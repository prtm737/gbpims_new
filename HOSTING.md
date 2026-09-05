# GBPIMS — Hosting
## Live at: https://gbpims.netlify.app (primary — use this)
## Mirror: https://app.prtam737-gbpims.workers.dev (Cloudflare — kept for redundancy, `*.workers.dev` is unreliable in some Indian networks due to HTTP3/module-preload edge bug — Netlify is the official URL)

## Deploy
cd /data/data/com.termux/files/usr/tmp/opencode/gbpims
export NETLIFY_AUTH_TOKEN="nfp_..."
node_modules/.bin/netlify deploy --site=d514a2a7-9a63-49a4-a306-dbe3dae7c2d7 --dir=dist --functions=.netlify/functions-internal --prod

## Cloudflare redeploy (mirror only):
export CLOUDFLARE_API_TOKEN="cfat_..." CLOUDFLARE_ACCOUNT_ID="1612f4..." WORKER_NAME=app
node scripts/deploy-cloudflare.mjs

## Keepalive
Supabase free projects pause after 7d inactivity — the worker's daily cron plugin (src/server-keepalive.ts) pings daily. Netlify function also keeps it warm via SSR requests.
