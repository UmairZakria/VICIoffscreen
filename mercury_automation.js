(function () {
  "use strict";

  function ensurePoppinsFont() {
    if (document.getElementById("mercury-automation-poppins-font")) return;
    try {
      var preconnect1 = document.createElement("link");
      preconnect1.rel = "preconnect";
      preconnect1.href = "https://fonts.googleapis.com";

      var preconnect2 = document.createElement("link");
      preconnect2.rel = "preconnect";
      preconnect2.href = "https://fonts.gstatic.com";
      preconnect2.crossOrigin = "anonymous";

      var fontLink = document.createElement("link");
      fontLink.id = "mercury-automation-poppins-font";
      fontLink.rel = "stylesheet";
      fontLink.href =
        "https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700&display=swap";

      document.head.appendChild(preconnect1);
      document.head.appendChild(preconnect2);
      document.head.appendChild(fontLink);
    } catch (e) {}
  }

  function sendProgress(step, totalSteps, message) {
    try {
      chrome.runtime.sendMessage({
        action: "VEHICLE_LOOKUP_PROGRESS",
        provider: "mercury",
        step: step,
        totalSteps: totalSteps,
        message: message,
      }).catch(function () {});
    } catch (e) {}
  }

  function sendSuccess(vehicles, profile) {
    try {
      chrome.runtime.sendMessage({
        action: "VEHICLE_LOOKUP_SUCCESS",
        provider: "mercury",
        vehicles: vehicles,
        profile: profile,
      }).catch(function () {});
    } catch (e) {}
  }

  function sendError(error) {
    try {
      chrome.runtime.sendMessage({
        action: "VEHICLE_LOOKUP_ERROR",
        provider: "mercury",
        error: error,
      }).catch(function () {});
    } catch (e) {}
  }

  function getPendingQuote(callback) {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.get(["mercury_pending_quote"], function (items) {
        if (items && items.mercury_pending_quote) {
          var quote = items.mercury_pending_quote;
          if (Date.now() - (quote.timestamp || 0) < 15 * 60 * 1000) {
            return callback(quote);
          }
        }
        callback(null);
      });
    } else {
      callback(null);
    }
  }

  function clearPendingQuote() {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.remove(["mercury_pending_quote"]);
    }
  }

  function isPoBox(addrStr) {
    if (!addrStr) return false;
    var s = String(addrStr).toLowerCase().trim();
    return /\b(p\.?\s*o\.?\s*box|post\s+office\s+box|\d+\s+po\s+box|po\s+box\s+\d+|box\s+\d+)\b/i.test(s) ||
           /^\s*p\.?\s*o\.?\s*box\b/i.test(s) ||
           /^\s*box\s+\d+/i.test(s) ||
           /\bpobox\b/i.test(s);
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function randomDelay(min, max) {
    return min + Math.random() * (max - min);
  }

  function getNativeInputSetter(input) {
    try {
      return (
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set ||
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")
          ?.set
      );
    } catch (e) {
      return null;
    }
  }

  // Human-like asynchronous typing simulator
  async function typeLikeHumanAsync(input, text) {
    if (!input || text === undefined || text === null || text === "") {
      return;
    }

    try {
      input.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    } catch (e) {}

    await delay(randomDelay(80, 200));

    try {
      input.focus();
    } catch (e) {}

    await delay(randomDelay(40, 100));

    var nativeSetter = getNativeInputSetter(input);
    var str = String(text);

    try {
      if (nativeSetter) {
        nativeSetter.call(input, "");
      } else {
        input.value = "";
      }
    } catch (e) {
      input.value = "";
    }

    try {
      input.select();
    } catch (e) {}

    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var currentValue = "";

      try {
        currentValue = input.value + ch;
      } catch (e) {
        currentValue = str.substring(0, i + 1);
      }

      try {
        if (nativeSetter) {
          nativeSetter.call(input, currentValue);
        } else {
          input.value = currentValue;
        }
      } catch (e) {
        input.value = currentValue;
      }

      try {
        var tracker = input._valueTracker;
        if (tracker) {
          tracker.setValue(currentValue);
        }
      } catch (e) {}

      try {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: ch,
            code: "Key" + ch.toUpperCase(),
            bubbles: true,
            cancelable: true,
          }),
        );
        input.dispatchEvent(
          new KeyboardEvent("keypress", {
            key: ch,
            bubbles: true,
            cancelable: true,
          }),
        );
        input.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            composed: true,
            data: ch,
            inputType: "insertText",
          }),
        );
        input.dispatchEvent(
          new KeyboardEvent("keyup", {
            key: ch,
            code: "Key" + ch.toUpperCase(),
            bubbles: true,
            cancelable: true,
          }),
        );
      } catch (e) {}

      await delay(randomDelay(15, 35));
    }

    try {
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
    } catch (e) {}

    try {
      input.classList.remove("ng-invalid", "ng-pristine", "ng-untouched", "invalid", "error");
      input.classList.add("ng-valid", "ng-dirty", "ng-touched", "filled");
    } catch (e) {}

    await delay(40);
  }

  function setSelectValue(select, value) {
    if (!select) return;

    try {
      select.focus();
    } catch (e) {}

    var options = select.options;
    var found = false;

    for (var i = 0; i < options.length; i++) {
      var optionValue = String(options[i].value || "").toLowerCase();
      var optionText = String(options[i].text || "").toLowerCase();
      var wanted = String(value || "").toLowerCase();

      if (optionValue === wanted || optionText.includes(wanted)) {
        select.selectedIndex = i;
        found = true;
        break;
      }
    }

    if (!found) return;

    try {
      var nativeSelectValueSetter =
        Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set ||
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")?.set;

      if (nativeSelectValueSetter) {
        nativeSelectValueSetter.call(select, select.value);
      }
    } catch (e) {}

    try {
      var tracker = select._valueTracker;
      if (tracker) tracker.setValue("");
    } catch (e) {}

    try {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new Event("blur", { bubbles: true }));
    } catch (e) {}
  }

  async function humanClickButton(btn) {
    if (!btn) return false;

    try {
      if (btn.disabled || btn.getAttribute("aria-disabled") === "true") {
        return false;
      }
    } catch (e) {}

    try {
      btn.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}

    await delay(randomDelay(150, 400));

    try {
      btn.focus();
    } catch (e) {}

    await delay(randomDelay(80, 200));

    try {
      btn.click();
      return true;
    } catch (e) {
      return false;
    }
  }

  function copyToClipboard(text) {
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
    try {
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(textarea);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showDiscoveredBanner(vehicles, profile) {
    ensurePoppinsFont();
    var existing = document.getElementById("mercury-discovered-vehicles-banner");
    if (existing) existing.remove();

    var banner = document.createElement("div");
    banner.id = "mercury-discovered-vehicles-banner";
    banner.style.cssText = [
      "position: fixed",
      "top: 20px",
      "right: 20px",
      "z-index: 99999999",
      "background: #0f172a",
      "color: #f1f5f9",
      "padding: 20px 24px",
      "border-radius: 16px",
      "box-shadow: 0 20px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1)",
      "font-family: 'Poppins', sans-serif !important",
      "font-weight: 300",
      "min-width: 320px",
      "max-width: 420px",
    ].join(";");

    var listHtml = vehicles
      .map(function (v) {
        return (
          '<li style="padding:8px 12px;margin-bottom:4px;background:rgba(255,255,255,0.06);border-radius:8px;font-size:13px;font-weight:400;color:#38bdf8;font-family:Poppins,sans-serif;">' +
          escapeHtml(v) +
          "</li>"
        );
      })
      .join("");

    var fullName =
      profile.fullName ||
      (profile.name
        ? (profile.name.first || "") + " " + (profile.name.last || "")
        : "Customer");

    var locationText = "";
    if (profile.address) {
      locationText =
        (profile.address.city || "") +
        (profile.address.city && profile.address.state ? ", " : "") +
        (profile.address.state || "");
    }

    banner.innerHTML = [
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">',
      '<div style="font-size:13.5px;font-weight:500;color:#22c55e;font-family:Poppins,sans-serif;">',
      "Mercury Vehicles Discovered (" + vehicles.length + ")",
      "</div>",
      '<button id="mercury-banner-close" style="background:none;border:none;color:#94a3b8;font-size:13px;font-family:Poppins,sans-serif;cursor:pointer;padding:2px 4px;">Close</button>',
      "</div>",
      '<p style="font-size:11px;color:#94a3b8;margin-bottom:10px;font-family:Poppins,sans-serif;">For: <strong>' +
        escapeHtml(fullName) +
        "</strong>" +
        (locationText ? " • " + escapeHtml(locationText) : "") +
        "</p>",
      '<ul style="list-style:none;padding:0;margin:0 0 12px 0;">' + listHtml + "</ul>",
      '<div style="font-size:11.5px;color:#22c55e;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);padding:6px 10px;border-radius:8px;text-align:center;font-family:Poppins,sans-serif;">',
      "Copied to Clipboard",
      "</div>",
    ].join("");

    document.body.appendChild(banner);

    document.getElementById("mercury-banner-close")?.addEventListener("click", function () {
      banner.remove();
    });
  }

  function getFormattedStartDate() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    var mm = (d.getMonth() + 1).toString().padStart(2, "0");
    var dd = d.getDate().toString().padStart(2, "0");
    var yyyy = d.getFullYear();
    return mm + dd + yyyy;
  }

  function findProceedButton() {
    var selectors = [
      'input[value="Proceed to Vehicles"]',
      'input[type="submit"].orange',
      ".saveContainer input[type='submit']",
      'input[type="submit"][value*="Vehicles"]',
      'button[type="submit"]',
    ];

    for (var i = 0; i < selectors.length; i++) {
      var btn = document.querySelector(selectors[i]);
      if (btn) return btn;
    }
    return null;
  }

  async function fillAndSubmitAboutYouForm(profile) {
    var firstNameInput =
      document.getElementById("firstName") ||
      document.querySelector('input[name="firstName"]');
    var middleInput =
      document.getElementById("middleName") ||
      document.querySelector('input[name="middleName"]');
    var lastNameInput =
      document.getElementById("lastName") ||
      document.querySelector('input[name="lastName"]');
    var suffixSelect =
      document.getElementById("nameSuffix") ||
      document.querySelector('select[name="suffix"]');
    var dobInput =
      document.getElementById("dateOfBirth") ||
      document.querySelector('input[name="dateOfBirth"]');
    var phoneInput =
      document.getElementById("phoneNumber") ||
      document.querySelector('input[name="phoneNumber"]');
    var emailInput =
      document.getElementById("email") ||
      document.querySelector('input[name="email"]');
    var startDateInput =
      document.getElementById("policyStartDate") ||
      document.querySelector('input[name="policyStartDate"]');
    var addressLine1Input =
      document.getElementById("addressLine1") ||
      document.querySelector('input[name="addressLine1"]');
    var addressLine2Input =
      document.getElementById("addressLine2") ||
      document.querySelector('input[name="addressLine2"]');
    var cityInput =
      document.getElementById("city") ||
      document.querySelector('input[name="city"]');
    var zipCodeInput =
      document.getElementById("postalCodeUI") ||
      document.querySelector('input[name="zipCode"]');

    var fName = profile.name && profile.name.first ? profile.name.first : "Customer";
    var lName = profile.name && profile.name.last ? profile.name.last : "User";
    var mInitial = profile.name && profile.name.middle ? profile.name.middle.charAt(0) : "";
    var dobDigits = (profile.dob || "08/15/1975").replace(/\D/g, "");
    var phoneDigits = (profile.phone || "8172944402").replace(/\D/g, "");
    var emailStr = profile.email || "customer782@gmail.com";
    var startDateDigits = getFormattedStartDate();

    var addrObj = profile.address || {};
    if (isPoBox(addrObj.street || addrObj.full) && Array.isArray(profile.allAddresses)) {
      var altAddr = profile.allAddresses.find(function (a) {
        var st = (a && (a.street || a.full) || "").trim();
        return st && !isPoBox(st);
      });
      if (altAddr) addrObj = altAddr;
    }

    var streetStr =
      addrObj && addrObj.street
        ? addrObj.street.replace(/[,]/g, "").trim()
        : "3101 Highlawn Ter";
    var unitStr =
      addrObj && addrObj.unit
        ? addrObj.unit.replace(/[,]/g, "").trim()
        : "";
    var cityStr =
      addrObj && addrObj.city
        ? addrObj.city.trim()
        : "Fort Worth";
    var zipStr =
      addrObj && addrObj.zip
        ? String(addrObj.zip).trim()
        : "76133";

    if (firstNameInput) await typeLikeHumanAsync(firstNameInput, fName);
    if (middleInput && mInitial) await typeLikeHumanAsync(middleInput, mInitial);
    if (lastNameInput) await typeLikeHumanAsync(lastNameInput, lName);

    if (suffixSelect && profile.name && profile.name.suffix) {
      var sufVal = String(profile.name.suffix).toLowerCase();
      if (sufVal === "ii") sufVal = "c_II";
      else if (sufVal === "iii") sufVal = "c_III";
      else if (sufVal === "iv") sufVal = "c_IV";
      else if (sufVal === "v") sufVal = "c_V";
      setSelectValue(suffixSelect, sufVal);
      await delay(40);
    }

    if (dobInput) await typeLikeHumanAsync(dobInput, dobDigits);
    if (phoneInput) await typeLikeHumanAsync(phoneInput, phoneDigits);
    if (emailInput) await typeLikeHumanAsync(emailInput, emailStr);
    if (startDateInput) await typeLikeHumanAsync(startDateInput, startDateDigits);
    if (addressLine1Input) await typeLikeHumanAsync(addressLine1Input, streetStr);
    if (addressLine2Input && unitStr) await typeLikeHumanAsync(addressLine2Input, unitStr);
    if (cityInput) await typeLikeHumanAsync(cityInput, cityStr);
    if (zipCodeInput && (!zipCodeInput.value || zipCodeInput.value !== zipStr)) {
      await typeLikeHumanAsync(zipCodeInput, zipStr);
    }

    await delay(300);

    var proceedBtn = findProceedButton();
    if (proceedBtn) {
      sendProgress(4, 5, "Proceeding to vehicle pre-fill results...");
      await humanClickButton(proceedBtn);
    }
  }

  function detectVehicles() {
    var vehicleSection = document.querySelector(
      ".vehicle-section, #formGroup.summary",
    );
    if (!vehicleSection) return [];

    var spans = vehicleSection.querySelectorAll(
      ".labels span, label span, .desktopView label span, .nonDesktopView .labels span, span",
    );

    var vehicles = [];
    spans.forEach(function (el) {
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (/^\d{4}\s+[A-Z0-9][A-Z0-9\s-]*$/i.test(text)) {
        if (text.length > 5 && !vehicles.includes(text)) {
          vehicles.push(text);
        }
      }
    });

    return vehicles;
  }

  function sendEmpty(message, profile) {
    try {
      chrome.runtime.sendMessage({
        action: "VEHICLE_LOOKUP_EMPTY",
        provider: "mercury",
        vehicles: [],
        message: message || "No vehicle found on Mercury",
        profile: profile,
      });
    } catch (e) {}
  }

  function checkMercuryNoVehiclesFound(state) {
    // 1. Check for manual vehicle entry fields (which only appear when pre-fill vehicles were not found)
    var manualVehicleIndicators = [
      'input[id*="vin"]',
      'input[name*="vin"]',
      '#vinNumber',
      'select[name*="vehYear"]',
      'select[name*="vehicleYear"]',
      'button[id*="addVehicle"]',
      '#addVehicleButton',
      '.add-vehicle',
      '#vehicleListContainer',
      '.vehicle-detail-section'
    ];
    for (var i = 0; i < manualVehicleIndicators.length; i++) {
      var el = document.querySelector(manualVehicleIndicators[i]);
      if (el && el.offsetParent !== null) {
        return true;
      }
    }

    // 2. Check for explicit text saying no vehicles or asking to manually enter
    var headings = document.querySelectorAll('h1, h2, h3, h4, p, span, div.title, label');
    for (var j = 0; j < headings.length; j++) {
      var t = (headings[j].textContent || '').toLowerCase();
      if (
        t.includes('no vehicles found') ||
        t.includes('add a vehicle manually') ||
        t.includes('enter your vehicle information') ||
        t.includes('we could not find any vehicles') ||
        t.includes('tell us about your vehicle')
      ) {
        return true;
      }
    }

    // 3. If step 2 has been submitted for more than 12 seconds and still no vehicles found
    if (state.step2Filled && state.step2FilledTime && (Date.now() - state.step2FilledTime > 12000)) {
      return true;
    }

    return false;
  }

  function runMercuryAutomation(profile) {
    var state = {
      startQuoteCompleted: false,
      step1Completed: false,
      step2Filling: false,
      step2Filled: false,
      step2FilledTime: 0,
      lastSubmitTime: 0,
      vehiclesFound: false,
      startedAt: Date.now(),
    };

    sendProgress(1, 5, "Starting Mercury vehicle automation...");

    function isAboutYouPage() {
      return !!(
        document.getElementById("firstName") ||
        document.querySelector('input[name="firstName"]')
      );
    }

    async function handleStartQuote() {
      if (state.startQuoteCompleted) return;

      var zipInput =
        document.getElementById("gaq-zip-code") ||
        document.querySelector('input[name="gaqZipCode"]') ||
        document.querySelector("input.quote-zip") ||
        document.querySelector("input.zipInput");

      var quoteButton =
        document.getElementById("submit-gaq") ||
        document.querySelector("button.quote-submit");

      if (!zipInput || !quoteButton) return;

      var zip = "";
      if (profile && profile.address && profile.address.zip) {
        zip = String(profile.address.zip).replace(/\D/g, "").substring(0, 5);
      }
      if (zip.length !== 5) zip = "76133";

      sendProgress(1, 5, "Entering ZIP code " + zip + " on Mercury...");

      if (String(zipInput.value || "") !== zip) {
        await typeLikeHumanAsync(zipInput, zip);
      }

      await delay(randomDelay(300, 600));

      quoteButton =
        document.getElementById("submit-gaq") ||
        document.querySelector("button.quote-submit");

      if (!quoteButton) return;

      var clicked = await humanClickButton(quoteButton);
      if (clicked) {
        state.startQuoteCompleted = true;
        state.lastSubmitTime = Date.now();
        sendProgress(2, 5, "Mercury quote initiated...");
      }
    }

    async function handleStep1() {
      if (state.step1Completed) return;

      if (isAboutYouPage()) {
        state.startQuoteCompleted = true;
        state.step1Completed = true;
        return;
      }

      if (!state.startQuoteCompleted) return;
      if (Date.now() - state.lastSubmitTime < 800) return;

      var buttons = document.querySelectorAll(
        'input[type="submit"], button[type="submit"], input[type="button"], button',
      );

      var candidate = null;
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var value = (btn.value || btn.innerText || btn.textContent || "").trim().toLowerCase();
        if (
          value.includes("start") ||
          value.includes("about you") ||
          value.includes("get started") ||
          value.includes("continue")
        ) {
          candidate = btn;
          break;
        }
      }

      if (!candidate) return;

      sendProgress(2, 5, "Navigating to About You form...");
      var clicked = await humanClickButton(candidate);
      if (clicked) {
        state.step1Completed = true;
        state.lastSubmitTime = Date.now();
      }
    }

    async function handleStep2() {
      if (state.step2Filling || state.step2Filled) return;

      var firstNameInput =
        document.getElementById("firstName") ||
        document.querySelector('input[name="firstName"]');

      if (!firstNameInput) return;

      state.startQuoteCompleted = true;
      state.step1Completed = true;
      state.step2Filling = true;

      sendProgress(3, 5, "Filling About You information...");

      try {
        await fillAndSubmitAboutYouForm(profile);
        state.step2Filled = true;
        state.step2FilledTime = Date.now();
        state.lastSubmitTime = Date.now();
      } catch (e) {
        state.step2Filling = false;
      }
    }

    var interval = setInterval(async function () {
      if (state.vehiclesFound) {
        clearInterval(interval);
        return;
      }

      if (Date.now() - state.startedAt > 90000) {
        clearInterval(interval);
        sendError("Mercury vehicle lookup timed out after 90 seconds.");
        clearPendingQuote();
        return;
      }

      if (isAboutYouPage()) {
        state.startQuoteCompleted = true;
        state.step1Completed = true;
        if (!state.step2Filled) {
          await handleStep2();
        }
        return;
      }

      var vehicles = detectVehicles();
      if (vehicles.length > 0) {
        state.vehiclesFound = true;
        clearInterval(interval);
        var clipboardText = vehicles.join("\n");
        copyToClipboard(clipboardText);
        showDiscoveredBanner(vehicles, profile);
        sendSuccess(vehicles, profile);
        clearPendingQuote();
        return;
      }

      // Check if after submitting About You, no vehicles were found on Mercury
      if (state.step2Filled && checkMercuryNoVehiclesFound(state)) {
        state.vehiclesFound = false;
        clearInterval(interval);
        sendEmpty("No vehicle found on Mercury", profile);
        clearPendingQuote();
        return;
      }

      if (!state.startQuoteCompleted) {
        await handleStartQuote();
        return;
      }

      if (!state.step1Completed) {
        await handleStep1();
        return;
      }

      if (!state.step2Filled) {
        await handleStep2();
        return;
      }
    }, 500);

    setTimeout(function () {
      if (isAboutYouPage()) {
        handleStep2().catch(function () {});
        return;
      }
      if (!state.startQuoteCompleted) {
        handleStartQuote().catch(function () {});
      }
    }, 500);
  }

  getPendingQuote(function (profile) {
    if (!profile) return;
    ensurePoppinsFont();
    runMercuryAutomation(profile);
  });
})();
