import { AGENT_SETUP_ESSENTIAL_TASKS, isEssentialSetupTask } from '@parallext/shared';
import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES, operationalStateFromCheck, operationalStateFromQuality,
    rollUpOperationalState, type AgentOperationalState } from '@parallext/shared';
import { admitSealedRunEvidence, aliasedChannelSpelling, canonicalEvidenceChannel, intentEvidence,
    readSealedRunEvidence, type IntentEvidenceScope, type SealedRunCandidate } from '../simulation/agent-release-evidence';
import { evaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { EvaluationRevisionService } from '../evaluation-revision/evaluation-revision.service';
import { buildAgentToolExplanations } from './agent-tool-explanations';
import { AGENT_TEST_SAFE_TOOL_NAMES } from '../conversations/agent-test-tool-policy';
import {
    AGENT_SETUP_TASK_CHECKS, buildDomainContractDraft, isAgentAccountBusinessHours, isAgentMissionV1, type AgentAssessment,
    type AgentMissionV1, type AgentSetupTask, type AgentQualityCheck, findGuidedTourForQualityCode,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { READINESS } from '../verticals/vertical-readiness.service';
import { readinessTablesToInspect } from '../../common/utils/readiness-predicate-authority.util';
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
function requiredInformation(value: unknown): Record<string, Array<{ field: string; question: string; validation?: string }>> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).slice(0, 10).flatMap(([context, fields]) => {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(context) || !Array.isArray(fields)) return [];
        const safe = fields.slice(0, 10).flatMap(field => {
            if (!field || typeof field !== 'object' || Array.isArray(field)) return [];
            const name = text((field as any).field, 80);
            const question = text((field as any).question, 500);
            if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name) || !question) return [];
            const validation = text((field as any).validation, 200);
            return [{ field: name, question, ...(validation ? { validation } : {}) }];
        });
        return [[context, safe]];
    }));
}
export function setupTaskStatus(checks: AgentQualityCheck[]): AgentSetupTask['status'] {
    if (!checks.length || checks.some(check => check.status === 'unknown')) return 'unknown';
    if (checks.some(check => check.status === 'fail')) return 'fail';
    if (checks.some(check => check.status === 'warning')) return 'warning';
    return checks.every(check => check.status === 'not_applicable') ? 'not_applicable' : 'pass';
}

/**
 * The channel types a customer can write through, the same set Calidad counts
 * as connections (`OPERATIONAL_CHANNELS` in agent-quality.service.ts).
 */
const OPERATIONAL_CONNECTION_TYPES = ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'];

/**
 * The channel task of an account with NO connection at all (audit #51).
 *
 * The agent is born with no channel assigned, so on a brand-new account
 * `channel_assignment` is the first check that fails, and the task said
 * "Asignar un canal conectado" and pointed at the agent editor — to assign a
 * channel that does not exist, four screens away from the WhatsApp question
 * that would create one. With zero connections the only true next step is to
 * connect one, whichever of the two checks reported the gap:
 * `channel_assignment` (nothing assigned; since Ola 6 it passes as soon as the
 * default agent answers any connection by fallback, so on the default agent
 * it only fails with nothing to answer) or `channel_connection` (assigned, but
 * nothing connected).
 *
 * Status and state are untouched: the checks said the truth; what was wrong
 * was the step they were turned into. `pendingCheckCode` moves to
 * `channel_connection` because that is the check "connect" repairs, and the
 * label every surface derives from it (`setupTaskLabelKey`) says so.
 * Anything else — an unsupported assignment, a connection nobody answers, a
 * count nobody could read — keeps its own diagnosis.
 */
export function connectFirstChannelTask(
    task: AgentSetupTask,
    operationalConnections: number | null,
): AgentSetupTask {
    if (task.key !== 'channel' || task.status !== 'fail' || operationalConnections !== 0) return task;
    if (task.pendingCheckCode !== 'channel_assignment' && task.pendingCheckCode !== 'channel_connection') return task;
    const whatsapp = task.channelType === undefined || task.channelType === 'whatsapp';
    return {
        ...task,
        ...(task.checks.some(check => check.code === 'channel_connection') ? { pendingCheckCode: 'channel_connection' } : {}),
        // WhatsApp is where most owners start, and its screen opens on the one
        // question that picks the route. Another preferred channel keeps the
        // channel list, where that channel's card is.
        href: whatsapp ? '/admin/channels/whatsapp' : '/admin/channels',
        tourId: whatsapp ? 'first_channel_whatsapp' : 'connect_channel',
        channelType: whatsapp ? 'whatsapp' : task.channelType,
    };
}

const SETUP_TOUR_CHANNELS = ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_chat'];

/**
 * The channel the channel task speaks about: the one its tour walks and its
 * repair screen opens (F17/F6).
 *
 * The wizard's order (`settings.setupWizardChannels`) answers "which channel
 * do I connect FIRST", so it leads only while the account is known to have NO
 * operational connection. From the first connection on, the agent's own
 * channels lead and the order is only a fallback. The wizard saves that order
 * on every stage save, so letting it lead forever told an owner whose
 * WhatsApp broke to repair Instagram, with the Instagram tour.
 *
 * Decided on the connection count, not on "the agent has assignments":
 *  - a legacy agent was seeded with all five channels, so its assignments say
 *    nothing about what to connect first; with nothing connected the owner's
 *    answer in the wizard is still the right first channel;
 *  - a D16 agent is born with none, and connecting a channel is what assigns
 *    it (`bindDefaultAgentToChannel`), so once something is connected its
 *    assignments are the real channels.
 * A count nobody could read (`null`) is never zero, so it keeps the agent's
 * channels first, the same rule `connectFirstChannelTask` applies.
 *
 * The tour contract names the embedded surface `web_chat`; the runtime
 * channel list names it `web_widget`. Both spellings come from the one alias
 * contract rather than from a ternary written here.
 */
export function preferredSetupChannel(
    wizardOrder: readonly string[],
    assigned: readonly string[],
    operationalConnections: number | null,
): AgentSetupTask['channelType'] {
    const ordered = operationalConnections === 0 ? [...wizardOrder, ...assigned] : [...assigned, ...wizardOrder];
    return ordered.map(aliasedChannelSpelling)
        .find(channel => SETUP_TOUR_CHANNELS.includes(channel)) as AgentSetupTask['channelType'];
}

/** Shared assessment, built from the same capability composer that runs the agent. */
@Injectable()
export class AgentAssessmentService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly quality: AgentQualityService,
        private readonly capabilities: TurnCapabilityComposerService,
        @Optional() private readonly revisions?: EvaluationRevisionService,
    ) {}

    /**
     * The service that captures the tenant's live evaluation dependencies.
     *
     * A DECLARED dependency. It was resolved through `ModuleRef` with
     * `{ strict: false }` while `CopilotModule` did not import
     * `EvaluationRevisionModule` — which works, and hides the edge: a container
     * lookup cannot fail at boot, so a missing provider would have surfaced as
     * "the evidence source is unreadable" on a live assessment rather than as a
     * red `test:bootstrap`. The module imports it now, so the wiring is checked
     * where wiring is supposed to be checked.
     *
     * Still `@Optional()`, because the harnesses that build this service
     * directly do not construct the whole graph, and because the honest failure
     * here is "unreadable" — never "no evidence exists".
     */
    private revisionAuthority(): EvaluationRevisionService | null {
        return this.revisions ?? null;
    }

    /**
     * Which columns each readiness table actually has, in THIS tenant's schema.
     *
     * Readiness reports one boolean per key, and a failed lookup is reported by
     * pushing `satisfied: true, count: 0` plus a report-wide degraded flag —
     * except when the failure message looks like a table the tenant never
     * provisioned, which is the branch that catches an absent COLUMN too,
     * because PostgreSQL says "does not exist" for both. So a predicate that
     * cannot run comes back as a real, confident zero, and the owner is told to
     * load data they already loaded.
     *
     * One catalogue read per assessment answers it from the outside: if the
     * predicate names a column this table does not have, the count it produced
     * cannot have been about the tenant's data, whatever it said. `null` when
     * the catalogue itself could not be read — which is not an empty schema, and
     * must not be reported as one.
     */
    private async readinessColumns(schema: string): Promise<Record<string, ReadonlySet<string>> | null> {
        const tables = readinessTablesToInspect(
            Object.keys(READINESS) as Array<keyof typeof READINESS>, READINESS);
        if (!tables.length) return {};
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT table_name, column_name FROM information_schema.columns
                 WHERE table_schema = $1 AND table_name = ANY($2::text[])`,
                [schema, tables]);
            const byTable: Record<string, Set<string>> = {};
            for (const row of rows ?? []) {
                const table = String(row.table_name);
                (byTable[table] ??= new Set()).add(String(row.column_name));
            }
            // A table the catalogue does not know is deliberately LEFT OUT
            // rather than recorded as having no columns. Most of these tables
            // are created lazily on first use, so "absent" means this tenant
            // never touched that vertical — and zero rows is the honest answer
            // to the question, exactly as the readiness lookup already treats
            // it. Recording it as a column-less table would turn every
            // unprovisioned vertical into an unreadable source, which is the
            // same lie in the other direction.
            return byTable;
        } catch { return null; }
    }

    /**
     * The live authority a stored run has to match, captured once per assessment
     * and only when candidate evidence exists to weigh.
     *
     * Opening a panel must not capture a new evaluation snapshot: that path
     * creates or leases a knowledge replica, freezes turn context and queries
     * MCP definitions. This reads the tenant's dependencies once, and re-reads
     * the agent version and the tenant settings afterwards so a configuration
     * that changed mid-read is reported as unreadable rather than published as a
     * mixture of two states. No hash is copied from a stored run.
     */
    private async evidenceAuthority(input: {
        tenantId: string; schema: string; agentId: string; agentVersion: number | null; config: unknown;
        profileId: string; channels: readonly string[]; settingsUpdatedAt: Date | null;
        runs: readonly SealedRunCandidate[];
    }): Promise<{ runs: readonly SealedRunCandidate[]; scope?: IntentEvidenceScope; readable: boolean }> {
        const revisions = this.revisionAuthority();
        if (!revisions) return { runs: [], readable: false };
        try {
            const manifest = await revisions.capture(input.tenantId);
            const [after, settings] = await Promise.all([
                this.prisma.executeInTenantSchema<any[]>(input.schema,
                    'SELECT version FROM agent_personas WHERE id = $1::uuid', [input.agentId]),
                this.prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { updatedAt: true } }),
            ]);
            if (Number(after[0]?.version) !== input.agentVersion
                || (settings?.updatedAt?.getTime() ?? null) !== (input.settingsUpdatedAt?.getTime() ?? null)) {
                return { runs: [], readable: false };
            }
            const configHash = evaluationSnapshot(input.tenantId, input.agentId,
                { version: input.agentVersion ?? undefined, config_json: input.config }).configHash;
            const admitted = admitSealedRunEvidence({ tenantId: input.tenantId, agentId: input.agentId,
                agentVersion: input.agentVersion, configHash, current: manifest, runs: input.runs });
            const channels = [...new Set(input.channels.map(canonicalEvidenceChannel))]
                .filter(channel => (CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel));
            return {
                runs: admitted.runs, readable: true,
                scope: channels.length ? {
                    agentId: input.agentId, dependencyRevision: manifest.revision, configHash,
                    profileId: input.profileId, channels, languages: [...EVAL_LANGUAGES],
                    currentDependencyRevisions: admitted.currentDependencyRevisions,
                } : undefined,
            };
        } catch { return { runs: [], readable: false }; }
    }

    /**
     * How many connections can carry a customer's message to this tenant at
     * all, counted like Calidad counts them: active `channel_accounts` of an
     * operational type plus the business's own active web chats. The public
     * demo link (`is_demo`) is not a connection. `null` when it could not be
     * read — which is never "zero", and never turns a task into "connect".
     */
    private async operationalConnectionCount(tenantId: string): Promise<number | null> {
        try {
            const rows = (await this.prisma.$queryRawUnsafe(
                `SELECT (SELECT COUNT(*)::int FROM public.channel_accounts
                          WHERE tenant_id = $1::uuid AND is_active = true
                            AND channel_type = ANY($2::text[]))
                      + (SELECT COUNT(*)::int FROM public.widget_configs
                          WHERE tenant_id = $1::uuid AND is_active = true
                            AND COALESCE(is_demo, false) = false) AS c`,
                tenantId, OPERATIONAL_CONNECTION_TYPES,
            )) as Array<{ c?: unknown }>;
            const count = Number(rows?.[0]?.c);
            return Number.isInteger(count) && count >= 0 ? count : null;
        } catch {
            return null;
        }
    }

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
        const [overview, channels, operationalConnections] = await Promise.all([
            this.quality.getOverview(tenantId, agent.id),
            Promise.all((assigned.length ? assigned : [null]).map(async channelType => {
                const scope = channelType ? 'assigned' as const : 'preview' as const;
                try {
                    const result = await this.capabilities.resolve({ tenantId, schemaName: schema, agentId: agent.id, config,
                        industry, subType, role: 'tenant_agent', channelType: channelType ?? undefined, refreshReadiness: true });
                    return { channelType, scope, status: result.contract ? 'known' as const : 'unavailable' as const, contract: result.contract };
                } catch { return { channelType, scope, status: 'unavailable' as const, contract: null }; }
            })),
            this.operationalConnectionCount(tenantId),
        ]);
        // The wizard's order only picks the channel while nothing is connected.
        const preferredChannel = preferredSetupChannel(strings(settings.setupWizardChannels), assigned, operationalConnections);
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
            // No `?? 'unknown'`: `operationalStateFromCheck` returns null only for
            // `not_applicable`, and calling that "nobody could read it" was not a
            // label problem. `unknown` dominates the roll-up, so one inapplicable
            // task made the whole agent permanently unreadable — a clinic with no
            // catalogue could never be reported as operating. `rollUpOperationalState`
            // already skips nulls, which is what it was written to do.
            state: override ?? operationalStateFromCheck(task.status, {
                // A task whose checks could not be read is unknown, whatever the
                // aggregate says: an unreadable source is not a passing one.
                sourceAvailable: !task.checks.some(check =>
                    (check as any)?.evidence?.sourceAvailability === 'unavailable'),
                // Known risks to a channel that still works today opt in, so
                // they read "needs attention", not "not ready to attend": a
                // credential about to expire, and a WhatsApp number with no
                // payment method in Meta before the date Meta stops delivering
                // without one (`whatsapp_delivery` at `warning`).
                operationalIssue: task.checks.some(check => check.evidence?.hasCredentialIssue === true
                    || (check.code === 'whatsapp_delivery' && check.status === 'warning')),
            }),
        });
        const tasks: AgentSetupTask[] = [withState({ key: 'mission', status: saved !== undefined && (!isAgentMissionV1(saved) || unsupportedIntents.length) ? 'fail' : configured ? 'pass' : 'warning', checks: [],
            href: `/admin/agent/${agent.id}`, tourId: null, dependsOn: [] },
            // `warning` on this task means "running on the template's mission",
            // not "something broke". It is unfinished setup, not a regression.
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
            const taskStatus = setupTaskStatus(relevant);
            const firstPending = relevant.find(check => check.status === taskStatus && ['fail', 'warning', 'unknown'].includes(check.status));
            tasks.push(connectFirstChannelTask(withState({ key: key as AgentSetupTask['key'], status: taskStatus, checks: relevant,
                ...(firstPending ? { pendingCheckCode: firstPending.code } : {}),
                ...defaults[key], href: firstPending?.href ?? defaults[key].href,
                // `whatsapp_delivery` has no tour: its fixes live on the WhatsApp
                // screen and in Meta. Falling back to the channel task's
                // "connect a channel" tour would walk the owner to connect a
                // channel that is already connected.
                tourId: firstPending?.status === 'unknown' || firstPending?.code === 'test_drive_permissions'
                    || firstPending?.code === 'whatsapp_delivery'
                    ? null : findGuidedTourForQualityCode(firstPending?.code, firstPending?.evidence)?.id ?? defaults[key].tourId,
                ...(key === 'channel' ? { channelType: preferredChannel } : {}) }), operationalConnections));
        }
        const catalog = getVerticalCatalog(industry, subType);
        if (catalog) {
            const relevant = checks.filter(check => check.href === catalog.route && check.code.startsWith('tool_'));
            tasks.push(withState({ key: 'catalog', status: setupTaskStatus(relevant), checks: relevant, href: catalog.route, tourId: null, dependsOn: ['mission'] }));
        }
        // What was actually proven for each task, instead of a literal that could
        // only ever say "not verified". Evidence from an older revision of the
        // agent is reported as stale: the configuration that passed is not the
        // one being assessed.
        const sealed = await this.prisma.transactionInTenantSchema(schema, query =>
            readSealedRunEvidence(query, schema, agent.id))
            .then(runs => ({ runs: runs as readonly SealedRunCandidate[], readable: true }))
            .catch(() => ({ runs: [] as readonly SealedRunCandidate[], readable: false }));
        // The live authority is captured only when there is something to weigh,
        // so a tenant that never ran an evaluation costs no dependency capture.
        const authority = sealed.readable && sealed.runs.length
            ? await this.evidenceAuthority({ tenantId, schema, agentId: agent.id, agentVersion: Number(agent.version) || null,
                config, profileId: domain.profileId, channels: assigned,
                settingsUpdatedAt: tenant?.updatedAt ?? null, runs: sealed.runs })
            : { runs: sealed.runs, scope: undefined as IntentEvidenceScope | undefined, readable: sealed.readable };
        const requiredTests = domain.intents.filter(intent => definition.intentKeys.includes(intent.key)).map(intent => {
            const evidence = intentEvidence(intent.key, Number(agent.version) || null, authority.runs, authority.scope);
            return {
            intentKey: intent.key, toolPlan: [...intent.toolPlan], terminalStates: [...intent.states], confirmation: intent.confirmation,
            fallback: intent.fallback, evidence,
            // An evidence source nobody could read is not an absence of evidence.
            // `not_verified` is the word a brand-new agent gets, and answering a
            // failed read with it is how an unreadable source becomes "prepared".
            state: (!authority.readable ? 'unknown'
                : evidence === 'verified' ? 'tested' : evidence === 'failed' ? 'degraded'
                    : evidence === 'stale' ? 'degraded' : 'pending') as AgentOperationalState,
            unavailableTools: intent.toolPlan.filter(tool => channels.some(channel => !channel.contract?.publishedTools.includes(tool))),
            }; });
        // The task that turns preparation into evidence now reads the evidence.
        // The quality overview says a run happened; it does not say the mission's
        // own tasks were proven by it, so "ready" alone could not close this task.
        const proven = requiredTests.length > 0 && requiredTests.every(test => test.evidence === 'verified')
            && overview.tested.status === 'ready' && !overview.tested.stale;
        tasks.push(withState({ key: 'tests',
            status: requiredTests.some(test => test.state === 'unknown') ? 'unknown'
                : requiredTests.some(test => test.evidence === 'failed') ? 'fail'
                    : proven || (!requiredTests.length && overview.tested.status === 'ready' && !overview.tested.stale) ? 'pass' : 'warning',
            checks: [], href: `/admin/agent/${agent.id}/test`, tourId: 'run_agent_tests', dependsOn: ['mission', 'agent', 'knowledge'] },
            // Like the mission task, `warning` here means "not proven yet", not
            // "something broke". Deriving the shared word from the status would
            // spell an agent that has simply never been tested `degraded`, which
            // dominates the roll-up and reads as a working thing that stopped.
            !requiredTests.length ? undefined
                : requiredTests.some(test => test.state === 'unknown') ? 'unknown'
                    : requiredTests.some(test => test.evidence === 'failed' || test.evidence === 'stale') ? 'degraded'
                        : proven ? 'tested' : 'pending'));
        // Essentials first: the setup card on Home shows only these, in this
        // order, and "the next thing to do" is the first essential still open.
        // Mission, knowledge, hours, appointments, catalog and tests make the
        // agent better; they follow, for the health panel.
        const essentialRank = (key: AgentSetupTask['key']) => {
            const index = AGENT_SETUP_ESSENTIAL_TASKS.indexOf(key);
            return index === -1 ? AGENT_SETUP_ESSENTIAL_TASKS.length : index;
        };
        tasks.sort((a, b) => essentialRank(a.key) - essentialRank(b.key));
        // A channel whose projection could not be read is unknown, not ready. A
        // channel whose contract blocks writers is not prepared either: the
        // profile, the role or the surface itself cannot commit the business
        // there, so no committing task of the mission can complete on it.
        const statedChannels = channels.map(channel => ({
            ...channel,
            state: channel.status === 'unavailable' ? ('unknown' as const)
                : channel.contract?.degraded ? ('degraded' as const)
                    : channel.contract?.writersBlocked ? ('pending' as const)
                        : channel.contract ? ('prepared' as const) : ('pending' as const),
        }));
        const toolNames = [...new Set(channels.flatMap(channel => channel.contract?.publishedTools ?? []))];
        // One catalogue read for the whole assessment, so every readiness answer
        // can say whether its source was readable instead of reporting a failed
        // lookup as data the owner never loaded.
        const readinessColumns = await this.readinessColumns(schema);
        const channelTools = statedChannels.map(channel => buildAgentToolExplanations({
            contract: channel.contract, domain, missionIntentKeys: definition.intentKeys, toolNames,
            evidenceByIntent: Object.fromEntries(requiredTests.map(test => [test.intentKey, test.evidence])),
            agentId: agent.id, language: typeof config.language === 'string' ? config.language : 'es',
            safeToolNames: new Set(AGENT_TEST_SAFE_TOOL_NAMES),
            readinessDefinitions: READINESS as Record<string, { table: string; where?: string; repairRoute?: string }>,
            readinessColumns,
        }));
        const tools = (channelTools[0] ?? []).map(first => {
            const entries = channelTools.map(items => items.find(item => item.tool === first.tool)!);
            const rolled = rollUpOperationalState(entries.map(entry => entry.state));
            // A published tool reads `prepared` when nothing disproved it, and
            // that answer is only available once the stored evidence has been
            // read. An unreadable source is not an empty one: it may not be
            // rendered as a tool that is ready.
            const state = !authority.readable && rolled === 'prepared' ? 'unknown' as const : rolled;
            // Preserve the actual channel's explanation for the limiting state;
            // never combine published names into a fabricated runtime contract.
            const limiting = entries.find(entry => entry.state === rolled)!;
            return { ...limiting, state,
                requires: { prerequisites: [...new Set(entries.flatMap(entry => entry.requires.prerequisites))],
                    readiness: [...new Set(entries.flatMap(entry => entry.requires.readiness))] },
                missing: { ...limiting.missing, readiness: [...new Set(entries.flatMap(entry => entry.missing.readiness))] },
            };
        });
        const blockedTool = tools.find(tool => tool.missionIntents.length > 0 && tool.state !== 'operating');
        const assessment: AgentAssessment = {
            version: 1, revision: '', generatedAt: new Date().toISOString(), agent: overview.agent, overview,
            mission: { source: configured ? 'configured' : 'template_derived', templateId: agent.template_id ?? null, profileId: domain.profileId, definition, availableIntentKeys: domain.intents.map(intent => intent.key), unsupportedIntents },
            channels: statedChannels, tasks,
            // A tool the mission needs that is not operating is unfinished work
            // even when every setup task passes, so the next action is the route
            // named by the gate that refused it when a task owns that route, and
            // otherwise the surface that exercises tools.
            nextTask: tasks.find(task => !['pass', 'not_applicable'].includes(task.status))?.key
                ?? (blockedTool ? tasks.find(task => task.href === blockedTool.missing.repairRoute)?.key
                    ?? tasks.find(task => task.key === 'tests')?.key ?? null : null),
            requiredTests,
            // The two rules that make the shared word worth having: nothing
            // unreadable becomes "operating", and one broken part is never
            // averaged away by the green ones around it. Tools and the mission's
            // own tasks are parts of the agent: leaving them out let the whole
            // read "operating" while a needed tool was blocked and not one task
            // of the mission had been proven.
            // "Can it attend today" is decided by what is verifiable: the
            // essential tasks, plus any REAL problem elsewhere (something
            // unreadable, something that broke). A template-derived mission or a
            // test that was never run is unfinished polish, not a reason to tell
            // a new owner that a working agent "is not ready" (owner decision D2,
            // sep-2026); those tasks keep their own `pending` for the health panel.
            state: rollUpOperationalState([
                operationalStateFromQuality(overview.status),
                ...tasks.filter(task => isEssentialSetupTask(task.key) || task.state === 'degraded' || task.state === 'unknown').map(task => task.state),
                ...statedChannels.map(channel => channel.state),
                ...tools.map(tool => tool.state),
                ...requiredTests.filter(test => test.state !== 'pending').map(test => test.state),
            ]),
            // No cast. The contract carries `readinessAudit` now, so the
            // shape the surfaces read is the shape this hands over — the cast
            // was what let a field every screen depends on live outside the
            // one declaration they all share, and it was hiding a second
            // thing too: this builds frozen arrays and the contract asked for
            // mutable ones.
            tools,
            configuration: { persona: { name: text(config.persona?.name), role: text(config.persona?.role), greeting: text(config.persona?.greeting), fallbackMessage: text(config.persona?.fallbackMessage),
                personality: { tone: text(config.persona?.personality?.tone), formality: text(config.persona?.personality?.formality),
                    emojiUsage: text(config.persona?.personality?.emojiUsage, 20), humor: text(config.persona?.personality?.humor) } },
                behavior: { mainInstructions: text(config.behavior?.mainInstructions), rules: strings(config.behavior?.rules),
                    requiredFields: requiredInformation(config.behavior?.requiredFields), forbiddenTopics: strings(config.behavior?.forbiddenTopics),
                    handoffTriggers: strings(config.behavior?.handoffTriggers) },
                editorMode: (config.editorMode ?? config._mode) === 'prompt' ? 'prompt' : 'guided',
                customPrompt: text(config.customPrompt ?? config._customPrompt, 16000),
                customPromptTruncated: typeof (config.customPrompt ?? config._customPrompt) === 'string' && (config.customPrompt ?? config._customPrompt).length > 16000,
                language: text(config.language, 20), skillset: text(config.skillset, 20),
                upsell: { enabled: config.upsell?.enabled === true, intensity: text(config.upsell?.intensity, 20),
                    maxDiscountPercent: typeof config.upsell?.maxDiscountPercent === 'number' ? config.upsell.maxDiscountPercent : null },
                llm: { temperature: typeof config.llm?.temperature === 'number' ? config.llm.temperature : null,
                    maxTokens: typeof config.llm?.maxTokens === 'number' ? config.llm.maxTokens : null },
                rag: { enabled: config.rag?.enabled === true, topK: typeof config.rag?.topK === 'number' ? config.rag.topK : null,
                    similarityThreshold: typeof config.rag?.similarityThreshold === 'number' ? config.rag.similarityThreshold : null },
                hours: { aiOutsideHours: config.hours?.aiOutsideHours !== false,
                    afterHoursMessageOverride: text(config.hours?.afterHoursMessageOverride) },
                tools: Object.fromEntries(Object.entries(config.tools ?? {}).map(([key, value]) => [key,
                    Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([flag, val]) => ['enabled', 'canBook', 'canCancel', 'canCheckStock', 'canRecommend', 'canApplyDiscount', 'canCreateLinks', 'emailConfirmations'].includes(flag) && typeof val === 'boolean'))])),
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
            state: 'pending', nextTask: 'agent', requiredTests: [], tools: [], configuration: null };
    }
}
