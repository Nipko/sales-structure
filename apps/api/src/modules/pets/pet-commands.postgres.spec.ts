import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PetsService } from './pets.service';
import type { PetCommandOptions } from './pet-commands';
import { ComplianceService } from '../compliance/compliance.service';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import type { ServedAgentAuthority } from '../persona/served-agent-authority';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';

const url = process.env.PARALLLY_ISOLATION_TEST_URL;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
(url ? describe : describe.skip)('Pet commands through real Prisma/PostgreSQL', () => {
    const schema = `tenant_pet_commands_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID(), contactId = randomUUID(), otherContact = randomUUID(), conversationId = randomUUID(), agentId = randomUUID();
    let client: PrismaClient, prisma: PrismaService, pets: PetsService, scope: ServedAgentAuthority;
    let beforeEffect: (() => Promise<void>) | undefined;
    const q = (sql: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(schema, sql, params);
    const options = (idempotencyKey = randomUUID()) => ({ contactId, conversationId, idempotencyKey, requireIdempotency: true, operationalScope: scope });
    const create = (extra: Record<string, any> = {}, opts: PetCommandOptions = options()) => pets.create(schema, { contactId, name: 'Luna', species: 'cat', ...extra }, opts);
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation')) throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url }); prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        await q('CREATE TABLE contacts(id UUID PRIMARY KEY,name TEXT)');
        await q('CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID,metadata JSONB)');
        await q('CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)');
        await q('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY,erased_at TIMESTAMPTZ DEFAULT NOW())');
        await q('CREATE TABLE customer_memory_facts(id UUID,owner_kind TEXT,owner_id UUID,source_contact_id UUID)');
        await q('CREATE TABLE customer_memories(contact_id UUID)');
        await q('CREATE TABLE agent_personas(id UUID PRIMARY KEY,version INT,is_active BOOLEAN,config_json JSONB)');
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8').replaceAll('{{SCHEMA_NAME}}', schema);
        for (const statement of (prisma as any).splitSqlStatements(ddl)) {
            const table = statement.match(/^CREATE TABLE IF NOT EXISTS\s+"[^"]+"\."(pets|pet_command_receipts)"/i);
            if (table) await client.$executeRawUnsafe(statement);
        }
        const native = PrismaService.prototype.transactionInTenantSchema.bind(prisma);
        prisma.transactionInTenantSchema = ((name: string, work: any, opts: any) => native(name, async query => work(async (sql: string, params?: any[]) => {
            if (/^UPDATE pets SET/.test(sql) && beforeEffect) { const hook = beforeEffect; beforeEffect = undefined; await hook(); }
            return query(sql, params);
        }), opts)) as any;
        pets = new PetsService(prisma);
    });
    beforeEach(async () => {
        beforeEffect = undefined;
        await q('TRUNCATE contacts,conversations,contact_identities,customer_memory_erasure,customer_memory_facts,customer_memories,agent_personas,pets,pet_command_receipts');
        await q("INSERT INTO contacts VALUES($1::uuid,'Synthetic'),($2::uuid,'Other')", [contactId, otherContact]);
        await q("INSERT INTO conversations VALUES($1::uuid,$2::uuid,'{}'::jsonb)", [conversationId, contactId]);
        const [agent] = await q("INSERT INTO agent_personas VALUES($1::uuid,1,true,'{}'::jsonb) RETURNING *", [agentId]);
        scope = { kind: 'agent', tenantId, schemaName: schema, agentId, version: 1, operationalHash: operationalConfigurationHash(agent) };
    });
    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_pet_commands_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
        } finally { await client.$disconnect(); }
    });
    it.each([{ species: undefined }, { species: 'invented' }, { name: '  ' }, { weightKg: -1 }, { weightKg: 10.123 },
        { birthDate: '2026-02-30' }, { isNeutered: 'false' }])('rejects invalid fields before inserting a pet: %j', async input => {
        await expect(create(input)).rejects.toThrow();
        expect(await q('SELECT id FROM pets')).toEqual([]);
        expect(await q('SELECT command_key FROM pet_command_receipts')).toEqual([]);
    });
    it('creates an explicit species and makes concurrent retries one atomic record', async () => {
        const opts = options();
        const rows = await Promise.all([create({ isNeutered: false }, opts), create({ isNeutered: false }, opts)]);
        expect(rows[0].id).toBe(rows[1].id);
        expect(rows.some(row => row.idempotentReplay)).toBe(true);
        expect(await q('SELECT name,species,is_neutered FROM pets')).toEqual([{ name: 'Luna', species: 'cat', is_neutered: false }]);
        expect(await q('SELECT command_kind FROM pet_command_receipts')).toEqual([{ command_kind: 'create' }]);
    });
    it('serializes first-use receipt setup across independent service instances', async () => {
        await q('DROP TABLE pet_command_receipts');
        const opts = options(), data = { contactId, name: 'First-use pet', species: 'cat' };
        const first = new PetsService(prisma), second = new PetsService(prisma);
        const rows = await Promise.all([first.create(schema, data, opts), second.create(schema, data, opts)]);
        expect(rows[0].id).toBe(rows[1].id);
        expect(rows.some(row => row.idempotentReplay)).toBe(true);
        expect(await q('SELECT id FROM pets')).toHaveLength(1);
        expect(await q('SELECT command_key FROM pet_command_receipts')).toHaveLength(1);
    });
    it('rejects a reused command key with different data or another contact', async () => {
        const opts = options(); await create({}, opts);
        await expect(create({ name: 'Different' }, opts)).rejects.toThrow('pet_command_changed');
        await expect(create({ contactId: otherContact }, { ...opts, contactId: otherContact, conversationId: undefined })).rejects.toThrow('pet_command_changed');
        expect(await q('SELECT id FROM pets')).toHaveLength(1);
    });
    it('applies partial camelCase corrections and an explicit clearing without losing other fields', async () => {
        const row = await create({ breed: 'Mixed', allergies: 'Old statement', weightKg: 4 });
        const updated = await pets.update(schema, row.id, { weightKg: 4.25, isNeutered: true, allergies: null }, options());
        expect(Number(updated.weight_kg)).toBe(4.25);
        expect(updated).toMatchObject({ breed: 'Mixed', is_neutered: true, allergies: null });
    });
    it('preserves, corrects and clears an explicitly supplied birth date through Prisma', async () => {
        const row = await create({ birthDate: '2021-02-28' });
        expect(row.birth_date.toISOString().slice(0, 10)).toBe('2021-02-28');
        const corrected = await pets.update(schema, row.id, { birthDate: '2020-02-29' }, options());
        expect(corrected.birth_date.toISOString().slice(0, 10)).toBe('2020-02-29');
        expect((await pets.update(schema, row.id, { birthDate: null }, options())).birth_date).toBeNull();
    });
    it('does not let an old retry overwrite a more recent correction', async () => {
        const row = await create({ weightKg: 4 }), old = options();
        await pets.update(schema, row.id, { weightKg: 4.25 }, old);
        await pets.update(schema, row.id, { weightKg: 4.5 }, options());
        expect(await pets.update(schema, row.id, { weightKg: 4.25 }, old)).toMatchObject({ idempotentReplay: true });
        expect(Number((await pets.getById(schema, row.id)).weight_kg)).toBe(4.5);
    });
    it('rejects another tutor, inactive pets, a missing contact and an unrelated conversation', async () => {
        const row = await create();
        await expect(pets.update(schema, row.id, { name: 'Wrong' }, { ...options(), contactId: otherContact, conversationId: undefined })).rejects.toThrow('pet_unavailable');
        await pets.delete(schema, row.id);
        await expect(pets.update(schema, row.id, { name: 'Inactive' }, options())).rejects.toThrow('pet_unavailable');
        await expect(create({}, { ...options(), conversationId: randomUUID() })).rejects.toThrow('pet_conversation_unavailable');
        await expect(pets.create(schema, { contactId: randomUUID(), name: 'Absent', species: 'dog' })).rejects.toThrow('pet_contact_unavailable');
    });
    it.each(['create', 'update'])('rolls back %s if its durable receipt cannot commit', async kind => {
        const row = await create({ weightKg: 4 });
        await q(`CREATE FUNCTION refuse_pet_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END$$`);
        await q('CREATE TRIGGER refuse_pet_receipt BEFORE INSERT ON pet_command_receipts FOR EACH ROW EXECUTE FUNCTION refuse_pet_receipt()');
        try {
            await expect(kind === 'create' ? create({ name: 'Must roll back' }) : pets.update(schema, row.id, { weightKg: 5 }, options())).rejects.toThrow('synthetic receipt failure');
            expect(await q('SELECT id FROM pets')).toHaveLength(1);
            expect(Number((await pets.getById(schema, row.id)).weight_kg)).toBe(4);
        } finally { await q('DROP TRIGGER refuse_pet_receipt ON pet_command_receipts'); await q('DROP FUNCTION refuse_pet_receipt()'); }
    });
    it('keeps owner and operational revision locked through the write and rejects the next stale command', async () => {
        const row = await create({ weightKg: 4 }), entered = deferred(), release = deferred();
        beforeEffect = async () => { entered.resolve(); await release.promise; };
        const pending = pets.update(schema, row.id, { weightKg: 5 }, options()); await entered.promise;
        try {
            for (const statement of ['UPDATE pets SET contact_id=$2::uuid WHERE id=$1::uuid', 'UPDATE agent_personas SET version=2 WHERE id=$1::uuid']) {
                await expect(prisma.transactionInTenantSchema(schema, async query => {
                    await query("SELECT set_config('lock_timeout','50ms',true)");
                    await query(statement, statement.startsWith('UPDATE pets') ? [row.id, otherContact] : [agentId]);
                })).rejects.toThrow();
            }
        } finally { beforeEffect = undefined; release.resolve(); await pending; }
        await q('UPDATE agent_personas SET version=2 WHERE id=$1::uuid', [agentId]);
        await expect(pets.update(schema, row.id, { weightKg: 6 }, options())).rejects.toThrow('agent_operational_revision_changed');
        expect(Number((await pets.getById(schema, row.id)).weight_kg)).toBe(5);
    });
    it('erases derived receipts and prevents commands from recreating them for an erased contact', async () => {
        const row = await create();
        await (new ComplianceService(prisma) as any).eraseCustomerMemory(schema, contactId);
        expect(await q('SELECT command_key FROM pet_command_receipts')).toEqual([]);
        await expect(create()).rejects.toThrow('contact_erased');
        await expect(pets.update(schema, row.id, { name: 'After erasure' }, options())).rejects.toThrow('contact_erased');
    });
    it('the real tool adapters carry private scope and preserve camelCase data through the canonical service', async () => {
        const executor = Object.create(AIToolExecutorService.prototype); executor.petsService = pets;
        const result = await executor.registerPet(schema, contactId, { name: 'Tool pet', species: 'rabbit', weightKg: 2 }, conversationId, randomUUID(), scope);
        expect(result).toMatchObject({ name: 'Tool pet', species: 'rabbit' });
        const updated = await executor.updatePetTool(schema, contactId, { petId: result.petId, weightKg: 2.5, isNeutered: true }, conversationId, randomUUID(), scope);
        expect(updated.success).toBe(true);
        expect((await pets.getById(schema, result.petId)).is_neutered).toBe(true);
        const wrong = await executor.updatePetTool(schema, otherContact, { petId: result.petId, weightKg: 3 }, undefined, randomUUID(), scope);
        expect(wrong.error).toBe('pet_unavailable');
    });
});
