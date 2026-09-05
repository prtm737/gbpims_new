// Serves the app's static assets through the worker's own fetch path instead
// of the Cloudflare static-assets binding. Some browsers fail to import()
// modules served by the assets binding (opaque preload + CORS-mode refetch
// interaction); running them through normal worker code avoids that layer.
import { createFileRoute } from "@tanstack/react-router";

const MIME: Record<string, string> = {
  js: "text/javascript",
  mjs: "text/javascript",
  css: "text/css",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
};

export const Route = createFileRoute("/api/public/asset")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const name = (url.searchParams.get("name") ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
        if (!name || name.includes("..")) return new Response("Not found", { status: 404 });

        // The worker runtime puts bindings (incl. ASSETS) on globalThis.__env__
        const env = (globalThis as { __env__?: { ASSETS?: { fetch: (r: Request) => Promise<Response> } } }).__env__;
        const ASSETS = env?.ASSETS;
        if (!ASSETS) return new Response("Assets unavailable", { status: 503 });

        const upstream = await ASSETS.fetch(new Request(`https://internal/assets/${name}`));
        if (!upstream.ok) return new Response("Not found", { status: 404 });

        const ext = name.split(".").pop() ?? "";
        const headers = new Headers();
        headers.set("content-type", MIME[ext] ?? "application/octet-stream");
        headers.set("cache-control", "public, max-age=31536000, immutable");
        headers.set("access-control-allow-origin", "*");
        headers.set("vary", "Origin");
        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
