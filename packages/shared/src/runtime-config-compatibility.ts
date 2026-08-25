/**
 * Code-backed CFG-01 matrix. It reports sources and validity only: secret
 * values never leave the process and cannot accidentally reach an Ops payload.
 */
export const RUNTIME_CONFIG_COMPATIBILITY_VERSION = 1 as const;

export type RuntimeConfigSensitivity = 'public' | 'internal' | 'secret';
export type RuntimeConfigScope = 'platform' | 'tenant_runtime';

export interface RuntimeConfigContractEntry {
    name: string;
    scope: RuntimeConfigScope;
    sensitivity: RuntimeConfigSensitivity;
    owner: string;
    legacyFallback?: string;
    safeDefault?: string;
    validation: string;
    rotation: string;
    rollback: string;
}

export const RUNTIME_CONFIG_CONTRACT: readonly RuntimeConfigContractEntry[] = Object.freeze([
    Object.freeze({
        name: 'TENANT_SECRET_KEY', scope: 'platform', sensitivity: 'secret', owner: 'security',
        legacyFallback: 'ENCRYPTION_KEY', validation: '64 hexadecimal characters',
        rotation: 'Set new key + key id and preserve previous key atomically.',
        rollback: 'Restore previous key id/key while the previous keyring entry remains available.',
    }),
    Object.freeze({
        name: 'TENANT_SECRET_KEY_ID', scope: 'platform', sensitivity: 'internal', owner: 'security',
        safeDefault: 'primary', validation: '1-40 alphanumeric, underscore or dash',
        rotation: 'Change atomically with TENANT_SECRET_KEY.',
        rollback: 'Restore the former id together with its key.',
    }),
    Object.freeze({
        name: 'TENANT_SECRET_PREVIOUS_KEYS', scope: 'platform', sensitivity: 'secret', owner: 'security',
        safeDefault: '{}', validation: 'JSON object of key id to 64-hex key',
        rotation: 'Add the former current key before changing current id/key.',
        rollback: 'Keep both key generations until rewrap evidence is complete.',
    }),
    Object.freeze({
        name: 'TENANT_SECRET_PLAINTEXT', scope: 'platform', sensitivity: 'internal', owner: 'security',
        safeDefault: 'accept', validation: 'accept|reject',
        rotation: 'Cut over to reject only after inventory reports zero plaintext.',
        rollback: 'Return to accept only for a bounded migration incident.',
    }),
    Object.freeze({
        name: 'INTEGRATION_WRITE_CAPABILITIES', scope: 'platform', sensitivity: 'internal', owner: 'integrations',
        legacyFallback: 'INTEGRATION_WRITE_PROVIDERS', safeDefault: '',
        validation: 'provider@apiVersion:operation entries separated by commas',
        rotation: 'Add one certified provider/version/operation after sandbox sign-off.',
        rollback: 'Remove the exact capability entry; queued intent remains suppressed.',
    }),
    Object.freeze({
        name: 'VERTICAL_INTEGRATIONS_TOAST_ALLOWED_HOSTS', scope: 'platform', sensitivity: 'internal', owner: 'integrations',
        safeDefault: '*.toasttab.com official namespace', validation: 'HTTPS host allowlist',
        rotation: 'Add reviewed host explicitly.', rollback: 'Remove custom host and use official default.',
    }),
    Object.freeze({
        name: 'VERTICAL_INTEGRATIONS_CLINIKO_ALLOWED_HOSTS', scope: 'platform', sensitivity: 'internal', owner: 'integrations',
        safeDefault: 'api.<shard>.cliniko.com official namespace', validation: 'HTTPS host allowlist',
        rotation: 'Add reviewed host explicitly.', rollback: 'Remove custom host and use official default.',
    }),
]);

export interface ResolvedRuntimeConfigEntry {
    name: string;
    source: 'explicit' | 'legacy' | 'default';
    present: boolean;
    valid: boolean;
    sensitivity: RuntimeConfigSensitivity;
    /** Stable diagnostic code only; never the configured value. */
    diagnostic: string;
}

export interface RuntimeConfigCompatibilitySnapshotV1 {
    version: typeof RUNTIME_CONFIG_COMPATIBILITY_VERSION;
    deploymentCompatible: boolean;
    entries: readonly ResolvedRuntimeConfigEntry[];
}

type EnvLike = Readonly<Record<string, string | undefined>>;
const HEX_64 = /^[a-fA-F0-9]{64}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,40}$/;

function entry(
    contract: RuntimeConfigContractEntry,
    source: ResolvedRuntimeConfigEntry['source'],
    present: boolean,
    valid: boolean,
    diagnostic: string,
): ResolvedRuntimeConfigEntry {
    return Object.freeze({
        name: contract.name,
        source,
        present,
        valid,
        sensitivity: contract.sensitivity,
        diagnostic,
    });
}

function validPreviousKeys(raw: string | undefined): boolean {
    if (!raw) return true;
    try {
        const value = JSON.parse(raw);
        return !!value && typeof value === 'object' && !Array.isArray(value)
            && Object.entries(value).every(([id, key]) => KEY_ID.test(id) && HEX_64.test(String(key)));
    } catch {
        return false;
    }
}

function validHostnameAllowlist(raw: string | undefined): boolean {
    if (!raw) return true;
    const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
    const entries = raw.split(',').map(value => value.trim()).filter(Boolean);
    return entries.length > 0 && entries.every(value => (
        !value.includes('://')
        && !value.includes('*')
        && hostname.test(value)
        && !['.localhost', '.local', '.internal', '.home', '.lan']
            .some(suffix => value.toLowerCase().endsWith(suffix))
    ));
}

export interface IntegrationWriteCapabilityGrant {
    provider: string;
    apiVersion: string;
    operation: string;
    source: 'explicit' | 'legacy';
}

const WRITE_CAPABILITY_RE = /^([a-z0-9_-]+)@([a-zA-Z0-9._-]+):([a-z0-9_*.-]+)$/;

export function parseIntegrationWriteCapabilities(
    explicit: string | undefined,
    legacy: string | undefined,
): { grants: readonly IntegrationWriteCapabilityGrant[]; valid: boolean; source: 'explicit' | 'legacy' | 'default' } {
    const rawExplicit = String(explicit || '').trim();
    if (rawExplicit) {
        const grants: IntegrationWriteCapabilityGrant[] = [];
        for (const token of rawExplicit.split(',').map(value => value.trim()).filter(Boolean)) {
            const match = WRITE_CAPABILITY_RE.exec(token);
            if (!match) return { grants: Object.freeze([]), valid: false, source: 'explicit' };
            grants.push(Object.freeze({
                provider: match[1].toLowerCase(),
                apiVersion: match[2],
                operation: match[3].toLowerCase(),
                source: 'explicit' as const,
            }));
        }
        return { grants: Object.freeze(grants), valid: true, source: 'explicit' };
    }
    const grants = String(legacy || '')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
        .map(provider => Object.freeze({
            provider,
            apiVersion: '*',
            operation: '*',
            source: 'legacy' as const,
        }));
    return {
        grants: Object.freeze(grants),
        valid: true,
        source: grants.length ? 'legacy' : 'default',
    };
}

export function integrationWriteCapabilityAllowed(input: {
    provider: string;
    apiVersion?: string | null;
    operation?: string | null;
    explicit?: string;
    legacy?: string;
}): boolean {
    const parsed = parseIntegrationWriteCapabilities(input.explicit, input.legacy);
    if (!parsed.valid) return false;
    const provider = String(input.provider || '').trim().toLowerCase();
    const apiVersion = String(input.apiVersion || '').trim();
    const operation = String(input.operation || '').trim().toLowerCase();
    return parsed.grants.some(grant => (
        grant.provider === provider
        && (grant.apiVersion === '*' || (!!apiVersion && grant.apiVersion === apiVersion))
        && (grant.operation === '*' || (!!operation && grant.operation === operation))
    ));
}

export function resolveRuntimeConfigCompatibility(
    env: EnvLike,
): RuntimeConfigCompatibilitySnapshotV1 {
    const byName = new Map(RUNTIME_CONFIG_CONTRACT.map(item => [item.name, item]));
    const secretKey = env.TENANT_SECRET_KEY || env.ENCRYPTION_KEY;
    const secretSource = env.TENANT_SECRET_KEY ? 'explicit' : env.ENCRYPTION_KEY ? 'legacy' : 'default';
    const keyId = env.TENANT_SECRET_KEY_ID || 'primary';
    const plaintext = String(env.TENANT_SECRET_PLAINTEXT || 'accept').toLowerCase();
    const writes = parseIntegrationWriteCapabilities(
        env.INTEGRATION_WRITE_CAPABILITIES,
        env.INTEGRATION_WRITE_PROVIDERS,
    );
    const toastHostsValid = validHostnameAllowlist(env.VERTICAL_INTEGRATIONS_TOAST_ALLOWED_HOSTS);
    const clinikoHostsValid = validHostnameAllowlist(env.VERTICAL_INTEGRATIONS_CLINIKO_ALLOWED_HOSTS);
    const entries: ResolvedRuntimeConfigEntry[] = [
        entry(byName.get('TENANT_SECRET_KEY')!, secretSource, !!secretKey, !secretKey || HEX_64.test(secretKey), secretKey ? 'key_material_present' : 'lazy_fail_closed'),
        entry(byName.get('TENANT_SECRET_KEY_ID')!, env.TENANT_SECRET_KEY_ID ? 'explicit' : 'default', !!env.TENANT_SECRET_KEY_ID, KEY_ID.test(keyId), 'key_id_resolved'),
        entry(byName.get('TENANT_SECRET_PREVIOUS_KEYS')!, env.TENANT_SECRET_PREVIOUS_KEYS ? 'explicit' : 'default', !!env.TENANT_SECRET_PREVIOUS_KEYS, validPreviousKeys(env.TENANT_SECRET_PREVIOUS_KEYS), 'previous_keyring_checked'),
        entry(byName.get('TENANT_SECRET_PLAINTEXT')!, env.TENANT_SECRET_PLAINTEXT ? 'explicit' : 'default', !!env.TENANT_SECRET_PLAINTEXT, ['accept', 'reject'].includes(plaintext), 'plaintext_cutover_resolved'),
        entry(byName.get('INTEGRATION_WRITE_CAPABILITIES')!, writes.source, writes.grants.length > 0, writes.valid, writes.grants.length ? 'write_allowlist_present' : 'external_writes_disabled'),
        entry(
            byName.get('VERTICAL_INTEGRATIONS_TOAST_ALLOWED_HOSTS')!,
            env.VERTICAL_INTEGRATIONS_TOAST_ALLOWED_HOSTS ? 'explicit' : 'default',
            !!env.VERTICAL_INTEGRATIONS_TOAST_ALLOWED_HOSTS,
            toastHostsValid,
            toastHostsValid ? 'host_allowlist_resolved' : 'host_allowlist_invalid',
        ),
        entry(
            byName.get('VERTICAL_INTEGRATIONS_CLINIKO_ALLOWED_HOSTS')!,
            env.VERTICAL_INTEGRATIONS_CLINIKO_ALLOWED_HOSTS ? 'explicit' : 'default',
            !!env.VERTICAL_INTEGRATIONS_CLINIKO_ALLOWED_HOSTS,
            clinikoHostsValid,
            clinikoHostsValid ? 'host_allowlist_resolved' : 'host_allowlist_invalid',
        ),
    ];
    return Object.freeze({
        version: RUNTIME_CONFIG_COMPATIBILITY_VERSION,
        deploymentCompatible: entries.every(item => item.valid),
        entries: Object.freeze(entries),
    });
}
