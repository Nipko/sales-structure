const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'public', 'sitemap.xml');
const SITE = 'https://parallly-chat.cloud';
const LOCALES = ['es', 'en', 'pt', 'fr'];
const STATIC = [
  '/', '/precios', '/costos-whatsapp', '/comparar/meta-business-agent', '/soluciones',
  '/producto', '/producto/agente-ia', '/producto/canales', '/producto/reservas',
  '/producto/crm', '/producto/app-android', '/support', '/privacy', '/terms',
  '/data-policy', '/data-deletion', '/producto/conocimiento', '/producto/parallly-assist', '/producto/calidad',
];

const verticalSource = fs.readFileSync(path.join(ROOT, 'src', 'data', 'verticals.ts'), 'utf8');
const slugs = [...verticalSource.matchAll(/^\s*slug:\s*"([^"]+)"/gm)].map(match => match[1]);
if (new Set(slugs).size !== 18) throw new Error(`expected 18 vertical slugs, found ${new Set(slugs).size}`);
const paths = [...STATIC, ...[...new Set(slugs)].map(slug => `/soluciones/${slug}`)];
const url = (locale, route) => `${SITE}/${locale}${route === '/' ? '' : route}`;
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

const rows = [];
for (const route of paths) {
  for (const locale of LOCALES) {
    rows.push('  <url>');
    rows.push(`    <loc>${escape(url(locale, route))}</loc>`);
    for (const alternate of LOCALES) {
      rows.push(`    <xhtml:link rel="alternate" hreflang="${alternate}" href="${escape(url(alternate, route))}" />`);
    }
    rows.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escape(url('es', route))}" />`);
    rows.push(`    <changefreq>${route === '/' ? 'weekly' : route.startsWith('/privacy') || route.startsWith('/terms') || route.startsWith('/data-') ? 'yearly' : 'monthly'}</changefreq>`);
    rows.push(`    <priority>${route === '/' ? '1.0' : route === '/precios' || route === '/soluciones' ? '0.9' : '0.7'}</priority>`);
    rows.push('  </url>');
  }
}
const output = ['<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...rows, '</urlset>', ''].join('\n');

if (process.argv.includes('--check')) {
  const stored = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8').replaceAll('\r\n', '\n') : '';
  if (stored !== output) {
    console.error('sitemap.xml is stale: run node scripts/generate-localized-sitemap.cjs');
    process.exit(1);
  }
  console.log(`Localized sitemap matches ${paths.length} routes × ${LOCALES.length} languages.`);
} else {
  fs.writeFileSync(OUTPUT, output);
  console.log(`Wrote ${paths.length * LOCALES.length} localized URLs to ${OUTPUT}.`);
}
