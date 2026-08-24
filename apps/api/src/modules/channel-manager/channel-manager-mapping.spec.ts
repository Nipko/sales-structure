import { ChannelManagerService } from './channel-manager.service';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const LISTING_ID = '22222222-2222-4222-8222-222222222222';
const OLD_PROPERTY_ID = '33333333-3333-4333-8333-333333333333';
const PROPERTY_ID = '44444444-4444-4444-8444-444444444444';

describe('ChannelManagerService mapping ownership', () => {
    it('serializes the one-to-one mapping and advances the tenant SoR cache generation', async () => {
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('FROM cm_listings') && sql.includes('FOR UPDATE')) {
                return [{ id: LISTING_ID, property_id: OLD_PROPERTY_ID }];
            }
            if (sql.includes('pg_advisory_xact_lock')) return [{ locked: '1' }];
            if (sql.includes('FROM properties')) return [{ id: PROPERTY_ID }];
            if (sql.includes('property_id = $1::uuid') && sql.includes('id <>')) return [];
            if (sql.includes('UPDATE cm_listings')) {
                return [{ id: LISTING_ID, property_id: PROPERTY_ID }];
            }
            throw new Error(`Unexpected mapping SQL: ${sql}`);
        });
        const prisma: any = {
            getTenantSchemaName: jest.fn().mockResolvedValue('tenant_lodging'),
            assertTenantSchemaName: jest.fn(),
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: 1 }]),
            transactionInTenantSchema: jest.fn(async (_schema: string, run: any) => run(query)),
        };
        const redis: any = {
            get: jest.fn().mockResolvedValue('tables-ready'),
            incr: jest.fn().mockResolvedValue(1),
        };
        const service = new ChannelManagerService(
            prisma,
            redis,
            { axiosRef: {} } as any,
            new TenantSecretCryptoService(),
        );

        await expect(service.mapListingToProperty(TENANT_ID, LISTING_ID, PROPERTY_ID))
            .resolves.toMatchObject({ id: LISTING_ID, property_id: PROPERTY_ID });

        expect(prisma.transactionInTenantSchema).toHaveBeenCalledWith(
            'tenant_lodging',
            expect.any(Function),
        );
        expect(query.mock.calls.some(([sql]) => /FOR UPDATE/i.test(sql))).toBe(true);
        expect(query.mock.calls.some(([sql]) => /pg_advisory_xact_lock/i.test(sql))).toBe(true);
        expect(redis.incr).toHaveBeenCalledWith(`lodging:sor:version:${TENANT_ID}`);
    });
});
