/**
 * What the customer profile ("Ver cliente", /admin/contacts/:id) was opened with.
 *
 * The inbox, memberships, pets, photo sessions and treatment plans link here with a CONTACT id; the CRM
 * list links with a LEAD id. `GET /crm/leads/:tenant/:id` answers both and says which it was in
 * `data.resolved` ({ kind: 'lead' | 'contact_lead' | 'contact_only', leadId, contactId }).
 *
 * Every write the page makes (notes, tasks, stage, archive, custom fields, score, insight) is keyed on a
 * LEAD id: a note written with a contact id breaks the notes -> leads foreign key, and an update by
 * contact id touches no row. So the page must never write with the id from the URL unless that id is the
 * lead's.
 */
export type LeadProfileView =
    /** The URL id is not the lead's: go to the lead's own URL, where every call is keyed correctly. */
    | { mode: 'redirect'; leadId: string }
    /** A lead whose id is the URL id: the full, editable profile. */
    | { mode: 'editable'; leadId: string }
    /** A contact with no lead yet: activity only, no write actions. */
    | { mode: 'read_only'; contactId: string | null }
    /** The response carries no lead at all: show an error, never a blank page. */
    | { mode: 'invalid' };

export function interpretLeadProfile(urlId: string, data: any): LeadProfileView {
    const lead = data?.lead;
    if (!lead || typeof lead !== 'object') return { mode: 'invalid' };
    const resolved = data?.resolved;
    // `lead.id` is null for the contact-backed profile; an API that predates `resolved` always returns the
    // lead whose id is the URL id (a contact id was a 500 there), so no `resolved` means "editable".
    if (resolved?.kind === 'contact_only' || (resolved && !lead.id)) {
        return { mode: 'read_only', contactId: resolved?.contactId ?? lead.contact_id ?? null };
    }
    const leadId = typeof lead.id === 'string' && lead.id ? lead.id : (typeof resolved?.leadId === 'string' ? resolved.leadId : null);
    if (!leadId) return { mode: 'invalid' };
    if (leadId !== urlId) return { mode: 'redirect', leadId };
    return { mode: 'editable', leadId };
}
