document.addEventListener('DOMContentLoaded', () => {
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
  const personMercuryBtn = document.getElementById('person-mercury-btn');
  const personDobBtn = document.getElementById('person-dob-btn');
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

  if (personMercuryBtn) {
    personMercuryBtn.addEventListener('click', () => {
      const p = activePersonsList[currentPersonIndex] || currentData?.person;
      if (p) startVehicleLookup('mercury', p);
    });
  }

  if (personDobBtn) {
    personDobBtn.addEventListener('click', () => {
      const p = activePersonsList[currentPersonIndex] || currentData?.person;
      if (p) startDobLookup(p);
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
    const providerName = provider === 'amica' ? 'Amica' : 'Mercury';
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
    if (vehicleProviderTag) vehicleProviderTag.textContent = provider === 'amica' ? 'Amica' : (provider === 'DOB' ? 'DOB' : 'Mercury');
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
    const providerName = provider === 'amica' ? 'Amica' : 'Mercury';
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
      const providerName = msg.provider === 'amica' ? 'Amica' : 'Mercury';
      const emptyMsg = msg.message || `No vehicle found on ${providerName}`;
      showVehicleProgress(msg.provider, 100, emptyMsg, true);
      renderEmptyVehicleNotice(msg.provider, emptyMsg);
      setTimeout(() => {
        hideVehicleProgress();
      }, 4000);
    } else if (msg.action === 'VEHICLE_LOOKUP_SUCCESS') {
      if (!msg.vehicles || msg.vehicles.length === 0) {
        const providerName = msg.provider === 'amica' ? 'Amica' : 'Mercury';
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

  // Settings & Calibration Sidebar Logic
  function initSettingsSidebar() {
    const settingsToggleBtn = document.getElementById('settings-toggle-btn');
    const settingsSidebar = document.getElementById('settings-sidebar');
    const closeSidebarBtn = document.getElementById('close-sidebar-btn');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    const btnRecordUnmask = document.getElementById('btn-record-unmask');
    const btnRecordThatsThem = document.getElementById('btn-record-thatsthem');
    const btnCancelRecording = document.getElementById('btn-cancel-recording');

    const recStatusDot = document.getElementById('rec-status-dot');
    const recStatusTitle = document.getElementById('rec-status-title');
    const recStatusSub = document.getElementById('rec-status-sub');

    if (!settingsToggleBtn || !settingsSidebar) return;

    // Each site owns one recording slot that can be re-recorded or deleted.
    const MACRO_TARGETS = [
      { key: 'unmask', site: 'Unmask.com', storageKey: 'recorded_macro_unmask', defaultLabel: 'Record Unmask' },
      { key: 'thatsthem', site: 'ThatsThem.com', storageKey: 'recorded_macro_thatsthem', defaultLabel: 'Record ThatsThem' }
    ];

    function el(id) {
      return document.getElementById(id);
    }

    function macroEls(key) {
      return {
        badge: el(`badge-macro-${key}`),
        time: el(`time-macro-${key}`),
        stats: el(`stats-macro-${key}`),
        duration: el(`duration-macro-${key}`),
        points: el(`points-macro-${key}`),
        speed: el(`speed-macro-${key}`),
        click: el(`click-macro-${key}`),
        elem: el(`elem-macro-${key}`),
        empty: el(`empty-macro-${key}`),
        recordBtn: el(`btn-record-${key}`),
        recordLabel: el(`label-record-${key}`),
        deleteBtn: el(`btn-delete-${key}`)
      };
    }

    function openSidebar() {
      settingsSidebar.classList.remove('closed');
      if (sidebarBackdrop) sidebarBackdrop.classList.remove('hidden');
      loadMacroStats();
    }

    function closeSidebar() {
      settingsSidebar.classList.add('closed');
      if (sidebarBackdrop) sidebarBackdrop.classList.add('hidden');
    }

    settingsToggleBtn.addEventListener('click', openSidebar);
    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

    function setStatus(state, title, subtitle) {
      if (!recStatusDot || !recStatusTitle || !recStatusSub) return;
      recStatusDot.className = 'rec-status-indicator';
      if (state === 'recording') recStatusDot.classList.add('recording');
      else if (state === 'busy') recStatusDot.classList.add('busy');

      recStatusTitle.textContent = title;
      recStatusSub.textContent = subtitle;
    }

    function formatMacroTime(iso) {
      try {
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch (e) {
        return 'Recent';
      }
    }

    // Records saved before per-site slots existed only live in last_macro_recording.
    function macroForTarget(store, target) {
      const direct = store[target.storageKey];
      if (direct && direct.path) return direct;
      const legacy = store.last_macro_recording;
      if (legacy && legacy.path && legacy.target === target.key) return legacy;
      return null;
    }

    // One site card: stats when a macro is saved, empty state + hidden Delete otherwise.
    function renderMacroCard(target, rec) {
      const e = macroEls(target.key);
      const hasRec = !!(rec && rec.path);

      if (e.badge) {
        e.badge.textContent = hasRec ? 'Recorded' : 'Not Recorded';
        e.badge.classList.toggle('saved', hasRec);
        e.badge.classList.toggle('empty', !hasRec);
      }
      if (e.time) e.time.textContent = hasRec ? formatMacroTime(rec.recordedAt) : '--';
      if (e.stats) e.stats.classList.toggle('hidden', !hasRec);
      if (e.empty) e.empty.classList.toggle('hidden', hasRec);
      if (e.recordLabel) e.recordLabel.textContent = hasRec ? 'Re-record' : target.defaultLabel;
      if (e.deleteBtn) {
        e.deleteBtn.classList.toggle('hidden', !hasRec);
        e.deleteBtn.disabled = false;
        delete e.deleteBtn.dataset.armed;
        const lbl = e.deleteBtn.querySelector('span');
        if (lbl) lbl.textContent = 'Delete';
      }

      if (!hasRec) return;

      if (e.duration) e.duration.textContent = `${rec.durationMs || 0} ms`;
      if (e.points) e.points.textContent = `${rec.pointCount || (rec.path && rec.path.length) || 0} pts`;
      if (e.speed) e.speed.textContent = `${rec.avgSpeedPxPerSec || 0} px/s`;
      if (e.click) {
        const c = rec.click;
        e.click.textContent = c ? `(${c.x}, ${c.y})` : 'N/A';
      }
      if (e.elem) {
        const c = rec.click;
        if (c && c.targetTag) {
          const idStr = c.targetId ? `#${c.targetId}` : '';
          const classStr = c.targetClass ? `.${c.targetClass.trim().split(/\s+/)[0]}` : '';
          e.elem.textContent = `<${c.targetTag.toLowerCase()}${idStr}${classStr}>`;
          e.elem.title = `${c.targetTag} ${c.targetText ? `"${c.targetText}"` : ''}`;
        } else {
          e.elem.textContent = 'None';
          e.elem.title = '';
        }
      }
    }

    function loadMacroStats() {
      const keys = ['last_macro_recording', 'active_mouse_recording'].concat(MACRO_TARGETS.map((t) => t.storageKey));
      chrome.storage.local.get(keys, (res) => {
        const store = res || {};
        const active = store.active_mouse_recording;
        if (btnCancelRecording) btnCancelRecording.classList.toggle('hidden', !(active && active.active));
        if (active && active.active) {
          const targetName = active.target === 'unmask' ? 'Unmask.com' : 'ThatsThem.com';
          setStatus('recording', `Recording on ${targetName}...`, 'Move cursor and click target element on the tab to finish.');
        } else {
          setStatus('ready', 'Ready to Record', 'Record a fresh macro, or delete an old one and record it again.');
        }
        MACRO_TARGETS.forEach((target) => renderMacroCard(target, macroForTarget(store, target)));
      });
    }

    // First click arms the button, second click removes the saved macro.
    async function deleteRecording(target) {
      const e = macroEls(target.key);
      const label = e.deleteBtn ? e.deleteBtn.querySelector('span') : null;

      if (e.deleteBtn && e.deleteBtn.dataset.armed !== '1') {
        e.deleteBtn.dataset.armed = '1';
        if (label) label.textContent = 'Confirm?';
        setTimeout(() => {
          if (e.deleteBtn && e.deleteBtn.dataset.armed === '1') {
            delete e.deleteBtn.dataset.armed;
            if (label) label.textContent = 'Delete';
          }
        }, 3000);
        return;
      }

      if (e.deleteBtn) {
        delete e.deleteBtn.dataset.armed;
        e.deleteBtn.disabled = true;
      }

      let deleteError = null;
      try {
        await chrome.runtime.sendMessage({ action: 'DELETE_MOUSE_RECORDING', target: target.key });
      } catch (err) {
        console.error('Failed to delete recording:', err);
        deleteError = err.message || 'Could not delete the saved macro.';
      }
      // Refresh first: loadMacroStats() rewrites the status banner, so the result is set after it.
      loadMacroStats();
      setStatus(
        'ready',
        deleteError ? 'Delete Failed' : `${target.site} recording deleted`,
        deleteError || 'Click the record button to capture a fresh macro.'
      );
    }

    async function triggerRecording(target) {
      const isUnmask = target === 'unmask';
      const targetName = isUnmask ? 'Unmask.com' : 'ThatsThem.com';
      const btn = isUnmask ? btnRecordUnmask : btnRecordThatsThem;
      const otherBtn = isUnmask ? btnRecordThatsThem : btnRecordUnmask;

      if (btn) btn.classList.add('recording');
      if (otherBtn) otherBtn.disabled = true;

      setStatus('recording', `Recording on ${targetName}...`, 'Tab opened. Move cursor & click anywhere on that tab to capture.');

      try {
        await chrome.runtime.sendMessage({
          action: 'START_MOUSE_RECORDING',
          target: target
        });
      } catch (err) {
        console.error('Failed to trigger recording:', err);
        setStatus('ready', 'Recording Failed', err.message || 'Could not start recording session.');
        if (btn) btn.classList.remove('recording');
        if (otherBtn) otherBtn.disabled = false;
      }
    }

    if (btnRecordUnmask) {
      btnRecordUnmask.addEventListener('click', () => triggerRecording('unmask'));
    }
    if (btnRecordThatsThem) {
      btnRecordThatsThem.addEventListener('click', () => triggerRecording('thatsthem'));
    }

    // Delete buttons on the recording cards
    MACRO_TARGETS.forEach((target) => {
      const deleteBtn = el(`btn-delete-${target.key}`);
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => deleteRecording(target));
      }
    });

    if (btnCancelRecording) {
      btnCancelRecording.addEventListener('click', async () => {
        try {
          await chrome.runtime.sendMessage({ action: 'CANCEL_MOUSE_RECORDING' });
          setStatus('ready', 'Recording Cancelled', 'Select a target below to record or manage its Turnstile click point.');
        } catch (err) {
          console.error('Failed to cancel recording:', err);
        }
        loadMacroStats();
      });
    }

    // Listen for recording finished
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'MOUSE_RECORDING_SAVED') {
        if (btnRecordUnmask) {
          btnRecordUnmask.classList.remove('recording');
          btnRecordUnmask.disabled = false;
        }
        if (btnRecordThatsThem) {
          btnRecordThatsThem.classList.remove('recording');
          btnRecordThatsThem.disabled = false;
        }
        const site = msg.target === 'unmask' ? 'Unmask.com' : 'ThatsThem.com';
        setStatus('ready', `Saved ${site} Macro!`, `Captured ${msg.result?.pointCount || 0} points & click at (${msg.result?.click?.x}, ${msg.result?.click?.y}).`);
        loadMacroStats();
      } else if (msg.action === 'MOUSE_RECORDING_DELETED') {
        loadMacroStats();
        const site = msg.target === 'unmask' ? 'Unmask.com' : 'ThatsThem.com';
        setStatus('ready', `${site} recording deleted`, 'Record a fresh macro whenever you are ready.');
      } else if (msg.action === 'MOUSE_RECORDING_CANCELLED') {
        loadMacroStats();
      }
    });

    loadMacroStats();
  }

  initSettingsSidebar();
});
