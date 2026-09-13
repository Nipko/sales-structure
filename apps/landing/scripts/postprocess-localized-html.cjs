const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out');
const LOCALES = ['es', 'en', 'pt', 'fr'];

if (!fs.existsSync(OUT)) throw new Error('landing export is missing; run next build first');

let changed = 0;
let checked = 0;
for (const locale of LOCALES) {
  const candidates = fs.readdirSync(OUT, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
    .map(entry => path.join(entry.parentPath ?? entry.path, entry.name))
    .filter(file => {
      const relative = path.relative(OUT, file).replaceAll('\\', '/');
      return relative === `${locale}.html` || relative.startsWith(`${locale}/`);
    });
  if (!candidates.length) throw new Error(`no exported HTML found for /${locale}`);
  for (const file of candidates) {
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(/<html lang="[^"]*"/, `<html lang="${locale}"`);
    if (!after.startsWith('<!DOCTYPE html>') || !after.includes(`<html lang="${locale}"`)) {
      throw new Error(`${path.relative(OUT, file)} does not carry lang=${locale}`);
    }
    if (after !== before) {
      fs.writeFileSync(file, after);
      changed += 1;
    }
    checked += 1;
  }
}
console.log(`Localized export verified: ${checked} HTML documents; ${changed} language attributes corrected.`);
