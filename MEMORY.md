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
  Vite 8 + Tailwind 4 + Nitro (`cloudflare-module` preset, always-on). Bun/termux local dev.
- Live URL: https://gbpims.gbpims.workers.dev (Cloudflare Workers, short URL — subdomain `gbpims`, no `prtm737`). Legacy: https://gbpims.netlify.app (fallback). Render retired — free tier slept after 15 min idle, cron keep-alive unreliable.
- CI/CD: `.github/workflows/deploy.yml` — push to `main` → npm install
  (`--legacy-peer-deps`) → `npm run build` (cloudflare-module, bakes `VITE_*`) →
  `node scripts/deploy-cloudflare.mjs` (requires `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; optional `WORKER_NAME`, `CLOUDFLARE_CUSTOM_DOMAIN`). Script auto-detects `.output/` (local) vs `dist/` (Lovable sandbox).
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
### 2026-09-08 — Fixed "bills vanish" (stale caches) + empty PDF archive + recovery tool
- ROOT CAUSE of "generated bills disappeared / sometimes show, sometimes don't":
  the app served STALE workbook copies as truth. Three layers fixed:
  1. Cold workers served the Supabase snapshot if < 24h old — any read racing a
     write could poison that snapshot with a PRE-write copy, hiding just-written
     bills for up to a day. SNAPSHOT_MAX_AGE_MS 24h → 10 min.
  2. Stale-while-revalidate window was 60 min (bills written up to an hour ago
     invisible). WORKBOOK_STALE_MS 60 min → 5 min.
  3. fetchWorkbook's error fallback served cache/snapshot EVEN FOR FRESH READS,
     so getFreshWorkbook (post-write UI refresh) could silently lie. Fresh reads
     now throw on Google errors; only non-fresh reads may fall back.
  4. NEW revalidateAfterWrite(): after every appendRows/updateRowById/
    deleteRowById/replaceSettings a fresh full read re-caches + re-snapshots the
    POST-write workbook, closing the read-race poison window for good.
- updateRowById now REFUSES (throws) when multiple rows share the id — editing
  the wrong duplicate row is impossible. savePowerBill: edit of a bill that
  vanished from the sheet throws instead of appending a duplicate; fresh clash
  check now throws if the bill number belongs to ANOTHER client.
- deleteRowById clears ALL rows sharing the id (values:batchClear), removing
  legacy duplicate rows when a bill/client is explicitly deleted.
- powerBills() dedupes by bill_id (newest timestamp wins) so any historical
  duplicate rows can never make entries flicker; PowerBill gained `timestamp`.
- PDF archive "always empty" root cause: listPdfArchive skipped month folders —
  Supabase list returns folder pseudo-entries with id:null and the old code did
  `if (!monthFolder.id) continue`. Rewritten walk: kind → month (id-less) →
  files (id). PDFs were stored all along, never listed.
- Generation-time PDF archiving errors now toast instead of silent catch
  (billing.tsx + rent-bill-dialog.tsx).
- Sync tenants safety: dup client rows sharing the primary id are never deleted.
- Settings → "Recover lost rows" (admin): scanMissingRows() compares the live
  sheet (fresh read) against up to 14 days of backups/<date>/workbook.json in
  the gbpims-pdfs bucket across ledger/rent/labs/incubatees/clients/payments;
  restoreMissingRows() appends only rows still absent (idempotent) and
  verifies with a fresh read, reporting anything unrestorable. This is the tool
  for the Sep 3 missing bills — run it and press restore if rows are missing.
- UI: workbook query staleTime 0 + refetchOnWindowFocus (sessionStorage cache is
  paint-only); billing engine bill list slice 40 → 200.
- Gotcha: duplicate bill rows in the sheet are harmless now (UI dedupes) but
  should be cleaned manually if seen — updateRowById refuses ambiguous edits.
- Typecheck = only pre-existing __root.tsx error; vite build OK.

### 2026-09-08 — Billing engine: one client per company + arrears-note fix + PDF preview fix
- Billing engine (and everything using `powerClients()`) now merges PowerClients
  rows that share a company name into ONE entry, like the Ledger: `PowerClient`
  gained `clientIds` (all merged row ids, primary first) + `incubateeIds`; meters
  union by lab name; blanks filled from duplicates. `lastReadings`/
  `outstandingArrears`/`isOrphanBill` accept `string | string[]` and check every
  merged id — auto arrears and previous readings now cover all labs of a company.
- `importTenantClients` (Billing → "Sync tenants") is now a consolidation pass:
  duplicate client rows for the same company are MERGED into the first row
  (meters combined, load/AC/profile fields picked first-non-empty), their ledger
  bills re-pointed to the surviving client_id, dup rows deleted; single rows get
  missing lab meters + incubatee link topped up. Returns `{created, merged,
  updated, skipped}`; billing page toast lists all three counts.
- billing.tsx: `selected`/`powerPdfOptions`/`loadGeneratedBill` resolve clients
  via `clientIds` so bills recorded under a pre-merge duplicate id still find
  their company (and its merged client is used for the bill form).
- pdf.ts: "Please ignore the arear amount if paid…" note now prints ONLY when
  `bill.arrears > 0 || bill.surcharge > 0` (was unconditional).
- PDF preview fix: CSP had no `frame-src`, so `default-src 'self'` blocked the
  preview dialog's `blob:` iframe (blank dialog on Preview). Added
  `frame-src 'self' blob:;` (+ `media-src 'self' blob:;`) to BOTH CSP strings —
  `vite.config.ts` routeRules AND `public/_headers` (they must stay in sync).
- Gotcha: user should press "Sync tenants" once to physically merge duplicate
  PowerClients rows; until then the UI merges them at render time anyway.
- Typecheck (tmp deps: /data/.../tmp/opencode/gbpdeps — needs `npm install
  --legacy-peer-deps` there after any `--no-save` install prunes it; copy
  package.json from repo first) = only the pre-existing __root.tsx
  ErrorComponentProps error. vite build OK.

### 2026-09-07 — Office-workflow upgrade batch (all 9 audit items)
- Daily backup: backup.server.ts writes backups/<date>/workbook.json into the
  gbpims-pdfs bucket (90 days kept, auto-pruned). Fires once/day from
  getWorkbook/getFreshWorkbook; manual "Back up now" + downloadable list in
  Settings (listBackupsFn/getBackupDownloadUrlFn/backupNowFn).
- Dashboard: TodayChecklist card (rent generated? electricity unpaid?
  overdue? leases expiring 60d? backup status) with progress bar.
- Ledger: "Remind all" opens BulkReminderDialog — walks overdue rent +
  electricity dues one-by-one through WhatsApp (reminderMessage loosened to a
  structural type).
- Incubatees: duplicate company-name guard — inline amber hint + confirm()
  before creating a second active row with the same name.
- Generate rent: response includes skipped[] (companies with no space); the
  toast lists created/refreshed/skipped by name.
- GlobalSearch palette in AppShell header (Ctrl/⌘-K or "/"): tenants, spaces,
  rent invoices, electricity bills with amounts and due info; links to pages.
- Reports: security-deposit register (held vs refundable, CSV export).
- Money inputs (rent dialog, manual rent/power entry) get Indian comma
  grouping on blur via formatAmount(); num() strips commas so grouped values
  parse everywhere.
- UI polish: gbp-fade-up/gbp-fade-in/gbp-pop keyframes + card-hover utility,
  prefers-reduced-motion guard; StatCard lift+fade; page content fade-in;
  nav items and all buttons animate press (active:scale).

### 2026-09-07 — Fixed 400 on Format workbook after rename deploy
- Symptom: "Unable to parse range: ElectricityBills!A1:AG5000" when pressing
  Format workbook; sheet unchanged.
- Cause: migrateLedgerColumnOrder ran before the ElectricityBills tab was
  guaranteed to exist (rename step had failed silently on a stale sheet list
  / undefined sheetId), and the migration read was not wrapped.
- Fixes in ensureWorkbook:
  - Rename now re-fetches meta first, requires a numeric sheetId, skips if
    ElectricityBills already exists (concurrency-safe).
  - If ElectricityBills is still missing, salvage step creates it and copies
    PowerLedger data verbatim before migrating.
  - migrateLedgerColumnOrder fully wrapped — failures are warnings only.

### 2026-09-07 — Renamed PowerLedger → ElectricityBills + simplified sheet
- TABS.ledger renamed: "PowerLedger" → "ElectricityBills" (user expectation).
  ensureWorkbook: deletes the empty old ElectricityBills leftover tab, then
  renames PowerLedger. Ledger header order changed to put human-readable
  columns first (bill_id, client_name, dates, units, charges, amounts,
  status, remarks); technical columns moved to the end.
- migrateLedgerColumnOrder(): rewrites existing rows stored in the old
  column order (detected by exact old-header match) so data aligns with the
  new headers. Runs inside ensureWorkbook before header rewrite.
- HIDDEN_HEADERS: technical columns (readings, ids, rates, timestamp…) are
  hidden in the sheet via updateDimensionProperties(hidden) — data intact.
- Frozen first row + first column on every tab.
- Dashboard formulas remapped to the new ElectricityBills column letters:
  total N, paid O, balance P, status Q, month C, client B.
- "Format workbook" button now runs full ensureWorkbook (rename + migrate +
  format + dashboard), not just formatting.
- Gotcha: the rename changes the tab name users see; older audit mentions of
  PowerLedger refer to the same tab.

### 2026-09-07 — Auto workbook upgrade (no manual button needed)
- `upgradeWorkbookOnce()` in gbp.server.ts: once per day per server instance,
  the first workbook load fires `ensureWorkbook` in the background — applies
  formatting, creates the Dashboard tab, deletes the empty legacy
  ElectricityBills tab. Triggered fire-and-forget from getWorkbook/getFresh
  Workbook; silent failures only.
- Reason: user expected the sheet to change automatically; "Format workbook"
  button lives on the Settings page and was never pressed.

### 2026-09-07 — Ledger grouping by company + live Dashboard tab + archive-on-generate
- Ledger page: groups keyed by company name (case-insensitive) instead of
  incubatee_id — companies occupying several labs (Zymolent, Exiss, ZeroHarm)
  now appear as ONE group with all labs and entries merged. Orphaned records
  stay in their own "Orphaned — X" group.
- `savePowerBill`: before appending a new bill number, re-checks against a
  fresh sheet read; a stale cache could allocate an existing number and
  OVERWRITE another client's bill row — root cause of "Elia/Nectar bills
  missing from sheet while showing in app". Regenerate missing bills.
- `importTenantClients`: one billing client per company, meters seeded for
  every lab the company occupies (was one client per tenant row).
- PDF archive now also fires at GENERATION time (billing engine + rent bill
  dialog), not only on download.
- Sheet redesign (runs on Settings → "Format workbook" and on connect):
  currency ₹ format on all amount columns, yyyy-mm-dd on date columns, and a
  new green "Dashboard" tab — all-time KPIs, 12-month billed/collected/
  outstanding report, live "who owes what" FILTER tables. Month matching uses
  SUMPRODUCT(IF(ISNUMBER(...),TEXT(...),LEFT(...))) so it works whether the
  sheet stored dates as real dates or ISO text.

### 2026-09-07 — Month-wise PDF archive in Supabase Storage
- New private bucket `gbpims-pdfs`, bootstrapped lazily via the Storage API on
  first upload (no migration needed; supabaseAdmin service role).
- Layout: `<kind>/<YYYY-MM>/<refId>_<label>.pdf`, kind = electricity | rent |
  receipt. Upsert on the same path replaces (regenerated bill = new PDF).
- Server: `src/lib/pdf-archive.server.ts` (archivePdf, listPdfArchive,
  getPdfDownloadUrl → 1h signed URL) + `archivePdfFn`/`listPdfArchiveFn`/
  `getPdfDownloadUrlFn` in gbp.functions.ts (archive requires write role).
- Client: every PDF download auto-archives (pdf.ts `downloadPdf`/
  `downloadPowerBillPdf`, pdf-rent.ts `downloadRentInvoicePdf`); new base64
  builders (`powerBillPdfBase64`, `rentInvoicePdfBase64`, `pdfBase64`).
- UI: `PdfArchiveSection` (Billing + Ledger pages) lists stored PDFs grouped
  by month with signed-URL downloads; refreshes via `pdf-archive-updated`
  window event fired by `archivePdfQuiet` in pdf-archive-client.ts.
- Old bills: user believed data was lost — it was in `PowerLedger` (they were
  checking the dead `ElectricityBills` tab); old bills can be re-stored by
  simply downloading them (auto-archive kicks in).

### 2026-09-07 — Fixed "data not appearing in the Google Sheet"
- Symptoms: UI saved fine (data appeared in-app) but rows were missing/old in
  the sheet; Ledger and generated electricity bills not visible; sync chip said
  "Sheet synced" while showing stale data.
- Root causes fixed:
  1. Cache-poisoning race in `sheets.server.ts`: a read in flight during a
     write finished AFTER the write and re-cached the pre-write workbook (and
     re-saved it to the Supabase snapshot). Fixed with a per-spreadsheet
     write-generation counter — reads that raced a write are never cached.
  2. After-write UI refresh used `invalidateQueries`, which could be served
     from the 2-min server cache / snapshot instead of the sheet. Added
     `getFreshWorkbook` server fn (bypasses memory cache + snapshot via
     `readWorkbook(fresh)`) and `fetchFreshWorkbook()` in `use-app-data.ts`;
     every `useSheetMutation` success now pulls the live sheet.
  3. Manual sync button (`SyncStatus`, ledger page) and `useWorkbookState`'s
     `refetch()` now use the same fresh read.
  4. Removed the legacy empty `ElectricityBills` tab from `TABS`/`HEADERS`/
     `Workbook` (all electricity data lives in `PowerLedger`); the dead tab
     confused "where is my data" — `ensureWorkbook` + `formatWorkbook` now
     delete it (only if it has no data rows).
- Gotcha: sheet stays source of truth; snapshot/cache are read accelerators
  only. If users report stale data again, check `writeGeneration` logic first.
- Typecheck/build verified locally with npm deps in tmp dir (repo uses bun
  lockfile; termux storage blocked `npm install` in-tree).

### 2026-09-05 — Speed + installable PWA
- `router.tsx`: `defaultPreload: "intent"` + `defaultPreloadStaleTime: 30s` —
  route chunks/loaders prefetch on hover/touch.
- `_authenticated/route.tsx`: guard now uses `getSession()` (local, no network)
  instead of `getUser()` (server round-trip) — snappier entry into the app.
- Added `public/sw.js` (registered in `__root.tsx` in PROD only): cache-first
  for `/assets/*` (immutable hashed), network-first for navigations with
  offline fallback; `/_serverFn/` and `/api/` are never cached.
  Bump `VERSION` in sw.js only if the SW logic itself changes.
- `manifest.webmanifest`: added `id`, `lang`, `categories`, app shortcuts.
  Install via Chrome "Add to home screen" on Android.
- Bundle was already well-split (jspdf/recharts lazy) — no changes needed.

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

### 2026-09-08 — Migrated to Cloudflare Workers, retired Render, short URL
- Render free sleeps after 15 min + cron unreliable → retired `render.yaml` + `apphosting.yaml`; `vite.config.ts` nitro preset `node-server` → `cloudflare-module` (explicit output `.output/server` + `.output/public`; Lovable sandbox still forces `dist/server`+`dist/client` — both supported).
- `scripts/deploy-cloudflare.mjs`: auto-detects `.output/` vs `dist/` build dirs, defaults `WORKER_NAME=gbpims` → `https://gbpims.<subdomain>.workers.dev` (short; `WORKER_NAME=gbp` → `https://gbp.<subdomain>.workers.dev` for 3-char tiny URL), optional `CLOUDFLARE_CUSTOM_DOMAIN` binding for custom tiny domain.
- `.github/workflows/deploy.yml` renamed to "Deploy to Cloudflare Workers (always-on, no sleep)": build step verifies Supabase URL + wrangler.json, then deploys via `node scripts/deploy-cloudflare.mjs` using `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` secrets (optional `WORKER_NAME`, `CLOUDFLARE_CUSTOM_DOMAIN`).
- `HOSTING.md` now documents Cloudflare as primary (short URL guidance + manual deploy).
- `vite.config.ts:14` + deploy script + workflow are the three places that must agree on preset/output.
- Gotcha: set `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit) + `CLOUDFLARE_ACCOUNT_ID` in GitHub Secrets or Cloudflare deploy does nothing; after first deploy verify `https://<WORKER_NAME>.<subdomain>.workers.dev` loads (old `gbpims.onrender.com` will 404).
