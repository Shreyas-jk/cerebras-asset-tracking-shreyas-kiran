# Error catalog

Every error the system can produce, organised by workflow. Sourced from `api/src/routes/*.ts`, `api/src/errors.ts`, and the public `starter/docs/api-reference.md`. Where the code disagrees with the docs, the discrepancy is flagged inline.

Conventions used below:
- **Code** is the literal string in `error.code`.
- **State** = what the user just did when this fires.
- **Recovery** = what the UI should offer them.
- **Microcopy** is a draft — short, no exclamation marks, no "Oops!". Refine per screen.

---

## Receive errors

### `invalid_tag_format` — 400
- **Endpoint:** `POST /v1/scans/receive`
- **Source:** `api/src/routes/scans.ts:33-39`
- **Trigger:** `asset_tag` does not match `/^C\d{7}$/`. Fires before the asset lookup, before serial comparison.
- **State:** Tech just scanned an asset tag.
- **Recovery:** Keep focus on the tag input. Show the malformed string back to them so they can see what scanned wrong (handheld scanners sometimes drop a character).
- **Microcopy:** `Tag should look like C0000101 — letter C, then seven digits. You scanned "<value>".`
- **Catch client-side too** so we don't waste a round-trip.

### `and_match_failed` — 409
- **Endpoint:** `POST /v1/scans/receive`
- **Source:** `api/src/routes/scans.ts:48-58`
- **Trigger:** Tag already exists with a *different* serial. Body `details` includes `expected_serial` (on file) and `provided_serial` (what they scanned).
- **State:** Tech is on the receive screen, has scanned a tag that's already in the system, and now scanned/typed a serial that doesn't match.
- **Recovery:** Three paths:
  1. Wrong serial — rescan serial (back one step).
  2. Wrong tag — rescan tag (back to start).
  3. Neither — physically mistagged unit; surface "talk to a manager" copy (no v1 API to escalate).
- **Microcopy:** `Tag C0000101 is on file with serial SN-INST-A001. You scanned SN-DEMO-9.`  Sub-line: `The unit, the tag, or the scan is wrong. Pick a path.`
- **Naming concern** — see bottom of file.

### `invalid_location` (receive) — 422
- **Endpoint:** `POST /v1/scans/receive`
- **Source:** `api/src/routes/scans.ts:26-28` — fires when the *whole receive body* fails the zod parse. The error name is misleading: any missing field (serial, model, asset_class, etc.) lands here, not just location issues.
- **State:** Tech submitted the new-asset form with something missing or malformed.
- **Recovery:** Inline field errors. Don't lose what they typed. Re-focus the first invalid field.
- **Microcopy:** Field-specific. `Pick an asset class.` / `Model is required.` etc. The generic API message is too vague to show as-is.
- **Naming concern** — should be `invalid_payload`, see bottom.

### Receive success modes (not errors, but easy to mis-handle)

| HTTP | When | Body | UX |
|---|---|---|---|
| `201 Created` | new tag, first time | new `Asset` | "Received." |
| `200 OK` | tag exists, serial matches (idempotent) | existing `Asset`, plus a `duplicate_receive` event written behind the scenes | "Already on file. Logged a duplicate-receive event." Do NOT say "Received." — nothing changed in ops state. |

---

## Store errors

### `invalid_location` (store) — 422
- **Endpoint:** `POST /v1/scans/store`
- **Source:** `api/src/routes/scans.ts:111-113` — same zod-parse-failed catch-all.
- **State:** Submitted store with missing fields.
- **Recovery:** Inline. Same approach as receive's `invalid_location`.
- **Microcopy:** Field-specific. The store endpoint requires `asset_tag`, `location.site`, `user_id`, `scan_payload`; other location fields can be null.

### `unknown_asset` (store) — 404
- **Endpoint:** `POST /v1/scans/store`
- **Source:** `api/src/routes/scans.ts:119`
- **Trigger:** Tag not in the database.
- **State:** Tech scanned an asset tag for storing but the asset was never received.
- **Recovery:** Offer a one-tap link to `/tech/receive?prefill=<tag>`. This is a near-certain mis-routed scan — they should receive it first.
- **Microcopy:** `C0009001 isn't in the system yet. Receive it first.` Button: `Go to Receive →`

### `invalid_transition` (store) — 422
- **Endpoint:** `POST /v1/scans/store`
- **Source:** `api/src/routes/scans.ts:123-129`
- **Trigger:** Asset state isn't `received` or `in_service`. Details: `from_state`, `attempted_event`.
- **State:** Tech tried to store an asset that's already stored, in RMA, or disposed.
- **Recovery:** Show current state and where the asset thinks it lives. Let the tech read that before deciding. No "force store" path — the API is the contract.
- **Microcopy:** `C0000104 is already stored at Lab-Building-A / Storage-1 / SHELF-3. No change made.` — and if state is RMA/disposed: `C0000108 is in RMA. Storing it would skip that step — talk to a manager.`

---

## Deploy errors

### `invalid_location` (deploy) — 422
- Same shape as receive/store. Zod parse failure on the whole body. `api/src/routes/scans.ts:158-160`.

### `incomplete_deploy_location` — 422
- **Endpoint:** `POST /v1/scans/deploy`
- **Source:** `api/src/routes/scans.ts:164-170`
- **Trigger:** Body passed zod (so `site` is set) but at least one of `room`, `rack`, `ru` is null. Details: the partial `location` object.
- **State:** Tech scanned a location barcode that doesn't include rack-unit (e.g., they scanned a storage-shelf barcode for a deploy).
- **Recovery:** Show *which* component is missing. "Deploy needs rack and RU. The location you scanned has room but no rack." Big "scan again" button — focus stays on the location input.
- **Microcopy:** `Deploy needs site, room, rack, and RU. The scanned location is missing: rack, ru.`

### `unknown_asset` (deploy) — 404
- Same as store. Recovery offers a Receive link.

### `invalid_transition` (deploy) — 422
- **Trigger:** Asset is in `rma_pending`, `disposed`, or already `in_service`. (Allowed only from `received` and `stored`.)
- **Microcopy:** Branch on state. `C0000101 is already in service at <location>.` vs `C0000108 is in RMA — it can't be deployed until it comes back.`

---

## Transfer errors

### `invalid_location` (transfer) — 422
- Zod parse failure. `api/src/routes/scans.ts:216-218`. The name is *especially* wrong here — transfer doesn't take a location at all.

### `unknown_asset` (transfer) — 404
- Same shape.

### `invalid_transition` (transfer) — 422
- **Source:** `api/src/routes/scans.ts:227-233`
- **Trigger:** Asset state is `disposed` or `unreceived`.
- **State:** Tech tried to hand off something that has no custodian to legally pass.
- **Recovery:** Show the state, no rescan path — manager intervention.
- **Microcopy:** `C0000109 is disposed. Custody can't be transferred.`

### `same_custodian` — 422
- **Source:** `api/src/routes/scans.ts:236-242`
- **Trigger:** `to_custodian === asset.custodian`.
- **State:** Tech scanned their own badge by accident, or the asset is already assigned to the person they intended to hand it to.
- **Recovery:** Re-scan the receiving badge. Don't punish — this is a common scan-self-badge mistake.
- **Microcopy:** `tech-jane already holds this. Scan the receiving tech's badge.`
- **Can catch client-side** — we know who's logged in and we know the current custodian after the asset lookup. Don't waste the round-trip.

---

## Read-side errors (list, detail, history)

### `invalid_query` — 400 (UNDOCUMENTED)
- **Endpoint:** `GET /v1/assets`
- **Source:** `api/src/routes/assets.ts:14-19`
- **Trigger:** Query string fails zod validation. Hard to hit through the typed client — only if you hand-craft a URL.
- **Discrepancy:** Not in `api-reference.md`'s error table.
- **Microcopy:** Unlikely to surface; if it does, the manager's filter UI did something wrong. Render as a generic server error.

### `unknown_asset` — 404
- **Endpoint:** `GET /v1/assets/:tag`, `GET /v1/assets/:tag/events`, plus the three scan endpoints.
- **Trigger:** Tag not in the database.
- **Manager UI:** "No asset with tag C9999999." Plus a link back to the list.
- **Tech UI:** see above per workflow.

---

## Facilities / Finance mock writes

### `invalid_payload` — 422
- **Endpoints:** `POST /v1/mock/facilities/spaces`, `POST /v1/mock/finance/equipment`
- **Source:** `api/src/routes/mocks.ts:99` and `:122`
- **Trigger:** Body fails zod parse.
- **State:** The server-side scan route is firing the write-back. If this trips, my code is wrong, not the tech's.
- **Recovery:** Log it, surface a "couldn't sync facilities/finance — operations still updated" banner. Don't fail the scan; the scan already succeeded upstream.
- **Microcopy:** `Recorded the scan, but couldn't update facilities/finance. Manager will see it on the reconcile report.` (Honest about partial success.)

---

## Generic / infrastructure errors

### `internal_error` — 500
- **Source:** Documented in `api-reference.md:230`. Not seen in any `sendError` call I could grep — probably comes from Fastify's default error handler on uncaught exceptions.
- **State:** Anything could trigger this.
- **Recovery:** Retry, then give up. Don't auto-retry — the request might have partially completed and a duplicate scan creates a confusing event.
- **Microcopy:** `The system errored. Your scan wasn't saved. Try again.`

### `missing_token` — 500 (from the same-origin proxy, not upstream)
- **Source:** `starter/app/api/upstream/[...path]/route.ts:13-23`
- **Trigger:** `API_TOKEN` not set in the starter's env.
- **State:** Dev environment misconfig. Should never reach a real user.
- **Recovery:** Surface in big red text in dev — silent in production is worse.

### Network errors (no `error.code`)
- **Source:** `fetch()` throws. Caught in our code as a non-`ApiError` exception.
- **Trigger:** Offline, upstream down, DNS, CORS — none of these come with the structured error shape.
- **Microcopy:** `Couldn't reach the system. Check the connection and try again.` No technical detail.

### Rate limit — 429 (BRIEF SAYS 60/min, LOCAL API DOES NOT ENFORCE)
- **Source:** `api/README.md` and `docs/CHALLENGE.md:92` both reference a 60 req/min rate limit, but `grep -rn "rate.limit|429" api/src/` returns nothing. Local dev never sees 429. The hosted API presumably enforces it.
- **State:** Manager loaded the asset list while it was polling, or reconcile fired N parallel requests.
- **Recovery:** Backoff with a single retry. Show "Rate limited — retrying in 3s." Don't loop forever.
- **Microcopy:** `Too many requests. Slowing down…`

---

## Client-side validation (catch before calling the API)

These never reach the network if we do our job:

| Check | Where | Microcopy |
|---|---|---|
| `/^C\d{7}$/` | tag inputs on every screen | `Tag should look like C0000101 — letter C, then seven digits.` |
| non-empty serial after trim | receive (new) + receive (confirm-duplicate) | `Serial number is required.` |
| non-empty model / manufacturer | receive (new) | `Model is required.` / `Manufacturer is required.` |
| asset_class picked | receive (new) | `Pick an asset class.` |
| location.site set | receive (new), store | `Pick a site.` (defaulted, but the form can clear it) |
| location complete for deploy | deploy | `Deploy needs site, room, rack, and RU. Missing: <list>.` — prevents the API round-trip |
| to_custodian ≠ self user_id | transfer | `That's you. Scan the receiving tech's badge.` |
| to_custodian ≠ current custodian | transfer (after asset lookup) | matches `same_custodian` API message |
| Tag pre-flighted on store/deploy/transfer | each | If the tag is unknown, offer the Receive link before submitting |

---

## Naming concerns (raw material for README pushback section)

1. **`and_match_failed`** — meaningless name. Reads like "the AND match failed" but `AND` isn't a thing the API talks about. Almost certainly intended as `serial_match_failed` or `asset_and_serial_match_failed`. Suggest renaming to `serial_mismatch`.

2. **`invalid_location` is overloaded.** The receive, store, deploy, and transfer endpoints all return `invalid_location` for *any* zod parse failure on the request body — even when location has nothing to do with the failure (transfer doesn't take a location at all; receive's missing `serial` lands here). It should be a generic `invalid_payload` or `invalid_request_body`. The current name actively misleads error-handling code.

3. **Three names for the same kind of failure.** `invalid_query` (list endpoint), `invalid_location` (scan endpoints), `invalid_payload` (mock endpoints) are all "request body/query didn't pass zod." Pick one canonical name; keep specific codes for *specific* fail-fast checks (`invalid_tag_format`, `incomplete_deploy_location`).

4. **`invalid_query` is undocumented.** Present in `api/src/routes/assets.ts:16` but absent from `api-reference.md`'s error table.

5. **`internal_error` is documented but never emitted by any route.** It's presumably the catch-all from Fastify's default handler. Either remove from public docs or add an explicit `setErrorHandler` that emits it consistently.

6. **`incomplete_deploy_location` is good.** Specific, scoped, and the details payload carries the partial location. This is the model the others should follow.

7. **Rate-limit claim isn't enforced locally.** Brief and api/README state 60 req/min; no implementation in `api/src`. Either implement (Fastify rate-limit plugin is one line) or strike the claim from the docs.

8. **`/health` is at the root, but the proxy assumes everything is under `/v1`.** Browser calls to `api.health()` 404 through the proxy. Either move `/health` under `/v1`, or special-case it in the proxy.

9. **`transfer_custody` events don't record `to_custodian`.** The `Event` type carries `user_id` (who scanned) but no destination-custodian field. On a transfer, `user_id` is the FROM party (the logged-in tech); the new custodian is written to the asset record but never persisted in the event itself. The destination is reconstructible only by (a) reading the asset's current custodian — works only for the most recent transfer — or (b) parsing `scan_payload` if the client wrote it in a known shape. Adding a `to_custodian: string` field to the Event union (or a generic `event_payload` jsonb) would make custody history trivially auditable. As-is, a manager investigating a transfer history six months later has to know the client's payload conventions. This came up implementing the asset-detail event log: the headline "Custody from A to B" required parsing my own `scan_payload` JSON shape, which is fragile if any other client writes a different format.
