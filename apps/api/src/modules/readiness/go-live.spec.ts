/**
 * R4 · control de salida (C0 §1.2, ADR 0010): binario, en modo sombra hasta la bandera `readiness.goLiveGate`.
 * - La decisión pura (`decideGoLive`) y que la sombra nunca bloquea.
 * - GoLiveService: registra cada decisión, no lanza, publica con 409 si no_listo y exige el reconocimiento de «limitado».
 * - Agent Test nunca pasa por el control.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConflictException } from '@nestjs/common';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { blocksTurn, decideGoLive, notLiveNotice } from './go-live-gate';
import { GoLiveService } from './go-live.service';
import { ReadinessController } from './readiness.controller';

const TENANT = '5f7883f0-0000-4000-8000-000000000001';
const CONVERSATION = '7a7a7a7a-0000-4000-8000-000000000001';

describe('decideGoLive: atiende o no atiende', () => {
    it.each([
        [{ state: 'on', verdict: 'listo' }, { serve: true, reason: 'published' }],
        [{ state: 'on', verdict: 'limitado' }, { serve: true, reason: 'published' }],
        // publicado que cae a no_listo: no se apaga en silencio (C0 §1.2, regresión)
        [{ state: 'on', verdict: 'no_listo' }, { serve: true, reason: 'published_regressed' }],
        [{ state: 'off', verdict: 'no_listo' }, { serve: false, reason: 'no_listo' }],
        [{ state: 'off', verdict: 'limitado' }, { serve: false, reason: 'not_published' }],
        [{ state: 'off', verdict: 'listo' }, { serve: false, reason: 'not_published' }],
        [{ state: 'off', verdict: null }, { serve: false, reason: 'not_published' }],
        [{ state: 'off', verdict: 'no_listo', testContact: true }, { serve: true, reason: 'test_contact' }],
    ] as const)('%j → %j', (input, expected) => expect(decideGoLive(input as any)).toEqual(expected));

    it('la sombra nunca bloquea; aplicado bloquea solo lo que no atiende', () => {
        for (const d of [{ serve: false, reason: 'no_listo' }, { serve: true, reason: 'published' }] as const) expect(blocksTurn('shadow', d)).toBe(false);
        expect(blocksTurn('enforce', { serve: false, reason: 'no_listo' })).toBe(true);
        expect(blocksTurn('enforce', { serve: true, reason: 'published' })).toBe(false);
    });

    it('el mensaje fijo existe en es/en/pt/fr y cae a español', () => {
        expect(notLiveNotice('pt-BR')).toMatch(/atendimento automático/);
        expect(notLiveNotice('fr')).toMatch(/réponses automatiques/);
        expect(notLiveNotice('en')).toMatch(/automatic replies/);
        expect(notLiveNotice('de')).toBe(notLiveNotice('es'));
    });
});

function build(opts: { state?: 'on' | 'off'; flags?: Record<string, boolean>; testContacts?: string[]; verdict?: string | null; failRow?: boolean; result?: any } = {}) {
    const inserts: any[][] = [];
    const updates: any[][] = [];
    const prisma = {
        $queryRawUnsafe: jest.fn(async () => {
            if (opts.failRow) throw new Error('connection reset');
            return [{ go_live_state: opts.state ?? 'off', go_live_at: null, go_live_by: null, go_live_spec_version: null, go_live_ack: null, flags: opts.flags ?? {}, test_contacts: opts.testContacts ?? null }];
        }),
        $executeRawUnsafe: jest.fn(async (...args: any[]) => { updates.push(args); return 1; }),
        getTenantSchemaName: jest.fn(async () => 'tenant_x'),
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: any[]) => {
            if (/^\s*INSERT INTO go_live_decisions/.test(sql)) { inserts.push(params); return []; }
            return [];
        }),
    };
    const readiness = {
        spec: { specVersion: '1.1.0-rc.1' },
        currentVerdict: jest.fn(async () => (opts.verdict === undefined ? 'no_listo' : opts.verdict)),
        getCurrent: jest.fn(async () => ({ result: opts.result })),
    };
    const events = { emit: jest.fn() };
    const service = new GoLiveService(prisma as any, readiness as any, events as any);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    return { service, prisma, readiness, events, inserts, updates };
}
const flush = () => new Promise(r => setImmediate(r));

describe('GoLiveService.check (cada mensaje entrante de un canal real)', () => {
    it('modo sombra: un tenant no publicado y no_listo NO se bloquea, y la decisión queda registrada', async () => {
        const f = build({ state: 'off', verdict: 'no_listo' });
        const check = await f.service.check(TENANT, { channelType: 'whatsapp', contact: '+57 300 111 2233', conversationId: CONVERSATION });
        expect(check).toEqual({ decision: { serve: false, reason: 'no_listo' }, mode: 'shadow', blocks: false });
        await flush();
        expect(f.inserts).toEqual([['whatsapp', CONVERSATION, 'shadow', false, 'no_listo', 'off', 'no_listo', '1.1.0-rc.1']]);
    });

    it('aplicado (readiness.goLiveGate): el mismo tenant se bloquea; uno publicado atiende', async () => {
        const off = await build({ state: 'off', flags: { 'readiness.goLiveGate': true } }).service.check(TENANT, { channelType: 'whatsapp' });
        expect(off).toMatchObject({ mode: 'enforce', blocks: true });
        const on = await build({ state: 'on', verdict: 'limitado', flags: { 'readiness.goLiveGate': true } }).service.check(TENANT, { channelType: 'whatsapp' });
        expect(on).toEqual({ decision: { serve: true, reason: 'published' }, mode: 'enforce', blocks: false });
    });

    it('la lista blanca de prueba (settings.goLive.testContacts) atiende aunque no esté publicado', async () => {
        const f = build({ state: 'off', flags: { 'readiness.goLiveGate': true }, testContacts: ['+57 300-111-2233'] });
        await expect(f.service.check(TENANT, { channelType: 'whatsapp', contact: '573009998877' })).resolves.toMatchObject({ blocks: true });
        await expect(f.service.check(TENANT, { channelType: 'whatsapp', contact: '573001112233' })).resolves.toMatchObject({ blocks: false, decision: { reason: 'test_contact' } });
        await expect(f.service.check(TENANT, { channelType: 'whatsapp', contact: '+57 300 111 2233' })).resolves.toMatchObject({ blocks: false });
    });

    it('un fallo de lectura no apaga al tenant: atiende (unavailable), no lanza y lo registra', async () => {
        const f = build({ failRow: true });
        await expect(f.service.check(TENANT, { channelType: 'instagram' })).resolves.toEqual({ decision: { serve: true, reason: 'unavailable' }, mode: 'shadow', blocks: false });
        await flush();
        expect(f.inserts[0]).toEqual(expect.arrayContaining(['instagram', 'unavailable']));
    });

    it('un fallo al registrar no rompe el turno', async () => {
        const f = build();
        f.prisma.executeInTenantSchema.mockRejectedValueOnce(Object.assign(new Error('relation "go_live_decisions" does not exist'), { code: '42P01' }));
        await expect(f.service.check(TENANT, { channelType: 'whatsapp' })).resolves.toMatchObject({ blocks: false });
        await flush();
    });
});

describe('GoLiveService.publish (C0 §1.2: off → on)', () => {
    const limited = { verdict: 'limitado', blockingGaps: [], resultHash: 'h1', specVersion: '1.1.0-rc.1', limitedIntents: [
        { id: 'C12', title: 'Medios de pago', requirementIds: ['CORE.PAYMENT.FINANCING'] },
        { id: 'C20', title: 'Festivos', requirementIds: ['CORE.HOURS.HOLIDAYS'] },
    ] };
    const owner = { userId: 'u-owner' };

    it('no_listo → 409 con los bloqueantes, sin escribir', async () => {
        const f = build({ result: { verdict: 'no_listo', blockingGaps: ['CORE.PAYMENT.METHODS'], limitedIntents: [] } });
        const err = await f.service.publish(TENANT, undefined, owner).catch(e => e);
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getResponse()).toMatchObject({ verdict: 'no_listo', blockingGaps: ['CORE.PAYMENT.METHODS'] });
        expect(f.updates).toEqual([]);
        expect(f.readiness.getCurrent).toHaveBeenCalledWith(TENANT, { refresh: true });
    });

    it('limitado sin reconocer todas las intenciones → 409 con las que faltan', async () => {
        const f = build({ result: limited });
        const err = await f.service.publish(TENANT, ['C12'], owner).catch(e => e);
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getResponse()).toMatchObject({ verdict: 'limitado', missing: ['C20'] });
        expect(f.updates).toEqual([]);
    });

    it('limitado reconocido → publica y guarda el reconocimiento como acto (quién, cuándo, qué evaluación)', async () => {
        const f = build({ result: limited });
        await f.service.publish(TENANT, ['C12', 'C20'], owner);
        const [sql, tenant, by, specVersion, ack] = f.updates[0];
        expect(sql).toMatch(/SET go_live_state = 'on'/);
        expect([tenant, by, specVersion]).toEqual([TENANT, 'u-owner', '1.1.0-rc.1']);
        expect(JSON.parse(ack)).toMatchObject({ verdict: 'limitado', resultHash: 'h1', acknowledgedBy: 'u-owner', intents: limited.limitedIntents });
        expect(f.events.emit).toHaveBeenCalledWith('go_live.changed', expect.objectContaining({ tenantId: TENANT, state: 'on', verdict: 'limitado' }));
    });

    it('listo → publica sin reconocimiento; despublicar vuelve a off', async () => {
        const f = build({ result: { verdict: 'listo', blockingGaps: [], limitedIntents: [], resultHash: 'h2', specVersion: '1.1.0-rc.1' } });
        await f.service.publish(TENANT, undefined, owner);
        expect(f.updates[0][4]).toBeNull();
        await f.service.unpublish(TENANT, owner);
        expect(f.updates[1][0]).toMatch(/SET go_live_state = 'off'/);
    });

    it('ack que no es lista → 400', async () => {
        await expect(build({ result: limited }).service.publish(TENANT, 'C12', owner)).rejects.toMatchObject({ status: 400 });
    });
});

describe('ReadinessController: rutas del control de salida', () => {
    const proto = ReadinessController.prototype as any;
    it('ver: dueño y supervisor; publicar y despublicar: solo el dueño (o la plataforma suplantando)', () => {
        expect(Reflect.getMetadata(ROLES_KEY, proto.goLiveStatus)).toEqual(['super_admin', 'tenant_admin', 'tenant_supervisor']);
        expect(Reflect.getMetadata(ROLES_KEY, proto.publish)).toEqual(['super_admin', 'tenant_admin']);
        expect(Reflect.getMetadata(ROLES_KEY, proto.unpublish)).toEqual(['super_admin', 'tenant_admin']);
    });

    it('la plataforma sin suplantar no publica por el dueño', async () => {
        const goLive = { publish: jest.fn() };
        const controller = new ReadinessController({} as any, {} as any, goLive as any);
        await expect(controller.publish(TENANT, { ack: [] }, { user: { role: 'super_admin' } })).rejects.toMatchObject({ status: 403 });
        expect(goLive.publish).not.toHaveBeenCalled();
    });
});

describe('Agent Test y la evaluación nunca pasan por el control de salida', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../conversations/conversations.service.ts'), 'utf8');
    const body = (name: string) => {
        const start = source.indexOf(`async ${name}(`);
        expect(start).toBeGreaterThan(-1);
        const next = source.slice(start + 1).search(/\n {4}(?:private |public )?async \w+\(/);
        return source.slice(start, next < 0 ? undefined : start + 1 + next);
    };

    it('el control solo se consulta en los canales reales (mensaje entrante y web chat)', () => {
        const calls = [...source.matchAll(/this\.goLive\.check\(/g)].length;
        expect(calls).toBe(2);
        expect(body('runTurn')).toContain('this.goLive.check(');
        expect(body('processWidgetMessage')).toContain('this.goLive.check(');
        expect(body('executeAgentTurn')).not.toContain('goLive');
        expect(body('generateResponse')).not.toContain('goLive');
    });

    it('el web chat de prueba (enlace de demo) no se controla', () => {
        expect(body('processWidgetMessage')).toMatch(/!demoTurn && !replayTurn\) \{\s*const gate = await this\.goLive\.check/);
    });

    it('AgentTestService no conoce el control', () => {
        const agentTest = fs.readFileSync(path.resolve(__dirname, '../conversations/agent-test.service.ts'), 'utf8');
        expect(agentTest).not.toMatch(/GoLive|goLive|go_live/);
    });
});
