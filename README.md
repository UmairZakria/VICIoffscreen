# DNC & Identity Compliance Lookup (Parallel Dual-Source)

A Chrome / Microsoft Edge Manifest V3 extension with:
* **Sub-Second Instant Lookups (Persistent Warm Background Workers)**:
  - Pre-warms both `https://infolookup.site/` and `https://vibegenx.com/infolookup` in persistent background iframes.
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
  - Source 2: `https://vibegenx.com/infolookup`
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
`node scratch/trusted_click_test.js`

## Full Address Completion (vibegenx.com records)

`vibegenx.com` often returns only the street (`3724 Kildare Dr`) while
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

If every Unmask.com fallback fails, the very same background tab continues on
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
* **The security page is waited out.** Every ThatSthem search can answer with its
  sentinel/Cloudflare Turnstile page (`<title>Security Check</title>`,
  `meta[name="sentinel-challenge"]`, `#captcha-container`, *"Confirm you're human"*).
  An empty page there is **not** "no records": the run waits (up to 90 s) and clears the
  check with a **real trusted click** (see *Turnstile / security checks* below), clicks
  **Try again** if the check fails, and brings the tab to the front for a human when two
  trusted clicks are not enough. The results are read normally as soon as the check clears.
* When both sites are exhausted the user sees
  *"No DOB found on Unmask or ThatSthem (searched …)"*.

Regression harnesses: `node scratch/thats_them_test.js`, `node scratch/trusted_click_test.js`

## Turnstile / security checks: only the trusted click engine

Cloudflare's Turnstile widget lives in a closed shadow root and ignores synthetic DOM
events, so the recorded **"human cursor" replay** (*Engine 1*: move a drawn cursor along
the recorded path and dispatch pointer/mouse events) never cleared a challenge. It has been
removed from both content scripts — a security check is now handled by the **trusted click**
(*Engine 2*) alone:

1. ~0.6 s after the check is detected the widget is located and scrolled into view:
   `iframe[src*='challenges.cloudflare.com']` / `#captcha-container iframe` /
   `.cf-turnstile iframe`, and — because newer Cloudflare markup renders the widget in a
   **declarative closed shadow root** where `querySelector` cannot see the iframe — the
   **hidden `input[name='cf-turnstile-response']`**, whose parent is the widget's host
   element and can still be measured. Only after that do the wide containers
   (`#captcha-container`, `.cf-turnstile`, `.challenge__captcha`, `main.challenge`) act as a
   fallback.
2. The click point is resolved, best source first: the **recorded click point** while it
   still falls inside the widget → the widget's **checkbox** (30 px in from its left edge,
   vertically centred) → the recorded click point when the widget is unreachable → the
   middle of the viewport. A full width wrapper is never used for the checkbox estimate.
3. `REPLAY_MACRO_CLICK` asks `background.js` to attach the debugger and send
   `Input.dispatchMouseEvent` (`mouseMoved` → `mousePressed` → `mouseReleased`): a real,
   OS-level click. A blue ripple marks the point that was clicked - it is cosmetic and
   dispatches no events.
4. **The click is repeated until the check is gone** — one click every **3 s**
   (`TRUSTED_CLICK_GAP_MS`), each one measured again, because the widget re-renders (and can
   move) after every attempt and the first click often lands while it is still loading. After
   **3** attempts the tab is also brought to the front once, so a stubborn check can be
   finished by hand, and the clicking continues — up to **30** attempts (~90 s), which is the
   same budget the run's own timeout uses (Unmask then tries the next address, ThatSthem moves
   to the next step). The moment the challenge page disappears nothing is clicked any more.

Recording a macro is therefore about **where the click goes**, not about replaying movement:
the waypoints/speed on a card are just the capture's footprint.

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
| Browser-verification / security page | trusted click after ~0.6 s, then repeated every 3 s (up to 30 attempts, tab surfaced after 3) | same trusted click loop, then the next step |
| Navigation to the next fallback | immediate | immediate |

## Amica quote: staying fast while the tab is in the background

The Amica tab is opened in the background (`chrome.tabs.create({ active: false })`), and Chrome
clamps timers in a hidden tab to **one call per second** — and to **one call a minute** once it
has been hidden for five minutes. The funnel used to be a `setInterval(…, 50)` poll, so looking
at another tab quietly turned it into a 1 Hz (later 1/min) drip. **DOM mutation callbacks are
not throttled**, so the loop is now driven by the page instead of by a timer:

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

* The **first** record shows instantly (*"Fastest Result: infolookup.site (awaiting
  secondary…)"*), the second one is appended as *Record 2 · vibegenx.com*.
* Only the **primary address** of a street-only (vibegenx) record is completed before
  streaming, with a **1.2 s budget** — the history addresses are completed on demand by
  Amica / Mercury / Unmask, which reuse the same cache.
* The parallel-lookup timeout (**20 s**) no longer throws the run away: a source that
  answers late is still streamed to the widget instead of its record silently vanishing,
  and the widget now names the source that failed
  (*"Completed (infolookup.site) - vibegenx.com failed"*).
* Identical records from both sites are still collapsed into one card with the
  *"✓ Verified Match Across Both Sites"* badge.

## Settings & Calibration: managing cursor macros

The **Settings & Calibration** panel (widget, popup and detached window share the same
layout) keeps one recording card per site — **Unmask.com** and **ThatsThem.com** — so the
recorded **Turnstile click point** (see *Turnstile / security checks* above) can be
re-captured or dropped without touching DevTools:

* Each card shows `Recorded` / `Not Recorded`, the capture time and its stats (duration,
  waypoints, average speed, first click + target element), read from
  `recorded_macro_unmask` / `recorded_macro_thatsthem`.
* **Delete** only appears when that site actually has a macro. The first click arms the
  button (*"Confirm?"*, resets after 3 s), the second click sends
  `DELETE_MOUSE_RECORDING` to the worker, which clears the per-site slot plus the shared
  `last_macro_recording` / `active_mouse_recording` keys and broadcasts
  `MOUSE_RECORDING_DELETED` so every open panel refreshes.
* Once a macro is gone the card falls back to *"No recorded movement saved."* and the
  record button (**Record Unmask** / **Record ThatsThem**, relabelled *Re-record* while a
  macro exists) captures a fresh one.
* Macros recorded before the per-site slots existed are still shown: a
  `last_macro_recording` entry is credited to the card it belongs to (`target` field).
* While a capture is running the banner turns into *"Recording on …"* and the
  **Cancel Active Recording** button (popup / window) appears.

Regression harness: `node scratch/settings_recordings_test.js`

## How to Install / Reload

1. Open **Chrome** or **Microsoft Edge** and go to `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right toggle).
3. Click the **Reload** button (circular arrow) on the extension card.
4. Navigate to any website (e.g. your CRM or dialer).
5. Click the extension toolbar icon to toggle the **Sticky Draggable Widget**.
6. Enter a phone number and click **Search** to run the parallel lookup.
