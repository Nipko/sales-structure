import { createHash } from 'crypto';

export interface EnrollmentTerms {
    version: 1; courseId: string; cohortId: string; courseName: string;
    price: string; currency: string; startsAt: string; endsAt: string | null;
    schedule: string | null; modality: string | null; room: string | null; meetingUrl: string | null;
    prerequisites: string | null;
}
const date = (value: unknown): string => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
export function enrollmentTerms(course: any, cohort: any): EnrollmentTerms {
    const price = Number(course?.price);
    if (!course?.id || !cohort?.id || !Number.isFinite(price) || price < 0 || !/^[A-Z]{3}$/.test(course.currency || '')) throw new Error('enrollment_terms_unavailable');
    return { version: 1, courseId: course.id, cohortId: cohort.id, courseName: String(course.name),
        price: price.toFixed(2), currency: course.currency, startsAt: date(cohort.starts_at), endsAt: cohort.ends_at ? date(cohort.ends_at) : null,
        schedule: cohort.schedule || null, modality: course.modality || null, room: cohort.room || null,
        meetingUrl: cohort.meeting_url || null, prerequisites: course.prerequisites || null };
}
export function enrollmentTermsHash(terms: EnrollmentTerms | undefined): string | null {
    if (!terms || terms.version !== 1 || !terms.courseId || !terms.cohortId || !terms.price || !terms.currency) return null;
    const ordered = Object.fromEntries(Object.keys(terms).sort().map(key => [key, (terms as any)[key]]));
    return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}
/** Missing legacy terms require a new agreement; catalogue edits cannot silently change an enrollment's price. */
export function enrollmentPriceSql(alias = 'target'): string {
    if(!/^[a-z_]+$/.test(alias))throw new Error('invalid_sql_alias');
    return `NULLIF(${alias}.metadata->'enrollmentTerms'->>'price','')::numeric`;
}
export function enrollmentCurrencySql(alias = 'target'): string {
    if(!/^[a-z_]+$/.test(alias))throw new Error('invalid_sql_alias');
    return `${alias}.metadata->'enrollmentTerms'->>'currency'`;
}

export function enrollmentTermsReviewResult(terms:EnrollmentTerms,allowWaitlist:boolean,error='confirmation_required') {
    return {error,persisted:false,requiresConfirmation:true,enrollmentTerms:terms,allowWaitlist,
        message:allowWaitlist
            ? 'Present the course, cohort dates, schedule, location, price, currency and prerequisites. Ask explicitly whether the customer accepts these terms and joining the waitlist with automatic seat assignment only while these terms remain unchanged. Waiting does not assign a seat or request payment.'
            : 'Present the course, cohort dates, schedule, location, price, currency and prerequisites and request confirmation. No enrollment or charge has been made.'};
}
