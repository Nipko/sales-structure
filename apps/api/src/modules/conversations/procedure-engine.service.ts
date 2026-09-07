import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import {
    decideToolAuthority,
    normalizeForIntent,
    type ProcedureDefinition, type ProcedureStep, type ProcedureRunState,
    type ToolAuthorityDecision, type ToolExecutionAuthority,
} from '@parallext/shared';
import { isNonCommittalTool } from './tool-policy-registry';
import {
    interpolateProcedureArgs,
    coerceProcedureSlot,
    type ProcedureSlotSpec,
} from './procedure-slot-interpolation';
import { isInformationSeekingMessage, isPauseMessage, isResumeMessage, normalizeCustomerIntent } from '../../common/conversation/intent-normalizer';
import { procedureDialogueMessages } from './procedure-dialogue-messages';
import { LanguageDetectorService } from './language-detector.service';

export interface ProcedureProcessResult {
    handled: boolean;
    /** Directive text for the LLM to voice (what to say), like the booking engine. */
    text?: string;
    completed?: boolean;
    handoff?: boolean;
    handoffReason?: string;
    procedureName?: string;
    dialogueAct?: 'question' | 'pause' | 'cancel' | 'resume' | 'invalid';
}

/**
 * The agent this procedure is running for.
 *
 * Without it the engine ran every active procedure of the tenant against every
 * conversation and handed the executor any tool name a step happened to
 * contain — so a procedure authored for the restaurant fired inside a gym
 * conversation, and a step could call a tool the agent had switched off.
 */
export interface ProcedureAgentContext {
    /** Tenant vertical. A procedure tagged for another vertical never matches. */
    industry?: string;
    subType?: string;
    /** The agent's saved tool config, used to compile tool steps. */
    toolsConfig?: unknown;
    channelType?: string;
    language?: string;
    /**
     * La autoridad de ejecución de ESTE turno.
     *
     * La autorización de un paso se decidía contra la config guardada del
     * agente, que es una preferencia del dueño y no una concesión de autoridad:
     * un procedimiento podía invocar un writer en un perfil bloqueado, por plan
     * insuficiente o sin los datos que la tool necesita. Y cuando el contrato no
     * llegaba, la autorización *caía* a esa config — es decir, el camino más
     * degradado era también el más permisivo.
     *
     * Ahora es lo mismo que mira el ejecutor, y sin ella no corre ningún paso
     * de tool: un procedimiento detenido se retoma, uno que escribió sin
     * permiso no se deshace.
     */
    authority?: ToolExecutionAuthority;

    /**
     * El negocio no puede comprometerse en este turno. Se propaga al ejecutor
     * para que un paso de tool no escriba aunque el motor haya llegado hasta
     * acá por otro camino.
     */
    commitmentBlocked?: { reason: string } | null;

    /** Lo que el dueño apagó a mano. Se propaga al ejecutor. */
    deniedTools?: readonly string[];
}

const STATE_TTL = 3600; // 1h
const MISSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_CACHE_TTL = 300; // 5min
const MAX_STEPS_PER_TURN = 25;
const MAX_PAUSED_MISSIONS = 4;
const SELECT_MISSION = /^(?:quiero|necesito|ahora|tambien|retomemos|retomar|continuar con|i want|i need|now|also|resume|continue with|quero|preciso|agora|tambem|retomar|continuar com|je veux|je souhaite|j ai besoin|maintenant|reprendre|reprenons|continuer avec)\b/;
const CANCEL_CURRENT_COLLECTION = /^(?:(?:por favor|please)\s+)?(?:cancelar|cancela|cancelalo|cancel|annuler|arretez|olvidalo|olvidate|dejemoslo|deixa pra la|ya no quiero(?: continuar)?|no quiero continuar|nao quero continuar|i don't want to continue|i do not want to continue|je ne veux plus continuer|mejor nada|nada de eso)(?:\s+(?:por favor|please))?[.!\s]*$/;

export interface ProcedureStateStore {
    load(schemaName: string, conversationId: string): Promise<ProcedureRunState | null>;
    save(schemaName: string, conversationId: string, state: ProcedureRunState): Promise<void>;
    clear(schemaName: string, conversationId: string): Promise<void>;
}

export interface ProcedureDefinitionStore {
    listActive(schemaName: string): Promise<ProcedureDefinition[]>;
    getById(schemaName: string, id: string): Promise<ProcedureDefinition | null>;
}

/**
 * Deterministic procedure (AOP/SOP) execution engine — T2.12.
 *
 * Mirrors the booking engine's directive pattern: the engine decides the flow
 * step-by-step and returns ONE directive per turn; the LLM only voices it. The
 * LLM never decides which step comes next, so the flow can't be hallucinated.
 *
 * State is kept in Redis `procedure:{conversationId}`. Procedure definitions are
 * read directly from the tenant `procedures` table (created by ProceduresService).
 */
@Injectable()
export class ProcedureEngineService {
    private readonly logger = new Logger(ProcedureEngineService.name);
    private stateStore?: ProcedureStateStore;
    private definitionStore?: ProcedureDefinitionStore;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly toolExecutor: AIToolExecutorService,
    ) {}

    private stateKey(conversationId: string): string {
        return `procedure:${conversationId}`;
    }

    forExecution(ports: { redis?: RedisService; toolExecutor?: AIToolExecutorService; persistence: ProcedureStateStore; definitions?: ProcedureDefinitionStore }): ProcedureEngineService {
        const engine = new ProcedureEngineService(this.prisma, ports.redis || this.redis, ports.toolExecutor || this.toolExecutor);
        engine.stateStore = ports.persistence;
        engine.definitionStore = ports.definitions;
        return engine;
    }

    async getState(conversationId: string, schemaName?: string): Promise<ProcedureRunState | null> {
        if (this.stateStore) {
            if (!schemaName) throw new Error('procedure_schema_required');
            const state = await this.stateStore.load(schemaName, conversationId);
            if (state?.expiresAt && (!Number.isFinite(Date.parse(state.expiresAt)) || Date.parse(state.expiresAt) <= Date.now())) {
                return this.finishCurrentMission(conversationId, state, schemaName);
            }
            return state;
        }
        if (!schemaName) return this.redis.getJson<ProcedureRunState>(this.stateKey(conversationId));
        // Read the durable marker before the cache: a completed or erased task
        // must not be resurrected by an old Redis value after a cache failure.
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT metadata FROM conversations WHERE id = $1::uuid`, [conversationId]);
        if (!rows[0]) return null;
        const metadata = rows[0].metadata || {};
        if (metadata.procedureStateManaged) {
            const state = metadata.procedureState;
            if (!state?.procedureId) return null;
            if (!state.expiresAt || Date.parse(state.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(state.expiresAt))) {
                return this.finishCurrentMission(conversationId, state, schemaName);
            }
            return state;
        }
        // One-time migration of still-live legacy cache entries.
        const legacy = await this.redis.getJson<ProcedureRunState>(this.stateKey(conversationId)).catch(() => null);
        if (legacy?.procedureId) await this.saveState(conversationId, legacy, schemaName);
        return legacy;
    }

    private async saveState(conversationId: string, state: ProcedureRunState, schemaName?: string, renewRetention = true): Promise<void> {
        state.updatedAt = new Date().toISOString();
        if (renewRetention) state.expiresAt = new Date(Date.now() + MISSION_RETENTION_MS).toISOString();
        if (this.stateStore) {
            if (!schemaName) throw new Error('procedure_schema_required');
            await this.stateStore.save(schemaName, conversationId, state);
            return;
        }
        if (schemaName) {
            const saved = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1::uuid RETURNING id`,
                [conversationId, JSON.stringify({ procedureStateManaged: true, procedureState: state })]);
            if (!saved[0]) throw new Error('procedure_conversation_missing');
        }
        await this.redis.setJson(this.stateKey(conversationId), state, STATE_TTL).catch(() => {});
    }

    async clearState(conversationId: string, schemaName?: string): Promise<void> {
        if (this.stateStore) {
            if (!schemaName) throw new Error('procedure_schema_required');
            await this.stateStore.clear(schemaName, conversationId);
            return;
        }
        if (schemaName) await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'procedureState') || '{"procedureStateManaged":true}'::jsonb WHERE id = $1::uuid`, [conversationId]);
        await this.redis.del(this.stateKey(conversationId)).catch(() => {});
    }

    private retainedMissions(state: ProcedureRunState): ProcedureRunState[] {
        const seen = new Set([state.procedureId]);
        return (Array.isArray(state.suspendedMissions) ? state.suspendedMissions : []).filter(frame => {
            if (!frame || typeof frame !== 'object' || !frame.procedureId || seen.has(frame.procedureId)
                || !frame.collected || typeof frame.collected !== 'object' || Array.isArray(frame.collected)
                || !Number.isFinite(Date.parse(frame.expiresAt || '')) || Date.parse(frame.expiresAt!) <= Date.now()) return false;
            seen.add(frame.procedureId);
            return true;
        }).slice(0, MAX_PAUSED_MISSIONS).map(({ suspendedMissions: _nested, ...frame }) => structuredClone(frame));
    }

    /** Finishing one task never erases another, and never executes the next task implicitly. */
    private async finishCurrentMission(conversationId: string, state: ProcedureRunState, schemaName: string): Promise<ProcedureRunState | null> {
        const [next, ...remaining] = this.retainedMissions(state);
        if (!next) { await this.clearState(conversationId, schemaName); return null; }
        const restored = { ...next, pausedAt: new Date().toISOString(), suspendedMissions: remaining };
        await this.saveState(conversationId, restored, schemaName, false);
        return restored;
    }

    /** Active procedures for a tenant (cached). Empty array if the table is absent. */
    private async loadActiveProcedures(tenantId: string, schemaName: string): Promise<ProcedureDefinition[]> {
        if (this.definitionStore) return this.definitionStore.listActive(schemaName);
        const cacheKey = `procedures:active:${tenantId}`;
        const cached = await this.redis.getJson<ProcedureDefinition[]>(cacheKey);
        if (Array.isArray(cached)) return cached;

        let procs: ProcedureDefinition[] = [];
        try {
            // The per-tenant `procedures` table is created lazily by ProceduresService.
            // For tenants without procedures it doesn't exist yet — probe with
            // to_regclass first (returns NULL, no error) so we never issue a failing
            // query that Prisma logs on every incoming message.
            const reg = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                // ::text is load-bearing: Prisma cannot deserialize a raw
                // `regclass` column and throws, so an uncast probe lands in the
                // catch below and silently disables procedures on every turn.
                `SELECT to_regclass('procedures')::text AS reg`,
                [],
            );
            if (reg?.[0]?.reg) {
                // `vertical` is selected because it is a filter, not decoration:
                // it was stored on every procedure and read by nothing, so a
                // procedure authored for one vertical triggered on a keyword
                // match in any conversation of the tenant.
                const rows = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT id, name, trigger, steps, version, vertical FROM procedures WHERE status = 'active'`,
                    [],
                );
                procs = (rows || []).map((r) => ({
                    id: r.id,
                    name: r.name,
                    trigger: r.trigger && typeof r.trigger === 'object' ? r.trigger : { keywords: [] },
                    steps: Array.isArray(r.steps) ? r.steps : [],
                    status: 'active' as const,
                    version: Number(r.version) || 1,
                    vertical: r.vertical || undefined,
                }));
            }
        } catch {
            // to_regclass already handled the "table missing" case (returns NULL,
            // no throw). Reaching here means the SELECT failed — a TRANSIENT error.
            // Return empty for THIS turn only; do NOT cache it, or a momentary DB
            // blip would disable procedures for the full cache TTL.
            return [];
        }
        // Cache the successful result (a genuine empty list included — table missing
        // via to_regclass NULL also lands here). Invalidated on create/activate.
        await this.redis.setJson(cacheKey, procs, ACTIVE_CACHE_TTL).catch(() => {});
        return procs;
    }

    private async loadProcedureById(schemaName: string, id: string): Promise<ProcedureDefinition | null> {
        if (this.definitionStore) return this.definitionStore.getById(schemaName, id);
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, name, trigger, steps, status, version, vertical FROM procedures WHERE id = $1::uuid`,
                [id],
            );
            const r = rows?.[0];
            if (!r) return null;
            return {
                id: r.id,
                name: r.name,
                trigger: r.trigger || { keywords: [] },
                steps: Array.isArray(r.steps) ? r.steps : [],
                status: r.status,
                version: Number(r.version) || 1,
                // Selected on the resume path too: a procedure re-tagged to
                // another vertical mid-conversation must be abandoned, not
                // carried on because the resume query forgot to ask.
                vertical: r.vertical || undefined,
            };
        } catch (error) {
            // A transient read failure cannot cancel a durable customer task.
            throw error;
        }
    }

    /**
     * A procedure with no `vertical` is horizontal and applies everywhere. One
     * that names a vertical applies only there — matched against the industry
     * or the subtype, because authors tag with whichever they think in.
     */
    private appliesToVertical(procedure: ProcedureDefinition, agent?: ProcedureAgentContext): boolean {
        const tagged = String((procedure as any).vertical || '').trim().toLowerCase();
        if (!tagged) return true;
        const industry = String(agent?.industry || '').trim().toLowerCase();
        const subType = String(agent?.subType || '').trim().toLowerCase();
        return tagged === industry || tagged === subType;
    }

    private matchTrigger(procs: ProcedureDefinition[], userText: string): ProcedureDefinition | null {
        // Normalize BOTH sides (lowercase + strip accents) so a keyword like
        // "Devolución" matches "quiero una devolucion" regardless of case/accents.
        const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const text = norm(userText);
        if (!text.trim()) return null;
        for (const p of procs) {
            const kws = p.trigger?.keywords || [];
            if (kws.some((k) => k && text.includes(norm(k)))) return p;
        }
        return null;
    }

    /**
     * Main entry. Returns handled=false when no procedure is active/triggered, so
     * the normal pipeline continues. When handled, `text` is the directive.
     */
    async process(
        schemaName: string,
        tenantId: string,
        conversationId: string,
        contactId: string,
        userText: string,
        agent?: ProcedureAgentContext,
    ): Promise<ProcedureProcessResult> {
        let state = await this.getState(conversationId, schemaName);
        let resumingProcedure = !!state;
        let procedure: ProcedureDefinition | null = null;
        let resumeSelectedMission = false;
        const dialogue = normalizeCustomerIntent(userText);

        // A new explicit task can run while another is paused. Ordinary answers,
        // questions and a generic "continue" keep the current task selected.
        if (state?.pausedAt && SELECT_MISSION.test(normalizeForIntent(userText)) && !isResumeMessage(userText)
            && !['cancel', 'opt_out', 'reject', 'request_human', 'correct'].includes(dialogue.intent)
            && !isInformationSeekingMessage(userText) && !isPauseMessage(userText)) {
            const active = (await this.loadActiveProcedures(tenantId, schemaName))
                .filter(candidate => this.appliesToVertical(candidate, agent));
            const matches = active.filter(candidate => this.matchTrigger([candidate], userText));
            if (matches.length > 1) return { handled: true, completed: false, dialogueAct: 'pause',
                text: procedureDialogueMessages(agent?.language).missionSelection };
            // Cache is only a discovery hint. Revalidate before selecting or creating state.
            const target = matches[0] ? await this.loadProcedureById(schemaName, matches[0].id) : null;
            if (target && (target.status !== 'active' || !this.appliesToVertical(target, agent))) return { handled: false };
            if (target?.id === state.procedureId) resumeSelectedMission = true;
            if (target && target.steps.length && target.id !== state.procedureId) {
                const frames = this.retainedMissions(state);
                const saved = frames.find(frame => frame.procedureId === target.id && frame.version === target.version);
                if (!frames.some(frame => frame.procedureId === target.id) && frames.length >= MAX_PAUSED_MISSIONS) {
                    return { handled: true, completed: false, dialogueAct: 'pause',
                        text: procedureDialogueMessages(agent?.language).missionLimit };
                }
                const { suspendedMissions: _nested, ...current } = state;
                const suspended = [{ ...current, pausedAt: current.pausedAt || new Date().toISOString() }, ...frames.filter(frame => frame.procedureId !== target.id)];
                state = saved ? { ...saved, suspendedMissions: suspended } : {
                    procedureId: target.id, version: target.version, currentStepId: target.steps[0].id,
                    collected: {}, awaitingField: null, startedAt: new Date().toISOString(), suspendedMissions: suspended,
                };
                resumingProcedure = !!saved;
                resumeSelectedMission = !!saved;
                await this.saveState(conversationId, state, schemaName);
            }
        }

        if (state) {
            procedure = await this.loadProcedureById(schemaName, state.procedureId);
            // Deleted, deactivated, re-versioned — or re-tagged to a vertical
            // this agent does not serve. Abandon cleanly in every case.
            if (!procedure
                || procedure.status !== 'active'
                || procedure.version !== state.version
                || !this.appliesToVertical(procedure, agent)) {
                await this.finishCurrentMission(conversationId, state, schemaName);
                return { handled: false };
            }
        } else {
            const active = (await this.loadActiveProcedures(tenantId, schemaName))
                .filter((candidate) => this.appliesToVertical(candidate, agent));
            const matched = this.matchTrigger(active, userText);
            if (!matched || !matched.steps.length) return { handled: false };
            procedure = matched;
            state = {
                procedureId: procedure.id,
                version: procedure.version,
                currentStepId: procedure.steps[0].id,
                collected: {},
                awaitingField: null,
                startedAt: new Date().toISOString(),
            };
            this.logger.log(`[Procedure] Started "${procedure.name}" for conversation ${conversationId}`);
        }

        const byId = new Map(procedure.steps.map((s) => [s.id, s]));
        const indexOfId = (id: string | null) => procedure!.steps.findIndex((s) => s.id === id);

        const messages = procedureDialogueMessages(new LanguageDetectorService().detect(userText, agent?.language ?? 'es'));
        if ((resumingProcedure && dialogue.intent === 'cancel') || dialogue.intent === 'opt_out') {
            if (dialogue.intent === 'cancel' && !CANCEL_CURRENT_COLLECTION.test(normalizeForIntent(userText))) {
                // Cancelling an order/booking is a domain command, not permission
                // to discard whichever collection happened to be selected.
                state.pausedAt ||= new Date().toISOString();
                await this.saveState(conversationId, state, schemaName, false);
                return { handled: false, completed: false, dialogueAct: 'pause', procedureName: procedure.name };
            }
            if (dialogue.intent === 'opt_out') await this.clearState(conversationId, schemaName);
            else await this.finishCurrentMission(conversationId, state, schemaName);
            return { handled: true, completed: false, dialogueAct: 'cancel', text: messages.cancelled, procedureName: procedure.name };
        }
        if (dialogue.intent === 'request_human') {
            await this.saveState(conversationId, state, schemaName);
            return { handled: true, completed: false, handoff: true, handoffReason: 'procedure_customer_request', text: messages.handoff, procedureName: procedure.name };
        }
        if (isPauseMessage(userText)) {
            state.pausedAt = new Date().toISOString();
            await this.saveState(conversationId, state, schemaName);
            return { handled: true, completed: false, dialogueAct: 'pause', text: messages.paused, procedureName: procedure.name };
        }
        if (state.pausedAt) {
            // A later unrelated message cannot silently resume and become a slot.
            if (!resumeSelectedMission && !isResumeMessage(userText)) {
                await this.saveState(conversationId, state, schemaName, false);
                return { handled: false, completed: false, dialogueAct: 'pause', procedureName: procedure.name };
            }
            state.pausedAt = null;
            await this.saveState(conversationId, state, schemaName);
            const ask = byId.get(state.currentStepId ?? '');
            if (state.awaitingField) {
                return { handled: true, completed: false, dialogueAct: 'resume', text: ask?.config.question, procedureName: procedure.name };
            }
        }

        // A question, pause or rejection is a dialogue act, not a field value.
        // Validate at collection time so a message-only ending cannot certify
        // bad data just because there is no later tool validator to catch it.
        if (state.awaitingField) {
            const ask = byId.get(state.currentStepId ?? '');
            if (isInformationSeekingMessage(userText)) {
                await this.saveState(conversationId, state, schemaName);
                return {
                    handled: true, completed: false, dialogueAct: 'question', procedureName: procedure.name,
                    text: ask?.config.explanation || messages.question,
                };
            }
            const spec = this.collectionSpec(procedure, ask, state.awaitingField);
            const bareRejection = dialogue.intent === 'reject' && dialogue.normalized === dialogue.matched;
            const skipOptional = spec.required === false && spec.type !== 'boolean'
                && (bareRejection || /^(?:omitir|saltar|skip|pular|ignorer|passer)$/.test(normalizeForIntent(userText)));
            let value = userText.trim();
            const prefixes = {
                email: /^(?:mi (?:correo|email) es|my email is|meu (?:email|e-mail) e|mon (?:email|courriel) est)\s+/i,
                name: /^(?:me llamo|mi nombre es|my name is|meu nome e|je m'appelle)\s+/i,
                phone: /^(?:mi (?:telefono|numero) es|my (?:phone|number) is|meu (?:telefone|numero) e|mon numero est)\s+/i,
            };
            const prefix = prefixes[spec.type as keyof typeof prefixes];
            if (prefix) {
                const match = normalizeForIntent(value).match(prefix);
                if (match) value = value.slice(match[0].length).trim();
            }
            const coercion = coerceProcedureSlot(value, spec.type ?? 'string');
            const invalidDialogue = spec.type !== 'boolean'
                && (bareRejection || ['affirm', 'acknowledge', 'continue'].includes(dialogue.intent));
            const invalidName = spec.type === 'name' && /^(?:no|nao|non|not|quiero|necesito|prefiero|i want|i need|je veux|je ne|quero|preciso)\b/.test(normalizeForIntent(value));
            if (!skipOptional && (!value || !coercion.ok || invalidDialogue || invalidName
                || (spec.choices?.length && !spec.choices.includes(String(coercion.value))))) {
                await this.saveState(conversationId, state, schemaName);
                return { handled: true, completed: false, dialogueAct: 'invalid', text: [messages.invalid, ask?.config.question].filter(Boolean).join('\n\n'), procedureName: procedure.name };
            }
            if (!skipOptional) state.collected[state.awaitingField] = coercion.value;
            state.awaitingField = null;
            state.currentStepId = this.nextStepId(procedure, state.currentStepId);
        }

        const parts: string[] = [];
        let guard = 0;
        while (state.currentStepId && guard++ < MAX_STEPS_PER_TURN) {
            const step = byId.get(state.currentStepId);
            if (!step) { state.currentStepId = null; break; }

            if (step.type === 'message') {
                if (step.config.text) parts.push(step.config.text);
                state.currentStepId = this.nextStepId(procedure, state.currentStepId);
                continue;
            }

            if (step.type === 'ask') {
                if (step.config.question) parts.push(step.config.question);
                state.awaitingField = step.config.field || `field_${step.id}`;
                await this.saveState(conversationId, state, schemaName);
                return { handled: true, text: parts.join('\n\n'), procedureName: procedure.name };
            }

            if (step.type === 'tool') {
                const toolName = String(step.config.tool || '');
                // Compile against the agent, not against the string the author
                // typed. A procedure could name any tool and the engine handed it
                // straight to the executor, so a step could run a family the
                // agent had switched off.
                const stepAuthority = this.toolStepDecision(toolName, agent);
                if (!stepAuthority.allowed) {
                    this.logger.warn(
                        `[Procedure] step "${step.id}" names "${toolName}" `
                        + `(${stepAuthority.reason}): ${stepAuthority.detail} — escalando`,
                    );
                    await this.finishCurrentMission(conversationId, state, schemaName);
                    return {
                        handled: true,
                        completed: false,
                        text: 'Esta parte del procedimiento necesita una herramienta que este agente no tiene habilitada. Pasá la conversación a una persona del equipo.',
                        // El motivo tipado viaja en la escalada. Sin esto, "el
                        // dueño apagó la tool", "el perfil está bloqueado" y "el
                        // paso nombra una tool de otra familia" llegaban a la
                        // cola humana con la misma etiqueta, y son tres cosas
                        // que se arreglan en tres lugares distintos.
                        handoffReason: `procedure_tool_${stepAuthority.reason}:${toolName || 'unknown'}`,
                        handoff: true,
                        procedureName: procedure.name,
                    };
                }

                // Everything the customer answered lives in `collected` and used
                // to never reach the tool: args were passed verbatim, so a step
                // that asked for an order number called `get_order_status` with
                // `{}` — or worse, with the literal `"{{ order_id }}"`.
                const rendered = interpolateProcedureArgs(
                    step.config.args,
                    state.collected,
                    (step.config as any).slots as Record<string, ProcedureSlotSpec> | undefined,
                );
                if (!rendered.ok) {
                    this.logger.warn(
                        `[Procedure] step "${step.id}" args unresolved (missing: ${rendered.missing.join(', ') || 'none'};`
                        + ` invalid: ${rendered.invalid.map(i => i.arg).join(', ') || 'none'})`,
                    );
                    await this.saveState(conversationId, state, schemaName);
                    return {
                        handled: true,
                        completed: false,
                        text: rendered.invalid.length
                            ? 'Alguno de los datos que me diste no tiene el formato que necesito. Pedile al cliente que lo confirme antes de seguir.'
                            : 'Me falta un dato para completar este paso. Pídaselo al cliente antes de seguir.',
                        procedureName: procedure.name,
                    };
                }

                try {
                    // Checkpoint the exact step before any tool can act. A
                    // worker restart resumes through the same execution ledger.
                    await this.saveState(conversationId, state, schemaName);
                    const result = await this.toolExecutor.execute(
                        schemaName, tenantId, contactId, toolName, rendered.args, conversationId,
                        {
                            authority: agent!.authority!,
                            channelType: agent?.channelType,
                            commitmentBlocked: agent?.commitmentBlocked ?? null,
                            deniedTools: agent?.deniedTools,
                        },
                    );
                    if (result?.error) {
                        const explicitlyRejected = ['action_rejected', 'approval_rejected'].includes(result.error);
                        if (explicitlyRejected) {
                            await this.finishCurrentMission(conversationId, state, schemaName);
                            return {
                                handled: true,
                                completed: true,
                                text: result.message || 'La acción fue rechazada y el procedimiento se cerró.',
                                procedureName: procedure.name,
                            };
                        }

                        // Confirmation/OTP/approval and fail-closed provider results
                        // are not completed tool steps. Persist the SAME currentStepId
                        // so the next turn resumes the control handshake instead of
                        // silently skipping the writer.
                        if (step.config.saveAs) state.collected[step.config.saveAs] = result;
                        await this.saveState(conversationId, state, schemaName);
                        return {
                            handled: true,
                            completed: false,
                            text: result.message || 'La acción todavía no puede completarse.',
                            handoff: result.shouldHandoff === true,
                            handoffReason: result.shouldHandoff === true
                                ? `procedure_tool_control:${toolName || 'unknown'}`
                                : undefined,
                            procedureName: procedure.name,
                        };
                    }
                    if (step.config.saveAs) state.collected[step.config.saveAs] = result;
                } catch (e: any) {
                    this.logger.warn(`[Procedure] tool ${toolName} failed: ${e.message}`);
                    if (step.config.saveAs) state.collected[step.config.saveAs] = { error: true };
                    await this.saveState(conversationId, state, schemaName);
                    return {
                        handled: true,
                        completed: false,
                        text: 'No se pudo completar esta acción. Inténtalo de nuevo o solicita ayuda humana.',
                        procedureName: procedure.name,
                    };
                }
                state.currentStepId = this.nextStepId(procedure, state.currentStepId);
                continue;
            }

            if (step.type === 'condition') {
                const pass = this.evaluateCondition(step, state.collected);
                const target = pass ? step.config.then : step.config.else;
                // jump to target if valid, else fall through to sequential next
                state.currentStepId = target && indexOfId(target) >= 0 ? target : this.nextStepId(procedure, state.currentStepId);
                continue;
            }

            if (step.type === 'handoff') {
                await this.finishCurrentMission(conversationId, state, schemaName);
                return {
                    handled: true,
                    text: parts.length ? parts.join('\n\n') : undefined,
                    handoff: true,
                    handoffReason: step.config.reason || `Procedimiento: ${procedure.name}`,
                    procedureName: procedure.name,
                };
            }

            // Unknown step type — skip.
            state.currentStepId = this.nextStepId(procedure, state.currentStepId);
        }

        // If the per-turn step guard tripped while steps are still pending, the
        // procedure is NOT complete — persist the state and resume next turn
        // instead of wrongly marking it completed and discarding mid-flow state.
        if (state.currentStepId) {
            await this.saveState(conversationId, state, schemaName);
            return {
                handled: parts.length > 0,
                text: parts.length ? parts.join('\n\n') : undefined,
                completed: false,
                procedureName: procedure.name,
            };
        }

        // Reached the end → procedure complete.
        await this.finishCurrentMission(conversationId, state, schemaName);
        return {
            handled: parts.length > 0,
            text: parts.length ? parts.join('\n\n') : undefined,
            completed: true,
            procedureName: procedure.name,
        };
    }

    /**
     * Whether this agent may run the named tool.
     *
     * Without an agent context we cannot tell an authorised tool from an
     * arbitrary one, so nothing is authorised. A procedure that stops is
     * recoverable; one that runs a tool the tenant switched off is not.
     */
    private toolStepAuthorized(toolName: string, agent?: ProcedureAgentContext): boolean {
        return this.toolStepDecision(toolName, agent).allowed;
    }

    private toolStepDecision(
        toolName: string,
        agent?: ProcedureAgentContext,
    ): ToolAuthorityDecision {
        if (!toolName) {
            return {
                allowed: false,
                reason: 'not_authorised',
                detail: 'El paso no nombra ninguna tool.',
            };
        }
        // La misma decisión que toma el ejecutor, tomada acá para poder
        // detener el procedimiento con un mensaje en vez de dejarlo avanzar
        // hasta chocar. Sin autoridad no hay paso de tool: el techo de
        // subtipo, el plan, la habilitación, la salud del proveedor y el
        // bloqueo del perfil ya se resolvieron antes de llegar acá.
        return decideToolAuthority(agent?.authority, toolName, {
            isNonCommittal: isNonCommittalTool(toolName),
        });
    }

    private nextStepId(procedure: ProcedureDefinition, currentId: string | null): string | null {
        if (!currentId) return null;
        const idx = procedure.steps.findIndex((s) => s.id === currentId);
        if (idx < 0) return null;
        const explicitNext = procedure.steps[idx].next;
        if (explicitNext && procedure.steps.some((s) => s.id === explicitNext)) return explicitNext;
        return idx + 1 < procedure.steps.length ? procedure.steps[idx + 1].id : null;
    }

    private collectionSpec(procedure: ProcedureDefinition, ask: ProcedureStep | undefined, field: string): ProcedureSlotSpec {
        if (ask?.config.fieldType) return { type: ask.config.fieldType, required: ask.config.required, choices: ask.config.choices };
        // Preserve types already declared by a downstream tool argument.
        for (const step of procedure.steps) {
            for (const [arg, value] of Object.entries(step.config.args ?? {})) {
                if (typeof value === 'string' && value.replace(/\s/g, '') === `{{${field}}}` && step.config.slots?.[arg]?.type) {
                    return step.config.slots[arg];
                }
            }
        }
        const key = field.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
        const attributes = { required: ask?.config.required, choices: ask?.config.choices };
        if (/(?:^|_)(?:email|e_mail|correo|courriel)(?:$|_)/.test(key)) return { type: 'email', ...attributes };
        if (/(?:^|_)(?:phone|telefono|telefone|telephone|celular)(?:$|_)/.test(key)) return { type: 'phone', ...attributes };
        if (/(?:^|_)(?:name|nombre|nome|nom)(?:$|_)/.test(key)) return { type: 'name', ...attributes };
        return { type: 'string', ...attributes };
    }

    private evaluateCondition(step: ProcedureStep, collected: Record<string, any>): boolean {
        const raw = this.resolvePath(collected, step.config.conditionField || '');
        const op = step.config.operator || 'exists';
        const target = step.config.value;
        switch (op) {
            case 'exists':
                return raw !== undefined && raw !== null && raw !== '' && raw !== false;
            case 'not_exists':
                return raw === undefined || raw === null || raw === '' || raw === false;
            case 'eq':
                return String(raw) === String(target);
            case 'neq':
                return String(raw) !== String(target);
            case 'contains':
                return String(raw ?? '').toLowerCase().includes(String(target ?? '').toLowerCase());
            default:
                return false;
        }
    }

    private resolvePath(obj: any, path: string): any {
        if (!path) return undefined;
        return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
    }
}
