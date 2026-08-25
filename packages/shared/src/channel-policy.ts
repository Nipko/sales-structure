/** Every transport known by the platform, including retained internal/legacy surfaces. */
export type ChannelType =
    | 'whatsapp'
    | 'instagram'
    | 'messenger'
    | 'telegram'
    | 'sms'
    | 'email'
    | 'web_widget';

/** Certified two-way conversational surfaces available to live Agent Test. */
export type ConversationalChannelType = Exclude<ChannelType, 'sms' | 'email'>;

/**
 * Single product boundary for self-service conversational channels.
 * Email is internal inbound only and SMS is retained solely for legacy data.
 */
export const CERTIFIED_SELF_SERVICE_CHANNELS: readonly ConversationalChannelType[] =
    Object.freeze(['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget']);
