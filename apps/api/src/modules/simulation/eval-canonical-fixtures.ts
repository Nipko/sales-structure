import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { EVAL_SANDBOX_CONTACT_ID } from '../conversations/agent-test-tool-policy';
import { EVAL_SANDBOX_FIXTURE_IDS } from '../conversations/eval-writer-sandbox';
import type { EvalNamespaceQuery } from './isolated-eval-namespace';
import { TemporalCapacityContractService } from '../verticals/temporal-capacity-contract.service';
import { wallClockToUtc } from '../appointments/appointment-ics.util';
import { REPAIR_EVAL_IDS, prepareRepairEvalFixtures } from '../repair-orders/repair-order-eval-fixtures';
import { CATALOG_EVAL_IDS, prepareCatalogEvalFixtures } from '../orders/catalog-order-eval-fixtures';

export const CANONICAL_EVAL_FIXTURE_IDS = Object.freeze({
    ...EVAL_SANDBOX_FIXTURE_IDS,
    ...REPAIR_EVAL_IDS,
    ...CATALOG_EVAL_IDS,
    staffUser: '00000000-0000-4000-8000-00000000b010',
    unavailableClass: '00000000-0000-4000-8000-00000000b011',
    unavailableCohort: '00000000-0000-4000-8000-00000000b012',
    persona: '00000000-0000-4000-8000-00000000b013',
});

type Window = { day: number; start: number; end: number };
export type CanonicalEvalFixtures = {
    status: 'blocked'; reason: 'invalid_snapshot_time' | 'invalid_timezone' | 'invalid_business_hours' | 'business_hours_closed' | 'business_hours_too_short';
} | {
    status: 'ready'; date: string; time: string; endTime: string; recoveryTime: string;
    recoveryEndTime: string; endDate: string; timezone: string; weekday: number;
    ids: typeof CANONICAL_EVAL_FIXTURE_IDS; bindings: Record<string, string>;
    windows: Window[];
};

const DAYS = [['dom', 'sunday'], ['lun', 'monday'], ['mar', 'tuesday'], ['mie', 'wednesday'], ['jue', 'thursday'], ['vie', 'friday'], ['sab', 'saturday']];
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const minutes = (value: unknown): number | null => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
function uniqueWallClock(value: string, timezone: string): boolean {
    const instant = wallClockToUtc(value, timezone).getTime();
    const format = (epoch: number) => {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
        const part = (type: string) => parts.find(item => item.type === type)!.value;
        return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
    };
    return format(instant) === value && ![-7200, -3600, -1800, 1800, 3600, 7200].some(offset => format(instant + offset * 1000) === value);
}

/** Civil dates are calculated in the snapshot's timezone, never the host timezone. */
export function resolveCanonicalEvalFixtures(snapshot?: AgentEvaluationSnapshot): CanonicalEvalFixtures {
    const captured = new Date(snapshot?.capturedAt ?? Date.now());
    if (!Number.isFinite(captured.getTime())) return { status: 'blocked', reason: 'invalid_snapshot_time' };
    const hours = snapshot?.config?.hours;
    const timezone = hours?.timezone || 'America/Bogota';
    let date: string;
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(captured);
        const part = (type: string) => parts.find(value => value.type === type)!.value;
        date = `${part('year')}-${part('month')}-${part('day')}`;
    } catch { return { status: 'blocked', reason: 'invalid_timezone' }; }
    const schedule: unknown = hours?.schedule;
    if (schedule !== undefined && (!schedule || typeof schedule !== 'object' || Array.isArray(schedule))) {
        return { status: 'blocked', reason: 'invalid_business_hours' };
    }
    const configured = schedule as Record<string, unknown> | undefined;
    const windows: Window[] = [];
    // The actual runtime treats an absent/empty agent schedule as unrestricted.
    // Explicit closed/malformed schedules must never be replaced by that default.
    if (!configured || Object.keys(configured).length === 0) {
        for (let day = 0; day < 7; day++) windows.push({ day, start: 0, end: 1439 });
    } else {
        if (Object.keys(configured).some(key => !DAYS.flat().includes(key))) return { status: 'blocked', reason: 'invalid_business_hours' };
        for (const [day, aliases] of DAYS.entries()) {
            const values = aliases.filter(key => Object.hasOwn(configured, key)).map(key => configured[key]);
            if (values.length > 1 && JSON.stringify(values[0]) !== JSON.stringify(values[1])) return { status: 'blocked', reason: 'invalid_business_hours' };
            const value: any = values[0];
            if (value === undefined || value === null || value === false || value === 'closed' || value === 'cerrado') continue;
            if (typeof value !== 'object' || Array.isArray(value)) return { status: 'blocked', reason: 'invalid_business_hours' };
            if (value.enabled === false) continue;
            const start = minutes(value.start ?? value.open), end = minutes(value.end ?? value.close);
            if (start === null || end === null || end <= start) return { status: 'blocked', reason: 'invalid_business_hours' };
            windows.push({ day, start, end });
        }
    }
    if (!windows.length) return { status: 'blocked', reason: 'business_hours_closed' };
    // Two adjacent 30-minute appointments and a 60-minute class must fit.
    const usable = windows.filter(window => window.end - window.start >= 60);
    if (!usable.length) return { status: 'blocked', reason: 'business_hours_too_short' };
    for (let offset = 2; offset < 16; offset++) {
        const candidate = addDays(date, offset);
        const weekday = new Date(`${candidate}T12:00:00Z`).getUTCDay();
        const window = usable.find(item => item.day === weekday);
        if (!window) continue;
        // Prefer a daytime slot only if it is actually contained in that window.
        const start = window.start <= 540 && window.end >= 600 ? 540 : window.start;
        const time = clock(start), endTime = clock(start + 30), recoveryTime = endTime, recoveryEndTime = clock(start + 60);
        try {
            if (![time, recoveryTime, recoveryEndTime].every(value => uniqueWallClock(`${candidate}T${value}:00`, timezone))) continue;
            new TemporalCapacityContractService().normalize({ kind: 'appointment', startsAtLocal: `${candidate}T${time}:00`, timezone, durationMinutes: 60 });
            new TemporalCapacityContractService().normalize({ kind: 'appointment', startsAtLocal: `${candidate}T${recoveryTime}:00`, timezone, durationMinutes: 30 });
        } catch { continue; } // Nonexistent/ambiguous DST wall clocks are never advertised as bookable fixtures.
        const endDate = addDays(candidate, 30);
        return { status: 'ready', date: candidate, time, endTime, recoveryTime, recoveryEndTime, endDate, timezone, weekday,
            ids: CANONICAL_EVAL_FIXTURE_IDS, windows,
            bindings: { date: candidate, time, endTime, recoveryTime, recoveryEndTime, endDate, timezone,
                service: '[EVAL] Sandbox Service', fitnessClass: '[EVAL] Sandbox Class', course: '[EVAL] Sandbox Course',
                unavailableClass: '[EVAL] Cancelled Class', unavailableCohort: '[EVAL] Cancelled Cohort',
                cohort: 'EVAL-OPEN', customerName: 'Alex Rivera', customerEmail: 'alex.rivera@example.invalid',
                customerPhone: '+573000000001', ...Object.fromEntries(Object.entries(CANONICAL_EVAL_FIXTURE_IDS).map(([key, value]) => [`${key}Id`, value])) },
        };
    }
    return { status: 'blocked', reason: 'business_hours_closed' };
}

/** Only explicit {{fixture.name}} tokens are substituted; unknown tokens fail the gate. */
export function bindCanonicalEvalFixtures<T>(value: T, fixtures: CanonicalEvalFixtures): T {
    if (fixtures.status !== 'ready') throw new Error(`eval_fixtures_blocked:${fixtures.reason}`);
    const bind = (item: unknown): unknown => {
        if (typeof item === 'string') return item.replace(/\{\{fixture\.([a-zA-Z]+)\}\}/g, (_token, key: string) => {
            if (!Object.hasOwn(fixtures.bindings, key)) throw new Error(`eval_fixture_binding_unknown:${key}`);
            return fixtures.bindings[key];
        });
        if (Array.isArray(item)) return item.map(bind);
        if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, part]) => [key, bind(part)]));
        return item;
    };
    return bind(value) as T;
}

/** Called only after lease ownership validation; query is already scoped to this namespace. */
export async function prepareCanonicalEvalFixtures(query: EvalNamespaceQuery, schema: string, snapshot?: AgentEvaluationSnapshot): Promise<CanonicalEvalFixtures> {
    if (!/^tenant_eval_[a-f0-9]{8}_[a-f0-9]{24}$/.test(schema)) throw new Error('eval_fixture_namespace_required');
    const fixture = resolveCanonicalEvalFixtures(snapshot);
    if (fixture.status !== 'ready') return fixture;
    const f = fixture.ids, marker = JSON.stringify({ evalSandbox: true }), table = (name: string) => `"${schema}".${name}`;
    const seed = async (sql: string, params: unknown[]) => { await query(sql, params); };
    await seed(`INSERT INTO ${table('persona_config')} (id, config_yaml, config_json, version, is_active) VALUES ($1::uuid, '{}', $2::jsonb, 1, true)`,
        [f.persona, JSON.stringify(snapshot?.config ?? { hours: { timezone: fixture.timezone, schedule: {} } })]);
    // No global users, provider accounts or credentials are created here.
    await seed(`INSERT INTO ${table('__eval_ref_users')} (id,tenant_id,is_active,first_name,last_name) SELECT $1::uuid,tenant_id,true,'Eval','Staff' FROM ${table('__eval_namespace')} ON CONFLICT DO NOTHING`, [f.staffUser]);
    for (const window of fixture.windows) await seed(`INSERT INTO ${table('availability_slots')} (user_id, day_of_week, start_time, end_time, is_active) VALUES ($1::uuid,$2,$3::time,$4::time,true)`,
        [f.staffUser, window.day, clock(window.start), clock(window.end)]);
    for (const [id, name, duration, category] of [[f.service, '[EVAL] Sandbox Service', 30, 'eval'], [f.boardingService, '[EVAL] Boarding Service', 1440, 'guarderia']]) {
        await seed(`INSERT INTO ${table('services')} (id,name,description,duration_minutes,price,currency,is_active,category,max_concurrent,metadata) VALUES ($1::uuid,$2,'Evaluation-only fixture',$3,10,'COP',true,$4,1,$5::jsonb)`, [id, name, duration, category, marker]);
    }
    await seed(`INSERT INTO ${table('properties')} (id,name,description,city,max_guests,night_price,currency,is_active,metadata) VALUES ($1::uuid,'[EVAL] Sandbox Property','Evaluation-only fixture','Eval City',4,100,'COP',true,$2::jsonb)`, [f.property, marker]);
    await seed(`INSERT INTO ${table('tour_packages')} (id,name,description,duration_type,duration_value,price,currency,max_capacity,destination,is_active,metadata) VALUES ($1::uuid,'[EVAL] Sandbox Tour','Evaluation-only fixture','hours',2,50,'COP',10,'Eval City',true,$2::jsonb)`, [f.tourPackage, marker]);
    await seed(`INSERT INTO ${table('tour_inventory')} (id,package_id,departure_date,departure_time,available_seats,total_seats,is_active,notes) VALUES ($1::uuid,$2::uuid,$3::date,$4::time,10,10,true,'[EVAL] fixture')`, [f.tourInventory, f.tourPackage, fixture.date, fixture.time]);
    await seed(`INSERT INTO ${table('menu_items')} (id,name,description,price,currency,is_available,is_active,metadata) VALUES ($1::uuid,'[EVAL] Sandbox Menu Item','Evaluation-only fixture',10,'COP',true,true,$2::jsonb)`, [f.menuItem, marker]);
    await seed(`INSERT INTO ${table('members')} (id,contact_id,member_number,current_period_start,current_period_end,class_credits_remaining,status,metadata) VALUES ($1::uuid,$2::uuid,'EVAL-SANDBOX',CURRENT_DATE,$3::date,10,'active',$4::jsonb)`, [f.member, EVAL_SANDBOX_CONTACT_ID, fixture.endDate, marker]);
    for (const [id, name, cancelled] of [[f.fitnessClass, '[EVAL] Sandbox Class', false], [f.unavailableClass, '[EVAL] Cancelled Class', true]]) {
        await seed(`INSERT INTO ${table('fitness_classes')} (id,name,class_type,scheduled_at,duration_minutes,max_capacity,available_spots,credits_required,is_cancelled,metadata) VALUES ($1::uuid,$2,'eval',$3::timestamp,60,20,20,1,$4,$5::jsonb)`, [id, name, `${fixture.date} ${fixture.time}`, cancelled, marker]);
    }
    await seed(`INSERT INTO ${table('courses')} (id,name,slug,description,price,currency,subject,level,is_active,metadata) VALUES ($1::uuid,'[EVAL] Sandbox Course','eval-sandbox-course','Evaluation-only fixture',100,'COP','eval','A1',true,$2::jsonb)`, [f.course, marker]);
    for (const [id, code, status] of [[f.cohort, 'EVAL-OPEN', 'open'], [f.unavailableCohort, '[EVAL] Cancelled Cohort', 'cancelled']]) {
        await seed(`INSERT INTO ${table('course_cohorts')} (id,course_id,cohort_code,starts_at,ends_at,schedule,max_capacity,available_seats,status,metadata) VALUES ($1::uuid,$2::uuid,$3,$4::date,$5::date,$6,20,20,$7,$8::jsonb)`, [id, f.course, code, fixture.date, fixture.endDate, `${fixture.date} ${fixture.time}-${fixture.recoveryEndTime}`, status, marker]);
    }
    await seed(`INSERT INTO ${table('products')} (id,name,description,category,price,currency,is_available,stock,metadata) VALUES ($1::uuid,'[EVAL] Sandbox Product','Evaluation-only fixture','eval',10,'COP',true,100,$2::jsonb)`, [f.product, marker]);
    await seed(`INSERT INTO ${table('vehicles')} (id,make,model,year,price_cents,currency,status,category,description) VALUES ($1::uuid,'[EVAL]','Sandbox Vehicle',$2,1000,'COP','available','eval','Evaluation-only fixture')`, [f.vehicle, Number(fixture.date.slice(0, 4))]);
    await seed(`INSERT INTO ${table('pets')} (id,contact_id,name,species,is_active,metadata) VALUES ($1::uuid,$2::uuid,'[EVAL] Sandbox Pet','dog',true,$3::jsonb)`, [f.pet, EVAL_SANDBOX_CONTACT_ID, marker]);
    await seed(`INSERT INTO ${table('insurance_policies')} (id,policy_number,contact_id,policyholder_name,monthly_premium,currency,starts_at,ends_at,status,metadata) VALUES ($1::uuid,'EVAL-SANDBOX-POLICY',$2::uuid,'Eval Policyholder',10,'COP',CURRENT_DATE,$3::date,'active',$4::jsonb)`, [f.insurancePolicy, EVAL_SANDBOX_CONTACT_ID, fixture.endDate, marker]);
    await prepareRepairEvalFixtures(query, schema);
    await prepareCatalogEvalFixtures(query, schema, f.product);
    return fixture;
}
