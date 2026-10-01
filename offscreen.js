// Offscreen Document script
// Keeps every target page loaded and ready in a persistent background iframe, so a search
// never has to wait on a cold tab being opened, focused and rendered.

'use strict';

// Source name -> { frame id, url }. A lookup is only valid if this map has an entry: the
// frame and the page it hosts have to be chosen together, and guessing one from the other
// (the previous `source.includes('infolookup') ? a : b`) silently sent anything unlisted to
// the wrong runner.
const RUNNERS = {
  'infolookup.site': { frameId: 'frame-infolookup', url: 'https://infolookup.site/' },
  'infolookupp.com': { frameId: 'frame-infolookupp', url: 'https://infolookupp.com/' },
  // Record 3. Its own page: the same phone box shape as the other two lookup sites, but its own
  // answer format (a TCPA row per check, and the owners under `.cx-info`).
  'uspeoplesearch.net': { frameId: 'frame-uspeoplesearch', url: 'https://www.uspeoplesearch.net/' },
  'amica.com': { frameId: 'frame-amica', url: 'https://www.amica.com/' },
  'unmask.com': { frameId: 'frame-unmask', url: 'https://unmask.com/' },
  'thatsthem.com': { frameId: 'frame-thatsthem', url: 'https://thatsthem.com/' },
  'google.com': { frameId: 'frame-google', url: 'https://www.google.com/' }
};

function getFrame(source) {
  const runner = RUNNERS[source];
  if (!runner) return null;
  return document.getElementById(runner.frameId) || null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'RELOAD_IFRAME') {
    const runner = RUNNERS[request.source];
    const frame = runner ? document.getElementById(runner.frameId) : null;
    if (frame) {
      frame.src = `${runner.url}?_r=${Date.now()}`;
    }
    sendResponse({ status: runner ? 'reloading' : 'unknown-source' });
    return true;
  }

  // Point a runner at the page it should start on. It is deliberately left on about:blank until
  // a run is actually asked for: these sites serve a different app shell depending on the cookies
  // they already hold, and a lookup needs a session that no previous run left behind.
  //
  // `request.url` is honoured when given, because a DOB run starts on a search URL rather than a
  // homepage (https://unmask.com/address/3724-Kildare-Dr-Houston-TX-77047). `_r` is appended so a
  // repeat of the same URL is a real navigation rather than a no-op.
  if (request.action === 'PREPARE_RUNNER') {
    const runner = RUNNERS[request.source];
    if (!runner) {
      sendResponse({ ok: false, error: 'unknown-source' });
      return true;
    }
    const frame = document.getElementById(runner.frameId);
    if (!frame) {
      sendResponse({ ok: false, error: 'no-frame' });
      return true;
    }
    const target = request.url || runner.url;
    frame.src = `${target}${target.includes('?') ? '&' : '?'}_r=${Date.now()}`;
    sendResponse({ ok: true, frameId: runner.frameId });
    return true;
  }

  // Park the runner back on about:blank once the run is over, so the finished quote is not
  // left sitting in memory (it holds the person's name, address and vehicles).
  if (request.action === 'RESET_RUNNER') {
    const frame = getFrame(request.source);
    if (frame) {
      try {
        frame.src = 'about:blank';
      } catch (e) {
        /* the document is going away anyway */
      }
    }
    sendResponse({ ok: !!frame });
    return true;
  }

  if (request.action === 'PING_OFFSCREEN') {
    sendResponse({ status: 'pong', runners: Object.keys(RUNNERS) });
    return true;
  }
});