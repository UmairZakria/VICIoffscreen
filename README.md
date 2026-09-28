# DNC & Identity Compliance Lookup (Parallel Dual-Source)

A Chrome / Microsoft Edge Manifest V3 extension with:
* **Sub-Second Instant Lookups (Persistent Warm Background Workers)**:
  - Pre-warms both `https://infolookup.site/` and `https://infolookupp.com/` in persistent background iframes.
  - Keeps sessions, scripts, and Cloudflare tokens pre-initialized in memory.
  - Does **NOT** reload the website between searches — simply enters the new number in-place and clicks search, delivering the same instant (<1s) speed as searching manually on the site.
* **White & Black Minimalist Theme**: Crisp white main background (`#ffffff`), solid black buttons (`#000000`), black text, and clean modern hairline dividers.
* **Sticky Draggable On-Page Widget**: Floats directly on top of your CRM, dialer, or any website.
  - **Sticky**: Stays fixed as you scroll.
  - **Draggable**: Drag by the header grip (`⋮⋮`) anywhere across monitors.
  - **Remembers Position**: Restores your preferred screen location across reloads.
  - **Collapsible / Closable**: Minimize with `_` or close with `✕`. Click extension toolbar icon to toggle.
* **Parallel Dual-Source Headless Search**:
  - Source 1: `https://infolookup.site/`
  - Source 2: `https://infolookupp.com/`
  - Runs both searches simultaneously in parallel in the background without opening visible tabs.
  - **Fastest Response First**: Displays results immediately as soon as the first source finishes.
  - **Smart Deduplication**: If both websites return the same record, it displays only once with a `✓ Verified Match Across Both Sites` badge. If different records are returned, it displays them in order.
* **Full Identity & First Address Extraction**:
  - Full Name
  - Initials Avatar
  - Age badge
  - Full First Address (Street, City, State, Zip)
* **Compliance Status**:
  - DNC Status
  - Litigator
  - Blacklist
* **1-Click Copy**:
  - Individual copy buttons for Name and Address
  - 1-click "Copy All Info" button

## The second lookup source moved to infolookupp.com

Record 2 used to be `https://vibegenx.com/infolookup`. It is now **`https://infolookupp.com/`** —
same theme, same `cx-` markup, a few details different. The source name is the record identity
everywhere (it is the key the widget hangs the record card, the ZIP filter and the DOB run on), so
the name moved with the site:

* `manifest.json` — host permission, content-script match and description.
* `offscreen.html` / `offscreen.js` — the runner frame is `frame-infolookupp`, pre-warmed on
  `https://infolookupp.com/` like the other sources.
* `rules.json` — the framing rule for `||infolookupp.com` (strips `x-frame-options` and
  `content-security-policy`) is what lets the page load inside the hidden iframe at all.
* `background.js` — the warm worker port key and the dispatch call.
* `content.js` — the search flow, the extractors and every reported result.

**The host match is exact, on purpose.** `infolookupp.com` contains the string `infolookup`, so
the old `host.includes('infolookup')` check classified the new source as `infolookup.site` and ran
the first source's flow, with the first source's selectors, against it. `SOURCE_BY_HOST` now maps
each host to its own source.

What the new markup needed:

* **`STATE / ZIP` is one column.** An address row carries `.cx-addr-street`, `.cx-addr-city` and
  `.cx-addr-statezip` (`"TX 77047"`), where the older build had a separate state and ZIP column.
  `splitStateZip()` reads every shape of that cell and both layouts still work.
* **`—` is not a value.** A row without a location prints an em dash, which `cleanAddressField`
  already treats as empty — that is what keeps a street-only row street-only instead of reading
  `"8301 Tumbleweed Trl, Apt 3601, —, —"`.
* **The name cell holds a copy button**, which is stripped before the name is read.
* **The search row is `.search-input-wrap`** (the input plus a "Paste" button), so the input is
  looked for there first and the submit control is searched by id, `type="submit"`, class and
  label. A build with no submit button is no longer an instant failure: Enter (and
  `form.requestSubmit()`) is tried, and the results wait reports the timeout if nothing was
  submitted.

Regression harness: `node scratch/infolookupp_test.js`

## DOB Discovery (Unmask.com) — which date gets accepted
## DOB Discovery (Unmask.com) — which date gets accepted

The **DOB** button deep-researches the record's date of birth on Unmask.com. The
record's age string usually carries the birth year, e.g. `72 yrs (1954)`, and that
year is what every candidate is validated against:

* A card/profile is only used when its age is within **±3 years** of the record's age
  (`72 yrs` → accepts 1951‑1957, rejects 1958 because it is 4 years off).
* On a profile page every date is collected (born on … / DOB: … / month day, year /
  month year) and the **closest** year to the expected birth year wins — not the first
  date on the page — so a relative's birth year can never leak into the result.
* If a profile only shows dates that contradict the record's age, the extension
  reports **no DOB** and keeps searching instead of reporting a wrong date.
* A matched profile whose summary has **no birth date at all** (e.g. Unmask shows only
  *"Cristian currently lives in Houston, TX"* plus the address) is abandoned ~1.2 s after
  the summary stops rendering — the run moves straight to the next fallback instead of
  waiting out the 12 s profile timeout.
* **Placeholder / partial dates are never trusted alone.** When a source only offers a
  *January* date (`January 1954`, `January 1, 1954`, `01/01/1954` — Unmask's
  month/day-unknown placeholder) or a bare birth year (`1962`), that value is still
  shown and copied as **DOB 1** (marked *"month/day unknown"* / *"year only"*), but the
  run immediately keeps searching — Unmask continues on ThatSthem, ThatSthem continues
  with its next step — and the fuller date is displayed next to it as **DOB 2**, each
  with its own copy button. If nothing fuller exists the user is told
  *"Only the birth year 1962 from ThatSthem – no fuller date found (searched …)"*.
  The fuller date is what goes into the Amica/Mercury quote form.

Fallback order when nothing is found: every address → phone number → name + city +
state → name + state. If Unmask answers a name search with its **"What age range best
fits …?"** prompt (18‑29 / 30‑49 / 50‑99 / "I don't know"), that means there are no
usable records behind it, so the run moves on to the next fallback immediately
instead of waiting for cards. When every fallback is exhausted the user is told with
*"No DOB found on Unmask (searched …)"*.

Regression harnesses: `node scratch/dob_engine_test.js`, `node scratch/unmask_modal_test.js`,
`node scratch/challenge_handoff_test.js`, `node scratch/dob_return_tab_test.js`

## The run never follows a link off the site

A DOB run exists to read **one** profile's date of birth, so no link on the page is ever
followed unless it is a person profile on the host the run is already on. Unmask's own
chrome — header, footer, "share" rows, app banners — carries anchors to Facebook, X,
Instagram, YouTube and data brokers, and the relative scan used to match a bare `a[href]`
sweep of the whole page, so a social link could win the match and be loaded (or scrolled to)
instead of the profile holding the DOB.

* Every candidate link is **resolved first** (`resolveInternalUrl`) and must stay on the
  same host (`www.` ignored) with an `http(s)` scheme. A social host, any other domain, a
  `mailto:`/`tel:`/`javascript:`/`data:` link and an in-page `#` jump resolve to `null`.
* The destination must then look like a **person profile** (`isInternalProfileUrl`):
  `/Name/ST-City/<id>`, `/Name/ST/<id>`, `/Name/<uuid>`, `/Name/ST-City` or the short
  `/First-Last/` slug. The site's own furniture (`login`, `privacy`, `terms`, `opt-out`,
  `blog`, `search`, `unlock`, …) and its address/phone/email **listings** are never followed.
* The **target profile's DOB is read to completion first.** The relatives section is only
  scrolled and scanned while the page is *not* the target's profile, so no scroll, card
  match or navigation can cut the DOB extraction short.
* The "See all relatives" control is clicked only when it is a button or a link that stays
  on the site — a click on an external anchor is itself a navigation.
* Relative candidates found on a search-result card, and the final candidate that is about
  to be loaded, go through the same gate: a social or external anchor that answered to the
  name is dropped, so the run can never be navigated off the site.

Regression harness: `node scratch/unmask_relative_link_test.js`

## Google AI Mode: the DOB row, and the search-history cleanup

Google is a **second, independent DOB source** beside Unmask. The run asks AI Mode
`"{name} lives at {address} born in {year} in which month ? no rough guess accurate"` for the
record's primary address and then for its other addresses, and what comes back is drawn as its own
row next to the Unmask / ThatSthem dates (`google.ai`) so the two can be compared. Like the other
sources it runs in the hidden offscreen runner (`GOOGLE_VISIBLE = false`), so no tab appears.

The query is typed into the box on `google.com` and submitted with Enter; every *following* address
is opened directly on the AI Mode URL (`&udm=50`), which is why the box is only touched once per
run.

**That typed query is also a search-history entry**, and Google offers the same string straight back
in the box's suggestion list — the only place it can be taken out again:

* The list opens by itself once the query is typed, or on **Ctrl+ArrowDown**, or on a **click in the
  box**; the box announces it with `aria-expanded="true"`. The run uses *visible rows* as the primary
  signal and accepts the attribute as a fallback, so a build that keeps `aria-expanded` on a wrapper
  cannot leave the cleanup doing nothing.
* Every row is a `li[data-attrid="AutocompletePrediction"]` (`.sbct`) whose `data-entityname` is the
  string it stands for, and every row holds a "Delete" control
  (`div.AQZ9Vd[role="button"][aria-label^="Delete"]` wrapping `div.sbai`) that is
  `visibility:hidden` until the row is hovered.

So, before Enter is pressed, the run opens that list and **sweeps it**: it hovers the row (dispatching
the hover events *and* setting the `.sbhl` class Google's CSS keys on), presses the hidden "Delete"
label **and** the wrapper that carries the `jsaction` as a full pointer/mouse sequence (left button,
`detail: 1`, primary mouse pointer, the element's own coordinates), waits for the row to disappear and
repeats the press up to twice before moving on.

It removes **the run's own query and every stale entry an earlier run left behind**. That second part
is what keeps the list from growing by one entry per run: the query shape is the extension's own and
is matched **anchored at the end** — `… lives at … born in <year> in which month ? no rough guess
accurate` — so a user's own search that happens to mention those words is never touched. The current
run's query is matched exactly first (case and whitespace aside), then by its opening 60 characters in
case Google stored it trimmed.

Everything is bounded (`LIST_OPEN_MAX_MS`, at most `HISTORY_MAX_DELETES` rows and
`HISTORY_SWEEP_MAX_MS` in total), so a box that never opens its list cannot hold the search up — and
the box is **re-armed** right before Enter (`armQuery`): Escape closes the list and the typed query is
written back, so an item left selected in it can never be what Google searches for instead.

**The sweep never fails silently** — the progress line names the outcome, which is also how the step
is diagnosed on the live page:

| Progress line | What it means |
| --- | --- |
| *"Removed N searches from Google's history."* | the Delete presses worked (N includes stale entries) |
| *"Google's suggestion list did not open - the search history was left as it is."* | no rows ever rendered or `aria-expanded` never flipped |
| *"Google did not remove the search-history entry - its Delete control ignored the click."* | the row was there and pressed, but Google did not act on it |
| *"No Google search-history entry for this search yet."* | nothing of ours was in the list |

The runner's console (`chrome://extensions` → the extension → **Inspect views: offscreen.html**) also
logs `[Google] search-history sweep: N removed, M left alone, X ms`. To *watch* the step, set
`GOOGLE_VISIBLE = true` in `background.js`: the Google run then uses a real tab for one run.

**The cleanup happens on a trip back to google.com.** Google records a search a moment *after* it
happens, so the entry is usually **not** in the suggestion list yet when the run leaves the homepage.
The answer is therefore held, the run returns to `https://www.google.com/`, and each page load is one
attempt:

1. the box is **clicked** (that, or a plain focus, is what renders the list — the click is repeated and
   `Ctrl+ArrowDown` is tried with it), then the list is swept;
2. if nothing of ours is in it and the box showed no suggestions at all, the query's **opening 40
   characters are typed in** to give Google something to suggest (typing alone does not search, so this
   adds no history entry of its own);
3. if the entry is still not there, the page is **refreshed** and the attempt is repeated — up to
   `CLEANUP_MAX_RELOADS` refreshes and `CLEANUP_MAX_MS` in total;
4. the moment an entry of ours is gone, the held answer is reported.

A sweep that finds the row but cannot delete it also leads to a refresh and another attempt, so a
missed click is retried rather than given up on. The trip is hard-bounded: whatever happens — no box, no
list, a consent wall — the answer it is holding is reported (and a run already longer than
`CLEANUP_GIVE_UP_AFTER_MS` reports immediately instead of taking the trip at all).

Regression harness: `node scratch/google_history_delete_test.js`

## Full Address Completion (infolookupp.com records)

`infolookupp.com` often returns only the street (`3724 Kildare Dr`) while
`infolookup.site` returns the complete address (`3724 Kildare Dr, Houston, Texas
77047`). Amica, Mercury and Unmask all need **city + state + zip**, so the missing
parts are now resolved with the public **Nominatim (OpenStreetMap)** API inside the
background worker, before a record is streamed to the widget:

* Only records that have a street but no city/state/zip are looked up (PO boxes are skipped).
* Results are cached for 30 days (memory + `chrome.storage.local`) and requests are
  rate limited to 1 per second, as the public Nominatim policy requires.
* When `infolookup.site` already returned the full address for the same street, its
  city/state/zip is used as a hint, so the lookup stays in the right city.
* A result is only accepted when the road, house number and state match the record —
  a mismatching hit is discarded and the original record is left untouched.
* If the lookup fails, times out (6 s) or finds nothing, the record keeps its original
  street and everything else works exactly as before.

Regression harness: `node scratch/address_completion_test.js`

## ThatSthem.com fallback (after Unmask has nothing)

If every Unmask.com fallback fails, the very same hidden runner continues on
**thatsthem.com** in this order:

1. name search — `https://thatsthem.com/name/Deborah-Williams/Houston-TX-77047`
2. every address — `https://thatsthem.com/address/3724-Kildare-Dr-Houston-TX-77047`
3. phone — `https://thatsthem.com/phone/713-252-6330`

ThatSthem result cards already carry the date of birth
(*"Born October 1958 (67 years old)"*), so the DOB is read straight from the search
results — no profile page has to be opened. The same rules as Unmask apply:

* **Name matching** — first + last name (middle name / initial scored), or a match
  through the card's **"Known as:"** aliases.
* **DOB / age matching** — accepted only within **±3 years** of the record's age or
  explicit birth year (a 1958 card can never answer a `72 yrs (1954)` record).
* **Zip matching** — when both the record and the card know the zip, they must be equal
  (state must match as well); the exact street match scores highest.
* A card that only matches by name is not enough: it must also carry a DOB, otherwise
  the run moves to the next fallback.

* **Zip matching uses the card's whole address history.** A record's address is often the
  person's *previous* address (they move), so the zip/street check looks at the card's
  **Current Address plus every Previous Addresses entry**. This was a real miss: the
  right card for a `2740 Kibler Rd … 44321` record had `44313` as its current address
  and `44321` only in its previous addresses, so it used to be rejected while the older
  same-name cards (wrong DOB) scored highest.
* **The security check is handed to the user.** Every ThatSthem search can answer with its
  sentinel/Cloudflare Turnstile page (`<title>Security Check</title>`,
  `meta[name="sentinel-challenge"]`, `#captcha-container`, *"Confirm you're human"*).
  An empty page there is **not** "no records": the run brings the tab to the front and waits
  (up to 3 min) for the check to be cleared, then reads the results normally. Nothing on the
  check is ever clicked — see *Security checks: the user's to solve* below.
* **A "No Results Found" page is a result, not a check.** That page carries ThatSthem's *own*
  Turnstile widget, and reading that widget as a challenge handed the panel
  (`<div class="bg-amber-50 …">` with `<h2>No Results Found</h2>` and *"We couldn't find any
  records matching your search"*) to the user as something to solve — the run then sat there for
  up to three minutes with nothing to clear. So:
  * the panel is now read **first**, before any check detection, and advances to the next step;
  * a page carrying the site's own content (result cards, that panel, or its search box) can never
    be a check, however much Cloudflare framework it loads;
  * and the detector only keys off Cloudflare's *interstitial* markup (sentinel metas, the
    interstitial title, `#challenge-form` / `main.challenge` / `challenge__*` / `chl_page` script,
    and the `#title` / `#description` / `#status` wording) — never a turnstile widget or a
    Cloudflare script on its own, which every normal page of the site has. The same lesson the
    Unmask detector had already learned.
* When both sites are exhausted the user sees
  *"No DOB found on Unmask or ThatSthem (searched …)"*.

Regression harnesses: `node scratch/thats_them_test.js`, `node scratch/challenge_handoff_test.js`

## Security checks: the user's to solve

Cloudflare's Turnstile widget lives in a **closed shadow root** and only trusts real OS-level
input. The extension used to try to beat it — measuring the widget, or replaying the user's
recorded click through the **Chrome DevTools Protocol** as a real trusted click. Both were
removed, together with the **`debugger` permission** they needed.

**The check now belongs to the user.** On seeing a check the run:

1. **Puts the check in front of the user once** (`FOCUS_LOOKUP_TAB`) and reports *"please clear it in
   the tab that just came forward"*, **once** only (`challengePrompted`), so it cannot nag. A DOB
   run normally works inside the **hidden offscreen runner**, where there is no tab to bring
   forward — so on seeing a check the run is **promoted into a real tab** at that point (see
   *Unmask / ThatSthem: hidden runner and the security-check hand-off* below).
2. **Touches nothing at all** while the check is up — no click, no recorded replay, no
   `Space`-key rescue, no reload, no "Try again". Each tick simply re-reads the page.
3. **Resumes by itself** the moment the check clears: the results are read exactly as they
   would have been, and the search carries on.
4. **Gives up politely** if nobody clears it: after `CHALLENGE_WAIT_MS` (3 min) the run moves
   to the next address/target with a plain *"the check was not cleared"* line.

**Nothing on a check page is ever clicked, in any form.** That is enforced by
`node scratch/challenge_handoff_test.js`, which asserts the removed solver's entry points
(`solveTurnstile`, `dispatchTrustedClick`, `replayRecordedApproach`, `chrome.debugger`,
`Input.dispatchMouseEvent`, …) appear in none of the three shipped files, and that the live
branch body contains no click, no reload and no replay — only `focusThisTab()` and a watch loop.

One unrelated click remains on Unmask: its own **"unlock search results"** toggle (a plain
in-page checkbox that reveals the results list). Its selectors are deliberately narrow —
`aria-label*="View/Address/Phone/Name Search"` only — so a human-verification widget can never
be picked up by it. The generic `*="Verify"` / `*="human"` selectors that could match one were
removed.

**Nothing is recorded or replayed for a check any more.** The cursor-recording feature is gone
altogether — no recorder script, no macro slots, no recording messages. The Settings panel now holds
the *switches* instead (which records a lookup runs on, which DOB platforms it may ask, which records
show their DNC status): see *Settings & Calibration: what a lookup runs on* below.

## Unmask / ThatSthem: hidden runner and the security-check hand-off

A DOB run normally works inside the **offscreen document's hidden iframe** — the same mechanism
`infolookup.site`, `infolookupp.com` and `www.amica.com` use — so **no tab appears in the user's tab
strip while a run works through its addresses**. The session is written to storage *before* the
frame is pointed at the first step, because the content script reads it exactly once on load.

### A check is only seen when there really is one

Promotion is expensive — it puts a tab in front of the user — so the detector behind it has to be
precise. It used to treat anything Cloudflare-ish as a check, including
`script[src*='challenge-platform']`, `script[src*='challenges.cloudflare.com']` and
`iframe[src*='turnstile']`. A **normal** page behind Cloudflare carries the bot-management script,
and can embed a Turnstile widget of its own, so ordinary results pages were mistaken for checks —
which promoted *every* run into a visible tab with nothing on it to solve.

The detector now keys off the interstitial's own shell only:

* the title — *"Just a moment…"*, *"Attention Required!"*, *"Checking your browser"*,
  *"Performing security verification"*
* `<main class="challenge">` and its `challenge__*` children (`.challenge__hero`,
  `.challenge__title`, `.challenge__hero-image`)
* the older challenge-page IDs (`#challenge-running`, `#challenge-stage`, `#challenge-form`)
* `script[src*='chl_page']` — Cloudflare's challenge-page script specifically, as opposed to the
  bot-management script a normal page loads

The broad src markers are gone. `node scratch/dob_offscreen_test.js` asserts both directions: a
normal page carrying either cloudflare marker is **not** a check, and the real interstitial still is.

A security check is the one thing that cannot be solved in a hidden frame: nobody can see it. So on
seeing a genuine one the run is **promoted** — handed over to a real tab parked on the same step —
and only then is the user involved:

| Moment | What happens |
|---|---|
| A Cloudflare / browser check appears in the hidden runner | the run is **promoted**: a tab is opened on the current step, activated, and its window focused (`PROMOTE_RUNNER_TO_TAB` via `FOCUS_LOOKUP_TAB`), and the offscreen frame is parked so only one runner stays live |
| The check clears | the promoted tab **drops to the background** and the user is put back on the tab they started from, while the lookup carries on inside that tab out of sight |
| The run ends (DOB found, nothing found, error, cancel) | the caller tab is activated again; the final line stays readable for **1.5 s**, then the lookup tab closes. Offscreen runs never opened a tab, so there is nothing to close and nowhere to send the user — the frame is simply parked back on `about:blank` |

### A run is never sent to a tab just because the document was still booting

`chrome.offscreen.createDocument()` resolves when the document **exists**, not when `offscreen.js` has
run and registered its message listener. A message sent into that window fails with *"Could not
establish connection"*, which looks exactly like *"there is no runner"* — and `prepareRunner()` used
to spend its three retries inside it and then fall back to a background tab.

That is what produced the oddest symptom seen here: one lookup where **Google ran hidden and Unmask
did not**. `START_DOB_LOOKUP` starts both prepares at the same moment and against the same offscreen
document, so whichever lost the race opened a tab. It is worst right after an extension reload, since
that is when the document is gone and is recreated lazily by the first lookup.

The document is now pinged and waited for before anything is asked of it:

* `pingOffscreen(timeoutMs)` re-sends `PING_OFFSCREEN` until the document answers, up to 3 s per
  attempt; `prepareRunner()` only sends `PREPARE_RUNNER` once it has an answer.
* That answer lists the runners the document really has (`{ status: 'pong', runners: [...] }`), so a
  **stale document is detected from its own report** instead of from a failed message. A missing
  runner replaces the document once (`offscreen-not-listening`, `no-frame` and `unknown-source` all
  do) and the prepare is retried before anything falls back to a tab.
* The service worker also calls `ensureOffscreenDocument()` at **start-up**, so a reload boots the
  document before the first lookup asks for a runner. Amica is deliberately *not* pre-loaded there:
  that line runs on every service-worker wake, and re-pointing a parked page each time would defeat
  keeping it warm.

### Which runner a run is using is shown on the progress line

A tab can only appear for a DOB run in two ways — the hidden runner was unavailable, or a security
check promoted it — so every `DOB_LOOKUP_PROGRESS` line now ends with which one it is:

| Suffix | Meaning |
|---|---|
| `· hidden` | the run is in the offscreen frame; no tab belongs to it |
| `· tab (security check)` | it was promoted so a check in the frame could be solved |
| `· tab (no hidden runner: <reason>)` | the offscreen prepare failed (`prepareRunner` reports the reason) and the run is in a background tab |

That is deliberately visible rather than console-only: "why is there a tab?" is then answerable from
the widget itself. A run object rebuilt from a message has no `mode` and is left unlabelled rather
than being claimed to be hidden.

The tab id of a promoted or fallback tab is also written into the **persisted session**
(`session.dobTabId`), and a new run closes a leftover one before it starts. Without that, a
service-worker restart mid-run orphans the tab (the in-memory run is gone, so nothing closes it) and
the *next* search appears to be running in a tab that actually belongs to the previous one.

### Why the promoted tab is not closed when the check clears

Closing it there was tried and **reverted**. Whether a *hidden frame* gets challenged is a different
question from whether a *top-level tab* does, and in practice the frame came back challenged
straight after the user had cleared the check in the tab. The run was therefore handed back to the
frame, the frame was challenged again, a second tab was opened, that tab loaded cleanly, reported
*"cleared"* and was closed again — **a tab that opened and closed over and over**.

So the run stays in the tab — the one context that reliably gets through the check — the tab goes to
the background, and the user gets their own tab back. `endDobLookup()` closes it when the run
finishes. A tab that quietly sits in the background for the length of one lookup is the lesser evil.

A later check in that same tab still hands the user back: `challengeCleared` is **reset** whenever a
check appears, not merely set, so the flag can never belong to a previous check.

Promotion uses the URL the **background** recorded for the step (`session.currentUrl`), not the URL
the check page reports. Cloudflare usually serves its interstitial on the same URL, but it can also
redirect to `/cdn-cgi/challenge-platform/…`; sending the user there would put them in front of a page
with nothing to solve.

Only the promoted tab may trigger the hand-back: the offscreen frame reports checks as well, and it
must never be the reason the user's view is taken away. The hand-back is reported once
(`challengeClearedSent`), and the automation can only report it **after** the challenge branch has
been left — that branch returns while a check is on screen, so a run can never claim "cleared" while
the user is still looking at the check.

If the offscreen document cannot be created the run **falls back to the old behaviour**: a real
background tab, activated when a check appears and hidden again once it clears. Same hand-off either
way.

Three safeguards keep that fallback from being a silent surprise:

* **A stale offscreen document is recreated.** An offscreen document from an earlier install has
  outlived the update and does not contain the runner frame, so it answers `no-frame` — or
  `unknown-source`, if it is still running the *old* `offscreen.js` and has never heard of that
  runner at all. Both mean "replace this document", and both are retried once against a freshly
  created one. Treating only `no-frame` that way is what quietly put every DOB run into a visible
  tab.
* **A transient failure is retried too.** `chrome.offscreen.createDocument()` resolves when the
  document *exists*, not when `offscreen.js` has run and registered its listener, so the first
  message after creating one can fail with *"Could not establish connection"*. That is not
  "there is no runner", so it is retried (3 attempts, 250 ms apart) rather than downgrading the
  run. This bites hardest right after an extension reload, when the offscreen document is gone and
  is recreated lazily by the first lookup — i.e. exactly when someone is testing this.
* **A fallback announces itself** — the exact reason is logged, and the widget is told
  *"Hidden runner unavailable - this lookup is using a background tab."* A tab appearing with no
  explanation is the one thing this design exists to prevent.

The return target is fixed when the run starts: the widget hands over its own page
(`sender.tab`), while the popup and the standalone window are not tabs at all, so
`chrome.tabs.onActivated` remembers the **last web tab** the user was on (`chrome://`,
`chrome-extension://` and `about:` pages are ignored). The hand-off is polite: the caller tab is
only activated while the lookup tab is still the one on screen — if the user already moved on,
their choice wins and nothing is stolen from them. The target is part of the stored session
(`unmask_pending_lookup`), so a restarted service worker can still finish the hand-off.

Both DOB content scripts ask the background `RUNNER_HELLO` before they run and only start once it
answers, because the offscreen runner means they now legitimately run in a subframe. The background
tells the offscreen document apart from a foreign page by `sender.tab` — a content script in a
normal tab always has one, and the offscreen document is not a tab. A page that embeds `unmask.com`
or `thatsthem.com` in a frame of its own is therefore refused, instead of getting a DOB run driven
with somebody else's saved search.

Unmask sends `X-Frame-Options: SAMEORIGIN`, so `rules.json` strips the framing headers for it;
ThatSthem sends none, so its rule is belt-and-braces.

Regression harnesses: `node scratch/dob_offscreen_test.js`, `node scratch/dob_return_tab_test.js`

## Speed: how fast each step reacts

Every automation step polls the page instead of waiting on fixed delays, and it only
waits as long as the page is still changing:

| Wait | Unmask | ThatSthem |
|---|---|---|
| State re-check interval | **150 ms** | **150 ms** |
| Page with no results / no dialog | **2.0–2.5 s** (6 s while the document is still loading) | **7 s loaded / 12 s still loading** |
| Cards visible but none matched | 500 ms of an unchanged list | 500 ms of an unchanged card list |
| Matched profile without a DOB | 350 ms of an unchanged summary | – |
| "Try Searching Another …" / no-results panel | next tick (~0.15 s) | next tick (~0.15 s) |
| Browser-verification / security page | the run is promoted into (or its tab brought forward as) a real tab and the user is asked once to clear the check; nothing on the check is clicked, replayed or reloaded — the run simply watches until it clears (up to 3 min), then reads the results | if it never clears, the next step is tried after the 3-minute wait |
| Navigation to the next fallback | immediate | immediate |

## Amica quote: running in a hidden frame instead of a visible tab

Amica now runs in an **iframe inside the offscreen document**, exactly like `infolookup.site`
and `infolookupp.com`, so a quote no longer takes a tab out of the user's tab strip. The runner
frame (`frame-amica`) sits on `about:blank` until a quote is actually asked for, is pointed at
`https://www.amica.com/` for the run, and is parked back on `about:blank` when the run ends —
the finished quote holds the person's name, address and vehicles, and there is no reason to
leave it sitting in a long-lived document.

Three things had to give way to make that work:

* **Amica sends `x-frame-options: SAMEORIGIN`.** `rules.json` strips `x-frame-options` and
  `content-security-policy` for `||amica.com` (rule 3) on `sub_frame` / `xmlhttprequest` /
  `other`, the same mechanism the other two lookups already rely on. Without it the frame
  renders a blank refusal and the run times out.
* **`amica_automation.js` refused to run in any frame.** It bailed out on
  `if (window !== window.top) return;`, which would have stopped the runner dead. A frame now asks
  the background whether it is the extension's own (`RUNNER_HELLO`): a content script in a normal
  tab always carries `sender.tab`, the offscreen document does not, so a page that embeds
  `www.amica.com` in a frame of its own is refused and gets no automated quote driven with somebody
  else's saved profile.
  `document.referrer` was tried first and **cannot work**: an extension page sends no `Referer`, so
  the offscreen runner is indistinguishable from a parentless frame, and once the funnel navigates
  the referrer becomes an amica.com URL either way.
* **The content script needed `all_frames: true`** to be injected into the offscreen frame at
  all (it was top-level only).

**Ordering matters:** the pending quote is written to `chrome.storage.local` *before* the frame
is told to load, because `amica_automation.js` reads `amica_pending_quote` once on load. Load
first and the run never starts. The `amica.com` cookies are wiped first as well, so the frame
loads a fresh Amica session instead of the previous run's.

**The runners are laid out, not `display:none`.** A `display:none` frame has a zero-size
layout box and Amica will not render its quote flow in one, so `#runners` is parked off to the
left (`left: -10000px`) at a real 1280×800 instead.

`offscreen.js` now resolves a source to its frame through an explicit `RUNNERS` map. The
previous `source.includes('infolookup') ? infolookup : infolookupp` ternary silently sent **any
unlisted source to the infolookupp frame**; an unlisted source is now reported as
`unknown-source` instead of being guessed at.

**Fallback:** if the offscreen document cannot be created, or the frame refuses the prepare,
`startVehicleLookup()` logs a warning and opens a real background tab exactly as before, so the
quote still runs. All teardown goes through one `finishVehicleLookup()`, which closes the tab
in tab mode, resets the frame in offscreen mode, and clears the right pending-quote key in
both. Mercury is untouched — it still opens a tab.

Regression harness: `node scratch/amica_offscreen_test.js`

## Amica quote: the next search is loaded before you ask for it

Booting Amica from scratch is what put *"Initializing Amica vehicle lookup..."* on screen for
several seconds. The site is now **kept loaded in its hidden frame**, so a lookup starts at the
quoting ZIP instead of waiting for the site again:

```
browser start / install    ->  Amica is loaded into frame-amica and left idle
a lookup ends              ->  frame reset, and a fresh Amica is loaded straight away
press Amica on a record    ->  the quote is written to storage
                               the page notices it where it stands and starts at the ZIP
                               (no reload, so no "Initializing Amica vehicle lookup..." wait)
```

* **Only the page can say when it is usable**, so it reports it. `amica_automation.js` waits for
  `document.readyState === "complete"` **and** the quoting ZIP field
  (`#zipcodeInitInputQuoting`) before sending `AMICA_RUNNER_READY { ready: true }`. The background
  stores that in `amica_runner_ready` (10-minute TTL) and takes the fast path only when it is
  there — it is never assumed.
* **Nothing is pre-loaded while a run is in flight.** `prewarmAmica()` returns early when
  `activeVehicleLookup` is set, so the frame is never reloaded underneath a running quote.
* **Two different teardowns, on purpose.** `finishVehicleLookup()` — the end of a run — loads the
  next Amica (`prepareNext` defaults to `true`). The start path passes
  `finishVehicleLookup({ prepareNext: false })`, because the new run is about to take that frame
  itself.
* **A warm page that does not start is not waited on.** If no `VEHICLE_LOOKUP_PROGRESS` arrives
  within 4 s (`AMICA_WARM_FALLBACK_MS`) the background says so and loads Amica the normal way. The
  cold path is untouched, and it is what runs when the pre-load failed, the TTL expired, or the
  frame was replaced by a fresh offscreen document.
* **One page serves exactly one run** (`started` in `amica_automation.js`): the funnel navigates
  deep into the quote flow, so the next search always gets a freshly loaded frame.
* Cookies are cleared at pre-load time as well as at cold start, so the page parked there is a
  fresh Amica session rather than the last run's.

Only Amica is kept warm. Mercury is untouched — it still opens a tab and starts from scratch.

## Amica quote: staying fast while the tab is in the background

The Amica tab used to be opened in the background (`chrome.tabs.create({ active: false })`),
and Chrome clamps timers in a hidden tab to **one call per second** — and to **one call a
minute** once it has been hidden for five minutes. The funnel used to be a `setInterval(…, 50)`
poll, so looking at another tab quietly turned it into a 1 Hz (later 1/min) drip. (The
offscreen frame above removes that throttle entirely; this engine is what keeps the tab
fallback usable, and DOM mutation callbacks are **not** throttled in either mode.) The loop is
now driven by the page instead of by a timer:

| Trigger | Effect |
|---|---|
| DOM change (`MutationObserver`: `childList`, `subtree`, `characterData`, plus `class` / `disabled` / `hidden` / `style` / `aria-*`) | step immediately |
| Safety timer (**400 ms**, the piece that is still clamped when hidden) | covers waits that happen while the page sits still |
| `visibilitychange` / `focus` / `pageshow` / `popstate` / `hashchange` | step immediately |
| Minimum gap between two steps | **60 ms**, and a burst of mutations is coalesced into a single follow-up |
| Minimum gap between two page actions | **350 ms** (was a full second) |

Everything that used to be repeated work happens once:

* **One click per step** — the step keeps its form filled (`fillAndTypeInput` returns
  immediately when the value is already right), but the submit fires once and is only retried
  after **1.5 s** if the page truly did not move on; a button that has not rendered yet does not
  consume the retry window. `clickElement()` now sends the pointer pair and **exactly one**
  `click` — it no longer dispatches a click *and* calls `targetBtn.click()`, which ran every
  Amica handler twice and queued duplicate quote requests. It also leaves
  `disabled`/`aria-disabled` buttons alone and jumps to the target instead of smooth-scrolling.
* **One progress message per state** — `background.js` broadcasts every
  `VEHICLE_LOOKUP_PROGRESS` to **every** tab, so an identical line is not repeated for **1.5 s**.
* **One wide scan per change** — the *"how would you like to enter your vehicle info"* text scan
  (`legend, p, h1…`) is reused for **250 ms**; the cheap
  `#VEHICLE_INFO_ENTRY_OPTION-fieldset` / `input[name="VEHICLE_INFO_ENTRY_OPTION"]` checks still
  answer first, and a screen that is not the vehicle-entry screen is not scanned at all.

The run is still capped at **90 s**, with a further safety timeout that stops the observer and
the timer, and the address-retry timings are unchanged: fill → ~0.4 s settle →
**Start Your Quote** → ~1.5 s verdict.

Regression harness: `node scratch/amica_speed_test.js`

## Amica quote: when Amica rejects the address

Amica silently stays on the step after **Start Your Quote** when it cannot match the
address and marks the street field with `class="invalid"`
(`#addressLineOneInputQuoting`). The automation watches exactly that:

1. Fill the person's address → press **Start Your Quote** → wait ~1.5 s.
2. If the street field is flagged **invalid** (or the page does not move on at all within
   ~7 s), that address is a dud → try the person's **next address** (PO boxes are never
   used).
3. When every address has been rejected, ask **Nominatim** (through the background
   worker) to validate the primary address and try the returned address. A misspelt
   street is accepted as a correction only when the house number, zip and state all
   agree.
4. If that fails too the run stops with *"Amica rejected every known address for this
   person"* instead of clicking in a loop.

Progress messages: *"Amica rejected 11 Bad Rd, Akron, OH - trying the next address…"*,
*"Amica rejected every address - validating one with OpenStreetMap…"*,
*"Retrying with the validated address: 2740 Kibler Rd, Copley, OH"*.

Regression harness: `node scratch/amica_address_test.js`

## Reliability of the dual-source record list

Both sites are searched in parallel and each record is streamed to the widget the moment
its source answers:

* The **first** record shows instantly (*"Fastest Result: Record 1 (awaiting
  secondary…)"*), the second one is appended as *Record 2*. Only the records switched
  on in Settings are searched, so switching one off leaves a single-card lookup.
* Only the **primary address** of a street-only (infolookupp) record is completed before
  streaming, with a **1.2 s budget** — the history addresses are completed on demand by
  Amica / Mercury / Unmask, which reuse the same cache.
* The parallel-lookup timeout (**20 s**) no longer throws the run away: a source that
  answers late is still streamed to the widget instead of its record silently vanishing,
  and the widget now names the record that failed
  (*"Completed (Record 1) - Record 2 failed"*).
* Identical records from both sites are still collapsed into one card with the
  *"✓ Verified Match Across Both Sites"* badge.

## The record's addresses on the card

A record normally carries more than one address: the primary one plus the history the sources
returned. The address card shows **one at a time**, and the chevrons on its right side (next to
the copy button) step through the rest:

```
Primary address          [Copy] [ ▲ 1/3 ▼ ]        Address 2            [Copy] [ ▲ 1/3 ▼ ]
112 Comal Peak                                     9800 Folcik St
Bulverde, Texas 78163                              San Antonio, Texas 78250
```

* The label follows the selection: **Primary address** for the first entry, **Address 2**,
  **Address 3**, … with an `n/total` counter between the chevrons.
* Both chevrons **wrap around**, so stepping past the last address returns to the primary one.
* **Copy always copies the address on screen**, not the primary one, so a different street can
  be grabbed in one click.
* The list is built from `person.address` (primary) followed by `person.allAddresses`,
  deduplicated (casing/punctuation variants count as the same address). Entries without a
  street still show their city/state/zip, a unit is appended to the street
  (*"21 Rainbow Dr Apt 4"*), and **PO boxes are listed too** - they are only skipped when a
  quote form is filled in.
* A record with a **single address shows no chevrons at all**, and the chosen index is kept on
  the person object, so it survives the widget's re-renders (progress updates, vehicle/DOB
  results, record switching).

Regression harness: `node scratch/address_card_test.js`

## Filtering the record cards by ZIP

Both record cards — **Record 1** and **Record 2** — carry a small
**5 digit ZIP box** on their navigation row: the record chevrons stay on the left, the box sits at
the right end of the same row.

```
[ ‹  1 / 3  › ]  · · · · · · · · · · · · · · · · · · · · · · ·   [ ZIP code ]  ✕
      ^ person chevrons                       (one row per record card)     ^ the new box
```

* Typing a ZIP shows **only the people of that record whose addresses include it**: the primary
  address *and* every history address are checked, so somebody is kept when **any** of their
  addresses carries the ZIP. A `78163-4402` ZIP+4 matches `78163`, and a ZIP written inside a
  one-line address is found as well.
* A **partial ZIP (1–4 digits) does not filter** — the list is only narrowed once five digits are
  in, so the card never jumps around while typing (the box accepts digits only, `maxlength=5`).
* The value is **shared**: a ZIP typed into either box filters **both** record cards, and the two
  boxes mirror each other. The `✕` button appears as soon as there is a ZIP and clears it from any
  card, giving the person list straight back.
* When a record has nobody in that ZIP it stays on screen with
  *"No address of this record is in ZIP 90210 — 3 people hidden"*, so the record's compliance
  badges are never lost and the box is still there to undo the filter.
* A record with a **single person still shows the box**; only the `1/1` chevrons are hidden.
* The caret stays in the box while the card is re-rendered on each keystroke, and clicking the box
  never triggers the card behind it.
* A **new search starts unfiltered**, so a ZIP from the previous lookup cannot hide the new
  records.

Regression harness: `node scratch/zip_filter_test.js`

## Settings & Calibration: what a lookup runs on

The **Settings & Calibration** panel (the widget, the popup and the detached window share the same
layout) is what decides which lookup sources and DOB platforms a run may use. **Everything is on by
default**, so an install that never opens the panel behaves exactly as it always has.

| Section | Switch | What it controls |
| --- | --- | --- |
| **Info Lookup** | **Record 1** | the first record a phone number is searched on |
| | **Record 2** | the second record |
| **DOB Sources** | **Unmask** | the platform the DOB run starts on (address → phone → name fallbacks) |
| | **ThatSthem** | the platform the run moves on to once Unmask is exhausted |
| | **AI** | Google AI Mode, which answers beside the others on its own line |
| **DNC Status** | **Record 1** | whether that record's DNC / Litigator / Blacklist card is drawn |
| | **Record 2** | the same for the second record |

The two lookup sites are called **Record 1 / Record 2** (and the vehicle providers **Ride 1 /
Ride 2**) throughout the UI: the sites behind them are never named on a card, in a progress line or in
a summary.

* Each switch is a plain `<label class="setting-row"><input class="setting-toggle"
  data-setting="records.record1">…` and the panel writes **one key** — `automation_settings` — that the
  widget, the popup, the detached window *and* the background service worker all read. A switch flipped
  in one panel therefore takes effect everywhere at once (the other panels repaint from
  `chrome.storage.onChanged`).
* **Only the records that are on are searched.** Switching Record 2 off means its card never appears;
  the lookup itself carries on with Record 1, and *"this lookup is done"* waits for exactly the
  records that were asked for — one or two (`expectedSources`), never a fixed two.
* **A DOB platform that is off is never asked, and never a fallback.** With **Unmask** off the run
  starts on ThatSthem; with **ThatSthem** off, Unmask exhaustion *ends* the run instead of falling
  through (`startThatsThemPhase` refuses outright, so no path can reach it). The three switches are read
  once when the run starts and carried on its session (`allowUnmask` / `allowThatsThem`), so a switch
  flipped while a run is in flight cannot drag a source back in. With all three off the card is told
  *"All DOB sources are turned off in Settings."* rather than being left spinning.
* The **DNC Status** switches only control the **Compliance** card under a record (DNC / Litigator /
  Blacklist); the lookup itself is unaffected.
* Missing keys, an empty group or a junk value all read as **on** — an older install, a half-written
  value or a value written by an older version can never silently turn a source off.

Regression harness: `node scratch/settings_toggles_test.js`


## Portal server: the extension talks to the live deployment

The extension's API base URL is `https://auto-lookup-portal.vercel.app`
(`DEFAULT_AUTH_API` in `background.js`, `DEFAULT_API_URL` in `auth_client.js`), and that origin is
declared in `manifest.json`'s `host_permissions` alongside `<all_urls>`.

`localhost:3000` was only ever the **development** server for the portal. A value like that left in
`chrome.storage.local` (`dnc_api_url`) is what made an already-installed extension fail with
"Could not connect to server … Make sure Next.js is running" after the portal moved to Vercel — the
stored URL was preferred over the built-in default everywhere (login, quota sync, and the paid-lookup
consume call), so nothing ever reached the live portal.

Both entry points now normalise whatever URL they are handed (`isLoopbackApiUrl` /
`normalizeApiUrl` in `auth_client.js` and `background.js`):

* a loopback address (`localhost`, `*.localhost`, `127.x.x.x`, `0.0.0.0`, `::1`) is treated as
  "not configured" and replaced by the live portal,
* a bare host gets `https://` and a trailing slash is dropped,
* the corrected URL is written back to `dnc_api_url`, so an old install heals itself on the next
  popup / window / widget login — no re-install and no manual re-configuration.

The Server box in the popup (and in the detached window) still overrides the default for a staging
deployment, but it can no longer pin the extension to a machine-local server; after a save it shows
the URL that will actually be called. The endpoints used are `POST /api/auth/login`,
`GET /api/auth/me`, `POST /api/lookup/consume`, and `GET|POST /api/admin/users` (admin portal only).
No local Next.js server is needed for an installed build.


## How to Install / Reload

1. Open **Chrome** or **Microsoft Edge** and go to `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right toggle).
3. Click the **Reload** button (circular arrow) on the extension card.
4. Navigate to any website (e.g. your CRM or dialer).
5. Click the extension toolbar icon to toggle the **Sticky Draggable Widget**.
6. Enter a phone number and click **Search** to run the parallel lookup.
