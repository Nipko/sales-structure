import { renderReplyFacts } from './fact-renderer';

/**
 * F4300-37 residue (production QA 29-oct, dental, image 82bd4817): «¿qué tratamientos ofrecen y cuánto duran?» was answered «Prefiero
 * no darle una cantidad que no tengo confirmada en el sistema. Consulta general dura 30 minutos.» — «(30 minutos), consulta
 * especializada» read as «30 consultas», and the safe count template replaced the list of services.
 */
const NOW = new Date('2026-10-29T05:00:00Z');
const LOCALES: Record<string, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };
const render = (reply: string, language: string, customerText: string) =>
    renderReplyFacts({ reply, facts: [], now: NOW, language, locale: LOCALES[language], customerText } as any);

describe('F4300-37 · a duration before the next service is not a count', () => {
    it.each([
        ['es', '¿qué tratamientos ofrecen y cuánto duran?', 'Ofrecemos consulta general (30 minutos), consulta especializada (45 minutos) y control y seguimiento (20 minutos).'],
        ['en', 'what treatments do you offer and how long do they take?', 'We offer general consultation (30 minutes), specialist consultation (45 minutes) and follow-up appointments (20 minutes).'],
        ['pt', 'quais tratamentos vocês têm e quanto duram?', 'Oferecemos consulta geral (30 minutos), consulta especializada (45 minutos) e controle (20 minutos).'],
        ['fr', 'quels soins proposez-vous et combien de temps durent-ils ?', 'Nous proposons consultation générale (30 minutes), consultation spécialisée (45 minutes) et contrôle (20 minutes).'],
    ])('[%s] the list of services stays', (lang, ask, reply) => {
        const out = render(reply, lang, ask);
        expect(out.text).toBe(reply);
        expect(out.fallbacks ?? []).toEqual([]);
    });

    it('a typed count of appointments with no record list still falls back', () => {
        const out = render('Usted tiene 3 citas programadas este mes.', 'es', '¿cuántas citas tengo?');
        expect((out.fallbacks ?? []).map((f: any) => f.reason)).toContain('unrendered_count');
    });

    // Production QA 30-oct (dental): the customer's hypothetical count is not a count of their records.
    it.each([
        ['es', '¿Cuál es el tiempo total si agendo 3 controles?', 'Cada cita de control dura 20 minutos, así que tres citas ocuparían 60 minutos en total.'],
        ['fr', 'Combien de temps au total pour 3 contrôles ?', 'Chaque rendez-vous dure 20 minutes, donc trois rendez-vous prendraient 60 minutes au total.'],
    ])('[%s] «three appointments» asked by the customer stays', (lang, ask, reply) => {
        const out = render(reply, lang, ask);
        expect(out.text).toBe(reply);
        expect(out.fallbacks ?? []).toEqual([]);
    });
});
