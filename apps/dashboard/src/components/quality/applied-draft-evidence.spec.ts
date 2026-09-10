import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppliedDraftVerification, AppliedDraftVerificationReason, AppliedDraftVerificationState } from '@parallext/shared';
import { AppliedDraftEvidence } from './AgentConfigurationReview';

const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
let mockLocale: string = 'es';
const mockMessages: Record<string, any> = Object.fromEntries(LOCALES.map(locale => [locale, require(`../../../messages/${locale}.json`).agentConfiguration]));
jest.mock('next-intl', () => ({ useTranslations: () => {
    const lookup = (key: string) => key.split('.').reduce((node: any, part) => node?.[part], mockMessages[mockLocale]);
    const t = (key: string) => String(lookup(key) ?? key);
    t.has = (key: string) => typeof lookup(key) === 'string';
    return t;
} }));
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant' }) }));
jest.mock('@/hooks/useRole', () => ({ useRole: () => ({ role: 'tenant_admin' }) }));
jest.mock('@/lib/api', () => ({ api: { applyAgentConfiguration: jest.fn() } }));

const REVISION = '55555555-5555-4555-8555-555555555555';
const HASH = 'b'.repeat(64);
/** React escapes text the same way in every assertion below, so compare like for like. */
const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const copy = (path: string, locale: string = mockLocale) => escaped(path.split('.').reduce((node: any, part) => node?.[part], mockMessages[locale].draftCheck));
const evidence = (state: AppliedDraftVerificationState, reason: AppliedDraftVerificationReason | null, overrides: Partial<AppliedDraftVerification> = {}): AppliedDraftVerification =>
    ({ scope: 'applied_draft', state, reason, revisionId: REVISION, revisionHash: HASH, checkedAt: new Date().toISOString(), ...overrides });
const render = (verification: AppliedDraftVerification, currentRevision?: { id: string; bodyHash: string } | null) =>
    renderToStaticMarkup(createElement(AppliedDraftEvidence, { verification, currentRevision }));
const UNAVAILABLE_REASONS: AppliedDraftVerificationReason[] = ['runner_unavailable', 'run_failed', 'quota_exhausted', 'timed_out', 'revision_changed'];
const paths = (value: any, prefix = ''): string[] => typeof value === 'object' && value
    ? Object.keys(value).flatMap(key => paths(value[key], prefix ? `${prefix}.${key}` : key)).sort()
    : [prefix];

describe('evidence about the applied draft revision', () => {
    beforeEach(() => { mockLocale = 'es'; });

    it.each(LOCALES)('never lets a smoke check read as a certification in %s', locale => {
        mockLocale = locale;
        const html = render(evidence('verified', null));
        expect(html).toContain(copy('verified'));
        // The caveat is the whole point of the state: it must never be optional.
        expect(html).toContain(copy('verifiedLimit'));
        expect(html).toContain(copy('scope'));
    });

    it.each(UNAVAILABLE_REASONS)('reports %s as nothing proven, with its own cause', reason => {
        const html = render(evidence('unavailable', reason));
        expect(html).toContain(copy('unavailable'));
        expect(html).toContain(copy(`reasons.${reason}`));
        expect(html).not.toContain(copy('verified'));
        expect(html).not.toContain(copy('failed'));
        // Neither the success nor the failure tone: nothing was established.
        expect(html).not.toContain('emerald');
        expect(html).not.toContain('red-');
    });

    it('gives every unavailable cause distinguishable copy in all four languages', () => {
        for (const locale of LOCALES) {
            const sentences = UNAVAILABLE_REASONS.map(reason => copy(`reasons.${reason}`, locale));
            expect(new Set(sentences).size).toBe(UNAVAILABLE_REASONS.length);
            for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(20);
        }
    });

    it('says nothing about a cause the apply did not report', () => {
        const html = render(evidence('unavailable', null));
        expect(html).toContain(copy('unavailable'));
        for (const reason of UNAVAILABLE_REASONS) expect(html).not.toContain(copy(`reasons.${reason}`));
    });

    it('raises the saved-but-silent draft loudly', () => {
        const html = render(evidence('failed', 'empty_reply'));
        expect(html).toContain(copy('failed'));
        expect(html).toContain('role="alert"');
        expect(html).toContain('red-');
        expect(html).not.toContain(copy('verified'));
    });

    it('explains an account-scope proposal instead of showing an error', () => {
        const html = render(evidence('not_applicable', 'account_scope', { revisionId: null, revisionHash: null }));
        expect(html).toContain(copy('notApplicable'));
        expect(html).toContain(copy('scopeAccount'));
        expect(html).not.toContain(copy('scope'));
        expect(html).not.toContain('role="alert"');
        expect(html).not.toContain('red-');
    });

    it('demotes evidence whose revision has been superseded', () => {
        for (const moved of [{ id: '66666666-6666-4666-8666-666666666666', bodyHash: HASH }, { id: REVISION, bodyHash: 'c'.repeat(64) }]) {
            const html = render(evidence('verified', null), moved);
            expect(html).toContain(copy('stale'));
            expect(html).toContain(copy('staleThen'));
            // The old verdict survives only as history, never in the success tone.
            expect(html).not.toContain('emerald');
            expect(html).not.toContain(copy('verifiedLimit'));
        }
    });

    it('keeps a current verdict current, and does not guess when there is nothing to compare', () => {
        const matching = render(evidence('verified', null), { id: REVISION, bodyHash: HASH });
        expect(matching).not.toContain(copy('stale'));
        expect(matching).toContain('emerald');
        for (const unknown of [undefined, null]) {
            const html = render(evidence('verified', null), unknown);
            expect(html).not.toContain(copy('stale'));
            expect(html).toContain(copy('verified'));
        }
    });

    it('renders its own block so the applied draft is never read as the operational assessment', () => {
        const html = render(evidence('verified', null));
        expect(html.startsWith('<section')).toBe(true);
        expect(html).toContain(copy('title'));
    });

    it('carries the same draftCheck keys, all non-empty, in the four message files', () => {
        const reference = paths(mockMessages.es.draftCheck);
        expect(reference).toEqual(expect.arrayContaining(['title', 'scope', 'scopeAccount', 'verified', 'verifiedLimit', 'failed', 'unavailable', 'notApplicable', 'stale', 'staleThen',
            ...UNAVAILABLE_REASONS.map(reason => `reasons.${reason}`)]));
        for (const locale of LOCALES) {
            expect(paths(mockMessages[locale].draftCheck)).toEqual(reference);
            for (const path of reference) expect(copy(path, locale)).toEqual(expect.stringMatching(/\S/));
        }
    });
});
