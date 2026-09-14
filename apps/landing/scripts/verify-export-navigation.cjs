const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../out');
const files = fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
  .map(entry => path.join(entry.parentPath ?? entry.path, entry.name))
  .filter(file => /^(es|en|pt|fr)(\/|\.html)/.test(path.relative(root, file).replaceAll('\\', '/')));
const cache = new Map();
const failures = [];
let checked = 0;
function documentAt(file) {
  if (!cache.has(file)) cache.set(file, fs.readFileSync(file, 'utf8'));
  return cache.get(file);
}
function resolveFile(route) {
  const stem = path.join(root, decodeURIComponent(route));
  return [stem, `${stem}.html`, path.join(stem, 'index.html')].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
}
function decodeAttribute(value) { return value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"'); }
for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const html = documentAt(file);
  const route = `/${relative.replace(/\.html$/, '').replace(/\/index$/, '')}`;
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) failures.push(`${route}: duplicate element IDs`);
  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
    const href = decodeAttribute(match[1]);
    if (!href || /^(mailto:|tel:|https?:|javascript:)/.test(href)) continue;
    const url = new URL(href, `https://export.test${route}`);
    const destination = resolveFile(url.pathname);
    if (!destination) { failures.push(`${route}: missing target ${href}`); continue; }
    if (url.hash && destination.endsWith('.html')) {
      const id = decodeURIComponent(url.hash.slice(1));
      if (!documentAt(destination).includes(`id="${id}"`)) failures.push(`${route}: missing anchor ${href}`);
    }
    checked += 1;
  }
}
if (failures.length) { console.error([...new Set(failures)].join('\n')); process.exit(1); }
console.log(`Export navigation passed: ${checked} local links across ${files.length} localized HTML documents; no missing anchors or duplicate IDs.`);
