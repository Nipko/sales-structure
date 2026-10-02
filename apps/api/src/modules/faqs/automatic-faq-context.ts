export const AUTOMATIC_FAQ_MAX_ANSWER_CHARS = 3_000;
export const AUTOMATIC_FAQ_MAX_TOTAL_CHARS = 6_000;

/** Keep whole answers only. Truncating could remove a price condition or a
 * limitation. An oversized FAQ stays available through an explicit search. */
export function boundedAutomaticFaqs<T extends { id: string; question: string; answer: string }>(rows: readonly T[]): T[] {
    let used = 0;
    const selected: T[] = [];
    for (const faq of rows) {
        if (typeof faq?.id !== 'string' || typeof faq?.question !== 'string' || typeof faq?.answer !== 'string') continue;
        const size = faq.id.length + faq.question.length + faq.answer.length;
        if (faq.id.length > 128 || faq.question.length > 256 || faq.answer.length > AUTOMATIC_FAQ_MAX_ANSWER_CHARS
            || used + size > AUTOMATIC_FAQ_MAX_TOTAL_CHARS) continue;
        selected.push(faq);
        used += size;
        if (selected.length === 3) break;
    }
    return selected;
}
