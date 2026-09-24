// Background Service Worker for Manifest V3
// Keeps persistent headless workers warm in the background for instant sub-second lookups

let activeLookup = null;
let searchCounter = 0;
const workerPorts = {
  'infolookup.site': null,
  'vibegenx.com': null
};

// Pre-warm the background runners immediately on extension install or startup
chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreenDocument().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreenDocument().catch(() => {});
});

// Pre-warm when user toggles widget via toolbar icon
chrome.action.onClicked.addListener(async (tab) => {
  ensureOffscreenDocument().catch(() => {});

  if (!tab || !tab.id) return;
  if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:'))) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_WIDGET' });
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['widget.js']
      });

      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_WIDGET' }).catch(() => {});
      }, 150);
    } catch (injectErr) {
      console.error('Could not inject widget:', injectErr);
    }
  }
});

// Listen for persistent port connections from content scripts inside the background iframes
chrome.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith('worker-')) {
    const source = port.name.replace('worker-', '');
    workerPorts[source] = port;

    port.onMessage.addListener((msg) => {
      if (msg.action === 'SEARCH_RESULT') {
        handleAutomationResult(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      if (workerPorts[source] === port) {
        workerPorts[source] = null;
      }
    });
  }
});

// Primary search dispatch and messaging from widget / popup / window
let activeVehicleLookup = null; // { tabId, provider, profile, startTime }
let activeDobLookup = null; // { tabId, session, startTime }

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'LOOKUP_PHONE') {
    startParallelLookup(request.phone, request.session, sender, sendResponse);
    return true; // Keep channel open for async response
  }
  if (request.action === 'PAGE_PHONE_DETECTED') {
    // Relay to any open standalone windows or popups
    chrome.runtime.sendMessage(request).catch(() => {});
  }
  if (request.action === 'START_VEHICLE_LOOKUP') {
    startVehicleLookup(request.provider, request.profile, sendResponse);
    return true;
  }
  // Amica asks for a validated address when it rejects every address the person has.
  if (request.action === 'GEOCODE_ADDRESS') {
    geocodeAddressForQuote(request.address)
      .then((address) => sendResponse({ success: !!address, address }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }
  if (request.action === 'CANCEL_VEHICLE_LOOKUP') {
    cancelVehicleLookup(sendResponse);
    return true;
  }
  if (request.action === 'VEHICLE_LOOKUP_PROGRESS') {
    broadcastVehicleMessage(request);
  }
  if (request.action === 'VEHICLE_LOOKUP_SUCCESS') {
    broadcastVehicleMessage(request);
    if (activeVehicleLookup && activeVehicleLookup.tabId) {
      setTimeout(() => {
        if (activeVehicleLookup && activeVehicleLookup.tabId) {
          chrome.tabs.remove(activeVehicleLookup.tabId).catch(() => {});
          activeVehicleLookup = null;
        }
      }, 1500);
    }
  }
  if (request.action === 'VEHICLE_LOOKUP_EMPTY') {
    broadcastVehicleMessage(request);
    if (activeVehicleLookup && activeVehicleLookup.tabId) {
      setTimeout(() => {
        if (activeVehicleLookup && activeVehicleLookup.tabId) {
          chrome.tabs.remove(activeVehicleLookup.tabId).catch(() => {});
          activeVehicleLookup = null;
        }
      }, 1500);
    }
  }
  if (request.action === 'VEHICLE_LOOKUP_ERROR') {
    broadcastVehicleMessage(request);
    if (activeVehicleLookup && activeVehicleLookup.tabId) {
      chrome.tabs.remove(activeVehicleLookup.tabId).catch(() => {});
      activeVehicleLookup = null;
    }
  }

  // DOB Lookup Actions (Unmask.com)
  if (request.action === 'START_DOB_LOOKUP') {
    startDobLookup(request.person, request.phone, sendResponse);
    return true;
  }
  if (request.action === 'CANCEL_DOB_LOOKUP') {
    cancelDobLookup(sendResponse);
    return true;
  }
  if (request.action === 'DOB_LOOKUP_NEXT_ADDRESS') {
    advanceDobNextAddress(sender?.tab?.id, sendResponse);
    return true;
  }
  // ThatSthem's Turnstile lives in a closed shadow root, so the extension cannot click
  // it - surface the tab so the user can complete the check.
  if (request.action === 'FOCUS_LOOKUP_TAB') {
    const tabId = sender?.tab?.id;
    if (tabId) {
      chrome.tabs.update(tabId, { active: true }).catch(() => {});
      if (sender?.tab?.windowId !== undefined) {
        chrome.windows.update(sender.tab.windowId, { focused: true }).catch(() => {});
      }
    }
  }
  if (request.action === 'DOB_LOOKUP_PROGRESS') {
    broadcastDobMessage(request);
  }
  if (request.action === 'DOB_LOOKUP_SUCCESS') {
    handleDobSuccess(request, sender);
  }
  if (request.action === 'DOB_LOOKUP_EMPTY' || request.action === 'DOB_LOOKUP_ERROR') {
    broadcastDobMessage(request);
    if (activeDobLookup && activeDobLookup.tabId) {
      setTimeout(() => {
        if (activeDobLookup && activeDobLookup.tabId) {
          chrome.tabs.remove(activeDobLookup.tabId).catch(() => {});
          activeDobLookup = null;
        }
      }, 1500);
    }
    chrome.storage.local.remove(['unmask_pending_lookup', THATSTHEM_STORAGE_KEY]).catch(() => {});
  }

  // Mouse movement & click recording automation
  if (request.action === 'START_MOUSE_RECORDING') {
    handleStartMouseRecording(request.target, sender, sendResponse);
    return true;
  }
  if (request.action === 'RECORDER_IFRAME_CLICK') {
    const tabId = sender?.tab?.id || activeMouseRecordingTabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, request).catch(() => {});
    }
    return false;
  }
  if (request.action === 'MOUSE_RECORDING_COMPLETED') {
    handleMouseRecordingCompleted(request, sender, sendResponse);
    return true;
  }
  if (request.action === 'REPLAY_MACRO_CLICK') {
    handleReplayMacroClick(request, sender, sendResponse);
    return true;
  }
  if (request.action === 'CANCEL_MOUSE_RECORDING') {
    handleCancelMouseRecording(sendResponse);
    return true;
  }
  if (request.action === 'DELETE_MOUSE_RECORDING') {
    handleDeleteMouseRecording(request.target, sendResponse);
    return true;
  }
});

let activeMouseRecordingTabId = null;

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeVehicleLookup && activeVehicleLookup.tabId === tabId) {
    activeVehicleLookup = null;
  }
  if (activeDobLookup && activeDobLookup.tabId === tabId) {
    activeDobLookup = null;
  }
  if (activeMouseRecordingTabId && activeMouseRecordingTabId === tabId) {
    activeMouseRecordingTabId = null;
    chrome.storage.local.get(['active_mouse_recording'], (res) => {
      if (res && res.active_mouse_recording && res.active_mouse_recording.active) {
        chrome.storage.local.remove('active_mouse_recording');
      }
    });
  }
});

function isPoBox(addrStr) {
  if (!addrStr) return false;
  const s = String(addrStr).toLowerCase().trim();
  return /\b(p\.?\s*o\.?\s*box|post\s+office\s+box|\d+\s+po\s+box|po\s+box\s+\d+|box\s+\d+)\b/i.test(s) ||
         /^\s*p\.?\s*o\.?\s*box\b/i.test(s) ||
         /^\s*box\s+\d+/i.test(s) ||
         /\bpobox\b/i.test(s);
}

// ---------------------------------------------------------------------------
// Address completion via Nominatim (OpenStreetMap)
//
// vibegenx.com frequently returns only the street ("3724 Kildare Dr") while
// infolookup.site returns the whole thing ("3724 Kildare Dr, Houston, Texas
// 77047"). Amica, Mercury and Unmask all need city + state + zip, so the missing
// parts are resolved here - once per unique address, cached and rate limited to
// 1 request/second as the public Nominatim API requires - before the record is
// streamed to the widget. The user therefore sees the full address as well, and
// no automation script needs to know anything about this.
// ---------------------------------------------------------------------------
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_MIN_GAP_MS = 1100; // Nominatim usage policy: max 1 request / second
const NOMINATIM_TIMEOUT_MS = 6000;
const ADDRESS_CACHE_STORAGE_KEY = 'address_completion_cache';
const ADDRESS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ADDRESS_CACHE_MAX_ENTRIES = 400;
const ADDRESS_COMPLETE_MAX_PER_PERSON = 3;
const ADDRESS_COMPLETE_BUDGET_MS = 3500;

const STREET_SUFFIX_ALIASES = {
  aly: 'alley', anx: 'annex', ave: 'avenue', av: 'avenue', blvd: 'boulevard',
  cir: 'circle', ct: 'court', dr: 'drive', expy: 'expressway', fwy: 'freeway',
  hwy: 'highway', ln: 'lane', pkwy: 'parkway', pl: 'place', rd: 'road',
  st: 'street', ter: 'terrace', trl: 'trail', tpke: 'turnpike', way: 'way'
};

let addressCache = null; // Map<key, { address, expiresAt }>, lazily loaded from storage
let nominatimQueue = Promise.resolve();
let lastNominatimCallAt = 0;

function normalizeZip(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 5 ? digits.substring(0, 5) : '';
}

function stateToCode(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length === 2) return s.toUpperCase();
  return STATE_NAME_TO_CODE[s.toLowerCase()] || s.toUpperCase();
}

// "3724 Kildare Dr" -> "kildare drive" (house number dropped, suffix expanded)
function streetCoreKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/\d/.test(word))
    .map((word) => STREET_SUFFIX_ALIASES[word] || word)
    .join(' ');
}

function houseNumber(value) {
  const m = String(value || '').match(/^\s*(\d+[a-z]?)\b/i);
  return m ? m[1].toLowerCase() : '';
}

// Only records that carry a real street but no city/state/zip need a lookup.
function needsAddressCompletion(addr) {
  if (!addr) return false;
  const street = String(addr.street || addr.full || '').trim();
  if (!street || isPoBox(street)) return false; // PO boxes have no physical street
  const city = String(addr.city || '').trim();
  const state = String(addr.state || '').trim();
  return !city || !state || normalizeZip(addr.zip).length !== 5;
}

// City/state/zip carried by any other address of the same person (a safe hint,
// it keeps the lookup inside the right state).
function collectAddressHints(person) {
  const hints = { state: '' };
  if (!person) return hints;
  const sources = [];
  if (person.address) sources.push(person.address);
  if (Array.isArray(person.allAddresses)) person.allAddresses.forEach((a) => sources.push(a));
  sources.forEach((addr) => {
    if (!addr || hints.state) return;
    const code = stateToCode(addr.state);
    if (code) hints.state = code;
  });
  return hints;
}

function buildNominatimQuery(addr, hints) {
  const parts = [];
  const street = String(addr.street || '').trim() || String(addr.full || '').trim();
  if (street) parts.push(street);
  const city = String(addr.city || '').trim() || (hints && hints.city) || '';
  const state = stateToCode(addr.state) || (hints && hints.state) || '';
  const zip = normalizeZip(addr.zip) || (hints && hints.zip) || '';
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (zip) parts.push(zip);
  return parts.join(', ');
}

function addressCacheKey(addr, hints) {
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return [
    norm(addr.street || addr.full),
    norm(addr.city || (hints && hints.city)),
    stateToCode(addr.state) || (hints && hints.state) || '',
    normalizeZip(addr.zip) || (hints && hints.zip) || ''
  ].join('|');
}

// The other source (infolookup.site) often already has the full address for the
// same street - using it as a hint keeps the Nominatim result in the right city.
function findCrossSourceHints(addr) {
  const streetKey = streetCoreKey(addr.street || addr.full);
  if (!streetKey || !activeLookup || !Array.isArray(activeLookup.results)) return null;

  for (const result of activeLookup.results) {
    const data = result && result.data;
    if (!data) continue;
    const persons = Array.isArray(data.persons) ? data.persons.slice() : [];
    if (data.person) persons.push(data.person);

    for (const person of persons) {
      const candidate = person && person.address;
      if (!candidate) continue;
      if (streetCoreKey(candidate.street || candidate.full) !== streetKey) continue;
      const city = String(candidate.city || '').trim();
      const code = stateToCode(candidate.state);
      const zip = normalizeZip(candidate.zip);
      if (city || code || zip) return { city, state: code, zip };
    }
  }
  return null;
}

async function loadAddressCache() {
  if (addressCache) return addressCache;
  addressCache = new Map();
  try {
    const stored = await chrome.storage.local.get(ADDRESS_CACHE_STORAGE_KEY);
    const raw = stored ? stored[ADDRESS_CACHE_STORAGE_KEY] : null;
    const now = Date.now();
    if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach((key) => {
        const entry = raw[key];
        if (entry && entry.address && entry.expiresAt > now) addressCache.set(key, entry);
      });
    }
  } catch (e) {
    addressCache = addressCache || new Map();
  }
  return addressCache;
}

function persistAddressCache() {
  if (!addressCache) return;
  const raw = {};
  let count = 0;
  addressCache.forEach((entry, key) => {
    if (count++ < ADDRESS_CACHE_MAX_ENTRIES) raw[key] = entry;
  });
  chrome.storage.local.set({ [ADDRESS_CACHE_STORAGE_KEY]: raw }).catch(() => {});
}

// Serialised + rate limited so the public API limits are never exceeded.
function fetchNominatim(query) {
  const run = async () => {
    const wait = NOMINATIM_MIN_GAP_MS - (Date.now() - lastNominatimCallAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastNominatimCallAt = Date.now();

    const url = `${NOMINATIM_ENDPOINT}?` + new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '1',
      countrycodes: 'us'
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const result = nominatimQueue.then(run, run);
  nominatimQueue = result.catch(() => {});
  return result;
}

// A hit is only trusted when it clearly is the same street in the same state -
// a wrong city/zip would silently corrupt an insurance quote.
function isTrustworthyHit(addr, hints, hit) {
  if (!hit) return { ok: false, reason: 'no result' };
  const osm = hit.address || {};

  const ourStreetKey = streetCoreKey(addr.street || addr.full);
  const hitStreetKey = streetCoreKey(osm.road || osm.pedestrian || osm.footway || '');
  if (ourStreetKey && hitStreetKey && ourStreetKey !== hitStreetKey &&
      !ourStreetKey.includes(hitStreetKey) && !hitStreetKey.includes(ourStreetKey)) {
    return { ok: false, reason: `road mismatch ("${osm.road}")` };
  }

  const ourNumber = houseNumber(addr.street || addr.full);
  const hitNumber = String(osm.house_number || '').toLowerCase();
  if (ourNumber && hitNumber && ourNumber !== hitNumber) {
    return { ok: false, reason: `house number mismatch (${osm.house_number})` };
  }

  const expectedState = stateToCode(addr.state) || (hints && hints.state) || '';
  const hitState = stateToCode(osm.state);
  if (expectedState && hitState && expectedState !== hitState) {
    return { ok: false, reason: `state mismatch (${hitState})` };
  }

  return { ok: true, reason: '' };
}

// Fills in the missing city/state/zip of a partial address (never overwriting
// what the record already knows). Returns the completed fields or null.
async function completeAddress(addr, hints) {
  if (!needsAddressCompletion(addr)) return null;

  const key = addressCacheKey(addr, hints);
  const cache = await loadAddressCache();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.address;

  const query = buildNominatimQuery(addr, hints);
  if (!query) return null;

  let results;
  try {
    results = await fetchNominatim(query);
  } catch (e) {
    console.warn(`[Background] Address completion failed for "${query}":`, e.message);
    return null;
  }

  if (!Array.isArray(results) || results.length === 0) return null;

  const hit = results[0];
  const verdict = isTrustworthyHit(addr, hints, hit);
  if (!verdict.ok) {
    console.warn(`[Background] Ignored address result for "${query}": ${verdict.reason}`);
    return null;
  }

  const osm = hit.address || {};
  const completed = {
    street: [osm.house_number, osm.road].filter(Boolean).join(' ') || String(addr.street || '').trim(),
    city: osm.city || osm.town || osm.village || osm.hamlet || osm.municipality || '',
    state: stateToCode(osm.state),
    zip: normalizeZip(osm.postcode),
    displayName: hit.display_name || ''
  };
  if (!completed.city && !completed.state && !completed.zip) return null;

  cache.set(key, { address: completed, expiresAt: Date.now() + ADDRESS_CACHE_TTL_MS });
  persistAddressCache();
  console.log(`[Background] Completed address "${query}" -> ${completed.street}, ${completed.city}, ${completed.state} ${completed.zip}`);
  return completed;
}

// Keeps everything the record already had and only fills the blanks.
function mergeCompletedAddress(addr, completed) {
  if (!addr || !completed) return addr;
  const street = String(addr.street || '').trim() || completed.street || '';
  const city = String(addr.city || '').trim() || completed.city || '';
  const state = stateToCode(addr.state) || completed.state || '';
  const zip = normalizeZip(addr.zip) || completed.zip || '';
  const cityStateZip = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
  const existingFull = String(addr.full || '').trim();
  return {
    ...addr,
    street,
    city,
    state,
    zip,
    full: existingFull.includes(',') ? existingFull : [street, cityStateZip].filter(Boolean).join(', '),
    completedFrom: 'nominatim'
  };
}

// Completes the primary address first (Amica / Mercury / Unmask all use it) and
// then the remaining history entries, inside a small time budget.
async function completePersonAddresses(person, options) {
  if (!person) return person;
  const opts = options || {};
  const maxAddresses = opts.maxAddresses || ADDRESS_COMPLETE_MAX_PER_PERSON;
  const budgetMs = opts.budgetMs || ADDRESS_COMPLETE_BUDGET_MS;
  const baseHints = collectAddressHints(person);
  const deadline = Date.now() + budgetMs;
  let attempts = 0;

  const targets = [];
  if (person.address) targets.push(person.address);
  if (Array.isArray(person.allAddresses)) {
    person.allAddresses.forEach((addr) => {
      if (addr && !targets.includes(addr)) targets.push(addr);
    });
  }

  for (const addr of targets) {
    if (attempts >= maxAddresses || Date.now() > deadline) break;
    if (!needsAddressCompletion(addr)) continue;
    attempts++;
    try {
      const hints = Object.assign({}, baseHints, findCrossSourceHints(addr) || {});
      const completed = await completeAddress(addr, hints);
      if (!completed) continue;
      const merged = mergeCompletedAddress(addr, completed);
      if (addr === person.address) person.address = merged;
      else Object.assign(addr, merged);
    } catch (e) {
      console.warn('[Background] Address completion skipped:', e.message);
    }
  }

  return person;
}

async function completeResultAddresses(data, options) {
  if (!data) return data;
  const persons = Array.isArray(data.persons) ? data.persons : [];
  if (data.person && !persons.includes(data.person)) persons.push(data.person);
  for (const person of persons) {
    if (person) await completePersonAddresses(person, options);
  }
  return data;
}

// A quote form can reject an address even when it looks complete (Amica marks the street
// field "invalid" and silently stays on the step). This asks Nominatim for the canonical
// street/city/state/zip so the form can be filled with a validated address instead.
async function geocodeAddressForQuote(addr) {
  if (!addr) return null;

  const street = String(addr.street || addr.full || '').trim();
  if (!street || isPoBox(street)) return null;

  const hints = {
    city: String(addr.city || '').trim(),
    state: stateToCode(addr.state),
    zip: normalizeZip(addr.zip)
  };
  const query = buildNominatimQuery(addr, hints);
  if (!query) return null;

  let results;
  try {
    results = await fetchNominatim(query);
  } catch (e) {
    console.warn(`[Background] Address validation failed for "${query}":`, e.message);
    return null;
  }
  if (!Array.isArray(results) || results.length === 0) return null;

  const hit = results[0];
  const osm = hit.address || {};
  const verdict = isTrustworthyHit(addr, hints, hit);

  if (!verdict.ok) {
    // The street name may simply be misspelt in the record. Accept the hit as a
    // correction when the house number, zip and state all agree - that keeps it in the
    // same place while fixing the spelling, which is what the form needs.
    const ourNumber = houseNumber(street);
    const hitNumber = String(osm.house_number || '').toLowerCase();
    const numberOk = !ourNumber || !hitNumber || ourNumber === hitNumber;
    const hitState = stateToCode(osm.state);
    const stateOk = !hints.state || !hitState || hitState === hints.state;
    const hitZip = normalizeZip(osm.postcode);
    const zipOk = !hints.zip || !hitZip || hitZip === hints.zip;

    if (!(numberOk && stateOk && zipOk)) {
      console.warn(`[Background] Address validation rejected "${query}": ${verdict.reason}`);
      return null;
    }
    console.log(`[Background] Corrected street "${street}" -> "${osm.road}" (house number/zip/state match)`);
  }

  const canonical = {
    street: [osm.house_number, osm.road].filter(Boolean).join(' ') || street,
    city: osm.city || osm.town || osm.village || osm.hamlet || osm.municipality || hints.city || '',
    state: stateToCode(osm.state) || hints.state || '',
    zip: normalizeZip(osm.postcode) || hints.zip || '',
    displayName: hit.display_name || ''
  };

  console.log(
    `[Background] Validated address "${query}" -> ${canonical.street}, ${canonical.city}, ${canonical.state} ${canonical.zip}`
  );
  return canonical;
}

async function startVehicleLookup(provider, profile, sendResponse) {
  try {
    if (activeVehicleLookup && activeVehicleLookup.tabId) {
      chrome.tabs.remove(activeVehicleLookup.tabId).catch(() => {});
      activeVehicleLookup = null;
    }

    // Street-only records (vibegenx.com) would leave Amica/Mercury without city or
    // zip and make them fall back to a default city - complete them first.
    if (profile && profile.address) {
      const holder = { address: profile.address, allAddresses: profile.allAddresses };
      try {
        await completePersonAddresses(holder);
        profile.address = holder.address;
      } catch (e) {
        console.warn('[Background] Could not complete quote address:', e.message);
      }
    }

    // Safety fallback: if the profile address contains a PO Box, switch to second or third physical address
    if (profile && isPoBox(profile.address?.street || profile.address?.full) && Array.isArray(profile.allAddresses)) {
      const nonPoBox = profile.allAddresses.find(a => {
        const st = (a?.street || a?.full || '').trim();
        return st && !isPoBox(st);
      });
      if (nonPoBox) {
        console.log(`[Background] Swapping PO Box "${profile.address?.street}" to physical address:`, nonPoBox);
        profile.address = {
          street: nonPoBox.street || nonPoBox.full || profile.address.street,
          unit: nonPoBox.unit || '',
          city: nonPoBox.city || profile.address.city,
          state: nonPoBox.state || profile.address.state,
          zip: nonPoBox.zip || profile.address.zip
        };
        profile.skippedPoBox = true;
      }
    }

    const storageKey = provider === 'amica' ? 'amica_pending_quote' : 'mercury_pending_quote';
    const quoteData = {
      ...profile,
      timestamp: Date.now()
    };

    await chrome.storage.local.set({ [storageKey]: quoteData });

    // Ensure stale quote sessions/cookies on amica.com are wiped before opening tab
    if (provider === 'amica' && chrome.cookies) {
      try {
        const amicaCookies = await chrome.cookies.getAll({ domain: 'amica.com' });
        for (const c of amicaCookies) {
          const cookieDomain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
          const cookieUrl = `https://${cookieDomain}${c.path}`;
          await chrome.cookies.remove({ url: cookieUrl, name: c.name, storeId: c.storeId }).catch(() => {});
        }
      } catch (e) {
        console.warn('[Background] Could not clear Amica cookies:', e);
      }
    }

    const targetUrl = provider === 'amica' ? 'https://www.amica.com/' : 'https://www.mercuryinsurance.com/';
    const tab = await chrome.tabs.create({ url: targetUrl, active: false });

    activeVehicleLookup = {
      tabId: tab.id,
      provider,
      profile,
      startTime: Date.now()
    };

    if (sendResponse) sendResponse({ success: true, tabId: tab.id });
  } catch (err) {
    if (sendResponse) sendResponse({ success: false, error: err.message });
  }
}

function cancelVehicleLookup(sendResponse) {
  if (activeVehicleLookup && activeVehicleLookup.tabId) {
    chrome.tabs.remove(activeVehicleLookup.tabId).catch(() => {});
    activeVehicleLookup = null;
  }
  chrome.storage.local.remove(['amica_pending_quote', 'mercury_pending_quote']).catch(() => {});
  if (sendResponse) sendResponse({ success: true });
}

function broadcastVehicleMessage(msg) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((t) => {
      if (t.id) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
    });
  });
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// DOB Discovery Automation via Unmask.com
const UNMASK_STREET_SUFFIXES = {
  alley: "Aly", annex: "Anx", avenue: "Ave", boulevard: "Blvd", circle: "Cir",
  court: "Ct", drive: "Dr", expressway: "Expy", freeway: "Fwy", highway: "Hwy",
  lane: "Ln", parkway: "Pkwy", place: "Pl", road: "Rd", street: "St",
  terrace: "Ter", trail: "Trl", turnpike: "Tpke", way: "Way"
};

const STATE_NAME_TO_CODE = {
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

function titleCaseWord(word) {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCasePhrase(str) {
  if (!str) return "";
  return str.split(/\s+/).map(titleCaseWord).join(" ");
}

function slugifyAddress(str) {
  if (!str) return "";
  return str.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
}

function abbreviateAndTitleAddress(words) {
  if (!words) return "";
  return words.split(/\s+/).map((w) => {
    const lower = w.toLowerCase().replace(/\.$/, "");
    return UNMASK_STREET_SUFFIXES[lower] || titleCaseWord(w);
  }).join(" ");
}

function buildUnmaskUrlForAddress(addr) {
  if (!addr) return "https://unmask.com/";
  const street = (addr.street || "").replace(/[,#]/g, "").trim();
  const city = (addr.city || "").trim();
  let state = (addr.state || "").trim();
  if (state.length > 2) {
    state = STATE_NAME_TO_CODE[state.toLowerCase()] || state.substring(0, 2);
  }
  state = state.toUpperCase();
  const zip = String(addr.zip || "").replace(/\D/g, "").substring(0, 5);

  const streetSlug = slugifyAddress(abbreviateAndTitleAddress(street));
  const citySlug = titleCasePhrase(city).replace(/\s+/g, "_");

  if (zip) {
    return `https://unmask.com/address/${streetSlug}--${citySlug}-${state}-${zip}/`;
  } else {
    return `https://unmask.com/address/${streetSlug}--${citySlug}-${state}/`;
  }
}

function buildUnmaskUrlForPhone(phoneStr) {
  if (!phoneStr) return null;
  const digits = String(phoneStr).replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return null;
  const formatted = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  return `https://unmask.com/phone/${formatted}/`;
}

// ---------------------------------------------------------------------------
// ThatSthem.com fallback (only used after every Unmask.com fallback failed)
//
//   name    https://thatsthem.com/name/Deborah-Williams/Houston-TX-77047
//   address https://thatsthem.com/address/3724-Kildare-Dr-Houston-TX-77047
//   phone   https://thatsthem.com/phone/713-252-6330
//
// Unlike Unmask, the ThatSthem result cards already carry the date of birth
// ("Born October 1958 (67 years old)"), so no profile page has to be opened: the
// content script reads the cards and reports the DOB straight away.
// ---------------------------------------------------------------------------
const THATSTHEM_STORAGE_KEY = 'thatsthem_pending_lookup';

// "3724 Kildare Dr" -> "3724-Kildare-Dr" (suffix kept as written, like the site)
function thatStemStreetSlug(street) {
  const cleaned = String(street || '')
    .replace(/[,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return titleCasePhrase(cleaned)
    .replace(/[^A-Za-z0-9\s-]/g, '')
    .replace(/[-\s]+/g, '-')
    .replace(/^-|-$/g, '');
}

// "Deborah Williams" -> "Deborah-Williams"
function thatStemNameSlug(name) {
  const { first, last } = parseFirstLastForUnmask(name);
  if (!first || !last) return '';
  return `${titleCaseWord(first)}-${titleCaseWord(last)}`.replace(/[^A-Za-z0-9-]/g, '');
}

// "Houston", "TX", "77047" -> "Houston-TX-77047"
function thatStemLocationSlug(city, state, zip) {
  const parts = [];
  const citySlug = titleCasePhrase(String(city || '').trim()).replace(/[^A-Za-z0-9\s-]/g, '');
  if (citySlug) parts.push(citySlug.replace(/\s+/g, '-'));

  let st = String(state || '').trim();
  if (st.length > 2) st = STATE_NAME_TO_CODE[st.toLowerCase()] || st;
  if (st) parts.push(st.toUpperCase());

  const cleanZip = String(zip || '').replace(/\D/g, '').substring(0, 5);
  if (cleanZip.length === 5) parts.push(cleanZip);

  return parts.join('-');
}

// Records sometimes carry the whole address inside "street"; split it again so the
// street slug never duplicates the city/state/zip.
function splitStreetAndLocation(addr) {
  let street = String((addr && (addr.street || addr.full)) || '').trim();
  let city = String((addr && addr.city) || '').trim();
  let state = String((addr && addr.state) || '').trim();
  let zip = String((addr && addr.zip) || '').replace(/\D/g, '').substring(0, 5);

  if (street.indexOf(',') !== -1) {
    const parts = street.split(',');
    const rest = parts.slice(1).join(',').trim();
    street = parts[0].trim();
    const m = rest.match(/([A-Za-z .'-]+?)[,\s]+([A-Za-z]{2})(?:\s+(\d{5}))?$/);
    if (m) {
      if (!city) city = m[1].trim();
      if (!state) state = m[2].trim();
      if (!zip && m[3]) zip = m[3];
    }
  }

  return { street, city, state, zip };
}

function buildThatsThemNameUrl(name, city, state, zip) {
  const nameSlug = thatStemNameSlug(name);
  if (!nameSlug) return null;
  const locationSlug = thatStemLocationSlug(city, state, zip);
  // With no city/state/zip known the bare name search is still far better than
  // skipping ThatSthem's name step: the cards are filtered by name + DOB + zip anyway.
  return locationSlug
    ? `https://thatsthem.com/name/${nameSlug}/${locationSlug}`
    : `https://thatsthem.com/name/${nameSlug}`;
}

function buildThatsThemAddressUrl(addr) {
  const parsed = splitStreetAndLocation(addr);
  const streetSlug = thatStemStreetSlug(parsed.street);
  const locationSlug = thatStemLocationSlug(parsed.city, parsed.state, parsed.zip);
  if (!streetSlug || !locationSlug) return null;
  return `https://thatsthem.com/address/${streetSlug}-${locationSlug}`;
}

function buildThatsThemPhoneUrl(phoneStr) {
  if (!phoneStr) return null;
  const digits = String(phoneStr).replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return null;
  return `https://thatsthem.com/phone/${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function parseFirstLastForUnmask(name) {
  if (!name) return { first: '', last: '' };
  const cleaned = name.trim().replace(/[,]/g, ' ');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  const lastPart = parts[parts.length - 1].toLowerCase().replace(/\./g, '');
  let last = parts[parts.length - 1];
  const first = parts[0];
  if (['jr', 'sr', 'ii', 'iii', 'iv', 'v'].includes(lastPart) && parts.length >= 3) {
    last = parts[parts.length - 2];
  }
  return { first, last };
}

function buildUnmaskNameCityUrl(name, state, city) {
  const { first, last } = parseFirstLastForUnmask(name);
  if (!first || !last || !state || !city) return null;
  const nameSlug = `${titleCaseWord(first)}-${titleCaseWord(last)}`;
  let st = (state || '').trim();
  if (st.length > 2) {
    st = STATE_NAME_TO_CODE[st.toLowerCase()] || st;
  }
  st = st.toUpperCase();
  const citySlug = titleCasePhrase(city).replace(/\s+/g, '-');
  return `https://unmask.com/${nameSlug}/${st}-${citySlug}/`;
}

function buildUnmaskNameStateUrl(name, state) {
  const { first, last } = parseFirstLastForUnmask(name);
  if (!first || !last || !state) return null;
  const nameSlug = `${titleCaseWord(first)}-${titleCaseWord(last)}`;
  let st = (state || '').trim();
  if (st.length > 2) {
    st = STATE_NAME_TO_CODE[st.toLowerCase()] || st;
  }
  st = st.toUpperCase();
  return `https://unmask.com/${nameSlug}/${st}/`;
}

function normalizeAddressList(person) {
  const list = [];
  const seen = new Set();

  function addCandidate(raw) {
    if (!raw) return;
    let street = (raw.street || '').trim();
    let city = (raw.city || '').trim();
    let state = (raw.state || '').trim();
    let zip = String(raw.zip || '').replace(/\D/g, '').substring(0, 5);
    let full = raw.full || '';

    // If street or city is missing but full is provided, parse it
    if ((!street || !city) && full) {
      const m = full.match(/^(.*?)[,\n]+([^,\n]+)[,\n\s]+([A-Za-z]{2}|[A-Za-z\s]+)(?:[,\s]+(\d{5}))?/);
      if (m) {
        if (!street) street = m[1].trim();
        if (!city) city = m[2].trim();
        if (!state) state = m[3].trim();
        if (!zip && m[4]) zip = m[4];
      }
    }

    if (state.length > 2) {
      const code = STATE_NAME_TO_CODE[state.toLowerCase()];
      if (code) state = code;
    }
    state = state.toUpperCase();

    if (!street || (!city && !zip)) return;

    const key = `${street.toLowerCase().replace(/[^a-z0-9]/g, '')}|${zip || city.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    list.push({
      street,
      city,
      state,
      zip,
      full: full || `${street}, ${city}, ${state} ${zip}`.trim()
    });
  }

  // 1. Primary address first
  if (person && person.address) {
    addCandidate(person.address);
  }

  // 2. All addresses from history
  if (person && person.allAddresses && Array.isArray(person.allAddresses)) {
    person.allAddresses.forEach(addCandidate);
  }

  return list;
}

async function startDobLookup(person, phone, sendResponse) {
  if (typeof phone === 'function') {
    sendResponse = phone;
    phone = null;
  }
  try {
    if (activeDobLookup && activeDobLookup.tabId) {
      chrome.tabs.remove(activeDobLookup.tabId).catch(() => {});
      activeDobLookup = null;
    }

    const rawPhone = phone || person?.phone || person?.phoneNumber || (person?.phones && person.phones[0]) || '';

    // normalizeAddressList drops addresses without a city/zip, so complete the
    // street-only vibegenx.com records before the Unmask URLs are built.
    if (person) {
      try {
        await completePersonAddresses(person);
      } catch (e) {
        console.warn('[Background] Could not complete DOB address:', e.message);
      }
    }

    const addresses = normalizeAddressList(person);

    let targetAge = null;
    // Records usually carry the explicit birth year next to the age,
    // e.g. "72 yrs (1954)". Keeping it lets the Unmask run validate every
    // DOB it finds against the real birth year instead of guessing.
    let targetYear = null;
    if (person && person.age) {
      const s = String(person.age);
      const currentYear = new Date().getFullYear();

      // 1. Explicit birth year, e.g. "72 yrs (1954)"
      const yearM = s.match(/\b(19\d{2}|20[0-1]\d)\b/);
      if (yearM) {
        const y = parseInt(yearM[1], 10);
        const calc = currentYear - y;
        if (calc >= 10 && calc <= 110) targetYear = y;
      }

      // 2. Age in years, e.g. "72 yrs", "72 years old", "(72)"
      const ageM = s.match(/\b(\d{2})\s*(?:yrs?|years?|yo)?\b/i) || s.match(/\b(\d{2,3})\b/);
      if (ageM) {
        targetAge = parseInt(ageM[1], 10);
      } else if (targetYear) {
        targetAge = currentYear - targetYear;
      }
    }

    let defaultState = '';
    let defaultCity = '';
    if (person?.address) {
      defaultState = person.address.state || '';
      defaultCity = person.address.city || '';
    }
    if ((!defaultState || !defaultCity) && Array.isArray(person?.allAddresses)) {
      for (const addr of person.allAddresses) {
        if (!defaultState && addr.state) defaultState = addr.state;
        if (!defaultCity && addr.city) defaultCity = addr.city;
      }
    }
    if (defaultState && defaultState.length > 2) {
      defaultState = STATE_NAME_TO_CODE[defaultState.toLowerCase()] || defaultState;
    }
    defaultState = (defaultState || '').toUpperCase();

    const session = {
      targetName: person.name || '',
      targetAge: targetAge,
      targetYear: targetYear,
      person: person,
      phone: rawPhone,
      state: defaultState,
      city: defaultCity,
      searchedPhone: false,
      searchedNameCity: false,
      searchedNameState: false,
      addresses: addresses,
      addressIndex: 0,
      status: 'searching'
    };

    if (addresses.length === 0) {
      const phoneUrl = buildUnmaskUrlForPhone(rawPhone);
      if (phoneUrl) {
        session.status = 'searching_phone';
        session.searchedPhone = true;
        await chrome.storage.local.set({ unmask_pending_lookup: session });

        const tab = await chrome.tabs.create({ url: phoneUrl, active: false });
        activeDobLookup = {
          tabId: tab.id,
          session,
          startTime: Date.now()
        };

        broadcastDobMessage({
          action: 'DOB_LOOKUP_PROGRESS',
          step: 1,
          totalSteps: 5,
          message: `Searching phone number on Unmask (${rawPhone})...`
        });

        if (sendResponse) sendResponse({ success: true, tabId: tab.id });
        return;
      }

      const nameCityUrl = buildUnmaskNameCityUrl(session.targetName, session.state, session.city);
      if (nameCityUrl) {
        session.status = 'searching_name_city';
        session.searchedNameCity = true;
        await chrome.storage.local.set({ unmask_pending_lookup: session });

        const tab = await chrome.tabs.create({ url: nameCityUrl, active: false });
        activeDobLookup = { tabId: tab.id, session, startTime: Date.now() };

        broadcastDobMessage({
          action: 'DOB_LOOKUP_PROGRESS',
          step: 1,
          totalSteps: 5,
          message: `Searching name on Unmask (${session.targetName}, ${session.city}, ${session.state})...`
        });

        if (sendResponse) sendResponse({ success: true, tabId: tab.id });
        return;
      }

      const nameStateUrl = buildUnmaskNameStateUrl(session.targetName, session.state);
      if (nameStateUrl) {
        session.status = 'searching_name_state';
        session.searchedNameState = true;
        await chrome.storage.local.set({ unmask_pending_lookup: session });

        const tab = await chrome.tabs.create({ url: nameStateUrl, active: false });
        activeDobLookup = { tabId: tab.id, session, startTime: Date.now() };

        broadcastDobMessage({
          action: 'DOB_LOOKUP_PROGRESS',
          step: 1,
          totalSteps: 5,
          message: `Searching name on Unmask (${session.targetName}, ${session.state})...`
        });

        if (sendResponse) sendResponse({ success: true, tabId: tab.id });
        return;
      }

      if (sendResponse) sendResponse({ success: false, error: 'No address, phone, or name/state available for DOB lookup.' });
      return;
    }

    const firstUrl = buildUnmaskUrlForAddress(addresses[0]);
    await chrome.storage.local.set({ unmask_pending_lookup: session });

    const tab = await chrome.tabs.create({ url: firstUrl, active: false });

    activeDobLookup = {
      tabId: tab.id,
      session,
      startTime: Date.now()
    };

    broadcastDobMessage({
      action: 'DOB_LOOKUP_PROGRESS',
      step: 1,
      totalSteps: 5,
      message: `Searching address 1 of ${addresses.length}: ${addresses[0].street}...`
    });

    if (sendResponse) sendResponse({ success: true, tabId: tab.id });
  } catch (err) {
    if (sendResponse) sendResponse({ success: false, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// ThatSthem phase: name search -> every address -> phone, then give up.
// ---------------------------------------------------------------------------
function primaryZipForSession(session) {
  const list = (session && session.addresses) || [];
  for (const addr of list) {
    const zip = String((addr && addr.zip) || '').replace(/\D/g, '');
    if (zip.length >= 5) return zip.substring(0, 5);
  }
  return '';
}

function buildThatsThemPlan(session) {
  const steps = [];
  const zip = primaryZipForSession(session);

  const nameUrl = buildThatsThemNameUrl(session.targetName, session.city, session.state, zip);
  if (nameUrl) {
    const where = [session.city, session.state, zip].filter(Boolean).join(' ');
    steps.push({
      url: nameUrl,
      kind: 'name',
      label: `name (${session.targetName}${where ? ' in ' + where : ''})`
    });
  }

  const addresses = session.addresses || [];
  addresses.forEach((addr, index) => {
    const url = buildThatsThemAddressUrl(addr);
    if (url) {
      steps.push({
        url,
        kind: 'address',
        label: `address ${index + 1} of ${addresses.length} (${addr.street || addr.full || ''})`
      });
    }
  });

  const phoneUrl = buildThatsThemPhoneUrl(session.phone);
  if (phoneUrl) {
    steps.push({ url: phoneUrl, kind: 'phone', label: `phone (${session.phone})` });
  }

  return steps;
}

// Everything on both sites failed - this is the "let the user know" step.
function exhaustDobLookup(session, sendResponse) {
  const addresses = (session && session.addresses) || [];
  const detailParts = [];
  if (addresses.length > 0) detailParts.push(`${addresses.length} address${addresses.length > 1 ? 'es' : ''}`);
  if (session && session.searchedPhone) detailParts.push('phone');
  if (session && (session.searchedNameCity || session.searchedNameState)) detailParts.push('name');
  if (session && session.searchedThatsThem) detailParts.push('ThatSthem');
  const detail = detailParts.join(' + ') || 'all methods';
  const weak = session && session.weakDob ? session.weakDob : null;

  if (weak) {
    const from = weak.source === 'thatsthem.com' ? 'ThatSthem' : 'Unmask';
    // Only a placeholder / year-only date was found - say so instead of "no DOB found".
    broadcastDobMessage({
      action: 'DOB_LOOKUP_EMPTY',
      message:
        `Only ${weak.yearOnly ? 'the birth year' : 'the placeholder date'} ${weak.dob} from ${from}` +
        ` - no fuller date found (searched ${detail})`,
      person: session.person,
      dob1: weak.dob,
      dob1Source: weak.source,
      dob1Note: weak.yearOnly ? 'year only' : 'month/day unknown',
      keepDob1: true
    });
  } else {
    broadcastDobMessage({
      action: 'DOB_LOOKUP_EMPTY',
      message: `No DOB found on Unmask or ThatSthem (searched ${detail})`,
      person: session ? session.person : null
    });
  }

  if (sendResponse) sendResponse({ success: true, exhausted: true });
  cancelDobLookup();
}

async function startThatsThemPhase(session, tabId, sendResponse) {
  const steps = buildThatsThemPlan(session);
  if (steps.length === 0) {
    exhaustDobLookup(session, sendResponse);
    return;
  }

  session.stage = 'thatsthem';
  session.searchedThatsThem = true;
  session.themSteps = steps;
  session.themIndex = 0;
  session.themLastAdvanceAt = 0;

  await goToThatsThemStep(session, tabId, 0, sendResponse);
}

async function goToThatsThemStep(session, tabId, index, sendResponse) {
  const steps = session.themSteps || [];
  const step = steps[index];
  if (!step) {
    exhaustDobLookup(session, sendResponse);
    return;
  }

  session.themIndex = index;
  session.themLastAdvanceAt = Date.now();
  await chrome.storage.local.set({
    [THATSTHEM_STORAGE_KEY]: session,
    unmask_pending_lookup: session
  });

  if (activeDobLookup) {
    activeDobLookup.session = session;
    if (tabId) activeDobLookup.tabId = tabId;
  } else if (tabId) {
    activeDobLookup = { tabId, session, startTime: Date.now() };
  }

  broadcastDobMessage({
    action: 'DOB_LOOKUP_PROGRESS',
    step: 5,
    totalSteps: 6,
    message: `ThatSthem ${index + 1}/${steps.length}: searching by ${step.label}...`
  });

  if (tabId) {
    chrome.tabs.update(tabId, { url: step.url }).catch(() => {
      chrome.tabs
        .create({ url: step.url, active: false })
        .then((newTab) => {
          if (activeDobLookup) activeDobLookup.tabId = newTab.id;
        })
        .catch(() => {});
    });
  }

  if (sendResponse) sendResponse({ success: true, nextUrl: step.url, exhausted: false });
}

async function advanceThatsThemNext(senderTabId, session, sendResponse) {
  const tabId = (activeDobLookup && activeDobLookup.tabId) || senderTabId;

  // Ignore a duplicate "next" fired while the page is already being replaced.
  if (session.themLastAdvanceAt && Date.now() - session.themLastAdvanceAt < 1200) {
    if (sendResponse) sendResponse({ success: true, ignored: true });
    return;
  }

  const nextIndex = (session.themIndex || 0) + 1;
  const steps = session.themSteps || [];
  if (nextIndex < steps.length) {
    await goToThatsThemStep(session, tabId, nextIndex, sendResponse);
    return;
  }

  exhaustDobLookup(session, sendResponse);
}

async function advanceDobNextAddress(senderTabId, sendResponse) {
  const data = await chrome.storage.local.get('unmask_pending_lookup');
  const session = data ? data.unmask_pending_lookup : (activeDobLookup ? activeDobLookup.session : null);

  if (!session) {
    if (sendResponse) sendResponse({ success: false, error: 'No session' });
    return;
  }

  const tabId = (activeDobLookup && activeDobLookup.tabId) || senderTabId;

  // Once Unmask is exhausted the very same tab keeps the run alive on ThatSthem.
  if (session.stage === 'thatsthem') {
    await advanceThatsThemNext(senderTabId, session, sendResponse);
    return;
  }

  const addresses = session.addresses || [];
  const currentIndex = session.addressIndex || 0;
  const nextIndex = currentIndex + 1;

  function advanceToUrl(newUrl, progressMsg, statusName, isPhone, isName) {
    session.status = statusName;
    chrome.storage.local.set({ unmask_pending_lookup: session });

    if (activeDobLookup) {
      activeDobLookup.session = session;
      if (tabId) activeDobLookup.tabId = tabId;
    } else if (tabId) {
      activeDobLookup = { tabId, session, startTime: Date.now() };
    }

    broadcastDobMessage({
      action: 'DOB_LOOKUP_PROGRESS',
      step: 3,
      totalSteps: 5,
      message: progressMsg
    });

    if (tabId) {
      chrome.tabs.update(tabId, { url: newUrl }).catch(() => {
        chrome.tabs.create({ url: newUrl, active: false }).then((newTab) => {
          if (activeDobLookup) activeDobLookup.tabId = newTab.id;
        });
      });
    }

    if (sendResponse) {
      sendResponse({ success: true, nextUrl: newUrl, exhausted: false, isPhoneSearch: !!isPhone, isNameSearch: !!isName });
    }
  }

  // 1. Next Address
  if (nextIndex < addresses.length) {
    const nextAddr = addresses[nextIndex];
    const nextUrl = buildUnmaskUrlForAddress(nextAddr);
    session.addressIndex = nextIndex;
    advanceToUrl(
      nextUrl,
      `Trying address ${nextIndex + 1} of ${addresses.length}: ${nextAddr.street || ''}...`,
      'searching'
    );
    return;
  }

  // 2. Phone Fallback (https://unmask.com/phone/XXX-XXX-XXXX/)
  if (session.phone && !session.searchedPhone) {
    session.searchedPhone = true;
    const phoneUrl = buildUnmaskUrlForPhone(session.phone);
    if (phoneUrl) {
      advanceToUrl(
        phoneUrl,
        `Addresses exhausted. Searching phone on Unmask (${session.phone})...`,
        'searching_phone',
        true,
        false
      );
      return;
    }
  }

  // 3. Name + State + City Fallback (https://unmask.com/Betty-Hyatt/TX-Paris/)
  if (session.targetName && session.state && session.city && !session.searchedNameCity) {
    session.searchedNameCity = true;
    const nameCityUrl = buildUnmaskNameCityUrl(session.targetName, session.state, session.city);
    if (nameCityUrl) {
      advanceToUrl(
        nameCityUrl,
        `Searching name on Unmask (${session.targetName}, ${session.city}, ${session.state})...`,
        'searching_name_city',
        false,
        true
      );
      return;
    }
  }

  // 4. Name + State Fallback (without city) (https://unmask.com/Betty-Hyatt/TX/)
  if (session.targetName && session.state && !session.searchedNameState) {
    session.searchedNameState = true;
    const nameStateUrl = buildUnmaskNameStateUrl(session.targetName, session.state);
    if (nameStateUrl) {
      advanceToUrl(
        nameStateUrl,
        `Searching name without city on Unmask (${session.targetName}, ${session.state})...`,
        'searching_name_state',
        false,
        true
      );
      return;
    }
  }

  // 5. Unmask exhausted -> fall back to the ThatSthem.com search order:
  //    name (city/state/zip) -> every address -> phone.
  if (!session.searchedThatsThem) {
    await startThatsThemPhase(session, tabId, sendResponse);
    return;
  }

  // 6. Both sites exhausted - let the user know.
  exhaustDobLookup(session, sendResponse);
}

// A weak date is one that cannot be trusted as the final answer:
//   * Unmask's January placeholder ("January 1962": real month/day unknown)
//   * a ThatSthem card that only shows the birth year ("1962")
// It is still shown to the user immediately (DOB 1), but the run keeps walking the
// remaining steps so a fuller date can be reported next to it (DOB 2).
async function handleDobSuccess(msg, sender) {
  let session = (activeDobLookup && activeDobLookup.session) || null;
  if (!session) {
    try {
      const stored = await chrome.storage.local.get(['unmask_pending_lookup', THATSTHEM_STORAGE_KEY]);
      session = stored.unmask_pending_lookup || stored[THATSTHEM_STORAGE_KEY] || null;
    } catch (e) {}
  }

  const tabId = (activeDobLookup && activeDobLookup.tabId) || (sender && sender.tab && sender.tab.id) || null;
  const isWeakReport = !!msg.continueSearch;

  if (isWeakReport && session) {
    // A repeated weak value (same step seen twice) is simply skipped, but the run must
    // still move on: the page that reported it has already stopped its own loop.
    if (session.weakDob && session.weakDob.dob === msg.dob) {
      try {
        session.themLastAdvanceAt = 0;
        await advanceThatsThemNext(tabId, session, null);
      } catch (e) {
        finishDobLookup();
      }
      return;
    }

    if (!session.weakDob) {
      session.weakDob = { dob: msg.dob, source: msg.source || '', yearOnly: !!msg.yearOnly };
      if (activeDobLookup) activeDobLookup.session = session;

      broadcastDobMessage({
        ...msg,
        searchContinues: true,
        dob1: msg.dob,
        dob1Source: msg.source || '',
        dob1Note: msg.yearOnly ? 'year only' : 'month/day unknown'
      });
    }

    try {
      if (msg.source === 'thatsthem.com') {
        // Already walking the ThatSthem steps: jump straight to the next one.
        session.themLastAdvanceAt = 0;
        await advanceThatsThemNext(tabId, session, null);
      } else {
        await startThatsThemPhase(session, tabId, null);
      }
    } catch (e) {
      console.warn('[Background] Could not continue the DOB search:', e.message);
      finishDobLookup();
    }
    return;
  }

  const weak = session && session.weakDob ? session.weakDob : null;
  broadcastDobMessage(
    weak
      ? {
          ...msg,
          dob1: weak.dob,
          dob1Source: weak.source,
          dob1Note: weak.yearOnly ? 'year only' : 'month/day unknown',
          dob2: msg.dob,
          dob2Source: msg.source || ''
        }
      : msg
  );
  finishDobLookup();
}

function finishDobLookup() {
  if (activeDobLookup && activeDobLookup.tabId) {
    setTimeout(() => {
      if (activeDobLookup && activeDobLookup.tabId) {
        chrome.tabs.remove(activeDobLookup.tabId).catch(() => {});
        activeDobLookup = null;
      }
    }, 1500);
  }
  chrome.storage.local.remove(['unmask_pending_lookup', THATSTHEM_STORAGE_KEY]).catch(() => {});
}

function cancelDobLookup(sendResponse) {
  if (activeDobLookup && activeDobLookup.tabId) {
    chrome.tabs.remove(activeDobLookup.tabId).catch(() => {});
    activeDobLookup = null;
  }
  chrome.storage.local.remove(['unmask_pending_lookup', THATSTHEM_STORAGE_KEY]).catch(() => {});
  if (sendResponse) sendResponse({ success: true });
}

function broadcastDobMessage(msg) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((t) => {
      if (t.id) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
    });
  });
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function handleStartMouseRecording(target, sender, sendResponse) {
  try {
    let originTab = null;
    if (sender && sender.tab && sender.tab.id) {
      originTab = sender.tab;
    } else {
      try {
        const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
        const focusedWin = windows.find((w) => w.focused) || windows[0];
        if (focusedWin && focusedWin.tabs) {
          originTab = focusedWin.tabs.find((t) => t.active) || focusedWin.tabs[0];
        }
      } catch (e) {}

      if (!originTab) {
        try {
          const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          originTab = tabs[0] || null;
        } catch (e) {}
      }
    }

    const targetUrl = target === 'unmask' ? 'https://unmask.com/' : 'https://thatsthem.com/';
    const session = {
      active: true,
      target: target,
      originTabId: originTab ? originTab.id : null,
      originWindowId: originTab ? originTab.windowId : null,
      url: targetUrl,
      startedAt: Date.now()
    };

    // If an existing recording tab was open, cleanly close it before starting a new one
    if (activeMouseRecordingTabId) {
      try {
        await chrome.tabs.remove(activeMouseRecordingTabId).catch(() => {});
      } catch (e) {}
      activeMouseRecordingTabId = null;
    }
    await chrome.storage.local.remove('active_mouse_recording');

    await chrome.storage.local.set({ active_mouse_recording: session });

    const recorderTab = await chrome.tabs.create({ url: targetUrl, active: true });
    activeMouseRecordingTabId = recorderTab.id;
    session.recorderTabId = recorderTab.id;
    await chrome.storage.local.set({ active_mouse_recording: session });

    if (sendResponse) sendResponse({ success: true, tabId: recorderTab.id });
  } catch (err) {
    console.error('[Background] Failed to start mouse recording:', err);
    if (sendResponse) sendResponse({ success: false, error: err.message });
  }
}

async function handleMouseRecordingCompleted(request, sender, sendResponse) {
  try {
    const tabId = sender && sender.tab && sender.tab.id ? sender.tab.id : activeMouseRecordingTabId;
    const originTabId = request.originTabId;
    const originWindowId = request.originWindowId;

    activeMouseRecordingTabId = null;

    const msg = {
      action: 'MOUSE_RECORDING_SAVED',
      target: request.target,
      result: request.result
    };
    broadcastDobMessage(msg);

    if (tabId) {
      setTimeout(() => {
        chrome.tabs.remove(tabId).catch(() => {});
      }, 250);
    }

    if (originTabId) {
      setTimeout(() => {
        chrome.tabs.update(originTabId, { active: true }).catch(() => {});
        if (originWindowId) {
          chrome.windows.update(originWindowId, { focused: true }).catch(() => {});
        }
      }, 350);
    }

    if (sendResponse) sendResponse({ success: true });
  } catch (err) {
    console.error('[Background] Error handling mouse recording completion:', err);
    if (sendResponse) sendResponse({ success: false, error: err.message });
  }
}

async function handleCancelMouseRecording(sendResponse) {
  try {
    if (activeMouseRecordingTabId) {
      chrome.tabs.remove(activeMouseRecordingTabId).catch(() => {});
      activeMouseRecordingTabId = null;
    }
    await chrome.storage.local.remove('active_mouse_recording');
    broadcastDobMessage({ action: 'MOUSE_RECORDING_CANCELLED' });
    if (sendResponse) sendResponse({ success: true });
  } catch (err) {
    if (sendResponse) sendResponse({ success: false, error: err.message });
  }
}

async function handleDeleteMouseRecording(target, sendResponse) {
  try {
    const keysToRemove = [];
    if (target === 'unmask') {
      keysToRemove.push('recorded_macro_unmask');
    } else if (target === 'thatsthem') {
      keysToRemove.push('recorded_macro_thatsthem');
    } else {
      keysToRemove.push('recorded_macro_unmask', 'recorded_macro_thatsthem');
    }
    keysToRemove.push('last_macro_recording');
    keysToRemove.push('active_mouse_recording');

    await chrome.storage.local.remove(keysToRemove);

    broadcastDobMessage({
      action: 'MOUSE_RECORDING_DELETED',
      target: target
    });

    if (sendResponse) sendResponse({ success: true, target });
  } catch (err) {
    if (sendResponse) sendResponse({ success: false, error: err.message });
  }
}

async function handleReplayMacroClick(request, sender, sendResponse) {
  const tabId = sender?.tab?.id || request.tabId;
  const x = Math.round(Number(request.x));
  const y = Math.round(Number(request.y));

  if (!tabId || isNaN(x) || isNaN(y)) {
    if (sendResponse) sendResponse({ success: false, error: 'Invalid coordinates or tabId' });
    return;
  }

  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');

    // 1. Move mouse cursor to target coordinate
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x,
      y: y
    });

    await new Promise((r) => setTimeout(r, 60));

    // 2. Press left mouse button
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      clickCount: 1,
      x: x,
      y: y
    });

    await new Promise((r) => setTimeout(r, 100));

    // 3. Release left mouse button
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      x: x,
      y: y
    });

    await new Promise((r) => setTimeout(r, 50));
    await chrome.debugger.detach(target).catch(() => {});

    if (sendResponse) sendResponse({ success: true, x, y });
  } catch (err) {
    console.warn('[Background] Debugger trusted click failed:', err);
    try {
      await chrome.debugger.detach(target).catch(() => {});
    } catch (e) {}
    if (sendResponse) sendResponse({ success: false, error: err.message });
  }
}

async function startParallelLookup(phoneNumber, session, sender, sendResponse) {
  if (activeLookup && activeLookup.timeoutId) {
    clearTimeout(activeLookup.timeoutId);
  }

  let callerTabId = sender?.tab?.id || null;
  if (!callerTabId) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0]) callerTabId = tabs[0].id;
    } catch (e) {}
  }

  const searchId = ++searchCounter;

  activeLookup = {
    searchId: searchId,
    session: session || null,
    phone: phoneNumber,
    tabId: callerTabId,
    sendResponse: sendResponse,
    responded: false,
    expired: false,
    results: [],
    errors: [],
    completedSources: new Set(),
    timeoutId: null
  };

  // 20-second safety timeout. The lookup is only marked expired (not discarded), so a
  // slow source that answers later is still streamed to the widget instead of vanishing.
  activeLookup.timeoutId = setTimeout(() => {
    if (activeLookup && activeLookup.searchId === searchId) {
      if (!activeLookup.responded) {
        try {
          activeLookup.sendResponse({
            success: false,
            error: 'Parallel lookup timed out after 20s.'
          });
        } catch (e) {}
      }
      activeLookup.expired = true;
    }
  }, 20000);

  try {
    await ensureOffscreenDocument();

    // Dispatch search in-place to already warm iframes
    dispatchToWorker('infolookup.site', phoneNumber, searchId);
    dispatchToWorker('vibegenx.com', phoneNumber, searchId);
  } catch (err) {
    if (activeLookup && activeLookup.searchId === searchId) {
      clearTimeout(activeLookup.timeoutId);
      try {
        activeLookup.sendResponse({
          success: false,
          error: err.message || 'Failed to initialize background automation.'
        });
      } catch (e) {}
      activeLookup = null;
    }
  }
}

async function dispatchToWorker(source, phone, searchId) {
  // If port is already connected, send immediately (0ms delay)
  const port = workerPorts[source];
  if (port) {
    try {
      port.postMessage({ action: 'EXECUTE_SEARCH', phone, searchId });
      return;
    } catch (e) {
      workerPorts[source] = null;
    }
  }

  // If port is not ready yet, wait up to 2.5 seconds for connection
  const start = Date.now();
  while (Date.now() - start < 2500) {
    await new Promise((r) => setTimeout(r, 100));
    const p = workerPorts[source];
    if (p) {
      try {
        p.postMessage({ action: 'EXECUTE_SEARCH', phone, searchId });
        return;
      } catch (e) {
        workerPorts[source] = null;
      }
    }
  }

  // If worker didn't connect, notify offscreen to reload that iframe
  chrome.runtime.sendMessage({ action: 'RELOAD_IFRAME', source }).catch(() => {});
}

async function handleAutomationResult(msg) {
  if (!activeLookup || activeLookup.searchId !== msg.searchId) {
    return; // Ignore stale or mismatched search responses
  }

  const { source, data, error } = msg;

  if (activeLookup.completedSources.has(source)) return;
  activeLookup.completedSources.add(source);

  // vibegenx.com often returns street-only records ("3724 Kildare Dr"). Fill in the
  // missing city/state/zip before the record is streamed, so the widget shows the full
  // address. Only the primary address is resolved here and with a tight budget: a slow
  // source must never lose its record to the parallel-lookup timeout, and the run's
  // other addresses are completed on demand (Amica / Mercury / Unmask ask for them).
  if (data) {
    try {
      await completeResultAddresses(data, { maxAddresses: 1, budgetMs: 1200 });
    } catch (e) {
      console.warn('[Background] Address completion failed:', e.message);
    }
  }

  // The lookup may have been replaced by a newer search while the addresses completed.
  if (!activeLookup || activeLookup.searchId !== msg.searchId) {
    return;
  }

  if (data) {
    activeLookup.results.push({ source, data });
  } else {
    activeLookup.errors.push({ source, error });
  }

  const isFirstSuccess = activeLookup.results.length === 1 && !!data;
  const totalCompleted = activeLookup.results.length + activeLookup.errors.length;
  const isAllDone = totalCompleted >= 2;

  // Stream message to widget
  const streamMsg = {
    action: 'PARALLEL_STREAM_RESULT',
    source: source,
    data: data || null,
    error: error || null,
    isFirst: isFirstSuccess,
    isAllDone: isAllDone,
    session: activeLookup.session
  };

  sendToWidget(streamMsg);

  // If this is the fastest successful result, reply immediately (never to a promise
  // that already timed out - but the widget was still told above).
  if (isFirstSuccess && !activeLookup.responded && !activeLookup.expired) {
    activeLookup.responded = true;
    try {
      activeLookup.sendResponse({
        success: true,
        data: data,
        source: source,
        isFirst: true,
        isAllDone: isAllDone,
        session: activeLookup.session
      });
    } catch (e) {}
  }

  // If both completed
  if (isAllDone) {
    if (!activeLookup.responded && !activeLookup.expired) {
      activeLookup.responded = true;
      try {
        activeLookup.sendResponse({
          success: false,
          error: activeLookup.errors.map((e) => `${e.source}: ${e.error}`).join(' | ') || 'No results from either source.'
        });
      } catch (e) {}
    }

    if (activeLookup.timeoutId) clearTimeout(activeLookup.timeoutId);
    activeLookup = null;
    // NOTE: Keep offscreen document and iframes warm in memory for instant subsequent searches
  }
}

function sendToWidget(msg) {
  // 1. Send directly to caller tab
  if (activeLookup?.tabId) {
    chrome.tabs.sendMessage(activeLookup.tabId, msg).catch(() => {});
  }

  // 2. Broadcast to all active tabs as fallback
  chrome.tabs.query({ active: true }, (tabs) => {
    tabs.forEach((t) => {
      if (t.id && t.id !== activeLookup?.tabId) {
        chrome.tabs.sendMessage(t.id, msg).catch(() => {});
      }
    });
  });

  // 3. Send runtime message for any extension context
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function ensureOffscreenDocument() {
  const OFFSCREEN_PATH = 'offscreen.html';

  if (typeof chrome.offscreen.hasDocument === 'function') {
    if (await chrome.offscreen.hasDocument()) {
      return;
    }
  } else if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (contexts && contexts.length > 0) {
      return;
    }
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['DOM_SCRAPING'],
      justification: 'Automating parallel TCPA compliance lookup in background'
    });
  } catch (err) {
    if (!err.message.includes('Only a single offscreen document')) {
      throw err;
    }
  }
}
