const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const MOBILE_ROOT = path.resolve(__dirname, '..');

// Geometry copied from the canonical Parallly vector mark. The master badge
// occupies this box; mapping it to the detected blue badge preserves the exact
// proportions of every existing raster asset.
const MASTER_BOX = {
    x: 807.800781,
    y: 106.003906,
    width: 214.824219,
    height: 214.957031,
};

const CHECK_ONE = `
M 941.011719 175.398438
L 946.234375 179.816406
L 940.332031 186.8125
C 934.882812 193.328125 929.304688 200.066406 916.597656 215.449219
C 913.824219 218.835938 910.988281 222.21875 910.277344 223.058594
C 909.570312 223.863281 908.054688 225.671875 906.894531 227.089844
C 905.765625 228.507812 904.734375 229.734375 904.636719 229.832031
C 904.507812 229.925781 901.703125 233.3125 898.347656 237.410156
C 886.417969 251.917969 883.675781 255.242188 883.191406 255.628906
C 882.675781 256.046875 880.742188 254.304688 867.550781 241.601562
C 865.164062 239.277344 859.328125 233.730469 854.558594 229.25
L 845.945312 221.089844
L 851.621094 214.964844
L 857.296875 208.871094
L 865.261719 216.542969
C 869.617188 220.769531 875.066406 225.992188 877.355469 228.152344
L 881.515625 232.054688
L 888.898438 223.121094
C 896.121094 214.417969 909.117188 198.746094 925.5625 178.945312
L 933.691406 169.175781
L 934.753906 170.078125
C 935.335938 170.5625 938.171875 172.980469 941.011719 175.398438
Z`;

const CHECK_TWO = `
M 974.191406 170.5625
C 974.867188 171.140625 975.773438 171.949219 976.222656 172.300781
C 981.707031 176.976562 984.769531 179.71875 984.769531 179.914062
C 984.769531 180.203125 978.996094 187.230469 964.777344 204.324219
C 955.328125 215.707031 947.039062 225.734375 938.367188 236.28125
C 937.300781 237.601562 935.753906 239.40625 934.949219 240.308594
C 934.140625 241.214844 931.238281 244.695312 928.5 248.050781
C 925.757812 251.402344 922.984375 254.691406 922.371094 255.371094
L 921.242188 256.5625
L 915.792969 251.757812
C 912.761719 249.113281 910.054688 246.664062 909.699219 246.339844
C 909.054688 245.664062 909.054688 245.664062 924.46875 227.25
C 925.5625 225.929688 927.917969 223.089844 929.691406 220.960938
C 931.433594 218.835938 936.429688 212.804688 940.785156 207.578125
C 945.136719 202.355469 953.394531 192.390625 959.132812 185.492188
C 972.773438 169.011719 972.355469 169.527344 972.675781 169.527344
C 972.835938 169.527344 973.515625 170.011719 974.191406 170.5625
Z`;

const TARGETS = [
    'assets/icon.png',
    'assets/adaptive-icon.png',
    'assets/splash.png',
    'assets/logo-wordmark.png',
    'store-assets/play-icon-512.png',
    'store-assets/play-feature-graphic-1024x500.png',
];

function isBrandBlue(r, g, b, a) {
    return a > 80 && b > 160 && g > 80 && b > r * 1.4;
}

async function findBadgeBox(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mask = new Uint8Array(info.width * info.height);

    for (let pixel = 0; pixel < mask.length; pixel += 1) {
        const offset = pixel * 4;
        if (isBrandBlue(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) {
            mask[pixel] = 1;
        }
    }

    const components = [];
    const stack = [];
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let pixel = 0; pixel < mask.length; pixel += 1) {
        if (mask[pixel] !== 1) continue;
        mask[pixel] = 2;
        stack.push(pixel);
        let count = 0;
        let minX = info.width;
        let minY = info.height;
        let maxX = -1;
        let maxY = -1;

        while (stack.length) {
            const current = stack.pop();
            const x = current % info.width;
            const y = Math.floor(current / info.width);
            count += 1;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);

            for (const [dx, dy] of neighbors) {
                const nextX = x + dx;
                const nextY = y + dy;
                if (nextX < 0 || nextY < 0 || nextX >= info.width || nextY >= info.height) continue;
                const next = nextY * info.width + nextX;
                if (mask[next] !== 1) continue;
                mask[next] = 2;
                stack.push(next);
            }
        }

        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const aspect = width / height;
        if (count > 100 && aspect > 0.75 && aspect < 1.25) {
            components.push({ count, minX, minY, maxX, maxY, width, height });
        }
    }

    components.sort((a, b) => b.count - a.count);
    if (!components.length) throw new Error(`No square blue badge found in ${file}`);
    return components[0];
}

function whiteChecksSvg(width, height) {
    return Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"
             viewBox="${MASTER_BOX.x} ${MASTER_BOX.y} ${MASTER_BOX.width} ${MASTER_BOX.height}"
             preserveAspectRatio="none">
          <path fill="#ffffff" d="${CHECK_ONE}" />
          <path fill="#ffffff" d="${CHECK_TWO}" />
        </svg>
    `);
}

async function refreshAsset(relativePath) {
    const file = path.join(MOBILE_ROOT, relativePath);
    const badge = await findBadgeBox(file);
    const output = await sharp(file)
        .composite([{
            input: whiteChecksSvg(badge.width, badge.height),
            left: badge.minX,
            top: badge.minY,
        }])
        .png()
        .toBuffer();
    await fs.writeFile(file, output);
    console.log(`${relativePath}: badge ${badge.width}x${badge.height} at ${badge.minX},${badge.minY}`);
}

(async () => {
    for (const target of TARGETS) await refreshAsset(target);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
