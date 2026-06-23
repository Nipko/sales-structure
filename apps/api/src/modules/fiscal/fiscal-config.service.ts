import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { FiscalMode, IvaTreatment } from './interfaces/fiscal-provider.interface';

/**
 * Issuer (the entity that issues the invoice) for the US_REMOTE mode.
 * In CO_LOCAL mode the issuer is the account configured at Factus (the NIT that
 * owns the numbering resolution), so we don't duplicate it here.
 */
export interface UsIssuerConfig {
    legalName?: string;
    taxId?: string;
    address?: string;
    email?: string;
}

/**
 * Issuer fiscal data for the CO_LOCAL mode (Parallly's own data). Factus holds
 * the legal source of truth for the OFFICIAL document, but the BRANDED graphic
 * representation needs these to print Parallly's NIT, address, regime and the
 * DIAN numbering resolution. Editable from the super admin.
 */
export interface CoIssuerConfig {
    legalName?: string; // razón social DIAN (ej. 'Parallext SAS')
    nit?: string;
    address?: string;
    email?: string;
    phone?: string;
    regime?: string; // 'Responsable de IVA' | 'No responsable de IVA'
    dianResolution?: string; // número + fecha de la resolución de numeración
    authRange?: string; // rango autorizado (prefijo + desde-hasta)
    resolutionValidUntil?: string; // vigencia
}

/**
 * Global fiscal configuration, editable from the super admin without redeploy.
 * Persisted in the shared `platform_settings` table under the `fiscal.*`
 * namespace (same store + raw-SQL pattern as SettingsService) and cached in
 * Redis. Factus API credentials live in env vars (secrets), NOT here.
 */
export interface FiscalConfig {
    /** CO_LOCAL = SAS Colombia issues DIAN FEV (default). US_REMOTE = LLC issues, no FEV. */
    mode: FiscalMode;
    /** How the IVA line is built for CO invoices (cloud computing default: excluido). */
    coIvaTreatment: IvaTreatment;
    /** Informational env label for Factus ('sandbox' | 'production'). Base URL comes from env. */
    factusEnvironment: string;
    /** Factus numbering_range_id for the active "Factura de Venta" range (required to issue). */
    factusNumberingRangeId: string | null;
    /** Factus numbering_range_id for the active "Nota Crédito" range (optional; inferred if single). */
    factusCreditNumberingRangeId: string | null;
    /** Catalog defaults for the subscription line item (legacy "internal IDs" contract). */
    defaultUnitMeasureId: string;
    defaultStandardCodeId: string;
    defaultProductTributeId: string;
    /**
     * Catalog defaults for the CURRENT Factus "codes" contract (bills/validate
     * validates these, not the *_id fields above):
     *  - unit_measure_code: DIAN unit-of-measure code (94 = unidad, 70 = ...).
     *  - standard_code: UNSPSC code of the product/service ("código estándar").
     */
    defaultUnitMeasureCode: string;
    defaultStandardCode: string;
    /** Fallback municipality_id when the acquirer has none. */
    defaultMunicipalityId: string | null;
    /** Invoice line item: base description (plan name is appended) and SKU/code. */
    itemDescription: string;
    itemCodeReference: string;
    /** Issuer details for US_REMOTE mode. */
    usIssuer: UsIssuerConfig;
    /** Issuer fiscal data for CO_LOCAL mode (printed on the branded representation). */
    coIssuer: CoIssuerConfig;
}

const DEFAULTS: FiscalConfig = {
    mode: 'CO_LOCAL',
    coIvaTreatment: 'excluido',
    factusEnvironment: 'sandbox',
    factusNumberingRangeId: null,
    factusCreditNumberingRangeId: null,
    defaultUnitMeasureId: '70', // 'unidad'
    defaultStandardCodeId: '1', // adopción del contribuyente
    defaultProductTributeId: '1', // IVA (product tribute)
    defaultUnitMeasureCode: '94', // 'unidad' (catálogo DIAN, contrato por códigos)
    defaultStandardCode: '999', // genérico — reemplazar por el UNSPSC real del servicio

    defaultMunicipalityId: null,
    itemDescription: 'Suscripción Parallly',
    itemCodeReference: 'PARALLLY-SUB',
    usIssuer: {},
    coIssuer: {},
};

@Injectable()
export class FiscalConfigService {
    private readonly logger = new Logger(FiscalConfigService.name);
    private readonly CACHE_KEY = 'fiscal:config';
    private readonly CACHE_TTL = 300; // 5 minutes

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    /** Read the effective fiscal config (cache → DB → defaults). */
    async getConfig(): Promise<FiscalConfig> {
        const cached = await this.redis.getJson<FiscalConfig>(this.CACHE_KEY);
        if (cached) return cached;

        // $queryRaw is typed loosely (any[]) like the platform SettingsService —
        // values are coerced to string so the rest of the config is well-typed.
        const rows = await this.prisma.$queryRaw<any[]>`
            SELECT key, value FROM platform_settings WHERE key LIKE 'fiscal.%'
        `;
        const map = new Map<string, string>(rows.map((r: any) => [String(r.key), String(r.value)]));
        const get = (k: string): string | undefined => {
            const v = map.get(k);
            return v && v.trim() !== '' ? v : undefined;
        };

        let usIssuer: UsIssuerConfig = {};
        const rawIssuer = get('fiscal.issuer_us');
        if (rawIssuer) {
            try {
                usIssuer = JSON.parse(rawIssuer);
            } catch {
                this.logger.warn('fiscal.issuer_us is not valid JSON — ignoring');
            }
        }

        let coIssuer: CoIssuerConfig = {};
        const rawCoIssuer = get('fiscal.issuer_co');
        if (rawCoIssuer) {
            try {
                coIssuer = JSON.parse(rawCoIssuer);
            } catch {
                this.logger.warn('fiscal.issuer_co is not valid JSON — ignoring');
            }
        }

        const mode = (get('fiscal.mode') as FiscalMode) || DEFAULTS.mode;
        const coIvaTreatment = (get('fiscal.co_iva_treatment') as IvaTreatment) || DEFAULTS.coIvaTreatment;

        const config: FiscalConfig = {
            mode: mode === 'US_REMOTE' ? 'US_REMOTE' : 'CO_LOCAL',
            coIvaTreatment: coIvaTreatment === 'gravado_19' ? 'gravado_19' : 'excluido',
            factusEnvironment: get('fiscal.factus_environment') || DEFAULTS.factusEnvironment,
            factusNumberingRangeId: get('fiscal.factus_numbering_range_id') ?? DEFAULTS.factusNumberingRangeId,
            factusCreditNumberingRangeId:
                get('fiscal.factus_credit_numbering_range_id') ?? DEFAULTS.factusCreditNumberingRangeId,
            defaultUnitMeasureId: get('fiscal.default_unit_measure_id') || DEFAULTS.defaultUnitMeasureId,
            defaultStandardCodeId: get('fiscal.default_standard_code_id') || DEFAULTS.defaultStandardCodeId,
            defaultProductTributeId: get('fiscal.default_product_tribute_id') || DEFAULTS.defaultProductTributeId,
            defaultUnitMeasureCode: get('fiscal.default_unit_measure_code') || DEFAULTS.defaultUnitMeasureCode,
            defaultStandardCode: get('fiscal.default_standard_code') || DEFAULTS.defaultStandardCode,
            defaultMunicipalityId: get('fiscal.default_municipality_id') ?? DEFAULTS.defaultMunicipalityId,
            itemDescription: get('fiscal.item_description') || DEFAULTS.itemDescription,
            itemCodeReference: get('fiscal.item_code_reference') || DEFAULTS.itemCodeReference,
            usIssuer,
            coIssuer,
        };

        await this.redis.setJson(this.CACHE_KEY, config, this.CACHE_TTL);
        return config;
    }

    /**
     * Update one or more fiscal config keys. Accepts a partial FiscalConfig and
     * maps it onto the flat `fiscal.*` keys, then invalidates the cache.
     */
    async updateConfig(patch: Partial<FiscalConfig>): Promise<void> {
        const updates: Record<string, string> = {};
        if (patch.mode) updates['fiscal.mode'] = patch.mode;
        if (patch.coIvaTreatment) updates['fiscal.co_iva_treatment'] = patch.coIvaTreatment;
        if (patch.factusEnvironment) updates['fiscal.factus_environment'] = patch.factusEnvironment;
        if (patch.factusNumberingRangeId !== undefined)
            updates['fiscal.factus_numbering_range_id'] = patch.factusNumberingRangeId ?? '';
        if (patch.factusCreditNumberingRangeId !== undefined)
            updates['fiscal.factus_credit_numbering_range_id'] = patch.factusCreditNumberingRangeId ?? '';
        if (patch.defaultUnitMeasureId) updates['fiscal.default_unit_measure_id'] = patch.defaultUnitMeasureId;
        if (patch.defaultStandardCodeId) updates['fiscal.default_standard_code_id'] = patch.defaultStandardCodeId;
        if (patch.defaultProductTributeId) updates['fiscal.default_product_tribute_id'] = patch.defaultProductTributeId;
        if (patch.defaultUnitMeasureCode) updates['fiscal.default_unit_measure_code'] = patch.defaultUnitMeasureCode;
        if (patch.defaultStandardCode) updates['fiscal.default_standard_code'] = patch.defaultStandardCode;
        if (patch.defaultMunicipalityId !== undefined)
            updates['fiscal.default_municipality_id'] = patch.defaultMunicipalityId ?? '';
        if (patch.itemDescription) updates['fiscal.item_description'] = patch.itemDescription;
        if (patch.itemCodeReference) updates['fiscal.item_code_reference'] = patch.itemCodeReference;
        if (patch.usIssuer) updates['fiscal.issuer_us'] = JSON.stringify(patch.usIssuer);
        if (patch.coIssuer) updates['fiscal.issuer_co'] = JSON.stringify(patch.coIssuer);

        for (const [key, value] of Object.entries(updates)) {
            await this.prisma.$executeRaw`
                INSERT INTO platform_settings (key, value, category, updated_at)
                VALUES (${key}, ${value}, 'fiscal', NOW())
                ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
            `;
        }

        await this.redis.del(this.CACHE_KEY);
        this.logger.log(`Updated ${Object.keys(updates).length} fiscal settings`);
    }
}
