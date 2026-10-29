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
export const PACKAGE_FIELD_AUTHORITY = 'duration (durationType/durationValue), price, includes, excludes and languages are the configured values of each package. description is free text written by the business: it never overrides, negates or replaces those fields. When duration is set, that is how long the package lasts, whatever its description says.';

/**
 * Told to the model with a package list read without a date. Production 2026-10-24: «combien de places restent pour le Spark QA
 * Tour ?» got `seatsLeft: null` from search_packages (seats belong to a departure, and a dateless search reads none) and the
 * reply said there was no precise number of seats while the 2026-12-15 09:00 departure had 10. The dateless list no longer
 * carries a null seat count; it says where the seats are.
 * F4300-54 (production QA 29-oct, travel, EN and ES): «What are the specific departure times for the tours?» → «I don't have
 * specific departure times listed», after search_packages only, while the Spark QA Tour departs 2026-12-15 at 09:00. Dates and
 * times are the departure's too, and the note says where they are.
 */
export const PACKAGE_SEATS_NOTE = 'Seats, dates and times belong to each departure, not to the package: this list was read without a date, so it carries no seat count and no departure. The departures (date, time, seatsLeft) are upcomingDepartures[] in get_package_details of each package (or check_package_availability for one date). Never say the seat count or the departure dates or times are unknown or not recorded before reading them.';

/**
 * F4300-32. The languages a package is guided in, or `'not_registered'` when the business recorded none. Production 2026-10-24:
 * «en qué idiomas es el Spark QA Tour?» (languages ['es']) was answered «no tengo esa información», and «em que idiomas é o Tour
 * QA Aurora?» (languages []) was answered «espanhol»: an empty list left to the model reads as "anything goes". Codes and names
 * are kept as the business wrote them. Pure.
 */
export function packageLanguages(raw: unknown): string[] | 'not_registered' {
    let value = raw;
    if (typeof value === 'string') {
        const text = value.trim();
        try { value = text.startsWith('[') ? JSON.parse(text) : text.split(/[,;/]+/); } catch { value = []; }
    }
    const list = Array.isArray(value)
        ? [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
        : [];
    return list.length ? list : 'not_registered';
}

/** Told to the model with a package read whose languages are not registered. */
export const PACKAGE_LANGUAGES_NOTE = 'languages lists the languages each package is guided or offered in (codes such as "es" = Spanish, "en" = English, "pt" = Portuguese, "fr" = French). languages "not_registered" means the business has not recorded them for that package: say the language is not registered and offer to confirm it with the team. Never guess one, not even the language of this conversation or of the business.';
