import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '@parallext/shared';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // Path 1: Internal API key (service-to-service or dashboard cross-service)
    const internalKey = request.headers['x-internal-key'];
    if (internalKey) {
      const expectedKey = this.config.get<string>('INTERNAL_API_KEY');
      if (expectedKey && internalKey === expectedKey) {
        request.user = {
          sub: 'internal-service',
          email: 'internal@parallext.local',
          role: 'super_admin',
          tenantId: request.headers['x-tenant-id'] || request.body?.tenantId || null,
          isInternalService: true,
        };
        return true;
      }
    }

    // Path 2: JWT Bearer token
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Token de autenticación requerido');
    }

    // Try with INTERNAL_JWT_SECRET first, then JWT_SECRET as fallback
    const secrets = [
      this.config.get<string>('app.jwtSecret'),
      this.config.get<string>('INTERNAL_JWT_SECRET'),
      this.config.get<string>('JWT_SECRET'),
    ].filter(Boolean);

    for (const secret of secrets) {
      try {
        const payload = this.jwtService.verify<JwtPayload>(token, { secret });
        request.user = payload;
        return true;
      } catch {
        // Try next secret
      }
    }

    throw new UnauthorizedException('Token inválido o expirado');
  }

  private extractToken(request: any): string | null {
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }
}
