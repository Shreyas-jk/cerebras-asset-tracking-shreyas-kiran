# Sunday notes

Brain dump for Sunday's session. Bullets, not prose.

## Seed-data shape (so I'm not re-counting Sunday morning)

- 1000 procedural assets (`api/src/seed/procedural.ts`) + 12 hand-crafted (`seed/assets.ts`) = **~1012 total**.
- Distribution (procedural is 70/12/8/5/5; hand-crafted adds 6 in_service, 3 stored, 1 received, 1 rma, 1 disposed):
  - **in_service** ≈ 706
  - **stored** ≈ 123
  - **received** ≈ 81
  - **rma_pending** ≈ 51
  - **disposed** ≈ 51
- 12 hand-crafted carry **all the planted drift**; the 1000 procedural rows agree across all three systems by design.

## Manager triage strip candidates

What the 8:55am manager wants to know in under 60 seconds: "is anything on fire?" — not a census. So lead with *actionable abnormalities*, not status counts.

Lean toward 4 metrics:
- **Reconcile drift count** — total flagged rows from `/api/reconcile`, broken out by category. Click-through to the report. This is the load-bearing number.
- **In RMA over N days** — derived: assets where state = `rma_pending` and the last `rma_open` event is older than 14 days. The seed has C0000108 with `last_observed: 2026-04-21` which puts it ~25 days stale; a few procedural rma_pending rows may also qualify.
- **Received but not yet acted on** — assets in state `received` with no subsequent event newer than 48h (or 7d). The seed has C0000107 sitting in received — that's a backlog signal.
- **Disposed this month** — audit-relevant count. Cheap to compute (filter assets by state = disposed and `updated_at > start_of_month`).

Strong candidate to *not* show: total in_service count. It's the boring number. The "70% in service" census doesn't help the manager decide anything.

Other candidates considered, dropped:
- Recently received (24h count) — duplicate of the backlog signal.
- Total custodians active — too soft, no action attached.
- Storage utilization — would need facilities data joined to a capacity number we don't have.

## Reconciliation taxonomy (6 categories)

From the Thursday-night plan, lightly refined:

1. **Real drift** — same row in all three systems, but a field disagrees (e.g. ops says rack U18, facilities says U16). C0000110 is the marquee.
2. **Expected scope mismatch** — ops state says `stored` / `rma_pending` / `disposed`, so facilities correctly has no row. Hide-by-default; show a count ("4,213 expected mismatches suppressed").
3. **Stale observation** — facilities row exists and agrees with ops, but `last_observed` is older than threshold (90d? 60d? pick one). C0000111 (2025-11-02) is the demo case.
4. **State/scope drift** — ops says RMA or disposed but facilities and/or finance still has an active row. C0000108 (RMA in facilities), C0000109 (disposed in finance + facilities).
5. **Ghost in facilities or finance** — appears in one of the downstream systems but has no ops record. C0000199 (facilities ghost), C0000113 (finance pending_receipt orphan).
6. **Ambiguous / needs human** — disposed in ops, capitalized in finance: could be a finance-lag, could be a real audit issue. C0000109 fits here AND in category 4 — pick the more actionable bucket.

Ranking by what to surface first: 1 (real drift) > 4 (state/scope) > 5 (ghosts) > 6 (ambiguous) > 3 (stale) > 2 (suppressed by default).

## "Three calls I nearly made the other way" — candidates

Pulled from `decisions.md`; pick three for the README. The most interesting (in priority order):

- **Hide on-file serial in duplicate confirmation** — reversed from initial implementation. Showing the expected serial turned verification into rubber-stamping. The mismatch panel surfaces the on-file value, but only when there's something to diagnose. Strongest "judgment over convenience" candidate.
- **200 + body field for partial write-back failures, not 207** — spec-correct vs. consumer-fragile. Picked the pragmatic shape.
- **First-deployment framing detected by `from_state === "received"`, not event-log inspection** — 95% right at zero cost vs. 100% right at a round-trip. The kind of accept-good-enough call that costs nothing operationally.
- **No server route for /tech/transfer (asymmetry is fine)** — server routes exist where coordination matters; transfer doesn't need it. Asymmetry across the four screens *reflects* what each does.
- **Disposed transfer: no escalation block** — honest dead ends beat fake affordances. Escalation lives where a manager could plausibly act.

Of the five, I'll pick the three that contrast the most: probably (1), (2), and (3) — each has a different shape of trade-off (UX vs. ergonomics, spec vs. compatibility, latency vs. correctness).

## Sunday build order

Confirming the proposal — that's the right sequence:

1. **`/api/reconcile/route.ts`** — server-side join (assets + facilities + finance) and category-tagging. Testable with curl alone, no UI needed. Fast feedback loop.
2. **`/manager/reconcile`** — render the categorized report. Information design showpiece; most "judgment" surface area on the manager side.
3. **`/manager`** list — pagination, filtering, **plus the triage strip that pulls the reconcile drift count**. Doing this after reconcile means the triage strip has real data to point at.
4. **`/manager/assets/[tag]`** — detail + event log. Smallest piece; mostly fetch-and-render. Slot last among the build items because it benefits from real seeded data (which includes my Sunday demo scans).
5. **README** — "Three calls", pushback section, run instructions, env vars, deployment notes. Pull from `decisions.md` and `errors-catalog.md`.
6. **Loom** — record after a fresh `POST /v1/reset`. 3–5 min covering: scan UX (one path end-to-end), one piece of microcopy (probably the duplicate-confirm or the serial-mismatch panel), and one "almost did it the other way" call.

Sub-items to remember on Sunday:

- **Reset before recording Loom.** Otherwise the demo runs against state I poked at while building.
- **Hit the happy-path checklist** (`starter/docs/happy-path.md`) before submitting. Not the test they run, but if it fails something deeper is broken.
- **Wire `/api/reconcile`'s drift count into the triage strip** as the final cross-screen integration. Server route returns counts per category; the manager landing fetches the same endpoint and shows the totals.
- **README pushback list pulls from `errors-catalog.md`'s naming-concerns section** — eight items already drafted there. Edit to the strongest three or four for the README; keep the full list in `errors-catalog.md`.
- **Don't push to upstream Cerebras repo.** Origin is correctly pointed at `Shreyas-jk/cerebras-asset-tracking-shreyas-kiran` since Thursday's session.
- **Submission form:** https://forms.gle/6gxhe8Js98KGqSDx8 (from CHALLENGE.md). Needs deployed URL + GitHub link + Loom.
- **Update README run instructions** to cover both local dev (`pnpm dev`) and the deployed URLs once they're live (API at the Railway/etc. URL, starter at the Vercel URL). Mention the env-var wiring on Vercel so a fork-and-deploy reviewer can replicate.

## Deployment plan (Daniel's clarification — candidates deploy their own API)

The brief implied a hosted API; per Daniel's email, the candidate deploys both halves. Plan:

- **API → Railway** (free tier sufficient). Render or Fly.io as fallback if Railway gives trouble — same Node + SQLite shape works on any of the three.
  - Deploy from this GitHub repo, build context = `api/`. Railway's monorepo support handles this with a Root Directory setting.
  - Build command: `pnpm install && pnpm --filter @asset-tracking/api build`
  - Start command: `node api/dist/index.js` (or set Root Dir to `api` and use `node dist/index.js`).
  - `PORT` is read from env (defaults to 8080); Railway sets `PORT` automatically. `HOST` already defaults to `0.0.0.0`.
  - **Heads-up:** `better-sqlite3` needs native compile. Worked locally only after switching to system Python 3.9. Railway/Render use Linux + Python 3 in their build images — *should* be fine, but flag if the build fails.
  - **Heads-up:** SQLite file lives at `api/data/asset-tracking.db`. On Railway's free tier the filesystem is ephemeral — every redeploy reseeds from scratch via the seed code on first boot. Acceptable for a demo; if the grader pokes around and the dyno cycles, they'll see the original seed again. Not a blocker; mention in the README so it's not surprising.
- **Starter → Vercel** via the one-click button (URL needs to be updated in `starter/README.md` to point at my fork — currently has `REPLACE_WITH_YOUR_REPO`).
  - Set env vars in Vercel: `API_BASE_URL = <railway-url>/v1` and `API_TOKEN = <any-non-empty-string>` (the API doesn't validate the token, but the proxy refuses to start without one).
  - The token never reaches the browser — the proxy at `app/api/upstream/[...path]` attaches it server-side. So I can use any value.

**Order (don't reverse):**

1. Deploy API to Railway. Wait for build to complete.
2. Verify with curl against the deployed URL:
   - `curl https://<railway>.up.railway.app/health` → `{"ok":true,"version":"1.0.0"}`
   - `curl https://<railway>.up.railway.app/v1/assets?state=stored | head -c 200` → see real seed data.
3. Deploy starter to Vercel with the env vars set. Wait for build.
4. Open the Vercel URL in a browser. Run through:
   - `/tech/receive` with a fresh tag → success.
   - `/manager` → seeded asset list renders.
   - `/manager/reconcile` → categorized report renders against the deployed API.
5. Run the happy-path checklist (`starter/docs/happy-path.md`) against the deployed URL end-to-end before filling out the submission form.

**Submission only after the deployed Vercel URL passes all ten happy-path steps.** That URL is what the grader hits.

## Things explicitly NOT planned for Sunday

Subtraction is part of the deliverable. Locking these in advance so I don't drift:

- Camera scanner (`html5-qrcode`). Brief says the camera path matters; the keyboard-scanner path works today and the four flows are complete. Sunday energy is for reconcile, not for fighting browser permissions on mobile Safari.
- A11y audit. `aria-label` + reasonable contrast is the bar; not chasing it further.
- Authentication. Out of scope per brief.
- The RMA UI workflow. State machine supports it; UI is not required and there's no demo benefit.
- Bulk import/export, offline queueing, parent-child asset relationships.
- Tests beyond the existing `ScanInput.test.tsx`. Adding meaningful integration tests on Sunday afternoon trades off against the README and Loom, both of which count as much as code per the brief.
