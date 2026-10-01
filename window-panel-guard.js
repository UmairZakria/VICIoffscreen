// The detached window's own guard. It is loaded before widget.js purely so that a failure to start the
// panel says so on the page - "the window is blank" is otherwise the only symptom the user can see, with
// the reason hidden in a console they have no reason to open.
//
// It is a file rather than an inline <script> because an extension page's CSP allows only `self` scripts,
// which would block the inline one - the guard would be the thing that fails.

window.addEventListener("error", (event) => {
  try {
    const note = document.createElement("pre");
    note.style.cssText =
      "margin:0;padding:14px 16px;font:12px/1.6 monospace;color:#b91c1c;white-space:pre-wrap;";
    note.textContent =
      "The panel could not start in this window:\n" +
      (event.message || (event.error && event.error.message) || "unknown error") +
      "\n" +
      (event.filename || "") +
      ":" +
      (event.lineno || "");
    (document.body || document.documentElement).appendChild(note);
  } catch (e) {
    /* Nothing more can be done: the page is blank either way. */
  }
});
