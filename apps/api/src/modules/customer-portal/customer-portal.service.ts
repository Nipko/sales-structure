import { Injectable, Logger, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { cpmsg } from './customer-portal-i18n';
import { SmsSenderService } from '../sms-notifications/sms-sender.service';
import { EmailService } from '../email/email.service';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import { RegionalProfileService } from '../tenants/regional-profile.service';

@Injectable()
export class CustomerPortalService {
    private readonly logger = new Logger(CustomerPortalService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly jwt: JwtService,
        private readonly config: ConfigService,
        private readonly smsSender: SmsSenderService,
        private readonly emailService: EmailService,
        private readonly regionalProfile: RegionalProfileService,
    ) {}

    // ---- Helpers ----

    /**
     * Resolve the tenant schema name from tenantId (cached in Redis).
     */
    private async getSchemaName(tenantId: string): Promise<string> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });

        if (!tenant) {
            throw new NotFoundException(`Tenant ${tenantId} not found`);
        }

        await this.redis.set(`tenant:${tenantId}:schema`, tenant.schemaName, 600);
        return tenant.schemaName;
    }

    /**
     * Resolve the tenant preferred language (cached in Redis alongside schema).
     * Returns the raw value stored on the tenant row (e.g. "es-CO", "en").
     * cpmsg() normalises it to 2 chars internally.
     */
    private async getTenantLanguage(tenantId: string): Promise<string> {
        const cached = await this.redis.get(`tenant:${tenantId}:lang`);
        if (cached) return cached;

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { language: true },
        });

        const lang = tenant?.language ?? 'es';
        await this.redis.set(`tenant:${tenantId}:lang`, lang, 600);
        return lang;
    }

    /**
     * Generate a 6-digit numeric verification code.
     */
    private generateCode(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /**
     * Build the Redis key for a portal verification code.
     */
    private codeKey(tenantId: string, identifier: string): string {
        return `portal:code:${tenantId}:${identifier}`;
    }

    /**
     * Verify the X-Portal-Token header and return the decoded payload.
     */
    async verifyPortalToken(token: string): Promise<{ sub: string; tenantId: string; type: string }> {
        try {
            const payload = this.jwt.verify(token);
            if (payload.type !== 'customer') {
                throw new UnauthorizedException('Invalid portal token type');
            }
            return payload;
        } catch (error) {
            throw new UnauthorizedException('Invalid or expired portal token');
        }
    }

    // ---- Request Access (Magic Link) ----

    /**
     * Generate a verification code for the customer, store in Redis, and
     * return the code. The controller/caller is responsible for dispatching
     * the code via WhatsApp or email.
     */
    async requestAccess(
        tenantId: string,
        body: { phone?: string; email?: string },
        ip?: string,
    ): Promise<{ identifier: string; channel: 'sms' | 'email' }> {
        const [schema, lang] = await Promise.all([
            this.getSchemaName(tenantId),
            this.getTenantLanguage(tenantId),
        ]);

        const identifier = body.phone || body.email;
        if (!identifier) {
            throw new BadRequestException('Either phone or email is required');
        }

        const channel: 'sms' | 'email' = body.phone ? 'sms' : 'email';

        // Rate limit this public endpoint (atomic INCR+EXPIRE) by identifier and
        // by IP, to stop contact enumeration and code/SMS bombing.
        const idCount = await this.redis.incrementRateLimit(`ratelimit:portal:id:${tenantId}:${identifier}`, 3600);
        if (idCount > 3) throw new BadRequestException(cpmsg(lang, 'auth.tooManyRequests'));
        if (ip) {
            const ipCount = await this.redis.incrementRateLimit(`ratelimit:portal:ip:${ip}`, 3600);
            if (ipCount > 10) throw new BadRequestException(cpmsg(lang, 'auth.tooManyRequests'));
        }

        // Verify the contact exists in the tenant schema
        const whereClause = body.phone
            ? `phone = $1`
            : `email = $1`;

        const contacts = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id FROM contacts WHERE ${whereClause} AND is_active = true LIMIT 1`,
            [identifier],
        );

        // Generate+store the code ONLY when the contact exists, but ALWAYS return
        // the same generic response so callers can't tell whether a phone/email is
        // a registered contact (enumeration). Delivery is handled by the caller.
        if (contacts && contacts.length > 0) {
            const code = this.generateCode();
            const redisKey = this.codeKey(tenantId, identifier);
            await this.redis.set(redisKey, JSON.stringify({
                code,
                contactId: contacts[0].id,
                attempts: 0,
            }), 600); // 10 minutes
            this.logger.log(`Portal access code generated for ${channel}:${identifier} in tenant ${tenantId}`);
            // Fire-and-forget: do NOT await. The response must take the same time
            // whether or not the contact exists, or the latency difference becomes
            // an enumeration oracle (defeating the generic-response guarantee above).
            // dispatchCode swallows its own errors, so it never rejects.
            void this.dispatchCode(tenantId, channel, identifier, code, lang);
        } else {
            this.logger.warn(`Portal access requested for unknown ${channel} in tenant ${tenantId} — generic response`);
        }

        return { identifier, channel };
    }

    /**
     * Deliver the portal verification code to the customer. SMS goes through the
     * tenant's own Twilio number (SmsSenderService); email through EmailService.
     * Best-effort and swallowed — the caller always returns a generic response so
     * a delivery failure can't be used to probe which contacts exist.
     *
     * NOTE: WhatsApp-first OTP is intentionally not wired here. Proactively sending
     * a code over WhatsApp requires a Meta-approved Authentication message template
     * per tenant; until that exists, phone codes go over SMS. The hook lives here.
     */
    private async dispatchCode(tenantId: string, channel: 'sms' | 'email', identifier: string, code: string, lang: string): Promise<void> {
        const message = cpmsg(lang, 'auth.codeMessage').replace('{code}', code);
        try {
            if (channel === 'sms') {
                // Sin país del tenant no se reescribe el número: se manda tal
                // como lo escribió el cliente. Un `+57` inventado manda el
                // código a un teléfono que no es suyo.
                const region = await this.regionalProfile.phoneRegionFor(tenantId);
                const to = normalizePhoneE164(identifier, region) || identifier;
                const sent = await this.smsSender.sendToNumber(tenantId, to, message);
                if (!sent) this.logger.warn(`Portal SMS code not delivered for tenant ${tenantId} (SMS channel connected?)`);
            } else {
                await this.emailService.send({
                    to: identifier,
                    subject: cpmsg(lang, 'auth.codeSubject'),
                    html: `<p style="font-size:16px;font-family:sans-serif">${message}</p>`,
                });
            }
        } catch (e: any) {
            this.logger.warn(`Portal code dispatch failed for tenant ${tenantId}: ${e.message}`);
        }
    }

    // ---- Verify Code & Issue JWT ----

    /**
     * Verify the 6-digit code and issue a short-lived customer JWT.
     */
    async verifyCode(
        tenantId: string,
        body: { code: string; phone?: string; email?: string },
    ): Promise<{ token: string; expiresIn: string; contactId: string }> {
        const identifier = body.phone || body.email;
        if (!identifier) {
            throw new BadRequestException('Either phone or email is required');
        }
        if (!body.code || body.code.length !== 6) {
            throw new BadRequestException('A valid 6-digit code is required');
        }

        const [redisKey, lang] = [
            this.codeKey(tenantId, identifier),
            await this.getTenantLanguage(tenantId),
        ];
        const stored = await this.redis.get(redisKey);

        if (!stored) {
            throw new UnauthorizedException(cpmsg(lang, 'auth.codeExpired'));
        }

        const data = JSON.parse(stored) as { code: string; contactId: string; attempts: number };

        // Rate-limit brute force: max 5 attempts
        if (data.attempts >= 5) {
            await this.redis.del(redisKey);
            throw new UnauthorizedException(cpmsg(lang, 'auth.tooManyAttempts'));
        }

        if (data.code !== body.code) {
            // Increment attempt counter
            data.attempts += 1;
            await this.redis.set(redisKey, JSON.stringify(data), 600);
            throw new UnauthorizedException(cpmsg(lang, 'auth.invalidCode'));
        }

        // Code is valid — delete it so it can't be reused
        await this.redis.del(redisKey);

        // Issue customer JWT
        const expiresIn = '1h';
        const token = this.jwt.sign(
            {
                sub: data.contactId,
                tenantId,
                type: 'customer',
            },
            { expiresIn },
        );

        this.logger.log(`Portal token issued for contact ${data.contactId} in tenant ${tenantId}`);

        return { token, expiresIn, contactId: data.contactId };
    }

    // ---- Profile ----

    async getProfile(tenantId: string, contactId: string): Promise<any> {
        const schema = await this.getSchemaName(tenantId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT
                id,
                phone,
                email,
                first_name,
                last_name,
                display_name,
                avatar_url,
                language,
                tags,
                custom_attributes,
                created_at,
                updated_at
            FROM contacts
            WHERE id = $1::uuid AND is_active = true
            LIMIT 1`,
            [contactId],
        );

        if (!rows || rows.length === 0) {
            throw new NotFoundException('Contact profile not found');
        }

        return rows[0];
    }

    // ---- Conversations ----

    async getConversations(tenantId: string, contactId: string): Promise<any[]> {
        const schema = await this.getSchemaName(tenantId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT
                c.id,
                c.channel_type,
                c.status,
                c.started_at,
                c.updated_at,
                c.metadata,
                (
                    SELECT json_build_object(
                        'id', m.id,
                        'content', m.content,
                        'direction', m.direction,
                        'created_at', m.created_at
                    )
                    FROM messages m
                    WHERE m.conversation_id = c.id
                    ORDER BY m.created_at DESC
                    LIMIT 1
                ) AS last_message,
                (
                    SELECT COUNT(*)::int
                    FROM messages m2
                    WHERE m2.conversation_id = c.id
                ) AS message_count
            FROM conversations c
            WHERE c.contact_id = $1::uuid
            ORDER BY c.updated_at DESC
            LIMIT 50`,
            [contactId],
        );

        return rows || [];
    }

    // ---- Appointments ----

    async getAppointments(tenantId: string, contactId: string): Promise<any[]> {
        const schema = await this.getSchemaName(tenantId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT
                a.id,
                a.service_name,
                a.start_time,
                a.end_time,
                a.status,
                a.location_type,
                a.location_address,
                a.meeting_link,
                a.notes,
                a.created_at,
                a.updated_at
            FROM appointments a
            WHERE a.contact_id = $1::uuid
                AND a.start_time >= NOW()
                AND a.status NOT IN ('cancelled', 'no_show')
            ORDER BY a.start_time ASC
            LIMIT 50`,
            [contactId],
        );

        return rows || [];
    }

    // ---- Orders ----

    async getOrders(tenantId: string, contactId: string): Promise<any[]> {
        const schema = await this.getSchemaName(tenantId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT
                o.id,
                o.order_number,
                o.status,
                o.total_amount,
                o.currency,
                o.items,
                o.notes,
                o.created_at,
                o.updated_at
            FROM orders o
            WHERE o.contact_id = $1::uuid
            ORDER BY o.created_at DESC
            LIMIT 50`,
            [contactId],
        );

        return rows || [];
    }
}
