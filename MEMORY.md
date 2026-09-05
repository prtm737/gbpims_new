# GBPIMS — Project Memory

> Read this at the start of every session. Append a dated entry after every
> significant change so the next session (or a different model) can pick up
> without the user re-explaining anything. Keep entries short and factual.

## What this project is
GBPIMS — Guwahati Biotech Park Incubatee Management System. Staff portal for
26 modular labs: occupancy, monthly rent, electricity billing, payments.
Data lives in a team-owned Google Sheet (not a DB); Supabase is used only for
auth. Connected to Lovable — NEVER rewrite published git history (no force
push, no rebase/squash of pushed commits).

## Architecture
- Stack: React 19 + TanStack Start (SSR) + TanStack Router (file-based) +
  Vite 8 + Tailwind 4 + Nitro (`netlify` preset). Bun/termux local dev.
- Live URL: https://gbpims.netlify.app (primary). Cloudflare Workers mirror:
  https://app.prtam737-gbpims.workers.dev (`scripts/deploy-cloudflare.mjs`).
- CI/CD: `.github/workflows/deploy.yml` — push to `main` → npm install
  (`--legacy-peer-deps`, vite 8/tailwind peer conflict) → build →
  `netlify deploy --prod` (site `d514a2a7-9a63-49a4-a306-dbe3dae7c2d7`).
- Routes: `/` landing, `/auth` sign-in, `/reset-password`,
  `/_authenticated/{dashboard,labs,incubatees,leases,rent,billing,ledger,reports,settings}`
  (guard in `src/routes/_authenticated/route.tsx`, `ssr:false`, redirects via
  `authClient.auth.getUser()`).
- Server API routes: `src/routes/api/public/auth-proxy.ts` (forwards
  `/auth/v1/*` to Supabase so the browser never calls Supabase directly),
  `src/routes/api/public/asset.ts`.

## Auth & env vars (critical — broke once, see changelog)
- Supabase project: `fphchylxhcghlvfkvkfz`.
- CLIENT build-time (must be set when `npm run build` runs, baked into JS):
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
  `src/lib/auth-client.ts` throws "Authentication is not configured." if
  missing → root error boundary shows "This page didn't load".
- SERVER runtime (Netlify site env / workflow secrets): `SUPABASE_URL`,
  `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `GOOGLE_SERVICE_ACCOUNT_JSON`. Template: `.env.deploy.example`.
- The workflow maps the same `SUPABASE_*` secrets into the `VITE_*` names.

## Data layer
- Google Sheet workbook via service account `gbpims@gbpims-507606.iam...`.
- Schema/tabs: `src/lib/sheets-schema.ts`; server reads/writes:
  `src/lib/sheets.server.ts`, `src/lib/gbp.server.ts`; server functions:
  `src/lib/gbp.functions.ts`; client cache hook: `src/lib/use-app-data.ts`
  (TanStack Query); derived views: `src/lib/derive.ts`.
- Roles: admin / staff / viewer — helpers in `src/components/workbook-state.tsx`
  (`canWrite`, `canCreate`, `canEdit`, `canDelete`).
- PDFs: `src/lib/pdf*.ts` (jspdf) for rent/electricity invoices.

## Keep-alive
- Supabase free tier pauses after 7d idle. Nitro cron plugin
  `src/server-keepalive.ts` + Netlify function `netlify/functions/keepalive.mjs`.

## Error handling
- `src/server.ts` wraps SSR fetch, converts h3-swallowed 500s into
  `src/lib/error-page.ts` HTML ("This page didn't load"). Set
  `SHOW_SERVER_ERRORS=1` on the worker to expose stack traces temporarily.
- Client-side: `ErrorComponent` in `src/routes/__root.tsx` +
  `src/lib/lovable-error-reporting.ts`.

## Changelog
### 2026-09-05 — Fixed production auth crash ("This page didn't load")
- Symptom: `/` fine, `/auth` + `/dashboard` showed the error page on
  gbpims.netlify.app.
- Cause: GitHub Actions deploy (added 2026-09-04) passed only server-side
  `SUPABASE_*` env at build; client bundle had no `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_PUBLISHABLE_KEY`, so `authClient` threw on first use.
- Fix: `deploy.yml` now writes a `.env` file with the `VITE_*` values before
  `npm run build` (process.env alone did NOT embed in CI builds — the
  known-good local build had a `.env` file) and fails the build if the
  secrets are empty or if the built bundle lacks the Supabase URL.
- Gotcha: after a "successful" Actions run, verify the live bundle actually
  contains `VITE_SUPABASE_URL` — identical asset hash across deploys means
  the env never reached the build.
- Lesson: any env the browser needs must be present at BUILD time, not just
  runtime.

### 2026-09-04 — CI/CD setup
- Added GitHub Actions auto-deploy to Netlify; `npm install` with
  `--legacy-peer-deps` (vite 8 + tailwind peer conflict); added missing
  `@netlify/functions` dep for the keepalive function.
- Initial commit of the whole project.
