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
import { CouponsService } from '../billing/coupons.service';
import { VerticalsService, VERTICAL_PROVISIONING_VERSION } from '../verticals/verticals.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PlatformSmsService } from './platform-sms.service';
// Solo TIPOS desde @parallext/shared: ese paquete expone TypeScript crudo, así que
// un import de valor haría que el JS compilado lo require() y el arranque muera.
import { JwtPayload, UserRole } from '@parallext/shared';
import { TIMEZONE_COUNTRY, SPANISH_SPEAKING_COUNTRIES } from '../../common/utils/billing-country.util';
import { validateEmailDomain } from '../../common/utils/email.util';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import {
    InvalidVerticalSelectionError,
    resolveVerticalSelection,
} from '../verticals/vertical-identifiers';
import { LockOwnershipLostError, OwnedLockLease } from '../../common/utils/owned-lock.util';
import { mergeTenantSettingsAtomic } from '../../common/utils/tenant-settings.util';
import {
    resolveReadyTenantContext,
    resolveReadyUserTenantContext,
    TENANT_LIFECYCLE_LOCK_TTL_SECONDS,
    tenantLifecycleLockKey,
    tenantPurgingFenceKey,
} from '../../common/utils/tenant-lifecycle.util';
import {
    verificationEmail, passwordResetEmail, twoFactorEmail,
    welcomeEmail, passwordChangedEmail, newTrustedDeviceEmail,
} from '../email/email-layouts';

interface SessionData {
    sid: string;
    tenantId?: string;
    loginAt: number;
    lastActivity: number;
    clientType?: 'web' | 'mobile';
}

// Refresh token TTLs (seconds)
const REFRESH_TTL_DEFAULT = 8 * 60 * 60;       // 8 hours (one work shift)
const REFRESH_TTL_REMEMBER = 14 * 24 * 60 * 60; // 14 days

const SESSION_TTL = 360; // 6 min — refreshed by activity ping (frontend sends every 5 min)
// La app móvil NO tiene activity-ping (y no debe: el teléfono pasa horas en el
// bolsillo). Su sesión vive lo que su refresh window de rememberMe: el refresh
// token rotativo de un solo uso es la autoridad real. Con el TTL web de 6 min,
// cada background >6 min terminaba en "please log in again".
const SESSION_TTL_MOBILE = REFRESH_TTL_REMEMBER; // 14 días

/** 'web' (default, compat con todo lo existente) | 'mobile' (app RN). */
type ClientType = 'web' | 'mobile';
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
        private couponsService: CouponsService,
        private verticalsService: VerticalsService,
        private throttleService: TenantThrottleService,
        private platformSms: PlatformSmsService,
    ) { }

    /** Public for SAML and any boundary that must mint a tenant-scoped session. */
    async resolveReadyTenantIdForUser(userId: string, claimedTenantId?: string | null): Promise<string | undefined> {
        return (await resolveReadyUserTenantContext(this.prisma, this.redis, userId, claimedTenantId))?.tenantId;
    }

    // ── Token helpers ─────────────────────────────────────────────

    /**
     * Generate access + refresh token pair.
     * Stores refresh token hash in Redis for validation & rotation.
     */
    private async generateTokens(
        payload: JwtPayload,
        options: { rememberMe?: boolean; sid?: string; clientType?: ClientType } = {},
    ): Promise<{ accessToken: string; refreshToken: string }> {
        // El claim `client` viaja en access y refresh: validateUser/refreshToken
        // resuelven con él la clave de sesión correcta (web vs mobile).
        const base: any = options.clientType === 'mobile' ? { ...payload, client: 'mobile' } : { ...payload };
        const tokenPayload = options.sid ? { ...base, sid: options.sid } : base;

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
            clientType: options.clientType || 'web',
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
     * Revoke refresh tokens for a user. Sin clientType (p. ej. cambio de
     * contraseña) revoca TODO; con clientType revoca solo los tokens de esa
     * plataforma — un force-login web no debe matar la sesión del teléfono.
     */
    async revokeAllUserSessions(userId: string, clientType?: ClientType): Promise<void> {
        const client = this.redis.getClient();
        const pattern = `refresh:${userId}:*`;
        let cursor = '0';
        do {
            const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            if (keys.length > 0) {
                if (!clientType) {
                    await client.del(...keys);
                } else {
                    for (const key of keys) {
                        const meta = await this.redis.getJson<{ clientType?: string }>(key);
                        // Tokens legacy sin clientType = web (compat).
                        const tokenClient = meta?.clientType || 'web';
                        if (tokenClient === clientType) await client.del(key);
                    }
                }
            }
        } while (cursor !== '0');
    }

    // ── Session management ─────────────────────────────────────
    //
    // Sesiones POR TIPO DE CLIENTE: `session:{userId}` (web, clave histórica
    // intacta) y `session:{userId}:mobile` conviven. Antes había UNA sesión por
    // usuario: abrir el dashboard mataba la sesión del teléfono y viceversa —
    // el dueño alternando entre ambos vivía deslogueado.

    private sessionKey(userId: string, clientType?: ClientType): string {
        return clientType === 'mobile' ? `session:${userId}:mobile` : `session:${userId}`;
    }

    private sessionTtl(clientType?: ClientType): number {
        return clientType === 'mobile' ? SESSION_TTL_MOBILE : SESSION_TTL;
    }

    private async createSession(userId: string, tenantId?: string, clientType?: ClientType): Promise<string> {
        const sid = crypto.randomUUID();
        const session: SessionData = {
            sid,
            tenantId: tenantId || undefined,
            loginAt: Date.now(),
            lastActivity: Date.now(),
            clientType: clientType || 'web',
        };
        await this.redis.setJson(this.sessionKey(userId, clientType), session, this.sessionTtl(clientType));
        if (tenantId) {
            await this.redis.sadd(`tenant_sessions:${tenantId}`, userId);
        }
        return sid;
    }

    private async destroySession(userId: string, clientType?: ClientType): Promise<void> {
        const session = await this.redis.getJson<SessionData>(this.sessionKey(userId, clientType));
        await this.redis.del(this.sessionKey(userId, clientType));
        // El asiento (tenant_sessions) es por USUARIO: solo se libera cuando no
        // queda ninguna sesión del usuario en el otro tipo de cliente.
        if (session?.tenantId) {
            const other = await this.redis.get(this.sessionKey(userId, clientType === 'mobile' ? 'web' : 'mobile'));
            if (!other) await this.redis.srem(`tenant_sessions:${session.tenantId}`, userId);
        }
    }

    private async cleanStaleTenantSessions(tenantId: string): Promise<void> {
        const members = await this.redis.smembers(`tenant_sessions:${tenantId}`);
        for (const userId of members) {
            const [web, mobile] = await Promise.all([
                this.redis.get(this.sessionKey(userId, 'web')),
                this.redis.get(this.sessionKey(userId, 'mobile')),
            ]);
            if (!web && !mobile) {
                await this.redis.srem(`tenant_sessions:${tenantId}`, userId);
            }
        }
    }

    private async enforceSessionPolicy(user: { id: string; role: string; tenantId: string | null }, force: boolean, clientType?: ClientType): Promise<void> {
        if (user.role === 'super_admin') return;

        // El conflicto es SOLO contra una sesión del MISMO tipo de cliente:
        // un login móvil nunca pisa (ni pregunta por) la sesión del dashboard.
        const existing = await this.redis.getJson<SessionData>(this.sessionKey(user.id, clientType));
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
            // El asiento es por usuario: si ya ocupa uno (misma u otra plataforma),
            // este login no consume un asiento nuevo.
            const otherClient = await this.redis.get(this.sessionKey(user.id, clientType === 'mobile' ? 'web' : 'mobile'));
            const occupiesSeat = !!existing || !!otherClient;
            if (!occupiesSeat && currentCount >= seatsLimit) {
                throw new ForbiddenException({
                    error: 'tenant_session_limit',
                    message: `Tu empresa ha alcanzado el límite de sesiones concurrentes (${Number.isFinite(seatsLimit) ? seatsLimit : '∞'})`,
                    currentCount,
                    maxAllowed: Number.isFinite(seatsLimit) ? seatsLimit : null,
                });
            }
        }

        if (force && existing) {
            await this.revokeAllUserSessions(user.id, clientType);
            await this.destroySession(user.id, clientType);
        }
    }

    async activityPing(userId: string, clientType?: ClientType): Promise<boolean> {
        const key = this.sessionKey(userId, clientType);
        const exists = await this.redis.get(key);
        if (!exists) return false;
        await this.redis.expire(key, this.sessionTtl(clientType));
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
            // Código estable + mensaje: el dashboard traduce por `error` y ofrece "ir a
            // iniciar sesión". Antes le mostrábamos "Email already registered", en
            // inglés y sin salida, a una PYME en su primer minuto de producto.
            throw new ConflictException({
                error: 'email_taken',
                message: 'Ese correo ya tiene una cuenta.',
            });
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

        // A dead SMTP must not block the signup itself — but the client has to know,
        // so it can show a "we couldn't send the code" notice instead of parking the
        // user on a screen waiting for a mail that will never arrive.
        let verificationEmailSent = false;
        try {
            verificationEmailSent = (await this.sendVerificationEmail(user.id)).sent;
        } catch (error) {
            this.logger.error(`[Signup] Failed to send verification email: ${error}`);
        }

        return {
            accessToken,
            refreshToken,
            verificationEmailSent,
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

    async login(email: string, password: string, rememberMe = false, force = false, deviceTrustToken?: string, deviceFingerprint?: string, clientType?: ClientType) {
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
        await this.enforceSessionPolicy(user, force, clientType);

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
        const readyTenantId = await this.resolveReadyTenantIdForUser(user.id, user.tenantId);
        const sid = await this.createSession(user.id, readyTenantId, clientType);

        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role as UserRole,
            tenantId: readyTenantId,
        };

        const { accessToken, refreshToken } = await this.generateTokens(payload, { rememberMe, sid, clientType });

        const effectiveOnboarding = user.role === 'super_admin' || !!readyTenantId;

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
                tenantId: readyTenantId,
                tenantName: readyTenantId ? user.tenant?.name : undefined,
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

        const clientType: ClientType = decoded.client === 'mobile' ? 'mobile' : 'web';
        const sessionKey = this.sessionKey(userId, clientType);

        // Verify active session if the token had one.
        // SOLO PARA MÓVIL: sesión AUSENTE (TTL vencido) ≠ sid distinto (takeover).
        // El refresh token rotativo de un solo uso es la credencial real: si sigue
        // siendo válido, la sesión móvil se RECREA con su mismo sid en vez de
        // expulsar — antes un teléfono quieto >6 min moría acá con 401.
        // En WEB la semántica de producción se conserva intacta: sesión muerta
        // por TTL = 401 y re-login (es el backstop de inactividad del navegador).
        let sessionRecreated = false;
        if (tokenSid) {
            const session = await this.redis.getJson<SessionData>(sessionKey);
            if (session && session.sid !== tokenSid) {
                throw new UnauthorizedException('Session expired — please log in again');
            }
            if (!session) {
                if (!tokenId || clientType !== 'mobile') {
                    throw new UnauthorizedException('Session expired — please log in again');
                }
                sessionRecreated = true; // se materializa tras validar el refresh en Redis
            }
        }

        if (!tokenId) {
            // Legacy token without tid — still allow but don't rotate
            const user = await this.prisma.user.findUnique({ where: { id: userId } });
            if (!user || !user.isActive) throw new UnauthorizedException('Invalid token');

            const readyTenantId = await this.resolveReadyTenantIdForUser(user.id, user.tenantId);
            const payload: JwtPayload = {
                sub: user.id, email: user.email,
                role: user.role as UserRole, tenantId: readyTenantId,
            };
            const session = await this.redis.getJson<SessionData>(sessionKey);
            const { accessToken, refreshToken: newRefresh } = await this.generateTokens(payload, { sid: session?.sid, clientType });
            return { accessToken, refreshToken: newRefresh };
        }

        // Check if this token exists in Redis (not revoked)
        const redisKey = `refresh:${userId}:${tokenId}`;
        const stored = await this.redis.getJson<{ rememberMe?: boolean }>(redisKey);

        if (!stored) {
            // Blast radius acotado a ESTA plataforma: un refresh viejo de la web
            // (pestaña zombie tras un force-login) no debe tumbar el teléfono.
            await this.revokeAllUserSessions(userId, clientType);
            await this.destroySession(userId, clientType);
            throw new UnauthorizedException('Token reuse detected — all sessions revoked');
        }

        // Revoke the old token
        await this.revokeRefreshToken(userId, tokenId);

        // Issue new pair with current session ID
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.isActive) throw new UnauthorizedException('Invalid token');

        const readyTenantId = await this.resolveReadyTenantIdForUser(user.id, user.tenantId);
        if (sessionRecreated && tokenSid) {
            // Refresh válido + sesión vencida por TTL → nueva sesión con el MISMO
            // sid (los access tokens en vuelo siguen siendo coherentes).
            // El asiento se re-ocupa respetando el cupo del plan: si el tenant
            // está al tope (y este usuario ya no figura), toca re-login normal.
            if (readyTenantId) {
                const already = await this.redis.getClient().sismember(`tenant_sessions:${readyTenantId}`, userId);
                if (!already) {
                    await this.cleanStaleTenantSessions(readyTenantId);
                    const count = await this.redis.scard(`tenant_sessions:${readyTenantId}`);
                    const seatsLimit = await this.throttleService.getPlanLimit(readyTenantId, 'seats');
                    if (count >= seatsLimit) {
                        throw new UnauthorizedException('Session expired — please log in again');
                    }
                }
            }
            const session: SessionData = {
                sid: tokenSid,
                tenantId: readyTenantId,
                loginAt: Date.now(),
                lastActivity: Date.now(),
                clientType,
            };
            await this.redis.setJson(sessionKey, session, this.sessionTtl(clientType));
            if (readyTenantId) await this.redis.sadd(`tenant_sessions:${readyTenantId}`, userId);
        }

        const session = await this.redis.getJson<SessionData>(sessionKey);
        const payload: JwtPayload = {
            sub: user.id, email: user.email,
            role: user.role as UserRole, tenantId: readyTenantId,
        };
        const { accessToken, refreshToken: newRefresh } = await this.generateTokens(payload, {
            rememberMe: stored.rememberMe,
            sid: session?.sid,
            clientType,
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
            // Solo la sesión de ESTA plataforma: cerrar sesión en el teléfono no
            // debe tumbar el dashboard abierto (ni al revés).
            await this.destroySession(decoded.sub, decoded.client === 'mobile' ? 'mobile' : 'web');
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
        // Ambas plataformas: la sesión móvil (14d) también debe morir con la clave.
        await this.destroySession(userId);
        await this.destroySession(userId, 'mobile');

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
                onboardingCompleted: true,
                emailVerified: true,
                tenant: {
                    select: { id: true, schemaName: true, isActive: true, onboardingCompletedAt: true },
                },
            },
        });

        if (!user || !user.isActive) {
            throw new UnauthorizedException('User not found or inactive');
        }

        // Session validation: verify the JWT's session ID matches the active session.
        // Skip for super_admin and legacy tokens without sid (backward compat).
        // El claim `client` decide contra QUÉ sesión se valida (web vs mobile).
        if (user.role !== 'super_admin' && payload.sid) {
            const clientType: ClientType = (payload as any).client === 'mobile' ? 'mobile' : 'web';
            const key = this.sessionKey(user.id, clientType);
            const session = await this.redis.getJson<SessionData>(key);
            if (!session || session.sid !== payload.sid) {
                throw new UnauthorizedException('session_expired');
            }
            // An authenticated request IS activity. Until now the only thing that
            // renewed the 6-min session was the frontend ping, which is disabled on
            // the registration screens — so somebody demonstrably filling in the
            // onboarding form could have their session expire underneath them.
            await this.redis.expire(key, this.sessionTtl(clientType));
        }

        const readyContext = user.role === 'super_admin'
            ? await resolveReadyTenantContext(this.prisma, this.redis, payload.tenantId)
            : await resolveReadyUserTenantContext(this.prisma, this.redis, user.id, payload.tenantId);

        return {
            id: user.id,
            email: user.email,
            role: user.role,
            tenantId: readyContext?.tenantId,
            isActive: user.isActive,
            // Necesario para EmailVerifiedGuard: sin esto en req.user no hay
            // forma de gatear las acciones donde el correo importa de verdad.
            emailVerified: user.emailVerified,
            schemaName: readyContext?.schemaName,
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

    async googleLogin(idToken: string, rememberMe = false, force = false, deviceTrustToken?: string, deviceFingerprint?: string, clientType?: ClientType) {
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

        // El alta NO ocurre desde la app: crear la empresa exige el wizard web
        // (vertical, canales, agente). Sin este guard, tocar "Continuar con
        // Google" en el móvil creaba un usuario SIN tenant que entraba a una
        // consola permanentemente vacía —y dejaba una cuenta huérfana en la DB—.
        if (isNewUser && clientType === 'mobile') {
            throw new UnauthorizedException({
                error: 'no_account',
                message: 'No encontramos una cuenta con este correo. Crea tu empresa desde la web y luego inicia sesión aquí.',
            });
        }

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
                    // Google YA probó que la casilla existe y que es de esta
                    // persona: pedirle además nuestro código de 6 dígitos es
                    // fricción sin ninguna garantía extra. El alta con Google ya
                    // marcaba verificado; faltaba el caso de quien se registró
                    // con contraseña y vincula Google después, que quedaba sin
                    // verificar para siempre.
                    emailVerified: true,
                    emailVerifyCode: null,
                    emailVerifyExpires: null,
                },
                include: { tenant: true },
            });
        }

        // Enforce session policy (skip for brand-new users)
        if (!isNewUser) {
            await this.enforceSessionPolicy(user, force, clientType);
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

        const readyTenantId = await this.resolveReadyTenantIdForUser(user.id, user.tenantId);
        const sid = await this.createSession(user.id, readyTenantId, clientType);

        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role as UserRole,
            tenantId: readyTenantId,
        };

        const { accessToken, refreshToken } = await this.generateTokens(payload, { rememberMe, sid, clientType });

        const effectiveOnboarding = user.role === 'super_admin' || !!readyTenantId;

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
                tenantId: readyTenantId,
                tenantName: readyTenantId ? user.tenant?.name : undefined,
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
                    // Igual que con Google: Microsoft ya probó la casilla.
                    emailVerified: true,
                    emailVerifyCode: null,
                    emailVerifyExpires: null,
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

        const readyTenantId = await this.resolveReadyTenantIdForUser(user.id, user.tenantId);
        const sid = await this.createSession(user.id, readyTenantId);

        const payload: JwtPayload = {
            sub: user.id, email: user.email,
            role: user.role as UserRole, tenantId: readyTenantId,
        };

        const { accessToken, refreshToken } = await this.generateTokens(payload, { rememberMe, sid });
        const effectiveOnboarding = user.role === 'super_admin' || !!readyTenantId;

        return {
            requires2FA: false,
            accessToken, refreshToken,
            user: {
                id: user.id, email: user.email,
                firstName: user.firstName, lastName: user.lastName,
                role: user.role, tenantId: readyTenantId,
                tenantName: readyTenantId ? user.tenant?.name : undefined,
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

    /**
     * Generates the 6-digit code and attempts delivery. `sent` reports whether the
     * mail actually left: `emailService.send()` swallows SMTP failures and returns
     * false, so ignoring it meant a dead SMTP locked every email signup out of the
     * product with nothing but a warn line in the logs. Callers decide what to do —
     * signup degrades, the explicit resend fails loudly.
     */
    async sendVerificationEmail(userId: string): Promise<{ message: string; sent: boolean }> {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const code = String(crypto.randomInt(100000, 1000000));
        const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await this.prisma.user.update({
            where: { id: userId },
            data: { emailVerifyCode: code, emailVerifyExpires: expires },
        });

        const sent = await this.emailService.send({
            to: user.email,
            subject: 'Tu codigo de verificacion — Parallly',
            html: verificationEmail(user.firstName, code),
        });

        if (!sent) {
            this.logger.error(`[Verification] Delivery failed for user ${userId} <${user.email}> — the code exists but nobody received it`);
        }

        return { message: sent ? 'Verification code sent' : 'Verification code generated but not delivered', sent };
    }

    /**
     * Lets a user fix a mistyped address while still unverified. Without this a typo
     * was a dead end: the code goes to an inbox they don't own and every future login
     * lands back on the same locked screen.
     */
    async changePendingEmail(userId: string, rawEmail: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        if (user.emailVerified) {
            throw new BadRequestException({ error: 'email_already_verified', message: 'Tu correo ya está verificado.' });
        }

        const email = (rawEmail || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            throw new BadRequestException({ error: 'invalid_email', message: 'Ese correo no parece válido.' });
        }
        validateEmailDomain(email);

        // Guardar la misma dirección = "reenviame el código". El campo viene precargado
        // con el correo actual, así que rechazarlo sería castigar el uso más obvio.
        if (email !== user.email.trim().toLowerCase()) {
            const taken = await this.prisma.user.findUnique({ where: { email } });
            if (taken) throw new ConflictException({ error: 'email_taken', message: 'Ese correo ya tiene una cuenta.' });

            await this.prisma.user.update({
                where: { id: userId },
                data: { email, emailVerifyCode: null, emailVerifyExpires: null },
            });
            this.logger.log(`[Verification] Pending email changed for user ${userId}`);
        }

        const { sent } = await this.sendVerificationEmail(userId);
        return { email, verificationEmailSent: sent };
    }

    async verifyEmailCode(userId: string, code: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        if (!user.emailVerifyCode || !user.emailVerifyExpires ||
            user.emailVerifyExpires < new Date() ||
            !this.timingSafeEqual(user.emailVerifyCode, code)) {
            throw new BadRequestException({
                error: 'invalid_verification_code',
                message: 'El código es incorrecto o ya venció.',
            });
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
        // Ambas plataformas: la sesión móvil (14d) también debe morir con la clave.
        await this.destroySession(user.id);
        await this.destroySession(user.id, 'mobile');

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
        clientType?: ClientType,
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
        const readyTenantId = await this.resolveReadyTenantIdForUser(user.id, user.tenantId);
        const sid = await this.createSession(user.id, readyTenantId, clientType);
        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role as UserRole,
            tenantId: readyTenantId,
        };
        const { accessToken, refreshToken } = await this.generateTokens(payload, { rememberMe, sid, clientType });

        const effectiveOnboarding = user.role === 'super_admin' || !!readyTenantId;

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
                tenantId: readyTenantId,
                tenantName: readyTenantId ? user.tenant?.name : undefined,
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
        await this.destroySession(userId, 'mobile');
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

    private async withTenantLifecycleLease<T>(
        tenantId: string,
        work: (assertLifecycleOwned: () => Promise<void>) => Promise<T>,
    ): Promise<T> {
        const lockKey = tenantLifecycleLockKey(tenantId);
        const lockToken = await this.redis.acquireLockToken(lockKey, TENANT_LIFECYCLE_LOCK_TTL_SECONDS);
        if (!lockToken) {
            throw new ConflictException({
                error: 'tenant_lifecycle_in_progress',
                message: 'El ciclo de vida de este tenant ya está siendo modificado.',
                tenantId,
            });
        }
        const lease = new OwnedLockLease(
            this.redis,
            lockKey,
            lockToken,
            TENANT_LIFECYCLE_LOCK_TTL_SECONDS,
            this.logger,
            `[Onboarding] Tenant lifecycle lock lost for ${tenantId}`,
        );
        lease.start();
        try {
            await lease.assertOwned();
            if (await this.redis.get(tenantPurgingFenceKey(tenantId))) {
                throw new ConflictException({
                    error: 'tenant_purge_in_progress',
                    message: 'El tenant está en proceso de eliminación y no puede provisionarse.',
                    tenantId,
                });
            }
            return await work(() => lease.assertOwned());
        } catch (error: unknown) {
            if (error instanceof LockOwnershipLostError || lease.hasLostOwnership()) {
                throw new ConflictException({
                    error: 'tenant_lifecycle_lock_lost',
                    message: 'El alta perdió el lock de ciclo de vida y se detuvo antes del siguiente commit.',
                    tenantId,
                });
            }
            throw error;
        } finally {
            lease.stop();
            await this.redis.releaseLockToken(lockKey, lockToken)
                .catch((error: any) => this.logger.warn(`[Onboarding] Tenant lifecycle lock release failed: ${error.message}`));
        }
    }

    async completeOnboarding(userId: string, data: CompleteOnboardingDto): Promise<any> {
        // El lock cubre TODO el alta, no solo la transacción que crea tenant/user.
        // Sin él, dos requests que leen tenantId=null a la vez pueden crear dos
        // tenants y la segunda termina dejando huérfano al primero. Redis permite
        // coordinar también entre instancias del API y el token evita liberar el
        // lock de otro proceso si el TTL llegara a vencer.
        const lockKey = `lock:onboarding:${userId}`;
        const lockTtlSeconds = 120;
        const lockToken = await this.redis.acquireLockToken(lockKey, lockTtlSeconds);
        if (!lockToken) {
            throw new ConflictException({
                error: 'onboarding_in_progress',
                message: 'El alta de esta cuenta ya está en ejecución. Intenta nuevamente en unos segundos.',
            });
        }
        const lease = new OwnedLockLease(
            this.redis,
            lockKey,
            lockToken,
            lockTtlSeconds,
            this.logger,
            `[Onboarding] Lock lost for user ${userId}`,
        );
        lease.start();

        try {
            await lease.assertOwned();
            return await this.completeOnboardingLocked(userId, data, () => lease.assertOwned());
        } catch (error: unknown) {
            if (error instanceof LockOwnershipLostError || lease.hasLostOwnership()) {
                throw new ConflictException({
                    error: 'onboarding_lock_lost',
                    message: 'El alta perdió su lock de ejecución y fue detenida antes del siguiente commit.',
                });
            }
            throw error;
        } finally {
            lease.stop();
            await this.redis.releaseLockToken(lockKey, lockToken)
                .catch((error: any) => this.logger.warn(`[Onboarding] Lock release failed: ${error.message}`));
        }
    }

    private async completeOnboardingLocked(
        userId: string,
        data: CompleteOnboardingDto,
        assertLockOwned: () => Promise<void>,
    ): Promise<any> {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        const assertOnboardingLockOwned = assertLockOwned;

        // Idempotencia. La transacción comitea el tenant ANTES de los pasos críticos
        // (schema, agente, Business Identity, vertical y billing). Si cualquiera
        // falla, el usuario queda ligado con onboardingCompleted=false y esta rama
        // repara/reanuda sin crear otro tenant ni emitir sesión prematuramente.
        if (user.tenantId) {
            const existingTenantId = user.tenantId;
            return this.withTenantLifecycleLease(existingTenantId, async (assertLifecycleOwned) => {
            const assertLockOwned = async () => {
                await assertOnboardingLockOwned();
                await assertLifecycleOwned();
            };
            this.logger.log(`[Onboarding] Reintento sobre tenant ${existingTenantId} — verificando y reparando provisioning`);
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: existingTenantId },
                select: {
                    name: true,
                    industry: true,
                    language: true,
                    schemaName: true,
                    settings: true,
                    plan: true,
                    billingEmail: true,
                    billingCountry: true,
                },
            });
            if (!tenant) throw new NotFoundException('Tenant not found');

            const settings = (tenant.settings as any) || {};
            const requestedSubType = settings.subType
                ?? settings.verticalConfig?.subType
                ?? data.subType
                ?? data.company?.subType
                ?? null;
            let selection;
            try {
                selection = resolveVerticalSelection(tenant.industry, requestedSubType);
            } catch (error) {
                if (error instanceof InvalidVerticalSelectionError) {
                    throw new BadRequestException({
                        error: 'invalid_vertical_selection',
                        message: error.message,
                        industry: error.industry,
                        subType: error.subType,
                    });
                }
                throw error;
            }

            // Un draft legacy puede resolver a otra identidad canónica completa
            // (finanzas/seguros -> seguros/broker). Persistir solo verticalConfig
            // dejaría gates globales y sidebar leyendo `tenant.industry=finanzas`.
            const canonicalSettings = {
                ...settings,
                subType: selection.subType,
                businessInfoDraft: {
                    ...(settings.businessInfoDraft || {}),
                    companyName: settings.businessInfoDraft?.companyName || tenant.name,
                    industry: selection.industry,
                },
            };
            if (tenant.industry !== selection.industry || settings.subType !== selection.subType) {
                await assertLockOwned();
                await mergeTenantSettingsAtomic(this.prisma, existingTenantId, {
                    subType: selection.subType,
                    businessInfoDraft: canonicalSettings.businessInfoDraft,
                }, {
                    industry: selection.industry,
                });
            }

            // DDL y bootstrap son pasos críticos y reanudables. createTenantSchema
            // devuelve el nombre físico canónico (con UUID) y lo persiste; nunca
            // seguimos usando el placeholder basado en slug.
            await assertLockOwned();
            const effectiveSchemaName = await this.prisma.createTenantSchema(tenant.schemaName);
            await assertLockOwned();
            await this.redis.del(`tenant:${existingTenantId}:schema`);
            this.logger.log(`[Onboarding] Schema verificado/reparado: ${effectiveSchemaName}`);
            const goals = Array.isArray(settings.chatReasons)
                ? settings.chatReasons
                : (Array.isArray(data.goals || data.chatReasons) ? (data.goals || data.chatReasons) : []);
            await assertLockOwned();
            await this.personaService.createDefaultAgentFromGoals(
                existingTenantId,
                goals,
                user.email || 'onboarding-retry',
                selection.industry,
                selection.subType || undefined,
            );
            const businessDraft = canonicalSettings.businessInfoDraft || {};
            await assertLockOwned();
            await this.businessInfoService.upsertPrimary(existingTenantId, {
                companyName: businessDraft.companyName || tenant.name,
                industry: selection.industry,
                website: businessDraft.website || settings.website || undefined,
                phone: businessDraft.phone || undefined,
                email: businessDraft.email || tenant.billingEmail || undefined,
                about: businessDraft.about || undefined,
                socialLinks: businessDraft.socialLinks || settings.socialLinks || undefined,
            });
            const tenantLang = (tenant.language || 'es-CO').split('-')[0];
            await assertLockOwned();
            await this.verticalsService.bootstrapVertical(
                existingTenantId,
                selection.industry,
                selection.subType,
                tenantLang,
                { assertLifecycleOwned },
            );
            await assertLockOwned();
            await this.ensureOnboardingSubscription({
                tenantId: existingTenantId,
                planSlug: (tenant.plan || data.plan || data.planSlug || 'emprendedor') as string,
                billingEmail: businessDraft.email || tenant.billingEmail || user.email,
                billingCountry: tenant.billingCountry
                    || data.company?.country
                    || data.billingCountry
                    || this.inferCountryFromTimezone(settings.timezone || 'America/Bogota'),
                cardTokenId: data.cardTokenId,
            });
            // Mismo cupón que en el flujo normal: la rama de reparación reintenta el
            // alta completa, y el UNIQUE (couponId, tenantId) hace que un segundo
            // intento devuelva `already_redeemed` en vez de regalar el mes dos veces.
            const couponResult = await this.applyOnboardingCoupon({
                tenantId: existingTenantId,
                userId: user.id,
                couponCode: data.couponCode,
            });
            await assertLockOwned();
            await this.prisma.$transaction(async (tx: any) => {
                await assertLockOwned();
                await tx.tenant.update({
                    where: { id: existingTenantId },
                    data: { isActive: true, onboardingCompletedAt: new Date() },
                });
                await assertLockOwned();
                await tx.user.update({
                    where: { id: user.id },
                    data: { onboardingCompleted: true },
                });
                await assertLockOwned();
            });

            const verticalConfig = await this.verticalsService.getVerticalConfig(existingTenantId);

            await assertLockOwned();
            const prevSession = await this.redis.getJson<SessionData>(`session:${user.id}`);
            const existingSid = prevSession?.sid || await this.createSession(user.id, existingTenantId);
            await assertLockOwned();
            const { accessToken, refreshToken } = await this.generateTokens({
                sub: user.id,
                email: user.email,
                role: user.role as UserRole,
                tenantId: existingTenantId,
            }, { sid: existingSid });

            return {
                accessToken,
                refreshToken,
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    tenantId: existingTenantId,
                    tenantName: tenant?.name,
                    onboardingCompleted: true,
                },
                verticalConfig,
                coupon: couponResult,
            };
            });
        }

        // Accept nested format from onboarding wizard
        const company = data.company || {};
        const companyName = (company.name || data.companyName || '').trim();
        if (!companyName) {
            throw new BadRequestException({
                error: 'company_name_required',
                message: 'El nombre de la empresa es obligatorio',
            });
        }
        const website = company.website || data.website;
        const socialLinks = company.socialMedia || data.socialLinks;
        const rawIndustry = company.industry || data.industry;
        const rawSubType = data.subType || company.subType;
        let verticalSelection;
        try {
            verticalSelection = resolveVerticalSelection(rawIndustry, rawSubType);
        } catch (error) {
            if (error instanceof InvalidVerticalSelectionError) {
                throw new BadRequestException({
                    error: 'invalid_vertical_selection',
                    message: error.message,
                    industry: error.industry,
                    subType: error.subType,
                });
            }
            throw error;
        }
        const { industry, subType } = verticalSelection;
        const companySize = company.orgSize || data.companySize;
        const timezone = company.timezone || data.timezone || 'America/Bogota';
        const customerTypes = data.audiences || data.customerTypes;
        const chatReasons = data.goals || data.chatReasons;
        const referralSource = data.referral || data.referralSource;
        const phone = company.phone || data.phone;
        const businessEmail = company.email || data.businessEmail;
        const about = company.about || data.about;
        const selectedPlan = (data.plan || data.planSlug || 'emprendedor') as string;
        const billingCountry = (company.country
            || data.billingCountry
            || this.inferCountryFromTimezone(timezone)) as string;
        // Se persiste sin secretos/token de tarjeta: es el insumo durable que un
        // retry necesita para reparar Business Identity y billing tras un corte.
        const businessInfoDraft = {
            companyName,
            industry,
            website: website || undefined,
            phone: phone || undefined,
            email: businessEmail || undefined,
            about: about || undefined,
            socialLinks: socialLinks || undefined,
        };

        // Slug a partir del nombre. Los homónimos se desambiguan con sufijo en vez de
        // rechazarse: "Ferretería El Tornillo" es un nombre plausible en dos ciudades
        // distintas, y hasta ahora el segundo que se registraba recibía un 409 en
        // inglés sin ninguna instrucción de qué hacer.
        const slug = await this.findAvailableTenantSlug(companyName);
        const schemaName = `tenant_${slug.replace(/-/g, '_')}`;

        // Idioma del tenant. Preferimos el locale REAL con el que el usuario está
        // usando el dashboard; el huso horario es solo el respaldo. Antes esto era
        // 'es-CO' fijo, así que un tenant brasileño arrancaba con agente, FAQs y
        // etiquetas en español teniendo el portugués completo disponible.
        const clientLocale = typeof data.locale === 'string' ? data.locale.slice(0, 2).toLowerCase() : '';
        const tenantLangCode = ['es', 'en', 'pt', 'fr'].includes(clientLocale)
            ? clientLocale
            : this.inferLanguageFromTimezone(timezone);
        const tenantLanguage = `${tenantLangCode}-${this.inferCountryFromTimezone(timezone)}`;

        // Reserve the definitive tenant id first so the lifecycle lease exists
        // before the tenant/user transaction becomes visible to purge workers.
        const provisioningTenantId = crypto.randomUUID();
        return this.withTenantLifecycleLease(provisioningTenantId, async (assertLifecycleOwned) => {
        const assertLockOwned = async () => {
            await assertOnboardingLockOwned();
            await assertLifecycleOwned();
        };

        // Atomic transaction: create tenant + link user
        await assertLockOwned();
        const result = await this.prisma.$transaction(async (tx: any) => {
            // 1. Create tenant with settings JSONB
            await assertLockOwned();
            const tenant = await tx.tenant.create({
                data: {
                    id: provisioningTenantId,
                    name: companyName,
                    slug,
                    industry,
                    schemaName,
                    // El plan real lo fija createTrialSubscription más abajo, en esta
                    // misma request, a partir de lo que el usuario eligió. Sembrar
                    // 'starter' acá solo servía para que hubiera una ventana en la que
                    // el tenant decía un plan que nadie había pedido.
                    plan: selectedPlan,
                    language: tenantLanguage,
                    // Readiness is committed atomically only after every critical
                    // provisioning invariant below has succeeded.
                    isActive: false,
                    settings: {
                        website,
                        socialLinks,
                        companySize,
                        timezone,
                        customerTypes,
                        chatReasons,
                        referralSource,
                        // Persistir el input mínimo permite que un retry repare
                        // schema/agente/bootstrap aunque el cliente se cierre.
                        subType,
                        businessInfoDraft,
                    },
                    signupSource: data.signupSource || referralSource || null,
                },
            });

            // 2. Claim the user for this tenant; readiness remains false.
            await assertLockOwned();
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    tenantId: tenant.id,
                    role: 'tenant_admin',
                    // Se marca true solo después de schema + bootstrap verificados.
                    onboardingCompleted: false,
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
            await assertLockOwned();
            await tx.auditLog.create({
                data: {
                    tenantId: tenant.id,
                    userId: user.id,
                    action: 'onboarding_provisioning_started',
                    resource: 'tenant',
                    details: { companyName, slug, email: user.email },
                },
            });

            // Fencing check immediately before Prisma commits the callback.
            await assertLockOwned();
            return { tenant, user: updatedUser };
        });

        // 4. Create/repair isolated DB schema (outside transaction — DDL cannot
        // be rolled back). Es CRÍTICO: si falla, la request falla y el retry de
        // arriba reanuda. El servicio retorna y persiste el nombre físico UUID;
        // desde este punto no se reutiliza el placeholder basado en slug.
        await assertLockOwned();
        const effectiveSchemaName = await this.prisma.createTenantSchema(result.tenant.schemaName);
        result.tenant.schemaName = effectiveSchemaName;
        await assertLockOwned();
        await this.redis.del(`tenant:${result.tenant.id}:schema`);
        this.logger.log(`[Onboarding] Canonical tenant schema ready: ${effectiveSchemaName}`);

        // 5. Create default AI agent based on onboarding goals
        const goals: string[] = Array.isArray(chatReasons) ? chatReasons : [];
        await assertLockOwned();
        await this.personaService.createDefaultAgentFromGoals(
            result.tenant.id,
            goals,
            user.email || 'onboarding',
            industry,
            subType || undefined,
        );

        // 6. Business Identity es parte del readiness del agente: sin ella
        // <turn.business> queda vacío. Es crítica y el draft durable permite
        // que la rama de retry la repare idempotentemente.
        await assertLockOwned();
        await this.businessInfoService.upsertPrimary(result.tenant.id, businessInfoDraft);

        // 6.5. Bootstrap vertical-specific defaults. También es CRÍTICO: el
        // servicio persiste pending/failed/complete y solo retorna al cumplir
        // cuotas e invariantes post-bootstrap.
        const tenantLang = tenantLangCode;
        console.log(`[Onboarding] Starting vertical bootstrap: industry="${industry}", subType="${subType}", lang="${tenantLang}", tenant="${result.tenant.id}"`);
        await assertLockOwned();
        await this.verticalsService.bootstrapVertical(
            result.tenant.id,
            industry,
            subType,
            tenantLang,
            { assertLifecycleOwned },
        );
        const verticalConfig = await this.verticalsService.getVerticalConfig(result.tenant.id);
        console.log(`[Onboarding] Vertical bootstrap completed and verified for "${effectiveSchemaName}"`);

        // 7. Billing también precede el flag de completitud. En particular,
        // card_required_for_trial/plan_not_found nunca deben dejar un usuario
        // marcado como listo sin suscripción; el retry consulta antes de crear.
        await assertLockOwned();
        await this.ensureOnboardingSubscription({
            tenantId: result.tenant.id,
            planSlug: selectedPlan,
            billingEmail: businessEmail || user.email,
            billingCountry,
            cardTokenId: data.cardTokenId,
        });

        // 7.5. Código promocional del alta. Va DESPUÉS de la suscripción porque el
        // canje la exige, y antes de cerrar el funnel para que el resultado viaje en
        // la misma respuesta. No usa assertLockOwned ni corta el flujo: un código mal
        // tipeado no puede tumbar un alta que ya provisionó schema, agente y vertical.
        const couponResult = await this.applyOnboardingCoupon({
            tenantId: result.tenant.id,
            userId: result.user.id,
            couponCode: data.couponCode,
        });

        // Solo ahora el funnel está completo. Si cualquiera de los pasos
        // críticos anteriores falló, el usuario queda ligado al tenant pero con
        // onboardingCompleted=false y la siguiente request repara/reanuda.
        await assertLockOwned();
        await this.prisma.$transaction(async (tx: any) => {
            await assertLockOwned();
            await tx.tenant.update({
                where: { id: result.tenant.id },
                data: { isActive: true, onboardingCompletedAt: new Date() },
            });
            await assertLockOwned();
            await tx.user.update({
                where: { id: result.user.id },
                data: { onboardingCompleted: true },
            });
            await assertLockOwned();
        });
        result.user.onboardingCompleted = true;
        await assertLockOwned();
        await this.prisma.auditLog.create({
            data: {
                tenantId: result.tenant.id,
                userId: result.user.id,
                action: 'onboarding_completed',
                resource: 'tenant',
                details: { verticalProvisioningVersion: VERTICAL_PROVISIONING_VERSION, schemaName: effectiveSchemaName },
            },
        });

        // 8. Update session with tenantId + generate new JWT tokens
        await assertLockOwned();
        const existingSession = await this.redis.getJson<SessionData>(`session:${result.user.id}`);
        const sid = existingSession?.sid || await this.createSession(result.user.id, result.user.tenantId || undefined);
        if (existingSession && result.user.tenantId) {
            await assertLockOwned();
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

        await assertLockOwned();
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
            coupon: couponResult,
        };
        });
    }

    /**
     * Canjea el código promocional del alta, si vino uno.
     *
     * NUNCA lanza. El alta es cara (schema del tenant, agente por defecto, bootstrap
     * vertical, suscripción) y ya está hecha para cuando se llama; hacerla fallar por
     * un código vencido o mal tipeado sería regalarle al usuario un estado a medias.
     * Se devuelve el resultado para que el frontend avise, y el usuario siempre puede
     * reintentar desde Configuración → Facturación.
     */
    private async applyOnboardingCoupon(input: {
        tenantId: string;
        userId: string;
        couponCode?: string;
    }): Promise<{
        applied: boolean;
        code?: string;
        freeMonths?: number;
        trialEndsAt?: Date;
        error?: string;
    } | null> {
        const raw = (input.couponCode || '').trim();
        if (!raw) return null;

        try {
            const res = await this.couponsService.redeemForTenant({
                code: raw,
                tenantId: input.tenantId,
                actorUserId: input.userId,
                source: 'onboarding',
            });
            this.logger.log(
                `[Onboarding] coupon ${res.code} applied to tenant ${input.tenantId} — +${res.freeMonths}m`,
            );
            return {
                applied: true,
                code: res.code,
                freeMonths: res.freeMonths,
                trialEndsAt: res.trialEndsAt,
            };
        } catch (err: any) {
            // Las excepciones de Nest llevan el código estable en `response.error`.
            const reason = err?.response?.error || err?.error || 'invalid';
            this.logger.warn(
                `[Onboarding] coupon "${raw.toUpperCase()}" NOT applied for tenant ${input.tenantId}: ${reason}`,
            );
            return { applied: false, error: reason };
        }
    }

    private async ensureOnboardingSubscription(input: {
        tenantId: string;
        planSlug: string;
        billingEmail?: string;
        billingCountry?: string;
        cardTokenId?: string;
    }): Promise<void> {
        const existing = await this.prisma.billingSubscription.findUnique({
            where: { tenantId: input.tenantId },
            select: { id: true },
        });
        if (existing) return;
        await this.billingService.createTrialSubscription(input);
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
        if (!await resolveReadyTenantContext(this.prisma, this.redis, tenantId)) {
            throw new ConflictException({
                error: 'tenant_not_ready',
                message: 'El tenant está inactivo, provisionando o en proceso de eliminación.',
                tenantId,
            });
        }

        // Find the first tenant_admin user for this tenant
        const targetUser = await this.prisma.user.findFirst({
            where: { tenantId, role: 'tenant_admin', isActive: true },
            orderBy: { createdAt: 'asc' },
        });

        if (!targetUser) {
            throw new NotFoundException(`No active tenant_admin found for tenant ${tenantId}`);
        }
        const readyTenantId = await this.resolveReadyTenantIdForUser(targetUser.id, tenantId);
        if (!readyTenantId) throw new ConflictException({ error: 'tenant_not_ready', tenantId });

        const tokenId = crypto.randomUUID();

        // Generate a short-lived access token (1 hour)
        const payload: JwtPayload = {
            sub: targetUser.id,
            email: targetUser.email,
            role: targetUser.role as UserRole,
            tenantId: readyTenantId,
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
        }).catch((e: any) => {
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
                tenantId: readyTenantId,
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
        }).catch((e: any) => {
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

    /**
     * Slug único para el tenant. Normaliza acentos y ñ (sin esto "Peluquería Ñandú"
     * perdía las letras acentuadas y colisionaba con nombres distintos), y desambigua
     * homónimos con sufijo numérico en vez de rechazar el alta.
     */
    private async findAvailableTenantSlug(companyName: string | undefined): Promise<string> {
        const base = (companyName || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 50) || 'empresa';

        for (let i = 0; i < 50; i++) {
            const candidate = i === 0 ? base : `${base}-${i + 1}`;
            const taken = await this.prisma.tenant.findUnique({
                where: { slug: candidate },
                select: { id: true },
            });
            if (!taken) return candidate;
        }
        // 50 homónimos es inverosímil; si pasa, un sufijo temporal antes de rendirse.
        return `${base}-${Date.now().toString(36)}`;
    }

    /**
     * Covers every zone the onboarding selector actually offers. The previous map had
     * 9 entries for 20 LatAm options, so a tenant in Panamá or Guatemala was silently
     * billed as Colombia.
     */
    private inferCountryFromTimezone(tz: string | undefined): string {
        if (!tz) return 'CO';
        return TIMEZONE_COUNTRY[tz] || 'CO';
    }

    /**
     * Tenant content language (agent persona, seeded FAQs, pipeline labels). This used
     * to be `timezone.includes('America') ? 'es' : 'en'`, which handed a Brazilian
     * tenant a Spanish agent even though the pt content exists — and gave every
     * European tenant English.
     */
    private inferLanguageFromTimezone(tz: string | undefined): string {
        const country = this.inferCountryFromTimezone(tz);
        if (country === 'BR' || country === 'PT') return 'pt';
        if (country === 'FR') return 'fr';
        if (SPANISH_SPEAKING_COUNTRIES.has(country)) return 'es';
        return 'en';
    }
}
