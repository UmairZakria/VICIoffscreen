# DNC & Identity Compliance Lookup (Parallel Dual-Source)

A Chrome / Microsoft Edge Manifest V3 extension with:
* **Sub-Second Instant Lookups (Persistent Warm Background Workers)**:
  - Pre-warms both `https://infolookup.site/` and `https://infolookupp.com/` in persistent background iframes.
  - Keeps sessions, scripts, and Cloudflare tokens pre-initialized in memory.
  - Does **NOT** reload the website between searches — simply enters the new number in-place and clicks search, delivering the same instant (<1s) speed as searching manually on the site.
* **White & Black Minimalist Theme**: Crisp white main background (`#ffffff`), solid black buttons (`#000000`), black text, and clean modern hairline dividers.
* **Sticky Draggable On-Page Widget**: Floats directly on top of your CRM, dialer, or any website.
  - **Sticky**: Stays fixed as you scroll.
  - **Draggable**: Drag by the header anywhere across monitors.
  - **Refresh**: the circular-arrow button at the left of the header restarts every background worker (see *Refresh: what the header button restarts* below).
  - **Remembers Position**: Restores your preferred screen location across reloads.
  - **Collapsible / Closable**: Minimize with `_` or close with `✕`. Click extension toolbar icon to toggle.
* **Parallel Dual-Source Headless Search**:
  - Source 1: `https://infolookup.site/`
  - Source 2: `https://infolookupp.com/`
  - Runs both searches simultaneously in parallel in the background without opening visible tabs.
  - **Fastest Response First**: Displays results immediately as soon as the first source finishes.
  - **One Card Per Record**: Record 1 and Record 2 always keep their own card, even when both sites return exactly the same person – nothing is merged, so the two answers can be compared and each record can be switched on or off on its own in Settings.
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
* **A record card waits for an actual answer.** All three source flows poll for up to **45 s**;
  they do not treat compliance-only values or unchanged prior results as an empty owner result.
  `infolookup.site` recognizes its `.person-name` no-result message,
  `infolookupp.com` recognizes `.cx-prompt.cx-not-found`, and `uspeoplesearch.net` recognizes
  `#cx-ie.d-row.cx-prompt` with *"Not Found"*. Those explicit states stream an empty-person result
  so the widget can show its placeholder card; while a result is still loading, polling continues.
  The background safety limit is **60 s**, and the widget waits **65 s** before timing out.

Regression harness: `node scratch/infolookupp_test.js`

## DOB Discovery (Unmask.com) — which date gets accepted
## DOB Discovery (Unmask.com) — which date gets accepted

The **DOB** button deep-researches the record's date of birth on Unmask.com. The
record's age string usually carries the birth year, e.g. `72 yrs (1954)`, and that
year is what every candidate is validated against:

* A card/profile is only used when its age is within **±3 years** of the record's age
  (`72 yrs` → accepts 1951‑1957, rejects 1958 because it is 4 years off).
* On a profile page every date is collected (born on … / DOB: … / month day, year /
  month year) and only dates within **±1 year** of the expected birth year are eligible;
  the **closest** eligible year wins — not the first date on the page — so a two-year
  mismatch or a relative's birth year can never leak into the result.
* If a profile only shows dates that contradict the record's age, the extension
  reports **no DOB** and keeps searching instead of reporting a wrong date.
* A matched profile whose summary has **no birth date at all** (e.g. Unmask shows only
  *"Cristian currently lives in Houston, TX"* plus the address) is abandoned ~0.5 s after
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
*"{name} lives at {address} born in {year} in which month ? no rough guess accurate"* for the
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

**Every step is a deadline sampled on a 150 ms tick**, never a sleep: a click the page acts on in 80 ms is
noticed on the next tick, and one it ignores is waited out on that same tick with a repeat press before
being given up on. The dials are `DELETE_RETRY_MS` (the repeat press, 300 ms, twice) and
`DELETE_WAIT_MS` (before a pressed row is declared ignored), the click ladder that opens the list
(400 ms, 800 ms, then `LIST_OPEN_MAX_MS`), and `HISTORY_SWEEP_MAX_MS` for the sweep as a whole. A box that
renders **no rows at all** is handed back after 600 ms instead of waiting `LIST_OPEN_MAX_MS` out — the
caller seeds the box next, which is what actually gets rows on screen.

On the results page the answer is read once its text has been unchanged for `ANSWER_STABLE_MS` and never
before `ANSWER_MIN_MS`. The one long fixed part of the run is the cleanup trip back to google.com:
`CLEANUP_RELOAD_DELAY_MS` per page load, `CLEANUP_MAX_RELOADS` loads and `CLEANUP_MAX_MS` in total. The
answer is already in hand while that trip runs, and a run already past `CLEANUP_GIVE_UP_AFTER_MS` reports
it immediately instead of taking the trip at all.

**The sweep never fails silently** — the progress line names the outcome, which is also how the step
is diagnosed on the live page:

| Progress line | What it means |
| --- | --- |
| *"Removed N searches from the search history."* | the Delete presses worked (N includes stale entries) |
| *"The suggestion list did not open - the search history was left as it is."* | no rows ever rendered or `aria-expanded` never flipped |
| *"The search-history entry was not removed - its Delete control ignored the click."* | the row was there and pressed, but the page did not act on it |
| *"No search-history entry for this search yet."* | nothing of ours was in the list |

**Nothing the user sees names Google.** Every progress line calls the source **AI** — the same word the
Settings panel uses for that switch — and the search-history lines name no site at all. The full name
survives only in the console trace below, which is a diagnostic, not the product.

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

### The email run (the card's **Email** button)

The same page, the same search box, the same history sweep — a different question:

    "{name} lives at {address} born in {year|Month year} any public available primary email .
     gmail hotmail yahoo icloud are prefered"

* **Started by the Email button** on a record card (beside DOB) and governed by the *same* Settings
  switch as the DOB run's Google leg (`DOB Sources → AI`): a user who turned AI Mode off means no
  Google AI calls at all, whatever they are for.
* **The birth month goes into the query when the card already has one.** `birthMonthName` reads the
  Google row first, then Unmask's, then ThatSthem's, so a month a previous search found turns the
  query's `born in 1950` into `born in February 1950` — which places the person far better. With no
  month on the card the bare year is used, exactly as the hand-written query does.
* **One Google page, one job.** The email run and the birth-month run share the one hidden runner
  frame, so starting either supersedes the other (`startGoogleEmailLookup` ↔ `startGoogleDobLookup`).
  That is also the order that makes sense, because the DOB answer is where the month comes from.
* **What is reported is what the answer stated**: the first address in the answer column *before* its
  "this household … for family/co-occupants" sentence — the one the answer itself calls primary. An
  address from the household sentence is used only when nothing primary was stated, and the row says
  `household address` when it is. The answer also has to name the record's person **in full**, so a
  relative at the same address (a Loften Dunlap against a Theresa Dunlap) can never put their address
  on that card; an answer that names nobody this run asked about reports nothing, and the run moves on.
* Addresses are drawn in the card's **Email Addresses** box, **merged** with whatever Unmask /
  ThatSthem already found rather than replacing them, and written onto the person so a re-render keeps
  them.
* Progress is tagged **EMAIL** in the card's progress box. An address the answer never names reports
  *"No public email address was named for this address."* and the **next address is asked** — the street
  addresses the record carries are all completed (city + ZIP) before the run starts, so a record whose
  addresses are street-only is asked about in full rather than through its first address alone. The run
  ends with *"AI found no public email address for any known address."*

`google_email_automation.js` is derived from `google_automation.js` by
`node scratch/build_google_email_script.js` — that script does the mechanical half (guard name, storage
key, message names); the answer reader (`collectEmails` / `extractEmail`) is edited in place and is
what the harness below covers. Re-running the generator would overwrite those edits.

Regression harness: `node scratch/google_email_extract_test.js` — the reader, against the two real
Google answers this was built from (primary vs household, namesake refusal, casing, page addresses).

### The gender run (the chip beside a person's name)

The smallest of the three AI jobs, and the only one that asks about a *person* rather than a record:

    "{name} is male or female?"

* **Started by the chip beside the name** on every person card. The button *is* the display: both
  symbols until it has been asked, then the symbol the AI named, recoloured (pink for female, blue for
  male), with the wording in its tooltip. Nothing else is added to the card for it — and the icon is not
  a new row, so the card reads the same as before.
* **One query, no address list.** A question about a name has nothing to narrow down address by
  address, so the background builds exactly one query (`buildGoogleGenderQueries`), and the run ends
  when the answer names a gender or when the answer has been read and does not.
* **The reader weighs what each sentence said** (`readGenderSentence`): a statement about the person by
  name ("Val Power is female.") outranks "uniformly identified as male", which outranks a pronoun
  ("She is based in Adelaide"), which outranks the name-style wording ("John is traditionally a male
  given name"). A verdict that only the last two support is still shown, marked `indirect wording` — a
  guess about how a name is usually given is never passed off as a statement about the person. An
  answer that names both, or neither, reports nothing at all.
* **The identity check is the name itself**, because the query gives the answer nothing else: it has to
  name at least one word of the person's name, and the first name is enough (`"John ..."` is how the
  answer writes the person it was asked about).
* Same runner, same rules as the other two: the gender run shares the one Google page, so starting any
  of the three AI jobs supersedes the others, it is governed by the same `DOB Sources → AI` switch, and
  the card's Cancel button stops it.

Regression harness: `node scratch/google_gender_extract_test.js` — the reader, against the two real
answers this was built from (the direct statement, "identified as male", the name-style sentence, a
pronoun-only answer, an answer about somebody else, and one that names both).

## The manual card (a record that named nobody, or a person it does not have)

Every record card carries a **+** at its right end, and a record that named nobody shows the same card
with fields in place of a name and an address:

| Field | What it takes |
| --- | --- |
| **name** | the person's name - as much of it as is known |
| **street** (the card's street line) | the house number and street, or nothing at all |
| **city** (the card's city line) | the city, state and ZIP - or just a ZIP, or just a city and state |

Both address lines are fields, but they are drawn as the card draws a found address: the street bold and
the city muted underneath, with no boxes. Search is the card's own mini-button, on the address title row
where a found card keeps its Copy - and the AI resolver behind it:

    "{name} lives at {street, city, state zip} what is the full address, email and dob?"  ← asked first
    "{name} lives at {street, city, state zip} whats the full address?"                   ← the fallback

The second query is only asked when the first produced nothing usable - the same "next address" walk the
DOB and email runs already use. What comes back **replaces** what the user typed: the fuller name
("Frank Peugh" → "Franklin C. Peugh"), the street, city, state and ZIP, an email when the answer states
one, and the birth date when it names one. Only then do DOB, Rides and Email have a name and a complete
address to run from.

* `applyManualAddressInput` (widget) splits the two lines into the parts a lookup needs while the user
  types - a city and a ZIP where it can find them - and keeps the pair as `addressInput`, which is what
  the AI queries are built from. Nothing is invented: a bare `75115` stays a bare ZIP until the answer
  supplies the rest.
* `extractAddressRecord` (content script) reads every shape a real answer has come back in: the labelled
  rows (`Full Address: 130 Meadowbrook Dr, Desoto, TX 75115 (located in the Mantlebrook neighborhood).`),
  the lead-in with the address on its own lines (`… zip code is:` / `2700 Orchard Park St NW` /
  `Canton, OH 44718`), and the address written into a sentence
  (`The full address for Jeffrey V. Green in Canton, OH is 2700 Orchard Park St NW, Canton, OH 44718.`).
  The asides are skipped, so *"He also previously lived nearby at 2646 Orchard Park St NW"* is never
  mistaken for the current address.
* `readAnswerBirthDate` reads the **birth date** out of the same answer, in the answer's own words:
  `1958 or early 1959` from *"given the current year is 2026, his birth year is 1958 or early 1959"*,
  `March 1958` from *"born in March 1958"*, or a stated date as it is written (`09/16/1963`). It goes onto
  the person as the **AI row of the DOB box** (`dob3`, the slot the DOB run's AI leg writes) with a note
  saying how much of a date it was - `year only` / `month/day unknown` / nothing for a whole date - so
  the year the answer gave is on the card instead of being dropped, and Email's question carries it.
  The hedge is kept on purpose: it is the AI saying how sure it is.
* The **name** is only taken when it is the person that was asked about (`samePersonName`: a shared word,
  or one word starting the other, which is how a fuller name passes). An answer about somebody else
  leaves the typed name alone and only the address is used.
* The manual card is exempt from the ZIP filter and carries no ZIP box of its own - the ZIP goes in its
  address field, which is what the AI resolver is for - and what it resolves is written onto the card's
  person, so the card is redrawn with the filled-in fields.
* The card the **+** adds goes **in front** of the people the lookup found and the card jumps to it: the
  thing just asked for is the thing on screen (1 / 7, not 7 / 7). A new ZIP filter still lands on a found
  person - the filter is about the people the lookup found, not about the card being typed into - while a
  resolver's answer stays on the card that asked for it.
* The **Email** button asks its question with the birth date where one is known - the record's own age
  ("71 yrs (1955)"), the DOB the DOB run has already put on the card ("born in September 1963"), or the
  year the resolver read out ("born in 1958") - and asks it without one where none exists. Where two rows
  disagree the one that names a month is used, so a bare year cannot displace an exact date. A card typed
  in by hand has no age at all, and the year used to be required: the Email button then answered "This
  record has no address with a city and ZIP to ask Google about" about a card whose address was sitting
  right there on it.
* A record whose lookup *failed* keeps its existing "… failed" line rather than a manual card: the
  compliance badge on that card would read "Clean", which is the one thing nobody may be told about a
  record that never answered.

Regression harness: `node scratch/google_address_extract_test.js` — the reader, against the real answers
this was built from: labelled rows, address-as-lines, an address written into a sentence, a stranger's
name, a street-only answer, the birth year with its hedge, a month-and-year, a stated date, and an answer
with nothing in it.

Regression harness: `node scratch/google_email_queries_test.js` — the Email question as it is built for
a record the lookup answered for and for a card typed in by hand (with the card's DOB, and with no
birth date anywhere at all), where the year comes from, the address split that keeps a city from being
lost to a unit number, and the two cases that really are worth asking nothing about.

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

Promotion is expensive — a real challenge should be the only thing that ever reaches the user's
screen — so the detector behind it has to be precise. It used to treat anything Cloudflare-ish as a check, including
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
| A Cloudflare / browser check appears in the hidden runner | one background lookup tab is opened on the current step and the offscreen frame is parked; the tab is activated only if it independently detects the verification page |
| The user clears the check in that tab | the caller tab is restored; the same lookup tab remains in the background and continues the search |
| Another check or fallback step occurs | the existing lookup tab is reused; no additional lookup tab is created |
| The run ends (DOB found, nothing found, error, cancel) | the caller tab is activated again; the final line stays readable for **1.5 s**, then the single lookup tab closes. The offscreen frame is parked back on `about:blank` |

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
| `· tab (no hidden runner: <reason>)` | legacy status from a run started by a previous version; new Unmask runs do not use a tab when hidden preparation fails |

That is deliberately visible rather than console-only: "why is there a tab?" is then answerable from
the widget itself. A run object rebuilt from a message has no `mode` and is left unlabelled rather
than being claimed to be hidden.

The tab id of a promoted or fallback tab is also written into the **persisted session**
(`session.dobTabId`), and a new run closes a leftover one before it starts. Without that, a
service-worker restart mid-run orphans the tab (the in-memory run is gone, so nothing closes it) and
the *next* search appears to be running in a tab that actually belongs to the previous one.

### Continuing the lookup after verification

After the user clears a challenge shown in the promoted tab, the worker restores the caller tab and
keeps the lookup tab in the background. All remaining Unmask and ThatSthem steps reuse this same
tab, so another challenge or fallback does not create a new tab. The single lookup tab closes when
the run ends.

The challenge detector recognizes the exact current shell, including
`.challenge__content-wrapper` / `.challenge__title` and the "Performing security verification"
heading, as well as older interstitial markers. Generic Cloudflare scripts and Turnstile widgets on
ordinary result pages are not sufficient to show a tab.

A later check in the same tab still gets its own handoff: the persisted `challengeCleared` flag and
each page's one-shot handback flag are reset when a new check appears.

Promotion uses the URL the **background** recorded for the step (`session.currentUrl`), not the URL
the check page reports. Cloudflare usually serves its interstitial on the same URL, but it can also
redirect to `/cdn-cgi/challenge-platform/…`; sending the user there would put them in front of a page
with nothing to solve.

Only the promoted tab may trigger the hand-back: the offscreen frame reports checks as well, and it
must never be the reason the user's view is taken away. The hand-back is reported once
(`challengeClearedSent`), and the automation can only report it **after** the challenge branch has
been left — that branch returns while a check is on screen, so a run can never claim "cleared" while
the user is still looking at the check.

If the offscreen document cannot be created, the Unmask run now **fails explicitly without opening
a browser tab**. This keeps ordinary searches truly offscreen and avoids a background fallback tab
appearing in the tab strip. The widget receives the hidden-runner error so it does not stay stuck.

The hidden-runner setup still has three safeguards:

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
* **No silent tab fallback** — if both prepare attempts fail, the exact reason is logged and the
  lookup reports an error. No tab is created unless the hidden page reports a security check.

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
  `document.readyState === "complete"` **and** a quoting ZIP field before sending
  `AMICA_RUNNER_READY { ready: true }`. This accepts both the previous
  `#zipcodeInitInputQuoting` field and the current `#zip-input-quote_hero` /
  `.zip-input__field` layout. The background stores that in `amica_runner_ready` (10-minute TTL)
  and takes the fast path only when it is there — it is never assumed.
* **The current homepage quote form is handled directly.** The automation selects **Auto + Home**
  (`PrivatePassenger|HO3`), enters the record's ZIP in `#zip-input-quote_hero`, then submits the
  button inside that same quote form. Auto-only (`PrivatePassenger`) is selected only if the
  bundled option is absent. The form controls are scoped to `.quote-hero__pulldown` so a different
  page form cannot be submitted by mistake.
* **Nothing is pre-loaded while a run is in flight.** `prewarmAmica()` returns early when
  `activeVehicleLookup` is set, so the frame is never reloaded underneath a running quote.
* **Two different teardowns, on purpose.** `finishVehicleLookup()` — the end of a run — loads the
  next Amica (`prepareNext` defaults to `true`). The start path passes
  `finishVehicleLookup({ prepareNext: false })`, because the new run is about to take that frame
  itself.
* **A warm page that does not reach a quote step is not waited on.** The initial
  *"Starting Amica vehicle automation..."* message alone does not disarm the fallback. If no
  subsequent step arrives within 4 s (`AMICA_WARM_FALLBACK_MS`), the background says so and loads
  Amica the normal way. The cold path is untouched, and it is what runs when the pre-load failed,
  the TTL expired, or the frame was replaced by a fresh offscreen document.
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

Everything that used to be repeated work happens once:

* **One click per step** — the step keeps its form filled (`fillAndTypeInput` returns
  immediately when the value is already right), but the submit fires once and is only retried
  after **1.5 s** if the page truly did not move on; a button that has not rendered yet does not
  consume the retry window. There is no blanket delay between distinct form steps; the per-step
  retry gate prevents duplicate submissions without slowing the next screen. `clickElement()` now
  sends the pointer pair and **exactly one**
  `click` — it no longer dispatches a click *and* calls `targetBtn.click()`, which ran every
  Amica handler twice and queued duplicate quote requests. It also leaves
  `disabled`/`aria-disabled` buttons alone and jumps to the target instead of smooth-scrolling.
* **The address form submits only its quote CTA.** The address step looks for
  `button.quote-flyout-panel__button[data-id="GetaQuote.aStartQuote"]` inside the street field's
  form (then the same exact CTA on the page, for Amica layouts without a wrapping form). It uses
  the button's native `.click()` activation so the site's submit behavior runs, and does not fall
  back to an arbitrary `button[type="submit"]`, which could submit the site's search form instead.
  A missing or disabled CTA does not count as a submission or start the address-response timer.
* **The current address field is a Google autocomplete widget.** Amica marks the native
  `#addressLineOneInputQuoting` as `hidden` and renders a `gmp-place-autocomplete` in its place.
  The address step is therefore detected through `#addressForm`, not the hidden input's
  visibility; it sets the autocomplete widget's value as well as the native address field before
  filling city, state and ZIP and pressing the quote CTA.
* **One progress message per state** — `background.js` broadcasts every
  `VEHICLE_LOOKUP_PROGRESS` to **every** tab, so an identical line is not repeated for **1.5 s**.
* **One wide scan per change** — the *"how would you like to enter your vehicle info"* text scan
  (`legend, p, h1…`) is reused for **250 ms**; the cheap
  `#VEHICLE_INFO_ENTRY_OPTION-fieldset` / `input[name="VEHICLE_INFO_ENTRY_OPTION"]` checks still
  answer first, and a screen that is not the vehicle-entry screen is not scanned at all.

The run is still capped at **90 s**, with a further safety timeout that stops the observer and
the timer. The address form now waits **150 ms** for input events to settle before submitting;
an invalid-address marker is acted on after **300 ms**, while the **7 s** no-response safeguard
remains unchanged.

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

## Reliability of the multi-source record list

All enabled sources are searched in parallel and each record is streamed to the widget when
its source has a stable result or an explicit no-result state:

* The first successful record streams immediately; each other enabled source is appended independently.
  Only the records switched on in Settings are searched.
* Only the **primary address** of a street-only (infolookupp) record is completed before
  streaming, with a **1.2 s budget** — the history addresses are completed on demand by
  Amica / Mercury / Unmask, which reuse the same cache.
* The parallel-lookup timeout (**60 s**) no longer throws the run away: a source that
  answers late is still streamed to the widget instead of its record silently vanishing,
  and the widget now names the record that failed
  (*"Completed (Record 1) - Record 2 failed"*).
* **Identical records are never merged.** Every record draws its own card — *"Compliance · Record 1"*
  and *"Compliance · Record 2"* — with its own compliance grid and its own person/address slides, so the
  two answers can be read side by side and each record can be switched on or off on its own. An earlier
  build collapsed a match into a single card, retagged it *"Compliance · \<site 1\> & \<site 2\>
  (Verified)"* and moved the person details between them; that path, its *"✓ Verified Match Across Both
  Sites"* status line and the record-equality helpers behind it are gone.

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

The two lookup sites are called **Record 1 / Record 2**, and vehicle discovery is the single **Rides**
action, throughout the UI: the sites and the insurance providers behind them are never named on a card,
in a progress line or in a summary. Mercury's automation (the Mercury content script, its
`mercury_pending_quote` hand-off and the `mercury` provider branch in the background) is still wired up,
it simply has no button anymore — **Rides** is the only way to start a vehicle run, and it runs on Amica.

* Each switch is a plain `<label class="setting-row"><input class="setting-toggle"
  data-setting="records.record1">…` and the panel writes **one key** — `automation_settings` — that the
  widget, the popup, the detached window *and* the background service worker all read. A switch flipped
  in one panel therefore takes effect everywhere at once (the other panels repaint from
  `chrome.storage.onChanged`).
* **Only the records that are on are searched.** Switching Record 2 off means its card never appears;
  the lookup itself carries on with Record 1, and *"this lookup is done"* waits for exactly the
  records that were asked for — one or two (`expectedSources`), never a fixed two. Because the two
  records are never merged into one card, that switch is always visible in the result: one record
  switched on means exactly one card.
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


## Brand assets: the logo and the icon set

`logo.png` (528×473, RGBA, transparent page background) is the single source of the product mark — a
blue → green shield with a white check. It is **portrait** (1.116 : 1 as exported, and the mark itself
is 381×449, i.e. 0.85 : 1), which is exactly why it cannot simply be handed to the browser as an icon:
every icon slot is square, so a non-square file gets squashed into 16×16 / 32×32 and the shield comes
out distorted.

* `icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` — the extension icon, referenced from
  `manifest.json` under **both** `icons` and `action.default_icon`, so the toolbar button, the
  extensions page (`chrome://extensions`) and the browser's extension menu all show the mark.
* `icons/icon512.png` — for store listings (Chrome Web Store / AMO uploads want a 128 and a large
  version; it is not referenced by the manifest).
* They are generated, never hand-made: **`node scratch/make_icons.js`** decodes `logo.png`, trims the
  leftover margin, re-centres the mark on a **square** canvas (aspect preserved, only 4 % breathing
  room) and box-downscales it, weighted by alpha so the transparent edge cannot darken the outline.
  `node scratch/make_icons.js 16 32 48 128 256 512` chooses sizes, `--keep-background` skips the
  background cut (there is none to cut in the shipped file — the flood fill clears *border-connected*
  white only, which is what keeps the white check inside the shield intact).
* The logo itself (not the icon set) is what the **sign-in screens** show, in place of the old black
  rounded square with a lock glyph: `popup.html` and `window.html` through the `.login-badge-icon` rule
  in `window.css`, the in-page widget's own sign-in view in `widget.js`, and the admin portal's login
  page (`dnc-portal/public/logo.png`, used in `src/app/login/page.js`). Every box stays square and the
  image is fitted with `object-fit: contain`, so the mark is never stretched.
* `logo.png` is listed in `web_accessible_resources` because the injected widget renders inside the
  **page's** DOM: without that entry the shadow root could not load it. (A page with a strict
  `img-src` policy can still refuse it, exactly as it can refuse the widget's Poppins fonts; every
  other surface is an extension page and unaffected.)


## Refresh: what the header button restarts

The circular-arrow button at the left of the widget header (where the six-dot drag grip used to be) does
a **real, whole-extension restart** — one `RESTART_EXTENSION` message, handled by `restartExtension()` in
`background.js`:

1. **Every run in flight is stopped** (`stopEveryRun()`): the phone lookup is answered and dropped
   (its 60 s safety timer cleared), the ride, DOB and Google runs are cancelled — each one hands the
   user's own tab back exactly as a normal finish does — and the warm Amica page is dropped
   (`setAmicaWarm(false)`).
2. **The pending-run storage those runs wrote** (`amica_pending_quote`, `mercury_pending_quote`,
   `unmask_pending_lookup`, `thatsthem_pending_lookup`, `google_pending_lookup`) is cleared, so a
   cancelled run cannot be picked up by the next page load.
3. **The tab is remembered** (`widget_reinject_after_reload`), then the worker replies — the reply is
   deliberately sent *before* the reload, because the reload destroys the worker that would send it.
4. **`chrome.runtime.reload()`** reloads the whole extension, front and back: the service worker is
   torn down and started again, the offscreen document and every runner frame inside it (both record
   frames, Amica, Unmask, ThatSthem, Google) are destroyed and rebuilt, the static
   `declarativeNetRequest` rules are re-registered, and the popup / detached window are closed and
   reopen fresh afterwards.
5. **Every open widget takes itself out of its page** (`EXTENSION_RELOADING`): the reload invalidates all
   of their contexts at once, and a widget with no context left is an inert box whose buttons do
   nothing — so they are removed rather than left behind.
6. **The widget comes back on the tab that asked.** The reload invalidates the widget's own context, so
   the service worker that starts up on the other side re-injects `widget.js` into the remembered tab
   (one shot, and only within 60 s of the press). `widget.js` also clears the injection flag and removes
   any leftover host element first, so the result is one live widget — never a live one stacked on a
   corpse — and the toolbar icon can still bring one back by hand if a reload ever failed to happen.

The widget receives the answer immediately, so the icon stops spinning at once and the status line
reads *"Extension restarted — this page is coming back with it…"*. Pressing it while a search is running
cancels that search: the widget bumps its own session id, so anything the cancelled run still streams in
is ignored.

Two safety nets: if the worker never answers, an **8 s watchdog** stops the spinner and points at
`chrome://extensions`; and if the page still holds a widget from an **older extension context** (an
update or a previous reload invalidated it), `chrome.runtime.sendMessage` throws and that is reported as
*"This page holds an older copy of the widget — reload the page, then press refresh again"* instead of
spinning for ever. In either case the toolbar icon still toggles/re-injects the widget.

Nothing the user configured is touched by a restart: the signed-in session, the Settings switches, the
widget position and the address cache all survive (they live in `chrome.storage.local`).

Dragging is unaffected: the **whole header is still the grab handle** (the header's other buttons are
excluded from the drag, so pressing refresh never moves the widget).


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


## Record 3 (uspeoplesearch.net)

The third record has the same shape as the other two - a site with a phone box, driven in the offscreen
runner frame, read back into a card - and it is wired through every place a record has to be named:

| Where | What it carries |
| --- | --- |
| `manifest.json` | the host permission and the `content.js` match for `uspeoplesearch.net` |
| `rules.json` | rule 8: the framing headers stripped for `\|\|uspeoplesearch.net` (without it the site refuses to be framed at all) |
| `offscreen.html` / `offscreen.js` | `frame-uspeoplesearch` and its `RUNNERS` entry (`https://www.uspeoplesearch.net/`) |
| `content.js` | `SOURCE_BY_HOST`, the dispatch branch, and the search and the two readers below |
| `background.js` | `RECORD_SOURCES`, `RECORD_KEYS` (`record3`), `recordLabel` ("Record 3"), the `records.record3` / `dnc.record3` defaults, and the worker port |
| `widget.js`, `popup.html` / `popup.js`, `window.html` / `window.js` | the label and keys, the two settings switches, and the same defaults |

**The search** is `#input` with `#submit` beside it. The page keeps the *previous* answer on screen while
the next lookup runs, and shows loading skeletons in the meantime, so nothing is read until the answer on
screen is the new one:

* `readUsPeopleDomState` reports `answered: false` while the TCPA rows are there but empty - the skeleton
  state - so a half-drawn page is never reported as a result;
* a value counts only when it carries the site's own `populated` class, so the empty skeleton rows are
  ignored whatever they hold;
* the answered text of `#tcpa` + `#cards-wrap` is stamped before the search is submitted and compared
  afterwards (`usPeopleAnswerStamp`), so a lookup slower than the wait can never report the previous
  phone's answer as this one's - the failure a stale answer causes, silently;
* an owner card with no name is a skeleton and is skipped, for the same reason; a name with no address
  is still retained rather than mistaken for an empty result;
* the page's `#cx-ie.d-row.cx-prompt` / *"Not Found"* state is returned as a completed empty-person
  result, without inventing clean compliance values.

**The compliance table** is one `.tcpa-row` per check, and each label is matched with its whitespace
removed, because "DNC National", "DNC State" and "Litigator Owner" each put half of their label in a
`<sub>` ("DNCNational"). The verdict is read from the value's own class - `alert` for a hit, `safe` for a
clear check - with the wording ("Registered") only as a fallback, and it maps onto the values the other
two records already produce:

| The site says | The card reads |
| --- | --- |
| National **and** State registered | `State & Federal DNC` |
| National only | `Federal DNC` |
| State only | `State DNC` |
| neither | `Clean` |
| `Litigator`, or the owner's `Litigator`, a hit | `Flagged` |
| `Blacklist` a hit | `Flagged` |

**The owners** are the `.cx-card`s under `#cards-wrap`: the name and age from `.cx-basic`, the addresses
from `.cx-addresses .cx-address` (the `LIVES AT` row is the one every action runs on; the `LIVED AT` rows
become the history beside it), the relatives from `.cx-related` (with `Not Present` dropped) and the birth
year from `.cx-dob`, which the card carries the way a card shows it - `84 yrs (1942)`.

Regression harness: `node scratch/uspeoplesearch_test.js` — the wiring end to end (manifest, framing
rule, runner frame, record keys and label, all three panels' switches) plus both readers driven with the
site's own markup: the both-registers answer, each single-register case, a hit on the owner's litigator
and on the blacklist, the skeleton state that has to read as "no answer yet", and owner cards with three
addresses, a PO Box row and a `Not Present` relative.

## The pop-out (the panel in its own window)

The widget's last header control is a **pop-out**: it moves the panel out of the page and into its own
window. That button replaced the old minimize control, which is gone - the panel is now either on the page
or in a window of its own, never a collapsed strip.

**The detached window *is* the panel.** `window.html` is a 780-byte page whose only content is
`<script src="widget.js">` - the same file the toolbar icon injects into a page - so there is one interface
to maintain instead of two that drift apart (which is what had happened: the old `window.html` still showed
the superseded summary layout). In that window the panel adds `window-mode`: it fills the window instead of
floating over a page, the header is no longer a drag handle, the pop-out button hides itself (already out),
and the ✕ closes the window rather than hiding a panel there is no page to hide it from.

* A content script has no access to `chrome.windows`, so the button asks the worker
  (`OPEN_DETACHED_WINDOW`) and the worker creates the window with `type: 'popup'` - a real window, not
  another tab - and answers once it is up.
* **The panel stands aside, and comes back.** It is *hidden*, not removed, and only after that answer
  (so a failure to open leaves it where it was). Closing the window shows that very panel again on the
  page it came from, holding everything it had - `chrome.windows.onRemoved` in the worker sends
  `SHOW_WIDGET` to the tab that asked. If that page has no panel left to show (it was reloaded, or the
  panel was closed from the page), a fresh one is injected, the same way the toolbar icon does it.
* Where the panel came from is kept in storage (`widget_popout_return`), because the worker can be torn
  down between the pop-out and the close; it is ignored after 12 hours, and the window id recorded with it
  means closing some *other* window cannot claim the return.
* The window reopens where it was left: `winBounds` is written by the panel as the window is moved and
  resized, and both this button and the popup's own pop-out read it. Asking twice brings the open window
  forward (`chrome.windows.update`) rather than stacking a second copy.
* **Auto mode runs the lookup where the panel is.** Auto watches the portal's dialer for a phone number,
  and only the in-page copy can see it - so that copy announces every number it detects
  (`PAGE_PHONE_DETECTED`, which the worker relays to the extension's own views) and **the copy that is on
  screen runs the lookup**: the page's own when it is showing, the window's when the page's has stood
  aside, and nothing at all when the panel is hidden from the toolbar. In the window that receiving end is
  `runDetectedPhoneLookup`, which ignores a number it has already looked up - so one detection is one
  lookup, and one credit.
* The icon is the same "leave this frame" glyph the popup's pop-out uses, so the two read as the same
  action on both surfaces.

`window.js` is now unreferenced by the interface (it was the old window's own implementation) while
`window.css` is still shared - `popup.css` re-exports it and `popup.html` links it - so only `window.js`
is a candidate for deletion.

## The sign-in screen

The widget's signed-out state **is** the sign-in screen, and it is the one screen in the widget that is
not part of the white card: a photograph (`bg.jpg`) behind a dark gradient scrim, with the form sitting on
it. The scrim is what keeps every label readable whatever the photo does behind it, and the panel runs
edge to edge inside the body's padding so the image has no white frame around it.

* `bg.jpg` is loaded through `chrome.runtime.getURL('bg.jpg')` and is therefore listed in
  `manifest.web_accessible_resources` **beside `logo.png`** - a resource that is not listed there cannot be
  loaded by a page at all, and the panel would be left with its fallback. That fallback is the gradient,
  which is the first background layer on purpose: a missing or renamed image still leaves a readable
  panel, just without the photograph.
* While signed out the header is part of the panel (`container.classList.add('signed-out')`), so the brand
  title and the four window controls switch to light ink instead of sitting in a white bar on top of a
  dark surface.
* The fields are labelled, each carries a leading icon, and the password has a reveal control: the eye
  (`#widget-auth-eye`) toggles the input's type and swaps itself for the struck-through eye, so the state
  is visible without hovering. It reads nothing and sends nothing.
* Autofill is kept from painting the fields white (`-webkit-autofill` is re-inked), because a white field
  in the middle of the panel is the one thing that would give the design away.
* **The type is stated, not inherited - and 300 has to be registered.** Headings, paragraphs, labels and
  form controls do not inherit a font from the card, which is why the first cut of this panel came out in
  the browser's default face: the panel names `Poppins` itself, and so does each of those elements inside
  it. The panel is set in the **300 (Light)** face - `Poppins-Light.ttf`, registered as
  `@font-face { font-weight: 300 }` beside the other weights, because a request for 300 with no face
  declared for it falls back to the nearest declared weight (400) and "light" comes out looking exactly
  like regular. The scale it uses: the wordmark 13px/300 tracked 0.16em and uppercased; the headline
  22px/300; the line under it 11.5px/300 on a 1.7 line-height; labels 11px/400 tracked 0.06em and
  uppercased; fields and the footer 300; the submit label 400, since a button at 300 reads as too slight;
  and the header wordmark matches the panel at 13px/300.
* **The ids are the contract.** `#widget-auth-view`, `#widget-auth-alert` (`-text`), `#widget-auth-form`,
  `#widget-auth-username`, `#widget-auth-password`, `#widget-auth-submit`, `#widget-auth-btn-text` and
  `#widget-auth-spinner` are what the sign-in code reads, so a restyle has to keep every one of them.
  `scratch/settings_toggles_test.js` asserts exactly that - along with the backdrop wiring, the manifest
  entry for it and the reveal control - which is what stops a future redesign from breaking sign-in
  silently.

## The manifest is Manifest V3 only

`manifest.json` declares `"manifest_version": 3`, and its `background` block carries **only**
`service_worker`:

    "background": {
      "service_worker": "background.js"
    },

* **Never add `"scripts"`** (or `"page"`, or `"persistent"`) beside it. Those are Manifest V2 keys, and
  Chrome refuses the *whole* background block when it sees them: the extension still loads, and then does
  nothing at all - clicking the toolbar icon does not open the widget, because the click handler lives in
  the service worker that never started. `chrome://extensions` reports it as a **warning**
  (`'background.scripts' requires manifest version of 2 or lower`), not an error, which is what let it sit
  there looking harmless.
* It is a **reload-time** failure: Chrome reads `manifest.json` when the extension is reloaded, and keeps
  using the manifest it already has until then. A key added today therefore breaks the extension on the
  *next* reload, however long ago it was added.
* `browser_specific_settings.gecko` stays: Chrome ignores it and Firefox needs the id. A Firefox build of
  this extension needs its own manifest (Firefox before 136 wants `background.scripts`), so if it is ever
  published there, build that manifest separately rather than putting the key back here.
* `node scratch/manifest_test.js` guards all of it - the MV3 shape, the absence of MV2 keys, that every
  file the manifest names really exists (a missing icon or `rules.json` refuses the load just as quietly),
  that all four Google automation scripts are listed, and that the widget's build stamp names the shipped
  version.

## How to Install / Reload

1. Open **Chrome** or **Microsoft Edge** and go to `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right toggle).
3. Click the **Reload** button (circular arrow) on the extension card.
4. Navigate to any website (e.g. your CRM or dialer).
5. Click the extension toolbar icon to toggle the **Sticky Draggable Widget**.
6. Enter a phone number and click **Search** to run the parallel lookup.
