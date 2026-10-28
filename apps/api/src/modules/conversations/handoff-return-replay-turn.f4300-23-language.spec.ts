import { LanguageDetectorService } from './language-detector.service';
import { replayLanguageText, staleConsentReply } from './handoff-return-replay-turn';

/**
 * F4300-23 (production QA 28-oct, salon and store tenants): the return of an unattended handoff answered a Spanish conversation in
 * French («Bonjour ! … J'ai noté votre demande…»): the replay text joined «D'accord, merci» (the message that had triggered the
 * transfer) and the Spanish waiting message, and its language was read from the whole.
 */
const detector = new LanguageDetectorService();

describe('F4300-23 · the replay of an unattended handoff speaks the language of the last waiting message', () => {
    it('the last line is what the language is read from', () => {
        expect(replayLanguageText("D'accord, merci\nhola, sigue alguien ahí?")).toBe('hola, sigue alguien ahí?');
        expect(replayLanguageText('  \nsolo una línea\n  ')).toBe('solo una línea');
        expect(replayLanguageText(undefined)).toBe('');
    });

    it('a Spanish last line gives Spanish whatever came before it', () => {
        // Read on its own (no stored language: the stored one is the stale episode's), as `replayTurnLanguage` does.
        expect(detector.detect(replayLanguageText("D'accord, merci\nhola, sigue alguien ahí?"), 'es', null, { preferred: 'es' })).toBe('es');
        expect(staleConsentReply(detector.detect(replayLanguageText("D'accord, merci\nsí"), 'es', null, { preferred: 'es' }), true)).toMatch(/^Dejé su solicitud anotada/);
    });
});
