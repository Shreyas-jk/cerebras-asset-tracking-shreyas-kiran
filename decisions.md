# Design decisions

A running log. Each entry is one design call: what I did, why, and the alternative I almost picked. Pruned on Sunday into the README's "Three calls I nearly made the other way" section.

## /tech/receive

- Decision: Two-step flow with a pre-check `api.assets.get(tag)` before any data entry.
  Reasoning: Lets us branch the UI cleanly — new tag → creation form; existing tag → confirm-serial flow with the model/manufacturer/current-state visible. The cost is one extra round-trip (100–300ms); the gain is that when a duplicate serial mismatches we can show "on file: SN-INST-A001" *before* the tech has typed anything they'd have to re-enter.
  Alternative: Skip the pre-check, submit the receive blind, and react to 201 / 200 / 409. Fewer round-trips but the duplicate case is much worse — the tech has typed serial/model/manufacturer for nothing.

- Decision: Show "Looking up <tag>…" thin status line during the pre-check.
  Reasoning: A glove-on tech who sees zero UI feedback for 300ms will scan a second time. Visible status prevents the duplicate call. The input stays focused — they could still rescan, they just won't unless they want to.
  Alternative: Silent loading state, or a global spinner. Both have the same "did anything happen?" problem on a dock-bay screen.

- Decision: Default location is rendered as visible text "Location: Lab-Building-A / Receiving / DOCK-1 [edit]", not hidden behind an expand panel.
  Reasoning: The tech needs to know what they're committing to. If the default is wrong (they're at DOCK-2), they need to spot it before submitting, not after. Showing it as plain text + an [edit] affordance is honest.
  Alternative: Defaulted invisibly and only revealed in the success banner. Faster scan but a tech at a different dock would silently mis-attribute.

- Decision: scan_payload is `JSON.stringify({ raw, ts, screen })`.
  Reasoning: The audit value of `scan_payload` is highest when it carries WHAT was scanned, WHEN, and FROM WHERE in the app. `raw` is the literal scanned string (so we can detect scanner-character-drop bugs later), `ts` is the client-side ISO timestamp (which can be compared against the server-side event timestamp to detect clock skew), `screen` distinguishes "this came from the receive flow" from "store" — useful when reading the event log six months later.
  Alternative: Plain raw string. Simpler, but loses the audit-trail value. The schema permits anything; the upgrade is free.

- Decision: No auto-advance after success. Tech presses Enter (or clicks "Scan next") to return to TAG_SCAN.
  Reasoning: The success banner is the audit confirmation a tech wants to read. Auto-resetting after 3s steals it. A glove-on tech who's slow to read should not have the UI race them.
  Alternative: Auto-advance after 3s or 5s. Faster throughput in theory; worse for the read-the-confirmation case which is the whole point of the banner.

- Decision: The duplicate-receive success state and the new-receive success state get distinct microcopy.
  Reasoning: "Received." on a duplicate would be wrong — ops state didn't change. Honest copy is "Already on file. Logged a duplicate-receive event." This matters because the next reader of the event log will see the duplicate_receive event and the matching UI affordance.
  Alternative: One "Success!" banner for both. Easier to write; semantically wrong.

- Decision: Serial mismatch shows three recovery actions: re-scan serial, re-scan tag, "Talk to a manager." The third is honest about platform limits (no flag-for-investigation API exists in v1).
  Reasoning: A mistagged unit is a real possibility at the dock. Pretending we can solve it with a button is dishonest. The "Talk to a manager" path expands to a copy-able message block with all the relevant IDs.
  Alternative: Only two paths (re-scan serial, re-scan tag) and hope the tech figures out the mistagged-unit case on their own. Worse — that's the case where bad data enters the system most easily.

- Decision: Tag-format validation runs client-side first (regex `/^C\d{7}$/`) before any API call.
  Reasoning: Saves a round-trip on the most common mis-scan (scanner dropped a digit). Same regex as the API uses.
  Alternative: Let the API return `invalid_tag_format` and surface it. Costs a round-trip on a check we can do in zero time.

## /tech/receive — confirm-duplicate UX

- Decision: Hide on-file serial during duplicate confirmation. The confirm step shows only tag, model, manufacturer, current state, and custodian. The on-file serial is revealed only when a mismatch fires (where surfacing it is necessary for diagnosis).
  Reasoning: Showing the answer up front primes the tech to type it instead of trusting the scanner read. Verification should be a check, not a confirmation. The whole purpose of confirm-serial is to catch the case where the wrong unit is at the wrong tag — showing the expected value defeats that purpose.
  Alternative: Show on-file serial in the confirm step (friction-reducing — the tech reads both values side by side and clicks ahead). Rejected because it transforms verification into rubber-stamping. Reversed my initial implementation, which had shown the serial in a helper line below the input.

## /tech/receive — prefill from store

- Decision: Receive page reads `?prefill=<tag>` from the URL on mount, populates the tag input, and leaves it focused — but does NOT auto-submit. Tech presses Enter (or rescans) to commit.
  Reasoning: The prefill arrives when a tech tries to store an unreceived asset and clicks "Go to Receive." Auto-submitting would skip the human read-back step that prevents a "wait, this is the wrong tag" mistake. The tag in the URL came from a scanner one click earlier; it's high-confidence but not unattended-confident.
  Alternative: Auto-submit on mount. Faster path; one fewer keypress. Rejected for the audit reason above. Also rejected: ignoring the prefill entirely and asking the tech to rescan from scratch — that's hostile when we already know the tag.

## /tech/store — partial-success status code

- Decision: The server route returns HTTP 200 with a `facilities` discriminator field (`"skipped" | "cleared" | "failed"`) rather than HTTP 207 Multi-Status when the upstream scan succeeds but the facilities write-back fails.
  Reasoning: 207 is correct per the HTTP spec for a multi-resource update with partial outcomes, but it's inconsistently handled by fetch, by typed clients, by middleware, and by error boundaries that treat any non-2xx as "throw." A 200 with an unambiguous discriminator field is impossible to misuse — the client always sees a successful response and branches on a field rather than a status code. The semantic precision of 207 isn't worth the operational fragility.
  Alternative: 207 Multi-Status. Spec-correct, but invites edge cases at every consumer.

## /tech/store — write-back lives in a server route, not in the page

- Decision: De-rack write-back to `/v1/mock/facilities/spaces` lives in `app/api/scans/store/route.ts`, not in the browser. The page POSTs to `/api/scans/store`, which fans out to the upstream scan + the conditional facilities write.
  Reasoning: Two reasons. (1) Same security argument as the reconcile route — the bearer token stays server-side. (2) Atomicity-of-presentation — the tech needs ONE answer about what happened, not two separate fetches the browser has to assemble. The server can sequence the calls and report a coherent result (`{ asset, facilities: "cleared" | "failed" | "skipped" }`) with the partial-failure case modeled explicitly.
  Alternative: Fire both calls from the browser using the api client (works fine because the proxy attaches the token). Rejected because the partial-success state would be the browser's job to coordinate, and a tech who got a green check on the scan and then a red toast on the write-back has no way to know whether ops or facilities is correct.

## /tech/store — pre-fetch to know `from_state`

- Decision: The server route does `api.assets.get(tag)` before submitting the scan, purely to learn `from_state`. The write-back is only fired when `from_state === "in_service"`.
  Reasoning: The scan endpoint returns the updated asset (with `state: "stored"`) but no `from_state`. To decide whether facilities needs a row removed, the server needs to know the prior state. Pre-fetch is one extra round-trip and produces a deterministic decision. A race is possible (state could change between the pre-fetch and the scan) — if so, the scan will fail with `invalid_transition` and we surface that error directly. The rarer race (`received → stored → in_service` between the two calls) would skip a write-back that should fire; the reconciliation report will flag it. Acceptable.
  Alternative: Post-fetch the event log to learn the previous state. Same round-trip count, harder to read. Or pass `from_state` from the client (which already pre-fetched to render the right framing). Rejected — the client can lie; the server should not trust it.

## /tech/store — explicit "in service → storage" copy

- Decision: When the from-state is `in_service`, the location-scan step renders an amber banner with the literal wording: "<tag> is currently in service at <location>. Scanning a storage location will move it to storage." Drop "de-rack" from user-facing copy entirely; it's jargon.
  Reasoning: A tech taking an instrument out of service deserves to see what they're about to do in physical terms ("move it to storage") rather than technical terms ("de-rack"). The amber colour ("attention, not error") differentiates this from a normal store-from-received which gets a calm blue banner. The whole point is that an inadvertent take-out-of-service is much worse than an inadvertent put-on-shelf, and the UI should reflect that asymmetry.
  Alternative: Same neutral framing for both cases. Rejected — it would hide the importance of the in_service path. Also rejected: a confirmation modal ("Are you sure?"). Modals are friction without payoff; the amber strip + the literal description does the job without a second tap.

## /tech/deploy — write today's date as `capitalized_on`

- Decision: The finance write-back sends `capitalized_on` as today's YYYY-MM-DD on every deploy.
  Reasoning: The deploy IS the capitalization moment. The seed's `capitalized_on` value is a starting state, not truth — it's whatever the synthetic data generator wrote. Sending today's date demonstrates the write-back is real (a subsequent GET will see the new date) and gives the manager an audit-relevant signal: "this asset was capitalized when this scan happened." Without it, the finance side looks frozen-in-the-past and reconcile loses a lever.
  Alternative: Omit `capitalized_on` and let the mock's merge preserve the seed value. Less disruption to the demo data, but the write-back becomes invisible — the only thing changing on finance's side is `status`, which was already `capitalized` for most rows.

## /tech/deploy — no defensive pre-fetch in the server route

- Decision: The deploy route at `app/api/scans/deploy/route.ts` does NOT pre-fetch the asset. It validates the location body, submits the upstream scan, and fans out both write-backs unconditionally on success.
  Reasoning: Unlike store, deploy's write-backs don't depend on `from_state` — facilities and finance both fire on every successful deploy. The page already pre-fetches client-side to render the right framing (first-deployment vs from-storage). A server-side pre-fetch would only buy us slightly nicer error messages for `unknown_asset` and `invalid_transition`, both of which the upstream returns clearly anyway. Saves one round-trip per deploy.
  Alternative: Pre-fetch defensively (same shape as the store route) for symmetry. Considered and rejected — symmetry isn't a goal worth a round-trip, and the asymmetry actually reflects a real difference in what the two routes need to know.

## /tech/deploy — parallel write-backs with `Promise.allSettled`, two named amber strips

- Decision: Facilities and finance write-backs fire in parallel via `Promise.allSettled`. The success response carries two independent discriminator fields (`facilities`, `finance`). On the page, each failed write gets its own amber strip — facilities first, finance second. Same 200 + body-field pattern as store for the same reason (207 is fragile across consumers).
  Reasoning: The writes are independent — facilities cares about racks, finance cares about books. Parallel is faster (~2× throughput on this leg) and `allSettled` keeps one failure from cascading. Separately-named failure strips are honest about scope: a stale facilities row is something the rack-walking tech notices; a stale finance status is something Monday's books surface. The manager's recovery is different for each, so we should name them differently.
  Alternative: Sequential calls (run finance only if facilities succeeded). Wrong — they're independent so there's no reason to gate one on the other. Also rejected: a single "downstreams didn't sync" strip in the both-failed case. Compact but less actionable.

## /tech/deploy — "first deployment" detected by `from_state === "received"`, not event history (THREE-CALLS CANDIDATE)

- Decision: The green "First deployment" framing is shown when `from_state === "received"`. From `stored` gets the calmer blue "From storage to service" framing.
  Reasoning: A purer signal would be "this asset has never had a `deploy` event before" — but that requires pulling the event log on every deploy, which is an extra round-trip on the hot scan path. The simpler heuristic is right ~95% of the time (received → deployed is the canonical first deployment) and the false-negative case (received → stored → deployed) gets a duller framing but no actual data error. The audit/event log is authoritative either way; this is just UI accent colour.
  Alternative: Query `api.assets.history(tag)` to check for prior deploy events. Strictly correct, but a fourth round-trip on a hot path for a UX accent isn't worth the latency. Strongly considered as the "correct" answer; rejected on cost/value grounds.
  This is a three-calls-candidate for the README: the kind of decision where the cheaper signal is "good enough" and the alternative would have cost real latency for marginal UX gain.

## /tech/transfer — direct browser call, no server route

- Decision: The transfer page calls `api.scans.transfer` directly from the browser through the existing `/api/upstream/*` proxy. No dedicated `app/api/scans/transfer/route.ts`.
  Reasoning: Transfer has no write-backs. The two arguments for the server routes on store and deploy were (a) token security (the proxy already handles this) and (b) multi-call coordination (none here). Adding a route would be ceremony, not value. The asymmetry across the four scan screens reflects what each scan actually has to coordinate.
  Alternative: Add a server route for symmetry. Rejected — symmetry isn't a goal; honesty about what each operation does is.

## /tech/transfer — self-badge allowed (taking custody from a synthetic custodian)

- Decision: Scanning the logged-in user's own badge is allowed. The client-side check is `badge !== asset.custodian`, not `badge !== getCurrentUserId()`.
  Reasoning: Operationally, "I'm picking this up from the storage bin" is a real workflow. The asset is held by `container-storage-3`; tech-jane scans her own badge to take custody. The API correctly treats this as a valid transfer (handoff goes container-storage-3 → tech-jane). Blocking self-badge would break a legitimate pattern; the API's own `same_custodian` check catches the genuinely-redundant case (badge already equals the current custodian).
  Alternative: Block self-badge as a guardrail against "I scanned my own badge by accident." Rejected — the API's existing check handles the redundant case, and the storage-pickup case is real.

## /tech/transfer — no escalation block on disposed (THREE-CALLS CANDIDATE)

- Decision: The disposed blocked-state on transfer is a clean dead end. No copy-able "talk to a manager" block, unlike the receive-mismatch and deploy-RMA cases which do offer one.
  Reasoning: Escalation blocks exist where a manager could plausibly act — receive-mismatch (the unit may be mistagged, manager can investigate), deploy-RMA (the asset is mid-return, manager can adjust the workflow). A disposed asset's state is genuinely terminal: there's no plausible "manager fixes this" path that the platform supports. Offering an escalation affordance there would be cargo-culted UX consistency over honest dead-ending.
  Alternative: Add the same escalation block for parity. Rejected — fake affordances are worse than honest dead ends.
  Three-calls candidate: where to put escalation affordances is itself a design decision worth surfacing in the README.
