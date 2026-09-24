// Content script for Unmask.com DOB Discovery Automation
// Injected into https://unmask.com/* and https://*.unmask.com/*

(function () {
  "use strict";

  if (window.__unmaskAutomationLoaded) return;
  window.__unmaskAutomationLoaded = true;

  // Suffix mappings ported from link-opener
  var STREET_SUFFIXES = {
    alley: "Aly",
    annex: "Anx",
    avenue: "Ave",
    boulevard: "Blvd",
    circle: "Cir",
    court: "Ct",
    drive: "Dr",
    expressway: "Expy",
    freeway: "Fwy",
    highway: "Hwy",
    lane: "Ln",
    parkway: "Pkwy",
    place: "Pl",
    road: "Rd",
    street: "St",
    terrace: "Ter",
    trail: "Trl",
    turnpike: "Tpke",
    way: "Way",
  };

  function titleCase(word) {
    if (!word) return "";
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  function titleCaseAll(str) {
    if (!str) return "";
    return str.split(/\s+/).map(titleCase).join(" ");
  }

  function slugify(str) {
    if (!str) return "";
    return str
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  }

  function abbreviateAndTitle(words) {
    if (!words) return "";
    return words
      .split(/\s+/)
      .map(function (w) {
        var lower = w.toLowerCase().replace(/\.$/, "");
        return STREET_SUFFIXES[lower] || titleCase(w);
      })
      .join(" ");
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function sendProgress(step, totalSteps, message) {
    try {
      chrome.runtime.sendMessage({
        action: "DOB_LOOKUP_PROGRESS",
        step: step,
        totalSteps: totalSteps,
        message: message,
      });
    } catch (e) {}
  }

  function sendSuccess(dob, person, emails, options) {
    var opts = options || {};
    try {
      chrome.runtime.sendMessage({
        action: "DOB_LOOKUP_SUCCESS",
        dob: dob,
        emails: emails || [],
        person: person,
        source: "unmask.com",
        placeholder: !!opts.placeholder,
        continueSearch: !!opts.continueSearch
      });
    } catch (e) {}
  }

  function sendEmpty(message, person) {
    try {
      chrome.runtime.sendMessage({
        action: "DOB_LOOKUP_EMPTY",
        message: message || "No DOB found on Unmask",
        person: person,
      });
    } catch (e) {}
  }

  function copyToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(textarea);
  }

  function focusThisTab() {
    try {
      chrome.runtime.sendMessage({ action: "FOCUS_LOOKUP_TAB" });
    } catch (e) {}
  }

  // Detects Cloudflare Turnstile "Just a moment..." and challenge interstitials
  function isCloudflareChallengePage() {
    var title = (document.title || "").toLowerCase();
    if (
      title.includes("just a moment") ||
      title.includes("security check") ||
      title.includes("attention required") ||
      title.includes("checking your browser") ||
      title.includes("verify you are human")
    ) {
      return true;
    }
    var challengeEl = document.querySelector(
      "main.challenge, .challenge__hero, [aria-label*='Security check'], [aria-label*='security check'], script[src*='challenge-platform'], script[src*='challenges.cloudflare.com'], iframe[src*='turnstile'], iframe[src*='challenges.cloudflare.com'], #challenge-running, #challenge-stage, #challenge-form"
    );
    if (challengeEl) return true;
    return false;
  }

  // ---- Trusted click target resolution -------------------------------------
  // Turnstile lives behind a closed shadow root, so nothing inside it reacts to DOM
  // events: the old "Engine 1" (replaying the recorded cursor path and firing synthetic
  // pointer/mouse events) never cleared a challenge because Cloudflare only trusts real
  // input. The only engine left is Engine 2 - a genuine OS-level click that background.js
  // dispatches over the Chrome DevTools Protocol. All this side has to do is resolve the
  // viewport coordinates of the Turnstile checkbox.
  function findTurnstileElement() {
    var iframe = document.querySelector(
      "iframe[src*='challenges.cloudflare.com'], iframe[src*='challenge-platform'], iframe[src*='turnstile'], .challenge iframe, #captcha-container iframe"
    );
    if (iframe) return iframe;

    // Turnstile is now often rendered with declarative shadow DOM
    // (<template shadowrootmode="closed">): the widget iframe then sits inside a closed shadow
    // root, where querySelector cannot see it. The hidden response input stays in the light DOM
    // and shares the widget's host element, so the host can still be measured - which is what
    // keeps the repeated clicks landing on the widget instead of on a stale recording.
    var response = document.querySelector(
      "input[name='cf-turnstile-response'], input[id*='cf-chl-widget'][type='hidden']"
    );
    if (response && response.parentElement) return response.parentElement;

    return document.querySelector(
      "#captcha-container, .cf-turnstile, .challenge__captcha, .challenge__hero, main.challenge, .challenge"
    );
  }

  // A normal Turnstile widget is ~300x65px and its checkbox sits ~30px in from the left
  // edge, vertically centred.
  var TURNSTILE_WIDGET_MAX_WIDTH = 400;

  function checkboxPointForRect(rect) {
    return {
      x: Math.round(rect.left + Math.min(30, rect.width * 0.18)),
      y: Math.round(rect.top + rect.height / 2)
    };
  }

  function pointInsideRect(point, rect) {
    return (
      point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
    );
  }

  // Coordinates for the trusted click, best source first:
  //   1. the recorded click point while the widget still sits exactly where it was recorded
  //   2. the checkbox of the widget that is on screen right now (survives layout shifts)
  //   3. the recorded click point on its own (widget unreachable or still loading)
  //   4. the middle of the viewport as a last resort
  function resolveTrustedClickPoint(macro) {
    var recorded = null;
    if (macro && macro.click && isFinite(macro.click.x) && isFinite(macro.click.y)) {
      recorded = { x: Math.round(macro.click.x), y: Math.round(macro.click.y) };
    }

    var el = findTurnstileElement();
    if (el) {
      try {
        el.scrollIntoView({ behavior: "auto", block: "center" });
      } catch (e) {
        try {
          el.scrollIntoView();
        } catch (e2) {}
      }

      var rect = null;
      try {
        rect = el.getBoundingClientRect();
      } catch (e3) {}

      if (rect && rect.width > 0 && rect.height > 0) {
        if (recorded && pointInsideRect(recorded, rect)) {
          return { x: recorded.x, y: recorded.y, source: "recorded" };
        }
        // Only trust the checkbox estimate on something widget sized - a full width
        // wrapper would put the estimate at the far left of the page.
        if (el.tagName === "IFRAME" || rect.width <= TURNSTILE_WIDGET_MAX_WIDTH) {
          var pt = checkboxPointForRect(rect);
          return { x: pt.x, y: pt.y, source: "widget" };
        }
      }
    }

    if (recorded) return { x: recorded.x, y: recorded.y, source: "recorded" };
    return {
      x: Math.round(window.innerWidth / 2),
      y: Math.round(window.innerHeight / 2),
      source: "viewport"
    };
  }

  // Cosmetic marker for the point the trusted click was sent to (helps spot a bad
  // calibration); it dispatches no events itself.
  function showClickRipple(x, y) {
    try {
      var ripple = document.createElement("div");
      ripple.style.cssText =
        "position: fixed; left: " + (x - 15) + "px; top: " + (y - 15) + "px; width: 30px; height: 30px; border-radius: 50%; border: 2px solid #3b82f6; pointer-events: none; z-index: 2147483647; opacity: 0.9; transition: opacity 0.45s ease-out, transform 0.45s ease-out;";
      (document.body || document.documentElement).appendChild(ripple);

      var fadeOut = function () {
        ripple.style.opacity = "0";
        ripple.style.transform = "scale(2.2)";
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(fadeOut);
      else fadeOut();

      setTimeout(function () {
        if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
      }, 500);
    } catch (e) {}
  }

  // ---- Trusted click pacing -------------------------------------------------
  // One click is not enough for Cloudflare's interactive widget: it re-renders (and can move)
  // after every attempt, the first click often lands while the widget is still loading, and a
  // stubborn challenge needs a few tries before it clears. The click is therefore repeated
  // with freshly measured coordinates until the challenge page is gone - the caps below only
  // stop a widget that will never clear from being clicked forever.
  var TRUSTED_CLICK_SETTLE_MS = 600; // let the widget render before the first click
  var TRUSTED_CLICK_GAP_MS = 3000; // gap between two trusted clicks
  var TRUSTED_CLICK_MAX = 30; // ~90s of clicking: the run's own budget stops it first
  var TRUSTED_CLICK_FOCUS_AFTER = 3; // surface the tab once this many clicks did nothing

  // True on the tick after the widget settled, then once per gap, until the cap is reached.
  // The branch itself decides when to stop: the moment the challenge page is gone this is
  // never asked again.
  function trustedClickDue(clicks, detectedAt, lastClickAt, now) {
    if (clicks >= TRUSTED_CLICK_MAX) return false;
    if (clicks === 0) return now - detectedAt > TRUSTED_CLICK_SETTLE_MS;
    return now - lastClickAt > TRUSTED_CLICK_GAP_MS;
  }

  // Engine 2: the only engine used - a real OS-level trusted click that background.js
  // dispatches over the Chrome DevTools Protocol.
  async function replayMacroEngine2(targetX, targetY) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(
          { action: "REPLAY_MACRO_CLICK", x: targetX, y: targetY },
          function (res) {
            resolve(res && res.success);
          }
        );
      } catch (err) {
        resolve(false);
      }
    });
  }

  // Realistic human click dispatcher
  async function simulateHumanClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}

    await delay(randomDelay(150, 300));
    try {
      el.focus();
    } catch (e) {}

    await delay(randomDelay(80, 180));

    try {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    } catch (e) {}

    if (el.type === "checkbox") {
      el.checked = true;
      try {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {}
    }

    // Also dispatch on parent label or wrapper if available
    var parentLabel = el.closest("label, .custom-checkbox, .checkbox-wrapper, .um-form__group");
    if (parentLabel && parentLabel !== el) {
      try {
        parentLabel.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      } catch (e) {}
    }

    if (typeof el.click === "function") {
      try {
        el.click();
      } catch (e) {}
    }

    return true;
  }

  function normalizeName(str) {
    return (str || "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseNameDetails(str) {
    if (!str) return { first: "", middle: "", middleInitial: "", last: "", full: "", raw: "" };
    var raw = String(str).replace(/\([^)]*\)/g, " ").trim();
    var first = "", middle = "", last = "";

    if (raw.includes(",")) {
      var commaParts = raw.split(",");
      last = normalizeName(commaParts[0]);
      var rest = normalizeName(commaParts.slice(1).join(" ")).split(" ").filter(Boolean);
      first = rest[0] || "";
      middle = rest.slice(1).join(" ");
    } else {
      var parts = normalizeName(raw).split(" ").filter(Boolean);
      if (parts.length === 1) {
        first = parts[0];
        last = parts[0];
      } else if (parts.length === 2) {
        first = parts[0];
        last = parts[1];
      } else if (parts.length >= 3) {
        first = parts[0];
        var lastPart = parts[parts.length - 1];
        if (["jr", "sr", "ii", "iii", "iv", "v"].includes(lastPart)) {
          last = parts[parts.length - 2];
          middle = parts.slice(1, parts.length - 2).join(" ");
        } else {
          last = lastPart;
          middle = parts.slice(1, parts.length - 1).join(" ");
        }
      }
    }
    var middleInitial = middle ? middle.charAt(0) : "";
    var cleanFull = [first, middle, last].filter(Boolean).join(" ");
    return {
      first: first,
      middle: middle,
      middleInitial: middleInitial,
      last: last,
      full: cleanFull,
      raw: raw,
    };
  }

  // Name scoring: evaluates first, last, and middle name / initials
  function matchNameScore(target, cand) {
    if (!target.first || !cand.first || !target.last || !cand.last) return -100;

    // Check last name
    var lastMatch = target.last === cand.last;
    if (!lastMatch) {
      if (
        (target.last.length > 3 && cand.last.includes(target.last)) ||
        (cand.last.length > 3 && target.last.includes(cand.last))
      ) {
        lastMatch = true;
      }
    }
    if (!lastMatch) return -100;

    var score = 50; // Base points for last name match

    // First name match
    if (target.first === cand.first) {
      score += 50;
    } else if (
      (target.first.length > 2 && cand.first.startsWith(target.first)) ||
      (cand.first.length > 2 && target.first.startsWith(cand.first)) ||
      (target.first.charAt(0) === cand.first.charAt(0))
    ) {
      score += 25;
    } else {
      return -100;
    }

    // Middle name / initial match:
    // target: "Gloria Jean Grice" (middle: "jean", initial: "j")
    // cand: "Gloria J Grice" (middle: "j", initial: "j")
    if (target.middle && cand.middle) {
      if (target.middle === cand.middle) {
        score += 40; // Exact middle name match
      } else if (
        target.middleInitial === cand.middleInitial ||
        target.middle.startsWith(cand.middle) ||
        cand.middle.startsWith(target.middle)
      ) {
        score += 35; // Initial match (J for Jean!)
      } else {
        score -= 20;
      }
    } else if (target.middle && !cand.middle) {
      score += 10;
    } else if (!target.middle && cand.middle) {
      score += 15; // Target has no middle name specified, candidate has middle name (e.g. Patrick Cates vs Patrick Allen Cates)
    }

    return score;
  }

  function isElementVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    var style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function matchAliasScore(target, aliasStr) {
    if (!aliasStr) return 0;
    var a = parseNameDetails(aliasStr);
    if (!a.last || a.last !== target.last) return 0;

    // Check initials: "g j grice" for "gloria jean grice"
    if (a.first.length === 1 && a.first === target.first.charAt(0)) {
      if (
        (a.middle && a.middle.length === 1 && a.middle === target.middleInitial) ||
        !a.middle
      ) {
        return 30; // Perfect initials alias match!
      }
      return 15;
    }
    if (a.first === target.first) {
      return 20;
    }
    return 0;
  }

  function evaluateAliasMatch(target, aliasStr, targetAge, cardAge) {
    if (!aliasStr) return 0;
    var a = parseNameDetails(aliasStr);
    var ageKnown = !!(targetAge && cardAge);

    // Case 1: Both First and Last match! (e.g. Alias has Kennedy Fulbright)
    var nameScore = matchNameScore(target, a);
    if (nameScore > 0) {
      // Name matches through an alias but the age says a different person
      if (ageKnown && !isAgeWithinTolerance(targetAge, cardAge)) return 0;
      return nameScore + 50; // 150+
    }

    // Case 2: First name matches exactly (e.g. Kennedy == Kennedy)
    if (target.first && a.first && target.first === a.first) {
      var score = 65; // Base score for first name match in alias
      if (ageKnown) {
        var diff = Math.abs(targetAge - cardAge);
        if (diff === 0) score += 45; // Exact age match: 65 + 45 = 110 (>80 threshold!)
        else if (diff === 1) score += 35; // 65 + 35 = 100
        else if (diff === 2) score += 25; // 65 + 25 = 90
        else if (diff === 3) score += 20; // 65 + 20 = 85 (lowest confidence accepted)
        else score -= 60; // Beyond tolerance: 65 - 60 = 5 -> rejected
      }
      return score;
    }

    // Case 3: Last name matches exactly in alias
    if (target.last && a.last && target.last === a.last) {
      if (ageKnown && !isAgeWithinTolerance(targetAge, cardAge)) return 0;
      var score2 = 45;
      if (ageKnown && Math.abs(targetAge - cardAge) <= 1) {
        score2 += 40;
      }
      return score2;
    }

    return 0;
  }

  function matchAgeScore(targetAge, cardAge) {
    if (!targetAge || !cardAge) return 15; // Unknown age: neutral (cannot rule out)
    var diff = Math.abs(targetAge - cardAge);
    if (diff === 0) return 40; // Exact match
    if (diff === 1) return 35; // 1 year diff (e.g. 72 vs 73)
    if (diff === 2) return 25; // 2 years diff
    if (diff === 3) return 15; // 3 years diff: still acceptable, lowest confidence
    return -50; // Beyond tolerance: caller rejects the card outright
  }

  // Age agreement between the record and a search-result card. +/-3 years absorbs
  // off-by-one birthday/record lag; anything wider is a different person.
  // Record: 72 yrs -> 1954, so a card holding 1958 (age 68) is never a match.
  var MATCH_AGE_TOLERANCE = 3;

  function isAgeWithinTolerance(targetAge, cardAge) {
    if (!targetAge || !cardAge) return true; // Unknown age: cannot rule the card out
    return Math.abs(targetAge - cardAge) <= MATCH_AGE_TOLERANCE;
  }

  function isNameMatch(targetStr, candidateStr) {
    var target = parseNameDetails(targetStr);
    var cand = parseNameDetails(candidateStr);
    return matchNameScore(target, cand) >= 80;
  }

  function parseAge(str) {
    if (!str) return null;
    if (String(str).includes("80+")) return 80;
    var m = String(str).match(/\b(\d{2,3})\b/);
    return m ? parseInt(m[1], 10) : null;
  }

  // ---------------------------------------------------------------------------
  // Date of birth matching
  //
  // The record tells us how old the person is (e.g. "72 yrs (1954)"), so the only
  // birth years we may report are the ones that truly belong to that person.
  // A +/-3 year window absorbs off-by-one birthday / record lag while still
  // rejecting a clearly different person: a 72 yr old record -> 1954, so 1958
  // (age 68) is 4 years off and is never acceptable.
  // ---------------------------------------------------------------------------
  var DOB_YEAR_TOLERANCE = 3;
  var MIN_BIRTH_YEAR = 1912;
  var MAX_PLAUSIBLE_AGE = 110;
  // A matched profile without a DOB is abandoned after this short settle time.
  var PROFILE_NO_DOB_SETTLE_MS = 350;
  // A rendered card list is given this long (per unchanged render) before we accept
  // that none of its cards is our person and move on.
  var CARDS_SETTLE_MS = 500;
  // How often the page state is re-checked (every step reacts within one tick).
  var TICK_MS = 150;

  var MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];

  function isMonthName(word) {
    return !!word && MONTH_NAMES.indexOf(String(word).toLowerCase()) !== -1;
  }

  function formatMonthName(word) {
    var lower = String(word).toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function currentYear() {
    return new Date().getFullYear();
  }

  // Birth year the record points at. Accepts the explicit year the record carries
  // ("72 yrs (1954)" or 1954), a plain age (72), or the raw age string.
  function getExpectedBirthYear(targetAge, targetYear) {
    var now = currentYear();
    var yearRaw = (targetYear === null || targetYear === undefined) ? "" : String(targetYear);
    var ageRaw = (targetAge === null || targetAge === undefined) ? "" : String(targetAge);

    var yearMatch = yearRaw.match(/\b(19\d{2}|20[0-1]\d)\b/) || ageRaw.match(/\b(19\d{2}|20[0-1]\d)\b/);
    if (yearMatch) {
      var yearNum = parseInt(yearMatch[1], 10);
      if (yearNum >= MIN_BIRTH_YEAR && yearNum <= now) return yearNum;
    }

    var ageMatch = ageRaw.match(/\b(\d{1,3})\b/);
    if (ageMatch) {
      var ageNum = parseInt(ageMatch[1], 10);
      if (ageNum > 0 && ageNum <= MAX_PLAUSIBLE_AGE) return now - ageNum;
    }

    return null;
  }

  // "January 1954" / "January 1, 1954" / "01/01/1954" is the placeholder Unmask shows
  // when the real month and day are unknown: 50/50 real, so it is reported but never
  // trusted on its own.
  function isPlaceholderDob(dobText) {
    var text = String(dobText || "").trim();

    var numeric = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (numeric) {
      return parseInt(numeric[1], 10) === 1 && parseInt(numeric[2], 10) === 1;
    }

    var m = text.match(/^([A-Za-z]+)\.?\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(\d{4})$/);
    if (!m) return false;
    var month = m[1].toLowerCase();
    if (month !== "january" && month !== "jan") return false;
    var day = m[2] ? parseInt(m[2], 10) : 1; // "January 1954" means January 1st
    return day === 1;
  }

  function cleanSummaryText(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  // The profile summary is server rendered, so once the document has finished
  // loading and its text has stopped growing a missing DOB will never appear.
  function isProfileSummarySettled(snapshot) {
    if (!snapshot || snapshot.length < 20) return false;
    if (document.readyState !== "complete") return false;
    return true;
  }

  // Extracts the DOB of the person the record describes.
  // Dates that do not line up with the record's age (e.g. 1954 expected, 1958 on
  // the page) are ignored instead of reported - a wrong DOB is worse than none.
  function extractDobFromText(text, targetAge, targetYear) {
    if (!text) return null;
    var best = pickBestDobCandidate(collectDobCandidates(text), targetAge, targetYear);
    return best ? best.text : null;
  }

  // Collects every date-like string on the page that could be a birth date.
  // priority 4 = explicit wording   ("born on August 13, 1963", "DOB: 08/13/1963")
  // priority 3 = date followed by an age ("August 13, 1963 and is 62 years old")
  // priority 1 = bare "August 13, 1963"
  // priority 0 = bare "August 1963"
  function collectDobCandidates(text) {
    var list = [];
    if (!text) return list;

    function add(display, yearStr, priority, index) {
      var year = parseInt(yearStr, 10);
      var now = currentYear();
      if (!display || !year) return;
      if (year < MIN_BIRTH_YEAR || year > now) return;
      list.push({ text: display, year: year, priority: priority, index: index });
    }

    var m;

    // "born on August 13th, 1963", "was born August 13, 1963", "DOB: August 13, 1963"
    var reExplicitMonthDayYear = /\b(?:born|dob|date\s+of\s+birth|birth\s*date|birthday)\b\s*(?::|\s+on|\s+in|\s+is)?\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
    while ((m = reExplicitMonthDayYear.exec(text)) !== null) {
      if (isMonthName(m[1])) {
        add(formatMonthName(m[1]) + " " + m[2] + ", " + m[3], m[3], 4, m.index);
      }
    }

    // "born in August 1963", "DOB: August 1963"
    var reExplicitMonthYear = /\b(?:born|dob|date\s+of\s+birth|birth\s*date|birthday)\b\s*(?::|\s+in|\s+on|\s+is)?\s*([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/gi;
    while ((m = reExplicitMonthYear.exec(text)) !== null) {
      if (isMonthName(m[1])) {
        add(formatMonthName(m[1]) + " " + m[2], m[2], 4, m.index);
      }
    }

    // "born on 08/15/1954", "DOB: 8-15-1954"
    var reExplicitNumeric = /\b(?:born|dob|date\s+of\s+birth|birth\s*date|birthday)\b\s*(?::|\s+on|\s+is)?\s*(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](\d{4})\b/gi;
    while ((m = reExplicitNumeric.exec(text)) !== null) {
      add(m[1] + "/" + m[2] + "/" + m[3], m[3], 4, m.index);
    }

    // "August 13th, 1963 and is 62 years old", "August 13, 1963 (62 yrs old)"
    var reMonthDayYearAge = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\s*[,;(]?\s*(?:and\s+)?(?:is\s+)?(?:age\s*)?(\d{1,3})\s*(?:years?(?:\s+old)?|yrs?|yo)\b/gi;
    while ((m = reMonthDayYearAge.exec(text)) !== null) {
      var hintAge = parseInt(m[4], 10);
      if (isMonthName(m[1]) && hintAge > 0 && hintAge <= MAX_PLAUSIBLE_AGE) {
        add(formatMonthName(m[1]) + " " + m[2] + ", " + m[3], m[3], 3, m.index);
      }
    }

    // Bare "August 13th, 1963"
    var reMonthDayYear = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g;
    while ((m = reMonthDayYear.exec(text)) !== null) {
      if (isMonthName(m[1])) {
        add(formatMonthName(m[1]) + " " + m[2] + ", " + m[3], m[3], 1, m.index);
      }
    }

    // Bare "August 1963"
    var reMonthYear = /\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/g;
    while ((m = reMonthYear.exec(text)) !== null) {
      if (isMonthName(m[1])) {
        add(formatMonthName(m[1]) + " " + m[2], m[2], 0, m.index);
      }
    }

    return list;
  }

  // Picks the birth date that best matches the record's age: the closest year to
  // the age-implied birth year wins, explicit "born ..." wording outranks a bare
  // date. Anything further than DOB_YEAR_TOLERANCE years away belongs to somebody
  // else and is never returned.
  function pickBestDobCandidate(candidates, targetAge, targetYear) {
    if (!candidates || candidates.length === 0) return null;

    var expectedYear = getExpectedBirthYear(targetAge, targetYear);

    if (expectedYear) {
      var best = null;
      var bestScore = -Infinity;
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        var diff = Math.abs(c.year - expectedYear);
        if (diff > DOB_YEAR_TOLERANCE) continue; // Different person: 1958 vs 1954
        var score = (c.priority * 10) - diff;
        if (!best || score > bestScore || (score === bestScore && c.index < best.index)) {
          best = c;
          bestScore = score;
        }
      }
      return best;
    }

    // Record carries no age/year: trust an explicit birth phrase first, otherwise
    // the most specific date that still implies a lifelike age.
    var now = currentYear();
    var fallback = null;
    for (var j = 0; j < candidates.length; j++) {
      var cand = candidates[j];
      var impliedAge = now - cand.year;
      if (impliedAge < 5 || impliedAge > MAX_PLAUSIBLE_AGE) continue;
      if (cand.priority >= 3) return cand;
      if (
        !fallback ||
        cand.priority > fallback.priority ||
        (cand.priority === fallback.priority && cand.index < fallback.index)
      ) {
        fallback = cand;
      }
    }
    return fallback;
  }

  // Closest date that had to be rejected, so the UI can explain the skip instead
  // of silently reporting nothing.
  function describeClosestRejectedDob(text, targetAge, targetYear) {
    var candidates = collectDobCandidates(text);
    var expectedYear = getExpectedBirthYear(targetAge, targetYear);
    if (!candidates.length || !expectedYear) return null;

    var closest = null;
    var closestDiff = Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var diff = Math.abs(candidates[i].year - expectedYear);
      if (diff < closestDiff) {
        closest = candidates[i];
        closestDiff = diff;
      }
    }
    if (!closest) return null;
    return { text: closest.text, year: closest.year, diff: closestDiff };
  }

  // Cheap fingerprint of the rendered card list: any name/age/address that streams in
  // changes it, which is how the run knows the list has finished rendering.
  function cardsFingerprint(cards) {
    if (!cards || !cards.length) return "";
    var parts = [String(cards.length)];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var text = card && card.textContent ? card.textContent : "";
      parts.push(text.length);
    }
    return parts.join(":");
  }

  function isUnmaskAddressNotFound() {
    // If person cards are already in the DOM, results ARE present! Never treat as not found!
    var cards = document.querySelectorAll("div.clickable.person, div[itemtype*='Person'].person, .person");
    if (cards && cards.length > 0) {
      return false;
    }

    // Check for an explicitly VISIBLE "Try Searching Another ..." dialog header.
    // Each page type uses its own wording: "Try Searching Another Address",
    // "Try Searching Another Phone Number", "Try Searching Another Name".
    var dialogHeaders = Array.from(
      document.querySelectorAll(".um-dialog__title, .tz-dialog h2, .tz-dialog__inner h2")
    );
    for (var i = 0; i < dialogHeaders.length; i++) {
      var h = dialogHeaders[i];
      if (isElementVisible(h) && /try searching another/i.test(h.textContent || "")) {
        return true;
      }
    }

    // Same dialog, matched by its body text ("We were unable to find any results
    // for that phone number. Try searching a different number.")
    var dialogBodies = Array.from(
      document.querySelectorAll(".um-dialog__text, .tz-dialog__inner p, .tz-dialog p")
    );
    for (var b = 0; b < dialogBodies.length; b++) {
      if (!isElementVisible(dialogBodies[b])) continue;
      var bodyText = (dialogBodies[b].textContent || "").toLowerCase();
      if (bodyText.includes("unable to find any results") || bodyText.includes("try searching a different")) {
        return true;
      }
    }

    // Check for an explicitly VISIBLE no-results banner/message
    var noneBoxes = Array.from(
      document.querySelectorAll(".um-results__none, .no-results, .um-alert--warning")
    );
    for (var j = 0; j < noneBoxes.length; j++) {
      var box = noneBoxes[j];
      if (isElementVisible(box)) {
        var boxText = (box.textContent || "").toLowerCase();
        if (
          boxText.includes("no records found") ||
          boxText.includes("couldn't find any records") ||
          boxText.includes("0 results found")
        ) {
          return true;
        }
      }
    }

    return false;
  }

  // Unmask shows this prompt when a name search (state / state+city) cannot be
  // narrowed down: "What age range best fits Charles?" with 18-29 / 30-49 / 50-99
  // buttons plus an "I don't know" cancel. No usable records sit behind it, so the
  // run has to move on to the next fallback instead of waiting for cards that will
  // never arrive.
  function looksLikeAgeRangePrompt(titleText, buttonValues) {
    if (/age\s+range/i.test(String(titleText || ""))) return true;

    var rangeButtons = 0;
    (buttonValues || []).forEach(function (value) {
      if (/^\s*\d{1,3}\s*-\s*\d{1,3}\s*\+?\s*$/.test(String(value || ""))) rangeButtons++;
    });
    return rangeButtons >= 2;
  }

  function isUnmaskAgeRangePrompt() {
    var modals = Array.from(
      document.querySelectorAll(
        ".tzModal[role='dialog'], .tzModal, .wl-modal-form, [role='dialog'][aria-modal='true']"
      )
    );

    for (var i = 0; i < modals.length; i++) {
      var modal = modals[i];
      if (!isElementVisible(modal)) continue;

      var titleEl = modal.querySelector(".wl-modal-form__title");
      var titleText = titleEl ? titleEl.textContent : modal.textContent;

      var valueEls = Array.from(
        modal.querySelectorAll(
          "input.wl-modal-form__input-field--button, input[type='button'][class*='input-field'], input[type='button']"
        )
      );
      var values = valueEls.map(function (el) {
        return el.value || el.textContent || "";
      });

      if (looksLikeAgeRangePrompt(titleText, values)) return true;
    }

    return false;
  }

  var TOP_EMAIL_DOMAINS = [
    "gmail.com",
    "yahoo.com",
    "ymail.com",
    "hotmail.com",
    "outlook.com",
    "icloud.com",
    "aol.com",
    "att.net",
    "comcast.net",
    "msn.com",
    "live.com",
    "sbcglobal.net",
    "verizon.net",
    "bellsouth.net",
    "charter.net",
    "cox.net"
  ];

  function selectBestEmails(rawEmails, personName) {
    if (!rawEmails || !rawEmails.length) return [];
    var unique = [];
    var seen = {};
    for (var i = 0; i < rawEmails.length; i++) {
      var em = String(rawEmails[i] || "").trim().toLowerCase();
      if (em && !seen[em]) {
        seen[em] = true;
        unique.push(em);
      }
    }

    if (unique.length <= 2) return unique;

    var firstEmail = unique[0];
    var candidates = unique.slice(1);

    // 1. Highest rank top domain
    var bestSecond = null;
    var bestDomainRank = 9999;
    for (var c = 0; c < candidates.length; c++) {
      var domain = (candidates[c].split("@")[1] || "").toLowerCase().trim();
      var rank = TOP_EMAIL_DOMAINS.indexOf(domain);
      if (rank !== -1 && rank < bestDomainRank) {
        bestDomainRank = rank;
        bestSecond = candidates[c];
      }
    }

    if (bestSecond) {
      return [firstEmail, bestSecond];
    }

    // 2. Contains person first or last name
    var nameParts = (personName || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
    var firstName = nameParts[0] || "";
    var lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

    for (var n = 0; n < candidates.length; n++) {
      var candLower = candidates[n].toLowerCase();
      if ((firstName.length >= 3 && candLower.includes(firstName)) ||
          (lastName.length >= 3 && candLower.includes(lastName))) {
        bestSecond = candidates[n];
        break;
      }
    }

    if (bestSecond) {
      return [firstEmail, bestSecond];
    }

    // 3. Fallback to any random/next email
    return [firstEmail, candidates[0]];
  }

  function extractEmailsFromPage(personName) {
    var emailSec =
      document.getElementById("email-addresses") ||
      document.querySelector(".wl-card--email, [data-section='email-addresses'], #email-addresses");

    if (emailSec) {
      var seeAllBtn = emailSec.querySelector(
        ".wl-card__cta-link, button.wl-card__cta-link, .um-btn-more, button[class*='more']"
      );
      if (seeAllBtn && !seeAllBtn.dataset.clicked) {
        seeAllBtn.dataset.clicked = "true";
        try { seeAllBtn.click(); } catch (e) {}
      }
    }

    var rawEmails = [];
    var emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

    var elements = emailSec
      ? Array.from(emailSec.querySelectorAll(".wl-card-item__title, .wl-card-item, span, a, button"))
      : Array.from(document.querySelectorAll("#email-addresses .wl-card-item__title, .wl-card--email .wl-card-item__title"));

    for (var i = 0; i < elements.length; i++) {
      var text = (elements[i].textContent || "").trim();
      var matches = text.match(emailRegex);
      if (matches) {
        for (var m = 0; m < matches.length; m++) {
          var em = matches[m].toLowerCase();
          if (!rawEmails.includes(em)) {
            rawEmails.push(em);
          }
        }
      }
    }

    if (rawEmails.length === 0 && emailSec) {
      var secText = emailSec.textContent || "";
      var m2 = secText.match(emailRegex);
      if (m2) {
        for (var k = 0; k < m2.length; k++) {
          var em2 = m2[k].toLowerCase();
          if (!rawEmails.includes(em2)) rawEmails.push(em2);
        }
      }
    }

    return selectBestEmails(rawEmails, personName);
  }

  // Automation runner
  function runUnmaskAutomation(session) {
    var targetName = session.targetName || "";
    var targetAge = session.targetAge || null;
    // Explicit birth year from the record (e.g. "72 yrs (1954)") when available.
    var targetYear = session.targetYear || null;
    var currentUrl = window.location.href;
    var pathname = window.location.pathname;
    var isAddressPage = pathname.includes("/address/");
    var isPhonePage = pathname.includes("/phone/");
    var isProfilePage =
      !isAddressPage &&
      !isPhonePage &&
      (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(pathname) ||
       /\/[A-Za-z0-9_-]+\/[A-Za-z]{2}-[A-Za-z0-9_-]+\/[a-f0-9-]{10,}/i.test(pathname));
    var isNameSearchPage =
      !isAddressPage &&
      !isPhonePage &&
      !isProfilePage &&
      /^\/[A-Za-z0-9_-]+\/[A-Za-z]{2}(?:-[A-Za-z0-9_-]+)?\/?$/i.test(pathname);

    var state = {
      checkboxClicked: false,
      checkboxClickedAt: 0,
      cardsDetectedAt: 0,
      cardsSignature: "",
      cardsReported: -1,
      startedAt: Date.now(),
      processed: false,
      dobExtractLogged: false,
      profileReadyAt: 0,
      profileSnapshot: "",
      challengeDetectedAt: 0,
      challengeReplayInProgress: false,
      challengeClicks: 0,
      challengeLastClickAt: 0,
      challengeFocusSteps: 0,
      lastCalibratedCoords: null,
    };

    var interval = null;

    function advanceToNextAddress(reason) {
      if (state.processed) return;
      state.processed = true;
      if (interval) clearInterval(interval);

      sendProgress(2, 4, reason || "Moving to next address...");
      try {
        chrome.runtime.sendMessage({ action: "DOB_LOOKUP_NEXT_ADDRESS" }, function (res) {
          if (res && res.nextUrl && !res.exhausted) {
            if (window.location.href !== res.nextUrl) {
              window.location.href = res.nextUrl;
            }
          }
        });
      } catch (e) {}
    }

    sendProgress(1, 4, "Connecting to Unmask (" + (targetName || "Target") + ")...");

    interval = setInterval(async function () {
      if (state.processed) return;

      // ==========================================
      // SCENARIO 0: Cloudflare Turnstile Challenge Intercept
      // ==========================================
      if (isCloudflareChallengePage()) {
        if (!state.challengeDetectedAt) {
          state.challengeDetectedAt = Date.now();
          sendProgress(1, 4, "Security check detected on Unmask. Preparing calibration...");
        }

        // Safety timeout for Cloudflare challenge (90 seconds max)
        if (Date.now() - state.challengeDetectedAt > 90000) {
          advanceToNextAddress("Security check timed out. Trying next address...");
          return;
        }

        if (state.challengeReplayInProgress) return;

        // The challenge only clears for a real input event, so the trusted click (Engine 2)
        // is dispatched straight away. Engine 1 (replaying the recorded cursor path with
        // synthetic DOM events) is gone - Cloudflare ignores untrusted events.
        // The first click waits for the widget to render, and clicks are then repeated once
        // per gap until the challenge page is gone - each one measured again, because the
        // widget re-renders (and can move) after every attempt.
        if (trustedClickDue(state.challengeClicks, state.challengeDetectedAt, state.challengeLastClickAt, Date.now())) {
          state.challengeReplayInProgress = true;
          var isRetry = state.challengeClicks > 0;
          state.challengeClicks += 1;
          state.challengeLastClickAt = Date.now();
          chrome.storage.local.get(["recorded_macro_unmask", "last_macro_recording"], async function (res) {
            var macro = res ? (res.recorded_macro_unmask || res.last_macro_recording) : null;
            var point = resolveTrustedClickPoint(macro);
            state.lastCalibratedCoords = { x: point.x, y: point.y };

            sendProgress(1, 4, (isRetry ? "Retrying trusted click (Engine 2) at " : "Trusted click (Engine 2) at ") + point.x + ", " + point.y + " [" + point.source + "] (attempt " + state.challengeClicks + "/" + TRUSTED_CLICK_MAX + ")...");
            var clicked = await replayMacroEngine2(point.x, point.y);
            if (clicked) showClickRipple(point.x, point.y);
            state.challengeReplayInProgress = false;
            sendProgress(1, 4, clicked ? "Engine 2 click dispatched. Verifying resolution..." : "Engine 2 click could not be sent - verifying resolution...");
          });
          return;
        }

        // The user should be able to watch the check being solved: the lookup tab is brought to
        // the front the moment the check appears, and once more if it survives a few clicks.
        // The trusted clicks keep landing on the widget either way - surfacing the tab only
        // makes them visible.
        var focusStep = state.challengeClicks >= TRUSTED_CLICK_FOCUS_AFTER ? 2 : 1;
        if ((state.challengeFocusSteps || 0) < focusStep) {
          state.challengeFocusSteps = focusStep;
          focusThisTab();
          sendProgress(
            1,
            4,
            focusStep === 1
              ? "Security check on Unmask - bringing the tab forward to solve it here..."
              : "Unmask is still checking - retrying the click here, please hold..."
          );
          return;
        }

        return; // Stay on challenge page while waiting for Turnstile to clear
      }

      // If challenge cleared on this same page, reset challenge state so search gets a fresh window
      if (state.challengeDetectedAt && !isCloudflareChallengePage()) {
        state.challengeDetectedAt = 0;
        state.challengeClicks = 0;
        state.challengeLastClickAt = 0;
        state.challengeFocusSteps = 0;
        state.startedAt = Date.now();
        sendProgress(2, 4, "Security check passed. Reading Unmask results...");
      }

      // ==========================================
      // SCENARIO 1: On Profile Page
      // ==========================================
      if (isProfilePage || document.getElementById("summary") || document.querySelector(".um-profile-summary")) {
        var summarySec =
          document.getElementById("summary") ||
          document.querySelector(".um-profile-summary, .um-results-profile__section");

        var profileNameEl = summarySec
          ? summarySec.querySelector(".um-profile-summary__name, h1.um-profile-summary__name, h1")
          : document.querySelector(".um-profile-summary__name, h1");
        var profileName = profileNameEl ? profileNameEl.textContent.trim() : "";

        var summaryTextEl = summarySec
          ? summarySec.querySelector(".um-profile-summary__text, .um-profile-summary__footer p")
          : null;
        var summaryText = summaryTextEl
          ? summaryTextEl.textContent
          : (summarySec ? summarySec.textContent : (document.body ? document.body.innerText : ""));

        // Check if this profile belongs to our target person
        var targetSlug = (targetName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        var isSlugMatch = targetSlug && pathname.toLowerCase().includes("/" + targetSlug + "/");
        var isTargetProfile =
          session.status === "on_target_profile" || isSlugMatch || isNameMatch(targetName, profileName);

        if (isTargetProfile) {
          if (!state.dobExtractLogged) {
            state.dobExtractLogged = true;
            sendProgress(4, 4, "Extracting DOB & Emails from profile...");
          }

          var profileBodyText = document.body ? document.body.innerText : "";
          var dob =
            extractDobFromText(summaryText, targetAge, targetYear) ||
            extractDobFromText(profileBodyText, targetAge, targetYear);

          if (dob) {
            var emails = extractEmailsFromPage(targetName);
            var isPlaceholder = isPlaceholderDob(dob);
            state.processed = true;
            clearInterval(interval);
            copyToClipboard(dob);
            sendSuccess(dob, session.person, emails, {
              placeholder: isPlaceholder,
              // A January date is a 50/50 placeholder: report it right away, but keep
              // the run alive so ThatSthem can answer with a second, independent DOB.
              continueSearch: isPlaceholder
            });
            if (isPlaceholder) {
              sendProgress(5, 6, "Placeholder DOB " + dob + " found - checking ThatSthem for a second date...");
            } else {
              chrome.storage.local.remove("unmask_pending_lookup").catch(function () {});
            }
            return;
          }

          // A matched profile that shows no birth date is a dead end. The summary is
          // server rendered, so once the page has loaded and the text stopped growing
          // there is nothing left to wait for - move to the next fallback straight
          // away instead of burning the 12s profile timeout. Any date that contradicts
          // the record's age is named in the message so the skip stays visible.
          var profileSnapshot = cleanSummaryText(summaryText) + "|" + (profileBodyText || "").length;
          if (isProfileSummarySettled(profileSnapshot)) {
            if (state.profileSnapshot !== profileSnapshot) {
              // Still rendering: restart the short grace period
              state.profileSnapshot = profileSnapshot;
              state.profileReadyAt = Date.now();
              return;
            }
            if (Date.now() - state.profileReadyAt > PROFILE_NO_DOB_SETTLE_MS) {
              var noDobReason = "No DOB on " + (profileName || targetName || "this") + "'s profile";
              var rejected =
                describeClosestRejectedDob(summaryText, targetAge, targetYear) ||
                describeClosestRejectedDob(profileBodyText, targetAge, targetYear);
              if (rejected && rejected.diff > DOB_YEAR_TOLERANCE) {
                noDobReason +=
                  " (ignored " + rejected.text + ", expected around " +
                  getExpectedBirthYear(targetAge, targetYear) + " for age " +
                  (targetAge || "?") + ")";
              }
              advanceToNextAddress(noDobReason + ". Trying next...");
              return;
            }
          }
        }

        // If on relative's profile or not yet on target profile
        if (session.status === "on_relative_profile" || !isTargetProfile) {
          sendProgress(3, 4, "Checking relatives for " + targetName + "...");

          // 1. Scroll down to relatives section so it renders into DOM
          var relativesSec =
            document.getElementById("relatives") ||
            document.querySelector(".um-results-profile__section#relatives, .wl-card#relatives, [data-section='relatives'], #relatives");

          if (relativesSec) {
            try {
              relativesSec.scrollIntoView({ behavior: "smooth", block: "center" });
            } catch (e) {}

            // Expand "See all relatives" if button present
            var seeAllBtn = relativesSec.querySelector(
              ".wl-card__cta-link, button.wl-card__cta-link, .um-btn-more, button[class*='more'], a[class*='more']"
            );
            if (seeAllBtn && !seeAllBtn.dataset.clicked) {
              seeAllBtn.dataset.clicked = "true";
              seeAllBtn.click();
            }
          }

          // 2. Scan relative links specifically (#relatives, .wl-card-items, .wl-card-item)
          var relativeLinks = Array.from(
            document.querySelectorAll("#relatives a, .wl-card-items a, a.wl-card-item, a[href]")
          );

          var targetSlug = targetName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

          for (var pl = 0; pl < relativeLinks.length; pl++) {
            var pLink = relativeLinks[pl];
            var href = pLink.getAttribute("href") || "";
            if (!href || href.startsWith("#") || href.includes("login") || href.includes("privacy") || href.includes("terms")) continue;
            if (href.includes("/address/") || href.includes("/phone/")) continue;

            // Direct URL slug match (e.g. href contains "/trenton-shupp/")
            var hrefLower = href.toLowerCase();
            var isSlugMatched = targetSlug && (
              hrefLower.includes("/" + targetSlug + "/") ||
              hrefLower.includes("/" + targetSlug + "-")
            );

            // Clean title extraction from relative card (.wl-card-item__title)
            var titleEl = pLink.querySelector(".wl-card-item__title");
            var rName = "";
            if (titleEl) {
              rName = titleEl.textContent.trim();
            } else {
              var clone = pLink.cloneNode(true);
              clone.querySelectorAll(".wl-card-item__sub-text, .sub-text, span.location, span.address").forEach(function (el) {
                el.remove();
              });
              var hEl = clone.querySelector("h2, h3, h4, span");
              rName = (hEl ? hEl.textContent : clone.textContent).trim();
            }
            rName = rName.replace(/\s+/g, " ");

            // Strip location if attached (e.g. "Trenton Shupp Blossom, TX")
            var cleanedRName = rName.replace(/,\s*[A-Za-z\s]+$/, "").trim();

            if (isSlugMatched || (cleanedRName && isNameMatch(targetName, cleanedRName)) || (rName && isNameMatch(targetName, rName))) {
              state.processed = true;
              clearInterval(interval);
              session.status = "on_target_profile";
              chrome.storage.local.set({ unmask_pending_lookup: session }).catch(function () {});
              sendProgress(4, 4, "Found " + (rName || targetName) + " in relatives list. Loading profile...");
              var dest = pLink.href || (window.location.origin + (href.startsWith("/") ? "" : "/") + href);
              window.location.href = dest;
              return;
            }
          }
        }

        // Profile timeout after 12 seconds if DOB could not be extracted
        if (Date.now() - state.startedAt > 9000) {
          advanceToNextAddress("Could not extract DOB from profile. Trying next address...");
          return;
        }

        return; // Stay on profile page while extracting
      }

      // Overall safety timeout per address (22 seconds)
      if (Date.now() - state.startedAt > 12000) {
        advanceToNextAddress("Address timed out. Trying next address...");
        return;
      }

      if (isAddressPage || isPhonePage || isNameSearchPage) {
        // Priority 1: Look for person cards in DOM
        var personCards = Array.from(
          document.querySelectorAll('div.clickable.person, div[itemtype*="Person"].person, .person')
        );

        var pageTypeLabel = isPhonePage ? "phone" : (isNameSearchPage ? "name" : "address");

        if (personCards.length > 0) {
          if (!state.cardsDetectedAt) {
            state.cardsDetectedAt = Date.now();
          }

          // Only re-report when the number of cards changes (no per-tick message spam)
          if (state.cardsReported !== personCards.length) {
            state.cardsReported = personCards.length;
            sendProgress(
              3,
              4,
              "Scanning & ranking " + personCards.length + " card(s) on " + pageTypeLabel + " page..."
            );
          }

          var targetDetails = parseNameDetails(targetName);
          var candidates = [];
          var ageSkipped = [];

          for (var cIdx = 0; cIdx < personCards.length; cIdx++) {
            var card = personCards[cIdx];
            var nameEl = card.querySelector(
              '.person__header-title, [itemprop="name"], h2'
            );
            var cardName = "";
            if (nameEl) {
              var clone = nameEl.cloneNode(true);
              clone.querySelectorAll('.person__header-subtext, span, button, svg').forEach(function(el) { el.remove(); });
              cardName = (clone.textContent || "").replace(/\s+/g, " ").trim();
              if (!cardName) {
                cardName = (nameEl.textContent || "").split("\n")[0].replace(/\s+/g, " ").trim();
              }
            }

            var ageEl = card.querySelector(".person__age-amount, .person__age");
            var cardAge = ageEl ? parseAge(ageEl.textContent) : null;
            var reportLink =
              card.querySelector('a.person__header-text[href]') ||
              card.querySelector('a[href*="/"][class*="header"]') ||
              card.querySelector('.person__header a[href]') ||
              card.querySelector('a.person__button[href]') ||
              card.querySelector('a[href*="-"][href*="/"]') ||
              card.querySelector('a[href]');
            var reportHref = reportLink ? (reportLink.href || reportLink.getAttribute("href") || "") : "";
            if (reportHref && !reportHref.startsWith("http")) {
              reportHref = window.location.origin + (reportHref.startsWith("/") ? "" : "/") + reportHref;
            }

            if (!reportHref) continue;

            // Extract aliases
            var aliases = [];
            var aliasEls = Array.from(card.querySelectorAll('[itemprop="alternateName"]'));
            for (var a = 0; a < aliasEls.length; a++) {
              var aText = aliasEls[a].textContent.trim();
              if (aText && !aliases.includes(aText)) aliases.push(aText);
            }
            var infoRows = Array.from(card.querySelectorAll(".person__info"));
            for (var r = 0; r < infoRows.length; r++) {
              var rowTitle = (infoRows[r].querySelector(".person__title")?.textContent || "").toLowerCase();
              if (rowTitle.includes("alias")) {
                var spans = Array.from(infoRows[r].querySelectorAll(".person__data, span"));
                for (var s = 0; s < spans.length; s++) {
                  var sText = spans[s].textContent.trim();
                  if (sText && !sText.toLowerCase().includes("alias") && !aliases.includes(sText)) {
                    aliases.push(sText);
                  }
                }
              }
            }

            // Extract relatives
            var relatives = [];
            var relEls = Array.from(card.querySelectorAll('[itemprop="relatedTo"]'));
            for (var relIdx = 0; relIdx < relEls.length; relIdx++) {
              var rName = relEls[relIdx].textContent.trim();
              var rLink = relEls[relIdx].getAttribute("href") || (relEls[relIdx].closest("a") ? relEls[relIdx].closest("a").getAttribute("href") : "");
              if (rName) relatives.push({ name: rName, href: rLink });
            }
            for (var r2 = 0; r2 < infoRows.length; r2++) {
              var pt = infoRows[r2].querySelector(".person__title");
              var rTitle = (pt ? pt.textContent : "").toLowerCase();
              if (rTitle.includes("relative")) {
                var rLinks = Array.from(infoRows[r2].querySelectorAll("a.person__link, a[href]"));
                if (rLinks.length > 0) {
                  for (var rl = 0; rl < rLinks.length; rl++) {
                    var relNameText = rLinks[rl].textContent.trim();
                    var relLinkHref = rLinks[rl].getAttribute("href") || "";
                    if (relNameText && !relNameText.toLowerCase().includes("relative")) {
                      if (!relatives.some(function(item) { return item.name === relNameText; })) {
                        relatives.push({ name: relNameText, href: relLinkHref });
                      }
                    }
                  }
                } else {
                  // Comma-separated relative names
                  var dataEl = infoRows[r2].querySelector(".person__data") || infoRows[r2];
                  var textParts = (dataEl.textContent || "").split(/[,;\n]/);
                  for (var tp = 0; tp < textParts.length; tp++) {
                    var cleanPart = textParts[tp].trim();
                    if (cleanPart && !cleanPart.toLowerCase().includes("relative")) {
                      if (!relatives.some(function(item) { return item.name === cleanPart; })) {
                        relatives.push({ name: cleanPart, href: "" });
                      }
                    }
                  }
                }
              }
            }

            // Also check all links in card for target name or slug
            var cardTargetSlug = (targetName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
            var cardLinks = Array.from(card.querySelectorAll("a[href]"));
            for (var cl = 0; cl < cardLinks.length; cl++) {
              var cLink = cardLinks[cl];
              var cHref = cLink.getAttribute("href") || "";
              var cText = cLink.textContent.trim();
              if (cHref && cardTargetSlug && (cHref.toLowerCase().includes("/" + cardTargetSlug + "/") || cHref.toLowerCase().includes("/" + cardTargetSlug + "-"))) {
                var fullDest = cHref.startsWith("http") ? cHref : (window.location.origin + (cHref.startsWith("/") ? "" : "/") + cHref);
                if (!relatives.some(function(item) { return item.href === fullDest; })) {
                  relatives.push({ name: cText || targetName, href: fullDest });
                }
              }
            }

            // 1. Direct Evaluation (Card holder primary name matches)
            var cardNameDetails = parseNameDetails(cardName);
            var directNameScore = matchNameScore(targetDetails, cardNameDetails);

            // The card is named like the target but its age contradicts the record
            // (record: 72 yrs -> 1954, card: 68 -> 1958). That is a different person,
            // so the card and its self-references must never be used.
            var cardAgeMismatch = directNameScore > 0 && !isAgeWithinTolerance(targetAge, cardAge);

            if (cardAgeMismatch) {
              ageSkipped.push(cardName + " (age " + cardAge + " vs " + targetAge + ")");
            }

            // If card text mentions target person anywhere, ensure it's tracked as a relative
            if (
              !cardAgeMismatch &&
              targetName && card.textContent &&
              card.textContent.toLowerCase().includes(targetName.toLowerCase())
            ) {
              if (!relatives.some(function(item) { return isNameMatch(targetName, item.name); })) {
                relatives.push({ name: targetName, href: "" });
              }
            }

            if (directNameScore > 0 && !cardAgeMismatch) {
              var score = directNameScore + 60; // Direct card holder bonus
              score += matchAgeScore(targetAge, cardAge);

              // Check aliases bonus
              var aliasBonus = 0;
              for (var al = 0; al < aliases.length; al++) {
                aliasBonus = Math.max(aliasBonus, matchAliasScore(targetDetails, aliases[al]));
              }
              score += aliasBonus;

              candidates.push({
                cardIndex: cIdx,
                score: score,
                reportUrl: reportHref,
                isDirect: true,
                name: cardName,
                age: cardAge,
                ageDiff: (targetAge && cardAge) ? Math.abs(targetAge - cardAge) : 999
              });
            }

            // 2. Alias Evaluation (Target person might be listed under Aliases)
            // e.g. Customer: "Kennedy Fulbright", Card Name: "Sabrina Tyres Everett", Aliases: "Kennedy T Everett", Age: 51
            var bestAliasMatchScore = 0;
            var matchedAliasName = "";
            for (var alIdx = 0; alIdx < aliases.length; alIdx++) {
              var aScore = evaluateAliasMatch(targetDetails, aliases[alIdx], targetAge, cardAge);
              if (aScore > bestAliasMatchScore) {
                bestAliasMatchScore = aScore;
                matchedAliasName = aliases[alIdx];
              }
            }

            if (bestAliasMatchScore >= 80) {
              candidates.push({
                cardIndex: cIdx,
                score: bestAliasMatchScore,
                reportUrl: reportHref,
                isDirect: true, // It is the same person via alias!
                name: cardName + " (aka " + matchedAliasName + ")",
                age: cardAge,
                ageDiff: (targetAge && cardAge) ? Math.abs(targetAge - cardAge) : 999
              });
            }

            // 3. Relative Evaluation (Target person might be listed as a relative)
            for (var relI = 0; relI < relatives.length; relI++) {
              var relObj = relatives[relI];
              var relNameDetails = parseNameDetails(relObj.name);
              var relNameScore = matchNameScore(targetDetails, relNameDetails);
              if (relNameScore > 0) {
                var relScore = relNameScore + 25; // Relative base score (e.g. 100 + 25 = 125)
                var hasProfileUuid = /[a-f0-9]{8}-[a-f0-9]{4}/i.test(relObj.href || "");
                var destUrl = hasProfileUuid
                  ? (relObj.href.startsWith("http") ? relObj.href : (window.location.origin + (relObj.href.startsWith("/") ? "" : "/") + relObj.href))
                  : reportHref;
                candidates.push({
                  cardIndex: cIdx,
                  score: relScore,
                  reportUrl: destUrl,
                  isDirect: hasProfileUuid ? true : false,
                  name: relObj.name + " (Relative of " + cardName + ")",
                  age: null,
                  ageDiff: 999
                });
              }
            }
          }

          // Sort candidates by score descending, then by closest age
          candidates.sort(function (a, b) {
            if (b.score !== a.score) return b.score - a.score;
            return a.ageDiff - b.ageDiff;
          });

          var bestCandidate = candidates.length > 0 ? candidates[0] : null;

          if (bestCandidate && bestCandidate.score >= 80 && bestCandidate.reportUrl) {
            state.processed = true;
            clearInterval(interval);
            session.status = bestCandidate.isDirect ? "on_target_profile" : "on_relative_profile";
            chrome.storage.local.set({ unmask_pending_lookup: session }).catch(function () {});

            var matchLabel = bestCandidate.name + (bestCandidate.age ? " (Age " + bestCandidate.age + ")" : "");
            sendProgress(4, 4, "Matched ideal candidate: " + matchLabel + ". Loading profile...");
            window.location.href = bestCandidate.reportUrl;
            return;
          }

          // Cards are rendered but none of them is our person: move on as soon as the
          // card list has stopped changing. A list that is still filling in keeps
          // resetting the short settle window; a finished list is left immediately.
          var cardsSignature = cardsFingerprint(personCards);
          if (state.cardsSignature !== cardsSignature) {
            state.cardsSignature = cardsSignature;
            state.cardsDetectedAt = Date.now();
            return;
          }

          if (Date.now() - state.cardsDetectedAt > CARDS_SETTLE_MS) {
            var ageNote = ageSkipped.length > 0
              ? "Skipped wrong DOB: " + ageSkipped.slice(0, 3).join(", ") + ". "
              : "";
            advanceToNextAddress(ageNote + "No matching candidate on this " + pageTypeLabel + ". Checking next...");
            return;
          }
        } else {
          // Priority 1: An "age range" prompt means Unmask could not resolve this name
          // search - there is nothing usable on the page, move to the next fallback.
          if (isUnmaskAgeRangePrompt()) {
            advanceToNextAddress(
              "Unmask asked for an age range on " + pageTypeLabel + " search (no usable records). Checking next..."
            );
            return;
          }

          // Priority 2: Only if NO cards are present, check if an actual "Address/Phone/Name Not Found" dialog is VISIBLE
          if (isUnmaskAddressNotFound()) {
            advanceToNextAddress("No records on this " + pageTypeLabel + ". Moving to next...");
            return;
          }

          // Priority 3: Only if NO cards are present, check and click human verification checkbox
          var checkbox =
            document.querySelector('input[type="checkbox"][aria-label*="Address Search"]') ||
            document.querySelector('input[type="checkbox"][aria-label*="View Address Search"]') ||
            document.querySelector('input[type="checkbox"][aria-label*="Phone Search"]') ||
            document.querySelector('input[type="checkbox"][aria-label*="View Phone Search"]') ||
            document.querySelector('input[type="checkbox"][aria-label*="Name Search"]') ||
            document.querySelector('input[type="checkbox"][aria-label*="View Name Search"]') ||
            document.querySelector('input[type="checkbox"][aria-label*="Verify you are human"]') ||
            document.querySelector('input[type="checkbox"][aria-label*="human"]') ||
            document.querySelector('input[type="checkbox"][aria-label*="Verify"]') ||
            document.querySelector('input[aria-label*="Verify you are human"]') ||
            document.querySelector('input[aria-label*="View Address Search"]') ||
            document.querySelector('input[aria-label*="View Phone Search"]') ||
            document.querySelector('input[aria-label*="View Name Search"]');

          if (checkbox && isElementVisible(checkbox) && !checkbox.checked && !state.checkboxClicked) {
            state.checkboxClicked = true;
            state.checkboxClickedAt = Date.now();
            sendProgress(2, 4, "Unlocking " + pageTypeLabel + " search results...");
            await simulateHumanClick(checkbox);
            await delay(randomDelay(250, 500));
            return;
          }

          // Priority 4: nothing rendered at all. Move on quickly once the document has
          // finished loading (a still-loading page keeps a longer grace window so a
          // slow page is never skipped early).
          var elapsedSinceCheck = state.checkboxClickedAt ? (Date.now() - state.checkboxClickedAt) : (Date.now() - state.startedAt);
          var maxWait = document.readyState === "complete"
            ? (state.checkboxClickedAt ? 2000 : 2500)
            : 6000;
          if (elapsedSinceCheck > maxWait) {
            advanceToNextAddress("No records found on " + pageTypeLabel + " search. Checking next...");
            return;
          }
        }
      }
    }, TICK_MS);
  }

  // Initialize
  chrome.storage.local.get(["unmask_pending_lookup", "active_mouse_recording"], function (res) {
    if (res && res.active_mouse_recording && res.active_mouse_recording.active) {
      // Mouse recording is active on this tab - do not run search automation
      return;
    }
    var session = res ? res.unmask_pending_lookup : null;
    if (!session) return;
    runUnmaskAutomation(session);
  });
})();
