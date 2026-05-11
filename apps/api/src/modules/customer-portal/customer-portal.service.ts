import { Injectable, Logger, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class CustomerPortalService {
    private readonly logger = new Logger(CustomerPortalService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly jwt: JwtService,
        private readonly config: ConfigService,
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
    ): Promise<{ identifier: string; channel: 'whatsapp' | 'email' }> {
        const schema = await this.getSchemaName(tenantId);

        const identifier = body.phone || body.email;
        if (!identifier) {
            throw new BadRequestException('Either phone or email is required');
        }

        const channel: 'whatsapp' | 'email' = body.phone ? 'whatsapp' : 'email';

        // Verify the contact exists in the tenant schema
        const whereClause = body.phone
            ? `phone = $1`
            : `email = $1`;

        const contacts = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id FROM contacts WHERE ${whereClause} AND is_active = true LIMIT 1`,
            [identifier],
        );

        if (!contacts || contacts.length === 0) {
            throw new NotFoundException('No active contact found with the provided information');
        }

        // Generate and store verification code (10 min TTL)
        const code = this.generateCode();
        const redisKey = this.codeKey(tenantId, identifier);
        await this.redis.set(redisKey, JSON.stringify({
            code,
            contactId: contacts[0].id,
            attempts: 0,
        }), 600); // 10 minutes

        this.logger.log(`Portal access code generated for ${channel}:${identifier} in tenant ${tenantId}`);

        // NOTE: The actual sending of the code via WhatsApp or email should be
        // handled by the caller or an event listener. We return the code here
        // so the controller can orchestrate delivery.
        // In production, you would NOT return the code in the response —
        // it would be sent via the channel only.

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

        const redisKey = this.codeKey(tenantId, identifier);
        const stored = await this.redis.get(redisKey);

        if (!stored) {
            throw new UnauthorizedException('Verification code expired or not found. Request a new one.');
        }

        const data = JSON.parse(stored) as { code: string; contactId: string; attempts: number };

        // Rate-limit brute force: max 5 attempts
        if (data.attempts >= 5) {
            await this.redis.del(redisKey);
            throw new UnauthorizedException('Too many failed attempts. Request a new code.');
        }

        if (data.code !== body.code) {
            // Increment attempt counter
            data.attempts += 1;
            await this.redis.set(redisKey, JSON.stringify(data), 600);
            throw new UnauthorizedException('Invalid verification code');
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
