import {
    HANDOFF_NOTICE_KINDS, HANDOFF_NOTICE_LANGUAGES,
    handoffNoticeLanguage, handoffNoticeText, isHandoffNoticeKind,
} from './handoff-notice';
import { widgetHandoffNotice } from '../widget/widget-handoff-messages';

describe('Deterministic handoff notice catalogue', () => {
    it('ships every notice kind in the four supported languages', () => {
        for (const kind of HANDOFF_NOTICE_KINDS) {
            if (kind === 'none') continue;
            const rendered = HANDOFF_NOTICE_LANGUAGES.map(language => handoffNoticeText(kind, language));
            expect(rendered.every(text => typeof text === 'string' && text.trim().length > 0)).toBe(true);
            // Four distinct translations, not the Spanish string copied around.
            expect(new Set(rendered).size).toBe(HANDOFF_NOTICE_LANGUAGES.length);
        }
    });

    it('renders nothing for the kind that adds no sentence of its own', () => {
        for (const language of HANDOFF_NOTICE_LANGUAGES) {
            expect(handoffNoticeText('none', language)).toBeNull();
        }
    });

    it('refuses an unknown kind instead of degrading into silence', () => {
        expect(() => handoffNoticeText('made_up' as any, 'es')).toThrow('handoff_notice_kind_unknown');
        expect(isHandoffNoticeKind('made_up')).toBe(false);
        expect(isHandoffNoticeKind('queue_head')).toBe(true);
    });

    it('narrows any detected language to a supported one, defaulting to Spanish', () => {
        expect(handoffNoticeLanguage('pt-BR')).toBe('pt');
        expect(handoffNoticeLanguage('EN')).toBe('en');
        expect(handoffNoticeLanguage('fr-CA')).toBe('fr');
        expect(handoffNoticeLanguage('de')).toBe('es');
        expect(handoffNoticeLanguage(undefined)).toBe('es');
        expect(handoffNoticeLanguage(null)).toBe('es');
        expect(handoffNoticeLanguage('')).toBe('es');
    });

    it('keeps the queue notice identical to the wording the runtime already sends', () => {
        // The conversation runtime imports these constants, so a divergence here
        // would silently change what a transferred customer reads.
        expect(handoffNoticeText('queue_head', 'es')).toContain('Un agente le responderá en breve');
        expect(handoffNoticeText('transferring', 'es')).toBe('Le voy a transferir con un agente de nuestro equipo.');
    });

    it('the web chat notice agrees with the catalogue one, word for word, in every language', () => {
        for (const lang of ['es', 'en', 'pt', 'fr'] as const) {
            expect(widgetHandoffNotice(lang)).toBe(handoffNoticeText('inbox_notice', lang));
        }
        expect(widgetHandoffNotice('es')).toBe('Su conversación quedó en la bandeja de atención. Una persona podrá continuar por este chat.');
        expect(widgetHandoffNotice(undefined)).toBe(widgetHandoffNotice('es'));
    });

    it('speaks to the customer with usted in Spanish, and without the colloquial «te» in Portuguese', () => {
        for (const kind of ['queue_head', 'transferring', 'inbox_notice'] as const) {
            expect(handoffNoticeText(kind, 'es')).not.toMatch(/\b(?:tu|tus|te|eres|puedes)\b/i);
            expect(handoffNoticeText(kind, 'pt')).not.toMatch(/\b(?:te|teu|tua)\b/i);
        }
        expect(handoffNoticeText('queue_head', 'es')).toBe(
            'Entiendo su solicitud. Le estoy transfiriendo con nuestro equipo de atención. Un agente le responderá en breve. 🙋');
        expect(handoffNoticeText('inbox_notice', 'es')).toContain('Su conversación quedó');
    });
});
