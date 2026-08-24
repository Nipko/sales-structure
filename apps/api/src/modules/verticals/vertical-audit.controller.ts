import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
    deriveNativeBacklogAll,
    summariseNativeBacklogDetailed,
} from './native-backlog';

/**
 * Code-backed vertical intervention ledger for the platform owner.
 *
 * This is intentionally a platform route instead of a tenant route: it
 * describes the 76 product profiles, not one tenant's configuration. Every
 * number is derived from the same manifests, policies, evals and navigation
 * contracts used by runtime; no mutable "percent complete" is stored here.
 */
@ApiTags('vertical-audit')
@ApiBearerAuth()
@Controller('verticals/audit')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class VerticalAuditController {
    @Get('native-backlog')
    @ApiOperation({ summary: 'Get the code-backed native-depth intervention ledger' })
    getNativeBacklog() {
        const summary = summariseNativeBacklogDetailed();
        return {
            success: true,
            data: {
                generatedAt: new Date().toISOString(),
                state: summary.states,
                responsibility: summary.responsibilities,
                generatedFrom: summary.generatedFrom,
                internalGates: summary.internalGates,
                laterGates: summary.laterGates,
                profilesWithOpenCode: summary.profilesWithOpenCode,
                entries: deriveNativeBacklogAll(),
            },
        };
    }
}
