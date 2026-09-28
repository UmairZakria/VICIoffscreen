// Throwaway probe 3: isolate what makes Nominatim return 403, because a Chrome
// extension cannot override the User-Agent header.
// Run: node scratch/nominatim_ua_probe.js

const url =
  'https://nominatim.openstreetmap.org/search?' +
  new URLSearchParams({ q: '3724 Kildare Dr', format: 'jsonv2', addressdetails: '1', limit: '1', countrycodes: 'us' });

const cases = [
  ['plain (undici default UA)', {}],
  ['browser-like UA only', { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36' }],
  ['custom UA only', { 'User-Agent': 'dnc-lookup-extension-probe/1.0' }],
  ['node UA only', { 'User-Agent': 'node' }],
  ['browser UA + Origin chrome-extension', {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36',
    Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
  }],
  ['browser UA + Origin + Referer infolookupp', {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36',
    Origin: 'https://infolookupp.com',
    Referer: 'https://infolookupp.com/',
  }],
];

(async () => {
  for (const [label, headers] of cases) {
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      let info;
      try {
        const data = JSON.parse(text);
        info = data.length ? data[0].display_name : 'no results';
      } catch (e) {
        info = text.slice(0, 90).replace(/\s+/g, ' ');
      }
      console.log(`${String(res.status).padEnd(4)} ${label.padEnd(42)} -> ${info}`);
    } catch (e) {
      console.log(`ERR  ${label.padEnd(42)} -> ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
})();
