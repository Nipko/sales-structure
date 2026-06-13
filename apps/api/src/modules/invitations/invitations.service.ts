import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { invitationEmail, welcomeTeamMemberEmail } from '../email/email-layouts';
import { validateEmailDomain } from '../../common/utils/email.util';

const TOKEN_BYTES = 32;
const DEFAULT_TTL_DAYS = 14;
const ALLOWED_ROLES = new Set(['tenant_admin', 'tenant_supervisor', 'tenant_agent']);

@Injectable()
export class InvitationsService {
    private readonly logger = new Logger(InvitationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly email: EmailService,
        private readonly throttle: TenantThrottleService,
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
        if (existingUser && existingUser.tenantId === input.tenantId) {
            throw new ConflictException({ error: 'already_member', message: 'This email is already a member of your team.' });
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
        await this.throttle.enforcePlanLimit(input.tenantId, 'seats', activeUsers + pendingInvites, 'usuarios');

        const token = randomBytes(TOKEN_BYTES).toString('base64url');
        const expiresAt = new Date(Date.now() + DEFAULT_TTL_DAYS * 86_400_000);

        const invitation = await this.prisma.tenantInvitation.create({
            data: {
                tenantId: input.tenantId,
                email,
                role: input.role,
                skillTags: input.skillTags ?? [],
                token,
                invitedByUserId: input.invitedByUserId ?? null,
                expiresAt,
            },
        });

        // Send the email but don't block on failure — admin can always resend.
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: input.tenantId },
            select: { name: true, slug: true, settings: true },
        });
        const tenantLogoUrl = (tenant?.settings as any)?.logoUrl ?? null;
        const inviter = input.invitedByUserId
            ? await this.prisma.user.findUnique({
                where: { id: input.invitedByUserId },
                select: { firstName: true, lastName: true, email: true },
            })
            : null;

        await this.sendInvitationEmail({
            email,
            token,
            tenantName: tenant?.name || 'Parallly',
            tenantLogoUrl,
            inviterName: inviter
                ? `${inviter.firstName ?? ''} ${inviter.lastName ?? ''}`.trim() || inviter.email
                : null,
            role: input.role,
            expiresAt,
        }).catch((err) => {
            this.logger.error(`[Invitations] Failed to send invitation email to ${email}: ${err.message}`);
        });

        await this.prisma.auditLog.create({
            data: {
                tenantId: input.tenantId,
                userId: input.invitedByUserId,
                action: 'invitation_created',
                resource: `tenant_invitations/${invitation.id}`,
                details: { email, role: input.role },
            },
        });

        return invitation;
    }

    async resend(tenantId: string, invitationId: string) {
        const invitation = await this.prisma.tenantInvitation.findUnique({ where: { id: invitationId } });
        if (!invitation || invitation.tenantId !== tenantId) {
            throw new NotFoundException({ error: 'invitation_not_found' });
        }
        if (invitation.acceptedAt) {
            throw new BadRequestException({ error: 'already_accepted' });
        }
        if (invitation.revokedAt) {
            throw new BadRequestException({ error: 'revoked' });
        }

        // Bump expiration so the new email link is fresh
        const newExpires = new Date(Date.now() + DEFAULT_TTL_DAYS * 86_400_000);
        const updated = await this.prisma.tenantInvitation.update({
            where: { id: invitationId },
            data: { expiresAt: newExpires, resentAt: new Date() },
        });

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { name: true, settings: true },
        });

        await this.sendInvitationEmail({
            email: invitation.email,
            token: invitation.token,
            tenantName: tenant?.name || 'Parallly',
            tenantLogoUrl: (tenant?.settings as any)?.logoUrl ?? null,
            inviterName: null,
            role: invitation.role,
            expiresAt: newExpires,
        });

        return updated;
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
        if (existingUser) {
            // The email already has an account. Block to avoid silently
            // moving users between tenants — admin must merge or the user
            // signs in with their existing creds and asks to be added.
            throw new ConflictException({
                error: 'user_exists',
                message: 'An account already exists for this email. Sign in to your existing account.',
            });
        }

        // Backstop seat enforcement at the moment a seat is actually consumed
        // (the invite may have been created before a plan downgrade).
        const activeUsers = await this.prisma.user.count({
            where: { tenantId: invitation.tenantId, isActive: true },
        });
        await this.throttle.enforcePlanLimit(invitation.tenantId, 'seats', activeUsers, 'usuarios');

        const password = await bcrypt.hash(input.password, 12);
        const user = await this.prisma.user.create({
            data: {
                email: invitation.email,
                firstName: input.firstName,
                lastName: input.lastName || '',
                password,
                role: invitation.role,
                tenantId: invitation.tenantId,
                skillTags: invitation.skillTags,
                isActive: true,
                emailVerified: true,  // verified via invitation link possession
                authProvider: 'email',
            },
        });

        await this.prisma.tenantInvitation.update({
            where: { id: invitation.id },
            data: { acceptedAt: new Date(), acceptedUserId: user.id },
        });

        await this.prisma.auditLog.create({
            data: {
                tenantId: invitation.tenantId,
                userId: user.id,
                action: 'invitation_accepted',
                resource: `tenant_invitations/${invitation.id}`,
                details: { email: invitation.email, role: invitation.role },
            },
        });

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: invitation.tenantId },
            select: { name: true },
        });
        this.email.send({
            to: invitation.email,
            subject: `Bienvenido a ${tenant?.name || 'Parallly'}`,
            html: welcomeTeamMemberEmail(input.firstName, tenant?.name || 'Parallly', this.roleLabel(invitation.role)),
        }).catch((err) => {
            this.logger.error(`[Invitations] Failed to send welcome email to ${invitation.email}: ${err.message}`);
        });

        return { userId: user.id, tenantId: invitation.tenantId, role: invitation.role };
    }

    // ── Email rendering ────────────────────────────────────────────

    private async sendInvitationEmail(input: {
        email: string;
        token: string;
        tenantName: string;
        tenantLogoUrl: string | null;
        inviterName: string | null;
        role: string;
        expiresAt: Date;
    }) {
        const dashboardUrl = process.env.DASHBOARD_URL || 'https://admin.parallly-chat.cloud';
        const acceptUrl = `${dashboardUrl}/accept-invite/${input.token}`;
        const roleLabel = this.roleLabel(input.role);
        const expiresText = input.expiresAt.toLocaleDateString('es-CO', {
            day: 'numeric', month: 'long', year: 'numeric',
        });

        const html = invitationEmail({
            inviterName: input.inviterName,
            tenantName: input.tenantName,
            tenantLogoUrl: input.tenantLogoUrl,
            roleLabel,
            acceptUrl,
            expiresText,
        });

        await this.email.send({
            to: input.email,
            subject: `Te invitaron a unirte a ${input.tenantName} en Parallly`,
            html,
        });
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

    private roleLabel(role: string): string {
        switch (role) {
            case 'tenant_admin': return 'Administrador';
            case 'tenant_supervisor': return 'Supervisor';
            case 'tenant_agent': return 'Agente';
            default: return role;
        }
    }
}
