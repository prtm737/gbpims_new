// Server-only Google Sheets access through the official Google Sheets v4 API,
// authenticated with a Google Cloud service account (OAuth2 JWT bearer flow).
import {
  DEFAULT_SETTINGS,
  HEADERS,
  LAB_IDS,
  TABS,
  type Row,
  type TabKey,
  type Workbook,
} from "./sheets-schema";

const API_ROOT = "https://sheets.googleapis.com/v4";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type ServiceAccount = { client_email: string; private_key: string };

let cachedToken: { token: string; expiresAt: number } | undefined;

function parseServiceAccount(): ServiceAccount {
  const raw = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ServiceAccount;
      if (parsed.client_email && parsed.private_key) return parsed;
    } catch {
      /* fall through to the individual-variable form */
    }
  }
  // Fallback: the key's literal "\n" sequences must be unescaped first.
  const clientEmail = process.env["GOOGLE_SERVICE_ACCOUNT_EMAIL"];
  const privateKey = process.env["GOOGLE_PRIVATE_KEY"]?.replace(/\\n/g, "\n");
  if (clientEmail && privateKey)
    return { client_email: clientEmail, private_key: privateKey };
  throw new Error(
    "Google Sheets connection is not configured for this project. Add the GOOGLE_SERVICE_ACCOUNT_JSON environment variable and try again.",
  );
}

function base64UrlEncode(bytes: Uint8Array | string): string {
  let binary: string;
  if (typeof bytes === "string") {
    binary = bytes;
  } else {
    let out = "";
    for (const b of bytes) out += String.fromCharCode(b);
    binary = out;
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64Decode(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

// RS256 JWT signing for the service-account OAuth flow, using the runtime's
// native WebCrypto (Cloudflare Workers, Node 20+). The service account's
// PKCS#8 private key is imported directly — no ASN.1 parsing needed.
async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const account = parseServiceAccount();
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const pemBody = account.private_key.split("-----")[2] ?? "";
  const keyBytes = base64Decode(pemBody.replace(/\s+/g, ""));
  const keyData = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength,
  ) as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${body}`),
  );
  return `${header}.${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000)
    return cachedToken.token;
  const account = parseServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({
    iss: account.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Google auth failed [${res.status}]: ${text.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sheetsApi<T>(path: string, init?: RequestInit): Promise<T> {
  let lastBody = "";
  let lastStatus = 0;

  // Google Sheets enforces a per-minute read/write quota; retry transient
  // throttling with exponential backoff before surfacing an error.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // A 401 can mean our cached token was revoked mid-flight; refresh once.
    const token = await getAccessToken();
    const res = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (res.ok) return (await res.json()) as T;

    lastStatus = res.status;
    lastBody = await res.text();
    // A 401 can mean our cached token expired early; drop it and retry once.
    if (lastStatus === 401 && attempt === 0) {
      cachedToken = undefined;
      continue;
    }
    if (!RETRY_STATUS.has(res.status)) break;
    // Fast first retry so a single throttled call doesn't stall the page.
    await sleep(150 * 2 ** attempt + Math.floor(Math.random() * 120));
  }

  console.error(
    `[sheets] ${init?.method ?? "GET"} ${path} failed [${lastStatus}]`,
  );
  if (lastStatus === 429) {
    throw new Error(
      "Google Sheets is rate limiting us right now (quota reached). Please wait a few seconds and retry — no data was lost.",
    );
  }
  throw new Error(
    `Google Sheets request failed [${lastStatus}]: ${lastBody.slice(0, 300)}`,
  );
}

type CacheEntry = { at: number; data: Workbook };
const workbookCache = new Map<string, CacheEntry>();
// Bumped on every write so an in-flight read that started before the write can
// never repopulate the cache with a pre-write copy of the workbook.
const writeGeneration = new Map<string, number>();
function bumpWriteGeneration(spreadsheetId: string): void {
  writeGeneration.set(
    spreadsheetId,
    (writeGeneration.get(spreadsheetId) ?? 0) + 1,
  );
}
// Fresh window served straight from memory, plus a longer stale window that is
// served instantly while a background refresh runs (keeps Sheets quota low).
const WORKBOOK_TTL_MS = 120_000;
const WORKBOOK_STALE_MS = 60 * 60_000;
const inFlight = new Map<string, Promise<Workbook>>();

// Durable snapshot in Postgres. Serverless workers start cold constantly, so the
// in-memory cache alone means every cold request pays a full Sheets read (and
// burns quota). The snapshot lets a cold worker answer instantly and refresh in
// the background, and it is also the fallback when Google rate limits us.
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60_000;

async function loadSnapshot(spreadsheetId: string): Promise<CacheEntry | null> {
  try {
    const { supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("workbook_snapshots")
      .select("data, updated_at")
      .eq("spreadsheet_id", spreadsheetId)
      .maybeSingle();
    if (!data?.data) return null;
    return {
      at: new Date(data.updated_at as string).getTime(),
      data: data.data as Workbook,
    };
  } catch {
    return null;
  }
}

async function saveSnapshot(
  spreadsheetId: string,
  data: Workbook,
): Promise<void> {
  try {
    const { supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("workbook_snapshots").upsert(
      {
        spreadsheet_id: spreadsheetId,
        data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "spreadsheet_id" },
    );
  } catch {
    /* snapshotting is best effort */
  }
}

function refreshInBackground(
  spreadsheetId: string,
  options: { ensure?: boolean },
): void {
  if (inFlight.has(spreadsheetId)) return;
  const task = fetchWorkbook(spreadsheetId, options).finally(() =>
    inFlight.delete(spreadsheetId),
  );
  inFlight.set(spreadsheetId, task);
  task.catch(() => {});
}

async function dropSnapshot(spreadsheetId: string): Promise<void> {
  try {
    const { supabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("workbook_snapshots")
      .delete()
      .eq("spreadsheet_id", spreadsheetId);
  } catch {
    /* best effort */
  }
}

/**
 * Drop the cached workbook so the next read reflects a just-written change.
 * The durable snapshot is dropped as well: otherwise a cold worker would serve
 * the pre-write copy from the database and deleted rows would reappear.
 */
export function invalidateWorkbookCache(spreadsheetId?: string): void {
  if (spreadsheetId) {
    workbookCache.delete(spreadsheetId);
    bumpWriteGeneration(spreadsheetId);
    void dropSnapshot(spreadsheetId);
  } else {
    workbookCache.clear();
  }
}

function colLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function rangeFor(tab: TabKey): string {
  const last = colLetter(HEADERS[tab].length - 1);
  return `${TABS[tab]}!A1:${last}5000`;
}

function rowsToObjects(values: string[][] | undefined, tab: TabKey): Row[] {
  if (!values || values.length < 2) return [];
  const headers = HEADERS[tab];
  return values
    .slice(1)
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => {
      const obj: Row = {};
      headers.forEach((h, i) => {
        obj[h] = String(r[i] ?? "");
      });
      return obj;
    });
}

function objectToRow(tab: TabKey, obj: Row): string[] {
  return HEADERS[tab].map((h) => String(obj[h] ?? ""));
}

type MetaIds = {
  sheets?: { properties?: { title?: string; sheetId?: number } }[];
};

const BRAND = { red: 0.388, green: 0.725, blue: 0.0 }; // GBP green #63B900
const BRAND_BLUE = { red: 0, green: 0.702, blue: 0.765 };
const PALE_GREEN = { red: 0.941, green: 0.98, blue: 0.925 };
const PALE_BLUE = { red: 0.91, green: 0.976, blue: 0.984 };
const PALE_AMBER = { red: 1, green: 0.957, blue: 0.82 };
const PALE_RED = { red: 1, green: 0.91, blue: 0.91 };

/**
 * Applies a consistent, presentable look to every tab: brand-green frozen
 * header row, banded rows, filter view and auto-sized columns. Idempotent and
 * safe to call after ensuring the tabs exist.
 */
export async function formatWorkbook(spreadsheetId: string): Promise<void> {
  const meta = await sheetsApi<MetaIds>(
    `/spreadsheets/${spreadsheetId}?fields=sheets.properties(title,sheetId)`,
  );

  // Retire the legacy, always-empty ElectricityBills tab: every electricity
  // bill is written to PowerLedger. Removed only when it holds no data rows.
  try {
    const legacy = (meta.sheets ?? []).find(
      (s) => s.properties?.title === "ElectricityBills",
    );
    const legacySheetId = legacy?.properties?.sheetId;
    if (legacySheetId !== undefined && legacySheetId >= 0) {
      const check = await sheetsApi<{ values?: string[][] }>(
        `/spreadsheets/${spreadsheetId}/values/ElectricityBills!A2:A`,
      );
      const hasData = (check.values ?? []).some(
        (r) => String(r[0] ?? "").trim() !== "",
      );
      if (!hasData) {
        await sheetsApi(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [{ deleteSheet: { sheetId: legacySheetId } }],
          }),
        });
      }
    }
  } catch {
    /* best effort — the tab may already be gone */
  }

  const byTitle = new Map(
    (meta.sheets ?? []).map((s) => [
      s.properties?.title ?? "",
      s.properties?.sheetId ?? -1,
    ]),
  );
  const requests: unknown[] = [];
  const decorative: unknown[] = [];

  for (const tab of Object.keys(TABS) as TabKey[]) {
    const sheetId = byTitle.get(TABS[tab]);
    if (sheetId === undefined || sheetId < 0) continue;
    const cols = HEADERS[tab].length;

    requests.push(
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: cols,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: BRAND,
              horizontalAlignment: "LEFT",
              verticalAlignment: "MIDDLE",
              padding: { top: 6, right: 8, bottom: 6, left: 8 },
              textFormat: {
                bold: true,
                fontSize: 10,
                foregroundColor: { red: 1, green: 1, blue: 1 },
              },
            },
          },
          fields:
            "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)",
        },
      },
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: cols,
          },
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 38 },
          fields: "pixelSize",
        },
      },
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: cols,
          },
          cell: {
            userEnteredFormat: {
              verticalAlignment: "MIDDLE",
              wrapStrategy: "WRAP",
              padding: { top: 4, right: 6, bottom: 4, left: 6 },
            },
          },
          fields: "userEnteredFormat(verticalAlignment,wrapStrategy,padding)",
        },
      },
    );

    decorative.push({
      addBanding: {
        bandedRange: {
          range: {
            sheetId,
            startRowIndex: 0,
            startColumnIndex: 0,
            endColumnIndex: cols,
          },
          rowProperties: {
            headerColor: BRAND,
            firstBandColor: { red: 1, green: 1, blue: 1 },
            secondBandColor: PALE_GREEN,
          },
        },
      },
    });

    if (
      tab === "labs" ||
      tab === "incubatees" ||
      tab === "rent" ||
      tab === "ledger"
    ) {
      const statusHeader =
        tab === "labs" ? "status" : tab === "incubatees" ? "status" : "status";
      const statusCol = HEADERS[tab].indexOf(statusHeader);
      if (statusCol >= 0) {
        const statusRange = {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: statusCol,
          endColumnIndex: statusCol + 1,
        };
        const rules = [
          { text: "paid", color: PALE_GREEN },
          { text: "occupied", color: PALE_BLUE },
          { text: "vacant", color: PALE_GREEN },
          { text: "pending", color: PALE_AMBER },
          { text: "partial", color: PALE_AMBER },
          { text: "overdue", color: PALE_RED },
          { text: "notice", color: PALE_RED },
        ];
        for (const rule of rules) {
          decorative.push({
            addConditionalFormatRule: {
              index: 0,
              rule: {
                ranges: [statusRange],
                booleanRule: {
                  condition: {
                    type: "TEXT_EQ",
                    values: [{ userEnteredValue: rule.text }],
                  },
                  format: {
                    backgroundColor: rule.color,
                    textFormat: { bold: true },
                  },
                },
              },
            },
          });
        }
      }
    }

    if (tab === "settings") {
      decorative.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: PALE_BLUE,
              textFormat: { bold: true, foregroundColor: BRAND_BLUE },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      });
    }
  }

  if (requests.length === 0) return;
  try {
    await sheetsApi(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  } catch (err) {
    // Banding already exists (or formatting is partially applied) — cosmetic only.
    console.warn(
      `[sheets] formatting skipped: ${(err as Error).message.slice(0, 160)}`,
    );
  }

  // Existing banding/conditional rules can reject duplicates, so cosmetic
  // decoration is isolated from the essential readable header styling.
  try {
    await sheetsApi(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: decorative }),
    });
  } catch {
    /* already banded */
  }
}

export async function ensureWorkbook(
  spreadsheetId: string,
): Promise<{ created: string[] }> {
  const meta = await sheetsApi<MetaIds>(
    `/spreadsheets/${spreadsheetId}?fields=sheets.properties(title,sheetId)`,
  );
  const existing = new Set(
    (meta.sheets ?? []).map((s) => s.properties?.title ?? ""),
  );
  const tabKeys = Object.keys(TABS) as TabKey[];
  const missing = tabKeys.filter((t) => !existing.has(TABS[t]));

  if (missing.length > 0) {
    await sheetsApi(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: missing.map((t) => ({
          addSheet: { properties: { title: TABS[t] } },
        })),
      }),
    });
  }

  // Write header rows for every tab (idempotent).
  await sheetsApi(`/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: tabKeys.map((t) => ({
        range: `${TABS[t]}!A1:${colLetter(HEADERS[t].length - 1)}1`,
        values: [HEADERS[t]],
      })),
    }),
  });

  // Retire the legacy, always-empty ElectricityBills tab: every electricity
  // bill is written to PowerLedger. Removed only when it holds no data rows.
  try {
    const legacy = (meta.sheets ?? []).find(
      (s) => s.properties?.title === "ElectricityBills",
    );
    const legacySheetId = legacy?.properties?.sheetId;
    if (legacySheetId !== undefined && legacySheetId >= 0) {
      const check = await sheetsApi<{ values?: string[][] }>(
        `/spreadsheets/${spreadsheetId}/values/ElectricityBills!A2:A`,
      );
      const hasData = (check.values ?? []).some(
        (r) => String(r[0] ?? "").trim() !== "",
      );
      if (!hasData) {
        await sheetsApi(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [{ deleteSheet: { sheetId: legacySheetId } }],
          }),
        });
      }
    }
  } catch {
    /* best effort — the tab may already be gone */
  }

  // Seed the labs and default settings when those tabs are empty.
  const wb = await readWorkbook(spreadsheetId, { ensure: false });

  if (wb.labs.length === 0) {
    await appendRows(
      spreadsheetId,
      "labs",
      LAB_IDS.map((id, i) => ({
        lab_id: id,
        block: "A",
        floor: String(Math.floor(i / 8) + 1),
        area_sqft: "",
        monthly_rent: DEFAULT_SETTINGS["default_monthly_rent"] ?? "",
        status: "vacant",
        notes: "",
      })),
    );
  }

  if (Object.keys(wb.settings).length === 0) {
    await appendRows(
      spreadsheetId,
      "settings",
      Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })),
    );
  }

  await formatWorkbook(spreadsheetId);

  return { created: missing.map((t) => TABS[t]) };
}

export async function readWorkbook(
  spreadsheetId: string,
  options: { ensure?: boolean; fresh?: boolean } = {},
): Promise<Workbook> {
  const cached = workbookCache.get(spreadsheetId);
  if (!options.fresh && cached) {
    const age = Date.now() - cached.at;
    if (age < WORKBOOK_TTL_MS) return cached.data;
    if (age < WORKBOOK_STALE_MS) {
      // Stale-while-revalidate: answer now, refresh in the background.
      refreshInBackground(spreadsheetId, options);
      return cached.data;
    }
  }
  const pending = inFlight.get(spreadsheetId);
  if (pending && !options.fresh) return pending;

  if (!options.fresh && !cached) {
    // Cold worker: serve the durable snapshot immediately when it is recent
    // enough, and warm the memory cache in the background.
    const snapshot = await loadSnapshot(spreadsheetId);
    if (snapshot && Date.now() - snapshot.at < SNAPSHOT_MAX_AGE_MS) {
      workbookCache.set(spreadsheetId, snapshot);
      if (Date.now() - snapshot.at > WORKBOOK_TTL_MS) {
        refreshInBackground(spreadsheetId, options);
      }
      return snapshot.data;
    }
  }

  const task = fetchWorkbook(spreadsheetId, options).finally(() =>
    inFlight.delete(spreadsheetId),
  );
  inFlight.set(spreadsheetId, task);
  return task;
}

async function fetchWorkbook(
  spreadsheetId: string,
  options: { ensure?: boolean } = {},
): Promise<Workbook> {
  const genAtStart = writeGeneration.get(spreadsheetId) ?? 0;
  const tabKeys = Object.keys(TABS) as TabKey[];
  const query = tabKeys.map((t) => `ranges=${rangeFor(t)}`).join("&");

  let data: { valueRanges?: { values?: string[][] }[] };
  try {
    data = await sheetsApi(
      `/spreadsheets/${spreadsheetId}/values:batchGet?${query}`,
    );
  } catch (error) {
    // Never blank the app on a transient Google failure (quota/network): fall
    // back to the last known copy from memory or the durable snapshot.
    const fallback =
      workbookCache.get(spreadsheetId) ??
      (await loadSnapshot(spreadsheetId)) ??
      null;
    if (fallback) {
      workbookCache.set(spreadsheetId, {
        at: fallback.at,
        data: fallback.data,
      });
      return fallback.data;
    }
    if (options.ensure === false) throw error;
    const message = error instanceof Error ? error.message : String(error);
    // Only repair workbook structure for Google's invalid/missing-range error.
    // Auth, quota and network failures must surface directly instead of causing
    // a second burst of write calls that can worsen throttling.
    if (
      !message.includes("[400]") &&
      !message.includes("Unable to parse range")
    ) {
      throw error;
    }
    await ensureWorkbook(spreadsheetId);
    data = await sheetsApi(
      `/spreadsheets/${spreadsheetId}/values:batchGet?${query}`,
    );
  }

  const ranges = data.valueRanges ?? [];
  const byTab = {} as Record<TabKey, Row[]>;
  tabKeys.forEach((t, i) => {
    byTab[t] = rowsToObjects(ranges[i]?.values, t);
  });

  const settings: Record<string, string> = {};
  byTab.settings.forEach((r) => {
    if (r["key"]) settings[r["key"]] = r["value"] ?? "";
  });

  const workbook: Workbook = {
    labs: byTab.labs,
    incubatees: byTab.incubatees,
    rent: byTab.rent,
    payments: byTab.payments,
    clients: byTab.clients,
    ledger: byTab.ledger,
    audit: byTab.audit ?? [],
    settings,
  };
  // Only cache when no write raced this read: a pre-write copy must never
  // overwrite the cache or the durable snapshot.
  if ((writeGeneration.get(spreadsheetId) ?? 0) === genAtStart) {
    workbookCache.set(spreadsheetId, { at: Date.now(), data: workbook });
    void saveSnapshot(spreadsheetId, workbook);
  }
  return workbook;
}

/** Make sure every lab in the roster (L01..L26) exists as a row. */
export async function syncLabRoster(spreadsheetId: string): Promise<number> {
  const wb = await readWorkbook(spreadsheetId, { fresh: true, ensure: false });
  const have = new Set(wb.labs.map((l) => l["lab_id"]));
  const missing = LAB_IDS.filter((id) => !have.has(id));
  if (missing.length === 0) return 0;
  await appendRows(
    spreadsheetId,
    "labs",
    missing.map((id) => ({
      lab_id: id,
      block: "A",
      floor: String(Math.floor((Number(id.slice(1)) - 1) / 9) + 1),
      area_sqft: "",
      monthly_rent: DEFAULT_SETTINGS["default_monthly_rent"] ?? "",
      status: "vacant",
      notes: "",
      space_type: "lab",
      name: id,
    })),
  );
  return missing.length;
}

export async function appendRows(
  spreadsheetId: string,
  tab: TabKey,
  rows: Row[],
): Promise<void> {
  if (rows.length === 0) return;
  invalidateWorkbookCache(spreadsheetId);
  await sheetsApi(
    `/spreadsheets/${spreadsheetId}/values/${TABS[tab]}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: rows.map((r) => objectToRow(tab, r)) }),
    },
  );
  invalidateWorkbookCache(spreadsheetId);
}

/** Rewrite the header row of one tab (idempotent) so new columns exist. */
export async function writeTabHeaders(
  spreadsheetId: string,
  tab: TabKey,
): Promise<void> {
  const last = colLetter(HEADERS[tab].length - 1);
  await sheetsApi(
    `/spreadsheets/${spreadsheetId}/values/${TABS[tab]}!A1:${last}1?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [HEADERS[tab]] }) },
  );
}

/** Update a single row matched on its first (id) column. Returns false when not found. */
export async function updateRowById(
  spreadsheetId: string,
  tab: TabKey,
  idValue: string,
  patch: Row,
): Promise<boolean> {
  invalidateWorkbookCache(spreadsheetId);
  const data = await sheetsApi<{ values?: string[][] }>(
    `/spreadsheets/${spreadsheetId}/values/${rangeFor(tab)}`,
  );
  const values = data.values ?? [];
  const headers = HEADERS[tab];
  const index = values.findIndex(
    (r, i) => i > 0 && String(r[0] ?? "") === idValue,
  );
  if (index === -1) return false;

  const current: Row = {};
  headers.forEach((h, i) => {
    current[h] = String(values[index]?.[i] ?? "");
  });
  const merged = { ...current, ...patch };
  const rowNumber = index + 1;
  const last = colLetter(headers.length - 1);

  await sheetsApi(
    `/spreadsheets/${spreadsheetId}/values/${TABS[tab]}!A${rowNumber}:${last}${rowNumber}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [objectToRow(tab, merged)] }),
    },
  );
  invalidateWorkbookCache(spreadsheetId);
  return true;
}

/** Clear a single row matched on its first (id) column. Returns false when not found. */
export async function deleteRowById(
  spreadsheetId: string,
  tab: TabKey,
  idValue: string,
): Promise<boolean> {
  invalidateWorkbookCache(spreadsheetId);
  const data = await sheetsApi<{ values?: string[][] }>(
    `/spreadsheets/${spreadsheetId}/values/${rangeFor(tab)}`,
  );
  const values = data.values ?? [];
  const index = values.findIndex(
    (r, i) => i > 0 && String(r[0] ?? "") === idValue,
  );
  if (index === -1) return false;
  const rowNumber = index + 1;
  const last = colLetter(HEADERS[tab].length - 1);
  await sheetsApi(
    `/spreadsheets/${spreadsheetId}/values/${TABS[tab]}!A${rowNumber}:${last}${rowNumber}:clear`,
    { method: "POST", body: "{}" },
  );
  invalidateWorkbookCache(spreadsheetId);
  return true;
}

export async function replaceSettings(
  spreadsheetId: string,
  settings: Record<string, string>,
): Promise<void> {
  invalidateWorkbookCache(spreadsheetId);
  const rows = Object.entries(settings).map(([key, value]) => [key, value]);
  await sheetsApi(
    `/spreadsheets/${spreadsheetId}/values/${TABS.settings}!A1:B1000?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [HEADERS.settings, ...rows] }),
    },
  );
  // Invalidate again after the write so a read that raced the PUT cannot leave
  // the old rates cached.
  invalidateWorkbookCache(spreadsheetId);
}

export async function spreadsheetTitle(spreadsheetId: string): Promise<string> {
  const meta = await sheetsApi<{ properties?: { title?: string } }>(
    `/spreadsheets/${spreadsheetId}?fields=properties.title`,
  );
  return meta.properties?.title ?? "Untitled spreadsheet";
}
