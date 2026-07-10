/**
 * Minimal ZIP writer (STORED / uncompressed) with no external dependency, so the
 * fiscal email can deliver the XML + PDF as a single .zip (the standard way
 * Colombian e-invoices are delivered) without touching package-lock.json.
 */

const CRC_TABLE: number[] = (() => {
    const t: number[] = new Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf: Buffer): number {
    let crc = ~0;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
    return (~crc) >>> 0;
}

export interface ZipEntry {
    name: string;
    data: Buffer;
}

/** Build a valid .zip Buffer from the given entries (no compression). */
export function createZip(entries: ZipEntry[]): Buffer {
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    const dosTime = 0;
    const dosDate = 0x0021; // 1980-01-01 (fixed; avoids timezone dependence)

    for (const e of entries) {
        const nameBuf = Buffer.from(e.name, 'utf8');
        const crc = crc32(e.data);
        const size = e.data.length;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); // local file header signature
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt16LE(0, 6); // flags
        local.writeUInt16LE(0, 8); // compression = stored
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(size, 18); // compressed size
        local.writeUInt32LE(size, 22); // uncompressed size
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28); // extra length
        parts.push(local, nameBuf, e.data);

        const cen = Buffer.alloc(46);
        cen.writeUInt32LE(0x02014b50, 0); // central dir header signature
        cen.writeUInt16LE(20, 4); // version made by
        cen.writeUInt16LE(20, 6); // version needed
        cen.writeUInt16LE(0, 8); // flags
        cen.writeUInt16LE(0, 10); // compression
        cen.writeUInt16LE(dosTime, 12);
        cen.writeUInt16LE(dosDate, 14);
        cen.writeUInt32LE(crc, 16);
        cen.writeUInt32LE(size, 20);
        cen.writeUInt32LE(size, 24);
        cen.writeUInt16LE(nameBuf.length, 28);
        cen.writeUInt16LE(0, 30); // extra length
        cen.writeUInt16LE(0, 32); // comment length
        cen.writeUInt16LE(0, 34); // disk number start
        cen.writeUInt16LE(0, 36); // internal attrs
        cen.writeUInt32LE(0, 38); // external attrs
        cen.writeUInt32LE(offset, 42); // local header offset
        central.push(cen, nameBuf);

        offset += local.length + nameBuf.length + size;
    }

    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); // end of central dir signature
    end.writeUInt16LE(0, 4); // disk number
    end.writeUInt16LE(0, 6); // disk with central dir
    end.writeUInt16LE(entries.length, 8); // entries on this disk
    end.writeUInt16LE(entries.length, 10); // total entries
    end.writeUInt32LE(centralBuf.length, 12); // central dir size
    end.writeUInt32LE(offset, 16); // central dir offset
    end.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([...parts, centralBuf, end]);
}
