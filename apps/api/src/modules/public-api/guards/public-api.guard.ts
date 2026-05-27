import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PublicApiKeyService } from '../public-api-key.service';

@Injectable()
export class PublicApiGuard implements CanActivate {
    constructor(private readonly apiKeyService: PublicApiKeyService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const apiKey = request.headers['x-api-key'];
        if (!apiKey) throw new UnauthorizedException('X-API-Key header required');

        const keyData = await this.apiKeyService.validateKey(apiKey);
        if (!keyData) throw new UnauthorizedException('Invalid API key');

        request.tenantId = keyData.tenantId;
        request.apiKeyScopes = keyData.scopes;
        request.apiKeyId = keyData.keyId;
        request.apiKeyRateLimitRpm = keyData.rateLimitRpm;
        return true;
    }
}
