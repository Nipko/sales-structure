import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SimulationEvidenceBoundary, SimulationResolutionState, SimulationRetirement } from './SimulationEvidenceBoundary';

let mockLocale = 'es';
const mockMessages: Record<string, any> = Object.fromEntries(['es','en','pt','fr'].map(locale => [locale, require(`../../../messages/${locale}.json`).simulation]));
jest.mock('next-intl', () => ({useTranslations: () => (key: string) => {
    const value = mockMessages[mockLocale][key];
    if (typeof value !== 'string') throw new Error(`Missing translation: ${mockLocale}.${key}`);
    return value;
}}));
beforeEach(() => {mockLocale = 'es';});

describe('simulation evidence availability', () => {
    it.each(['es', 'en', 'pt', 'fr'])('does not render waiting for customer data as a red failure in %s', locale => {
        mockLocale = locale;
        for (const status of ['needs_customer_input', 'not_assessable']) {
            const html = renderToStaticMarkup(createElement(SimulationResolutionState, { resolved: null, resolutionStatus: status }));
            expect(html).toContain(mockMessages[locale][status === 'needs_customer_input' ? 'needsCustomerInput' : 'notAssessable']);
            expect(html).not.toMatch(/text-red|0%|<svg/);
        }
    });

    it('keeps conclusive success and failure accessible without relying on icon color', () => {
        for (const resolved of [true, false]) {
            const html = renderToStaticMarkup(createElement(SimulationResolutionState, { resolved }));
            expect(html).toContain(mockMessages.es[resolved ? 'resolved' : 'notResolved']);
        }
    });
    it.each(['es','en','pt','fr'])('withholds cached transcripts and scores for unavailable evidence in %s', locale => {
        mockLocale = locale;
        for (const state of [{status:'retired' as const,loading:false,error:false},
            {status:'completed' as const,loading:true,error:false},{status:'completed' as const,loading:false,error:true}]) {
            // El tipo del componente declara `children` como prop requerida, asi
            // que pasarlo como tercer argumento deja el objeto de props incompleto.
            // eslint-disable-next-line react/no-children-prop
            const html = renderToStaticMarkup(createElement(SimulationEvidenceBoundary, {...state,retry:jest.fn(),
                children:createElement('div',null,'PRIVATE TRANSCRIPT 9/10')}));
            expect(html).not.toContain('PRIVATE TRANSCRIPT'); expect(html).not.toContain('9/10');
            expect(html).toContain(mockMessages[locale][state.status === 'retired' ? 'retiredHint' : state.loading ? 'loadingResults' : 'loadResultsError']);
        }
    });
    it('renders available results without inventing a score or a success statement', () => {
        // Mismo motivo: el componente declara `children` requerido.
        // eslint-disable-next-line react/no-children-prop
        const html = renderToStaticMarkup(createElement(SimulationEvidenceBoundary,{status:'completed',loading:false,error:false,retry:jest.fn(),
            children:createElement('span',null,'Actual result')}));
        expect(html).toBe('<span>Actual result</span>');
    });
    it.each(['es','en','pt','fr'])('explains the scope and requires an explicit retirement step in %s', locale => {
        mockLocale = locale;
        const html = renderToStaticMarkup(createElement(SimulationRetirement,{status:'completed',role:'tenant_admin',busy:false,error:false,retire:jest.fn()}));
        expect(html).toContain(mockMessages[locale].retireHint);
        expect(html).toContain(mockMessages[locale].retireRun);
        expect(html).not.toContain(mockMessages[locale].retireConfirmButton);
        expect(html).not.toContain(mockMessages[locale].status_retired);
    });
    it.each(['tenant_agent','unknown',''])('does not expose retirement to %s', role => {
        expect(renderToStaticMarkup(createElement(SimulationRetirement,{status:'completed',role,busy:false,error:false,retire:jest.fn()}))).toBe('');
    });
    it('does not offer to retire evidence already withdrawn', () => {
        expect(renderToStaticMarkup(createElement(SimulationRetirement,{status:'retired',role:'tenant_admin',busy:false,error:false,retire:jest.fn()}))).toBe('');
    });
});
