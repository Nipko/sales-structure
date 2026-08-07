import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Frenos sobre el super_admin creando cupones. Antes era barra libre: cualquier
 * super_admin podia mintear meses gratis sin cuota, sin motivo y sin alerta, a
 * diferencia del resto de la casa (impersonate exige motivo obligatorio).
 *
 * La UNIDAD de control es "meses-gratis" (freeMonths x maxRedemptions), no la
 * cantidad de cupones: un cupon de 24 meses sin tope pesa infinitamente mas que
 * 10 cupones de 1 mes con tope de 1 canje.
 *
 * Tres capas, en orden de fuerza:
 *  1. Motivo obligatorio (requireReason): queda en auditoria, calca impersonate.
 *  2. Cuota mensual DURA (monthlyGiftedMonthsCap): tope de meses-gratis emitidos
 *     por mes calendario. Se puede superar SOLO con el PIN del dueno (el override
 *     no es un flag que cualquiera pueda pasar).
 *  3. PIN del dueno para ALTO IMPACTO: cupones sin tope de canjes (potencial
 *     infinito) o cuya emision supera highImpactThresholdMonths. Distingue al
 *     dueno de otros super_admin sin inventar un sub-rol.
 *
 * Config editable sin deploy (blob JSON en platform_settings + cache Redis),
 * calcado de AlertConfigService. El PIN NO vive en la DB —donde un super_admin
 * podria resetearlo y vaciar el control— sino en la env OWNER_COUPON_PIN, que
 * custodia el dueno via GitHub Secrets.
 */
export interface CouponGovernanceConfig {
    /** Tope de meses-gratis emitidos por mes calendario. null = sin cuota. */
    monthlyGiftedMonthsCap: number | null;
    /** Motivo obligatorio al crear/generar cupones. */
    requireReason: boolean;
    /** Emision (freeMonths x cantidad) desde la cual se exige el PIN del dueno. */
    highImpactThresholdMonths: number;
    /** Tope de meses-gratis acumulables por un mismo tenant. null = sin tope. */
    maxStackedMonthsPerTenant: number | null;
}

export const COUPON_GOVERNANCE_DEFAULTS: CouponGovernanceConfig = {
    monthlyGiftedMonthsCap: 60,
    requireReason: true,
    highImpactThresholdMonths: 24,
    maxStackedMonthsPerTenant: 6,
};

const SETTINGS_KEY = 'coupons.governance';
const CACHE_KEY = 'coupons:governance';
const CACHE_TTL = 300;

@Injectable()
export class CouponGovernanceService {
    private readonly logger = new Logger(CouponGovernanceService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    private merge(base: CouponGovernanceConfig, partial: any): CouponGovernanceConfig {
        const p = partial && typeof partial === 'object' ? partial : {};
        const numOrNull = (v: any, fallback: number | null): number | null => {
            if (v === null) return null;
            return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
        };
        const num = (v: any, fallback: number): number =>
            typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
        return {
            monthlyGiftedMonthsCap: numOrNull(p.monthlyGiftedMonthsCap, base.monthlyGiftedMonthsCap),
            requireReason: typeof p.requireReason === 'boolean' ? p.requireReason : base.requireReason,
            highImpactThresholdMonths: num(p.highImpactThresholdMonths, base.highImpactThresholdMonths),
            maxStackedMonthsPerTenant: numOrNull(p.maxStackedMonthsPerTenant, base.maxStackedMonthsPerTenant),
        };
    }

    /** Config efectiva (defaults + overrides). Cacheada; nunca lanza. */
    async get(): Promise<CouponGovernanceConfig> {
        try {
            const cached = await this.redis.getJson<CouponGovernanceConfig>(CACHE_KEY);
            if (cached) return this.merge(COUPON_GOVERNANCE_DEFAULTS, cached);

            const rows = await this.prisma.$queryRaw<{ value: string }[]>`
                SELECT value FROM platform_settings WHERE key = ${SETTINGS_KEY} LIMIT 1
            `;
            let stored: any = {};
            if (rows?.[0]?.value) {
                try { stored = JSON.parse(rows[0].value); } catch { stored = {}; }
            }
            const merged = this.merge(COUPON_GOVERNANCE_DEFAULTS, stored);
            await this.redis.setJson(CACHE_KEY, merged, CACHE_TTL);
            return merged;
        } catch (e: any) {
            this.logger.debug(`CouponGovernance get fell back to defaults: ${e.message}`);
            return { ...COUPON_GOVERNANCE_DEFAULTS };
        }
    }

    async set(partial: any): Promise<CouponGovernanceConfig> {
        const merged = this.merge(await this.get(), partial);
        const json = JSON.stringify(merged);
        await this.prisma.$executeRaw`
            INSERT INTO platform_settings (key, value, category, updated_at)
            VALUES (${SETTINGS_KEY}, ${json}, 'billing', NOW())
            ON CONFLICT (key) DO UPDATE SET value = ${json}, updated_at = NOW()
        `;
        await this.redis.setJson(CACHE_KEY, merged, CACHE_TTL);
        return merged;
    }

    // ── PIN del dueno ──────────────────────────────────────────────

    get pinConfigured(): boolean {
        return !!(process.env.OWNER_COUPON_PIN && process.env.OWNER_COUPON_PIN.length >= 4);
    }

    /** Comparacion en tiempo constante: un PIN no debe filtrarse por timing. */
    private pinMatches(provided?: string): boolean {
        const expected = process.env.OWNER_COUPON_PIN;
        if (!expected || !provided) return false;
        const a = createHash('sha256').update(expected).digest();
        const b = createHash('sha256').update(provided).digest();
        return timingSafeEqual(a, b);
    }

    // ── Metricas para la cuota y el panel ──────────────────────────

    /**
     * Meses-gratis EMITIDOS este mes calendario = suma de (free_months x
     * max_redemptions) sobre los cupones creados desde el 1ro. Los cupones sin
     * tope de canjes (max_redemptions null) quedan afuera de este numero: su
     * potencial es infinito y se gobiernan por el PIN, no por la cuota.
     *
     * Cada codigo de lote es una fila con max_redemptions=1, asi que este mismo
     * SUM cuenta los lotes de forma natural (free_months x cantidad de codigos).
     */
    async giftedMonthsThisMonth(): Promise<number> {
        try {
            const rows = await this.prisma.$queryRaw<{ total: number }[]>`
                SELECT COALESCE(SUM("free_months" * "max_redemptions"), 0)::int AS total
                FROM "public"."billing_coupons"
                WHERE "created_at" >= date_trunc('month', NOW())
                  AND "free_months" IS NOT NULL
                  AND "max_redemptions" IS NOT NULL
            `;
            return rows?.[0]?.total ?? 0;
        } catch (e: any) {
            this.logger.warn(`giftedMonthsThisMonth failed: ${e.message}`);
            return 0;
        }
    }

    /** Meses-gratis ya CANJEADOS (vivos) por un tenant, para el tope de stacking. */
    async activeStackedMonthsForTenant(tenantId: string): Promise<number> {
        try {
            const rows = await this.prisma.$queryRaw<{ total: number }[]>`
                SELECT COALESCE(SUM(c."free_months"), 0)::int AS total
                FROM "public"."billing_coupon_redemptions" r
                JOIN "public"."billing_coupons" c ON c."id" = r."coupon_id"
                WHERE r."tenant_id" = ${tenantId}
                  AND (r."metadata" ->> 'revokedAt') IS NULL
            `;
            return rows?.[0]?.total ?? 0;
        } catch (e: any) {
            this.logger.warn(`activeStackedMonthsForTenant failed: ${e.message}`);
            return 0;
        }
    }

    /** Resumen para el panel del dueno: cuanto regalo este mes vs el tope. */
    async summary(): Promise<{
        giftedMonthsThisMonth: number;
        monthlyCap: number | null;
        remaining: number | null;
        pinConfigured: boolean;
        config: CouponGovernanceConfig;
    }> {
        const config = await this.get();
        const used = await this.giftedMonthsThisMonth();
        const remaining = config.monthlyGiftedMonthsCap == null
            ? null
            : Math.max(config.monthlyGiftedMonthsCap - used, 0);
        return {
            giftedMonthsThisMonth: used,
            monthlyCap: config.monthlyGiftedMonthsCap,
            remaining,
            pinConfigured: this.pinConfigured,
            config,
        };
    }

    // ── La guarda que se aplica en create / generateBatch ──────────

    /**
     * Aplica motivo + cuota + PIN antes de mintear. Lanza si algo no pasa.
     * `plannedGiftedMonths` = freeMonths x cantidad (o Infinity si el cupon no
     * tiene tope de canjes). Devuelve si la emision fue de alto impacto, para
     * marcarlo en la auditoria y la alerta.
     */
    async assertCanIssue(input: {
        reason?: string;
        plannedGiftedMonths: number;
        ownerPin?: string;
    }): Promise<{ highImpact: boolean; overQuota: boolean }> {
        const cfg = await this.get();

        if (cfg.requireReason && (!input.reason || input.reason.trim().length < 3)) {
            throw new BadRequestException({
                error: 'reason_required',
                message: 'A reason (min 3 chars) is required to issue coupons.',
            });
        }

        const impact = input.plannedGiftedMonths;
        const monthly = await this.giftedMonthsThisMonth();
        const overQuota = cfg.monthlyGiftedMonthsCap != null
            && Number.isFinite(impact)
            && monthly + impact > cfg.monthlyGiftedMonthsCap;
        const highImpact = !Number.isFinite(impact) || impact >= cfg.highImpactThresholdMonths;

        // Todo lo que exceda el sobre de rutina (cuota o alto impacto) exige el PIN
        // del dueno. El PIN ES el override: no hay un flag que un super_admin
        // cualquiera pueda pasar para saltarse la cuota.
        if (overQuota || highImpact) {
            if (!this.pinConfigured) {
                throw new ForbiddenException({
                    error: 'owner_pin_not_configured',
                    message: overQuota
                        ? 'This issuance exceeds the monthly gifted-months cap and requires the owner PIN, which is not configured (set OWNER_COUPON_PIN).'
                        : 'This is a high-impact issuance and requires the owner PIN, which is not configured (set OWNER_COUPON_PIN).',
                });
            }
            if (!this.pinMatches(input.ownerPin)) {
                throw new ForbiddenException({
                    error: 'invalid_owner_pin',
                    message: 'Owner PIN required or incorrect for this high-impact / over-quota issuance.',
                });
            }
        }

        return { highImpact, overQuota };
    }

    /** Tope de stacking por tenant, aplicado en el canje. Lanza si se pasa. */
    async assertStackingAllowed(tenantId: string, addMonths: number): Promise<void> {
        const cfg = await this.get();
        if (cfg.maxStackedMonthsPerTenant == null) return;
        const current = await this.activeStackedMonthsForTenant(tenantId);
        if (current + addMonths > cfg.maxStackedMonthsPerTenant) {
            throw new BadRequestException({
                error: 'stacking_cap_reached',
                message: `This tenant already has ${current} gifted month(s); the cap is ${cfg.maxStackedMonthsPerTenant}.`,
            });
        }
    }
}
