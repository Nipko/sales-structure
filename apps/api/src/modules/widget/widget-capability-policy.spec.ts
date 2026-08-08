import type { ChannelType } from '@parallext/shared';
import {
    WIDGET_CHANNEL_TYPE,
    hasWidgetCapability,
    resolveWidgetCapabilities,
} from './widget-capability-policy';

describe('widget staged capability policy', () => {
    it('uses the formal shared ChannelType slug', () => {
        const channel: ChannelType = WIDGET_CHANNEL_TYPE;
        expect(channel).toBe('web_widget');
    });

    it.each(['delivery', 'identity', 'policy', 'revocation'] as const)(
        'fails closed when %s evidence is missing',
        (missing) => {
            const evidence: any = {
                delivery: true, identity: true, policy: true, revocation: true, humanDelivery: true,
            };
            delete evidence[missing];
            const snapshot = resolveWidgetCapabilities(evidence);
            expect(snapshot.formalChannel).toBe(false);
            expect(snapshot.stage).toBe('preview');
            expect(snapshot.missing).toContain(missing);
            expect(hasWidgetCapability(snapshot, 'automated_conversation')).toBe(false);
            expect(hasWidgetCapability(snapshot, 'human_handoff')).toBe(false);
        },
    );

    it('enables automated delivery before human handoff and only promotes after human delivery exists', () => {
        const automated = resolveWidgetCapabilities({
            delivery: true, identity: true, policy: true, revocation: true, humanDelivery: false,
        });
        expect(automated).toMatchObject({ formalChannel: true, stage: 'automated' });
        expect(hasWidgetCapability(automated, 'automated_conversation')).toBe(true);
        expect(hasWidgetCapability(automated, 'human_handoff')).toBe(false);

        const full = resolveWidgetCapabilities({
            delivery: true, identity: true, policy: true, revocation: true, humanDelivery: true,
        });
        expect(full.stage).toBe('full_channel');
        expect(hasWidgetCapability(full, 'human_handoff')).toBe(true);
    });
});
