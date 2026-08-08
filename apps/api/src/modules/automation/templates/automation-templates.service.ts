import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantThrottleService } from '../../throttle/tenant-throttle.service';
import { AutomationService } from '../automation.service';
import { seedAutomationTemplates } from './seed-templates';

@Injectable()
export class AutomationTemplatesService implements OnModuleInit {
    private readonly logger = new Logger(AutomationTemplatesService.name);
    private seeded = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly automationService: AutomationService,
        private readonly throttle: TenantThrottleService,
    ) {}

    async onModuleInit() {
        try {
            await this.ensureSeeded();
        } catch (err: any) {
            this.logger.warn(`Auto-seed skipped (table may not exist yet): ${err.message}`);
        }
    }

    private async ensureSeeded(): Promise<void> {
        if (this.seeded) return;
        // Always run the idempotent upsert (once per process): seedAutomationTemplates
        // updates existing rows (matched by name.en) and creates missing ones, so seed
        // changes — new languages, icons, actions — propagate to tenants that were
        // seeded before those fields existed. Previously this only ran when the table
        // was empty, leaving stale rows frozen at their first-seeded version.
        this.logger.log('Syncing automation templates (idempotent upsert)...');
        await seedAutomationTemplates(this.prisma as any);
        this.seeded = true;
        this.logger.log('Automation templates synced');
    }

    async listTemplates(filters?: { category?: string; industry?: string }) {
        await this.ensureSeeded();
        const where: any = { isActive: true };
        if (filters?.category) where.category = filters.category;
        if (filters?.industry) {
            where.OR = [
                { industry: filters.industry },
                { industry: null },
            ];
            delete where.isActive;
            where.AND = [{ isActive: true }];
        }
        return this.prisma.automationTemplate.findMany({
            where,
            orderBy: [{ popularityCount: 'desc' }, { createdAt: 'asc' }],
        });
    }

    async getTemplate(templateId: string) {
        const template = await this.prisma.automationTemplate.findUnique({
            where: { id: templateId },
        });
        if (!template) throw new NotFoundException('Template not found');
        return template;
    }

    async installTemplate(
        tenantId: string,
        schemaName: string,
        templateId: string,
        variables: Record<string, any>,
    ) {
        const template = await this.getTemplate(templateId);

        const resolvedVariables = this.resolveVariables(template.variables, variables);

        const triggerConfig = this.substituteVariables(template.triggerConfig, resolvedVariables);
        const actionsConfig = this.substituteVariables(template.actionsConfig, resolvedVariables);
        this.assertResolved(actionsConfig);

        const actions = Array.isArray(actionsConfig) ? actionsConfig : [];
        if (actions.some((action: any) => action?.type === 'http_request')
            && !(await this.throttle.isFeatureEnabled(tenantId, 'httpRequestAction'))) {
            throw new ForbiddenException({
                error: 'feature_not_available',
                feature: 'httpRequestAction',
                message: 'La plantilla requiere solicitudes HTTP, no disponibles en el plan actual.',
            });
        }

        const nameObj = template.name as any;
        const ruleName = nameObj?.es || nameObj?.en || 'Template Rule';

        const rule = await this.automationService.createRuleWithinQuota(
            schemaName,
            {
                tenant_id: tenantId,
                name: ruleName,
                trigger_type: (triggerConfig as any).trigger_type,
                conditions_json: (triggerConfig as any).conditions || [],
                actions_json: actions,
                active: false,
            },
            (currentCount) => this.throttle.enforcePlanLimit(
                tenantId, 'automationRules', currentCount, 'reglas de automatización',
            ),
        );

        await this.incrementPopularity(templateId);

        return rule;
    }

    async incrementPopularity(templateId: string) {
        await this.prisma.automationTemplate.update({
            where: { id: templateId },
            data: { popularityCount: { increment: 1 } },
        });
    }

    private substituteVariables(config: any, variables: Record<string, any>): any {
        const json = JSON.stringify(config);
        const substituted = json.replace(/\{\{(\w+)\}\}/g, (_, key) => {
            return variables[key] !== undefined ? String(variables[key]) : `{{${key}}}`;
        });
        return JSON.parse(substituted);
    }

    private resolveVariables(definitions: unknown, supplied: Record<string, any>): Record<string, any> {
        const resolved: Record<string, any> = {};
        const required: string[] = [];
        for (const definition of Array.isArray(definitions) ? definitions : []) {
            const key = typeof definition?.key === 'string' ? definition.key : '';
            if (!key) continue;
            if (definition.default !== undefined) resolved[key] = definition.default;
            if (definition.default === '' || definition.default == null) required.push(key);
        }
        for (const [key, value] of Object.entries(supplied || {})) resolved[key] = value;

        const missing = required.filter((key) => String(resolved[key] ?? '').trim() === '');
        if (missing.length) {
            throw new BadRequestException({
                error: 'automation_template_variables_required',
                missingVariables: missing,
                message: 'Completa las variables obligatorias antes de instalar la plantilla.',
            });
        }
        return resolved;
    }

    private assertResolved(config: unknown): void {
        const unresolved = [...JSON.stringify(config).matchAll(/\{\{(\w+)\}\}/g)]
            .map((match) => match[1]);
        if (unresolved.length) {
            throw new BadRequestException({
                error: 'automation_template_variables_unresolved',
                missingVariables: [...new Set(unresolved)],
                message: 'La plantilla contiene variables sin resolver.',
            });
        }
    }
}
