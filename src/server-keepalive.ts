// Nitro plugin: daily Supabase keep-alive via Cloudflare cron trigger.
// Free Supabase projects pause after ~1 week with no API activity; a single
// REST query per day (counted as database activity) keeps the project alive.
// The cron schedule itself is attached to the worker by scripts/deploy-cloudflare.mjs.
import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("cloudflare:scheduled", async ({ controller }) => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) return;
    try {
      await fetch(`${url}/rest/v1/user_roles?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      console.log(
        `[keepalive] ping at ${new Date().toISOString()} (cron: ${controller.cron})`,
      );
    } catch (error) {
      console.error("[keepalive] failed:", error);
    }
  });
});
