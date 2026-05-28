import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AutomationService } from '../automation.service';
import { seedAutomationTemplates } from './seed-templates';

@Injectable()
export class AutomationTemplatesService implements OnModuleInit {
    private readonly logger = new Logger(AutomationTemplatesService.name);
    private seeded = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly automationService: AutomationService,
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
        const count = await this.prisma.automationTemplate.count();
        if (count === 0) {
            this.logger.log('No automation templates found — seeding defaults...');
            await seedAutomationTemplates(this.prisma as any);
            this.logger.log('Automation templates seeded successfully');
        }
        this.seeded = true;
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

        const triggerConfig = this.substituteVariables(template.triggerConfig, variables);
        const actionsConfig = this.substituteVariables(template.actionsConfig, variables);

        const nameObj = template.name as any;
        const ruleName = nameObj?.es || nameObj?.en || 'Template Rule';

        const rule = await this.automationService.createRule(schemaName, {
            tenant_id: tenantId,
            name: ruleName,
            trigger_type: (triggerConfig as any).trigger_type || 'lead.captured',
            conditions_json: (triggerConfig as any).conditions || [],
            actions_json: actionsConfig,
            active: false,
        });

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
}
