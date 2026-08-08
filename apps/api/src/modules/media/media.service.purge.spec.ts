import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MediaService } from './media.service';

describe('MediaService tenant purge', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    let storagePath: string;

    beforeEach(() => {
        storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'parallly-purge-media-'));
    });

    afterEach(() => {
        fs.rmSync(storagePath, { recursive: true, force: true });
    });

    it('deletes both hot media and the cold archives/{tenantId} tree', async () => {
        const config = {
            get: jest.fn((key: string, fallback: unknown) => (
                key === 'MEDIA_STORAGE_PATH' ? storagePath : fallback
            )),
        };
        const service = new MediaService({} as any, config as any, {} as any);
        const tenantDir = path.join(storagePath, tenantId);
        const archiveDir = path.join(storagePath, 'archives', tenantId);
        fs.mkdirSync(tenantDir, { recursive: true });
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.writeFileSync(path.join(tenantDir, 'hot.bin'), 'hot');
        fs.writeFileSync(path.join(archiveDir, 'invoice.pdf'), 'cold');

        await expect(service.deleteAllTenantFiles(tenantId)).resolves.toEqual({
            removed: 2,
            tenantDir,
            archiveDir,
        });
        expect(fs.existsSync(tenantDir)).toBe(false);
        expect(fs.existsSync(archiveDir)).toBe(false);
    });
});
