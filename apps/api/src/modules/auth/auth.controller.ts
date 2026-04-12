import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { IsEmail, IsString, IsOptional, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

class LoginDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(1)
    password: string;
}

class RegisterDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(6)
    password: string;

    @IsString()
    firstName: string;

    @IsString()
    lastName: string;

    @IsString()
    @IsOptional()
    role?: string;

    @IsString()
    @IsOptional()
    tenantId?: string;
}

class RefreshTokenDto {
    @IsString()
    refreshToken: string;
}

class AdminResetPasswordDto {
    @IsString()
    userId: string;

    @IsString()
    @MinLength(6)
    newPassword: string;
}

class SignupDto {
    @IsString()
    @MinLength(2)
    companyName: string;

    @IsString()
    industry: string;

    @IsEmail()
    email: string;

    @IsString()
    @MinLength(6)
    password: string;

    @IsString()
    firstName: string;

    @IsString()
    lastName: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Login with email and password' })
    async login(@Body() dto: LoginDto) {
        const result = await this.authService.login(dto.email, dto.password);
        return { success: true, data: result };
    }

    @Post('signup')
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Self-service signup: create a new company and admin account' })
    async signup(@Body() dto: SignupDto) {
        const result = await this.authService.signupWithTenant({
            companyName: dto.companyName,
            industry: dto.industry,
            email: dto.email,
            password: dto.password,
            firstName: dto.firstName,
            lastName: dto.lastName,
        });
        return { success: true, data: result };
    }

    @Post('register')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin', 'tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Register a new user (admin only)' })
    async register(@Body() dto: RegisterDto, @CurrentUser() currentUser: any) {
        // Tenant admins can only create users in their tenant
        if (currentUser.role === 'tenant_admin') {
            dto.tenantId = currentUser.tenantId;
            dto.role = 'tenant_agent'; // Can only create agents
        }

        const user = await this.authService.register({
            email: dto.email,
            password: dto.password,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: dto.role as any,
            tenantId: dto.tenantId,
        });

        return { success: true, data: user };
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Refresh access token' })
    async refresh(@Body() dto: RefreshTokenDto) {
        const result = await this.authService.refreshToken(dto.refreshToken);
        return { success: true, data: result };
    }

    @Post('admin/reset-password')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Admin reset user password (super_admin only)' })
    async adminResetPassword(@Body() dto: AdminResetPasswordDto) {
        const result = await this.authService.adminResetPassword(dto.userId, dto.newPassword);
        return { success: true, data: result };
    }

    @Post('me')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Get current user info' })
    async me(@CurrentUser() user: any) {
        return { success: true, data: user };
    }

    @Post('google')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Login or register with Google OAuth' })
    async googleLogin(@Body() body: { idToken: string }) {
        const result = await this.authService.googleLogin(body.idToken);
        return { success: true, data: result };
    }

    @Post('setup-password')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Set password for Google-authenticated users' })
    async setupPassword(@Request() req: any, @Body() body: { password: string }) {
        await this.authService.setupPassword(req.user.id, body.password);
        return { success: true };
    }

    @Post('send-verification')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Send email verification code' })
    async sendVerification(@Request() req: any) {
        await this.authService.sendVerificationEmail(req.user.id);
        return { success: true };
    }

    @Post('verify-email')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Verify email with 6-digit code' })
    async verifyEmail(@Request() req: any, @Body() body: { code: string }) {
        await this.authService.verifyEmailCode(req.user.id, body.code);
        return { success: true };
    }

    @Post('complete-onboarding')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Complete onboarding: create company and tenant' })
    async completeOnboarding(@Request() req: any, @Body() body: any) {
        const result = await this.authService.completeOnboarding(req.user.id, body);
        return { success: true, data: result };
    }
}
