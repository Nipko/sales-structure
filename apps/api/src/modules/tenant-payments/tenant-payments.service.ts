import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';

const MP_API = 'https://api.mercadopago.com';

export interface TenantPaymentConfig {
    provider: 'mercadopago';
    /** Enmascarado al leer; sólo se guarda cifrado. */
    accessToken?: string;
    webhookSecret?: string;
    publicKey?: string;
    connected: boolean;
    webhookConfigured: boolean;
    /** Verificado contra MercadoPago la última vez que se guardó. */
    accountEmail?: string;
}

export interface PaymentLink {
    id: string;
    url: string;
    amountCents: number;
    currency: string;
    description: string;
}

export interface OwnedPaymentReference {
    canonicalReference: string;
    amountCents: number;
    currency: string;
}

const PAYMENT_REFERENCE_TARGETS: Record<string, {
    table: 'orders' | 'tour_bookings' | 'food_orders' | 'enrollments';
    amountExpression: string;
    currencyExpression: string;
}> = {
    order: { table: 'orders', amountExpression: 'target.total_amount', currencyExpression: 'target.currency' },
    tour: { table: 'tour_bookings', amountExpression: 'target.total_price', currencyExpression: 'target.currency' },
    food: { table: 'food_orders', amountExpression: 'target.total', currencyExpression: 'target.currency' },
    enrollment: {
        table: 'enrollments',
        amountExpression: 'course.price',
        currencyExpression: 'course.currency',
    },
};

/**
 * Cobros del tenant a SU cliente final.
 *
 * Mercado Pago fue retirado por completo del cobro de suscripciones de la
 * PLATAFORMA. Este módulo no comparte credenciales, webhooks ni adaptadores con
 * billing: existe solamente para que el tenant cobre a su propio cliente. Por
 * eso conecta la seña anti-no-show, el anticipo de un tour, la matrícula de un
 * curso y el pedido de un restaurante con las columnas `payment_status` que ya
 * existían dentro de su esquema.
 *
 * MODELO ELEGIDO (decisión de agosto 2026): token del tenant, cifrado. Cada
 * tenant carga sus propias credenciales de MercadoPago y el dinero va DIRECTO a
 * su cuenta; la plataforma no toca esa plata en ningún momento.
 *
 * La alternativa era marketplace/split — el pago pasa por la cuenta de la
 * plataforma y se reparte, lo que habilitaría comisión por transacción. Se
 * descartó a propósito: convierte a la plataforma en intermediario financiero,
 * con los requisitos de MercadoPago, la exposición fiscal y la responsabilidad
 * sobre contracargos que eso implica. Acá el tenant cobra y factura como
 * siempre; nosotros sólo generamos el link.
 *
 * El token se cifra con el mismo servicio que ya protege los tokens de canal
 * (AES-256-GCM con ENCRYPTION_KEY) y nunca vuelve al frontend: se devuelve
 * enmascarado.
 */
@Injectable()
export class TenantPaymentsService {
    private readonly logger = new Logger(TenantPaymentsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly crypto: WhatsappCryptoService,
    ) {}

    private cacheKey(tenantId: string) { return `tenant_payments:${tenantId}`; }

    /** Config enmascarada, para la UI. Nunca devuelve el token. */
    async getConfig(tenantId: string): Promise<TenantPaymentConfig> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const cfg = (tenant?.settings as any)?.tenantPayments || {};
        return {
            provider: 'mercadopago',
            connected: !!cfg.accessTokenEnc,
            webhookConfigured: !!cfg.webhookSecretEnc,
            publicKey: cfg.publicKey || undefined,
            accountEmail: cfg.accountEmail || undefined,
            accessToken: cfg.accessTokenEnc ? '***' : undefined,
            webhookSecret: cfg.webhookSecretEnc ? '***' : undefined,
        };
    }

    /**
     * Guarda las credenciales del tenant.
     *
     * VERIFICA contra MercadoPago antes de guardar. Sin eso, un token mal pegado
     * se descubre recién cuando un cliente real intenta pagar y el link no
     * existe — o sea, en el peor momento posible y sin que el dueño se entere.
     */
    async setConfig(
        tenantId: string,
        input: { accessToken?: string; publicKey?: string; webhookSecret?: string },
    ): Promise<TenantPaymentConfig> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        if (!tenant) throw new BadRequestException('Tenant not found');
        const settings = (tenant.settings as any) || {};
        const current = settings.tenantPayments || {};

        let accessTokenEnc = current.accessTokenEnc;
        let webhookSecretEnc = current.webhookSecretEnc;
        let accountEmail = current.accountEmail;

        // '***' = el frontend devolvió el valor enmascarado sin tocarlo.
        if (input.accessToken && input.accessToken !== '***') {
            const check = await this.verifyToken(input.accessToken);
            if (!check.ok) {
                throw new BadRequestException({
                    error: 'invalid_mp_credentials',
                    message: 'MercadoPago rechazó ese access token. Verificá que sea el de producción de tu cuenta.',
                });
            }
            accessTokenEnc = this.crypto.encryptToken(input.accessToken);
            accountEmail = check.email;
        }
        if (input.webhookSecret && input.webhookSecret !== '***') {
            const secret = input.webhookSecret.trim();
            if (secret.length < 16 || secret.length > 512) {
                throw new BadRequestException({
                    error: 'invalid_mp_webhook_secret',
                    message: 'La clave secreta de Webhooks de Mercado Pago no tiene un formato válido.',
                });
            }
            webhookSecretEnc = this.crypto.encryptToken(secret);
        }

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    ...settings,
                    tenantPayments: {
                        provider: 'mercadopago',
                        accessTokenEnc,
                        webhookSecretEnc,
                        publicKey: input.publicKey ?? current.publicKey,
                        accountEmail,
                    },
                } as any,
            },
        });
        await this.redis.del(this.cacheKey(tenantId)).catch(() => {});
        this.logger.log(`Credenciales de cobro guardadas para el tenant ${tenantId}${accountEmail ? ` (${accountEmail})` : ''}`);
        return this.getConfig(tenantId);
    }

    async disconnect(tenantId: string): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        if (!tenant) return;
        const settings = (tenant.settings as any) || {};
        delete settings.tenantPayments;
        await this.prisma.tenant.update({ where: { id: tenantId }, data: { settings } });
        await this.redis.del(this.cacheKey(tenantId)).catch(() => {});
    }

    /** El token descifrado, sólo para uso interno. */
    private async getAccessToken(tenantId: string): Promise<string | null> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const enc = (tenant?.settings as any)?.tenantPayments?.accessTokenEnc;
        if (!enc) return null;
        try {
            return this.crypto.decryptToken(enc);
        } catch (e: any) {
            // Pasa si rotó ENCRYPTION_KEY. Decirlo claro: el síntoma sin esto es
            // "los cobros dejaron de funcionar" sin ninguna pista de por qué.
            this.logger.error(`No se pudo descifrar el token de cobro del tenant ${tenantId}: ${e.message}`);
            return null;
        }
    }

    /** Secreto HMAC del webhook; nunca se expone por controller. */
    async getWebhookSecret(tenantId: string): Promise<string | null> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const enc = (tenant?.settings as any)?.tenantPayments?.webhookSecretEnc;
        if (!enc) return null;
        try {
            return this.crypto.decryptToken(enc);
        } catch (e: any) {
            this.logger.error(`No se pudo descifrar la clave webhook de cobro del tenant ${tenantId}: ${e.message}`);
            return null;
        }
    }

    async isConfigured(tenantId: string): Promise<boolean> {
        return !!(await this.getAccessToken(tenantId));
    }

    /**
     * Resuelve únicamente objetos de compra que pertenecen al contacto actual.
     * Además devuelve el monto canónico para que el LLM no pueda inventarlo.
     */
    async resolveOwnedReference(
        tenantId: string,
        contactId: string,
        reference: string,
    ): Promise<OwnedPaymentReference | null> {
        const match = /^([a-z]+):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(reference.trim());
        if (!match) return null;
        const [, kind, entityId] = match;
        const target = PAYMENT_REFERENCE_TARGETS[kind.toLowerCase()];
        if (!target) return null;
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return null;

        const join = target.table === 'enrollments'
            ? 'JOIN courses course ON course.id = target.course_id'
            : '';
        try {
            const rows = await this.prisma.executeInTenantSchema<Array<{ amount: unknown; currency: string | null }>>(
                schemaName,
                `SELECT ${target.amountExpression} AS amount,
                        ${target.currencyExpression} AS currency
                   FROM ${target.table} target
                   ${join}
                  WHERE target.id = $1::uuid
                    AND target.contact_id = $2::uuid
                  LIMIT 1`,
                [entityId, contactId],
            );
            const row = rows[0];
            const amountMajor = Number(row?.amount);
            const amountCents = Math.round(amountMajor * 100);
            const currency = String(row?.currency || '').trim().toUpperCase();
            if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
            return {
                canonicalReference: `${kind.toLowerCase()}:${entityId.toLowerCase()}`,
                amountCents,
                currency,
            };
        } catch (e: any) {
            this.logger.warn(`No se pudo resolver ${reference} para el tenant ${tenantId}: ${e.message}`);
            return null;
        }
    }

    /**
     * Genera un link de pago con las credenciales DEL TENANT.
     *
     * `externalReference` es lo que después permite saber qué se pagó: se arma
     * como `{tipo}:{id}` (por ejemplo `appointment:<uuid>`) para que el webhook
     * pueda escribir el `payment_status` en la tabla correcta sin adivinar.
     */
    async createPaymentLink(
        tenantId: string,
        input: {
            amountCents: number;
            currency?: string;
            description: string;
            externalReference: string;
            payerEmail?: string;
            idempotencyKey?: string;
        },
    ): Promise<PaymentLink> {
        const token = await this.getAccessToken(tenantId);
        if (!token) {
            throw new BadRequestException({
                error: 'payments_not_configured',
                message: 'Este negocio todavía no conectó su cuenta de MercadoPago para cobrar.',
            });
        }
        if (!await this.getWebhookSecret(tenantId)) {
            throw new BadRequestException({
                error: 'mp_webhook_not_configured',
                message: 'Falta guardar la clave secreta de Webhooks de Mercado Pago antes de generar enlaces.',
            });
        }
        if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
            throw new BadRequestException({ error: 'invalid_amount' });
        }

        const currency = (input.currency || 'COP').toUpperCase();
        // COP y CLP no tienen decimales: MercadoPago espera el monto en unidades
        // enteras, y mandarle 90000.00 en vez de 90000 hace que rechace o
        // redondee sin avisar.
        const zeroDecimal = ['COP', 'CLP', 'PYG', 'JPY', 'KRW', 'VND', 'ISK'].includes(currency);
        if (zeroDecimal && input.amountCents % 100 !== 0) {
            throw new BadRequestException({ error: 'invalid_zero_decimal_amount' });
        }
        const unitPrice = input.amountCents / 100;
        const notificationUrl = this.notificationUrl(tenantId);

        const res = await fetch(`${MP_API}/checkout/preferences`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...(input.idempotencyKey ? { 'X-Idempotency-Key': input.idempotencyKey } : {}),
            },
            body: JSON.stringify({
                items: [{
                    title: input.description.slice(0, 250),
                    quantity: 1,
                    unit_price: unitPrice,
                    currency_id: currency,
                }],
                external_reference: input.externalReference,
                ...(input.payerEmail ? { payer: { email: input.payerEmail } } : {}),
                // El webhook llega a NUESTRA API, pero el pago es del tenant: lo
                // usamos sólo para marcar el estado, nunca para mover plata.
                notification_url: notificationUrl,
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            this.logger.warn(`MP preference falló para el tenant ${tenantId}: ${res.status} ${body.slice(0, 200)}`);
            throw new BadRequestException({
                error: 'payment_link_failed',
                message: 'No se pudo generar el link de pago. Revisá las credenciales de MercadoPago del negocio.',
            });
        }

        const data: any = await res.json();
        const id = String(data?.id || '').trim();
        const url = String(data?.init_point || data?.sandbox_init_point || '').trim();
        if (!id || !this.isHttpsUrl(url)) {
            throw new BadRequestException({ error: 'invalid_payment_link_response' });
        }
        if (input.idempotencyKey) {
            await this.redis.set(this.idempotencyKey(tenantId, input.idempotencyKey), id, 7 * 86400).catch(() => {});
        }
        return {
            id,
            url,
            amountCents: input.amountCents,
            currency,
            description: input.description,
        };
    }

    async findPaymentLinkByIdempotencyKey(tenantId: string, key: string): Promise<string | null> {
        return this.redis.get(this.idempotencyKey(tenantId, key)).catch(() => null);
    }

    async verifyPaymentLink(tenantId: string, preferenceId: string): Promise<boolean> {
        const token = await this.getAccessToken(tenantId);
        if (!token || !preferenceId) return false;
        try {
            const res = await fetch(`${MP_API}/checkout/preferences/${encodeURIComponent(preferenceId)}`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(15000),
            });
            if (!res.ok) return false;
            const data: any = await res.json();
            const url = String(data?.init_point || data?.sandbox_init_point || '').trim();
            return String(data?.id || '') === preferenceId && this.isHttpsUrl(url);
        } catch {
            return false;
        }
    }

    private idempotencyKey(tenantId: string, key: string): string {
        return `tenant_payment_link:idem:${tenantId}:${key}`;
    }

    private notificationUrl(tenantId: string): string {
        const rawBase = String(process.env.API_PUBLIC_URL || process.env.NEXT_PUBLIC_API_URL || '')
            .trim()
            .replace(/\/api\/v1\/?$/, '');
        try {
            const base = new URL(rawBase);
            const local = ['localhost', '127.0.0.1', '::1'].includes(base.hostname);
            if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) throw new Error('https_required');
            return new URL(`/api/v1/tenant-payments/webhook/${tenantId}`, base).toString();
        } catch {
            throw new BadRequestException({
                error: 'payment_webhook_url_not_configured',
                message: 'API_PUBLIC_URL debe ser una URL HTTPS válida para recibir confirmaciones de pago.',
            });
        }
    }

    private isHttpsUrl(value: string): boolean {
        try { return new URL(value).protocol === 'https:'; } catch { return false; }
    }

    /** Le pregunta a MercadoPago de quién es este token. */
    private async verifyToken(accessToken: string): Promise<{ ok: boolean; email?: string }> {
        try {
            const res = await fetch(`${MP_API}/users/me`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(15000),
            });
            if (!res.ok) return { ok: false };
            const data: any = await res.json();
            return { ok: true, email: data?.email };
        } catch {
            return { ok: false };
        }
    }
}
