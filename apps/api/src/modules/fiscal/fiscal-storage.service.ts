import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Persists fiscal artifacts (signed XML + PDF) to local storage for the legal
 * 5-year retention requirement, so Parallly keeps its own copy independent of
 * the provider's hosting. Mirrors the MediaService disk pattern.
 *
 * Layout: {FISCAL_STORAGE_PATH}/{tenantId}/{invoiceId}.{pdf|xml}
 */
@Injectable()
export class FiscalStorageService {
    private readonly logger = new Logger(FiscalStorageService.name);
    private readonly storagePath = process.env.FISCAL_STORAGE_PATH || '/data/invoices';

    constructor() {
        try {
            fs.mkdirSync(this.storagePath, { recursive: true });
        } catch (err: any) {
            this.logger.warn(`Could not ensure fiscal storage dir ${this.storagePath}: ${err?.message}`);
        }
    }

    /** Persist an artifact. Returns the relative storage key, or null on failure. */
    save(tenantId: string, invoiceId: string, ext: 'pdf' | 'xml', buffer: Buffer): string | null {
        try {
            const dir = path.join(this.storagePath, this.safe(tenantId));
            fs.mkdirSync(dir, { recursive: true });
            const fileName = `${this.safe(invoiceId)}.${ext}`;
            fs.writeFileSync(path.join(dir, fileName), buffer);
            return `${this.safe(tenantId)}/${fileName}`;
        } catch (err: any) {
            this.logger.error(`Failed to store fiscal ${ext} for ${invoiceId}: ${err?.message}`);
            return null;
        }
    }

    /** Read a stored artifact, or null if absent. */
    read(tenantId: string, invoiceId: string, ext: 'pdf' | 'xml'): Buffer | null {
        try {
            const file = path.join(this.storagePath, this.safe(tenantId), `${this.safe(invoiceId)}.${ext}`);
            if (!fs.existsSync(file)) return null;
            return fs.readFileSync(file);
        } catch {
            return null;
        }
    }

    private safe(s: string): string {
        return (s || '').replace(/[^a-zA-Z0-9_-]/g, '');
    }
}
