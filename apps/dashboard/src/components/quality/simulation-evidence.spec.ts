import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SimulationEvidenceBoundary, SimulationRetirement } from './SimulationEvidenceBoundary';

let mockLocale = 'es';
const mockMessages: Record<string, any> = Object.fromEntries(['es','en','pt','fr'].map(locale => [locale, require(`../../../messages/${locale}.json`).simulation]));
jest.mock('next-intl', () => ({useTranslations: () => (key: string) => {
    const value = mockMessages[mockLocale][key];
    if (typeof value !== 'string') throw new Error(`Missing translation: ${mockLocale}.${key}`);
    return value;
}}));
beforeEach(() => {mockLocale = 'es';});

describe('simulation evidence availability', () => {
    it.each(['es','en','pt','fr'])('withholds cached transcripts and scores for unavailable evidence in %s', locale => {
        mockLocale = locale;
        for (const state of [{status:'retired' as const,loading:false,error:false},
            {status:'completed' as const,loading:true,error:false},{status:'completed' as const,loading:false,error:true}]) {
            const html = renderToStaticMarkup(createElement(SimulationEvidenceBoundary, {...state,retry:jest.fn(),
                children:createElement('div',null,'PRIVATE TRANSCRIPT 9/10')}));
            expect(html).not.toContain('PRIVATE TRANSCRIPT'); expect(html).not.toContain('9/10');
            expect(html).toContain(mockMessages[locale][state.status === 'retired' ? 'retiredHint' : state.loading ? 'loadingResults' : 'loadResultsError']);
        }
    });
    it('renders available results without inventing a score or a success statement', () => {
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
