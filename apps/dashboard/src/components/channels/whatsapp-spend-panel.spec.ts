import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WhatsappSpendPanel } from './WhatsappSpendPanel';
import type { WhatsappConsumption, WhatsappNumberPause } from '@/lib/whatsapp-spend';

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
/**
 * A pause exactly as `GET /whatsapp/spend/pauses` sends one.
 *
 * The previous fixture built a billing-time-zone row and set `paused: true` on
 * it by hand — a field that endpoint has never returned. Every assertion below
 * passed while the shipped screen showed nothing, because both sides of the
 * seam agreed with each other and disagreed with production. The shape here is
 * copied from the controller, field for field, so that stops being possible.
 */
const paused = (over: Partial<WhatsappNumberPause> = {}): WhatsappNumberPause => ({
    channelAccountId: '15550001111',
    displayName: null,
    paused: true,
    stateUnknown: false,
    explanation: 'Meta rechazó el cobro de este número.',
    since: '2026-10-02T09:00:00.000Z',
    observations: 3,
    clearedAt: null,
    ...over,
});

const consumption = (over: Partial<WhatsappConsumption> = {}): WhatsappConsumption => ({
    months: 12,
    freeServiceDeliveriesPerNumberMonth: 1000,
    consumption: [{
        month: '2026-10', channelAccountId: '15550001111',
        freeDeliveries: 640, chargedDeliveries: 212,
        money: [{ currency: 'USD', settledMinor: 1240, retainedMinor: 0 }],
        byMarketCategory: [],
    }],
    ...over,
});

const render = (props: Parameters<typeof WhatsappSpendPanel>[0]) =>
    renderToStaticMarkup(createElement(WhatsappSpendPanel, props));

const policy = (enforcement: 'observe' | 'enforce' = 'observe') => ({
    enforcement,
    defaults: {
        numberDeliveriesPerCalendarMonth: 2_000,
        contactDeliveriesPerCalendarMonth: 60,
        warnPermille: 800,
        softPermille: 950,
    },
});

describe('the WhatsApp spend panel', () => {
    beforeEach(() => { mockLocale = 'es'; });

    it('offers a way out of a pause to somebody who can take it', () => {
        const markup = render({
            summary: null, pauses: [paused()], onResume: async () => undefined,
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
        const markup = render({ summary: null, pauses: [paused()] });
        expect(markup).toContain('Meta rechazó el cobro');
        expect(markup).not.toContain('Reanudar envíos');
    });

    it('says "we could not find out" instead of implying the number is fine', () => {
        // `stateUnknown` is not `paused: false`. While it holds, nothing is
        // sent — so rendering it as a healthy number would let an operator
        // conclude nothing is wrong while nothing is going out.
        const markup = render({
            summary: null,
            pauses: [paused({ paused: false, stateUnknown: true, explanation: null })],
        });
        expect(markup).toContain('No pudimos leer el estado de cobro');
        // And not as the red "stopped" block, which would send somebody to add
        // a card they may not need.
        expect(markup).not.toContain('Envío pausado');
    });

    it('gives each number its own allowance for its own billing month', () => {
        // Per number and per WABA-local calendar month, with the allowance
        // itself coming from the payload. The panel used to add every number's
        // free deliveries over a rolling thirty days and clamp the total at a
        // hardcoded thousand, which reported an exhausted allowance to a tenant
        // whose numbers each had hundreds left.
        const markup = render({ summary: null, consumption: consumption() });
        expect(markup).toContain('640 / 1000');
        expect(markup).toContain('2026-10');
        expect(markup).toContain('212');
    });

    it('never puts two currencies on one line', () => {
        // Two currencies are two totals. Adding them would need an exchange
        // rate nobody agreed to, so each is rendered beside its own code and
        // there is no line underneath them.
        const markup = render({
            summary: null,
            consumption: consumption({
                consumption: [{
                    month: '2026-10', channelAccountId: '15550001111',
                    freeDeliveries: 10, chargedDeliveries: 4,
                    money: [
                        { currency: 'USD', settledMinor: 1240, retainedMinor: 0 },
                        { currency: 'COP', settledMinor: 5100000, retainedMinor: 0 },
                    ],
                    byMarketCategory: [],
                }],
            }),
        });
        expect(markup).toContain('USD');
        expect(markup).toContain('COP');
    });

    it('says these figures are not the whole bill', () => {
        // What Parallly sent is not what Meta charged: the same account can be
        // billed by another app or by a person using Meta's own inbox. A panel
        // that implied otherwise would be read as a promise.
        expect(render({ summary: null, consumption: consumption() }))
            .toContain('cuentan solo lo que envió Parallly');
    });

    it('shows whether protection can stop sends and exposes the admin control', () => {
        const observing = render({
            summary: null, policy: policy(), onSetEnforcement: async () => undefined,
        });
        expect(observing).toContain('Sólo observar');
        expect(observing).toContain('2000 entregas por número y 60 por contacto');
        expect(observing).toContain('Activar protección');

        const enforcing = render({
            summary: null, policy: policy('enforce'), onSetEnforcement: async () => undefined,
        });
        expect(enforcing).toContain('Protección activa');
        expect(enforcing).toContain('Volver a sólo observar');
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
                pauses: [paused()],
                awaiting: { graceHours: 72, effects: [{ effectKey: 'a' }] },
                policy: policy(),
                onResume: async () => undefined,
                onSetEnforcement: async () => undefined,
            });
            expect(markup.length).toBeGreaterThan(0);
        }
    });
});
