import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/** A purchasable SMS credit tier. priceCents is in minor units of `currency`. */
export interface SmsPackage {
    id: string; // kebab-case slug, stable
    name: string;
    credits: number; // 1 credit = 1 Twilio message segment
    priceCents: number; // minor units of `currency` (e.g. COP → pesos*100)
    currency: string; // COP | USD | ...
    active: boolean;
    highlight?: boolean; // "most popular" flag for UI
}

export interface SmsPackagesConfig {
    /**
     * Master kill switch for the whole reseller model (super admin). OFF by default:
     * while the platform's per-SMS cost can't be priced competitively, no tenant can
     * buy credits and no metered send goes out — so the platform never fronts a cost
     * it can't recover. Balances and ledger are preserved across toggles.
     */
    enabled?: boolean;
    senderId?: string; // platform sender override for notification SMS
    packages: SmsPackage[];
}

/**
 * Proposed default tiers (editable in /admin). Prices are placeholders — the real
 * Twilio-CO cost (~160–240 COP/SMS) must be validated to guarantee margin.
 */
const DEFAULT_PACKAGES: SmsPackage[] = [
    { id: 'inicial', name: 'Inicial', credits: 500, priceCents: 9_000_000, currency: 'COP', active: true },
    { id: 'pro', name: 'Pro', credits: 2000, priceCents: 32_000_000, currency: 'COP', active: true, highlight: true },
    { id: 'masivo', name: 'Masivo', credits: 10000, priceCents: 140_000_000, currency: 'COP', active: true },
];

/** Currencies with no minor unit — amounts are charged as whole main units. */
const ZERO_DECIMAL_CURRENCIES = new Set(['COP', 'CLP', 'PYG', 'JPY', 'KRW', 'VND', 'ISK']);

type LedgerReason = 'purchase' | 'consumption' | 'adjustment' | 'refund';

/**
 * Owns the prepaid SMS credit balance + ledger and the package-tier config.
 * Balance mutations are atomic (single UPDATE ... RETURNING with a WHERE guard),
 * so concurrent sends can never drive the balance negative. All tables are global
 * (public schema) → Prisma client / tagged-template raw with ::uuid casts.
 */
@Injectable()
export class SmsCreditsService {
    private readonly logger = new Logger(SmsCreditsService.name);
    private readonly PACKAGES_KEY = 'sms.packages'; // platform_settings key
    private readonly CACHE_KEY = 'sms:packages:config';
    private readonly CACHE_TTL = 300; // 5 min

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    // ---------------------------------------------------------------- packages

    /** Full package config (senderId + all tiers incl. inactive). Cached 5 min. */
    async getConfig(): Promise<SmsPackagesConfig> {
        const cached = await this.redis.getJson<SmsPackagesConfig>(this.CACHE_KEY);
        if (cached) return cached;

        let config: SmsPackagesConfig = { enabled: false, packages: DEFAULT_PACKAGES };
        try {
            const rows = await this.prisma.$queryRaw<{ value: string }[]>`
                SELECT value FROM platform_settings WHERE key = ${this.PACKAGES_KEY} LIMIT 1`;
            if (rows.length && rows[0].value) {
                const parsed = JSON.parse(rows[0].value);
                if (parsed && Array.isArray(parsed.packages)) config = parsed;
            }
        } catch (e: any) {
            this.logger.warn(`Failed to read sms.packages config: ${e.message}`);
        }
        await this.redis.setJson(this.CACHE_KEY, config, this.CACHE_TTL);
        return config;
    }

    /** True when the super admin has switched the reseller model on. */
    async isEnabled(): Promise<boolean> {
        const { enabled } = await this.getConfig();
        return enabled === true;
    }

    /**
     * Active tiers for the tenant purchase UI. Returns [] while the model is off,
     * which is what makes the tenant-facing "Créditos SMS" section disappear.
     * `includeInactive` (super admin) ignores the switch so tiers stay editable.
     */
    async getPackages(includeInactive = false): Promise<SmsPackage[]> {
        const { packages, enabled } = await this.getConfig();
        if (includeInactive) return packages;
        if (enabled !== true) return [];
        return packages.filter((p) => p.active);
    }

    async getPackage(id: string): Promise<SmsPackage | null> {
        const { packages } = await this.getConfig();
        return packages.find((p) => p.id === id) ?? null;
    }

    /** Persist the tier config (super admin). Validates every tier. */
    async setConfig(config: SmsPackagesConfig): Promise<SmsPackagesConfig> {
        const packages = Array.isArray(config.packages) ? config.packages : [];
        const seen = new Set<string>();
        for (const p of packages) {
            if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) throw new Error(`Paquete con id inválido: ${p.id}`);
            if (seen.has(p.id)) throw new Error(`Paquete duplicado: ${p.id}`);
            seen.add(p.id);
            if (!p.name?.trim()) throw new Error(`El paquete ${p.id} necesita nombre`);
            if (!Number.isInteger(p.credits) || p.credits <= 0) throw new Error(`El paquete ${p.id} necesita créditos > 0`);
            if (!Number.isInteger(p.priceCents) || p.priceCents <= 0) throw new Error(`El paquete ${p.id} necesita precio > 0`);
            if (!p.currency?.trim()) throw new Error(`El paquete ${p.id} necesita moneda`);
            // Zero-decimal currencies (COP, CLP, …) are charged in whole main units;
            // priceCents/100 must be an integer or the PSP rejects/rounds the amount.
            if (ZERO_DECIMAL_CURRENCIES.has(p.currency.trim().toUpperCase()) && p.priceCents % 100 !== 0) {
                throw new Error(`El paquete ${p.id}: para ${p.currency.toUpperCase()} (sin decimales) el precio debe ser múltiplo de 100`);
            }
        }
        const clean: SmsPackagesConfig = {
            enabled: config.enabled === true,
            senderId: config.senderId?.trim() || undefined,
            packages: packages.map((p) => ({
                id: p.id,
                name: p.name.trim(),
                credits: p.credits,
                priceCents: p.priceCents,
                currency: p.currency.trim().toUpperCase(),
                active: p.active !== false,
                highlight: !!p.highlight,
            })),
        };
        const value = JSON.stringify(clean);
        await this.prisma.$executeRaw`
            INSERT INTO platform_settings (key, value, category, updated_at)
            VALUES (${this.PACKAGES_KEY}, ${value}, 'sms', NOW())
            ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()`;
        await this.redis.del(this.CACHE_KEY);
        this.logger.log(`SMS package config updated (${clean.packages.length} tiers)`);
        return clean;
    }

    /** Platform sender for tenant notification SMS. Config override → null (caller falls back to env). */
    async getSenderId(): Promise<string | undefined> {
        const { senderId } = await this.getConfig();
        return senderId;
    }

    // ---------------------------------------------------------------- balance

    async getBalance(tenantId: string): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ balance_credits: number }[]>`
            SELECT balance_credits FROM sms_credit_balances WHERE tenant_id = ${tenantId}::uuid LIMIT 1`;
        return rows.length ? Number(rows[0].balance_credits) : 0;
    }

    /**
     * Atomically add credits and append a ledger row. Idempotent when `ref` is
     * given: if a ledger row with the same (reason, ref) exists, it's a no-op.
     * Returns the resulting balance.
     */
    async addCredits(
        tenantId: string,
        credits: number,
        reason: LedgerReason,
        ref?: string,
        metadata?: Record<string, any>,
    ): Promise<number> {
        if (!Number.isInteger(credits) || credits <= 0) throw new Error('credits must be a positive integer');

        // Increment + ledger insert run in ONE transaction. When `ref` is set, the
        // partial unique index (tenant_id, reason, ref) WHERE delta>0 makes the
        // ledger insert the atomic idempotency gate: a concurrent/duplicate grant
        // (e.g. MP payment.created + payment.updated for the same order) fails the
        // insert → the whole transaction rolls back → no double-credit.
        try {
            return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                const balanceId = randomUUID();
                const rows = await tx.$queryRaw<{ balance_credits: number }[]>`
                    INSERT INTO sms_credit_balances (id, tenant_id, balance_credits, created_at, updated_at)
                    VALUES (${balanceId}::uuid, ${tenantId}::uuid, ${credits}, NOW(), NOW())
                    ON CONFLICT (tenant_id) DO UPDATE
                        SET balance_credits = sms_credit_balances.balance_credits + ${credits}, updated_at = NOW()
                    RETURNING balance_credits`;
                const balanceAfter = Number(rows[0].balance_credits);
                await tx.smsCreditLedger.create({
                    data: { id: randomUUID(), tenantId, delta: credits, reason, ref: ref ?? null, balanceAfter, metadata: metadata ?? {} },
                });
                return balanceAfter;
            });
        } catch (e: any) {
            if (e?.code === 'P2002' || /unique|duplicate key/i.test(e?.message || '')) {
                this.logger.log(`addCredits idempotent skip ${reason}:${ref} (tenant ${tenantId})`);
                return this.getBalance(tenantId);
            }
            throw e;
        }
    }

    /**
     * Atomically consume credits IF the balance covers it (single guarded UPDATE).
     * Returns { ok:false } without mutating when the balance is insufficient.
     */
    async consume(
        tenantId: string,
        credits: number,
        reason: LedgerReason = 'consumption',
        ref?: string,
        metadata?: Record<string, any>,
    ): Promise<{ ok: boolean; balance: number }> {
        if (!Number.isInteger(credits) || credits <= 0) throw new Error('credits must be a positive integer');

        const rows = await this.prisma.$queryRaw<{ balance_credits: number }[]>`
            UPDATE sms_credit_balances
                SET balance_credits = balance_credits - ${credits}, updated_at = NOW()
            WHERE tenant_id = ${tenantId}::uuid AND balance_credits >= ${credits}
            RETURNING balance_credits`;

        if (!rows.length) {
            return { ok: false, balance: await this.getBalance(tenantId) };
        }
        const balanceAfter = Number(rows[0].balance_credits);
        await this.prisma.smsCreditLedger.create({
            data: { id: randomUUID(), tenantId, delta: -credits, reason, ref: ref ?? null, balanceAfter, metadata: metadata ?? {} },
        });
        return { ok: true, balance: balanceAfter };
    }

    /** Super-admin manual adjustment (signed). Floors at 0; never negative. */
    async adjust(tenantId: string, delta: number, reason: string, adminUserId?: string): Promise<number> {
        if (!Number.isInteger(delta) || delta === 0) throw new Error('delta must be a non-zero integer');
        const note = { adminReason: reason, adminUserId };
        if (delta > 0) return this.addCredits(tenantId, delta, 'adjustment', `adj:${randomUUID()}`, note);

        // negative adjustment: clamp to available balance
        const current = await this.getBalance(tenantId);
        const take = Math.min(current, -delta);
        if (take <= 0) return current;
        const res = await this.consume(tenantId, take, 'adjustment', `adj:${randomUUID()}`, note);
        return res.balance;
    }

    // ---------------------------------------------------------------- reads

    async listLedger(tenantId: string, limit = 50): Promise<any[]> {
        return this.prisma.smsCreditLedger.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: Math.min(Math.max(limit, 1), 200),
        });
    }

    /** Aggregate totals for the tenant usage UI. */
    async getConsumption(tenantId: string): Promise<{
        balance: number;
        purchased: number;
        consumed: number;
        consumedThisMonth: number;
        /**
         * El interruptor maestro de la plataforma. Viaja acá porque el
         * dashboard necesita saber si mostrar SMS COMO CANAL, no sólo si
         * mostrar el saldo: sin esto el tenant podía comprar créditos y no
         * tener ninguna pantalla donde gastarlos — vender un saldo inutilizable.
         */
        enabled: boolean;
    }> {
        const balance = await this.getBalance(tenantId);
        const enabled = await this.isEnabled().catch(() => false);
        const rows = await this.prisma.$queryRaw<
            { purchased: number; consumed: number; consumed_month: number }[]
        >`
            SELECT
                COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS purchased,
                COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS consumed,
                COALESCE(SUM(CASE WHEN delta < 0 AND created_at >= date_trunc('month', NOW()) THEN -delta ELSE 0 END), 0) AS consumed_month
            FROM sms_credit_ledger WHERE tenant_id = ${tenantId}::uuid`;
        const r = rows[0] || ({} as any);
        return {
            balance,
            purchased: Number(r.purchased || 0),
            consumed: Number(r.consumed || 0),
            consumedThisMonth: Number(r.consumed_month || 0),
            enabled,
        };
    }

    /** Super-admin: all tenant balances (with tenant name), highest first. */
    async listBalances(): Promise<any[]> {
        return this.prisma.$queryRaw<any[]>`
            SELECT b.tenant_id, t.name AS tenant_name, t.slug, b.balance_credits, b.updated_at
            FROM sms_credit_balances b
            JOIN tenants t ON t.id = b.tenant_id
            ORDER BY b.balance_credits DESC
            LIMIT 500`;
    }
}
