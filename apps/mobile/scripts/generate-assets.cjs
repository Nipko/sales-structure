/**
 * Genera los assets de la app (icon, adaptive-icon, splash) a partir de SVG.
 * Diseño: burbuja de chat (IA conversacional) sobre el morado de marca. Sin fuentes.
 *
 * Uso:  node apps/mobile/scripts/generate-assets.cjs
 * Requiere `sharp` (está en el node_modules del root del monorepo).
 */
const path = require('path');
const fs = require('fs');

// sharp del root del monorepo
const sharp = require(path.resolve(__dirname, '../../../node_modules/sharp'));

const OUT = path.resolve(__dirname, '../assets');
fs.mkdirSync(OUT, { recursive: true });

const ACCENT = '#6c5ce7';
const ACCENT2 = '#8b7cf0';
const DARK = '#0a0a12';

/** Burbuja de chat con 3 puntos. cx/cy centro, w ancho. */
function bubble(cx, cy, w, fill, dot) {
    const h = w * 0.7;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const r = w * 0.16;
    const dotR = w * 0.07;
    const tail = `M ${x + w * 0.28} ${y + h - 2} L ${x + w * 0.12} ${y + h + w * 0.18} L ${x + w * 0.52} ${y + h - 2} Z`;
    return `
    <path d="${tail}" fill="${fill}"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"/>
    <circle cx="${cx - w * 0.22}" cy="${cy}" r="${dotR}" fill="${dot}"/>
    <circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${dot}"/>
    <circle cx="${cx + w * 0.22}" cy="${cy}" r="${dotR}" fill="${dot}"/>`;
}

// 1) ICON 1024 — cuadrado con gradiente morado + burbuja blanca
const iconSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${ACCENT}"/><stop offset="1" stop-color="${ACCENT2}"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  ${bubble(512, 470, 540, '#ffffff', ACCENT)}
</svg>`;

// 2) ADAPTIVE FOREGROUND 1024 — transparente, burbuja blanca centrada (zona segura)
const adaptiveSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${bubble(512, 500, 430, '#ffffff', ACCENT)}
</svg>`;

// 3) SPLASH 1242x2436 — fondo oscuro + burbuja morada con puntos blancos
const splashSvg = `<svg width="1242" height="2436" viewBox="0 0 1242 2436" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${ACCENT}"/><stop offset="1" stop-color="${ACCENT2}"/>
  </linearGradient></defs>
  <rect width="1242" height="2436" fill="${DARK}"/>
  ${bubble(621, 1150, 420, 'url(#g2)', '#ffffff')}
</svg>`;

async function render(svg, file) {
    await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, file));
    console.log('✓', file);
}

(async () => {
    await render(iconSvg, 'icon.png');
    await render(adaptiveSvg, 'adaptive-icon.png');
    await render(splashSvg, 'splash.png');
    console.log('Assets generados en apps/mobile/assets/');
})();
