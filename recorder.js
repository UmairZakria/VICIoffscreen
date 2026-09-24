// Content Script: Mouse Movement & Click Coordinate Recorder
// Supports top-level page and nested/cross-origin IFrames (e.g., Cloudflare Turnstile, Captchas)

(function () {
  "use strict";

  if (window.__mouseRecorderLoaded) return;
  window.__mouseRecorderLoaded = true;

  chrome.storage.local.get(["active_mouse_recording"], function (res) {
    var session = res ? res.active_mouse_recording : null;
    if (!session || !session.active) return;

    // Check freshness (session created within last 2 minutes)
    if (session.startedAt && Date.now() - session.startedAt > 120000) {
      chrome.storage.local.remove("active_mouse_recording");
      return;
    }

    if (window.self === window.top) {
      // Running in Top-Level Window
      var host = window.location.hostname.toLowerCase();
      var isUnmask = host.includes("unmask.com") && session.target === "unmask";
      var isThatsThem = host.includes("thatsthem.com") && session.target === "thatsthem";

      if (!isUnmask && !isThatsThem) return;
      initTopRecorder(session);
    } else {
      // Running inside an IFrame (e.g. Cloudflare Turnstile / Captcha)
      initIFrameChildRecorder(session);
    }
  });

  // =========================================================================
  // CHILD IFRAME RECORDER
  // =========================================================================
  function initIFrameChildRecorder(session) {
    var childClickRecorded = false;

    function forwardMove(e) {
      if (childClickRecorded) return;
      try {
        window.top.postMessage(
          {
            type: "__MACRO_CHILD_MOVE__",
            x: e.clientX,
            y: e.clientY,
            screenX: e.screenX,
            screenY: e.screenY,
            time: performance.now()
          },
          "*"
        );
      } catch (err) {}
    }

    function forwardClick(e) {
      if (childClickRecorded) return;
      childClickRecorded = true;

      document.removeEventListener("mousemove", forwardMove, true);
      document.removeEventListener("pointermove", forwardMove, true);
      document.removeEventListener("click", forwardClick, true);
      document.removeEventListener("mousedown", forwardClick, true);
      document.removeEventListener("pointerdown", forwardClick, true);

      var targetTag = e.target ? e.target.tagName : "IFRAME_ELEMENT";
      var targetId = e.target && e.target.id ? e.target.id : "";
      var targetClass = e.target && e.target.className ? String(e.target.className) : "";
      var targetText = e.target && e.target.innerText ? e.target.innerText.slice(0, 50).trim() : "";

      var payload = {
        type: "__MACRO_CHILD_CLICK__",
        x: e.clientX,
        y: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        targetTag: targetTag,
        targetId: targetId,
        targetClass: targetClass,
        targetText: targetText,
        time: performance.now()
      };

      // 1. Post to top-level window
      try {
        window.top.postMessage(payload, "*");
      } catch (err) {}

      // 2. Also send via runtime as redundancy
      try {
        chrome.runtime.sendMessage({
          action: "RECORDER_IFRAME_CLICK",
          data: payload
        });
      } catch (err) {}
    }

    document.addEventListener("mousemove", forwardMove, { capture: true, passive: true });
    document.addEventListener("pointermove", forwardMove, { capture: true, passive: true });
    document.addEventListener("click", forwardClick, { capture: true });
    document.addEventListener("mousedown", forwardClick, { capture: true });
    document.addEventListener("pointerdown", forwardClick, { capture: true });
  }

  // =========================================================================
  // TOP-LEVEL RECORDER
  // =========================================================================
  function initTopRecorder(session) {
    // Inject minimalist "Recording..." indicator
    var badge = document.createElement("div");
    badge.id = "__macro_recording_badge";
    badge.innerHTML =
      '<span style="width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block;animation:__recPulse 1s infinite alternate;"></span><span>Recording...</span>';
    badge.style.cssText = [
      "position: fixed !important",
      "top: 14px !important",
      "right: 14px !important",
      "z-index: 2147483647 !important",
      "background: rgba(15, 23, 42, 0.92) !important",
      "backdrop-filter: blur(8px) !important",
      "-webkit-backdrop-filter: blur(8px) !important",
      "color: #ffffff !important",
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important",
      "font-size: 13px !important",
      "font-weight: 500 !important",
      "padding: 6px 14px !important",
      "border-radius: 9999px !important",
      "border: 1px solid rgba(255,255,255,0.15) !important",
      "box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3) !important",
      "display: flex !important",
      "align-items: center !important",
      "gap: 8px !important",
      "pointer-events: none !important",
      "user-select: none !important",
      "transition: opacity 0.2s ease !important"
    ].join(";");

    if (!document.getElementById("__rec_pulse_style")) {
      var style = document.createElement("style");
      style.id = "__rec_pulse_style";
      style.textContent =
        "@keyframes __recPulse { from { opacity: 0.3; transform: scale(0.9); } to { opacity: 1; transform: scale(1.15); } }";
      (document.head || document.documentElement).appendChild(style);
    }

    function attachBadge() {
      if (!document.body) {
        document.addEventListener("DOMContentLoaded", attachBadge, { once: true });
        return;
      }
      document.body.appendChild(badge);
    }
    attachBadge();

    var startTime = performance.now();
    var path = [];
    var speeds = [];
    var totalDistance = 0;
    var lastX = null;
    var lastY = null;
    var lastScreenX = null;
    var lastScreenY = null;
    var screenToViewportOffsetX = null;
    var screenToViewportOffsetY = null;
    var lastTime = null;
    var clickCompleted = false;
    var blurTimeout = null;

    function recordMovementPoint(x, y, pageX, pageY, now) {
      var t = Math.round(now - startTime);
      var speed = 0;

      if (lastTime !== null && lastX !== null && lastY !== null) {
        var dt = now - lastTime;
        var dx = x - lastX;
        var dy = y - lastY;
        var dist = Math.hypot(dx, dy);
        totalDistance += dist;
        if (dt > 0) {
          speed = Math.round((dist / dt) * 1000); // px/s
          speeds.push(speed);
        }
      }

      lastX = x;
      lastY = y;
      lastTime = now;

      path.push({
        x: x,
        y: y,
        pageX: pageX !== undefined ? pageX : x + (window.scrollX || 0),
        pageY: pageY !== undefined ? pageY : y + (window.scrollY || 0),
        t: t,
        speed: speed
      });
    }

    function onMouseMove(e) {
      if (clickCompleted) return;
      var now = performance.now();
      var x = e.clientX;
      var y = e.clientY;

      lastScreenX = e.screenX;
      lastScreenY = e.screenY;
      screenToViewportOffsetX = e.screenX - e.clientX;
      screenToViewportOffsetY = e.screenY - e.clientY;

      recordMovementPoint(x, y, e.pageX, e.pageY, now);
    }

    // Convert child frame coordinate to top-level viewport coordinate
    function resolveChildCoordinates(data, sourceWindow) {
      var clickX = null;
      var clickY = null;
      var iframeEl = null;

      // 1. Try finding matching iframe element in DOM
      try {
        var iframes = document.querySelectorAll("iframe");
        for (var i = 0; i < iframes.length; i++) {
          if (sourceWindow && iframes[i].contentWindow === sourceWindow) {
            iframeEl = iframes[i];
            break;
          }
        }
      } catch (e) {}

      if (iframeEl) {
        var rect = iframeEl.getBoundingClientRect();
        clickX = Math.round(rect.left + (data.x || 0));
        clickY = Math.round(rect.top + (data.y || 0));
      } else if (data.screenX && screenToViewportOffsetX !== null) {
        // 2. Exact screen coordinate offset invariant
        clickX = Math.round(data.screenX - screenToViewportOffsetX);
        clickY = Math.round(data.screenY - screenToViewportOffsetY);
      } else if (lastX !== null && lastY !== null) {
        // 3. Last known cursor coordinate right before entering iframe
        clickX = lastX;
        clickY = lastY;
      } else {
        clickX = data.x || 0;
        clickY = data.y || 0;
      }

      return { x: clickX, y: clickY, iframe: iframeEl };
    }

    // Handle cross-frame messages from child iframes
    function onWindowMessage(ev) {
      if (!ev.data || clickCompleted) return;

      if (ev.data.type === "__MACRO_CHILD_MOVE__") {
        var moveCoords = resolveChildCoordinates(ev.data, ev.source);
        recordMovementPoint(moveCoords.x, moveCoords.y, moveCoords.x + (window.scrollX || 0), moveCoords.y + (window.scrollY || 0), performance.now());
      } else if (ev.data.type === "__MACRO_CHILD_CLICK__") {
        var clickCoords = resolveChildCoordinates(ev.data, ev.source);
        var targetDesc = ev.data.targetTag || "IFRAME_ELEMENT";
        if (clickCoords.iframe) {
          var fId = clickCoords.iframe.id ? "#" + clickCoords.iframe.id : "";
          targetDesc = "iframe" + fId + " -> " + targetDesc;
        }

        finalizeRecording({
          x: clickCoords.x,
          y: clickCoords.y,
          pageX: clickCoords.x + (window.scrollX || 0),
          pageY: clickCoords.y + (window.scrollY || 0),
          targetTag: targetDesc,
          targetId: ev.data.targetId || "",
          targetClass: ev.data.targetClass || "",
          targetText: ev.data.targetText || "IFrame Action"
        });
      }
    }

    // Window blur fallback: catches clicks on sandboxed iframes that focus away from top window
    function onWindowBlur() {
      if (clickCompleted) return;

      if (blurTimeout) clearTimeout(blurTimeout);
      blurTimeout = setTimeout(function () {
        if (clickCompleted) return;

        var activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "IFRAME" || activeEl.tagName === "EMBED" || (activeEl.shadowRoot && activeEl.shadowRoot.querySelector("iframe")))) {
          var rect = activeEl.getBoundingClientRect();
          var clickX = lastX;
          var clickY = lastY;

          // If last position was inside/near iframe, keep it; else target center
          if (
            clickX === null ||
            clickX < rect.left - 20 ||
            clickX > rect.right + 20 ||
            clickY < rect.top - 20 ||
            clickY > rect.bottom + 20
          ) {
            clickX = Math.round(rect.left + rect.width / 2);
            clickY = Math.round(rect.top + rect.height / 2);
          }

          var targetDesc = "iframe" + (activeEl.id ? "#" + activeEl.id : "");
          finalizeRecording({
            x: clickX,
            y: clickY,
            pageX: clickX + (window.scrollX || 0),
            pageY: clickY + (window.scrollY || 0),
            targetTag: targetDesc,
            targetId: activeEl.id || "",
            targetClass: String(activeEl.className || ""),
            targetText: activeEl.title || activeEl.name || "Cloudflare / Security Checkbox"
          });
        }
      }, 100);
    }

    // Top-level direct click on document
    function onFirstClick(e) {
      if (clickCompleted) return;
      finalizeRecording({
        x: e.clientX,
        y: e.clientY,
        pageX: e.pageX,
        pageY: e.pageY,
        targetTag: e.target ? e.target.tagName : "",
        targetId: e.target && e.target.id ? e.target.id : "",
        targetClass: e.target && e.target.className ? String(e.target.className) : "",
        targetText: e.target && e.target.innerText ? e.target.innerText.slice(0, 50).trim() : ""
      });
    }

    // Runtime message listener fallback
    function onRuntimeMessage(msg) {
      if (clickCompleted || !msg) return;
      if (msg.action === "RECORDER_IFRAME_CLICK" && msg.data) {
        var clickCoords = resolveChildCoordinates(msg.data, null);
        finalizeRecording({
          x: clickCoords.x,
          y: clickCoords.y,
          pageX: clickCoords.x + (window.scrollX || 0),
          pageY: clickCoords.y + (window.scrollY || 0),
          targetTag: "iframe -> " + (msg.data.targetTag || "checkbox"),
          targetId: msg.data.targetId || "",
          targetClass: msg.data.targetClass || "",
          targetText: msg.data.targetText || "Turnstile / IFrame Checkbox"
        });
      }
    }

    function finalizeRecording(clickData) {
      if (clickCompleted) return;
      clickCompleted = true;

      if (blurTimeout) {
        clearTimeout(blurTimeout);
        blurTimeout = null;
      }

      // Immediately disarm event listeners
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("pointermove", onMouseMove, true);
      document.removeEventListener("click", onFirstClick, true);
      document.removeEventListener("mousedown", onFirstClick, true);
      document.removeEventListener("pointerdown", onFirstClick, true);
      window.removeEventListener("message", onWindowMessage);
      window.removeEventListener("blur", onWindowBlur);
      try {
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      } catch (e) {}

      var clickTime = Math.round(performance.now() - startTime);
      clickData.t = clickTime;

      // Include final click coordinate in path
      path.push({
        x: clickData.x,
        y: clickData.y,
        pageX: clickData.pageX,
        pageY: clickData.pageY,
        t: clickTime,
        speed: 0
      });

      var avgSpeed = clickTime > 0 ? Math.round(totalDistance / (clickTime / 1000)) : 0;
      var peakSpeed = speeds.length > 0 ? Math.max.apply(null, speeds) : 0;

      var recordPayload = {
        target: session.target,
        url: window.location.href,
        recordedAt: new Date().toISOString(),
        durationMs: clickTime,
        pointCount: path.length,
        totalDistancePx: Math.round(totalDistance),
        avgSpeedPxPerSec: avgSpeed,
        peakSpeedPxPerSec: peakSpeed,
        click: clickData,
        path: path
      };

      // Clean up badge
      if (badge && badge.parentNode) {
        badge.parentNode.removeChild(badge);
      }

      // Save recording in storage
      var storageKey = session.target === "unmask" ? "recorded_macro_unmask" : "recorded_macro_thatsthem";
      var storageObj = {};
      storageObj[storageKey] = recordPayload;
      storageObj["last_macro_recording"] = recordPayload;
      storageObj["active_mouse_recording"] = null;

      chrome.storage.local.set(storageObj, function () {
        try {
          chrome.runtime.sendMessage({
            action: "MOUSE_RECORDING_COMPLETED",
            target: session.target,
            result: recordPayload,
            originTabId: session.originTabId,
            originWindowId: session.originWindowId
          });
        } catch (err) {
          console.error("[Recorder] Error sending completion message:", err);
        }
      });
    }

    // Attach listeners
    document.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
    document.addEventListener("pointermove", onMouseMove, { capture: true, passive: true });
    document.addEventListener("click", onFirstClick, { capture: true });
    document.addEventListener("mousedown", onFirstClick, { capture: true });
    document.addEventListener("pointerdown", onFirstClick, { capture: true });
    window.addEventListener("message", onWindowMessage);
    window.addEventListener("blur", onWindowBlur);
    try {
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
    } catch (e) {}
  }
})();
