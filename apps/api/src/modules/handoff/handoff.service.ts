import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CronLockService } from '../redis/cron-lock.service';
import { EmailService } from '../email/email.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { AiResolutionService } from '../analytics/ai-resolution.service';
import { normalizeCustomerIntent } from '../../common/conversation/intent-normalizer';
import {
    DEFECT_ON_ARRIVAL_KEYWORDS,
    isAnswerableCustomTrigger,
    isAnswerableTopicWord,
    isDefectOnArrivalKeyword,
    isHypotheticalDefectQuestion,
    policyOverrideLabel,
    policyQuestionScope,
    POLICY_TOPIC_KEYWORDS,
    SOFT_DEFECT_KEYWORDS,
    softDefectAsFact,
} from './handoff-policy-question';
import {
    buildPolicyClassifierRequest,
    parsePolicyLabel,
    policyCacheKey,
    policyTopicsIn,
    reasonForPolicyLabel,
    type PolicyLabel,
} from './handoff-policy-classifier';
import { hasDispatchOutbox, noHumanReplySql } from './handoff-human-reply';
import { MAX_REPLAY_CLAIMS } from './handoff-return-replay.service';

/** The catch-up for lost replays runs on one sweep in this many (the sweep itself runs every minute). */
export const REPLAY_CATCH_UP_EVERY_SWEEPS = 5;
import {
    normalizeForIntent,
    ConversationAssignedEvent,
    NormalizedMessage,
    StructuredHandoffSummary,
    TenantConfig,
} from '@parallext/shared';
import { randomUUID } from 'crypto';
import { handoffAgentI18n } from './handoff-i18n';
import {
    HANDOFF_ANNOUNCEMENT_DESTINATIONS, HANDOFF_EFFECTS_DDL, HandoffEffectError,
    admitHandoffEffect, expireHandoffEffectLeases, prepareHandoffEffects, projectHandoffEffects,
    settleHandoffEffect,
    type HandoffEffectDestination, type HandoffEffectOutcome,
} from './handoff-effects';
import {
    HANDOFF_EFFECT_KEYS,
    HANDOFF_RECEIPT_DDL,
    markHandoffEffect,
    readHandoffReceipt,
    recordHandoffReceipt,
    type HandoffEffectKey,
    type HandoffReceipt,
    type HandoffReceiptLookup,
    type HandoffReceiptRequest,
} from './handoff-receipt';
import {
    buildDeterministicHandoffSummary,
    formatLegacyHandoffSummary,
    HandoffMessageEvidence,
    HandoffSummaryContext,
    HandoffTraceEvidence,
    parseLlmHandoffSummary,
    sanitizeHandoffText,
} from './handoff-summary.util';

/**
 * How long an escalated conversation may sit with nobody from the team writing
 * before the agent speaks again. Owner decision (5-oct): 10 minutes — a customer
 * who asked for nothing, or who is waiting on an empty queue, is not left in
 * silence. Not per tenant: no per-tenant handoff settings exist yet, so the one
 * constant is the single place to change it.
 */
export const UNATTENDED_HANDOFF_MINUTES = 10;

export interface HandoffResult {
    handoffId: string;
    assignedTo?: string;
    summary: string;
    structuredSummary: StructuredHandoffSummary;
    reason: string;
    /**
     * Present only when the caller asked for one. It is the durable authority a
     * deterministic notice needs to reach a conversation a person now owns; the
     * `handoffId` above is a Redis lookup key and never serves that purpose.
     */
    receipt?: HandoffReceipt;
}

/** Everything the transition transaction may do besides its own statements. */
export interface HandoffDeliveryOptions {
    beforeSideEffect?: () => Promise<void>;
    awaitNotifications?: boolean;
    /**
     * Bind this transfer to the exact inbound that caused it. Only callers that
     * already persisted that inbound can supply it; the rest keep today's
     * behaviour and simply produce no receipt.
     */
    receipt?: HandoffReceiptRequest;
    /**
     * Finish the side effects of a transfer that already committed. The
     * transition, the note and the receipt are left untouched.
     */
    resume?: HandoffReceipt;
}

export interface HandoffEscalatedEvent {
    tenantId: string;
    conversationId: string;
    reason: string;
    summary: string;
    structuredSummary: StructuredHandoffSummary;
    traceId: string;
    schemaName: string;
    assignedTo: string | null;
    assignedAgentName?: string;
    contactName?: string;
    contactPhone?: string;
    lastMessage?: string;
    handoffTriggeredAt: string;
}

interface AutoAssignment {
    agentId: string;
    contactId?: string;
    phone?: string;
}

const HANDOFF_INBOX_URL = 'https://admin.parallly-chat.cloud/admin/inbox';

/**
 * Only a demonstrated absence of the effect may be attempted again.
 *
 * The bounded SMTP transport names the cases it cannot vouch for; those wait
 * for a person. Everything else here comes from a fan-out listener, and the
 * listeners that can partially succeed swallow their own errors — so a
 * rejection means the listener threw before it reached anything.
 */
const HANDOFF_UNCERTAIN_FAILURES: ReadonlySet<string> = new Set([
    'smtp_deadline_outcome_unknown', 'smtp_acceptance_unverified', 'smtp_connection_closed',
    'handoff_sms_partial_outcome_unknown',
]);
function classifyHandoffEffectFailure(error: any): HandoffEffectOutcome {
    const code = String(error?.message || error || 'handoff_effect_failed').slice(0, 120);
    return HANDOFF_UNCERTAIN_FAILURES.has(code) || /timed?\s*out|timeout|connection\s+(?:closed|reset)/i.test(code)
        ? { kind: 'unknown', errorCode: code }
        : { kind: 'rejected', errorCode: code };
}

/** The router's execution context, so a read-only turn (Agent Test, evaluation, draft) is passed through to the model call. */
type ClassifierExecutionContext = Parameters<LLMRouterService['execute']>[0]['executionContext'];

@Injectable()
export class HandoffService {
    private readonly logger = new Logger(HandoffService.name);
    private readonly handoffSchemaReady = new Set<string>();
    private readonly handoffReceiptSchemaReady = new Set<string>();

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private eventEmitter: EventEmitter2,
        private emailService: EmailService,
        private emailTemplates: EmailTemplatesService,
        private llmRouter: LLMRouterService,
        private aiResolutionService: AiResolutionService,
        private cronLock: CronLockService,
    ) {}

    /** How long a classification of the same message is reused (one turn is read two or three times). */
    private static readonly POLICY_LABEL_TTL_MS = 60_000;
    /** A failed classification is remembered briefly so the same turn does not wait on a dead model twice. */
    private static readonly POLICY_LABEL_FAILURE_TTL_MS = 15_000;
    /** The model has this long; after that the deterministic rules decide. */
    private static readonly POLICY_CLASSIFIER_TIMEOUT_MS = 2_500;
    private policyLabelCache?: Map<string, { label: PolicyLabel | null; at: number }>;
    private policyLabelInflight?: Map<string, Promise<PolicyLabel | null>>;
    /** Test hook: overrides the classifier timeout. */
    policyClassifierTimeoutMs?: number;

    /**
     * Decide whether a message escalates. The deterministic rules go first: a request
     * for a person, a strong grievance, VIP, failed attempts and every custom trigger
     * that is not a refund / return / discount word never wait for a model. Only a
     * message that is otherwise answerable AND mentions that topic is classified (one
     * small model call, cached per message), because the same words are a policy
     * question, a how-to, a personal case or a price negotiation.
     *
     * The model never has the last word against the customer: what a message says about
     * the customer's OWN case ("me cobraron dos veces", "quiero mi reembolso", "llegó
     * roto", "¿me hace un descuento?") is a high-precision rule that escalates before the
     * model is asked, so a wrong label cannot hide it. The model clears only the soft
     * cases (a bare topic word, a hypothetical). A `none` label does not silence a defect
     * main escalated ("la app no funciona, ¿me devuelven la llamada?"). When the model is
     * unavailable, times out or answers nonsense, `shouldHandoff` (the regular
     * expressions) decides.
     */
    async decideHandoff(
        message: string,
        conversation: any,
        config: TenantConfig,
        operatingCountry?: string | null,
        tenantId?: string,
        /** The turn's execution context (Agent Test, evaluation, draft): the router keeps it read-only and accounts the spend. */
        executionContext?: ClassifierExecutionContext,
    ): Promise<string | null> {
        const topics = policyTopicsIn(message, config.behavior?.handoffTriggers || []);
        // No refund / return / discount word: nothing for a model to read, the rules decide.
        if (!topics) return this.shouldHandoff(message, conversation, config, operatingCountry);
        const strong = this.evaluateHandoff(message, conversation, config, operatingCountry, 'ignore_topics');
        if (strong) return strong;
        const enabled = (cat: string) => this.categoryEnabled(config, cat);
        // Nothing this tenant could route the answer to: no reason to ask the model.
        if (!enabled('complaint') && !enabled('discount_request') && !topics.customTrigger) return null;
        const own = policyOverrideLabel(message, topics);
        if (own) {
            const reason = reasonForPolicyLabel(own, topics, enabled);
            if (reason) return reason;
        }
        const label = await this.classifyPolicyMessage(message, tenantId, executionContext);
        if (!label) return this.shouldHandoff(message, conversation, config, operatingCountry);
        const reason = reasonForPolicyLabel(label, topics, enabled);
        if (reason) return reason;
        // `none` means the topic word was incidental ("¿me devuelven la llamada?"): the
        // rest of the message is judged as it always was, defects included.
        return label === 'none'
            ? this.evaluateHandoff(message, conversation, config, operatingCountry, 'keep_defects')
            : null;
    }

    /** Whether `decideHandoff` is about to wait on the model for this message (so the turn can show it is typing). */
    needsPolicyClassification(message: string, config: TenantConfig, tenantId?: string): boolean {
        return !!policyTopicsIn(message, config.behavior?.handoffTriggers || []) && !this.peekPolicyLabel(message, tenantId);
    }

    /** The label already decided for this message (this turn read it before), without a model call. */
    peekPolicyLabel(message: string, tenantId?: string): PolicyLabel | null {
        const hit = this.policyLabelCache?.get(policyCacheKey(tenantId, message));
        return hit && hit.label && Date.now() - hit.at < HandoffService.POLICY_LABEL_TTL_MS ? hit.label : null;
    }

    /** One model call per message: later readers of the same turn get the cached label (or the in-flight call). */
    async classifyPolicyMessage(message: string, tenantId?: string, executionContext?: ClassifierExecutionContext): Promise<PolicyLabel | null> {
        const key = policyCacheKey(tenantId, message);
        const cache = this.policyLabelCache ??= new Map();
        const inflight = this.policyLabelInflight ??= new Map();
        const hit = cache.get(key);
        if (hit) {
            const ttl = hit.label ? HandoffService.POLICY_LABEL_TTL_MS : HandoffService.POLICY_LABEL_FAILURE_TTL_MS;
            if (Date.now() - hit.at < ttl) return hit.label;
        }
        const pending = inflight.get(key);
        if (pending) return pending;
        const run = this.runPolicyClassifier(message, tenantId, executionContext).then((label) => {
            cache.set(key, { label, at: Date.now() });
            if (cache.size > 500) cache.delete(cache.keys().next().value as string);
            return label;
        }).finally(() => inflight.delete(key));
        inflight.set(key, run);
        return run;
    }

    private async runPolicyClassifier(message: string, tenantId?: string, executionContext?: ClassifierExecutionContext): Promise<PolicyLabel | null> {
        if (!this.llmRouter || typeof this.llmRouter.execute !== 'function') return null;
        const { systemPrompt, userContent } = buildPolicyClassifierRequest(message);
        let timer: NodeJS.Timeout | undefined;
        try {
            const response = await Promise.race([
                // Same route as the intent interpreter's small extraction call; the
                // router accounts the spend to the tenant and applies its budget.
                this.llmRouter.execute({
                    model: 'grok-4-1-fast-non-reasoning',
                    messages: [{ role: 'user', content: userContent }],
                    systemPrompt,
                    temperature: 0,
                    maxTokens: 24,
                    tenantId,
                    executionContext,
                    traceContext: { stage: 'handoff_policy_classifier' },
                }),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('policy_classifier_timeout')),
                        this.policyClassifierTimeoutMs ?? HandoffService.POLICY_CLASSIFIER_TIMEOUT_MS);
                }),
            ]);
            const label = parsePolicyLabel(response?.content);
            if (!label) this.logger?.warn('[Handoff] policy classifier answered something that is not a label; using the rules');
            return label;
        } catch (e: any) {
            this.logger?.warn(`[Handoff] policy classifier unavailable (${e?.message}); using the rules`);
            return null;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private categoryEnabled(config: TenantConfig, category: string): boolean {
        const categoriesCfg = (config.behavior as any)?.handoffCategories as Record<string, boolean> | undefined;
        return !categoriesCfg || categoriesCfg[category] !== false;
    }

    /**
     * Evaluate if a conversation should be escalated to a human agent, by rules alone.
     * Returns the reason string if handoff should trigger, null otherwise. This is the
     * decision when no model is available; `decideHandoff` is what the turn uses.
     */
    shouldHandoff(
        message: string,
        conversation: any,
        config: TenantConfig,
        /** Operating country, so national ways of asking for a person are heard. */
        operatingCountry?: string | null,
    ): string | null {
        return this.evaluateHandoff(message, conversation, config, operatingCountry, 'rules');
    }

    /**
     * `rules`: refund / return / discount words are answered or escalated by the
     * regular expressions. `ignore_topics`: those words, the tenant triggers that are
     * only those words, "no funciona" and "llegó roto" are set aside for the classifier,
     * so what is left is the strong signals (a person, a grievance, VIP, failed attempts,
     * any other trigger).
     */
    private evaluateHandoff(
        message: string,
        conversation: any,
        config: TenantConfig,
        operatingCountry: string | null | undefined,
        mode: 'rules' | 'ignore_topics' | 'keep_defects',
    ): string | null {
        const triggers = config.behavior?.handoffTriggers || [];
        // Accent-stripped, because the raw `toLowerCase()` meant `devolución`
        // and `devolucion` each had to be listed by hand — and `pésimo` was
        // listed twice for the same reason, while every other accented word was
        // simply missed.
        const text = normalizeForIntent(message);

        // Decision categories — each can be toggled per tenant via
        // config.behavior.handoffCategories ({ complaint:false } disables it).
        // Absent config = all enabled (previous behavior). The returned reason IS
        // the category, so the console can route (manager for discounts, support
        // for complaints, etc.).
        const categoriesCfg = (config.behavior as any)?.handoffCategories as Record<string, boolean> | undefined;
        const enabled = (cat: string) => !categoriesCfg || categoriesCfg[cat] !== false;

        // 1. Explicit request for a human.
        //
        // This was a nine-phrase list in Spanish and English with no accent
        // handling — no Portuguese `atendente`, no French `conseiller`, and no
        // bare `asesor`, which is how most of the region asks. It now shares the
        // classifier with the booking engine and the execution guard, so the
        // same words mean the same thing everywhere.
        if (enabled('human_request')) {
            const intent = normalizeCustomerIntent(message, {
                country: operatingCountry,
                // A request for a person arrives inside a complaint, not as a
                // single word, so the length ceiling for confirmations must not
                // silence it.
                maxLength: Number.MAX_SAFE_INTEGER,
            });
            if (intent.intent === 'request_human' && intent.confidence !== 'low') {
                return 'human_request';
            }
        }

        // 2. Complaint / frustration
        // Accent-stripped by `normalizeForIntent` above, so each word appears
        // once and Portuguese/French forms can be added without duplicating.
        const complaintKeywords = [
            'queja', 'reclamo', 'reclamacion', 'molesto', 'furioso', 'inaceptable',
            'devolucion', 'reembolso', 'pesimo', 'horrible', 'terrible',
            'no funciona', 'estafa', 'demanda', 'abogado',
            // A report that it broke on arrival. A bare "quiero devolver…" is NOT here:
            // "devolver la llamada / las llaves / el carro" is an ordinary request, so
            // a return escalates only together with a defect, a grievance or a topic word.
            ...DEFECT_ON_ARRIVAL_KEYWORDS,
            // Portuguese
            'reclamacao', 'reembolso', 'pessimo', 'golpe', 'nao funciona', 'advogado',
            // French
            'plainte', 'remboursement', 'inacceptable', 'ne fonctionne pas', 'avocat',
        ];
        // A question ABOUT the refund/return policy is informational: the agent
        // answers it. Only the policy-topic words are neutralised; any other
        // complaint word in the same message still escalates. Likewise a
        // hypothetical ("¿qué hago si el producto llegó roto?") is a question,
        // while "me llegó roto" is a report.
        const policyScope = mode === 'rules' ? policyQuestionScope(message) : null;
        const hypotheticalDefect = isHypotheticalDefectQuestion(message);
        // What is left to the classifier instead of escalating. `ignore_topics`: the topic
        // words and the defects (a model reads them). `keep_defects` (after a `none`
        // label): only the topic words; a defect stated as fact still escalates.
        const setAside = (kw: string): boolean => {
            if (mode === 'rules') return isAnswerableTopicWord(policyScope, kw);
            if (POLICY_TOPIC_KEYWORDS.has(kw)) return true;
            if (SOFT_DEFECT_KEYWORDS.has(kw)) return mode === 'ignore_topics' || !softDefectAsFact(message);
            if (isDefectOnArrivalKeyword(kw)) return mode === 'ignore_topics';
            return false;
        };
        const escalates = (keywords: string[]) => keywords
            .filter(kw => text.includes(kw))
            .some(kw => !setAside(kw) && !(hypotheticalDefect && isDefectOnArrivalKeyword(kw)));
        if (enabled('complaint') && escalates(complaintKeywords)) {
            return 'complaint';
        }

        // 3. Out-of-policy discount / price negotiation — route to someone who can
        // approve, instead of letting the AI improvise a discount.
        const discountKeywords = [
            'descuento', 'rebaja', 'mas barato', 'precio especial',
            'me lo dejas', 'me lo deja en', 'oferta especial', 'mejor precio', 'hacer precio',
            // Portuguese / French
            'desconto', 'mais barato', 'melhor preco', 'remise', 'moins cher',
        ];
        if (enabled('discount_request') && escalates(discountKeywords)) {
            return 'discount_request';
        }

        // 4. VIP customer (flagged on the contact/lead/memory) — best-effort from
        // what the conversation row carries.
        const isVip = conversation?.metadata?.vip === true || conversation?.is_vip === true
            || conversation?.lead?.is_vip === true || conversation?.contact?.is_vip === true;
        if (enabled('vip') && isVip) {
            return 'vip';
        }

        // 5. Too many failed AI attempts
        const failedAttempts = conversation.metadata?.failedAttempts || 0;
        if (enabled('max_failed_attempts') && failedAttempts >= 3) {
            return 'max_failed_attempts';
        }

        // 6. Custom triggers from persona config
        //
        // Both sides are accent-stripped. The message already was; the trigger
        // was not, so a trigger WITH an accent could never fire — the owner
        // typed "electrocución" in the editor, the message arrived folded to
        // "electrocucion", and the two never met. The tenant had no way to know:
        // the rule was there, on screen, doing nothing. Folding both sides only
        // ever adds matches, and it is what the seeded triggers already assume
        // by being written without accents.
        for (const trigger of triggers) {
            const needle = normalizeForIntent(trigger);
            // The platform seeds `reembolso` as a trigger on most personas. Asked
            // as a general policy question ("¿hacen reembolsos?") it is the same
            // informational question as above, so the same exemption applies;
            // any other trigger, or a personal case, is unchanged.
            if (mode !== 'rules' ? POLICY_TOPIC_KEYWORDS.has(needle) : isAnswerableCustomTrigger(policyScope, needle, message)) continue;
            if (needle && text.includes(needle)) {
                return `custom_trigger:${trigger}`;
            }
        }

        return null;
    }

    /**
     * Execute handoff: mark conversation, emit event for agent console notification,
     * assign to available agent if possible.
     */
    async prepareDelivery(tenantId: string): Promise<void> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureStructuredHandoffColumns(schema);
        await this.aiResolutionService.ensureResolutionColumns(schema);
    }

    async executeHandoff(
        tenantId: string,
        conversationId: string,
        message: NormalizedMessage,
        reason: string,
        delivery?: HandoffDeliveryOptions,
    ): Promise<HandoffResult> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureStructuredHandoffColumns(schemaName);
        // Lazy DDL is hoisted above the transition transaction: neither the
        // resolution columns nor the receipt table may be created inside it.
        await this.aiResolutionService.ensureResolutionColumns(schemaName);
        if (delivery?.receipt) await this.ensureHandoffReceiptTable(schemaName);
        // Tenant language drives the email template variant (fallback 'es').
        // These are agent/admin-facing notifications, so tenant language is the
        // right choice. TODO(i18n): for customer-facing emails use the
        // conversation's detected language instead.
        const lang = await this.getTenantLanguage(tenantId);

        await delivery?.beforeSideEffect?.();
        // 1. Build a bounded, evidence-linked summary. The legacy string is
        // retained for existing inbox/email consumers.
        const recentMessages = await this.prisma.executeInTenantSchema<HandoffMessageEvidence[]>(schemaName,
            `SELECT id::text, direction, content_text, metadata, created_at FROM messages
             WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 20`,
            [conversationId],
        );
        const traceEvidence = await this.loadHandoffTraceEvidence(schemaName, conversationId);
        const structuredSummary = await this.generateStructuredSummary({
            tenantId,
            conversationId,
            reason,
            language: lang,
            messages: recentMessages || [],
            messageMetadata: message.metadata,
            ...traceEvidence,
            generatedAt: new Date().toISOString(),
        });
        const summary = formatLegacyHandoffSummary(structuredSummary);
        const handoffTriggeredAt = structuredSummary.generatedAt;

        await delivery?.beforeSideEffect?.();
        // 2. The transition itself.
        //
        // Status, resolution flag, note and — when the caller asked for one —
        // the durable receipt now commit together. They used to be three
        // independent statements, so a failure between them could leave a
        // conversation transferred with no note, or a receipt describing a
        // transition that never happened. The receipt runs FIRST and inside the
        // same transaction because it must observe, under the conversation row
        // lock, the status the conversation still had before this update.
        const i18n = handoffAgentI18n(lang);
        // Resuming: the transition, the note and the receipt already committed.
        // Repeating them would add a second internal note for one transfer.
        const receipt = delivery?.resume ?? await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const recorded = delivery?.receipt
                ? await recordHandoffReceipt(query, schemaName, {
                    ...delivery.receipt,
                    conversationId,
                    toStatus: 'waiting_human',
                    reason,
                    traceId: structuredSummary.traceId,
                })
                : undefined;
            // What this transfer owes, written with the transfer itself. A
            // process that dies before reaching any destination still leaves the
            // list behind, one row per destination, where recovery can find it.
            if (recorded) {
                await prepareHandoffEffects(query, schemaName, recorded.id,
                    ['assignment', 'cache', ...HANDOFF_ANNOUNCEMENT_DESTINATIONS, 'email']);
            }
            await query(
                `UPDATE conversations
                 SET status = 'waiting_human',
                     metadata = jsonb_set(
                         COALESCE(metadata, '{}'::jsonb),
                         '{handoff}',
                         $2::jsonb
                     ),
                     handoff_summary = $3::jsonb,
                     handoff_trace_id = $4,
                     handoff_summary_generated_at = $5::timestamptz,
                     updated_at = NOW()
                 WHERE id = $1::uuid`,
                [conversationId, JSON.stringify({
                    reason,
                    summary,
                    structuredSummary,
                    traceId: structuredSummary.traceId,
                    startedAt: handoffTriggeredAt,
                    contactId: message.contactId,
                }), JSON.stringify(structuredSummary), structuredSummary.traceId, structuredSummary.generatedAt],
            );
            // 2b. Mark conversation as handed off for AI resolution tracking
            await query(
                `UPDATE conversations SET was_handed_off = true, handoff_at = NOW() WHERE id = $1::uuid`,
                [conversationId],
            );
            // 3. Create internal note documenting the handoff
            await query(
                `INSERT INTO internal_notes (conversation_id, agent_id, content, created_at)
                 VALUES ($1::uuid, NULL, $2, NOW())`,
                [conversationId, i18n.noteText(reason, summary)],
            );
            return recorded;
        });

        // 4. Get contact info for notifications
        const contactInfo = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT ct.id as contact_id, ct.name as contact_name, ct.phone as contact_phone, ct.channel_type,
                    (SELECT content_text FROM messages WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 1) as last_message
             FROM conversations cv
             LEFT JOIN contacts ct ON ct.id = cv.contact_id
             WHERE cv.id = $1::uuid`,
            [conversationId],
        );
        const contact = contactInfo?.[0] || {};

        // 5. Try to auto-assign to an available agent (skill-based routing)
        //
        // From here every step is a resumable PHASE. Receipt, status and note
        // commit together, but these happen after, and a crash in the window used
        // to leave a receipt that made every later attempt return immediately —
        // so nobody was assigned and nobody was told. Each phase is skipped when
        // the receipt already records it, and records itself as soon as it ends.
        // Each destination is admitted, attempted and settled on its own row.
        // The aggregate `announced` flag could not say which of six consumers
        // had run, so one failing consumer re-announced the transfer to all of
        // them — a second Slack message, a second CRM note, a second paid SMS.
        //
        // `undefined` means this attempt did not happen: the destination is
        // already settled, or it just failed. A caller that needs the value of
        // an effect settled earlier reads it from the projection.
        const deliverEffect = async (destination: HandoffEffectDestination,
            act: () => Promise<string | null | void>): Promise<string | null | undefined> => {
            if (!receipt) {
                const legacy = await act();
                return typeof legacy === 'string' ? legacy : null;
            }
            const leaseToken = randomUUID();
            try {
                const admitted = await this.prisma.transactionInTenantSchema(schemaName, query =>
                    admitHandoffEffect(query, schemaName, { receiptId: receipt.id, destination, leaseToken }));
                // Not granted. The lapsed-lease case answers this way on purpose:
                // its `unknown` transition has to commit, and a throw would take
                // it down with the refusal.
                if (admitted.state !== 'admitted') {
                    this.logger.log(`Handoff effect ${destination} not attempted: ${admitted.state}`);
                    return undefined;
                }
            } catch (error: any) {
                if (error instanceof HandoffEffectError) {
                    this.logger.log(`Handoff effect ${destination} not attempted: ${error.code}`);
                    return undefined;
                }
                throw error;
            }
            let outcome: HandoffEffectOutcome;
            try {
                const value = await act();
                outcome = { kind: 'accepted', receipt: typeof value === 'string' ? value : null };
            } catch (error: any) {
                outcome = classifyHandoffEffectFailure(error);
            }
            // Never swallowed. A result that cannot be written leaves the row
            // admitted, and the expiry of that lease is what turns it into
            // `unknown` — a person decides — instead of into a second attempt.
            await this.prisma.transactionInTenantSchema(schemaName, async query => {
                await settleHandoffEffect(query, schemaName, { receiptId: receipt.id, destination, leaseToken, outcome });
                await projectHandoffEffects(query, schemaName, receipt.id);
            });
            if (outcome.kind !== 'accepted') {
                this.logger.error(`Handoff effect ${destination} settled as ${outcome.kind}: ${outcome.errorCode}`);
            }
            return outcome.kind === 'accepted' ? (outcome.receipt ?? null) : undefined;
        };
        const settledValue = (key: HandoffEffectKey) => receipt?.effects?.[key];
        const assignment = await deliverEffect('assignment', async () => {
            const autoAssignment = await this.tryAutoAssign(tenantId, schemaName, conversationId, reason, delivery);
            return autoAssignment?.agentId || null;
        });
        const assignedTo: string | null = assignment !== undefined ? assignment
            : (typeof settledValue('assignment') === 'string' ? settledValue('assignment') as string : null);

        // 6. Get assigned agent name for notifications
        let assignedAgentName: string | undefined;
        let assignedAgentEmail: string | undefined;
        if (assignedTo) {
            const agentRows = await this.prisma.$queryRaw<any[]>`
                SELECT TRIM(first_name || ' ' || last_name) as name, email
                FROM users WHERE id = ${assignedTo}::uuid LIMIT 1
            `;
            assignedAgentName = agentRows?.[0]?.name;
            assignedAgentEmail = agentRows?.[0]?.email;

        }

        // 7. Store handoff state in Redis for fast lookup
        const handoffId = typeof settledValue('cache') === 'string'
            ? settledValue('cache') as string : `hoff_${Date.now()}`;
        await deliverEffect('cache', async () => {
            await this.redis.set(
                `handoff:${tenantId}:${conversationId}`,
                JSON.stringify({
                    handoffId,
                    reason,
                    startedAt: handoffTriggeredAt,
                    contactId: message.contactId,
                    assignedTo,
                    summary,
                    structuredSummary,
                    traceId: structuredSummary.traceId,
                }),
                86400,
            );
            return handoffId;
        });

        // 8. Emit event with full context for notifications
        await delivery?.beforeSideEffect?.();
        const handoffEvent = {
            tenantId,
            conversationId,
            reason,
            summary,
            structuredSummary,
            traceId: structuredSummary.traceId,
            schemaName,
            assignedTo,
            assignedAgentName,
            contactName: contact.contact_name || message.contactId,
            contactPhone: contact.contact_phone || '',
            lastMessage: (contact.last_message || '').substring(0, 100),
            handoffTriggeredAt,
            // Stable across every attempt, so a consumer that can dedupe has
            // something to dedupe on.
            handoffReceiptId: receipt?.id ?? null,
            // The CRM note has always been written against a contact this event
            // never carried, so it referenced nobody.
            contactId: contact.contact_id ?? null,
            channelType: contact.channel_type ?? message.channelType ?? null,
        } as HandoffEscalatedEvent;
        // One event per destination instead of one for all six. `emitAsync`
        // rejects the whole fan-out when any single listener throws, so the
        // aggregate flag was never written and a resumed transfer announced
        // itself again to the five that had already succeeded. Each of these is
        // awaited on purpose: an announcement whose outcome nobody observed
        // cannot be settled, and a transfer is rare enough to pay for that.
        for (const destination of HANDOFF_ANNOUNCEMENT_DESTINATIONS) {
            await deliverEffect(destination, async () => {
                const results=await this.eventEmitter.emitAsync(`handoff.escalated.${destination}`, handoffEvent) || [];
                const receipt=results.find(value=>typeof value==='string'&&value.length>0);
                return typeof receipt==='string'?receipt:null;
            });
        }

        // 9. The most expensive repeat: a resumed transfer must never send a
        // second email. `renderAndSend` answers with a boolean, and a boolean
        // cannot tell an unconfigured transport — safe to try again — from a
        // server that accepted the message before the socket died. The bounded
        // attempt returns the SMTP id or throws a code that says which, so an
        // outcome nobody can vouch for is recorded as `unknown` and waits for a
        // person instead of arriving twice.
        const contactName = contact.contact_name || i18n.contactFallback;
        const contactPhone = contact.contact_phone || 'N/A';
        const lastMessage = (contact.last_message || '').substring(0, 200);
        const target = assignedAgentEmail
            ? { email: assignedAgentEmail, slug: 'handoff_notification' as const }
            : await this.resolveHandoffFallbackRecipient(tenantId);
        await deliverEffect('email', async () => {
            // Nobody to notify is a settled outcome, not an unfinished phase:
            // leaving it open made every later attempt resume forever.
            if (!target) return 'no_recipient';
            const variables: Record<string, string> = target.slug === 'handoff_notification'
                ? {
                    agent_name: assignedAgentName || i18n.agentFallback,
                    contact_name: contactName, contact_phone: contactPhone, reason,
                    last_message: lastMessage, inbox_url: HANDOFF_INBOX_URL,
                }
                : {
                    contact_name: contactName, contact_phone: contactPhone, reason,
                    last_message: lastMessage, inbox_url: HANDOFF_INBOX_URL,
                };
            try {
                const attempt = await this.emailTemplates.renderAndPrepare(
                    schemaName, target.slug, target.email, variables, lang);
                if (!attempt) throw new Error('handoff_email_template_unavailable');
                await delivery?.beforeSideEffect?.();
                return await attempt();
            } catch (error: any) {
                // A legacy transfer has no resume, so the plain transport is its
                // only second chance. A durable caller — one holding a fence, or
                // one with a receipt to resume from — gets the failure instead,
                // and the classification decides whether it may try again.
                if (receipt || delivery) throw error;
                const sent = target.slug === 'handoff_notification'
                    ? await this.emailService.send({
                        to: target.email, subject: i18n.assignedSubject(contactName),
                        html: i18n.assignedHtml({ contactName, contactPhone, reason, lastMessage }),
                    })
                    : await this.emailService.send({
                        to: target.email, subject: i18n.unassignedSubject(),
                        html: i18n.unassignedHtml({ contactName, contactPhone, reason, lastMessage }),
                    });
                return sent ? 'fallback' : 'fallback_unsent';
            }
        });

        this.logger.log(
            `Handoff executed: conversation=${conversationId}, reason=${reason}, assignedTo=${assignedTo || 'unassigned'}`,
        );

        return {
            handoffId,
            assignedTo: assignedTo || undefined,
            summary,
            structuredSummary,
            reason,
            receipt,
        };
    }

    /**
     * Who hears about a transfer nobody was assigned: the tenant's billing
     * address, then any active administrator. A lookup that fails is not an
     * empty answer — it is a reason to try again later — so it propagates and
     * the effect settles as retryable instead of as "nobody to notify".
     */
    private async resolveHandoffFallbackRecipient(tenantId: string):
        Promise<{ email: string; slug: 'handoff_notification_unassigned' } | null> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId }, select: { billingEmail: true },
        });
        if (tenant?.billingEmail) {
            return { email: tenant.billingEmail, slug: 'handoff_notification_unassigned' };
        }
        const adminUser = await this.prisma.user.findFirst({
            where: { tenantId, role: 'tenant_admin', isActive: true }, select: { email: true },
        });
        return adminUser?.email ? { email: adminUser.email, slug: 'handoff_notification_unassigned' } : null;
    }

    /**
     * Bootstrap the receipt table outside any privacy or transition transaction.
     * Ownership is checked by the callers that already resolved this schema for
     * the tenant; no DDL may run once the transition transaction is open.
     */
    private async ensureHandoffReceiptTable(schemaName: string): Promise<void> {
        if (this.handoffReceiptSchemaReady.has(schemaName)) return;
        for (const statement of [...HANDOFF_RECEIPT_DDL, ...HANDOFF_EFFECTS_DDL]) {
            await this.prisma.executeInTenantSchema(schemaName, statement);
        }
        this.handoffReceiptSchemaReady.add(schemaName);
        // Permissions nobody settled become uncertain here rather than sitting
        // `admitted` behind a dead lease. Once per schema per process, outside
        // every transaction, and never on the path of a transfer that is
        // currently being delivered.
        await this.prisma.transactionInTenantSchema(schemaName,
            query => expireHandoffEffectLeases(query, schemaName))
            .catch(error => this.logger.warn(`Handoff effect leases not swept: ${error?.message}`));
    }

    /**
     * Recover the receipt of a transfer already performed for this exact inbound.
     *
     * A caller uses this BEFORE deciding to escalate: a receipt means the
     * transfer happened, so the notice is reproduced from it and the transfer is
     * never repeated. Null means this inbound never transferred the conversation.
     */
    async lookupHandoffReceipt(tenantId: string, lookup: HandoffReceiptLookup): Promise<HandoffReceipt | null> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureHandoffReceiptTable(schemaName);
        return this.prisma.transactionInTenantSchema(schemaName,
            (query) => readHandoffReceipt(query, schemaName, lookup));
    }

    /**
     * Finish the phases a crashed transfer never reached.
     *
     * Runs the same code as a fresh transfer with the transition skipped, so
     * every phase applies its own "already done" rule and nothing that reached
     * the outside world happens twice.
     */
    private async resumeHandoffEffects(
        tenantId: string,
        conversationId: string,
        message: NormalizedMessage,
        receipt: HandoffReceipt,
        delivery?: Omit<HandoffDeliveryOptions, 'receipt'>,
    ): Promise<void> {
        // Each phase reads "already done" once, at the start, so two resumes
        // racing could both announce the same transfer. One at a time; whoever
        // does not get the lock simply leaves it to the holder.
        const key = `lock:handoff-effects:${receipt.id}`;
        const token = await this.redis.acquireLockToken(key, 60).catch(() => null);
        if (!token) {
            this.logger.log(`Handoff effects for ${receipt.id} are being resumed elsewhere`);
            return;
        }
        try {
            await this.executeHandoff(tenantId, conversationId, message, receipt.reason,
                { ...delivery, resume: receipt });
        } finally {
            await this.redis.releaseLockToken(key, token).catch(() => undefined);
        }
    }

    /**
     * Escalate once for this inbound, or recover what a previous attempt already
     * recorded. The two-step shape is deliberate: a concurrent turn that lost the
     * unique index rolls its whole transition back, so notes, assignment and
     * notifications are never repeated to obtain a notice that already exists.
     */
    async executeHandoffOnce(
        tenantId: string,
        conversationId: string,
        message: NormalizedMessage,
        reason: string,
        request: HandoffReceiptRequest,
        delivery?: Omit<HandoffDeliveryOptions, 'receipt'>,
    ): Promise<HandoffReceipt> {
        const lookup: HandoffReceiptLookup = {
            conversationId, contactId: request.contactId, inboundMessageId: request.inboundMessageId,
        };
        const existing = await this.lookupHandoffReceipt(tenantId, lookup);
        if (existing) {
            // The transfer happened. Its side effects may not have: a crash
            // between the transition and the assignment, the announcement or the
            // notification used to be invisible here, because a receipt made
            // every later attempt return immediately. Resume what is missing.
            if (HANDOFF_EFFECT_KEYS.every(key => existing.effects?.[key] !== undefined)) return existing;
            this.logger.warn(`Resuming handoff effects for ${conversationId}: `
                + HANDOFF_EFFECT_KEYS.filter(key => existing.effects?.[key] === undefined).join(', '));
            await this.resumeHandoffEffects(tenantId, conversationId, message, existing, delivery);
            return (await this.lookupHandoffReceipt(tenantId, lookup)) ?? existing;
        }
        try {
            const result = await this.executeHandoff(tenantId, conversationId, message, reason,
                { ...delivery, receipt: request });
            if (!result.receipt) throw new Error('handoff_receipt_unavailable');
            // Re-read so the caller sees the phases as they actually ended: the
            // receipt returned by the transition predates every side effect.
            return (await this.lookupHandoffReceipt(tenantId, lookup).catch(() => null)) ?? result.receipt;
        } catch (error) {
            // A concurrent turn can win either the unique inbound index or the
            // conversation row lock: the loser then sees a status a receipt may
            // not transition out of. Both are the same fact — somebody else
            // already transferred this inbound — and its receipt is canonical.
            // Our own transition rolled back whole, so nothing was repeated.
            // Any error that leaves no receipt behind is a genuine failure.
            const recorded = await this.lookupHandoffReceipt(tenantId, lookup).catch(() => null);
            if (recorded) return recorded;
            throw error;
        }
    }

    /**
     * Who may hand a conversation back to the AI: the agent it is assigned to, or
     * a tenant admin / supervisor. `POST /handoff/:id/complete` previously only
     * checked the role, so any agent of the tenant could complete (and thereby
     * unassign and re-arm the bot on) a conversation another agent was working.
     * Same rule as `AgentConsoleService.assertCanActOnConversation`, which guards
     * the equivalent `return-to-ai` route. A conversation nobody holds is not
     * "assigned to the caller", so a plain agent cannot complete it either.
     */
    async assertCanCompleteHandoff(
        tenantId: string,
        conversationId: string,
        actorId: string,
        actorRole: string,
    ): Promise<void> {
        // The route's @Roles keeps super_admin out of plain tenant calls; an
        // impersonating or platform super_admin that reaches here keeps the
        // access it always had.
        if (actorRole === 'super_admin') return;
        if (!['tenant_admin', 'tenant_supervisor', 'tenant_agent'].includes(actorRole)) {
            throw new ForbiddenException('Role cannot complete handoffs');
        }
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        const rows = await this.prisma.executeInTenantSchema<Array<{ assigned_to: string | null }>>(
            schemaName,
            `SELECT assigned_to FROM conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId],
        );
        if (!rows?.length) throw new NotFoundException('Conversation not found');
        const elevated = actorRole === 'tenant_admin' || actorRole === 'tenant_supervisor';
        if (!elevated && rows[0].assigned_to !== actorId) {
            throw new ForbiddenException('Conversation is not assigned to the authenticated agent');
        }
    }

    /**
     * Complete handoff: return conversation back to AI
     */
    async completeHandoff(tenantId: string, conversationId: string): Promise<void> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations
             SET status = 'active',
                 assigned_to = NULL,
                 metadata = COALESCE(metadata, '{}'::jsonb) - 'bookingState' - 'bookingStateUpdatedAt' - 'toolContext' - 'toolContextUpdatedAt',
                 updated_at = NOW()
             WHERE id = $1::uuid`,
            [conversationId],
        );

        await this.redis.del(`booking:${conversationId}`).catch(() => {});
        await this.redis.del(`handoff:${tenantId}:${conversationId}`);

        this.eventEmitter.emit('handoff.completed', { tenantId, conversationId });

        this.logger.log(`Handoff completed for conversation ${conversationId}, returned to AI`);
    }

    /**
     * Hands back to the AI the conversations a person never picked up.
     *
     * `waiting_human` mutes the agent, and nothing but a human action ever
     * cleared it. The 72h auto-resolve could not help either: it only fires when
     * NOBODY has written in three days, so a customer who keeps writing into an
     * unattended handoff was silenced indefinitely — every message stored, none
     * answered, no alert anywhere.
     *
     * Only conversations where the customer is still writing and no agent ever
     * replied are returned. A handoff a person is actually working is left alone.
     */
    // Every minute so the 10-minute window is met (a 10-minute cron would return
    // it between minute 10 and 20). The lock TTL (30s, the CronLockService floor)
    // keeps the API and the worker from both running it.
    @Cron('* * * * *')
    async returnUnattendedHandoffsCron(): Promise<void> {
        await this.cronLock.runExclusive(
            'handoff.returnUnattendedHandoffs',
            30,
            () => this.returnUnattendedHandoffs(),
            { prefer: 'api' },
        );
    }

    /**
     * How often the sweep also re-asks for waiting-message replays that never happened. It is only a
     * safety net for a lost event, and its query walks the tenant's active conversations (there is
     * no index on the handoff flags, and a new one would take a lock on the largest table at every
     * deploy), so it runs on one sweep in five instead of every minute.
     */
    private sweepsSeen = 0;

    async returnUnattendedHandoffs(): Promise<void> {
        const catchUp = ((this.sweepsSeen = (this.sweepsSeen ?? 0) + 1) - 1) % REPLAY_CATCH_UP_EVERY_SWEEPS === 0;
        try {
            const tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, schemaName: true },
            });
            for (const tenant of tenants) {
                try {
                    await this.returnUnattendedHandoffsForTenant(tenant.id, tenant.schemaName, catchUp);
                } catch (e: any) {
                    this.logger.warn(`[Handoff] Unattended sweep failed for ${tenant.id}: ${e.message}`);
                }
            }
        } catch (e: any) {
            this.logger.warn(`[Handoff] Unattended sweep failed: ${e.message}`);
        }
    }

    private async returnUnattendedHandoffsForTenant(tenantId: string, schemaName: string, catchUp = true): Promise<void> {
        const run = (sql: string, params: any[]) => this.prisma.executeInTenantSchema<any[]>(schemaName, sql, params);
        const hasOutbox = await hasDispatchOutbox(run, schemaName);
        // The same conditions pick the rows AND guard the UPDATE: between the two a
        // person may have answered, and the second statement must not undo that.
        const eligible = (a: string) => `${a}.status IN ('waiting_human', 'with_human')
                AND ${a}.metadata->'handoff'->>'startedAt' IS NOT NULL
                AND (${a}.metadata->'handoff'->>'startedAt')::timestamptz
                    < NOW() - ($1 || ' minutes')::interval
                AND COALESCE(${a}.metadata->'handoff'->>'returnedToAi', 'false') <> 'true'
                -- nobody from the team answered, on any channel (also covers an
                -- auto-assigned with_human conversation whose agent never wrote)
                ${noHumanReplySql(a, hasOutbox)}
                -- ...and the customer is still waiting on an answer
                AND EXISTS (
                    SELECT 1 FROM messages m
                     WHERE m.conversation_id = ${a}.id
                       AND m.direction = 'inbound'
                       AND m.created_at > (${a}.metadata->'handoff'->>'startedAt')::timestamptz
                )`;
        const returned = await run(
            `UPDATE conversations c
                SET status = 'active',
                    assigned_to = NULL,
                    metadata = jsonb_set(jsonb_set(
                        COALESCE(c.metadata, '{}'::jsonb),
                        '{handoff,returnedToAi}', 'true'::jsonb, true
                    ), '{handoff,returnNoticePending}', 'true'::jsonb, true),
                    updated_at = NOW()
              WHERE c.id IN (SELECT x.id FROM conversations x WHERE ${eligible('x')} LIMIT 50)
                AND ${eligible('c')}
          RETURNING c.id`,
            [String(UNATTENDED_HANDOFF_MINUTES)],
        );
        // Only the rows this statement really changed are announced: a conversation a
        // person answered in the meantime comes back empty and is left alone.
        if (!returned?.length) {
            if (catchUp) await this.reemitPendingReplays(tenantId, schemaName, run, hasOutbox, []);
            return;
        }

        const hasAssignments = !!(await run('SELECT to_regclass($1)::text AS t',
            [`${schemaName}.conversation_assignments`]).catch(() => []))?.[0]?.t;
        for (const row of returned) {
            if (hasAssignments) {
                // The person nobody heard from no longer owns it.
                await run(
                    `UPDATE conversation_assignments SET resolved_at = NOW()
                      WHERE conversation_id = $1::uuid AND resolved_at IS NULL`, [row.id],
                ).catch(e => this.logger.warn(`[Handoff] Could not close the assignment of ${row.id}: ${e.message}`));
            }
            await this.redis.del(`handoff:${tenantId}:${row.id}`).catch(() => {});
            this.eventEmitter.emit('handoff.returned_unattended', { tenantId, schemaName, conversationId: row.id });
        }
        this.logger.warn(`[Handoff] Returned ${returned.length} unattended conversation(s) to the AI in tenant ${tenantId}`);
        if (catchUp) await this.reemitPendingReplays(tenantId, schemaName, run, hasOutbox, returned.map((r: any) => String(r.id)));
    }

    /**
     * The catch-up for the customer's waiting message. The event above is emitted
     * once, in this process: a crash between the UPDATE and the listener, or an
     * enqueue that failed and gave its claim back, would leave a returned
     * conversation whose waiting message is never answered (the sweep itself no
     * longer selects it). This asks for the replay again, for conversations
     * returned in the last day whose replay was never claimed. The claim in the
     * listener makes asking twice harmless, and `MAX_REPLAY_CLAIMS` stops a
     * failure that never heals.
     */
    private async reemitPendingReplays(
        tenantId: string, schemaName: string,
        run: (sql: string, params: any[]) => Promise<any[]>, hasOutbox: boolean, alreadyEmitted: string[],
    ): Promise<void> {
        let pending: any[] = [];
        try {
            pending = await run(
                `SELECT c.id FROM conversations c
                  WHERE c.status = 'active'
                    AND c.metadata->'handoff'->>'returnedToAi' = 'true'
                    AND c.metadata->'handoff'->>'returnNoticePending' = 'true'
                    AND c.metadata->'handoff'->>'startedAt' IS NOT NULL
                    AND COALESCE(c.metadata->'handoff'->>'returnReplayFor', '') <> c.metadata->'handoff'->>'startedAt'
                    AND COALESCE((c.metadata->'handoff'->>'returnReplayClaims')::int, 0) < ${MAX_REPLAY_CLAIMS}
                    AND c.updated_at > NOW() - interval '24 hours'
                    ${noHumanReplySql('c', hasOutbox)}
                  ORDER BY c.updated_at DESC LIMIT 50`, []) || [];
        } catch (e: any) {
            this.logger.warn(`[Handoff] Replay catch-up could not be read for ${tenantId}: ${e.message}`);
            return;
        }
        for (const row of pending) {
            if (alreadyEmitted.includes(String(row.id))) continue;
            this.eventEmitter.emit('handoff.returned_unattended', { tenantId, schemaName, conversationId: row.id });
        }
    }

    /**
     * Tenant's configured language as a short code (es/en/pt/fr), falling back
     * to 'es'. `tenant.language` is stored as a full locale (e.g. 'es-CO'), so
     * we strip the region — matching the convention in persona.service.
     */
    private async getTenantLanguage(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { language: true },
            });
            return (tenant?.language || 'es-CO').split('-')[0];
        } catch {
            return 'es';
        }
    }

    /**
     * Check if a conversation is currently in handoff
     */
    async isInHandoff(tenantId: string, conversationId: string): Promise<boolean> {
        const data = await this.redis.get(`handoff:${tenantId}:${conversationId}`);
        return !!data;
    }

    /**
     * Get handoff details from Redis
     */
    async getHandoffDetails(tenantId: string, conversationId: string): Promise<any | null> {
        const data = await this.redis.get(`handoff:${tenantId}:${conversationId}`);
        return data ? JSON.parse(data) : null;
    }

    /**
     * Try to auto-assign to an available agent (least-loaded)
     */
    private async tryAutoAssign(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        reason?: string,
        delivery?: { beforeSideEffect?: () => Promise<void>; awaitNotifications?: boolean },
    ): Promise<AutoAssignment | null> {
        try {
            // 1. Get contact_id from the conversation
            const convRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT contact_id FROM conversations WHERE id = $1::uuid`,
                [conversationId]
            );
            const contactId = convRows?.[0]?.contact_id;
            
            // 2. Fetch the lead score (default to 0 if not found)
            let leadScore = 0;
            if (contactId) {
                const leadRows = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT score FROM leads WHERE contact_id = $1::uuid LIMIT 1`,
                    [contactId]
                );
                leadScore = leadRows?.[0]?.score || 0;
            }

            // 3. Fetch the vertical configuration for this tenant
            const tenantRows = await this.prisma.$queryRawUnsafe(
                `SELECT settings FROM public.tenants WHERE id = $1::uuid LIMIT 1`,
                tenantId
            ) as any[];
            const settings = tenantRows?.[0]?.settings || {};
            const vertical = settings.verticalConfig?.industry || '';

            // 4. Map handoff CATEGORY to skill tag for routing (the typed reason
            // from shouldHandoff lets us send each kind to the right person).
            const skillMap: Record<string, string> = {
                complaint: 'complaints',
                human_request: 'general',
                discount_request: 'sales',   // someone who can approve a price/discount
                vip: 'senior',
                max_failed_attempts: 'technical',
                // legacy reason strings (back-compat with any in-flight conversations)
                frustration_detected: 'complaints',
                explicit_human_request: 'general',
            };
            const preferredSkill = reason ? skillMap[reason] || null : null;

            // 5. Build prioritized skills array
            const targetSkills: string[] = [];

            // A. VIP Lead (Score >= 80) -> route to senior or supervisor agents
            if (leadScore >= 80) {
                targetSkills.push('senior', 'supervisor');
                this.logger.log(`[AutoAssign] VIP Lead detected (Score=${leadScore}) for conversation ${conversationId}. Prioritizing senior/supervisor agents.`);
            }

            // B. Health Vertical -> route to clinical or doctor agents
            const isHealthVertical = ['salud', 'health', 'clinica', 'odontologia', 'medicina', 'bienestar'].some(v => 
                vertical.toLowerCase().includes(v)
            );
            if (isHealthVertical) {
                targetSkills.push('clinical', 'doctor');
                this.logger.log(`[AutoAssign] Health vertical detected ("${vertical}") for conversation ${conversationId}. Prioritizing clinical/doctor agents.`);
            }

            // C. Fallback to mapped handoff reason skill tag
            if (preferredSkill) {
                targetSkills.push(preferredSkill);
            }

            // Prefer agents with the highest overlap of target skills, then fallback to least-loaded
            const agents = await this.prisma.$queryRawUnsafe(`
                SELECT u.id, TRIM(u.first_name || ' ' || u.last_name) as name,
                    u.skill_tags,
                    (SELECT COUNT(*) FROM "${schemaName}".conversations c
                     WHERE c.assigned_to = u.id::text AND c.status = 'with_human') as active_count,
                    (SELECT COUNT(*)::int FROM unnest(u.skill_tags) x WHERE x = ANY($2::text[])) as matching_skills_count
                FROM public.users u
                WHERE u.tenant_id = $1::uuid
                  AND u.is_active = true
                  AND u.role IN ('tenant_admin', 'tenant_supervisor', 'tenant_agent')
                  AND u.availability_status = 'online'
                  AND (SELECT COUNT(*) FROM "${schemaName}".conversations c
                       WHERE c.assigned_to = u.id::text AND c.status = 'with_human') < u.max_capacity
                ORDER BY matching_skills_count DESC, active_count ASC
                LIMIT 1
            `, tenantId, targetSkills) as any[];

            if (agents?.length) {
                const agent = agents[0];
                const assignedAt = new Date().toISOString();
                const assignment = await this.prisma.transactionInTenantSchema(
                    schemaName,
                    async (query) => {
                        const conversations = await query<Array<{ contact_id: string | null }>>(
                            // assigned_to es VARCHAR, no UUID (ver agent-console.service).
                            `UPDATE conversations
                                SET assigned_to = $2, status = 'with_human', metadata = COALESCE(metadata, '{}'::jsonb) #- '{handoff,returnNoticePending}', updated_at = NOW()
                              WHERE id = $1::uuid
                              RETURNING contact_id`,
                            [conversationId, agent.id],
                        );
                        if (!conversations[0]) throw new Error(`Conversation ${conversationId} not found`);
                        await query(
                            `UPDATE conversation_assignments
                                SET resolved_at = NOW()
                              WHERE conversation_id = $1::uuid AND resolved_at IS NULL`,
                            [conversationId],
                        );
                        await query(
                            `INSERT INTO conversation_assignments (conversation_id, agent_id, assigned_at)
                             VALUES ($1::uuid, $2::uuid, $3::timestamptz)`,
                            [conversationId, agent.id, assignedAt],
                        );
                        const contactId = conversations[0].contact_id || undefined;
                        const contacts = contactId
                            ? await query<Array<{ phone: string | null }>>(
                                `SELECT phone FROM contacts WHERE id = $1::uuid LIMIT 1`,
                                [contactId],
                            )
                            : [];
                        return {
                            agentId: String(agent.id),
                            contactId,
                            phone: contacts[0]?.phone || undefined,
                        } as AutoAssignment;
                    },
                );
                await this.emitConversationAssigned({
                    tenantId,
                    schemaName,
                    conversationId,
                    agentId: assignment.agentId,
                    ...(assignment.contactId ? { contactId: assignment.contactId } : {}),
                    ...(assignment.phone ? { phone: assignment.phone } : {}),
                    assignmentSource: 'auto',
                    assignedAt,
                }, delivery);
                this.logger.log(`[AutoAssign] Automatically assigned conversation ${conversationId} to agent "${agent.name}" (Active Count=${agent.active_count}, Matching Skills=${agent.matching_skills_count})`);
                return assignment;
            }
        } catch (e: any) {
            this.logger.warn(`Auto-assign failed: ${e.message}`);
        }
        return null;
    }

    private async emitConversationAssigned(event: ConversationAssignedEvent,
        delivery?: { beforeSideEffect?: () => Promise<void>; awaitNotifications?: boolean }): Promise<void> {
        try {
            await delivery?.beforeSideEffect?.();
            if (delivery?.awaitNotifications) await this.eventEmitter.emitAsync('conversation.assigned', event);
            else this.eventEmitter.emit('conversation.assigned', event);
        } catch (error: any) {
            // The assignment transaction already committed. A listener failure
            // must not make callers retry and create a second assignment row.
            this.logger.error(`conversation.assigned listener failed: ${error.message}`);
        }
    }

    private async ensureStructuredHandoffColumns(schemaName: string): Promise<void> {
        if (this.handoffSchemaReady.has(schemaName)) return;
        const statements = [
            `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_summary JSONB`,
            `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_trace_id VARCHAR(128)`,
            `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_summary_generated_at TIMESTAMPTZ`,
        ];
        for (const statement of statements) {
            await this.prisma.executeInTenantSchema(schemaName, statement);
        }
        this.handoffSchemaReady.add(schemaName);
    }

    private async loadHandoffTraceEvidence(
        schemaName: string,
        conversationId: string,
    ): Promise<{ turnTrace: HandoffTraceEvidence | null; conversationTrace: HandoffTraceEvidence | null }> {
        let turnTrace: HandoffTraceEvidence | null = null;
        let conversationTrace: HandoffTraceEvidence | null = null;
        try {
            const rows = await this.prisma.executeInTenantSchema<HandoffTraceEvidence[]>(
                schemaName,
                `SELECT id::text, steps, created_at
                   FROM turn_traces
                  WHERE conversation_id = $1::uuid
                  ORDER BY created_at DESC LIMIT 1`,
                [conversationId],
            );
            turnTrace = rows?.[0] || null;
        } catch (error: any) {
            this.logger.debug(`No turn trace available for handoff ${conversationId}: ${error.message}`);
        }
        try {
            const rows = await this.prisma.executeInTenantSchema<HandoffTraceEvidence[]>(
                schemaName,
                `SELECT id::text, kb_sources, created_at
                   FROM conversation_traces
                  WHERE conversation_id = $1::uuid
                  ORDER BY created_at DESC LIMIT 1`,
                [conversationId],
            );
            conversationTrace = rows?.[0] || null;
        } catch (error: any) {
            this.logger.debug(`No LLM trace available for handoff ${conversationId}: ${error.message}`);
        }
        return { turnTrace, conversationTrace };
    }

    private async generateStructuredSummary(
        context: HandoffSummaryContext,
    ): Promise<StructuredHandoffSummary> {
        const fallback = buildDeterministicHandoffSummary(context);
        if (context.messages.length === 0) return fallback;

        const i18n = handoffAgentI18n(context.language);
        const { customer, assistant } = i18n.transcriptLabels;
        const transcript = [...context.messages]
            .reverse()
            .map((message) => {
                const role = message.direction === 'inbound' ? customer : assistant;
                return `${role}: ${sanitizeHandoffText(message.content_text, 300)}`;
            })
            .join('\n')
            .slice(0, 6_000);

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: transcript }],
                systemPrompt: [
                    'You create concise internal handoff summaries from the supplied transcript only.',
                    'Return one valid JSON object and no markdown.',
                    'Required keys: customerIntent (string), knownFacts (string[]), pendingActions (string[]), confidence (number 0..1), uncertainty (string[]).',
                    'Do not include secrets, credentials, emails, phone numbers, payment-card or identity-document numbers.',
                    'Do not invent facts, tool outcomes, citations, identifiers, or actions already completed.',
                    `Output language: ${sanitizeHandoffText(context.language, 12)}. Escalation reason: ${sanitizeHandoffText(context.reason, 200)}.`,
                ].join('\n'),
                temperature: 0.1,
                maxTokens: 500,
                tenantId: context.tenantId,
                traceContext: { conversationId: context.conversationId, stage: 'handoff_summary' },
            });
            if (response.content) {
                const parsed = parseLlmHandoffSummary(response.content, fallback);
                if (parsed) return parsed;
            }
        } catch (error: any) {
            this.logger.warn(`AI handoff summary failed, using deterministic fallback: ${error.message}`);
        }
        return fallback;
    }
}
