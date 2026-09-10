import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BenchmarkService, type PlanBenchmarkRequest } from './benchmark.service';

/**
 * A comparison is a platform claim, so operating one is a platform action. The
 * corpus endpoint is separate from the plan endpoint on purpose: it is how an
 * operator sees what would be compared, and what was refused, before anything
 * is stored or run.
 */
@Controller('benchmark/:tenantId')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class BenchmarkController {
    constructor(private readonly benchmark: BenchmarkService) {}
    private actor(req: any) { return { id: req.user?.sub ?? req.user?.id, role: req.user?.role }; }

    @Post('corpus')
    @Roles('super_admin')
    corpus(@Body() body: PlanBenchmarkRequest) {
        const built = this.benchmark.corpus(body);
        return { success: true, data: {
            corpusId: built.corpus.id, corpusHash: built.corpus.contentHash,
            tasks: built.corpus.tasks.length, emptyStrata: built.emptyStrata, refusals: built.refusals } };
    }

    @Post('runs')
    @Roles('super_admin')
    async plan(@Param('tenantId') tenantId: string, @Body() body: PlanBenchmarkRequest, @Req() req: any) {
        return { success: true, data: await this.benchmark.plan(tenantId, body, this.actor(req)) };
    }

    @Post('runs/start')
    @Roles('super_admin')
    async start(@Param('tenantId') tenantId: string,
        @Body() body: PlanBenchmarkRequest & { runIndex?: number }, @Req() req: any) {
        return { success: true,
            data: await this.benchmark.start(tenantId, body, this.actor(req), body?.runIndex) };
    }

    @Post('reviews')
    @Roles('super_admin')
    async review(@Param('tenantId') tenantId: string,
        @Body() body: { corpusHash: string; taskKey: string; blindLabel: string; reviewerId: string; score: number; notes?: string },
        @Req() req: any) {
        return { success: true,
            data: await this.benchmark.review(tenantId, body?.corpusHash, body, this.actor(req)) };
    }

    @Post('report')
    @Roles('super_admin', 'tenant_admin')
    async report(@Param('tenantId') tenantId: string, @Body() body: PlanBenchmarkRequest, @Req() req: any) {
        return { success: true, data: await this.benchmark.report(tenantId, body, this.actor(req)) };
    }
}
