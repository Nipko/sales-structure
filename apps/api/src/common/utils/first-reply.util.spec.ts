import {
    FIRST_REPLY_SETTING_KEY,
    applyFirstReply,
    forgetFirstReplyMemoryForTests,
    isRecordedFirstReply,
    recordFirstReply,
} from './first-reply.util';

/**
 * La primera respuesta real, registrada una sola vez.
 *
 * Qué impone la base y qué no: `public.tenants.settings` es
 * `JSONB NOT NULL DEFAULT '{}'` (migración 20260301000000_init) y no tiene
 * ninguna restricción por clave. No hay índice ni CHECK que impida dos horas
 * distintas: lo único que lo impide es el candado de fila
 * (`SELECT … FOR UPDATE` en `mutateTenantSettingsAtomic`) más la regla de
 * "primera gana" que corre DENTRO de ese candado. Por eso el doble de abajo no
 * finge ninguna restricción: guarda un documento, cuenta lecturas con candado y
 * escrituras, y las pruebas afirman el orden candado → escritura y que la
 * segunda escritura nunca ocurre.
 */
const tenantId = '11111111-1111-4111-8111-111111111111';
const T1 = new Date('2026-09-14T15:04:05.000Z');
const T2 = new Date('2026-09-15T09:00:00.000Z');

function fakeTenantsTable(initial: Record<string, unknown> | null) {
    const state = { settings: initial, locks: 0, writes: 0, order: [] as string[] };
    const tx = {
        $queryRawUnsafe: jest.fn(async (sql: string, id: string) => {
            state.order.push(/FOR UPDATE/i.test(sql) ? 'lock' : 'read');
            if (/FOR UPDATE/i.test(sql)) state.locks++;
            if (id !== tenantId || state.settings === null) return [];
            return [{ settings: state.settings }];
        }),
        $executeRawUnsafe: jest.fn(async (_sql: string, id: string, json: string) => {
            state.order.push('write');
            if (id !== tenantId || state.settings === null) return 0;
            state.writes++;
            state.settings = JSON.parse(json);
            return 1;
        }),
    };
    const prisma: any = { $transaction: jest.fn(async (callback: any) => callback(tx)) };
    return { state, tx, prisma };
}

describe('applyFirstReply — the pure rule', () => {
    const at = T1.toISOString();

    it.each(['account_created', 'agent_reviewed', 'channel_deferred', 'channel_connected'])(
        'moves %s to live and stamps the hour', (stage) => {
            expect(applyFirstReply({ onboardingStage: stage, other: 1 }, at))
                .toEqual({ onboardingStage: 'live', other: 1, [FIRST_REPLY_SETTING_KEY]: at });
        });

    it('keeps completed (it outranks live) but still stamps the hour — the account the fix exists for', () => {
        expect(applyFirstReply({ onboardingStage: 'completed' }, at))
            .toEqual({ onboardingStage: 'completed', [FIRST_REPLY_SETTING_KEY]: at });
    });

    it('never overwrites a recorded hour, and still advances a stage that lags behind it', () => {
        const earlier = '2026-09-10T10:00:00.000Z';
        expect(applyFirstReply({ onboardingStage: 'channel_connected', [FIRST_REPLY_SETTING_KEY]: earlier }, at))
            .toEqual({ onboardingStage: 'live', [FIRST_REPLY_SETTING_KEY]: earlier });
    });

    it('returns the very same object when nothing changes, so the row is not rewritten', () => {
        const settled = { onboardingStage: 'completed', [FIRST_REPLY_SETTING_KEY]: '2026-09-10T10:00:00.000Z' };
        expect(applyFirstReply(settled, at)).toBe(settled);
        const liveWithout = { onboardingStage: 'live' };
        expect(applyFirstReply(liveWithout, at)).toBe(liveWithout);
    });

    it('moves an account from before the stage contract to live without inventing its first-reply date', () => {
        // Its first reply happened long before the field existed: today would be a false date.
        expect(applyFirstReply({ timezone: 'America/Bogota' }, at))
            .toEqual({ timezone: 'America/Bogota', onboardingStage: 'live' });
        // …and the next call, now that it reads `live`, does not stamp it either.
        const after = applyFirstReply({ timezone: 'America/Bogota' }, at);
        expect(applyFirstReply(after, T2.toISOString())).toBe(after);
    });

    it('treats a value that is not a date as no hour at all', () => {
        for (const junk of ['', 'soon', 42, null, { at }]) {
            expect(isRecordedFirstReply(junk)).toBe(false);
            expect(applyFirstReply({ onboardingStage: 'completed', [FIRST_REPLY_SETTING_KEY]: junk }, at))
                .toEqual({ onboardingStage: 'completed', [FIRST_REPLY_SETTING_KEY]: at });
        }
    });
});

describe('recordFirstReply — the writer', () => {
    beforeEach(() => forgetFirstReplyMemoryForTests());

    it('stamps the hour and moves the stage in one locked mutation', async () => {
        const table = fakeTenantsTable({ onboardingStage: 'channel_connected', timezone: 'America/Lima' });

        await expect(recordFirstReply(table.prisma, tenantId, { at: T1 })).resolves.toBe('recorded');

        expect(table.state.settings).toEqual({
            onboardingStage: 'live', timezone: 'America/Lima', [FIRST_REPLY_SETTING_KEY]: T1.toISOString(),
        });
        expect(table.state.order).toEqual(['lock', 'write']);
        expect(table.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('first write wins: a later reply from another process never moves the hour', async () => {
        const table = fakeTenantsTable({ onboardingStage: 'channel_connected' });
        await recordFirstReply(table.prisma, tenantId, { at: T1 });

        // Another process (the API and the worker each keep their own memory).
        forgetFirstReplyMemoryForTests();
        await expect(recordFirstReply(table.prisma, tenantId, { at: T2 })).resolves.toBe('already_recorded');

        expect(table.state.settings?.[FIRST_REPLY_SETTING_KEY]).toBe(T1.toISOString());
        expect(table.state.writes).toBe(1);
        // It still took the lock: that is what serialises two processes.
        expect(table.state.locks).toBe(2);
    });

    it('completed stays completed, and the hour is written', async () => {
        const table = fakeTenantsTable({ onboardingStage: 'completed', setupWizardCompleted: true });

        await expect(recordFirstReply(table.prisma, tenantId, { at: T1 })).resolves.toBe('recorded');

        expect(table.state.settings).toEqual({
            onboardingStage: 'completed', setupWizardCompleted: true, [FIRST_REPLY_SETTING_KEY]: T1.toISOString(),
        });
    });

    it('is cheap on every send: once settled, this process does not read the row again', async () => {
        const table = fakeTenantsTable({ onboardingStage: 'account_created' });
        await recordFirstReply(table.prisma, tenantId, { at: T1 });
        await expect(recordFirstReply(table.prisma, tenantId, { at: T2 })).resolves.toBe('remembered');
        await expect(recordFirstReply(table.prisma, tenantId, { at: T2 })).resolves.toBe('remembered');
        expect(table.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('two replies at the same moment open one transaction', async () => {
        const table = fakeTenantsTable({ onboardingStage: 'channel_connected' });
        const outcomes = await Promise.all([
            recordFirstReply(table.prisma, tenantId, { at: T1 }),
            recordFirstReply(table.prisma, tenantId, { at: T2 }),
        ]);
        expect(outcomes.sort()).toEqual(['recorded', 'remembered']);
        expect(table.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(table.state.settings?.[FIRST_REPLY_SETTING_KEY]).toBe(T1.toISOString());
    });

    it('never throws: a failed write resolves, and the next reply tries again', async () => {
        const table = fakeTenantsTable({ onboardingStage: 'channel_connected' });
        table.prisma.$transaction.mockRejectedValueOnce(new Error('connection terminated'));

        await expect(recordFirstReply(table.prisma, tenantId, { at: T1 })).resolves.toBe('failed');
        expect(table.state.writes).toBe(0);

        // The memory was released, so the next delivered reply records it.
        await expect(recordFirstReply(table.prisma, tenantId, { at: T2 })).resolves.toBe('recorded');
        expect(table.state.settings?.[FIRST_REPLY_SETTING_KEY]).toBe(T2.toISOString());
    });

    it('never throws on a missing tenant row or a client without transactions', async () => {
        const missing = fakeTenantsTable(null);
        await expect(recordFirstReply(missing.prisma, tenantId, { at: T1 })).resolves.toBe('failed');

        forgetFirstReplyMemoryForTests();
        await expect(recordFirstReply({} as any, tenantId, { at: T1 })).resolves.toBe('failed');
    });

    it('does nothing without a tenant', async () => {
        const table = fakeTenantsTable({ onboardingStage: 'channel_connected' });
        await expect(recordFirstReply(table.prisma, '', { at: T1 })).resolves.toBe('skipped');
        await expect(recordFirstReply(table.prisma, undefined, { at: T1 })).resolves.toBe('skipped');
        expect(table.prisma.$transaction).not.toHaveBeenCalled();
    });
});
