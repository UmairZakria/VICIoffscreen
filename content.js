// Content Script injected into https://infolookupp.com/ AND https://infolookup.site/
// Runs concurrently inside persistent headless background iframes

(function () {
  // Only execute when running inside an embedded iframe (background automation)
  if (window.self === window.top) {
    return;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const host = window.location.hostname.toLowerCase();

  // The host decides which search flow runs, and both flows report under the name of the site
  // they scraped - that name is the record key the widget hangs its card, ZIP filter and DOB run
  // on, so it has to match the key the background dispatches with (`worker-<source>`).
  //
  // The match is by exact host on purpose: `infolookupp.com` contains the string "infolookup",
  // so the old `host.includes('infolookup') ? 'infolookup.site' : 'vibegenx.com'` classified the
  // second source as infolookup.site and ran the wrong flow, with the wrong selectors, against it.
  const SOURCE_BY_HOST = {
    'infolookup.site': 'infolookup.site',
    'www.infolookup.site': 'infolookup.site',
    'infolookupp.com': 'infolookupp.com',
    'www.infolookupp.com': 'infolookupp.com'
  };
  const sourceName = SOURCE_BY_HOST[host] || 'infolookup.site';

  let port = null;
  let activeSearchId = null;

  function connectPort() {
    try {
      port = chrome.runtime.connect({ name: 'worker-' + sourceName });

      port.onMessage.addListener(async (msg) => {
        if (msg.action === 'EXECUTE_SEARCH') {
          activeSearchId = msg.searchId;
          if (sourceName === 'infolookup.site') {
            await executeInfolookupSearch(msg.phone, msg.searchId);
          } else {
            await executeInfolookuppSearch(msg.phone, msg.searchId);
          }
        }
      });

      port.onDisconnect.addListener(() => {
        port = null;
        setTimeout(connectPort, 1200);
      });

      port.postMessage({ action: 'WORKER_READY', source: sourceName });
    } catch (e) {
      setTimeout(connectPort, 1500);
    }
  }

  connectPort();

  /* ═══════════════════════════════════════════════════════
     INFOLOOKUP.SITE HELPERS
  ═══════════════════════════════════════════════════════ */

  // infolookup.site refuses to look the same number up twice and shows
  // "This number was just searched. Please try a different number."
  //
  // The check is `phoneRaw === lastSearchedNumber`, where the site declares
  // `let lastSearchedNumber = ''` at the top level of a classic <script>. That binding lives in the
  // page's global *lexical* environment, so `window.lastSearchedNumber = ''` only creates a stray
  // property on the window object and never touches the real variable. Injected <script> elements
  // run in the page's main world, where a bare assignment resolves the real binding.
  // Returns true when the site's guard variable was actually reset.
  function resetInfolookupDuplicateGuard() {
    const marker = 'data-dnc-guard-reset';
    try {
      document.documentElement.removeAttribute(marker);
    } catch (e) {}

    try {
      const resetScript = document.createElement('script');
      resetScript.textContent =
        '(function(){' +
        'var ok=false;' +
        'try{ lastSearchedNumber = ""; ok = (lastSearchedNumber === ""); }catch(e){}' +
        'if(!ok){ try{ eval("lastSearchedNumber = \\"\\""); ok = (lastSearchedNumber === ""); }catch(e){} }' +
        'try{ document.documentElement.setAttribute("' + marker + '", ok ? "1" : "0"); }catch(e){}' +
        '})();';
      document.documentElement.appendChild(resetScript);
      resetScript.remove();
    } catch (e) {}

    return document.documentElement.getAttribute(marker) === '1';
  }

  // Wipes the rendered result so a fresh lookup can't be confused with stale data.
  function clearInfolookupResultsDom() {
    try {
      const dnc = document.getElementById('dncStatus');
      if (dnc) dnc.textContent = '—';
      const lit = document.getElementById('litigator');
      if (lit) lit.textContent = '—';
      const black = document.getElementById('blacklist');
      if (black) black.textContent = '—';
      const list = document.getElementById('personInfoListContainer');
      if (list) list.innerHTML = '';
      const errorDiv = document.getElementById('error');
      if (errorDiv) {
        errorDiv.style.display = 'none';
        const errorMsg = document.getElementById('errorMessage');
        if (errorMsg) errorMsg.textContent = '';
      }
    } catch (e) {}
  }

  // Reads whatever result infolookup.site currently has rendered.
  // `ready` is false while the compliance cells are still loading.
  function readInfolookupDomState() {
    const dncEl = document.getElementById('dncStatus');
    const litEl = document.getElementById('litigator');
    const blackEl = document.getElementById('blacklist');

    const dncText = dncEl ? dncEl.textContent.trim() : '';
    const litText = litEl ? litEl.textContent.trim() : '';
    const blackText = blackEl ? blackEl.textContent.trim() : '';

    const isLoading = (el, txt) =>
      !txt || txt === '—' || txt.toLowerCase().includes('load') || !!el?.querySelector('.loading-indicator');

    const complianceReady = !isLoading(dncEl, dncText) && !isLoading(litEl, litText) && !isLoading(blackEl, blackText);

    let personReady = false;
    let persons = [];
    const listContainer = document.getElementById('personInfoListContainer');
    const firstSection = listContainer?.querySelector('.section') || listContainer?.querySelector('.person-info');
    const personNameEl = firstSection?.querySelector('.person-name');
    const personNameText = personNameEl ? personNameEl.textContent.trim() : '';
    if (personNameText && !personNameText.toLowerCase().includes('load')) {
      personReady = true;
      const lowerName = personNameText.toLowerCase();
      persons = lowerName.includes('no result') || lowerName.includes('no owner')
        ? []
        : extractInfolookupSitePersons();
    }

    return {
      ready: complianceReady,
      personReady,
      persons,
      compliance: complianceReady
        ? {
            dnc: formatInfolookupComplianceValue(cleanText(dncText)),
            litigator: formatInfolookupComplianceValue(cleanText(litText)),
            blacklist: formatInfolookupComplianceValue(cleanText(blackText))
          }
        : null
    };
  }

  function postInfolookupResult(searchId, compliance, persons) {
    if (!port) return;
    const list = persons || [];
    port.postMessage({
      action: 'SEARCH_RESULT',
      searchId: searchId,
      source: 'infolookup.site',
      data: {
        ...compliance,
        persons: list,
        person: list[0] || null
      }
    });
  }


  /* ═══════════════════════════════════════════════════════
     SOURCE 1: INFOLOOKUP.SITE FAST SEARCH (NO RELOAD)
  ═══════════════════════════════════════════════════════ */
  async function executeInfolookupSearch(phone, searchId) {
    const start = Date.now();
    let phoneInput = null;

    // Wait for #phoneInput (already present 99% of the time)
    while (Date.now() - start < 8000) {
      phoneInput = document.getElementById('phoneInput') || document.querySelector('input[type="tel"]');
      if (phoneInput) break;
      await sleep(150);
    }

    if (!phoneInput) {
      if (port) {
        port.postMessage({
          action: 'SEARCH_RESULT',
          searchId: searchId,
          source: 'infolookup.site',
          error: 'Phone input (#phoneInput) not found.'
        });
      }
      return;
    }

    // infolookup.site blocks searching the same number twice ("This number was just searched"),
    // so clear that guard first — otherwise repeat lookups abort before any data is rendered.
    const guardCleared = resetInfolookupDuplicateGuard();

    // Clear previous results in DOM before executing new search to avoid reading stale data.
    // This is only safe when the guard was cleared, because that guarantees a fresh lookup will run
    // and repopulate the DOM. If the guard could not be cleared we deliberately leave the DOM intact
    // so the duplicate-search fallback further down still has the site's own data to read.
    if (guardCleared) {
      clearInfolookupResultsDom();
    }

    // 1. Enter phone number
    const cleanDigits = phone.replace(/\D/g, '');

    // 2. Find the search button
    const searchBtn = document.getElementById('searchButton') || document.querySelector('button#searchButton');
    if (!searchBtn) {
      if (port) {
        port.postMessage({
          action: 'SEARCH_RESULT',
          searchId: searchId,
          source: 'infolookup.site',
          error: 'Search button (#searchButton) not found.'
        });
      }
      return;
    }

    // Fills the input and triggers the site's own search handler.
    // Reusable so a retry after a duplicate-guard hit can re-submit the same number.
    function submitSearch() {
      phoneInput.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(phoneInput, cleanDigits);
      } else {
        phoneInput.value = cleanDigits;
      }
      phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
      phoneInput.dispatchEvent(new Event('change', { bubbles: true }));
      phoneInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

      try {
        phoneInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      } catch (e) {}
      searchBtn.click();
    }

    await sleep(60);
    submitSearch();

    // 3. Fast-poll for new results (100ms interval for sub-second capture)
    const searchStart = Date.now();
    const maxWaitResults = 12000;
    let compliance = null;
    let complianceReady = false;
    let complianceReadyTime = null;
    let duplicateRetries = 0;

    while (Date.now() - searchStart < maxWaitResults) {
      if (activeSearchId !== searchId) return; // Discard if user triggered a newer search

      // Check if site returned an error
      const errorDiv = document.getElementById('error');
      const errorMsg = document.getElementById('errorMessage');
      if (errorDiv && errorDiv.style.display !== 'none') {
        const errText = errorMsg?.textContent.trim() || errorDiv.textContent.trim();
        const errLower = errText ? errText.toLowerCase() : '';
        if (errText && !errLower.includes('looking up')) {
          if (errLower.includes('just searched')) {
            // Duplicate-search guard tripped. The site aborts the new lookup but deliberately keeps
            // #resultsContainer visible, so the data for this exact number is still on screen.
            if (guardCleared) {
              // A fresh lookup was expected, so the DOM is empty — force the guard off and retry once.
              if (duplicateRetries === 0) {
                duplicateRetries++;
                resetInfolookupDuplicateGuard();
                clearInfolookupResultsDom();
                submitSearch();
                continue;
              }
            } else {
              // The guard could not be cleared, but the result left on screen is this number's result.
              const dupState = readInfolookupDomState();
              if (dupState.ready) {
                postInfolookupResult(searchId, dupState.compliance, dupState.persons);
                return;
              }
            }
          }

          if (port) {
            port.postMessage({
              action: 'SEARCH_RESULT',
              searchId: searchId,
              source: 'infolookup.site',
              error: errText
            });
          }
          return;
        }
      }

      // Check compliance stats + person information
      const state = readInfolookupDomState();

      if (state.ready) {
        if (!complianceReady) {
          complianceReady = true;
          complianceReadyTime = Date.now();
        }
        compliance = state.compliance;
      }

      const personReady = state.personReady;
      const personsList = state.persons;

      // Fast return condition:
      if (complianceReady && compliance) {
        if (personReady || (complianceReadyTime && (Date.now() - complianceReadyTime > 3000))) {
          postInfolookupResult(searchId, compliance, personsList);
          return;
        }
      }

      await sleep(100);
    }

    // Fallback if loop ends
    if (complianceReady && compliance) {
      postInfolookupResult(searchId, compliance, extractInfolookupSitePersons());
      return;
    }

    if (port) {
      port.postMessage({
        action: 'SEARCH_RESULT',
        searchId: searchId,
        source: 'infolookup.site',
        error: 'Timed out waiting for infolookup.site results.'
      });
    }
  }

  function cleanAddressField(val) {
    if (!val) return '';
    const cleaned = val.replace(/\s+/g, ' ').trim();
    const lower = cleaned.toLowerCase();
    if (
      lower === 'unknown' ||
      lower === 'n/a' ||
      lower === 'none' ||
      lower === '-' ||
      lower === '—' ||
      lower === 'null' ||
      lower === 'undefined' ||
      lower.includes('no address') ||
      lower.includes('not listed') ||
      lower.includes('no record')
    ) {
      return '';
    }
    return cleaned;
  }

  // The "STATE / ZIP" column of a `.cx-addr-row` as two fields. Every shape the column has
  // been seen in is accepted: "TX 77047", "TX, 77047", "TX-77047", "Texas 77047", a bare
  // "77047" and a bare "TX". A dash placeholder cleans to nothing, so a row without a
  // location stays street-only.
  function splitStateZip(value) {
    const text = cleanAddressField(value);
    if (!text) return { state: '', zip: '' };

    const zipMatch = text.match(/(\d{5})(?:-\d{4})?\s*$/);
    const zip = zipMatch ? zipMatch[1] : '';
    const state = cleanAddressField(
      text
        .replace(/(\d{5})(?:-\d{4})?\s*$/, '')
        .replace(/[,\-|/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );

    return { state, zip };
  }

  function extractInfolookupSitePersons() {
    const listContainer = document.getElementById('personInfoListContainer');
    if (!listContainer) return [];

    // Select only top-level person sections to avoid picking up nested .person-info elements
    let sections = Array.from(listContainer.querySelectorAll(':scope > .section'));
    if (sections.length === 0) {
      // Filter out elements whose parent or ancestor is already a .section
      sections = Array.from(listContainer.querySelectorAll('.section')).filter(
        (el) => !el.parentElement || !el.parentElement.closest('.section')
      );
    }
    if (sections.length === 0) {
      sections = Array.from(listContainer.querySelectorAll('.person-info, .card')).filter(
        (el) => !el.closest('.section')
      );
    }
    if (sections.length === 0 && listContainer.children.length > 0) {
      sections = Array.from(listContainer.children).filter((el) => el.nodeType === 1);
    }

    const persons = [];
    const seenCards = new Set();

    for (const sec of sections) {
      const nameEl = sec.querySelector('.person-name');
      const name = nameEl ? nameEl.textContent.replace(/\s+/g, ' ').trim() : '';
      if (!name || name.toLowerCase().includes('load') || name.toLowerCase().includes('no result') || name.toLowerCase().includes('no owner')) {
        continue;
      }

      let avatar = sec.querySelector('.person-avatar')?.textContent.trim() || '';
      if (!avatar || avatar.length > 3 || avatar.toLowerCase().includes('fa-') || avatar === 'LO') {
        avatar = name.slice(0, 2).toUpperCase();
      }

      const age = sec.querySelector('.person-age-display')?.textContent.replace(/\s+/g, ' ').trim() || '';

      // Scan all table rows across the card for the best address and full address history
      let bestAddress = null;
      let partialAddress = null;
      const allAddresses = [];
      const seenAddrKeys = new Set();

      function addAddressRecord(street, city, state, zip, rawFull) {
        street = cleanAddressField(street);
        city = cleanAddressField(city);
        state = cleanAddressField(state);
        zip = cleanAddressField(zip);

        const cityStateZip = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
        const full = rawFull ? cleanAddressField(rawFull) : [street, cityStateZip].filter(Boolean).join(', ');

        if (!street && !city && !zip) return;

        const dedupeKey = `${street.toLowerCase().replace(/[^a-z0-9]/g, '')}|${zip || city.toLowerCase()}`;
        if (seenAddrKeys.has(dedupeKey)) return;
        seenAddrKeys.add(dedupeKey);

        const addrObj = { street, city, state, zip, full };
        allAddresses.push(addrObj);

        if (street && cityStateZip && !bestAddress) {
          bestAddress = addrObj;
        } else if (street && !bestAddress) {
          bestAddress = addrObj;
        } else if (cityStateZip && !partialAddress) {
          partialAddress = addrObj;
        }
      }

      const rows = Array.from(sec.querySelectorAll('.address-table tbody tr, .address-table tr, table tbody tr, table tr'));
      for (const row of rows) {
        if (row.querySelector('th') || row.classList.contains('header')) continue;
        const rowLower = row.textContent.toLowerCase();
        if (rowLower.includes('lives at') && rowLower.includes('city')) continue;
        if (rowLower.includes('no address') || rowLower.includes('loading')) continue;

        const tds = Array.from(row.querySelectorAll('td'));
        if (tds.length >= 4) {
          addAddressRecord(tds[0].textContent, tds[1].textContent, tds[2].textContent, tds[3].textContent);
        } else if (tds.length === 3) {
          addAddressRecord(tds[0].textContent, tds[1].textContent, '', tds[2].textContent);
        } else if (tds.length === 2) {
          const val = cleanAddressField(tds[1].textContent || tds[0].textContent);
          const m = val.match(/^(.*?)[,\n]+([^,\n]+)[,\n\s]+([A-Za-z]{2}|[A-Za-z\s]+)(?:[,\s]+(\d{5}))?/);
          if (m) {
            addAddressRecord(m[1], m[2], m[3], m[4] || '', val);
          } else if (val) {
            addAddressRecord(val, '', '', '', val);
          }
        } else if (tds.length >= 1) {
          const val = cleanAddressField(tds[tds.length - 1].textContent);
          const m = val.match(/^(.*?)[,\n]+([^,\n]+)[,\n\s]+([A-Za-z]{2}|[A-Za-z\s]+)(?:[,\s]+(\d{5}))?/);
          if (m) {
            addAddressRecord(m[1], m[2], m[3], m[4] || '', val);
          } else if (val) {
            addAddressRecord(val, '', '', '', val);
          }
        }
      }

      let address = bestAddress || partialAddress;
      if (!address && allAddresses.length > 0) address = allAddresses[0];

      // Fallback: check other address elements if table yielded no address
      if (!address) {
        const addrBlock = sec.querySelector('.address, .person-address, .location, .addr, .address-line');
        if (addrBlock) {
          const txt = cleanAddressField(addrBlock.textContent);
          if (txt) {
            address = { street: txt, full: txt };
            addAddressRecord(txt, '', '', '', txt);
          }
        }
      }

      if (address && allAddresses.length === 0) {
        allAddresses.push(address);
      }

      // Deduplicate exact same person cards
      const dedupeKey = `${name.toLowerCase()}|${age.toLowerCase()}|${address?.full || ''}`;
      if (seenCards.has(dedupeKey)) {
        continue;
      }
      seenCards.add(dedupeKey);

      persons.push({ name, avatar, age, address, allAddresses });
    }

    return persons;
  }

  function extractInfolookupSitePerson() {
    const all = extractInfolookupSitePersons();
    return all && all.length > 0 ? all[0] : null;
  }

  function formatInfolookupComplianceValue(val) {
    if (!val) return 'Clean';
    const lower = val.toLowerCase().trim();
    if (lower === 'clean' || lower === 'not listed' || lower.includes('no record') || lower === 'no') {
      return 'Clean';
    }
    if (lower.includes('federal') && lower.includes('state')) {
      return 'Federal & State DNC';
    }
    if (lower.includes('federal')) {
      return 'Federal DNC';
    }
    if (lower.includes('state')) {
      return 'State DNC';
    }
    if (lower === 'listed' || lower === 'yes') {
      return 'Listed';
    }
    return val.replace(/\b\w/g, c => c.toUpperCase());
  }

  /* ═══════════════════════════════════════════════════════
     SOURCE 2: INFOLOOKUPP.COM FAST SEARCH (NO RELOAD)
  ═══════════════════════════════════════════════════════ */
  async function executeInfolookuppSearch(phone, searchId) {
    const start = Date.now();
    let phoneInput = null;

    // The search box is `input[type="tel"]` inside `.search-input-wrap` on the current build
    // (with a "Paste" button beside it); the older build had the same input without the wrapper,
    // so both shapes are accepted.
    while (Date.now() - start < 8000) {
      phoneInput =
        document.querySelector('.search-input-wrap input[type="tel"]') ||
        document.querySelector('input[type="tel"]') ||
        document.querySelector('input[inputmode="numeric"]') ||
        document.querySelector('input[placeholder*="555"]') ||
        document.querySelector('input[maxlength="14"]');

      if (phoneInput) break;
      await sleep(150);
    }

    if (!phoneInput) {
      if (port) {
        port.postMessage({
          action: 'SEARCH_RESULT',
          searchId: searchId,
          source: sourceName,
          error: 'Phone input field was not found on infolookupp.com.'
        });
      }
      return;
    }

    const cleanDigits = phone.replace(/\D/g, '');
    phoneInput.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(phoneInput, cleanDigits);
    } else {
      phoneInput.value = cleanDigits;
    }
    phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
    phoneInput.dispatchEvent(new Event('change', { bubbles: true }));
    phoneInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    await sleep(60);

    // The control that submits the search, in every shape this build has had: an id, a submit
    // button, a class that says "search", or a button whose label says "search". The current
    // build renders the search row as `.search-input-wrap` (input + a "Paste" button), so the
    // tag/class shapes are what actually find it there.
    const findSearchButton = () => {
      const byId = document.getElementById('search-btn') || document.getElementById('searchButton');
      if (byId) return byId;

      const byType = document.querySelector('button[type="submit"], input[type="submit"]');
      if (byType) return byType;

      // A class that says "search" - but never a search-clear/reset control, which sits in the
      // same row as the input.
      const byClass = Array.from(document.querySelectorAll('button.search-btn, button.search-submit, button[class*="search-"]')).find(
        (b) => !b.classList.contains('paste-clear-btn') && !/\b(clear|paste|reset)\b/i.test((b.textContent || '').trim())
      );
      if (byClass) return byClass;

      return (
        Array.from(document.querySelectorAll('button')).find((b) => {
          const label = (b.textContent || '').trim().toLowerCase();
          if (!label.includes('search')) return false;
          // The "Paste" / "Clear" control sits in the same row and must never be the submit.
          if (b.classList.contains('paste-clear-btn') || label.includes('paste')) return false;
          return true;
        }) || null
      );
    };

    let searchBtn = findSearchButton();
    for (let attempt = 0; attempt < 10 && !searchBtn; attempt++) {
      await sleep(150);
      searchBtn = findSearchButton();
    }

    // Enter is pressed as well: the older build needed it next to the click, and a build that
    // renders no submit button searches on Enter alone. A missing button is therefore not an
    // immediate error any more - the results wait below reports a timeout if nothing was ever
    // submitted, which is the honest answer for both builds.
    try {
      phoneInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    } catch (e) {}

    if (searchBtn) {
      searchBtn.click();
    } else {
      try {
        const form = phoneInput.form || (phoneInput.closest && phoneInput.closest('form'));
        if (form && typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        }
      } catch (e) {}
    }

    const maxWaitResults = 12000;
    const searchStartTime = Date.now();
    let sawScrubbing = false;
    let scrubFinishedTime = null;

    await sleep(80);

    while (Date.now() - searchStartTime < maxWaitResults) {
      if (activeSearchId !== searchId) return;

      const bodyText = document.body.innerText || '';

      if (bodyText.includes('Running TCPA scrub') || bodyText.toLowerCase().includes('scrubbing')) {
        sawScrubbing = true;
      }

      // Compliance and owners as the current build renders them: the pills sit in
      // `.compliance-status-item` (a `.compliance-label` next to a `.status-pill`) and the owners
      // in `.cx-cards .cx-card`, each with `.cx-addr-street` / `.cx-addr-city` /
      // `.cx-addr-statezip` rows.
      const compliance = extractInfolookuppCompliance();
      const personsList = extractInfolookuppPersons();
      const person = personsList[0] || null;
      const stillScrubbing = bodyText.includes('Running TCPA scrub') || bodyText.toLowerCase().includes('scrubbing');

      if (sawScrubbing && !stillScrubbing && !scrubFinishedTime) {
        scrubFinishedTime = Date.now();
      }

      if (compliance && compliance.dnc && compliance.litigator && compliance.blacklist && !stillScrubbing) {
        const isNotPlaceholder =
          !compliance.dnc.toLowerCase().includes('scrub') &&
          !compliance.litigator.toLowerCase().includes('scrub') &&
          !compliance.blacklist.toLowerCase().includes('scrub');

        if (isNotPlaceholder) {
          if (personsList.length > 0 && personsList[0].name) {
            if (port) {
              port.postMessage({
                action: 'SEARCH_RESULT',
                searchId: searchId,
                source: sourceName,
                data: {
                  ...compliance,
                  persons: personsList,
                  person: person
                }
              });
            }
            return;
          }

          if (scrubFinishedTime && (Date.now() - scrubFinishedTime > 1500)) {
            if (port) {
              port.postMessage({
                action: 'SEARCH_RESULT',
                searchId: searchId,
                source: sourceName,
                data: {
                  ...compliance,
                  persons: personsList,
                  person: person || null
                }
              });
            }
            return;
          }
        }
      }

      if (bodyText.includes('No records found') || bodyText.includes('Invalid phone number')) {
        if (port) {
          port.postMessage({
            action: 'SEARCH_RESULT',
            searchId: searchId,
            source: sourceName,
            error: 'No records found or invalid phone number.'
          });
        }
        return;
      }

      await sleep(100);
    }

    const finalCompliance = extractInfolookuppCompliance();
    const finalPersons = extractInfolookuppPersons();

    if (finalCompliance && (finalCompliance.dnc || finalCompliance.litigator || finalCompliance.blacklist)) {
      if (port) {
        port.postMessage({
          action: 'SEARCH_RESULT',
          searchId: searchId,
          source: sourceName,
          data: {
            ...finalCompliance,
            persons: finalPersons,
            person: finalPersons[0] || null
          }
        });
      }
      return;
    }

    if (port) {
      port.postMessage({
        action: 'SEARCH_RESULT',
        searchId: searchId,
        source: sourceName,
        error: 'Timed out waiting for infolookupp.com results.'
      });
    }
  }

  // Owners as infolookupp.com renders them: `.cx-cards > .cx-card`, each holding
  // `.cx-name h3.value` (with a copy button inside that has to be stripped), `.cx-avatar`,
  // `.cx-age-badge` ("65 age (1961)") and a `.cx-addr-table` of `.cx-addr-row`s.
  function extractInfolookuppPersons() {
    const cards = Array.from(document.querySelectorAll('.cx-cards .cx-card, .cx-card'));
    if (!cards || cards.length === 0) return [];

    const persons = [];
    for (const card of cards) {
      let name = '';
      const nameEl = card.querySelector('.cx-name .value') || card.querySelector('.cx-name h3') || card.querySelector('.cx-name');
      if (nameEl) {
        const clone = nameEl.cloneNode(true);
        clone.querySelectorAll('button, svg').forEach((el) => el.remove());
        name = clone.textContent.trim();
      }

      let avatar = card.querySelector('.cx-avatar')?.textContent.trim() || '';
      if (!avatar && name) {
        avatar = name.slice(0, 2).toUpperCase();
      }
      const age = card.querySelector('.cx-age-badge')?.textContent.trim() || '';

      let bestAddress = null;
      let partialAddress = null;
      const allAddresses = [];
      const seenAddrKeys = new Set();
      const addrRows = Array.from(card.querySelectorAll('.cx-addr-table .cx-addr-row, .cx-addr-row'));

      for (const row of addrRows) {
        const street = cleanAddressField(row.querySelector('.cx-addr-street')?.textContent || '');
        const city = cleanAddressField(row.querySelector('.cx-addr-city')?.textContent || '');

        // The state and the ZIP are one "STATE / ZIP" column on the current build
        // (`.cx-addr-statezip`, e.g. "TX 77047") and two columns on the older one, so both are
        // read and the combined cell is split. A dash placeholder ("—") cleans to an empty
        // string, which is what keeps a street-only row street-only instead of
        // "8301 Tumbleweed Trl, Apt 3601, —, —".
        const stateZip = splitStateZip(row.querySelector('.cx-addr-statezip')?.textContent || '');
        const state = cleanAddressField(row.querySelector('.cx-addr-state')?.textContent || '') || stateZip.state;
        const zip = cleanAddressField(row.querySelector('.cx-addr-zip')?.textContent || '') || stateZip.zip;

        const cityStateZip = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
        const full = [street, cityStateZip].filter(Boolean).join(', ');

        if (!street && !city && !zip) continue;

        const dedupeKey = `${street.toLowerCase().replace(/[^a-z0-9]/g, '')}|${zip || city.toLowerCase()}`;
        if (seenAddrKeys.has(dedupeKey)) continue;
        seenAddrKeys.add(dedupeKey);

        const addrObj = { street, city, state, zip, full };
        allAddresses.push(addrObj);

        if (street && cityStateZip && !bestAddress) {
          bestAddress = addrObj;
        } else if (street && !bestAddress) {
          bestAddress = addrObj;
        } else if (cityStateZip && !partialAddress) {
          partialAddress = addrObj;
        }
      }

      const address = bestAddress || partialAddress;
      if (address && allAddresses.length === 0) {
        allAddresses.push(address);
      }

      if (name || age || address) {
        persons.push({ name, avatar, age, address, allAddresses });
      }
    }

    return persons;
  }

  function extractInfolookuppPerson() {
    const all = extractInfolookuppPersons();
    return all && all.length > 0 ? all[0] : null;
  }

  function extractInfolookuppCompliance() {
    let dnc = null, litigator = null, blacklist = null;
    const allElements = Array.from(document.querySelectorAll('div, tr, li, p, span, dt, dd'));

    for (const el of allElements) {
      const text = el.textContent.trim();
      if (!dnc && /^(DNC status|DNC|National DNC|State DNC)$/i.test(text)) dnc = getValueNear(el);
      if (!litigator && /^Litigator$/i.test(text)) litigator = getValueNear(el);
      if (!blacklist && /^Blacklist$/i.test(text)) blacklist = getValueNear(el);
    }

    const bodyText = document.body.innerText || '';
    if (!dnc) {
      const match = bodyText.match(/DNC(?:\s*status)?\s*[:\-]?\s*([^\n\r]+)/i);
      if (match && match[1] && !match[1].toLowerCase().includes('scrub')) dnc = cleanText(match[1]);
    }
    if (!litigator) {
      const match = bodyText.match(/Litigator\s*[:\-]?\s*([^\n\r]+)/i);
      if (match && match[1] && !match[1].toLowerCase().includes('scrub')) litigator = cleanText(match[1]);
    }
    if (!blacklist) {
      const match = bodyText.match(/Blacklist\s*[:\-]?\s*([^\n\r]+)/i);
      if (match && match[1] && !match[1].toLowerCase().includes('scrub')) blacklist = cleanText(match[1]);
    }

    if (dnc || litigator || blacklist) {
      return {
        dnc: formatInfolookuppComplianceValue(dnc || 'Clean'),
        litigator: formatInfolookuppComplianceValue(litigator || 'Clean'),
        blacklist: formatInfolookuppComplianceValue(blacklist || 'Clean')
      };
    }
    return null;
  }

  function formatInfolookuppComplianceValue(val) {
    if (!val) return 'Clean';
    const lower = val.toLowerCase().trim();
    if (lower === 'clean' || lower === 'not listed' || lower.includes('no record') || lower === 'pass' || lower === 'no') {
      return 'Clean';
    }
    if (lower.includes('federal') && lower.includes('state')) {
      return 'State & Federal DNC';
    }
    if (lower.includes('federal')) {
      return 'Federal DNC';
    }
    if (lower.includes('state')) {
      return 'State DNC';
    }
    if (lower === 'listed' || lower.includes('flagged') || lower === 'yes') {
      return 'Flagged';
    }
    return val.replace(/\b\w/g, c => c.toUpperCase());
  }

  function getValueNear(labelEl) {
    let next = labelEl.nextElementSibling;
    if (next && next.textContent.trim()) return cleanText(next.textContent.trim());

    const parent = labelEl.parentElement;
    if (parent) {
      const children = Array.from(parent.children);
      const idx = children.indexOf(labelEl);
      if (idx !== -1 && idx + 1 < children.length) {
        const val = children[idx + 1].textContent.trim();
        if (val) return cleanText(val);
      }
      if (parent.nextElementSibling && parent.nextElementSibling.textContent.trim()) {
        return cleanText(parent.nextElementSibling.textContent.trim());
      }
    }
    return null;
  }

  function cleanText(val) {
    if (!val) return '';
    let cleaned = val.replace(/^[•\s:\-]+/, '').trim();
    cleaned = cleaned.replace(/^(check-circle|info-circle|fas|fa|exclamation-circle)\s*/i, '');
    const firstLine = cleaned.split(/[\r\n]+/)[0].trim();
    return firstLine;
  }
})();
