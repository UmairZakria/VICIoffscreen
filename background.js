// Background Service Worker for Manifest V3
// Keeps persistent headless workers warm in the background for instant sub-second lookups

let activeLookup = null;
let searchCounter = 0;
const workerPorts = {
  'infolookup.site': null,
  'infolookupp.com': null,
  'uspeoplesearch.net': null
};

// ---------------------------------------------------------------------------
// Run-time settings (Settings & Calibration panel)
//
// One storage key, written by the widget / popup / window: which records a number is looked up on,
// which platforms the DOB button may ask, and which record's DNC status is drawn. Everything
// defaults to on, so an install that never opens the panel behaves exactly as it always has.
// ---------------------------------------------------------------------------
const AUTOMATION_SETTINGS_KEY = 'automation_settings';
const AUTOMATION_SETTINGS_DEFAULTS = {
  records: { record1: true, record2: true, record3: true },
  dob: { unmask: true, thatsthem: true, ai: true },
  dnc: { record1: true, record2: true, record3: true }
};

// The three sites are the user's Record 1, Record 2 and Record 3; vehicle discovery is the single
// "Rides" action.
const RECORD_SOURCES = ['infolookup.site', 'infolookupp.com', 'uspeoplesearch.net'];
const RECORD_KEYS = {
  'infolookup.site': 'record1',
  'infolookupp.com': 'record2',
  'uspeoplesearch.net': 'record3'
};
// Mercury's automation is still wired up here, but it has no UI entry point, so both providers
// carry the one "Rides" label the panel shows.
const RIDE_LABELS = { amica: 'Rides', mercury: 'Rides' };

function recordKey(source) {
  return RECORD_KEYS[String(source == null ? '' : source).toLowerCase()] || '';
}

function recordLabel(source) {
  if (String(source == null ? '' : source).toLowerCase() === 'infolookup.site') return 'Record 1';
  if (String(source == null ? '' : source).toLowerCase() === 'infolookupp.com') return 'Record 2';
  if (String(source == null ? '' : source).toLowerCase() === 'uspeoplesearch.net') return 'Record 3';
  return 'Record';
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

async function getAutomationSettings() {
  try {
    const stored = await chrome.storage.local.get([AUTOMATION_SETTINGS_KEY]);
    return normalizeAutomationSettings(stored ? stored[AUTOMATION_SETTINGS_KEY] : null);
  } catch (e) {
    return normalizeAutomationSettings(null);
  }
}

// Which records are switched on, in the order they stream.
function enabledRecordSources(settings) {
  return RECORD_SOURCES.filter((source) => settingValue(settings, 'records.' + recordKey(source)));
}

// The DOB platforms the user left switched on. Read once when a run starts and carried on that run's
// session, so a switch flipped mid-run cannot make the run fall back to a source that is off.
function dobSourcesFromSettings(settings) {
  return {
    unmask: settingValue(settings, 'dob.unmask'),
    thatsthem: settingValue(settings, 'dob.thatsthem'),
    ai: settingValue(settings, 'dob.ai')
  };
}

// Pre-warm the background runners immediately on extension install or startup
chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreenDocument().catch(() => {});
  prewarmAmica().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreenDocument().catch(() => {});
  prewarmAmica().catch(() => {});
});

// The service worker also starts when the extension is reloaded, and that is exactly when the
// offscreen document is gone - `onInstalled` does not fire for an unpacked reload. Creating it here
// means it is booted and listening before the first lookup asks for a runner, so that lookup cannot
// land inside the "document exists but is not listening yet" window.
//
// Amica is deliberately NOT pre-loaded here: this runs on every service-worker wake, and re-pointing
// a parked page each time would defeat keeping it warm.
ensureOffscreenDocument().catch(() => {});

// The tab the widget's refresh button was pressed on. The whole-extension reload that follows (see
// restartExtension) invalidates the widget that asked for it, so the tab id is remembered for a moment
// and the service worker that starts up **on the other side of the reload** puts the widget back. The
// button therefore reads as "restart the extension and carry on", not "lose the widget and go hunting
// for the toolbar icon". The flag is read once and removed immediately, so a browser restart hours
// later can never resurrect a widget on a tab that has moved on.
const REINJECT_AFTER_RELOAD_KEY = 'widget_reinject_after_reload';
const REINJECT_MAX_AGE_MS = 60000;

// Where a popped-out panel came from. The widget hides itself rather than removing itself, so closing the
// window can show the very same panel - with what it was holding - back on the page it was opened from.
// The record lives in storage because the worker can be torn down between the pop-out and the close.
const POPOUT_RETURN_KEY = 'widget_popout_return';
const POPOUT_RETURN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

(async () => {
  try {
    const stored = await chrome.storage.local.get(REINJECT_AFTER_RELOAD_KEY);
    const pending = stored && stored[REINJECT_AFTER_RELOAD_KEY];
    if (!pending || !pending.tabId) return;

    await chrome.storage.local.remove(REINJECT_AFTER_RELOAD_KEY);
    if (Date.now() - (pending.at || 0) > REINJECT_MAX_AGE_MS) return;

    await chrome.scripting.executeScript({
      target: { tabId: pending.tabId },
      files: ['widget.js']
    });
  } catch (e) {
    // The tab is gone, or it is not a page this extension is allowed to script: nothing to put back.
  }
})();

// The widget is deliberately **not** a content script any more: it used to be injected into every
// page on every site, which put it on pages nobody asked about. It is injected here instead, the
// first time the toolbar icon is clicked on a tab, and from then on that icon toggles it.
chrome.action.onClicked.addListener(async (tab) => {
  ensureOffscreenDocument().catch(() => {});

  if (!tab || !tab.id) return;
  if (!isWebPageUrl(tab.url)) return;

  // The widget is already on this page - the click only shows or hides it.
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_WIDGET' });
    return;
  } catch (err) {
    // Nothing listening in this tab: the widget has not been injected here yet, which is exactly what
    // the first click on the icon means.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['widget.js']
    });
    // Nothing is sent after this on purpose: a freshly injected widget shows itself, so a
    // TOGGLE_WIDGET here would hide the widget that was just put on the page.
  } catch (injectErr) {
    console.error('Could not inject widget:', injectErr);
  }
});

// The detached panel: the widget's pop-out opens window.html as its own window - `type: 'popup'`, so it
// is a window and not another tab - and it is not tied to the page the widget was injected into.
//
// The bounds are shared with the popup's own pop-out (`winBounds`, written by window.js as the user moves
// and resizes it), so the window reopens where it was left. Asking twice brings the open window forward
// instead of stacking a second copy, and the tab that asked is remembered so the panel can go back to it
// when the window is closed (see returnWidgetToPage).
async function openDetachedWindow(returnTabId) {
  const url = chrome.runtime.getURL('window.html');

  let windowId = null;
  try {
    const open = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    for (const win of open) {
      const holdsPanel = (win.tabs || []).some((tab) => String(tab.url || '').startsWith(url));
      if (holdsPanel && win.id !== undefined) {
        await chrome.windows.update(win.id, { focused: true, drawAttention: true });
        windowId = win.id;
        break;
      }
    }
  } catch (e) {
    // getAll is only a convenience here: it failing must not stop the window from being opened.
  }

  if (windowId === null) {
    let bounds = { width: 420, height: 690, top: 100, left: 100 };
    try {
      const stored = await chrome.storage.local.get(['winBounds']);
      if (stored && stored.winBounds) bounds = Object.assign(bounds, stored.winBounds);
    } catch (e) {
      // Default bounds are fine when storage cannot be read.
    }

    const created = await chrome.windows.create({ url: url, type: 'popup', ...bounds, focused: true });
    windowId = created ? created.id : null;
  }

  // Which page the panel should go back to. Written whether the window was created or brought forward, so
  // a pop-out from a second page takes the return over from the first.
  if (returnTabId) {
    const record = { tabId: returnTabId, windowId: windowId, at: Date.now() };
    try {
      await chrome.storage.local.set({ [POPOUT_RETURN_KEY]: record });
    } catch (e) {}
  }

  return { ok: true, windowId: windowId };
}

// The popped-out window was closed, so the panel goes back to the page it came from. The widget there was
// hidden, not removed - so it is shown again, holding everything it had. Only when there is nothing left
// to show (the page was reloaded, or the panel was closed from the page) is a fresh widget injected.
async function returnWidgetToPage(windowId) {
  let record = null;
  try {
    const stored = await chrome.storage.local.get(POPOUT_RETURN_KEY);
    record = stored ? stored[POPOUT_RETURN_KEY] : null;
  } catch (e) {
    return;
  }

  if (!record || !record.tabId) return;
  // Another popped-out window, not the one this record is about: leave it alone.
  if (windowId !== undefined && record.windowId !== undefined && windowId !== record.windowId) return;
  if (Date.now() - (record.at || 0) > POPOUT_RETURN_MAX_AGE_MS) {
    try {
      await chrome.storage.local.remove(POPOUT_RETURN_KEY);
    } catch (e) {}
    return;
  }

  try {
    await chrome.storage.local.remove(POPOUT_RETURN_KEY);
  } catch (e) {}

  try {
    await chrome.tabs.sendMessage(record.tabId, { action: 'SHOW_WIDGET' });
    return;
  } catch (e) {
    // Nothing listening: the page moved on, so the panel is put back the way the toolbar icon does it.
  }

  try {
    const tab = await chrome.tabs.get(record.tabId);
    if (!tab || !isWebPageUrl(tab.url)) return;
    await chrome.scripting.executeScript({ target: { tabId: record.tabId }, files: ['widget.js'] });
  } catch (e) {
    // The tab is gone: there is nothing to bring the panel back to.
  }
}

// Closing the detached window is what asks for the panel back on the page. Registered at the top level so
// Chrome wakes the worker for it.
chrome.windows.onRemoved.addListener((windowId) => {
  returnWidgetToPage(windowId).catch(() => {});
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
// Google AI Mode is a *second* DOB source that runs beside Unmask, not instead of it, so it has its
// own run, its own storage key and its own runner frame.
let activeGoogleLookup = null; // { tabId, mode, source, session, startTime }
const GOOGLE_STORAGE_KEY = 'google_pending_lookup';
const GOOGLE_RUNNER_FRAME = 'google.com';
const GOOGLE_HOME_URL = 'https://www.google.com/';
const GOOGLE_MAX_ADDRESSES = 4;
// Google's *email* run is a second AI Mode job on the same runner:
//
//   "{name} lives at {address} born in {year|Month year} any public available primary email .
//    gmail hotmail yahoo icloud are prefered"
//
// It keeps its own storage key, so the DOB run and the email run can never read each other's session -
// but they share the one runner frame, so starting either one supersedes the other (the DOB run's own
// answer is what the email query's month comes from, so they are meant to be run in turn).
const GOOGLE_EMAIL_STORAGE_KEY = 'google_email_pending_lookup';
let activeGoogleEmailLookup = null; // { tabId, mode, source, session, startTime }
// Google's *gender* run is the third AI Mode job on the same runner:
//
//   "{name} is male or female?"
//
// A question about a name has nothing to narrow down address by address, so it is a single query - and
// it keeps its own storage key like the other two, so none of the three can read another's session.
// All three share the one runner frame, so starting any of them supersedes the others.
const GOOGLE_GENDER_STORAGE_KEY = 'google_gender_pending_lookup';
let activeGoogleGenderLookup = null; // { tabId, mode, source, session, startTime }
// Google's *address resolver* is the fourth AI Mode job, and the only one asked about a record the user
// typed in by hand - the manual card. It asks two questions about that same input, in order:
//
//   "{name} lives at {input} what is the full address, email and dob?"
//   "{name} lives at {input} whats the full address?"
//
// (the second is the fallback: a page that answers none of the three things the first asks for usually
// answers the plain address question). It keeps its own storage key like the others, and shares the one
// runner frame with them: starting any of the four supersedes the rest.
const GOOGLE_ADDRESS_STORAGE_KEY = 'google_address_pending_lookup';
let activeGoogleAddressLookup = null; // { tabId, mode, source, session, startTime }
// Google runs in the hidden offscreen runner, like the other sites, so no tab ever appears for it.
// Set this to true to watch it work instead: the run then uses a real tab, brought to the front - and
// the whole search-history step prints its step-by-step trace to that tab's console (F12). With it
// false (as shipped) the run is invisible; the trace then lands in the offscreen document's console,
// which is reachable through chrome://extensions -> Inspect views: offscreen.html.
const GOOGLE_VISIBLE = false;
// The tab the visible runs reuse, so a run left open for inspection is not joined by a second one.
let googleDebugTabId = null;
// Amica is kept loaded in the hidden runner between searches, so a lookup starts at the quoting ZIP
// instead of waiting for the whole site to boot. Only the frame itself can tell when its form is up,
// so it reports back (AMICA_RUNNER_READY) and that report is what is trusted here.
const AMICA_WARM_KEY = 'amica_runner_ready';
const AMICA_WARM_TTL_MS = 10 * 60 * 1000;
// How long a warm page gets to pick a quote up before the run falls back to loading Amica normally.
const AMICA_WARM_FALLBACK_MS = 4000;

// Fire-and-forget beside the Unmask run, so it needs its own stop: a page that never answers (a
// consent wall, a script that never loads) must not leave the runner loaded for ever.
const GOOGLE_RUN_BUDGET_MS = 150000;
const GOOGLE_EMAIL_RUN_BUDGET_MS = 150000;
const GOOGLE_GENDER_RUN_BUDGET_MS = 150000;
const GOOGLE_ADDRESS_RUN_BUDGET_MS = 150000;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'LOOKUP_PHONE') {
    handleAuthorizedLookup(request.phone, request.session, sender, sendResponse);
    return true; // Keep channel open for async response
  }
  if (request.action === 'AUTH_LOGIN') {
    handleAuthLogin(request.username, request.password, request.apiUrl, sendResponse);
    return true;
  }
  if (request.action === 'AUTH_SYNC_QUOTA') {
    handleAuthSyncQuota(sendResponse);
    return true;
  }
  if (request.action === 'AUTH_LOGOUT') {
    chrome.storage.local.remove(['dnc_auth_token', 'dnc_auth_user']).then(() => {
      chrome.runtime.sendMessage({ action: 'AUTH_LOGGED_OUT' }).catch(() => {});
      if (sendResponse) sendResponse({ success: true });
    });
    return true;
  }
  if (request.action === 'PAGE_PHONE_DETECTED') {
    // Relay to any open standalone windows or popups
    chrome.runtime.sendMessage(request).catch(() => {});
  }
  if (request.action === 'START_VEHICLE_LOOKUP') {
    startVehicleLookup(request.provider, request.profile, sendResponse);
    return true;
  }
  // amica_automation.js / unmask_automation.js / thatsthem_automation.js ask this before they
  // drive their page. It must be answered, or the automation treats the unanswered message as
  // "not ours" and silently does nothing - which is what left the UI stuck on "Initializing
  // Amica vehicle lookup...".
  //
  // A content script in a normal tab always has `sender.tab`; the offscreen document is not a
  // tab, so it is the only context in which a subframe can legitimately be told yes. A page that
  // embeds one of these sites in a frame of its own is in a tab, and is refused.
  if (request.action === 'RUNNER_HELLO') {
    sendResponse({ ok: !sender || !sender.tab });
    return true;
  }
  // A security check has appeared. There is nothing to click - Cloudflare only accepts a real
  // hand - so an offscreen run opens a background copy and waits for that tab to confirm the
  // challenge before showing it. A tab already running the check is simply brought forward.
  if (request.action === 'FOCUS_LOOKUP_TAB') {
    bringLookupIntoView(sender).catch(() => {});
  }
  // The user cleared the check in the promoted tab. The run is returned to the hidden runner when
  // that tab actually showed the challenge; otherwise the tab remains as a background fallback.
  if (request.action === 'CHALLENGE_CLEARED') {
    hideLookupAfterChallenge(sender).catch(() => {});
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
  // Amica found no vehicles for the address it was given. Its other addresses are tried before the
  // lookup is reported as empty.
  if (request.action === 'AMICA_NEXT_ADDRESS') {
    retryAmicaWithAddress(request, sendResponse);
    return true;
  }
  // The hidden Amica page reports whether it is loaded and idle. That report is what lets the next
  // lookup start at the quoting ZIP instead of booting the site again.
  if (request.action === 'AMICA_RUNNER_READY') {
    setAmicaWarm(!!request.ready);
  }
  if (request.action === 'VEHICLE_LOOKUP_PROGRESS') {
    // The initial "Starting..." line only confirms that the script ran; it does not prove the
    // landing form was found or submitted. Keep the warm fallback armed until the quote flow
    // reports a real step so a stale/new-layout page cannot leave the lookup stuck indefinitely.
    if (
      activeVehicleLookup &&
      request.message !== 'Starting Amica vehicle automation...'
    ) {
      activeVehicleLookup.sawProgress = true;
    }
    broadcastVehicleMessage(request);
  }
  if (request.action === 'VEHICLE_LOOKUP_SUCCESS') {
    broadcastVehicleMessage(request);
    // Give the widget a moment to read the broadcast before the run is torn down.
    setTimeout(() => finishVehicleLookup(), 1500);
  }
  if (request.action === 'VEHICLE_LOOKUP_EMPTY') {
    broadcastVehicleMessage(request);
    setTimeout(() => finishVehicleLookup(), 1500);
  }
  if (request.action === 'VEHICLE_LOOKUP_ERROR') {
    broadcastVehicleMessage(request);
    finishVehicleLookup();
  }

  // DOB Lookup Actions (Unmask.com, with Google AI Mode running beside it)
  if (request.action === 'START_DOB_LOOKUP') {
    // Only the platforms the user left switched on in Settings are asked. Google AI Mode answers the
    // same question from the same record, so it is started here - and deliberately *not* awaited: it
    // reports on its own line, so a Google page that is slow (or that never answers at all) can never
    // hold the Unmask / ThatSthem dates back.
    startDobLookupWithSettings(request, sendResponse, sender);
    return true;
  }
  if (request.action === 'CANCEL_DOB_LOOKUP') {
    cancelDobLookup(sendResponse);
    return true;
  }
  // The Google AI Mode *email* run: its own button on the card, its own pending session, the same
  // runner frame as the DOB run.
  if (request.action === 'START_GOOGLE_EMAIL_LOOKUP') {
    startGoogleEmailLookupWithSettings(request, sendResponse);
    return true;
  }

  // The widget's pop-out. A content script has no access to chrome.windows, so the panel asks here and
  // the worker opens (or brings forward) the window - see openDetachedWindow.
  if (request.action === 'OPEN_DETACHED_WINDOW') {
    const returnTabId = sender && sender.tab && sender.tab.id ? sender.tab.id : null;
    openDetachedWindow(returnTabId)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  // The Google AI Mode *gender* run: the icon beside a person's name, one name-only query.
  if (request.action === 'START_GOOGLE_GENDER_LOOKUP') {
    startGoogleGenderLookupWithSettings(request, sendResponse);
    return true;
  }
  // The Google AI Mode *address resolver*: the Search button under a manual card.
  if (request.action === 'START_GOOGLE_ADDRESS_LOOKUP') {
    startGoogleAddressLookupWithSettings(request, sendResponse);
    return true;
  }
  // The widget's refresh button: a whole-extension restart. The reply is the worker's last act before
  // it reloads itself (see restartExtension), so it cannot be answered from anything but this call.
  if (request.action === 'RESTART_EXTENSION') {
    restartExtension(sender, sendResponse);
    return true;
  }
  if (request.action === 'DOB_LOOKUP_NEXT_ADDRESS') {
    // `force` is the page's last word: it asked for the next step, was told the page was still being
    // replaced, and asked again. Honouring it is what keeps a run from sitting on a page for ever.
    advanceDobNextAddress(sender?.tab?.id, sendResponse, request.record, request.force);
    return true;
  }
  // A security check has appeared on the lookup page. The extension does not try to clear it -
  // it only brings the tab to the front once, so the user can solve it, and the run carries on
  // by itself afterwards. When the run ends the tab is handed back (see restoreCallerTab).
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
    // Let the user read the last line, then hand their tab back to them. A message from a run
    // that has already been replaced by a press on the other record must not end the run that is
    // actually in flight, though.
    const runRecord = activeDobLookup && activeDobLookup.session ? activeDobLookup.session.record : '';
    if (!request.record || !runRecord || String(request.record) === runRecord) {
      endDobLookup(activeDobLookup && activeDobLookup.session, 1500);
    }
  }

  // Google AI Mode, the parallel DOB source. Its messages name the record they belong to just as the
  // Unmask ones do, so a result is drawn on the card that asked for it and never on the other one.
  if (request.action === 'GOOGLE_LOOKUP_PROGRESS') {
    broadcastDobMessage(request);
  }
  if (request.action === 'GOOGLE_DOB_RESULT') {
    broadcastDobMessage(request);
    // The answer has been found and is on the card: park the runner (or close the visible debug tab)
    // and drop the pending session.
    finishGoogleLookup(true, false);
  }
  if (request.action === 'GOOGLE_DOB_NEXT_ADDRESS') {
    nextGoogleAddress(sendResponse);
    return true;
  }
  if (request.action === 'GOOGLE_LOOKUP_EMPTY') {
    broadcastDobMessage(request);
  }

  // The Google AI Mode email run. Its messages name their record just like the DOB ones do, so the
  // addresses it finds land on the card that asked for them and never on the other one.
  if (request.action === 'GOOGLE_EMAIL_PROGRESS') {
    broadcastDobMessage(request);
  }
  if (request.action === 'GOOGLE_EMAIL_RESULT') {
    broadcastDobMessage(request);
    // The email is on the card: park the runner and drop the pending session.
    finishGoogleEmailLookup(true);
  }
  if (request.action === 'GOOGLE_EMAIL_NEXT_ADDRESS') {
    nextGoogleEmailAddress(sendResponse);
    return true;
  }
  if (request.action === 'GOOGLE_EMAIL_EMPTY') {
    broadcastDobMessage(request);
  }

  // The Google AI Mode gender run: the icon beside a person's name. Its messages carry the record too,
  // so the answer is drawn on the card whose person was asked about.
  if (request.action === 'GOOGLE_GENDER_PROGRESS') {
    broadcastDobMessage(request);
  }
  if (request.action === 'GOOGLE_GENDER_RESULT') {
    broadcastDobMessage(request);
    finishGoogleGenderLookup(true);
  }
  if (request.action === 'GOOGLE_GENDER_NEXT_ADDRESS') {
    nextGoogleGenderAddress(sendResponse);
    return true;
  }
  if (request.action === 'GOOGLE_GENDER_EMPTY') {
    broadcastDobMessage(request);
  }

  // The Google AI Mode address resolver (the manual card's Search button). Its messages name their
  // record too, so what it resolves is written onto the card that asked.
  if (request.action === 'GOOGLE_ADDRESS_PROGRESS') {
    broadcastDobMessage(request);
  }
  if (request.action === 'GOOGLE_ADDRESS_RESULT') {
    broadcastDobMessage(request);
    finishGoogleAddressLookup(true);
  }
  if (request.action === 'GOOGLE_ADDRESS_NEXT_ADDRESS') {
    nextGoogleAddressQuery(sendResponse);
    return true;
  }
  if (request.action === 'GOOGLE_ADDRESS_EMPTY') {
    broadcastDobMessage(request);
  }

});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeVehicleLookup && activeVehicleLookup.tabId === tabId) {
    activeVehicleLookup = null;
  }
  if (activeDobLookup && activeDobLookup.tabId === tabId) {
    activeDobLookup = null;
  }
});

// ---------------------------------------------------------------------------
// Where the user came from
//
// A DOB run is started from the widget (a content script, so `sender.tab` names the page), from
// the popup or from the standalone window - neither of the last two is a tab, so the last web
// tab the user was on is remembered instead. That is the tab they are put back on when the run
// ends, after they were taken to Unmask to watch a Cloudflare check being solved.
// ---------------------------------------------------------------------------
let lastUserTabId = null;

function isWebPageUrl(url) {
  return !!url && !/^(chrome|edge|about|devtools|chrome-extension|edge-extension|moz-extension):/i.test(url);
}

chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
  if (tabs && tabs[0] && tabs[0].id) {
    if (isWebPageUrl(tabs[0].url)) lastUserTabId = tabs[0].id;
  }
}).catch(() => {});

chrome.tabs.onActivated.addListener((info) => {
  if (!info || !info.tabId) return;
  chrome.tabs
    .get(info.tabId)
    .then((tab) => {
      if (tab && isWebPageUrl(tab.url)) lastUserTabId = tab.id;
    })
    .catch(() => {});
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
// infolookupp.com frequently returns only the street ("3724 Kildare Dr") while
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

// "1361 Vz County Road 2403" -> "Vz County Road 2403". Rural roads are mapped in OSM without house
// numbers, so the address-carrying query can come back empty while the road itself is there with the
// city and zip this record is missing.
function streetWithoutNumber(value) {
  return String(value || '')
    .replace(/^\s*\d+[a-z]?\s+/i, '')
    .trim();
}

// Whether that second question is worth asking at all. It is only asked for a road whose name carries
// an identifier of its own - "Vz County Road 2403", "Farm to Market Road 859", "County Road 12" - which
// is specific enough to stand on its own in one state. A bare "Oak St" is not: the same name exists in
// dozens of cities and the first hit could be in any of them, and a wrong city or zip is worse than a
// missing one.
function looksLikeNumberedRoad(value) {
  const s = String(value || '').toLowerCase();
  if (!/\d/.test(s)) return false;
  return /\b(county|county road|farm to market|farm|ranch|fm|rr|state|us|hwy|highway|loop|spur|old)\b/.test(s);
}

// The fields a hit can fill in. Never the street unless the record has none.
function completionOf(addr, hit) {
  const osm = (hit && hit.address) || {};
  const completed = {
    street: [osm.house_number, osm.road].filter(Boolean).join(' ') || String(addr.street || '').trim(),
    city: osm.city || osm.town || osm.village || osm.hamlet || osm.municipality || '',
    state: stateToCode(osm.state),
    zip: normalizeZip(osm.postcode),
    displayName: hit.display_name || ''
  };
  if (!completed.city && !completed.state && !completed.zip) return null;
  return completed;
}

// Fills in the missing city/state/zip of a partial address (never overwriting
// what the record already knows). Returns the completed fields or null.
async function completeAddress(addr, hints) {
  if (!needsAddressCompletion(addr)) return null;

  const key = addressCacheKey(addr, hints);
  const cache = await loadAddressCache();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.address;

  // The address as the record has it, and - for a rural street that OSM knows without house numbers -
  // the road on its own. The record's own street is never overwritten, so this can only fill blanks in.
  const queries = [];
  const full = buildNominatimQuery(addr, hints);
  if (full) queries.push(full);

  const street = String(addr.street || addr.full || '').trim();
  const withoutNumber = streetWithoutNumber(street);
  if (withoutNumber && withoutNumber !== street && looksLikeNumberedRoad(street)) {
    const roadOnly = buildNominatimQuery(Object.assign({}, addr, { street: withoutNumber }), hints);
    if (roadOnly && queries.indexOf(roadOnly) < 0) queries.push(roadOnly);
  }

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const roadOnly = i > 0;

    let results;
    try {
      results = await fetchNominatim(query);
    } catch (e) {
      // A failing API (403, timeout, offline) is not asked again with the fallback query: only "no
      // results" for the address-carrying query means the road itself is worth a look.
      console.warn(`[Background] Address completion failed for "${query}":`, e.message);
      break;
    }

    if (!Array.isArray(results) || results.length === 0) continue;

    const hit = results[0];
    const osm = hit.address || {};
    if (roadOnly && !osm.road) continue; // not a road: not about this address at all

    // The same strict verdict for both questions: the road name still has to be ours (the house number
    // only makes it stricter), because a wrong city or zip is worse than a missing one. Asking about
    // the road without its house number only removes the reason a hit could not be found - it does not
    // loosen what is accepted.
    const verdict = isTrustworthyHit(addr, hints, hit);
    if (!verdict.ok) {
      console.warn(`[Background] Ignored address result for "${query}": ${verdict.reason}`);
      continue;
    }

    const completed = completionOf(addr, hit);
    if (!completed) continue;

    cache.set(key, { address: completed, expiresAt: Date.now() + ADDRESS_CACHE_TTL_MS });
    persistAddressCache();
    console.log(`[Background] Completed address "${query}" -> ${completed.street}, ${completed.city}, ${completed.state} ${completed.zip}`);
    return completed;
  }

  return null;
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
    // Clear whatever the previous run left behind, in either mode. Nothing is pre-loaded here: this
    // run is about to take the Amica frame itself.
    finishVehicleLookup({ prepareNext: false });

    // Street-only records (infolookupp.com) would leave Amica/Mercury without city or
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

    // Amica is already loaded and idle in the hidden runner: writing the quote IS the start. The page
    // notices it where it stands and begins at the quoting ZIP, with no reload in between - which is
    // the whole point of keeping it warm.
    if (provider === 'amica' && (await amicaRunnerIsWarm())) {
      await chrome.storage.local.set({ [storageKey]: quoteData });
      setAmicaWarm(false);

      activeVehicleLookup = {
        tabId: null,
        provider: 'amica',
        profile,
        offscreen: true,
        warm: true,
        startTime: Date.now()
      };

      armAmicaWarmFallback(profile);
      if (sendResponse) sendResponse({ success: true, offscreen: true, warm: true });
      return;
    }

    await chrome.storage.local.set({ [storageKey]: quoteData });

    // Amica runs in the offscreen document's own frame, so the quote flow never takes a tab
    // out of the user's tab strip. Mercury is left alone: it was never moved over, and its
    // quote flow still expects a normal tab.
    if (provider === 'amica') {
      const started = await startAmicaInOffscreen(profile);
      if (started) {
        if (sendResponse) sendResponse({ success: true, offscreen: true });
        return;
      }
      console.warn('[Background] Offscreen Amica unavailable, falling back to a background tab');
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

// Amica finished the quote but listed no vehicles for the address it was given. Its other addresses
// are worth trying: Amica only returns vehicles for an address it can tie to the person, and a
// record's primary address is not always that one.
//
// The run is not ended - it is pointed at Amica again with the next address as the primary one, and
// the new page walks the funnel from the quoting ZIP. Which addresses have already been tried lives
// on the run, so this cannot bounce between two of them.
async function retryAmicaWithAddress(msg, sendResponse) {
  const run = activeVehicleLookup;
  if (!run || run.provider !== 'amica') {
    if (sendResponse) sendResponse({ ok: false });
    return;
  }

  const candidates = Array.isArray(msg.candidates) ? msg.candidates : [];
  const usedUpTo = Number.isInteger(msg.usedUpTo) ? msg.usedUpTo : 0;
  const key = (a) => String((a && (a.street || a.full)) || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Everything up to and including the address Amica actually used has now been tried.
  if (!run.triedAddresses) run.triedAddresses = [];
  for (let i = 0; i <= usedUpTo && i < candidates.length; i++) {
    const k = key(candidates[i]);
    if (k && run.triedAddresses.indexOf(k) < 0) run.triedAddresses.push(k);
  }

  const next = candidates.find((c) => c && c.street && run.triedAddresses.indexOf(key(c)) < 0);
  if (!next) {
    if (sendResponse) sendResponse({ ok: false, exhausted: true });
    return;
  }

  const profile = {
    ...(run.profile || {}),
    address: next,
    skippedPoBox: false,
    timestamp: Date.now(),
    retriedAddress: true
  };
  run.profile = profile;

  // A fresh session: the address is entered during the quote, so the flow has to start over.
  try {
    await clearAmicaCookies();
  } catch (e) {}

  // Written before Amica is pointed at it, because the automation reads it once, on load.
  await chrome.storage.local.set({ amica_pending_quote: profile });

  if (run.tabId) {
    chrome.tabs.update(run.tabId, { url: 'https://www.amica.com/' }).catch(() => {
      chrome.tabs
        .create({ url: 'https://www.amica.com/', active: false })
        .then((tab) => {
          if (activeVehicleLookup) activeVehicleLookup.tabId = tab.id;
        })
        .catch(() => {});
    });
  } else {
    const prepared = await prepareRunner('amica.com');
    if (!prepared.ok) {
      console.warn('[Background] Could not retry Amica with another address (' + prepared.reason + ').');
      if (sendResponse) sendResponse({ ok: false, reason: prepared.reason });
      return;
    }
  }

  broadcastVehicleMessage({
    action: 'VEHICLE_LOOKUP_PROGRESS',
    provider: 'amica',
    step: 1,
    totalSteps: 6,
    message:
      'No vehicles for that address - retrying with ' +
      [next.street, next.city, next.state].filter(Boolean).join(', ') +
      '...'
  });

  if (sendResponse) sendResponse({ ok: true });
}

// ------------------------------------------------------------------ keeping Amica loaded and idle

// Records whether a loaded, idle Amica is sitting in the hidden runner. Only the frame can know
// this, so nothing here is guessed: it is written when the page says it is usable and cleared the
// moment a run takes it over.
function setAmicaWarm(ready) {
  if (ready) {
    chrome.storage.local.set({ [AMICA_WARM_KEY]: { at: Date.now() } }).catch(() => {});
  } else {
    chrome.storage.local.remove(AMICA_WARM_KEY).catch(() => {});
  }
}

async function amicaRunnerIsWarm() {
  try {
    const stored = await chrome.storage.local.get([AMICA_WARM_KEY]);
    const warm = stored[AMICA_WARM_KEY];
    if (!warm || !warm.at) return false;
    return Date.now() - warm.at < AMICA_WARM_TTL_MS;
  } catch (e) {
    return false;
  }
}

// Loads Amica in the hidden runner before it is asked for, so the next lookup begins at the quoting
// ZIP rather than waiting for the site to boot. Cookies are cleared first, so the page that is
// parked there is a fresh Amica session rather than the last run's.
async function prewarmAmica() {
  // A run in flight owns the frame: never reload it underneath one.
  if (activeVehicleLookup) return false;

  try {
    setAmicaWarm(false);
    await clearAmicaCookies();
    await ensureOffscreenDocument();

    const res = await chrome.runtime.sendMessage({ action: 'PREPARE_RUNNER', source: 'amica.com' });
    if (!res || !res.ok) {
      console.log('[Background] Amica could not be pre-loaded (' + ((res && res.error) || 'no-response') + ').');
      return false;
    }

    console.log('[Background] Amica is loading in the hidden runner, ready for the next lookup.');
    return true;
  } catch (e) {
    return false;
  }
}

// A warm page that does not pick the quote up - it was replaced by a fresh offscreen document, for
// instance - must not leave the run sitting there: Amica is loaded normally instead.
function armAmicaWarmFallback(profile) {
  const run = activeVehicleLookup;
  setTimeout(() => {
    if (activeVehicleLookup !== run || run.sawProgress) return;
    console.warn('[Background] The pre-loaded Amica did not start - loading it normally.');
    finishVehicleLookup({ prepareNext: false });
    startVehicleLookup('amica', profile, null).catch(() => {});
  }, AMICA_WARM_FALLBACK_MS);
}

// The offscreen path for Amica.
//
// The pending quote is written to storage BEFORE the frame is asked to load, because
// amica_automation.js reads it once on load: if the frame loaded first it would find nothing
// and the run would never start. Clearing the stale cookies is what makes the new frame load
// a fresh Amica session rather than the previous run's.
async function startAmicaInOffscreen(profile) {
  try {
    await clearAmicaCookies();

    const quoteData = { ...profile, timestamp: Date.now() };
    await chrome.storage.local.set({ amica_pending_quote: quoteData });

    await ensureOffscreenDocument();

    const res = await chrome.runtime.sendMessage({
      action: 'PREPARE_RUNNER',
      source: 'amica.com'
    });
    if (!res || !res.ok) {
      await chrome.storage.local.remove(['amica_pending_quote']);
      return false;
    }

    activeVehicleLookup = {
      tabId: null,
      provider: 'amica',
      profile,
      offscreen: true,
      startTime: Date.now()
    };
    return true;
  } catch (e) {
    console.warn('[Background] Could not start Amica offscreen:', e.message);
    await chrome.storage.local.remove(['amica_pending_quote']).catch(() => {});
    return false;
  }
}

async function clearAmicaCookies() {
  if (!chrome.cookies) return;
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

// Ends a run in whichever mode it was started. In offscreen mode there is no tab to close, but
// the frame is parked back on about:blank so the finished quote (name, address, vehicles) is
// not left sitting in the offscreen document, and the pending quote is cleared either way.
function finishVehicleLookup({ clearQuote = true, prepareNext = true } = {}) {
  if (!activeVehicleLookup) return;
  const run = activeVehicleLookup;
  activeVehicleLookup = null;

  if (run.tabId) {
    chrome.tabs.remove(run.tabId).catch(() => {});
  } else if (run.offscreen && run.provider === 'amica') {
    chrome.runtime.sendMessage({ action: 'RESET_RUNNER', source: 'amica.com' }).catch(() => {});
    // Load the next Amica before it is asked for: the frame goes back to a fresh Amica session and
    // reports when its form is up, so the following search starts at the quoting ZIP.
    if (prepareNext) prewarmAmica().catch(() => {});
  }

  if (clearQuote) {
    const keys = run.provider === 'amica' ? ['amica_pending_quote'] : ['mercury_pending_quote'];
    chrome.storage.local.remove(keys).catch(() => {});
  }
}

function cancelVehicleLookup(sendResponse) {
  finishVehicleLookup();
  chrome.storage.local.remove(['amica_pending_quote', 'mercury_pending_quote']).catch(() => {});
  if (sendResponse) sendResponse({ success: true });
}

// Stops every run that is in flight: the phone lookup, the ride runs, the DOB runs and the Google run.
// Each one hands the user's own tab back the way a normal finish does, so nothing is left mid-flight
// with a tab open or a spinner turning.
function stopEveryRun() {
  // A phone lookup that is still waiting: answer it, then forget it. The widget bumps its own session
  // id when the button is pressed, which is what makes it ignore anything this run still streams.
  if (activeLookup) {
    const run = activeLookup;
    activeLookup = null;
    if (run.timeoutId) clearTimeout(run.timeoutId);
    if (!run.responded && run.sendResponse) {
      try {
        run.sendResponse({
          success: false,
          error: 'Cancelled by an extension restart.',
          session: run.session || null
        });
      } catch (e) {}
    }
  }

  // `prepareNext: false`: the frame is about to be destroyed by the reload, so parking a fresh page in
  // the old one would be thrown away a moment later.
  finishVehicleLookup({ clearQuote: true, prepareNext: false });
  if (activeDobLookup) cancelDobLookup();
  finishGoogleLookup(true);
  finishGoogleEmailLookup(true);
  finishGoogleGenderLookup(true);
  finishGoogleAddressLookup(true);
  setAmicaWarm(false);
}

// The widget's refresh button: a real, whole-extension restart.
//
// This is the one thing the widget cannot do for itself, and the reason the message exists at all.
// `chrome.runtime.reload()` tears down the service worker, the offscreen document with every runner
// frame inside it, and every extension page (popup, detached window), then loads all of them again
// from scratch - the service worker starts afresh and boots a new offscreen document, the static
// declarativeNetRequest rules are re-registered, and the widget is re-injected into the tab that asked
// (see REINJECT_AFTER_RELOAD_KEY above). A clean slate no amount of re-initialising can match.
//
// The reply is sent **before** the reload, because the reload destroys this worker: the widget is told
// "reloading" and stops spinning instead of waiting for a worker that is already gone.
async function restartExtension(sender, sendResponse) {
  const callerTabId = sender && sender.tab && sender.tab.id ? sender.tab.id : null;

  // 1. Every run in flight, so the reload cannot happen underneath a run that has a tab open.
  stopEveryRun();

  // 2. The state those runs wrote. A killed run must not be picked up by the next page load.
  try {
    await chrome.storage.local.remove([
      'amica_pending_quote',
      'mercury_pending_quote',
      'unmask_pending_lookup',
      THATSTHEM_STORAGE_KEY,
      GOOGLE_STORAGE_KEY,
      GOOGLE_EMAIL_STORAGE_KEY,
      GOOGLE_GENDER_STORAGE_KEY,
      GOOGLE_ADDRESS_STORAGE_KEY
    ]);
  } catch (e) {}

  // 3. Remember where to put the widget back, on the other side of the reload.
  if (callerTabId) {
    try {
      await chrome.storage.local.set({
        [REINJECT_AFTER_RELOAD_KEY]: { tabId: callerTabId, at: Date.now() }
      });
    } catch (e) {}
  }

  // 4. Answer first - this is the last message this worker will ever send - then reload.
  if (sendResponse) {
    sendResponse({ success: true, reload: true, tabId: callerTabId });
  }

  // 5. Every open widget takes itself out of its page. The reload invalidates all of them at once, and
  //    a widget whose context is gone is an inert box whose buttons do nothing - so they are removed
  //    rather than left behind. The tab that asked gets a fresh one from step 6 as soon as the new
  //    worker starts; any other tab gets one the next time the toolbar icon is used there.
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((t) => {
      if (t.id) chrome.tabs.sendMessage(t.id, { action: 'EXTENSION_RELOADING' }).catch(() => {});
    });
  });

  setTimeout(() => {
    chrome.runtime.reload();
  }, 600);
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

// The session of the run that is currently on screen - from memory while the worker lives,
// from storage after it was restarted.
async function storedDobSession() {
  try {
    const stored = await chrome.storage.local.get(['unmask_pending_lookup', THATSTHEM_STORAGE_KEY]);
    return stored.unmask_pending_lookup || stored[THATSTHEM_STORAGE_KEY] || null;
  } catch (e) {
    return null;
  }
}

// The tab a DOB run was started from. The widget hands its own tab over as `sender.tab`; the
// popup and the standalone window are not tabs, so the last web tab the user was on is used.
async function resolveCallerTabId(sender) {
  if (sender && sender.tab && sender.tab.id) return sender.tab.id;
  if (lastUserTabId) return lastUserTabId;
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs && tabs[0];
    return tab && tab.id && isWebPageUrl(tab.url) ? tab.id : null;
  } catch (e) {
    return null;
  }
}

// Puts the user back on the tab the run was started from. This only happens while they are
// still watching the lookup tab (it is the one on screen) - if they already moved on, their
// choice wins and nothing is stolen from them.
async function restoreCallerTab(session, lookupTabId) {
  const callerTabId = (session && session.callerTabId) || lastUserTabId || null;
  if (!callerTabId || !lookupTabId || callerTabId === lookupTabId) return false;

  try {
    const lookupTab = await chrome.tabs.get(lookupTabId).catch(() => null);
    if (lookupTab && !lookupTab.active) return false;

    const callerTab = await chrome.tabs.get(callerTabId).catch(() => null);
    if (!callerTab) return false;

    await chrome.tabs.update(callerTabId, { active: true });
    if (callerTab.windowId !== undefined) {
      await chrome.windows.update(callerTab.windowId, { focused: true }).catch(() => {});
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Unmask and ThatSthem each read their own storage key and one run spans both, so the session is
// kept under both names - exactly as goToThatsThemStep has always written it.
function persistDobSession(session) {
  return chrome.storage.local
    .set({ unmask_pending_lookup: session, [THATSTHEM_STORAGE_KEY]: session })
    .catch(() => {});
}

// Starts a DOB step inside the hidden offscreen runner. False means the runner is not available,
// so the caller falls back to a real background tab.
//
// A `no-frame` answer is retried once against a freshly created offscreen document: it means the
// open document does not have the frame this version of the code expects, which is what happens
// when a document from an earlier install outlives an update. Without the retry that stale state
// quietly degraded every DOB run into the visible tab this was built to remove.
// "This document is no use": either it has no such runner, or it exists but is not answering at all.
// Both are worth one freshly created document before the runner is reported unavailable.
const REPLACE_DOCUMENT_REASONS = ['no-frame', 'unknown-source', 'offscreen-not-listening'];

// Starts a DOB step inside the hidden offscreen runner. The answer carries the reason when the
// runner is not available, so Unmask can report a clear error without opening a browser tab.
async function startDobInOffscreen(frame, url) {
  let prepared = await prepareRunner(frame, url);

  if (!prepared.ok && REPLACE_DOCUMENT_REASONS.includes(prepared.reason)) {
    console.warn(
      '[Background] Offscreen document unusable for "' + frame + '" (' + prepared.reason + ') - recreating it.'
    );
    await ensureOffscreenDocument(true).catch(() => {});
    prepared = await prepareRunner(frame, url);
  }

  if (!prepared.ok) {
    console.warn(
      '[Background] Hidden runner unavailable for ' + frame + ' (' + prepared.reason +
        ').'
    );
  }
  return { ok: prepared.ok, reason: prepared.reason || '' };
}

// Opens a DOB run in the hidden runner. `session` must already be in storage before the runner
// loads, because the content script reads it exactly once on load.
async function openDobRunner(url, session) {
  session.currentUrl = url;
  await persistDobSession(session);

  const run = {
    mode: 'offscreen',
    tabId: null,
    // The frame that drives the whole run. It stays the Unmask frame even after the search moves
    // on to ThatSthem, because it is the frame element - not the site loaded inside it - that
    // PREPARE_RUNNER and RESET_RUNNER address.
    source: 'unmask.com',
    session,
    startTime: Date.now()
  };

  const prepared = await startDobInOffscreen(run.source, url);
  if (prepared.ok) {
    activeDobLookup = run;
    return run;
  }

  const error = new Error(
    'Unmask hidden runner unavailable (' + prepared.reason + '). No browser tab was opened.'
  );
  error.code = 'DOB_OFFSCREEN_UNAVAILABLE';
  error.record = session.record || '';
  throw error;
}

// A security check cannot be solved in the offscreen runner: a hidden frame cannot be put in
// front of anyone. The run is handed over to a background tab on the same step; that tab is only
// activated if it independently detects the challenge, and the frame is parked meanwhile.
//
// The URL comes from `session.currentUrl`, which the background records as it walks the run,
// rather than from the page that reported the check. Cloudflare normally serves its interstitial
// on the same URL, but it can also redirect to /cdn-cgi/challenge-platform/... - promoting to
// that would put the user in front of a page with nothing to solve.
async function promoteDobRunToTab(reportedUrl) {
  const run = activeDobLookup;
  if (!run) return false;

  // Already promoted: do not show a normal page unless that tab confirms the challenge.
  if (run.mode === 'tab' && run.tabId) {
    if (run.challengeSeenInTab) {
      chrome.tabs.update(run.tabId, { active: true }).catch(() => {});
    }
    return true;
  }

  const session = run.session || (await storedDobSession());
  const url = (session && session.currentUrl) || reportedUrl || null;
  if (!url) return false;

  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
  } catch (e) {
    return false;
  }

  // Only one runner may be live. Left alone, the frame would keep re-reading the challenge page
  // and asking to be promoted over and over.
  chrome.runtime.sendMessage({ action: 'RESET_RUNNER', source: run.source }).catch(() => {});
  chrome.runtime.sendMessage({ action: 'RESET_RUNNER', source: 'thatsthem.com' }).catch(() => {});

  run.mode = 'tab';
  run.tabId = tab.id;
  // Why this run is in a tab, so the progress line can say so.
  run.promotedForCheck = true;
  run.challengeSeenInTab = false;
  run.challengePromotions = (run.challengePromotions || 0) + 1;

  if (session) {
    session.promotedForChallenge = true;
    session.challengeCleared = false;
    session.challengeSeenInTab = false;
    // Kept in the session as well, so a service-worker restart cannot orphan this tab.
    session.dobTabId = tab.id;
    persistDobSession(session);
  }

  return true;
}

// "Put this lookup in front of the user." In offscreen mode that means promoting the run into a
// tab; in tab mode the tab is activated, which is what this has always done.
async function bringLookupIntoView(sender) {
  const run = activeDobLookup;

  if (run && run.returningOffscreen) {
    run.challengeDuringReturn = true;
    return;
  }

  if (run && run.mode === 'offscreen') {
    await promoteDobRunToTab(sender && sender.url);
    return;
  }

  const tabId = (sender && sender.tab && sender.tab.id) || (run && run.tabId);
  if (!tabId) return;

  chrome.tabs.update(tabId, { active: true }).catch(() => {});
  if (sender && sender.tab && sender.tab.windowId !== undefined) {
    chrome.windows.update(sender.tab.windowId, { focused: true }).catch(() => {});
  }

  // The same hand-back applies when the run was already in a tab (the offscreen document was
  // unavailable): once the check is gone that tab hides itself and the user is returned to where
  // they started, exactly as the promoted case does.
  //
  // `challengeCleared` is reset rather than only set: a check has just (re)appeared, so the
  // hand-back for *this* one has not happened yet. Leaving the flag from the previous check would
  // mean a later one is solved and the user is never handed back.
  if (run && run.tabId === tabId) {
    run.challengeSeenInTab = true;
    const session = run.session || (await storedDobSession());
    if (session) {
      session.promotedForChallenge = true;
      session.challengeCleared = false;
      session.challengeSeenInTab = true;
      persistDobSession(session);
    }
  }
}

// Once a real challenge has been cleared in the promoted tab, resume that exact search URL in the
// hidden runner and close the temporary tab. A tab promoted because the iframe was challenged but
// loaded without showing a challenge remains in the background instead, avoiding a promote/close loop.
async function hideLookupAfterChallenge(sender) {
  const run = activeDobLookup;
  if (!run || run.mode !== 'tab' || !run.tabId) return;

  // Only the promoted tab may hide itself. The offscreen frame reports challenges too, and it
  // must never be the reason the user's view is taken away.
  if (!sender || !sender.tab || sender.tab.id !== run.tabId) return;

  const session = run.session || (await storedDobSession());
  if (session && session.challengeCleared) return;
  const tabId = run.tabId;
  const sawChallenge = !!(run.challengeSeenInTab || (session && session.challengeSeenInTab));
  if (session) {
    session.challengeCleared = true;
  }

  if (
    !session ||
    !session.currentUrl ||
    (!sawChallenge && (run.challengePromotions || 0) >= 2)
  ) {
    run.promotedForCheck = false;
    if (session) {
      session.promotedForChallenge = false;
      session.challengeSeenInTab = false;
      await persistDobSession(session);
    }
    await restoreCallerTab(session, tabId);
    return;
  }

  const runnerSource = session.currentUrl.includes('thatsthem.com')
    ? 'thatsthem.com'
    : 'unmask.com';
  run.returningOffscreen = true;
  run.challengeDuringReturn = false;
  session.promotedForChallenge = false;
  session.challengeSeenInTab = false;
  delete session.dobTabId;
  await persistDobSession(session);
  if (activeDobLookup !== run) return;
  const prepared = await prepareRunner(runnerSource, session.currentUrl);
  if (activeDobLookup !== run) return;

  run.returningOffscreen = false;
  if (!prepared.ok) {
    run.promotedForCheck = false;
    run.challengeSeenInTab = false;
    session.dobTabId = tabId;
    await persistDobSession(session);
    await restoreCallerTab(session, tabId);
    return;
  }

  run.mode = 'offscreen';
  run.tabId = null;
  run.currentRunnerSource = runnerSource;
  run.promotedForCheck = false;
  run.challengeSeenInTab = false;
  await persistDobSession(session);
  await restoreCallerTab(session, tabId);
  chrome.tabs.remove(tabId).catch(() => {});

  // The iframe may still be challenged even though the top-level page was cleared. If it reports
  // that during the handoff, promote again only after the temporary tab is gone.
  if (run.challengeDuringReturn && activeDobLookup === run) {
    run.challengeDuringReturn = false;
    await promoteDobRunToTab(session.currentUrl);
  }
}

// Ends a DOB run: the user is taken back to where they started, the lookup tab closes (after a
// beat, so the final line stays readable) and the pending session is dropped.
async function endDobLookup(session, delayMs) {
  const pending = session || (await storedDobSession());
  const run = activeDobLookup;
  const lookupTabId = (run && run.tabId) || null;

  if (lookupTabId) {
    await restoreCallerTab(pending, lookupTabId);
    setTimeout(() => {
      if (activeDobLookup && activeDobLookup.tabId === lookupTabId) {
        chrome.tabs.remove(lookupTabId).catch(() => {});
        activeDobLookup = null;
      }
    }, Math.max(0, delayMs || 0));
  } else if (run && run.mode === 'offscreen') {
    // No tab was ever opened, so there is nothing to close and nowhere to send the user: the
    // runner is simply parked back on about:blank so the results are not left sitting in memory.
    chrome.runtime.sendMessage({ action: 'RESET_RUNNER', source: run.source }).catch(() => {});
    if (run.source !== 'thatsthem.com') {
      chrome.runtime.sendMessage({ action: 'RESET_RUNNER', source: 'thatsthem.com' }).catch(() => {});
    }
    activeDobLookup = null;
  }

  chrome.storage.local.remove(['unmask_pending_lookup', THATSTHEM_STORAGE_KEY]).catch(() => {});
}

// The record's age and, when it names one, its explicit birth year ("72 yrs (1954)").
function parseTargetAgeAndYear(person) {
  let targetAge = null;
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

  return { targetAge, targetYear };
}

// -------------------------------------------------------------------- Google AI Mode (parallel DOB)

// Google AI Mode runs *beside* the Unmask / ThatSthem run, not instead of it, so the dates it finds
// can be compared with theirs. The query is the one that works by hand:
//
//   "{name} lives at {address} born in {year} in which month ? no rough guess accurate"
//
// It is asked for the record's primary address first, and then - one at a time, each on its own
// page load - for the person's other addresses, because an address the AI cannot place usually
// produces no answer at all.
function buildGoogleQueries(person) {
  if (!person) return [];

  const name = String(person.name || '').trim();
  const { targetYear } = parseTargetAgeAndYear(person);
  if (!name || !targetYear) return [];

  // normalizeAddressList puts the primary address first and drops entries with no city or ZIP -
  // exactly the ones the AI cannot place.
  const addresses = [];
  for (const addr of normalizeAddressList(person)) {
    const cityState = [addr.city, addr.state].filter(Boolean).join(', ');
    const tail = [cityState, addr.zip].filter(Boolean).join(' ');
    const line = [addr.street, tail]
      .filter(Boolean)
      .join(', ')
      .replace(/\s+/g, ' ')
      .trim();

    if (line && addresses.indexOf(line) < 0) addresses.push(line);
    if (addresses.length >= GOOGLE_MAX_ADDRESSES) break;
  }

  return addresses.map(
    (address) => `${name} lives at ${address} born in ${targetYear} in which month ? no rough guess accurate`
  );
}

// Stops the Google run: the runner is parked back on about:blank (or its tab closed) and the
// pending session is dropped. `silent` is used when a new run is replacing this one, or when the
// page simply never answered - the widget is not told anything it did not ask for. `keepTab` leaves
// the visible debug tab in place instead of closing it.
function finishGoogleLookup(silent, keepTab) {
  const run = activeGoogleLookup;
  activeGoogleLookup = null;

  chrome.storage.local.remove(GOOGLE_STORAGE_KEY).catch(() => {});
  // With the visible debug tab there is no hidden frame to park.
  if (!GOOGLE_VISIBLE) {
    chrome.runtime.sendMessage({ action: 'RESET_RUNNER', source: GOOGLE_RUNNER_FRAME }).catch(() => {});
  }

  if (run && run.mode === 'tab' && run.tabId && !keepTab) {
    chrome.tabs.remove(run.tabId).catch(() => {});
    if (googleDebugTabId === run.tabId) googleDebugTabId = null;
  }

  if (silent || !run || !run.session) return;
  broadcastDobMessage({
    action: 'GOOGLE_LOOKUP_EMPTY',
    message: 'AI did not name a birth month for any known address.',
    record: run.session.record || ''
  });
}

// A real, visible tab for the Google run (see GOOGLE_VISIBLE). One tab is reused for every run, so a
// run that was left open for inspection is navigated again rather than joined by a second tab.
async function openGoogleDebugTab(url) {
  if (googleDebugTabId) {
    try {
      const existing = await chrome.tabs.get(googleDebugTabId);
      if (existing && existing.id) {
        await chrome.tabs.update(existing.id, { url, active: true });
        if (existing.windowId !== undefined) {
          chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
        }
        return existing;
      }
    } catch (e) {
      // The tab was closed by hand: fall through and open a new one.
    }
    googleDebugTabId = null;
  }

  const tab = await chrome.tabs.create({ url, active: true });
  googleDebugTabId = tab.id;
  if (tab.windowId !== undefined) {
    chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
  return tab;
}

// The AI Mode page asks what to ask next once an address has produced nothing. The address list
// lives here, so this is where it is advanced - and where the run is ended when there is nothing
// left to ask.
async function nextGoogleAddress(sendResponse) {
  let session = (activeGoogleLookup && activeGoogleLookup.session) || null;

  // Recovered from storage when the worker was restarted between two addresses - see
  // googlePendingSession. Otherwise an address that never answers would end the whole run.
  if (!session) {
    session = await googlePendingSession(GOOGLE_STORAGE_KEY);
    if (session) {
      activeGoogleLookup = { mode: 'offscreen', tabId: null, source: GOOGLE_RUNNER_FRAME, session };
    }
  }

  if (!session) {
    if (sendResponse) sendResponse({ exhausted: true });
    return;
  }

  session.queryIndex += 1;
  if (session.queryIndex >= session.queries.length) {
    // Every address was asked and the answers held nothing that agrees with the record, so the run
    // is over and its tab is closed - the user asked for exactly this: nothing in the paragraph,
    // nothing left to try, close.
    finishGoogleLookup(false, false);
    if (sendResponse) sendResponse({ exhausted: true });
    return;
  }

  chrome.storage.local.set({ [GOOGLE_STORAGE_KEY]: session }).catch(() => {});
  if (sendResponse) {
    sendResponse({ nextQuery: session.queries[session.queryIndex], index: session.queryIndex });
  }
}

async function startGoogleDobLookup(person, record) {
  try {
    // A press on either record card supersedes the previous Google run. The tab is kept (not
    // closed) because the next run navigates the same one.
    finishGoogleLookup(true, true);
    // The Google runner is a single frame, and the DOB run needs the same search box the email run
    // uses: whichever was asked for last is the one that runs.
    finishGoogleEmailLookup(true);
    finishGoogleGenderLookup(true);
    finishGoogleAddressLookup(true);

    const queries = buildGoogleQueries(person);
    if (queries.length === 0) return;

    const session = {
      record: record ? String(record) : '',
      targetName: person.name || '',
      targetYear: parseTargetAgeAndYear(person).targetYear,
      queries,
      queryIndex: 0,
      status: 'searching',
      startedAt: Date.now()
    };

    // Written before the runner loads: the content script reads it exactly once on load.
    await chrome.storage.local.set({ [GOOGLE_STORAGE_KEY]: session });

    const run = { mode: 'offscreen', tabId: null, source: GOOGLE_RUNNER_FRAME, session };

    if (GOOGLE_VISIBLE) {
      // Watch it work: a real tab, in front, so the query, the AI Mode switch and the answer can all
      // be seen. This is the debug path - with GOOGLE_VISIBLE false the hidden offscreen runner is
      // used and no tab ever appears.
      const tab = await openGoogleDebugTab(GOOGLE_HOME_URL);
      run.mode = 'tab';
      run.tabId = tab.id;
    } else if (!(await startDobInOffscreen(GOOGLE_RUNNER_FRAME, GOOGLE_HOME_URL)).ok) {
      const tab = await chrome.tabs.create({ url: GOOGLE_HOME_URL, active: false });
      run.mode = 'tab';
      run.tabId = tab.id;
    }

    activeGoogleLookup = run;

    // A run that returns no answer is over: the tab is closed like any other finished lookup, since
    // the page has nothing left to show.
    setTimeout(() => {
      if (activeGoogleLookup && activeGoogleLookup.session === session) {
        finishGoogleLookup(false, false);
      }
    }, GOOGLE_RUN_BUDGET_MS);
  } catch (e) {
    console.warn('[Background] Could not start the Google AI search:', e.message);
  }
}

// ------------------------------------------------------------------ Google AI Mode (email run)

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// The birth month a DOB string names, as a full month name - "February 1950", "Feb 1950",
// "02/14/1950", "1950-02-14" - or "" when it names none ("1950", "1950 (year only)").
//
// The email query carries it when a previous search found one: "born in February 1950" places the
// person far better than the bare year, and the AI's answer is asked to name the primary address's
// owner, so a wrong candidate costs the whole run.
function birthMonthName(dob) {
  const text = String(dob || '').trim();
  if (!text) return '';

  // A month written by name, full or abbreviated.
  for (const name of MONTH_NAMES) {
    const prefix = name.slice(0, 3).toLowerCase();
    if (new RegExp('\\b' + prefix + '[a-z]*\\b', 'i').test(text)) return name;
  }

  // A numeric date, whichever way round it is written.
  const mdy = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  if (mdy) {
    const month = parseInt(mdy[1], 10);
    if (month >= 1 && month <= 12) return MONTH_NAMES[month - 1];
  }

  const ymd = text.match(/\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (ymd) {
    const month = parseInt(ymd[2], 10);
    if (month >= 1 && month <= 12) return MONTH_NAMES[month - 1];
  }

  return '';
}

// The birth year the Google queries are disambiguated with: the record's own age or explicit birth year
// where it names one ("72 yrs (1954)"), and otherwise the year out of the DOB the card already holds -
// the DOB run's answer is on the card before Email is usually pressed, and it names the same person.
//
// A card that is being typed in by hand has neither until one of those runs has answered, and the
// question is still worth asking without one. Requiring the year is what made a manual card's Email
// button report "no address with a city and ZIP" while its address sat right there on the card.
function birthYearForQuery(person, knownDob) {
  const { targetYear } = parseTargetAgeAndYear(person);
  if (targetYear) return String(targetYear);

  const fromDob = String(knownDob == null ? '' : knownDob).match(/\b(1[89]\d{2}|20[0-2]\d)\b/);
  return fromDob ? fromDob[1] : '';
}

// What the email run actually asks Google, one query per known address, primary address first:
//
//   "{name} lives at {address} born in {year} any public available primary email .
//    gmail hotmail yahoo icloud are prefered"
//
// `knownDob` is whatever the card already holds - the Google row first, then Unmask's, then
// ThatSthem's - and its month is used where it names one. The birth year comes from the record's age
// ("71 yrs (1955)"), or from that same DOB when the record names no age; a card being typed in by hand
// has neither, and the question is asked without it rather than not at all. Nothing else is added: the
// last part of the query is the instruction that makes the answer come back as the one primary
// address's owner rather than a list of lookalikes.
function buildGoogleEmailQueries(person, knownDob) {
  if (!person) return [];

  const name = String(person.name || '').trim();
  if (!name) return [];

  const targetYear = birthYearForQuery(person, knownDob);
  const month = birthMonthName(knownDob);
  const bornIn = [month, targetYear].filter(Boolean).join(' ');
  const bornClause = bornIn ? ` born in ${bornIn}` : '';

  // normalizeAddressList puts the primary address first and drops entries with no city or ZIP -
  // exactly the ones the AI cannot place.
  const addresses = [];
  for (const addr of normalizeAddressList(person)) {
    const cityState = [addr.city, addr.state].filter(Boolean).join(', ');
    const tail = [cityState, addr.zip].filter(Boolean).join(' ');
    const line = [addr.street, tail]
      .filter(Boolean)
      .join(', ')
      .replace(/\s+/g, ' ')
      .trim();

    if (line && addresses.indexOf(line) < 0) addresses.push(line);
    if (addresses.length >= GOOGLE_MAX_ADDRESSES) break;
  }

  return addresses.map(
    (address) =>
      `${name} lives at ${address}${bornClause} any public available primary email . gmail hotmail yahoo icloud are prefered`
  );
}

// The email run is asked for by a button on the card. Google AI Mode is the one switch that governs
// it (Settings -> DOB Sources -> AI): the run is a Google AI Mode query, and a user who turned AI Mode
// off means no Google AI calls at all, whatever they are for.
async function startGoogleEmailLookupWithSettings(request, sendResponse) {
  const settings = await getAutomationSettings();
  const sources = dobSourcesFromSettings(settings);
  const record = request && request.record ? String(request.record) : '';

  if (!sources.ai) {
    const message = 'AI is switched off in Settings - turn it on to use it for emails.';
    broadcastDobMessage({ action: 'GOOGLE_EMAIL_EMPTY', message, record });
    if (sendResponse) sendResponse({ success: false, error: message });
    return;
  }

  await startGoogleEmailLookup(request, sendResponse);
}

// Stops the Google email run. The runner frame is parked again; the visible debug tab (only ever there
// with GOOGLE_VISIBLE) is left open, because every Google run reuses it. `silent` is used when a new
// run is replacing this one, or when the page simply never answered - the card is not told anything it
// did not ask for.
function finishGoogleEmailLookup(silent) {
  const run = activeGoogleEmailLookup;
  activeGoogleEmailLookup = null;

  chrome.storage.local.remove(GOOGLE_EMAIL_STORAGE_KEY).catch(() => {});
  if (!GOOGLE_VISIBLE) {
    chrome.runtime.sendMessage({ action: 'RESET_RUNNER', source: GOOGLE_RUNNER_FRAME }).catch(() => {});
  }

  if (silent || !run || !run.session) return;
  broadcastDobMessage({
    action: 'GOOGLE_EMAIL_EMPTY',
    message: 'AI found no public email address for any known address.',
    record: run.session.record || ''
  });
}

// The session a Google run is walking, recovered from storage when the run in flight is gone.
//
// Every message wakes the service worker, but an idle worker is still torn down between two of them.
// Without this recovery the run ended after the *first* address - which is exactly the address an
// unanswered question needs to fall through from. The in-memory run is preferred where it exists,
// because it carries the mode (the hidden offscreen frame, or the visible debug tab).
async function googlePendingSession(storageKey) {
  try {
    const stored = await chrome.storage.local.get([storageKey]);
    return (stored && stored[storageKey]) || null;
  } catch (e) {
    return null;
  }
}

// The AI Mode page asks what to ask next once an address has produced nothing. The address list lives
// here, exactly as it does for the DOB run, and the answer is navigated to a new page load either way.
async function nextGoogleEmailAddress(sendResponse) {
  let session = (activeGoogleEmailLookup && activeGoogleEmailLookup.session) || null;

  if (!session) {
    session = await googlePendingSession(GOOGLE_EMAIL_STORAGE_KEY);
    if (session) {
      activeGoogleEmailLookup = { mode: 'offscreen', tabId: null, source: GOOGLE_RUNNER_FRAME, session };
    }
  }

  if (!session) {
    if (sendResponse) sendResponse({ exhausted: true });
    return;
  }

  session.queryIndex += 1;
  if (session.queryIndex >= session.queries.length) {
    finishGoogleEmailLookup(false);
    if (sendResponse) sendResponse({ exhausted: true });
    return;
  }

  chrome.storage.local.set({ [GOOGLE_EMAIL_STORAGE_KEY]: session }).catch(() => {});
  if (sendResponse) {
    sendResponse({ nextQuery: session.queries[session.queryIndex], index: session.queryIndex });
  }
}

// The email run itself. It shares the one Google runner frame with the DOB run, so starting it
// supersedes a DOB run in flight - and `startGoogleDobLookup` supersedes this one in turn. One Google
// page, one job: two AI Mode runs in one frame would fight over the same search box, and the sweep
// that takes the query back out of Google's history needs the box to itself.
async function startGoogleEmailLookup(request, sendResponse) {
  try {
    const person = request ? request.person : null;
    const record = request && request.record ? String(request.record) : '';
    const knownDob = request ? request.dob || '' : '';

    finishGoogleEmailLookup(true);
    finishGoogleGenderLookup(true);
    finishGoogleAddressLookup(true);
    finishGoogleLookup(true, true);

    // Street-only records (infolookupp.com) carry no city or ZIP, and the AI cannot place an address
    // without them - so they are completed first, the same way the Unmask leg of a DOB run does it.
    // Without this the email run had a single usable address to ask, which is what left the record's
    // other street addresses unasked.
    if (person) {
      try {
        await completePersonAddresses(person);
      } catch (e) {
        console.warn('[Background] Could not complete email address:', e.message);
      }
    }

    const queries = buildGoogleEmailQueries(person, knownDob);
    if (queries.length === 0) {
      // The two reasons a card can have no question worth asking, told apart: a card being typed in has
      // no name until the user types one, and that is not the address's fault - reporting it as if it
      // were sent the user looking at an address that was right there on the card.
      const message = String((person && person.name) || '').trim()
        ? 'This record has no address with a city and ZIP to ask Google about.'
        : 'This card has no name to ask Google about yet - type one in first.';
      broadcastDobMessage({ action: 'GOOGLE_EMAIL_EMPTY', message, record });
      if (sendResponse) sendResponse({ success: false, error: message });
      return;
    }

    const session = {
      // The record card this run belongs to - echoed on every message it produces.
      record,
      targetName: person && person.name ? person.name : '',
      // The month is only carried on the session so a diagnosis of a run is possible from storage.
      knownDob: String(knownDob || ''),
      queries,
      queryIndex: 0,
      status: 'searching',
      startedAt: Date.now()
    };

    // Written before the runner loads: the content script reads it exactly once on load.
    await chrome.storage.local.set({ [GOOGLE_EMAIL_STORAGE_KEY]: session });

    const run = { mode: 'offscreen', tabId: null, source: GOOGLE_RUNNER_FRAME, session };

    if (GOOGLE_VISIBLE) {
      // Watch it work: a real tab, in front, so the query, the AI Mode switch and the answer - and the
      // step-by-step history trace in that tab's console - can all be seen.
      const tab = await openGoogleDebugTab(GOOGLE_HOME_URL);
      run.mode = 'tab';
      run.tabId = tab.id;
    } else if (!(await startDobInOffscreen(GOOGLE_RUNNER_FRAME, GOOGLE_HOME_URL)).ok) {
      const tab = await chrome.tabs.create({ url: GOOGLE_HOME_URL, active: false });
      run.mode = 'tab';
      run.tabId = tab.id;
    }

    activeGoogleEmailLookup = run;

    // A run that never answers is over: the page has nothing left to show, so the runner is parked.
    setTimeout(() => {
      if (activeGoogleEmailLookup && activeGoogleEmailLookup.session === session) {
        finishGoogleEmailLookup(false);
      }
    }, GOOGLE_EMAIL_RUN_BUDGET_MS);

    if (sendResponse) sendResponse({ success: true, queries: queries.length });
  } catch (e) {
    console.warn('[Background] Could not start the Google email search:', e.message);
    if (sendResponse) sendResponse({ success: false, error: e.message || 'Failed to start' });
  }
}

// ------------------------------------------------------------------ Google AI Mode (gender run)

// What the gender run asks Google, which is the whole question - the name, and nothing else:
//
//   "{name} is male or female?"
//
// There is deliberately no address or year in it: they would turn a question about a person into a
// question about a record, and the answer's own wording ("John is traditionally a male given name") is
// exactly what this run reads.
function buildGoogleGenderQueries(person) {
  const name = person ? String(person.name || '').trim() : '';
  if (!name) return [];
  return [`${name} is male or female?`];
}

// Stops the gender run. The runner frame is parked again; the visible debug tab (only ever there with
// GOOGLE_VISIBLE) is left open because every Google run reuses it. `silent` is used when a new run is
// replacing this one, or when the page simply never answered.
function finishGoogleGenderLookup(silent) {
  const run = activeGoogleGenderLookup;
  activeGoogleGenderLookup = null;

  chrome.storage.local.remove(GOOGLE_GENDER_STORAGE_KEY).catch(() => {});
  if (!GOOGLE_VISIBLE) {
    chrome.runtime.sendMessage({ action: 'RESET_RUNNER', source: GOOGLE_RUNNER_FRAME }).catch(() => {});
  }

  if (silent || !run || !run.session) return;
  broadcastDobMessage({
    action: 'GOOGLE_GENDER_EMPTY',
    message: 'AI could not tell whether this person is male or female.',
    record: run.session.record || ''
  });
}

// The page asks what to ask next when a question produced nothing. There is only ever one query here,
// so this is where a run that found no gender ends - with the card told, rather than left spinning.
//
// The session is read from the run in flight, and - when the worker was restarted between the page load
// and this message - from the pending session it left behind (see googlePendingSession).
async function nextGoogleGenderAddress(sendResponse) {
  let session = (activeGoogleGenderLookup && activeGoogleGenderLookup.session) || null;
  if (!session) session = await googlePendingSession(GOOGLE_GENDER_STORAGE_KEY);

  if (session && (session.queryIndex || 0) + 1 < session.queries.length) {
    session.queryIndex = (session.queryIndex || 0) + 1;
    if (!activeGoogleGenderLookup) {
      activeGoogleGenderLookup = { mode: 'offscreen', tabId: null, source: GOOGLE_RUNNER_FRAME, session };
    }
    chrome.storage.local.set({ [GOOGLE_GENDER_STORAGE_KEY]: session }).catch(() => {});
    if (sendResponse) {
      sendResponse({ nextQuery: session.queries[session.queryIndex], index: session.queryIndex });
    }
    return;
  }

  finishGoogleGenderLookup(false);
  if (sendResponse) sendResponse({ exhausted: true });
}

// The gender run itself, started by the icon beside a person's name. It shares the one Google runner
// frame with the birth-month run and the email run, so starting it supersedes both - one Google page,
// one job.
async function startGoogleGenderLookup(request, sendResponse) {
  try {
    const person = request ? request.person : null;
    const record = request && request.record ? String(request.record) : '';

    finishGoogleGenderLookup(true);
    finishGoogleEmailLookup(true);
    finishGoogleAddressLookup(true);
    finishGoogleLookup(true, true);

    const queries = buildGoogleGenderQueries(person);
    if (queries.length === 0) {
      const message = 'This card has no name to ask about.';
      broadcastDobMessage({ action: 'GOOGLE_GENDER_EMPTY', message, record });
      if (sendResponse) sendResponse({ success: false, error: message });
      return;
    }

    const session = {
      // The record card this run belongs to - echoed on every message it produces.
      record,
      targetName: person.name || '',
      queries,
      queryIndex: 0,
      status: 'searching',
      startedAt: Date.now()
    };

    // Written before the runner loads: the content script reads it exactly once on load.
    await chrome.storage.local.set({ [GOOGLE_GENDER_STORAGE_KEY]: session });

    const run = { mode: 'offscreen', tabId: null, source: GOOGLE_RUNNER_FRAME, session };

    if (GOOGLE_VISIBLE) {
      // Watch it work: a real tab, in front, with the whole history sweep traced in its console.
      const tab = await openGoogleDebugTab(GOOGLE_HOME_URL);
      run.mode = 'tab';
      run.tabId = tab.id;
    } else if (!(await startDobInOffscreen(GOOGLE_RUNNER_FRAME, GOOGLE_HOME_URL)).ok) {
      const tab = await chrome.tabs.create({ url: GOOGLE_HOME_URL, active: false });
      run.mode = 'tab';
      run.tabId = tab.id;
    }

    activeGoogleGenderLookup = run;

    // A run that never answers is over: the page has nothing left to show, so the runner is parked.
    setTimeout(() => {
      if (activeGoogleGenderLookup && activeGoogleGenderLookup.session === session) {
        finishGoogleGenderLookup(false);
      }
    }, GOOGLE_GENDER_RUN_BUDGET_MS);

    if (sendResponse) sendResponse({ success: true, queries: queries.length });
  } catch (e) {
    console.warn('[Background] Could not start the Google gender search:', e.message);
    if (sendResponse) sendResponse({ success: false, error: e.message || 'Failed to start' });
  }
}

// The gender run is governed by the same Settings switch as the other two Google jobs (DOB Sources ->
// AI): a user who turned AI Mode off means no Google AI calls at all, whatever they are for.
async function startGoogleGenderLookupWithSettings(request, sendResponse) {
  const settings = await getAutomationSettings();
  const sources = dobSourcesFromSettings(settings);
  const record = request && request.record ? String(request.record) : '';

  if (!sources.ai) {
    const message = 'AI is switched off in Settings - turn it on to use it here.';
    broadcastDobMessage({ action: 'GOOGLE_GENDER_EMPTY', message, record });
    if (sendResponse) sendResponse({ success: false, error: message });
    return;
  }

  await startGoogleGenderLookup(request, sendResponse);
}

// ------------------------------------------------------------------ Google AI Mode (address resolver)

// What the manual card asks Google. Two questions about the same input, in the order the card uses
// them: the first wants everything at once, the second is the plain address question that a page
// answering nothing to the first will usually answer.
//
// The input is whatever the user typed into the card's address field - a ZIP, a city and state, a
// street, or all of it. Nothing is parsed or completed here: the whole point of the run is that the AI
// turns it into a full address.
function buildGoogleAddressQueries(person) {
  const name = person ? String(person.name || '').trim() : '';
  const place = person
    ? String(
        person.addressInput ||
          (person.address && (person.address.full || person.address.street || person.address.zip || person.address.city)) ||
          ''
      ).trim()
    : '';

  if (!name || !place) return [];

  return [
    `${name} lives at ${place} what is the full address, email and dob?`,
    `${name} lives at ${place} whats the full address?`
  ];
}

// Stops the resolver. The runner frame is parked again; the visible debug tab is left open because
// every Google run reuses it. `silent` is used when a new run is replacing this one.
function finishGoogleAddressLookup(silent) {
  const run = activeGoogleAddressLookup;
  activeGoogleAddressLookup = null;

  chrome.storage.local.remove(GOOGLE_ADDRESS_STORAGE_KEY).catch(() => {});
  if (!GOOGLE_VISIBLE) {
    chrome.runtime.sendMessage({ action: 'RESET_RUNNER', source: GOOGLE_RUNNER_FRAME }).catch(() => {});
  }

  if (silent || !run || !run.session) return;
  broadcastDobMessage({
    action: 'GOOGLE_ADDRESS_EMPTY',
    message: 'AI could not resolve a full address from what was typed in.',
    record: run.session.record || ''
  });
}

// The page asks for the next question when the one it just read produced nothing: that is query two.
// The session is read from the run in flight, and - when the worker was restarted between the page load
// and this message - from the pending session it left behind.
async function nextGoogleAddressQuery(sendResponse) {
  let session = (activeGoogleAddressLookup && activeGoogleAddressLookup.session) || null;
  if (!session) session = await googlePendingSession(GOOGLE_ADDRESS_STORAGE_KEY);

  if (session && (session.queryIndex || 0) + 1 < session.queries.length) {
    session.queryIndex = (session.queryIndex || 0) + 1;
    if (!activeGoogleAddressLookup) {
      activeGoogleAddressLookup = { mode: 'offscreen', tabId: null, source: GOOGLE_RUNNER_FRAME, session };
    }
    chrome.storage.local.set({ [GOOGLE_ADDRESS_STORAGE_KEY]: session }).catch(() => {});
    if (sendResponse) {
      sendResponse({ nextQuery: session.queries[session.queryIndex], index: session.queryIndex });
    }
    return;
  }

  finishGoogleAddressLookup(false);
  if (sendResponse) sendResponse({ exhausted: true });
}

// The resolver itself, started by the Search button under a manual card. It shares the one Google
// runner frame with the other three AI jobs, so starting it supersedes them - one Google page, one job.
async function startGoogleAddressLookup(request, sendResponse) {
  try {
    const person = request ? request.person : null;
    const record = request && request.record ? String(request.record) : '';

    finishGoogleAddressLookup(true);
    finishGoogleGenderLookup(true);
    finishGoogleEmailLookup(true);
    finishGoogleLookup(true, true);

    const queries = buildGoogleAddressQueries(person);
    if (queries.length === 0) {
      const message = 'Type a name and something of the address, then press Search again.';
      broadcastDobMessage({ action: 'GOOGLE_ADDRESS_EMPTY', message, record });
      if (sendResponse) sendResponse({ success: false, error: message });
      return;
    }

    const session = {
      // The record card this run belongs to - echoed on every message it produces.
      record,
      targetName: person.name || '',
      queries,
      queryIndex: 0,
      status: 'searching',
      startedAt: Date.now()
    };

    // Written before the runner loads: the content script reads it exactly once on load.
    await chrome.storage.local.set({ [GOOGLE_ADDRESS_STORAGE_KEY]: session });

    const run = { mode: 'offscreen', tabId: null, source: GOOGLE_RUNNER_FRAME, session };

    if (GOOGLE_VISIBLE) {
      // Watch it work: a real tab, in front, with the whole history sweep traced in its console.
      const tab = await openGoogleDebugTab(GOOGLE_HOME_URL);
      run.mode = 'tab';
      run.tabId = tab.id;
    } else if (!(await startDobInOffscreen(GOOGLE_RUNNER_FRAME, GOOGLE_HOME_URL)).ok) {
      const tab = await chrome.tabs.create({ url: GOOGLE_HOME_URL, active: false });
      run.mode = 'tab';
      run.tabId = tab.id;
    }

    activeGoogleAddressLookup = run;

    // A run that never answers is over: the page has nothing left to show, so the runner is parked.
    setTimeout(() => {
      if (activeGoogleAddressLookup && activeGoogleAddressLookup.session === session) {
        finishGoogleAddressLookup(false);
      }
    }, GOOGLE_ADDRESS_RUN_BUDGET_MS);

    if (sendResponse) sendResponse({ success: true, queries: queries.length });
  } catch (e) {
    console.warn('[Background] Could not start the Google address search:', e.message);
    if (sendResponse) sendResponse({ success: false, error: e.message || 'Failed to start' });
  }
}

// The resolver obeys the same Settings switch as the other three Google jobs (DOB Sources -> AI): a
// user who turned AI Mode off means no Google AI calls at all, whatever they are for.
async function startGoogleAddressLookupWithSettings(request, sendResponse) {
  const settings = await getAutomationSettings();
  const sources = dobSourcesFromSettings(settings);
  const record = request && request.record ? String(request.record) : '';

  if (!sources.ai) {
    const message = 'AI is switched off in Settings - turn it on to use it here.';
    broadcastDobMessage({ action: 'GOOGLE_ADDRESS_EMPTY', message, record });
    if (sendResponse) sendResponse({ success: false, error: message });
    return;
  }

  await startGoogleAddressLookup(request, sendResponse);
}

// A press on the DOB button runs only the platforms the Settings panel left switched on. The choice
// is read here, once, and carried on the run's session: a switch flipped while a run is in flight
// still cannot make that run fall back to a source the user has turned off.
async function startDobLookupWithSettings(request, sendResponse, sender) {
  const settings = await getAutomationSettings();
  const sources = dobSourcesFromSettings(settings);
  const record = request.record;

  // Google AI Mode answers on its own line, so it needs no session of its own here.
  if (sources.ai) {
    startGoogleDobLookup(request.person, record);
  }

  if (!sources.unmask && !sources.thatsthem) {
    // Nothing left to ask. The card is told instead of being left spinning.
    const message = sources.ai
      ? 'Unmask and ThatSthem are turned off in Settings - asking AI only.'
      : 'All DOB sources are turned off in Settings.';
    if (!sources.ai) {
      broadcastDobMessage({
        action: 'DOB_LOOKUP_EMPTY',
        record: record ? String(record) : '',
        message,
        person: request.person || null
      });
    }
    if (sendResponse) {
      sendResponse(sources.ai ? { success: true, message } : { success: false, error: message });
    }
    return;
  }

  startDobLookup(request.person, request.phone, sendResponse, sender, record, sources);
}

async function startDobLookup(person, phone, sendResponse, sender, record, sources) {
  if (typeof phone === 'function') {
    sendResponse = phone;
    phone = null;
  }
  const recordSource = record ? String(record) : '';
  try {
    if (activeDobLookup && activeDobLookup.tabId) {
      chrome.tabs.remove(activeDobLookup.tabId).catch(() => {});
      activeDobLookup = null;
    }

    // A tab from an earlier run can outlive it: if the service worker was restarted, or the run was
    // rebuilt from a message, the in-memory run is gone and nothing closed it. That is stored in the
    // session for exactly this case - otherwise the *next* search shows a tab that looks like it
    // belongs to it, which reads as "this run is in a tab" when it is not.
    try {
      const previous = await storedDobSession();
      if (previous && previous.dobTabId) {
        console.warn('[Background] Closing a lookup tab left behind by an earlier run.');
        chrome.tabs.remove(previous.dobTabId).catch(() => {});
      }
    } catch (e) {}

    // Which record card asked for this run. Every message the run produces carries it back, so a
    // press on the other card can never show this record's DOB (and the other way round).
    const rawPhone = phone || person?.phone || person?.phoneNumber || (person?.phones && person.phones[0]) || '';

    // normalizeAddressList drops addresses without a city/zip, so complete the
    // street-only infolookupp.com records before the Unmask URLs are built.
    if (person) {
      try {
        await completePersonAddresses(person);
      } catch (e) {
        console.warn('[Background] Could not complete DOB address:', e.message);
      }
    }

    const addresses = normalizeAddressList(person);

    // Records usually carry the explicit birth year next to the age, e.g. "72 yrs (1954)".
    // Keeping it lets every source validate the DOB it finds against the real birth year instead of
    // guessing. The same values drive the parallel Google AI Mode search.
    const { targetAge, targetYear } = parseTargetAgeAndYear(person);

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
      // The record card this run belongs to - echoed on every message it produces.
      record: recordSource,
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
      status: 'searching',
      // The platforms this run may ask, decided when the button was pressed. A source that is
      // switched off in Settings is skipped outright - the run never falls back to it.
      allowUnmask: !sources || sources.unmask !== false,
      allowThatsThem: !sources || sources.thatsthem !== false
    };

    // Where the user was when they started this run: they are taken to Unmask when a
    // Cloudflare check appears, and put back on this tab once the run is over.
    session.callerTabId = await resolveCallerTabId(sender);

    // Unmask is switched off in Settings: this run starts on ThatSthem instead, and it never falls
    // forward into Unmask either. The session is kept in the same place and walked by the same code,
    // so the card sees the same progress lines and the same result handling as any other run.
    if (session.allowUnmask === false) {
      activeDobLookup = {
        mode: 'offscreen',
        tabId: null,
        source: 'unmask.com',
        session,
        startTime: Date.now()
      };

      const steps = buildThatsThemPlan(session);
      broadcastDobMessage({
        action: 'DOB_LOOKUP_PROGRESS',
        step: 1,
        totalSteps: 5,
        message: steps.length
          ? `Searching ${steps[0].label} on ThatSthem...`
          : 'Searching on ThatSthem...',
        record: recordSource
      });

      // startThatsThemPhase answers the caller itself, and walks to the first step (or exhausts when
      // there is nothing to search).
      await startThatsThemPhase(session, null, sendResponse);
      return;
    }

    if (addresses.length === 0) {
      const phoneUrl = buildUnmaskUrlForPhone(rawPhone);
      if (phoneUrl) {
        session.status = 'searching_phone';
        session.searchedPhone = true;
        await chrome.storage.local.set({ unmask_pending_lookup: session });

        const run = await openDobRunner(phoneUrl, session);

        broadcastDobMessage({
          action: 'DOB_LOOKUP_PROGRESS',
          step: 1,
          totalSteps: 5,
          message: `Searching phone number on Unmask (${rawPhone})...`,
          record: recordSource
        });

        if (sendResponse) sendResponse({ success: true, tabId: run.tabId });
        return;
      }

      const nameCityUrl = buildUnmaskNameCityUrl(session.targetName, session.state, session.city);
      if (nameCityUrl) {
        session.status = 'searching_name_city';
        session.searchedNameCity = true;
        await chrome.storage.local.set({ unmask_pending_lookup: session });

        const run = await openDobRunner(nameCityUrl, session);

        broadcastDobMessage({
          action: 'DOB_LOOKUP_PROGRESS',
          step: 1,
          totalSteps: 5,
          message: `Searching name on Unmask (${session.targetName}, ${session.city}, ${session.state})...`,
          record: recordSource
        });

        if (sendResponse) sendResponse({ success: true, tabId: run.tabId });
        return;
      }

      const nameStateUrl = buildUnmaskNameStateUrl(session.targetName, session.state);
      if (nameStateUrl) {
        session.status = 'searching_name_state';
        session.searchedNameState = true;
        await chrome.storage.local.set({ unmask_pending_lookup: session });

        const run = await openDobRunner(nameStateUrl, session);

        broadcastDobMessage({
          action: 'DOB_LOOKUP_PROGRESS',
          step: 1,
          totalSteps: 5,
          message: `Searching name on Unmask (${session.targetName}, ${session.state})...`,
          record: recordSource
        });

        if (sendResponse) sendResponse({ success: true, tabId: run.tabId });
        return;
      }

      if (sendResponse) sendResponse({ success: false, error: 'No address, phone, or name/state available for DOB lookup.' });
      return;
    }

    const firstUrl = buildUnmaskUrlForAddress(addresses[0]);
    const run = await openDobRunner(firstUrl, session);

    broadcastDobMessage({
      action: 'DOB_LOOKUP_PROGRESS',
      step: 1,
      totalSteps: 5,
      message: `Searching address 1 of ${addresses.length}: ${addresses[0].street}...`,
      record: recordSource
    });

    if (sendResponse) sendResponse({ success: true, tabId: run.tabId });
  } catch (err) {
    if (err && err.code === 'DOB_OFFSCREEN_UNAVAILABLE') {
      activeDobLookup = null;
      chrome.runtime.sendMessage({ action: 'RESET_RUNNER', source: 'unmask.com' }).catch(() => {});
      chrome.runtime.sendMessage({ action: 'RESET_RUNNER', source: 'thatsthem.com' }).catch(() => {});
      chrome.storage.local.remove(['unmask_pending_lookup', THATSTHEM_STORAGE_KEY]).catch(() => {});
      broadcastDobMessage({
        action: 'DOB_LOOKUP_ERROR',
        error: err.message,
        record: err.record || recordSource
      });
    }
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
  // ThatSthem is switched off in Settings: it is not asked at all - not on its own, and not as the
  // fallback the Unmask steps would otherwise move on to.
  if (session && session.allowThatsThem === false) {
    exhaustDobLookup(session, sendResponse);
    return;
  }

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
  // The run is now on thatsthem.com; this URL is what a security check would be promoted to.
  session.currentUrl = step.url;
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
  } else if (activeDobLookup && activeDobLookup.mode === 'offscreen') {
    prepareRunner('thatsthem.com', step.url).catch(() => {});
    prepareRunner('unmask.com', step.url).catch(() => {});
  }

  if (sendResponse) sendResponse({ success: true, nextUrl: step.url, exhausted: false });
}

async function advanceThatsThemNext(senderTabId, session, sendResponse, force) {
  const tabId = (activeDobLookup && activeDobLookup.tabId) || senderTabId;

  // Ignore a duplicate "next" fired while the page is already being replaced - unless the page has
  // asked again (force). A page whose own "No Results Found" panel rendered inside that window used to
  // be told "ignored" with no URL, and since the page stops its own loop when it asks, the run sat
  // there for ever. The retry the page sends is honoured, so the step is taken after all.
  if (!force && session.themLastAdvanceAt && Date.now() - session.themLastAdvanceAt < 1200) {
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

async function advanceDobNextAddress(senderTabId, sendResponse, record, force) {
  const data = await chrome.storage.local.get('unmask_pending_lookup');
  const session = data ? data.unmask_pending_lookup : (activeDobLookup ? activeDobLookup.session : null);

  if (!session) {
    if (sendResponse) sendResponse({ success: false, error: 'No session' });
    return;
  }

  // A page that belongs to a run which has since been replaced must not walk the steps of the run
  // that replaced it: the record it reports for is no longer the record this session is walking,
  // and its own run is over.
  const pageRecord = record ? String(record) : '';
  if (pageRecord && session.record && pageRecord !== session.record) {
    if (sendResponse) sendResponse({ success: false, stale: true, exhausted: false });
    return;
  }

  const tabId = (activeDobLookup && activeDobLookup.tabId) || senderTabId;

  // Once Unmask is exhausted the very same tab keeps the run alive on ThatSthem.
  if (session.stage === 'thatsthem') {
    await advanceThatsThemNext(senderTabId, session, sendResponse, force);
    return;
  }

  const addresses = session.addresses || [];
  const currentIndex = session.addressIndex || 0;
  const nextIndex = currentIndex + 1;

  function advanceToUrl(newUrl, progressMsg, statusName, isPhone, isName) {
    session.status = statusName;
    // Recorded so a Cloudflare check on this step can be promoted into a tab on the real step
    // URL rather than on whatever interstitial Cloudflare happened to serve.
    session.currentUrl = newUrl;
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
    } else if (activeDobLookup && activeDobLookup.mode === 'offscreen') {
      prepareRunner(activeDobLookup.source || 'unmask.com', newUrl).catch(() => {});
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

  // A run that has already been replaced by a press on the other record can still report its
  // result. That result belongs to the record the run was started for: it is broadcast (and shown
  // on that record's card), but it must not drive this run's session or walk it through steps that
  // are not its own. A weak report is reported as final here, because no run is left to look for
  // a fuller date for it.
  const reportedRecord = msg.record ? String(msg.record) : '';
  if (reportedRecord && session && session.record && reportedRecord !== session.record) {
    broadcastDobMessage({ ...msg, record: reportedRecord, continueSearch: false, searchContinues: false });
    return;
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
  // Answer found: put the user back on the tab they started from, then close the lookup tab.
  endDobLookup(activeDobLookup && activeDobLookup.session, 1500);
}

function cancelDobLookup(sendResponse) {
  endDobLookup(activeDobLookup && activeDobLookup.session, 0);
  // The card's Cancel button is one button for the whole DOB flow, and the Google email run draws in
  // that same progress box - so it is stopped here too rather than left in the runner. So are the gender
  // run and the manual card's address resolver, which use the same box.
  finishGoogleEmailLookup(true);
  finishGoogleGenderLookup(true);
  finishGoogleAddressLookup(true);
  if (sendResponse) sendResponse({ success: true });
}

// A DOB run is started by one record card, and everything it reports has to come back to that
// card. The pages that drive a run stamp their own messages with the record they loaded (they
// know it even after the run was replaced); anything that reaches here untagged - a line the
// background produces itself, or an older worker - is stamped with the run in flight. Messages
// that are not part of a DOB run (the mouse recorder shares this broadcaster) are left alone.
function withDobRecord(msg) {
  if (!msg || msg.record || typeof msg.action !== 'string' || msg.action.indexOf('DOB_LOOKUP') !== 0) {
    return msg;
  }
  const run = activeDobLookup;
  const record = run && run.session ? run.session.record : '';
  return record ? { ...msg, record } : msg;
}

// Which runner a DOB run is actually using, in one short phrase, so "why is there a tab?" can be
// answered from the widget instead of only from the service-worker console. A tab can only come from
// two places, and it says which.
//
// A run object that was rebuilt from a message (no `mode`) is not claimed to be hidden: silence is
// better than a wrong answer.
function dobRunnerNote() {
  const run = activeDobLookup;
  if (!run) return '';

  if (run.tabId) {
    if (run.promotedForCheck) return ' \u00b7 tab (security check)';
    if (run.fallbackReason) return ' \u00b7 tab (no hidden runner: ' + run.fallbackReason + ')';
    return ' \u00b7 tab';
  }

  if (run.mode === 'offscreen') return ' \u00b7 hidden';
  return '';
}

function broadcastDobMessage(msg) {
  const stamped = withDobRecord(msg);
  // Every progress line carries the runner, so the state is visible while the run happens. The note
  // is added *to* the stamped message, and `tagged` - the stamped message - is what goes out.
  const tagged =
    stamped && stamped.action === 'DOB_LOOKUP_PROGRESS' && stamped.message
      ? { ...stamped, message: stamped.message + dobRunnerNote() }
      : stamped;

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((t) => {
      if (t.id) chrome.tabs.sendMessage(t.id, tagged).catch(() => {});
    });
  });
  chrome.runtime.sendMessage(tagged).catch(() => {});
}

// The portal is hosted on Vercel. This is the only server a shipped build may call.
const DEFAULT_AUTH_API = 'https://auto-lookup-portal.vercel.app';
const LIMIT_REACHED_QUOTE = 'limit reached contact admin for more limit';

// `localhost:3000` is where the portal ran while it was being built. A packaged extension has no
// Next.js server on the user's machine, so a loopback URL is never a setting - it is a leftover that
// makes every login, quota sync and lookup fail with "could not connect". Those values are ignored
// in favour of the live portal.
function isLoopbackApiUrl(url) {
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.localhost') ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    );
  } catch (e) {
    return false;
  }
}

// Whatever the stored value (or the popup's Server box) holds, this is the base URL to call: a bare
// host such as "auto-lookup-portal.vercel.app" gets a scheme, a trailing slash is dropped, and
// anything unusable falls back to the live portal rather than to a dead address.
function normalizeApiUrl(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return DEFAULT_AUTH_API;
  if (isLoopbackApiUrl(text)) return DEFAULT_AUTH_API;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const parsed = new URL(withScheme);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch (e) {
    return DEFAULT_AUTH_API;
  }
}

// The API base URL in force, with a stale stored value corrected in place so an install that was
// pointed at localhost heals itself instead of staying broken until it is re-configured by hand.
async function authApiUrl(override) {
  const storage = await chrome.storage.local.get(['dnc_api_url']);
  const stored = storage ? storage.dnc_api_url : null;
  const apiUrl = normalizeApiUrl(override || stored);

  if (stored && stored !== apiUrl) {
    await chrome.storage.local.set({ dnc_api_url: apiUrl });
  }

  return apiUrl;
}

async function handleAuthLogin(username, password, apiUrlOverride, sendResponse) {
  const apiUrl = await authApiUrl(apiUrlOverride);

  try {
    const res = await fetch(`${apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 403 && (data.code === 'LIMIT_REACHED' || data.error?.includes('limit reached'))) {
        if (sendResponse) {
          sendResponse({
            success: false,
            code: 'LIMIT_REACHED',
            error: LIMIT_REACHED_QUOTE
          });
        }
        return;
      }
      if (sendResponse) {
        sendResponse({
          success: false,
          error: data.error || `Login failed (${res.status})`
        });
      }
      return;
    }

    await chrome.storage.local.set({
      dnc_auth_token: data.token,
      dnc_auth_user: data.user,
      dnc_api_url: apiUrl
    });

    sendToWidget({
      action: 'AUTH_QUOTA_UPDATED',
      lookupsRemaining: data.user.lookupsRemaining,
      lookupsTotal: data.user.lookupsTotal,
      user: data.user
    });

    if (sendResponse) {
      sendResponse({
        success: true,
        token: data.token,
        user: data.user
      });
    }
  } catch (err) {
    console.error('[Background] Login network error:', err);
    if (sendResponse) {
      sendResponse({
        success: false,
        error: `Could not reach the lookup portal at ${apiUrl}. Check your internet connection and try again. (${err.message})`
      });
    }
  }
}

async function handleAuthSyncQuota(sendResponse) {
  const authData = await chrome.storage.local.get(['dnc_auth_token']);
  const token = authData.dnc_auth_token;
  const apiUrl = await authApiUrl();

  if (!token) {
    if (sendResponse) sendResponse({ success: false, error: 'Not signed in' });
    return;
  }

  try {
    const res = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 403 && (data.code === 'LIMIT_REACHED' || data.error?.includes('limit reached'))) {
      await chrome.storage.local.remove(['dnc_auth_token', 'dnc_auth_user']);
      chrome.runtime.sendMessage({
        action: 'AUTH_LIMIT_REACHED',
        error: LIMIT_REACHED_QUOTE
      }).catch(() => {});
      if (sendResponse) sendResponse({ success: false, code: 'LIMIT_REACHED', error: LIMIT_REACHED_QUOTE });
      return;
    }

    if (res.status === 401) {
      await chrome.storage.local.remove(['dnc_auth_token', 'dnc_auth_user']);
      chrome.runtime.sendMessage({
        action: 'AUTH_REQUIRED',
        error: 'Session expired. Please sign in again.'
      }).catch(() => {});
      if (sendResponse) sendResponse({ success: false, code: 'SESSION_EXPIRED', error: 'Session expired' });
      return;
    }

    if (res.ok && data.user) {
      await chrome.storage.local.set({ dnc_auth_user: data.user });
      sendToWidget({
        action: 'AUTH_QUOTA_UPDATED',
        lookupsRemaining: data.user.lookupsRemaining,
        lookupsTotal: data.user.lookupsTotal,
        user: data.user
      });
      if (sendResponse) sendResponse({ success: true, user: data.user });
      return;
    }

    if (sendResponse) sendResponse({ success: false, error: data.error || 'Failed to sync quota' });
  } catch (err) {
    if (sendResponse) sendResponse({ success: false, error: err.message });
  }
}

async function handleAuthorizedLookup(phoneNumber, session, sender, sendResponse) {
  let authData = await chrome.storage.local.get(['dnc_auth_token', 'dnc_auth_user']);
  const token = authData.dnc_auth_token;
  const apiUrl = await authApiUrl();

  if (!token) {
    chrome.runtime.sendMessage({
      action: 'AUTH_REQUIRED',
      error: 'Please sign in to your account first.'
    }).catch(() => {});
    if (sendResponse) {
      sendResponse({
        success: false,
        code: 'NOT_LOGGED_IN',
        error: 'Please sign in to your account first.'
      });
    }
    return;
  }

  // Deduct 1 credit atomically on server
  try {
    const res = await fetch(`${apiUrl}/api/lookup/consume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await res.json().catch(() => ({}));

    // If quota reached or user disabled: automatically log out and quote exact requirement
    if (res.status === 403 && (data.code === 'LIMIT_REACHED' || data.error?.includes('limit reached'))) {
      await chrome.storage.local.remove(['dnc_auth_token', 'dnc_auth_user']);
      sendToWidget({
        action: 'AUTH_LIMIT_REACHED',
        error: LIMIT_REACHED_QUOTE
      });

      if (sendResponse) {
        sendResponse({
          success: false,
          code: 'LIMIT_REACHED',
          error: LIMIT_REACHED_QUOTE
        });
      }
      return;
    }

    if (res.status === 401) {
      await chrome.storage.local.remove(['dnc_auth_token', 'dnc_auth_user']);
      sendToWidget({
        action: 'AUTH_REQUIRED',
        error: 'Session expired. Please sign in again.'
      });

      if (sendResponse) {
        sendResponse({
          success: false,
          code: 'SESSION_EXPIRED',
          error: 'Session expired. Please sign in again.'
        });
      }
      return;
    }

    if (!res.ok) {
      throw new Error(data.error || `Server returned error (${res.status})`);
    }

    // Update remaining quota locally and notify UI across all tabs & windows
    let consumedQuota = null;
    if (typeof data.lookupsRemaining === 'number') {
      const user = authData.dnc_auth_user || {};
      user.lookupsRemaining = data.lookupsRemaining;
      user.lookupsTotal = data.lookupsTotal;
      await chrome.storage.local.set({ dnc_auth_user: user });

      consumedQuota = {
        lookupsRemaining: data.lookupsRemaining,
        lookupsTotal: data.lookupsTotal,
        totalLookupsUsed: data.totalLookupsUsed
      };

      sendToWidget({
        action: 'AUTH_QUOTA_UPDATED',
        lookupsRemaining: data.lookupsRemaining,
        lookupsTotal: data.lookupsTotal,
        totalLookupsUsed: data.totalLookupsUsed,
        user: user
      });
    }

    // Proceed to parallel lookup with latest quota metadata
    startParallelLookup(phoneNumber, session, sender, sendResponse, consumedQuota);
  } catch (err) {
    console.error('[Background Auth] Consume quota failed:', err);
    if (sendResponse) {
      sendResponse({
        success: false,
        error: `Could not reach the lookup portal at ${apiUrl}. Check your internet connection and try again. (${err.message})`
      });
    }
  }
}

async function startParallelLookup(phoneNumber, session, sender, sendResponse, consumedQuota) {
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

  // Only the records the user left switched on are searched at all. Record 1 is the first source and
  // Record 2 the second, and switching one off simply means its card never appears - the lookup
  // itself carries on with the other one.
  const recordSources = enabledRecordSources(await getAutomationSettings());

  if (recordSources.length === 0) {
    if (sendResponse) {
      sendResponse({
        success: false,
        error: 'All records are turned off in Settings.',
        session: session || null
      });
    }
    return;
  }

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
    // How many answers "this lookup is done" waits for: one per record that is switched on.
    expectedSources: recordSources.length,
    quota: consumedQuota || null,
    timeoutId: null
  };

  // 60-second safety timeout. The lookup is only marked expired (not discarded), so a
  // slow source that answers later is still streamed to the widget instead of vanishing.
  activeLookup.timeoutId = setTimeout(() => {
    if (activeLookup && activeLookup.searchId === searchId) {
      if (!activeLookup.responded) {
        try {
          activeLookup.sendResponse({
            success: false,
            error: 'Parallel lookup timed out after 60s.'
          });
        } catch (e) {}
      }
      activeLookup.expired = true;
    }
  }, 60000);

  try {
    await ensureOffscreenDocument();

    // Dispatch search in-place to already warm iframes - one per record that is switched on.
    for (const source of recordSources) {
      dispatchToWorker(source, phoneNumber, searchId);
    }
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

  // infolookupp.com often returns street-only records ("3724 Kildare Dr"). Fill in the
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
  // The lookup is done once every record that was actually searched has answered - one or two of
  // them, depending on the Settings panel.
  const expectedSources = activeLookup.expectedSources || RECORD_SOURCES.length;
  const isAllDone = totalCompleted >= expectedSources;

  // Stream message to widget
  const streamMsg = {
    action: 'PARALLEL_STREAM_RESULT',
    source: source,
    data: data || null,
    error: error || null,
    isFirst: isFirstSuccess,
    isAllDone: isAllDone,
    session: activeLookup.session,
    lookupsRemaining: activeLookup.quota?.lookupsRemaining,
    lookupsTotal: activeLookup.quota?.lookupsTotal
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
        session: activeLookup.session,
        lookupsRemaining: activeLookup.quota?.lookupsRemaining,
        lookupsTotal: activeLookup.quota?.lookupsTotal
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
          error: activeLookup.errors.map((e) => `${recordLabel(e.source)}: ${e.error}`).join(' | ') || 'No results from either record.'
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

// `force` drops any open offscreen document first. That exists for one specific failure: a
// document created by an older version of offscreen.html outlives an update, so a runner frame the
// new code expects is simply not there. Recreating it turns that stale state into a working runner
// instead of a silent fall-back to a visible tab.
async function ensureOffscreenDocument(force) {
  const OFFSCREEN_PATH = 'offscreen.html';

  if (force) {
    if (typeof chrome.offscreen.closeDocument === 'function') {
      await chrome.offscreen.closeDocument().catch(() => {});
    }
  } else if (typeof chrome.offscreen.hasDocument === 'function') {
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

// Answers that mean "this document does not have that runner at all". They are definite, so
// re-asking the same document is pointless: the document itself has to be replaced.
const STALE_RUNNER_REASONS = ['no-frame', 'unknown-source'];

// Waits until the offscreen document is actually listening, and returns what it says it has.
//
// `chrome.offscreen.createDocument()` resolves when the document *exists*, not when offscreen.js has
// run and registered its listener, so a message sent in that window fails with "Could not establish
// connection" and looks exactly like "there is no runner". That window is worst right after an
// extension reload, when the document is gone and is recreated lazily by the first lookup.
//
// Not waiting it out is what sent a DOB run into a background tab while the Google run in the same
// offscreen document was fine: the two prepares start together (START_DOB_LOOKUP kicks off both),
// and whichever one re-sent three times inside that window gave up and opened a tab.
async function pingOffscreen(timeoutMs) {
  const began = Date.now();

  for (;;) {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'PING_OFFSCREEN' });
      if (res && res.status === 'pong') return res;
    } catch (e) {
      // Not listening yet - keep waiting.
    }

    if (Date.now() - began >= timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 120));
  }
}

// Asks the offscreen document to load a runner frame, and reports { ok, reason } rather than a bare
// boolean - the reason is what makes a fall-back diagnosable.
//
// The document is waited for rather than assumed, and a document that answers without the runner
// we need is reported as stale from its *own* answer (`PING_OFFSCREEN` lists its runners), so the
// caller can replace it instead of a failed send doing the guessing.
async function prepareRunner(frame, url) {
  const attempts = 3;
  let reason = 'no-response';

  for (let i = 0; i < attempts; i++) {
    try {
      await ensureOffscreenDocument();

      const ready = await pingOffscreen(3000);
      if (!ready) {
        reason = 'offscreen-not-listening';
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250));
        continue;
      }

      if (Array.isArray(ready.runners) && ready.runners.indexOf(frame) === -1) {
        return { ok: false, reason: 'unknown-source' };
      }

      const res = await chrome.runtime.sendMessage({ action: 'PREPARE_RUNNER', source: frame, url });
      if (res && res.ok) return { ok: true, reason: '' };

      reason = (res && res.error) || 'no-response';
      // A definite "no such runner" will not change by asking again.
      if (STALE_RUNNER_REASONS.includes(reason)) return { ok: false, reason };
    } catch (e) {
      reason = e.message || 'threw';
    }

    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250));
  }

  return { ok: false, reason };
}
