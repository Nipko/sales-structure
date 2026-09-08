import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { BusinessInfoService } from '../business-info/business-info.service';
import { VerticalsService } from '../verticals/verticals.service';
import { VerticalTurnContextService } from './vertical-turn-context.service';
import { EvaluationRevisionService } from '../evaluation-revision/evaluation-revision.service';
import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const url = process.env.PARALLLY_ISOLATION_TEST_URL;
(url ? describe : describe.skip)('Frozen core context through Prisma, canonical readers and revision guards', () => {
    const tenantId = randomUUID(), companyId = randomUUID(), schema = `tenant_context_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient, prisma: PrismaService, companyDdl: string[], fixture: ReturnType<typeof agentTurnFixture>;
    const query = (sql: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(schema, sql, params);
    const settings = { businessHours: { enabled: false, timezone: 'America/Mexico_City' },
        verticalConfig: { industry: 'retail', subType: 'moda', terminology: { serviceNoun: { es: 'prenda', en: 'garment', pt: 'peça', fr: 'vêtement' } } },
        chatReasons: ['other:Vender con información precisa'], customerTypes: ['consumidor_final'],
        privateCredential: 'synthetic-not-for-the-prompt' };
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/parallly_eval_isolation')
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.create(PrismaService.prototype);
        Object.assign(prisma, { tenant: client.tenant, $transaction: client.$transaction.bind(client),
            $queryRawUnsafe: client.$queryRawUnsafe.bind(client), $executeRawUnsafe: client.$executeRawUnsafe.bind(client) });
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        for (const [column, type] of Object.entries({ settings: "JSONB DEFAULT '{}'", industry: 'TEXT', language: "TEXT DEFAULT 'es'",
            operating_currency: 'TEXT', billing_country: 'TEXT', operating_country: 'TEXT', operating_timezone: 'TEXT',
            default_locale: 'TEXT', phone_region: 'TEXT', address_schema_id: 'TEXT', country_pack_id: 'TEXT', country_pack_version: 'TEXT' }))
            await client.$executeRawUnsafe(`ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS ${column} ${type}`);
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8').replaceAll('{{SCHEMA_NAME}}', schema);
        companyDdl = (prisma as any).splitSqlStatements(ddl).filter((statement: string) =>
            /^(CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+"[^"]+"\."companies"/i.test(statement));
    });
    beforeEach(async () => {
        for (const statement of companyDdl) await client.$executeRawUnsafe(statement);
        await query('TRUNCATE companies');
        await query("INSERT INTO companies(id,name,phone,is_primary,metadata) VALUES($1::uuid,'Captured shop','+525555555555',true,$2::jsonb)",
            [companyId, JSON.stringify({ internalNote: 'synthetic-not-for-the-prompt' })]);
        await client.$executeRawUnsafe("UPDATE public.tenants SET settings=$2::jsonb,industry='retail',operating_country='MX',operating_currency='MXN',language='es' WHERE id=$1::uuid",
            tenantId, JSON.stringify(settings));
        const forbidden = (name: string) => jest.fn(() => { throw new Error(`production_cache_or_write_forbidden:${name}`); });
        const redis = { get: forbidden('get'), getJson: forbidden('getJson'), set: forbidden('set'), setJson: forbidden('setJson'), del: forbidden('del') };
        const tenants = { getSchemaName: jest.fn().mockResolvedValue(schema) };
        const regional = new RegionalProfileService(prisma, redis as any);
        const business = new BusinessInfoService(prisma, redis as any, tenants as any);
        const verticals = new VerticalsService(prisma, redis as any, {} as any);
        fixture = agentTurnFixture({ prisma, redis, tenantsService: tenants, regionalProfile: regional,
            businessInfoService: business, verticalTurnContext: new VerticalTurnContextService(prisma, verticals) });
        const revisions = new EvaluationRevisionService(prisma, { evaluationRoutingSignature: async () => 'synthetic-model-routing' } as any);
        fixture.revisions.capture = revisions.capture.bind(revisions);
        fixture.revisions.assertCurrent = revisions.assertCurrent.bind(revisions);
        // The domain readers and dependency guard are real. Model/capability I/O
        // remain fixtures; this test makes no claim about provider performance.
    });
    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_context_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
        } finally { await client.$disconnect(); }
    });

    it('captures canonical facts in four languages and consumes them without consulting those readers again', async () => {
        const snapshot = await fixture.service.captureSnapshot(tenantId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        expect(snapshot.contextInputs).toMatchObject({ businessHours: { timezone: 'America/Mexico_City' },
            business: { companyName: 'Captured shop', phone: '+525555555555' }, regional: { operatingCurrency: { value: 'MXN' } } });
        expect(snapshot.contextInputs!.vertical.fr).toMatchObject({ serviceNoun: 'vêtement', businessGoals: ['Vender con información precisa'] });
        expect(JSON.stringify(snapshot.contextInputs)).not.toContain('synthetic-not-for-the-prompt');
        const hours = jest.spyOn(prisma.tenant, 'findUnique').mockRejectedValue(new Error('core_source_read_forbidden'));
        const business = jest.spyOn(fixture.businessInfoService, 'getPrimary').mockRejectedValue(new Error('business_source_read_forbidden'));
        const vertical = jest.spyOn(fixture.verticalTurnContext, 'resolve').mockRejectedValue(new Error('vertical_source_read_forbidden'));
        const regional = jest.spyOn(fixture.regionalProfile, 'resolve').mockRejectedValue(new Error('regional_source_read_forbidden'));
        try {
            jest.spyOn(fixture.languageDetector, 'detect').mockReturnValue('fr');
            const response = await fixture.service.test(tenantId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'Bonjour' }, { agentSnapshot: snapshot });
            expect(response.debug.runtimeError).toBeUndefined();
            expect(response.debug.turnContext).toMatchObject({ timezone: 'America/Mexico_City', business: { companyName: 'Captured shop' },
                verticalContext: { serviceNoun: 'vêtement' }, regional: { operatingCountry: 'MX', currency: 'MXN' } });
            expect(hours).not.toHaveBeenCalled(); expect(business).not.toHaveBeenCalled();
            expect(vertical).not.toHaveBeenCalled(); expect(regional).not.toHaveBeenCalled();
            expect(fixture.redis.getJson).not.toHaveBeenCalled(); expect(fixture.redis.setJson).not.toHaveBeenCalled();
        } finally { hours.mockRestore(); }
    });

    it.each(['tenant', 'business'])('keeps the global guard when captured %s facts change later', async source => {
        const snapshot = await fixture.service.captureSnapshot(tenantId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        if (source === 'tenant') await client.$executeRawUnsafe("UPDATE public.tenants SET operating_country='BR' WHERE id=$1::uuid", tenantId);
        else await query("UPDATE companies SET name='Changed shop' WHERE id=$1::uuid", [companyId]);
        await expect(fixture.service.test(tenantId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' }, { agentSnapshot: snapshot }))
            .rejects.toThrow(`evaluation_dependencies_changed:${source === 'tenant' ? 'public.tenants' : 'tenant.companies'}`);
        expect(fixture.llmRouter.execute).not.toHaveBeenCalled();
    });

    it('rejects a context edit between initial manifest and final capture validation', async () => {
        const original = fixture.regionalProfile.captureForEvaluation.bind(fixture.regionalProfile);
        jest.spyOn(fixture.regionalProfile, 'captureForEvaluation').mockImplementation(async () => {
            const captured = await original(tenantId);
            await client.$executeRawUnsafe("UPDATE public.tenants SET operating_country='BR' WHERE id=$1::uuid", tenantId);
            return captured;
        });
        await expect(fixture.service.captureSnapshot(tenantId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toThrow('evaluation_dependencies_changed:public.tenants');
        expect(fixture.llmRouter.execute).not.toHaveBeenCalled();
    });

    it('records an empty business identity and invalidates it when the first company is added', async () => {
        await query('TRUNCATE companies');
        const snapshot = await fixture.service.captureSnapshot(tenantId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        expect(snapshot.contextInputs?.business).toBeNull();
        await query("INSERT INTO companies(id,name) VALUES($1::uuid,'First shop')", [companyId]);
        await expect(fixture.service.assertSnapshotCurrent(snapshot)).rejects.toThrow('evaluation_dependencies_changed:tenant.companies');
    });

    it('reads verified legacy business columns without repairing the source schema', async () => {
        await query('ALTER TABLE companies DROP COLUMN phone');
        const snapshot = await fixture.service.captureSnapshot(tenantId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        expect(snapshot.contextInputs?.business).toMatchObject({ companyName: 'Captured shop' });
        expect(snapshot.contextInputs?.business?.phone).toBeUndefined();
        expect(await query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='companies' AND column_name='phone'", [schema])).toEqual([]);
    });

    it('does not treat a missing business table or a stale Redis template as valid captured data', async () => {
        await query('DROP TABLE companies');
        await expect(fixture.service.captureSnapshot(tenantId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toThrow('evaluation_business_source_unavailable');
        expect(fixture.llmRouter.execute).not.toHaveBeenCalled();
        const prismaOnly = { tenant: { findUnique: async () => ({ settings: {}, industry: null }) } };
        const stale = { getJson: jest.fn().mockResolvedValue({ industry: 'seguros', subType: 'general' }), setJson: jest.fn() };
        expect(await new VerticalsService(prismaOnly as any, stale as any, {} as any)
            .getVerticalConfig(tenantId, 0, AGENT_TEST_EXECUTION_CONTEXT)).toBeNull();
        expect(stale.getJson).not.toHaveBeenCalled(); expect(stale.setJson).not.toHaveBeenCalled();
    });
});
