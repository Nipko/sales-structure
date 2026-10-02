import { AUTOMATIC_FAQ_MAX_ANSWER_CHARS, AUTOMATIC_FAQ_MAX_TOTAL_CHARS, boundedAutomaticFaqs } from './automatic-faq-context';

const faq = (id: string, answer: string) => ({ id, question: '¿Qué incluye la demostración Faro Azul?', answer });

describe('automatic FAQ context budget', () => {
    it('omits a whole oversized answer without silently removing its final condition', () => {
        const oversized = faq('large', `${'a'.repeat(AUTOMATIC_FAQ_MAX_ANSWER_CHARS)} Sólo bajo confirmación previa.`);
        const complete = faq('short', 'Visita de 20 minutos. Sólo bajo confirmación previa. 🏠');
        expect(boundedAutomaticFaqs([oversized, complete])).toEqual([complete]);
        expect(oversized.answer).toContain('Sólo bajo confirmación previa.');
    });

    it('bounds the combined context and keeps later short complete answers when one does not fit', () => {
        const rows = [faq('one', 'a'.repeat(2900)), faq('two', 'b'.repeat(2900)), faq('three', 'c'.repeat(2900)), faq('short', 'Disponible con cita previa.')];
        const result = boundedAutomaticFaqs(rows);
        expect(result).toEqual([rows[0], rows[1], rows[3]]);
        expect(result.reduce((sum, row) => sum + row.id.length + row.question.length + row.answer.length, 0)).toBeLessThanOrEqual(AUTOMATIC_FAQ_MAX_TOTAL_CHARS);
    });

    it('omits oversized metadata and never fragments Unicode answers', () => {
        const complete = faq('emoji', '🏠'.repeat(1500));
        expect(boundedAutomaticFaqs([{ ...complete, question: 'q'.repeat(257) }, { ...complete, id: 'i'.repeat(129) }, complete])).toEqual([complete]);
    });
});
