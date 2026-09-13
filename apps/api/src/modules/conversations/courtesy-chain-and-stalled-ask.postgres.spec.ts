import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConversationsService } from './conversations.service';
import { AgentTurnLedgerStore } from './agent-turn-ledger.store';
import { ProcedureEngineService } from './procedure-engine.service';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { OutboundQueueProcessor, OUTBOUND_QUEUE } from '../channels/outbound-queue.processor';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL } from '../channels/agent-dispatch-outbox';
import { TURN_LEDGER_DDL } from './agent-turn-ledger';
import { DispatchRolloutService } from '../channels/dispatch-rollout.service';
import { WhatsappSpendService } from '../billing/whatsapp-spend/whatsapp-spend.service';
import { WhatsappSendAdmissionService } from '../billing/whatsapp-spend/whatsapp-send-admission.service';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { valkeyConnection, workerValkeyDb } from '../../common/__fixtures__/worker-valkey';
import { resolvingChannelToken, openPauseStore } from '../channels/__fixtures__/spend-gate-double';
import type { StrictDispatchOutcome, StrictDispatchRequest } from '../channels/strict-dispatch-transport';
import type { NormalizedMessage } from '@parallext/shared';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const redisUrl = process.env.DISPATCH_QUEUE_TEST_REDIS_URL;
const ready = !!databaseUrl && !!redisUrl;

/**
 * ═══ TWO R5 SCENARIOS, RUN RATHER THAN REASONED ABOUT ═══
 *
 * `claude-whatsapp-response-spend-guardrails.md` §R5 names eighteen situations.
 * Two of them are about a turn that should decide NOT to answer, and both were
 * uncovered for the same reason: the only thing in the platform that could stop
 * a repeat was the spend gate's content digest, and a digest cannot see either
 * case. Five different courtesies are five different digests. A rephrased
 * question is a different digest from the question.
 *
 *   · **Pregunta resuelta y cinco «gracias»** — evidence: *sin cadena nueva de
 *     respuestas automáticas*. An answer followed by five distinct thank-yous
 *     produced six admissions, six reservations and six POSTs.
 *   · **Misma pregunta requerida sin progreso** — evidence: *reformulación
 *     limitada y vía alternativa, sin loop*. The procedure runtime re-emits the
 *     ask for a datum it is still awaiting, for as long as the customer keeps
 *     failing to supply it.
 *
 * So the oracle here is not a return value: it is the number of POSTs the
 * provider received, the number of reservation rows the ledger holds, the
 * outcome rows the turn ledger wrote, and — for the second scenario — whether a
 * person actually owns the conversation afterwards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL
 * ─────────────────────────────────────────────────────────────────────────────
 *  · PostgreSQL 55437, one disposable schema built from the shipped
 *    `prisma/tenant-schema.sql` — the conversation tables AND the WhatsApp spend
 *    ledger block — plus the outbox and turn-ledger DDL the stores bootstrap.
 *  · `PrismaService`'s own `executeInTenantSchema` / `transactionInTenantSchema`
 *    over a real `PrismaClient`, so every statement runs in its own transaction
 *    with `SET LOCAL search_path`.
 *  · Valkey 55440 behind the real `RedisService`: the conversation mutex, the
 *    burst debounce, the turn markers.
 *  · A real BullMQ `Queue` and `Worker`, uniquely named per run.
 *  · `ConversationsService.processIncomingMessage` → `runTurn`: the debounce,
 *    contact/conversation resolution, `saveMessage` and its dedupe index, the
 *    turn ledger, the outcome decision, `dispatchReplyThroughOutbox`.
 *  · `AgentTurnLedgerStore`, `AgentDispatchOutboxStore`, `DispatchRolloutService`
 *    with its real `platform_settings` row, `OutboundQueueService`,
 *    `OutboundQueueProcessor`, `ChannelGatewayService`.
 *  · **The money authority.** `WhatsappSendAdmissionService` over a real
 *    `WhatsappSpendService` over the real ledger tables — so "reservations
 *    taken" is a row count and the repetition guard is the shipped one, not a
 *    double that says yes.
 *  · `ProcedureEngineService.getState`, reading the durable procedure state out
 *    of `conversations.metadata`, which is how the turn learns which datum it is
 *    still awaiting.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS FAKED, AND WHY IT HAS TO BE
 * ─────────────────────────────────────────────────────────────────────────────
 *  · The model, at the `generateResponse` seam. There are no provider keys here
 *    and a real model is not deterministic — and these two scenarios are about
 *    what the platform does with a REPLY, so the reply is the input. The double
 *    writes the procedure state exactly as `ProcedureEngineService` writes it
 *    (`metadata.procedureStateManaged` + `metadata.procedureState`), and the
 *    turn reads it back through the real `getState`, so the datum identity is
 *    not an assumption this file makes.
 *  · The provider transport (`sendStrict`). Every remote effect is counted here
 *    instead of leaving the process.
 *  · `ProactiveDispatchService` is NOT wired, so the deterministic handover
 *    sentence takes the documented fallback — `replyOnceThroughOutbox` answers
 *    false and the turn puts it on the outbound queue instead, which is what a
 *    tenant without that lane gets. It is still admitted by the real money
 *    authority and still counted as a POST; what it does not get is an outbox
 *    row, which is why the durable cases here assert two rows and not three.
 *  · Collaborators with no bearing on these two decisions: analytics, nurturing,
 *    drip, lead scoring, identity, attribution, opt-out, throttling, persona
 *    resolution, pipeline stages. `handoffService` is a recorder rather than a
 *    stub: whether a person ends up owning the conversation is half of what the
 *    second scenario has to prove, so the call is asserted on.
 */
(ready ? describe : describe.skip)('two turns that should decide not to answer', () => {
    jest.setTimeout(240_000);

    const tenantId = randomUUID();
    const schema = `tenant_r5_stops_${randomUUID().replace(/-/g, '')}`;
    const agentId = randomUUID();
    const phoneNumberId = `pnid-${randomUUID().slice(0, 8)}`;
    const customerPhone = '573001112233';
    const outboundQueueName = `${OUTBOUND_QUEUE}-r5-${randomUUID().slice(0, 8)}`;

    let client: PrismaClient;
    let prisma: any;
    let redis: RedisService;
    let outboundQueue: Queue;
    let outboundWorker: Worker | undefined;
    let conversations: any;
    let outbox: AgentDispatchOutboxStore;
    let turnLedger: AgentTurnLedgerStore;
    let rollout: DispatchRolloutService;
    let admission: WhatsappSendAdmissionService;
    let channelGateway: ChannelGatewayService;
    let procedureEngine: ProcedureEngineService;

    /** Every POST the provider transport was asked to perform, in order. */
    let posts: { kind: string; body: string }[] = [];
    /** Every handoff the turn asked for. The "other route", if it is real. */
    let handoffs: { reason: string }[] = [];
    /** What the faked model answers next, and what datum it leaves awaited. */
    let script: { reply: string; awaiting?: string | null }[] = [];

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    const bodyOf = (payload: any): string =>
        String(payload?.text ?? payload?.mediaUrl ?? payload?.content?.text ?? '');

    async function until(what: string, condition: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            if (await condition()) return;
            if (Date.now() > deadline) throw new Error(`timed_out_waiting_for: ${what}`);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }

    const queueIdle = async (): Promise<boolean> => {
        const counts = await outboundQueue.getJobCounts('active', 'waiting', 'prioritized', 'delayed');
        return !counts.active && !counts.waiting && !counts.prioritized && !counts.delayed;
    };

    /** One customer message, driven all the way to a quiet queue. */
    async function customerSays(text: string, from = customerPhone): Promise<void> {
        const wamid = `wamid.IN.${randomUUID()}`;
        const msg: NormalizedMessage = {
            id: randomUUID(),
            tenantId,
            channelType: 'whatsapp' as any,
            channelAccountId: phoneNumberId,
            contactId: from,
            conversationId: '',
            direction: 'inbound',
            content: { type: 'text', text },
            timestamp: new Date(),
            status: 'delivered',
            metadata: { waMessageId: wamid, contactName: 'Cliente Sintético' },
        };
        await conversations.processIncomingMessage(msg);
        await until('a quiet outbound queue', queueIdle);
    }

    /** Reservation rows the money authority actually took. */
    const reservations = async (): Promise<any[]> =>
        sql(`SELECT effect_key, state, admission_reason FROM whatsapp_spend_reservations
              ORDER BY created_at, effect_key`);

    /** Every outcome the turn ledger recorded, oldest first. */
    const outcomes = async (): Promise<{ kind: string; reason: string | null; resumeAfter: string | null }[]> =>
        (await sql(`SELECT outcome FROM agent_turn_ledger WHERE outcome IS NOT NULL
                     ORDER BY created_at`))
            .map(row => ({
                kind: String(row.outcome.kind),
                reason: row.outcome.reason ?? null,
                resumeAfter: row.outcome.resumeAfter ?? null,
            }));

    const conversationStatus = async (): Promise<string> =>
        String((await sql('SELECT status FROM conversations LIMIT 1'))[0]?.status ?? 'none');

    beforeAll(async () => {
        const dbUrl = new URL(databaseUrl!), valkeyUrl = new URL(redisUrl!);
        if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname) || !dbUrl.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        if (!['localhost', '127.0.0.1'].includes(valkeyUrl.hostname))
            throw new Error('disposable_loopback_redis_required');

        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await ensureSyntheticGlobalTables(statement => client.$executeRawUnsafe(statement));
        await client.$executeRawUnsafe(
            `CREATE TABLE IF NOT EXISTS public.platform_settings(
                key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active,settings) VALUES($1::uuid,$2,true,\'{}\'::jsonb)',
            tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

        const template = readFileSync(join(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const conversationTables = template.slice(
            template.indexOf('-- ---- Contacts ----'),
            template.indexOf('-- ---- Consent Records ----'));
        for (const statement of (PrismaService.prototype as any).splitSqlStatements(
            conversationTables.replace(/\{\{SCHEMA_NAME\}\}/g, schema))) {
            await client.$executeRawUnsafe(statement);
        }
        // The money tables, from the same shipped DDL rather than a hand-written
        // approximation: the counters' own defaults are what decide whether the
        // free thousand is granted, so an approximation would be testing itself.
        const spendBlock = template.split('-- BEGIN WHATSAPP SPEND LEDGER')[1]
            ?.split('-- END WHATSAPP SPEND LEDGER')[0];
        if (!spendBlock) throw new Error('tenant_schema_spend_block_missing');
        for (const statement of spendBlock.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
            await client.$executeRawUnsafe(statement.replaceAll('{{SCHEMA_NAME}}', schema));
        }

        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRaw = client.$queryRaw.bind(client);
        prisma.$executeRaw = client.$executeRaw.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
        prisma.tenant = {
            findUnique: jest.fn(async () => ({
                id: tenantId, schemaName: schema, isActive: true, onboardingCompletedAt: new Date(),
                isInternal: false, subscriptionStatus: 'active', settings: {},
                subscription: { status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null },
            })),
            findMany: jest.fn(async () => [{ id: tenantId }]),
        };
        // What `accountFacts` reads: the time zone that dates the rate, the WABA
        // that pays, and the currency with its provenance. Without them the
        // authority reserves against an unknown price, which is a different
        // scenario from the two under test.
        prisma.channelAccount = {
            findFirst: jest.fn(async ({ where }: any) => (
                where?.accountId === phoneNumberId || where?.accountId === undefined
                    ? {
                        tenantId, wabaTimezone: 'America/Bogota', displayName: '+57 300 000 0000',
                        metadata: {
                            wabaId: 'waba-1', businessId: 'biz-1', billingMarket: 'CO',
                            billingCurrency: 'USD', billingCurrencySource: 'provider',
                            billingCurrencyConfirmedAt: new Date().toISOString(),
                        },
                    }
                    : null)),
        };

        // The two lazily-bootstrapped tables, applied here with their own
        // shipped DDL. The stores would create them on first use; doing it now
        // is what lets `beforeEach` truncate them, so one case never counts the
        // decisions of the one before it.
        for (const statement of [...TURN_LEDGER_DDL, ...DISPATCH_OUTBOX_DDL]) {
            await client.$executeRawUnsafe(`SET search_path TO "${schema}", public`);
            await client.$executeRawUnsafe(statement.replaceAll('{{SCHEMA_NAME}}', schema));
        }
        await client.$executeRawUnsafe('SET search_path TO public');

        await sql(`CREATE TABLE IF NOT EXISTS agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,
            channels TEXT[],channel_bindings TEXT[],schedule_mode TEXT,is_active BOOLEAN,
            is_default BOOLEAN,version INTEGER)`);
        await sql('CREATE TABLE IF NOT EXISTS customer_memory_erasure(contact_id UUID PRIMARY KEY)');
        await sql(`INSERT INTO agent_personas VALUES($1::uuid,'Alex','{"persona":{"name":"Alex"}}',
            ARRAY['whatsapp'],'{}'::text[],'24_7',true,true,1)`, [agentId]);
        const [agentRow] = await sql('SELECT * FROM agent_personas WHERE id=$1::uuid', [agentId]);
        const operationalHash = operationalConfigurationHash(agentRow);

        const config: any = { get: (key: string) => {
            if (key === 'redis.host') return '127.0.0.1';
            if (key === 'redis.port') return Number(valkeyUrl.port);
            // One logical Valkey database per Jest worker. `dispatch:rollout`
            // is a PLATFORM key with no tenant in its name, so two fixtures
            // writing distinct validation cohorts must not read one another's
            // cached evidence scope.
            if (key === 'redis.db') return workerValkeyDb();
            return undefined;
        }, getOrThrow: (key: string) => config.get(key) };

        redis = new RedisService(config);
        const connection = valkeyConnection(valkeyUrl);
        outboundQueue = new Queue(outboundQueueName, { connection });
        outboundQueue.on('error', () => undefined);

        const strictAdapter: any = {
            channelType: 'whatsapp',
            async sendStrict(request: StrictDispatchRequest): Promise<StrictDispatchOutcome> {
                // Counted when the call is MADE. "Did this leave the process?"
                // is the question these two scenarios are about, and counting on
                // the answer would make a hung provider invisible.
                posts.push({ kind: request.itemKind, body: bodyOf(request.payload) });
                return { kind: 'accepted', receipt: `wamid.OUT.${randomUUID()}` };
            },
            async sendTextMessage(_to: string, text: string) {
                posts.push({ kind: 'legacy_text', body: text });
                return `legacy.${randomUUID()}`;
            },
            async sendMediaMessage(_to: string, mediaUrl: string) {
                posts.push({ kind: 'legacy_media', body: mediaUrl });
                return `legacy.${randomUUID()}`;
            },
            async handleWebhook() { return null; },
            verifyWebhook() { return null; },
        };
        channelGateway = new ChannelGatewayService();
        channelGateway.registerAdapter(strictAdapter);

        const throttle: any = {
            getPriority: jest.fn(async () => 1),
            getMaxPendingJobs: jest.fn(async () => Infinity),
            isOverLimit: jest.fn(async () => false),
            recordUsage: jest.fn(async () => undefined),
            reserveActionUsage: jest.fn(async () => ({ allowed: true, count: 1, adopted: false })),
            commitActionUsage: jest.fn(async () => undefined),
            releaseActionUsage: jest.fn(async () => undefined),
            getAiMessageUsage: jest.fn(async () => ({ used: 0, limit: Infinity })),
            reserveAiMessageCount: jest.fn(async () => ({ allowed: true, count: 1, adopted: false })),
            commitAiMessageCount: jest.fn(async () => undefined),
            releaseAiMessageCount: jest.fn(async () => undefined),
        };
        const channelToken: any = resolvingChannelToken({
            getChannelToken: jest.fn(async () => ({ accessToken: 'synthetic-token' })),
        });

        outbox = new AgentDispatchOutboxStore(prisma, redis);
        turnLedger = new AgentTurnLedgerStore(prisma);
        rollout = new DispatchRolloutService(prisma, redis, channelGateway);
        admission = new WhatsappSendAdmissionService(prisma, new WhatsappSpendService(prisma), openPauseStore());
        const outboundProducer = new OutboundQueueService(outboundQueue as any, throttle, redis);
        const proactiveDispatch = new ProactiveDispatchService(prisma, outbox, outboundProducer);
        const outboundProcessor = new OutboundQueueProcessor(
            channelGateway, throttle, channelToken, redis,
            { send: jest.fn(async () => ({ sent: false, reason: 'monetization_disabled' })) } as any,
            prisma, admission, openPauseStore(), undefined, undefined, outbox);
        outboundProcessor.attachQueue(outboundProducer);

        procedureEngine = new ProcedureEngineService(prisma, redis, {} as any);

        conversations = Object.create(ConversationsService.prototype);
        Object.assign(conversations, {
            logger: new Logger('R5Stops'),
            prisma, redis,
            gateway: { emitToTenant: jest.fn(), emitNewMessage: jest.fn(), emitConversationUpdate: jest.fn() },
            channelGateway,
            outboundQueue: outboundProducer,
            channelToken,
            throttle,
            eventEmitter: new EventEmitter2(),
            dispatchOutbox: outbox,
            dispatchRollout: rollout,
            proactiveDispatch,
            turnLedger,
            procedureEngine,
            personaService: { resolvePersonaForChannel: jest.fn(async () => ({
                config: { language: 'es', persona: { name: 'Alex' }, hours: { aiOutsideHours: true } },
                agentId, version: 1, operationalHash,
            })) },
            llmRouter: { analyzeComplexity: () => 0.5, analyzeSentiment: () => 0.5 },
            handoffService: {
                shouldHandoff: jest.fn(() => null),
                // Deliberately false throughout: the point of the fourth turn of
                // the second scenario is the NOTICE budget, and a turn that never
                // runs cannot spend it. In production a transferred conversation
                // stops reaching the agent until `completeHandoff` returns it,
                // which is how a second stop in one episode is reached.
                isInHandoff: jest.fn(async () => false),
                executeHandoff: jest.fn(async (_t: string, _c: string, _m: any, reason: string) => {
                    handoffs.push({ reason });
                    await sql(`UPDATE conversations SET status='waiting_human', updated_at=NOW()`);
                    return {};
                }),
            },
            complianceService: { detectOptOut: jest.fn(() => false), processOptOut: jest.fn(async () => undefined) },
            analyticsService: { trackEvent: jest.fn(async () => undefined) },
            nurturingService: { cancelFollowUp: jest.fn(async () => undefined),
                scheduleFollowUp: jest.fn(async () => undefined) },
            dripSequenceService: { stopOnReply: jest.fn(async () => undefined) },
            identityService: { resolveOrCreateProfile: jest.fn(async () => undefined) },
            pipelineService: {
                resolveTenantStage: jest.fn(async (_t: string, stage?: string) => ({ slug: stage || 'nuevo' })),
                writeLeadStage: jest.fn(async () => undefined),
                syncOpportunityToDeal: jest.fn(async () => undefined),
                autoProgressFromConversation: jest.fn(async () => undefined),
            },
            leadScoring: { scoreAfterMessage: jest.fn(async () => undefined) },
            attributionService: { captureReferral: jest.fn(async () => undefined) },
            aiResolutionService: { ensureResolutionColumns: jest.fn(async () => undefined) },
            languageDetector: { detect: jest.fn(() => 'es') },
        });

        /**
         * THE MODEL SEAM. Returns the next scripted reply and leaves the
         * procedure state the engine would have left — written through the same
         * `conversations.metadata` shape `ProcedureEngineService.getState` reads,
         * so the datum identity the turn uses is read rather than assumed.
         */
        conversations.generateResponse = jest.fn(async (...args: any[]) => {
            const conversation = args[1];
            const step = script.shift();
            if (!step) throw new Error('r5_script_exhausted');
            await sql(
                `UPDATE conversations
                    SET metadata = jsonb_set(
                            jsonb_set(COALESCE(metadata,'{}'::jsonb), '{procedureStateManaged}', 'true'::jsonb),
                            '{procedureState}', $2::jsonb),
                        updated_at = NOW()
                  WHERE id = $1::uuid`,
                [String(conversation.id), JSON.stringify(step.awaiting
                    ? { procedureId: randomUUID(), awaitingField: step.awaiting, collected: {},
                        startedAt: new Date().toISOString(),
                        expiresAt: new Date(Date.now() + 3_600_000).toISOString() }
                    : { procedureId: randomUUID(), awaitingField: null, collected: {},
                        startedAt: new Date().toISOString(),
                        expiresAt: new Date(Date.now() + 3_600_000).toISOString() })]);
            return step.reply;
        });

        await client.$executeRawUnsafe(
            `INSERT INTO public.platform_settings(key,value,updated_at) VALUES($1,$2,NOW())
             ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
            'dispatch.normalOutbox',
            JSON.stringify({ enabled: true, tenantIds: [tenantId], channels: ['whatsapp'] }));
        await redis.del('dispatch:rollout');
        expect(await rollout.enabledFor(tenantId, 'whatsapp')).toBe(true);

        outboundWorker = new Worker(outboundQueueName,
            async (job, token) => outboundProcessor.process(job as any, token), {
                connection, concurrency: 1,
            });
        outboundWorker.on('error', () => undefined);
        outboundWorker.on('failed', () => undefined);
        await outboundWorker.waitUntilReady();
    }, 180_000);

    afterAll(async () => {
        await outboundWorker?.close(true).catch(() => undefined);
        await outboundQueue?.obliterate({ force: true }).catch(() => undefined);
        await outboundQueue?.close().catch(() => undefined);
        await redis?.del('dispatch:rollout').catch(() => undefined);
        await redis?.onModuleDestroy().catch(() => undefined);
        if (!client) return;
        try {
            if (!/^tenant_r5_stops_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',
                tenantId, schema);
        } finally { await client.$disconnect(); }
    }, 180_000);

    beforeEach(async () => {
        posts = [];
        handoffs = [];
        script = [];
        // A fresh conversation per case: the episode window is per conversation,
        // and two cases sharing one would count each other's decisions.
        await sql(`TRUNCATE agent_turn_ledger, agent_dispatch_outbox, messages, conversations, contacts CASCADE`);
        await sql(`TRUNCATE whatsapp_spend_allocations, whatsapp_spend_reservations, whatsapp_spend_counters`);
        // Redis is deliberately NOT swept: BullMQ's own keys live on the same
        // instance, and clearing them would empty the queue this suite measures.
        // Nothing carries over anyway — the turn markers and the debounce keys
        // are derived from a provider id that is fresh on every call, and the
        // procedure state lives in `conversations.metadata`, truncated above.
    });

    // ═════════════════════════════════════════════════════════════════════════
    // «Pregunta resuelta y cinco "gracias"» — sin cadena nueva de respuestas
    // ═════════════════════════════════════════════════════════════════════════
    describe('an answer, and then five thank-yous', () => {
        /** Five real Spanish closings, and no two of them alike. */
        const CLOSINGS = ['¡Con gusto!', '¡Un placer!', 'Gracias a ti.',
            'Estoy para servirte.', 'Que tengas un buen día.'];
        const ANSWER = 'El corte cuesta cuarenta mil pesos y mañana tengo cupo.';

        it('answers once, closes once, and lets four more thank-yous cost nothing', async () => {
            script = [{ reply: ANSWER }, ...CLOSINGS.map(reply => ({ reply }))];
            await customerSays('¿cuánto cuesta el corte?');
            for (const thanks of ['gracias', 'muchas gracias', 'mil gracias',
                'te agradezco', 'gracias de nuevo']) {
                await customerSays(thanks);
            }

            // MEASURED on this same harness before the change: six admissions,
            // six reservations, six POSTs. Five different courtesies are five
            // different digests, so the repetition guard the platform already
            // had could not see the chain at all. The two below are the point.
            expect(posts.map(post => post.body)).toEqual([ANSWER, '¡Con gusto!']);
            expect((await reservations()).length).toBe(2);
            // And the silence is durable rather than a log line: an operator can
            // see that four customer messages were deliberately not answered,
            // why, and when the answer could come out differently.
            const recorded = await outcomes();
            expect(recorded.map(row => `${row.kind}:${row.reason ?? '-'}`)).toEqual([
                'send:-',
                'send:courtesy_close',
                'wait:courtesy_chain_closed',
                'wait:courtesy_chain_closed',
                'wait:courtesy_chain_closed',
                'wait:courtesy_chain_closed',
            ]);
            // A deadline already in the past teaches an operator to ignore the
            // field; one a full episode past a goodbye said seconds ago would
            // hold the silence open longer than the episode it belongs to.
            for (const row of recorded.filter(entry => entry.kind === 'wait')) {
                const resume = Date.parse(String(row.resumeAfter));
                expect(resume).toBeGreaterThan(Date.now());
                expect(resume).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
            }
            // Nothing was committed for the silent turns either — two effects,
            // two rows — and nobody was pulled in: a chain of goodbyes is not a
            // problem a person needs to take over.
            expect((await sql('SELECT id FROM agent_dispatch_outbox')).length).toBe(2);
            expect(handoffs).toEqual([]);
        });

        it('still answers a real question asked in the middle of the thank-yous', async () => {
            // The failure that would matter more than the saving: a policy that
            // saves money by not answering people. The goodbye budget is spent,
            // and the very next real question is answered all the same.
            script = [
                { reply: 'Listo, te agendé para mañana.' },
                { reply: '¡Con gusto!' },
                { reply: 'Gracias a ti.' },
                { reply: 'Abrimos de lunes a sábado.' },
            ];
            await customerSays('quiero agendar');
            await customerSays('gracias');
            await customerSays('muchas gracias');
            await customerSays('¿qué días abren?');

            expect(posts.map(post => post.body)).toEqual([
                'Listo, te agendé para mañana.',
                '¡Con gusto!',
                'Abrimos de lunes a sábado.',
            ]);
            expect((await outcomes()).map(row => `${row.kind}:${row.reason ?? '-'}`)).toEqual([
                'send:-', 'send:courtesy_close', 'wait:courtesy_chain_closed', 'send:-',
            ]);
        });
    });

    // ═════════════════════════════════════════════════════════════════════════
    // «Misma pregunta requerida sin progreso» — reformulación limitada y vía
    // alternativa, sin loop
    // ═════════════════════════════════════════════════════════════════════════
    describe('one datum the customer never supplies', () => {
        const ASK = '¿Me compartís tu número de cédula para continuar?';
        const REPHRASED = '¿Cuál es tu número de documento?';
        const AGAIN = 'Para seguir necesito el documento, ¿me lo pasás?';
        /** The deterministic handover sentence, straight out of the catalog. */
        const NOTICE = 'Te voy a transferir con un agente de nuestro equipo.';
        /** What `datumAskKey('cedula')` is. The token, never the field name. */
        const CEDULA = 'send:awaiting_same_datum:cb5984b1';

        /**
         * The scenario's own word is *reformulación*, so the second attempt
         * is a DIFFERENT sentence about the same datum.
         *
         * It used to be the identical string, and that made these cases
         * depend on a defect: the durable lane passed `String(dispatchId)`
         * as the content digest, so the repeat guard could not see a
         * verbatim repeat and delivered it. With the digest fixed, an
         * identical second ask is refused by the money authority — which is
         * correct, and is NOT what these two cases are about. They are about
         * the counter that stops a rephrased loop, which no digest can see.
         * The verbatim repeat has its own case below.
         */
        const stalledScript = () => [
            { reply: ASK, awaiting: 'cedula' },
            { reply: REPHRASED, awaiting: 'cedula' },
            { reply: AGAIN, awaiting: 'cedula' },
            { reply: AGAIN, awaiting: 'cedula' },
        ];

        it('asks twice, then hands the conversation over instead of asking a third time', async () => {
            script = stalledScript();
            await customerSays('quiero agendar');
            await customerSays('no entiendo');
            await customerSays('¿para qué?');

            // MEASURED here before the change: four asks, four POSTs, four
            // reservations, no route and no end. Now: the question, ONE more
            // attempt at the same datum, and then the other way — not a third
            // ask, and not silence either.
            expect(posts.map(post => post.body)).toEqual([ASK, REPHRASED, NOTICE]);
            expect((await reservations()).length).toBe(3);
            expect((await outcomes()).map(row => `${row.kind}:${row.reason ?? '-'}`)).toEqual([
                CEDULA, CEDULA, 'escalate:stalled_ask_route',
            ]);
            // The route is a route, not a sentence about one: a person owns the
            // conversation, recorded under the reason that caused it.
            expect(handoffs).toEqual([{ reason: 'stalled_ask_route' }]);
            expect(await conversationStatus()).toBe('waiting_human');
            // And the words the customer reads are the server's, from the closed
            // handoff catalog. The model never writes this sentence.
            expect(posts[2].body).toBe(NOTICE);
            expect(posts[2].body).not.toBe(AGAIN);

            // ── AND THE FOURTH MESSAGE REACHES NOBODY BUT THE PERSON ────────
            //
            // A conversation a human owns does not run a turn at all, so the
            // loop is over for real rather than over by policy.
            await customerSays('no sé');
            expect(posts).toHaveLength(3);
            expect(await outcomes()).toHaveLength(3);
        });

        it('does not announce the handover twice when the agent gets the thread back', async () => {
            // Where the once-per-episode budget is actually reachable: a person
            // finishes and `completeHandoff` returns the thread to the agent,
            // inside the same half-hour. Stalling again on the same datum must
            // not buy a second announcement — that is the loop with a different
            // sentence in it — so the turn goes quiet, durably, and costs nothing.
            script = [...stalledScript(), { reply: AGAIN, awaiting: 'cedula' }];
            await customerSays('quiero agendar');
            await customerSays('no entiendo');
            await customerSays('¿para qué?');
            expect(posts.map(post => post.body)).toEqual([ASK, REPHRASED, NOTICE]);

            // Exactly what `completeHandoff` does to the row that matters here.
            await sql(`UPDATE conversations SET status='active', assigned_to=NULL, updated_at=NOW()`);
            await customerSays('sigo sin entender');

            expect(posts.map(post => post.body)).toEqual([ASK, REPHRASED, NOTICE]);
            const recorded = await outcomes();
            expect(recorded.map(row => `${row.kind}:${row.reason ?? '-'}`)).toEqual([
                CEDULA, CEDULA, 'escalate:stalled_ask_route', 'wait:ask_without_progress',
            ]);
            // One transfer, one announcement, and a deadline on the silence.
            expect(handoffs).toHaveLength(1);
            const resume = Date.parse(String(recorded[3].resumeAfter));
            expect(resume).toBeGreaterThan(Date.now());
            expect(resume).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
        });

        it('keeps durable delivery when the validation cohort is inactive', async () => {
            // `dispatch.normalOutbox` retains its old name for release-tooling
            // compatibility, but no longer selects a delivery lane. Removing
            // it must change only the cohort being validated: the same turn,
            // outbox ownership and recovery guarantees remain in force.
            await client.$executeRawUnsafe('DELETE FROM public.platform_settings WHERE key=$1',
                'dispatch.normalOutbox');
            await redis.del('dispatch:rollout');
            expect(await rollout.enabledFor(tenantId, 'whatsapp')).toBe(false);
            try {
                script = stalledScript();
                await customerSays('quiero agendar');
                await customerSays('no entiendo');
                await customerSays('¿para qué?');

                // Two attempts and then the same deterministic human route.
                expect(posts.map(post => post.body)).toEqual([ASK, REPHRASED, NOTICE]);
                expect((await outcomes()).map(row => `${row.kind}:${row.reason ?? '-'}`)).toEqual([
                    CEDULA, CEDULA, 'escalate:stalled_ask_route',
                ]);
                expect(handoffs).toEqual([{ reason: 'stalled_ask_route' }]);
                // Every provider effect still has durable ownership even while
                // the release-validation cohort is inactive.
                expect((await sql('SELECT id FROM agent_dispatch_outbox')).length).toBe(3);
            } finally {
                await client.$executeRawUnsafe(
                    `INSERT INTO public.platform_settings(key,value,updated_at) VALUES($1,$2,NOW())
                     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
                    'dispatch.normalOutbox',
                    JSON.stringify({ enabled: true, tenantIds: [tenantId], channels: ['whatsapp'] }));
                await redis.del('dispatch:rollout');
            }
        });

        it('refuses a verbatim second ask and still offers the person', async () => {
            // THE TWO GUARDS TOGETHER. A model that repeats itself word for
            // word hits the money authority first: the duplicate is refused
            // and costs nothing. What must NOT happen is the refusal
            // swallowing the escalation — a silent second turn that never
            // reaches the counter would leave the customer with one
            // unanswered question and no way out.
            //
            // This is also the case that used to be written into
            // `stalledScript`, where it measured the durable lane's ABSENT
            // digest guard rather than this composition.
            script = [
                { reply: ASK, awaiting: 'cedula' },
                { reply: ASK, awaiting: 'cedula' },
                { reply: AGAIN, awaiting: 'cedula' },
            ];
            await customerSays('quiero agendar');
            await customerSays('no entiendo');
            await customerSays('¿para qué?');

            expect(posts.map(post => post.body)).toEqual([ASK, NOTICE]);
            expect((await sql(`SELECT state, error_code FROM agent_dispatch_outbox
                                ORDER BY created_at`))
                .map(row => `${row.state}:${row.error_code ?? '-'}`))
                .toEqual(['sent:-', 'suppressed:spend_duplicate_recent_send', 'sent:-']);
            // Both turns still DECIDED to ask, which is what the counter
            // reads, so the third one routes exactly as it does when the
            // second attempt is rephrased and delivered.
            expect((await outcomes()).map(row => `${row.kind}:${row.reason ?? '-'}`)).toEqual([
                CEDULA, CEDULA, 'escalate:stalled_ask_route',
            ]);
            expect(handoffs).toEqual([{ reason: 'stalled_ask_route' }]);
            expect(await conversationStatus()).toBe('waiting_human');
        });

        it('never stops an intake that collects a different datum every turn', async () => {
            // The false positive that would cost more than the loop: a form with
            // four fields is four turns in a row whose only output was a
            // question. It is counted per DATUM, so each of these is the first
            // turn awaiting its own, and the fourth is answered like the first.
            script = [
                { reply: '¿Qué servicio querés?', awaiting: 'servicio' },
                { reply: '¿Para qué día?', awaiting: 'fecha' },
                { reply: '¿A qué hora?', awaiting: 'hora' },
                { reply: '¿A nombre de quién?', awaiting: 'nombre' },
            ];
            await customerSays('quiero agendar');
            await customerSays('corte');
            await customerSays('mañana');
            await customerSays('a las tres');

            expect(posts).toHaveLength(4);
            const recorded = await outcomes();
            expect(recorded.map(row => row.kind)).toEqual(['send', 'send', 'send', 'send']);
            // Four distinct tokens. The identity of the datum is what keeps a
            // long task apart from a loop, so that is the property asserted
            // rather than the particular hashes.
            expect(new Set(recorded.map(row => row.reason)).size).toBe(4);
            expect(handoffs).toEqual([]);
            expect(await conversationStatus()).toBe('active');
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // The repeat guard, on the lane the pilot moves everyone to
    // ══════════════════════════════════════════════════════════════════════════

    describe('the same answer, to the same person, twice', () => {
        /**
         * NOT one of the four R5 scenarios — found while measuring them, and
         * it lives here because this is the only harness with both lanes and
         * the real ledger behind them.
         *
         * The legacy case above notes in passing that "the spend gate digests
         * the body, so the second identical ask IS refused". On the durable
         * lane it was not, and could not be: `contentDigest` travelled as
         * `String(dispatchId)`, unique per row, so
         * `recentIdenticalDeliveries` matched nothing and `judgeRepetition`
         * never ran. MEASURED on this harness before the change: two POSTs
         * and two reservations for one sentence sent twice, where the legacy
         * lane took one of each.
         *
         * Neither turn is stopped upstream: two different questions, no
         * goodbye, no datum awaited. The turn decides to answer both times
         * and is right to — what must not happen is PAYING twice to say the
         * same thing to the same person inside the window.
         */
        const SAME = 'Abrimos de lunes a sábado, de 9 a 6.';

        /** Outbox rows with the reason each one ended the way it did. */
        const dispatched = async (): Promise<string[]> =>
            (await sql(`SELECT state, error_code FROM agent_dispatch_outbox
                         ORDER BY created_at`))
                .map(row => `${row.state}:${row.error_code ?? '-'}`);

        it('pays once and refuses the second identical reply', async () => {
            script = [{ reply: SAME }, { reply: SAME }];
            await customerSays('¿qué horario tienen?');
            await customerSays('¿a qué hora abren?');

            expect(posts.map(post => post.body)).toEqual([SAME]);
            expect(await dispatched()).toEqual([
                'sent:-', 'suppressed:spend_duplicate_recent_send',
            ]);
            // The refusal is BEFORE the reservation, so the second one costs
            // nothing at all — the point of the guard is not to record a
            // cheaper duplicate, it is to spend nothing.
            expect((await reservations()).length).toBe(1);
            // And the turn is not the thing that stopped: both turns decided
            // to answer, which is correct, and the money authority is where
            // the duplicate died. An operator reading the ledger sees a
            // committed intent and a suppressed effect, not a silent turn.
            expect((await outcomes()).map(row => `${row.kind}:${row.reason ?? '-'}`))
                .toEqual(['send:-', 'send:-']);
        });

        it('sends it again once the window has passed', async () => {
            // A cooldown, not a block. A customer may genuinely ask the same
            // question tomorrow, and a guard that never reopened would be a
            // platform that stops answering a returning customer.
            script = [{ reply: SAME }, { reply: SAME }];
            await customerSays('¿qué horario tienen?');
            // Both bounds are measured from the most recent identical
            // delivery, and both are ten minutes, so the row is aged past the
            // pair rather than past one of them.
            await sql(`UPDATE whatsapp_spend_reservations
                          SET created_at = created_at - interval '25 minutes'`);
            await customerSays('¿a qué hora abren?');

            expect(posts.map(post => post.body)).toEqual([SAME, SAME]);
            expect(await dispatched()).toEqual(['sent:-', 'sent:-']);
            expect((await reservations()).length).toBe(2);
        });

        it('does not confuse two different people saying the same thing', async () => {
            // The digest is compared per recipient. One answer sent to two
            // customers is two effects, and a guard keyed on content alone
            // would silence the second person entirely.
            script = [{ reply: SAME }];
            await customerSays('¿qué horario tienen?');
            expect(posts.map(post => post.body)).toEqual([SAME]);

            const other = `${customerPhone}7`;
            script = [{ reply: SAME }];
            await customerSays('¿qué horario tienen?', other);
            expect(posts.map(post => post.body)).toEqual([SAME, SAME]);
            expect(await dispatched()).toEqual(['sent:-', 'sent:-']);
        });
    });

    it('reads its own recent decisions back through the driver production uses', async () => {
        // The window every counter above depends on. It was dead: the `since`
        // bound travelled as a bare string, `timestamptz >= text` has no
        // operator under the Prisma driver, and the store swallowed the 42883
        // into an empty list — so every count was zero and no turn ever waited.
        // Nothing else in this file would fail loudly for that alone (a zero
        // count simply means "speak"), so it is pinned on its own.
        script = [{ reply: 'Listo, te agendé para mañana.' }];
        await customerSays('quiero agendar');
        const conversationId = String((await sql('SELECT id FROM conversations LIMIT 1'))[0].id);
        const window = await turnLedger.recentOutcomes(
            schema, conversationId, new Date(Date.now() - 30 * 60 * 1000));
        expect(window.length).toBe(1);
        expect(window[0].outcome.kind).toBe('send');
        // And it names the inbound, which is what lets a counter leave out the
        // turn's OWN earlier attempt after a crash instead of counting itself.
        const [row] = await sql('SELECT inbound_message_id FROM agent_turn_ledger');
        expect(window[0].inboundMessageId).toBe(String(row.inbound_message_id));
    });
});
