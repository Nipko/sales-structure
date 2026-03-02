import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload, UserRole } from '@parallext/shared';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
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

    async login(email: string, password: string) {
        const user = await this.prisma.user.findUnique({
            where: { email },
            include: { tenant: true },
        });

        if (!user || !user.isActive) {
            throw new UnauthorizedException('Invalid credentials');
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

    async validateUser(payload: JwtPayload) {
        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: {
                id: true,
                email: true,
                role: true,
                tenantId: true,
                isActive: true,
            },
        });

        if (!user || !user.isActive) {
            throw new UnauthorizedException('User not found or inactive');
        }

        return user;
    }
}
