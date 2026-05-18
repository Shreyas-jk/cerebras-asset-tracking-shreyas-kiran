# Asset tracking

Submitted as a take-home for Cerebras's AI Builder Challenge.

Four mobile-first scan workflows for the technician at the receiving dock, plus a desktop dashboard where a manager can spot drift across operations, facilities, and finance in under a minute.

## Demo

- **Frontend (Vercel)**: https://cerebras-asset-tracking-shreyas-kir.vercel.app/
- **API (Railway)**: https://asset-trackingstarter-production.up.railway.app

---

## Three calls I nearly made the other way

### 1. Hide the on-file serial during duplicate-receive confirmation

The first version of `/tech/receive` showed the on-file serial in a helper line below the input ("On file: SN-INST-A001..."). It made it so much easier for the tech, but I reversed this decision because it broke the actual verification.

The point of the confirm-serial step is to catch the wrong-labeling case where the item under a tag isn't what the system thinks. With the serial shown on screen, verification was being reduced to just reading what was on the screen and typing it back and not actually verifying it matches. So the confirm step now shows only model, manufacturer, current state, and custodian. The on-file serial is revealed only when a mismatch fires, where surfacing it is necessary for diagnosis.

The cost is a few extra seconds of friction for a tech with a clean rescan. The benefit is that a mistagged unit can't slip silently into the system, which is the kind of problem a manager will have to untangle later.

### 2. 200 with a discriminator field for partial-success, not 207 Multi-Status

The store and deploy server routes (`starter/app/api/scans/{store,deploy}/route.ts`) fan out to facilities and finance write-backs after the upstream scan succeeds. Either of those writes can fail without the operations side being wrong. The asset is correctly stored or deployed, facilities or finance just didn't get the update. That's a partial-success state, and I had to pick how to signal it.

The HTTP-spec-correct answer is 207 Multi-Status. I went with HTTP 200 and a discriminator field on the body instead (`facilities: "cleared" | "failed"`, `finance: "capitalized" | "failed"`). My reasoning is that 207 isn't handled consistently across the ecosystem. `fetch`, typed clients, middleware, and error boundaries often treat any non-2xx code as a failure to throw on, which means a partial-success response can get caught and rejected before the client ever sees the body. A 200 with a clear field on the body can't get misinterpreted that way. The client always gets a successful response and branches on the field.

The cost is that I'm not following the HTTP spec strictly. The benefit is that the response works reliably with whatever client code I plug in later, which matters more for a small system than spec purity.

### 3. "First deployment" framing from `from_state`, not the event log

When a tech opens `/tech/deploy` for an asset, the page shows a green "First deployment" banner if the asset is going from `received` to `in_service` for the first time, and a calmer blue "From storage to service" if it's coming from storage. The strictly-correct way to decide which banner to show is to look at the event log and check whether the asset has ever had a `deploy` event before. That requires fetching `/v1/assets/:tag/events` on every deploy, which is an extra round-trip on a hot scan path.

I went with the cheap signal instead: `from_state === "received"`. It's right about 95% of the time, because received-then-deployed is the canonical first deployment. The false-negative case is when an asset gets received, then stored, then later deployed from storage — my heuristic will show the duller blue framing in that case instead of the green one, but there's no actual data error. The event log is still authoritative for anyone who needs the underlying truth.

The cost is that the banner is wrong some of the time. The benefit is that the deploy scan doesn't pick up several hundred milliseconds of extra latency for a UX accent color. If I started seeing real reports of the heuristic getting it wrong, I'd revisit. For now the trade is fine.

Long-form for these and around 20 other decisions: see `decisions.md`.

---

## Things I'd push back on

The brief invites pushback. Three concrete items here, eight more in `errors-catalog.md`.

### `and_match_failed` reads like a typo

The receive endpoint returns `409 and_match_failed` when a duplicate tag arrives with a mismatched serial. The string `and_match_failed` doesn't actually describe anything the API talks about. It reads like the start of a sentence that got cut off — almost certainly meant to be `serial_match_failed` or something similar. What makes me confident it's a typo and not intentional is that the same string appears in `api/src/routes/scans.ts:51`, `starter/docs/api-reference.md`, and `starter/docs/tips.md`, so three different places have it identically. That suggests a copy-paste of an early typo, not a deliberate name.

### Three different error codes for the same kind of failure

Three different error codes (`invalid_query` on the list endpoint, `invalid_location` on every scan endpoint, and `invalid_payload` on the mock endpoints) all mean the same thing: the request body or query didn't pass zod validation. The naming actively misleads. The receive endpoint returns `invalid_location` when the `serial` field is missing, even though serial has nothing to do with location. The transfer endpoint returns `invalid_location` even though transfer doesn't take a location at all. If I'm writing client code that branches on the error code, I can't trust `invalid_location` to mean what it says.

A cleaner approach would be one canonical `invalid_request_body` for any zod failure, plus specific codes for specific fail-fast checks. The existing `invalid_tag_format` and `incomplete_deploy_location` are good models — they're specific and they describe what's actually wrong.

### `transfer_custody` events don't record `to_custodian`

This one came up while I was building the asset-detail event log. The `Event` type has a `user_id` field for who scanned, but there's no field for the destination custodian on a transfer. The `user_id` on a transfer event is the FROM party (the logged-in tech). The new custodian gets written to the asset record, but it isn't recorded in the event log at all.

I worked around this by parsing `scan_payload.raw` on the detail page, because my own client writes scan_payload as JSON `{raw, ts, screen}` where `raw` is the scanned badge. That works for events my code generated, but it depends on every other client agreeing on the same payload shape, which isn't a guarantee. A `to_custodian: string | null` field on the Event union would make this trivial and would mean a manager auditing a transfer history six months from now wouldn't need to know each client's payload conventions.

The asset-detail page falls back to "destination not recorded in the event log" when the reconstruction fails, so the data gap is surfaced honestly rather than hidden.

---

## Things I deliberately didn't build

The brief explicitly calls subtraction a skill. The things I chose not to build, and why:

- **Camera scanner.** The keyboard-scanner path (a text input that a USB or Bluetooth scanner types into) works for all four scan flows already. Camera scanning with `html5-qrcode` or `@zxing/browser` was the obvious next step, but I traded it for reconciliation depth and the manager-side information design instead. The brief weighted those judgment criteria more heavily, and I had to pick.
- **RMA workflow UI.** The state machine supports `rma_open` and `rma_receive_back`, but the brief explicitly excludes the UI for it.
- **Manual edit-in-place on the manager detail page.** Every state change in this system is supposed to come from a scan — that's the whole audit story. Adding a "fix it from the dashboard" button would undermine that.
- **Tests beyond the existing `ScanInput.test.tsx`.** I prioritized communication and reconciliation polish over integration tests this round. Tests come back in any longer-lived codebase.
- **Bulk import/export, CSV, undo, offline queueing, parent-child assets.** All out of scope per the brief.
- **Real escalation flow when scan errors need a manager.** The receive-mismatch and deploy-RMA panels show a "Talk to a manager" affordance that expands a copy-able message block with the relevant IDs. There's no flag API in v1, so a button that promises to escalate would be lying. An honest dead-end with a copy-able message reads better. The disposed-transfer case has no escalation block at all, because that state is genuinely terminal.

And things I almost added during the build but didn't — search on the manager list, role gating on the routes, a print-from-anywhere barcode button. Each one felt like a feature looking for a workflow gap. The brief specifically calls subtraction a skill, so those stayed cut.

---

## Run instructions

### Local

Prereqs: **Node 20.x** and **pnpm 9.x**. Both are pinned in `package.json`, and corepack will fetch pnpm 9.15.9 automatically on first invocation.

```bash
pnpm install
pnpm dev
```

The API runs at `http://localhost:8080`, the Next.js starter at `http://localhost:3000`. Open `http://localhost:3000`.

`starter/.env` (copy from `starter/.env.example`):

```
API_BASE_URL=http://localhost:8080/v1
API_TOKEN=local-dev-token-1234567890
```

The API doesn't have an auth check anywhere in `api/src/`, so any non-empty token works. The starter's proxy at `app/api/upstream/[...path]/route.ts` attaches the token server-side so it never reaches the browser.

Reset the local seed (clears all writes, reseeds 1012 assets):

```bash
curl -X POST http://localhost:3000/api/upstream/reset
```

A 10-step smoke test lives in `starter/docs/happy-path.md`.

### Deployed

| | URL |
|---|---|
| Frontend (Vercel) | https://cerebras-asset-tracking-shreyas-kir.vercel.app/ |
| API (Railway) | https://asset-trackingstarter-production.up.railway.app |

**Vercel env vars** (Project Settings → Environment Variables):

```
API_BASE_URL=https://asset-trackingstarter-production.up.railway.app/v1
API_TOKEN=<any non-empty string>
```

The trailing `/v1` is required, because Fastify mounts the API routes there and the API client builds paths relative to `API_BASE_URL`.

Reset the deployed seed:

```bash
curl -X POST https://asset-trackingstarter-production.up.railway.app/v1/reset
```

### Test barcodes

A printable Code 128 sheet for the eight interesting seed cases (drifted, ghost, disposed, RMA, plus clean ones) and six location formats lives at `/dev/barcodes`. It's a reviewer aid, not something a tech at the dock would see.

---

## Caveats worth flagging

- **Seed timestamps inflate the manager triage strip.** Every procedurally-seeded asset (about a thousand rows) has `updated_at = 2026-01-02T09:00:00Z`. The current date is in May 2026, which means the "In RMA over 14 days" metric reports 51 (every single RMA asset) and "Received over 7 days" reports 81 (every received asset). The metric logic is correct, the seed is just synthetic. With real scan activity over time, these numbers would be selective and meaningful.
- **Railway free tier sleeps the API.** The first request after some inactivity takes 5 to 10 seconds because the container is cold-starting. Subsequent requests are fast. The Vercel frontend works normally; only API-bound pages and scan actions show the cold-start delay.
- **Railway free-tier filesystem is ephemeral.** The SQLite database lives at `api/data/asset-tracking.db`, and Railway wipes that file on every redeploy. Within a session your scans persist; across a redeploy they reset to the seed.
- **The deployed API has no auth.** The brief explicitly says "no auth — wide open." The bearer-token plumbing through Vercel is architecturally correct (the token never reaches the browser), but at this stage it's functionally theater. Anyone who knows the Railway URL can scan or reset the database.

---

## Architecture

The repo is a monorepo with two apps. The `api/` directory is a Fastify server with better-sqlite3 storage, deployed to Railway. The `starter/` directory is the Next.js 15 App Router app deployed to Vercel. The tech scan pages are client components (state machines wrapped around scan inputs), and the manager pages and the reconcile route are server components.

When the browser hits the API, it goes through a same-origin proxy at `starter/app/api/upstream/[...path]/route.ts`. The proxy attaches `API_TOKEN` on the server side and forwards the request to the Railway API, so the token never reaches the browser.

Two scan flows have their own server-side routes in the Next.js app, because they need to coordinate the upstream scan with write-backs to the facilities and finance mocks:

- `starter/app/api/scans/store/route.ts` does the store scan, and if the asset was `in_service` before, it also writes to facilities to remove the rack row.
- `starter/app/api/scans/deploy/route.ts` does the deploy scan, then fires write-backs to facilities (with the new rack location) and finance (status `capitalized` plus today's date) in parallel.

Both routes return HTTP 200 with `facilities` and `finance` discriminator fields on the response body. Partial-success is modeled explicitly so the UI can name what failed and link to the reconcile report.

`/tech/receive` and `/tech/transfer` don't need a server-side route, because neither one has multi-call coordination to do. They call the upstream directly through the proxy.

The three-way reconciliation lives at `starter/app/api/reconcile/route.ts`. It fetches operations, facilities, and finance in parallel, joins them on the asset tag, and classifies each tag into one of six emitted categories: `real_drift`, `state_scope_drift`, `ghost_in_facilities`, `ghost_in_finance`, `stale_observation`, or `ambiguous`. There's a seventh `expected_mismatch` catch-all that gets counted but not emitted as a finding. Each asset goes into at most one category, picked by precedence. The `/manager/reconcile` page fetches that JSON and renders it.

The long-form design decisions are in `decisions.md`. The error catalog and naming concerns are in `errors-catalog.md`. Sunday's build notes are in `sunday-notes.md`.

---

## Submission

Form: https://forms.gle/6gxhe8Js98KGqSDx8 — Vercel URL, this GitHub repo link, and a 3–5 minute Loom.

MIT licensed. See `LICENSE`.
