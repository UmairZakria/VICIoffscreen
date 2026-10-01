document.addEventListener('DOMContentLoaded', () => {
  if (window.DNCAuthClient) {
    window.DNCAuthClient.init();
  }

  const phoneInput = document.getElementById('phone-input');
  const searchBtn = document.getElementById('search-btn');
  const clearBtn = document.getElementById('clear-btn');
  const popoutBtn = document.getElementById('popout-btn');
  const headerDot = document.getElementById('header-dot');

  const statusContainer = document.getElementById('status-container');
  const statusText = document.getElementById('status-text');
  const errorContainer = document.getElementById('error-container');
  const errorText = document.getElementById('error-text');
  const resultsContainer = document.getElementById('results-container');

  // Person Card Elements
  const personCard = document.getElementById('person-card');
  const personAvatar = document.getElementById('person-avatar');
  const personName = document.getElementById('person-name');
  const personAge = document.getElementById('person-age');
  const personStreet = document.getElementById('person-street');
  const personCityState = document.getElementById('person-citystate');
  const copyNameBtn = document.getElementById('copy-name-btn');
  const copyAddrBtn = document.getElementById('copy-addr-btn');
  const personAmicaBtn = document.getElementById('person-amica-btn');
  const personDobBtn = document.getElementById('person-dob-btn');
  const personEmailBtn = document.getElementById('person-email-btn');
  const personGenderBtn = document.getElementById('person-gender-btn');
  const dobResultsBox = document.getElementById('card-dob-results');
  const dobResultsCountLabel = document.getElementById('dob-results-count-label');
  const dobBadgesContainer = document.getElementById('dob-badges-container');
  const emailResultsBox = document.getElementById('card-email-results');
  const emailResultsCountLabel = document.getElementById('email-results-count-label');
  const emailBadgesContainer = document.getElementById('email-badges-container');

  // Vehicle Elements
  const vehicleProgressBox = document.getElementById('card-vehicle-progress');
  const vehicleProviderTag = document.getElementById('vehicle-provider-tag');
  const vehicleProgressStatus = document.getElementById('vehicle-progress-status');
  const vehicleProgressFill = document.getElementById('vehicle-progress-fill');
  const vehicleCancelBtn = document.getElementById('vehicle-cancel-btn');
  const vehicleResultsBox = document.getElementById('card-vehicle-results');
  const vehicleResultsCountLabel = document.getElementById('vehicle-results-count-label');
  const vehicleBadgesContainer = document.getElementById('vehicle-badges-container');
  const copyAllVehiclesBtn = document.getElementById('copy-all-vehicles-btn');

  // Compliance Elements
  const valDnc = document.getElementById('val-dnc');
  const valLitigator = document.getElementById('val-litigator');
  const valBlacklist = document.getElementById('val-blacklist');

  // Summary Elements
  const rawOutput = document.getElementById('raw-output');
  const copyAllBtn = document.getElementById('copy-all-btn');
  const copyAllLabel = document.getElementById('copy-all-label');

  // Mode Toggle Elements
  const modeManualBtn = document.getElementById('mode-manual-btn');
  const modeAutoBtn = document.getElementById('mode-auto-btn');
  const autoPulseDot = document.getElementById('auto-pulse-dot');
  const autoFeedbackBar = document.getElementById('auto-feedback-bar');
  const autoFeedbackText = document.getElementById('auto-feedback-text');

  let currentLookupMode = 'manual'; // 'manual' | 'auto'
  let autoPollTimer = null;
  let lastAutoLookedUpPhone = '';

  function setLookupMode(mode, save = true) {
    currentLookupMode = mode;
    if (save && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ lookupMode: mode });
    }

    if (mode === 'auto') {
      if (modeManualBtn) modeManualBtn.classList.remove('active');
      if (modeAutoBtn) modeAutoBtn.classList.add('active');
      if (autoPulseDot) autoPulseDot.classList.remove('hidden');
      if (autoFeedbackBar) autoFeedbackBar.classList.remove('hidden');
      startAutoLookup();
    } else {
      if (modeAutoBtn) modeAutoBtn.classList.remove('active');
      if (modeManualBtn) modeManualBtn.classList.add('active');
      if (autoPulseDot) autoPulseDot.classList.add('hidden');
      if (autoFeedbackBar) autoFeedbackBar.classList.add('hidden');
      stopAutoLookup();
      setLoading(false);
      hideStatus();
      hideError();
    }
  }

  if (modeManualBtn) modeManualBtn.addEventListener('click', () => setLookupMode('manual'));
  if (modeAutoBtn) modeAutoBtn.addEventListener('click', () => setLookupMode('auto'));

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['lookupMode'], (res) => {
      if (res.lookupMode === 'auto') {
        setLookupMode('auto', false);
      } else {
        setLookupMode('manual', false);
      }
    });
  }

  function handleAutoDetectedPhone(rawPhone) {
    if (window.DNCAuthClient && !window.DNCAuthClient.isAuthenticated()) {
      return;
    }
    if (rawPhone && rawPhone.length === 10 && rawPhone !== lastAutoLookedUpPhone) {
      lastAutoLookedUpPhone = rawPhone;
      const formatted = `(${rawPhone.slice(0, 3)}) ${rawPhone.slice(3, 6)}-${rawPhone.slice(6, 10)}`;
      phoneInput.value = formatted;
      if (autoFeedbackBar) autoFeedbackBar.classList.remove('waiting');
      if (autoFeedbackText) autoFeedbackText.textContent = `Auto-detected: ${rawPhone} · Looking up...`;
      searchBtn.click();
    }
  }

  async function checkActiveTabPhone() {
    if (currentLookupMode !== 'auto') return;
    if (window.DNCAuthClient && !window.DNCAuthClient.isAuthenticated()) return;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      for (const t of tabs) {
        if (t && t.id && !t.url?.startsWith('chrome://') && !t.url?.startsWith('edge://')) {
          try {
            const res = await chrome.tabs.sendMessage(t.id, { action: 'GET_PAGE_PHONE' });
            if (res && res.phone) {
              handleAutoDetectedPhone(res.phone);
              return;
            }
          } catch (_) {}
        }
      }
      if (!lastAutoLookedUpPhone && autoFeedbackBar && autoFeedbackText) {
        autoFeedbackBar.classList.add('waiting');
        autoFeedbackText.textContent = 'Auto mode active · Waiting for dialer number...';
      }
    } catch (e) {}
  }

  function startAutoLookup() {
    stopAutoLookup();
    lastAutoLookedUpPhone = '';
    checkActiveTabPhone();
    autoPollTimer = setInterval(checkActiveTabPhone, 700);
  }

  function stopAutoLookup() {
    if (autoPollTimer) {
      clearInterval(autoPollTimer);
      autoPollTimer = null;
    }
  }

  // Listen for broadcast from widget & stream results
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'PAGE_PHONE_DETECTED' && currentLookupMode === 'auto' && msg.phone) {
        handleAutoDetectedPhone(msg.phone);
      }
      if (msg.action === 'PARALLEL_STREAM_RESULT' && msg.data) {
        currentData = msg.data;
        displayResults(msg.data);
        hideStatus();
        setLoading(false);
      }
    });
  }

  let currentData = null;

  // Popout to separate window button
  if (popoutBtn) {
    popoutBtn.addEventListener('click', async () => {
      const stored = await chrome.storage.local.get(['winBounds']);
      const bounds = stored.winBounds || { width: 420, height: 690, top: 100, left: 100 };
      await chrome.windows.create({
        url: 'window.html',
        type: 'popup',
        ...bounds,
        focused: true
      });
      window.close();
    });
  }

  // Auto-format phone input as (XXX) XXX-XXXX
  phoneInput.addEventListener('input', (e) => {
    const raw = e.target.value.replace(/\D/g, '');
    let formatted = '';
    if (raw.length > 0) {
      formatted = '(' + raw.substring(0, 3);
    }
    if (raw.length >= 4) {
      formatted += ') ' + raw.substring(3, 6);
    }
    if (raw.length >= 7) {
      formatted += '-' + raw.substring(6, 10);
    }
    e.target.value = formatted || raw;
  });

  // Enter triggers search
  phoneInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      searchBtn.click();
    }
  });

  // Clear button
  clearBtn.addEventListener('click', () => {
    phoneInput.value = '';
    hideError();
    hideResults();
    hideStatus();
    phoneInput.focus();
  });

  // Search button click handler
  searchBtn.addEventListener('click', async () => {
    if (window.DNCAuthClient && !window.DNCAuthClient.isAuthenticated()) {
      window.DNCAuthClient.showLoginOverlay('Please sign in to your account first.');
      return;
    }

    const phone = phoneInput.value.trim();
    const digits = phone.replace(/\D/g, '');

    if (digits.length < 10) {
      showError('Please enter a valid 10-digit phone number.');
      return;
    }

    hideError();
    hideResults();
    showStatus('Running headless compliance & ID lookup...');
    setLoading(true);

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Lookup timed out. Please try again.')), 12000)
      );

      const response = await Promise.race([
        chrome.runtime.sendMessage({
          action: 'LOOKUP_PHONE',
          phone: phone
        }),
        timeoutPromise
      ]);

      if (!response) {
        throw new Error('No response from background service worker.');
      }

      if (response.code === 'LIMIT_REACHED' || response.error?.includes('limit reached')) {
        if (window.DNCAuthClient) {
          window.DNCAuthClient.handleLimitReached('limit reached contact admin for more limit');
        }
        return;
      }

      if (response.code === 'NOT_LOGGED_IN' || response.code === 'SESSION_EXPIRED') {
        if (window.DNCAuthClient) {
          window.DNCAuthClient.showLoginOverlay(response.error);
        }
        return;
      }

      if (typeof response.lookupsRemaining === 'number' && window.DNCAuthClient) {
        window.DNCAuthClient.updateQuotaDisplay(response.lookupsRemaining, response.lookupsTotal);
      }

      if (response.success) {
        currentData = response.data;
        displayResults(response.data);
      } else {
        showError(response.error || 'Failed to retrieve compliance records.');
      }
    } catch (err) {
      showError(err.message || 'Error occurred during lookup.');
    } finally {
      hideStatus();
      setLoading(false);
    }
  });

  const personSlideHeader = document.getElementById('person-slide-header');
  const personPrevBtn = document.getElementById('person-prev-btn');
  const personNextBtn = document.getElementById('person-next-btn');
  const personSlideCounter = document.getElementById('person-slide-counter');

  let activePersonsList = [];
  let currentPersonIndex = 0;

  function renderCurrentPersonSlide() {
    if (!activePersonsList || activePersonsList.length === 0) {
      personCard.classList.add('hidden');
      return;
    }

    const person = activePersonsList[currentPersonIndex];
    if (!person) {
      personCard.classList.add('hidden');
      return;
    }

    personName.textContent = person.name || 'Unknown Name';
    if (personAvatar) personAvatar.textContent = person.avatar || (person.name ? person.name.slice(0, 2).toUpperCase() : '--');
    personAge.textContent = person.age || '';

    if (person.address) {
      const cityStateZip = [person.address.city, person.address.state].filter(Boolean).join(', ') + (person.address.zip ? ` ${person.address.zip}` : '');
      if (person.address.street) {
        personStreet.textContent = person.address.street;
        personCityState.textContent = cityStateZip || '';
      } else if (cityStateZip) {
        personStreet.textContent = cityStateZip;
        personCityState.textContent = person.address.zip ? `ZIP ${person.address.zip}` : '';
      } else if (person.address.full) {
        personStreet.textContent = person.address.full;
        personCityState.textContent = '';
      } else {
        personStreet.textContent = 'No street record';
        personCityState.textContent = '';
      }
    } else {
      personStreet.textContent = 'No address record found';
      personCityState.textContent = '';
    }

    if (personSlideHeader) {
      if (activePersonsList.length > 1) {
        personSlideHeader.style.display = 'flex';
        if (personSlideCounter) {
          personSlideCounter.textContent = `${currentPersonIndex + 1} / ${activePersonsList.length}`;
        }
      } else {
        personSlideHeader.style.display = 'none';
      }
    }

    if (person.vehicles && person.vehicles.length > 0) {
      renderDiscoveredVehicles(person.vehicles);
    } else {
      if (vehicleResultsBox) vehicleResultsBox.classList.add('hidden');
    }

    if (person.dob || person.dob1 || person.dob2) {
      const firstDob = person.dob1 || person.dob;
      renderDiscoveredDob({
        dob1: firstDob,
        dob1Source: person.dob1Source,
        dob1Note: person.dob1Note || (isJanuaryPlaceholder(firstDob) ? 'month/day unknown' : ''),
        dob2: person.dob2,
        dob2Source: person.dob2Source
      });
    } else {
      if (dobResultsBox) dobResultsBox.classList.add('hidden');
    }

    if (person.emails && person.emails.length > 0) {
      renderDiscoveredEmails(person.emails);
    } else {
      if (emailResultsBox) emailResultsBox.classList.add('hidden');
    }

    personCard.classList.remove('hidden');
  }

  if (personPrevBtn) {
    personPrevBtn.addEventListener('click', () => {
      if (activePersonsList.length > 1) {
        currentPersonIndex = (currentPersonIndex - 1 + activePersonsList.length) % activePersonsList.length;
        renderCurrentPersonSlide();
      }
    });
  }

  if (personNextBtn) {
    personNextBtn.addEventListener('click', () => {
      if (activePersonsList.length > 1) {
        currentPersonIndex = (currentPersonIndex + 1) % activePersonsList.length;
        renderCurrentPersonSlide();
      }
    });
  }

  // Copy Name button
  copyNameBtn.addEventListener('click', () => {
    const p = activePersonsList[currentPersonIndex] || currentData?.person;
    if (p && p.name) {
      copyToClipboard(p.name, copyNameBtn);
    }
  });

  // Copy Address button
  copyAddrBtn.addEventListener('click', () => {
    const p = activePersonsList[currentPersonIndex] || currentData?.person;
    const fullAddr = p?.address?.full || p?.address?.street || personStreet.textContent;
    if (fullAddr && fullAddr !== '-') {
      copyToClipboard(fullAddr, copyAddrBtn);
    }
  });

  // Vehicle lookup buttons
  if (personAmicaBtn) {
    personAmicaBtn.addEventListener('click', () => {
      const p = activePersonsList[currentPersonIndex] || currentData?.person;
      if (p) startVehicleLookup('amica', p);
    });
  }

  if (personDobBtn) {
    personDobBtn.addEventListener('click', () => {
      const p = activePersonsList[currentPersonIndex] || currentData?.person;
      if (p) startDobLookup(p);
    });
  }

  if (personEmailBtn) {
    personEmailBtn.addEventListener('click', () => {
      const p = activePersonsList[currentPersonIndex] || currentData?.person;
      if (p) startGoogleEmailLookup(p);
    });
  }

  if (personGenderBtn) {
    personGenderBtn.addEventListener('click', () => {
      const p = activePersonsList[currentPersonIndex] || currentData?.person;
      if (p) startGoogleGenderLookup(p);
    });
  }

  if (copyDobBtn) {
    copyDobBtn.addEventListener('click', () => {
      const val = personDobValue ? personDobValue.textContent : '';
      if (val && val !== '-') copyToClipboard(val, copyDobBtn, null, 'Copied!');
    });
  }

  if (vehicleCancelBtn) {
    vehicleCancelBtn.addEventListener('click', () => {
      cancelVehicleLookup();
      cancelDobLookup();
    });
  }

  // Copy All button
  copyAllBtn.addEventListener('click', () => {
    const text = rawOutput.textContent;
    if (text) {
      copyToClipboard(text, copyAllBtn, copyAllLabel, 'Copied!');
    }
  });

  function displayResults(data) {
    const dnc = data.dnc || 'Clean';
    const litigator = data.litigator || 'Clean';
    const blacklist = data.blacklist || 'Clean';

    valDnc.textContent = dnc;
    valLitigator.textContent = litigator;
    valBlacklist.textContent = blacklist;

    setBadgeStyle(valDnc, dnc);
    setBadgeStyle(valLitigator, litigator);
    setBadgeStyle(valBlacklist, blacklist);

    // Person Card Info (Multiple Persons supported via Slides)
    activePersonsList = (data.persons && data.persons.length > 0) ? data.persons : (data.person ? [data.person] : []);
    currentPersonIndex = 0;
    renderCurrentPersonSlide();

    // Prepare Raw Summary
    let summary = '';
    activePersonsList.forEach((p, idx) => {
      if (activePersonsList.length > 1) {
        summary += `--- PERSON ${idx + 1} ---\n`;
      }
      if (p.name) summary += `Name: ${p.name}\n`;
      if (p.age) summary += `Age: ${p.age}\n`;
      if (p.dob) summary += `DOB: ${p.dob}\n`;
      if (p.emails && p.emails.length > 0) {
        summary += `Emails (${p.emails.length}): ${p.emails.join(', ')}\n`;
      }
      if (p.address && p.address.full) summary += `Address: ${p.address.full}\n`;
      if (p.vehicles && p.vehicles.length > 0) {
        summary += `Vehicles (${p.vehicles.length}):\n${p.vehicles.map((v) => `  • ${v}`).join('\n')}\n`;
      }
      summary += '\n';
    });

    summary += `DNC: ${dnc}\n`;
    summary += `Litigator: ${litigator}\n`;
    summary += `Blacklist: ${blacklist}`;

    rawOutput.textContent = summary.trim();
    resultsContainer.classList.remove('hidden');
  }

  function setBadgeStyle(el, value) {
    if (!el) return;
    el.className = 'badge';
    const lower = (value || '').toLowerCase().trim();
    if (!lower || lower === '-' || lower === '--' || lower.includes('loading')) {
      el.classList.add('badge-neutral');
    } else if (lower === 'clean' || lower.includes('clean') || lower.includes('not listed') || lower.includes('no record') || lower.includes('pass') || lower === 'no') {
      el.classList.add('badge-clean');
    } else {
      el.classList.add('badge-flagged');
    }
  }

  function copyToClipboard(text, btnElement, labelElement = null, successText = 'Copied') {
    navigator.clipboard.writeText(text).then(() => {
      if (labelElement) {
        const original = labelElement.textContent;
        labelElement.textContent = successText;
        setTimeout(() => { labelElement.textContent = original; }, 2000);
      } else {
        btnElement.style.borderColor = '#ffffff';
        setTimeout(() => { btnElement.style.borderColor = '#27272a'; }, 1500);
      }
    });
  }

  function showStatus(text) {
    statusText.textContent = text;
    statusContainer.classList.remove('hidden');
    headerDot.classList.add('active');
  }

  function hideStatus() {
    statusContainer.classList.add('hidden');
    headerDot.classList.remove('active');
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorContainer.classList.remove('hidden');
  }

  function hideError() {
    errorContainer.classList.add('hidden');
  }

  function hideResults() {
    resultsContainer.classList.add('hidden');
  }

  function setLoading(loading) {
    phoneInput.disabled = false;
    searchBtn.disabled = false;
    if (loading) {
      searchBtn.textContent = 'Searching...';
      searchBtn.style.opacity = '0.85';
    } else {
      searchBtn.textContent = 'Search';
      searchBtn.style.opacity = '1';
    }
  }

  // ==========================================
  // VEHICLE AUTOMATION (Amica / Mercury)
  // ==========================================
  let activeVehicleLookupPerson = null;

  function isPoBox(addrStr) {
    if (!addrStr) return false;
    const s = String(addrStr).toLowerCase().trim();
    return /\b(p\.?\s*o\.?\s*box|post\s+office\s+box|\d+\s+po\s+box|po\s+box\s+\d+|box\s+\d+)\b/i.test(s) ||
           /^\s*p\.?\s*o\.?\s*box\b/i.test(s) ||
           /^\s*box\s+\d+/i.test(s) ||
           /\bpobox\b/i.test(s);
  }

  function selectPhysicalAddressForVehicle(person) {
    let chosen = person?.address || null;
    const all = Array.isArray(person?.allAddresses) ? person.allAddresses : [];
    if (!chosen && all.length > 0) {
      chosen = all[0];
    }

    const getStreet = (a) => {
      if (!a) return '';
      if (typeof a === 'string') return a;
      return a.street || a.full || '';
    };

    const primaryStreet = getStreet(chosen);

    // If primary address contains a PO Box, check the second, third, etc. address in allAddresses
    if (isPoBox(primaryStreet) && all.length > 0) {
      const nonPoBox = all.find(a => {
        const st = getStreet(a);
        return st && !isPoBox(st);
      });
      if (nonPoBox) {
        console.log(`[Vehicle Lookup] Address "${primaryStreet}" is a PO Box. Using physical address:`, nonPoBox);
        return { address: nonPoBox, skippedPoBox: true, originalPoBox: primaryStreet };
      }
    }

    return { address: chosen, skippedPoBox: false, originalPoBox: '' };
  }

  function formatDobToSlash(str) {
    if (!str) return '';
    const s = String(str).trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
      const parts = s.split('/');
      return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
    }
    const months = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
      jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const m = s.match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(19\d\d|20\d\d)/i);
    if (m) {
      const mo = months[m[1].toLowerCase()] || '06';
      const da = m[2].padStart(2, '0');
      return `${mo}/${da}/${m[3]}`;
    }
    const m2 = s.match(/([A-Za-z]+)\s+(19\d\d|20\d\d)/i);
    if (m2) {
      const mo = months[m2[1].toLowerCase()] || '06';
      return `${mo}/15/${m2[2]}`;
    }
    const m3 = s.match(/\b(19\d\d|20\d\d)\b/);
    if (m3) {
      return `06/15/${m3[1]}`;
    }
    return '';
  }

  function extractProfileForVehicle(person) {
    const fullName = (person?.name || '').trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    let first = 'Customer', middle = '', last = 'User', suffix = '';

    if (nameParts.length === 1) {
      first = nameParts[0];
      last = nameParts[0];
    } else if (nameParts.length === 2) {
      first = nameParts[0];
      last = nameParts[1];
    } else if (nameParts.length >= 3) {
      first = nameParts[0];
      const lastPart = nameParts[nameParts.length - 1];
      if (['jr', 'sr', 'ii', 'iii', 'iv', 'v'].includes(lastPart.toLowerCase().replace(/\./g, ''))) {
        suffix = lastPart;
        last = nameParts[nameParts.length - 2];
        middle = nameParts.slice(1, nameParts.length - 2).join(' ');
      } else {
        middle = nameParts.slice(1, nameParts.length - 1).join(' ');
        last = lastPart;
      }
    }

    const resolved = selectPhysicalAddressForVehicle(person);
    const chosenAddr = resolved.address || {};
    let street = (chosenAddr?.street || (typeof chosenAddr === 'string' ? chosenAddr : '')).trim();
    let city = (chosenAddr?.city || '').trim();
    let state = (chosenAddr?.state || '').trim();
    let zip = (chosenAddr?.zip || '').trim();

    if (!city && !state && chosenAddr?.full) {
      const m = chosenAddr.full.match(/^(.*?)[,\n]+([^,\n]+)[,\n\s]+([A-Za-z]{2})(?:[,\s]+(\d{5}))?/);
      if (m) {
        if (!street) street = m[1].trim();
        city = m[2].trim();
        state = m[3].trim().toUpperCase();
        if (m[4]) zip = m[4].trim();
      } else if (!street) {
        street = chosenAddr.full.trim();
      }
    }

    const rawPhone = (phoneInput?.value || '').replace(/\D/g, '') || (person?.phone || person?.phoneNumber || '').replace(/\D/g, '') || '8172944402';

    let dob = '08/15/1975';
    if (person?.dob) {
      const formatted = formatDobToSlash(person.dob);
      if (formatted) dob = formatted;
    } else if (person?.age) {
      const yearMatch = person.age.match(/\b(19\d\d|20\d\d)\b/);
      if (yearMatch) {
        dob = `06/15/${yearMatch[1]}`;
      }
    }

    const email = (Array.isArray(person?.emails) && person.emails.length > 0)
      ? person.emails[0]
      : (person?.email || 'customer782@gmail.com');

    return {
      fullName,
      name: { first, middle, last, suffix },
      address: { street, unit: chosenAddr?.unit || '', city, state, zip },
      allAddresses: person?.allAddresses || [],
      skippedPoBox: resolved.skippedPoBox,
      originalPoBox: resolved.originalPoBox,
      phone: rawPhone,
      dob,
      email,
      gender: 'M'
    };
  }

  function startVehicleLookup(provider, person) {
    activeVehicleLookupPerson = person;
    const profile = extractProfileForVehicle(person);
    const providerName = rideLabel(provider);
    const initMsg = profile.skippedPoBox
      ? `Starting ${providerName} (using ${profile.address.street})...`
      : `Starting ${providerName} lookup...`;

    showVehicleProgress(provider, 15, initMsg);

    chrome.runtime.sendMessage({
      action: 'START_VEHICLE_LOOKUP',
      provider,
      profile
    }, (res) => {
      if (res && !res.success) {
        showVehicleProgress(provider, 100, `Error: ${res.error || 'Failed to start'}`);
      }
    });
  }

  function cancelVehicleLookup() {
    chrome.runtime.sendMessage({ action: 'CANCEL_VEHICLE_LOOKUP' }).catch(() => {});
    hideVehicleProgress();
    activeVehicleLookupPerson = null;
  }

  function showVehicleProgress(provider, pct, message, isWarning = false) {
    if (!vehicleProgressBox) return;
    vehicleProgressBox.classList.remove('hidden');
    if (vehicleProviderTag) vehicleProviderTag.textContent = provider === 'DOB' ? 'DOB' : provider === 'EMAIL' ? 'EMAIL' : provider === 'GENDER' ? 'GENDER' : rideLabel(provider);
    if (vehicleProgressStatus) vehicleProgressStatus.textContent = message || 'Processing...';
    if (vehicleProgressFill) {
      vehicleProgressFill.style.width = `${Math.min(100, Math.max(8, pct))}%`;
      if (isWarning) {
        vehicleProgressFill.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
      } else {
        vehicleProgressFill.style.background = 'linear-gradient(90deg, #10b981, #059669)';
      }
    }
    if (isWarning && vehicleCancelBtn) {
      vehicleCancelBtn.classList.add('hidden');
    } else if (vehicleCancelBtn) {
      vehicleCancelBtn.classList.remove('hidden');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function hideVehicleProgress() {
    if (vehicleProgressBox) vehicleProgressBox.classList.add('hidden');
  }

  function renderEmptyVehicleNotice(provider, message) {
    if (!vehicleResultsBox || !vehicleBadgesContainer) return;
    const providerName = rideLabel(provider);
    const text = message || `No vehicle found on ${providerName}`;

    if (vehicleResultsCountLabel) {
      vehicleResultsCountLabel.textContent = `Vehicle Lookup (${providerName})`;
    }

    if (copyAllVehiclesBtn) {
      copyAllVehiclesBtn.classList.add('hidden');
    }

    vehicleBadgesContainer.innerHTML = `
      <div class="vehicle-empty-notice">
        <span>⚠️</span>
        <span>${escapeHtml(text)}</span>
      </div>
    `;

    vehicleResultsBox.classList.remove('hidden');
  }

  function renderDiscoveredVehicles(vehicles) {
    if (!vehicleResultsBox || !vehicleBadgesContainer) return;

    if (!vehicles || vehicles.length === 0) {
      vehicleResultsBox.classList.add('hidden');
      return;
    }

    if (copyAllVehiclesBtn) {
      copyAllVehiclesBtn.classList.remove('hidden');
    }

    if (vehicleResultsCountLabel) {
      vehicleResultsCountLabel.textContent = `Discovered Vehicles (${vehicles.length})`;
    }

    vehicleBadgesContainer.innerHTML = vehicles
      .map(
        (v) => `
      <div class="vehicle-badge-item">
        <span class="vehicle-badge-name">
          <span>${v}</span>
        </span>
        <button class="mini-btn copy-single-vehicle" data-copy="${v}" type="button">Copy</button>
      </div>
    `
      )
      .join('');

    vehicleBadgesContainer.querySelectorAll('.copy-single-vehicle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const text = e.currentTarget.getAttribute('data-copy');
        if (text) copyToClipboard(text, e.currentTarget);
      });
    });

    if (copyAllVehiclesBtn) {
      copyAllVehiclesBtn.onclick = () => {
        copyToClipboard(vehicles.join('\n'), copyAllVehiclesBtn, null, 'Copied!');
      };
    }

    vehicleResultsBox.classList.remove('hidden');
  }

  // "January 1954" / "January 1, 1954" is the placeholder Unmask shows when the real
  // month and day are unknown (50/50), so the badge says so explicitly.
  function isJanuaryPlaceholder(str) {
    const s = String(str || '').trim();
    return /^jan(uary)?\.?\s+(?:1(?:st)?,?\s+)?\d{4}$/i.test(s);
  }

  function dobSourceLabel(source) {
    if (source === 'unmask.com') return 'Unmask';
    if (source === 'thatsthem.com') return 'ThatSthem';
    return source || '';
  }

  // DOB 1 (first source, possibly a placeholder / year-only value) and DOB 2 (the
  // confirmed date) are shown side by side so both can be compared and copied.
  function renderDiscoveredDob(info) {
    const data = info || {};
    if (!dobResultsBox || !dobBadgesContainer) return;

    const entries = [];
    if (data.dob1) entries.push({ source: data.dob1Source || '', note: data.dob1Note || '', value: data.dob1 });
    if (data.dob2) entries.push({ source: data.dob2Source || '', note: data.dob2Note || '', value: data.dob2 });

    if (entries.length === 0) {
      dobResultsBox.classList.add('hidden');
      return;
    }

    dobBadgesContainer.innerHTML = entries
      .map(
        (entry) => `
      <div class="dob-badge-item${entry.note ? ' dob-badge-item--placeholder' : ''}">
        <span class="dob-badge-name">
          ${entry.source ? `<span class="dob-badge-source">${escapeHtml(dobSourceLabel(entry.source))}</span>` : ''}
          <span class="dob-val-text">${escapeHtml(entry.value)}</span>
          ${entry.note ? `<span class="dob-badge-note">${escapeHtml(entry.note)}</span>` : ''}
        </span>
        <button class="mini-btn copy-single-dob" data-copy="${escapeHtml(entry.value)}" type="button">Copy</button>
      </div>`
      )
      .join('');

    dobBadgesContainer.querySelectorAll('.copy-single-dob').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const value = e.currentTarget.getAttribute('data-copy') || '';
        copyToClipboard(value, e.currentTarget, null, 'Copied!');
      });
    });

    dobResultsBox.classList.remove('hidden');
  }

  function renderDiscoveredEmails(emails) {
    if (!emailResultsBox || !emailBadgesContainer) return;

    if (!emails || emails.length === 0) {
      emailResultsBox.classList.add('hidden');
      return;
    }

    if (emailResultsCountLabel) {
      emailResultsCountLabel.textContent = `Email Addresses (${emails.length})`;
    }

    emailBadgesContainer.innerHTML = emails
      .map(
        (em) => `
      <div class="email-badge-item">
        <span class="email-badge-name" title="${escapeHtml(em)}">
          <span>${escapeHtml(em)}</span>
        </span>
        <button class="mini-btn copy-single-email" data-copy="${escapeHtml(em)}" type="button">Copy</button>
      </div>
    `
      )
      .join('');

    emailBadgesContainer.querySelectorAll('.copy-single-email').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const text = e.currentTarget.getAttribute('data-copy');
        if (text) copyToClipboard(text, e.currentTarget, null, 'Copied!');
      });
    });

    emailResultsBox.classList.remove('hidden');
  }

  let activeDobLookupPerson = null;
  // The Google AI Mode email run remembers which person asked for it, so what it finds is written onto
  // that person rather than into the display only.
  let activeEmailLookupPerson = null;
  // ...and the gender run's: the person whose name the chip belongs to.
  let activeGenderLookupPerson = null;

  // The email run: the month already on the card goes with the request, so the query asks
  // "born in February 1950" when a previous search found one.
  function startGoogleEmailLookup(person) {
    activeEmailLookupPerson = person;
    const knownDob = person.dob3 || person.dob2 || person.dob1 || person.dob || '';
    showVehicleProgress('EMAIL', 10, `Asking AI for ${person.name || 'person'}'s email address...`);

    chrome.runtime.sendMessage({
      action: 'START_GOOGLE_EMAIL_LOOKUP',
      person,
      dob: knownDob
    }, (res) => {
      if (res && !res.success) {
        showVehicleProgress('EMAIL', 100, `Error: ${res.error || 'Failed to start'}`, true);
      }
    });
  }

  // The gender chip beside the name is both the button and the answer: both symbols until it has been
  // asked, then the symbol the AI named, recoloured, with the wording in its tooltip.
  function genderIconSvg(gender) {
    if (gender === 'Female') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="5"/><path d="M12 14v7"/><path d="M9 18h6"/></svg>';
    }
    if (gender === 'Male') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="14" r="5"/><path d="M13.6 10.4 20 4"/><path d="M14.5 4H20v5.5"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="13" r="4.5"/><path d="M10 17.5V22"/><path d="M7.5 19.8h5"/><path d="M13.2 9.8 19 4"/><path d="M14 4h5v5"/></svg>';
  }

  function genderTitleText(gender, note) {
    if (gender !== 'Male' && gender !== 'Female') return 'Check gender with AI';
    return `${gender} — from the AI answer${note ? ` (${note})` : ''}`;
  }

  function renderGenderBadge(gender, note) {
    if (!personGenderBtn) return;
    const value = gender === 'Male' || gender === 'Female' ? gender : '';
    personGenderBtn.classList.toggle('is-female', value === 'Female');
    personGenderBtn.classList.toggle('is-male', value === 'Male');
    personGenderBtn.classList.remove('running');
    const title = genderTitleText(value, note);
    personGenderBtn.setAttribute('title', title);
    personGenderBtn.setAttribute('aria-label', title);
    personGenderBtn.innerHTML = genderIconSvg(value);
  }

  // The gender run: one name-only question, so there is nothing to carry into it and nothing to add to
  // the card but the chip's own colour.
  function startGoogleGenderLookup(person) {
    activeGenderLookupPerson = person;
    if (personGenderBtn) personGenderBtn.classList.add('running');
    showVehicleProgress('GENDER', 15, `Asking AI if ${person.name || 'person'} is male or female...`);

    chrome.runtime.sendMessage({
      action: 'START_GOOGLE_GENDER_LOOKUP',
      person
    }, (res) => {
      if (res && !res.success) {
        renderGenderBadge('', '');
        showVehicleProgress('GENDER', 100, `Error: ${res.error || 'Failed to start'}`, true);
      }
    });
  }

  function startDobLookup(person) {
    activeDobLookupPerson = person;
    showVehicleProgress('DOB', 15, `Searching Unmask for ${person.name || 'person'}...`);

    const phone = (phoneInput?.value || '').replace(/\D/g, '') || person?.phone || person?.phoneNumber || '';

    chrome.runtime.sendMessage({
      action: 'START_DOB_LOOKUP',
      person,
      phone
    }, (res) => {
      if (res && !res.success) {
        showVehicleProgress('DOB', 100, `Error: ${res.error || 'Failed to start'}`, true);
      }
    });
  }

  function cancelDobLookup() {
    chrome.runtime.sendMessage({ action: 'CANCEL_DOB_LOOKUP' }).catch(() => {});
    hideVehicleProgress();
    activeDobLookupPerson = null;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'VEHICLE_LOOKUP_PROGRESS') {
      const pct = Math.round((msg.step / msg.totalSteps) * 100);
      showVehicleProgress(msg.provider, pct, msg.message);
    } else if (msg.action === 'VEHICLE_LOOKUP_EMPTY') {
      const providerName = rideLabel(msg.provider);
      const emptyMsg = msg.message || `No vehicle found on ${providerName}`;
      showVehicleProgress(msg.provider, 100, emptyMsg, true);
      renderEmptyVehicleNotice(msg.provider, emptyMsg);
      setTimeout(() => {
        hideVehicleProgress();
      }, 4000);
    } else if (msg.action === 'VEHICLE_LOOKUP_SUCCESS') {
      if (!msg.vehicles || msg.vehicles.length === 0) {
        const providerName = rideLabel(msg.provider);
        const emptyMsg = msg.message || `No vehicle found on ${providerName}`;
        showVehicleProgress(msg.provider, 100, emptyMsg, true);
        renderEmptyVehicleNotice(msg.provider, emptyMsg);
        setTimeout(() => {
          hideVehicleProgress();
        }, 4000);
        return;
      }
      showVehicleProgress(msg.provider, 100, `Vehicles discovered (${msg.vehicles.length})!`);
      const targetPerson = activeVehicleLookupPerson || activePersonsList[currentPersonIndex];
      if (targetPerson) {
        targetPerson.vehicles = msg.vehicles;
      }
      renderDiscoveredVehicles(msg.vehicles);
      navigator.clipboard.writeText(msg.vehicles.join('\n')).catch(() => {});
      setTimeout(() => {
        hideVehicleProgress();
      }, 2500);

      // Refresh raw summary
      if (currentData) displayResults(currentData);
    } else if (msg.action === 'VEHICLE_LOOKUP_ERROR') {
      showVehicleProgress(msg.provider, 100, msg.error || 'No vehicles found', true);
      renderEmptyVehicleNotice(msg.provider, msg.error || 'No vehicles found');
      setTimeout(() => {
        hideVehicleProgress();
      }, 4000);
    }

    // DOB Messages from Unmask
    if (msg.action === 'DOB_LOOKUP_PROGRESS') {
      const pct = Math.round((msg.step / msg.totalSteps) * 100);
      showVehicleProgress('DOB', pct, msg.message);
    } else if (msg.action === 'DOB_LOOKUP_SUCCESS') {
      const firstDob = msg.dob1 || (msg.dob2 ? '' : msg.dob);
      const secondDob = msg.dob2 || '';
      const bestDob = secondDob || firstDob || msg.dob;
      const dob1Source = msg.dob1Source || msg.source || 'unmask.com';
      const dob1Note = msg.dob1Note || (msg.yearOnly ? 'year only' : msg.placeholder ? 'month/day unknown' : '');
      const dob2Source = msg.dob2Source || (secondDob ? msg.source || '' : '');

      const targetPerson = activeDobLookupPerson || activePersonsList[currentPersonIndex];
      if (targetPerson) {
        if (firstDob) {
          targetPerson.dob1 = firstDob;
          targetPerson.dob1Source = dob1Source;
          targetPerson.dob1Note = dob1Note;
        }
        if (secondDob) {
          targetPerson.dob2 = secondDob;
          targetPerson.dob2Source = dob2Source;
        }
        targetPerson.dob = bestDob;
        if (msg.emails && msg.emails.length > 0) {
          targetPerson.emails = msg.emails;
        }
      }

      renderDiscoveredDob({
        dob1: firstDob,
        dob1Source,
        dob1Note,
        dob2: secondDob,
        dob2Source
      });
      if (msg.emails && msg.emails.length > 0) {
        renderDiscoveredEmails(msg.emails);
      }
      navigator.clipboard.writeText(bestDob).catch(() => {});

      if (msg.searchContinues) {
        // Only a placeholder / year-only value so far - DOB 1 is on screen and the run
        // keeps looking for a fuller date.
        showVehicleProgress('DOB', 60, `${dob1Source === 'thatsthem.com' ? 'ThatSthem' : 'Unmask'} ${firstDob} - checking for a fuller date...`);
      } else {
        showVehicleProgress(
          'DOB',
          100,
          secondDob
            ? `DOB 1 (${dob1Source === 'thatsthem.com' ? 'ThatSthem' : 'Unmask'}): ${firstDob}  •  DOB 2 (ThatSthem): ${secondDob}`
            : `DOB discovered: ${msg.dob}!`
        );
        setTimeout(() => {
          hideVehicleProgress();
        }, 3000);
      }
      if (currentData) displayResults(currentData);
    } else if (msg.action === 'GOOGLE_EMAIL_PROGRESS') {
      const pct = Math.round((msg.step / msg.totalSteps) * 100);
      showVehicleProgress('EMAIL', pct, msg.message);
    } else if (msg.action === 'GOOGLE_EMAIL_RESULT') {
      // Merged into the addresses the card already holds, and written onto the person so a re-render
      // keeps it - the same way the Unmask / ThatSthem addresses arrive.
      const found = Array.isArray(msg.emails) ? msg.emails.filter(Boolean) : [];
      const person = activeEmailLookupPerson;
      if (person && found.length > 0) {
        const merged = Array.isArray(person.emails) ? person.emails.slice() : [];
        found.forEach((email) => {
          if (merged.indexOf(email) < 0) merged.push(email);
        });
        person.emails = merged;
        renderDiscoveredEmails(merged);
      }
      showVehicleProgress(
        'EMAIL',
        100,
        found.length > 0 ? `Email discovered: ${found[0]}` : 'No public email address was named for this address.',
        found.length === 0
      );
      setTimeout(() => {
        hideVehicleProgress();
      }, 4000);
      if (currentData) displayResults(currentData);
    } else if (msg.action === 'GOOGLE_EMAIL_EMPTY') {
      showVehicleProgress('EMAIL', 100, msg.message || 'AI found no email address', true);
      setTimeout(() => {
        hideVehicleProgress();
      }, 4000);
    } else if (msg.action === 'GOOGLE_GENDER_PROGRESS') {
      const pct = Math.round((msg.step / msg.totalSteps) * 100);
      showVehicleProgress('GENDER', pct, msg.message);
    } else if (msg.action === 'GOOGLE_GENDER_RESULT') {
      const gender = msg.gender === 'Male' || msg.gender === 'Female' ? msg.gender : '';
      const person = activeGenderLookupPerson;
      if (person && gender) {
        person.gender = gender;
        person.genderNote = msg.note || '';
        person.genderSource = msg.source || 'google.ai';
      }
      renderGenderBadge(gender, msg.note || '');
      showVehicleProgress(
        'GENDER',
        100,
        gender
          ? `${person && person.name ? person.name + ' — ' : ''}${gender}${msg.note ? ` (${msg.note})` : ''}`
          : 'AI did not say whether this person is male or female.',
        !gender
      );
      setTimeout(() => {
        hideVehicleProgress();
      }, 4000);
      if (currentData) displayResults(currentData);
    } else if (msg.action === 'GOOGLE_GENDER_EMPTY') {
      renderGenderBadge('', '');
      showVehicleProgress('GENDER', 100, msg.message || 'AI could not tell whether this person is male or female.', true);
      setTimeout(() => {
        hideVehicleProgress();
      }, 4000);
    } else if (msg.action === 'DOB_LOOKUP_EMPTY') {
      showVehicleProgress('DOB', 100, msg.message || 'No DOB found on Unmask', true);
      setTimeout(() => {
        hideVehicleProgress();
      }, 4000);
    } else if (msg.action === 'DOB_LOOKUP_ERROR') {
      showVehicleProgress('DOB', 100, msg.error || 'DOB lookup error', true);
      setTimeout(() => {
        hideVehicleProgress();
      }, 4000);
    }
  });

  // ---------------------------------------------------------------------------
  // Run-time settings (Settings & Calibration panel)
  //
  // One storage key for the widget, the popup, the detached window and the background: which records
  // the number is looked up on, which platforms the DOB button may ask, and which records show their
  // DNC status. Everything defaults to on, so an install that never opens the panel behaves exactly as
  // it always has.
  // ---------------------------------------------------------------------------
  const AUTOMATION_SETTINGS_KEY = 'automation_settings';
  const AUTOMATION_SETTINGS_DEFAULTS = {
    records: { record1: true, record2: true, record3: true },
    dob: { unmask: true, thatsthem: true, ai: true },
    dnc: { record1: true, record2: true, record3: true }
  };

  // The two sites are the user's Record 1 and Record 2; their names never reach the UI. Vehicle
  // discovery is the one "Rides" action, and Mercury's automation has no UI entry point.
  const RECORD_LABELS = {
    'infolookup.site': 'Record 1',
    'infolookupp.com': 'Record 2',
    'uspeoplesearch.net': 'Record 3'
  };
  const RECORD_KEYS = {
    'infolookup.site': 'record1',
    'infolookupp.com': 'record2',
    'uspeoplesearch.net': 'record3'
  };
  const RIDE_LABELS = { amica: 'Rides', mercury: 'Rides' };

  function recordLabel(source) {
    return RECORD_LABELS[String(source == null ? '' : source).toLowerCase()] || 'Record';
  }

  function recordKey(source) {
    return RECORD_KEYS[String(source == null ? '' : source).toLowerCase()] || '';
  }

  function rideLabel(provider) {
    return RIDE_LABELS[String(provider == null ? '' : provider).toLowerCase()] || 'Ride';
  }

  // Every group and every switch is filled in from the defaults, so a stored object that is missing a
  // key (an older install, a half-written value) can never read as "off".
  function normalizeAutomationSettings(raw) {
    const stored = raw && typeof raw === 'object' ? raw : {};
    const merge = (group, defaults) => {
      const fromStored = stored[group] && typeof stored[group] === 'object' ? stored[group] : {};
      const out = {};
      Object.keys(defaults).forEach((key) => {
        out[key] = fromStored[key] === undefined ? defaults[key] : !!fromStored[key];
      });
      return out;
    };
    return {
      records: merge('records', AUTOMATION_SETTINGS_DEFAULTS.records),
      dob: merge('dob', AUTOMATION_SETTINGS_DEFAULTS.dob),
      dnc: merge('dnc', AUTOMATION_SETTINGS_DEFAULTS.dnc)
    };
  }

  // "dnc.record1" -> its value. An unknown path reads as on, which is the safe default.
  function settingValue(settings, path) {
    const parts = String(path || '').split('.');
    let node = normalizeAutomationSettings(settings);
    for (let i = 0; i < parts.length; i++) {
      if (!node || typeof node !== 'object' || !(parts[i] in node)) return true;
      node = node[parts[i]];
    }
    return node === undefined ? true : !!node;
  }

  function readAutomationSettings(callback) {
    chrome.storage.local.get([AUTOMATION_SETTINGS_KEY], (res) => {
      callback(normalizeAutomationSettings(res ? res[AUTOMATION_SETTINGS_KEY] : null));
    });
  }

  function writeAutomationSetting(path, value, callback) {
    const parts = String(path || '').split('.');
    readAutomationSettings((settings) => {
      let node = settings;
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]];
      node[parts[parts.length - 1]] = !!value;
      chrome.storage.local.set({ [AUTOMATION_SETTINGS_KEY]: settings }, () => {
        if (callback) callback(settings);
      });
    });
  }

  // The settings a render reads, kept in step with storage so a repaint never has to wait on a storage
  // round-trip.
  let automationSettings = normalizeAutomationSettings(null);

  function automationSetting(path) {
    return settingValue(automationSettings, path);
  }

  readAutomationSettings((settings) => {
    automationSettings = settings;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[AUTOMATION_SETTINGS_KEY]) {
      automationSettings = normalizeAutomationSettings(changes[AUTOMATION_SETTINGS_KEY].newValue);
    }
  });

  // Settings & Calibration Sidebar Logic
  function initSettingsSidebar() {
    const settingsToggleBtn = document.getElementById('settings-toggle-btn');
    const settingsSidebar = document.getElementById('settings-sidebar');
    const closeSidebarBtn = document.getElementById('close-sidebar-btn');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');

    if (!settingsToggleBtn || !settingsSidebar) return;

    const toggles = Array.from(settingsSidebar.querySelectorAll('.setting-toggle'));

    function paint(settings) {
      toggles.forEach((input) => {
        const on = settingValue(settings, input.dataset.setting);
        input.checked = on;
        const row = input.closest('.setting-row');
        if (row) row.classList.toggle('off', !on);
      });
    }

    function refresh() {
      readAutomationSettings((settings) => {
        automationSettings = settings;
        paint(settings);
      });
    }

    function openSidebar() {
      settingsSidebar.classList.remove('closed');
      if (sidebarBackdrop) sidebarBackdrop.classList.add('visible');
      refresh();
    }

    function closeSidebar() {
      settingsSidebar.classList.add('closed');
      if (sidebarBackdrop) sidebarBackdrop.classList.remove('visible');
    }

    settingsToggleBtn.addEventListener('click', () => {
      if (settingsSidebar.classList.contains('closed')) openSidebar();
      else closeSidebar();
    });

    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

    toggles.forEach((input) => {
      input.addEventListener('change', () => {
        writeAutomationSetting(input.dataset.setting, input.checked, (settings) => {
          automationSettings = settings;
          paint(settings);
        });
      });
    });

    // The other panels share these settings: a switch flipped in the widget updates this one too.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[AUTOMATION_SETTINGS_KEY]) refresh();
    });

    refresh();
  }

  initSettingsSidebar();
});
