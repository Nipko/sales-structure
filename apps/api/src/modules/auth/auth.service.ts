import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { TOTP, Secret } from 'otpauth';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RedisService } from '../redis/redis.service';
import { GoogleAuthService } from './google-auth.service';
import { PersonaService } from '../persona/persona.service';
import { BusinessInfoService } from '../business-info/business-info.service';
import { BillingService } from '../billing/billing.service';
import { VerticalsService } from '../verticals/verticals.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PlatformSmsService } from './platform-sms.service';
import { JwtPayload, UserRole } from '@parallext/shared';
import { validateEmailDomain } from '../../common/utils/email.util';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import {
    verificationEmail, passwordResetEmail, twoFactorEmail,
    welcomeEmail, passwordChangedEmail, newTrustedDeviceEmail,
} from '../email/email-layouts';

interface SessionData {
    sid: string;
    tenantId?: string;
    loginAt: number;
    lastActivity: number;
}

// Refresh token TTLs (seconds)
const REFRESH_TTL_DEFAULT = 8 * 60 * 60;       // 8 hours (one work shift)
const REFRESH_TTL_REMEMBER = 14 * 24 * 60 * 60; // 14 days

const SESSION_TTL = 360; // 6 min — refreshed by activity ping (frontend sends every 5 min)
const TWO_FA_TOKEN_TTL = 300; // 5 min — temporary token for 2FA verification
const EXCHANGE_CODE_TTL = 60; // 60s — one-time code for OAuth redirect token exchange
const BACKUP_CODE_COUNT = 10;
const DEVICE_TRUST_TTL_DAYS = 30;
const MAX_TRUSTED_DEVICES = 10;

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private googleAuthService: GoogleAuthService,
        private emailService: EmailService,
        private redis: RedisService,
        private personaService: PersonaService,
        private businessInfoService: BusinessInfoService,
        private billingService: BillingService,
        private verticalsService: VerticalsService,
        private throttleService: TenantThrottleService,
        private platformSms: PlatformSmsService,
    ) { }

    // ── Token helpers ─────────────────────────────────────────────

    /**
     * Generate access + refresh token pair.
     * Stores refresh token hash in Redis for validation & rotation.
     */
    private async generateTokens(
        payload: JwtPayload,
        options: { rememberMe?: boolean; sid?: string } = {},
    ): Promise<{ accessToken: string; refreshToken: string }> {
        const tokenPayload = options.sid ? { ...payload, sid: options.sid } : payload;

        const accessToken = this.jwtService.sign(tokenPayload, {
            secret: this.configService.get<string>('auth.jwtSecret'),
            expiresIn: this.configService.get<string>('auth.jwtExpiration', '15m'),
        });

        const refreshTtl = options.rememberMe ? REFRESH_TTL_REMEMBER : REFRESH_TTL_DEFAULT;
        const refreshExpiresIn = options.rememberMe ? '14d' : '8h';

        const tokenId = crypto.randomUUID();
        const refreshToken = this.jwtService.sign(
            { ...tokenPayload, tid: tokenId },
            {
                secret: this.configService.get<string>('auth.jwtRefreshSecret'),
                expiresIn: refreshExpiresIn,
            },
        );

        // Store in Redis: refresh:{userId}:{tokenId} → metadata
        const redisKey = `refresh:${payload.sub}:${tokenId}`;
        await this.redis.setJson(redisKey, {
            userId: payload.sub,
            rememberMe: !!options.rememberMe,
            createdAt: Date.now(),
        }, refreshTtl);

        return { accessToken, refreshToken };
    }

    async createExchangeCode(data: {
        accessToken?: string; refreshToken?: string; user?: any;
        requires2FA?: boolean; twoFAToken?: string; twoFactorMethod?: string;
    }): Promise<string> {
        const code = crypto.randomBytes(32).toString('hex');
        await this.redis.setJson(`oauth_exchange:${code}`, data, EXCHANGE_CODE_TTL);
        return code;
    }

    async redeemExchangeCode(code: string): Promise<any> {
        const key = `oauth_exchange:${code}`;
        const data = await this.redis.getJson(key);
        if (!data) throw new UnauthorizedException('Invalid or expired exchange code');
        await this.redis.del(key);
        return data;
    }

    /**
     * Revoke a specific refresh token by removing it from Redis.
     */
    private async revokeRefreshToken(userId: string, tokenId: string): Promise<void> {
        await this.redis.del(`refresh:${userId}:${tokenId}`);
    }

    /**
     * Revoke ALL refresh tokens for a user (e.g., on password change).
     * Scans Redis for all refresh:{userId}:* keys and deletes them.
     */
    async revokeAllUserSessions(userId: string): Promise<void> {
        const client = this.redis.getClient();
        const pattern = `refresh:${userId}:*`;
        let cursor = '0';
        do {
            const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            if (keys.length > 0) {
                await client.del(...keys);
            }
        } while (cursor !== '0');
    }

    // ── Session management ─────────────────────────────────────

    private async createSession(userId: string, tenantId?: string): Promise<string> {
        const sid = crypto.randomUUID();
        const session: SessionData = {
            sid,
            tenantId: tenantId || undefined,
            loginAt: Date.now(),
            lastActivity: Date.now(),
        };
        await this.redis.setJson(`session:${userId}`, session, SESSION_TTL);
        if (tenantId) {
            await this.redis.sadd(`tenant_sessions:${tenantId}`, userId);
        }
        return sid;
    }

    private async destroySession(userId: string): Promise<void> {
        const session = await this.redis.getJson<SessionData>(`session:${userId}`);
        await this.redis.del(`session:${userId}`);
        if (session?.tenantId) {
            await this.redis.srem(`tenant_sessions:${session.tenantId}`, userId);
        }
    }

    private async cleanStaleTenantSessions(tenantId: string): Promise<void> {
        const members = await this.redis.smembers(`tenant_sessions:${tenantId}`);
        for (const userId of members) {
            const exists = await this.redis.get(`session:${userId}`);
            if (!exists) {
                await this.redis.srem(`tenant_sessions:${tenantId}`, userId);
            }
        }
    }

    private async enforceSessionPolicy(user: { id: string; role: string; tenantId: string | null }, force: boolean): Promise<void> {
        if (user.role === 'super_admin') return;

        const existing = await this.redis.getJson<SessionData>(`session:${user.id}`);
        if (existing && !force) {
            throw new ConflictException({
                error: 'session_conflict',
                message: 'Ya hay una sesión activa para esta cuenta',
                activeSession: { loginAt: existing.loginAt },
            });
        }

        if (user.tenantId) {
            await this.cleanStaleTenantSessions(user.tenantId);
            const currentCount = await this.redis.scard(`tenant_sessions:${user.tenantId}`);
            const seatsLimit = await this.throttleService.getPlanLimit(user.tenantId, 'seats');
            const isReplacingOwnSession = !!existing;
            if (!isReplacingOwnSession && currentCount >= seatsLimit) {
                throw new ForbiddenException({
                    error: 'tenant_session_limit',
                    message: `Tu empresa ha alcanzado el límite de sesiones concurrentes (${Number.isFinite(seatsLimit) ? seatsLimit : '∞'})`,
                    currentCount,
                    maxAllowed: Number.isFinite(seatsLimit) ? seatsLimit : null,
                });
            }
        }

        if (force && existing) {
            await this.revokeAllUserSessions(user.id);
            await this.destroySession(user.id);
        }
    }

    async activityPing(userId: string): Promise<boolean> {
        const exists = await this.redis.get(`session:${userId}`);
        if (!exists) return false;
        await this.redis.expire(`session:${userId}`, SESSION_TTL);
        return true;
    }

    private validatePasswordStrength(password: string): void {
        const errors: string[] = [];
        if (!password || password.length < 8) errors.push('Minimum 8 characters');
        if (!/[A-Z]/.test(password)) errors.push('At least 1 uppercase letter');
        if (!/[a-z]/.test(password)) errors.push('At least 1 lowercase letter');
        if (!/[0-9]/.test(password)) errors.push('At least 1 number');
        if (!/[^A-Za-z0-9]/.test(password)) errors.push('At least 1 special character');
        if (errors.length > 0) {
            throw new BadRequestException({ message: 'Password does not meet requirements', errors });
        }
    }

    async register(data: {
        email: string;
        password: string;
        firstName: string;
        lastName: string;
        role?: UserRole;
        tenantId?: string;
    }) {
        validateEmailDomain(data.email);
        // Check if user exists
        const existing = await this.prisma.user.findUnique({
            where: { email: data.email },
        });

        if (existing) {
            throw new ConflictException('Email already registered');
        }

        this.validatePasswordStrength(data.password);

        // Enforce seats limit for tenant user creation
        if (data.tenantId) {
            const currentUsers = await this.prisma.user.count({
                where: { tenantId: data.tenantId, isActive: true },
            });
            await this.throttleService.enforcePlanLimit(data.tenantId, 'seats', currentUsers, 'usuarios');
        }

        const hashedPassword = await bcrypt.hash(data.password, 12);

        // Create user
        const user = await this.prisma.user.create({
            data: {
                email: data.email,
                password: hashedPassword,
                firstName: data.firstName,
                lastName: data.lastName,
                role: data.role || 'tenant_agent',
                tenantId: data.tenantId,
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                tenantId: true,
            },
        });

        return user;
    }

    /**
     * Self-service signup: creates user only (no tenant).
     * Tenant is created later via completeOnboarding().
     * Sends email verification code automatically.
     * This is a PUBLIC endpoint — no JWT required.
     */
    async signupWithTenant(data: {
        email: string;
        password: string;
        firstName: string;
        lastName: string;
    }) {
        validateEmailDomain(data.email);
        // Check if email is already taken
        const existingUser = await this.prisma.user.findUnique({
            where: { email: data.email },
        });
        if (existingUser) {
            throw new ConflictException('Email already registered');
        }

        this.validatePasswordStrength(data.password);

        const hashedPassword = await bcrypt.hash(data.password, 12);

        // Create user without tenant — tenant will be created during onboarding
        const user = await this.prisma.user.create({
            data: {
                email: data.email,
                password: hashedPassword,
                firstName: data.firstName,
                lastName: data.lastName,
                role: 'tenant_admin',
                authProvider: 'email',
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                tenantId: true,
            },
        });

        // Create session + generate tokens
        const sid = await this.createSession(user.id);

        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role as UserRole,
        };

        const { accessToken, refreshToken } = await this.generateTokens(payload, { sid });

        try {
            await this.sendVerificationEmail(user.id);
        } catch (error) {
            this.logger.error(`[Signup] Failed to send verification email: ${error}`);
        }

        return {
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                tenantId: user.tenantId,
                hasPassword: true,
                emailVerified: false,
                onboardingCompleted: false,
            },
        };
    }

    async login(email: string, password: string, rememberMe = false, force = false, deviceTrustToken?: string, deviceFingerprint?: string) {
        const user = await this.prisma.user.findUnique({
            where: { email },
            include: { tenant: true },
        });

        if (!user || !user.isActive) {
            throw new UnauthorizedException('Invalid credentials');
        }

        if (!user.password) {
            throw new UnauthorizedException('This account uses Google sign-in. Please log in with Google.');
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        // Enforce single-session + tenant session limits
        await this.enforceSessionPolicy(user, force);

        // 2FA check — skip if device is trusted
        if (user.twoFactorEnabled) {
            if (deviceTrustToken) {
                const trusted = await this.verifyTrustedDevice(user.id, deviceTrustToken, deviceFingerprint);
                if (trusted) {
                    this.logger.log(`[2FA] Skipped for user ${user.email} — trusted device`);
                    // Fall through to normal login
                } else {
                    const twoFAToken = this.generate2FAToken(user.id);
                    return {
                        requires2FA: true,
                        twoFAToken,
                        twoFactorMethod: user.twoFactorMethod || 'totp',
                        user: { email: user.email, firstName: user.firstName },
                    };
                }
            } else {
                const twoFAToken = this.generate2FAToken(user.id);
                return {
                    requires2FA: true,
                    twoFAToken,
                    twoFactorMethod: user.twoFactorMethod || 'totp',
                    user: { email: user.email, firstName: user.firstName },
                };
            }
        }

        // Update last login
        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });

        // Create session and generate tokens
        const sid = await this.createSession(user.id, user.tenantId || undefined);

        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role as UserRole,
            tenantId: user.tenantId || undefined,
        };

        const { accessToken, refreshToken } = await this.generateTokens(payload, { rememberMe, sid });

        const effectiveOnboarding = user.role === 'super_admin' || !!user.tenantId || user.onboardingCompleted;

        return {
            requires2FA: false,
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                tenantId: user.tenantId,
                tenantName: user.tenant?.name,
                picture: user.picture,
                hasPassword: !!user.password,
                emailVerified: user.emailVerified,
                onboardingCompleted: effectiveOnboarding,
            },
        };
    }

    /**
     * Refresh token rotation: validates old token, revokes it, issues new pair.
     * If token is already revoked (replay attack), revokes ALL user sessions.
     */
    async refreshToken(token: string) {
        let decoded: any;
        try {
            decoded = this.jwtService.verify(token, {
                secret: this.configService.get<string>('auth.jwtRefreshSecret'),
            });
        } catch {
            throw new UnauthorizedException('Invalid or expired refresh token');
        }

        const { sub: userId, tid: tokenId, sid: tokenSid } = decoded;

        if (decoded.isImpersonation) {
            throw new UnauthorizedException('Impersonation tokens cannot be refreshed');
        }

        // Verify active session if the token had one
        if (tokenSid) {
            const session = await this.redis.getJson<SessionData>(`session:${userId}`);
            if (!session || session.sid !== tokenSid) {
                throw new UnauthorizedException('Session expired — please log in again');
            }
        }

        if (!tokenId) {
            // Legacy token without tid — still allow but don't rotate
            const user = await this.prisma.user.findUnique({ where: { id: userId } });
            if (!user || !user.isActive) throw new UnauthorizedException('Invalid token');

            const payload: JwtPayload = {
                sub: user.id, email: user.email,
                role: user.role as UserRole, tenantId: user.tenantId || undefined,
            };
            const session = await this.redis.getJson<SessionData>(`session:${userId}`);
            const { accessToken, refreshToken: newRefresh } = await this.generateTokens(payload, { sid: session?.sid });
            return { accessToken, refreshToken: newRefresh };
        }

        // Check if this token exists in Redis (not revoked)
        const redisKey = `refresh:${userId}:${tokenId}`;
        const stored = await this.redis.getJson<{ rememberMe?: boolean }>(redisKey);

        if (!stored) {
            await this.revokeAllUserSessions(userId);
            await this.destroySession(userId);
            throw new UnauthorizedException('Token reuse detected — all sessions revoked');
        }

        // Revoke the old token
        await this.revokeRefreshToken(userId, tokenId);

        // Issue new pair with current session ID
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.isActive) throw new UnauthorizedException('Invalid token');

        const session = await this.redis.getJson<SessionData>(`session:${userId}`);
        const payload: JwtPayload = {
            sub: user.id, email: user.email,
            role: user.role as UserRole, tenantId: user.tenantId || undefined,
        };
        const { accessToken, refreshToken: newRefresh } = await this.generateTokens(payload, {
            rememberMe: stored.rememberMe,
            sid: session?.sid,
        });

        return { accessToken, refreshToken: newRefresh };
    }

    /**
     * Logout: revoke the specific refresh token.
     */
    async logout(token: string): Promise<void> {
        try {
            const decoded = this.jwtService.verify(token, {
                secret: this.configService.get<string>('auth.jwtRefreshSecret'),
            });
            if (decoded.tid) {
                await this.revokeRefreshToken(decoded.sub, decoded.tid);
            }
            await this.destroySession(decoded.sub);
        } catch {
            // Token already expired or invalid — nothing to revoke
        }
    }

    /**
     * Admin-only password reset (super_admin resets any user's password)
     */
    async adminResetPassword(userId: string, newPassword: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        this.validatePasswordStrength(newPassword);

        const hashedPassword = await bcrypt.hash(newPassword, 12);

        await this.prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });

        await this.revokeAllUserSessions(userId);
        await this.destroySession(userId);

        return { message: 'Password reset successfully' };
    }

    async validateUser(payload: JwtPayload) {
        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: {
                id: true,
                email: true,
                role: true,
                tenantId: true,
                isActive: true,
                tenant: {
                    select: { schemaName: true },
                },
            },
        });

        if (!user || !user.isActive) {
            throw new UnauthorizedException('User not found or inactive');
        }

        // Session validation: verify the JWT's session ID matches the active session.
        // Skip for super_admin and legacy tokens without sid (backward compat).
        if (user.role !== 'super_admin' && payload.sid) {
            const session = await this.redis.getJson<SessionData>(`session:${user.id}`);
            if (!session || session.sid !== payload.sid) {
                throw new UnauthorizedException('session_expired');
            }
        }

        return {
            id: user.id,
            email: user.email,
            role: user.role,
            tenantId: user.tenantId,
            isActive: user.isActive,
            schemaName: user.tenant?.schemaName,
            // Carry the delegation through. Re-selecting the user from the DB
            // dropped these, so anything written while impersonating was
            // attributed to the impersonated tenant_admin — the audit trail
            // didn't just have gaps, it named the wrong person.
            impersonatedBy: payload.impersonatedBy,
            isImpersonation: payload.isImpersonation === true,
            impersonationSid: payload.impersonationSid,
        };
    }

    // ── Google OAuth ──────────────────────────────────────────────

    async googleLogin(idToken: string, rememberMe = false, force = false, deviceTrustToken?: string, deviceFingerprint?: string) {
        const googleUser = await this.googleAuthService.verifyIdToken(idToken);

        // Find existing user by email or googleId
        let user = await this.prisma.user.findFirst({
            where: {
                OR: [
                    { email: googleUser.email },
                    { googleId: googleUser.googleId },
                ],
            },
            include: { tenant: true },
        });

        const isNewUser = !user;

        if (!user) {
            user = await this.prisma.user.create({
                data: {
                    email: googleUser.email,
                    firstName: googleUser.firstName,
                    lastName: googleUser.lastName,
                    authProvider: 'google',
                    googleId: googleUser.googleId,
                    picture: googleUser.picture,
                    emailVerified: true,
                    role: 'tenant_admin',
                },
                include: { tenant: true },
            });
        } else if (user.authProvider === 'email' && !user.googleId) {
            user = await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    googleId: googleUser.googleId,
                    picture: googleUser.picture || user.picture,
                },
                include: { tenant: true },
            });
        }

        // Enforce session policy (skip for brand-new users)
        if (!isNewUser) {
            await this.enforceSessionPolicy(user, force);
        }

        // 2FA check (skip for new users or if device is trusted)
        if (!isNewUser && user.twoFactorEnabled) {
            let skipTwoFA = false;
            if (deviceTrustToken) {
                skipTwoFA = await this.verifyTrustedDevice(user.id, deviceTrustToken, deviceFingerprint);
                if (skipTwoFA) {
                    this.logger.log(`[2FA] Skipped for user ${user.email} — trusted device (Google login)`);
                }
            }
            if (!skipTwoFA) {
                const twoFAToken = this.generate2FAToken(user.id);
                return {
                    requires2FA: true,
                    twoFAToken,
                    twoFactorMethod: user.twoFactorMethod || 'totp',
                    user: { email: user.email, firstName: user.firstName },
                };
            }
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });

        const sid = await this.createSession(user.id, user.tenantId || undefined);

        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role as UserRole,
            tenantId: user.tenantId || undefined,
        };

        const { accessToken, refreshToken } = await this.generateTokens(payload, { rememberMe, sid });

        const effectiveOnboarding = user.role === 'super_admin' || !!user.tenantId || user.onboardingCompleted;

        return {
            requires2FA: false,
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                tenantId: user.tenantId,
                tenantName: user.tenant?.name,
                picture: user.picture,
                hasPassword: !!user.password,
                emailVerified: user.emailVerified,
                onboardingCompleted: effectiveOnboarding,
            },
        };
    }

    // ── Microsoft OAuth ─────────────────────────────────────────

    async microsoftLogin(microsoftUser: {
        microsoftId: string; email: string;
        firstName: string; lastName: string; displayName: string;
        picture?: string;
    }, rememberMe = false, force = false) {
        let user = await this.prisma.user.findFirst({
            where: {
                OR: [
                    { email: microsoftUser.email },
                    { microsoftId: microsoftUser.microsoftId },
                ],
            },
            include: { tenant: true },
        });

        const isNewUser = !user;

        if (!user) {
            const firstName = microsoftUser.firstName || microsoftUser.displayName.split(' ')[0] || '';
            const lastName = microsoftUser.lastName || microsoftUser.displayName.split(' ').slice(1).join(' ') || '';

            user = await this.prisma.user.create({
                data: {
                    email: microsoftUser.email,
                    firstName,
                    lastName,
                    authProvider: 'microsoft',
                    microsoftId: microsoftUser.microsoftId,
                    picture: microsoftUser.picture,
                    emailVerified: true,
                    role: 'tenant_admin',
                },
                include: { tenant: true },
            });
        } else if (!user.microsoftId) {
            user = await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    microsoftId: microsoftUser.microsoftId,
                    picture: microsoftUser.picture || user.picture,
                },
                include: { tenant: true },
            });
        } else if (microsoftUser.picture && microsoftUser.picture !== user.picture) {
            user = await this.prisma.user.update({
                where: { id: user.id },
                data: { picture: microsoftUser.picture },
                include: { tenant: true },
            });
        }

        if (!isNewUser) {
            await this.enforceSessionPolicy(user, force);
        }

        if (!isNewUser && user.twoFactorEnabled) {
            const twoFAToken = this.generate2FAToken(user.id);
            return {
                requires2FA: true,
                twoFAToken,
                twoFactorMethod: user.twoFactorMethod || 'totp',
                user: { email: user.email, firstName: user.firstName },
            };
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });

        const sid = await this.createSession(user.id, user.tenantId || undefined);

        const payload: JwtPayload = {
            sub: user.id, email: user.email,
            role: user.role as UserRole, tenantId: user.tenantId || undefined,
        };

        const { accessToken, refreshToken } = await this.generateTokens(payload, { rememberMe, sid });
        const effectiveOnboarding = user.role === 'super_admin' || !!user.tenantId || user.onboardingCompleted;

        return {
            requires2FA: false,
            accessToken, refreshToken,
            user: {
                id: user.id, email: user.email,
                firstName: user.firstName, lastName: user.lastName,
                role: user.role, tenantId: user.tenantId,
                tenantName: user.tenant?.name,
                picture: user.picture,
                hasPassword: !!user.password,
                emailVerified: user.emailVerified,
                onboardingCompleted: effectiveOnboarding,
            },
        };
    }

    // ── Password setup ────────────────────────────────────────────

    async setupPassword(userId: string, password: string) {
        this.validatePasswordStrength(password);

        const hashedPassword = await bcrypt.hash(password, 12);
        const user = await this.prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });

        // Notify password change
        this.emailService.send({
            to: user.email,
            subject: 'Tu contrasena ha sido cambiada — Parallly',
            html: passwordChangedEmail(user.firstName),
        });

        return { message: 'Password set successfully' };
    }

    // ── Email verification ────────────────────────────────────────

    async sendVerificationEmail(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const code = String(crypto.randomInt(100000, 1000000));
        const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await this.prisma.user.update({
            where: { id: userId },
            data: { emailVerifyCode: code, emailVerifyExpires: expires },
        });

        await this.emailService.send({
            to: user.email,
            subject: 'Tu codigo de verificacion — Parallly',
            html: verificationEmail(user.firstName, code),
        });

        return { message: 'Verification code sent' };
    }

    async verifyEmailCode(userId: string, code: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        if (!user.emailVerifyCode || !user.emailVerifyExpires ||
            user.emailVerifyExpires < new Date() ||
            !this.timingSafeEqual(user.emailVerifyCode, code)) {
            throw new BadRequestException('Invalid or expired verification code');
        }

        await this.prisma.user.update({
            where: { id: userId },
            data: { emailVerified: true, emailVerifyCode: null, emailVerifyExpires: null },
        });

        return { message: 'Email verified successfully' };
    }

    // ── Password reset (public, no JWT) ──────────────────────────

    async requestPasswordReset(email: string) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        // Always return success to avoid email enumeration
        if (!user || !user.isActive) return { message: 'If the email exists, a code was sent' };

        const code = String(crypto.randomInt(100000, 1000000));
        const expires = new Date(Date.now() + 10 * 60 * 1000);

        await this.prisma.user.update({
            where: { id: user.id },
            data: { emailVerifyCode: code, emailVerifyExpires: expires },
        });

        await this.emailService.send({
            to: user.email,
            subject: 'Restablece tu contrasena — Parallly',
            html: passwordResetEmail(user.firstName, code),
        });

        return { message: 'If the email exists, a code was sent' };
    }

    async confirmPasswordReset(email: string, code: string, newPassword: string) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user) throw new BadRequestException('Invalid or expired code');

        if (!user.emailVerifyCode || !user.emailVerifyExpires ||
            user.emailVerifyExpires < new Date() ||
            !this.timingSafeEqual(user.emailVerifyCode, code)) {
            throw new BadRequestException('Invalid or expired code');
        }

        this.validatePasswordStrength(newPassword);

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                emailVerifyCode: null,
                emailVerifyExpires: null,
            },
        });

        await this.revokeAllUserSessions(user.id);
        await this.destroySession(user.id);

        this.emailService.send({
            to: user.email,
            subject: 'Tu contrasena ha sido cambiada — Parallly',
            html: passwordChangedEmail(user.firstName),
        });

        return { message: 'Password reset successfully' };
    }

    // ── 2FA ───────────────────────────────────────────────────────

    private generateBackupCodes(): string[] {
        return Array.from({ length: BACKUP_CODE_COUNT }, () =>
            crypto.randomBytes(4).toString('hex').toUpperCase(),
        );
    }

    private async hashBackupCodes(codes: string[]): Promise<string[]> {
        return Promise.all(codes.map(c => bcrypt.hash(c, 10)));
    }

    private generate2FAToken(userId: string): string {
        return this.jwtService.sign(
            { sub: userId, purpose: '2fa' },
            {
                secret: this.configService.get<string>('auth.jwtSecret'),
                expiresIn: `${TWO_FA_TOKEN_TTL}s`,
            },
        );
    }

    verify2FAToken(token: string): string {
        try {
            const decoded = this.jwtService.verify(token, {
                secret: this.configService.get<string>('auth.jwtSecret'),
            });
            if (decoded.purpose !== '2fa') throw new Error();
            return decoded.sub;
        } catch {
            throw new UnauthorizedException('Invalid or expired 2FA token');
        }
    }

    async get2FAStatus(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true, twoFactorMethod: true } });
        if (!user) throw new NotFoundException('User not found');
        return { enabled: user.twoFactorEnabled, method: user.twoFactorMethod };
    }

    async setup2FA(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        if (user.twoFactorEnabled) {
            throw new BadRequestException('2FA is already enabled');
        }

        const secretObj = new Secret();
        const secret = secretObj.base32;
        const totp = new TOTP({ issuer: 'Parallly', label: user.email, secret: secretObj });
        const otpauthUrl = totp.toString();
        const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

        await this.prisma.user.update({
            where: { id: userId },
            data: { twoFactorSecret: this.encryptTotpSecret(secret) },
        });

        return { secret, otpauthUrl, qrCodeDataUrl };
    }

    async verifySetup2FA(userId: string, code: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        if (user.twoFactorEnabled) {
            throw new BadRequestException('2FA is already enabled');
        }
        if (!user.twoFactorSecret) {
            throw new BadRequestException('Run setup first');
        }

        const decryptedSecret = this.decryptTotpSecret(user.twoFactorSecret);
        const verifyTotp = new TOTP({ secret: Secret.fromBase32(decryptedSecret) });
        const isValid = verifyTotp.validate({ token: code, window: 1 }) !== null;
        if (!isValid) {
            throw new BadRequestException('Invalid code. Make sure your authenticator app is synced.');
        }

        const backupCodes = this.generateBackupCodes();
        const hashedCodes = await this.hashBackupCodes(backupCodes);

        await this.prisma.user.update({
            where: { id: userId },
            data: {
                twoFactorEnabled: true,
                twoFactorMethod: 'totp',
                backupCodes: hashedCodes,
            },
        });

        this.logger.log(`[2FA] Enabled TOTP for user ${user.email}`);
        return { backupCodes };
    }

    async disable2FA(userId: string, password: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        if (!user.twoFactorEnabled) {
            throw new BadRequestException('2FA is not enabled');
        }

        if (user.password) {
            const valid = await bcrypt.compare(password, user.password);
            if (!valid) throw new UnauthorizedException('Incorrect password');
        }

        await this.prisma.user.update({
            where: { id: userId },
            data: {
                twoFactorEnabled: false,
                twoFactorSecret: null,
                twoFactorMethod: null,
                backupCodes: [],
            },
        });

        await this.revokeAllTrustedDevices(userId);
        this.logger.log(`[2FA] Disabled for user ${user.email}`);
        return { message: '2FA disabled' };
    }

    async regenerateBackupCodes(userId: string, password: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        if (!user.twoFactorEnabled) {
            throw new BadRequestException('2FA is not enabled');
        }

        if (user.password) {
            const valid = await bcrypt.compare(password, user.password);
            if (!valid) throw new UnauthorizedException('Incorrect password');
        }

        const backupCodes = this.generateBackupCodes();
        const hashedCodes = await this.hashBackupCodes(backupCodes);

        await this.prisma.user.update({
            where: { id: userId },
            data: { backupCodes: hashedCodes },
        });

        return { backupCodes };
    }

    async send2FAEmail(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const code = String(crypto.randomInt(100000, 1000000));
        await this.redis.set(`2fa:email:${userId}`, code, 300);

        await this.emailService.send({
            to: user.email,
            subject: 'Tu codigo de autenticacion — Parallly',
            html: twoFactorEmail(user.firstName, code),
        });

        return { message: '2FA code sent to email' };
    }

    async send2FASms(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        if (!user.phone) throw new BadRequestException('No phone number on file for SMS 2FA');

        // Rate-limit SMS sends per user — SMS costs money (unlike the email fallback),
        // so an unthrottled endpoint would allow SMS-bombing the user's number.
        const rate = await this.redis.incrementRateLimit(`2fa:sms:rate:${userId}`, 3600);
        if (rate > 3) throw new BadRequestException('Too many SMS requests. Please wait a while or use email.');

        const code = String(crypto.randomInt(100000, 1000000));
        await this.redis.set(`2fa:sms:${userId}`, code, 300);

        const to = normalizePhoneE164(user.phone) || user.phone;
        const sent = await this.platformSms.sendTo(to, `Parallly: tu codigo de acceso es ${code}. Valido 5 minutos.`);
        if (!sent) throw new BadRequestException('SMS delivery unavailable. Try email instead.');

        return { message: '2FA code sent via SMS' };
    }

    async verify2FA(
        twoFAToken: string, code: string, method: 'totp' | 'email' | 'backup' | 'sms', rememberMe = false,
        trustDevice = false, deviceInfo?: { userAgent?: string; screenWidth?: number; screenHeight?: number; timezone?: string; language?: string; ip?: string },
    ) {
        const userId = this.verify2FAToken(twoFAToken);

        const attemptKey = `2fa:attempts:${userId}`;
        const attempts = parseInt(await this.redis.get(attemptKey) || '0', 10);
        if (attempts >= 5) {
            throw new BadRequestException('Too many failed attempts. Please wait 15 minutes and try again.');
        }

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { tenant: true },
        });
        if (!user) throw new NotFoundException('User not found');

        let valid = false;

        if (method === 'totp') {
            if (!user.twoFactorSecret) throw new BadRequestException('TOTP not configured');
            const decrypted = this.decryptTotpSecret(user.twoFactorSecret);
            const t = new TOTP({ secret: Secret.fromBase32(decrypted) });
            valid = t.validate({ token: code, window: 1 }) !== null;
        } else if (method === 'email') {
            const storedCode = await this.redis.get(`2fa:email:${userId}`);
            if (storedCode && storedCode === code) {
                valid = true;
                await this.redis.del(`2fa:email:${userId}`);
            }
        } else if (method === 'sms') {
            const storedCode = await this.redis.get(`2fa:sms:${userId}`);
            if (storedCode && storedCode === code) {
                valid = true;
                await this.redis.del(`2fa:sms:${userId}`);
            }
        } else if (method === 'backup') {
            const normalized = code.toUpperCase().replace(/\s/g, '');
            for (let i = 0; i < user.backupCodes.length; i++) {
                const match = await bcrypt.compare(normalized, user.backupCodes[i]);
                if (match) {
                    valid = true;
                    const updated = [...user.backupCodes];
                    updated.splice(i, 1);
                    await this.prisma.user.update({
                        where: { id: userId },
                        data: { backupCodes: updated },
                    });
                    break;
                }
            }
        }

        if (!valid) {
            await this.redis.set(attemptKey, String(attempts + 1), 900);
            this.logger.warn(`[2FA] Failed attempt ${attempts + 1}/5 for user ${user.email} (method: ${method})`);
            throw new BadRequestException('Invalid or expired code');
        }

        await this.redis.del(attemptKey);
        const sid = await this.createSession(user.id, user.tenantId || undefined);
        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role as UserRole,
            tenantId: user.tenantId || undefined,
        };
        const { accessToken, refreshToken } = await this.generateTokens(payload, { rememberMe, sid });

        const effectiveOnboarding = user.role === 'super_admin' || !!user.tenantId || user.onboardingCompleted;

        let deviceTrustToken: string | undefined;
        if (trustDevice && deviceInfo) {
            deviceTrustToken = await this.registerTrustedDevice(user.id, deviceInfo);
        }

        return {
            accessToken,
            refreshToken,
            deviceTrustToken,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                tenantId: user.tenantId,
                tenantName: user.tenant?.name,
                picture: user.picture,
                hasPassword: !!user.password,
                emailVerified: user.emailVerified,
                onboardingCompleted: effectiveOnboarding,
            },
        };
    }

    // ── Trusted Devices ─────────────────────────────────────────

    private parseDeviceName(userAgent?: string): string {
        if (!userAgent) return 'Unknown Device';
        const ua = userAgent.toLowerCase();
        let browser = 'Browser';
        if (ua.includes('edg/')) browser = 'Edge';
        else if (ua.includes('chrome') && !ua.includes('edg')) browser = 'Chrome';
        else if (ua.includes('firefox')) browser = 'Firefox';
        else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
        else if (ua.includes('opera') || ua.includes('opr')) browser = 'Opera';

        let os = '';
        if (ua.includes('windows')) os = 'Windows';
        else if (ua.includes('macintosh') || ua.includes('mac os')) os = 'macOS';
        else if (ua.includes('linux') && !ua.includes('android')) os = 'Linux';
        else if (ua.includes('android')) os = 'Android';
        else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

        return os ? `${browser} on ${os}` : browser;
    }

    private computeFingerprint(info: { userAgent?: string; screenWidth?: number; screenHeight?: number; timezone?: string; language?: string }): string {
        const raw = `${info.userAgent || ''}|${info.screenWidth || 0}x${info.screenHeight || 0}|${info.timezone || ''}|${info.language || ''}`;
        return crypto.createHash('sha256').update(raw).digest('hex');
    }

    async registerTrustedDevice(userId: string, deviceInfo: {
        userAgent?: string; screenWidth?: number; screenHeight?: number;
        timezone?: string; language?: string; ip?: string;
    }): Promise<string> {
        const existingCount = await this.prisma.trustedDevice.count({
            where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
        });
        if (existingCount >= MAX_TRUSTED_DEVICES) {
            const oldest = await this.prisma.trustedDevice.findFirst({
                where: { userId, isRevoked: false },
                orderBy: { lastUsedAt: 'asc' },
            });
            if (oldest) {
                await this.prisma.trustedDevice.update({
                    where: { id: oldest.id },
                    data: { isRevoked: true },
                });
            }
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const fingerprintHash = this.computeFingerprint(deviceInfo);
        const deviceName = this.parseDeviceName(deviceInfo.userAgent);
        const expiresAt = new Date(Date.now() + DEVICE_TRUST_TTL_DAYS * 24 * 60 * 60 * 1000);

        await this.prisma.trustedDevice.create({
            data: {
                userId,
                tokenHash,
                deviceName,
                userAgent: deviceInfo.userAgent?.substring(0, 500),
                fingerprintHash,
                ipAddress: deviceInfo.ip,
                expiresAt,
            },
        });

        // Cache in Redis for fast lookup
        await this.redis.setJson(`trust:${tokenHash}`, { userId, expiresAt: expiresAt.toISOString() }, DEVICE_TRUST_TTL_DAYS * 24 * 60 * 60);

        // Send email notification
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true } });
        if (user) {
            this.emailService.send({
                to: user.email,
                subject: 'Nuevo dispositivo de confianza — Parallly',
                html: newTrustedDeviceEmail(user.firstName, deviceName, deviceInfo.ip || 'Unknown', new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
            }).catch(() => { /* best effort */ });
        }

        this.logger.log(`[TrustedDevice] Registered "${deviceName}" for user ${userId}`);
        return rawToken;
    }

    async verifyTrustedDevice(userId: string, rawToken: string, fingerprint?: string): Promise<boolean> {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        // Fast path: Redis cache
        const cached = await this.redis.getJson<{ userId: string; expiresAt: string }>(`trust:${tokenHash}`);
        if (cached) {
            if (cached.userId !== userId || new Date(cached.expiresAt) < new Date()) {
                return false;
            }
            // Update last used
            this.prisma.trustedDevice.updateMany({
                where: { tokenHash, isRevoked: false },
                data: { lastUsedAt: new Date() },
            }).catch(() => { /* best effort */ });
            return true;
        }

        // Slow path: DB lookup
        const device = await this.prisma.trustedDevice.findUnique({ where: { tokenHash } });
        if (!device || device.isRevoked || device.userId !== userId || device.expiresAt < new Date()) {
            return false;
        }

        // Re-cache
        const ttlMs = device.expiresAt.getTime() - Date.now();
        if (ttlMs > 0) {
            await this.redis.setJson(`trust:${tokenHash}`, { userId, expiresAt: device.expiresAt.toISOString() }, Math.ceil(ttlMs / 1000));
        }

        await this.prisma.trustedDevice.update({
            where: { id: device.id },
            data: { lastUsedAt: new Date() },
        });

        return true;
    }

    async listTrustedDevices(userId: string) {
        const devices = await this.prisma.trustedDevice.findMany({
            where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
            select: {
                id: true, deviceName: true, ipAddress: true,
                createdAt: true, lastUsedAt: true, expiresAt: true,
            },
            orderBy: { lastUsedAt: 'desc' },
        });
        return devices;
    }

    async revokeTrustedDevice(userId: string, deviceId: string) {
        const device = await this.prisma.trustedDevice.findFirst({
            where: { id: deviceId, userId },
        });
        if (!device) throw new NotFoundException('Device not found');

        await this.prisma.trustedDevice.update({
            where: { id: deviceId },
            data: { isRevoked: true },
        });

        // Remove from Redis cache
        await this.redis.del(`trust:${device.tokenHash}`);
        this.logger.log(`[TrustedDevice] Revoked device ${device.deviceName} for user ${userId}`);
        return { message: 'Device revoked' };
    }

    async revokeAllTrustedDevices(userId: string) {
        const devices = await this.prisma.trustedDevice.findMany({
            where: { userId, isRevoked: false },
            select: { id: true, tokenHash: true },
        });

        if (devices.length === 0) return;

        await this.prisma.trustedDevice.updateMany({
            where: { userId, isRevoked: false },
            data: { isRevoked: true },
        });

        // Remove all from Redis cache
        for (const d of devices) {
            await this.redis.del(`trust:${d.tokenHash}`);
        }

        this.logger.log(`[TrustedDevice] Revoked all ${devices.length} devices for user ${userId}`);
    }

    // ── Change password (authenticated) ──────────────────────────

    async changePassword(userId: string, currentPassword: string, newPassword: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        if (!user.password) {
            throw new BadRequestException('This account uses Google sign-in. Set a password first.');
        }

        const isValid = await bcrypt.compare(currentPassword, user.password);
        if (!isValid) {
            throw new UnauthorizedException('Current password is incorrect');
        }

        this.validatePasswordStrength(newPassword);

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await this.prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });

        // Revoke all sessions + trusted devices — user must re-login with new password
        await this.revokeAllUserSessions(userId);
        await this.destroySession(userId);
        await this.revokeAllTrustedDevices(userId);

        this.emailService.send({
            to: user.email,
            subject: 'Tu contrasena ha sido cambiada — Parallly',
            html: passwordChangedEmail(user.firstName),
        });

        return { message: 'Password changed successfully' };
    }

    // ── Profile update ──────────────────────────────────────────

    async updateProfile(userId: string, data: { firstName?: string; lastName?: string; phone?: string; jobTitle?: string }) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const updated = await this.prisma.user.update({
            where: { id: userId },
            data: {
                ...(data.firstName && { firstName: data.firstName }),
                ...(data.lastName && { lastName: data.lastName }),
                ...(data.phone !== undefined && { phone: data.phone }),
                ...(data.jobTitle !== undefined && { jobTitle: data.jobTitle }),
            },
            select: {
                id: true, email: true, firstName: true, lastName: true,
                role: true, tenantId: true, phone: true, jobTitle: true,
            },
        });

        return updated;
    }

    // ── Onboarding completion ─────────────────────────────────────

    async completeOnboarding(userId: string, data: any) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        // Accept nested format from onboarding wizard
        const company = data.company || {};
        const companyName = company.name || data.companyName;
        const website = company.website || data.website;
        const socialLinks = company.socialMedia || data.socialLinks;
        const industry = company.industry || data.industry;
        const companySize = company.orgSize || data.companySize;
        const timezone = company.timezone || data.timezone || 'America/Bogota';
        const customerTypes = data.audiences || data.customerTypes;
        const chatReasons = data.goals || data.chatReasons;
        const referralSource = data.referral || data.referralSource;

        // Generate slug from company name
        const slug = companyName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

        // Check slug uniqueness
        const existingTenant = await this.prisma.tenant.findUnique({
            where: { slug },
        });
        if (existingTenant) {
            throw new ConflictException('A company with a similar name already exists');
        }

        const schemaName = `tenant_${slug.replace(/-/g, '_')}`;

        // Atomic transaction: create tenant + link user
        const result = await this.prisma.$transaction(async (tx: any) => {
            // 1. Create tenant with settings JSONB
            const tenant = await tx.tenant.create({
                data: {
                    name: companyName,
                    slug,
                    industry: industry || 'other',
                    schemaName,
                    plan: 'starter',
                    language: 'es-CO',
                    settings: {
                        website,
                        socialLinks,
                        companySize,
                        timezone,
                        customerTypes,
                        chatReasons,
                        referralSource,
                    },
                    // Funnel stage stamp — onboarding complete = step 2 of the funnel
                    onboardingCompletedAt: new Date(),
                    signupSource: data.signupSource || referralSource || null,
                },
            });

            // 2. Link user to tenant and mark onboarding complete
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    tenantId: tenant.id,
                    role: 'tenant_admin',
                    onboardingCompleted: true,
                },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    tenantId: true,
                    onboardingCompleted: true,
                },
            });

            // 3. Audit log
            await tx.auditLog.create({
                data: {
                    tenantId: tenant.id,
                    userId: user.id,
                    action: 'onboarding_completed',
                    resource: 'tenant',
                    details: { companyName, slug, email: user.email },
                },
            });

            return { tenant, user: updatedUser };
        });

        // 4. Create isolated DB schema (outside transaction — DDL cannot be rolled back)
        try {
            await this.prisma.createTenantSchema(result.tenant.schemaName);
        } catch (error) {
            console.error(`[Onboarding] Failed to create schema "${result.tenant.schemaName}":`, error);
        }

        // 5. Create default AI agent based on onboarding goals
        const goals: string[] = Array.isArray(chatReasons) ? chatReasons : [];
        try {
            await this.personaService.createDefaultAgentFromGoals(
                result.tenant.id,
                goals,
                user.email || 'onboarding',
                industry || undefined,
            );
        } catch (error) {
            console.error(`[Onboarding] Failed to create default agent for "${result.tenant.schemaName}":`, error);
        }

        // 6. Persist Business Identity so the agent has company context from
        // day one — otherwise <turn.business> would be empty until the user
        // manually filled Settings → Business Info.
        try {
            const phone = company.phone || data.phone;
            const email = company.email || data.businessEmail;
            const about = company.about || data.about;
            await this.businessInfoService.upsertPrimary(result.tenant.id, {
                companyName,
                industry: industry || undefined,
                website: website || undefined,
                phone: phone || undefined,
                email: email || undefined,
                about: about || undefined,
                socialLinks: socialLinks || undefined,
            });
        } catch (error) {
            console.error(`[Onboarding] Failed to persist business identity for "${result.tenant.schemaName}":`, error);
        }

        // 6.5. Bootstrap vertical-specific defaults (pipeline stages, agent persona, FAQs, services)
        let verticalConfig: any = null;
        try {
            const tenantLang = (timezone?.includes('America') ? 'es' : 'en');
            const verticalIndustry = industry || 'otro';
            const verticalSubType = data.subType || company.subType || null;
            console.log(`[Onboarding] Starting vertical bootstrap: industry="${verticalIndustry}", subType="${verticalSubType}", lang="${tenantLang}", tenant="${result.tenant.id}"`);
            await this.verticalsService.bootstrapVertical(
                result.tenant.id,
                verticalIndustry,
                verticalSubType,
                tenantLang,
            );
            verticalConfig = await this.verticalsService.getVerticalConfig(result.tenant.id);
            console.log(`[Onboarding] Vertical bootstrap completed successfully for "${result.tenant.schemaName}"`);
        } catch (error: any) {
            console.error(`[Onboarding] Failed vertical bootstrap for "${result.tenant.schemaName}":`, error?.message || error);
        }

        // 7. Create the trial subscription. The onboarding wizard may pass
        // `plan` (slug) and `cardTokenId` — defaults to starter with no card
        // so an empty body still produces a valid TRIALING subscription. Any
        // failure here is logged but does NOT roll back the tenant — the
        // founder can retry billing activation from the dashboard later.
        try {
            const planSlug = (data.plan || data.planSlug || 'starter') as string;
            const cardTokenId = data.cardTokenId as string | undefined;
            const billingEmail = company.email || data.businessEmail || user.email;
            const billingCountry = (company.country || data.billingCountry || this.inferCountryFromTimezone(timezone)) as string;
            await this.billingService.createTrialSubscription({
                tenantId: result.tenant.id,
                planSlug,
                billingEmail,
                billingCountry,
                cardTokenId,
            });
        } catch (error: any) {
            // If Pro/Enterprise was chosen without a card we intentionally
            // throw upstream — the dashboard UI will have validated it, but
            // if somebody hits the API directly, they should get a clear error.
            // Re-throw so the onboarding reports it.
            if (error?.response?.error === 'card_required_for_trial' || error?.response?.error === 'plan_not_found') {
                throw error;
            }
            console.error(`[Onboarding] Failed to create billing subscription for "${result.tenant.schemaName}":`, error);
        }

        // 8. Update session with tenantId + generate new JWT tokens
        const existingSession = await this.redis.getJson<SessionData>(`session:${result.user.id}`);
        const sid = existingSession?.sid || await this.createSession(result.user.id, result.user.tenantId || undefined);
        if (existingSession && result.user.tenantId) {
            existingSession.tenantId = result.user.tenantId;
            await this.redis.setJson(`session:${result.user.id}`, existingSession, SESSION_TTL);
            await this.redis.sadd(`tenant_sessions:${result.user.tenantId}`, result.user.id);
        }

        const payload: JwtPayload = {
            sub: result.user.id,
            email: result.user.email,
            role: result.user.role as UserRole,
            tenantId: result.user.tenantId || undefined,
        };

        const { accessToken, refreshToken } = await this.generateTokens(payload, { sid });

        return {
            accessToken,
            refreshToken,
            user: {
                id: result.user.id,
                email: result.user.email,
                firstName: result.user.firstName,
                lastName: result.user.lastName,
                role: result.user.role,
                tenantId: result.user.tenantId,
                tenantName: result.tenant.name,
                onboardingCompleted: result.user.onboardingCompleted,
            },
            verticalConfig,
        };
    }

    // ── Super Admin Impersonation ──────────────────────────────────

    /**
     * Generate short-lived tokens (1 hour) for a super_admin to impersonate
     * a tenant_admin in the given tenant. Tokens carry impersonation metadata
     * so audit trails can distinguish real from impersonated sessions.
     *
     * A reason is required: an act-as session that nobody can justify after the
     * fact is indistinguishable from an intrusion. The paired closing row is
     * written by endImpersonation().
     */
    async impersonate(
        superAdminId: string,
        tenantId: string,
        access: { reason: string; ticketId?: string },
    ): Promise<{ accessToken: string; refreshToken: string; user: any; sessionId: string; expiresInSeconds: number }> {
        // Verify the caller is actually a super_admin
        const superAdmin = await this.prisma.user.findUnique({ where: { id: superAdminId } });
        if (!superAdmin || superAdmin.role !== 'super_admin') {
            throw new UnauthorizedException('Only super_admin can impersonate');
        }

        // Verify tenant exists
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) {
            throw new NotFoundException(`Tenant ${tenantId} not found`);
        }

        // Find the first tenant_admin user for this tenant
        const targetUser = await this.prisma.user.findFirst({
            where: { tenantId, role: 'tenant_admin', isActive: true },
            orderBy: { createdAt: 'asc' },
        });

        if (!targetUser) {
            throw new NotFoundException(`No active tenant_admin found for tenant ${tenantId}`);
        }

        const tokenId = crypto.randomUUID();

        // Generate a short-lived access token (1 hour)
        const payload: JwtPayload = {
            sub: targetUser.id,
            email: targetUser.email,
            role: targetUser.role as UserRole,
            tenantId: targetUser.tenantId || undefined,
        };
        const delegation = {
            impersonatedBy: superAdminId,
            isImpersonation: true,
            impersonationSid: tokenId,
        };

        const accessToken = this.jwtService.sign(
            { ...payload, ...delegation },
            {
                secret: this.configService.get<string>('auth.jwtSecret'),
                expiresIn: '1h',
            },
        );

        // Generate a matching refresh token (also 1 hour)
        const refreshToken = this.jwtService.sign(
            { ...payload, tid: tokenId, ...delegation },
            {
                secret: this.configService.get<string>('auth.jwtRefreshSecret'),
                expiresIn: '1h',
            },
        );

        // Store refresh token in Redis with 1h TTL
        const redisKey = `refresh:${payload.sub}:${tokenId}`;
        await this.redis.setJson(redisKey, {
            userId: payload.sub,
            impersonatedBy: superAdminId,
            isImpersonation: true,
            createdAt: Date.now(),
        }, 3600);

        // Persisted trail. Without this the only record of a super_admin entering
        // a tenant's workspace is a Redis key that self-destructs in an hour, so
        // "who accessed my account and when" is unanswerable after the fact.
        // userId is the REAL actor (the super_admin), never the impersonated user.
        await this.prisma.auditLog.create({
            data: {
                tenantId,
                userId: superAdminId,
                action: 'super_admin.impersonation_started',
                resource: 'tenant',
                details: {
                    superAdminEmail: superAdmin.email,
                    impersonatedUserId: targetUser.id,
                    impersonatedEmail: targetUser.email,
                    tenantName: tenant.name,
                    tenantSlug: tenant.slug,
                    sessionId: tokenId,
                    expiresInSeconds: 3600,
                    reason: access.reason,
                    ticketId: access.ticketId || null,
                },
            },
        }).catch((e) => {
            // Never block the session on an audit write, but make the miss loud.
            this.logger.error(`Failed to persist impersonation audit for tenant ${tenantId}: ${e?.message}`);
        });

        this.logger.log(
            `Impersonation started: super_admin ${superAdmin.email} → tenant ${tenant.slug} (session ${tokenId}, reason: ${access.reason})`,
        );

        return {
            accessToken,
            refreshToken,
            sessionId: tokenId,
            expiresInSeconds: 3600,
            // The dashboard swaps this into its stored session. Without it the
            // browser kept the super_admin user object, so the UI believed it was
            // still in platform mode while holding a tenant token.
            user: {
                id: targetUser.id,
                email: targetUser.email,
                firstName: targetUser.firstName,
                lastName: targetUser.lastName,
                role: targetUser.role,
                tenantId: targetUser.tenantId,
                tenantName: tenant.name,
                emailVerified: true,
                onboardingCompleted: true,
            },
        };
    }

    /**
     * Close an impersonation session: revoke the short-lived refresh token and
     * write the paired audit row. Called with the operator's OWN token, so the
     * actor recorded here is the real super_admin.
     *
     * A start without an end is not an audit trail, only a record of intent —
     * without this the exposure window of a privileged session is unbounded.
     */
    async endImpersonation(
        superAdminId: string,
        params: { tenantId: string; sessionId?: string; impersonatedUserId?: string },
    ): Promise<{ ended: boolean }> {
        const superAdmin = await this.prisma.user.findUnique({ where: { id: superAdminId } });
        if (!superAdmin || superAdmin.role !== 'super_admin') {
            throw new UnauthorizedException('Only super_admin can end an impersonation session');
        }

        // Kill the impersonated refresh token so the session cannot be resumed
        // from a copied token after the operator "exited".
        if (params.sessionId && params.impersonatedUserId) {
            await this.redis
                .del(`refresh:${params.impersonatedUserId}:${params.sessionId}`)
                .catch(() => { /* best effort — the key expires within the hour anyway */ });
        }

        let startedAt: Date | null = null;
        if (params.sessionId) {
            const startRow = await this.prisma.auditLog.findFirst({
                where: {
                    tenantId: params.tenantId,
                    action: 'super_admin.impersonation_started',
                    details: { path: ['sessionId'], equals: params.sessionId },
                },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true },
            }).catch(() => null);
            startedAt = startRow?.createdAt ?? null;
        }

        await this.prisma.auditLog.create({
            data: {
                tenantId: params.tenantId,
                userId: superAdminId,
                action: 'super_admin.impersonation_ended',
                resource: 'tenant',
                details: {
                    superAdminEmail: superAdmin.email,
                    sessionId: params.sessionId || null,
                    impersonatedUserId: params.impersonatedUserId || null,
                    startedAt: startedAt ? startedAt.toISOString() : null,
                    durationSeconds: startedAt
                        ? Math.round((Date.now() - startedAt.getTime()) / 1000)
                        : null,
                },
            },
        }).catch((e) => {
            this.logger.error(`Failed to persist impersonation-end audit for tenant ${params.tenantId}: ${e?.message}`);
        });

        this.logger.log(`Impersonation ended: super_admin ${superAdmin.email} → tenant ${params.tenantId} (session ${params.sessionId || 'unknown'})`);

        return { ended: true };
    }

    /**
     * Best-effort country inference from the tenant's picked timezone. Used
     * only when the onboarding wizard did not include an explicit country —
     * gives BillingService's country-aware resolver a sensible default so
     * Starter tenants from Argentina don't get Colombian MP plan ids.
     * Expand this list as we onboard more countries.
     */
    private timingSafeEqual(a: string, b: string): boolean {
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }

    private encryptTotpSecret(plaintext: string): string {
        const key = process.env.ENCRYPTION_KEY;
        if (!key || key.length < 32) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error('ENCRYPTION_KEY is required in production — cannot store TOTP secrets without encryption');
            }
            return plaintext;
        }
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex').subarray(0, 32), iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${tag}:${encrypted}`;
    }

    private decryptTotpSecret(ciphertext: string): string {
        const key = process.env.ENCRYPTION_KEY;
        if (!key || key.length < 32) {
            return ciphertext;
        }
        if (!ciphertext.includes(':')) {
            return ciphertext;
        }
        const [ivHex, tagHex, encryptedHex] = ciphertext.split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex').subarray(0, 32), Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    private inferCountryFromTimezone(tz: string | undefined): string {
        if (!tz) return 'CO';
        const map: Record<string, string> = {
            'America/Bogota': 'CO',
            'America/Mexico_City': 'MX',
            'America/Argentina/Buenos_Aires': 'AR',
            'America/Santiago': 'CL',
            'America/Lima': 'PE',
            'America/Montevideo': 'UY',
            'America/Sao_Paulo': 'BR',
            'America/Guayaquil': 'EC',
            'America/Caracas': 'VE',
        };
        return map[tz] || 'CO';
    }
}
