import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { certifyProfiles } from './agent-certification';
import { PrismaService } from '../prisma/prisma.service';
import { EvalService } from './eval.service';
import { AgentTestService } from '../conversations/agent-test.service';
import { releaseRunContext } from './agent-release-policy';
import {
    CERTIFICATION_QUEUE, assertCertificationActor, assertCertificationId,
    assertPlanCertificationRequest, type CertificationActor, type PlanCertificationRequest,
} from './certification-contract';
import {
    cancelCertificationRun, certificationEvidenceFromLedger, certificationProgress,
    driveCertificationRun, ensureCertificationLedger, pauseCertificationRun, planCertificationLedger,
    resumeCertificationRun, retryCertificationCase,
    type CertificationLease, type CertificationQuery, type CertificationSubject,
} from './certification-ledger';
import { dryRunCertificationRunner, parallelyCertificationRunner } from './certification-runner';

export interface CertificationJob {
    readonly tenantId: string;
    readonly runId: string;
    readonly cases: number;
}

/**
 * The operable half of the certification executor.
 *
 * The ledger knew how to store a 233-hour run and survive being interrupted, and
 * nothing could start one: no service, no queue, no endpoint, no command. A
 * durable executor nobody can invoke is a design document with tests.
 *
 * Everything here is deliberately boring and explicit:
 *
 *  · **planning is idempotent by request key**, because the expensive mistake is
 *    planning the same catalogue twice and paying for it twice;
 *  · **starting publishes jobs**, one per batch of cases, so a worker crash
 *    loses a batch and not the run — the ledger's lease is what makes that safe;
 *  · **pause, resume and cancel are states**, not signals, so an operator who
 *    closes the tab does not change what the fleet does;
 *  · **the report is read from the ledger**, never from anything a caller sent;
 *  · **a rehearsal cannot certify**. `dry_run` writes real rows and the evidence
 *    assembly refuses them, so the wiring can be proven for free without ever
 *    producing a claim nobody paid for.
 */
@Injectable()
export class CertificationService {
    private readonly logger = new Logger(CertificationService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly evals: EvalService,
        private readonly agentTest: AgentTestService,
        @InjectQueue(CERTIFICATION_QUEUE) private readonly queue: Queue,
    ) {}

    private async schema(tenantId: string): Promise<string> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!schema) throw new NotFoundException({ error: 'tenant_not_found' });
        return schema;
    }

    private transaction<T>(schema: string, work: (query: CertificationQuery) => Promise<T>): Promise<T> {
        return this.prisma.transactionInTenantSchema(schema, query =>
            work(((sql: string, params: any[] = []) => query(sql, params)) as CertificationQuery));
    }

    /**
     * Plans a run and writes every case as a row before anything executes.
     *
     * The request key is the whole idempotency story: a retried POST, a
     * double-clicked button and a redelivered webhook all resolve to the same
     * run instead of a second catalogue nobody meant to pay for.
     */
    async plan(tenantId: string, body: PlanCertificationRequest, actor: CertificationActor) {
        assertCertificationActor(actor);
        const request = assertPlanCertificationRequest(body);
        const schema = await this.schema(tenantId);
        await this.transaction(schema, ensureCertificationLedger);

        const runId = await this.transaction(schema, async query => {
            const [existing] = await query<any[]>(
                `SELECT id FROM agent_certification_runs WHERE request_key = $1`, [request.requestKey]);
            return existing?.id ? String(existing.id) : null;
        }).catch(() => null);
        if (runId) return this.read(tenantId, runId, actor);

        const id = randomUUID();
        const record = await this.transaction(schema, query => planCertificationLedger(query, {
            agentId: request.agentId ?? randomUUID(),
            configHash: request.configHash ?? 'unset',
            dependencyRevision: request.dependencyRevision ?? 'unset',
            subjects: request.subjects as Readonly<Record<string, CertificationSubject>> | undefined,
            profiles: request.profiles, languages: request.languages,
            channels: request.channels, models: request.models, k: request.k,
            mode: request.mode, budgetUsdCents: request.budgetUsdCents,
            deadlineAt: request.deadlineAt ?? null,
        }, id as any));
        await this.transaction(schema, query =>
            query(`UPDATE agent_certification_runs SET request_key=$2 WHERE id=$1::uuid`, [id, request.requestKey]));
        await this.audit(tenantId, actor, 'certification.planned', {
            runId: id, mode: request.mode, cases: record.plannedCases, planHash: record.planHash,
        });
        this.logger.log(`[certification] planned ${record.plannedCases} cases (${request.mode}) for ${tenantId}`);
        return this.read(tenantId, id, actor);
    }

    /** Publishes the workers. Idempotent by job id, so a retried start adds nothing. */
    async start(tenantId: string, runId: string, actor: CertificationActor, workers = 2, casesPerWorker = 25) {
        assertCertificationActor(actor);
        assertCertificationId(runId);
        const schema = await this.schema(tenantId);
        const progress = await this.transaction(schema, query => certificationProgress(query, runId));
        if (!progress) throw new NotFoundException({ error: 'certification_run_not_found' });
        if (['finished', 'cancelled'].includes(progress.state)) {
            throw new ConflictException({ error: 'certification_run_closed', state: progress.state });
        }
        await this.transaction(schema, query => resumeCertificationRun(query, runId));
        const published: string[] = [];
        for (let worker = 0; worker < Math.max(1, Math.min(workers, 8)); worker++) {
            // A stable job id makes publication recoverable: a start that failed
            // half way through republishes the same ids and BullMQ keeps one.
            const jobId = `certification:${runId}:${worker}`;
            await this.queue.add('certification-batch',
                { tenantId, runId, cases: Math.max(1, Math.min(casesPerWorker, 200)) } satisfies CertificationJob,
                { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 50 });
            published.push(jobId);
        }
        await this.audit(tenantId, actor, 'certification.started', { runId, workers: published.length });
        return { runId, workers: published.length };
    }

    async pause(tenantId: string, runId: string, actor: CertificationActor) {
        assertCertificationActor(actor);
        assertCertificationId(runId);
        const schema = await this.schema(tenantId);
        await this.transaction(schema, query => pauseCertificationRun(query, runId));
        await this.audit(tenantId, actor, 'certification.paused', { runId });
        return this.read(tenantId, runId, actor);
    }

    async resume(tenantId: string, runId: string, actor: CertificationActor) {
        assertCertificationActor(actor);
        assertCertificationId(runId);
        const schema = await this.schema(tenantId);
        await this.transaction(schema, query => resumeCertificationRun(query, runId));
        await this.audit(tenantId, actor, 'certification.resumed', { runId });
        return this.start(tenantId, runId, actor);
    }

    async cancel(tenantId: string, runId: string, actor: CertificationActor) {
        assertCertificationActor(actor);
        assertCertificationId(runId);
        const schema = await this.schema(tenantId);
        await this.transaction(schema, query => cancelCertificationRun(query, runId));
        await this.audit(tenantId, actor, 'certification.cancelled', { runId });
        return this.read(tenantId, runId, actor);
    }

    async retry(tenantId: string, runId: string, caseKey: string, actor: CertificationActor) {
        assertCertificationActor(actor);
        assertCertificationId(runId);
        if (typeof caseKey !== 'string' || !/^[a-f0-9]{16,128}$/.test(caseKey)) {
            throw new BadRequestException({ error: 'certification_case_invalid' });
        }
        const schema = await this.schema(tenantId);
        const outcome = await this.transaction(schema, query => retryCertificationCase(query, runId, caseKey));
        await this.audit(tenantId, actor, 'certification.retried', { runId, caseKey, ...outcome });
        return outcome;
    }

    async read(tenantId: string, runId: string, actor: CertificationActor) {
        assertCertificationActor(actor, false);
        assertCertificationId(runId);
        const schema = await this.schema(tenantId);
        const progress = await this.transaction(schema, query => certificationProgress(query, runId));
        if (!progress) throw new NotFoundException({ error: 'certification_run_not_found' });
        return progress;
    }

    /**
     * The certification report, computed from stored rows.
     *
     * `certifyProfiles` is handed evidence built by `certificationEvidenceFromLedger`
     * and nothing else — no object from a request body has ever reached it, which
     * is the property the whole ledger exists to make true.
     */
    async report(tenantId: string, runId: string, actor: CertificationActor) {
        assertCertificationActor(actor, false);
        assertCertificationId(runId);
        const schema = await this.schema(tenantId);
        const [run] = await this.transaction(schema, query => query<any[]>(
            `SELECT plan_hash, mode FROM agent_certification_runs WHERE id=$1::uuid`, [runId]));
        if (!run) throw new NotFoundException({ error: 'certification_run_not_found' });
        const evidence = await this.transaction(schema, query => certificationEvidenceFromLedger(query, runId));
        const scope = await this.transaction(schema, query => query<any[]>(
            `SELECT DISTINCT profile_id, language, channel_type, model FROM agent_certification_cases
              WHERE run_id=$1::uuid`, [runId]));
        const report = certifyProfiles({
            scope: {
                languages: [...new Set(scope.map(row => String(row.language)))],
                channels: [...new Set(scope.map(row => String(row.channel_type)))],
                models: [...new Set(scope.map(row => String(row.model)))],
            },
            evidence: evidence.evidence,
            profiles: [...new Set(scope.map(row => String(row.profile_id)))],
        });
        return {
            runId, mode: String(run.mode), planHash: String(run.plan_hash),
            dryRun: evidence.dryRun === true,
            staleCases: evidence.staleCases, staleSubjects: evidence.staleSubjects,
            report,
        };
    }

    /** One worker's batch. Called by the processor; never by a request. */
    async process(job: CertificationJob) {
        const schema = await this.schema(job.tenantId);
        const [run] = await this.transaction(schema, query => query<any[]>(
            `SELECT mode, k, threshold, agent_id, config_hash, dependency_revision
               FROM agent_certification_runs WHERE id=$1::uuid`, [job.runId]));
        if (!run) throw new NotFoundException({ error: 'certification_run_not_found' });
        const subjectRows = await this.transaction(schema, query => query<any[]>(
            `SELECT profile_id, agent_id, config_hash, dependency_revision
               FROM agent_certification_subjects WHERE run_id=$1::uuid`, [job.runId]));
        const subjects = new Map<string, CertificationSubject>(subjectRows.map(row => [String(row.profile_id), {
            agentId: String(row.agent_id), configHash: String(row.config_hash),
            dependencyRevision: String(row.dependency_revision),
        }]));
        const k = Number(run.k), threshold = Number(run.threshold);
        const contextHash = (lease: CertificationLease) => releaseRunContext({
            agentId: subjects.get(lease.profileId)?.agentId ?? String(run.agent_id),
            dependencyRevision: subjects.get(lease.profileId)?.dependencyRevision ?? String(run.dependency_revision),
            configHash: subjects.get(lease.profileId)?.configHash ?? String(run.config_hash),
            channelType: lease.channelType, k, passPolicy: 'all', threshold,
        });
        const runner = String(run.mode) === 'dry_run'
            ? dryRunCertificationRunner({ k, threshold, contextHash })
            : parallelyCertificationRunner({
                runGate: (tenantId, agentId, opts) => this.evals.runGateV2(tenantId, agentId, opts as any),
                captureSnapshot: (tenantId, agentId) => this.agentTest.captureSnapshot(tenantId, agentId),
                tenantId: job.tenantId, k, threshold,
                subjectFor: profileId => subjects.get(profileId),
            });
        const outcome = await driveCertificationRun({
            transaction: work => this.transaction(schema, work),
            runner, runId: job.runId, maxCases: job.cases,
        });
        this.logger.log(`[certification] ${job.runId}: ${outcome.processed} cases, stopped on ${outcome.stopReason}`);
        return outcome;
    }

    private async audit(tenantId: string, actor: CertificationActor, action: string, details: Record<string, unknown>) {
        try {
            await this.prisma.auditLog.create({
                data: { tenantId, userId: actor.id, action, resource: 'agent_certification', details: details as any },
            });
        } catch (error: any) {
            // An audit that cannot be written must not abort the operation it
            // describes, but it must be visible: a silent catch here is how a
            // spending action ends up with no record of who asked for it.
            this.logger.warn(`[certification] audit failed for ${action}: ${error?.message ?? error}`);
        }
    }
}
