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
