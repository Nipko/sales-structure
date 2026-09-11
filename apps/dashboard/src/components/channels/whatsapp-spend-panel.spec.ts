import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WhatsappSpendPanel, type WhatsappReadinessNumber } from './WhatsappSpendPanel';

let mockLocale = 'es';
const namespaces: Record<string, any> = Object.fromEntries(['es', 'en', 'pt', 'fr']
    .map(locale => [locale, require(`../../../messages/${locale}.json`)]));
jest.mock('next-intl', () => ({
    useLocale: () => mockLocale,
    useTranslations: (namespace: string) => {
        const root = () => namespace.split('.').reduce((node: any, part) => node?.[part], namespaces[mockLocale]);
        const lookup = (key: string) => key.split('.').reduce((node: any, part) => node?.[part], root());
        const translate = (key: string, values?: Record<string, unknown>) => {
            const value = lookup(key);
            if (typeof value !== 'string') throw new Error(`Missing ${namespace} translation: ${mockLocale}.${key}`);
            return Object.entries(values ?? {}).reduce(
                (text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)), value);
        };
        translate.has = (key: string) => typeof lookup(key) === 'string';
        return translate;
    },
}));

/**
 * ═══ WHAT THE BUSINESS CAN SEE, AND WHAT IT CAN DO ABOUT IT ═══
 *
 * Two states in this panel are not information — they are a person stuck:
 *
 *   · a number Meta will not bill, which stops sending until somebody adds a
 *     card. The pause lifts by itself when Meta accepts a message, and a paused
 *     number sends nothing, so without a button the only way out is the POST
 *     the pause exists to prevent;
 *   · money counted against the account for messages nobody can confirm
 *     arrived. No amount of waiting decides it, so it has to be visible or it
 *     sits there for a month.
 *
 * Rendered to static markup rather than asserted through a DOM: what these
 * tests are about is whether the sentence and the control are THERE, in every
 * language the product ships.
 */
const paused = (over: Partial<WhatsappReadinessNumber> = {}): WhatsappReadinessNumber => ({
    channelAccountId: '15550001111',
    zone: 'America/Bogota',
    resolution: { kind: 'mapped' },
    guidance: 'Meta rechazó el cobro de este número.',
    paused: true,
    ...over,
});

const render = (props: Parameters<typeof WhatsappSpendPanel>[0]) =>
    renderToStaticMarkup(createElement(WhatsappSpendPanel, props));

describe('the WhatsApp spend panel', () => {
    beforeEach(() => { mockLocale = 'es'; });

    it('offers a way out of a pause to somebody who can take it', () => {
        const markup = render({
            summary: null, readiness: [paused()], onResume: async () => undefined,
        });
        expect(markup).toContain('Reanudar envíos');
        // And the number it is about, so a tenant with two knows which.
        expect(markup).toContain('15550001111');
    });

    it('shows the pause and no button to somebody who may not lift it', () => {
        // A supervisor reads that sending stopped and why. Resuming is a
        // decision about the business's own billing. A control that refuses
        // after being pressed teaches people the screen is broken, so it is
        // absent rather than disabled.
        const markup = render({ summary: null, readiness: [paused()] });
        expect(markup).toContain('Meta rechazó el cobro');
        expect(markup).not.toContain('Reanudar envíos');
    });

    it('says how many sends nobody can confirm, and why the money is still counted', () => {
        const markup = render({
            summary: null,
            awaiting: { graceHours: 72, effects: [{ effectKey: 'a' }, { effectKey: 'b' }] },
        });
        expect(markup).toContain('Envíos que nadie puede confirmar');
        // The count and the window, interpolated — a sentence that said "some
        // messages" would send somebody looking for a number that is not there.
        expect(markup).toContain('2 mensaje(s)');
        expect(markup).toContain('72 h');
    });

    it('says nothing at all when there is nothing waiting', () => {
        const markup = render({ summary: null, awaiting: { graceHours: 72, effects: [] } });
        expect(markup).not.toContain('Envíos que nadie puede confirmar');
    });

    it('renders in every language the product ships', () => {
        // The panel a business reads during an unexpected invoice is the last
        // place a missing translation should surface, and the mock throws on
        // one rather than falling back to the key.
        for (const locale of ['es', 'en', 'pt', 'fr']) {
            mockLocale = locale;
            const markup = render({
                summary: null,
                readiness: [paused()],
                awaiting: { graceHours: 72, effects: [{ effectKey: 'a' }] },
                onResume: async () => undefined,
            });
            expect(markup.length).toBeGreaterThan(0);
        }
    });
});
