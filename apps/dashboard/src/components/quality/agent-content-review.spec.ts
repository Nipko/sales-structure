import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentContentProposal } from '@parallext/shared';
import { AgentContentReview } from './AgentContentReview';

let mockLocale = 'es';
const messages: Record<string, any> = Object.fromEntries(['es', 'en', 'pt', 'fr']
    .map(locale => [locale, require(`../../../messages/${locale}.json`).agentContent]));
jest.mock('next-intl', () => ({
    useTranslations: () => {
        const lookup = (key: string) => key.split('.').reduce((node: any, part) => node?.[part], messages[mockLocale]);
        const translate = (key: string) => {
            const value = lookup(key);
            if (typeof value !== 'string') throw new Error(`Missing agentContent translation: ${mockLocale}.${key}`);
            return value;
        };
        translate.has = (key: string) => typeof lookup(key) === 'string';
        return translate;
    },
}));
jest.mock('@/lib/api', () => ({ api: {} }));

/**
 * What a person is shown before Assist writes a row on their behalf.
 *
 * The configuration card beside this one renders a diff. A creation has no
 * `before`, and an empty left-hand column reads as a field being cleared rather
 * than an object being made — so the absence has to be said in words, and every
 * field that will be written has to be visible before the button is pressed.
 */
describe('a content object before it exists', () => {
    const proposal = (over: Partial<AgentContentProposal> = {}): AgentContentProposal => ({
        id: 'proposal-1',
        operation: 'knowledge.faq.create',
        domain: 'knowledge',
        target: { service: 'KnowledgeService', method: 'createResource', table: 'knowledge_resources' },
        route: '/admin/knowledge',
        digest: 'a'.repeat(64),
        status: 'proposed',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        preview: {
            before: null, beforeState: 'does_not_exist',
            after: [{ field: 'title', value: '¿Hacen envíos?' }, { field: 'content', value: 'Sí, a todo el país.' }],
        },
        ...over,
    } as AgentContentProposal);

    const render = (over: Partial<AgentContentProposal> = {}) => renderToStaticMarkup(
        createElement(AgentContentReview, { tenantId: 'tenant-1', proposal: proposal(over) } as any));
    /** React escapes apostrophes, and half the French copy has one. */
    const readable = (html: string) => html
        .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    it.each(['es', 'en', 'pt', 'fr'])('says the object does not exist yet, in %s', locale => {
        mockLocale = locale;
        const html = readable(render());
        expect(html).toContain(messages[locale].willCreate);
        expect(html).toContain(messages[locale].operations.knowledge_faq_create);
        // And it offers the action, in that locale.
        expect(html).toContain('<button');
    });

    it('does not ask next-intl to read the operation key as a path', () => {
        mockLocale = 'es';
        // `knowledge.faq.create` has dots and next-intl reads a dot as a path
        // separator, so the raw key would be looked up as three nested objects
        // and never found — the heading would throw rather than render.
        expect(Object.keys(messages.es.operations).some(key => key.includes('.'))).toBe(false);
        expect(() => render()).not.toThrow();
    });

    it('shows every field that will be written, before anything is written', () => {
        mockLocale = 'es';
        const html = render();
        // The reviewer is approving this content, not a summary of it.
        expect(html).toContain('¿Hacen envíos?');
        expect(html).toContain('Sí, a todo el país.');
        expect(html).toContain(messages.es.fields.title);
        expect(html).toContain(messages.es.fields.content);
    });

    it('offers no button once the proposal has expired', () => {
        mockLocale = 'es';
        const html = render({ expiresAt: new Date(Date.now() - 1000).toISOString() });
        expect(html).toContain(messages.es.expired);
        // The element, not the label: "Crear" is also the first word of the
        // heading, so the word proves nothing about the button.
        expect(html).not.toContain('<button');
    });

    it('offers no button for something already applied', () => {
        mockLocale = 'es';
        const html = render({ status: 'applied', createdObjectId: 'object-1' });
        expect(html).not.toContain('<button');
    });

    it('names a field the copy has no word for rather than hiding it', () => {
        mockLocale = 'es';
        // A field added to the API and not yet translated must still be shown:
        // the reviewer is approving what will be written, and a field they
        // cannot see is a field they did not approve.
        const html = render({ preview: { before: null, beforeState: 'does_not_exist',
            after: [{ field: 'unmappedField', value: 'valor' }] } as any });
        expect(html).toContain('unmappedField');
        expect(html).toContain('valor');
    });
});
