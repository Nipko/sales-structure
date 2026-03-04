import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
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

    @Post('me')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Get current user info' })
    async me(@CurrentUser() user: any) {
        return { success: true, data: user };
    }
}
