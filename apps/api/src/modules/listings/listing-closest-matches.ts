/**
 * «Nothing matches every filter» is not «the agency has nothing for you».
 *
 * A QA agency had ONE apartment for sale (2 bedrooms, city set, neighbourhood
 * empty). «2 habitaciones en la zona norte» reached `search_listings` as
 * `neighborhood: 'norte'`, the SQL `LIKE` excluded the row whose neighbourhood
 * is NULL, and the agent told the customer there was no such apartment: a false
 * negative over a listing nobody had placed in any zone.
 *
 * The strict search stays strict (it is what `listings` means). This module
 * classifies the other available listings against the same criteria so the tool
 * can hand the near misses back as `closestMatches`, each one saying which
 * criterion it clearly misses (`unmetCriteria`) and which one the catalogue
 * cannot confirm because the field is empty (`unconfirmedCriteria`).
 */

export interface ListingSearchCriteria {
    transactionType?: string;
    propertyKind?: string;
    maxPrice?: number;
    minPrice?: number;
    minBedrooms?: number;
    minAreaM2?: number;
    neighborhood?: string;
    city?: string;
}

export type ListingCriterion = keyof ListingSearchCriteria;

/** Criteria the customer states as a requirement; location text is fuzzy («zona norte», «el centro»). */
export const HARD_LISTING_CRITERIA: ReadonlySet<ListingCriterion> = new Set<ListingCriterion>([
    'transactionType', 'propertyKind', 'maxPrice', 'minPrice', 'minBedrooms', 'minAreaM2',
]);

export const LOCATION_LISTING_CRITERIA: ReadonlySet<ListingCriterion> = new Set<ListingCriterion>(['neighborhood', 'city']);

export interface ListingCriteriaVerdict {
    unmet: ListingCriterion[];
    unconfirmed: ListingCriterion[];
}

const CRITERIA_ORDER: ListingCriterion[] = [
    'transactionType', 'propertyKind', 'maxPrice', 'minPrice', 'minBedrooms', 'minAreaM2', 'neighborhood', 'city',
];

/** Same folding as `foldedSql`: accents, œ/æ ligatures and case. */
export function foldListingText(value: unknown): string {
    return String(value ?? '')
        .replace(/œ/g, 'oe').replace(/Œ/g, 'oe').replace(/æ/g, 'ae').replace(/Æ/g, 'ae')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

const present = (value: unknown): boolean => value !== undefined && value !== null && String(value).trim() !== '';

const numeric = (value: unknown): number | null => {
    if (!present(value)) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

/** The criteria the caller actually gave (empty strings and undefined are «not asked»). */
export function givenListingCriteria(criteria: ListingSearchCriteria): ListingCriterion[] {
    return CRITERIA_ORDER.filter(key => present(criteria[key]));
}

export function evaluateListingCriteria(row: Record<string, any>, criteria: ListingSearchCriteria): ListingCriteriaVerdict {
    const unmet: ListingCriterion[] = [];
    const unconfirmed: ListingCriterion[] = [];
    const exact = (key: ListingCriterion, column: string) => {
        if (!present(row[column])) unconfirmed.push(key);
        else if (String(row[column]) !== String(criteria[key])) unmet.push(key);
    };
    // A price of 0/NULL is «consultar», not free: it can neither meet nor break a budget.
    const bound = (key: ListingCriterion, column: string, direction: 'max' | 'min', zeroUnknown: boolean) => {
        const value = numeric(row[column]);
        const limit = Number(criteria[key]);
        if (value === null || (zeroUnknown && value <= 0)) unconfirmed.push(key);
        else if (direction === 'max' ? value > limit : value < limit) unmet.push(key);
    };
    const contains = (haystacks: unknown[], needle: unknown) => {
        const folded = foldListingText(needle);
        return haystacks.some(h => present(h) && foldListingText(h).includes(folded));
    };

    for (const key of givenListingCriteria(criteria)) {
        switch (key) {
            case 'transactionType': exact(key, 'transaction_type'); break;
            case 'propertyKind': exact(key, 'property_kind'); break;
            case 'maxPrice': bound(key, 'price', 'max', true); break;
            case 'minPrice': bound(key, 'price', 'min', true); break;
            case 'minBedrooms': bound(key, 'bedrooms', 'min', false); break;
            case 'minAreaM2': bound(key, 'area_m2', 'min', true); break;
            case 'neighborhood':
                // The strict search also accepts the address; a street address that does
                // not name the zone does not prove the listing is outside it.
                if (contains([row.neighborhood, row.address], criteria.neighborhood)) break;
                if (!present(row.neighborhood)) unconfirmed.push(key);
                else unmet.push(key);
                break;
            case 'city':
                if (contains([row.city], criteria.city)) break;
                if (!present(row.city)) unconfirmed.push(key);
                else unmet.push(key);
                break;
        }
    }
    return { unmet, unconfirmed };
}

export interface ClosestListing {
    row: Record<string, any>;
    verdict: ListingCriteriaVerdict;
}

/**
 * Picks the near misses among `candidates`.
 *
 * - `strictCount === 0`: any candidate that misses or cannot confirm something,
 *   best first (fewest hard misses, then fewest misses, then fewest unknowns).
 * - `strictCount > 0`: only candidates whose ONLY problem is an empty field, so a
 *   real result list is not padded with listings that clearly miss a criterion.
 */
export function selectClosestListings(
    candidates: Record<string, any>[],
    criteria: ListingSearchCriteria,
    options: { excludeIds: Iterable<string>; strictCount: number; max: number },
): ClosestListing[] {
    if (givenListingCriteria(criteria).length === 0) return [];
    const excluded = new Set([...options.excludeIds].map(id => String(id)));
    const seen = new Set<string>();
    const scored: Array<ClosestListing & { order: number }> = [];
    candidates.forEach((row, order) => {
        const id = row && row.id !== undefined && row.id !== null ? String(row.id) : '';
        if (!id || excluded.has(id) || seen.has(id)) return;
        seen.add(id);
        const verdict = evaluateListingCriteria(row, criteria);
        if (verdict.unmet.length === 0 && verdict.unconfirmed.length === 0) return;
        if (options.strictCount > 0 && verdict.unmet.length > 0) return;
        scored.push({ row, verdict, order });
    });
    const hardMisses = (v: ListingCriteriaVerdict) => v.unmet.filter(k => HARD_LISTING_CRITERIA.has(k)).length;
    scored.sort((a, b) => hardMisses(a.verdict) - hardMisses(b.verdict)
        || a.verdict.unmet.length - b.verdict.unmet.length
        || a.verdict.unconfirmed.length - b.verdict.unconfirmed.length
        || a.order - b.order);
    return scored.slice(0, Math.max(0, options.max)).map(({ row, verdict }) => ({ row, verdict }));
}

const TRANSACTION_ES: Record<string, string> = { sale: 'venta', rent: 'arriendo' };

/** One line per listing, in the words the model should use with the customer. */
export function describeListingVerdict(row: Record<string, any>, criteria: ListingSearchCriteria, verdict: ListingCriteriaVerdict): string {
    const parts: string[] = [];
    for (const key of verdict.unmet) {
        switch (key) {
            case 'transactionType':
                parts.push(`operación distinta: es ${TRANSACTION_ES[row.transaction_type] || row.transaction_type}, no ${TRANSACTION_ES[String(criteria.transactionType)] || criteria.transactionType}`);
                break;
            case 'propertyKind': parts.push(`tipo distinto: es ${row.property_kind}, no ${criteria.propertyKind}`); break;
            case 'maxPrice': parts.push(`precio por encima del máximo pedido (${criteria.maxPrice})`); break;
            case 'minPrice': parts.push(`precio por debajo del mínimo pedido (${criteria.minPrice})`); break;
            case 'minBedrooms': parts.push(`tiene ${row.bedrooms} habitaciones, se pidieron al menos ${criteria.minBedrooms}`); break;
            case 'minAreaM2': parts.push(`área de ${Number(row.area_m2)} m², se pidieron al menos ${criteria.minAreaM2}`); break;
            case 'neighborhood': parts.push(`zona «${criteria.neighborhood}» no coincide: su barrio registrado es «${row.neighborhood}»`); break;
            case 'city': parts.push(`ciudad «${criteria.city}» no coincide: su ciudad registrada es «${row.city}»`); break;
        }
    }
    for (const key of verdict.unconfirmed) {
        switch (key) {
            case 'neighborhood': parts.push(`zona «${criteria.neighborhood}» no confirmada: el inmueble no tiene barrio registrado`); break;
            case 'city': parts.push(`ciudad «${criteria.city}» no confirmada: el inmueble no tiene ciudad registrada`); break;
            case 'maxPrice':
            case 'minPrice': parts.push('precio no publicado: no se puede confirmar el presupuesto'); break;
            default: parts.push(`${key} no confirmado: el dato no está registrado`); break;
        }
    }
    return parts.join('; ');
}

export function closestMatchesNote(strictCount: number): string {
    if (strictCount > 0) {
        return 'closestMatches cumplen el resto de criterios pero no tienen registrada la ubicación pedida. '
            + 'Puedes mencionarlos aclarando que su zona no está confirmada; nunca digas que están en esa zona.';
    }
    return 'Ningún inmueble cumple TODOS los criterios, pero la búsqueda sí encontró opciones cercanas en closestMatches. '
        + 'No digas que no hay inmuebles: di qué no puedes confirmar o qué es distinto (el matchNote de cada uno) y ofrécelos, '
        + 'por ejemplo «no tengo uno confirmado en la zona norte, pero tengo este…». '
        + 'Nunca afirmes que un inmueble cumple un criterio listado en unmetCriteria o unconfirmedCriteria.';
}
