import { BadRequestException, Body, Controller, Get, Logger, Put, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { auditActor } from '../../common/utils/audit-actor.util';
import { PrismaService } from '../prisma/prisma.service';
import {
    DEMO_ALLOWANCE_DEFAULTS,
    DEMO_ALLOWANCE_LIMITS,
    DEMO_ALLOWANCE_SETTINGS_KEY,
    DEMO_ALLOWANCE_UNREADABLE,
    DemoAllowanceService,
    validateDemoAllowancePatch,
    type DemoAllowance,
    type DemoAllowanceSource,
} from '../throttle/demo-allowance.service';

/**
 * The platform-paid allowance of "El enlace de {Nombre}" (D19), for the
 * platform owner.
 *
 * The three numbers — switch, lifetime replies per tenant, replies per page
 * and day — lived in `platform_settings` with no way to change them but SQL:
 * the generic settings PUT refuses the `onboarding` category on purpose, so a
 * cost the platform pays on every tenant's link had no screen, no validation
 * and no trace of who moved it. This is that screen's API, calqued from the
 * coupon governance (`billing-coupons/admin/governance`): super_admin only,
 * strict on input, and every change audited with the before and after under
 * the REAL operator (`auditActor`, never a bare id).
 */
@ApiTags('platform')
@Controller('platform/demo-allowance')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@Roles('super_admin')
@ApiBearerAuth()
export class DemoAllowanceController {
    private readonly logger = new Logger(DemoAllowanceController.name);

    constructor(
        private readonly allowance: DemoAllowanceService,
        private readonly prisma: PrismaService,
    ) {}

    /**
     * `source` says whether `allowance` is the stored row, the defaults in
     * force, or the defaults standing in for a database that could not be read
     * (`fallback`). The screen warns on `fallback` and does not offer to save:
     * those numbers are not what the platform has stored.
     */
    @Get()
    @ApiOperation({ summary: 'Read the platform-paid allowance of the public demo link (effective values, where they came from, defaults and limits)' })
    async read() {
        const reading = await this.allowance.getWithSource();
        return { success: true, data: this.describe(reading.allowance, reading.source) };
    }

    @Put()
    @ApiOperation({ summary: 'Change the platform-paid allowance of the public demo link (audited)' })
    async update(@Body() body: Record<string, unknown>, @Req() req: any) {
        const { patch, errors } = validateDemoAllowancePatch(body);
        if (errors.length) {
            throw new BadRequestException({
                error: 'demo_allowance_invalid',
                message: 'The demo allowance edit is not valid',
                fields: errors,
            });
        }
        const current = await this.allowance.getWithSource();
        if (current.source === 'fallback') {
            // The stand-in defaults are not a "before": auditing them, or
            // merging the edit over them, would record and store numbers
            // nobody chose. `set()` refuses on its own too.
            throw new ServiceUnavailableException({
                error: DEMO_ALLOWANCE_UNREADABLE,
                message: 'The stored demo allowance could not be read; nothing was changed',
            });
        }
        const before = current.allowance;
        const after = await this.allowance.set(patch);

        // Only what actually moved is a change; saving the same numbers again
        // is not an event anybody needs to read in the audit log.
        const changes = (Object.keys(after) as Array<keyof typeof after>)
            .filter((key) => before[key] !== after[key]);
        if (changes.length) {
            const actor = auditActor(req?.user);
            await this.prisma.auditLog.create({
                data: {
                    tenantId: null,
                    userId: actor.userId,
                    action: 'platform.demo_allowance_changed',
                    resource: `platform_settings/${DEMO_ALLOWANCE_SETTINGS_KEY}`,
                    details: { before, after, changed: changes, ...(actor.delegation ?? {}) } as any,
                },
            }).catch((error: any) => {
                // A cost the platform pays on every tenant's link must not move
                // silently; the change stands, and the missing trace is loud.
                this.logger.error(`[DemoAllowance] Failed to audit the change: ${error?.message}`);
            });
        }
        // What was just written is what is stored now.
        return { success: true, data: this.describe(after, 'stored') };
    }

    /** One shape for both verbs, so the screen renders straight from either. */
    private describe(allowance: DemoAllowance, source: DemoAllowanceSource) {
        return { allowance, source, defaults: DEMO_ALLOWANCE_DEFAULTS, limits: DEMO_ALLOWANCE_LIMITS };
    }
}
