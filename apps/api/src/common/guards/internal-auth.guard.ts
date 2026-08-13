import * as crypto from 'crypto';
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Internal service guard. Dashboard JWTs are intentionally rejected: these
 * routes enqueue work and inspect tenant-level limits, so a user token must
 * never be able to select an arbitrary tenant through the request body.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly logger = new Logger(InternalAuthGuard.name);

  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const internalKey = request.headers['x-internal-key'];

    if (!internalKey) {
      throw new UnauthorizedException('Internal service authentication required');
    }
    const expectedKey = this.configService.get<string>('INTERNAL_API_KEY');

    if (!expectedKey) {
      this.logger.warn(
        'INTERNAL_API_KEY env var is not set — rejecting internal key auth',
      );
      throw new UnauthorizedException('Internal auth is not configured');
    }

    const expected = Buffer.from(expectedKey);
    const provided = Buffer.from(String(internalKey));
    if (
      expected.length !== provided.length ||
      !crypto.timingSafeEqual(expected, provided)
    ) {
      throw new UnauthorizedException('Invalid internal API key');
    }

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
}
