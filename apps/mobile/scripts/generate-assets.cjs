/**
 * Genera los assets de la app (icon, adaptive-icon, adaptive-bg, splash) a partir
 * del LOGO REAL de Parallly.
 *
 *   - El "loguito" = la marca azul (#3897f0) que forma la doble-l de "Parallly".
 *     Se usa SOLO el loguito como símbolo del ícono de la app (sin texto, porque
 *     las máscaras de Android recortan el texto).
 *   - El splash usa el lockup completo "Parallly" (loguito azul + letras blancas)
 *     sobre el fondo oscuro de marca.
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

// Logo blanco oficial (loguito azul + wordmark blanco) para el splash sobre oscuro.
const WHITE_LOGO = path.resolve(__dirname, '../../dashboard/public/parallly-logo-white.svg');

const BRAND_BLUE = '#3897f0';
const DARK = '#0a0a12';

// ── El loguito real (marca azul que forma la "ll" de Parallly) ────────────────
// Path extraído del logo oficial. Bounding box ≈ x:[768,982] y:[42,255] (casi cuadrado).
const LOGUITO_PATH =
    'M 872.867188 42.34375 C 868.5 42.859375 865.835938 44.144531 860.730469 48.222656 C 852.960938 54.417969 841.722656 63.28125 840.40625 64.246094 C 840.082031 64.46875 831.027344 65.785156 816.355469 67.746094 C 812.46875 68.257812 808.582031 68.867188 807.683594 69.09375 C 801.9375 70.667969 797.183594 75.324219 795.160156 81.359375 C 794.871094 82.226562 794.359375 85.179688 794.003906 87.941406 C 792.398438 100.722656 790.503906 113.695312 790.183594 114.304688 C 789.863281 114.882812 781.644531 125.382812 778.433594 129.265625 C 769.957031 139.605469 768.253906 142.882812 768.253906 148.789062 C 768.253906 153.765625 769.667969 157.492188 773.261719 162.050781 C 776.089844 165.648438 783.152344 174.542969 786.910156 179.230469 C 789.511719 182.507812 790.472656 183.984375 790.601562 184.851562 C 790.730469 185.492188 791.660156 192.554688 792.753906 200.488281 C 793.972656 209.734375 794.90625 215.675781 795.355469 216.929688 C 797.121094 222.195312 802 227.011719 807.203125 228.617188 C 808.359375 228.96875 811.472656 229.546875 814.105469 229.867188 C 838.992188 233.113281 839.859375 233.238281 841.078125 234.105469 C 842.171875 234.878906 844.898438 237.027344 858.097656 247.527344 C 860.570312 249.488281 863.589844 251.765625 864.777344 252.570312 C 868.917969 255.332031 873.925781 256.390625 878.488281 255.429688 C 882.660156 254.5625 884.878906 253.148438 896.628906 243.804688 C 902.632812 239.050781 908.0625 234.75 908.734375 234.265625 C 909.828125 233.433594 910.5 233.304688 919.171875 232.117188 C 924.246094 231.441406 930.957031 230.574219 934.039062 230.1875 C 943.09375 229.097656 946.367188 227.8125 950.253906 223.929688 C 954.074219 220.074219 955.101562 217.378906 956.320312 207.710938 C 958.214844 192.941406 959.4375 184.398438 959.695312 183.757812 C 959.855469 183.371094 962.292969 180.195312 965.089844 176.695312 C 979.988281 158.070312 979.3125 159 980.789062 154.921875 C 982.011719 151.648438 982.171875 147.988281 981.273438 144.488281 C 980.148438 139.992188 979.921875 139.640625 964.605469 120.535156 C 962.328125 117.707031 960.238281 115.042969 959.984375 114.59375 C 959.4375 113.757812 959.308594 112.988281 956.996094 95.488281 C 955.199219 81.90625 955.132812 81.617188 953.5625 78.40625 C 952.566406 76.316406 951.792969 75.289062 949.933594 73.523438 C 945.886719 69.703125 944.054688 69.0625 933.554688 67.710938 C 929.511719 67.167969 925.816406 66.683594 925.367188 66.589844 C 924.917969 66.492188 921.355469 66.011719 917.4375 65.464844 C 913.488281 64.949219 909.957031 64.339844 909.570312 64.148438 C 908.800781 63.761719 907.128906 62.445312 893.417969 51.527344 C 885.292969 45.042969 882.789062 43.46875 879.449219 42.699219 C 877.332031 42.21875 875.050781 42.121094 872.867188 42.34375 Z M 900.898438 111.445312 L 906.101562 115.84375 L 900.226562 122.8125 C 894.800781 129.300781 889.246094 136.011719 876.59375 151.328125 C 873.832031 154.699219 871.003906 158.070312 870.300781 158.90625 C 869.59375 159.707031 868.082031 161.507812 866.925781 162.917969 C 865.804688 164.332031 864.777344 165.550781 864.679688 165.648438 C 864.550781 165.746094 861.757812 169.117188 858.417969 173.195312 C 846.539062 187.644531 843.808594 190.949219 843.328125 191.335938 C 842.8125 191.753906 840.886719 190.019531 827.753906 177.367188 C 825.378906 175.054688 819.566406 169.535156 814.8125 165.070312 L 806.238281 156.945312 L 811.890625 150.84375 L 817.542969 144.777344 L 825.472656 152.417969 C 829.808594 156.625 835.234375 161.828125 837.515625 163.976562 L 841.65625 167.863281 L 849.011719 158.96875 C 856.203125 150.300781 869.144531 134.695312 885.519531 114.976562 L 893.609375 105.25 L 894.671875 106.148438 C 895.25 106.628906 898.074219 109.039062 900.898438 111.445312 Z M 933.941406 106.628906 C 934.617188 107.207031 935.515625 108.011719 935.964844 108.363281 C 941.421875 113.019531 944.472656 115.75 944.472656 115.941406 C 944.472656 116.230469 938.726562 123.230469 924.566406 140.25 C 915.15625 151.582031 906.90625 161.570312 898.265625 172.070312 C 897.207031 173.386719 895.667969 175.183594 894.863281 176.082031 C 894.0625 176.984375 891.171875 180.449219 888.441406 183.789062 C 885.710938 187.128906 882.949219 190.40625 882.339844 191.078125 L 881.214844 192.265625 L 875.789062 187.484375 C 872.773438 184.851562 870.074219 182.410156 869.722656 182.089844 C 869.078125 181.414062 869.078125 181.414062 884.425781 163.078125 C 885.519531 161.761719 887.863281 158.9375 889.628906 156.816406 C 891.363281 154.699219 896.339844 148.695312 900.675781 143.492188 C 905.011719 138.289062 913.230469 128.367188 918.945312 121.496094 C 932.527344 105.089844 932.109375 105.601562 932.433594 105.601562 C 932.59375 105.601562 933.265625 106.082031 933.941406 106.628906 Z M 933.941406 106.628906';

/** SVG con sólo el loguito (transparente), renderizado grande para recortar luego. */
function loguitoSvg(size, fill) {
    return `<svg width="${size}" height="${size}" viewBox="765 39 220 220" xmlns="http://www.w3.org/2000/svg">
  <path fill="${fill}" fill-rule="nonzero" d="${LOGUITO_PATH}"/>
</svg>`;
}

/** Fondo oscuro de marca con un glow morado radial suave. */
function glowBg(w, h, cx, cy, r, centerColor) {
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="${cx}%" cy="${cy}%" r="${r}%">
      <stop offset="0%" stop-color="${centerColor}"/>
      <stop offset="55%" stop-color="#13111d"/>
      <stop offset="100%" stop-color="${DARK}"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${DARK}"/>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
</svg>`;
}

const center = (canvas, el) => Math.round((canvas - el) / 2);

/** Renderiza el loguito grande, recorta el transparente y lo escala a `targetW`. */
async function loguito(targetW, fill = BRAND_BLUE) {
    return sharp(Buffer.from(loguitoSvg(1600, fill)))
        .trim()
        .resize({ width: targetW })
        .png()
        .toBuffer({ resolveWithObject: true });
}

async function buildIcon() {
    const bg = await sharp(Buffer.from(glowBg(1024, 1024, 50, 46, 60, '#2b2168'))).png().toBuffer();
    const { data, info } = await loguito(560);
    await sharp(bg)
        .composite([{ input: data, left: center(1024, info.width), top: center(1024, info.height) }])
        .png()
        .toFile(path.join(OUT, 'icon.png'));
    console.log('✓ icon.png (loguito sobre fondo de marca + glow)');
}

async function buildAdaptive() {
    // Foreground: loguito transparente, dentro de la zona segura (~46% del lienzo).
    const { data, info } = await loguito(470);
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: data, left: center(1024, info.width), top: center(1024, info.height) }])
        .png()
        .toFile(path.join(OUT, 'adaptive-icon.png'));
    console.log('✓ adaptive-icon.png (loguito centrado, zona segura)');

    // Background del adaptive icon (Android 8+): mismo glow de marca.
    await sharp(Buffer.from(glowBg(1024, 1024, 50, 50, 62, '#2b2168'))).png().toFile(path.join(OUT, 'adaptive-bg.png'));
    console.log('✓ adaptive-bg.png (fondo de marca + glow)');
}

async function buildSplash() {
    const W = 1242, H = 2436;
    const bg = await sharp(Buffer.from(glowBg(W, H, 50, 46, 40, '#1b1640'))).png().toBuffer();
    // Lockup completo "Parallly" (loguito azul + letras blancas) desde el SVG oficial.
    const { data, info } = await sharp(fs.readFileSync(WHITE_LOGO), { density: 400 })
        .trim()
        .resize({ width: 840 })
        .png()
        .toBuffer({ resolveWithObject: true });
    await sharp(bg)
        .composite([{ input: data, left: center(W, info.width), top: center(H, info.height) }])
        .png()
        .toFile(path.join(OUT, 'splash.png'));
    console.log('✓ splash.png (lockup Parallly centrado sobre oscuro)');
}

async function buildWordmark() {
    // Lockup "Parallly" transparente (blanco + loguito azul) para usar dentro de la app
    // (ej. cabecera del login sobre fondo oscuro).
    await sharp(fs.readFileSync(WHITE_LOGO), { density: 400 })
        .trim()
        .resize({ width: 720 })
        .png()
        .toFile(path.join(OUT, 'logo-wordmark.png'));
    console.log('✓ logo-wordmark.png (lockup transparente para in-app)');
}

(async () => {
    await buildIcon();
    await buildAdaptive();
    await buildSplash();
    await buildWordmark();
    console.log('\nAssets generados en apps/mobile/assets/');
})().catch((e) => { console.error(e); process.exit(1); });
