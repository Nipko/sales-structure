/**
 * R4 · contrato de conocimiento del turno en la API (C0 §1.2, ADR 0010):
 * - sale de la MISMA evaluación que ve el panel (misma foto, misma caché, misma invalidación);
 * - se pinta como <knowledge_status> en la capa 3, y la regla 20 del contrato L1 reemplaza a la de «no ofrecido»;
 * - sin contrato, el prompt es el de siempre, byte por byte.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildTurnContract, evaluate, fromLegacyRows, type LegacyTenantRows } from '@parallext/business-spec';
import { loadSpec } from '@parallext/business-spec/load';
import type { TurnContext } from '@parallext/shared';
import { escapeXmlText } from '../../common/utils/xml.util';
import { PromptAssemblerService, RULE_20_KNOWLEDGE_STATUS } from '../conversations/prompt-assembler.service';
import { ReadinessContextService, knowledgeStatusFrom } from './readiness-context.service';
import { ReadinessService, turnContractCacheKey } from './readiness.service';

const FIXTURES = path.resolve(__dirname, '../../../../../packages/business-spec/test/fixtures/qa-tenants');
const NOW = new Date('2026-10-30T12:00:00.000Z');
const TENANT = '5f7883f0-0000-4000-8000-000000000001';
const fixture = (slug: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${slug}.snapshot.json`), 'utf8')) as LegacyTenantRows;

class FixedClockReadiness extends ReadinessService {
    protected now(): Date { return NOW; }
}

function build(slug = 'spark-qa-dental-03') {
    const rows = fixture(slug);
    const tx = {
        $executeRawUnsafe: jest.fn(async () => undefined),
        $queryRawUnsafe: jest.fn(async (sql: string) => (sql.includes('information_schema.tables')
            ? [{ v: Object.keys(rows).filter(k => Array.isArray((rows as any)[k])) }] : [{ v: rows }])),
    };
    const prisma = {
        getTenantSchemaName: jest.fn(async () => 'tenant_x'),
        $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
        // sin historial (tenant sin migrar): la preparación y el contrato se calculan igual
        transactionInTenantSchema: jest.fn(async () => { throw Object.assign(new Error('relation "readiness_evaluations" does not exist'), { code: '42P01' }); }),
    };
    const store = new Map<string, string>();
    const redis = {
        store,
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
        del: jest.fn(async (k: string) => { store.delete(k); }),
    };
    const readiness = new FixedClockReadiness(prisma as any, redis as any, { emit: jest.fn() } as any);
    jest.spyOn((readiness as any).logger, 'warn').mockImplementation(() => undefined);
    return { readiness, redis, prisma, context: new ReadinessContextService(readiness) };
}

const BASE_TURN: TurnContext = { language: 'es', timezone: 'America/Bogota', now: NOW.toISOString(), upcomingDays: [], businessHoursStatus: 'open' };
const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '<persona><name>Laura</name></persona>' } as any);

describe('ReadinessService.turnContract', () => {
    const spec = loadSpec();

    it('es el contrato del motor sobre la misma foto y la misma evaluación, y queda en caché con ella', async () => {
        const { readiness, redis } = build();
        const contract = await readiness.turnContract(TENANT);
        const snap = fromLegacyRows({ ...fixture('spark-qa-dental-03'), capturedAt: NOW.toISOString() } as any);
        const expected = buildTurnContract(spec, snap, evaluate(spec, snap, NOW), { now: NOW });
        expect(contract).toEqual(expected);
        expect(redis.store.has(turnContractCacheKey(TENANT, spec.specVersion))).toBe(true);
        // segundo pedido: de la caché, sin leer la foto otra vez
        const reads = redis.get.mock.calls.length;
        await readiness.turnContract(TENANT);
        expect(redis.get.mock.calls.length).toBe(reads + 1);
    });

    it('invalidate() borra la evaluación y el contrato', async () => {
        const { readiness, redis } = build();
        await readiness.turnContract(TENANT);
        await readiness.invalidate(TENANT);
        expect(redis.store.has(turnContractCacheKey(TENANT, spec.specVersion))).toBe(false);
    });

    it('sin foto legible no lanza: null, y el turno sigue sin el bloque', async () => {
        const { readiness, prisma, context } = build();
        prisma.$transaction.mockRejectedValue(new Error('db down'));
        await expect(readiness.turnContract(TENANT)).resolves.toBeNull();
        await expect(context.forTurn(TENANT)).resolves.toBeNull();
    });
});

describe('<knowledge_status> en el prompt', () => {
    it('forTurn pinta el bloque sin las prohibiciones comunes y sin writes mientras WRITE_MODE está en sombra', async () => {
        const { context } = build();
        const shadow = await context.forTurn(TENANT);
        expect(shadow?.block).toMatch(/^ {2}<knowledge_status spec="[^"]+" verdict="no_listo">/);
        expect(shadow?.block).not.toContain('writes=');
        expect(shadow?.block).not.toContain('<never>negar un atributo');
        expect(shadow?.unknownIds).toContain('CORE.PAYMENT.METHODS');
        const enforced = await context.forTurn(TENANT, { writesEnforced: true });
        expect(enforced?.block).toContain('writes="appointment=none"');
    });

    it('con el bloque, la regla 20 del contrato es la del estado del conocimiento (y absorbe «no ofrecido»)', async () => {
        const { context } = build();
        const knowledgeStatus = (await context.forTurn(TENANT))!;
        const prompt = assembler.assemble({ tools: {} } as any, { ...BASE_TURN, knowledgeStatus });
        expect(prompt).toContain(escapeXmlText(RULE_20_KNOWLEDGE_STATUS.trim()));
        expect(prompt).not.toContain('20. NOT OFFERED:');
        expect(prompt.match(/^ {2}20\. /gm)).toHaveLength(1);
        expect(prompt).toContain(knowledgeStatus.block);
        // las prohibiciones comunes viajan en la regla fija, no en cada turno
        expect(RULE_20_KNOWLEDGE_STATUS).toMatch(/never deny an attribute or a service that is not declared/);
        expect(RULE_20_KNOWLEDGE_STATUS).toMatch(/<vertical_context><not_offered>/);
    });

    it('sin el bloque, el contrato es el de antes byte por byte', () => {
        const before = assembler.assemble({ tools: {} } as any, BASE_TURN);
        expect(before).toContain('20. NOT OFFERED:');
        expect(before).not.toContain('KNOWLEDGE STATUS');
        expect(before).not.toContain('<knowledge_status');
    });

    it('la regla 20b (catálogo sobre FAQ) sigue después de la 20 con el bloque', () => {
        const contract = (assembler as any).buildContractLayer(false, false, true, true) as string;
        const lines = contract.split('\n');
        const i = lines.findIndex(l => l.startsWith('  20. KNOWLEDGE STATUS'));
        expect(lines[i + 1]).toMatch(/^ {2}20b\. THE CATALOGUE DECIDES/);
    });

    it('bloque del prompt de la clínica dental QA (instantánea)', async () => {
        const { readiness } = build();
        const block = knowledgeStatusFrom((await readiness.turnContract(TENANT))!).block;
        expect(block).toMatchSnapshot();
        expect(block.length).toBeLessThanOrEqual(2200);
    });
});
