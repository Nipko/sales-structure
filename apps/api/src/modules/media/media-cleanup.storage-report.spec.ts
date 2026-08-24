import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MediaCleanupService } from './media-cleanup.service';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('MediaCleanupService storage attribution', () => {
    let storagePath: string;
    let service: MediaCleanupService;

    beforeEach(() => {
        storagePath = mkdtempSync(join(tmpdir(), 'parallly-media-report-'));
        service = new MediaCleanupService(
            {} as any,
            { get: jest.fn((_key: string, fallback: string) => storagePath || fallback) } as any,
        );
    });

    afterEach(() => rmSync(storagePath, { recursive: true, force: true }));

    it('merges recursive hot and cold files into the real tenant row', async () => {
        mkdirSync(join(storagePath, TENANT_A, 'nested'), { recursive: true });
        mkdirSync(join(storagePath, 'archives', TENANT_A, '2026', '08'), { recursive: true });
        mkdirSync(join(storagePath, 'archives', TENANT_B), { recursive: true });
        writeFileSync(join(storagePath, TENANT_A, 'hot.bin'), Buffer.alloc(3));
        writeFileSync(join(storagePath, TENANT_A, 'nested', 'thumb.bin'), Buffer.alloc(5));
        writeFileSync(join(storagePath, 'archives', TENANT_A, '2026', '08', 'turn.json.gz'), Buffer.alloc(7));
        writeFileSync(join(storagePath, 'archives', TENANT_B, 'turn.json.gz'), Buffer.alloc(11));

        const report = await service.getStorageReport();

        expect(report).toMatchObject({
            totalFiles: 4,
            totalSizeBytes: 26,
            unattributedFiles: 0,
            unattributedSizeBytes: 0,
            complete: true,
            warnings: [],
        });
        expect(report.tenants).toEqual([
            { tenantId: TENANT_A, files: 3, sizeBytes: 15 },
            { tenantId: TENANT_B, files: 1, sizeBytes: 11 },
        ]);
    });

    it('counts reserved and malformed roots without assigning them to a tenant', async () => {
        mkdirSync(join(storagePath, 'system', 'updates'), { recursive: true });
        mkdirSync(join(storagePath, 'archives', 'not-a-tenant'), { recursive: true });
        writeFileSync(join(storagePath, 'system', 'updates', 'release.bin'), Buffer.alloc(13));
        writeFileSync(join(storagePath, 'archives', 'not-a-tenant', 'orphan.gz'), Buffer.alloc(17));

        const report = await service.getStorageReport();

        expect(report).toMatchObject({
            totalFiles: 2,
            totalSizeBytes: 30,
            unattributedFiles: 2,
            unattributedSizeBytes: 30,
            complete: true,
        });
        expect(report.tenants).toEqual([]);
    });

    it('stops safely and marks the report incomplete beyond the depth budget', async () => {
        let directory = join(storagePath, TENANT_A);
        mkdirSync(directory, { recursive: true });
        for (let index = 0; index < 10; index++) {
            directory = join(directory, `level-${index}`);
            mkdirSync(directory);
        }
        writeFileSync(join(directory, 'too-deep.bin'), Buffer.alloc(19));

        const report = await service.getStorageReport();

        expect(report.complete).toBe(false);
        expect(report.warnings).toEqual(expect.arrayContaining([
            expect.stringContaining('directory depth limit reached'),
        ]));
        expect(report.totalFiles).toBe(0);
        expect(report.tenants).toEqual([]);
    });
});
