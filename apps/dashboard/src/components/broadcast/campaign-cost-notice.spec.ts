import * as fs from 'fs';
import * as path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CampaignCostNotice, type CampaignEstimate } from './CampaignCostNotice';

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
 * ═══ THE FIGURE A CAMPAIGN IS CONFIRMED AGAINST ═══
 *
 * A campaign to four thousand people is a purchase, and the ways an estimate
 * can flatter it are specific enough to test one at a time:
 *
 *   · dropping the recipients it could not price makes the campaign look
 *     cheaper than it is. A destination the rate card cannot place is not free;
 *   · showing a zero when the total could not be expressed is a wrong number
 *     that reads like good news;
 *   · subtracting the free monthly allowance promises a discount Meta does not
 *     give — the thousand free deliveries are for SERVICE messages, and a
 *     campaign goes out as an approved template.
 *
 * Rendered to static markup, because what is under test is whether the sentence
 * is THERE, in every language the product ships.
 */
const estimate = (over: Partial<CampaignEstimate> = {}): CampaignEstimate => ({
    category: 'marketing',
    channelAccountId: '15550001111',
    currency: 'USD',
    calendarMonth: '2026-10',
    recipients: 4000,
    priced: 3660,
    totalMinorUnits: 1240,
    byMarket: [{ market: 'CO', recipients: 3660, micros: 4538400, unitMicros: 1240 }],
    unpriced: [],
    unpricedByReason: {},
    freeAllowanceApplies: false,
    ...over,
});

const render = (props: Parameters<typeof CampaignCostNotice>[0]) =>
    renderToStaticMarkup(createElement(CampaignCostNotice, props));

describe('what a campaign costs before anybody presses send', () => {
    beforeEach(() => { mockLocale = 'es'; });

    it('shows the recipients that could not be priced BESIDE the total', () => {
        const markup = render({
            recipients: 4000,
            estimate: estimate({
                unpriced: Array.from({ length: 340 }, (_, index) => ({
                    recipientRef: String(index), reason: 'market_ambiguous', detail: '+1',
                })),
                unpricedByReason: { market_ambiguous: 340 },
            }),
        });
        // The count, the reason, and the sentence that stops the total being
        // read as the whole cost.
        expect(markup).toContain('340 destinatarios sin precio');
        expect(markup).toContain('varios países que Meta cobra distinto');
        expect(markup).toContain('NO es gratis');
        // And the priced total is still there rather than being replaced by the
        // warning: "US$12,40 plus 340 nobody could price" is a decision somebody
        // can make; either half alone is not.
        expect(markup).toContain('12,40');
    });

    it('says the total could not be expressed rather than showing a zero', () => {
        // `totalMinorUnits: null` means the parts priced and the whole did not.
        // A zero there is the one wrong number that reads like good news.
        const markup = render({ recipients: 10, estimate: estimate({ totalMinorUnits: null }) });
        expect(markup).toContain('no se puede expresar en USD');
        expect(markup).not.toContain('0,00');
        expect(markup).not.toContain('$0');
    });

    it('formats the amount in the reader\'s own locale, with its currency beside it', () => {
        mockLocale = 'en';
        expect(render({ recipients: 10, estimate: estimate({ totalMinorUnits: 1240 }) }))
            .toContain('$12.40');
        mockLocale = 'es';
        expect(render({ recipients: 10, estimate: estimate({ totalMinorUnits: 1240 }) }))
            .toContain('12,40');
    });

    it('does not discount the free monthly allowance from a campaign', () => {
        // The thousand free deliveries are for SERVICE messages. Subtracting
        // them here would promise a discount Meta does not give, and would
        // spend on paper an allowance the tenant still needs for the replies
        // the campaign provokes.
        expect(render({ recipients: 4000, estimate: estimate() }))
            .toContain('son para mensajes de SERVICIO');
    });

    it('states the delivery count as an upper bound, not a forecast', () => {
        // An undelivered message is not charged, so a flat figure would be a
        // number somebody holds us to.
        expect(render({ recipients: 4000 })).toContain('hasta 4000 entregas cobradas');
    });

    it('says the amount is unknown instead of leaving the space blank', () => {
        // No endpoint prices a campaign yet. Somebody deciding whether to send
        // four thousand messages is owed that fact — a silent gap reads as
        // "nothing to pay".
        const markup = render({ recipients: 4000, estimate: null });
        expect(markup).toContain('Todavía no podemos calcular el importe');
        // And never a fabricated figure standing in for the missing one.
        expect(markup).not.toContain('Hasta ');
    });

    it('renders in every language the product ships', () => {
        for (const locale of ['es', 'en', 'pt', 'fr']) {
            mockLocale = locale;
            const markup = render({
                recipients: 4000,
                estimate: estimate({
                    unpriced: [{ recipientRef: '1', reason: 'market_unlisted', detail: '' }],
                    unpricedByReason: { market_unlisted: 1 },
                }),
            });
            expect(markup.length).toBeGreaterThan(0);
        }
    });
});

describe('the step between the button and the bill', () => {
    const page = fs
        .readFileSync(path.join(__dirname, '..', '..', 'app', 'admin', 'broadcast', 'page.tsx'), 'utf8')
        // `core.autocrlf` is on; normalised so the assertions do not depend on
        // which line ending this machine wrote.
        .replace(/\r\n/g, '\n');

    it('no longer launches a campaign straight off the button', () => {
        // "Enviar ahora" used to call `handleSendNow` on the click, with no
        // confirmation anywhere in the file except the one for picking an A/B
        // winner — a decision that costs nothing. One click sent the campaign to
        // everybody in it.
        expect(page).not.toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); handleSendNow\(/);
        expect(page).toContain('setPendingSend(campaign)');
        expect(page).toContain('<CampaignSendConfirm');
    });

    it('passes no estimate rather than inventing one', () => {
        // The rate depends on each recipient's country and on the template's
        // approved Meta category, and no endpoint returns a priced estimate.
        // Computing one in the browser would need the rate card here, which is
        // how the figure on the screen comes to disagree with the one the
        // reservation charges.
        const element = page.match(/<CampaignSendConfirm[\s\S]*?\/>/)?.[0] ?? '';
        expect(element).toContain('recipients=');
        expect(element).not.toContain('estimate=');
    });
});
