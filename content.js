// Content Script injected into https://vibegenx.com/infolookup AND https://infolookup.site/
// Runs concurrently inside persistent headless background iframes

(function () {
  // Only execute when running inside an embedded iframe (background automation)
  if (window.self === window.top) {
    return;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const host = window.location.hostname.toLowerCase();
  const sourceName = host.includes('infolookup') ? 'infolookup.site' : 'vibegenx.com';

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
            await executeVibegenxSearch(msg.phone, msg.searchId);
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

    // Reset infolookup.site's consecutive search restriction (allows searching the same number repeatedly)
    try {
      const resetScript = document.createElement('script');
      resetScript.textContent = 'window.lastSearchedNumber = "";';
      document.documentElement.appendChild(resetScript);
      resetScript.remove();
    } catch (e) {}

    // Clear previous results in DOM before executing new search to avoid reading stale data
    try {
      const oldDnc = document.getElementById('dncStatus');
      if (oldDnc) oldDnc.textContent = '—';
      const oldLit = document.getElementById('litigator');
      if (oldLit) oldLit.textContent = '—';
      const oldBlack = document.getElementById('blacklist');
      if (oldBlack) oldBlack.textContent = '—';
      const oldList = document.getElementById('personInfoListContainer');
      if (oldList) oldList.innerHTML = '';
    } catch (e) {}

    // 1. Enter phone number
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

    // 2. Find and click #searchButton
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

    try {
      phoneInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    } catch (e) {}
    searchBtn.click();

    // 3. Fast-poll for new results (100ms interval for sub-second capture)
    const searchStart = Date.now();
    const maxWaitResults = 12000;
    let compliance = null;
    let person = null;
    let complianceReady = false;
    let complianceReadyTime = null;

    await sleep(80);

    while (Date.now() - searchStart < maxWaitResults) {
      if (activeSearchId !== searchId) return; // Discard if user triggered a newer search

      // Check if site returned an error
      const errorDiv = document.getElementById('error');
      const errorMsg = document.getElementById('errorMessage');
      if (errorDiv && errorDiv.style.display !== 'none') {
        const errText = errorMsg?.textContent.trim() || errorDiv.textContent.trim();
        if (errText && !errText.toLowerCase().includes('looking up')) {
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

      // Check compliance stats
      const dncEl = document.getElementById('dncStatus');
      const litEl = document.getElementById('litigator');
      const blackEl = document.getElementById('blacklist');

      const dncText = dncEl ? dncEl.textContent.trim() : '';
      const litText = litEl ? litEl.textContent.trim() : '';
      const blackText = blackEl ? blackEl.textContent.trim() : '';

      const dncLoading = !dncText || dncText === '—' || dncText.toLowerCase().includes('load') || !!dncEl?.querySelector('.loading-indicator');
      const litLoading = !litText || litText === '—' || litText.toLowerCase().includes('load') || !!litEl?.querySelector('.loading-indicator');
      const blackLoading = !blackText || blackText === '—' || blackText.toLowerCase().includes('load') || !!blackEl?.querySelector('.loading-indicator');

      if (!dncLoading && !litLoading && !blackLoading) {
        if (!complianceReady) {
          complianceReady = true;
          complianceReadyTime = Date.now();
        }
        compliance = {
          dnc: formatInfolookupComplianceValue(cleanText(dncText)),
          litigator: formatInfolookupComplianceValue(cleanText(litText)),
          blacklist: formatInfolookupComplianceValue(cleanText(blackText))
        };
      }

      // Check person information
      const listContainer = document.getElementById('personInfoListContainer');
      const firstSection = listContainer?.querySelector('.section') || listContainer?.querySelector('.person-info');
      const personNameEl = firstSection?.querySelector('.person-name');
      const personNameText = personNameEl ? personNameEl.textContent.trim() : '';

      let personReady = false;
      let personsList = [];
      if (personNameText) {
        if (!personNameText.toLowerCase().includes('load')) {
          personReady = true;
          if (personNameText.toLowerCase().includes('no result') || personNameText.toLowerCase().includes('no owner')) {
            personsList = [];
          } else {
            personsList = extractInfolookupSitePersons();
          }
        }
      }

      // Fast return condition:
      if (complianceReady && compliance) {
        if (personReady || (complianceReadyTime && (Date.now() - complianceReadyTime > 3000))) {
          if (port) {
            port.postMessage({
              action: 'SEARCH_RESULT',
              searchId: searchId,
              source: 'infolookup.site',
              data: {
                ...compliance,
                persons: personsList,
                person: personsList[0] || null
              }
            });
          }
          return;
        }
      }

      await sleep(100);
    }

    // Fallback if loop ends
    if (complianceReady && compliance) {
      const fallbackPersons = extractInfolookupSitePersons();
      if (port) {
        port.postMessage({
          action: 'SEARCH_RESULT',
          searchId: searchId,
          source: 'infolookup.site',
          data: {
            ...compliance,
            persons: fallbackPersons,
            person: fallbackPersons[0] || null
          }
        });
      }
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
     SOURCE 2: VIBEGENX.COM FAST SEARCH (NO RELOAD)
  ═══════════════════════════════════════════════════════ */
  async function executeVibegenxSearch(phone, searchId) {
    const start = Date.now();
    let phoneInput = null;

    while (Date.now() - start < 8000) {
      phoneInput =
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
          source: 'vibegenx.com',
          error: 'Phone input field was not found on Vibegenx.'
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

    let searchBtn =
      document.getElementById('search-btn') ||
      document.querySelector('button#search-btn') ||
      Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent.trim().toLowerCase().includes('search')
      );

    if (!searchBtn) {
      if (port) {
        port.postMessage({
          action: 'SEARCH_RESULT',
          searchId: searchId,
          source: 'vibegenx.com',
          error: 'Search button was not found on Vibegenx.'
        });
      }
      return;
    }

    try {
      phoneInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    } catch (e) {}
    searchBtn.click();

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

      const compliance = extractVibegenxCompliance();
      const personsList = extractVibegenxPersons();
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
                source: 'vibegenx.com',
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
                source: 'vibegenx.com',
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
            source: 'vibegenx.com',
            error: 'No records found or invalid phone number.'
          });
        }
        return;
      }

      await sleep(100);
    }

    const finalCompliance = extractVibegenxCompliance();
    const finalPersons = extractVibegenxPersons();

    if (finalCompliance && (finalCompliance.dnc || finalCompliance.litigator || finalCompliance.blacklist)) {
      if (port) {
        port.postMessage({
          action: 'SEARCH_RESULT',
          searchId: searchId,
          source: 'vibegenx.com',
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
        source: 'vibegenx.com',
        error: 'Timed out waiting for Vibegenx results.'
      });
    }
  }

  function extractVibegenxPersons() {
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
        const state = cleanAddressField(row.querySelector('.cx-addr-state')?.textContent || '');
        const zip = cleanAddressField(row.querySelector('.cx-addr-zip')?.textContent || '');

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

  function extractVibegenxPerson() {
    const all = extractVibegenxPersons();
    return all && all.length > 0 ? all[0] : null;
  }

  function extractVibegenxCompliance() {
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
        dnc: formatVibegenxComplianceValue(dnc || 'Clean'),
        litigator: formatVibegenxComplianceValue(litigator || 'Clean'),
        blacklist: formatVibegenxComplianceValue(blacklist || 'Clean')
      };
    }
    return null;
  }

  function formatVibegenxComplianceValue(val) {
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
