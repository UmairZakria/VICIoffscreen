// Offscreen Document script
// Keeps both target lookup pages loaded and ready in persistent background iframes

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'RELOAD_IFRAME') {
    const fId = request.source?.includes('infolookup') ? 'frame-infolookup' : 'frame-vibegenx';
    const frame = document.getElementById(fId);
    if (frame) {
      const base = fId === 'frame-infolookup' ? 'https://infolookup.site/' : 'https://vibegenx.com/infolookup';
      frame.src = `${base}?_r=${Date.now()}`;
    }
    sendResponse({ status: 'reloading' });
    return true;
  }

  if (request.action === 'PING_OFFSCREEN') {
    sendResponse({ status: 'pong' });
    return true;
  }
});
