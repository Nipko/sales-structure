import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { GoogleAuthService } from './google-auth.service';
import { JwtPayload, UserRole } from '@parallext/shared';
import {
    verificationEmail, passwordResetEmail, twoFactorEmail,
    welcomeEmail, passwordChangedEmail,
} from '../email/email-layouts';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private googleAuthService: GoogleAuthService,
        private emailService: EmailService,
    ) { }

    async register(data: {
        email: string;
        password: string;
        firstName: string;
        lastName: string;
        role?: UserRole;
        tenantId?: string;
    }) {
        // Check if user exists
        const existing = await this.prisma.user.findUnique({
            where: { email: data.email },
        });

        if (existing) {
            throw new ConflictException('Email already registered');
        }

        // Hash password
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
     * Self-service signup: creates a tenant AND its admin user atomically.
     * This is a PUBLIC endpoint — no JWT required.
     */
    async signupWithTenant(data: {
        companyName: string;
        industry: string;
        email: string;
        password: string;
        firstName: string;
        lastName: string;
    }) {
        // Check if email is already taken
        const existingUser = await this.prisma.user.findUnique({
            where: { email: data.email },
        });
        if (existingUser) {
            throw new ConflictException('Email already registered');
        }

        // Generate slug from company name
        const slug = data.companyName
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
        const hashedPassword = await bcrypt.hash(data.password, 12);

        // Atomic transaction: create tenant + admin user
        const result = await this.prisma.$transaction(async (tx: any) => {
            // 1. Create tenant
            const tenant = await tx.tenant.create({
                data: {
                    name: data.companyName,
                    slug,
                    industry: data.industry,
                    schemaName,
                    plan: 'starter',
                    language: 'es-CO',
                },
            });

            // 2. Create owner/admin user
            const user = await tx.user.create({
                data: {
                    email: data.email,
                    password: hashedPassword,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    role: 'tenant_admin',
                    tenantId: tenant.id,
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

            // 3. Audit log
            await tx.auditLog.create({
                data: {
                    tenantId: tenant.id,
                    userId: user.id,
                    action: 'tenant_self_signup',
                    resource: 'tenant',
                    details: { companyName: data.companyName, slug, email: data.email },
                },
            });

            return { tenant, user };
        });

        // 4. Create isolated DB schema (outside transaction — DDL cannot be rolled back)
        try {
            await this.prisma.createTenantSchema(result.tenant.schemaName);
        } catch (error) {
            // Best-effort: schema creation failed but tenant/user exist.
            // Logged for manual follow-up; the tenant can still function.
            console.error(`[Signup] Failed to create schema "${result.tenant.schemaName}":`, error);
        }

        // 5. Generate JWT tokens — user is immediately authenticated
        const payload: JwtPayload = {
            sub: result.user.id,
            email: result.user.email,
            role: result.user.role as UserRole,
            tenantId: result.user.tenantId || undefined,
        };

        const accessToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('auth.jwtSecret'),
            expiresIn: this.configService.get<string>('auth.jwtExpiration', '15m'),
        });

        const refreshToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('auth.jwtRefreshSecret'),
            expiresIn: this.configService.get<string>('auth.jwtRefreshExpiration', '7d'),
        });

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
            },
        };
    }

    async login(email: string, password: string) {
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

        // Update last login
        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });

        // Generate tokens
        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role as UserRole,
            tenantId: user.tenantId || undefined,
        };

        const accessToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('auth.jwtSecret'),
            expiresIn: this.configService.get<string>('auth.jwtExpiration', '15m'),
        });

        const refreshToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('auth.jwtRefreshSecret'),
            expiresIn: this.configService.get<string>('auth.jwtRefreshExpiration', '7d'),
        });

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
                tenantName: user.tenant?.name,
            },
        };
    }

    async refreshToken(token: string) {
        try {
            const payload = this.jwtService.verify(token, {
                secret: this.configService.get<string>('auth.jwtRefreshSecret'),
            });

            const user = await this.prisma.user.findUnique({
                where: { id: payload.sub },
            });

            if (!user || !user.isActive) {
                throw new UnauthorizedException('Invalid token');
            }

            const newPayload: JwtPayload = {
                sub: user.id,
                email: user.email,
                role: user.role as UserRole,
                tenantId: user.tenantId || undefined,
            };

            const accessToken = this.jwtService.sign(newPayload, {
                secret: this.configService.get<string>('auth.jwtSecret'),
                expiresIn: this.configService.get<string>('auth.jwtExpiration', '15m'),
            });

            return { accessToken };
        } catch {
            throw new UnauthorizedException('Invalid or expired refresh token');
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

        const hashedPassword = await bcrypt.hash(newPassword, 12);

        await this.prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });

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

        return {
            id: user.id,
            email: user.email,
            role: user.role,
            tenantId: user.tenantId,
            isActive: user.isActive,
            schemaName: user.tenant?.schemaName, // Flattened for controllers
        };
    }

    // ── Google OAuth ──────────────────────────────────────────────

    async googleLogin(idToken: string) {
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

        if (!user) {
            // Create new user with Google auth — no password, no tenant yet
            user = await this.prisma.user.create({
                data: {
                    email: googleUser.email,
                    firstName: googleUser.firstName,
                    lastName: googleUser.lastName,
                    authProvider: 'google',
                    googleId: googleUser.googleId,
                    picture: googleUser.picture,
                    emailVerified: true, // Google verifies emails
                    role: 'tenant_admin',
                },
                include: { tenant: true },
            });
        } else if (user.authProvider === 'email' && !user.googleId) {
            // Link Google account to existing email user
            user = await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    googleId: googleUser.googleId,
                    picture: googleUser.picture || user.picture,
                },
                include: { tenant: true },
            });
        }

        // Update last login
        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });

        // Generate tokens
        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role as UserRole,
            tenantId: user.tenantId || undefined,
        };

        const accessToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('auth.jwtSecret'),
            expiresIn: this.configService.get<string>('auth.jwtExpiration', '15m'),
        });

        const refreshToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('auth.jwtRefreshSecret'),
            expiresIn: this.configService.get<string>('auth.jwtRefreshExpiration', '7d'),
        });

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
                tenantName: user.tenant?.name,
                hasPassword: !!user.password,
                emailVerified: user.emailVerified,
                onboardingCompleted: user.onboardingCompleted,
            },
        };
    }

    // ── Password setup ────────────────────────────────────────────

    async setupPassword(userId: string, password: string) {
        const errors: string[] = [];
        if (password.length < 8) errors.push('Minimum 8 characters');
        if (!/[A-Z]/.test(password)) errors.push('At least 1 uppercase letter');
        if (!/[a-z]/.test(password)) errors.push('At least 1 lowercase letter');
        if (!/[0-9]/.test(password)) errors.push('At least 1 number');
        if (!/[^A-Za-z0-9]/.test(password)) errors.push('At least 1 special character');

        if (errors.length > 0) {
            throw new BadRequestException({ message: 'Password does not meet requirements', errors });
        }

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

        const code = String(Math.floor(100000 + Math.random() * 900000));
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
            user.emailVerifyCode !== code || user.emailVerifyExpires < new Date()) {
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

        const code = String(Math.floor(100000 + Math.random() * 900000));
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
            user.emailVerifyCode !== code || user.emailVerifyExpires < new Date()) {
            throw new BadRequestException('Invalid or expired code');
        }

        // Validate password strength
        const errors: string[] = [];
        if (newPassword.length < 8) errors.push('Minimum 8 characters');
        if (!/[A-Z]/.test(newPassword)) errors.push('At least 1 uppercase letter');
        if (!/[a-z]/.test(newPassword)) errors.push('At least 1 lowercase letter');
        if (!/[0-9]/.test(newPassword)) errors.push('At least 1 number');
        if (!/[^A-Za-z0-9]/.test(newPassword)) errors.push('At least 1 special character');

        if (errors.length > 0) {
            throw new BadRequestException({ message: 'Password does not meet requirements', errors });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                emailVerifyCode: null,
                emailVerifyExpires: null,
            },
        });

        // Notify
        this.emailService.send({
            to: user.email,
            subject: 'Tu contrasena ha sido cambiada — Parallly',
            html: passwordChangedEmail(user.firstName),
        });

        return { message: 'Password reset successfully' };
    }

    // ── 2FA (email-based) ─────────────────────────────────────────

    async send2FACode(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        await this.prisma.user.update({
            where: { id: userId },
            data: { emailVerifyCode: code, emailVerifyExpires: expires },
        });

        await this.emailService.send({
            to: user.email,
            subject: 'Tu codigo de autenticacion — Parallly',
            html: twoFactorEmail(user.firstName, code),
        });

        return { message: '2FA code sent' };
    }

    async verify2FACode(userId: string, code: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        if (!user.emailVerifyCode || !user.emailVerifyExpires ||
            user.emailVerifyCode !== code || user.emailVerifyExpires < new Date()) {
            throw new BadRequestException('Invalid or expired 2FA code');
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: { emailVerifyCode: null, emailVerifyExpires: null },
        });

        // Generate full tokens now that 2FA is passed
        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role as UserRole,
            tenantId: user.tenantId || undefined,
        };

        const accessToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('auth.jwtSecret'),
            expiresIn: this.configService.get<string>('auth.jwtExpiration', '15m'),
        });
        const refreshToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('auth.jwtRefreshSecret'),
            expiresIn: this.configService.get<string>('auth.jwtRefreshExpiration', '7d'),
        });

        return { accessToken, refreshToken };
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

        const errors: string[] = [];
        if (newPassword.length < 8) errors.push('Minimum 8 characters');
        if (!/[A-Z]/.test(newPassword)) errors.push('At least 1 uppercase letter');
        if (!/[a-z]/.test(newPassword)) errors.push('At least 1 lowercase letter');
        if (!/[0-9]/.test(newPassword)) errors.push('At least 1 number');
        if (!/[^A-Za-z0-9]/.test(newPassword)) errors.push('At least 1 special character');

        if (errors.length > 0) {
            throw new BadRequestException({ message: 'Password does not meet requirements', errors });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await this.prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });

        this.emailService.send({
            to: user.email,
            subject: 'Tu contrasena ha sido cambiada — Parallly',
            html: passwordChangedEmail(user.firstName),
        });

        return { message: 'Password changed successfully' };
    }

    // ── Onboarding completion ─────────────────────────────────────

    async completeOnboarding(userId: string, data: any) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const {
            companyName,
            website,
            socialLinks,
            industry,
            companySize,
            customerTypes,
            chatReasons,
            referralSource,
        } = data;

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
                        customerTypes,
                        chatReasons,
                        referralSource,
                    },
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

        // 5. Generate new JWT tokens (now includes tenantId)
        const payload: JwtPayload = {
            sub: result.user.id,
            email: result.user.email,
            role: result.user.role as UserRole,
            tenantId: result.user.tenantId || undefined,
        };

        const accessToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('auth.jwtSecret'),
            expiresIn: this.configService.get<string>('auth.jwtExpiration', '15m'),
        });

        const refreshToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('auth.jwtRefreshSecret'),
            expiresIn: this.configService.get<string>('auth.jwtRefreshExpiration', '7d'),
        });

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
        };
    }
}
