/**
 * Copiloto de onboarding, la ejecución de extracción (C0 §1.3, rebanada R6, ADR 0012).
 *
 * Lee lo que el negocio ya subió (web del dominio que declaró el dueño y documentos en `knowledge_documents`, FAQs
 * publicadas) y, para los requisitos que aplican y siguen ausentes, sembrados o de ejemplo, propone valores con sus citas.
 * También detecta:
 * - contradicciones: una fuente dice algo distinto del valor confirmado, o dos fuentes se contradicen;
 * - contenido genérico: FAQs publicadas sembradas, de ejemplo o sin dato (pregunta al dueño, nunca una edición);
 * y guarda preguntas puntuales del modelo para el dueño.
 *
 * El LLM propone y el código decide (C0 §0.6): cada propuesta pasa por `checkCopilotProposal` (estructura del requisito,
 * cita literal en la fuente que nombra, cifras respaldadas) antes de guardarse, y lo que falla se descarta y se cuenta.
 * La ejecución no escribe ningún valor del negocio: solo propuestas (CopilotProposalsService). Tope por tenant: 10 al día.
 */
import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
    checkCopilotProposal, genericTextReason, isCopilotRequirement, resolveValue, sameCopilotValue, type CopilotSource,
} from '@parallext/business-spec';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { PrismaService } from '../prisma/prisma.service';
import type { BusinessFactActor } from '../readiness/business-facts.service';
import { ReadinessService } from '../readiness/readiness.service';
import {
    COPILOT_EXTRACTION_MODEL, COPILOT_LIMITS, buildExtractionPrompt, parseExtractionResponse, type PromptRequirement,
} from './copilot-extraction-prompt';
import {
    CopilotProposalsService, newExtractionRunId, type CopilotEvidenceView, type CopilotProposalDraft,
} from './copilot-proposals.service';

/** Estados en los que el copiloto propone un valor (lo confirmado solo se compara, para detectar contradicciones). */
const OPEN_STATES = new Set(['ausente', 'sembrado', 'ejemplo', 'caducado']);
const FAQ_HYGIENE = 'CORE.KNOWLEDGE.FAQ_HYGIENE';
export const EXTRACTION_RUN_ACTION = 'copilot.extraction_run';

export interface ExtractionRunSummary {
    runId: string;
    model: string | null;
    sources: number;
    targets: number;
    proposed: number;
    contradictions: number;
    questions: number;
    discarded: { requirementId: string; code: string; message: string }[];
    /** Por qué no se llamó al modelo (sin fuentes, nada que proponer) o la respuesta no se pudo leer. */
    note: 'no_sources' | 'nothing_missing' | 'malformed_response' | 'llm_unavailable' | null;
}

interface SourceRow { id: string; title: string | null; source_type: string | null; source_url: string | null; content_text: string | null }
interface FaqRow { id: string; question: string; answer: string; content_status: string | null }

const hostOf = (url: string | null | undefined): string | null => {
    if (!url) return null;
    try {
        return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '');
    } catch { return null; }
};

const evidenceView = (e: { source_ref: string; quote: string; origin: string; url: string | null; label: string }): CopilotEvidenceView =>
    ({ sourceRef: e.source_ref, origin: e.origin, label: e.label, url: e.url, quote: e.quote });

@Injectable()
export class OnboardingExtractionService {
    private readonly logger = new Logger(OnboardingExtractionService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly readiness: ReadinessService,
        private readonly llm: LLMRouterService,
        private readonly proposals: CopilotProposalsService,
    ) {}

    protected now(): Date {
        return new Date();
    }

    /** «Analizar mis fuentes» (C0 §1.3): una ejecución, con tope diario por tenant. */
    async run(tenantId: string, actor: BusinessFactActor): Promise<ExtractionRunSummary> {
        if (actor.kind !== 'user' || !actor.userId) throw new ForbiddenException('el análisis lo pide una persona del negocio');
        await this.assertDailyCap(tenantId);
        const runId = newExtractionRunId();
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        const spec = this.readiness.spec;
        const [view, snapshot] = await Promise.all([this.readiness.getCurrent(tenantId, { refresh: true }), this.readiness.readSnapshot(tenantId)]);
        const applicable = view.result.requirements.filter(r => r.applies && !r.platform && !r.derived);

        const missing: PromptRequirement[] = [];
        const confirmed: PromptRequirement[] = [];
        for (const r of applicable) {
            if (!isCopilotRequirement(spec, r.id)) continue;
            const req = spec.requirements[r.id];
            const resolved = resolveValue(snapshot.values[r.id], this.now());
            const entry: PromptRequirement = {
                id: r.id, title: req.title, structure: req.data?.structure ?? null, example: req.data?.example ?? null,
                question: typeof req.gapMessage === 'string' ? req.gapMessage : (Object.values(req.gapMessage)[0] ?? req.title),
            };
            if (resolved.state === 'confirmado' && resolved.record) confirmed.push({ ...entry, current: resolved.record.value });
            else if (OPEN_STATES.has(String(resolved.state ?? 'ausente')) || r.result !== 'cumple') missing.push(entry);
        }
        const targets = missing.slice(0, COPILOT_LIMITS.maxTargets);
        const compare = confirmed.slice(0, COPILOT_LIMITS.maxConfirmed);
        const targetIds = new Set([...targets, ...compare].map(r => r.id));
        const currentOf = new Map(compare.map(r => [r.id, r.current]));

        const { sources, faqs } = await this.readSources(schema);
        const drafts: CopilotProposalDraft[] = [];
        const summary: ExtractionRunSummary = {
            runId, model: null, sources: sources.length, targets: targets.length + compare.length,
            proposed: 0, contradictions: 0, questions: 0, discarded: [], note: null,
        };

        // contenido genérico: determinista, sin LLM
        if (applicable.some(r => r.id === FAQ_HYGIENE)) {
            for (const faq of faqs) {
                const reason = genericTextReason({ body: faq.answer, contentStatus: faq.content_status });
                if (!reason) continue;
                drafts.push({
                    kind: 'question', requirementId: FAQ_HYGIENE, targetRef: `faqs:${faq.id}`,
                    input: { question: { code: 'generic_faq', faq: { id: faq.id, question: faq.question.slice(0, 300), reason } } },
                    evidence: [{ sourceRef: `faqs:${faq.id}`, origin: `faqs:${faq.id}`, label: faq.question.slice(0, 120), url: null, quote: faq.answer.slice(0, 300) }],
                });
            }
        }

        if (!sources.length) summary.note = 'no_sources';
        else if (!targets.length && !compare.length) summary.note = 'nothing_missing';
        else {
            const prompt = buildExtractionPrompt({ missing: targets, confirmed: compare, sources });
            let content: string | null = null;
            try {
                const response = await this.llm.execute({
                    model: COPILOT_EXTRACTION_MODEL, messages: [{ role: 'user', content: prompt.user }], systemPrompt: prompt.system,
                    temperature: 0, maxTokens: COPILOT_LIMITS.maxTokens, jsonMode: true, tenantId,
                });
                content = response.content;
                summary.model = response.routingDecision?.selectedModel?.id ?? COPILOT_EXTRACTION_MODEL;
            } catch (err) {
                this.logger.warn(`copilot: el modelo no respondió para ${tenantId}: ${(err as Error).message}`);
                summary.note = 'llm_unavailable';
            }
            if (content !== null) {
                const parsed = parseExtractionResponse(content);
                if (parsed.malformed) summary.note = 'malformed_response';
                drafts.push(...this.decide(parsed, { spec, sources, targetIds, currentOf, summary }));
            }
        }

        const kept = drafts.slice(0, COPILOT_LIMITS.maxProposals);
        const stored = kept.length ? await this.proposals.storeRun(tenantId, runId, actor.userId, kept) : [];
        summary.proposed = stored.filter(p => p.kind === 'value').length;
        summary.contradictions = stored.filter(p => p.kind === 'contradiction').length;
        summary.questions = stored.filter(p => p.kind === 'question').length;
        await this.recordRun(tenantId, actor, summary);
        return summary;
    }

    /**
     * Lo que se guarda de la respuesta del modelo. Cada propuesta pasa los guardarraíles del paquete; después:
     * - dos versiones distintas del mismo requisito → una contradicción con las dos;
     * - una versión distinta del valor confirmado → una contradicción con el valor de hoy;
     * - igual al valor confirmado → nada;
     * - el resto → una propuesta de valor.
     */
    private decide(
        parsed: ReturnType<typeof parseExtractionResponse>,
        ctx: { spec: ReadinessService['spec']; sources: CopilotSource[]; targetIds: Set<string>; currentOf: Map<string, unknown>; summary: ExtractionRunSummary },
    ): CopilotProposalDraft[] {
        const bySource = new Map(ctx.sources.map(s => [s.ref, s]));
        const verified = new Map<string, { value: unknown; evidence: CopilotEvidenceView[] }[]>();
        for (const p of parsed.proposals) {
            if (!ctx.targetIds.has(p.requirementId)) {
                ctx.summary.discarded.push({ requirementId: p.requirementId, code: 'not_a_target', message: 'requisito fuera de esta ejecución' });
                continue;
            }
            const check = checkCopilotProposal(ctx.spec, p, bySource);
            if (!check.ok) {
                for (const r of check.rejections) ctx.summary.discarded.push({ requirementId: p.requirementId, code: r.code, message: r.message });
                continue;
            }
            const versions = verified.get(p.requirementId) ?? [];
            const same = versions.find(v => sameCopilotValue(v.value, p.value));
            if (same) same.evidence.push(...check.evidence.map(evidenceView));
            else versions.push({ value: p.value, evidence: check.evidence.map(evidenceView) });
            verified.set(p.requirementId, versions);
        }

        const drafts: CopilotProposalDraft[] = [];
        for (const [requirementId, versions] of verified) {
            const hasCurrent = ctx.currentOf.has(requirementId);
            const current = ctx.currentOf.get(requirementId);
            const differing = hasCurrent ? versions.filter(v => !sameCopilotValue(v.value, current)) : versions;
            if (!differing.length) continue;
            const evidence = differing.flatMap(v => v.evidence);
            if (differing.length > 1) {
                drafts.push({ kind: 'contradiction', requirementId, targetRef: '', evidence, input: { alternatives: differing, ...(hasCurrent ? { current } : {}) } });
            } else if (hasCurrent) {
                drafts.push({ kind: 'contradiction', requirementId, targetRef: '', evidence, input: { value: differing[0].value, current } });
            } else {
                drafts.push({ kind: 'value', requirementId, targetRef: '', evidence, input: { value: differing[0].value } });
            }
        }
        const covered = new Set(drafts.map(d => d.requirementId));
        for (const q of parsed.questions) {
            if (!ctx.targetIds.has(q.requirementId) || covered.has(q.requirementId)) continue;
            covered.add(q.requirementId);
            drafts.push({ kind: 'question', requirementId: q.requirementId, targetRef: '', evidence: [], input: { question: { code: 'owner_question', text: q.question } } });
        }
        return drafts;
    }

    /**
     * Fuentes ya ingeridas (C0 §1.3): documentos y páginas confirmados del negocio (nunca contenido sembrado o de ejemplo),
     * las páginas web solo del dominio que declaró el dueño, y las FAQs publicadas (las genéricas no son fuente: son
     * preguntas). El texto se recorta por fuente y en total; la cita se verifica contra lo recortado.
     */
    private async readSources(schema: string): Promise<{ sources: CopilotSource[]; faqs: FaqRow[] }> {
        const docs = await this.query<SourceRow>(schema,
            `SELECT id::text AS id, title, source_type, source_url, content_text FROM knowledge_documents
              WHERE COALESCE(status, '') NOT IN ('deleted', 'error') AND content_text IS NOT NULL AND length(content_text) > 0
                AND COALESCE(content_status, 'confirmed') = 'confirmed'
              ORDER BY updated_at DESC NULLS LAST LIMIT ${COPILOT_LIMITS.maxSources}`);
        const website = (await this.query<{ website: string | null }>(schema, 'SELECT website FROM companies WHERE is_primary = true LIMIT 1'))[0]?.website ?? null;
        const declared = hostOf(website);
        const faqs = await this.query<FaqRow>(schema,
            `SELECT id::text AS id, question, answer, content_status FROM faqs WHERE is_published = true ORDER BY order_index ASC, created_at ASC LIMIT 100`);

        const sources: CopilotSource[] = [];
        let budget: number = COPILOT_LIMITS.totalChars;
        const push = (s: Omit<CopilotSource, 'ref' | 'text'>, text: string) => {
            if (budget <= 0 || sources.length >= COPILOT_LIMITS.maxSources) return;
            const cut = text.slice(0, Math.min(COPILOT_LIMITS.sourceChars, budget));
            if (!cut.trim()) return;
            budget -= cut.length;
            sources.push({ ...s, ref: `S${sources.length + 1}`, text: cut });
        };
        for (const d of docs) {
            const isWeb = d.source_type === 'url' || /^https?:\/\//i.test(d.source_url ?? '');
            if (isWeb && declared) {
                const host = hostOf(d.source_url);
                // solo el dominio propio (C0 §1.3, §6.6): nunca el sitio de otro
                if (!host || (host !== declared && !host.endsWith(`.${declared}`))) continue;
            }
            push({ kind: isWeb ? 'web' : 'document', label: d.title ?? d.source_url ?? 'documento', url: d.source_url ?? null, origin: `knowledge_documents:${d.id}` }, String(d.content_text));
        }
        const answered = faqs.filter(f => !genericTextReason({ body: f.answer, contentStatus: f.content_status }));
        if (answered.length) {
            // las FAQs del dueño, como una fuente por FAQ (la cita debe salir de una sola)
            for (const f of answered) push({ kind: 'faq', label: f.question.slice(0, 120), url: null, origin: `faqs:${f.id}` }, `${f.question}\n${f.answer}`);
        }
        return { sources, faqs };
    }

    /** Lectura tolerante: un tenant sin la tabla (sin FAQs, sin companies) no tiene esas fuentes. */
    private async query<T>(schema: string, sql: string): Promise<T[]> {
        try {
            return await this.prisma.executeInTenantSchema<T[]>(schema, sql);
        } catch (err) {
            this.logger.warn(`copilot: fuente no disponible en ${schema}: ${(err as Error).message}`);
            return [];
        }
    }

    private async assertDailyCap(tenantId: string): Promise<void> {
        const since = new Date(this.now().getTime() - 24 * 3_600_000);
        const runs = await this.prisma.auditLog.count({ where: { tenantId, action: EXTRACTION_RUN_ACTION, createdAt: { gte: since } } });
        if (runs >= COPILOT_LIMITS.runsPerDay) {
            throw new HttpException({ error: 'copilot_daily_cap', message: `ya se analizaron las fuentes ${runs} veces hoy; vuelve a intentarlo mañana`, limit: COPILOT_LIMITS.runsPerDay }, HttpStatus.TOO_MANY_REQUESTS);
        }
    }

    private async recordRun(tenantId: string, actor: BusinessFactActor, summary: ExtractionRunSummary): Promise<void> {
        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId, userId: actor.kind === 'user' ? actor.userId : null, action: EXTRACTION_RUN_ACTION,
                    resource: `copilot/${summary.runId}`,
                    details: {
                        model: summary.model, sources: summary.sources, targets: summary.targets, proposed: summary.proposed,
                        contradictions: summary.contradictions, questions: summary.questions, discarded: summary.discarded.length, note: summary.note,
                        ...(actor.kind === 'user' ? actor.delegation ?? {} : {}),
                    } as any,
                },
            });
        } catch (err) {
            this.logger.warn(`copilot: ejecución ${summary.runId} sin registro: ${(err as Error).message}`);
        }
    }
}
