import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';

const MP_API = 'https://api.mercadopago.com';
const CACHE_TTL_SEC = 300;

export interface TenantPaymentConfig {
    provider: 'mercadopago';
    /** Enmascarado al leer; sólo se guarda cifrado. */
    accessToken?: string;
    publicKey?: string;
    connected: boolean;
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

/**
 * Cobros del tenant a SU cliente final.
 *
 * Toda la infraestructura de MercadoPago que ya existía cobra con las
 * credenciales de la PLATAFORMA: sirve para cobrarle la suscripción al tenant,
 * no para que el tenant le cobre a su cliente. Por eso la seña anti-no-show, el
 * anticipo de un tour, la matrícula de un curso y el pedido pago de un
 * restaurante quedaban con el circuito de dinero cortado — las columnas
 * `payment_status` existen en pedidos, tours e inscripciones y no las escribía
 * nadie.
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
            publicKey: cfg.publicKey || undefined,
            accountEmail: cfg.accountEmail || undefined,
            accessToken: cfg.accessTokenEnc ? '***' : undefined,
        };
    }

    /**
     * Guarda las credenciales del tenant.
     *
     * VERIFICA contra MercadoPago antes de guardar. Sin eso, un token mal pegado
     * se descubre recién cuando un cliente real intenta pagar y el link no
     * existe — o sea, en el peor momento posible y sin que el dueño se entere.
     */
    async setConfig(tenantId: string, input: { accessToken?: string; publicKey?: string }): Promise<TenantPaymentConfig> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        if (!tenant) throw new BadRequestException('Tenant not found');
        const settings = (tenant.settings as any) || {};
        const current = settings.tenantPayments || {};

        let accessTokenEnc = current.accessTokenEnc;
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

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    ...settings,
                    tenantPayments: {
                        provider: 'mercadopago',
                        accessTokenEnc,
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

    async isConfigured(tenantId: string): Promise<boolean> {
        return !!(await this.getAccessToken(tenantId));
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
        },
    ): Promise<PaymentLink> {
        const token = await this.getAccessToken(tenantId);
        if (!token) {
            throw new BadRequestException({
                error: 'payments_not_configured',
                message: 'Este negocio todavía no conectó su cuenta de MercadoPago para cobrar.',
            });
        }
        if (!input.amountCents || input.amountCents <= 0) {
            throw new BadRequestException({ error: 'invalid_amount' });
        }

        const currency = (input.currency || 'COP').toUpperCase();
        // COP y CLP no tienen decimales: MercadoPago espera el monto en unidades
        // enteras, y mandarle 90000.00 en vez de 90000 hace que rechace o
        // redondee sin avisar.
        const zeroDecimal = ['COP', 'CLP', 'PYG', 'JPY', 'KRW', 'VND', 'ISK'].includes(currency);
        const unitPrice = zeroDecimal ? Math.round(input.amountCents / 100) : input.amountCents / 100;

        const res = await fetch(`${MP_API}/checkout/preferences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
                notification_url: `${(process.env.API_PUBLIC_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/v1\/?$/, '')}/api/v1/tenant-payments/webhook/${tenantId}`,
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
        return {
            id: String(data.id),
            url: data.init_point || data.sandbox_init_point,
            amountCents: input.amountCents,
            currency,
            description: input.description,
        };
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
