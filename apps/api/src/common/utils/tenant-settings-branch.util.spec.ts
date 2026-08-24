import * as fs from 'node:fs';
import * as path from 'node:path';
import { mutateTenantSettingsBranchAtomic } from './tenant-settings-branch.util';

describe('mutateTenantSettingsBranchAtomic', () => {
    it('locks the live tenant row and writes only the selected branch', async () => {
        const tx = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ value: { enabled: false, keep: 'yes' } }]),
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        };
        const prisma = {
            $transaction: jest.fn(async (callback: any) => callback(tx)),
        };

        const result = await mutateTenantSettingsBranchAtomic(
            prisma as any,
            '8af1efcf-72fb-4a6c-8773-b17572ee8380',
            'slack',
            (current: any) => ({ ...current, enabled: true }),
        );

        expect(result).toEqual({ enabled: true, keep: 'yes' });
        expect(tx.$queryRawUnsafe.mock.calls[0][0]).toMatch(/FOR UPDATE/i);
        expect(tx.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual([
            '8af1efcf-72fb-4a6c-8773-b17572ee8380',
            '{slack}',
        ]);
        expect(tx.$executeRawUnsafe.mock.calls[0][0]).toMatch(/jsonb_set/i);
        expect(JSON.parse(tx.$executeRawUnsafe.mock.calls[0][3])).toEqual({
            enabled: true,
            keep: 'yes',
        });
    });

    it('rejects unsafe branch names before starting a transaction', async () => {
        const prisma = { $transaction: jest.fn() };
        await expect(mutateTenantSettingsBranchAtomic(
            prisma as any,
            '8af1efcf-72fb-4a6c-8773-b17572ee8380',
            'settings,other}',
            () => ({}),
        )).rejects.toThrow(/rama inv/i);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});

describe('tenant settings branch writers', () => {
    const serviceFiles = [
        'white-label/white-label.service.ts',
        'auth/saml.service.ts',
        'slack/slack.service.ts',
        'reviews/reviews.service.ts',
        'ecommerce/ecommerce.service.ts',
        'mcp/mcp-client.service.ts',
        'managed/managed.service.ts',
        'sms-notifications/sms-notifications.service.ts',
    ];

    it.each(serviceFiles)('%s never replaces the complete settings snapshot', (relative) => {
        const source = fs.readFileSync(path.join(__dirname, '../../modules', relative), 'utf8');
        expect(source).not.toMatch(/tenant\.update\([\s\S]{0,400}?data:\s*\{\s*settings:/);
        expect(source).toMatch(/mutateTenantSettingsBranchAtomic/);
    });

    it('has no direct Prisma read-modify-write snapshot replacement in runtime modules', () => {
        const root = path.join(__dirname, '../../modules');
        const sourceFiles: string[] = [];
        const visit = (directory: string) => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const absolute = path.join(directory, entry.name);
                if (entry.isDirectory()) visit(absolute);
                else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
                    sourceFiles.push(absolute);
                }
            }
        };
        visit(root);

        const offenders = sourceFiles.filter(file => {
            const source = fs.readFileSync(file, 'utf8');
            return /tenant\.update\([\s\S]{0,500}?data:\s*\{\s*settings\b/.test(source);
        }).map(file => path.relative(root, file));

        expect(offenders).toEqual([]);
    });
});
