import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MediaService } from './media.service';

describe('MediaService.readFile stays inside the media root', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    let root: string;
    let storagePath: string;
    let service: MediaService;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallly-read-media-'));
        storagePath = path.join(root, 'media');
        fs.mkdirSync(path.join(storagePath, tenantId), { recursive: true });
        fs.writeFileSync(path.join(storagePath, tenantId, 'photo.webp'), 'ok');
        // A file outside the media root, reachable only by traversal.
        fs.mkdirSync(path.join(root, 'secret'));
        fs.writeFileSync(path.join(root, 'secret', 'canary.txt'), 'canary');
        const config = {
            get: jest.fn((key: string, fallback: unknown) => (key === 'MEDIA_STORAGE_PATH' ? storagePath : fallback)),
        };
        service = new MediaService({} as any, config as any, {} as any);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('serves a file of a real tenant', () => {
        const result = service.readFile(tenantId, 'photo.webp');
        expect(result.exists).toBe(true);
        expect(result.buffer.toString()).toBe('ok');
    });

    it('refuses a decoded ../ in tenantId (the %2F case from the public route)', () => {
        const result = service.readFile('../secret', 'canary.txt');
        expect(result.exists).toBe(false);
        expect(result.buffer.length).toBe(0);
    });

    it('refuses any tenantId that is not a UUID', () => {
        expect(service.readFile('..', 'canary.txt').exists).toBe(false);
        expect(service.readFile(`${tenantId}/../../secret`, 'canary.txt').exists).toBe(false);
        expect(service.readFile('', 'photo.webp').exists).toBe(false);
    });

    it('still confines fileName to the tenant directory', () => {
        expect(service.readFile(tenantId, '../../secret/canary.txt').exists).toBe(false);
    });

    it('applies the same check to the jpg-to-webp delivery fallback', async () => {
        const result = await service.readFileForDelivery('../secret', 'canary.jpg');
        expect(result.exists).toBe(false);
    });
});
