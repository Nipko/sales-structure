import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExampleCard, LearningCoverage, LearningReviewAvailability, ReleaseCard } from './LearningWorkspace';
import type { LearningExample, LearningRelease } from '@/lib/agent-learning';

let mockLocale = 'es';
const mockMessages: Record<string, any> = Object.fromEntries(['es', 'en', 'pt', 'fr'].map(locale => [locale, require(`../../../messages/${locale}.json`).agentLearning]));
jest.mock('next-intl', () => ({ useLocale: () => mockLocale, useTranslations: () => {
    const lookup = (key: string) => key.split('.').reduce((node: any, part) => node?.[part], mockMessages[mockLocale]);
    const translate = (key: string, values?: Record<string, unknown>) => {
        if (typeof lookup(key) !== 'string') throw new Error(`Missing learning translation: ${mockLocale}.${key}`);
        return lookup(key).replace(/\{(\w+)\}/g, (_: string, variable: string) => String(values?.[variable] ?? variable));
    };
    translate.has = (key: string) => typeof lookup(key) === 'string';
    return translate;
} }));
jest.mock('@/lib/api', () => ({ api: {} }));

const common = { tenantId: 'tenant', agentId: 'agent', busy: false, run: jest.fn() };
const example = (): LearningExample => ({ id: 'example', source_id: 'source', kind: 'brand_style', intent: 'support',
    episode: [{ role: 'customer', text: '<script>private</script>' }, { role: 'assistant', text: 'Con gusto.' }],
    response_pattern: '¿Cómo puedo ayudarte?', rationale: 'Respuesta útil.', facts_required: [],
    analysis: { scores: Object.fromEntries(['accuracy','toolUse','understanding','clarity','brevity','empathy','brandTone','uncertainty','closure'].map(key => [key, 3])), exclusions: [] },
    status: 'analyzed', revision: 2, dedup_status: 'clear', split: 'train', channel: 'whatsapp', language: 'es', source_kind: 'file' });
const release = (): LearningRelease => ({ id: 'release', status: 'candidate', traffic_percent: 10, evaluation_status: 'failed',
    example_ids: ['example'], baseline_release_id: null, evaluation: { candidateAverage: 60, baselineAverage: 70, totalCases: 3, completedCases: 2, failedCases: 1 } });

describe('review and publication surfaces', () => {
    it.each(['es','en','pt','fr'])('explains changed sources and prevents stale approval/publication in %s',locale=>{
        mockLocale=locale;
        const item={...example(),source_kind:'inbox',source_conversation_id:'conversation',sourceAvailability:'changed' as const};
        const html=renderToStaticMarkup(createElement(ExampleCard,{...common,example:item,selected:false,onSelect:jest.fn()}));
        expect(html).toContain(mockMessages[locale].sourceChanged);
        expect(html).toContain(mockMessages[locale].reimportSource);
        expect(html).not.toContain(mockMessages[locale].privacyChecked);
        expect(html).not.toContain(mockMessages[locale].selectExample);
        for(const status of ['candidate','published']){
            const stale={...release(),status,evaluation_status:'passed',sourceAvailability:'changed' as const};
            const comparison=renderToStaticMarkup(createElement(ReleaseCard,{...common,release:stale,number:1}));
            expect(comparison).toContain(mockMessages[locale].releaseSourceChanged);
            expect(comparison).not.toContain(mockMessages[locale].publish+'</button>');
            expect(comparison).not.toContain(mockMessages[locale].evaluate+'</button>');
            if(status==='published')expect(comparison).toContain(mockMessages[locale].rollback);
        }
    });
    it.each(['es', 'en', 'pt', 'fr'])('keeps failed or loading evidence unknown rather than inventing zero reserved cases in %s', locale => {
        mockLocale = locale;
        for (const unavailable of [false, true]) {
            const coverage = renderToStaticMarkup(createElement(LearningCoverage, { data: null, unavailable }));
            expect(coverage).toContain(mockMessages[locale][unavailable ? 'coverageUnavailable' : 'coverageLoading']);
            expect(coverage).not.toContain(mockMessages[locale].moreHoldout);
            const review = renderToStaticMarkup(createElement(LearningReviewAvailability, { unavailable }));
            expect(review).toContain(mockMessages[locale][unavailable ? 'evidenceUnavailable' : 'loading']);
            if (unavailable) expect(review).not.toContain(mockMessages[locale].loading);
        }
        const known = renderToStaticMarkup(createElement(LearningCoverage, { data: { examples: [], releases: [], coverage: [] }, unavailable: false }));
        expect(known).toContain(mockMessages[locale].moreHoldout);
        expect(known).not.toContain(mockMessages[locale].coverageUnavailable);
        const recovered = renderToStaticMarkup(createElement(LearningCoverage, { data: { examples: [], releases: [], coverage: [{ split: 'holdout', count: 4 }] }, unavailable: false }));
        expect(recovered).not.toContain(mockMessages[locale].moreHoldout);
        expect(recovered).not.toContain(mockMessages[locale].coverageLoading);
    });
    it.each(['es', 'en', 'pt', 'fr'])('renders review and evaluation in %s with escaped source content', locale => {
        mockLocale = locale;
        const html = renderToStaticMarkup(createElement(ExampleCard, { ...common, example: example(), selected: false, onSelect: jest.fn() }));
        expect(html).toContain(mockMessages[locale].pattern);
        expect(html).toContain(mockMessages[locale].privacyChecked);
        expect(html).toContain('&lt;script&gt;private&lt;/script&gt;');
        expect(html).not.toContain('<script>');
        const comparison = renderToStaticMarkup(createElement(ReleaseCard, { ...common, release: release(), number: 1 }));
        expect(comparison).toContain(mockMessages[locale].evaluate);
        expect(comparison).not.toContain(mockMessages[locale].publish);
        expect(comparison).toContain('60.0');
    });
    it('offers publishing only after passed evaluation and rollback only for published releases', () => {
        mockLocale = 'es';
        const candidate = release(); candidate.evaluation_status = 'passed';
        const passed = renderToStaticMarkup(createElement(ReleaseCard, { ...common, release: candidate, number: 1 }));
        expect(passed).toContain(mockMessages.es.publish);
        expect(passed).not.toContain(mockMessages.es.rollback);
        candidate.status = 'published';
        const published = renderToStaticMarkup(createElement(ReleaseCard, { ...common, release: candidate, number: 1 }));
        expect(published).toContain(mockMessages.es.rollback);
        expect(published).not.toContain(mockMessages.es.publish + '</button>');
    });
    it('explains flagged evidence and never selects business facts as response style', () => {
        mockLocale = 'es';
        const item = example(); item.status = 'flagged'; item.analysis!.exclusions = ['unverified_operation'];
        const flagged = renderToStaticMarkup(createElement(ExampleCard, { ...common, example: item, selected: false, onSelect: jest.fn() }));
        expect(flagged).toContain(mockMessages.es.exclusions.unverified_operation);
        item.status = 'approved'; item.kind = 'business_fact';
        const approvedFact = renderToStaticMarkup(createElement(ExampleCard, { ...common, example: item, selected: false, onSelect: jest.fn() }));
        expect(approvedFact).not.toContain(mockMessages.es.selectExample);
        expect(approvedFact).toContain(mockMessages.es.kinds.business_fact);
    });
});
