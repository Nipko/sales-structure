/**
 * The structured fields of a tour package, stated so the model cannot read them past a description.
 *
 * Production QA 2026-10-24 (travel, `requiredReads.tours` on): «cuánto dura el tour Aurora?» ran search_packages, whose row had
 * `durationType: 'hours', durationValue: 4`, and the model answered that the tour «has no fixed duration»: the package's free
 * description text (written by the business, any wording) was read as a rule over the configured fields. The reader now gives
 * the duration as one plain value next to the raw pair, and says which fields are the configured data.
 */

/** «4 hours», «1 day»: the configured duration of a package, or null when it has none. Pure. */
export function packageDuration(type: unknown, value: unknown): string | null {
    const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = type === 'hours' ? 'hour' : type === 'days' ? 'day' : type === 'nights' ? 'night' : null;
    if (!unit) return null;
    return `${amount} ${unit}${amount === 1 ? '' : 's'}`;
}

/** Told to the model with every package read: the configured fields win over the description. */
export const PACKAGE_FIELD_AUTHORITY = 'duration (durationType/durationValue), price, includes and excludes are the configured values of each package. description is free text written by the business: it never overrides, negates or replaces those fields. When duration is set, that is how long the package lasts, whatever its description says.';
