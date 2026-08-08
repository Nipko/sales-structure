import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { isAutomationTriggerType, isVerticalManifestIndustry } from '@parallext/shared';
import { AutomationTemplatesService } from './automation-templates.service';
import { AUTOMATION_TEMPLATE_SEEDS } from './seed-templates';

describe('AutomationTemplatesService', () => {
    function build(template: any, featureEnabled = true) {
        const prisma = {
            automationTemplate: {
                findUnique: jest.fn().mockResolvedValue(template),
                update: jest.fn().mockResolvedValue(undefined),
            },
        };
        const automation = {
            createRuleWithinQuota: jest.fn(async (_schema: string, payload: any, enforce: any) => {
                await enforce(2);
                return { id: 'rule-1', ...payload };
            }),
        };
        const throttle = {
            enforcePlanLimit: jest.fn().mockResolvedValue(undefined),
            isFeatureEnabled: jest.fn().mockResolvedValue(featureEnabled),
        };
        return {
            service: new AutomationTemplatesService(prisma as any, automation as any, throttle as any),
            automation,
            throttle,
        };
    }

    const baseTemplate = {
        id: 'template-1',
        name: { es: 'Bienvenida', en: 'Welcome' },
        triggerConfig: { trigger_type: 'lead.captured', conditions: [] },
        actionsConfig: [{ type: 'send_template', config: { template_name: '{{template_name}}' } }],
        variables: [{ key: 'template_name', default: 'welcome' }],
    };

    it('applies defaults and enforces the total rule quota during installation', async () => {
        const { service, automation, throttle } = build(baseTemplate);

        await service.installTemplate('tenant-1', 'tenant_schema', 'template-1', {});

        expect(throttle.enforcePlanLimit).toHaveBeenCalledWith(
            'tenant-1', 'automationRules', 2, 'reglas de automatización',
        );
        expect(automation.createRuleWithinQuota).toHaveBeenCalledWith(
            'tenant_schema',
            expect.objectContaining({
                trigger_type: 'lead.captured',
                actions_json: [{ type: 'send_template', config: { template_name: 'welcome' } }],
                active: false,
            }),
            expect.any(Function),
        );
    });

    it('rejects a required blank variable before creating a dormant broken rule', async () => {
        const { service, automation } = build({
            ...baseTemplate,
            variables: [{ key: 'agent_id', default: '' }],
            actionsConfig: [{ type: 'assign_agent', config: { agent_id: '{{agent_id}}' } }],
        });

        await expect(service.installTemplate('tenant-1', 'tenant_schema', 'template-1', {}))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(automation.createRuleWithinQuota).not.toHaveBeenCalled();
    });

    it('does not let a template bypass the plan gate for HTTP actions', async () => {
        const { service, automation } = build({
            ...baseTemplate,
            actionsConfig: [{ type: 'http_request', config: { url: 'https://example.com' } }],
            variables: [],
        }, false);

        await expect(service.installTemplate('tenant-1', 'tenant_schema', 'template-1', {}))
            .rejects.toBeInstanceOf(ForbiddenException);
        expect(automation.createRuleWithinQuota).not.toHaveBeenCalled();
    });

    it('keeps every seed on canonical industries and runtime-backed triggers', () => {
        for (const template of AUTOMATION_TEMPLATE_SEEDS) {
            expect(template.industry == null || isVerticalManifestIndustry(template.industry)).toBe(true);
            expect(isAutomationTriggerType(template.triggerConfig.trigger_type)).toBe(true);
        }
        const afterHours = AUTOMATION_TEMPLATE_SEEDS.find((template) =>
            template.triggerConfig.trigger_type === 'new_message');
        expect(afterHours?.triggerConfig.conditions).toContainEqual({
            field: 'businessHoursStatus', operator: 'equals', value: 'closed',
        });
    });
});
