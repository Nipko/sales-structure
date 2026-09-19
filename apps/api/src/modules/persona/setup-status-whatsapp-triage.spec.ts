import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PersonaController } from './persona.controller';
import {
    WHATSAPP_TRIAGE_ANSWER_IDS,
    WHATSAPP_TRIAGE_SETTING_KEY,
    applyWhatsAppTriage,
    readWhatsAppTriage,
} from './whatsapp-triage.util';

/**
 * "¿Dónde vive hoy tu número de WhatsApp?" is kept for the ACCOUNT (audit,
 * sep-2026).
 *
 * The screen promises "lo dejamos anotado y lo retomas cuando lo tengas" and
 * "te lo vamos a recordar en Inicio", and the answer lived only in the
 * browser's localStorage: from the owner's phone, a private window or a
 * cleared browser the promise was broken and Inicio had nothing to remind her
 * of. It is written to `tenants.settings.whatsappTriage` now, and setup-status
 * hands it to every surface as `{ answerId, recordedAt } | null`.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-18T15:00:00.000Z');

describe('the triage answer as a stored fact', () => {
    it('offers exactly the five answers the screen asks', () => {
        expect([...WHATSAPP_TRIAGE_ANSWER_IDS]).toEqual(['business_app', 'personal_app', 'new_number', 'other_provider', 'not_at_hand']);
    });

    it('reads back only a well-formed answer, never a guess', () => {
        expect(readWhatsAppTriage({ answerId: 'not_at_hand', recordedAt: '2026-09-18T15:00:00.000Z' }))
            .toEqual({ answerId: 'not_at_hand', recordedAt: '2026-09-18T15:00:00.000Z' });
        for (const junk of [
            null, undefined, 'not_at_hand', [], {},
            { answerId: 'sandbox', recordedAt: '2026-09-18T15:00:00.000Z' },
            { answerId: 'not_at_hand' },
            { answerId: 'not_at_hand', recordedAt: 'pronto' },
            { answerId: 'not_at_hand', recordedAt: '   ' },
        ]) expect(readWhatsAppTriage(junk)).toBeNull();
    });

    it('records a new answer with its date, keeping every other setting', () => {
        const current = Object.freeze({ timezone: 'America/Bogota', channelConnectSkippedAt: '2026-09-17T10:00:00.000Z' });
        expect(applyWhatsAppTriage(current, 'not_at_hand', NOW)).toEqual({
            ...current,
            [WHATSAPP_TRIAGE_SETTING_KEY]: { answerId: 'not_at_hand', recordedAt: NOW.toISOString() },
        });
    });

    it('does not rewrite the row when she repeats the answer on file', () => {
        // The date says when she first told us; a second click is not news.
        const current = Object.freeze({ [WHATSAPP_TRIAGE_SETTING_KEY]: { answerId: 'other_provider', recordedAt: '2026-09-10T08:00:00.000Z' } });
        expect(applyWhatsAppTriage(current, 'other_provider', NOW)).toBe(current);
    });

    it('replaces a different answer, with the date of the new one', () => {
        const current = Object.freeze({ [WHATSAPP_TRIAGE_SETTING_KEY]: { answerId: 'other_provider', recordedAt: '2026-09-10T08:00:00.000Z' } });
        expect(applyWhatsAppTriage(current, 'business_app', NOW)[WHATSAPP_TRIAGE_SETTING_KEY])
            .toEqual({ answerId: 'business_app', recordedAt: NOW.toISOString() });
    });

    it('an answer that leaves WhatsApp for later puts WhatsApp first in the saved channel order', () => {
        // The wizard saved an Instagram-led order; she then answered on the
        // WhatsApp screen and postponed it. The channel task — Inicio, Salud,
        // Assist — must name WhatsApp, the channel her reason is about.
        const current = Object.freeze({ setupWizardChannels: ['instagram', 'whatsapp', 'messenger'] });
        expect(applyWhatsAppTriage(current, 'not_at_hand', NOW).setupWizardChannels).toEqual(['whatsapp', 'instagram', 'messenger']);
        expect(applyWhatsAppTriage(current, 'other_provider', NOW).setupWizardChannels).toEqual(['whatsapp', 'instagram', 'messenger']);
        // An answer that connects now does not reorder anything.
        expect(applyWhatsAppTriage(current, 'business_app', NOW).setupWizardChannels).toEqual(['instagram', 'whatsapp', 'messenger']);
        // A plan without WhatsApp in the order, or WhatsApp already first: untouched.
        const noWhatsApp = Object.freeze({ setupWizardChannels: ['instagram'] });
        expect(applyWhatsAppTriage(noWhatsApp, 'not_at_hand', NOW).setupWizardChannels).toEqual(['instagram']);
        // Repeating the answer on file still reorders a stale order, and keeps the first date.
        const repeated = Object.freeze({
            setupWizardChannels: ['instagram', 'whatsapp'],
            [WHATSAPP_TRIAGE_SETTING_KEY]: { answerId: 'not_at_hand', recordedAt: '2026-09-10T08:00:00.000Z' },
        });
        const next = applyWhatsAppTriage(repeated, 'not_at_hand', NOW);
        expect(next.setupWizardChannels).toEqual(['whatsapp', 'instagram']);
        expect(next[WHATSAPP_TRIAGE_SETTING_KEY]).toEqual({ answerId: 'not_at_hand', recordedAt: '2026-09-10T08:00:00.000Z' });
    });

    it('removes the answer on "Cambiar mi respuesta", and is a no-op when there is none', () => {
        const current = Object.freeze({ timezone: 'America/Lima', [WHATSAPP_TRIAGE_SETTING_KEY]: { answerId: 'not_at_hand', recordedAt: '2026-09-10T08:00:00.000Z' } });
        expect(applyWhatsAppTriage(current, null, NOW)).toEqual({ timezone: 'America/Lima' });
        const empty = Object.freeze({ timezone: 'America/Lima' });
        expect(applyWhatsAppTriage(empty, null, NOW)).toBe(empty);
    });
});

describe('PUT /persona/:tenantId/whatsapp-triage', () => {
    function harness(initial: Record<string, unknown> = {}) {
        let stored: Record<string, unknown> = { ...initial };
        const updates: string[] = [];
        const events: unknown[][] = [];
        const tx = {
            $queryRawUnsafe: jest.fn(async (_sql: string, _id: string) => [{ settings: stored }]),
            $executeRawUnsafe: jest.fn(async (_sql: string, _id: string, json: string) => {
                updates.push(json);
                stored = JSON.parse(json);
                return 1;
            }),
        };
        const controller: any = Object.create(PersonaController.prototype);
        Object.assign(controller, {
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            prisma: {
                $transaction: jest.fn(async (work: any) => work(tx)),
                $executeRawUnsafe: jest.fn(async (...args: unknown[]) => { events.push(args); return 1; }),
            },
        });
        return { controller, tx, updates, events, stored: () => stored };
    }

    it('is written only by the administrator', () => {
        expect(Reflect.getMetadata(ROLES_KEY, PersonaController.prototype.setWhatsAppTriage)).toEqual(['tenant_admin']);
    });

    it('stores the answer on the tenant and answers with the shape setup-status uses', async () => {
        const h = harness({ timezone: 'America/Bogota' });
        const result = await h.controller.setWhatsAppTriage(TENANT, { answerId: 'not_at_hand' });
        expect(result.success).toBe(true);
        expect(result.data.whatsappTriage).toEqual({ answerId: 'not_at_hand', recordedAt: expect.any(String) });
        expect(Number.isNaN(Date.parse(result.data.whatsappTriage.recordedAt))).toBe(false);
        expect(h.stored()).toMatchObject({ timezone: 'America/Bogota', whatsappTriage: result.data.whatsappTriage });
        // One locked read-modify-write, on the tenant in the path.
        expect(h.tx.$queryRawUnsafe.mock.calls[0][0]).toContain('FOR UPDATE');
        expect(h.tx.$queryRawUnsafe.mock.calls[0][1]).toBe(TENANT);
        expect(h.events).toHaveLength(1);
        expect(h.events[0]).toEqual(expect.arrayContaining([
            expect.stringContaining('INSERT INTO public.onboarding_events'),
            TENANT,
            null,
            'whatsapp_triage_answered',
            'whatsapp',
        ]));
    });

    it('clears it with an explicit null', async () => {
        const h = harness({ whatsappTriage: { answerId: 'business_app', recordedAt: '2026-09-10T08:00:00.000Z' } });
        const result = await h.controller.setWhatsAppTriage(TENANT, { answerId: null });
        expect(result.data.whatsappTriage).toBeNull();
        expect(h.stored()).not.toHaveProperty('whatsappTriage');
        expect(h.events).toEqual([]);
    });

    it.each([
        ['an answer the screen does not offer', { answerId: 'sandbox' }],
        ['a missing answer (a broken client is not "clear")', {}],
        ['no body at all', undefined],
        ['a number', { answerId: 3 }],
    ])('refuses %s without touching the row', async (_label, body) => {
        const h = harness({ whatsappTriage: { answerId: 'business_app', recordedAt: '2026-09-10T08:00:00.000Z' } });
        await expect(h.controller.setWhatsAppTriage(TENANT, body)).rejects.toBeInstanceOf(BadRequestException);
        expect(h.updates).toEqual([]);
    });
});

describe('setup-status hands the answer to Inicio', () => {
    function harness(settings: Record<string, unknown>) {
        const controller: any = Object.create(PersonaController.prototype);
        Object.assign(controller, {
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            prisma: {
                tenant: { findUnique: jest.fn().mockResolvedValue({ id: TENANT, schemaName: 'tenant_demo', industry: 'salud', settings, createdAt: NOW }) },
                getTenantSchemaName: jest.fn().mockResolvedValue('tenant_demo'),
                $queryRawUnsafe: jest.fn(async () => [{ c: 0 }]),
            },
        });
        return controller;
    }

    it('exposes exactly { answerId, recordedAt }', async () => {
        const answer: any = await harness({ whatsappTriage: { answerId: 'not_at_hand', recordedAt: '2026-09-18T15:00:00.000Z', extra: 'x' } })
            .getSetupStatus(TENANT);
        expect(answer.data.whatsappTriage).toEqual({ answerId: 'not_at_hand', recordedAt: '2026-09-18T15:00:00.000Z' });
    });

    it('says null when there is no answer, or only a broken one', async () => {
        expect((await harness({}).getSetupStatus(TENANT) as any).data.whatsappTriage).toBeNull();
        expect((await harness({ whatsappTriage: { answerId: 'sandbox', recordedAt: 'x' } }).getSetupStatus(TENANT) as any).data.whatsappTriage).toBeNull();
    });
});
