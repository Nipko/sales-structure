import { CERTIFIED_SELF_SERVICE_CHANNELS } from '@parallext/shared';
import { buildChannelCertificationMatrix, summariseChannelCertification,
    CHANNEL_CAPABILITIES } from './channel-certification-matrix';
import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { channelCertificationRuntime } from './channel-certification-runtime';
import { ChannelManagementController } from './channel-management.controller';

/**
 * What each channel is allowed to be said to do.
 *
 * The rule for this matrix is a prohibition rather than a target: *no
 * certifiques alcance inexistente*. Email has an internal inbound adapter and an
 * admin screen calling tenant routes that do not exist; SMS is a one-way
 * notification bought in credits. Both have appeared in capability lists beside
 * WhatsApp, and a list is exactly where scope nobody can configure gets
 * certified by adjacency.
 *
 * The derived half is fed here from the real adapters, so a declaration that
 * drifts from the code fails instead of shipping as a claim.
 */
describe('what each channel may be said to do', () => {
    // The same input the endpoint serves, so a drift between what the product
    // reports and what this file asserts is impossible rather than unlikely.
    const runtime = channelCertificationRuntime();

    const matrix = () => buildChannelCertificationMatrix(runtime);
    const row = (channelType: string) => matrix().find(entry => entry.channelType === channelType)!;

    it('never reports a conversational capability for a channel that is not self-service', () => {
        for (const channelType of ['email', 'sms']) {
            const retained = row(channelType);
            expect(retained.selfService).toBe(false);
            expect(retained.retainedScope).toEqual(expect.any(String));
            // Not one capability, in any state. A row of ticks is how scope that
            // does not exist gets read as supported.
            expect(retained.capabilities.every(cell => cell.basis === 'out_of_scope')).toBe(true);
            expect(retained.pending).toEqual([]);
        }
    });

    it('says what a retained channel actually is, in a sentence', () => {
        expect(row('email').retainedScope).toContain('routes that do not exist');
        expect(row('sms').retainedScope).toContain('One-way');
    });

    it('covers every certified self-service channel and nothing else as self-service', () => {
        expect(matrix().filter(entry => entry.selfService).map(entry => entry.channelType).sort())
            .toEqual([...CERTIFIED_SELF_SERVICE_CHANNELS].sort());
    });

    it('derives the transport from the adapters rather than from a declaration', () => {
        // Every certified channel WITH A PROVIDER implements the strict
        // transport today; if one stops, this says so before the matrix claims
        // otherwise. The widget is deliberately absent: there is nobody to hand
        // the message to, so it admits locally instead.
        expect([...runtime.strictTransports].sort())
            .toEqual(CERTIFIED_SELF_SERVICE_CHANNELS.filter(channel => channel !== 'web_widget').sort());
        for (const channelType of CERTIFIED_SELF_SERVICE_CHANNELS) {
            const cell = row(channelType).capabilities.find(entry => entry.capability === 'outbound_text')!;
            expect(cell).toMatchObject({ basis: 'derived', state: 'operating' });
        }
        expect(row('web_widget').capabilities.find(cell => cell.capability === 'outbound_text')?.evidence)
            .toContain('local admission');
    });

    it('reports a missing status producer as pending instead of assuming it', () => {
        const telegram = row('telegram');
        expect(telegram.capabilities.find(cell => cell.capability === 'delivery_receipt'))
            .toMatchObject({ basis: 'derived', state: 'pending' });
        expect(telegram.pending).toContain('delivery_receipt');
        // And a channel that does have one is not dragged down by its neighbour.
        expect(row('whatsapp').capabilities.find(cell => cell.capability === 'delivery_receipt')?.state)
            .toBe('operating');
    });

    it('separates "this channel does not offer it" from "this channel is missing it"', () => {
        const telegram = row('telegram');
        const flow = telegram.capabilities.find(cell => cell.capability === 'flow')!;
        expect(flow.basis).toBe('out_of_scope');
        // A Telegram without Flow is not a Telegram with a gap.
        expect(telegram.pending).not.toContain('flow');
        expect(row('whatsapp').capabilities.find(cell => cell.capability === 'flow'))
            .toMatchObject({ basis: 'declared', state: 'prepared' });
    });

    it('gives every declared capability something a reader can go and look at', () => {
        for (const entry of matrix().filter(row => row.selfService)) {
            for (const cell of entry.capabilities.filter(cell => cell.basis === 'declared')) {
                expect(cell.evidence.length).toBeGreaterThan(20);
                expect(cell.evidence).not.toBe('nothing declared');
            }
        }
    });

    it('refuses to call a channel complete while anything in scope is pending', () => {
        const summary = summariseChannelCertification(matrix());
        expect(summary.selfService).toBe(5);
        expect(summary.retained).toBe(2);
        // Telegram and the widget have no provider read receipt, so nothing is
        // complete yet — and the summary names the capability, not just a count.
        expect(summary.pendingByCapability.read_receipt).toEqual(['telegram', 'web_widget']);
        expect(summary.complete).toBeLessThan(summary.selfService);
    });

    it('rolls a channel up to the least advanced thing in its scope', () => {
        // `prepared` beats nothing and loses to nothing: a declared capability
        // with evidence is not the same as one shown working end to end.
        expect(row('telegram').state).toBe('pending');
        expect(row('whatsapp').state).toBe('prepared');
    });

    it('keeps one cell per capability per channel, in a stable order', () => {
        for (const entry of matrix()) {
            expect(entry.capabilities.map(cell => cell.capability)).toEqual([...CHANNEL_CAPABILITIES]);
        }
    });
    it('is reachable, which is the whole reason it stopped living in a test', () => {
        // The only importer of this module used to be this file. An endpoint
        // declared after `:channelType/status` would still be unreachable — Nest
        // matches in declaration order, so that route would answer this path
        // with a status lookup for a channel called "certification".
        const paths = Object.getOwnPropertyNames(ChannelManagementController.prototype)
            .filter(name => name !== 'constructor')
            .map(name => Reflect.getMetadata(PATH_METADATA,
                (ChannelManagementController.prototype as any)[name]))
            .filter((path): path is string => typeof path === 'string');
        const index = paths.indexOf('certification');
        expect(index).toBeGreaterThanOrEqual(0);
        expect(paths.slice(0, index).filter(path => path.startsWith(':') || path.includes('/:'))).toEqual([]);
    });
});
