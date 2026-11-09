import { ALERT_CONFIG_DEFAULTS } from './alert-config.service';
import { PlatformMonitorService } from './platform-monitor.service';
import { budgetLevel } from './llm-budget-level';

/**
 * ADR-0026. El 9-nov los 7 tenants QA iban por $15-18 de un tope blando de
 * $17.50 y un tope duro de $25 (el agente deja de responder) y nadie lo sabia:
 * el chequeo corria una vez al dia, solo al 90 % del blando y no miraba el duro.
 */
describe('budgetLevel', () => {
    const caps = { softCents: 1750, hardCents: 2500 };
    it.each([
        [1000, 'ok'],
        [1400, 'soft_warn'],
        [1750, 'soft_reached'],
        [2250, 'hard_near'],
        [2500, 'hard_reached'],
    ])('%i centavos -> %s', (spentCents, level) => {
        expect(budgetLevel({ spentCents, ...caps })).toBe(level);
    });

    it('sin topes o ilimitado: ok', () => {
        expect(budgetLevel({ spentCents: 1e9, softCents: 0, hardCents: Number.POSITIVE_INFINITY })).toBe('ok');
    });

    it('solo tope duro', () => {
        expect(budgetLevel({ spentCents: 950, softCents: 0, hardCents: 1000 })).toBe('hard_near');
    });
});

function harness(spend: Record<string, number>, limits: Record<string, { soft: number; hard: number }>) {
    const alerts: Array<{ key: string; subject: string; severity?: string; cooldownSec?: number }> = [];
    const store: Record<string, string> = {};
    const redis = {
        get: jest.fn(async (k: string) => store[k] ?? null),
        set: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    };
    const incidents = { resolveByKey: jest.fn(async () => undefined) };
    const prisma = { tenant: { findMany: jest.fn(async () => Object.keys(limits).map(id => ({ id, name: `T-${id}` }))) } };
    const throttle = {
        getPlanLimit: jest.fn(async (id: string, key: string) => (key === 'llmCostBudgetUsdCents' ? limits[id].soft : limits[id].hard)),
        getLlmSpendUsdCents: jest.fn(async (id: string) => spend[id] ?? 0),
    };
    const monitor = new PlatformMonitorService(
        redis as any, {} as any, prisma as any, {} as any, {} as any,
        incidents as any, {} as any,
        { get: jest.fn(async () => ALERT_CONFIG_DEFAULTS) } as any,
        {} as any, throttle as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        {} as any, {} as any,
    );
    (monitor as any).alert = jest.fn(async (key: string, subject: string, _html: string, _v: number, opts: any) => {
        alerts.push({ key, subject, severity: opts?.severity, cooldownSec: opts?.cooldownSec });
    });
    return { monitor, alerts, incidents, store };
}

describe('PlatformMonitorService.checkLlmBudgets', () => {
    it('avisa por tenant y nivel, con override respetado via getPlanLimit, y deja la foto para el superadmin', async () => {
        const h = harness(
            { a: 1500, b: 2300, c: 100 },
            { a: { soft: 1750, hard: 2500 }, b: { soft: 1750, hard: 2500 }, c: { soft: 10000, hard: 15000 } },
        );
        const statuses = await h.monitor.checkLlmBudgets();
        expect(h.alerts.map(a => [a.key, a.severity])).toEqual([
            ['llm:budget:a:soft_warn', 'warning'],
            ['llm:budget:b:hard_near', 'critical'],
        ]);
        expect(h.alerts[1].subject).toContain('T-b');
        expect(h.alerts.every(a => a.cooldownSec === 24 * 3600)).toBe(true);
        // El nivel nuevo cierra el incidente de los otros niveles y la clave vieja.
        expect(h.incidents.resolveByKey).toHaveBeenCalledWith('llm:budget:b:soft_warn');
        expect(h.incidents.resolveByKey).toHaveBeenCalledWith('llm:budget:b');
        expect(h.incidents.resolveByKey).not.toHaveBeenCalledWith('llm:budget:b:hard_near');
        expect(statuses.find(s => s.tenantId === 'c')).toMatchObject({ level: 'ok', softPct: 1, hardPct: 1 });
        expect(JSON.parse(h.store['llm:budget:status']).tenants).toHaveLength(3);
    });

    it('tenant sin topes: no avisa y cierra lo que hubiera', async () => {
        const h = harness({ z: 99999 }, { z: { soft: 0, hard: Number.POSITIVE_INFINITY } });
        await h.monitor.checkLlmBudgets();
        expect(h.alerts).toEqual([]);
        expect(h.incidents.resolveByKey).toHaveBeenCalledWith('llm:budget:z:hard_reached');
    });
});
