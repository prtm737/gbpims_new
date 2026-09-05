import { schedule } from "@netlify/functions";
export const handler = schedule("@daily", async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { statusCode: 200, body: "no env" };
  try {
    await fetch(`${url}/rest/v1/user_roles?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    console.log("[keepalive] ping ok");
  } catch (e) { console.error("[keepalive]", e); }
  return { statusCode: 200, body: "ok" };
});
