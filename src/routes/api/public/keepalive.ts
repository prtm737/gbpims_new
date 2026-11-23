import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/keepalive")({
  server: {
    handlers: {
      GET: keepAlive,
    },
  },
});

// Supabase free tier pauses after ~7 days without API activity. Pinging the
// REST endpoint with the service key counts as database activity and keeps the
// project alive; the caller (cron / bot / workflow) just needs a stable URL.
const KEEP_ALIVE_PATH = "/rest/v1/user_roles?select=id&limit=1";

async function keepAlive() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    return Response.json({ ok: false, reason: "missing_env" }, { status: 503 });
  }
  try {
    const response = await fetch(`${url}${KEEP_ALIVE_PATH}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      // Don't let a stalled Supabase keep-alive hang the caller forever.
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return Response.json({ ok: false, status: response.status }, { status: 502 });
    }
    return Response.json({ ok: true, at: new Date().toISOString() });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 503 });
  }
}
