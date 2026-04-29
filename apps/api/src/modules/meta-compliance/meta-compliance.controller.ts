import { Body, Controller, Get, Logger, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MetaComplianceService } from './meta-compliance.service';

/**
 * Public, unauthenticated endpoints for Meta App Review compliance:
 *
 *   POST /meta/data-deletion-callback   — Meta calls this when a Facebook user
 *                                          revokes our app. Configure this URL
 *                                          in App Dashboard → Settings →
 *                                          Advanced → Data Deletion Callback URL.
 *
 *   POST /meta/data-deletion-request    — Public form: anyone can request that
 *                                          their personal data be deleted.
 *
 *   GET  /meta/data-deletion/status     — Status lookup by confirmation_code.
 */
@ApiTags('meta-compliance')
@Controller('meta')
export class MetaComplianceController {
    private readonly logger = new Logger(MetaComplianceController.name);

    constructor(private readonly service: MetaComplianceService) {}

    @Post('data-deletion-callback')
    @ApiOperation({ summary: 'Meta data deletion callback (signed_request)' })
    async metaCallback(@Body() body: any) {
        // Meta posts as application/x-www-form-urlencoded with field "signed_request"
        const signedRequest = body?.signed_request || body?.signedRequest || '';
        return this.service.handleMetaCallback(signedRequest);
    }

    @Post('data-deletion-request')
    @ApiOperation({ summary: 'User-initiated data deletion request' })
    async userRequest(@Body() body: { email: string; description?: string }) {
        const result = await this.service.submitUserRequest(body || ({} as any));
        return { success: true, ...result };
    }

    @Get('data-deletion/status')
    @ApiOperation({ summary: 'Status of a deletion request by code' })
    async status(@Query('code') code: string) {
        const record = await this.service.getStatus(code);
        if (!record) return { success: false, status: 'not_found' };
        return { success: true, ...record };
    }
}
