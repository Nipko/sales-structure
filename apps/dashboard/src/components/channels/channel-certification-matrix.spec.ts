import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChannelCertificationMatrix, type ChannelRow, type ChannelCertificationSummary } from './ChannelCertificationMatrix';

let mockLocale = 'es';
const namespaces: Record<string, any> = Object.fromEntries(['es', 'en', 'pt', 'fr']
    .map(locale => [locale, require(`../../../messages/${locale}.json`)]));
jest.mock('next-intl', () => ({
    useTranslations: (namespace: string) => {
        const root = () => namespace.split('.').reduce((node: any, part) => node?.[part], namespaces[mockLocale]);
        const lookup = (key: string) => key.split('.').reduce((node: any, part) => node?.[part], root());
        const translate = (key: string) => {
            const value = lookup(key);
            if (typeof value !== 'string') throw new Error(`Missing ${namespace} translation: ${mockLocale}.${key}`);
            return value;
        };
        translate.has = (key: string) => typeof lookup(key) === 'string';
        return translate;
    },
}));

/**
 * The matrix a person reads to decide whether a channel can be sold as working.
 *
 * The summary used to answer three questions with one number: `complete` counted
 * a row with nothing in state `pending`, and a capability that is merely DECLARED
 * is not `pending` — it is `prepared`. So a channel whose media, payment link,
 * flow, tokens, reconnect, rate limits, multi-account, handoff, erasure and
 * agent-per-connection had never once been operated read as complete on the
 * strength of five derived cells. This screen has to make that impossible to
 * misread, in all four languages, or the fix stops at the API.
 */
describe('what a channel can be said to do', () => {
    const cell = (capability: string, state: string, basis: string, proof: any = null) =>
        ({ capability, state, basis, evidence: `${capability} evidence, long enough to be a pointer`, proof }) as any;

    const rows: ChannelRow[] = [{
        channelType: 'whatsapp', selfService: true, retainedScope: null, state: 'prepared',
        capabilities: [
            cell('inbound', 'operating', 'derived'),
            cell('outbound_media', 'prepared', 'declared'),
            cell('flow', 'pending', 'declared'),
        ],
        pending: ['flow'], untested: ['outbound_media'], unproven: ['inbound'], certified: false,
    }];

    const summary: ChannelCertificationSummary = {
        channels: 1, selfService: 1, retained: 0,
        implemented: 0, operating: 0, certified: 0,
        pendingByCapability: { flow: ['whatsapp'] },
        untestedByCapability: { outbound_media: ['whatsapp'] },
        unprovenByCapability: { inbound: ['whatsapp'] },
    };

    const render = (over: Partial<{ rows: ChannelRow[]; summary: ChannelCertificationSummary | null }> = {}) =>
        renderToStaticMarkup(createElement(ChannelCertificationMatrix,
            { rows, summary, ...over } as any));
    /** React escapes apostrophes, and half the French copy has one. */
    const readable = (html: string) => html
        .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x2F;/g, '/');

    it.each(['es', 'en', 'pt', 'fr'])('separates implemented, operating and certified, in %s', locale => {
        mockLocale = locale;
        const copy = namespaces[locale].channelCertification;
        const html = readable(render());
        for (const key of ['implemented', 'operating', 'certified'] as const) {
            expect(html).toContain(copy.summary[key]);
            // The meaning is on screen too: three counters with no sentences
            // beside them is exactly how one gets read as the others.
            expect(html).toContain(copy.summary[`${key}Meaning`]);
        }
    });

    it.each(['es', 'en', 'pt', 'fr'])('names the declared-but-never-operated list, in %s', locale => {
        mockLocale = locale;
        const copy = namespaces[locale].channelCertification;
        const html = readable(render());
        expect(html).toContain(copy.gaps.untested);
        expect(html).toContain(copy.gaps.untestedMeaning);
        // And the capability that is in it, by its own name.
        expect(html).toContain(copy.capabilities.outbound_media);
    });

    it('says a capability has no executed proof rather than showing nothing', () => {
        mockLocale = 'es';
        const html = readable(render());
        expect(html).toContain(namespaces.es.channelCertification.noProof);
    });

    it('shows the run when there is one, with its revision and its date', () => {
        mockLocale = 'es';
        const proven = [{ ...rows[0], capabilities: [cell('inbound', 'operating', 'derived',
            { kind: 'suite', source: 'channel-certification.postgres.spec.ts', revision: 'abcdef1234567890', recordedAt: '2026-09-09T10:00:00.000Z' })] }];
        const html = readable(render({ rows: proven as any }));
        expect(html).toContain('channel-certification.postgres.spec.ts');
        expect(html).toContain('abcdef12');
        expect(html).toContain('2026-09-09');
        expect(html).not.toContain(namespaces.es.channelCertification.noProof);
    });

    it('marks a certified row and leaves an uncertified one unmarked', () => {
        mockLocale = 'es';
        // The MARK, not the word: "Certificado" is also the label of a summary
        // card, so the word proves nothing about the row.
        const mark = `aria-label="${namespaces.es.channelCertification.certifiedRow}"`;
        expect(readable(render())).not.toContain(mark);
        const certified = [{ ...rows[0], certified: true }];
        expect(readable(render({ rows: certified as any }))).toContain(mark);
    });

    it('gives the table a caption and every row a header cell', () => {
        mockLocale = 'es';
        const html = render();
        // A matrix without row headers is unreadable with a screen reader: the
        // cell states are meaningless without the channel they belong to.
        expect(html).toContain('<caption');
        expect(html).toContain('scope="row"');
        expect(html).toContain('scope="col"');
    });

    it('renders without a summary rather than throwing', () => {
        mockLocale = 'es';
        const html = render({ summary: null });
        expect(html).toContain('whatsapp');
        expect(html).not.toContain(namespaces.es.channelCertification.gaps.title);
    });
});
