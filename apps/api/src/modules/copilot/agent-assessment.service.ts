import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { operationalStateFromCheck, operationalStateFromQuality, rollUpOperationalState,
    type AgentOperationalState } from '@parallext/shared';
import {
    AGENT_SETUP_TASK_CHECKS, buildDomainContractDraft, isAgentAccountBusinessHours, isAgentMissionV1, type AgentAssessment,
    type AgentMissionV1, type AgentSetupTask, type AgentQualityCheck, findGuidedTourForQualityCode,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AgentQualityService } from '../quality/agent-quality.service';
import { TurnCapabilityComposerService } from '../conversations/turn-capability-composer.service';
import { getVerticalCatalog } from '../../common/utils/vertical-catalog.util';

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as any)[key])}`).join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}
function strings(value: unknown, limit = 20): string[] {
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).slice(0, limit).map(item => item.slice(0, 2000)) : [];
}
function text(value: unknown, limit = 4000): string { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
export function setupTaskStatus(checks: AgentQualityCheck[]): AgentSetupTask['status'] {
    if (!checks.length || checks.some(check => check.status === 'unknown')) return 'unknown';
    if (checks.some(check => check.status === 'fail')) return 'fail';
    if (checks.some(check => check.status === 'warning')) return 'warning';
    return checks.every(check => check.status === 'not_applicable') ? 'not_applicable' : 'pass';
}

/** Shared assessment, built from the same capability composer that runs the agent. */
@Injectable()
export class AgentAssessmentService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly quality: AgentQualityService,
        private readonly capabilities: TurnCapabilityComposerService,
    ) {}

    async getAssessment(tenantId: string, agentId?: string, attempt = 0): Promise<AgentAssessment> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!schema) throw new NotFoundException('Tenant not found');
        const [rows, tenant] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT id, name, template_id, version, config_json, channels, channel_bindings FROM agent_personas
                 WHERE ($1::uuid IS NULL OR id = $1::uuid)
                 ORDER BY is_default DESC, is_active DESC, created_at ASC LIMIT 1`, [agentId ?? null]),
            this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { industry: true, settings: true, updatedAt: true } }),
        ]);
        const agent = rows[0];
        if (!agent && agentId) throw new NotFoundException('Agent not found');
        if (!agent) return this.noAgent();
        const settings = (tenant?.settings ?? {}) as any;
        const industry = settings.verticalConfig?.industry ?? tenant?.industry ?? 'otro';
        const subType = settings.verticalConfig?.subType ?? settings.subType ?? null;
        const config = agent.config_json ?? {};
        const domain = buildDomainContractDraft(industry, subType);
        const assigned = [...new Set<string>([...strings(agent.channels), ...strings(agent.channel_bindings).map(binding => binding.split(':')[0])])];
        const preferredChannel = [...strings(settings.setupWizardChannels), ...assigned].map(channel => channel === 'web_widget' ? 'web_chat' : channel)
            .find(channel => ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_chat'].includes(channel)) as AgentSetupTask['channelType'];
        const [overview, channels] = await Promise.all([
            this.quality.getOverview(tenantId, agent.id),
            Promise.all((assigned.length ? assigned : [null]).map(async channelType => {
                const scope = channelType ? 'assigned' as const : 'preview' as const;
                try {
                    const result = await this.capabilities.resolve({ tenantId, schemaName: schema, agentId: agent.id, config,
                        industry, subType, role: 'tenant_agent', channelType: channelType ?? undefined });
                    return { channelType, scope, status: result.contract ? 'known' as const : 'unavailable' as const, contract: result.contract };
                } catch { return { channelType, scope, status: 'unavailable' as const, contract: null }; }
            })),
        ]);
        const current = await this.prisma.executeInTenantSchema<any[]>(schema, 'SELECT version FROM agent_personas WHERE id = $1::uuid', [agent.id]);
        if (Number(agent.version) !== overview.agent.version || Number(current[0]?.version) !== overview.agent.version) {
            if (attempt === 0) return this.getAssessment(tenantId, agent.id, 1);
            throw new ConflictException('Agent changed during assessment; retry');
        }
        const saved = config.mission;
        const configured = saved?.version === 1 && text(saved.objective) && strings(saved.intentKeys).length > 0;
        const definition: AgentMissionV1 = {
            version: 1,
            objective: text(configured ? saved.objective : config.persona?.role) || domain.prompt.scope,
            intentKeys: configured ? strings(saved.intentKeys) : domain.intents.map(intent => intent.key),
            successCriteria: configured ? strings(saved.successCriteria) : [],
            handoffConditions: configured ? strings(saved.handoffConditions) : strings(config.behavior?.handoffTriggers),
        };
        const unsupportedIntents = definition.intentKeys.filter(key => !domain.intents.some(intent => intent.key === key));
        const checks = overview.preparation.dimensions.flatMap(dimension => dimension.checks);
        // Every task carries the shared word as well as its own status, and it
        // is derived here rather than in each screen — three surfaces reading one
        // status and inventing three labels is exactly what this replaces.
        const withState = (task: Omit<AgentSetupTask, 'state'>, override?: AgentOperationalState): AgentSetupTask => ({
            ...task,
            state: override ?? operationalStateFromCheck(task.status, {
                // A task whose checks could not be read is unknown, whatever the
                // aggregate says: an unreadable source is not a passing one.
                sourceAvailable: !task.checks.some(check =>
                    (check as any)?.evidence?.sourceAvailability === 'unavailable'),
            }) ?? 'unknown',
        });
        const tasks: AgentSetupTask[] = [withState({ key: 'mission', status: saved !== undefined && (!isAgentMissionV1(saved) || unsupportedIntents.length) ? 'fail' : configured ? 'pass' : 'warning', checks: [],
            href: `/admin/agent/${agent.id}`, tourId: null, dependsOn: [] },
            // `warning` on this task means "running on the template's mission",
            // not "something broke". Everywhere else warning is "revisar", which
            // is why the shared word is stated here instead of derived.
            configured ? undefined : 'pending')];
        const defaults: Record<string, { href: string; tourId: AgentSetupTask['tourId']; dependsOn: AgentSetupTask['key'][] }> = {
            channel: { href: '/admin/channels', tourId: 'connect_channel', dependsOn: ['agent'] },
            agent: { href: `/admin/agent/${agent.id}`, tourId: 'agent_handoff_rules', dependsOn: ['mission'] },
            business: { href: '/admin/settings/business-info', tourId: 'business_identity', dependsOn: [] },
            knowledge: { href: '/admin/knowledge', tourId: 'knowledge_base', dependsOn: ['business'] },
            team: { href: '/admin/users', tourId: 'human_handoff_route', dependsOn: [] },
            hours: { href: '/admin/settings/business-hours', tourId: 'business_hours', dependsOn: [] },
            appointments: { href: '/admin/appointments', tourId: 'appointments_setup', dependsOn: ['hours'] },
        };
        for (const [key, codes] of Object.entries(AGENT_SETUP_TASK_CHECKS)) {
            const relevant = checks.filter(check => codes.includes(check.code));
            if (key === 'appointments' && relevant.every(check => check.status === 'not_applicable')) continue;
            const firstPending = relevant.find(check => ['fail', 'warning', 'unknown'].includes(check.status));
            tasks.push(withState({ key: key as AgentSetupTask['key'], status: setupTaskStatus(relevant), checks: relevant,
                ...defaults[key], href: firstPending?.href ?? defaults[key].href,
                tourId: firstPending?.code === 'test_drive_permissions' ? null : findGuidedTourForQualityCode(firstPending?.code)?.id ?? defaults[key].tourId,
                ...(key === 'channel' ? { channelType: preferredChannel } : {}) }));
        }
        const catalog = getVerticalCatalog(industry, subType);
        if (catalog) {
            const relevant = checks.filter(check => check.href === catalog.route && check.code.startsWith('tool_'));
            tasks.push(withState({ key: 'catalog', status: setupTaskStatus(relevant), checks: relevant, href: catalog.route, tourId: null, dependsOn: ['mission'] }));
        }
        tasks.push(withState({ key: 'tests', status: overview.tested.status === 'ready' && !overview.tested.stale ? 'pass' : 'warning', checks: [],
            href: `/admin/agent/${agent.id}/test`, tourId: 'run_agent_tests', dependsOn: ['mission', 'agent', 'knowledge'] }));
        const requiredTests = domain.intents.filter(intent => definition.intentKeys.includes(intent.key)).map(intent => ({
            intentKey: intent.key, toolPlan: [...intent.toolPlan], terminalStates: [...intent.states], confirmation: intent.confirmation,
            fallback: intent.fallback, evidence: 'not_verified' as const,
            unavailableTools: intent.toolPlan.filter(tool => channels.some(channel => !channel.contract?.publishedTools.includes(tool))),
        }));
        // A channel whose projection could not be read is unknown, not ready.
        const statedChannels = channels.map(channel => ({
            ...channel,
            state: channel.status === 'unavailable' ? ('unknown' as const)
                : channel.contract?.degraded ? ('degraded' as const)
                    : channel.contract ? ('prepared' as const) : ('pending' as const),
        }));
        const assessment: AgentAssessment = {
            version: 1, revision: '', generatedAt: new Date().toISOString(), agent: overview.agent, overview,
            mission: { source: configured ? 'configured' : 'template_derived', templateId: agent.template_id ?? null, profileId: domain.profileId, definition, availableIntentKeys: domain.intents.map(intent => intent.key), unsupportedIntents },
            channels: statedChannels, tasks, nextTask: tasks.find(task => !['pass', 'not_applicable'].includes(task.status))?.key ?? null, requiredTests,
            // The two rules that make the shared word worth having: nothing
            // unreadable becomes "operating", and one broken part is never
            // averaged away by the green ones around it.
            state: rollUpOperationalState([
                operationalStateFromQuality(overview.status),
                ...tasks.map(task => task.state),
                ...statedChannels.map(channel => channel.state),
            ]),
            configuration: { persona: { name: text(config.persona?.name), role: text(config.persona?.role), greeting: text(config.persona?.greeting), fallbackMessage: text(config.persona?.fallbackMessage),
                personality: { tone: text(config.persona?.personality?.tone), formality: text(config.persona?.personality?.formality) } },
                behavior: { rules: strings(config.behavior?.rules), forbiddenTopics: strings(config.behavior?.forbiddenTopics), handoffTriggers: strings(config.behavior?.handoffTriggers) },
                editorMode: (config.editorMode ?? config._mode) === 'prompt' ? 'prompt' : 'guided',
                customPrompt: text(config.customPrompt ?? config._customPrompt, 16000),
                customPromptTruncated: typeof (config.customPrompt ?? config._customPrompt) === 'string' && (config.customPrompt ?? config._customPrompt).length > 16000,
                language: text(config.language, 20), tools: Object.fromEntries(Object.entries(config.tools ?? {}).map(([key, value]) => [key,
                    Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([flag, val]) => ['enabled', 'canBook', 'canCancel', 'canCheckStock', 'canRecommend', 'canCreateLinks'].includes(flag) && typeof val === 'boolean'))])),
                account: { businessHours: isAgentAccountBusinessHours(settings.businessHours) ? settings.businessHours : null,
                    businessHoursStatus: settings.businessHours === undefined ? 'absent' : isAgentAccountBusinessHours(settings.businessHours) ? 'valid' : 'invalid' } },
        };
        assessment.revision = createHash('sha256').update(canonical({ version: agent.version, config, settingsUpdatedAt: tenant?.updatedAt, tasks,
            channels: channels.map(channel => ({ ...channel, contract: channel.contract ? { ...channel.contract, resolvedAt: undefined } : null })) })).digest('hex');
        return assessment;
    }

    private noAgent(): AgentAssessment {
        return { version: 1, revision: 'no_agent', generatedAt: new Date().toISOString(), agent: null, overview: null,
            mission: { source: 'not_configured', templateId: null, profileId: null, definition: null, availableIntentKeys: [], unsupportedIntents: [] }, channels: [],
            // No agent at all is `pending`, not `unknown`: the answer is known
            // and it is that nothing has been created yet.
            tasks: [{ key: 'agent', status: 'fail', state: 'pending', checks: [], href: '/admin/agent', tourId: null, dependsOn: [] }],
            state: 'pending', nextTask: 'agent', requiredTests: [], configuration: null };
    }
}
