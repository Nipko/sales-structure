import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EvalService } from './eval.service';
import { AgentTestService } from '../conversations/agent-test.service';
import { benchmarkStatement, type BenchmarkSubject, type BenchmarkTask } from './agent-benchmark';
import {
    benchmarkRunProgress, cancelBenchmarkRun, ensureBenchmarkLedger, generateBenchmarkCorpus,
    loadBenchmarkEvidence, openBenchmarkRun, pauseBenchmarkRun, recordBenchmarkReview,
    resumeBenchmarkRun, runBenchmarkSubject, summariseStoredBenchmark, syntheticBenchmarkRunner,
    type BenchmarkQuery, type BenchmarkRunner,
} from './benchmark-harness';
import { assertCertificationActor, type CertificationActor } from './certification-contract';

export const BENCHMARK_QUEUE = 'agent-benchmark';

export interface BenchmarkJob {
    readonly tenantId: string;
    readonly corpusId: string;
    readonly seed: string;
    /**
     * Everything the generator needs to rebuild the SAME corpus in another
     * process. Carrying only the id and the seed rebuilt a corpus over the whole
     * catalogue instead of the planned slice, and the attempts landed under a
     * hash nobody was comparing — a silent failure, because the rows were there.
     */
    readonly profiles?: readonly string[];
    readonly languages?: readonly string[];
    readonly channels: readonly string[];
    readonly perStratum?: number;
    /** What the planner froze. A rebuild that disagrees is refused, not scored. */
    readonly corpusHash: string;
    readonly subjectId: string;
    readonly runIndex: number;
    readonly kind: 'parallly' | 'synthetic';
    /** The run this pass belongs to. Every task is gated and charged against it. */
    readonly runId?: string;
}

export interface PlanBenchmarkRequest {
    readonly corpusId: string;
    readonly seed: string;
    readonly profiles?: string[];
    readonly languages?: string[];
    readonly channels: string[];
    readonly perStratum?: number;
    readonly subjects: BenchmarkSubject[];
    /**
     * Stable across retries. A start that failed after publishing half its jobs
     * has to be safe to call again, and a second run over the same corpus would
     * double the spend and make "did the subject agree with itself" meaningless.
     */
    readonly requestKey?: string;
    /**
     * The ceiling, in US cents. Required as soon as Parallly is a subject,
     * because that is the runner that calls a model — the same rule the
     * certification executor works to, and for the same reason: an
     * uncapped run over a catalogue is a bill nobody approved.
     */
    readonly budgetUsdCents?: number;
    readonly deadlineAt?: string;
}

/**
 * The operable half of the benchmark, with the same shape as the certification
 * service and for the same reason: a harness nobody can invoke is a library.
 *
 * The corpus is deliberately NOT stored as rows. It is generated from the
 * catalogue and frozen by hash, so any process that asks for the same id and
 * seed gets the same corpus — which is what lets a worker in another process
 * score attempts against it without a table to keep in sync. The hash is the
 * contract, and an attempt naming a different one is refused by the summary.
 *
 * What is stored is what cannot be regenerated: the attempts, and the blind
 * scores people gave them.
 */
@Injectable()
export class BenchmarkService {
    private readonly logger = new Logger(BenchmarkService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly evals: EvalService,
        private readonly agentTest: AgentTestService,
        @InjectQueue(BENCHMARK_QUEUE) private readonly queue: Queue,
    ) {}

    private async schema(tenantId: string): Promise<string> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!schema) throw new NotFoundException({ error: 'tenant_not_found' });
        return schema;
    }

    private transaction<T>(schema: string, work: (query: BenchmarkQuery) => Promise<T>): Promise<T> {
        return this.prisma.transactionInTenantSchema(schema, query =>
            work(((sql: string, params: any[] = []) => query(sql, params)) as BenchmarkQuery));
    }

    private assertRequest(body: PlanBenchmarkRequest): PlanBenchmarkRequest {
        if (typeof body?.corpusId !== 'string' || !/^[a-zA-Z0-9_-]{3,60}$/.test(body.corpusId)) {
            throw new BadRequestException({ error: 'benchmark_corpus_id_invalid' });
        }
        if (typeof body?.seed !== 'string' || !/^[a-zA-Z0-9_-]{4,60}$/.test(body.seed)) {
            throw new BadRequestException({ error: 'benchmark_seed_invalid' });
        }
        const channels = [...new Set(body.channels ?? [])];
        if (!channels.length || channels.some(channel => !(CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel))) {
            throw new BadRequestException({ error: 'benchmark_channel_invalid' });
        }
        const languages = body.languages?.length ? [...new Set(body.languages)] : [...EVAL_LANGUAGES];
        if (languages.some(language => !(EVAL_LANGUAGES as readonly string[]).includes(language))) {
            throw new BadRequestException({ error: 'benchmark_language_invalid' });
        }
        const canonical = listCanonicalSubtypeExperienceProfileIds();
        const profiles = body.profiles?.length ? [...new Set(body.profiles)] : canonical;
        if (profiles.some(profile => !canonical.includes(profile))) {
            throw new BadRequestException({ error: 'benchmark_profile_unknown' });
        }
        if (!Array.isArray(body.subjects) || body.subjects.length < 1) {
            throw new BadRequestException({ error: 'benchmark_subject_required' });
        }
        // A label a reviewer can decode is not blind, and a benchmark whose
        // review is not blind is a benchmark whose review is an opinion about a
        // brand. `summariseBenchmark` refuses it later; refusing here means the
        // run never happens rather than being discarded after it costs money.
        for (const subject of body.subjects) {
            if (!subject?.id || !subject.blindLabel || !subject.label
                || subject.blindLabel === subject.id
                || subject.blindLabel.toLowerCase().includes(subject.label.toLowerCase())) {
                throw new BadRequestException({ error: 'benchmark_blind_label_invalid', subject: subject?.id });
            }
        }
        return { ...body, channels, languages, profiles };
    }

    /** Freezes the corpus and reports what it refused, without storing a row. */
    corpus(body: PlanBenchmarkRequest) {
        const request = this.assertRequest(body);
        const built = generateBenchmarkCorpus({
            id: request.corpusId, seed: request.seed, profiles: request.profiles,
            languages: request.languages, channels: request.channels, perStratum: request.perStratum,
        });
        if (!built.corpus.tasks.length) {
            throw new ConflictException({ error: 'benchmark_corpus_empty', refusals: built.refusals });
        }
        return built;
    }

    async plan(tenantId: string, body: PlanBenchmarkRequest, actor: CertificationActor) {
        assertCertificationActor(actor);
        const built = this.corpus(body);
        const schema = await this.schema(tenantId);
        await this.transaction(schema, ensureBenchmarkLedger);
        await this.audit(tenantId, actor, 'benchmark.planned', {
            corpusId: built.corpus.id, corpusHash: built.corpus.contentHash,
            tasks: built.corpus.tasks.length, subjects: body.subjects.map(subject => subject.id),
        });
        return {
            corpusId: built.corpus.id, corpusHash: built.corpus.contentHash,
            tasks: built.corpus.tasks.length, emptyStrata: built.emptyStrata, refusals: built.refusals,
        };
    }

    async start(tenantId: string, body: PlanBenchmarkRequest, actor: CertificationActor, runIndex = 1) {
        assertCertificationActor(actor);
        const request = this.assertRequest(body);
        const built = this.corpus(request);
        const spends = request.subjects.some(subject => subject.kind === 'self');
        // The one refusal that has to happen before anything is published: the
        // Parallly runner calls a model for every task, and an uncapped pass
        // over a catalogue is a bill nobody approved. A run of only synthetic
        // subjects costs nothing and needs no ceiling.
        if (spends && !(Number.isInteger(request.budgetUsdCents) && (request.budgetUsdCents as number) > 0)) {
            throw new BadRequestException({ error: 'benchmark_budget_required' });
        }
        const schema = await this.schema(tenantId);
        await this.transaction(schema, ensureBenchmarkLedger);
        const requestKey = request.requestKey
            ?? `${request.corpusId}:${request.seed}:${built.corpus.contentHash}:${runIndex}`;
        const run = await this.transaction(schema, query => openBenchmarkRun(query, {
            corpusId: request.corpusId, corpusHash: built.corpus.contentHash, requestKey, runIndex,
            budgetUsdCents: request.budgetUsdCents ?? null, deadlineAt: request.deadlineAt ?? null,
        }));
        const published: string[] = [];
        for (const subject of request.subjects) {
            const jobId = `benchmark:${request.corpusId}:${request.seed}:${subject.id}:${runIndex}`;
            await this.queue.add('benchmark-subject', {
                tenantId, corpusId: request.corpusId, seed: request.seed,
                profiles: request.profiles, languages: request.languages,
                channels: request.channels, perStratum: request.perStratum,
                corpusHash: built.corpus.contentHash,
                subjectId: subject.id, runId: run.id,
                runIndex, kind: subject.kind === 'self' ? 'parallly' : 'synthetic',
            } satisfies BenchmarkJob, { jobId, attempts: 2, removeOnComplete: 50 });
            published.push(jobId);
        }
        await this.audit(tenantId, actor, 'benchmark.started',
            { corpusId: request.corpusId, subjects: published.length, runId: run.id,
                budgetUsdCents: run.budgetUsdCents });
        return { subjects: published.length, runId: run.id, budgetUsdCents: run.budgetUsdCents };
    }

    /** Terminal, and audited with the real actor. A worker after it takes nothing. */
    async cancel(tenantId: string, runId: string, actor: CertificationActor) {
        assertCertificationActor(actor);
        const schema = await this.schema(tenantId);
        const cancelled = await this.transaction(schema, query => cancelBenchmarkRun(query, runId));
        await this.audit(tenantId, actor, 'benchmark.cancelled', { runId, cancelled });
        return { runId, cancelled };
    }

    async pause(tenantId: string, runId: string, actor: CertificationActor) {
        assertCertificationActor(actor);
        const schema = await this.schema(tenantId);
        const paused = await this.transaction(schema, query => pauseBenchmarkRun(query, runId));
        await this.audit(tenantId, actor, 'benchmark.paused', { runId, paused });
        return { runId, paused };
    }

    async resume(tenantId: string, runId: string, actor: CertificationActor) {
        assertCertificationActor(actor);
        const schema = await this.schema(tenantId);
        const resumed = await this.transaction(schema, query => resumeBenchmarkRun(query, runId));
        await this.audit(tenantId, actor, 'benchmark.resumed', { runId, resumed });
        return { runId, resumed };
    }

    /** What has been spent, and whether anything is still allowed to run. */
    async runState(tenantId: string, runId: string, actor: CertificationActor) {
        assertCertificationActor(actor);
        const schema = await this.schema(tenantId);
        return this.transaction(schema, query => benchmarkRunProgress(query, runId));
    }

    /**
     * One subject's pass over the corpus.
     *
     * The corpus is rebuilt from the id and seed rather than read from a table:
     * the generator is deterministic, so this worker and the one that planned it
     * are looking at the same frozen tasks, and the hash on every attempt proves
     * it rather than assuming it.
     */
    async process(job: BenchmarkJob, subject?: BenchmarkSubject) {
        const schema = await this.schema(job.tenantId);
        const built = generateBenchmarkCorpus({
            id: job.corpusId, seed: job.seed,
            profiles: job.profiles ? [...job.profiles] : undefined,
            languages: job.languages ? [...job.languages] : undefined,
            channels: [...job.channels], perStratum: job.perStratum,
        });
        // The generator is deterministic, so this is a check that the worker and
        // the planner are looking at the same frozen tasks — not an assumption
        // that they are.
        if (job.corpusHash && built.corpus.contentHash !== job.corpusHash) {
            throw new ConflictException({
                error: 'benchmark_corpus_drifted',
                expected: job.corpusHash, actual: built.corpus.contentHash,
            });
        }
        const resolved: BenchmarkSubject = subject ?? {
            id: job.subjectId, kind: job.kind === 'parallly' ? 'self' : 'alternative',
            label: job.subjectId, blindLabel: `subject-${job.runIndex}-${job.subjectId.slice(0, 4)}`,
            setupMinutes: null,
        };
        const runner: BenchmarkRunner = job.kind === 'parallly'
            ? this.parallelyRunner(job.tenantId)
            : syntheticBenchmarkRunner({ seed: `${job.seed}:${job.subjectId}`, confirmRate: 0.6 });
        const outcome = await this.transaction(schema, query => runBenchmarkSubject({
            query, corpus: built.corpus, subject: resolved, runner,
            runIndex: job.runIndex, runId: job.runId,
        }));
        this.logger.log(`[benchmark] ${job.subjectId}: ${outcome.confirmed}/${outcome.attempts} confirmed`
            + `, ${outcome.skipped} already done, stopped ${outcome.stopReason}`);
        return outcome;
    }

    /**
     * Parallly answering the corpus through its own runtime.
     *
     * It is the only runner here that costs anything, and it is the one the
     * comparison is about: a benchmark where our side is simulated compares a
     * competitor against a mock of ourselves.
     */
    private parallelyRunner(tenantId: string): BenchmarkRunner {
        return async (subject, task: BenchmarkTask) => {
            const started = Date.now();
            try {
                const snapshot = await this.agentTest.captureSnapshot(tenantId, subject.id);
                const gate = await this.evals.runGateV2(tenantId, subject.id, {
                    channelType: task.channel, k: 1, passPolicy: 'all', agentSnapshot: snapshot,
                    scenarios: [{ key: task.key, messages: [...task.messages], criteria: '', expectedActions: [] }],
                } as any);
                const result = (gate?.results ?? [])[0];
                return {
                    // `confirmed` is the effect check, not the judge's opinion:
                    // the corpus counts a task done where the row lands.
                    confirmed: result?.passed === true,
                    costUsdCents: Math.max(0, Math.round(Number(gate?.costUsdCents ?? 0))),
                    latencyMs: Date.now() - started,
                    transcript: (result?.runs ?? []).flatMap((run: any) => run?.transcript ?? []),
                    error: result?.error ? String(result.error).slice(0, 200) : null,
                };
            } catch (error: any) {
                // Unchecked, not failed. The summary treats the two differently
                // and so must this.
                return {
                    confirmed: null, costUsdCents: null, latencyMs: null, transcript: [],
                    error: String(error?.message ?? 'subject_unreachable').slice(0, 200),
                };
            }
        };
    }

    async review(tenantId: string, corpusHash: string, review: {
        taskKey: string; blindLabel: string; reviewerId: string; score: number; notes?: string;
    }, actor: CertificationActor) {
        assertCertificationActor(actor);
        if (typeof corpusHash !== 'string' || !/^[a-f0-9]{16,128}$/.test(corpusHash)) {
            throw new BadRequestException({ error: 'benchmark_corpus_hash_invalid' });
        }
        if (!Number.isFinite(review?.score) || review.score < 0 || review.score > 10) {
            throw new BadRequestException({ error: 'benchmark_score_invalid' });
        }
        const schema = await this.schema(tenantId);
        await this.transaction(schema, query => recordBenchmarkReview(query, corpusHash, review));
        await this.audit(tenantId, actor, 'benchmark.reviewed', { corpusHash, taskKey: review.taskKey });
        return { recorded: true };
    }

    /** The summary, and the sentence it is allowed to support. */
    async report(tenantId: string, body: PlanBenchmarkRequest, actor: CertificationActor) {
        assertCertificationActor(actor, false);
        const request = this.assertRequest(body);
        const built = this.corpus(request);
        const schema = await this.schema(tenantId);
        const report = await this.transaction(schema, query => summariseStoredBenchmark({
            query, corpus: built.corpus, subjects: request.subjects,
        }));
        const evidence = await this.transaction(schema, query =>
            loadBenchmarkEvidence(query, built.corpus.contentHash));
        return {
            report, statement: benchmarkStatement(report),
            attempts: evidence.attempts.length, reviews: evidence.reviews.length,
        };
    }

    private async audit(tenantId: string, actor: CertificationActor, action: string, details: Record<string, unknown>) {
        try {
            await this.prisma.auditLog.create({
                data: { tenantId, userId: actor.id, action, resource: 'agent_benchmark', details: details as any },
            });
        } catch (error: any) {
            this.logger.warn(`[benchmark] audit failed for ${action}: ${error?.message ?? error}`);
        }
    }
}
