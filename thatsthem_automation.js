// Content script for ThatSthem.com DOB discovery (fallback after Unmask.com).
// Injected into https://thatsthem.com/* and https://*.thatsthem.com/*.
//
// Search order on ThatSthem (planned by background.js):
//   1. name search    https://thatsthem.com/name/Deborah-Williams/Houston-TX-77047
//   2. every address  https://thatsthem.com/address/3724-Kildare-Dr-Houston-TX-77047
//   3. phone          https://thatsthem.com/phone/713-252-6330
//
// The result cards already carry the date of birth, e.g.
//   <p> Born October 1958 (67 years old) </p>
// so the DOB is read straight from the search results - no profile page has to be
// opened. Name / age(DOB) / zip matching is the same as the Unmask automation's.

(function () {
  "use strict";

  if (window.__thatsThemAutomationLoaded) return;
  window.__thatsThemAutomationLoaded = true;

  var SESSION_KEY = "thatsthem_pending_lookup";

  // ---- same rules as unmask_automation.js ----------------------------------
  var MATCH_AGE_TOLERANCE = 3;
  var DOB_YEAR_TOLERANCE = 3;
  var MIN_BIRTH_YEAR = 1912;
  var MAX_PLAUSIBLE_AGE = 110;
  var ACCEPT_SCORE = 80;

  // ---- timing --------------------------------------------------------------
  var TICK_MS = 150; // how often the page state is re-checked
  var CARDS_SETTLE_MS = 500; // unchanged card list for this long -> move on
  var PAGE_TIMEOUT_MS = 7000; // loaded page that renders nothing at all
  var PAGE_LOADING_TIMEOUT_MS = 12000; // ...while the document is still loading
  var BROWSER_CHECK_MAX_MS = 90000; // how long to wait out the bot-check page

  // The Turnstile widget sits in a closed shadow root, so the extension cannot click it:
  // ask the background worker to bring this tab to the front so a human can.
  function focusThisTab() {
    try {
      chrome.runtime.sendMessage({ action: "FOCUS_LOOKUP_TAB" });
    } catch (e) {}
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ---- Trusted click target resolution -------------------------------------
  // The Turnstile widget sits in a closed shadow root, so nothing inside it reacts to DOM
  // events: the old "Engine 1" (replaying the recorded cursor path and firing synthetic
  // pointer/mouse events) never cleared the check because Cloudflare only trusts real
  // input. The only engine left is Engine 2 - a genuine OS-level click that background.js
  // dispatches over the Chrome DevTools Protocol. All this side has to do is resolve the
  // viewport coordinates of the Turnstile checkbox.
  function findTurnstileElement() {
    var iframe = document.querySelector(
      "#captcha-container iframe, .cf-turnstile iframe, iframe[src*='challenges.cloudflare.com'], iframe[src*='turnstile']"
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

    return document.querySelector("#captcha-container, .cf-turnstile");
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
  // with freshly measured coordinates until the check page is gone - the caps below only stop
  // a widget that will never clear from being clicked forever.
  var TRUSTED_CLICK_SETTLE_MS = 600; // let the widget render before the first click
  var TRUSTED_CLICK_GAP_MS = 3000; // gap between two trusted clicks
  var TRUSTED_CLICK_MAX = 30; // ~90s of clicking: the run's own budget stops it first
  var TRUSTED_CLICK_FOCUS_AFTER = 3; // surface the tab once this many clicks did nothing

  // True on the tick after the widget settled, then once per gap, until the cap is reached.
  // The branch itself decides when to stop: the moment the check page is gone this is never
  // asked again.
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

  // Fingerprint of the parsed cards: changes while the list is still filling in, so the
  // run only moves on once the page has actually stopped changing.
  function recordsFingerprint(records) {
    if (!records || !records.length) return "";
    var parts = [String(records.length)];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      parts.push([r.name, r.year || "", r.age || "", r.zip || "", r.street || ""].join("~"));
    }
    return parts.join("|");
  }

  // ThatSthem answers automated visits with a sentinel/Turnstile security page (title
  // "Security Check", #captcha-container with a Cloudflare Turnstile). Nothing can be
  // read while it is up, so the run has to wait for it instead of treating the page as
  // "no records" and moving on.
  function isBrowserCheckPage() {
    if (document.querySelector("meta[name='sentinel-challenge'], meta[name='sentinel-ticket']")) return true;
    if (/security check|checking your browser|just a moment|verify you are human/i.test(document.title || "")) {
      return true;
    }

    var captcha = document.querySelector("#captcha-container, .cf-turnstile");
    if (captcha && isElementVisible(captcha)) return true;

    var title = document.querySelector("#title");
    if (title && /checking your browser|confirm you'?re human|verifying/i.test(cleanText(title.textContent))) {
      return true;
    }

    var description = document.querySelector("#description");
    if (description && /complete the check below/i.test(cleanText(description.textContent))) return true;

    var status = document.querySelector("#status");
    if (status && /completing verification|verification in progress/i.test(cleanText(status.textContent))) {
      return true;
    }

    return false;
  }

  function isBrowserCheckFailed() {
    var failed = document.querySelector("#failed");
    if (failed && !failed.classList.contains("hidden")) return true;
    var retry = document.querySelector("#retry");
    return !!(retry && !retry.classList.contains("hidden"));
  }

  // "Try again" is offered when the check failed - click it once per appearance.
  function clickBrowserCheckRetry() {
    if (!isBrowserCheckFailed()) return false;
    var retry = document.querySelector("#retry");
    if (!retry || retry.getAttribute("data-dnc-clicked") === "1") return false;
    retry.setAttribute("data-dnc-clicked", "1");
    try {
      retry.click();
    } catch (e) {}
    return true;
  }

  var STATE_NAME_TO_CODE = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "district of columbia": "DC",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA",
    "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY"
  };

  function currentYear() {
    return new Date().getFullYear();
  }

  function cleanText(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeZip(value) {
    var digits = String(value || "").replace(/\D/g, "");
    return digits.length >= 5 ? digits.substring(0, 5) : "";
  }

  function stateToCode(value) {
    var s = cleanText(value);
    if (!s) return "";
    if (s.length === 2) return s.toUpperCase();
    return STATE_NAME_TO_CODE[s.toLowerCase()] || s.toUpperCase();
  }

  function sameWord(a, b) {
    return !!a && !!b && cleanText(a).toLowerCase() === cleanText(b).toLowerCase();
  }

  function isElementVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    var style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  // ---- messaging (the same actions the Unmask run uses) --------------------
  function sendProgress(step, totalSteps, message) {
    try {
      chrome.runtime.sendMessage({
        action: "DOB_LOOKUP_PROGRESS",
        step: step,
        totalSteps: totalSteps,
        message: message
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
        source: "thatsthem.com",
        placeholder: !!opts.placeholder,
        continueSearch: !!opts.continueSearch,
        yearOnly: !!opts.yearOnly
      });
    } catch (e) {}
  }

  function copyToClipboard(text) {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () {});
      }
    } catch (e) {}
  }

  // Ask the background worker for the next ThatSthem step (address / phone / give up)
  function requestNextStep(reason) {
    if (reason) sendProgress(5, 6, reason);
    try {
      chrome.runtime.sendMessage({ action: "DOB_LOOKUP_NEXT_ADDRESS" }, function (res) {
        if (res && res.nextUrl && !res.exhausted) {
          if (window.location.href !== res.nextUrl) window.location.href = res.nextUrl;
        }
      });
    } catch (e) {}
  }

  // ---- name rules (identical to unmask_automation.js) ----------------------
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
    var first = "",
      middle = "",
      last = "";

    if (raw.includes(",")) {
      var commaParts = raw.split(",");
      last = normalizeName(commaParts[0]);
      var rest = normalizeName(commaParts.slice(1).join(" "))
        .split(" ")
        .filter(Boolean);
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
    return {
      first: first,
      middle: middle,
      middleInitial: middleInitial,
      last: last,
      full: [first, middle, last].filter(Boolean).join(" "),
      raw: raw
    };
  }

  function matchNameScore(target, cand) {
    if (!target.first || !cand.first || !target.last || !cand.last) return -100;

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

    if (target.first === cand.first) {
      score += 50;
    } else if (
      (target.first.length > 2 && cand.first.startsWith(target.first)) ||
      (cand.first.length > 2 && target.first.startsWith(cand.first)) ||
      target.first.charAt(0) === cand.first.charAt(0)
    ) {
      score += 25;
    } else {
      return -100;
    }

    if (target.middle && cand.middle) {
      if (target.middle === cand.middle) {
        score += 40;
      } else if (
        target.middleInitial === cand.middleInitial ||
        target.middle.startsWith(cand.middle) ||
        cand.middle.startsWith(target.middle)
      ) {
        score += 35;
      } else {
        score -= 20;
      }
    } else if (target.middle && !cand.middle) {
      score += 10;
    } else if (!target.middle && cand.middle) {
      score += 15;
    }

    return score;
  }

  function matchAliasScore(target, aliasStr) {
    if (!aliasStr) return 0;
    var a = parseNameDetails(aliasStr);
    if (!a.last || a.last !== target.last) return 0;

    if (a.first.length === 1 && a.first === target.first.charAt(0)) {
      if ((a.middle && a.middle.length === 1 && a.middle === target.middleInitial) || !a.middle) {
        return 30;
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

    // Both first and last name match the target
    var nameScore = matchNameScore(target, a);
    if (nameScore > 0) {
      if (ageKnown && !isAgeWithinTolerance(targetAge, cardAge)) return 0;
      return nameScore + 50;
    }

    // Only the first name matches
    if (target.first && a.first && target.first === a.first) {
      var score = 65;
      if (ageKnown) {
        var diff = Math.abs(targetAge - cardAge);
        if (diff === 0) score += 45;
        else if (diff === 1) score += 35;
        else if (diff === 2) score += 25;
        else if (diff === 3) score += 20;
        else score -= 60;
      }
      return score;
    }

    // Only the last name matches
    if (target.last && a.last && target.last === a.last) {
      if (ageKnown && !isAgeWithinTolerance(targetAge, cardAge)) return 0;
      var score2 = 45;
      if (ageKnown && Math.abs(targetAge - cardAge) <= 1) score2 += 40;
      return score2;
    }

    return 0;
  }

  function matchAgeScore(targetAge, cardAge) {
    if (!targetAge || !cardAge) return 15; // Unknown age: neutral
    var diff = Math.abs(targetAge - cardAge);
    if (diff === 0) return 40;
    if (diff === 1) return 35;
    if (diff === 2) return 25;
    if (diff === 3) return 15;
    return -50; // Beyond tolerance: the caller rejects the card
  }

  function isAgeWithinTolerance(targetAge, cardAge) {
    if (!targetAge || !cardAge) return true;
    return Math.abs(targetAge - cardAge) <= MATCH_AGE_TOLERANCE;
  }

  // ---- card text parsers (pure: unit tested against the real page markup) --

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

  // "Born October 1958 (67 years old)" -> { label: "October 1958", year: 1958, age: 67 }
  function parseBornText(text) {
    var t = cleanText(text);
    if (!t) return null;

    var m = t.match(
      /born\s+([A-Za-z]{3,9})\.?\s+(\d{4})(?:\s*\(\s*(\d{1,3})\s*(?:years?|yrs?)?\s*(?:old)?\s*\))?/i
    );
    if (m && isMonthName(m[1])) {
      var year = parseInt(m[2], 10);
      if (year < MIN_BIRTH_YEAR || year > currentYear()) return null;
      var month = formatMonthName(m[1]);
      return {
        label: month + " " + year,
        month: month,
        year: year,
        age: m[3] ? parseInt(m[3], 10) : null
      };
    }

    // "Born 1958 (67 years old)" - no month on the card
    var m2 = t.match(/born\s+(\d{4})(?:\s*\(\s*(\d{1,3})\s*(?:years?|yrs?)?\s*(?:old)?\s*\))?/i);
    if (m2) {
      var yearOnly = parseInt(m2[1], 10);
      if (yearOnly < MIN_BIRTH_YEAR || yearOnly > currentYear()) return null;
      return {
        label: String(yearOnly),
        month: "",
        year: yearOnly,
        age: m2[2] ? parseInt(m2[2], 10) : null
      };
    }

    // "(67 years old)" only - usable for matching, not a date of birth
    var m3 = t.match(/(\d{1,3})\s*(?:years?|yrs?)\s*old/i);
    if (m3) {
      var ageOnly = parseInt(m3[1], 10);
      if (ageOnly > 0 && ageOnly <= MAX_PLAUSIBLE_AGE) {
        return { label: "", month: "", year: null, age: ageOnly };
      }
    }

    return null;
  }

  // "Lives in Houston, TX" -> { city: "Houston", state: "TX" }
  function parseLivesIn(text) {
    var t = cleanText(text);
    var m = t.match(/lives\s+in\s+(.+?),\s*([A-Za-z .'-]+)\s*$/i);
    if (!m) return null;
    var city = cleanText(m[1]);
    var state = stateToCode(m[2]);
    if (!city && !state) return null;
    return { city: city, state: state };
  }

  // "Known as: Deborah D. Clifton • Deborah Doreen Williams" -> [names]
  function parseKnownAs(text) {
    var t = cleanText(text);
    var idx = t.toLowerCase().indexOf("known as");
    if (idx === -1) return [];
    var rest = t.slice(idx + "known as".length).replace(/^[:\s]+/, "");
    return rest
      .split(/[•·|]/)
      .map(function (part) {
        return cleanText(part).replace(/^[,;]+|[,;]+$/g, "");
      })
      .filter(function (part) {
        return part.length > 2 && /\s/.test(part);
      });
  }

  // "Houston, TX 77047" -> { city, state, zip }
  function parseCityStateZip(text) {
    var t = cleanText(text);
    var m = t.match(/^(.+?),\s*([A-Za-z .'-]+?)\s+(\d{5})(?:-\d{4})?$/);
    if (m) return { city: cleanText(m[1]), state: stateToCode(m[2]), zip: normalizeZip(m[3]) };

    var m2 = t.match(/^(.+?),\s*([A-Za-z .'-]+)$/);
    if (m2) return { city: cleanText(m2[1]), state: stateToCode(m2[2]), zip: "" };

    return null;
  }

  // Fallback parser for a flattened "3724 Kildare Dr Houston, TX 77047" block
  function parseAddressBlock(text) {
    var t = cleanText(text).replace(/^current address:?/i, "").trim();
    if (!t) return null;

    var withCommas = t.match(/^(.*?),\s*(.+?),\s*([A-Za-z]{2})\s+(\d{5})\s*$/);
    if (withCommas) {
      return {
        street: cleanText(withCommas[1]),
        city: cleanText(withCommas[2]),
        state: stateToCode(withCommas[3]),
        zip: normalizeZip(withCommas[4])
      };
    }

    // Greedy street group: the city is the single word right before the comma
    var flat = t.match(/^(.+)\s+([A-Za-z]+),\s*([A-Za-z]{2})\s+(\d{5})\s*$/);
    if (flat) {
      return {
        street: cleanText(flat[1]),
        city: cleanText(flat[2]),
        state: stateToCode(flat[3]),
        zip: normalizeZip(flat[4])
      };
    }

    return { street: t, city: "", state: "", zip: "" };
  }

  // ---- DOM extraction ------------------------------------------------------

  function streetKey(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  // All addresses shown for a card: "Current Address" plus every "Previous Addresses"
  // entry. A record's address is often the person's *previous* one, so the zip/street
  // check has to look at the whole list, not just the current address.
  function readAddressList(container) {
    var addresses = [];
    var wrappers = Array.from(container.querySelectorAll("span[x-href]"));
    if (wrappers.length === 0) wrappers = Array.from(container.querySelectorAll("span"));

    wrappers.forEach(function (wrapper) {
      var lines = Array.from(wrapper.querySelectorAll("div"))
        .map(function (div) {
          return cleanText(div.textContent);
        })
        .filter(Boolean);
      if (lines.length < 2) return;

      var cityStateZip = parseCityStateZip(lines[1]);
      if (!cityStateZip) return;

      addresses.push({
        street: lines[0],
        city: cityStateZip.city,
        state: cityStateZip.state,
        zip: cityStateZip.zip
      });
    });

    return addresses;
  }

  // One ThatSthem result card ("div.record") -> plain record data
  function readRecord(card) {
    if (!card) return null;

    var nameEl = card.querySelector("h2 span[x-href]") || card.querySelector("h2");
    var name = cleanText(nameEl ? nameEl.textContent : "");
    if (!name) return null;

    var record = {
      name: name,
      nameDetails: parseNameDetails(name),
      aliases: [],
      dob: null,
      year: null,
      age: null,
      city: "",
      state: "",
      zip: "",
      street: "",
      addresses: []
    };

    // "Lives in Houston, TX" / "Born October 1958 (67 years old)" / "Known as: ..."
    Array.from(card.querySelectorAll("p")).forEach(function (p) {
      var text = cleanText(p.textContent);
      if (!text) return;

      if (/^known\s+as/i.test(text)) {
        var aliasNames = Array.from(p.querySelectorAll("span[x-href]"))
          .map(function (el) {
            return cleanText(el.textContent);
          })
          .filter(Boolean);
        record.aliases = aliasNames.length > 0 ? aliasNames : parseKnownAs(text);
        return;
      }

      if (!record.dob && /\bborn\b/i.test(text)) {
        var parsedDob = parseBornText(text);
        if (parsedDob) {
          record.dob = parsedDob;
          record.year = parsedDob.year;
          record.age = parsedDob.age;
        }
        return;
      }

      if (!record.city && /lives\s+in/i.test(text)) {
        var parsedLocation = parseLivesIn(text);
        if (parsedLocation) {
          record.city = parsedLocation.city;
          record.state = parsedLocation.state;
        }
      }
    });

    // "Current Address:" plus every "Previous Addresses:" entry. The zip / street check
    // later looks at this whole list, because a record's address is often an older one.
    var currentAddresses = [];
    var previousAddresses = [];

    Array.from(card.querySelectorAll("h3")).forEach(function (heading) {
      var label = cleanText(heading.textContent).toLowerCase();
      if (label.indexOf("current address") === -1 && label.indexOf("previous address") === -1) return;

      var container = heading.parentElement || heading;
      var list = readAddressList(container);
      if (!list.length) {
        var flat = parseAddressBlock(cleanText(container.textContent));
        if (flat && flat.street) list = [flat];
      }

      if (label.indexOf("current address") !== -1) currentAddresses = currentAddresses.concat(list);
      else previousAddresses = previousAddresses.concat(list);
    });

    record.addresses = currentAddresses.concat(previousAddresses);
    var primaryAddress = currentAddresses[0] || previousAddresses[0] || null;
    if (primaryAddress) {
      record.street = primaryAddress.street || "";
      record.zip = primaryAddress.zip || "";
      if (!record.city) record.city = primaryAddress.city || "";
      if (!record.state) record.state = primaryAddress.state || "";
    }

    // Some cards show the age without a "Born ..." line
    if (!record.age) {
      var ageMatch = cleanText(card.textContent).match(/(\d{1,3})\s*(?:years?|yrs?)\s*old/i);
      if (ageMatch) record.age = parseInt(ageMatch[1], 10);
    }

    return record;
  }

  function readRecords() {
    return Array.from(document.querySelectorAll("div.record"))
      .map(readRecord)
      .filter(Boolean);
  }

  function isNoResultsPage() {
    var headings = Array.from(document.querySelectorAll("h1, h2, h3"));
    for (var i = 0; i < headings.length; i++) {
      if (isElementVisible(headings[i]) && /no results found/i.test(cleanText(headings[i].textContent))) {
        return true;
      }
    }
    var body = cleanText(document.body ? document.body.innerText : "");
    return /couldn'?t find any records matching your search/i.test(body);
  }

  // ---- matching: name + age/DOB + zip, exactly like the Unmask run ---------
  function evaluateRecord(target, record) {
    var directScore = matchNameScore(target.details, record.nameDetails);
    var isDirect = directScore > 0;
    var bestAliasScore = 0;
    var bestAliasName = "";

    record.aliases.forEach(function (alias) {
      var aliasScore = evaluateAliasMatch(target.details, alias, target.age, record.age);
      if (aliasScore > bestAliasScore) {
        bestAliasScore = aliasScore;
        bestAliasName = alias;
      }
    });

    // No name match at all -> this card is somebody else
    if (!isDirect && bestAliasScore < ACCEPT_SCORE) return null;

    // Age / DOB gate: a 1958 card can never answer a "72 yrs (1954)" record
    if (target.age && record.age && !isAgeWithinTolerance(target.age, record.age)) return null;
    if (target.year && record.year && Math.abs(target.year - record.year) > DOB_YEAR_TOLERANCE) return null;

    // Zip / street gate: the record's address counts when it appears ANYWHERE on the
    // card - current address or any previous address. People move, and the record often
    // holds the older address, so checking only the current zip rejects the right card.
    var cardZips = (record.addresses || [])
      .map(function (addr) {
        return addr.zip;
      })
      .filter(Boolean);
    if (target.zip && cardZips.length > 0 && cardZips.indexOf(target.zip) === -1) return null;

    var cardStreets = (record.addresses || [])
      .map(function (addr) {
        return addr.street;
      })
      .filter(Boolean);
    var streetMatches = !!target.street && cardStreets.some(function (s) {
      var a = streetKey(s);
      var b = streetKey(target.street);
      return a && b && (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1);
    });

    if (target.state && record.state && target.state !== record.state) return null;

    var score = isDirect ? directScore : bestAliasScore;
    score += matchAgeScore(target.age, record.age);
    // A date with a month (and day) is far more useful than a bare birth year, so it
    // wins when a page holds both kinds of card.
    if (record.dob && record.dob.month) score += 25;
    if (target.zip && cardZips.indexOf(target.zip) !== -1) score += 25;
    if (target.city && record.city && sameWord(target.city, record.city)) score += 10;
    if (target.state && record.state && target.state === record.state) score += 5;
    if (streetMatches) score += 30;

    return {
      score: score,
      name: record.name,
      matchedAs: isDirect ? record.name : bestAliasName,
      isDirect: isDirect,
      dob: record.dob,
      year: record.year,
      age: record.age,
      city: record.city,
      state: record.state,
      zip: record.zip,
      street: record.street,
      addresses: record.addresses
    };
  }

  function buildTarget(session) {
    var addresses = (session && session.addresses) || [];
    var primary = addresses[0] || {};

    var zip = normalizeZip(primary.zip);
    if (!zip) {
      for (var i = 0; i < addresses.length && !zip; i++) {
        zip = normalizeZip(addresses[i] && addresses[i].zip);
      }
    }

    var city = session.city || primary.city || "";
    var state = stateToCode(session.state || primary.state || "");

    return {
      name: (session && session.targetName) || "",
      details: parseNameDetails((session && session.targetName) || ""),
      age: (session && session.targetAge) || null,
      year: (session && session.targetYear) || null,
      city: city,
      state: state,
      zip: zip,
      street: primary.street || primary.full || "",
      person: (session && session.person) || null
    };
  }

  // ---- run loop ------------------------------------------------------------
  chrome.storage.local.get([SESSION_KEY, "active_mouse_recording"], function (res) {
    if (res && res.active_mouse_recording && res.active_mouse_recording.active) {
      // Mouse recording is active on this tab - do not run search automation
      return;
    }
    var session = res ? res[SESSION_KEY] : null;
    if (!session || session.stage !== "thatsthem") return;

    var target = buildTarget(session);
    if (!target.details.last) return; // nothing usable to match on

    var state = {
      processed: false,
      startedAt: Date.now(),
      cardsSeenAt: 0,
      cardsSignature: "",
      reportedWeak: false,
      checkedAt: 0,
      focusAsked: false,
      challengeReplayInProgress: false,
      challengeClicks: 0,
      challengeLastClickAt: 0,
      lastCalibratedCoords: null
    };
    var interval = null;

    function finish(dob) {
      if (state.processed) return;
      state.processed = true;
      if (interval) clearInterval(interval);
      copyToClipboard(dob);
      sendSuccess(dob, target.person);
    }

    function next(reason) {
      if (state.processed) return;
      state.processed = true;
      if (interval) clearInterval(interval);
      requestNextStep(reason);
    }

    var where = [target.city, target.state].filter(Boolean).join(", ");
    sendProgress(5, 6, "ThatSthem: matching " + (target.name || "target") + (where ? " (" + where + ")" : "") + "...");

    interval = setInterval(async function () {
      if (state.processed) return;

      var records = readRecords();

      if (records.length > 0) {
        // Restart the settle window while the card list is still changing
        var cardsSignature = recordsFingerprint(records);
        if (state.cardsSignature !== cardsSignature) {
          state.cardsSignature = cardsSignature;
          state.cardsSeenAt = Date.now();
        }
        if (!state.cardsSeenAt) state.cardsSeenAt = Date.now();

        var candidates = [];
        records.forEach(function (record) {
          var match = evaluateRecord(target, record);
          if (match && match.dob && match.dob.label) candidates.push(match);
        });
        candidates.sort(function (a, b) {
          return b.score - a.score;
        });

        var best = candidates[0] || null;
        if (best && best.score >= ACCEPT_SCORE && best.dob.month) {
          finish(best.dob.label);
          return;
        }

        // The card matched but it only shows a birth year (no month). Report it as the
        // weak value (shown as DOB 1) and let the background worker walk the remaining
        // steps so a fuller date can still be reported next to it.
        if (best && best.score >= ACCEPT_SCORE && !state.reportedWeak) {
          state.reportedWeak = true;
          state.processed = true;
          if (interval) clearInterval(interval);
          copyToClipboard(best.dob.label);
          sendSuccess(best.dob.label, target.person, [], { continueSearch: true, yearOnly: true });
          sendProgress(5, 6, "ThatSthem only shows the birth year " + best.dob.label + " - checking the next step...");
          return;
        }

        // Cards are rendered but none of them is our person
        if (Date.now() - state.cardsSeenAt > CARDS_SETTLE_MS) {
          next("ThatSthem: no matching record here. Checking next...");
        }
        return;
      }

      // The automated "Checking your browser" interstitial has to be waited out: an empty
      // page here is not the same as "no records", so never advance past it.
      if (isBrowserCheckPage()) {
        if (!state.checkedAt) {
          state.checkedAt = Date.now();
          sendProgress(5, 6, "ThatSthem asks for a human check - preparing calibration...");
        } else if (clickBrowserCheckRetry()) {
          sendProgress(5, 6, "ThatSthem asked for the browser check again - retrying...");
        }

        if (state.challengeReplayInProgress) return;

        // The check only clears for a real input event, so the trusted click (Engine 2) is
        // dispatched straight away. Engine 1 (replaying the recorded cursor path with
        // synthetic DOM events) is gone - Cloudflare ignores untrusted events.
        // The first click waits for the widget to render, and clicks are then repeated once
        // per gap until the check page is gone - each one measured again, because the widget
        // re-renders (and can move) after every attempt.
        if (trustedClickDue(state.challengeClicks, state.checkedAt, state.challengeLastClickAt, Date.now())) {
          state.challengeReplayInProgress = true;
          var isRetry = state.challengeClicks > 0;
          state.challengeClicks += 1;
          state.challengeLastClickAt = Date.now();
          chrome.storage.local.get(["recorded_macro_thatsthem", "last_macro_recording"], async function (res) {
            var macro = res ? (res.recorded_macro_thatsthem || res.last_macro_recording) : null;
            var point = resolveTrustedClickPoint(macro);
            state.lastCalibratedCoords = { x: point.x, y: point.y };

            sendProgress(5, 6, "ThatSthem: " + (isRetry ? "retrying trusted click (Engine 2) at " : "trusted click (Engine 2) at ") + point.x + ", " + point.y + " [" + point.source + "] (attempt " + state.challengeClicks + "/" + TRUSTED_CLICK_MAX + ")...");
            var clicked = await replayMacroEngine2(point.x, point.y);
            if (clicked) showClickRipple(point.x, point.y);
            state.challengeReplayInProgress = false;
            sendProgress(5, 6, clicked ? "ThatSthem: Engine 2 click dispatched. Verifying resolution..." : "ThatSthem: Engine 2 click could not be sent - verifying resolution...");
          });
          return;
        }

        // A stubborn check gets a human nudge as well: surface the tab once, while the
        // trusted clicks keep coming.
        if (state.challengeClicks >= TRUSTED_CLICK_FOCUS_AFTER && !state.focusAsked) {
          state.focusAsked = true;
          focusThisTab();
          sendProgress(5, 6, "ThatSthem is still asking for the check - retrying the click; please confirm it in its tab too...");
          return;
        }

        if (Date.now() - state.checkedAt > BROWSER_CHECK_MAX_MS) {
          next("ThatSthem: browser verification did not complete. Checking next...");
        }
        return;
      }

      // Verification cleared (or was never shown): give the results a full window.
      if (state.checkedAt) {
        state.checkedAt = 0;
        state.challengeClicks = 0;
        state.challengeLastClickAt = 0;
        state.focusAsked = false;
        state.cardsSeenAt = 0;
        state.startedAt = Date.now();
        sendProgress(5, 6, "Browser verification passed - reading ThatSthem results...");
      }

      // No cards at all: is this the explicit "No Results Found" panel?
      if (isNoResultsPage()) {
        next("ThatSthem: no records found. Checking next...");
        return;
      }

      if (Date.now() - state.startedAt > (document.readyState === "complete" ? PAGE_TIMEOUT_MS : PAGE_LOADING_TIMEOUT_MS)) {
        next("ThatSthem: page timed out. Checking next...");
      }
    }, TICK_MS);
  });
})();
