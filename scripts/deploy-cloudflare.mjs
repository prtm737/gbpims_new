#!/usr/bin/env node
// Deploys the built Cloudflare Worker (from .output/) via the Cloudflare REST
// API, without wrangler (which cannot run on Android/Termux).
//
// Required env vars:
//   CLOUDFLARE_API_TOKEN  - token with Workers Scripts:Edit + Workers KV:Edit (for vars)
//   CLOUDFLARE_ACCOUNT_ID - your account id
// Optional:
//   WORKER_NAME           - defaults to "gbpims"
//
// Usage: node scripts/deploy-cloudflare.mjs
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SERVER_DIR = path.join(ROOT, ".output", "server");
const PUBLIC_DIR = path.join(ROOT, ".output", "public");
const WRANGLER = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, "wrangler.json"), "utf8"));
const WORKER_NAME = process.env["WORKER_NAME"] ?? "gbpims";
const API = "https://api.cloudflare.com/client/v4";

const TOKEN = process.env["CLOUDFLARE_API_TOKEN"];
const ACCOUNT = process.env["CLOUDFLARE_ACCOUNT_ID"];
if (!TOKEN || !ACCOUNT) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

async function cf(pathname, init) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare API ${res.status} at ${pathname}: ${text.slice(0, 400)}`);
  }
  if (!res.ok || json.success === false) {
    throw new Error(
      `Cloudflare API error at ${pathname}: ${JSON.stringify(json.errors ?? text).slice(0, 600)}`,
    );
  }
  return json.result ?? json;
}

function extensionOf(p) {
  const ext = path.extname(p).slice(1);
  return ext || "bin";
}

// 1) Build the asset manifest (hash = sha256(base64(content)+extension)[:32])
function buildManifest() {
  const manifest = {};
  function walk(dir, base = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) {
        const content = fs.readFileSync(full);
        const hash = createHash("sha256")
          .update(content.toString("base64") + extensionOf(rel))
          .digest("hex")
          .slice(0, 32);
        manifest[`/${rel}`] = { hash, size: content.length };
      }
    }
  }
  walk(PUBLIC_DIR);
  if (Object.keys(manifest).length === 0) throw new Error("No assets found in .output/public");
  return manifest;
}

// 2) Collect every server module the entry imports (Nitro no_bundle layout)
function collectModules() {
  const modules = [];
  const seen = new Set();
  const importRe = /from\s+["'](\.[^"']+)["']/g;

  function addFile(absPath) {
    const rel = path.relative(SERVER_DIR, absPath);
    const key = path.posix.normalize(rel.split(path.sep).join("/"));
    if (seen.has(key)) return;
    seen.add(key);
    const content = fs.readFileSync(absPath, "utf8");
    modules.push({
      name: key,
      content_type: key.endsWith(".mjs") || key.endsWith(".js")
        ? "application/javascript+module"
        : "application/octet-stream",
      content_base64: fs.readFileSync(absPath).toString("base64"),
    });
    // Follow relative imports (chunks/libs live in sibling dirs), both static
    // and dynamic ones.
    const dir = path.dirname(absPath);
    let m;
    const dynRe = /import\(\s*["'](\.[^"']+)["']\s*\)/g;
    const targets = new Set();
    while ((m = importRe.exec(content))) targets.add(m[1]);
    while ((m = dynRe.exec(content))) targets.add(m[1]);
    for (const t of targets) {
      const resolved = path.resolve(dir, t);
      for (const suffix of ["", ".mjs", ".js", "/index.mjs"]) {
        const cand = resolved + suffix;
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          addFile(cand);
          break;
        }
      }
    }
  }

  addFile(path.join(SERVER_DIR, "index.mjs"));
  if (modules.length === 0) throw new Error("No server modules collected");
  return modules;
}

const manifest = buildManifest();
console.log(`Assets: ${Object.keys(manifest).length} files`);
const modules = collectModules();
console.log(`Server modules: ${modules.length} files`);

// 3) Open an asset upload session
const session = await cf(
  `/accounts/${ACCOUNT}/workers/scripts/${WORKER_NAME}/assets-upload-session`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifest }),
  },
);
let completionJwt = session.jwt;
const MIME = {
  js: "text/javascript",
  mjs: "text/javascript",
  css: "text/css",
  html: "text/html; charset=utf-8",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  webmanifest: "application/manifest+json",
  txt: "text/plain; charset=utf-8",
  woff: "font/woff",
  woff2: "font/woff2",
  pdf: "application/pdf",
};
function mimeOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

const buckets = session.buckets ?? [];

const hashToPath = new Map(Object.entries(manifest).map(([p, v]) => [v.hash, p]));
let uploaded = 0;
for (const bucket of buckets) {
  // The upload endpoint requires multipart/form-data: one field per file,
  // field name = hash, value = base64 content, plus the base64=true query param.
  // Each part's Content-Type is what Cloudflare serves the file with — without
  // it browsers refuse to execute scripts (strict MIME checking).
  const form = new FormData();
  for (const hash of bucket) {
    const rel = hashToPath.get(hash);
    if (!rel) throw new Error(`No file for hash ${hash}`);
    const content = fs.readFileSync(path.join(PUBLIC_DIR, rel));
    form.append(
      hash,
      new Blob([content.toString("base64")], { type: mimeOf(rel) }),
      rel,
    );
  }
  const res = await fetch(`${API}/accounts/${ACCOUNT}/workers/assets/upload?base64=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.jwt}` },
    body: form,
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(`Asset upload failed: ${JSON.stringify(json).slice(0, 400)}`);
  }
  if (json.result?.jwt) completionJwt = json.result.jwt;
  uploaded += bucket.length;
}
console.log(`Uploaded ${uploaded} new asset(s)`); 
if (!completionJwt) throw new Error("No completion JWT from asset upload");

// 4) Upload the script (metadata + modules) as a new version.
// Plain-text vars come from .env.deploy (VARS=... line, comma-separated);
// secrets (SUPABASE_SERVICE_ROLE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON) are set
// through the secrets endpoint after deployment so they never appear in
// version metadata.
const secrets = {};
const plainVars = {};
const envDeployPath = path.join(ROOT, ".env.deploy");
if (fs.existsSync(envDeployPath)) {
  for (const line of fs.readFileSync(envDeployPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === "VARS") {
      for (const name of value.split(",").map((s) => s.trim()).filter(Boolean)) {
        const v = process.env[name];
        if (v !== undefined) plainVars[name] = v;
      }
    } else {
      secrets[key] = value;
    }
  }
}

const metadata = {
  main_module: "index.mjs",
  compatibility_date: WRANGLER.compatibility_date,
  compatibility_flags: WRANGLER.compatibility_flags ?? ["nodejs_compat"],
  bindings: [
    ...(WRANGLER.assets?.binding ? [{ type: "assets", name: WRANGLER.assets.binding }] : []),
    ...Object.entries(plainVars).map(([name, text]) => ({ type: "plain_text", name, text })),
  ],
  // Daily cron so the Supabase keep-alive plugin runs once a day (free tier).
  triggers: { cron: ["13 3 * * *"] },
  assets: { jwt: completionJwt },
  observability: { enabled: true },
};

const form = new FormData();
form.append("metadata", JSON.stringify(metadata));
for (const mod of modules) {
  form.append(
    mod.name,
    new Blob([Buffer.from(mod.content_base64, "base64")], { type: mod.content_type }),
    mod.name,
  );
}

const version = await cf(`/accounts/${ACCOUNT}/workers/scripts/${WORKER_NAME}/versions`, {
  method: "POST",
  body: form,
});
console.log(`Version created: ${version.id}`);

// 5) Deploy the version to 100% of traffic
await cf(`/accounts/${ACCOUNT}/workers/scripts/${WORKER_NAME}/deployments`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    strategy: "percentage",
    versions: [{ percentage: 100, version_id: version.id }],
  }),
});

// 6) Set secrets (PUT per secret; values are never logged)
for (const [name, value] of Object.entries(secrets)) {
  const res = await fetch(
    `${API}/accounts/${ACCOUNT}/workers/scripts/${WORKER_NAME}/secrets`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, text: value, type: "secret_text" }),
    },
  );
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(`Failed to set secret ${name}: ${JSON.stringify(json.errors ?? res.status)}`);
  }
  console.log(`Secret set: ${name}`);
}

// 7) Enable the workers.dev subdomain route
const subdomain = await cf(`/accounts/${ACCOUNT}/workers/subdomain`);
await cf(`/accounts/${ACCOUNT}/workers/scripts/${WORKER_NAME}/subdomain`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ enabled: true }),
}).catch((e) => console.warn(`subdomain enable: ${e.message}`));

console.log(`\nDeployed! Live at: https://${WORKER_NAME}.${subdomain.subdomain}.workers.dev`);
