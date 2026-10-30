import { catalogPriceStatus } from '../catalog-price-status';
import { getToolPolicy, isBusinessWriteTool } from '../tool-policy-registry';
import { isFailedToolResult, KNOWLEDGE_READERS, moneyFieldName, NON_DATA_KEYS } from '../trusted-price-context';
import { toolResultSucceeded } from '../../../common/utils/outcome-claim.util';
import { FACT_TTL_MS, type FactInvalidation, type VerifiedFact, type VerifiedFactKind } from './facts-ledger';

/**
 * Typed facts from the tool results of one turn (operations runtime PR3). Pure: the caller stores them.
 *
 * Only successful reads of the static tool registry count. Knowledge readers (FAQ, policy, knowledge base) are prose,
 * not catalogue authority; a failed or stale result says nothing about the business; an MCP/unknown tool has no
 * declared subject. A fact needs a subject id: an amount with no entity around it stays limited to the call.
 */
export interface ExecutedTool { name: string; result: any; args?: any }

const ENTITY_ID_EXCLUDED = new Set(['contactid', 'customerid', 'tenantid', 'conversationid', 'agentid', 'staffid',
    'instructorid', 'userid', 'ownerid', 'categoryid', 'channelaccountid']);
const NAME_KEYS = ['name', 'title', 'nombre', 'label', 'displayName', 'packageName', 'propertyName', 'productName',
    'serviceName', 'className', 'courseName', 'planName', 'itemName', 'vehicleName'];
const GENERIC_CONTAINERS = new Set(['items', 'results', 'data', 'rows', 'records', 'list', 'matches', 'closestmatches']);
const TYPE_BY_TOOL: Array<[RegExp, string]> = [
    [/menu/, 'menu_item'], [/package/, 'package'], [/propert/, 'property'], [/listing/, 'listing'],
    [/product|stock|catalog/, 'product'], [/vehicle/, 'vehicle'], [/course/, 'course'], [/membership|plan/, 'plan'],
    [/class/, 'class'], [/order/, 'order'], [/appointment/, 'appointment'], [/booking/, 'booking'], [/service/, 'service'],
];
/** Descriptive attributes that stay true like a price does (24h); never people, notes or free text. */
const ATTRIBUTE_FIELDS = new Set(['amenities', 'capacity', 'maxguests', 'bedrooms', 'bathrooms', 'beds', 'area', 'aream2',
    'duration', 'durationminutes', 'durationdays', 'nights', 'includes', 'inclusions', 'excludes', 'exclusions', 'allergens', 'preptimeminutes',
    // A listing's parking spots (production QA 30-oct): 0 is what backs «the property has no parking».
    'parkingspots']);
const AVAILABILITY_SUBJECT_ARGS = ['serviceId', 'propertyId', 'packageId', 'listingId', 'productId', 'vehicleId', 'courseId', 'classId'];
const READ_META_STATUSES = new Set(['ok', 'empty', 'stale', 'error']);
const MAX_LIST_ITEMS = 15;
const MAX_ARRAY_ITEMS = 12;
const MAX_TEXT = 80;

const snake = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/_id$/i, '').toLowerCase();
const text = (value: unknown) => String(value).slice(0, MAX_TEXT);

function toolSubjectType(tool: string): string | undefined {
    return TYPE_BY_TOOL.find(([pattern]) => pattern.test(tool))?.[1];
}

function singular(key: string): string {
    const k = snake(key);
    return k.endsWith('ies') ? `${k.slice(0, -3)}y` : k.endsWith('s') ? k.slice(0, -1) : k;
}

function entityId(record: Record<string, unknown>): { key: string; id: string } | null {
    const valid = (value: unknown) => (typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isFinite(value));
    if (valid(record.id)) return { key: 'id', id: String(record.id) };
    for (const [key, value] of Object.entries(record)) {
        if (/(Id|_id)$/.test(key) && !ENTITY_ID_EXCLUDED.has(key.replace(/_/g, '').toLowerCase()) && valid(value)) return { key, id: String(value) };
    }
    return null;
}

function entityName(record: Record<string, unknown>): string | undefined {
    for (const key of NAME_KEYS) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return text(value.trim());
    }
    return undefined;
}

function shortReference(id: string): string {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8).toUpperCase() : text(id);
}

function attributeValue(value: unknown): VerifiedFact['value'] | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.trim() ? text(value.trim()) : null;
    if (Array.isArray(value)) {
        const items = value.map(item => typeof item === 'string' ? item
            : item && typeof item === 'object' && typeof (item as any).name === 'string' ? (item as any).name : null)
            .filter((item): item is string => !!item && !!item.trim()).slice(0, MAX_ARRAY_ITEMS).map(text);
        return items.length ? items : null;
    }
    return null;
}

interface TurnFacts { facts: VerifiedFact[]; invalidations: FactInvalidation[] }

export function extractVerifiedFacts(executed: readonly ExecutedTool[], at: Date, turn?: string): TurnFacts {
    const facts: VerifiedFact[] = [];
    const invalidations: FactInvalidation[] = [];
    const observedAt = at.toISOString();
    const make = (kind: VerifiedFactKind, tool: string, body: Omit<VerifiedFact, 'v' | 'kind' | 'source' | 'observedAt' | 'expiresAt'>): VerifiedFact => ({
        v: 1, kind, ...body, source: { tool, ...(turn ? { turn } : {}) }, observedAt,
        expiresAt: new Date(at.getTime() + FACT_TTL_MS[kind]).toISOString(),
    });

    for (const { name, result, args } of executed || []) {
        if (typeof name !== 'string') continue;
        if (isBusinessWriteTool(name)) {
            if (toolResultSucceeded(result)) invalidations.push({ subjectIds: idsIn({ args, result }), records: true });
            continue;
        }
        const policy = getToolPolicy(name);
        if (!policy || policy.origin === 'mcp' || KNOWLEDGE_READERS.has(name) || isFailedToolResult(result)) continue;
        if (typeof result !== 'object' || result.stale === true || result.status === 'stale') continue;
        const publicRead = policy.dataClassification === 'public';
        const toolType = toolSubjectType(name);

        // Entities: money (every reader), attributes (public catalogue), record status (customer records).
        const visit = (value: unknown, container: string | undefined, inheritedCurrency: string | undefined, depth: number): void => {
            if (!value || typeof value !== 'object' || depth > 6) return;
            if (Array.isArray(value)) {
                value.slice(0, 40).forEach(item => visit(item, container, inheritedCurrency, depth + 1));
                return;
            }
            const record = value as Record<string, unknown>;
            const currency = typeof record.currency === 'string' && record.currency.trim() ? record.currency.trim().toUpperCase() : inheritedCurrency;
            const identity = entityId(record);
            if (identity) {
                const type = identity.key !== 'id' ? snake(identity.key)
                    : container && !GENERIC_CONTAINERS.has(container.toLowerCase()) ? singular(container)
                        : toolType || 'item';
                const subject = { type, id: identity.id, ...(entityName(record) ? { name: entityName(record) } : {}) };
                const explicitStatus = record.priceStatus ?? record.price_status;
                const addMoney = (key: string, raw: unknown, prefix = '') => {
                    const money = moneyFieldName(key);
                    if (!money || !(typeof raw === 'number' || (typeof raw === 'string' && raw.trim()))) return;
                    const amount = Number(raw);
                    if (!Number.isFinite(amount) || amount < 0) return;
                    const value = money.cents ? amount / 100 : amount;
                    const priceStatus = catalogPriceStatus(value, explicitStatus);
                    if (priceStatus === 'missing') return;
                    facts.push(make('money', name, { subject, field: `${prefix}${key}`, value, priceStatus, ...(currency ? { currency } : {}) }));
                };
                for (const [key, child] of Object.entries(record)) {
                    if (NON_DATA_KEYS.has(key)) continue;
                    addMoney(key, child);
                    // One level of plain grouping (`pricing: { nightPrice, cleaningFee }`), never another entity.
                    if (child && typeof child === 'object' && !Array.isArray(child) && !entityId(child as Record<string, unknown>)) {
                        for (const [inner, raw] of Object.entries(child as Record<string, unknown>)) addMoney(inner, raw, `${key}.`);
                    }
                    if (publicRead && ATTRIBUTE_FIELDS.has(key.replace(/_/g, '').toLowerCase())) {
                        const attribute = attributeValue(child);
                        if (attribute !== null) facts.push(make('attribute', name, { subject, field: key, value: attribute }));
                    }
                }
                if (!publicRead) {
                    for (const key of ['status', 'paymentStatus', 'payment_status']) {
                        const status = record[key];
                        if (typeof status !== 'string' || !status.trim()) continue;
                        if (key === 'status' && READ_META_STATUSES.has(status) && 'asOf' in record) continue;
                        facts.push(make('record_status', name, { subject, field: key === 'payment_status' ? 'paymentStatus' : key, value: text(status) }));
                    }
                }
            }
            for (const [key, child] of Object.entries(record)) {
                if (NON_DATA_KEYS.has(key) || !child || typeof child !== 'object') continue;
                visit(child, Array.isArray(child) || entityId(child as Record<string, unknown>) ? key : container, currency, depth + 1);
            }
        };
        visit(result, undefined, undefined, 0);

        // Availability: the answer for that subject (and date), valid for minutes.
        if (/availability$/.test(name) || name === 'check_stock') {
            const subjectArg = AVAILABILITY_SUBJECT_ARGS.find(key => typeof args?.[key] === 'string' && args[key].trim());
            const id = subjectArg ? String(args[subjectArg]) : entityId(result)?.id;
            const available = typeof result.available === 'boolean' ? result.available
                : typeof result.isAvailable === 'boolean' ? result.isAvailable
                    : typeof result.inStock === 'boolean' ? result.inStock
                        : Array.isArray(result.slots) ? result.slots.length > 0 : undefined;
            if (id && available !== undefined) {
                const date = [args?.date, args?.checkIn, args?.startDate, args?.departureDate].find(v => typeof v === 'string' && v.trim());
                const slots = Array.isArray(result.slots) ? result.slots.slice(0, 8).map((slot: any) =>
                    typeof slot === 'string' ? slot : text(slot?.time ?? slot?.start ?? slot?.startTime ?? '')).filter(Boolean) : [];
                const type = subjectArg ? snake(subjectArg) : toolType || 'item';
                const nameOf = typeof result.serviceName === 'string' ? result.serviceName : entityName(result);
                facts.push(make('availability', name, {
                    subject: { type, id, ...(nameOf ? { name: text(nameOf) } : {}) },
                    field: date ? `available:${text(date)}` : 'available', value: available,
                    ...(slots.length ? { detail: slots } : {}),
                }));
            }
        }

        // The customer's own records: the list as read, with whether it is complete.
        if (!publicRead && /^(list_|get_my_)/.test(name)) {
            const entry = Object.entries(result).find(([key, value]) => Array.isArray(value) && !GENERIC_CONTAINERS.has(key.toLowerCase())
                && (value.length === 0 || value.every(item => item && typeof item === 'object' && entityId(item))));
            if (entry) {
                const [key, rows] = entry as [string, any[]];
                const total = typeof result.total === 'number' ? result.total : typeof result.totalCount === 'number' ? result.totalCount : rows.length;
                const limit = Number(args?.limit);
                const complete = rows.length === 0 ? result.hasMore !== true
                    : result.hasMore === false || result.truncated === false
                        || (typeof result.total === 'number' && result.total === rows.length)
                        || (Number.isFinite(limit) && limit > 0 && rows.length < limit);
                facts.push(make('record_list', name, {
                    subject: { type: snake(key), id: 'customer' }, field: 'records',
                    value: rows.slice(0, MAX_LIST_ITEMS).map(row => {
                        const id = entityId(row)!.id;
                        return [shortReference(id), typeof row.status === 'string' ? row.status : ''].filter(Boolean).join(' ');
                    }),
                    complete, total,
                }));
            }
        }
    }
    return { facts, invalidations };
}

/** Every id-shaped string a write's arguments or result mention: the subjects whose availability it changed. */
function idsIn(value: unknown, into: string[] = [], depth = 0): string[] {
    if (!value || typeof value !== 'object' || depth > 5) return into;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if ((key === 'id' || /(Id|_id)$/.test(key)) && (typeof child === 'string' || typeof child === 'number')) into.push(String(child));
        else if (child && typeof child === 'object') idsIn(child, into, depth + 1);
    }
    return into;
}
