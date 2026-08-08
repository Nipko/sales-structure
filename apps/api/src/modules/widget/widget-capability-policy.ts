import type { ChannelType } from '@parallext/shared';

export const WIDGET_CHANNEL_TYPE = 'web_widget' as const satisfies ChannelType;

export type WidgetCapability =
    | 'public_configuration'
    | 'automated_conversation'
    | 'human_handoff';

export interface WidgetChannelPrerequisites {
    /** The socket path emits a persisted-message acknowledgement. */
    delivery: boolean;
    /** The current session is bound to tenant, widget and visitor identity. */
    identity: boolean;
    /** Origin, tenant lifecycle, plan and rate policies ran for this operation. */
    policy: boolean;
    /** The persisted token was re-read so deletion/rotation takes effect. */
    revocation: boolean;
    /** A human reply can be delivered back to this widget session. */
    humanDelivery: boolean;
}

export interface WidgetCapabilitySnapshot {
    channelType: typeof WIDGET_CHANNEL_TYPE;
    stage: 'preview' | 'automated' | 'full_channel';
    formalChannel: boolean;
    capabilities: readonly WidgetCapability[];
    missing: readonly (keyof WidgetChannelPrerequisites)[];
}

const FORMAL_PREREQUISITES: readonly (keyof WidgetChannelPrerequisites)[] = [
    'delivery', 'identity', 'policy', 'revocation',
];

/** Capability derivation is closed-world: absent evidence is false. */
export function resolveWidgetCapabilities(
    evidence: Partial<WidgetChannelPrerequisites> | null | undefined,
): WidgetCapabilitySnapshot {
    const missing = FORMAL_PREREQUISITES.filter((key) => evidence?.[key] !== true);
    const formalChannel = missing.length === 0;
    const capabilities: WidgetCapability[] = ['public_configuration'];
    if (formalChannel) capabilities.push('automated_conversation');
    if (formalChannel && evidence?.humanDelivery === true) capabilities.push('human_handoff');

    return Object.freeze({
        channelType: WIDGET_CHANNEL_TYPE,
        stage: !formalChannel ? 'preview' : evidence?.humanDelivery === true ? 'full_channel' : 'automated',
        formalChannel,
        capabilities: Object.freeze(capabilities),
        missing: Object.freeze(missing),
    });
}

export function hasWidgetCapability(
    snapshot: WidgetCapabilitySnapshot | null | undefined,
    capability: WidgetCapability,
): boolean {
    return snapshot?.capabilities.includes(capability) === true;
}
