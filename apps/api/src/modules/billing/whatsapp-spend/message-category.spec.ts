import { declaredCategory, resolveMessageCategory } from './message-category';
import { WHATSAPP_MESSAGE_CATEGORIES } from '../whatsapp-rates';

/**
 * ═══ A CATEGORY IS A FACT, NOT A DEFAULT ═══
 *
 * The price depends on it and the five are not close together: marketing costs
 * several times a service reply, and in some markets a service reply inside the
 * window costs nothing.
 *
 * Two lanes were getting it wrong in opposite directions. The durable and
 * legacy lanes passed nothing and the authority defaulted to `service`, so
 * every campaign and every one-time password priced as the cheapest thing Meta
 * sells. The REST lane passed the literal `'template'`, which is not one of the
 * five, so nothing priced at all.
 */

describe('a template', () => {
    it('is whatever Meta approved it as', () => {
        for (const [approved, expected] of [
            ['MARKETING', 'marketing'],
            ['UTILITY', 'utility'],
            ['AUTHENTICATION', 'authentication'],
            ['marketing', 'marketing'],
        ] as [string, string][]) {
            const result = resolveMessageCategory({ isTemplate: true, templateCategory: approved });
            expect({ approved, category: result.kind === 'resolved' ? result.category : null })
                .toEqual({ approved, category: expected });
        }
    });

    it('names its own source, so a wrong price can be traced', () => {
        const result = resolveMessageCategory({
            isTemplate: true, templateCategory: 'UTILITY', templateName: 'order_shipped',
        });
        expect(result.kind === 'resolved' && result.source).toBe('template_approval');
        expect(result.kind === 'resolved' && result.detail).toContain('order_shipped');
    });

    it('prices an authentication template crossing a border on its own line', () => {
        const domestic = resolveMessageCategory({
            isTemplate: true, templateCategory: 'AUTHENTICATION' });
        const abroad = resolveMessageCategory({
            isTemplate: true, templateCategory: 'AUTHENTICATION',
            authenticationInternational: true });
        expect(domestic.kind === 'resolved' && domestic.category).toBe('authentication');
        expect(abroad.kind === 'resolved' && abroad.category).toBe('authentication_international');
    });

    it('is unknown when Meta has not told us the category', () => {
        // The honest answer, and the one the old default hid: a template whose
        // approval never synced priced as a service reply.
        const result = resolveMessageCategory({
            isTemplate: true, templateCategory: null, templateName: 'promo_oct' });
        expect(result.kind).toBe('unknown');
        expect(result.kind === 'unknown' && result.reason).toBe('template_category_missing');
        expect(result.detail).toContain('promo_oct');
        expect(result.detail).toContain('sync the templates');
    });

    it('is unknown when the category is not one Meta prices', () => {
        const result = resolveMessageCategory({
            isTemplate: true, templateCategory: 'TRANSACTIONAL' });
        expect(result.kind === 'unknown' && result.reason).toBe('template_category_unrecognised');
    });

    it('is never the pseudo-type the REST lane used to send', () => {
        // `'template'` is not one of Meta's five. Passed as a category it
        // matched no row in the rate card, so the effect priced as unknown and
        // the exposure was invisible.
        expect(declaredCategory('template')).toBeNull();
        expect(WHATSAPP_MESSAGE_CATEGORIES).not.toContain('template' as never);
    });
});

describe('a session message', () => {
    it('is service, because that is what Meta calls it', () => {
        const result = resolveMessageCategory({ isTemplate: false, insideServiceWindow: true });
        expect({ kind: result.kind, category: result.kind === 'resolved' ? result.category : null })
            .toEqual({ kind: 'resolved', category: 'service' });
        expect(result.kind === 'resolved' && result.source).toBe('session_window');
    });

    it('is service when the window is simply not known', () => {
        // A non-template message can only be delivered inside the window —
        // Meta refuses it otherwise — so absence of the flag is not absence of
        // the window.
        const result = resolveMessageCategory({ isTemplate: false });
        expect(result.kind === 'resolved' && result.category).toBe('service');
    });

    it('is unknown when it is provably outside the window', () => {
        // Meta will not deliver it at all. Pricing it as a service reply would
        // report a cost for a message that cannot exist.
        const result = resolveMessageCategory({ isTemplate: false, insideServiceWindow: false });
        expect(result.kind === 'unknown' && result.reason).toBe('proactive_without_template');
    });
});

describe('a category a producer states outright', () => {
    it('is accepted when it is one of the five', () => {
        for (const category of WHATSAPP_MESSAGE_CATEGORIES) {
            const result = declaredCategory(category);
            expect({ category, ok: result?.kind === 'resolved' && result.category === category })
                .toEqual({ category, ok: true });
        }
    });

    it('is refused when it is anything else', () => {
        for (const value of ['template', 'promo', '', null, undefined, 'urgent']) {
            expect({ value, result: declaredCategory(value) }).toEqual({ value, result: null });
        }
    });

    it('forgives casing and a stray space, which invent nothing', () => {
        // Trimming ` SERVICE ` to `service` is reading what was written. It is
        // not the same act as turning an unrecognised word into a category,
        // which is the one this refuses.
        const result = declaredCategory('  SERVICE ');
        expect(result?.kind === 'resolved' && result.category).toBe('service');
    });
});
