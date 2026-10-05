// Injected Sticky Draggable Widget on Web Pages
// Minimalist Black & White Theme (White Main BG, Black Buttons & Text)
// Parallel Dual-Source (infolookup.site & infolookupp.com), one card per record, progressive streaming

(function () {
  // Only run in the top-level browsing context, never in iframes
  if (window.self !== window.top) {
    return;
  }

  // Prevent multiple injections
  if (window.__dnc_widget_injected) {
    return;
  }
  window.__dnc_widget_injected = true;

  // Which build this file is. The widget is injected on demand, and afterwards the toolbar icon only
  // *toggles* the copy that is already on the page - and the browser serves extension files from its own
  // cache until the extension is reloaded. A page can therefore be running older code while the file on
  // disk is newer; this stamp is what tells the two apart. It is logged once, here, and shown at the
  // bottom of the Settings drawer.
  const WIDGET_BUILD = "1.9.13 auto lookup in the window";
  console.log(`[DNC widget] build "${WIDGET_BUILD}" injected`);

  // A widget left behind by a previous copy of the extension can still be sitting in the page: its
  // context died with the extension reload (or the update), so it is inert and its buttons do nothing.
  // It is replaced rather than duplicated - this is what makes the refresh button's restart come back
  // to one live widget instead of stacking a new one on top of the dead one.
  const staleHost = document.getElementById("dnc-compliance-widget-host");
  if (staleHost) staleHost.remove();

  // Create Host Element & Shadow Root for 100% CSS Isolation
  const host = document.createElement("div");
  host.id = "dnc-compliance-widget-host";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const fontRegular = chrome.runtime.getURL("Poppins/Poppins-Regular.ttf");
  const fontLight = chrome.runtime.getURL("Poppins/Poppins-Light.ttf");
  const fontMedium = chrome.runtime.getURL("Poppins/Poppins-Medium.ttf");
  const fontSemiBold = chrome.runtime.getURL("Poppins/Poppins-SemiBold.ttf");
  const fontBold = chrome.runtime.getURL("Poppins/Poppins-Bold.ttf");

  // The sign-in panel's backdrop. It has to be a web-accessible resource for a page to load it (see
  // manifest.json), which is why bg.jpg is listed there beside the logo.
  const authBackdrop = chrome.runtime.getURL("bg.jpg");

  // Stylesheet
  const style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@200;300;400;500;600;700&display=swap');

    /* The weights the widget draws with. 300 is the light one the sign-in panel is set in: without a
       face registered for it, asking for 300 falls back to the nearest declared weight (400), which is
       why "light" text used to come out looking exactly like regular text. */
    @font-face {
      font-family: 'Poppins';
      font-weight: 300;
      font-style: normal;
      src: url('${fontLight}') format('truetype');
    }

    @font-face {
      font-family: 'Poppins';
      font-weight: 400;
      font-style: normal;
      src: url('${fontRegular}') format('truetype');
    }
    @font-face {
      font-family: 'Poppins';
      font-weight: 500;
      font-style: normal;
      src: url('${fontMedium}') format('truetype');
    }
    @font-face {
      font-family: 'Poppins';
      font-weight: 600;
      font-style: normal;
      src: url('${fontSemiBold}') format('truetype');
    }
    @font-face {
      font-family: 'Poppins';
      font-weight: 700;
      font-style: normal;
      src: url('${fontBold}') format('truetype');
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }

    .widget-container {
      position: fixed;
      top: 30px;
      right: 30px;
      z-index: 2147483647;
      width: 395px;
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 16px;
      box-shadow: 0 20px 48px -12px rgba(0, 0, 0, 0.14), 0 4px 16px rgba(0, 0, 0, 0.04);
      font-family: 'Poppins', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #09090b;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      user-select: text;
    }

    /* The panel as the whole of its own window: it fills the window instead of floating over a page, the
       header is not a drag handle there (the window itself is what moves), and the pop-out button has
       nothing left to do.
    
       It stays fixed on purpose. The panel's host is appended to <html> rather than <body> - which is
       invisible while it floats, because a fixed element is positioned against the viewport - so making it
       static here would lay it out after the full-height body and the page's own overflow would hide it. */
    .widget-container.window-mode {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: auto !important;
      bottom: auto !important;
      width: 100% !important;
      height: 100vh !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }

    .widget-container.window-mode .widget-header {
      cursor: default;
    }

    .widget-container.window-mode .widget-header:active {
      cursor: default;
    }

    .widget-container.window-mode .popout-btn {
      display: none;
    }

    .widget-container.window-mode .widget-body {
      max-height: none;
      flex: 1;
    }

    /* Header / Drag Handle */
    .widget-header {
      background: #ffffff;
      padding: 10px 14px;
      border-bottom: 1px solid #e4e4e7;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: grab;
      user-select: none;
    }

    .widget-header:active {
      cursor: grabbing;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    /* Refresh: tears the background workers down and builds them again */
    .refresh-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 5px;
      color: #a1a1aa;
      cursor: pointer;
      flex: none;
    }

    .refresh-btn:hover {
      background: #f4f4f6;
      border-color: #e4e4e7;
      color: #09090b;
    }

    .refresh-btn:disabled {
      cursor: default;
      opacity: 0.9;
    }

    .refresh-btn.spinning {
      color: #09090b;
    }

    .refresh-btn.spinning svg {
      animation: refresh-spin 0.7s linear infinite;
    }

    @keyframes refresh-spin {
      to {
        transform: rotate(360deg);
      }
    }

    .brand-title {
      font-size: 13px;
      font-weight: 300;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #09090b;
      line-height: 1;
    }

    .brand-badge {
      font-size: 10px;
      font-weight: 500;
      color: #71717a;
      background: #f4f4f6;
      padding: 2px 7px;
      border-radius: 6px;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .auth-header-pill {
      font-size: 11px;
      padding: 3px 8px;
      background: #f4f4f5;
      border: 1px solid #e4e4e7;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-right: 3px;
      transition: all 0.15s ease;
      cursor: pointer;
      user-select: none;
    }

    .auth-header-pill:hover {
      background: #ececee;
      border-color: #d4d4d8;
    }

    .quota-bolt-icon {
      color: #0284c7;
      flex-shrink: 0;
    }

    .auth-quota-display {
      font-weight: 600;
      color: #09090b;
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
    }

    .auth-quota-display.low {
      color: #dc2626;
    }

    .auth-logout-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      color: #71717a;
      padding: 2px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.15s ease;
      margin-left: 1px;
    }

    .auth-logout-btn:hover {
      color: #ef4444;
      background: #fee2e2;
    }

    .control-btn {
      background: transparent;
      border: 1px solid transparent;
      color: #71717a;
      border-radius: 6px;
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      transition: all 0.15s ease;
    }

    .control-btn:hover {
      background: #f4f4f6;
      border-color: #e4e4e7;
      color: #09090b;
    }

    .control-btn.settings-btn:hover {
      transform: rotate(25deg);
    }

    .control-btn.close-btn:hover {
      background: #fee2e2;
      border-color: #fecaca;
      color: #dc2626;
    }

    /* Body */
    .widget-body {
      padding: 15px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #ffffff;
      max-height: 82vh;
      overflow-y: auto;
    }

    .widget-body::-webkit-scrollbar {
      width: 5px;
    }
    .widget-body::-webkit-scrollbar-track {
      background: #fafafa;
    }
    .widget-body::-webkit-scrollbar-thumb {
      background: #e4e4e7;
      border-radius: 3px;
    }

    /* ---------------------------------------------------------------- the sign-in panel
       The first thing a signed-out user sees, and the one screen in the widget that is not part of the
       white card: the photograph behind a dark scrim, with the form sitting on it. The scrim is what
       keeps the text readable whatever the photo does behind it, and the panel runs full width inside
       the body's padding so the image has no white frame around it. */
    .widget-auth-view {
      margin: -15px;
      padding: 20px 16px 22px;
      background-image:
        linear-gradient(180deg, rgba(9, 9, 11, 0.58) 0%, rgba(9, 9, 11, 0.8) 52%, rgba(9, 9, 11, 0.95) 100%),
        url('${authBackdrop}');
      background-size: cover, cover;
      background-position: center, center 28%;
      background-repeat: no-repeat, no-repeat;
      color: #fafafa;
    }

    /* Every text element in the panel names the family itself. Headings, paragraphs, labels and form
       controls do not inherit a font from the card, which is exactly why a panel that relied on
       inheritance showed the browser's default face instead of Poppins. */
    .widget-auth-view,
    .widget-auth-view h2,
    .widget-auth-view p,
    .widget-auth-view label,
    .widget-auth-view span,
    .widget-auth-view button,
    .widget-auth-view input {
      font-family: 'Poppins', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    .auth-brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 16px;
    }

    .auth-brand img {
      width: 28px;
      height: 28px;
      object-fit: contain;
      filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
    }

    /* The wordmark: light and tracked, so it reads as a mark rather than as a label. */
    .auth-brand span {
      font-size: 13px;
      font-weight: 300;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: rgba(250, 250, 250, 0.92);
    }

    .auth-hero h2 {
      margin: 0;
      font-size: 22px;
      font-weight: 300;
      line-height: 1.32;
      letter-spacing: 0.005em;
      text-align: center;
      color: #fafafa;
    }

    .auth-hero p {
      margin: 7px 0 20px;
      font-size: 11.5px;
      font-weight: 300;
      line-height: 1.7;
      letter-spacing: 0.015em;
      color: rgba(250, 250, 250, 0.68);
      text-align: center;
    }

    .auth-field {
      margin-bottom: 10px;
    }

    .auth-label {
      display: block;
      font-size: 11px;
      font-weight: 400;
      color: rgba(250, 250, 250, 0.68);
      margin-bottom: 6px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    /* The field itself: a translucent pane over the photo, which lights up when it has the caret. */
    .auth-input-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(255, 255, 255, 0.09);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 12px;
      padding: 0 11px;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    }

    .auth-input-wrap:focus-within {
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.42);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1);
    }

    .auth-input-wrap > svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      color: rgba(250, 250, 250, 0.55);
    }

    .auth-input-wrap input {
      flex: 1;
      min-width: 0;
      background: transparent;
      border: none;
      outline: none;
      color: #fafafa;
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 300;
      letter-spacing: 0.015em;
      padding: 10px 0;
    }

    .auth-input-wrap input::placeholder {
      color: rgba(250, 250, 250, 0.42);
    }

    /* Chrome's own autofill styling would paint these fields white; keep them part of the panel. */
    .auth-input-wrap input:-webkit-autofill,
    .auth-input-wrap input:-webkit-autofill:hover,
    .auth-input-wrap input:-webkit-autofill:focus {
      -webkit-text-fill-color: #fafafa;
      transition: background-color 9999s ease-in-out 0s;
    }

    .auth-eye {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      padding: 2px;
      cursor: pointer;
      color: rgba(250, 250, 250, 0.55);
      transition: color 0.15s;
    }

    .auth-eye:hover {
      color: #fafafa;
    }

    .auth-eye svg {
      width: 14px;
      height: 14px;
    }

    .auth-submit {
      width: 100%;
      margin-top: 6px;
      padding: 11px 14px;
      border: none;
      border-radius: 12px;
      background: #fafafa;
      color: #09090b;
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 400;
      letter-spacing: 0.03em;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      transition: transform 0.12s, box-shadow 0.15s, opacity 0.15s;
    }

    .auth-submit:hover {
      box-shadow: 0 10px 22px rgba(0, 0, 0, 0.38);
      transform: translateY(-1px);
    }

    .auth-submit:active {
      transform: translateY(0);
    }

    .auth-submit:disabled {
      opacity: 0.7;
      cursor: default;
      transform: none;
      box-shadow: none;
    }

    .auth-spinner {
      width: 12px;
      height: 12px;
      border: 2px solid rgba(9, 9, 11, 0.22);
      border-top-color: #09090b;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    /* The sign-in answer (a wrong password, a used-up quota) - the same red, on glass. */
    .auth-alert {
      background: rgba(248, 113, 113, 0.14);
      border: 1px solid rgba(248, 113, 113, 0.42);
      color: #fecaca;
      padding: 9px 11px;
      border-radius: 10px;
      font-size: 11.5px;
      font-weight: 500;
      line-height: 1.45;
      margin-bottom: 12px;
      text-align: center;
    }

    .auth-foot {
      margin-top: 16px;
      font-size: 10px;
      font-weight: 300;
      line-height: 1.75;
      letter-spacing: 0.02em;
      color: rgba(250, 250, 250, 0.5);
      text-align: center;
    }

    .auth-foot b {
      color: rgba(250, 250, 250, 0.78);
      font-weight: 600;
    }

    /* While signed out the panel above is a photograph, so the header is part of it rather than a white
       bar on top of it. The controls are already transparent, so only their ink has to change. */
    .widget-container.signed-out .widget-header {
      background: #09090b;
      border-bottom-color: rgba(255, 255, 255, 0.08);
    }

    .widget-container.signed-out .brand-title {
      color: #fafafa;
    }

    .widget-container.signed-out .refresh-btn,
    .widget-container.signed-out .control-btn {
      color: rgba(250, 250, 250, 0.62);
    }

    .widget-container.signed-out .refresh-btn:hover,
    .widget-container.signed-out .control-btn:hover {
      color: #fafafa;
      background: rgba(255, 255, 255, 0.1);
    }

    /* Mode Toggle (Manual / Auto) */
    .mode-toggle-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #f4f4f6;
      border-radius: 8px;
      padding: 3px;
    }

    .mode-segmented {
      display: flex;
      width: 100%;
      gap: 3px;
    }

    .mode-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 5px 8px;
      font-family: 'Poppins', sans-serif;
      font-size: 11.5px;
      font-weight: 500;
      color: #71717a;
      background: transparent;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      user-select: none;
    }

    .mode-btn:hover {
      color: #09090b;
    }

    .mode-btn.active {
      background: #ffffff;
      color: #09090b;
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    }




    .auto-feedback-bar {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 6px 10px;
      background: #f0fdf4;
      border: 1px solid rgba(22, 163, 74, 0.15);
      border-radius: 7px;
      font-size: 11px;
      font-weight: 500;
      color: #166534;
      transition: all 0.2s ease;
    }

    .auto-feedback-bar.waiting {
      background: #f8fafc;
      border-color: rgba(0, 0, 0, 0.06);
      color: #64748b;
    }

    .auto-spinner {
      width: 12px;
      height: 12px;
      border: 2px solid rgba(22, 101, 52, 0.25);
      border-top-color: #166534;
      border-radius: 50%;
      animation: spin 0.65s linear infinite;
      flex-shrink: 0;
    }

    .auto-feedback-dot {
      font-size: 8px;
      line-height: 1;
      color: #16a34a;
    }

    .auto-feedback-bar.waiting .auto-feedback-dot {
      color: #94a3b8;
    }

    /* Search Bar */
    .search-row {
      display: flex;
      gap: 8px;
    }

    .phone-input {
      flex: 1;
      background: #ffffff;
      border: 1px solid #e4e4e7;
      border-radius: 9px;
      padding: 9px 13px;
      font-family: 'Poppins', sans-serif;
      font-size: 13px;
      font-weight: 500;
      color: #09090b;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .phone-input:focus {
      border-color: #09090b;
      box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.05);
    }

    .phone-input::placeholder {
      color: #a1a1aa;
      font-weight: 400;
    }

    .search-btn {
      background: #09090b;
      color: #ffffff;
      border: none;
      border-radius: 9px;
      padding: 0 16px;
      font-family: 'Poppins', sans-serif;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s, opacity 0.15s;
      white-space: nowrap;
    }

    .search-btn:hover {
      background: #27272a;
    }

    .search-btn:active {
      transform: scale(0.98);
    }

    /* Status Banner */
    .status-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 13px;
      background: #fafafa;
      border: 1px solid #f1f3f5;
      border-radius: 8px;
      font-size: 11.5px;
      font-weight: 500;
      color: #52525b;
    }

    .spinner {
      width: 13px;
      height: 13px;
      border: 2px solid #e4e4e7;
      border-top-color: #09090b;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Error Banner */
    .error-banner {
      padding: 9px 13px;
      background: #fafafa;
      border: 1px solid #18181b;
      border-radius: 8px;
      font-size: 11.5px;
      color: #09090b;
      font-weight: 500;
    }

    /* Results */
    .results-area {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Card Base */
    .card {
      background: #ffffff;
      border: 1px solid #f1f3f5;
      border-radius: 12px;
      padding: 13px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .record-header-tag {
      font-size: 11px;
      font-weight: 600;
      color: #71717a;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 2px;
    }

    /* Identity Card */
    .person-card {
      background: #fafafa;
      border: 1px solid #f1f3f5;
    }

    /* Person Slide Carousel Navigation */
    .person-slide-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 4px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      margin-bottom: 4px;
    }

    .slide-counter-badge {
      display: flex;
      align-items: center;
      gap: 3px;
      background: #f4f4f6;
      border-radius: 6px;
      padding: 2px 4px;
    }

    .slide-nav-btn {
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 4px;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #09090b;
      padding: 0;
      transition: all 0.15s ease;
    }

    .slide-nav-btn:hover {
      background: #09090b;
      color: #ffffff;
      border-color: #09090b;
    }

    .slide-counter-text {
      font-size: 11px;
      font-weight: 600;
      color: #52525b;
      padding: 0 4px;
      letter-spacing: -0.2px;
    }

    .person-header-row {
      display: flex;
      align-items: center;
      gap: 11px;
    }

    .avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: #09090b;
      color: #ffffff;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .person-meta {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .name-wrapper {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .person-name {
      font-size: 14px;
      font-weight: 600;
      color: #09090b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .age-badge {
      font-size: 11.5px;
      color: #71717a;
      font-weight: 400;
    }

    .mini-btn {
      background: #ffffff;
      border: 1px solid #e4e4e7;
      color: #09090b;
      border-radius: 5px;
      padding: 2px 7px;
      font-family: 'Poppins', sans-serif;
      font-size: 10.5px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s;
    }

    .mini-btn:hover {
      background: #09090b;
      color: #ffffff;
      border-color: #09090b;
    }

    .person-actions {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
    }

    .vehicle-btn {
      background: #f4f4f5;
      color: #27272a;
      border: 1px solid #e4e4e7;
      font-size: 10px;
      padding: 2px 6px;
      font-weight: 500;
    }

    .vehicle-btn:hover {
      background: #09090b;
      color: #ffffff;
      border-color: #09090b;
    }

    .vehicle-btn.running {
      background: #09090b;
      color: #ffffff;
      border-color: #09090b;
      opacity: 0.85;
    }

    .dob-btn {
      background: #f4f4f5;
      color: #09090b;
      border: 1px solid #e4e4e7;
      font-size: 10px;
      padding: 2px 6px;
      font-weight: 600;
      letter-spacing: 0.2px;
    }

    .dob-btn:hover {
      background: #2563eb;
      color: #ffffff;
      border-color: #2563eb;
    }

    /* The gender chip beside the name. It is square because it holds an icon rather than a word, and
       the icon *is* the answer: unknown shows both symbols, and the answer recolours it (pink for
       female, blue for male) so the card reads at a glance without another row. */
    .gender-btn {
      background: #f4f4f5;
      color: #52525b;
      border: 1px solid #e4e4e7;
      border-radius: 5px;
      padding: 2px 5px;
      line-height: 0;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      transition: all 0.15s;
    }

    .gender-btn svg {
      width: 11px;
      height: 11px;
    }

    .gender-btn:hover {
      background: #09090b;
      color: #ffffff;
      border-color: #09090b;
    }

    .gender-btn.is-female {
      background: #fdf2f8;
      color: #be185d;
      border-color: #fbcfe8;
    }

    .gender-btn.is-female:hover {
      background: #be185d;
      color: #ffffff;
      border-color: #be185d;
    }

    .gender-btn.is-male {
      background: #eff6ff;
      color: #1d4ed8;
      border-color: #bfdbfe;
    }

    .gender-btn.is-male:hover {
      background: #1d4ed8;
      color: #ffffff;
      border-color: #1d4ed8;
    }

    .gender-btn.running {
      opacity: 0.55;
      pointer-events: none;
    }

    /* The manual card. A record that named nobody still has the same card - name, address and every
       action - it just asks the user for the two things the record could not provide. Same materials
       as the rest of the card: hairlines, quiet greys, one dark action. */
    .manual-add-btn {
      width: 20px;
      height: 20px;
      border-radius: 5px;
      border: 1px solid #e4e4e7;
      background: #ffffff;
      color: #3f3f46;
      font-size: 14px;
      font-weight: 500;
      line-height: 1;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s;
    }

    .manual-add-btn:hover {
      background: #09090b;
      color: #ffffff;
      border-color: #09090b;
    }

    /* The fields *are* the card's own lines - the name, the street, the city - so they carry that
       typography, with no box and no border. An empty placeholder then reads as one of the record cards
       rather than as a form. The underline stays transparent until a field has the caret, so the layout
       never shifts a pixel. */
    .manual-name-input,
    .manual-street-input,
    .manual-city-input {
      font-family: 'Poppins', sans-serif;
      color: #09090b;
      background: transparent;
      border: none;
      border-bottom: 1px solid transparent;
      border-radius: 0;
      padding: 0;
      margin: 0;
      width: 100%;
      box-sizing: border-box;
      display: block;
    }

    /* The name line carries a found person's name type: 14px / 600. */
    .manual-name-input {
      max-width: 230px;
      font-size: 14px;
      font-weight: 600;
    }

    /* The street line carries the street line's type: 12.5px / 600. */
    .manual-street-input {
      font-size: 12.5px;
      font-weight: 600;
    }

    /* ...and the city line the muted line under it: 11.5px / 400 in the card's grey. */
    .manual-city-input {
      font-size: 11.5px;
      font-weight: 400;
      color: #52525b;
    }

    .manual-name-input:focus,
    .manual-street-input:focus,
    .manual-city-input:focus {
      outline: none;
      border-bottom-color: #d4d4d8;
    }

    .manual-name-input::placeholder,
    .manual-street-input::placeholder,
    .manual-city-input::placeholder {
      color: #a1a1aa;
      font-weight: 400;
    }


    .manual-search-btn svg {
      width: 11px;
      height: 11px;
      flex-shrink: 0;
    }

    .manual-search-btn.running {
      opacity: 0.6;
      pointer-events: none;
    }

    .age-dob-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .dob-badge-container {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 4px;
      padding: 1px 6px;
      font-size: 10.5px;
    }

    .dob-badge-label {
      color: #1e40af;
      font-weight: 600;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }

    .dob-badge-val {
      color: #1e3a8a;
      font-weight: 600;
    }

    /* Vehicle Progress & Lookup Box */
    .vehicle-progress-box {
      margin-top: 8px;
      padding: 8px 10px;
      background: #f8fafc;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 7px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .vehicle-progress-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }

    .vehicle-progress-left {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      flex: 1;
    }

    .vehicle-provider-tag {
      background: #09090b;
      color: #ffffff;
      font-size: 9.5px;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 4px;
      letter-spacing: 0.2px;
      flex-shrink: 0;
    }

    .vehicle-progress-status {
      color: #334155;
      font-weight: 500;
      font-size: 10.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .vehicle-cancel-btn {
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 10px;
      cursor: pointer;
      padding: 1px 4px;
      font-family: 'Poppins', sans-serif;
      transition: color 0.15s;
      flex-shrink: 0;
    }

    .vehicle-cancel-btn:hover {
      color: #ef4444;
    }

    .vehicle-progress-track {
      width: 100%;
      height: 4px;
      background: #e2e8f0;
      border-radius: 2px;
      overflow: hidden;
    }

    .vehicle-progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #10b981, #059669);
      border-radius: 2px;
      transition: width 0.35s ease;
    }

    /* Vehicle Discovered Results Box */
    .vehicle-results-box {
      margin-top: 8px;
      padding: 8px 10px;
      background: #f8fafc;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .vehicle-results-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .vehicle-badges-container {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .vehicle-badge-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 11px;
      font-weight: 500;
      color: #0f172a;
    }

    .vehicle-badge-name {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .vehicle-empty-notice {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #fffbeb;
      border: 1px solid #fef3c7;
      border-radius: 6px;
      padding: 6px 9px;
      font-size: 11px;
      font-weight: 500;
      color: #b45309;
    }

    /* DOB Discovered Results Box */
    .dob-results-box {
      margin-top: 8px;
      padding: 8px 10px;
      background: #f0fdf4;
      border: 1px solid rgba(22, 163, 74, 0.2);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .dob-results-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .dob-badges-container {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .dob-badge-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #ffffff;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 11.5px;
      font-weight: 600;
      color: #15803d;
    }

    .dob-badge-name {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .dob-badge-source {
      display: inline-block;
      min-width: 56px;
      padding: 1px 6px;
      border-radius: 999px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      color: #166534;
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      text-align: center;
    }

    .dob-badge-item--placeholder .dob-badge-source {
      background: #fffbeb;
      border-color: #fde68a;
      color: #92400e;
    }

    .dob-badge-note {
      font-size: 10px;
      font-weight: 500;
      color: #b45309;
    }

    .dob-cake-icon {
      font-size: 13px;
    }

    /* Email Discovered Results Box */
    .email-results-box {
      margin-top: 8px;
      padding: 8px 10px;
      background: #f0f9ff;
      border: 1px solid rgba(14, 165, 233, 0.25);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .email-results-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .email-badges-container {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .email-badge-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #ffffff;
      border: 1px solid #bae6fd;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      color: #0369a1;
    }

    .email-badge-name {
      display: flex;
      align-items: center;
      gap: 7px;
      word-break: break-all;
    }

    /* Address Box */
    .address-box {
      background: #ffffff;
      border: 1px solid #f1f3f5;
      border-radius: 8px;
      padding: 9px 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .address-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 3px;
    }

    .sub-label {
      font-size: 10px;
      font-weight: 600;
      color: #71717a;
    }

    .street-line {
      font-size: 12.5px;
      font-weight: 600;
      color: #09090b;
    }

    .city-line {
      font-size: 11.5px;
      color: #52525b;
      font-weight: 400;
    }

    .address-title-actions {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .addr-nav {
      display: flex;
      align-items: center;
      gap: 2px;
      background: #f4f4f6;
      border-radius: 6px;
      padding: 2px 4px;
    }

    .addr-nav-btn {
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 4px;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #09090b;
      padding: 0;
      transition: all 0.15s ease;
    }

    .addr-nav-btn:hover {
      background: #09090b;
      color: #ffffff;
      border-color: #09090b;
    }

    .addr-nav-counter {
      font-size: 10px;
      font-weight: 600;
      color: #52525b;
      min-width: 22px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    /* ZIP filter on the record navigation row */
    .zip-filter-box {
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .zip-filter-input {
      width: 74px;
      padding: 3px 6px;
      font-family: 'Poppins', sans-serif;
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.4px;
      color: #09090b;
      background: #ffffff;
      border: 1px solid #e4e4e7;
      border-radius: 5px;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .zip-filter-input::placeholder {
      color: #a1a1aa;
      font-weight: 400;
      letter-spacing: 0;
    }

    .zip-filter-input:focus {
      border-color: #09090b;
      box-shadow: 0 0 0 2px rgba(9, 9, 11, 0.08);
    }

    .zip-filter-clear {
      background: #ffffff;
      border: 1px solid #e4e4e7;
      border-radius: 5px;
      color: #52525b;
      width: 18px;
      height: 18px;
      font-size: 10px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      transition: all 0.15s ease;
    }

    .zip-filter-clear:hover {
      background: #09090b;
      color: #ffffff;
      border-color: #09090b;
    }

    .zip-filter-note {
      font-size: 11.5px;
      color: #71717a;
      padding: 6px 0 2px;
    }

    /* Compliance Card */
    .compliance-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }

    .compliance-cell {
      background: #fafafa;
      border: 1px solid #f1f3f5;
      border-radius: 8px;
      padding: 9px 6px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      align-items: center;
      text-align: center;
    }

    .cell-label {
      font-size: 10px;
      font-weight: 500;
      color: #71717a;
    }

    .badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 6px;
      border-radius: 5px;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-sizing: border-box;
    }

    .badge-clean {
      background: #dcfce7;
      color: #166534;
      border: 1px solid rgba(22, 101, 52, 0.2);
    }

    .badge-flagged {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid rgba(185, 28, 28, 0.2);
    }

    .badge-neutral {
      background: #f4f4f5;
      color: #71717a;
      border: 1px solid rgba(0, 0, 0, 0.05);
    }

    /* Summary & Copy All */
    .copy-all-btn {
      background: #09090b;
      color: #ffffff;
      border: none;
      border-radius: 9px;
      padding: 10px 14px;
      font-family: 'Poppins', sans-serif;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: background 0.15s;
    }

    .copy-all-btn:hover {
      background: #27272a;
    }

    .raw-box {
      background: #fafafa;
      border: 1px solid #f1f3f5;
      border-radius: 8px;
      padding: 10px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      color: #27272a;
      white-space: pre-wrap;
      line-height: 1.5;
    }

    /* Settings Button */
    .settings-btn {
      padding: 3px 5px;
      border-radius: 5px;
      color: #71717a;
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .settings-btn:hover {
      background: #f4f4f6;
      border-color: #e4e4e7;
      color: #09090b;
      transform: rotate(20deg);
    }

    /* Settings Sidebar Drawer */
    .settings-sidebar {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      background: #ffffff;
      z-index: 100;
      display: flex;
      flex-direction: column;
      transform: translateX(0);
      transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .settings-sidebar.closed {
      transform: translateX(100%);
      pointer-events: none;
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 13px 16px;
      border-bottom: 1px solid #f1f3f5;
      background: #ffffff;
    }

    .sidebar-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      color: #09090b;
    }

    .close-sidebar-btn {
      font-size: 12px;
      width: 26px;
      height: 26px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      border: 1px solid #e4e4e7;
      border-radius: 6px;
      cursor: pointer;
      color: #71717a;
    }

    .close-sidebar-btn:hover {
      color: #09090b;
      border-color: #09090b;
    }

    .sidebar-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
      flex: 1;
    }

    /* Which build is running. The widget is injected on demand and the toolbar icon afterwards only
       toggles the copy that is already on the page, so a page can be running code older than the file on
       disk. This footer is how the two are told apart (the console prints the same stamp on injection). */
    .sidebar-build-stamp {
      padding: 7px 16px 9px;
      border-top: 1px solid #f1f3f5;
      font-size: 10px;
      color: #a1a1aa;
      letter-spacing: 0.2px;
    }

    .sidebar-section-header {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .sidebar-section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #71717a;
    }

    .sidebar-section-desc {
      font-size: 12px;
      color: #52525b;
      line-height: 1.45;
    }

    /* One switch per setting: the checkbox holds the state; the track and knob are what it looks
       like. The label wraps both, so clicking anywhere on the row toggles it. */
    .setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 11px 14px;
      background: #fafafa;
      border: 1px solid #e4e4e7;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .setting-row:hover {
      background: #f4f4f5;
    }

    .setting-label {
      font-size: 13px;
      font-weight: 500;
      color: #18181b;
    }

    .settings-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .setting-toggle {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
      pointer-events: none;
    }

    .setting-track {
      position: relative;
      flex: 0 0 auto;
      width: 38px;
      height: 22px;
      border-radius: 999px;
      background: #d4d4d8;
      transition: background 0.18s ease;
    }

    .setting-knob {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      transition: transform 0.18s ease;
    }

    .setting-toggle:checked + .setting-track {
      background: #09090b;
    }

    .setting-toggle:checked + .setting-track .setting-knob {
      transform: translateX(16px);
    }

    .setting-toggle:focus-visible + .setting-track {
      outline: 2px solid #09090b;
      outline-offset: 2px;
    }

    .setting-row.off .setting-label {
      color: #a1a1aa;
    }

    .hidden {
      display: none !important;
    }
  `;

  // HTML Structure
  const container = document.createElement("div");
  container.className = "widget-container";

  // The panel runs in two places: injected into a page, and as the whole of the extension's own detached
  // window (`window.html` loads this same file, so there is one panel to maintain). An extension URL is
  // what tells them apart - the worker only ever injects into http(s) pages - and in the window the panel
  // fills it instead of floating over it.
  const IS_OWN_WINDOW = window.location.protocol === "chrome-extension:";
  if (IS_OWN_WINDOW) container.classList.add("window-mode");
  container.innerHTML = `
    <div class="widget-header" id="widget-header">
      <div class="header-left">
        <button id="refresh-btn" class="refresh-btn" title="Refresh - restart the background workers and clear this lookup" type="button" aria-label="Refresh">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
        <span class="brand-title">Auto Lookup</span>
      </div>
      <div class="header-controls">
        <div id="auth-header-pill" class="auth-header-pill hidden" title="Remaining Lookups · Click to refresh">
          <svg class="quota-bolt-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
          <span id="auth-quota-display" class="auth-quota-display">0 left</span>
          <button id="auth-logout-btn" class="auth-logout-btn" title="Sign Out" type="button">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
        <button id="settings-toggle-btn" class="control-btn settings-btn" title="Calibration & Settings" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
        <button id="popout-btn" class="control-btn popout-btn" title="Open in a separate window" aria-label="Open in a separate window" type="button">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </button>
        <button id="close-btn" class="control-btn close-btn" title="Close" type="button">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>

    <div class="widget-body" id="widget-body">
      <!-- In-Widget Sign In (shown when not logged in) -->
      <div id="widget-auth-view" class="widget-auth-view">
        <div class="auth-brand">
          <img src="${chrome.runtime.getURL("logo.png")}" alt="Auto Lookup" />
          <span>Auto Lookup</span>
        </div>

        <div class="auth-hero">
          <h2>Welcome back</h2>
          <p>Sign in to run compliance lookups</p>
        </div>

        <div id="widget-auth-alert" class="auth-alert hidden">
          <span id="widget-auth-alert-text">limit reached contact admin for more limit</span>
        </div>

        <form id="widget-auth-form" autocomplete="on">
          <div class="auth-field">
            <label class="auth-label" for="widget-auth-username">Username</label>
            <div class="auth-input-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              <input type="text" id="widget-auth-username" placeholder="Enter your username" required autocomplete="username" spellcheck="false" />
            </div>
          </div>

          <div class="auth-field">
            <label class="auth-label" for="widget-auth-password">Password</label>
            <div class="auth-input-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2.2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <input type="password" id="widget-auth-password" placeholder="Enter your password" required autocomplete="current-password" spellcheck="false" />
              <button type="button" id="widget-auth-eye" class="auth-eye" title="Show password" aria-label="Show password">
                <svg id="widget-auth-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <svg id="widget-auth-eye-shut" class="hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 3l18 18"></path>
                  <path d="M10.6 5.2A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.6 4.2"></path>
                  <path d="M6.5 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a10.7 10.7 0 0 0 4.4-.9"></path>
                  <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>
                </svg>
              </button>
            </div>
          </div>

          <button type="submit" id="widget-auth-submit" class="auth-submit">
            <span id="widget-auth-btn-text">Sign In</span>
            <span id="widget-auth-spinner" class="auth-spinner hidden"></span>
          </button>
        </form>

        <div class="auth-foot">
          Each lookup is counted against your account.<br />
          <b>Need more lookups?</b> Ask your admin.
        </div>
      </div>

      <!-- Main Search Views (hidden until authenticated) -->
      <div id="widget-main-view" class="widget-main-view hidden">
        <!-- Mode Toggle (Manual / Auto) -->
        <div class="mode-toggle-bar">
          <div class="mode-segmented">
            <button id="mode-manual-btn" class="mode-btn active" type="button">Manual</button>
            <button id="mode-auto-btn" class="mode-btn" type="button">
              <span>Auto</span>
            </button>
          </div>
        </div>

        <div id="auto-feedback-bar" class="auto-feedback-bar hidden">
          <div id="auto-spinner" class="auto-spinner hidden"></div>
          <span id="auto-feedback-text">Auto mode active · Waiting for dialer number...</span>
        </div>

        <!-- Search Input -->
        <div class="search-row">
          <input
            type="tel"
            id="phone-input"
            class="phone-input"
            placeholder="(555) 555-5555"
            maxlength="14"
            spellcheck="false"
            autocomplete="off"
          />
          <button id="search-btn" class="search-btn" type="button">Search</button>
        </div>

        <!-- Error Message -->
        <div id="error-container" class="error-banner hidden">
          <span id="error-text"></span>
        </div>

        <!-- Results Area -->
        <div id="results-container" class="results-area hidden">
          <div id="records-list"></div>
        </div>
      </div>
    </div>

    <!-- Settings Sidebar Drawer -->
    <aside id="settings-sidebar" class="settings-sidebar closed">
      <div class="sidebar-header">
        <div class="sidebar-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          <span>Settings & Calibration</span>
        </div>
        <button id="close-sidebar-btn" class="close-sidebar-btn" title="Close" type="button">✕</button>
      </div>

      <div class="sidebar-body">
        <div class="sidebar-section-header">
          <span class="sidebar-section-title">Info Lookup</span>
          <span class="sidebar-section-desc">Which records the number is searched on.</span>
        </div>

        <div class="settings-list">
          <label class="setting-row">
            <span class="setting-label">Record 1</span>
            <input type="checkbox" class="setting-toggle" data-setting="records.record1" />
            <span class="setting-track"><span class="setting-knob"></span></span>
          </label>
          <label class="setting-row">
            <span class="setting-label">Record 2</span>
            <input type="checkbox" class="setting-toggle" data-setting="records.record2" />
            <span class="setting-track"><span class="setting-knob"></span></span>
          </label>
          <label class="setting-row">
            <span class="setting-label">Record 3</span>
            <input type="checkbox" class="setting-toggle" data-setting="records.record3" />
            <span class="setting-track"><span class="setting-knob"></span></span>
          </label>
        </div>

        <div class="sidebar-section-header">
          <span class="sidebar-section-title">DOB Sources</span>
          <span class="sidebar-section-desc">Which platforms the DOB button may ask. A source that is off is never searched, and never a fallback.</span>
        </div>

        <div class="settings-list">
          <label class="setting-row">
            <span class="setting-label">Unmask</span>
            <input type="checkbox" class="setting-toggle" data-setting="dob.unmask" />
            <span class="setting-track"><span class="setting-knob"></span></span>
          </label>
          <label class="setting-row">
            <span class="setting-label">ThatSthem</span>
            <input type="checkbox" class="setting-toggle" data-setting="dob.thatsthem" />
            <span class="setting-track"><span class="setting-knob"></span></span>
          </label>
          <label class="setting-row">
            <span class="setting-label">AI</span>
            <input type="checkbox" class="setting-toggle" data-setting="dob.ai" />
            <span class="setting-track"><span class="setting-knob"></span></span>
          </label>
        </div>

        <div class="sidebar-section-header">
          <span class="sidebar-section-title">DNC Status</span>
          <span class="sidebar-section-desc">Which records show their DNC / Litigator / Blacklist status.</span>
        </div>

        <div class="settings-list">
          <label class="setting-row">
            <span class="setting-label">Record 1</span>
            <input type="checkbox" class="setting-toggle" data-setting="dnc.record1" />
            <span class="setting-track"><span class="setting-knob"></span></span>
          </label>
          <label class="setting-row">
            <span class="setting-label">Record 2</span>
            <input type="checkbox" class="setting-toggle" data-setting="dnc.record2" />
            <span class="setting-track"><span class="setting-knob"></span></span>
          </label>
          <label class="setting-row">
            <span class="setting-label">Record 3</span>
            <input type="checkbox" class="setting-toggle" data-setting="dnc.record3" />
            <span class="setting-track"><span class="setting-knob"></span></span>
          </label>
        </div>

      <!-- Which copy of widget.js is on this page. The widget is injected on demand and the toolbar icon
           afterwards only toggles the copy already there, so a page can be running older code than the
           file on disk - this footer is how the two are told apart. Filled in by initWidgetSettingsSidebar. -->
      <div id="widget-build-stamp" class="sidebar-build-stamp"></div>
    </aside>
  `;

  shadow.appendChild(style);
  shadow.appendChild(container);

  // DOM Elements
  const header = shadow.getElementById("widget-header");
  const popoutBtn = shadow.getElementById("popout-btn");
  const closeBtn = shadow.getElementById("close-btn");
  const refreshBtn = shadow.getElementById("refresh-btn");
  const phoneInput = shadow.getElementById("phone-input");
  const searchBtn = shadow.getElementById("search-btn");
  const statusContainer = shadow.getElementById("status-container");
  const statusText = shadow.getElementById("status-text");
  const errorContainer = shadow.getElementById("error-container");
  const errorText = shadow.getElementById("error-text");
  const resultsContainer = shadow.getElementById("results-container");
  const sourceStatusText = shadow.getElementById("source-status-text");
  const recordsList = shadow.getElementById("records-list");
  const copyAllBtn = shadow.getElementById("copy-all-btn");
  const copyAllLabel = shadow.getElementById("copy-all-label");
  const rawOutput = shadow.getElementById("raw-output");

  // Mode Toggle Elements
  const modeManualBtn = shadow.getElementById("mode-manual-btn");
  const modeAutoBtn = shadow.getElementById("mode-auto-btn");
  const autoPulseDot = shadow.getElementById("auto-pulse-dot");
  const autoFeedbackBar = shadow.getElementById("auto-feedback-bar");
  const autoFeedbackText = shadow.getElementById("auto-feedback-text");
  const autoSpinner = shadow.getElementById("auto-spinner");

  // Widget Authentication Elements
  const widgetAuthView = shadow.getElementById("widget-auth-view");
  const widgetAuthAlert = shadow.getElementById("widget-auth-alert");
  const widgetAuthAlertText = shadow.getElementById("widget-auth-alert-text");
  const widgetAuthForm = shadow.getElementById("widget-auth-form");
  const widgetAuthUsername = shadow.getElementById("widget-auth-username");
  const widgetAuthPassword = shadow.getElementById("widget-auth-password");
  const widgetAuthSubmit = shadow.getElementById("widget-auth-submit");
  const widgetAuthBtnText = shadow.getElementById("widget-auth-btn-text");
  const widgetAuthSpinner = shadow.getElementById("widget-auth-spinner");
  const widgetMainView = shadow.getElementById("widget-main-view");
  const authHeaderPill = shadow.getElementById("auth-header-pill");
  const authQuotaDisplay = shadow.getElementById("auth-quota-display");
  const authLogoutBtn = shadow.getElementById("auth-logout-btn");

  // The password field's reveal control: the eye shows what has been typed, the struck-through eye puts
  // it back. It only changes the input's type - nothing is read or sent by it.
  const widgetAuthEye = shadow.getElementById("widget-auth-eye");
  const widgetAuthEyeOpen = shadow.getElementById("widget-auth-eye-open");
  const widgetAuthEyeShut = shadow.getElementById("widget-auth-eye-shut");
  if (widgetAuthEye && widgetAuthPassword) {
    widgetAuthEye.addEventListener("click", () => {
      const revealed = widgetAuthPassword.type === "text";
      widgetAuthPassword.type = revealed ? "password" : "text";
      widgetAuthEye.setAttribute("title", revealed ? "Show password" : "Hide password");
      widgetAuthEye.setAttribute("aria-label", revealed ? "Show password" : "Hide password");
      if (widgetAuthEyeOpen) widgetAuthEyeOpen.classList.toggle("hidden", !revealed);
      if (widgetAuthEyeShut) widgetAuthEyeShut.classList.toggle("hidden", revealed);
    });
  }

  let widgetUser = null;
  let widgetToken = null;

  function showWidgetLogin(alertMessage) {
    // The header goes dark with the panel: while signed out the sign-in photograph is the whole widget.
    container.classList.add("signed-out");
    if (widgetAuthView) widgetAuthView.classList.remove("hidden");
    if (widgetMainView) widgetMainView.classList.add("hidden");
    if (authHeaderPill) authHeaderPill.classList.add("hidden");
    if (alertMessage) {
      if (widgetAuthAlertText) widgetAuthAlertText.textContent = alertMessage;
      if (widgetAuthAlert) widgetAuthAlert.classList.remove("hidden");
    } else {
      if (widgetAuthAlert) widgetAuthAlert.classList.add("hidden");
    }
  }

  function showWidgetMain(user) {
    widgetUser = user;
    container.classList.remove("signed-out");
    if (widgetAuthView) widgetAuthView.classList.add("hidden");
    if (widgetMainView) widgetMainView.classList.remove("hidden");
    if (authHeaderPill) authHeaderPill.classList.remove("hidden");
    updateWidgetQuotaDisplay(user?.lookupsRemaining, user?.lookupsTotal);
  }

  function updateWidgetQuotaDisplay(remaining, total) {
    if (!authQuotaDisplay) return;
    if (widgetUser?.role === "admin") {
      authQuotaDisplay.textContent = "Admin (∞)";
      authQuotaDisplay.classList.remove("low");
      return;
    }
    const rem = typeof remaining === "number" ? remaining : 0;
    const tot = typeof total === "number" ? total : 0;
    authQuotaDisplay.textContent = `${rem} / ${tot} left`;
    if (rem <= 10) {
      authQuotaDisplay.classList.add("low");
    } else {
      authQuotaDisplay.classList.remove("low");
    }
  }

  function syncWidgetQuota() {
    if (!widgetToken) return;
    try {
      chrome.runtime.sendMessage({ action: "AUTH_SYNC_QUOTA" }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        if (res.success && res.user) {
          widgetUser = res.user;
          updateWidgetQuotaDisplay(res.user.lookupsRemaining, res.user.lookupsTotal);
        } else if (res.code === "LIMIT_REACHED" || res.error?.includes("limit reached")) {
          showWidgetLogin("limit reached contact admin for more limit");
        }
      });
    } catch (_) {}
  }

  // Check login on widget initialization
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["dnc_auth_token", "dnc_auth_user", "dnc_api_url"], (res) => {
      widgetToken = res ? res.dnc_auth_token : null;
      widgetUser = res ? res.dnc_auth_user : null;
      if (widgetToken && widgetUser) {
        showWidgetMain(widgetUser);
        syncWidgetQuota();
      } else {
        showWidgetLogin();
      }
    });

    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.dnc_auth_user) {
          const newUser = changes.dnc_auth_user.newValue;
          if (newUser) {
            widgetUser = newUser;
            updateWidgetQuotaDisplay(newUser.lookupsRemaining, newUser.lookupsTotal);
          } else {
            widgetUser = null;
            widgetToken = null;
            showWidgetLogin();
          }
        }
      });
    }

    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.action === "AUTH_QUOTA_UPDATED") {
        if (widgetUser) {
          widgetUser.lookupsRemaining = msg.lookupsRemaining;
          widgetUser.lookupsTotal = msg.lookupsTotal;
        }
        updateWidgetQuotaDisplay(msg.lookupsRemaining, msg.lookupsTotal);
      } else if (msg.action === "AUTH_LIMIT_REACHED") {
        showWidgetLogin("limit reached contact admin for more limit");
      } else if (msg.action === "AUTH_LOGGED_OUT" || msg.action === "AUTH_REQUIRED") {
        showWidgetLogin(msg.error);
      }
    });
  }

  // Auto-sync quota periodically (every 20s) and on tab focus
  setInterval(() => {
    if (widgetToken && widgetUser) {
      syncWidgetQuota();
    }
  }, 20000);

  window.addEventListener("focus", () => {
    if (widgetToken && widgetUser) {
      syncWidgetQuota();
    }
  });

  if (authHeaderPill) {
    authHeaderPill.addEventListener("click", (e) => {
      if (e.target && (e.target === authLogoutBtn || authLogoutBtn?.contains(e.target))) {
        return;
      }
      syncWidgetQuota();
      authHeaderPill.style.transform = "scale(0.96)";
      setTimeout(() => { authHeaderPill.style.transform = "none"; }, 150);
    });
  }

  if (authLogoutBtn) {
    authLogoutBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      widgetToken = null;
      widgetUser = null;
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(["dnc_auth_token", "dnc_auth_user"], () => {
          showWidgetLogin();
          try {
            chrome.runtime.sendMessage({ action: "AUTH_LOGGED_OUT" }).catch(() => {});
          } catch (_) {}
        });
      } else {
        showWidgetLogin();
      }
    });
  }

  if (widgetAuthForm) {
    widgetAuthForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = widgetAuthUsername?.value?.trim();
      const password = widgetAuthPassword?.value;
      if (!username || !password) return;

      if (widgetAuthAlert) widgetAuthAlert.classList.add("hidden");
      if (widgetAuthSubmit) widgetAuthSubmit.disabled = true;
      if (widgetAuthBtnText) widgetAuthBtnText.classList.add("hidden");
      if (widgetAuthSpinner) widgetAuthSpinner.classList.remove("hidden");

      chrome.runtime.sendMessage(
        {
          action: "AUTH_LOGIN",
          username: username,
          password: password,
        },
        (res) => {
          if (widgetAuthSubmit) widgetAuthSubmit.disabled = false;
          if (widgetAuthBtnText) widgetAuthBtnText.classList.remove("hidden");
          if (widgetAuthSpinner) widgetAuthSpinner.classList.add("hidden");

          if (!res) {
            showWidgetLogin("No response from extension background worker.");
            return;
          }

          if (!res.success) {
            showWidgetLogin(res.error || "Login failed");
            return;
          }

          widgetToken = res.token;
          widgetUser = res.user;
          if (widgetAuthPassword) widgetAuthPassword.value = "";
          showWidgetMain(res.user);
        }
      );
    });
  }

  let currentLookupMode = "manual"; // "manual" | "auto"
  let autoPollTimer = null;
  let autoDomObserver = null;
  let lastAutoLookedUpPhone = "";

  function cleanPhoneNumber(val) {
    if (!val) return "";
    let digits = String(val).replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
      digits = digits.substring(1);
    }
    if (digits.length === 10 && !/^0+$/.test(digits)) {
      return digits;
    }
    return "";
  }

  function extractDialerPhoneFromDoc(doc) {
    if (!doc) return "";
    try {
      // 1. Vicidial Manual Dial input fields
      const mdInput =
        doc.getElementById("MDPhOnEnUmBeR") ||
        doc.querySelector("input#MDPhOnEnUmBeR") ||
        doc.querySelector('input[name="MDPhOnEnUmBeR"]') ||
        doc.getElementById("MDphoneNumber") ||
        doc.querySelector('input[name="MDphoneNumber"]') ||
        doc.querySelector('input[name="manual_dial_phone"]');
      if (mdInput && mdInput.value) {
        const cleaned = cleanPhoneNumber(mdInput.value);
        if (cleaned) return cleaned;
      }

      // 2. Standard input with id="phone_number" or name="phone_number"
      const inputEl =
        doc.getElementById("phone_number") ||
        doc.querySelector("input#phone_number") ||
        doc.querySelector('input[name="phone_number"]');
      if (inputEl && inputEl.value) {
        const cleaned = cleanPhoneNumber(inputEl.value);
        if (cleaned) return cleaned;
      }

      // 3. Element with id="phone_numberDISP"
      const dispEl =
        doc.getElementById("phone_numberDISP") ||
        doc.querySelector("#phone_numberDISP");
      if (dispEl) {
        const text = dispEl.innerText || dispEl.textContent;
        const cleaned = cleanPhoneNumber(text);
        if (cleaned) return cleaned;
      }
    } catch (e) {}
    return "";
  }

  function scanForDialerPhone() {
    // 1. Check current top document
    let phone = extractDialerPhoneFromDoc(document);
    if (phone) return phone;

    // 2. Check iframes / frames on the page (e.g. Vicidial agent frames)
    try {
      const frames = document.querySelectorAll("iframe, frame");
      for (let i = 0; i < frames.length; i++) {
        try {
          const fDoc =
            frames[i].contentDocument || frames[i].contentWindow?.document;
          if (fDoc) {
            phone = extractDialerPhoneFromDoc(fDoc);
            if (phone) return phone;

            // Check nested frames
            const subFrames = fDoc.querySelectorAll("iframe, frame");
            for (let j = 0; j < subFrames.length; j++) {
              try {
                const sfDoc =
                  subFrames[j].contentDocument ||
                  subFrames[j].contentWindow?.document;
                if (sfDoc) {
                  phone = extractDialerPhoneFromDoc(sfDoc);
                  if (phone) return phone;
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }
    } catch (_) {}

    return "";
  }

  // A phone the page detected, looked up from here. When the panel lives in its own window there is no page
  // to watch: the in-page copy is the one that can see the dialer, and it announces every number it finds.
  // This is what turns that announcement into a lookup, exactly as that copy would have run it. A number
  // that was already looked up is left alone.
  function runDetectedPhoneLookup(rawPhone) {
    const digits = String(rawPhone == null ? "" : rawPhone).replace(/\D/g, "");
    if (digits.length !== 10 || !phoneInput) return;
    if (digits === lastAutoLookedUpPhone) return;
    lastAutoLookedUpPhone = digits;

    phoneInput.value = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;

    if (autoFeedbackBar) autoFeedbackBar.classList.remove("waiting");
    if (autoSpinner) autoSpinner.classList.remove("hidden");
    if (autoFeedbackText) autoFeedbackText.textContent = `Auto-detected: ${digits} · Looking up...`;

    if (searchBtn) searchBtn.click();
  }

  function startAutoLookup() {
    stopAutoLookup();
    lastAutoLookedUpPhone = "";
    checkAutoNumber();

    // High frequency interval (every 500ms) for reliable detection of JS value changes
    autoPollTimer = setInterval(checkAutoNumber, 500);

    // MutationObserver for instant DOM updates
    try {
      autoDomObserver = new MutationObserver(() => {
        checkAutoNumber();
      });
      autoDomObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    } catch (e) {}
  }

  function stopAutoLookup() {
    if (autoPollTimer) {
      clearInterval(autoPollTimer);
      autoPollTimer = null;
    }
    if (autoDomObserver) {
      autoDomObserver.disconnect();
      autoDomObserver = null;
    }
  }

  function checkAutoNumber() {
    if (currentLookupMode !== "auto") return;

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["dnc_auth_token"], (res) => {
        if (!res || !res.dnc_auth_token) return;

        const rawPhone = scanForDialerPhone();
        if (rawPhone && rawPhone.length === 10) {
          if (rawPhone !== lastAutoLookedUpPhone) {
            lastAutoLookedUpPhone = rawPhone;
            const formatted = `(${rawPhone.slice(0, 3)}) ${rawPhone.slice(3, 6)}-${rawPhone.slice(6, 10)}`;

            if (phoneInput) phoneInput.value = formatted;
            if (autoFeedbackBar) autoFeedbackBar.classList.remove("waiting");
            if (autoSpinner) autoSpinner.classList.remove("hidden");
            if (autoFeedbackText)
              autoFeedbackText.textContent = `Auto-detected: ${rawPhone} · Looking up...`;

            // Broadcast to other extension views (window / popup)
            chrome.runtime
              .sendMessage({
                action: "PAGE_PHONE_DETECTED",
                phone: rawPhone,
              })
              .catch(() => {});

            // Automatically execute search - but only from the copy that is on screen. A panel that has
            // been popped out (hidden) has nothing to paint into, and the window runs that lookup instead;
            // a panel hidden from the toolbar has nothing to show either. Either way, this is what keeps a
            // detected number to one lookup rather than two.
            if (searchBtn && !container.classList.contains("hidden")) searchBtn.click();
          }
        } else {
          if (!lastAutoLookedUpPhone) {
            if (autoSpinner) autoSpinner.classList.add("hidden");
            if (autoFeedbackBar) autoFeedbackBar.classList.add("waiting");
            if (autoFeedbackText)
              autoFeedbackText.textContent =
                "Auto mode active · Waiting for dialer number...";
          } else {
            // Dialer cleared between calls
            lastAutoLookedUpPhone = "";
            if (autoSpinner) autoSpinner.classList.add("hidden");
            if (autoFeedbackBar) autoFeedbackBar.classList.add("waiting");
            if (autoFeedbackText)
              autoFeedbackText.textContent =
                "Auto mode active · Waiting for next dialer number...";
          }
        }
      });
    }
  }

  function setLookupMode(mode, save = true) {
    currentLookupMode = mode;
    if (save) {
      chrome.storage.local.set({ lookupMode: mode });
    }

    if (mode === "auto") {
      if (modeManualBtn) modeManualBtn.classList.remove("active");
      if (modeAutoBtn) modeAutoBtn.classList.add("active");
      if (autoPulseDot) autoPulseDot.classList.remove("hidden");
      if (autoFeedbackBar) autoFeedbackBar.classList.remove("hidden");
      startAutoLookup();
    } else {
      if (modeAutoBtn) modeAutoBtn.classList.remove("active");
      if (modeManualBtn) modeManualBtn.classList.add("active");
      if (autoPulseDot) autoPulseDot.classList.add("hidden");
      if (autoFeedbackBar) autoFeedbackBar.classList.add("hidden");
      if (autoSpinner) autoSpinner.classList.add("hidden");
      stopAutoLookup();
      setLoading(false);
      hideStatus();
      hideError();
    }
  }

  if (modeManualBtn)
    modeManualBtn.addEventListener("click", () => setLookupMode("manual"));
  if (modeAutoBtn)
    modeAutoBtn.addEventListener("click", () => setLookupMode("auto"));

  // Restore saved lookup mode
  chrome.storage.local.get(["lookupMode"], (res) => {
    if (res.lookupMode === "auto") {
      setLookupMode("auto", false);
    } else {
      setLookupMode("manual", false);
    }
  });

  // Track results from both sources
  let activeResults = []; // [{ source, data }]

  // Restore the saved position. Visibility is deliberately not restored: the widget only exists on a
  // page because the toolbar icon was clicked there, so a widget that was injected is one the user
  // asked for. (The close button hides this page's copy; the next click on the icon brings it back.)
  chrome.storage.local.get(["widgetPosition"], (res) => {
    if (res.widgetPosition) {
      const { top, left } = res.widgetPosition;
      container.style.top = `${Math.max(10, Math.min(top, window.innerHeight - 80))}px`;
      container.style.left = `${Math.max(10, Math.min(left, window.innerWidth - 410))}px`;
      container.style.right = "auto";
    }
  });

  // Dragging Logic
  let isDragging = false;
  let startX = 0,
    startY = 0;
  let initialLeft = 0,
    initialTop = 0;

  header.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = container.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    const maxLeft = window.innerWidth - container.offsetWidth - 10;
    const maxTop = window.innerHeight - 40;

    newLeft = Math.max(10, Math.min(newLeft, maxLeft));
    newTop = Math.max(10, Math.min(newTop, maxTop));

    container.style.left = `${newLeft}px`;
    container.style.top = `${newTop}px`;
    container.style.right = "auto";
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      const rect = container.getBoundingClientRect();
      chrome.storage.local.set({
        widgetPosition: { top: rect.top, left: rect.left },
      });
    }
  });

  // Pop-Out: the panel moves into its own window. A content script cannot open one, so the worker does it
  // and answers once the window is up - and only then does this copy stand aside, which is what keeps a
  // failure to open from leaving the user with nothing.
  //
  // It is hidden rather than removed: closing that window shows this very panel again, holding what it had
  // (background.js owns that), and the toolbar icon brings it back sooner.
  if (popoutBtn) {
    popoutBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "OPEN_DETACHED_WINDOW" }, (res) => {
        if (!res || !res.ok) return;
        container.classList.add("hidden");
      });
    });
  }

  // Close Button
  closeBtn.addEventListener("click", () => {
    // In the detached window there is no page to hide the panel from: closing it closes the window.
    if (IS_OWN_WINDOW) {
      window.close();
      return;
    }
    container.classList.add("hidden");
  });

  // Refresh Button - restarts the whole extension (RESTART_EXTENSION in background.js).
  //
  // This is where the six-dot drag grip used to be. Dragging still works from the rest of the header,
  // and this spot now does the one thing the widget cannot do for itself: it asks the background to
  // reload the entire extension, front and back - the service worker, the offscreen document with every
  // runner frame inside it, the popup and the detached window - in one go. The tab this was pressed on
  // gets its widget back afterwards: background.js remembers the tab id and injects the widget into it
  // again as soon as the new service worker starts.
  let isRestarting = false;

  // The background answers *before* it reloads itself, so this is only a safety net for a worker that
  // is wedged, missing, or from an older copy of the extension. The icon must never spin for ever.
  const RESTART_ACK_TIMEOUT_MS = 8000;

  function stopRestartSpinner() {
    if (refreshBtn) {
      refreshBtn.classList.remove("spinning");
      refreshBtn.disabled = false;
    }
    isRestarting = false;
  }

  function restartExtension() {
    if (isRestarting || !refreshBtn) return;
    isRestarting = true;
    refreshBtn.classList.add("spinning");
    refreshBtn.disabled = true;

    // The restart cancels the runs that drew these, so their progress is cleared; the records the user
    // has already read stay on screen. None of this may be allowed to keep the icon spinning, hence
    // the guard: the restart itself is what matters, not the cosmetics around it.
    try {
      ["dob", "email", "gender", "address", "amica", "mercury"].forEach((provider) => {
        hideVehicleProgress(provider);
        activeResults.forEach((r) => hideVehicleProgress(provider, r.source));
        lookupRecordByProvider[provider] = "";
      });
      hideError();
      setLoading(false);
      // A newer session id is what makes this widget ignore anything a cancelled run still streams in.
      currentSearchSession++;
      showStatus("Restarting the extension...");
    } catch (e) {
      // Cosmetic only.
    }

    const watchdog = setTimeout(() => {
      stopRestartSpinner();
      hideStatus();
      showError(
        "The extension did not answer the restart. Reload it from chrome://extensions, then reload this page.",
      );
    }, RESTART_ACK_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage({ action: "RESTART_EXTENSION" }, (res) => {
        const failed = chrome.runtime.lastError || !res || !res.success;
        clearTimeout(watchdog);
        stopRestartSpinner();

        if (failed) {
          hideStatus();
          showError(
            (res && res.error) ||
              "Could not restart the extension. Reload it from chrome://extensions.",
          );
          return;
        }

        // The extension is reloading now; the widget that comes back is a fresh one. Say so instead of
        // claiming a state this copy is about to lose.
        showStatus("Extension restarted - this page is coming back with it...");
        setTimeout(hideStatus, 5000);
      });
    } catch (e) {
      // This page still holds the widget of an older extension context (a reload or an update already
      // invalidated it), so no message can reach a worker from here at all.
      clearTimeout(watchdog);
      stopRestartSpinner();
      hideStatus();
      showError(
        "This page holds an older copy of the widget. Reload the page, then press refresh again.",
      );
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      restartExtension();
    });
  }

  // Phone input formatting
  phoneInput.addEventListener("input", (e) => {
    const raw = e.target.value.replace(/\D/g, "");
    let formatted = "";
    if (raw.length > 0) formatted = "(" + raw.substring(0, 3);
    if (raw.length >= 4) formatted += ") " + raw.substring(3, 6);
    if (raw.length >= 7) formatted += "-" + raw.substring(6, 10);
    e.target.value = formatted || raw;
  });

  phoneInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      searchBtn.click();
    }
  });

  let currentSearchSession = 0;

  // Search Action
  searchBtn.addEventListener("click", async () => {
    const authData = await new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["dnc_auth_token"], (res) => resolve(res || {}));
      } else {
        resolve({});
      }
    });

    if (!authData || !authData.dnc_auth_token) {
      showError("Please sign in via the extension window to access lookups.");
      return;
    }

    const phone = phoneInput.value.trim();
    const digits = phone.replace(/\D/g, "");

    if (digits.length < 10) {
      showError("Please enter a valid 10-digit phone number.");
      return;
    }

    const session = ++currentSearchSession;

    hideError();
    hideResults();
    activeResults = [];
    recordsList.innerHTML = "";
    // A new search starts unfiltered, so a ZIP left over from the last one cannot hide records.
    setZipFilter("");
    setLoading(true);

    let timeoutId;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Lookup timed out. Please try again.")), 65000);
      });

      const response = await Promise.race([
        chrome.runtime.sendMessage({
          action: "LOOKUP_PHONE",
          phone: phone,
          session: session,
        }),
        timeoutPromise,
      ]);

      // If user triggered a newer search while waiting, ignore this response
      if (session !== currentSearchSession) {
        return;
      }

      if (!response) {
        throw new Error("No response from background service worker.");
      }

      if (response && typeof response.lookupsRemaining === 'number') {
        if (widgetUser) {
          widgetUser.lookupsRemaining = response.lookupsRemaining;
          widgetUser.lookupsTotal = response.lookupsTotal;
        }
        updateWidgetQuotaDisplay(response.lookupsRemaining, response.lookupsTotal);
      }

      if (response.success && response.data) {
        handleIncomingStreamResult({
          source: response.source || "fastest",
          data: response.data,
          isFirst: true,
          isAllDone: response.isAllDone,
          session: session,
        });
      } else if (!response.success && activeResults.length === 0) {
        const errMsg = (response.code === 'LIMIT_REACHED' || response.error?.includes('limit reached'))
          ? 'limit reached contact admin for more limit'
          : (response.error || "Failed to retrieve compliance records.");
        showError(errMsg);
        hideStatus();
        setLoading(false);
      }
    } catch (err) {
      if (session !== currentSearchSession) return;
      if (activeResults.length === 0) {
        showError(err.message || "Error during parallel lookup.");
      }
    } finally {
      clearTimeout(timeoutId);
      if (session === currentSearchSession) {
        hideStatus();
        setLoading(false);
      }
    }
  });

  // Progressive Stream Listener from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "PARALLEL_STREAM_RESULT") {
      // Discard results from previous searches if a new search was started
      if (msg.session && msg.session !== currentSearchSession) {
        return;
      }

      if (typeof msg.lookupsRemaining === 'number') {
        if (widgetUser) {
          widgetUser.lookupsRemaining = msg.lookupsRemaining;
          widgetUser.lookupsTotal = msg.lookupsTotal;
        }
        updateWidgetQuotaDisplay(msg.lookupsRemaining, msg.lookupsTotal);
      }

      if (msg.data) {
        handleIncomingStreamResult(msg);
      } else if (msg.error) {
        if (activeResults.length > 0) {
          // Say which record failed instead of silently showing one record only. The label (Record 1 /
          // Record 2) is what a user can act on; the source behind it is not theirs to know.
          const okRecords = activeResults.map((r) => recordLabel(r.source)).join(" & ");
          sourceStatusText.textContent = `Completed (${okRecords}) - ${msg.source ? recordLabel(msg.source) : "the other record"} failed`;
          hideStatus();
          setLoading(false);
        } else if (msg.isAllDone) {
          showError(msg.error || "Failed to retrieve compliance records.");
          hideStatus();
          setLoading(false);
        }
      }

      if (msg.isAllDone) {
        hideStatus();
        setLoading(false);
        syncWidgetQuota();
      }
    }

    // The toolbar icon is what shows and hides the widget on a page.
    if (msg.action === "TOGGLE_WIDGET") {
      const isHidden = container.classList.contains("hidden");
      if (isHidden) {
        container.classList.remove("hidden");
        phoneInput.focus();
      } else {
        container.classList.add("hidden");
      }
    }

    // The page's panel is the one that can see the dialer, and it announces every number it detects. When
    // this panel is the one in its own window there is no page here to watch, so that announcement is what
    // runs the lookup - in auto mode, the mode the announcement is about.
    if (msg.action === "PAGE_PHONE_DETECTED" && IS_OWN_WINDOW && currentLookupMode === "auto") {
      runDetectedPhoneLookup(msg.phone);
    }

    // The detached window was closed, so the panel that stood aside comes back. Not a toggle: showing a
    // panel that is already visible must not hide it.
    if (msg.action === "SHOW_WIDGET") {
      container.classList.remove("hidden");
      if (phoneInput) phoneInput.focus();
    }

    // The extension is reloading (the refresh button): this widget's context is about to be invalidated,
    // which would leave it on the page as a dead box, so it takes itself out. The injection flag is
    // cleared with it, so the toolbar icon can bring a fresh widget back even if the reload never
    // actually happens.
    if (msg.action === "EXTENSION_RELOADING") {
      window.__dnc_widget_injected = false;
      host.remove();
    }
  });

  // Handle results arriving as soon as possible
  function handleIncomingStreamResult(msg) {
    const { source, data, isAllDone } = msg;

    // Check if we already added a result from this exact source
    const existingFromSource = activeResults.find((r) => r.source === source);
    if (existingFromSource) return;

    hideError();

    // Every record that is switched on gets its own card - even when the two answers are identical.
    // Identical records used to be folded into one card labelled "… & … (Verified)", which hid the
    // second record behind the first one. The cards are exactly what the Settings switches
    // (Record 1 / Record 2) decide between, so each record has to stand on its own.
    activeResults.push({ source, data });

    // Render the card
    renderResultCard(source, data, activeResults.length);

    resultsContainer.classList.remove("hidden");

    if (activeResults.length === 1) {
      if (isAllDone) {
        if (sourceStatusText) sourceStatusText.textContent = `Completed (${recordLabel(source)})`;
        hideStatus();
        setLoading(false);
      } else {
        if (sourceStatusText) sourceStatusText.textContent = `Fastest Result: ${recordLabel(source)} (awaiting secondary...)`;
        hideStatus();
        setLoading(false);
      }
    } else {
      if (sourceStatusText) {
        // Label the records (Record 1 / Record 2); the source behind a label is not the user's to know.
        sourceStatusText.textContent = `Multiple Records Found (${activeResults.map((r) => recordLabel(r.source)).join(" & ")})`;
      }
      hideStatus();
      setLoading(false);
    }

    if (isAllDone) {
      hideStatus();
      setLoading(false);
    }

    updateRawSummary();
  }

  // (The record comparison helpers that used to decide whether two records were "the same" - and
  // therefore whether one card or two should be drawn - are gone: every record draws its own card.)

  // ---------------------------------------------------------------------------
  // Record addresses
  //
  // A record normally carries more than one address: the primary one plus the history the
  // sources returned. The card shows one at a time, and the chevrons next to the copy button
  // step through them (the index is remembered on the person, so it survives re-renders).
  // ---------------------------------------------------------------------------
  function addressListForPerson(person) {
    const list = [];
    const seen = Object.create(null);

    const add = (addr) => {
      if (!addr) return;
      const entry = {
        street: String(addr.street || addr.full || "").trim(),
        unit: String(addr.unit || "").trim(),
        city: String(addr.city || "").trim(),
        state: String(addr.state || "").trim(),
        zip: String(addr.zip || "").trim()
      };
      if (!entry.street && !entry.city && !entry.zip) return;

      const key = [entry.street, entry.unit, entry.city, entry.state, entry.zip]
        .join("|")
        .toLowerCase()
        .replace(/[^a-z0-9|]/g, "");
      if (seen[key]) return;
      seen[key] = true;
      list.push(entry);
    };

    add(person && person.address);
    const history = Array.isArray(person && person.allAddresses) ? person.allAddresses : [];
    history.forEach(add);
    return list;
  }

  function clampAddressIndex(index, total) {
    const value = Math.floor(Number(index));
    if (!total || total < 1 || !isFinite(value)) return 0;
    return Math.min(Math.max(0, value), total - 1);
  }

  // Wraps around, so both chevrons always do something.
  function stepAddressIndex(index, total, delta) {
    if (!total || total < 1) return 0;
    const current = clampAddressIndex(index, total);
    return (current + delta + total) % total;
  }

  function addressLabelForIndex(index, total) {
    const position = clampAddressIndex(index, total || 1);
    if (position <= 0) return "Primary address";
    return "Address " + (position + 1);
  }

  // The two lines of the card, mirroring the fallbacks used when a source returns no street.
  function addressLinesForOption(option) {
    if (!option) return null;
    const street = option.unit ? option.street + " " + option.unit : option.street;
    const cityStateZip =
      [option.city, option.state].filter(Boolean).join(", ") + (option.zip ? " " + option.zip : "");

    if (street) return { street: street, city: cityStateZip };
    if (cityStateZip) return { street: cityStateZip, city: option.zip ? "ZIP " + option.zip : "" };
    return { street: "No address record found", city: "" };
  }

  // Chevron up / down on the right side of the address card, only when there is more than one.
  function addressNavHtml(index, total) {
    if (!total || total < 2) return "";
    return `
                <div class="addr-nav" role="group" aria-label="Address ${index + 1} of ${total}">
                  <button class="addr-nav-btn addr-prev-address" type="button" title="Previous address" aria-label="Previous address">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                  </button>
                  <span class="addr-nav-counter">${index + 1}/${total}</span>
                  <button class="addr-nav-btn addr-next-address" type="button" title="Next address" aria-label="Next address">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </button>
                </div>
              `;
  }

  // ---------------------------------------------------------------------------
  // ZIP filter on the record cards
  //
  // The navigation row of every record card carries a small 5 digit ZIP box: typing a ZIP shows
  // only the people of that record whose addresses include it.
  //
  // The value is kept **per record**. It used to be one shared value, which meant a ZIP typed for
  // Record 1 also narrowed Record 2 - so asking "who of these is in 77047?" for one source silently
  // hid people from the other one, with nothing on screen saying why.
  // ---------------------------------------------------------------------------
  const zipFiltersByRecord = Object.create(null); // record source -> normalised ZIP
  const zipFilterRepaints = []; // [{ source, element, repaint }]

  // The value the user has typed for a record. It is stored even while partial, so the box can be
  // re-rendered mid-typing without losing what was typed.
  function zipFilterFor(recordSource) {
    return zipFiltersByRecord[String(recordSource == null ? "" : recordSource)] || "";
  }

  function normalizeZipFilter(value) {
    return String(value == null ? "" : value)
      .replace(/\D/g, "")
      .slice(0, 5);
  }

  // Only a complete ZIP filters - 1-4 digits are still being typed.
  function activeZipFilter(value) {
    const zip = normalizeZipFilter(value == null ? "" : value);
    return zip.length === 5 ? zip : "";
  }

  // A ZIP matches when a 5 digit run of the address carries those digits. House numbers are
  // never 5 digits long, so "112 Comal Peak" can never pass for a ZIP.
  function addressMatchesZip(address, filter) {
    if (!address || !filter) return false;
    const runs = [address.zip, address.full, address.street]
      .filter(Boolean)
      .join(" ")
      .match(/\d{5}/g);
    return !!runs && runs.some((zip) => zip.indexOf(filter) !== -1);
  }

  function personMatchesZipFilter(person, filter) {
    if (!filter) return true;
    // A manual card has no address yet - that is what its Search button is for - so the ZIP filter
    // never hides it: the card the user is filling in must not vanish while they type.
    if (person && person.manual) return true;
    return addressListForPerson(person).some((address) => addressMatchesZip(address, filter));
  }

  function filterPersonsByZip(persons, filter) {
    const list = Array.isArray(persons) ? persons : [];
    if (!filter) return list.slice();
    return list.filter((person) => personMatchesZipFilter(person, filter));
  }

  // Applies a new filter to the record it was typed in, and to that record only. Stale cards are
  // dropped; the other record's card is left exactly as it is.
  function setZipFilter(recordSource, value) {
    const key = String(recordSource == null ? "" : recordSource);
    zipFiltersByRecord[key] = normalizeZipFilter(value);

    for (let i = zipFilterRepaints.length - 1; i >= 0; i--) {
      const entry = zipFilterRepaints[i];
      if (!entry || !entry.element || !entry.element.isConnected) {
        zipFilterRepaints.splice(i, 1);
        continue;
      }
      if (String(entry.source || "") !== key) continue; // not this record's card
      try {
        // A new filter: the card moves to a person the filter found (see the repaint it registers).
        entry.repaint();
      } catch (e) {}
    }
  }

  // The record card's navigation row: the record chevrons, and the ZIP box that filters *this* record
  // only. `hideZip` is what the manual card asks for - it takes the ZIP in its own address field (that is
  // what the AI resolver is for), so the filter box would be a second, competing one.
  function recordNavRowHtml(index, total, recordSource, hideZip) {
    const filterValue = zipFilterFor(recordSource);
    return `
        <div class="person-slide-header">
          <div class="slide-counter-badge"${total > 1 ? "" : ' style="display:none;"'}>
            <button class="slide-nav-btn prev-card-slide" title="Previous record" type="button">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <span class="slide-counter-text">${index + 1} / ${total}</span>
            <button class="slide-nav-btn next-card-slide" title="Next record" type="button">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
          ${hideZip ? "" : `
          <div class="zip-filter-box">
            <input class="zip-filter-input" type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="ZIP code" title="Show only the people whose address is in this ZIP" aria-label="Filter this record by ZIP code" value="${escapeHtml(filterValue)}" />
            <button class="zip-filter-clear${filterValue ? "" : " hidden"}" type="button" title="Clear the ZIP filter" aria-label="Clear the ZIP filter">✕</button>
          </div>`}
        </div>
      `;
  }

  // Keeps a rendered card's ZIP box in step with that record's own filter (the input the user is
  // typing in is left alone, so their keystrokes are never overwritten).
  function syncZipFilterBox(container, recordSource) {
    if (!container) return;
    const filterValue = zipFilterFor(recordSource);
    const input = container.querySelector(".zip-filter-input");
    const clear = container.querySelector(".zip-filter-clear");
    const focused = shadow && shadow.activeElement ? shadow.activeElement : null;
    if (input && input !== focused && input.value !== filterValue) {
      input.value = filterValue;
    }
    if (clear) clear.classList.toggle("hidden", !filterValue);
  }

  function zipFilterNoteHtml(index, source, hiddenCount) {
    return `
        <div class="card person-card">
          <div class="record-header-tag">
            <span>${escapeHtml(recordLabel(source))}</span>
          </div>
          ${recordNavRowHtml(0, 0, source)}
          <div class="zip-filter-note">No address of this record is in ZIP ${escapeHtml(activeZipFilter(zipFilterFor(source)))} - ${hiddenCount} ${hiddenCount === 1 ? "person" : "people"} hidden.</div>
        </div>
      `;
  }

  // ---------------------------------------------------------------------------
  // Which record card owns a lookup
  //
  // Both record cards render the same element ids (card-vehicle-progress, card-dob-results, ...),
  // and shadow.getElementById() returns the FIRST match in the whole shadow root - always Record
  // 1's card. So a lookup started from Record 2 used to paint its progress and results onto Record
  // 1 unless the two records happened to be the same person.
  //
  // Everything a lookup touches is therefore looked up inside the card that owns it. What is
  // remembered is the record's *name*, not the element: a card is rebuilt whenever a search runs,
  // so a held element would go stale, while the name keeps resolving.
  // ---------------------------------------------------------------------------
  const lookupRecordByProvider = Object.create(null); // amica | mercury | dob | email -> record source

  function lookupRecord(provider) {
    return lookupRecordByProvider[String(provider == null ? "" : provider).toLowerCase()] || "";
  }

  // The card element that renders a record's person section.
  function recordCard(recordSource) {
    if (!shadow || !recordSource) return null;
    const wanted = String(recordSource);
    const cards = shadow.querySelectorAll("[data-record-source]");
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute("data-record-source") === wanted) return cards[i];
    }
    return null;
  }

  // Finds an element inside the card that owns it. With no record known - a path that is not tied
  // to any card - the whole shadow root is searched, which is what happened before.
  function recordElement(recordSource, id) {
    if (!recordSource) return shadow ? shadow.getElementById(id) : null;
    const card = recordCard(recordSource);
    return card ? card.querySelector("#" + id) : null;
  }

  // ------------------------------------------------------------------ the manual card on a record
  //
  // A record that named nobody - or a record the user wants to ask about somebody it does not have -
  // gets the same card as everyone else, with two fields instead of a name and an address. Everything
  // else on it (Copy, the gender chip, Rides, DOB, Email, the progress and result boxes) is the card's
  // own markup, so those actions work on a typed-in person exactly as they work on a found one.

  // A person who is being typed in. The shape is the one every action already expects, so nothing else
  // in the card has to know the difference.
  function manualPerson() {
    return {
      manual: true,
      name: "",
      addressInput: "",
      address: { street: "", city: "", state: "", zip: "", full: "" },
      allAddresses: [],
      addressIndex: 0,
      emails: []
    };
  }

  // Turns whatever the user typed into the address field into the parts a lookup needs. The field takes
  // anything - a ZIP on its own, a city and state, a street, or the whole address - and Amica, the DOB
  // run and the AI runs all want a city and a ZIP, so what can be recognised is split out here and the
  // raw text is kept as `addressInput` for the AI resolver to work from.
  function applyManualAddressInput(person, raw) {
    if (!person) return;

    const text = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
    person.addressInput = text;

    const zipMatch = text.match(/\b(\d{5})(?:-\d{4})?\b/);
    const stateMatch = text.match(/\b([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\b/);
    const zip = zipMatch ? zipMatch[1] : "";
    const state = stateMatch ? stateMatch[1].toUpperCase() : "";

    let street = "";
    let city = "";

    const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      street = parts[0];
      const tail = parts[parts.length - 1].replace(/\b[A-Za-z]{2}\b/, " ").replace(/\d{5}(?:-\d{4})?/, " ");
      city = tail.replace(/\s+/g, " ").trim();

      // "1215 W Pleasant Run Rd, # TX75, DeSoto, TX 75115" - a unit between the street and the city
      // leaves the state and ZIP alone on the last part with no city beside them, and the city is then
      // the part before it. A bare two-letter code there is the state, not a city, and is left alone:
      // "…, DeSoto, TX, 75115" must not end up with a city called TX.
      if (!city && parts.length >= 3) {
        const before = parts[parts.length - 2];
        if (!/^[A-Za-z]{2}$/.test(before)) city = before;
      }
    } else if (text) {
      // One field: whatever it looks like it is.
      if (/^\d{5}(?:-\d{4})?$/.test(text)) {
        street = "";
        city = "";
      } else if (state) {
        city = text.replace(/\b[A-Za-z]{2}\s+\d{5}(?:-\d{4})?.*$/, "").replace(/[,\s]+$/, "").trim();
        street = "";
      } else if (/^\d+\s+\S/.test(text)) {
        street = text;
      } else {
        city = text;
      }
    }

    person.address = { street: street, city: city, state: state, zip: zip, full: text };
    person.allAddresses = text ? [{ street: street, city: city, state: state, zip: zip, full: text }] : [];
  }

  // Repaints a record's card from the data it holds. A card registers itself for repaint (the ZIP
  // filter uses the same registry), so a message that arrives for a card that is already on screen
  // redraws it in place instead of waiting for the next search.
  //
  // `keepPerson` belongs to the resolver: its answer is for the card that asked for it, so that card
  // stays on the person it is showing. A ZIP filter change is the opposite - it is about the people the
  // lookup found, so the card moves to one of those.
  function repaintRecord(recordSource, keepPerson) {
    const wanted = String(recordSource == null ? "" : recordSource);
    for (let i = zipFilterRepaints.length - 1; i >= 0; i--) {
      const entry = zipFilterRepaints[i];
      if (!entry || !entry.element || !entry.element.isConnected) {
        zipFilterRepaints.splice(i, 1);
        continue;
      }
      if (String(entry.source || "") !== wanted) continue;
      try {
        entry.repaint(keepPerson);
      } catch (e) {}
    }
  }

  // Render individual card block in order
  function renderResultCard(source, data, index) {
    const cardWrapper = document.createElement("div");
    cardWrapper.className = "card-item-group";
    cardWrapper.style.display = "flex";
    cardWrapper.style.flexDirection = "column";
    cardWrapper.style.gap = "8px";
    cardWrapper.style.marginBottom = "8px";

    const dnc = data.dnc || "Clean";
    const litigator = data.litigator || "Clean";
    const blacklist = data.blacklist || "Clean";

    const allPersons =
      data.persons && data.persons.length > 0
        ? data.persons
        : data.person
          ? [data.person]
          : [];
    // The ZIP box on the navigation row narrows this list down to the matching people. It uses
    // this record's own filter, so a ZIP typed for the other record cannot narrow this one.
    let personsList = filterPersonsByZip(allPersons, activeZipFilter(zipFilterFor(source)));
    let currentPersonIdx = 0;

    const personCardContainer = document.createElement("div");
    // Marks the card that owns these elements. Both record cards render the same element ids, so a
    // lookup has to find *its* card instead of the first match in the whole shadow root.
    personCardContainer.setAttribute("data-record-source", source);

    function updatePersonCardView(pIdx) {
      const p = personsList[pIdx];
      if (!p) return;

      const avatar =
        p.avatar || (p.name ? p.name.slice(0, 2).toUpperCase() : "--");
      const name = p.name || "Unknown Name";
      const age = p.age || "";
      const cityStateZip =
        [p.address?.city, p.address?.state].filter(Boolean).join(", ") +
        (p.address?.zip ? ` ${p.address.zip}` : "");

      // The card shows one of the record's addresses - the chevrons step through the rest.
      const addrOptions = addressListForPerson(p);
      const addrTotal = addrOptions.length;
      const addrIdx = clampAddressIndex(p.addressIndex, addrTotal);
      if (p.addressIndex !== addrIdx) p.addressIndex = addrIdx;
      const addrLines = addressLinesForOption(addrOptions[addrIdx]);

      let streetDisplay = "";
      let cityDisplay = "";

      if (addrLines) {
        streetDisplay = addrLines.street;
        cityDisplay = addrLines.city;
      } else if (p.address?.street) {
        streetDisplay = p.address.street;
        cityDisplay = cityStateZip;
      } else if (cityStateZip) {
        streetDisplay = cityStateZip;
        cityDisplay = p.address?.zip ? `ZIP ${p.address.zip}` : "";
      } else if (p.address?.full) {
        streetDisplay = p.address.full;
        cityDisplay = "";
      } else {
        streetDisplay = "No address record found";
        cityDisplay = "";
      }

      const fullAddr =
        [streetDisplay, cityDisplay].filter(Boolean).join(", ") ||
        p.address?.full ||
        streetDisplay;

      // The manual card has no ZIP box, and with a single card there are no chevrons either - so the
      // header row is only rendered when there is something in it.
      const slideNavHtml = p.manual
        ? (personsList.length > 1 ? recordNavRowHtml(pIdx, personsList.length, source, true) : "")
        : recordNavRowHtml(pIdx, personsList.length, source);

      // A manual card asks for the two things the record could not give: the name, and whatever the user
      // knows of the address. Everything else on the card is the card's own markup, which is what makes
      // the actions under it work on a typed-in person exactly as they do on a found one.
      const nameFieldHtml = p.manual
        ? `<input class="manual-name-input" type="text" autocomplete="off" spellcheck="false" placeholder="e.g., John Smith" aria-label="Name" value="${escapeHtml(p.name || "")}" />`
        : `<span class="person-name">${escapeHtml(name)}</span>`;

      // The manual card's address is the card's own two lines - the street, then the city, state and ZIP -
      // so what is typed in is shown in the same shape a found address is. Both lines are fields, and the
      // pair is put back into one string for the splitter whenever either of them changes.
      const manualStreet = (p.address && p.address.street) || "";
      const manualCity = (p.address && p.address.city) || "";
      const manualState = (p.address && p.address.state) || "";
      const manualZip = (p.address && p.address.zip) || "";
      const manualCityLine = (
        [manualCity, manualState].filter(Boolean).join(", ") + (manualZip ? " " + manualZip : "")
      ).trim();

      const addressBlockHtml = p.manual
        ? `
          <div class="address-box">
            <div class="address-title-row">
              <span class="sub-label">Primary address</span>
              <div class="address-title-actions">
                <button class="mini-btn manual-search-btn" type="button" title="Ask AI for the full address, email and DOB">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                  Search
                </button>
              </div>
            </div>
            <input class="manual-street-input" type="text" autocomplete="off" spellcheck="false" placeholder="e.g., 4821 Maple Grove Ln" aria-label="Street address" value="${escapeHtml(manualStreet)}" />
            <input class="manual-city-input" type="text" autocomplete="off" spellcheck="false" placeholder="e.g., Dayton, Ohio 45402" aria-label="City, state and ZIP" value="${escapeHtml(manualCityLine)}" />
          </div>
        `
        : `
          <div class="address-box">
            <div class="address-title-row">
              <span class="sub-label">${escapeHtml(addressLabelForIndex(addrIdx, addrTotal))}</span>
              <div class="address-title-actions">
                <button class="mini-btn copy-addr-action" data-copy="${escapeHtml(fullAddr)}" type="button">Copy</button>
                ${addressNavHtml(addrIdx, addrTotal)}
              </div>
            </div>
            <div class="street-line">${escapeHtml(streetDisplay)}</div>
            ${cityDisplay ? `<div class="city-line">${escapeHtml(cityDisplay)}</div>` : ""}
          </div>
        `;

      // The Copy button copies the name that is on the card. For a manual card that is whatever has been
      // typed so far - nothing at all until then, so there is nothing to copy - and never the
      // "Unknown Name" fallback, which the card only uses for a found person whose name came back empty.
      const copyNameValue = p.manual ? p.name || "" : name;

      personCardContainer.innerHTML = `
        <div class="card person-card">
          <div class="record-header-tag">
            <span>${recordLabel(source)}</span>
            <button class="manual-add-btn" type="button" title="Add a person to this record" aria-label="Add a person to this record">+</button>
          </div>
          ${slideNavHtml}
          <div class="person-header-row">
            <div class="person-meta">
              <div class="name-wrapper">
                ${nameFieldHtml}
                ${genderBadgeHtml(p.gender, p.genderNote)}
                <div class="person-actions">
                  <button class="mini-btn copy-name-action" data-copy="${escapeHtml(copyNameValue)}" type="button">Copy</button>
                  <button class="mini-btn vehicle-btn amica-action-btn" type="button" title="Discover vehicles on this record">${rideLabel("amica")}</button>
                  <button class="mini-btn dob-btn dob-action-btn" type="button" title="Deep research DOB on Unmask">DOB</button>
                  <button class="mini-btn dob-btn email-action-btn" type="button" title="Find the public primary email with AI">Email</button>
                </div>
              </div>
              <div class="age-dob-row">
                <span class="age-badge">${age}</span>
              </div>
            </div>
          </div>

          ${addressBlockHtml}

          <!-- Vehicle Progress Section -->
          <div class="vehicle-progress-box hidden" id="card-vehicle-progress">
            <div class="vehicle-progress-header">
              <div class="vehicle-progress-left">
                <span class="vehicle-provider-tag" id="vehicle-provider-tag">${rideLabel("amica")}</span>
                <span class="vehicle-progress-status" id="vehicle-progress-status">Starting lookup...</span>
              </div>
              <button class="vehicle-cancel-btn" id="vehicle-cancel-btn" type="button">✕ Cancel</button>
            </div>
            <div class="vehicle-progress-track">
              <div class="vehicle-progress-fill" id="vehicle-progress-fill" style="width: 15%;"></div>
            </div>
          </div>

          <!-- Vehicle Results Section -->
          <div class="vehicle-results-box hidden" id="card-vehicle-results">
            <div class="vehicle-results-header">
              <span class="sub-label" id="vehicle-results-count-label">Discovered Vehicles</span>
              <button class="mini-btn copy-vehicles-action" id="copy-all-vehicles-btn" type="button">Copy All</button>
            </div>
            <div class="vehicle-badges-container" id="vehicle-badges-container"></div>
          </div>

          <!-- DOB Results Section -->
          <div class="dob-results-box hidden" id="card-dob-results">
            <div class="dob-results-header">
              <span class="sub-label" id="dob-results-count-label">Date of Birth (DOB)</span>
            </div>
            <div class="dob-badges-container" id="dob-badges-container"></div>
          </div>

          <!-- Email Results Section -->
          <div class="email-results-box hidden" id="card-email-results">
            <div class="email-results-header">
              <span class="sub-label" id="email-results-count-label">Email Addresses</span>
            </div>
            <div class="email-badges-container" id="email-badges-container"></div>
          </div>
        </div>
      `;

      // Bind slide nav buttons
      const prevBtn = personCardContainer.querySelector(".prev-card-slide");
      const nextBtn = personCardContainer.querySelector(".next-card-slide");

      if (prevBtn) {
        prevBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          currentPersonIdx =
            (currentPersonIdx - 1 + personsList.length) % personsList.length;
          updatePersonCardView(currentPersonIdx);
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          currentPersonIdx = (currentPersonIdx + 1) % personsList.length;
          updatePersonCardView(currentPersonIdx);
        });
      }

      // Bind copy buttons for this slide
      personCardContainer
        .querySelectorAll(".copy-name-action, .copy-addr-action")
        .forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const text = e.currentTarget.getAttribute("data-copy");
            if (text) copyText(text, e.currentTarget);
          });
        });

      // Step through the record's other addresses with the chevrons on the address card
      const prevAddrBtn = personCardContainer.querySelector(".addr-prev-address");
      const nextAddrBtn = personCardContainer.querySelector(".addr-next-address");
      const stepAddress = (delta) => {
        const total = addrOptions.length;
        p.addressIndex = stepAddressIndex(p.addressIndex, total, delta);
        updatePersonCardView(pIdx);
      };

      if (prevAddrBtn) {
        prevAddrBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          stepAddress(-1);
        });
      }

      if (nextAddrBtn) {
        nextAddrBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          stepAddress(1);
        });
      }

      // The manual card: what the user types *is* the person. The name field writes straight onto it,
      // the address field is split into the parts a lookup needs, and Search hands both to the AI
      // resolver. Nothing repaints while typing - the caret has to stay where it is.
      const nameInput = personCardContainer.querySelector(".manual-name-input");
      const streetInput = personCardContainer.querySelector(".manual-street-input");
      const cityInput = personCardContainer.querySelector(".manual-city-input");
      const searchBtn = personCardContainer.querySelector(".manual-search-btn");
      const addBtn = personCardContainer.querySelector(".manual-add-btn");

      if (nameInput) {
        nameInput.addEventListener("input", (e) => {
          e.stopPropagation();
          p.name = e.target.value;
          const copyName = personCardContainer.querySelector(".copy-name-action");
          if (copyName) copyName.setAttribute("data-copy", p.name);
        });
        nameInput.addEventListener("click", (e) => e.stopPropagation());
        nameInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const focus = personCardContainer.querySelector(".manual-search-btn");
            if (focus) focus.focus();
          }
        });
      }

      // The two address lines are one address: whatever is typed in either is put back together in the
      // order the card shows it and handed to the same splitter the single field used to feed, so the
      // parts the runs need (street, city, state, ZIP) are split out exactly as before.
      const syncManualAddress = () => {
        const combined = [
          streetInput ? streetInput.value.trim() : "",
          cityInput ? cityInput.value.trim() : ""
        ]
          .filter(Boolean)
          .join(", ");
        applyManualAddressInput(p, combined);
      };

      [streetInput, cityInput].forEach((input) => {
        if (!input) return;
        input.addEventListener("input", (e) => {
          e.stopPropagation();
          syncManualAddress();
        });
        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            startGoogleAddressAutomation(p, source);
          }
        });
      });

      if (searchBtn) {
        searchBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          startGoogleAddressAutomation(p, source);
        });
      }

      if (addBtn) {
        addBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          addManualPerson();
        });
      }

      // Bind vehicle lookup buttons
      const amicaBtn = personCardContainer.querySelector(".amica-action-btn");
      const dobBtn = personCardContainer.querySelector(".dob-action-btn");
      const emailBtn = personCardContainer.querySelector(".email-action-btn");
      const genderBtn = personCardContainer.querySelector(".gender-action-btn");
      const cancelBtn = personCardContainer.querySelector("#vehicle-cancel-btn");

      if (amicaBtn) {
        amicaBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          startVehicleAutomation("amica", p, source);
        });
      }

      if (genderBtn) {
        genderBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          startGoogleGenderAutomation(p, source);
        });
      }

      if (emailBtn) {
        emailBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          startGoogleEmailAutomation(p, source);
        });
      }

      if (dobBtn) {
        dobBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          startDobAutomation(p, source);
        });
      }

      if (cancelBtn) {
        cancelBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          cancelVehicleAutomation();
          cancelDobAutomation(source);
        });
      }

      // If this person already had vehicles discovered, render them
      if (p.vehicles && p.vehicles.length > 0) {
        renderDiscoveredVehicles(source, p.vehicles);
      }

      // If this person already had DOB discovered, render it prominently
      if (p.dob || p.dob1 || p.dob2 || p.dob3) {
        const firstDob = p.dob1 || p.dob;
        renderDiscoveredDob(source, {
          dob1: firstDob,
          dob1Source: p.dob1Source,
          dob1Note: p.dob1Note || (isJanuaryPlaceholder(firstDob) ? "month/day unknown" : ""),
          dob2: p.dob2,
          dob2Source: p.dob2Source,
          dob3: p.dob3,
          dob3Source: p.dob3Source,
          dob3Note: p.dob3Note
        });
      } else {
        const dobBox = recordElement(source, "card-dob-results");
        if (dobBox) dobBox.classList.add("hidden");
      }

      // If this person already had emails discovered, render them
      if (p.emails && p.emails.length > 0) {
        renderDiscoveredEmails(source, p.emails);
      } else {
        const emailBox = recordElement(source, "card-email-results");
        if (emailBox) emailBox.classList.add("hidden");
      }

      // The ZIP box travelled with the navigation row that was just rebuilt.
      bindZipFilterBox();
      syncZipFilterBox(personCardContainer, source);
    }

    // Keeps the caret in the ZIP box while the card is rebuilt on every keystroke. Only *this*
    // card's box counts: with a per-record filter the other record no longer repaints from a
    // keystroke here, but it can still repaint for its own reasons, and it must not then steal the
    // caret out of the box being typed in.
    function isZipInputFocused() {
      const focused = shadow && shadow.activeElement ? shadow.activeElement : null;
      if (!focused || !focused.classList || !focused.classList.contains("zip-filter-input")) {
        return false;
      }
      return personCardContainer.contains(focused);
    }

    function focusZipInput() {
      const input = personCardContainer.querySelector(".zip-filter-input");
      if (!input) return;
      try {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      } catch (e) {}
    }

    function bindZipFilterBox() {
      const input = personCardContainer.querySelector(".zip-filter-input");
      if (input) {
        input.addEventListener("input", (e) => {
          e.stopPropagation();
          setZipFilter(source, e.target.value);
        });
        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") e.preventDefault();
        });
      }

      const clearBtn = personCardContainer.querySelector(".zip-filter-clear");
      if (clearBtn) {
        clearBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          setZipFilter(source, "");
          focusZipInput();
        });
      }
    }

    // Adds an empty card the user fills in themselves - what the + on the card's header is for. It goes
    // in *front* of the people the lookup found - on the record's own list and on the card's - and the
    // card jumps to it, so what was just asked for is what is on screen: 1 / 7, not 7 / 7. The repaint,
    // the chevrons and the ZIP filter then treat it like any other person on that record.
    //
    // `allPersons` *is* `data.persons` for a record that named somebody (see renderResultCard), and
    // pushing to both listed the card twice - once as the last person and once behind it, which is why
    // the count ran one higher than the number of cards. Whoever holds the list is asked to hold it once.
    function addManualPerson() {
      const person = manualPerson();
      allPersons.unshift(person);
      if (allPersons !== data.persons) {
        if (Array.isArray(data.persons)) data.persons.unshift(person);
        else if (data.person) data.persons = [person, data.person];
        else data.persons = [person];
      }

      personsList = filterPersonsByZip(allPersons, activeZipFilter(zipFilterFor(source)));
      const found = personsList.indexOf(person);
      currentPersonIdx = found >= 0 ? found : 0;

      renderPersonSection();
      if (!personCardContainer.parentNode) cardWrapper.appendChild(personCardContainer);
    }

    // Rebuilds the card for the current filter - either the filtered person or, when nothing of
    // this record is in that ZIP, a note that says how many people are hidden.
    function renderPersonSection() {
      const wasTyping = isZipInputFocused();

      // A record that named nobody gets the manual card rather than an empty space: a name field, an
      // address field and the AI resolver under them. It is created once for the card and then lives on
      // the record's list, so the user's typing survives every repaint.
      if (allPersons.length === 0) {
        const person = manualPerson();
        allPersons.push(person);
        personsList = [person];
        currentPersonIdx = 0;
      }

      const person = personsList[currentPersonIdx];

      if (!person) {
        personCardContainer.innerHTML = zipFilterNoteHtml(index, source, allPersons.length);
        bindZipFilterBox();
        syncZipFilterBox(personCardContainer, source);
      } else {
        updatePersonCardView(currentPersonIdx);
      }

      if (wasTyping) focusZipInput();
    }

    // The card is only worth showing when there is a person behind it, when the note has to explain
    // that the ZIP filter hid everyone, or when the record named nobody - in which case the manual card
    // is what the user types into.
    function shouldShowPersonSection() {
      const first = personsList[0];
      if (first && (first.name || first.address)) return true;
      if (allPersons.length === 0) return true;
      return personsList.length === 0;
    }

    if (shouldShowPersonSection()) {
      renderPersonSection();
      cardWrapper.appendChild(personCardContainer);
    }

    // Repaints this record's card when its own ZIP filter changes. The other record's card is
    // registered separately and is not touched.
    zipFilterRepaints.push({
      source: source,
      element: cardWrapper,
      repaint: (keepPerson) => {
        personsList = filterPersonsByZip(allPersons, activeZipFilter(zipFilterFor(source)));

        // Where the card lands. A resolver answer (keepPerson) belongs to the card that asked, and the
        // person it is showing is still in the list, so it stays put. A new ZIP filter is about the
        // people the lookup found: the manual card sits in front of them and is never filtered itself,
        // so landing on it would hide the very people the filter was asked for.
        if (!keepPerson) {
          const firstFound = personsList.findIndex((entry) => entry && !entry.manual);
          currentPersonIdx = firstFound >= 0 ? firstFound : 0;
        }

        if (!shouldShowPersonSection()) return;
        renderPersonSection();
        if (!personCardContainer.parentNode) cardWrapper.appendChild(personCardContainer);
      }
    });

    // The DNC / Litigator / Blacklist card belongs to one record, and the Settings panel switches each
    // record's status on or off on its own.
    if (automationSetting("dnc." + recordKey(source))) {
      const dncBadgeClass = getBadgeClass(dnc);
      const litBadgeClass = getBadgeClass(litigator);
      const blackBadgeClass = getBadgeClass(blacklist);

      const complianceCard = document.createElement("div");
      complianceCard.innerHTML = `
      <div class="card compliance-card">
        <div class="record-header-tag">
          <span>Compliance · ${recordLabel(source)}</span>
        </div>
        <div class="compliance-grid">
          <div class="compliance-cell">
            <span class="cell-label">DNC status</span>
            <span class="badge ${dncBadgeClass}">${dnc}</span>
          </div>
          <div class="compliance-cell">
            <span class="cell-label">Litigator</span>
            <span class="badge ${litBadgeClass}">${litigator}</span>
          </div>
          <div class="compliance-cell">
            <span class="cell-label">Blacklist</span>
            <span class="badge ${blackBadgeClass}">${blacklist}</span>
          </div>
        </div>
      </div>
    `;

      cardWrapper.appendChild(complianceCard);
    }

    recordsList.appendChild(cardWrapper);
  }

  function getBadgeClass(val) {
    const lower = (val || "").toLowerCase().trim();
    if (
      !lower ||
      lower === "-" ||
      lower === "--" ||
      lower === "unknown" ||
      lower === "not available" ||
      lower.includes("loading")
    ) {
      return "badge-neutral";
    }
    if (
      lower === "clean" ||
      lower.includes("clean") ||
      lower.includes("not listed") ||
      lower.includes("no record") ||
      lower.includes("pass") ||
      lower === "no"
    ) {
      return "badge-clean";
    }
    return "badge-flagged";
  }

  function updateRawSummary() {
    let summary = "";
    // One block per record card, so the copied text keeps Record 1 and Record 2 apart.
    activeResults.forEach((r, idx) => {
      const { source, data } = r;
      if (activeResults.length > 1) {
        summary += `--- ${recordLabel(source)} ---\n`;
      }
      const persons =
        data.persons && data.persons.length > 0
          ? data.persons
          : data.person
            ? [data.person]
            : [];
      persons.forEach((p, pIdx) => {
        if (persons.length > 1) {
          summary += `[Person ${pIdx + 1}]\n`;
        }
        if (p.name) summary += `Name: ${p.name}\n`;
        if (p.age) summary += `Age: ${p.age}\n`;
        if (p.dob) summary += `DOB: ${p.dob}\n`;
        if (p.emails && p.emails.length > 0) {
          summary += `Emails (${p.emails.length}): ${p.emails.join(", ")}\n`;
        }
        if (p.address?.full) summary += `Address: ${p.address.full}\n`;
        if (p.vehicles && p.vehicles.length > 0) {
          summary += `Vehicles (${p.vehicles.length}):\n${p.vehicles.map((v) => `  • ${v}`).join("\n")}\n`;
        }
        summary += "\n";
      });
      summary += `DNC: ${data.dnc || "Clean"}\n`;
      summary += `Litigator: ${data.litigator || "Clean"}\n`;
      summary += `Blacklist: ${data.blacklist || "Clean"}\n\n`;
    });

    if (rawOutput) rawOutput.textContent = summary.trim();
  }

  // Copy All button
  if (copyAllBtn) {
    copyAllBtn.addEventListener("click", () => {
      const text = rawOutput ? rawOutput.textContent : "";
      if (text) {
        copyText(text, null, copyAllLabel);
      }
    });
  }

  // Respond to popup or standalone window requests for the page phone
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "GET_PAGE_PHONE") {
      const phone = scanForDialerPhone();
      sendResponse({ phone: phone });
      return true;
    }
  });

  function copyText(text, btnElement, labelElement) {
    navigator.clipboard.writeText(text).then(() => {
      if (labelElement) {
        const orig = labelElement.textContent;
        labelElement.textContent = "Copied!";
        setTimeout(() => {
          labelElement.textContent = orig;
        }, 1800);
      } else if (btnElement) {
        const orig = btnElement.textContent;
        btnElement.textContent = "✓";
        setTimeout(() => {
          btnElement.textContent = orig;
        }, 1500);
      }
    });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function showStatus(text) {
    statusText.textContent = text;
    statusContainer.classList.remove("hidden");
  }

  function hideStatus() {
    statusContainer.classList.add("hidden");
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorContainer.classList.remove("hidden");
  }

  function hideError() {
    errorContainer.classList.add("hidden");
  }

  function hideResults() {
    resultsContainer.classList.add("hidden");
  }

  function setLoading(loading) {
    // Keep phone input and search button enabled at all times so user can type or search a new number
    phoneInput.disabled = false;
    searchBtn.disabled = false;
    if (loading) {
      searchBtn.textContent = "Searching...";
      searchBtn.style.opacity = "0.85";
      if (currentLookupMode === "auto" && autoSpinner) {
        autoSpinner.classList.remove("hidden");
      }
    } else {
      searchBtn.textContent = "Search";
      searchBtn.style.opacity = "1";
      if (autoSpinner) {
        autoSpinner.classList.add("hidden");
      }
      if (currentLookupMode === "auto" && lastAutoLookedUpPhone && autoFeedbackText) {
        autoFeedbackText.textContent = `Auto-detected: ${lastAutoLookedUpPhone} · Ready`;
      }
    }
  }

  // ==========================================
  // VEHICLE DISCOVERY AUTOMATION (Amica / Mercury)
  // ==========================================
  let activeVehicleSession = null;

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
      if (!a) return "";
      if (typeof a === "string") return a;
      return a.street || a.full || "";
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

    return { address: chosen, skippedPoBox: false, originalPoBox: "" };
  }

  function formatDobToSlash(str) {
    if (!str) return "";
    const s = String(str).trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
      const parts = s.split("/");
      return `${parts[0].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[2]}`;
    }
    const months = {
      january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
      july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
      jan: "01", feb: "02", mar: "03", apr: "04", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
    };
    const m = s.match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(19\d\d|20\d\d)/i);
    if (m) {
      const mo = months[m[1].toLowerCase()] || "06";
      const da = m[2].padStart(2, "0");
      return `${mo}/${da}/${m[3]}`;
    }
    const m2 = s.match(/([A-Za-z]+)\s+(19\d\d|20\d\d)/i);
    if (m2) {
      const mo = months[m2[1].toLowerCase()] || "06";
      return `${mo}/15/${m2[2]}`;
    }
    const m3 = s.match(/\b(19\d\d|20\d\d)\b/);
    if (m3) {
      return `06/15/${m3[1]}`;
    }
    return "";
  }

  function extractProfileForVehicleLookup(person, phoneVal) {
    const fullName = (person?.name || "").trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    let first = "Customer", middle = "", last = "User", suffix = "";

    if (nameParts.length === 1) {
      first = nameParts[0];
      last = nameParts[0];
    } else if (nameParts.length === 2) {
      first = nameParts[0];
      last = nameParts[1];
    } else if (nameParts.length >= 3) {
      first = nameParts[0];
      const lastPart = nameParts[nameParts.length - 1];
      if (["jr", "sr", "ii", "iii", "iv", "v"].includes(lastPart.toLowerCase().replace(/\./g, ""))) {
        suffix = lastPart;
        last = nameParts[nameParts.length - 2];
        middle = nameParts.slice(1, nameParts.length - 2).join(" ");
      } else {
        middle = nameParts.slice(1, nameParts.length - 1).join(" ");
        last = lastPart;
      }
    }

    const resolved = selectPhysicalAddressForVehicle(person);
    const chosenAddr = resolved.address || {};
    let street = (chosenAddr?.street || (typeof chosenAddr === "string" ? chosenAddr : "")).trim();
    let city = (chosenAddr?.city || "").trim();
    let state = (chosenAddr?.state || "").trim();
    let zip = (chosenAddr?.zip || "").trim();

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

    const rawPhone = (phoneVal || phoneInput?.value || "").replace(/\D/g, "") || (person?.phone || person?.phoneNumber || "").replace(/\D/g, "") || "8172944402";

    let dob = "08/15/1975";
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
      : (person?.email || "customer782@gmail.com");

    return {
      fullName,
      name: { first, middle, last, suffix },
      address: { street, unit: chosenAddr?.unit || "", city, state, zip },
      allAddresses: person?.allAddresses || [],
      skippedPoBox: resolved.skippedPoBox,
      originalPoBox: resolved.originalPoBox,
      phone: rawPhone,
      dob,
      email,
      gender: "M"
    };
  }

  function startVehicleAutomation(provider, person, recordSource) {
    // Remember which card asked, so the progress and results are drawn on that card and not on
    // whichever record happens to be first in the shadow root.
    lookupRecordByProvider[String(provider).toLowerCase()] = recordSource || "";

    const profile = extractProfileForVehicleLookup(person, phoneInput ? phoneInput.value : "");
    activeVehicleSession = {
      provider,
      person,
      profile,
      vehicles: [],
      record: recordSource || ""
    };

    const providerTitle = rideLabel(provider);
    const initMsg = profile.skippedPoBox
      ? `Initializing ${providerTitle} (using ${profile.address.street})...`
      : `Initializing ${providerTitle} vehicle lookup...`;

    showVehicleProgress(provider, 15, initMsg);

    chrome.runtime.sendMessage({
      action: "START_VEHICLE_LOOKUP",
      provider,
      profile
    }, (res) => {
      if (res && !res.success) {
        showVehicleProgress(provider, 100, `Error: ${res.error || "Failed to start"}`);
      }
    });
  }

  function cancelVehicleAutomation() {
    const provider = activeVehicleSession ? activeVehicleSession.provider : "";
    chrome.runtime.sendMessage({ action: "CANCEL_VEHICLE_LOOKUP" }).catch(() => {});
    hideVehicleProgress(provider);
    activeVehicleSession = null;
  }

  // `record` names the card a lookup has to be drawn on. It is only needed when that is not the
  // card the provider last started from - every DOB message says which record its run belongs to.
  function showVehicleProgress(provider, pct, message, isWarning = false, record) {
    const owner = record === undefined ? lookupRecord(provider) : record;
    const box = recordElement(owner, "card-vehicle-progress");
    const tag = recordElement(owner, "vehicle-provider-tag");
    const status = recordElement(owner, "vehicle-progress-status");
    const fill = recordElement(owner, "vehicle-progress-fill");
    const cancelBtn = recordElement(owner, "vehicle-cancel-btn");

    if (!box) return;
    box.classList.remove("hidden");
    if (tag) tag.textContent = provider === "DOB" ? "DOB" : provider === "EMAIL" ? "EMAIL" : provider === "GENDER" ? "GENDER" : provider === "ADDRESS" ? "AI" : rideLabel(provider);
    if (status) status.textContent = message || "Processing...";
    if (fill) {
      fill.style.width = `${Math.min(100, Math.max(8, pct))}%`;
      if (isWarning) {
        fill.style.background = "linear-gradient(90deg, #f59e0b, #d97706)";
      } else {
        fill.style.background = "linear-gradient(90deg, #10b981, #059669)";
      }
    }
    if (isWarning && cancelBtn) {
      cancelBtn.classList.add("hidden");
    } else if (cancelBtn) {
      cancelBtn.classList.remove("hidden");
    }
  }

  function hideVehicleProgress(provider, record) {
    const owner = record === undefined ? lookupRecord(provider) : record;
    const box = recordElement(owner, "card-vehicle-progress");
    if (box) box.classList.add("hidden");
  }

  function renderEmptyVehicleNotice(provider, message) {
    const record = lookupRecord(provider);
    const box = recordElement(record, "card-vehicle-results");
    const countLabel = recordElement(record, "vehicle-results-count-label");
    const container = recordElement(record, "vehicle-badges-container");
    const copyAllVehiclesBtn = recordElement(record, "copy-all-vehicles-btn");

    if (!box || !container) return;
    const providerName = rideLabel(provider);
    const text = message || `No vehicle found on ${providerName}`;

    if (countLabel) countLabel.textContent = `Vehicle Lookup (${providerName})`;
    if (copyAllVehiclesBtn) copyAllVehiclesBtn.classList.add("hidden");

    container.innerHTML = `
      <div class="vehicle-empty-notice">
        <span>⚠️</span>
        <span>${escapeHtml(text)}</span>
      </div>
    `;

    box.classList.remove("hidden");
  }

  function renderDiscoveredVehicles(recordSource, vehicles) {
    const box = recordElement(recordSource, "card-vehicle-results");
    const countLabel = recordElement(recordSource, "vehicle-results-count-label");
    const container = recordElement(recordSource, "vehicle-badges-container");
    const copyAllVehiclesBtn = recordElement(recordSource, "copy-all-vehicles-btn");

    if (!box || !container) return;

    if (!vehicles || vehicles.length === 0) {
      box.classList.add("hidden");
      return;
    }

    if (copyAllVehiclesBtn) copyAllVehiclesBtn.classList.remove("hidden");
    if (countLabel) countLabel.textContent = `Discovered Vehicles (${vehicles.length})`;

    container.innerHTML = vehicles
      .map(
        (v) => `
      <div class="vehicle-badge-item">
        <span class="vehicle-badge-name">
          <span>${escapeHtml(v)}</span>
        </span>
        <button class="mini-btn copy-single-vehicle" data-copy="${escapeHtml(v)}" type="button">Copy</button>
      </div>
    `
      )
      .join("");

    container.querySelectorAll(".copy-single-vehicle").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const text = e.currentTarget.getAttribute("data-copy");
        if (text) copyText(text, e.currentTarget);
      });
    });

    if (copyAllVehiclesBtn) {
      copyAllVehiclesBtn.onclick = () => {
        copyText(vehicles.join("\n"), copyAllVehiclesBtn);
      };
    }

    box.classList.remove("hidden");
  }

  // "January 1954" / "January 1, 1954" is the placeholder Unmask shows when the real
  // month and day are unknown (50/50), so the badge says so explicitly.
  function isJanuaryPlaceholder(str) {
    const s = String(str || "").trim();
    return /^jan(uary)?\.?\s+(?:1(?:st)?,?\s+)?\d{4}$/i.test(s);
  }

  // The three sources a DOB row can come from. Google AI Mode answers beside the Unmask run, so its
  // date is shown next to theirs rather than replacing it.
  function dobSourceLabel(source) {
    if (source === "unmask.com") return "Unmask";
    if (source === "thatsthem.com") return "ThatSthem";
    if (source === "google.ai") return "AI";
    return source || "";
  }

  // DOB 1 (first source, possibly a placeholder / year-only value), DOB 2 (the confirmed date) and
  // DOB 3 (Google AI Mode) are shown side by side so all of them can be compared and copied.
  function renderDiscoveredDob(recordSource, info) {
    const data = info || {};
    const box = recordElement(recordSource, "card-dob-results");
    const container = recordElement(recordSource, "dob-badges-container");

    if (!box || !container) return;

    const entries = [];
    if (data.dob1) entries.push({ source: data.dob1Source || "", note: data.dob1Note || "", value: data.dob1 });
    if (data.dob2) entries.push({ source: data.dob2Source || "", note: data.dob2Note || "", value: data.dob2 });
    if (data.dob3) entries.push({ source: data.dob3Source || "google.ai", note: data.dob3Note || "", value: data.dob3 });

    if (entries.length === 0) {
      box.classList.add("hidden");
      return;
    }

    container.innerHTML = entries
      .map(
        (entry) => `
      <div class="dob-badge-item${entry.note ? " dob-badge-item--placeholder" : ""}">
        <span class="dob-badge-name">
          ${entry.source ? `<span class="dob-badge-source">${escapeHtml(dobSourceLabel(entry.source))}</span>` : ""}
          <span class="dob-val-text">${escapeHtml(entry.value)}</span>
          ${entry.note ? `<span class="dob-badge-note">${escapeHtml(entry.note)}</span>` : ""}
        </span>
        <button class="mini-btn copy-single-dob" data-copy="${escapeHtml(entry.value)}" type="button">Copy</button>
      </div>`
      )
      .join("");

    container.querySelectorAll(".copy-single-dob").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const value = e.currentTarget.getAttribute("data-copy") || "";
        copyText(value, e.currentTarget);
      });
    });

    box.classList.remove("hidden");
  }

  // ---------------------------------------------------------------- the gender chip on a person card
  //
  // The icon beside the name is both the button and the answer: a question mark made of both symbols
  // until it has been asked, then the symbol the AI named - coloured, with the wording in its tooltip
  // (and, when the answer only came from the way the first name is usually given, that is said too, so
  // a guess about the name is never passed off as a statement about the person).

  function genderIconSvg(gender) {
    if (gender === "Female") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="5"/><path d="M12 14v7"/><path d="M9 18h6"/></svg>`;
    }
    if (gender === "Male") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="14" r="5"/><path d="M13.6 10.4 20 4"/><path d="M14.5 4H20v5.5"/></svg>`;
    }
    // Not asked yet: the two symbols together, which is what the button is about.
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="13" r="4.5"/><path d="M10 17.5V22"/><path d="M7.5 19.8h5"/><path d="M13.2 9.8 19 4"/><path d="M14 4h5v5"/></svg>`;
  }

  function genderTitleText(gender, note) {
    if (gender !== "Male" && gender !== "Female") return "Check gender with AI";
    return `${gender} — from the AI answer${note ? ` (${note})` : ""}`;
  }

  function genderBadgeHtml(gender, note) {
    const value = gender === "Male" || gender === "Female" ? gender : "";
    const state = value === "Female" ? " is-female" : value === "Male" ? " is-male" : "";
    const title = genderTitleText(value, note);
    return `<button id="gender-badge-btn" class="gender-btn gender-action-btn${state}" type="button" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${genderIconSvg(value)}</button>`;
  }

  // Repaints the chip in place, so an answer that arrives for a card that is already on screen shows
  // up without rebuilding the slide (and without disturbing the progress line under it).
  function renderGenderBadge(recordSource, gender, note) {
    const btn = recordElement(recordSource, "gender-badge-btn");
    if (!btn) return;

    const value = gender === "Male" || gender === "Female" ? gender : "";
    btn.classList.toggle("is-female", value === "Female");
    btn.classList.toggle("is-male", value === "Male");
    btn.classList.remove("running");

    const title = genderTitleText(value, note);
    btn.setAttribute("title", title);
    btn.setAttribute("aria-label", title);
    btn.innerHTML = genderIconSvg(value);
  }

  // The Google AI Mode gender run, asked for by the icon beside a person's name. One question, one
  // answer, and the chip itself carries what came back - so there is nothing else to trigger here and
  // no month (or address) to carry into the query.
  function startGoogleGenderAutomation(person, recordSource) {
    const record = recordSource || "";
    const session = { person, record };
    genderSessionsByRecord[record] = session;
    activeGenderSession = session;
    lookupRecordByProvider.gender = record;

    const chip = recordElement(record, "gender-badge-btn");
    if (chip) chip.classList.add("running");

    showVehicleProgress(
      "GENDER",
      15,
      `Asking AI if ${person.name || "this person"} is male or female...`,
      false,
      record
    );

    chrome.runtime.sendMessage({
      action: "START_GOOGLE_GENDER_LOOKUP",
      person,
      record
    }, (res) => {
      if (res && !res.success) {
        if (chip) chip.classList.remove("running");
        showVehicleProgress("GENDER", 100, `Error: ${res.error || "Failed to start"}`, true, record);
        setTimeout(() => hideVehicleProgress("GENDER", record), 4000);
      }
    });
  }

  // The record a gender message belongs to - the same rule the DOB and email messages follow.
  function genderMessageRecord(msg) {
    const tagged = msg && msg.record ? String(msg.record) : "";
    return tagged || lookupRecord("gender");
  }

  // The manual card's Search button. It asks the AI about the name and the address *as typed* (the
  // background builds both queries from them, and the second query is the fallback), and whatever comes
  // back fills the card in - which is what makes Rides, DOB and Email work on a person the record never
  // named.
  function startGoogleAddressAutomation(person, recordSource) {
    const record = recordSource || "";
    lookupRecordByProvider.address = record;

    const name = String(person.name || "").trim();
    const place = String(person.addressInput || "").trim();

    if (!name || !place) {
      showVehicleProgress("ADDRESS", 100, "Type a name and something of the address first.", true, record);
      setTimeout(() => hideVehicleProgress("ADDRESS", record), 4000);
      return;
    }

    addressSessionsByRecord[record] = { person, record };
    activeAddressSession = addressSessionsByRecord[record];

    const card = recordCard(record);
    const searchBtn = card ? card.querySelector(".manual-search-btn") : null;
    if (searchBtn) searchBtn.classList.add("running");

    showVehicleProgress("ADDRESS", 15, `Asking AI to complete ${name} at ${place}...`, false, record);

    chrome.runtime.sendMessage({
      action: "START_GOOGLE_ADDRESS_LOOKUP",
      person,
      record
    }, (res) => {
      if (res && !res.success) {
        if (searchBtn) searchBtn.classList.remove("running");
        showVehicleProgress("ADDRESS", 100, `Error: ${res.error || "Failed to start"}`, true, record);
        setTimeout(() => hideVehicleProgress("ADDRESS", record), 4000);
      }
    });
  }

  // The record an address message belongs to - the same rule the other runs' messages follow.
  function addressMessageRecord(msg) {
    const tagged = msg && msg.record ? String(msg.record) : "";
    return tagged || lookupRecord("address");
  }

  // Puts what the AI resolved onto the person. The name and the address the user typed are *replaced*
  // by it, which is the point of the run: every later lookup reads this person, so DOB, Rides and Email
  // carry on from a full name and a complete address instead of from "Jeff Green" and "44718".
  function applyAddressResult(msg, person) {
    if (!person) return;

    const name = String(msg.name || "").trim();
    if (name) person.name = name;

    const street = String(msg.street || "").trim();
    const city = String(msg.city || "").trim();
    const state = String(msg.state || "").trim();
    const zip = String(msg.zip || "").trim();
    const cityState = [city, state].filter(Boolean).join(", ");
    const full =
      String(msg.addressFull || "").trim() ||
      [street, cityState, zip].filter(Boolean).join(", ").replace(/, ([A-Z]{2}), /, ", $1 ");

    if (street || city || state || zip || full) {
      person.address = { street: street, city: city, state: state, zip: zip, full: full };
      person.addressInput = full || street || zip || city;
      person.allAddresses = full || street ? [person.address] : [];
      person.addressIndex = 0;
    }

    // The birth date the same answer named, when it named one - "his birth year is 1958 or early 1959".
    // It goes on the person as the AI row (dob3), which is the slot the DOB box draws and the row the
    // runs read a known DOB from, so the year the answer gave is on the card instead of being dropped,
    // and Email's question carries it rather than asking blind.
    const dob = String(msg.dob || "").trim();
    if (dob) {
      person.dob3 = dob;
      person.dob3Source = String(msg.source || "google.ai");
      person.dob3Note = String(msg.dobNote || "");
      if (!person.dob) person.dob = dob;
    }

    const email = String(msg.email || "").trim().toLowerCase();
    if (email) {
      const merged = Array.isArray(person.emails) ? person.emails.slice() : [];
      if (merged.indexOf(email) < 0) merged.push(email);
      person.emails = merged;
    }
  }

  function renderDiscoveredEmails(recordSource, emails) {
    const box = recordElement(recordSource, "card-email-results");
    const container = recordElement(recordSource, "email-badges-container");

    if (!box || !container) return;

    if (!emails || emails.length === 0) {
      box.classList.add("hidden");
      return;
    }

    container.innerHTML = emails
      .map(
        (em) => `
      <div class="email-badge-item">
        <span class="email-badge-name" title="${escapeHtml(em)}">
          <span class="email-val-text">${escapeHtml(em)}</span>
        </span>
        <button class="mini-btn copy-single-email" data-copy="${escapeHtml(em)}" type="button">Copy</button>
      </div>
    `
      )
      .join("");

    container.querySelectorAll(".copy-single-email").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const text = e.currentTarget.getAttribute("data-copy");
        if (text) copyText(text, e.currentTarget);
      });
    });

    box.classList.remove("hidden");
  }

  // A DOB run belongs to the record card that asked for it, and every line the run produces has to
  // come back to that card. The record travels with the run (it is sent with START_DOB_LOOKUP and
  // echoed on every message the run produces), so a run that was already replaced by a press on
  // the other card can no longer paint its result there or write it onto the other card's person.
  //
  // `activeDobSession` stays as the most recent run: it is the fallback for a message that carries
  // no record at all (an older worker still answering, for instance).
  const dobSessionsByRecord = Object.create(null); // record source -> { person, record }
  let activeDobSession = null;
  // The Google AI Mode email run keeps the same record of its own: which card's person asked for it,
  // so the addresses it reports are written onto that person and survive a re-render.
  const emailSessionsByRecord = Object.create(null); // record source -> { person, record }
  let activeEmailSession = null;
  // ...and the gender run's: which card's person the icon belongs to, so the answer is written onto
  // that person and survives a re-render of the slide.
  const genderSessionsByRecord = Object.create(null); // record source -> { person, record }
  let activeGenderSession = null;
  // ...and the manual card's resolver: which card's typed-in person the answer belongs to.
  const addressSessionsByRecord = Object.create(null); // record source -> { person, record }
  let activeAddressSession = null;

  // The session of the run that started on this record, or the run in flight when the record is
  // unknown.
  function dobSessionFor(recordSource) {
    const key = String(recordSource == null ? "" : recordSource);
    return dobSessionsByRecord[key] || activeDobSession || null;
  }

  // The record a DOB message belongs to: what the run itself was started for, and only when that
  // is missing the record of the run in flight.
  function dobMessageRecord(msg) {
    const tagged = msg && msg.record ? String(msg.record) : "";
    return tagged || lookupRecord("dob");
  }

  // The record an email message belongs to - the same rule the DOB messages follow.
  function emailMessageRecord(msg) {
    const tagged = msg && msg.record ? String(msg.record) : "";
    return tagged || lookupRecord("email");
  }

  function startDobAutomation(person, recordSource) {
    const record = recordSource || "";
    // Only one DOB run exists at a time, so a run the other card started cannot be finished any
    // more: its progress box is closed instead of being left spinning forever.
    const supersededRecord = lookupRecord("dob");
    if (supersededRecord && supersededRecord !== record) {
      hideVehicleProgress("DOB", supersededRecord);
    }

    lookupRecordByProvider.dob = record;
    activeDobSession = { person, record };
    dobSessionsByRecord[record] = activeDobSession;
    // The first line names the platform the run will actually ask: Unmask unless Settings left only
    // ThatSthem (or only AI) switched on.
    const dobLabel = automationSetting("dob.unmask")
      ? "Unmask"
      : (automationSetting("dob.thatsthem") ? "ThatSthem" : "AI");
    showVehicleProgress("DOB", 15, `Searching ${dobLabel} for ${person.name || "person"}...`, false, record);

    const phone = (phoneInput?.value || "").replace(/\D/g, "") || person?.phone || person?.phoneNumber || "";

    chrome.runtime.sendMessage({
      action: "START_DOB_LOOKUP",
      person,
      phone,
      record
    }, (res) => {
      if (res && !res.success) {
        showVehicleProgress("DOB", 100, `Error: ${res.error || "Failed to start"}`, true, record);
      }
    });
  }

  // The Google AI Mode email run, asked for by the Email button on a card.
  //
  // The month the card already holds - the Google row first, then Unmask's, then ThatSthem's - is
  // sent with it, because that is what turns the query's "born in 1950" into "born in February 1950".
  // The run draws in the same progress box the DOB run uses (tagged EMAIL) and reports its own empty
  // answer, so the card is never left spinning when Google names no address.
  function startGoogleEmailAutomation(person, recordSource) {
    const record = recordSource || "";
    const session = { person, record };
    emailSessionsByRecord[record] = session;
    activeEmailSession = session;
    lookupRecordByProvider.email = record;

    // The DOB the email question is disambiguated with: the most specific date the card holds, so a date
    // that names a month beats a bare year whichever row it came from. The AI row (dob3) can be a year
    // the address resolver read out ("1958 or early 1959") while Unmask holds the exact date, and the
    // question is better off with the month.
    const dobRows = [person.dob3, person.dob2, person.dob1, person.dob].filter(Boolean);
    const monthNamed = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
    const knownDob = dobRows.find((value) => monthNamed.test(String(value))) || dobRows[0] || "";

    showVehicleProgress(
      "EMAIL",
      10,
      `Asking AI for ${person.name || "this person"}'s email address...`,
      false,
      record
    );

    chrome.runtime.sendMessage({
      action: "START_GOOGLE_EMAIL_LOOKUP",
      person,
      record,
      dob: knownDob
    }, (res) => {
      if (res && !res.success) {
        showVehicleProgress("EMAIL", 100, `Error: ${res.error || "Failed to start"}`, true, record);
        setTimeout(() => hideVehicleProgress("EMAIL", record), 4000);
      }
    });
  }

  // Cancels the DOB run and closes the progress of every card that could be showing it: the one
  // the cancel button lives in, and the one that started the run in flight.
  function cancelDobAutomation(recordSource) {
    const runRecord = lookupRecord("dob");
    const record = recordSource === undefined ? runRecord : (recordSource || "");
    chrome.runtime.sendMessage({ action: "CANCEL_DOB_LOOKUP" }).catch(() => {});

    [record, runRecord].forEach((key) => {
      if (key) hideVehicleProgress("DOB", key);
      if (key && dobSessionsByRecord[key]) delete dobSessionsByRecord[key];
      // The one CANCEL_DOB_LOOKUP stops the Google email run as well (it draws in this same box), so
      // its progress is closed here too rather than left turning. So is the gender run.
      if (key) hideVehicleProgress("EMAIL", key);
      if (key) hideVehicleProgress("GENDER", key);
      if (key && emailSessionsByRecord[key]) delete emailSessionsByRecord[key];
    });

    if (activeDobSession && activeDobSession.record === record) activeDobSession = null;
    if (!runRecord || runRecord === record) lookupRecordByProvider.dob = "";
    if (activeEmailSession && activeEmailSession.record === record) activeEmailSession = null;
  }

  // Listen for vehicle & DOB discovery messages from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "VEHICLE_LOOKUP_PROGRESS") {
      const pct = Math.round((msg.step / msg.totalSteps) * 100);
      showVehicleProgress(msg.provider, pct, msg.message);
    } else if (msg.action === "VEHICLE_LOOKUP_EMPTY") {
      const providerName = rideLabel(msg.provider);
      const emptyMsg = msg.message || `No vehicle found on ${providerName}`;
      showVehicleProgress(msg.provider, 100, emptyMsg, true);
      renderEmptyVehicleNotice(msg.provider, emptyMsg);
      setTimeout(() => {
        hideVehicleProgress(msg.provider);
      }, 4000);
    } else if (msg.action === "VEHICLE_LOOKUP_SUCCESS") {
      if (!msg.vehicles || msg.vehicles.length === 0) {
        const providerName = rideLabel(msg.provider);
        const emptyMsg = msg.message || `No vehicle found on ${providerName}`;
        showVehicleProgress(msg.provider, 100, emptyMsg, true);
        renderEmptyVehicleNotice(msg.provider, emptyMsg);
        setTimeout(() => {
          hideVehicleProgress(msg.provider);
        }, 4000);
        return;
      }
      showVehicleProgress(msg.provider, 100, `Vehicles discovered (${msg.vehicles.length})!`);
      if (activeVehicleSession && activeVehicleSession.person) {
        activeVehicleSession.person.vehicles = msg.vehicles;
      }
      renderDiscoveredVehicles(lookupRecord(msg.provider), msg.vehicles);
      copyText(msg.vehicles.join("\n"));
      setTimeout(() => {
        hideVehicleProgress(msg.provider);
      }, 2500);
      updateRawSummary();
    } else if (msg.action === "VEHICLE_LOOKUP_ERROR") {
      showVehicleProgress(msg.provider, 100, msg.error || "No vehicles discovered", true);
      renderEmptyVehicleNotice(msg.provider, msg.error || "No vehicles discovered");
      setTimeout(() => {
        hideVehicleProgress(msg.provider);
      }, 4000);
    }

    // DOB Messages from Unmask. Every one of them names the record its run was started for, so a
    // late line from a run the other card replaced is drawn on its own card - and its DOB is
    // stored on that card's person - instead of on whichever card was pressed last.
    if (msg.action === "DOB_LOOKUP_PROGRESS") {
      const pct = Math.round((msg.step / msg.totalSteps) * 100);
      showVehicleProgress("DOB", pct, msg.message, false, dobMessageRecord(msg));
    } else if (msg.action === "DOB_LOOKUP_SUCCESS") {
      const record = dobMessageRecord(msg);
      const session = dobSessionFor(record);
      const firstDob = msg.dob1 || (msg.dob2 ? "" : msg.dob);
      const secondDob = msg.dob2 || "";
      const bestDob = secondDob || firstDob || msg.dob;
      const dob1Source = msg.dob1Source || msg.source || "unmask.com";
      const dob1Note = msg.dob1Note || (msg.yearOnly ? "year only" : msg.placeholder ? "month/day unknown" : "");
      const dob2Source = msg.dob2Source || (secondDob ? msg.source || "" : "");

      if (session && session.person) {
        if (firstDob) {
          session.person.dob1 = firstDob;
          session.person.dob1Source = dob1Source;
          session.person.dob1Note = dob1Note;
        }
        if (secondDob) {
          session.person.dob2 = secondDob;
          session.person.dob2Source = dob2Source;
        }
        session.person.dob = bestDob;
        if (msg.emails && msg.emails.length > 0) {
          session.person.emails = msg.emails;
        }
      }

      // The AI row lives on the person as dob3, and it has to be carried into every re-render: this
      // handler draws the Unmask / ThatSthem dates, so without it the AI answer that arrived first
      // was wiped off the card the moment this one landed.
      const aiDob = session && session.person ? session.person.dob3 || "" : "";
      const aiSource = session && session.person ? session.person.dob3Source || "" : "";
      const aiNote = session && session.person ? session.person.dob3Note || "" : "";

      renderDiscoveredDob(record, {
        dob1: firstDob,
        dob1Source,
        dob1Note,
        dob2: secondDob,
        dob2Source,
        dob3: aiDob,
        dob3Source: aiSource,
        dob3Note: aiNote
      });
      if (msg.emails && msg.emails.length > 0) {
        renderDiscoveredEmails(record, msg.emails);
      }
      copyText(bestDob);

      if (msg.searchContinues) {
        // Only a placeholder / year-only value so far - DOB 1 is already on screen and
        // the run keeps looking for a fuller date.
        showVehicleProgress("DOB", 60, `${dob1Source === "thatsthem.com" ? "ThatSthem" : "Unmask"} ${firstDob} - checking for a fuller date...`, false, record);
      } else {
        showVehicleProgress(
          "DOB",
          100,
          secondDob
            ? `DOB 1 (${dob1Source === "thatsthem.com" ? "ThatSthem" : "Unmask"}): ${firstDob}  •  DOB 2 (ThatSthem): ${secondDob}`
            : `DOB discovered: ${msg.dob}!`,
          false,
          record
        );
        setTimeout(() => {
          hideVehicleProgress("DOB", record);
        }, 3000);
      }
      updateRawSummary();
    } else if (msg.action === "GOOGLE_DOB_RESULT") {
      // Google AI Mode answers beside the Unmask / ThatSthem run, so its date is drawn as a third
      // row on the card whose person was asked about - and written onto that card's person, so
      // navigating away and back keeps it. The clipboard is deliberately left alone: Unmask already
      // puts the date it found there, and this row has its own Copy button.
      const record = dobMessageRecord(msg);
      const session = dobSessionFor(record);
      const person = session && session.person ? session.person : null;

      if (person) {
        person.dob3 = msg.dob;
        person.dob3Source = msg.source || "google.ai";
        person.dob3Note = msg.note || "";
      }

      const firstDob = person ? person.dob1 || person.dob : "";
      const secondDob = person && person.dob2 ? person.dob2 : "";

      renderDiscoveredDob(record, {
        dob1: firstDob,
        dob1Source: person ? person.dob1Source : "",
        dob1Note: person ? person.dob1Note || (isJanuaryPlaceholder(firstDob) ? "month/day unknown" : "") : "",
        dob2: secondDob,
        dob2Source: person ? person.dob2Source : "",
        dob3: msg.dob,
        dob3Source: msg.source || "google.ai",
        dob3Note: msg.note || ""
      });

      updateRawSummary();
    } else if (msg.action === "GOOGLE_EMAIL_PROGRESS") {
      const pct = Math.round((msg.step / msg.totalSteps) * 100);
      showVehicleProgress("EMAIL", pct, msg.message, false, emailMessageRecord(msg));
    } else if (msg.action === "GOOGLE_EMAIL_RESULT") {
      // The Google email run reports the one address it found for this record's person. It is merged
      // into the addresses already on the card (Unmask's, ThatSthem's) rather than replacing them, and
      // written onto the person so navigating away and back keeps it.
      const record = emailMessageRecord(msg);
      const session = emailSessionsByRecord[record] || activeEmailSession || null;
      const person = session && session.person ? session.person : null;
      const found = Array.isArray(msg.emails) ? msg.emails.filter(Boolean) : [];

      if (person && found.length > 0) {
        const merged = Array.isArray(person.emails) ? person.emails.slice() : [];
        found.forEach((email) => {
          if (merged.indexOf(email) < 0) merged.push(email);
        });
        person.emails = merged;
      }

      const all = person && Array.isArray(person.emails) && person.emails.length > 0 ? person.emails : found;
      if (all.length > 0) renderDiscoveredEmails(record, all);

      showVehicleProgress(
        "EMAIL",
        100,
        found.length > 0 ? `Email discovered: ${found[0]}` : "No public email address was named for this address.",
        found.length === 0,
        record
      );
      setTimeout(() => {
        hideVehicleProgress("EMAIL", record);
      }, 4000);
      updateRawSummary();
    } else if (msg.action === "GOOGLE_EMAIL_EMPTY") {
      const record = emailMessageRecord(msg);
      showVehicleProgress("EMAIL", 100, msg.message || "AI found no email address", true, record);
      setTimeout(() => {
        hideVehicleProgress("EMAIL", record);
      }, 4000);
    } else if (msg.action === "GOOGLE_GENDER_PROGRESS") {
      const pct = Math.round((msg.step / msg.totalSteps) * 100);
      showVehicleProgress("GENDER", pct, msg.message, false, genderMessageRecord(msg));
    } else if (msg.action === "GOOGLE_GENDER_RESULT") {
      // The chip beside the name turns into the answer, and the answer is written onto the person so
      // moving between the card's other people and back keeps it.
      const record = genderMessageRecord(msg);
      const session = genderSessionsByRecord[record] || activeGenderSession || null;
      const person = session && session.person ? session.person : null;
      const gender = msg.gender === "Male" || msg.gender === "Female" ? msg.gender : "";

      if (person && gender) {
        person.gender = gender;
        person.genderNote = msg.note || "";
        person.genderSource = msg.source || "google.ai";
      }

      if (gender) renderGenderBadge(record, gender, msg.note || "");

      showVehicleProgress(
        "GENDER",
        100,
        gender
          ? `${person && person.name ? person.name + " — " : ""}${gender}${msg.note ? ` (${msg.note})` : ""}`
          : "AI did not say whether this person is male or female.",
        !gender,
        record
      );
      setTimeout(() => {
        hideVehicleProgress("GENDER", record);
      }, 4000);
      updateRawSummary();
    } else if (msg.action === "GOOGLE_GENDER_EMPTY") {
      const record = genderMessageRecord(msg);
      showVehicleProgress("GENDER", 100, msg.message || "AI could not tell whether this person is male or female.", true, record);
      renderGenderBadge(record, "", "");
      setTimeout(() => {
        hideVehicleProgress("GENDER", record);
      }, 4000);
    } else if (msg.action === "GOOGLE_ADDRESS_PROGRESS") {
      const pct = Math.round((msg.step / msg.totalSteps) * 100);
      showVehicleProgress("ADDRESS", pct, msg.message, false, addressMessageRecord(msg));
    } else if (msg.action === "GOOGLE_ADDRESS_RESULT") {
      // The answer fills the manual card in: the name and the address the user typed are replaced by
      // what the AI found, and the card is redrawn so the fields show it. Everything under the card
      // (Rides, DOB, Email, the gender chip) now runs off that fuller name and the complete address.
      const record = addressMessageRecord(msg);
      const session = addressSessionsByRecord[record] || activeAddressSession || null;
      const person = session && session.person ? session.person : null;

      applyAddressResult(msg, person);
      // The answer belongs to this card, so it stays on the person it was asked about - the manual one.
      repaintRecord(record, true);

      // ...and the date it named goes into the DOB box as the AI row, beside whatever the DOB run found.
      // The box is drawn row by row, so every row the person already holds is carried into this paint.
      if (person && person.dob3) {
        renderDiscoveredDob(record, {
          dob1: person.dob1,
          dob1Source: person.dob1Source,
          dob1Note: person.dob1Note,
          dob2: person.dob2,
          dob2Source: person.dob2Source,
          dob2Note: person.dob2Note,
          dob3: person.dob3,
          dob3Source: person.dob3Source,
          dob3Note: person.dob3Note
        });
      }

      const resolved = person
        ? [person.name, person.address ? person.address.full : ""].filter(Boolean).join(" at ")
        : "";
      const note = msg.note ? ` (${msg.note})` : "";

      showVehicleProgress(
        "ADDRESS",
        100,
        resolved ? `Filled in: ${resolved}${note}` : "AI did not return an address for this person.",
        !resolved,
        record
      );
      setTimeout(() => {
        hideVehicleProgress("ADDRESS", record);
      }, 5000);
      if (person && person.emails && person.emails.length > 0) {
        renderDiscoveredEmails(record, person.emails);
      }
      updateRawSummary();
    } else if (msg.action === "GOOGLE_ADDRESS_EMPTY") {
      const record = addressMessageRecord(msg);
      const card = recordCard(record);
      const searchBtn = card ? card.querySelector(".manual-search-btn") : null;
      if (searchBtn) searchBtn.classList.remove("running");
      showVehicleProgress("ADDRESS", 100, msg.message || "AI could not resolve a full address from what was typed in.", true, record);
      setTimeout(() => {
        hideVehicleProgress("ADDRESS", record);
      }, 5000);
    } else if (msg.action === "DOB_LOOKUP_EMPTY") {
      const record = dobMessageRecord(msg);
      showVehicleProgress("DOB", 100, msg.message || "No DOB found on Unmask", true, record);
      setTimeout(() => {
        hideVehicleProgress("DOB", record);
      }, 4000);
    } else if (msg.action === "DOB_LOOKUP_ERROR") {
      const record = dobMessageRecord(msg);
      showVehicleProgress("DOB", 100, msg.error || "DOB lookup error", true, record);
      setTimeout(() => {
        hideVehicleProgress("DOB", record);
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
  const AUTOMATION_SETTINGS_KEY = "automation_settings";
  const AUTOMATION_SETTINGS_DEFAULTS = {
    records: { record1: true, record2: true, record3: true },
    dob: { unmask: true, thatsthem: true, ai: true },
    dnc: { record1: true, record2: true, record3: true }
  };

  // The three sites are the user's Record 1, Record 2 and Record 3; their names never reach the UI.
  // Vehicle discovery is the one "Rides" action, and Mercury's automation has no UI entry point.
  const RECORD_LABELS = {
    "infolookup.site": "Record 1",
    "infolookupp.com": "Record 2",
    "uspeoplesearch.net": "Record 3"
  };
  const RECORD_KEYS = {
    "infolookup.site": "record1",
    "infolookupp.com": "record2",
    "uspeoplesearch.net": "record3"
  };
  const RIDE_LABELS = { amica: "Rides", mercury: "Rides" };

  function recordLabel(source) {
    return RECORD_LABELS[String(source == null ? "" : source).toLowerCase()] || "Record";
  }

  function recordKey(source) {
    return RECORD_KEYS[String(source == null ? "" : source).toLowerCase()] || "";
  }

  function rideLabel(provider) {
    return RIDE_LABELS[String(provider == null ? "" : provider).toLowerCase()] || "Ride";
  }

  // Every group and every switch is filled in from the defaults, so a stored object that is missing a
  // key (an older install, a half-written value) can never read as "off".
  function normalizeAutomationSettings(raw) {
    const stored = raw && typeof raw === "object" ? raw : {};
    const merge = (group, defaults) => {
      const fromStored = stored[group] && typeof stored[group] === "object" ? stored[group] : {};
      const out = {};
      Object.keys(defaults).forEach((key) => {
        out[key] = fromStored[key] === undefined ? defaults[key] : !!fromStored[key];
      });
      return out;
    };
    return {
      records: merge("records", AUTOMATION_SETTINGS_DEFAULTS.records),
      dob: merge("dob", AUTOMATION_SETTINGS_DEFAULTS.dob),
      dnc: merge("dnc", AUTOMATION_SETTINGS_DEFAULTS.dnc)
    };
  }

  // "dnc.record1" -> its value. An unknown path reads as on, which is the safe default.
  function settingValue(settings, path) {
    const parts = String(path || "").split(".");
    let node = normalizeAutomationSettings(settings);
    for (let i = 0; i < parts.length; i++) {
      if (!node || typeof node !== "object" || !(parts[i] in node)) return true;
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
    const parts = String(path || "").split(".");
    readAutomationSettings((settings) => {
      let node = settings;
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]];
      node[parts[parts.length - 1]] = !!value;
      chrome.storage.local.set({ [AUTOMATION_SETTINGS_KEY]: settings }, () => {
        if (callback) callback(settings);
      });
    });
  }

  // The settings a render reads, kept in step with storage so a card repaint never has to wait on a
  // storage round-trip.
  let automationSettings = normalizeAutomationSettings(null);

  function automationSetting(path) {
    return settingValue(automationSettings, path);
  }

  readAutomationSettings((settings) => {
    automationSettings = settings;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[AUTOMATION_SETTINGS_KEY]) {
      automationSettings = normalizeAutomationSettings(changes[AUTOMATION_SETTINGS_KEY].newValue);
    }
  });

  // Settings & Calibration Sidebar Logic for In-Page Widget
  function initWidgetSettingsSidebar() {
    const settingsToggleBtn = shadow.getElementById("settings-toggle-btn");
    const settingsSidebar = shadow.getElementById("settings-sidebar");
    const closeSidebarBtn = shadow.getElementById("close-sidebar-btn");

    if (!settingsToggleBtn || !settingsSidebar) return;

    // The build stamp, at the bottom of the drawer: proof of *which* copy of widget.js is on this page,
    // which is the one thing that cannot be read off the cards themselves.
    const buildStamp = shadow.getElementById("widget-build-stamp");
    if (buildStamp) buildStamp.textContent = `Build ${WIDGET_BUILD}`;

    const toggles = Array.from(settingsSidebar.querySelectorAll(".setting-toggle"));

    function paint(settings) {
      toggles.forEach((input) => {
        const on = settingValue(settings, input.dataset.setting);
        input.checked = on;
        const row = input.closest(".setting-row");
        if (row) row.classList.toggle("off", !on);
      });
    }

    function refresh() {
      readAutomationSettings((settings) => {
        automationSettings = settings;
        paint(settings);
      });
    }

    function openSidebar() {
      settingsSidebar.classList.remove("closed");
      refresh();
    }

    function closeSidebar() {
      settingsSidebar.classList.add("closed");
    }

    settingsToggleBtn.addEventListener("click", () => {
      if (settingsSidebar.classList.contains("closed")) openSidebar();
      else closeSidebar();
    });

    if (closeSidebarBtn) closeSidebarBtn.addEventListener("click", closeSidebar);

    toggles.forEach((input) => {
      input.addEventListener("change", () => {
        writeAutomationSetting(input.dataset.setting, input.checked, (settings) => {
          automationSettings = settings;
          paint(settings);
        });
      });
    });

    // The other panels share these settings: a switch flipped in the popup updates this one too.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[AUTOMATION_SETTINGS_KEY]) refresh();
    });

    refresh();
  }

  initWidgetSettingsSidebar();
})();
