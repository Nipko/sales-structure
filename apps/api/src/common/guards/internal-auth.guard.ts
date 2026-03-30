import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

/**
 * Dual-auth guard that accepts EITHER:
 *   1. A valid `x-internal-key` header (service-to-service from WhatsApp microservice)
 *   2. A valid JWT Bearer token (from the frontend dashboard)
 *
 * When an internal key is matched the request is treated as an admin-level caller,
 * so downstream guards (RolesGuard, TenantGuard) see a synthetic user object.
 *
 * This replaces needing to share JWT tokens between microservices.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly logger = new Logger(InternalAuthGuard.name);
  private jwtGuard: CanActivate;

  constructor(private readonly configService: ConfigService) {
    // Create an instance of the Passport JWT guard to delegate to when
    // the request does not carry an internal key.
    const JwtGuard = AuthGuard('jwt');
    this.jwtGuard = new (JwtGuard as any)();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const internalKey = request.headers['x-internal-key'];

    // ── Path 1: Internal API key ────────────────────────────────────
    if (internalKey) {
      const expectedKey = this.configService.get<string>('INTERNAL_API_KEY');

      if (!expectedKey) {
        this.logger.warn(
          'INTERNAL_API_KEY env var is not set — rejecting internal key auth',
        );
        throw new UnauthorizedException('Internal auth is not configured');
      }

      if (internalKey !== expectedKey) {
        throw new UnauthorizedException('Invalid internal API key');
      }

      // Attach a synthetic admin user so RolesGuard / TenantGuard work.
      request.user = {
        id: 'internal-service',
        email: 'internal@parallext.local',
        role: 'super_admin',
        tenantId: request.headers['x-tenant-id'] || null,
        isActive: true,
        isInternalService: true,
      };

      this.logger.debug('Authenticated via internal API key');
      return true;
    }

    // ── Path 2: JWT Bearer token (delegates to Passport) ────────────
    try {
      return (await this.jwtGuard.canActivate(context)) as boolean;
    } catch (err) {
      throw new UnauthorizedException(
        'Authentication required — provide a valid JWT or x-internal-key header',
      );
    }
  }
}
