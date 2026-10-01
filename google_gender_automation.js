// Content script for the Google AI Mode gender lookup.
//
// Runs on https://www.google.com/* - in a background tab, or in the extension's hidden offscreen
// runner. It is the third AI Mode job beside the birth-month run and the email run, started by the
// gender button on a record card (the icon next to the person's name) and asks Google AI Mode
//
//   "{name} is male or female?"
//
// once per person - a question about a name has nothing to narrow down address by address, so this run
// is a single query. What it finds is reported as GOOGLE_GENDER_RESULT and shown on the person's own
// card, next to the name the question was about.
//
// The page is opened at google.com, the query is typed into the search box and submitted with
// Enter, and the results page is then switched into AI Mode (the "AI Mode" control, which is the
// same thing as adding udm=50 to the search URL). AI Mode is the only part of Google that answers
// this question - the ordinary results page does not.
//
// The typed query is also a Google search-history entry, and Google offers that string straight
// back in the box's suggestion list - which is exactly where it can be taken out again. Before
// Enter is pressed the run opens that list, finds the row whose `data-entityname` is the query it
// typed, hovers it (the row's "Delete" control is only revealed on hover) and clicks that control,
// so the address it just asked about does not stay behind in the search history. Only an exact
// match is ever deleted.

(function () {
  "use strict";

  if (window.__googleGenderAutomationLoaded) return;
  window.__googleGenderAutomationLoaded = true;

  var STORAGE_KEY = "google_gender_pending_lookup";
  // Every wait in this file is a deadline sampled on this tick, so it is also the floor on how long
  // any one step appears to take: a gesture that the page acts on in 100 ms still waits for the next
  // tick before it is noticed. It is kept small for exactly that reason - the tick body is a handful
  // of DOM queries, and the one heavier read (the answer's `innerText`) happens on the results page
  // only, where the run is normally in a hidden renderer rather than a tab the user is watching.
  var TICK_MS = 150;

  // The typed query should leave the homepage on its own. If it has not, the results URL is opened
  // directly rather than leaving the page sitting there with a query in its box.
  var HOME_TO_SEARCH_MAX_MS = 8000;
  // How long the "AI Mode" control may take to appear on the results page.
  var AI_MODE_MAX_MS = 4000;
  // The AI answer streams in. It is read once the text has stopped changing, but never in the first
  // moment it appears - the opening sentence usually arrives before the facts do.
  var ANSWER_MIN_MS = 1000;
  var ANSWER_STABLE_MS = 900;
  var ANSWER_MAX_MS = 75000;
  // Nothing is read until the answer column actually holds a paragraph, so an empty or
  // still-rendering column can never be mistaken for an answer. The gate is short here on purpose:
  // the answer to this question is often one sentence long - "Val Power is female." is a complete
  // answer - so the length a birth-month answer needs would have thrown it away.
  var MIN_ANSWER_CHARS = 12;
  // How long the answer may take to appear at all. A page that never returns a paragraph has
  // answered this address with "nothing": the run moves on, and closes once there is no address
  // left to ask.
  var ANSWER_APPEAR_MS = 25000;
  // How long the box's suggestion list may take to open once the run asks for it.
  var LIST_OPEN_MAX_MS = 1200;
  // After the row's Delete control is clicked, the row is given this long to disappear.
  var DELETE_WAIT_MS = 1500;
  // How long to wait before the click is repeated on the inner "Delete" label, for a build that
  // only hands the click to the wrapping control.
  var DELETE_RETRY_MS = 300;
  // Where the cleanup trip goes back to. Google's own homepage is the only page with the search box
  // whose suggestion list holds the search history.
  var GOOGLE_HOME_URL = "https://www.google.com/";
  // The whole search-history sweep is bounded by these two: it removes at most this many entries and
  // never spends more than this long, so the search it is standing in front of always goes out.
  var HISTORY_MAX_DELETES = 8;
  var HISTORY_SWEEP_MAX_MS = 3000;
  // The trip back to google.com after the answer was read. Google registers the search a moment after
  // it happens, so the entry is usually NOT in the suggestion list on the first visit: the page is
  // refreshed until it shows up, it is deleted, and only then is the answer reported. The answer is in
  // hand the whole time, so this is dead time on a successful run and is kept as short as the page
  // loads themselves allow: an attempt that finds nothing costs one sweep, and eight of them still fit
  // inside the cap below.
  var CLEANUP_RELOAD_DELAY_MS = 1200;
  var CLEANUP_MAX_RELOADS = 8;
  var CLEANUP_MAX_MS = 18000;
  // Past this point in the run the answer is reported without waiting for the cleanup any more, so a
  // slow trip can never cost the run its result.
  var CLEANUP_GIVE_UP_AFTER_MS = 90000;

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    var style = window.getComputedStyle(el);
    return !!style && style.visibility !== "hidden" && style.display !== "none";
  }

  // The session this frame is running. It names the record card the run belongs to, so a page that
  // outlives its own run still reports for its own record.
  var currentSession = null;

  function sessionRecord() {
    return (currentSession && currentSession.record) || "";
  }

  // The session is what survives a page load, so anything the run has to remember across its own
  // navigation goes back into storage with it.
  function saveSession() {
    if (!currentSession) return;
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: currentSession }).catch(function () {});
    } catch (e) {}
  }

  function currentQuery(session) {
    if (!session || !session.queries) return "";
    return session.queries[session.queryIndex || 0] || "";
  }

  function sendProgress(step, total, message) {
    try {
      chrome.runtime.sendMessage({
        action: "GOOGLE_GENDER_PROGRESS",
        step: step,
        totalSteps: total,
        message: message,
        record: sessionRecord()
      });
    } catch (e) {}
  }

  function sendResult(found, query) {
    try {
      chrome.runtime.sendMessage({
        action: "GOOGLE_GENDER_RESULT",
        gender: found.gender,
        note: found.note || "",
        source: "google.ai",
        query: query,
        record: sessionRecord()
      });
    } catch (e) {}
  }

  // Whether this frame is one the extension itself put on the page.
  //
  // A top-level tab is always fine. A subframe has to be confirmed by the background, because there
  // is no reliable way to tell from inside the frame who its parent is: `parent.location` throws
  // across origins, and `document.referrer` is empty for an extension parent - which is exactly
  // what makes the offscreen runner look like a frame with no parent at all.
  function confirmRunnerIsOurs(callback) {
    if (window.parent === window) {
      callback(true);
      return;
    }
    try {
      chrome.runtime.sendMessage({ action: "RUNNER_HELLO" }, function (res) {
        if (chrome.runtime.lastError) {
          callback(false);
          return;
        }
        callback(!!(res && res.ok));
      });
    } catch (e) {
      callback(false);
    }
  }

  // ------------------------------------------------------------------------------ the search box

  function isHomePage() {
    var path = String(window.location.pathname || "");
    return path === "/" || path === "/webhp" || path === "/index.html";
  }

  function findSearchInput() {
    return (
      document.querySelector('textarea[name="q"]') ||
      document.querySelector('input[name="q"]') ||
      document.querySelector("textarea.gLFyf") ||
      document.querySelector("#APjFqb") ||
      document.querySelector('textarea[role="combobox"]')
    );
  }

  // Framework-backed inputs ignore a plain `el.value = ...`, because the value is tracked by the
  // framework rather than by the DOM: the native setter is used and the events it listens for are
  // fired afterwards.
  function setNativeValue(el, value) {
    try {
      var proto =
        el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && setter.set) {
        setter.set.call(el, value);
        return;
      }
    } catch (e) {}
    el.value = value;
  }

  function typeQuery(query) {
    var input = findSearchInput();
    if (!input) return false;

    try {
      input.focus();
      input.click();
    } catch (e) {}

    setNativeValue(input, query);
    try {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) {}

    traceHistory("typed into the box: " + query);

    return true;
  }

  function pressEnter(input) {
    try {
      var opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      input.dispatchEvent(new KeyboardEvent("keydown", opts));
      input.dispatchEvent(new KeyboardEvent("keypress", opts));
      input.dispatchEvent(new KeyboardEvent("keyup", opts));
      return true;
    } catch (e) {
      return false;
    }
  }

  // The box is handed back to the run right before Enter.
  //
  // Opening the suggestion list made Google the owner of the box: an item can sit selected in it
  // (`aria-activedescendant`, `aria-expanded="true"`), and Enter would then submit *that* item
  // instead of the query the run typed. Escape closes the list and the typed query is written
  // again, so the only thing Enter can submit is the query this run is asking about.
  function armQuery(query) {
    var input = findSearchInput();
    if (!input) return;

    traceHistory("re-arming the box before Enter (Escape, then the query written back)");

    try {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true
        })
      );
    } catch (e) {}

    if (String(input.value == null ? "" : input.value) === query) return;

    setNativeValue(input, query);
    try {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) {}
  }

  // Google submits its own form from an Enter handler on the form. If that did not happen the form
  // is submitted here, so the page is never left holding a typed query and doing nothing.
  function submitSearchForm() {
    var form = document.querySelector('form[action*="/search"]') || document.querySelector("form");
    if (form && typeof form.submit === "function") {
      try {
        form.submit();
        return true;
      } catch (e) {}
    }
    return false;
  }

  // The URL that opens the query directly in AI Mode. Used when the typed query did not leave the
  // homepage, when the "AI Mode" control was not found, and for every address after the first.
  function aiResultsUrl(query) {
    return "https://www.google.com/search?q=" + encodeURIComponent(query) + "&udm=50";
  }

  function goToAiResults(query) {
    try {
      window.location.href = aiResultsUrl(query);
    } catch (e) {}
  }

  // ------------------------------------------------------------------------------------ AI Mode

  function aiModeActive() {
    if (/[?&]udm=50(&|$|#)/.test(String(window.location.search || ""))) return true;
    // Only the AI Mode answer column, matched on both of its attributes: an ordinary results page
    // must not look like AI Mode, or the "AI Mode" switch would never be clicked.
    return !!document.querySelector('div.mZJni[data-container-id="main-col"]');
  }

  // The control that switches the results page into AI Mode: a link carrying udm=50 in its target,
  // or failing that whatever element is labelled "AI Mode".
  function findAiModeControl() {
    var links = document.querySelectorAll('a[href*="udm=50"]');
    for (var i = 0; i < links.length; i++) {
      if (isVisible(links[i])) return links[i];
    }

    var labels = document.querySelectorAll("span, div");
    for (var j = 0; j < labels.length; j++) {
      var el = labels[j];
      if (el.children && el.children.length) continue;
      if (String(el.textContent || "").trim() !== "AI Mode") continue;
      var host = el.closest('a, button, [role="button"]');
      if (host && isVisible(host)) return host;
    }
    return null;
  }

  function clickElement(el) {
    try {
      el.click();
      return true;
    } catch (e) {
      return false;
    }
  }

  // The text of the AI answer - the AI Mode answer column and nothing else.
  //
  // Reading the whole page was the bug behind the run ending the moment the results page painted:
  // that page also carries the query echo, the ordinary result list and cited records, and a date in
  // any of them ("Age 88 (Mar 1938)") was being read as an answer. The column holds the answer and
  // nothing else, so a date found in it is a date the AI actually stated.
  function answerText() {
    var main =
      document.querySelector('div.mZJni[data-container-id="main-col"]') ||
      document.querySelector('div[data-container-id="main-col"]');

    if (!main) return "";
    return String(main.innerText || "").trim();
  }

  // The answer column is shared with the control strip under the answer ("Copy", "Share", …), which
  // carries no dates, so no filtering is needed beyond the length gate the caller applies.
  function answerIsPresent(text) {
    return !!text && text.length >= MIN_ANSWER_CHARS;
  }

  // -------------------------------------------------------------------------- reading the answer

  // The gender the answer states for the person.
  //
  // The answer is short and its wording varies, but the person and the word always sit together:
  //
  //   "Val Power is female."
  //   "John is traditionally a male given name. ... are uniformly identified as male."
  //
  // So it is read sentence by sentence, and each sentence is weighted by what it actually said. A
  // statement about the person by name outranks "identified as male", which outranks a pronoun (she,
  // he), which outranks the name-style wording ("a male given name") - that last one describes the
  // *name* rather than the person, so it is only trusted when nothing better was stated, and the card
  // is told as much.
  var MALE_GENDER_RE = /\b(?:male|man|men|boy|gentleman)\b/i;
  var FEMALE_GENDER_RE = /\b(?:female|woman|women|girl|lady)\b/i;
  // The sentence is explaining the name, not the person: "John is traditionally a male given name".
  var STATED_ABOUT_NAME_RE = /\b(?:given name|first name|forename|masculine name|feminine name)\b/i;
  var IDENTIFIED_AS_RE =
    /\b(?:identified|recorded|listed|registered|documented|described|reported|stated|categorised|categorized|classed)\s+as\s+(?:a\s+|an\s+)?(?:male|female|man|woman|boy|girl|lady|gentleman)\b/i;
  var IS_GENDER_RE = /\bis\b[^.!?]{0,40}?\b(?:male|female|man|woman|boy|girl|lady|gentleman)\b/i;
  var GENDER_PRONOUN_RE = /\b(?:he|she|his|her|him|hers)\b/i;

  // What one sentence says, and how much it is worth. The value comes from a gender word where there
  // is one; with no gender word at all, a pronoun can still carry it ("She is based in Adelaide"), and
  // that is worth less than anything stated outright. A sentence that names both genders ("a male name
  // also given to women") says nothing usable, so it is dropped rather than guessed at.
  function readGenderSentence(sentence, nameTokens) {
    var maleWord = MALE_GENDER_RE.test(sentence);
    var femaleWord = FEMALE_GENDER_RE.test(sentence);
    if (maleWord && femaleWord) return { value: "", score: 0 };
    if (!maleWord && !femaleWord) return readPronounSentence(sentence);

    var value = maleWord ? "Male" : "Female";
    var mentionsName = nameTokens.some(function (token) {
      return sentence.indexOf(token) >= 0;
    });

    if (STATED_ABOUT_NAME_RE.test(sentence)) return { value: value, score: 2 };
    if (IDENTIFIED_AS_RE.test(sentence)) return { value: value, score: 4 };
    if (mentionsName && IS_GENDER_RE.test(sentence)) return { value: value, score: 5 };
    if (IS_GENDER_RE.test(sentence)) return { value: value, score: 3 };
    if (GENDER_PRONOUN_RE.test(sentence)) return { value: value, score: mentionsName ? 3 : 2 };
    return { value: value, score: 1 };
  }

  // A sentence with no gender word in it, where only a pronoun can say which way it goes.
  function readPronounSentence(sentence) {
    var male = /\b(?:he|him|his)\b/i.test(sentence);
    var female = /\b(?:she|her|hers)\b/i.test(sentence);
    if (male === female) return { value: "", score: 0 };
    return { value: male ? "Male" : "Female", score: 2 };
  }

  // The gender this run reports: the two sides are added up sentence by sentence and the larger one
  // wins. Nothing at all, or a tie, is reported as nothing - an answer that contradicts itself is not
  // something to put on a card.
  //
  // `expectedName` is the identity check. The query gives the answer nothing else to go on - no
  // address, no birth year - so the answer naming a word of the person's name is the whole of it: the
  // first name alone is enough ("John ..."), because that is how the answer writes the person it was
  // asked about.
  function extractGender(text, expectedName) {
    if (!text) return null;

    var lower = String(text).toLowerCase().replace(/\s+/g, " ");
    var name = String(expectedName || "").trim().toLowerCase().replace(/\s+/g, " ");
    var tokens = name.split(" ").filter(function (token) {
      return token.length > 1;
    });
    if (!tokens.length) return null;

    var namesThePerson = tokens.some(function (token) {
      return lower.indexOf(token) >= 0;
    });
    if (!namesThePerson) return null;

    var totals = { Male: 0, Female: 0 };
    var best = 0;
    var sentences = lower.split(/[.!?\n]+/);

    for (var i = 0; i < sentences.length; i++) {
      var read = readGenderSentence(sentences[i], tokens);
      if (!read.value || !read.score) continue;
      totals[read.value] += read.score;
      if (read.score > best) best = read.score;
    }

    if (totals.Male === totals.Female) return null;
    var gender = totals.Male > totals.Female ? "Male" : "Female";

    return {
      gender: gender,
      // A verdict that no sentence stated outright - only the name-style wording ("a male given name")
      // or a pronoun supports it - is still shown; it just says so, rather than passing a guess off as
      // a statement about the person.
      note: best >= 4 ? "" : "indirect wording",
      score: totals[gender]
    };
  }
  // ------------------------------------------------------------- removing the search-history entry
  //
  // Google remembers the query the run typed and offers that string straight back in the box's
  // suggestion list. The list is a `ul` of `li[data-attrid="AutocompletePrediction"]` rows (`.sbct`),
  // each carrying the string it stands for in `data-entityname`, and each holding a "Delete" control
  // that takes the entry back out of the search history:
  //
  //   <li class="sbct" data-attrid="AutocompletePrediction" data-entityname="<the query>">
  //     …
  //     <div class="AQZ9Vd" role="button" aria-label="Delete <the query> from search history"
  //          jsaction="click:.CLIENT;contextmenu:.CLIENT">
  //       <div class="sbai JCHpcb" role="presentation">Delete</div>
  //
  // That control is `visibility:hidden` until its row is hovered (Google's CSS reveals it under
  // `.sbhl`), and the list itself only opens on a second click in the box or on Ctrl+ArrowDown.
  // Both are reproduced here, and the click is dispatched as the pointer/mouse sequence Google's
  // `jsaction` handlers listen for.

  function suggestionBox() {
    return (
      document.querySelector('textarea[name="q"][role="combobox"]') ||
      document.querySelector("textarea.gLFyf") ||
      findSearchInput()
    );
  }

  // Google sets `aria-expanded="true"` on the box while the suggestion list is showing, but the rows
  // themselves are the stronger signal: a build that keeps the attribute on a wrapper element would
  // otherwise leave the cleanup doing nothing at all. Either one counts.
  function visibleSuggestionRows() {
    return findSuggestionRows().filter(function (row) {
      try {
        var rect = row.getBoundingClientRect();
        return !!(rect && rect.height > 2 && rect.width > 2);
      } catch (e) {
        return true; // an unknown layout is treated as visible rather than skipping the cleanup
      }
    });
  }

  function suggestionListOpen(input) {
    if (visibleSuggestionRows().length > 0) return true;
    if (!input || !input.getAttribute) return false;
    if (String(input.getAttribute("aria-expanded") || "") !== "true") return false;
    return findSuggestionRows().length > 0;
  }

  function findSuggestionRows() {
    return Array.prototype.slice.call(
      document.querySelectorAll(
        'li[data-attrid="AutocompletePrediction"], ul[role="listbox"] li[role="option"], li.sbct'
      )
    );
  }

  // Two strings that mean the same search: case and runs of whitespace are Google's business, not
  // ours. Nothing else is normalized - "starts with" is not the same search.
  function sameText(a, b) {
    var left = String(a == null ? "" : a).replace(/\s+/g, " ").trim().toLowerCase();
    var right = String(b == null ? "" : b).replace(/\s+/g, " ").trim().toLowerCase();
    return !!left && left === right;
  }

  // The exact shape of the queries this extension types - this run's own, and the other two AI runs'
  // (which are swept up as well, because all three are ours and a sweep that only knew its own would
  // leave the others' entries behind):
  //
  //   "{name} is male or female?"
  //   "{name} lives at {address} born in {year|Month year} any public available primary email .
  //    gmail hotmail yahoo icloud are prefered"
  //   "{name} lives at {address} born in {year} in which month ? no rough guess accurate"
  //
  // It is anchored at the end on purpose: a row that merely *mentions* those words (a user's own
  // longer search, or a variant of one) is not one of ours and is left alone. Nothing a person types
  // by hand ends like this, so a row that matches can only have come from an earlier run - which is
  // why those stale entries are swept up as well.
  var OWN_QUERY_RE =
    /(?:\blives? at\b[\s\S]{0,200}\bborn in\b[\s\S]{0,200}(?:no rough guess accurate|are prefered)|\bis\s+male\s+or\s+female\b[^?]{0,4}\?)\s*$/i;

  function isOwnQueryText(text) {
    return !!text && OWN_QUERY_RE.test(text);
  }

  // The string a suggestion stands for: `data-entityname` is Google's own copy of it, the option
  // label is the fallback for a build that does not set that attribute.
  function suggestionText(row) {
    if (!row) return "";
    var entity = row.getAttribute ? row.getAttribute("data-entityname") : "";
    if (entity) return String(entity).replace(/\s+/g, " ").trim();
    var option = row.querySelector ? row.querySelector('[role="option"][aria-label], .lnnVSe, .gV2Mfd') : null;
    var label = option ? option.getAttribute("aria-label") || option.textContent : "";
    return String(label || row.textContent || "").replace(/\s+/g, " ").trim();
  }

  // The row for exactly this query - never a row that merely contains the same words, because a
  // history entry that is not this run's own query is somebody else's search.
  function findSuggestionRow(query) {
    var want = String(query == null ? "" : query).replace(/\s+/g, " ").trim();
    if (!want) return null;

    var rows = findSuggestionRows();
    for (var i = 0; i < rows.length; i++) {
      if (sameText(suggestionText(rows[i]), want)) return rows[i];
    }
    return null;
  }

  // The row that stands for this exact string, after a deletion was clicked on it.
  function findRowByText(text) {
    if (!text) return null;
    var rows = findSuggestionRows();
    for (var i = 0; i < rows.length; i++) {
      if (sameText(suggestionText(rows[i]), text)) return rows[i];
    }
    return null;
  }

  // A row that *begins* with the run's own query (its first 60 characters). Google can normalize or
  // trim the string it stores, and the same person's other address produces another such row - both
  // are this extension's searches, so both are fair game. Shorter prefixes are not used: they would
  // start matching a user's own searches.
  function findRowByPrefix(query) {
    var prefix = String(query == null ? "" : query).replace(/\s+/g, " ").trim().slice(0, 60).toLowerCase();
    if (prefix.length < 20) return null;

    var rows = findSuggestionRows();
    for (var i = 0; i < rows.length; i++) {
      var text = String(suggestionText(rows[i])).toLowerCase();
      if (text.indexOf(prefix) === 0) return rows[i];
    }
    return null;
  }

  // The row's "Delete" control: by its label, then by the wrapper Google puts the jsaction on, then
  // by the hidden "Delete" word inside it. It does not have to be *visible* to be clicked - being
  // visibility:hidden is only what keeps it out of sight until the row is hovered.
  function findSuggestionDelete(row) {
    if (!row || !row.querySelector) return null;
    return (
      row.querySelector('[role="button"][aria-label^="Delete"]') ||
      row.querySelector(".AQZ9Vd") ||
      row.querySelector(".sbai")
    );
  }

  // Hover a row the way a mouse would: Google's own `mouseover` handler (the row carries
  // `mouseover:.CLIENT`) reveals the Delete control, and the class its CSS keys on (`.sbhl`) is set
  // as well, so a build that reveals the control purely in CSS cannot hold the click up.
  function hoverSuggestionRow(row) {
    if (!row) return;

    // Watchable when the run is visible: the row is scrolled into view and outlined, then Google's own
    // hover handler is told the row is hovered and the class its CSS keys on (`.sbhl`) is set as well,
    // so a build that reveals the control purely in CSS cannot hold the click up.
    try {
      if (row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
    } catch (e) {}
    markRowForTheEye(row);

    try {
      row.classList.add("sbhl");
      if (row.parentElement && row.parentElement.classList) row.parentElement.classList.add("sbhl");
    } catch (e) {}

    ["mouseover", "mouseenter", "mousemove"].forEach(function (type) {
      try {
        row.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch (e) {}
    });
  }

  // What a real pointer/mouse event carries: the primary mouse pointer, the left button, one click
  // in the detail count, and the element's own centre as the coordinates. A handler that reads any
  // of those would otherwise see zeros.
  function controlEventInit(el) {
    var init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: 1,
      detail: 1,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true
    };

    try {
      var rect = el.getBoundingClientRect();
      init.clientX = Math.round(rect.left + rect.width / 2);
      init.clientY = Math.round(rect.top + rect.height / 2);
      init.screenX = init.clientX;
      init.screenY = init.clientY;
    } catch (e) {}

    return init;
  }

  // A click Google's own handlers will see: the pointer/mouse sequence its `jsaction` listens for,
  // then the plain click as a last resort.
  function pressControl(el) {
    if (!el) return false;

    var pressed = false;
    [
      ["mouseover", "MouseEvent"],
      ["pointerover", "PointerEvent"],
      ["pointerdown", "PointerEvent"],
      ["mousedown", "MouseEvent"],
      ["pointerup", "PointerEvent"],
      ["mouseup", "MouseEvent"],
      ["click", "MouseEvent"]
    ].forEach(function (pair) {
      var Ctor = window[pair[1]] || window.MouseEvent;
      try {
        el.dispatchEvent(new Ctor(pair[0], controlEventInit(el)));
        pressed = true;
      } catch (e) {}
    });

    try {
      if (typeof el.click === "function") {
        el.click();
        pressed = true;
      }
    } catch (e) {}

    return pressed;
  }

  // The whole search-history step narrates itself, in the tab's own console (F12 on the Google tab when
  // GOOGLE_VISIBLE is on). The widget's progress line carries the outcome; this carries the detail -
  // which gesture opened the list, every row that was on screen and whether it is one of ours, the row
  // that was picked, and what happened to the press.
  var HISTORY_TRACE = true;

  function traceHistory(message, data) {
    if (!HISTORY_TRACE) return;
    try {
      if (data === undefined) console.log("[Google history] " + message);
      else console.log("[Google history] " + message, data);
    } catch (e) {}
  }

  // Every row that is on screen, with whether this extension owns it - the fastest way to see why a
  // row was or was not picked.
  function traceRows(query) {
    if (!HISTORY_TRACE) return;

    var rows = findSuggestionRows();
    traceHistory("rows on screen: " + rows.length);
    for (var i = 0; i < rows.length && i < 12; i++) {
      var text = suggestionText(rows[i]);
      var mark = "not ours";
      if (sameText(text, query)) mark = "OURS - the exact query";
      else if (findRowByPrefix(query) === rows[i]) mark = "OURS - same opening as the query";
      else if (isOwnQueryText(text)) mark = "OURS - the extension's query shape";
      traceHistory("  " + (i + 1) + ". " + text + "   -> " + mark);
    }
  }

  // A short, visible outline on the row the sweep is working on, so a run watched in a real tab shows
  // which row is being removed. Cosmetic, and it takes itself off again.
  function markRowForTheEye(row) {
    if (!HISTORY_TRACE || !row || !row.style) return;
    try {
      row.style.outline = "2px solid #ff3b30";
      row.style.outlineOffset = "-2px";
      row.style.backgroundColor = "rgba(255, 59, 48, 0.12)";
      setTimeout(function () {
        try {
          row.style.outline = "";
          row.style.outlineOffset = "";
          row.style.backgroundColor = "";
        } catch (e) {}
      }, 2500);
    } catch (e) {}
  }

  // Press the row's Delete control the way a mouse does: the innermost "Delete" label is what the
  // cursor sits on, and the events bubble up to the wrapper that carries the jsaction. Both are
  // pressed, because a build can bind the action to either one.
  function pressSuggestionDelete(row, control) {
    if (!control) return false;

    var label = null;
    try {
      label = row && row.querySelector ? row.querySelector(".sbai") : null;
    } catch (e) {}

    var pressed = false;
    if (label && label !== control) pressed = pressControl(label) || pressed;
    return pressControl(control) || pressed;
  }

  // The box is what wants to be clicked: a click in it (or a plain focus) is what flips
  // `aria-expanded="true"` and makes the `ul` of suggestions render. Ctrl+ArrowDown is only the
  // fallback - on the live page the list often does not come up from the keystroke alone.
  function clickIntoBox(input) {
    if (!input) return;
    try {
      input.focus();
    } catch (e) {}
    pressControl(input);
  }

  // Ctrl+ArrowDown is Google's other "show me the suggestions" gesture. Whether either worked is read
  // back from the rendered rows / `aria-expanded`.
  function openSuggestionList(input) {
    if (!input) return;
    try {
      input.focus();
    } catch (e) {}
    try {
      var opts = {
        key: "ArrowDown",
        code: "ArrowDown",
        keyCode: 40,
        which: 40,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      };
      input.dispatchEvent(new KeyboardEvent("keydown", opts));
      input.dispatchEvent(new KeyboardEvent("keyup", opts));
    } catch (e) {}
  }

  // The searches this extension created, taken out of Google's suggestion list.
  //
  // Runs on the tick, never on a sleep. Returns true while the list is still being worked on - the
  // caller must not submit yet - and false once it is finished, whether entries were deleted, there
  // was nothing of ours in the list, or the box never opened it.
  //
  // It removes the run's own query AND every stale entry an earlier run left behind. The query shape
  // is the extension's own (`... lives at ... born in ... in which month ...`), so those rows can only
  // be ours - which is what keeps the list from growing by one entry per run. Everything is bounded:
  // HISTORY_MAX_DELETES rows and HISTORY_SWEEP_MAX_MS in total, so a box that never opens its list
  // costs LIST_OPEN_MAX_MS and nothing more, and the search it stands in front of always goes out.
  function deleteHistoryEntry(state, query, input) {
    if (!input) return false;

    if (!state.historyStep) {
      state.historyStep = "open";
      state.historyStartedAt = Date.now();
      state.historyOpenedAt = Date.now();
      state.historyDeleted = 0;
      state.historySkipped = 0;
      state.historyTried = [];
      traceHistory("--- search-history step: clicking into the box for its suggestion list");
      clickIntoBox(input);
      state.historyClickedAt = Date.now(); // click #1 is done; the repeat waits for the branch below
      return true;
    }

    var elapsed = Date.now() - state.historyStartedAt;

    if (state.historyStep === "open") {
      if (suggestionListOpen(input)) {
        traceHistory("the list is open (after " + (Date.now() - state.historyOpenedAt) + " ms)");
        traceRows(query);
        state.historyStep = "pick";
        return true;
      }

      var waitedOpen = Date.now() - state.historyOpenedAt;
      // The box has to be clicked: that (or a plain focus) is what renders the list. While it has not
      // come up, the click is repeated and Ctrl+ArrowDown is tried with it - exactly the two gestures
      // the box wants.
      if (!state.historyClickedAt) {
        state.historyClickedAt = Date.now();
        traceHistory("clicking into the box to open the suggestion list");
        clickIntoBox(input);
        return true;
      }
      if (waitedOpen > 400 && !state.historyKeyedAt) {
        state.historyKeyedAt = Date.now();
        traceHistory("list not open yet - clicking again and sending Ctrl+ArrowDown");
        clickIntoBox(input);
        openSuggestionList(input);
        return true;
      }
      if (waitedOpen > 800 && !state.historyClickedAgainAt) {
        state.historyClickedAgainAt = Date.now();
        traceHistory("list still not open - clicking into the box once more");
        clickIntoBox(input);
        return true;
      }

      // A box that has rendered no rows at all after both clicks and Ctrl+ArrowDown is not about to
      // render one, so it is handed back instead of waiting out the whole LIST_OPEN_MAX_MS. This is the
      // common case on the cleanup trip's page loads (the entry Google has not registered yet, and a
      // box with nothing to suggest), where the caller's next move - typing the query's opening to give
      // Google something to suggest - is what actually gets rows on screen. It costs the wait, never
      // the deletion: the caller sweeps again if rows do turn up.
      if (waitedOpen > 600 && !findSuggestionRows().length) {
        traceHistory("no rows at all after " + Math.round(waitedOpen) + " ms - leaving the box to the caller");
        return finishHistorySweep(state, elapsed);
      }

      if (waitedOpen > LIST_OPEN_MAX_MS) {
        state.historyStep = "done";
        traceHistory("GIVING UP: no suggestion rows ever rendered");
        sendProgress(1, 3, "The suggestion list did not open - the search history was left as it is.");
        return false;
      }
      return true;
    }

    if (state.historyStep === "pick") {
      var row = nextOwnRow(query, state);
      if (!row) return finishHistorySweep(state, elapsed);

      hoverSuggestionRow(row);
      var control = findSuggestionDelete(row);
      if (!control) {
        // A row of ours with no Delete control: Google does not offer one for every suggestion.
        traceHistory("row has no Delete control - left alone: " + suggestionText(row));
        state.historySkipped++;
        markRowTried(state, row);
        return true;
      }

      state.historyRowText = suggestionText(row);
      state.historyPressedAt = Date.now();
      state.historyRetries = 0;
      state.historyStep = "confirm";
      traceHistory("pressing Delete on: " + state.historyRowText);
      pressSuggestionDelete(row, control);
      return true;
    }

    if (state.historyStep === "confirm") {
      if (!findRowByText(state.historyRowText)) {
        state.historyDeleted++; // it is out of the search history
        traceHistory("row is gone - removed (" + state.historyDeleted + " so far)");
        if (historySweepFinished(state, elapsed)) return finishHistorySweep(state, elapsed);
        state.historyStep = "pick";
        return true;
      }

      var waited = Date.now() - state.historyPressedAt;
      // The click is repeated a couple of times - first on the hidden label, then on the row itself -
      // before it is accepted that Google is not going to act on it.
      if (state.historyRetries < 2 && waited > DELETE_RETRY_MS * (state.historyRetries + 1)) {
        state.historyRetries++;
        traceHistory("row is still there after " + waited + " ms - pressing again (try " + (state.historyRetries + 1) + ")");
        var again = findRowByText(state.historyRowText);
        if (again) pressSuggestionDelete(again, findSuggestionDelete(again) || again);
        return true;
      }

      if (waited > DELETE_WAIT_MS) {
        // The click was ignored. The row is left alone rather than hammered, and the run says so.
        traceHistory("PRESS IGNORED by the page: " + state.historyRowText);
        state.historySkipped++;
        markRowTried(state, state.historyRowText);
        if (historySweepFinished(state, elapsed)) return finishHistorySweep(state, elapsed);
        state.historyStep = "pick";
        return true;
      }
      return true;
    }

    return false;
  }

  // The rows already tried in this sweep. Google re-renders the list after every deletion, so the
  // next row is always looked up again - never carried over from the previous one.
  function markRowTried(state, rowOrText) {
    var text = typeof rowOrText === "string" ? rowOrText : suggestionText(rowOrText);
    if (!text) return;
    if (!state.historyTried) state.historyTried = [];
    if (state.historyTried.indexOf(text) < 0) state.historyTried.push(text);
  }

  // The next row this extension owns: the run's own query first (exactly, then by its opening), then
  // any entry an earlier run left behind. Rows already tried in this sweep are skipped.
  function nextOwnRow(query, state) {
    var tried = state.historyTried || [];

    var exact = findSuggestionRow(query);
    if (exact && tried.indexOf(suggestionText(exact)) < 0) return exact;

    var byPrefix = findRowByPrefix(query);
    if (byPrefix && tried.indexOf(suggestionText(byPrefix)) < 0) return byPrefix;

    var rows = findSuggestionRows();
    for (var i = 0; i < rows.length; i++) {
      var text = suggestionText(rows[i]);
      if (!text || tried.indexOf(text) >= 0) continue;
      if (isOwnQueryText(text)) return rows[i];
    }
    return null;
  }

  // Is the sweep out of rows, out of deletions or out of time?
  function historySweepFinished(state, elapsed) {
    if ((state.historyDeleted || 0) >= HISTORY_MAX_DELETES) return true;
    if (elapsed > HISTORY_SWEEP_MAX_MS) return true;
    return !nextOwnRow("", state);
  }

  // Ends the sweep and reports what it did - on the progress line, because a cleanup that silently
  // does nothing is exactly what made the first attempt at this look like it had never run.
  function finishHistorySweep(state, elapsed) {
    var removed = state.historyDeleted || 0;
    if (removed > 0) {
      sendProgress(
        1,
        3,
        "Removed " + removed + (removed === 1 ? " search" : " searches") + " from the search history."
      );
    } else if ((state.historySkipped || 0) > 0) {
      sendProgress(1, 3, "The search-history entry was not removed - its Delete control ignored the click.");
    } else {
      sendProgress(1, 3, "No search-history entry for this search yet.");
    }

    try {
      console.log("");
    } catch (e) {}

    traceHistory(
      "sweep finished: " +
        removed +
        " removed, " +
        (state.historySkipped || 0) +
        " left alone, " +
        Math.round(elapsed) +
        " ms"
    );

    state.historyStep = "done";
    return false;
  }

  // ---------------------------------------------------------------------------------- the run

  // This question did not produce an answer. The background owns the run, so it is
  // asked for the next one; when there is none left it reports the empty result itself.
  function requestNextAddress(state, reason) {
    state.reported = true;
    if (state.interval) clearInterval(state.interval);
    sendProgress(2, 3, reason);
    try {
      chrome.runtime.sendMessage(
        { action: "GOOGLE_GENDER_NEXT_ADDRESS", record: sessionRecord(), reason: reason },
        function (res) {
          if (chrome.runtime.lastError) return;
          if (!res || res.exhausted || !res.nextQuery) return;
          goToAiResults(res.nextQuery);
        }
      );
    } catch (e) {}
  }

  function succeed(state, found, query) {
    state.reported = true;
    if (state.interval) clearInterval(state.interval);
    sendResult(found, query);
  }

  // The answer is in hand, but the search that produced it is now in Google's history - and Google
  // registers a search a moment *after* it happens, so the entry is usually not in the suggestion list
  // yet. The answer is therefore held, the run goes back to google.com, and the page is refreshed until
  // the entry shows up, deleted, and only then is the answer reported.
  function startHistoryCleanupTrip(found, query) {
    var sweep = {
      pending: true,
      query: query || "",
      reloads: 0,
      startedAt: Date.now(),
      result: {
        gender: found.gender,
        note: found.note || ""
      }
    };

    if (!currentSession) {
      sendResult(found, query);
      return;
    }

    currentSession.historySweep = sweep;
    saveSession();

    traceHistory("answer in hand - going back to google.com to delete its search from history first");
    sendProgress(3, 3, "Answer found - removing this search from the search history...");

    try {
      window.location.href = GOOGLE_HOME_URL;
    } catch (e) {
      // Cannot navigate: report the answer rather than lose it.
      finishHistoryCleanupTrip(sweep, found, query);
    }
  }

  // Reports the held answer and closes the cleanup trip. Called at the end of the trip and on every
  // give-up path, so the answer is never swallowed by a cleanup that did not work out.
  function finishHistoryCleanupTrip(sweep, found, query) {
    var answer = found || (sweep && sweep.result) || null;
    var asked = query || (sweep && sweep.query) || "";

    if (currentSession && currentSession.historySweep) {
      currentSession.historySweep.pending = false;
      saveSession();
    }

    if (answer) sendResult(answer, asked);
  }

  // The state a sweep runs on. Shared by the search trip (which also does everything else) and by the
  // cleanup trip, which only sweeps.
  function newHistoryState() {
    return {
      historyStep: "",
      historyStartedAt: 0,
      historyOpenedAt: 0,
      historyKeyedAt: 0,
      historyClickedAt: 0,
      historyClickedAgainAt: 0,
      historyRowText: "",
      historyPressedAt: 0,
      historyRetries: 0,
      historyDeleted: 0,
      historySkipped: 0,
      historyTried: []
    };
  }

  // The trip itself: the run is on google.com, holding an answer, looking for the entry its own search
  // left behind. One page load is one attempt - open the box's list, delete every entry that is ours,
  // and when nothing of ours was there yet, refresh the page and try again (Google needs a moment to
  // record the search). When the entry is gone, the answer is reported.
  function runHistoryCleanupTrip(session) {
    var sweep = session.historySweep;
    var state = newHistoryState();

    sweep.startedAt = sweep.startedAt || Date.now();
    traceHistory(
      "cleanup trip: page " +
        String(window.location.href) +
        " (reload " +
        (sweep.reloads || 0) +
        " of " +
        CLEANUP_MAX_RELOADS +
        ")"
    );

    state.interval = setInterval(tick, TICK_MS);
    tick();

    function stopTrip() {
      if (state.interval) clearInterval(state.interval);
    }

    function tick() {
      // A hard deadline on the whole trip: whatever happens - no box, no list, a consent wall - the
      // answer it is holding gets reported.
      if (Date.now() - sweep.startedAt > CLEANUP_MAX_MS) {
        traceHistory("cleanup trip: out of time after " + (sweep.reloads || 0) + " refreshes - reporting the answer");
        stopTrip();
        finishHistoryCleanupTrip(sweep, null, sweep.query);
        return;
      }

      // 1. The suggestion list only exists on google.com's own homepage.
      if (!isHomePage()) {
        traceHistory("cleanup trip: not on the homepage - opening google.com");
        try {
          window.location.href = GOOGLE_HOME_URL;
        } catch (e) {
          finishHistoryCleanupTrip(sweep, null, sweep.query);
        }
        return;
      }

      var input = suggestionBox();
      if (!input) return; // the box has not rendered yet

      // 2. Ask for the list (a click in the box, repeated, and Ctrl+ArrowDown), then sweep it.
      if (deleteHistoryEntry(state, sweep.query, input)) return;
      if (state.historyStep !== "done") return;

      // 3. The sweep of this page load is over.
      if ((state.historyDeleted || 0) > 0) {
        traceHistory("cleanup trip: the entry is gone - reporting the answer now");
        stopTrip();
        finishHistoryCleanupTrip(sweep, null, sweep.query);
        return;
      }

      // 4. Nothing of ours in the list. When the box showed no suggestions AT ALL, it is given something
      //    to suggest first: typing alone does not search, so the query's opening can be typed in without
      //    adding a history entry of its own - and Google then offers the stored suggestion to delete.
      if (!state.seeded && !findSuggestionRows().length) {
        state.seeded = true;
        var seed = String(sweep.query || "").slice(0, 40);
        traceHistory("cleanup trip: the box showed nothing - typing \"" + seed + "\" to bring a suggestion up");
        typeQuery(seed);

        // Look at the list again from scratch.
        state.historyStep = "";
        state.historyStartedAt = 0;
        state.historyOpenedAt = 0;
        state.historyClickedAt = 0;
        state.historyKeyedAt = 0;
        state.historyClickedAgainAt = 0;
        state.historyTried = [];
        return;
      }

      // 5. Google has not recorded the search yet, so the page is refreshed and the whole thing is
      //    tried again.
      if ((sweep.reloads || 0) >= CLEANUP_MAX_RELOADS) {
        traceHistory(
          "cleanup trip: no entry appeared after " + (sweep.reloads || 0) + " refreshes - reporting anyway"
        );
        stopTrip();
        finishHistoryCleanupTrip(sweep, null, sweep.query);
        return;
      }

      sweep.reloads = (sweep.reloads || 0) + 1;
      saveSession();
      sendProgress(3, 3, "Waiting for the search to be listed (refresh " + sweep.reloads + ")...");
      traceHistory("cleanup trip: nothing yet - refreshing the page (next attempt " + (sweep.reloads + 1) + ")");
      setTimeout(function () {
        try {
          window.location.reload();
        } catch (e) {
          stopTrip();
          finishHistoryCleanupTrip(sweep, null, sweep.query);
        }
      }, CLEANUP_RELOAD_DELAY_MS);
    }
  }

  function runGoogleAutomation(session) {
    // A page that was loaded for the cleanup trip rather than for the search: the direction is the same
    // either way - google.com, the box, its suggestion list - but there is nothing left to ask Google,
    // only a search to take back out of its history.
    if (session.historySweep && session.historySweep.pending) {
      runHistoryCleanupTrip(session);
      return;
    }

    var query = currentQuery(session);
    if (!query) return;
    var expectedName = session.targetName || "";

    var state = {
      startedAt: Date.now(),
      interval: null,
      homeStep: 0,
      typedAt: 0,
      submittedAt: 0,
      aiClickedAt: 0,
      // The search-history sweep of the typed query: which step it is on, when it started, when the
      // list was asked for, when the box was keyed/clicked to open it, which row was clicked and how
      // often, and how many rows were removed or left alone.
      historyStep: "",
      historyStartedAt: 0,
      historyOpenedAt: 0,
      historyKeyedAt: 0,
      historyClickedAt: 0,
      historyClickedAgainAt: 0,
      historyRowText: "",
      historyPressedAt: 0,
      historyRetries: 0,
      historyDeleted: 0,
      historySkipped: 0,
      historyTried: [],
      reported: false,
      lastText: "",
      stableAt: 0
    };

    sendProgress(1, 3, "Asking AI if " + (session.targetName || "this person") + " is male or female...");
    traceHistory("run start on " + String(window.location.href) + " - the query is: " + query);
    state.interval = setInterval(tick, TICK_MS);
    tick();

    function tick() {
      if (state.reported) return;

      // The homepage: type the query into the search box, take it back out of the search history,
      // then press Enter. If the box did not take it, or Enter did not submit, the form is submitted
      // and finally the results URL is opened - the page must never sit there with a query typed into
      // it and nothing happening.
      if (isHomePage()) {
        // 1. Type the query into the box.
        if (state.homeStep === 0) {
          traceHistory("this is the google homepage - typing the query into the box");
          if (!typeQuery(query)) return; // the search box has not rendered yet
          state.homeStep = 1;
          state.typedAt = Date.now();
          return;
        }

        // 2. Take the query back out of Google's search history while the box - and the suggestion
        //    list that holds the entry - is still on screen. Once Enter has been pressed that list
        //    is gone for good.
        if (state.homeStep === 1 && deleteHistoryEntry(state, query, suggestionBox())) return;

        // 3. Enter, with the box re-armed first: an item left selected in the suggestion list would
        //    otherwise be what Google searches for instead of this query.
        if (state.homeStep === 1) {
          state.homeStep = 2;
          state.submittedAt = Date.now();
          armQuery(query);
          pressEnter(findSearchInput());
          return;
        }

        if (state.homeStep === 2 && Date.now() - state.submittedAt > 900) {
          state.homeStep = 3;
          if (submitSearchForm()) return;
        }
        if (state.homeStep >= 3 && Date.now() - state.startedAt > HOME_TO_SEARCH_MAX_MS) {
          state.homeStep = 4;
          goToAiResults(query);
        }
        return;
      }

      // 2. The results page: switch it into AI Mode (the "AI Mode" control is the same thing as
      // the udm=50 search URL).
      if (!aiModeActive()) {
        if (!state.aiClickedAt) {
          var control = findAiModeControl();
          if (control) {
            state.aiClickedAt = Date.now();
            sendProgress(2, 3, "Opening AI Mode...");
            clickElement(control);
            return;
          }
          if (Date.now() - state.startedAt > AI_MODE_MAX_MS) goToAiResults(query);
          return;
        }
        // The control was clicked but the page did not switch: open the AI Mode URL directly.
        if (Date.now() - state.aiClickedAt > 2500) goToAiResults(query);
        return;
      }

      // 3. AI Mode is open: wait for the answer to arrive, then read the gender out of it. Nothing is
      // read until a paragraph is actually there - and only that paragraph is read.
      var waited = Date.now() - state.startedAt;
      var text = answerText();

      if (!answerIsPresent(text)) {
        // Nothing has come back. Wait for a paragraph, but not for ever: a page that never returns
        // one has answered this address with nothing, so the run moves on - and closes once there is
        // no address left to ask.
        if (waited >= ANSWER_APPEAR_MS) {
          requestNextAddress(state, "AI returned no answer for this person.");
        }
        return;
      }

      if (text !== state.lastText) {
        // Still arriving: the settle window starts again.
        state.lastText = text;
        state.stableAt = Date.now();
        return;
      }

      var stableFor = Date.now() - state.stableAt;
      var settled = stableFor >= ANSWER_STABLE_MS || waited >= ANSWER_MAX_MS;
      if (!settled || waited < ANSWER_MIN_MS) return;

      var found = extractGender(text, expectedName);
      if (found) {
        // The search that produced this is now in Google's history, and Google needs a moment to record
        // it: the run goes back to google.com, refreshes until the entry shows up, deletes it, and only
        // then reports the answer. A run that has already taken a long time reports straight away
        // instead, so the cleanup can never cost it the result.
        if (Date.now() - state.startedAt > CLEANUP_GIVE_UP_AFTER_MS) {
          traceHistory("run is already long - reporting the answer without the history cleanup trip");
          succeed(state, found, query);
          return;
        }
        state.reported = true;
        if (state.interval) clearInterval(state.interval);
        startHistoryCleanupTrip(found, query);
        return;
      }

      // The answer is complete and does not say which of the two this person is, so this question gave
      // nothing.
      requestNextAddress(
        state,
        "AI's answer did not name this person's gender."
      );
    }
  }

  // -------------------------------------------------------------------------------- start-up

  // The runner check is a message round-trip, so the whole start is deferred until the background
  // has answered - starting before then would drive a search in a frame that may not be ours.
  confirmRunnerIsOurs(function (isOurs) {
    if (!isOurs) return;

    chrome.storage.local.get([STORAGE_KEY], function (res) {
      var session = res ? res[STORAGE_KEY] : null;
      if (!session || !currentQuery(session)) return;
      currentSession = session;
      runGoogleAutomation(session);
    });
  });
})();
