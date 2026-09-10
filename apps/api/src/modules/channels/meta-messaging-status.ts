import type { ChannelDeliveryStatusEvent } from './channel-delivery-status';

/**
 * What one `entry[].messaging[]` element from Meta actually is.
 *
 * Messenger and Instagram share an envelope and almost nothing else. Both
 * adapters answered the question "is this an inbound message?" and returned
 * `null` for everything else, which put delivery confirmations, read receipts,
 * echoes, reactions and postbacks into the same silence. The controller then
 * did `if (!normalized) continue;` and the event was gone with no log — the
 * same shape of blindness that let months of rejected WebP images keep saying
 * "Sent". This classifies the element first, so the only thing that reaches the
 * inbound path is an inbound message and everything else is named out loud.
 */
export type MetaMessagingEventKind =
    | 'inbound_message'
    | 'delivery'
    | 'read'
    | 'echo'
    | 'reaction'
    | 'postback'
    | 'referral'
    | 'optin'
    | 'handover'
    | 'account_linking'
    | 'unknown';

/**
 * A provider claim about everything sent to one thread up to an instant.
 *
 * Meta's per-message ids are the easy half. The watermark is the half that
 * cannot be keyed on a receipt at all: `read` on Messenger carries NO mid, only
 * "everything sent to this conversation before or at this timestamp was read",
 * and `delivery.mids` is documented as optional — "Field may not be present" —
 * so even a delivery can arrive as a bare cutoff. Inventing a mid to feed the
 * per-receipt writer would be a lie; resolving the cutoff against the dispatch
 * rows we actually accepted for THIS recipient is not.
 */
export interface MetaWatermarkClaim {
    readonly status: 'delivered' | 'read';
    /** Milliseconds since epoch, as Meta sends it. */
    readonly watermarkMs: number;
    /** The PSID/IGSID the thread belongs to — the fence around the resolution. */
    readonly recipient: string;
}

export interface MetaMessagingStatus {
    readonly kind: MetaMessagingEventKind;
    /** Receipts Meta named outright. These go straight to the shared writer. */
    readonly events: readonly ChannelDeliveryStatusEvent[];
    /** Set only when Meta gave a cutoff instead of ids. */
    readonly watermark: MetaWatermarkClaim | null;
}

const NOTHING: MetaMessagingStatus = Object.freeze({ kind: 'unknown', events: [], watermark: null });

const receipt = (value: unknown): string | null => {
    const text = typeof value === 'string' ? value.trim() : '';
    // 300 is the ceiling the outbox enforces on a receipt; a longer id could
    // never have been stored, so passing it on would only produce a lookup miss.
    return text && text.length <= 300 ? text : null;
};

/**
 * Meta's clock, only when it is plausibly a clock.
 *
 * A zero, a string, or a value from 1970 would resolve a watermark against
 * every message ever sent to the contact. The floor is the platform's own
 * lifetime; the ceiling admits ordinary skew and refuses a year from now.
 */
const MIN_WATERMARK_MS = Date.UTC(2015, 0, 1);
function watermarkMs(value: unknown): number | null {
    const ms = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(ms) || !Number.isInteger(ms)) return null;
    if (ms < MIN_WATERMARK_MS || ms > Date.now() + 86_400_000) return null;
    return ms;
}

/**
 * Classify one messaging element and pull whatever status it carries.
 *
 * `channelType` decides how `read` is read, and the two are genuinely different
 * events wearing the same key. Messenger's `message_reads` gives
 * `read: { watermark }`; Instagram's `messaging_seen` gives `read: { mid }`,
 * naming one message. Instagram sends no `delivery` at all — Meta documents
 * `message_deliveries` as "Only available for Messenger conversations" — so an
 * Instagram delivery is not modelled as a normal case, only tolerated if Meta
 * ever starts sending one.
 */
export function classifyMetaMessagingEvent(
    item: any, channelType: 'messenger' | 'instagram',
): MetaMessagingStatus {
    if (!item || typeof item !== 'object') return NOTHING;

    // Echo first: it arrives wearing `message`, and it is our OWN outbound
    // coming back. Letting it reach the inbound path would answer ourselves.
    if (item.message?.is_echo) return { kind: 'echo', events: [], watermark: null };
    if (item.message) return { kind: 'inbound_message', events: [], watermark: null };

    // The thread's other end. Meta puts it in `sender` for every status event:
    // the page/IG account is the `recipient` there, not the customer.
    const contact = typeof item.sender?.id === 'string' ? item.sender.id.trim() : '';

    if (item.delivery && typeof item.delivery === 'object') {
        const mids: unknown[] = Array.isArray(item.delivery.mids) ? item.delivery.mids : [];
        const events = mids
            .map(mid => receipt(mid))
            .filter((mid): mid is string => mid !== null)
            .map(providerMessageId => Object.freeze({
                providerMessageId,
                status: 'delivered' as const,
                recipient: contact || null,
                errorCode: null,
                errorDetail: null,
            }));
        if (events.length) return { kind: 'delivery', events, watermark: null };
        // No usable ids. Meta says the array "may not be present" for older
        // clients, and the cutoff is then the only thing the event carries.
        const ms = watermarkMs(item.delivery.watermark);
        return {
            kind: 'delivery',
            events: [],
            watermark: ms !== null && contact
                ? Object.freeze({ status: 'delivered' as const, watermarkMs: ms, recipient: contact })
                : null,
        };
    }

    if (item.read && typeof item.read === 'object') {
        if (channelType === 'instagram') {
            // One named message. No watermark resolution needed or wanted:
            // Instagram publishes no properties table for `messaging_seen`, so
            // anything beyond the documented `mid` is not something to guess at.
            const mid = receipt(item.read.mid);
            return {
                kind: 'read',
                events: mid
                    ? [Object.freeze({
                        providerMessageId: mid, status: 'read' as const,
                        recipient: contact || null, errorCode: null, errorDetail: null,
                    })]
                    : [],
                watermark: null,
            };
        }
        const ms = watermarkMs(item.read.watermark);
        return {
            kind: 'read',
            events: [],
            watermark: ms !== null && contact
                ? Object.freeze({ status: 'read' as const, watermarkMs: ms, recipient: contact })
                : null,
        };
    }

    // Everything below is real traffic we do not model. It gets a name so the
    // next person reads "postback ignored" instead of discovering silence.
    if (item.reaction) return { kind: 'reaction', events: [], watermark: null };
    if (item.postback) return { kind: 'postback', events: [], watermark: null };
    if (item.referral) return { kind: 'referral', events: [], watermark: null };
    if (item.optin) return { kind: 'optin', events: [], watermark: null };
    if (item.pass_thread_control || item.take_thread_control || item.request_thread_control) {
        return { kind: 'handover', events: [], watermark: null };
    }
    if (item.account_linking) return { kind: 'account_linking', events: [], watermark: null };
    return NOTHING;
}

/** Whether the element is something the inbound pipeline should even look at. */
export function isInboundMessagingEvent(status: MetaMessagingStatus): boolean {
    return status.kind === 'inbound_message';
}
