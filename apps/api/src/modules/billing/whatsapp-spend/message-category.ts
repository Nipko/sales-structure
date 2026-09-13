import {
    WHATSAPP_MESSAGE_CATEGORIES, type WhatsAppMessageCategory,
} from '../whatsapp-rates';

/**
 * ═══ WHICH OF META'S FIVE CATEGORIES THIS MESSAGE IS ═══
 *
 * The price depends on it, and the five are not close together: marketing costs
 * several times what a service reply costs, and in some markets a service reply
 * inside the window costs nothing at all.
 *
 * What the engine was doing:
 *
 *   · the durable and legacy lanes passed no category at all and the authority
 *     defaulted to `service` — so every campaign, every reminder and every
 *     one-time password was priced as the cheapest thing Meta sells;
 *   · the REST lane passed the literal `'template'`, which is not one of the
 *     five, so the rate card had no row for it and the effect priced as
 *     unknown.
 *
 * Both are the same mistake in opposite directions: a category is a FACT about
 * the message, and neither lane was reading it.
 *
 * ── WHERE THE FACT LIVES ────────────────────────────────────────────────────
 *
 * For a template, in Meta's own approval: a template is approved AS
 * `MARKETING`, `UTILITY` or `AUTHENTICATION`, and that approval is synced into
 * `whatsapp_templates.category`. That is the authority, and this module does
 * not second-guess it.
 *
 * For a session message — one sent inside the 24-hour customer service window —
 * the category IS `service`, by Meta's definition rather than by our choice.
 *
 * Anything else is `unknown`, and unknown is a diagnosis rather than a default.
 * Returning `service` for a message nobody can classify is how a marketing
 * blast comes to be priced as a reply.
 */

export type CategoryResolution =
    | {
        readonly kind: 'resolved';
        readonly category: WhatsAppMessageCategory;
        /** Where the fact came from, so a wrong price can be traced. */
        readonly source: 'template_approval' | 'session_window' | 'declared';
        readonly detail: string;
    }
    | {
        readonly kind: 'unknown';
        readonly reason: 'template_category_missing' | 'template_category_unrecognised'
            | 'proactive_without_template';
        readonly detail: string;
    };

/** Meta's own approval values, as the template sync stores them. */
const FROM_META: Readonly<Record<string, WhatsAppMessageCategory>> = Object.freeze({
    MARKETING: 'marketing',
    UTILITY: 'utility',
    AUTHENTICATION: 'authentication',
    // Meta prices an authentication template delivered across borders on its
    // own line. The approval value is the same; what separates them is where it
    // is going, which `authenticationInternational` carries.
    AUTHENTICATION_INTERNATIONAL: 'authentication_international',
    SERVICE: 'service',
});

export interface CategoryEvidence {
    /** True when this message is a template send. */
    readonly isTemplate: boolean;
    /** `whatsapp_templates.category`, as Meta approved it. */
    readonly templateCategory?: string | null;
    /** The template's name, for the diagnosis only. */
    readonly templateName?: string | null;
    /**
     * True when the message is a reply inside the 24-hour customer service
     * window. A session message IS `service` by Meta's definition.
     */
    readonly insideServiceWindow?: boolean;
    /**
     * Set only where the producer genuinely knows, e.g. an authentication
     * template whose recipient is in another country.
     */
    readonly authenticationInternational?: boolean;
}

export function resolveMessageCategory(evidence: CategoryEvidence): CategoryResolution {
    if (!evidence.isTemplate) {
        // A non-template message can only be sent inside the window — Meta
        // refuses it otherwise — so the window is what makes it `service`.
        if (evidence.insideServiceWindow !== false) {
            return Object.freeze({
                kind: 'resolved' as const, category: 'service' as const,
                source: 'session_window' as const,
                detail: 'a session message inside the 24-hour customer service window',
            });
        }
        return Object.freeze({
            kind: 'unknown' as const, reason: 'proactive_without_template' as const,
            detail: 'a message outside the service window that is not a template: Meta will not '
                + 'deliver it, and it cannot be priced as a service reply',
        });
    }

    const raw = String(evidence.templateCategory ?? '').trim().toUpperCase();
    if (!raw) {
        return Object.freeze({
            kind: 'unknown' as const, reason: 'template_category_missing' as const,
            detail: `template ${evidence.templateName || '(unnamed)'} has no category from Meta; `
                + 'sync the templates for this number so the approval category is known',
        });
    }
    const mapped = FROM_META[raw];
    if (!mapped) {
        return Object.freeze({
            kind: 'unknown' as const, reason: 'template_category_unrecognised' as const,
            detail: `template ${evidence.templateName || '(unnamed)'} reports category "${raw}", `
                + 'which is not one Meta prices',
        });
    }
    // An authentication template crossing a border is its own rate line.
    const category: WhatsAppMessageCategory =
        mapped === 'authentication' && evidence.authenticationInternational
            ? 'authentication_international'
            : mapped;
    return Object.freeze({
        kind: 'resolved' as const, category, source: 'template_approval' as const,
        detail: `template ${evidence.templateName || '(unnamed)'} approved by Meta as ${raw}`,
    });
}

/** A category a caller states outright, accepted only if it is one of the five. */
export function declaredCategory(value: unknown): CategoryResolution | null {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return null;
    if (!WHATSAPP_MESSAGE_CATEGORIES.includes(raw as WhatsAppMessageCategory)) return null;
    return Object.freeze({
        kind: 'resolved' as const, category: raw as WhatsAppMessageCategory,
        source: 'declared' as const, detail: `declared by the producer as ${raw}`,
    });
}
