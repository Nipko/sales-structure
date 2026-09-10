import { createHash } from 'crypto';
import { PRODUCTION_DATABASE_NAMES, PRODUCTION_DOMAINS, databaseNameIn, hostsIn } from './staging-isolation';

/**
 * ═══ THE RULES EVERY STAGING SCRIPT OBEYS ═══
 *
 * The scripts the staging workflow runs seed tenants, flip an operational
 * switch and delete data with `--reset`. Each of them is a loaded gun pointed at
 * whatever database it is handed, and the only thing standing between "reset the
 * staging tenants" and "reset the customers" is which connection string was in
 * the environment when somebody ran it.
 *
 * So none of them read the environment and hope. They all call
 * `assertStagingTarget` first, which refuses unless the environment says staging
 * AND the database says staging AND neither says production. Three independent
 * statements, because any one of them can be wrong on its own: a `.env` copied
 * between hosts satisfies the first, a URL typo satisfies the second.
 */

/** A database name must SAY staging. Not "not production" — say it. */
const STAGING_DATABASE_MARKER = /(^|[_-])staging($|[_-])|_stg($|[_-])/i;

export type StagingRefusal =
    | 'environment_not_staging'
    | 'connection_string_missing'
    | 'database_name_missing'
    | 'production_database_name'
    | 'database_name_not_staging'
    | 'production_host';

export class StagingTargetRefused extends Error {
    constructor(readonly reason: StagingRefusal, readonly detail?: string) {
        super(`staging_target_refused:${reason}${detail ? `:${detail}` : ''}`);
    }
}

export interface StagingTarget {
    readonly databaseUrl: string;
    readonly databaseName: string;
}

/**
 * The one gate. Pure except for what it is given, so the tests are the same
 * function the scripts run.
 *
 * `environment` is `PARALLLY_ENVIRONMENT`, written into the staging `.env` by
 * the workflow and absent everywhere else — including production, which never
 * sets it. An unset value is a refusal, never a default.
 */
export function assertStagingTarget(input: {
    environment?: string | null; databaseUrl?: string | null;
}): StagingTarget {
    if (String(input.environment ?? '').trim().toLowerCase() !== 'staging') {
        throw new StagingTargetRefused('environment_not_staging', String(input.environment ?? '(unset)'));
    }
    const databaseUrl = String(input.databaseUrl ?? '').trim();
    if (!databaseUrl) throw new StagingTargetRefused('connection_string_missing');
    for (const host of hostsIn(databaseUrl)) {
        if (PRODUCTION_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))) {
            throw new StagingTargetRefused('production_host', host);
        }
    }
    const databaseName = databaseNameIn(databaseUrl);
    if (!databaseName) throw new StagingTargetRefused('database_name_missing');
    if (PRODUCTION_DATABASE_NAMES.includes(databaseName)) {
        throw new StagingTargetRefused('production_database_name', databaseName);
    }
    if (!STAGING_DATABASE_MARKER.test(databaseName)) {
        throw new StagingTargetRefused('database_name_not_staging', databaseName);
    }
    return { databaseUrl, databaseName };
}

/**
 * The synthetic tenants, fixed and derivable.
 *
 * Deterministic ids so a second run can find and replace exactly what the first
 * one made, rather than accumulating a new set of tenants every deploy and
 * slowly turning the staging database into a place where provisioning is never
 * actually exercised.
 *
 * Every identifying value is obviously fake on sight — the phone numbers are in
 * the reserved +99 range, the emails are on `.invalid`, which by RFC 2606 can
 * never resolve. Nothing here can reach a person even if a channel were
 * accidentally connected.
 */
export interface SyntheticTenant {
    readonly id: string;
    readonly slug: string;
    readonly schemaName: string;
    readonly industry: string;
    readonly subType: string;
    readonly adminEmail: string;
    readonly contactPhone: string;
}

const uuidFrom = (seed: string): string => {
    const hex = createHash('sha256').update(`parallly-staging-synthetic:${seed}`).digest('hex');
    // Version 4 / variant bits, so the value satisfies every UUID check on the way.
    return [hex.slice(0, 8), hex.slice(8, 12), `4${hex.slice(13, 16)}`,
        `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`, hex.slice(20, 32)].join('-');
};

const TENANT_SEEDS: ReadonlyArray<{ slug: string; industry: string; subType: string }> = Object.freeze([
    { slug: 'stg-clinica', industry: 'salud', subType: 'clinica_general' },
    { slug: 'stg-restaurante', industry: 'gastronomia', subType: 'restaurante' },
    { slug: 'stg-capacitacion', industry: 'education', subType: 'capacitacion' },
]);

export const SYNTHETIC_TENANTS: readonly SyntheticTenant[] = Object.freeze(TENANT_SEEDS.map((seed, index) => Object.freeze({
    id: uuidFrom(seed.slug),
    slug: seed.slug,
    schemaName: `tenant_${seed.slug.replace(/-/g, '_')}`,
    industry: seed.industry,
    subType: seed.subType,
    adminEmail: `owner-${seed.slug}@staging.invalid`,
    // +99 is unassigned by ITU-T E.164 and can never be routed to a person.
    contactPhone: `+9900000${String(index + 1).padStart(4, '0')}`,
})));

/** The tenant a pilot may ever be turned on for. Exactly one, and it is synthetic. */
export const PILOT_TENANT = SYNTHETIC_TENANTS[0];
/** And the only channel: the web widget, which has no provider and no recipient. */
export const PILOT_CHANNEL = 'web_widget';

/**
 * What the dispatch pilot writes, and what turning it off writes.
 *
 * Scoped to one synthetic tenant on purpose: `enabled: true` with an empty
 * tenant list means EVERY tenant, and a staging rehearsal that quietly proves
 * the "all tenants" configuration is not a rehearsal of the pilot.
 */
export function dispatchPilotValue(enabled: boolean): { enabled: boolean; tenantIds: string[]; channels: string[] } {
    return enabled
        ? { enabled: true, tenantIds: [PILOT_TENANT.id], channels: [PILOT_CHANNEL] }
        : { enabled: false, tenantIds: [], channels: [] };
}

/** Refuses a pilot configuration that would reach past the synthetic tenant. */
export function assertPilotScope(value: { enabled?: unknown; tenantIds?: unknown; channels?: unknown }): void {
    if (value.enabled !== true) return;
    const tenantIds = Array.isArray(value.tenantIds) ? value.tenantIds : [];
    const channels = Array.isArray(value.channels) ? value.channels : [];
    if (tenantIds.length !== 1 || tenantIds[0] !== PILOT_TENANT.id) {
        throw new Error(`staging_pilot_scope_refused:tenants:${tenantIds.length}`);
    }
    if (channels.length !== 1 || channels[0] !== PILOT_CHANNEL) {
        throw new Error(`staging_pilot_scope_refused:channels:${channels.join(',') || 'none'}`);
    }
}

/**
 * What may leave the host in an artefact.
 *
 * A staging log is still a log of messages, and "it is synthetic" is a claim
 * about intent, not about what a person typed into the widget while somebody was
 * demonstrating it. Emails, phone numbers, long digit runs and bearer tokens are
 * replaced before anything is uploaded.
 */
export function redactForArtifact(text: string): string {
    return text
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
        .replace(/\+?\d[\d ()-]{6,}\d/g, '<phone>')
        .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '<token>')
        .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<jwt>');
}
