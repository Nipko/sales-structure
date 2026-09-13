import { Injectable, Logger, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { cpmsg } from './customer-portal-i18n';
import { CustomerPortalAccessService } from './customer-portal-access.service';

@Injectable()
export class CustomerPortalService {
    private readonly logger = new Logger(CustomerPortalService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly jwt: JwtService,
        private readonly portalAccess: CustomerPortalAccessService,
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

        // The authority performs the contact lookup and admission in the same
        // transaction. Known and unknown destinations therefore cross the same
        // database boundary and always receive the same public response.
        const challengeId = await this.portalAccess.issue(tenantId, schema, channel, identifier, lang);
        if (challengeId) {
            this.logger.log(`Portal access code generated for ${channel}:${identifier} in tenant ${tenantId}`);
            // Admission is already durable. An interrupted immediate attempt is
            // recovered by CustomerPortalAccessService's database-backed sweep.
            void this.portalAccess.deliver(challengeId).catch(error =>
                this.logger.warn(`Portal code dispatch deferred for tenant ${tenantId}: ${error?.message}`));
        } else {
            this.logger.warn(`Portal access requested for unknown ${channel} in tenant ${tenantId} — generic response`);
        }

        return { identifier, channel };
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

        const lang = await this.getTenantLanguage(tenantId);
        const channel: 'sms' | 'email' = body.phone ? 'sms' : 'email';
        let contactId: string;
        try {
            contactId = await this.portalAccess.verify(tenantId, channel, identifier, body.code);
        } catch (error: any) {
            const reason = String(error?.message || 'portal_code_expired');
            if (reason.includes('too_many')) throw new UnauthorizedException(cpmsg(lang, 'auth.tooManyAttempts'));
            if (reason.includes('invalid')) throw new UnauthorizedException(cpmsg(lang, 'auth.invalidCode'));
            throw new UnauthorizedException(cpmsg(lang, 'auth.codeExpired'));
        }

        // Issue customer JWT
        const expiresIn = '1h';
        const token = this.jwt.sign(
            {
                sub: contactId,
                tenantId,
                type: 'customer',
            },
            { expiresIn },
        );

        this.logger.log(`Portal token issued for contact ${contactId} in tenant ${tenantId}`);

        return { token, expiresIn, contactId };
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
