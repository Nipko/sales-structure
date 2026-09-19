import { WHATSAPP_DELIVERY_BLOCK_REASONS } from '@parallext/shared';
import {
    FUNDING_REQUIRED_FROM, resolveWabaZone, spendEnforcementFromSettings, whatsappAccountSendReadiness,
} from './account-send-readiness';
import { WhatsappSpendService } from './whatsapp-spend.service';

/**
 * The account-wide half of the send admission, read by the quality check that
 * tells an owner "WhatsApp cannot deliver". These pin that the reader and the
 * admission are the same rule: where they could drift, the test drives the real
 * `authorize` with the same input and compares.
 */

const NOW = new Date('2026-09-17T15:00:00.000Z');
const ZONE = 'America/Bogota';
const pause = (over: Record<string, unknown> = {}) => ({
    reason: 'funding_not_ready', code: 131042, detail: 'Business eligibility payment issue',
    since: '2026-09-16T10:00:00.000Z', source: 'status_webhook', observations: 2,
    lastSeen: '2026-09-17T09:00:00.000Z', ...over,
});
const established = { billingCurrencyEvidence: { currency: 'COP', source: 'meta_waba', observedAt: '2026-09-10T00:00:00.000Z' } };
const storedAbsent = (checkedAt: string) => ({
    wabaId: 'waba-1',
    fundingReadiness: { state: 'absent', source: 'graph_account_read', checkedAt, wabaId: 'waba-1' },
});

describe('account-send-readiness', () => {
    it('speaks only the shared vocabulary', () => {
        const readiness = whatsappAccountSendReadiness({
            metadata: { sendPause: pause(), wabaId: 'waba-1' }, wabaTimezone: null, enforcement: 'enforce', now: NOW,
        });
        for (const reason of [...readiness.refusals, ...readiness.upcoming]) {
            expect(WHATSAPP_DELIVERY_BLOCK_REASONS).toContain(reason);
        }
        expect(readiness.refusals).toEqual(['funding_restricted', 'timezone_missing', 'currency_unknown']);
    });

    it('a healthy number with a zone refuses nothing, in either mode when the currency is established', () => {
        for (const enforcement of ['observe', 'enforce'] as const) {
            expect(whatsappAccountSendReadiness({ metadata: established, wabaTimezone: ZONE, enforcement, now: NOW }))
                .toMatchObject({ refusals: [], upcoming: [], fundingState: 'not_checked' });
        }
    });

    describe('timezone_missing — the one both modes refuse', () => {
        it.each([[null], [''], ['   '], ['Mars/Olympus_Mons']])('refuses %p', (zone) => {
            expect(whatsappAccountSendReadiness({ metadata: established, wabaTimezone: zone, enforcement: 'observe', now: NOW })
                .refusals).toEqual(['timezone_missing']);
        });

        it('agrees with `authorize` about which zones are usable', async () => {
            // The admission's own gate, run for real: a zone the reader calls
            // missing is one `authorize` blocks as `timezone_missing`, and a
            // usable one gets past that step.
            const spend = new WhatsappSpendService({} as any);
            const identity: any = {
                tenantId: 't', channelType: 'whatsapp', channelAccountId: 'wa-1', payerKind: 'unknown',
                payerWabaId: null, credentialId: 'c', credentialSource: 'system_user', recipientScope: 'customer',
                recipientRef: 'r', category: 'service', currency: 'COP',
            };
            for (const zone of [null, '', 'Mars/Olympus_Mons', ZONE, 'Europe/Madrid']) {
                const result: any = await spend.authorize('tenant_x', {
                    effectKey: 'k', identity, deliveries: 1, wabaTimeZone: zone, admissionReason: 'test', at: NOW,
                });
                const refusedForZone = result.outcome === 'blocked' && result.block.code === 'timezone_missing';
                expect({ zone, refusedForZone }).toEqual({ zone, refusedForZone: resolveWabaZone(zone, NOW) === null });
            }
        });
    });

    describe('funding', () => {
        it('a live pause is `funding_restricted` whatever code Meta gave, as the admission refuses any live pause', () => {
            for (const code of [131042, null, 100]) {
                expect(whatsappAccountSendReadiness({
                    metadata: { ...established, sendPause: pause({ code }) }, wabaTimezone: ZONE, enforcement: 'observe', now: NOW,
                }).refusals).toEqual(['funding_restricted']);
            }
        });

        it('a cleared pause stops nothing', () => {
            expect(whatsappAccountSendReadiness({
                metadata: { ...established, sendPause: pause({ clearedAt: '2026-09-17T10:00:00.000Z', clearedBy: 'operator' }) },
                wabaTimezone: ZONE, enforcement: 'observe', now: NOW,
            }).refusals).toEqual([]);
        });

        it('an established absence is upcoming before the effective date and a refusal from it, in the WABA zone', () => {
            const before = whatsappAccountSendReadiness({
                metadata: { ...established, ...storedAbsent('2026-09-17T12:00:00.000Z') }, wabaTimezone: ZONE, enforcement: 'observe', now: NOW,
            });
            expect(before).toMatchObject({ refusals: [], upcoming: ['funding_absent'], fundingState: 'absent' });

            // 1-oct 03:00 UTC is still 30-sep 22:00 in Bogotá: Meta's date has not turned there.
            const lateEvening = new Date(`${FUNDING_REQUIRED_FROM}T03:00:00.000Z`);
            expect(whatsappAccountSendReadiness({
                metadata: { ...established, ...storedAbsent('2026-09-30T23:00:00.000Z') }, wabaTimezone: ZONE, enforcement: 'observe', now: lateEvening,
            }).upcoming).toEqual(['funding_absent']);

            const after = new Date(`${FUNDING_REQUIRED_FROM}T06:00:00.000Z`);
            expect(whatsappAccountSendReadiness({
                metadata: { ...established, ...storedAbsent('2026-10-01T05:00:00.000Z') }, wabaTimezone: ZONE, enforcement: 'observe', now: after,
            })).toMatchObject({ refusals: ['funding_absent'], upcoming: [] });
        });

        it('keeps an established absence two days after the check, with nothing changed', () => {
            // The owner checked on the 15th and has not added a card: the
            // deadline is still coming, and saying "pass" now would be false.
            const readiness = whatsappAccountSendReadiness({
                metadata: { ...established, ...storedAbsent('2026-09-15T12:00:00.000Z') },
                wabaTimezone: ZONE, enforcement: 'observe', now: NOW,
            });
            expect(readiness).toMatchObject({ refusals: [], upcoming: ['funding_absent'], fundingState: 'absent' });
        });

        it('never concludes absence from an unknown or foreign reading', () => {
            const unknown = { wabaId: 'waba-1', fundingReadiness: { state: 'unknown', checkedAt: '2026-09-17T12:00:00.000Z', wabaId: 'waba-1' } };
            const foreign = { ...storedAbsent('2026-09-17T12:00:00.000Z'), wabaId: 'waba-2' };
            for (const metadata of [unknown, foreign]) {
                const readiness = whatsappAccountSendReadiness({ metadata: { ...established, ...metadata }, wabaTimezone: ZONE, enforcement: 'observe', now: NOW });
                expect(readiness.refusals).toEqual([]);
                expect(readiness.upcoming).toEqual([]);
            }
        });
    });

    describe('currency_unknown — only where the admission defers', () => {
        it('is reported under enforce and never under observe', () => {
            expect(whatsappAccountSendReadiness({ metadata: {}, wabaTimezone: ZONE, enforcement: 'observe', now: NOW }).refusals).toEqual([]);
            expect(whatsappAccountSendReadiness({ metadata: {}, wabaTimezone: ZONE, enforcement: 'enforce', now: NOW }).refusals)
                .toEqual(['currency_unknown']);
            // A bare legacy string has no provenance: the authority refuses it.
            expect(whatsappAccountSendReadiness({ metadata: { billingCurrency: 'COP' }, wabaTimezone: ZONE, enforcement: 'enforce', now: NOW }).refusals)
                .toEqual(['currency_unknown']);
        });
    });

    it('reads the enforcement setting the admission reads', () => {
        expect(spendEnforcementFromSettings({ whatsappSpend: { enforcement: 'enforce' } })).toBe('enforce');
        for (const settings of [undefined, null, {}, { whatsappSpend: {} }, { whatsappSpend: { enforcement: 'ENFORCE' } }]) {
            expect(spendEnforcementFromSettings(settings)).toBe('observe');
        }
    });
});
