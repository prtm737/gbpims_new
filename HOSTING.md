# GBPIMS — Hosting

## Live at: https://gbpims.gbpims.workers.dev (Cloudflare Workers — always-on, no sleep)
Short URL: `https://gbpims.gbpims.workers.dev` (14 chars host, no `prtm737` — subdomain `gbpims` + worker `gbpims`).

Custom tiny domain (optional): add your domain to Cloudflare and set `CLOUDFLARE_CUSTOM_DOMAIN=gbp.yourdomain.com` as a GitHub secret or env var — deploy script will bind it.

Legacy: https://gbpims.netlify.app (Netlify — kept as fallback). Render retired (free tier sleeps after 15 min).

## Deploy
Push to `main` → GitHub Actions builds (`npm run build` with `cloudflare-module` preset) → `node scripts/deploy-cloudflare.mjs` deploys to Workers.

Required GitHub secrets:
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
Optional:
- `WORKER_NAME` (default `gbpims`; use `gbp` for shortest URL)
- `CLOUDFLARE_CUSTOM_DOMAIN` (e.g. `gbpims.example.com`)

Manual deploy (Termux/local):
```sh
export CLOUDFLARE_API_TOKEN="..." CLOUDFLARE_ACCOUNT_ID="..."
export WORKER_NAME=gbpims  # or gbp for shorter URL
# VARS are read from env at deploy time; secrets from .env.deploy
export SUPABASE_URL="https://fphchylxhcghlvfkvkfz.supabase.co"
export SUPABASE_PUBLISHABLE_KEY="..."
# .env.deploy must contain VARS + SUPABASE_SERVICE_ROLE_KEY + GOOGLE_SERVICE_ACCOUNT_JSON
npm run build
node scripts/deploy-cloudflare.mjs
```

## Keepalive
Supabase free projects pause after 7d inactivity — Cloudflare cron `13 3 * * *` triggers `src/server-keepalive.ts` daily.
