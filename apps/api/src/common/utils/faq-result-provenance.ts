/** Bounded source identity only: never include FAQ text or customer queries. */
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_IDS = 10;

export function projectFaqResultIds(ids: unknown, complete: unknown) {
    if (!Array.isArray(ids)) return { faqResultIds: [], faqResultIdsComplete: false };
    const safe = ids.slice(0, MAX_IDS).filter((id): id is string => typeof id === 'string' && UUID.test(id));
    return { faqResultIds: safe, faqResultIdsComplete: complete === true && ids.length <= MAX_IDS && safe.length === ids.length };
}

export function faqResultTraceMetadata(result: any) {
    if (result?.error || !Array.isArray(result?.faqs)) return projectFaqResultIds(null, false);
    // Retain multiplicity: explicit searches may count a view per returned row.
    return projectFaqResultIds(result.faqs.map((faq: any) => faq?.id), true);
}
