import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { validateEmailDomain } from '../../common/utils/email.util';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../quality/agent-quality-events';
import { PlatformNotificationOutboxService } from '../platform-notifications/platform-notification-outbox.service';

const TOKEN_BYTES = 32;
const DEFAULT_TTL_DAYS = 14;
const ALLOWED_ROLES = new Set(['tenant_admin', 'tenant_supervisor', 'tenant_agent']);

@Injectable()
export class InvitationsService {
    private readonly logger = new Logger(InvitationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: PlatformNotificationOutboxService,
        private readonly throttle: TenantThrottleService,
        @Optional() private readonly events?: EventEmitter2,
    ) {}

    // ── Admin operations (require auth + tenant ownership) ─────────

    async list(tenantId: string) {
        return this.prisma.tenantInvitation.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true, email: true, role: true, skillTags: true,
                expiresAt: true, acceptedAt: true, revokedAt: true,
                resentAt: true, createdAt: true,
            },
            take: 200,
        });
    }

    async create(input: {
        tenantId: string;
        email: string;
        role: string;
        skillTags?: string[];
        invitedByUserId?: string;
    }) {
        const email = input.email.trim().toLowerCase();
        validateEmailDomain(email);
        if (!ALLOWED_ROLES.has(input.role)) {
            throw new BadRequestException({ error: 'invalid_role', message: `Role must be one of: ${[...ALLOWED_ROLES].join(', ')}` });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new BadRequestException({ error: 'invalid_email' });
        }

        // Already a member?
        const existingUser = await this.prisma.user.findUnique({ where: { email } });
        const claimableProvisionedOwner = existingUser
            && existingUser.tenantId === input.tenantId
            && existingUser.role === input.role
            && existingUser.authProvider === 'invitation'
            && !existingUser.password
            && existingUser.emailVerified !== true;
        if (existingUser && !claimableProvisionedOwner) {
            throw new ConflictException({
                error: existingUser.tenantId === input.tenantId ? 'already_member' : 'user_exists',
                message: existingUser.tenantId === input.tenantId
                    ? 'This email is already a member of your team.'
                    : 'An account already exists for this email.',
            });
        }

        // Pending invitation already? Resend instead of duplicating.
        const pending = await this.prisma.tenantInvitation.findFirst({
            where: { tenantId: input.tenantId, email, acceptedAt: null, revokedAt: null },
        });
        if (pending && pending.expiresAt > new Date()) {
            throw new ConflictException({
                error: 'pending_invitation',
                message: 'There is already a pending invitation for this email. Use resend instead.',
                invitationId: pending.id,
            });
        }

        // Enforce the plan's seat limit: active users + outstanding (non-expired,
        // non-revoked) invitations both count toward the cap so an admin can't
        // over-provision the team beyond what the plan allows.
        const [activeUsers, pendingInvites] = await Promise.all([
            this.prisma.user.count({ where: { tenantId: input.tenantId, isActive: true } }),
            this.prisma.tenantInvitation.count({
                where: { tenantId: input.tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
            }),
        ]);
        const occupiedSeats = activeUsers + pendingInvites - (claimableProvisionedOwner ? 1 : 0);
        await this.throttle.enforcePlanLimit(input.tenantId, 'seats', occupiedSeats, 'usuarios');

        const token = randomBytes(TOKEN_BYTES).toString('base64url');
        const expiresAt = new Date(Date.now() + DEFAULT_TTL_DAYS * 86_400_000);

        const invitationId = randomUUID();
        const result = await this.prisma.$transaction(async (tx: any) => {
            const invitation = await tx.tenantInvitation.create({
                data: {
                    id: invitationId,
                    tenantId: input.tenantId,
                    email,
                    role: input.role,
                    skillTags: input.skillTags ?? [],
                    token,
                    invitedByUserId: input.invitedByUserId ?? null,
                    expiresAt,
                    notificationRevision: 1,
                },
            });
            const noticeId = await this.enqueueNotification(tx, {
                eventKey: `invitation:${invitationId}:invite:1`, kind: 'invitation.invite_email',
                entityId: invitationId, tenantId: input.tenantId, email, payload: { revision: 1 },
            });
            await tx.auditLog.create({
                data: {
                    tenantId: input.tenantId,
                    userId: input.invitedByUserId,
                    action: 'invitation_created',
                    resource: `tenant_invitations/${invitation.id}`,
                    details: { email, role: input.role },
                },
            });
            return { invitation, noticeId };
        });
        await this.deliverNow(result.noticeId);

        return result.invitation;
    }

    async resend(tenantId: string, invitationId: string) {
        const newExpires = new Date(Date.now() + DEFAULT_TTL_DAYS * 86_400_000);
        const result = await this.prisma.$transaction(async (tx: any) => {
            const invitation = await tx.tenantInvitation.findUnique({ where: { id: invitationId } });
            if (!invitation || invitation.tenantId !== tenantId) {
                throw new NotFoundException({ error: 'invitation_not_found' });
            }
            if (invitation.acceptedAt) throw new BadRequestException({ error: 'already_accepted' });
            if (invitation.revokedAt) throw new BadRequestException({ error: 'revoked' });
            const revision = Number(invitation.notificationRevision || 0) + 1;
            const updated = await tx.tenantInvitation.update({
                where: { id: invitationId },
                data: { expiresAt: newExpires, resentAt: new Date(), notificationRevision: revision },
            });
            const noticeId = await this.enqueueNotification(tx, {
                eventKey: `invitation:${invitationId}:invite:${revision}`, kind: 'invitation.invite_email',
                entityId: invitationId, tenantId, email: invitation.email, payload: { revision },
            });
            return { updated, noticeId };
        }, { isolationLevel: 'Serializable' });
        await this.deliverNow(result.noticeId);
        return result.updated;
    }

    async revoke(tenantId: string, invitationId: string) {
        const invitation = await this.prisma.tenantInvitation.findUnique({ where: { id: invitationId } });
        if (!invitation || invitation.tenantId !== tenantId) {
            throw new NotFoundException({ error: 'invitation_not_found' });
        }
        if (invitation.acceptedAt) {
            throw new BadRequestException({ error: 'already_accepted', message: 'Cannot revoke an accepted invitation.' });
        }
        return this.prisma.tenantInvitation.update({
            where: { id: invitationId },
            data: { revokedAt: new Date() },
        });
    }

    // ── Public token-based operations (no auth) ────────────────────

    /** Read invitation info to render the accept page. Doesn't reveal sensitive data. */
    async getByToken(token: string) {
        const invitation = await this.prisma.tenantInvitation.findUnique({ where: { token } });
        if (!invitation) {
            return { valid: false, reason: 'not_found' as const };
        }
        if (invitation.acceptedAt) {
            return { valid: false, reason: 'accepted' as const };
        }
        if (invitation.revokedAt) {
            return { valid: false, reason: 'revoked' as const };
        }
        if (invitation.expiresAt < new Date()) {
            return { valid: false, reason: 'expired' as const };
        }
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: invitation.tenantId },
            select: { name: true, slug: true, settings: true },
        });
        return {
            valid: true as const,
            invitation: {
                email: invitation.email,
                role: invitation.role,
                expiresAt: invitation.expiresAt,
                tenantName: tenant?.name ?? 'Parallly',
                tenantSlug: tenant?.slug ?? null,
                tenantLogoUrl: (tenant?.settings as any)?.logoUrl ?? null,
            },
        };
    }

    /**
     * Accept the invitation — creates the user with the assigned role and
     * tenant. This is the path for users who don't yet have an account.
     * If a user already exists with this email AND is already in another
     * tenant, we reject (we don't move users between tenants here).
     */
    async accept(token: string, input: {
        password: string;
        firstName: string;
        lastName?: string;
    }) {
        const invitation = await this.prisma.tenantInvitation.findUnique({ where: { token } });
        if (!invitation) throw new NotFoundException({ error: 'not_found' });
        if (invitation.acceptedAt) throw new BadRequestException({ error: 'already_accepted' });
        if (invitation.revokedAt) throw new BadRequestException({ error: 'revoked' });
        if (invitation.expiresAt < new Date()) throw new BadRequestException({ error: 'expired' });

        this.validatePasswordStrength(input.password);

        const existingUser = await this.prisma.user.findUnique({
            where: { email: invitation.email },
        });
        const claimableProvisionedOwner = existingUser
            && existingUser.tenantId === invitation.tenantId
            && existingUser.role === invitation.role
            && existingUser.authProvider === 'invitation'
            && !existingUser.password
            && existingUser.emailVerified !== true;
        if (existingUser && !claimableProvisionedOwner) {
            // Never move or overwrite a normal account. Only the inert owner
            // placeholder created by administrative tenant provisioning can be claimed.
            throw new ConflictException({
                error: 'user_exists',
                message: 'An account already exists for this email. Sign in to your existing account.',
            });
        }

        const password = await bcrypt.hash(input.password, 12);
        if (!claimableProvisionedOwner) {
            // Backstop seat enforcement at the moment a new seat is consumed
            // (the invite may have been created before a plan downgrade).
            const activeUsers = await this.prisma.user.count({
                where: { tenantId: invitation.tenantId, isActive: true },
            });
            await this.throttle.enforcePlanLimit(invitation.tenantId, 'seats', activeUsers, 'usuarios');

        }
        const accepted = await this.prisma.$transaction(async (tx: any) => {
            const current = await tx.tenantInvitation.findUnique({ where: { id: invitation.id } });
            if (!current) throw new NotFoundException({ error: 'not_found' });
            if (current.acceptedAt) throw new BadRequestException({ error: 'already_accepted' });
            if (current.revokedAt) throw new BadRequestException({ error: 'revoked' });
            if (current.expiresAt < new Date()) throw new BadRequestException({ error: 'expired' });
            const currentUser = await tx.user.findUnique({ where: { email: current.email } });
            const claimable = this.isClaimableOwner(currentUser, current);
            if (currentUser && !claimable) throw new ConflictException({
                error: 'user_exists', message: 'An account already exists for this email. Sign in to your existing account.',
            });
            const user = claimable
                ? await tx.user.update({ where: { id: currentUser.id }, data: {
                    firstName: input.firstName, lastName: input.lastName || '', password,
                    skillTags: current.skillTags, isActive: true, emailVerified: true,
                    emailVerificationState: 'verified', authProvider: 'email', onboardingCompleted: true,
                } })
                : await tx.user.create({ data: {
                    email: current.email, firstName: input.firstName, lastName: input.lastName || '', password,
                    role: current.role, tenantId: current.tenantId, skillTags: current.skillTags, isActive: true,
                    emailVerified: true, emailVerificationState: 'verified', authProvider: 'email', onboardingCompleted: true,
                } });
            await tx.tenantInvitation.update({
                where: { id: current.id }, data: { acceptedAt: new Date(), acceptedUserId: user.id },
            });
            await tx.auditLog.create({ data: {
                tenantId: current.tenantId, userId: user.id, action: 'invitation_accepted',
                resource: `tenant_invitations/${current.id}`, details: { email: current.email, role: current.role },
            } });
            const noticeId = await this.enqueueNotification(tx, {
                eventKey: `invitation:${current.id}:welcome`, kind: 'invitation.welcome_email',
                entityId: current.id, tenantId: current.tenantId, email: current.email,
                payload: { acceptedUserId: user.id },
            });
            return { user, invitation: current, noticeId };
        }, { isolationLevel: 'Serializable' });
        void this.deliverNow(accepted.noticeId);

        this.events?.emit(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
            tenantId: accepted.invitation.tenantId,
            source: 'tenant_users',
        });

        return { userId: accepted.user.id, tenantId: accepted.invitation.tenantId, role: accepted.invitation.role };
    }

    private async enqueueNotification(tx: any, input: {
        eventKey: string; kind: 'invitation.invite_email' | 'invitation.welcome_email';
        entityId: string; tenantId: string; email: string; payload: Record<string, unknown>;
    }): Promise<string> {
        const rows = await tx.$queryRawUnsafe(`INSERT INTO platform_notification_outbox(
                id,event_key,kind,entity_id,tenant_id,recipient_email,payload,state)
            VALUES($1::uuid,$2,$3,$4::uuid,$5::uuid,$6,$7::jsonb,'pending')
            ON CONFLICT(event_key) DO UPDATE SET updated_at=platform_notification_outbox.updated_at
            RETURNING id`, randomUUID(), input.eventKey, input.kind, input.entityId, input.tenantId,
        input.email, JSON.stringify(input.payload));
        return rows[0].id;
    }

    private async deliverNow(noticeId: string): Promise<void> {
        await this.notifications.deliver(noticeId).catch((error: any) => {
            this.logger.warn(`[Invitations] Durable notification ${noticeId} deferred: ${error?.message || error}`);
        });
    }

    private isClaimableOwner(user: any, invitation: any): boolean {
        return !!user && user.tenantId === invitation.tenantId && user.role === invitation.role
            && user.authProvider === 'invitation' && !user.password && user.emailVerified !== true;
    }

    private validatePasswordStrength(password: string): void {
        const errors: string[] = [];
        if (!password || password.length < 8) errors.push('Minimum 8 characters');
        if (!/[A-Z]/.test(password || '')) errors.push('At least 1 uppercase letter');
        if (!/[a-z]/.test(password || '')) errors.push('At least 1 lowercase letter');
        if (!/[0-9]/.test(password || '')) errors.push('At least 1 number');
        if (!/[^A-Za-z0-9]/.test(password || '')) errors.push('At least 1 special character');
        if (errors.length > 0) {
            throw new BadRequestException({ message: 'Password does not meet requirements', errors });
        }
    }

}
