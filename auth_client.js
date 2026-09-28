// Client-Side Authentication & Quota Manager for DNC Extension
// Works across popup.html, window.html, and injected widget

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DNCAuthClient = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_API_URL = 'https://auto-lookup-portal.vercel.app';
  const STORAGE_KEY_TOKEN = 'dnc_auth_token';
  const STORAGE_KEY_USER = 'dnc_auth_user';
  const STORAGE_KEY_API_URL = 'dnc_api_url';
  const LIMIT_REACHED_TEXT = 'limit reached contact admin for more limit';

  // The portal lives on Vercel now; `localhost:3000` was only ever the development server. A
  // packaged extension has no Next.js running on the user's machine, so a stored loopback URL is not
  // a setting - it is a leftover that makes the login fail with "could not connect". Such values are
  // ignored in favour of the live portal.
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

  // Accepts what the Server box holds ("auto-lookup-portal.vercel.app", a URL with a trailing slash,
  // nothing at all) and always yields the base URL the extension should call.
  function normalizeApiUrl(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return DEFAULT_API_URL;
    if (isLoopbackApiUrl(text)) return DEFAULT_API_URL;

    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    try {
      const parsed = new URL(withScheme);
      return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
    } catch (e) {
      return DEFAULT_API_URL;
    }
  }

  let currentApiUrl = DEFAULT_API_URL;
  let currentUser = null;
  let currentToken = null;

  async function getStoredAuth() {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([STORAGE_KEY_TOKEN, STORAGE_KEY_USER, STORAGE_KEY_API_URL], (res) => {
            const storedApiUrl = res ? res[STORAGE_KEY_API_URL] : null;
            const apiUrl = normalizeApiUrl(storedApiUrl);

            // A dev address left in storage is corrected once, here, so an install that was pointed at
            // localhost starts talking to the live portal on the next popup / window open.
            if (storedApiUrl && storedApiUrl !== apiUrl) {
              chrome.storage.local.set({ [STORAGE_KEY_API_URL]: apiUrl });
            }

            resolve({
              token: res ? res[STORAGE_KEY_TOKEN] || null : null,
              user: res ? res[STORAGE_KEY_USER] || null : null,
              apiUrl,
            });
          });
        } else {
          resolve({ token: null, user: null, apiUrl: DEFAULT_API_URL });
        }
      } catch (e) {
        resolve({ token: null, user: null, apiUrl: DEFAULT_API_URL });
      }
    });
  }

  async function setStoredAuth(token, user, apiUrl) {
    return new Promise((resolve) => {
      try {
        const data = {
          [STORAGE_KEY_TOKEN]: token,
          [STORAGE_KEY_USER]: user,
        };
        if (apiUrl) data[STORAGE_KEY_API_URL] = apiUrl;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(data, () => resolve(true));
        } else {
          resolve(true);
        }
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function clearStoredAuth() {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.remove([STORAGE_KEY_TOKEN, STORAGE_KEY_USER], () => resolve(true));
        } else {
          resolve(true);
        }
      } catch (e) {
        resolve(true);
      }
    });
  }

  class AuthManager {
    constructor() {
      this.initialized = false;
      this.overlay = null;
      this.alertBox = null;
      this.alertText = null;
      this.form = null;
      this.usernameInput = null;
      this.passwordInput = null;
      this.submitBtn = null;
      this.btnText = null;
      this.spinner = null;
      this.headerPill = null;
      this.quotaDisplay = null;
      this.logoutBtn = null;
      this.serverUrlToggle = null;
      this.serverUrlBox = null;
      this.serverUrlInput = null;
      this.serverUrlLabel = null;
      this.saveServerUrlBtn = null;
    }

    async init() {
      this.findDomElements();

      const stored = await getStoredAuth();
      currentToken = stored.token;
      currentUser = stored.user;
      currentApiUrl = stored.apiUrl;

      if (this.serverUrlLabel) {
        try {
          const u = new URL(currentApiUrl);
          this.serverUrlLabel.textContent = u.host;
        } catch (e) {
          this.serverUrlLabel.textContent = currentApiUrl;
        }
      }
      if (this.serverUrlInput) {
        this.serverUrlInput.value = currentApiUrl;
      }

      this.bindEvents();
      this.listenToMessages();

      if (currentToken && currentUser) {
        this.showAuthenticatedState(currentUser);
        this.syncQuotaWithServer();
      } else {
        this.showLoginOverlay();
      }

      this.initialized = true;
    }

    findDomElements() {
      this.overlay = document.getElementById('login-overlay');
      this.alertBox = document.getElementById('login-alert-box');
      this.alertText = document.getElementById('login-alert-text');
      this.form = document.getElementById('login-form');
      this.usernameInput = document.getElementById('login-username');
      this.passwordInput = document.getElementById('login-password');
      this.submitBtn = document.getElementById('login-submit-btn');
      this.btnText = document.getElementById('login-btn-text');
      this.spinner = document.getElementById('login-spinner');
      this.headerPill = document.getElementById('auth-header-pill');
      this.quotaDisplay = document.getElementById('auth-quota-display');
      this.logoutBtn = document.getElementById('auth-logout-btn');
      this.serverUrlToggle = document.getElementById('server-url-toggle-btn');
      this.serverUrlBox = document.getElementById('server-url-box');
      this.serverUrlInput = document.getElementById('server-url-input');
      this.serverUrlLabel = document.getElementById('server-url-label');
      this.saveServerUrlBtn = document.getElementById('save-server-url-btn');
    }

    bindEvents() {
      if (this.form) {
        this.form.addEventListener('submit', (e) => this.handleLoginSubmit(e));
      }

      if (this.logoutBtn) {
        this.logoutBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.logout();
        });
      }

      if (this.headerPill) {
        this.headerPill.addEventListener('click', (e) => {
          if (e.target && (e.target === this.logoutBtn || this.logoutBtn?.contains(e.target))) {
            return;
          }
          this.syncQuotaWithServer();
          this.headerPill.style.transform = 'scale(0.96)';
          setTimeout(() => { this.headerPill.style.transform = 'none'; }, 150);
        });
      }

      if (this.serverUrlToggle && this.serverUrlBox) {
        this.serverUrlToggle.addEventListener('click', () => {
          if (this.serverUrlBox) {
            this.serverUrlBox.classList.toggle('hidden');
          }
        });
      }

      if (this.saveServerUrlBtn && this.serverUrlInput) {
        this.saveServerUrlBtn.addEventListener('click', async () => {
          const url = normalizeApiUrl(this.serverUrlInput.value);
          currentApiUrl = url;
          await chrome.storage.local.set({ [STORAGE_KEY_API_URL]: url });
          // Show what is actually going to be called, so a dev address is visibly replaced by the
          // live portal instead of silently breaking the next login.
          if (this.serverUrlInput) this.serverUrlInput.value = url;
          if (this.serverUrlLabel) {
            try {
              this.serverUrlLabel.textContent = new URL(url).host;
            } catch (e) {
              this.serverUrlLabel.textContent = url;
            }
          }
          if (this.serverUrlBox) {
            this.serverUrlBox.classList.add('hidden');
          }
        });
      }

      // Auto-sync quota periodically (every 20s) and on window focus
      setInterval(() => {
        if (currentToken && currentUser) {
          this.syncQuotaWithServer();
        }
      }, 20000);

      window.addEventListener('focus', () => {
        if (currentToken && currentUser) {
          this.syncQuotaWithServer();
        }
      });
    }

    listenToMessages() {
      if (typeof chrome === 'undefined') return;

      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes.dnc_auth_user) {
            const newUser = changes.dnc_auth_user.newValue;
            if (newUser) {
              currentUser = newUser;
              this.updateQuotaDisplay(newUser.lookupsRemaining, newUser.lookupsTotal);
            } else {
              currentUser = null;
              currentToken = null;
              this.showLoginOverlay();
            }
          }
        });
      }

      if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg) => {
          if (!msg) return;
          if (msg.action === 'AUTH_QUOTA_UPDATED') {
            if (currentUser) {
              currentUser.lookupsRemaining = msg.lookupsRemaining;
              currentUser.lookupsTotal = msg.lookupsTotal;
            }
            this.updateQuotaDisplay(msg.lookupsRemaining, msg.lookupsTotal);
          } else if (msg.action === 'AUTH_LIMIT_REACHED') {
            this.handleLimitReached(msg.error || LIMIT_REACHED_TEXT);
          } else if (msg.action === 'AUTH_LOGGED_OUT' || msg.action === 'AUTH_REQUIRED') {
            this.logout(msg.error);
          }
        });
      }
    }

    async handleLoginSubmit(e) {
      if (e && e.preventDefault) e.preventDefault();
      const username = this.usernameInput?.value?.trim();
      const password = this.passwordInput?.value;

      if (!username || !password) return;

      this.hideAlert();
      this.setSubmitting(true);

      // Strategy 1: Delegate to background service worker (immune to CORS, mixed-content, or page restrictions)
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            action: 'AUTH_LOGIN',
            username,
            password,
            apiUrl: currentApiUrl,
          },
          async (res) => {
            if (chrome.runtime.lastError || !res) {
              // Try fallback direct fetch
              await this.directFetchLogin(username, password);
              return;
            }

            this.setSubmitting(false);

            if (!res.success) {
              if (res.code === 'LIMIT_REACHED' || res.error?.includes('limit reached')) {
                this.showAlert(LIMIT_REACHED_TEXT);
              } else {
                this.showAlert(res.error || 'Login failed');
              }
              return;
            }

            currentToken = res.token;
            currentUser = res.user;

            await setStoredAuth(currentToken, currentUser, currentApiUrl);
            this.showAuthenticatedState(currentUser);
            if (this.passwordInput) this.passwordInput.value = '';
          }
        );
        return;
      }

      // Strategy 2: Direct fetch fallback
      await this.directFetchLogin(username, password);
    }

    async directFetchLogin(username, password) {
      try {
        const res = await fetch(`${currentApiUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (res.status === 403 && (data.code === 'LIMIT_REACHED' || data.error?.includes('limit reached'))) {
            this.showAlert(LIMIT_REACHED_TEXT);
            return;
          }
          throw new Error(data.error || `Login failed (HTTP ${res.status})`);
        }

        currentToken = data.token;
        currentUser = data.user;

        await setStoredAuth(currentToken, currentUser, currentApiUrl);

        this.showAuthenticatedState(currentUser);
        if (this.passwordInput) this.passwordInput.value = '';
      } catch (err) {
        this.showAlert(err.message || 'Could not connect to authentication server.');
      } finally {
        this.setSubmitting(false);
      }
    }

    async syncQuotaWithServer() {
      if (!currentToken) return;

      // Strategy 1: Sync via background service worker
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'AUTH_SYNC_QUOTA' }, (res) => {
          if (!chrome.runtime.lastError && res && res.success && res.user) {
            currentUser = res.user;
            this.updateQuotaDisplay(currentUser.lookupsRemaining, currentUser.lookupsTotal);
            return;
          }
          if (res && (res.code === 'LIMIT_REACHED' || res.error?.includes('limit reached'))) {
            this.handleLimitReached(LIMIT_REACHED_TEXT);
            return;
          }
        });
      }

      // Strategy 2: Direct fetch fallback
      try {
        const res = await fetch(`${currentApiUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${currentToken}` },
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 403 && (data.code === 'LIMIT_REACHED' || data.error?.includes('limit reached'))) {
          this.handleLimitReached(LIMIT_REACHED_TEXT);
          return;
        }
        if (res.status === 401) {
          this.logout('Session expired. Please sign in again.');
          return;
        }
        if (res.ok && data.user) {
          currentUser = data.user;
          await chrome.storage.local.set({ [STORAGE_KEY_USER]: currentUser });
          this.updateQuotaDisplay(currentUser.lookupsRemaining, currentUser.lookupsTotal);
        }
      } catch (err) {
        console.warn('Could not sync quota:', err);
      }
    }

    showAuthenticatedState(user) {
      this.findDomElements();
      if (this.overlay) this.overlay.classList.add('hidden');
      if (this.headerPill) this.headerPill.classList.remove('hidden');
      this.updateQuotaDisplay(user?.lookupsRemaining, user?.lookupsTotal);
    }

    showLoginOverlay(alertMsg) {
      this.findDomElements();
      if (this.headerPill) this.headerPill.classList.add('hidden');
      if (this.overlay) this.overlay.classList.remove('hidden');
      if (alertMsg) {
        this.showAlert(alertMsg);
      } else {
        this.hideAlert();
      }
    }

    updateQuotaDisplay(remaining, total) {
      if (!this.quotaDisplay) return;
      if (currentUser?.role === 'admin') {
        this.quotaDisplay.textContent = 'Admin (∞)';
        this.quotaDisplay.classList.remove('low');
        return;
      }

      const rem = typeof remaining === 'number' ? remaining : 0;
      const tot = typeof total === 'number' ? total : 0;

      this.quotaDisplay.textContent = `${rem} / ${tot} left`;
      if (rem <= 10) {
        this.quotaDisplay.classList.add('low');
      } else {
        this.quotaDisplay.classList.remove('low');
      }
    }

    showAlert(message) {
      this.findDomElements();
      if (!this.alertBox || !this.alertText) return;
      this.alertText.textContent = message;
      this.alertBox.classList.remove('hidden');
    }

    hideAlert() {
      if (this.alertBox) this.alertBox.classList.add('hidden');
    }

    setSubmitting(isLoading) {
      if (this.submitBtn) this.submitBtn.disabled = isLoading;
      if (this.btnText) this.btnText.classList.toggle('hidden', isLoading);
      if (this.spinner) this.spinner.classList.toggle('hidden', !isLoading);
    }

    async handleLimitReached(message) {
      await clearStoredAuth();
      currentToken = null;
      currentUser = null;
      this.showLoginOverlay(message || LIMIT_REACHED_TEXT);
    }

    async logout(alertMsg) {
      await clearStoredAuth();
      currentToken = null;
      currentUser = null;
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'AUTH_LOGGED_OUT' }).catch(() => {});
        }
      } catch (e) {}
      this.showLoginOverlay(alertMsg);
    }

    isAuthenticated() {
      return !!currentToken && !!currentUser;
    }

    getUser() {
      return currentUser;
    }
  }

  const manager = new AuthManager();
  // Auto-init immediately if DOM is already ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => manager.init());
    } else {
      manager.init();
    }
  }

  return manager;
});
