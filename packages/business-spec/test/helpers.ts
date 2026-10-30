import * as fs from 'node:fs';
import * as path from 'node:path';
import { evaluate } from '../src/engine/evaluate';
import { fromLegacyRows, type LegacyTenantRows } from '../src/legacy-status';
import { loadSpec } from '../src/load';
import { emptySnapshot } from '../src/snapshot';
import type { ItemRecord, RequirementEvaluation, TenantSnapshot } from '../src/types';

export const NOW = new Date('2026-10-30T12:00:00.000Z');
export const spec = loadSpec();

export function base(subtype: string): TenantSnapshot {
    const s = emptySnapshot('test', NOW.toISOString());
    s.values['CORE.IDENTITY.PROFILE'] = [{ value: { subtype }, status: 'confirmed', origin: 'owner_form', confirmedAt: NOW.toISOString() }];
    return s;
}

export function val(s: TenantSnapshot, id: string, value: unknown, extra: Record<string, unknown> = {}): TenantSnapshot {
    (s.values[id] ??= []).push({ value, status: 'confirmed', origin: 'owner_form', confirmedAt: NOW.toISOString(), ...extra });
    return s;
}

export function item(s: TenantSnapshot, object: string, fields: Record<string, unknown>, extra: Partial<ItemRecord> = {}): TenantSnapshot {
    (s.items[object] ??= []).push({ id: `${object}-${(s.items[object] ?? []).length + 1}`, active: true, fields, contentStatus: 'confirmed', origin: 'owner_form', ...extra });
    return s;
}

export function region(s: TenantSnapshot, pack: Record<string, unknown> = {}): TenantSnapshot {
    val(s, 'CORE.IDENTITY.REGION', { operating_country: 'CO', timezone: 'America/Bogota', currency: 'COP' });
    s.platform.countryPack = { id: 'es-CO', country: 'CO', emergency: { medical: '123', crisisLine: '106', reviewStatus: 'unreviewed' }, consumerRights: null, ...pack } as TenantSnapshot['platform']['countryPack'];
    return s;
}

export function admin(s: TenantSnapshot): TenantSnapshot {
    s.accounts.push({ id: 'u1', role: 'tenant_admin', active: true, emailVerified: true, handoffNotifications: true });
    return s;
}

export function evalReq(s: TenantSnapshot, id: string): RequirementEvaluation {
    const r = evaluate(spec, s, NOW).requirements.find(x => x.id === id);
    if (!r) throw new Error(`no existe ${id}`);
    return r;
}

export const FIXTURES = path.join(__dirname, 'fixtures', 'qa-tenants');
export function fixtureRows(slug: string): LegacyTenantRows {
    return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${slug}.snapshot.json`), 'utf8')) as LegacyTenantRows;
}
export const fixtureSnapshot = (slug: string): TenantSnapshot => fromLegacyRows(fixtureRows(slug));
