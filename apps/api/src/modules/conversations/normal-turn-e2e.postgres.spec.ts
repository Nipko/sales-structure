import { randomUUID, createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createServer } from 'http';
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { Server as SocketServer } from 'socket.io';
import { io as socketClient, type Socket as ClientSocket } from 'socket.io-client';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WsRelayService } from '../redis/ws-relay.service';
import { ConversationsService } from './conversations.service';
import { ConversationsGateway } from './conversations.gateway';
import { AgentTurnLedgerStore } from './agent-turn-ledger.store';
import { InboundQueueService } from '../inbound/inbound-queue.service';
import { InboundQueueProcessor } from '../inbound/inbound-queue.processor';
import { INBOUND_QUEUE } from '../inbound/inbound-queue.constants';
import { ChannelsController } from '../channels/channels.controller';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
import { WhatsappWebhookService } from '../whatsapp/services/whatsapp-webhook.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { OutboundQueueProcessor, OUTBOUND_QUEUE } from '../channels/outbound-queue.processor';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { DispatchRolloutService } from '../channels/dispatch-rollout.service';
import { DispatchRecoveryService } from '../channels/dispatch-recovery.service';
import { redactDispatchOutbox } from '../channels/agent-dispatch-outbox';
import { redactTurnLedger } from './agent-turn-ledger';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import type { StrictDispatchOutcome, StrictDispatchRequest } from '../channels/strict-dispatch-transport';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const redisUrl = process.env.DISPATCH_QUEUE_TEST_REDIS_URL;
const ready = !!databaseUrl && !!redisUrl;

/**
 * ONE customer message, end to end, through the machinery that actually ships.
 *
 * The pieces of the normal turn were each proven on their own — the outbox
 * against real BullMQ and PostgreSQL, the widget against Socket.IO, the inbound
 * frontier against its validators — and never together. A seam only two suites
 * touch is a seam nobody tests: the fixtures on either side agree with each
 * other and not with production. This drives the real controller, the real
 * queues, the real turn, the real outbox, the real status writer and a real
 * browser socket, over disposable PostgreSQL and Valkey, and asserts on what
 * the customer would actually have received.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL
 * ─────────────────────────────────────────────────────────────────────────────
 *  · PostgreSQL 55437, one disposable schema built from `prisma/tenant-schema.sql`
 *    (the shipped DDL, including the partial unique index on `messages.external_id`),
 *    plus `DISPATCH_OUTBOX_DDL` and `TURN_LEDGER_DDL` bootstrapped by the stores.
 *  · `PrismaService`'s own `executeInTenantSchema` / `transactionInTenantSchema`
 *    over a real `PrismaClient` — so every statement really runs inside its own
 *    transaction with `SET LOCAL search_path`.
 *  · Valkey 55440 behind the real `RedisService` (conversation mutex, burst
 *    debounce, idempotency claims, turn markers) and the real `WsRelayService`.
 *  · Real BullMQ `Queue` + `Worker` for BOTH queues, uniquely named per run.
 *  · `ChannelsController.receiveWhatsApp` with a genuine `x-hub-signature-256`,
 *    `WhatsappWebhookService.handleWebhookPayload`, `InboundQueueService`,
 *    `InboundQueueProcessor`.
 *  · `ConversationsService.processIncomingMessage` → `runTurn`: burst debounce,
 *    contact/lead/opportunity/conversation resolution, `saveMessage` and its
 *    dedupe index, the turn ledger, `dispatchReplyThroughOutbox`, the legacy
 *    fallback, and the completion markers.
 *  · `AgentTurnLedgerStore`, `AgentDispatchOutboxStore`, `DispatchRolloutService`
 *    (its real `platform_settings` row), `DispatchRecoveryService`,
 *    `OutboundQueueService`, `OutboundQueueProcessor`, `ChannelGatewayService`.
 *  · `recordChannelDeliveryStatuses` → `applyDispatchProviderStatus`: the ONE
 *    shared writer both status ingresses use.
 *  · A real Socket.IO server, a real `socket.io-client`, and two
 *    `ConversationsGateway` instances wired the way production wires them — the
 *    worker's has no `server` and publishes over the Redis relay; the API's owns
 *    the namespace and re-emits. The browser leg is not simulated.
 *  · The erasure primitives `redactDispatchOutbox` and `redactTurnLedger`, and
 *    the same `messages` redaction statement `ComplianceService` runs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS FAKED, AND WHY IT HAS TO BE
 * ─────────────────────────────────────────────────────────────────────────────
 *  · The model and the tool executor, at the `generateResponse` seam. There are
 *    no provider keys here and a real model is not deterministic. The double
 *    fills `turnEffects` exactly as the real one does — a canonical payment link
 *    from a receipt, one attachment with its caption, writer records — so
 *    everything downstream of the seam is the shipped code path.
 *  · The provider transport (`sendStrict`) and the loose adapter
 *    (`sendTextMessage` / `sendMediaMessage`). No WhatsApp credentials exist,
 *    and the task of this harness is precisely to drive accepted / rejected /
 *    unknown on demand. Every remote effect is counted here.
 *  · Collaborators with no bearing on the spine: analytics, nurturing, drip,
 *    lead scoring, identity, attribution, opt-out detection, throttling, persona
 *    resolution, handoff triggers, pipeline stages.
 *  · The global Prisma models (`tenant`, `channelAccount`) — the disposable
 *    database has synthetic global tables, not the generated schema.
 *
 * Nothing else is stubbed. In particular the outbox, the ledger, the queues,
 * the status writer and the socket are the production objects.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PGBOUNCER LEG — AN EXPLICIT GAP, NOT A SILENT OMISSION
 * ─────────────────────────────────────────────────────────────────────────────
 * There is no PgBouncer image on this machine and pulling one is out of scope,
 * so the proxy itself is NOT in this run. What PgBouncer constrains, and what is
 * reproducible without it, is asserted directly in
 * `transaction-scoped pooling semantics`:
 *
 *   STANDS IN FOR THE PROXY
 *     · no session state is assumed across statements — the tenant `search_path`
 *       is set with `SET LOCAL` and demonstrably does not survive its transaction;
 *     · no multi-statement string can travel this path — the same primitive the
 *       turn uses refuses one;
 *     · nothing on the path leaves a session-scoped advisory lock behind, which
 *       is what would deadlock on a connection handed to the next client;
 *     · no connection is assumed to survive between calls — two successive calls
 *       are observed on different backends and the path still holds.
 *
 *   DOES **NOT** STAND IN FOR THE PROXY
 *     · Prisma's named prepared statements under transaction pooling (the
 *       `pgbouncer=true` connection-string contract) — the one failure mode that
 *       genuinely needs the proxy in front;
 *     · `server_reset_query` behaviour, pool exhaustion, queueing latency and
 *       `max_client_conn` back-pressure;
 *     · the `DIRECT_DATABASE_URL` split used by migrations.
 *
 * Running the real leg needs: a `pgbouncer` image (e.g. `edoburu/pgbouncer`) or
 * the package installed in the eval container, a `pgbouncer.ini` in transaction
 * mode pointing at 55437 with a `userlist.txt`, a published port (e.g. 55438),
 * and this suite re-pointed at
 * `postgresql://postgres:…@127.0.0.1:55438/parallly_eval_isolation?pgbouncer=true`
 * while DDL keeps using the direct 55437 URL.
 */
(ready ? describe : describe.skip)('the normal turn, end to end, through the real machinery', () => {
    jest.setTimeout(240_000);

    const tenantId = randomUUID();
    const schema = `tenant_normal_turn_${randomUUID().replace(/-/g, '')}`;
    const agentId = randomUUID();
    const phoneNumberId = `pnid-${randomUUID().slice(0, 8)}`;
    const customerPhone = '573001112233';
    const appSecret = 'synthetic-meta-app-secret';
    const jwtSecret = 'synthetic-inbox-jwt-secret';
    const inboundQueueName = `${INBOUND_QUEUE}-e2e-${randomUUID().slice(0, 8)}`;
    const outboundQueueName = `${OUTBOUND_QUEUE}-e2e-${randomUUID().slice(0, 8)}`;

    /** The three effects one turn produces, kept as markers we can count. */
    const REPLY_TEXT = 'Confirmado: tu cita queda agendada para el martes.';
    const PAYMENT_LINK = 'https://pay.example.test/canonical-receipt';
    const MEDIA_URL = 'https://cdn.example.test/comprobante.jpg';
    const MEDIA_CAPTION = 'Tu comprobante';

    let client: PrismaClient;
    let prisma: any;
    let redis: RedisService;
    let wsRelay: WsRelayService;
    let inboundQueue: Queue;
    let outboundQueue: Queue;
    let inboundWorker: Worker | undefined;
    let outboundWorker: Worker | undefined;
    let conversations: any;
    let controller: ChannelsController;
    let webhookService: WhatsappWebhookService;
    let inboundProducer: InboundQueueService;
    let inboundProcessor: InboundQueueProcessor;
    let outboundProducer: OutboundQueueService;
    let outboundProcessor: OutboundQueueProcessor;
    let outbox: AgentDispatchOutboxStore;
    let turnLedger: AgentTurnLedgerStore;
    let rollout: DispatchRolloutService;
    let recovery: DispatchRecoveryService;
    let channelGateway: ChannelGatewayService;
    let httpServer: ReturnType<typeof createServer>;
    let socketServer: SocketServer;
    let browser: ClientSocket | undefined;
    /** Everything the browser socket received on `/inbox`, in arrival order. */
    let inboxEvents: { event: string; payload: any }[] = [];

    /** Every remote effect any transport performed, in the order performed. */
    let remoteEffects: { via: 'strict' | 'loose'; kind: string; body: string; receipt?: string }[] = [];
    /** What the strict transport should answer next, per body. */
    let strictOutcome: (request: StrictDispatchRequest) => Promise<StrictDispatchOutcome>;
    /** Armed crash boundary; consumed by the first wrapper that matches. */
    let crashAt: string | null = null;
    /** Ordering trace for the "enqueued before the 200" proof. */
    let ackTrace: string[] = [];

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    const bodyOf = (payload: any): string =>
        String(payload?.text ?? payload?.mediaUrl ?? payload?.content?.text ?? '');

    /** Wait on a durable condition, never on the clock. */
    async function until(what: string, condition: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            if (await condition()) return;
            if (Date.now() > deadline) throw new Error(`timed_out_waiting_for: ${what}`);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }

    const queueIdle = async (queue: Queue): Promise<boolean> => {
        const counts = await queue.getJobCounts('active', 'waiting', 'prioritized', 'delayed');
        return !counts.active && !counts.waiting && !counts.prioritized && !counts.delayed;
    };

    const settleQueues = () => until('both queues idle',
        async () => (await queueIdle(inboundQueue)) && (await queueIdle(outboundQueue)));

    // ── the provider's webhook bodies ────────────────────────────────────────
    const messageBody = (wamid: string, text: string, from: string = customerPhone) => ({
        object: 'whatsapp_business_account',
        entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: {
            metadata: { phone_number_id: phoneNumberId },
            contacts: [{ wa_id: from, profile: { name: 'Cliente Sintético' } }],
            messages: [{ id: wamid, from, type: 'text', text: { body: text } }],
        } }] }],
    });

    const statusBody = (receipt: string, status: string, errorCode?: number) => ({
        object: 'whatsapp_business_account',
        entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: {
            metadata: { phone_number_id: phoneNumberId },
            statuses: [{
                id: receipt, status, recipient_id: customerPhone,
                timestamp: String(Math.floor(Date.now() / 1000)),
                ...(errorCode ? { errors: [{ code: errorCode, title: 'Rechazado' }] } : {}),
            }],
        } }] }],
    });

    /** POST through the real controller, with a real Meta signature. */
    async function postWebhook(body: any): Promise<{ status: number; sent: any }> {
        const raw = Buffer.from(JSON.stringify(body));
        const signature = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
        let status = 0, sent: any = null;
        const res: any = {
            status(code: number) { status = code; ackTrace.push(`ack:${code}`); return res; },
            send(payload: any) { sent = payload; return res; },
        };
        await controller.receiveWhatsApp(body, signature, { rawBody: raw } as any, res);
        return { status, sent };
    }

    // ── state readers ────────────────────────────────────────────────────────
    const ledgerRow = async (inboundMessageId: string) =>
        (await sql('SELECT * FROM agent_turn_ledger WHERE inbound_message_id=$1::uuid', [inboundMessageId]))[0];

    const inboundMessageIdFor = async (wamid: string): Promise<string> =>
        String((await sql('SELECT id FROM messages WHERE external_id=$1', [wamid]))[0].id);

    const outboxRows = async (inboundMessageId: string) =>
        sql(`SELECT id,item_index,item_kind,state,receipt,payload,message_id,redacted_at,error_code
               FROM agent_dispatch_outbox WHERE inbound_message_id=$1::uuid ORDER BY item_index`,
        [inboundMessageId]);

    const historyRows = async () =>
        sql(`SELECT id,direction,content_type,content_text,media_url,status,external_id
               FROM messages ORDER BY created_at, external_id`);

    beforeAll(async () => {
        const dbUrl = new URL(databaseUrl!), valkeyUrl = new URL(redisUrl!);
        if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname) || !dbUrl.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        if (!['localhost', '127.0.0.1'].includes(valkeyUrl.hostname))
            throw new Error('disposable_loopback_redis_required');

        client = new PrismaClient({ datasourceUrl: databaseUrl });
        // The shipped tenant DDL defaults its ids with `uuid_generate_v4()`, so
        // the extension has to exist before any of that DDL is applied. Every
        // other PostgreSQL suite on this disposable instance opens the same way.
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await ensureSyntheticGlobalTables(statement => client.$executeRawUnsafe(statement));
        // The rollout switch lives in a real row, so `enabledFor` is the shipped
        // read and not a stub. Scoped to this tenant so a neighbouring suite on
        // the same disposable database is never switched on by it.
        await client.$executeRawUnsafe(
            `CREATE TABLE IF NOT EXISTS public.platform_settings(
                key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active,settings) VALUES($1::uuid,$2,true,\'{}\'::jsonb)',
            tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

        // The shipped tenant DDL, not a hand-written approximation: contacts,
        // conversations, messages (with the partial unique index the inbound
        // dedupe depends on), leads and opportunities with their real FKs.
        const template = readFileSync(join(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const slice = template.slice(
            template.indexOf('-- ---- Contacts ----'),
            template.indexOf('-- ---- Consent Records ----'));
        for (const statement of (PrismaService.prototype as any).splitSqlStatements(
            slice.replace(/\{\{SCHEMA_NAME\}\}/g, schema))) {
            await client.$executeRawUnsafe(statement);
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
        prisma.channelAccount = {
            findFirst: jest.fn(async ({ where }: any) =>
                where?.accountId === phoneNumberId ? { tenantId } : null),
        };

        // `persona_config` already comes from the template slice above; the
        // multi-agent tables are created lazily in production, so they are added
        // here in the shape `readServingPersona` and the admission guard read.
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
            if (key === 'auth.jwtSecret') return jwtSecret;
            if (key === 'META_APP_SECRET') return appSecret;
            return undefined;
        }, getOrThrow: (key: string) => config.get(key) };

        redis = new RedisService(config);
        wsRelay = new WsRelayService(redis);

        const connection = { host: '127.0.0.1', port: Number(valkeyUrl.port), maxRetriesPerRequest: null };
        inboundQueue = new Queue(inboundQueueName, { connection });
        outboundQueue = new Queue(outboundQueueName, { connection });
        inboundQueue.on('error', () => undefined);
        outboundQueue.on('error', () => undefined);

        // ── the faked seams ──────────────────────────────────────────────────
        // One remote effect per call, and the caller decides what came back.
        const strictAdapter: any = {
            channelType: 'whatsapp',
            async sendStrict(request: StrictDispatchRequest): Promise<StrictDispatchOutcome> {
                // Recorded when the call is MADE, not when it comes back. A
                // provider that never answers is the case the outbox exists for,
                // and counting on the answer made that call invisible — the one
                // effect that most needs counting, because "did this leave the
                // process?" is the whole question a reconciliation asks.
                const effect: { via: 'strict'; kind: string; body: string; receipt?: string } =
                    { via: 'strict', kind: request.itemKind, body: bodyOf(request.payload) };
                remoteEffects.push(effect);
                const outcome = await strictOutcome(request);
                if (outcome.kind === 'accepted') effect.receipt = outcome.receipt;
                return outcome;
            },
            // The loose gateway the LEGACY producer uses. Counted the same way,
            // so a second copy of one answer is visible no matter which route
            // delivered it.
            async sendTextMessage(_to: string, text: string) {
                remoteEffects.push({ via: 'loose', kind: 'text', body: text });
                return `legacy.${randomUUID()}`;
            },
            async sendMediaMessage(_to: string, mediaUrl: string) {
                remoteEffects.push({ via: 'loose', kind: 'media', body: mediaUrl });
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
            hasAiMessageQuota: jest.fn(async () => true),
            incrementAiMessageCount: jest.fn(async () => undefined),
        };
        const channelToken: any = { getChannelToken: jest.fn(async () => ({ accessToken: 'synthetic-token' })) };

        outbox = new AgentDispatchOutboxStore(prisma, redis);
        turnLedger = new AgentTurnLedgerStore(prisma);
        rollout = new DispatchRolloutService(prisma, redis, channelGateway);
        outboundProducer = new OutboundQueueService(outboundQueue as any, throttle, redis);
        outboundProcessor = new OutboundQueueProcessor(
            channelGateway, throttle, channelToken, redis,
            { send: jest.fn(async () => ({ sent: false, reason: 'monetization_disabled' })) } as any,
            prisma, undefined, undefined, outbox);
        outboundProcessor.attachQueue(outboundProducer);
        recovery = new DispatchRecoveryService(prisma, outbox, outboundProducer,
            { runExclusive: jest.fn() } as any);

        // ── the two gateways, wired as production wires them ─────────────────
        const jwt = new JwtService({ secret: jwtSecret });
        // The worker's gateway owns no server: every emit goes over the Redis relay.
        const workerGateway = new ConversationsGateway(jwt, config, wsRelay, prisma, redis);
        // The API's gateway owns the namespace and re-emits what the relay carries.
        httpServer = createServer();
        socketServer = new SocketServer(httpServer);
        const namespace = socketServer.of('/inbox');
        const apiGateway = new ConversationsGateway(jwt, config, wsRelay, prisma, redis);
        (apiGateway as any).server = namespace;
        namespace.on('connection', client_ => {
            client_.on('disconnect', () => apiGateway.handleDisconnect(client_ as any));
            void apiGateway.handleConnection(client_ as any);
        });
        apiGateway.afterInit();
        await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', () => resolve()));

        // ── the turn ─────────────────────────────────────────────────────────
        conversations = Object.create(ConversationsService.prototype);
        Object.assign(conversations, {
            logger: new Logger('E2ETurn'),
            prisma, redis,
            gateway: workerGateway,
            channelGateway,
            outboundQueue: outboundProducer,
            channelToken,
            throttle,
            eventEmitter: new EventEmitter2(),
            dispatchOutbox: outbox,
            dispatchRollout: rollout,
            turnLedger,
            personaService: { resolvePersonaForChannel: jest.fn(async () => ({
                config: { language: 'es', persona: { name: 'Alex' }, hours: { aiOutsideHours: true } },
                agentId, version: 1, operationalHash,
            })) },
            llmRouter: { analyzeComplexity: () => 0.5, analyzeSentiment: () => 0.5 },
            handoffService: { shouldHandoff: jest.fn(() => null), isInHandoff: jest.fn(async () => false),
                executeHandoff: jest.fn(async () => ({})) },
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
        // THE FAKED SEAM. The model and the tool executor. It fills `turnEffects`
        // the way the real turn does — canonical link, attachment with caption,
        // and the writers that produced them — so nothing downstream is faked.
        conversations.generateResponse = jest.fn(async (...args: any[]) => {
            const effects = args[14];
            effects.paymentLinks.push(PAYMENT_LINK);
            effects.media.push({ url: MEDIA_URL, caption: MEDIA_CAPTION });
            effects.writers.push({ tool: 'create_payment_link', status: 'succeeded',
                ledgerId: randomUUID(), receipt: PAYMENT_LINK });
            return REPLY_TEXT;
        });

        inboundProducer = new InboundQueueService(inboundQueue as any, throttle);
        inboundProcessor = new InboundQueueProcessor(conversations);
        webhookService = new WhatsappWebhookService(
            config, prisma, inboundProducer,
            { detectOptOut: jest.fn(() => false), processOptOut: jest.fn(async () => undefined) } as any,
            { getValidAccessToken: jest.fn(async () => ({ accessToken: 'synthetic-token' })) } as any,
            { markAsRead: jest.fn(async () => undefined) } as any,
            redis);
        controller = new ChannelsController(
            channelGateway, {} as any, {} as any, {} as any, {} as any,
            prisma, webhookService, config, redis, channelToken, inboundProducer);

        // ── crash boundaries ─────────────────────────────────────────────────
        // A single armed boundary throws once from the exact seam it names. The
        // exception leaves `runTurn`, the BullMQ job fails, and BullMQ's own
        // retry is the restart — no bespoke recovery loop.
        const die = (boundary: string) => { crashAt = null; throw new Error(`simulated_process_death:${boundary}`); };
        const realRecordResult = turnLedger.recordResult.bind(turnLedger);
        turnLedger.recordResult = (async (...args: any[]) => {
            if (crashAt === 'after_model') die('after_model');
            const row = await (realRecordResult as any)(...args);
            if (crashAt === 'after_ledger') die('after_ledger');
            return row;
        }) as any;
        const realPublishBatch = outbox.publishBatch.bind(outbox);
        outbox.publishBatch = (async (...args: any[]) => {
            if (crashAt === 'after_batch_prepared') die('after_batch_prepared');
            return (realPublishBatch as any)(...args);
        }) as any;
        const realSettle = turnLedger.settle.bind(turnLedger);
        turnLedger.settle = (async (schemaName: string, inboundMessageId: string) => {
            if (crashAt === 'before_turn_done') {
                // The window is between the reply arriving and EITHER completion
                // record existing: the Redis marker is written moments earlier,
                // so the crash must take it with it to be the real window.
                await redis.del(`turn:done:${tenantId}:${(conversations as any).__pmid}`);
                die('before_turn_done');
            }
            return realSettle(schemaName, inboundMessageId);
        }) as any;

        // Turn the durable path on for this tenant only, through the shipped read.
        await client.$executeRawUnsafe(
            `INSERT INTO public.platform_settings(key,value,updated_at) VALUES($1,$2,NOW())
             ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
            'dispatch.normalOutbox',
            JSON.stringify({ enabled: true, tenantIds: [tenantId], channels: ['whatsapp'] }));
        await redis.del('dispatch:rollout');
        expect(await rollout.enabledFor(tenantId, 'whatsapp')).toBe(true);

        await startInboundWorker();
        await startOutboundWorker();

        // A real browser on /inbox, authenticated with a real token.
        const token = jwt.sign({ sub: randomUUID(), role: 'super_admin' });
        const endpoint = `http://127.0.0.1:${(httpServer.address() as any).port}/inbox`;
        browser = socketClient(endpoint, { auth: { token }, query: { tenantId },
            transports: ['websocket'], reconnection: false });
        browser.onAny((event: string, payload: any) => inboxEvents.push({ event, payload }));
        await new Promise<void>((resolve, reject) => {
            browser!.once('connect', () => resolve());
            browser!.once('connect_error', reject);
            setTimeout(() => reject(new Error('inbox_socket_connect_timeout')), 10_000);
        });
        // The room join happens inside handleConnection, after the socket is up.
        await until('the browser joined its tenant room',
            async () => namespace.adapter.rooms.get(tenantId)?.size === 1, 10_000);
    }, 180_000);

    async function startInboundWorker(): Promise<void> {
        const valkeyUrl = new URL(redisUrl!);
        inboundWorker = new Worker(inboundQueueName, async job => inboundProcessor.process(job as any), {
            connection: { host: '127.0.0.1', port: Number(valkeyUrl.port), maxRetriesPerRequest: null },
            concurrency: 1, lockDuration: 120_000,
        });
        inboundWorker.on('error', () => undefined);
        inboundWorker.on('failed', () => undefined);
        await inboundWorker.waitUntilReady();
    }

    async function startOutboundWorker(): Promise<void> {
        const valkeyUrl = new URL(redisUrl!);
        outboundWorker = new Worker(outboundQueueName,
            async (job, token) => outboundProcessor.process(job as any, token), {
                connection: { host: '127.0.0.1', port: Number(valkeyUrl.port), maxRetriesPerRequest: null },
                concurrency: 1,
            });
        outboundWorker.on('error', () => undefined);
        outboundWorker.on('failed', () => undefined);
        await outboundWorker.waitUntilReady();
    }

    afterAll(async () => {
        browser?.disconnect();
        await inboundWorker?.close(true).catch(() => undefined);
        await outboundWorker?.close(true).catch(() => undefined);
        await inboundQueue?.obliterate({ force: true }).catch(() => undefined);
        await outboundQueue?.obliterate({ force: true }).catch(() => undefined);
        await inboundQueue?.close().catch(() => undefined);
        await outboundQueue?.close().catch(() => undefined);
        await new Promise<void>(resolve => socketServer ? socketServer.close(() => resolve()) : resolve());
        await new Promise<void>(resolve => httpServer ? httpServer.close(() => resolve()) : resolve());
        await redis?.del('dispatch:rollout').catch(() => undefined);
        await wsRelay?.onModuleDestroy().catch(() => undefined);
        await redis?.onModuleDestroy().catch(() => undefined);
        if (!client) return;
        try {
            if (!/^tenant_normal_turn_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',
                tenantId, schema);
            await client.$executeRawUnsafe('DELETE FROM public.platform_settings WHERE key=$1',
                'dispatch.normalOutbox');
        } finally { await client.$disconnect(); }
    }, 180_000);

    beforeEach(() => {
        remoteEffects = [];
        inboxEvents = [];
        ackTrace = [];
        crashAt = null;
        strictOutcome = async () => ({ kind: 'accepted', receipt: `wamid.OUT.${randomUUID()}` });
    });

    /**
     * Drive one customer message all the way to a quiet queue.
     *
     * Returns the identity the rest of the turn hangs off: the provider's id,
     * the inbound row it became, and the ledger row it opened.
     */
    async function deliverCustomerMessage(text: string, wamid = `wamid.IN.${randomUUID()}`) {
        (conversations as any).__pmid = wamid;
        const ack = await postWebhook(messageBody(wamid, text));
        await until('the turn to reach a quiet system', async () =>
            (await queueIdle(inboundQueue)) && (await queueIdle(outboundQueue)));
        return { wamid, ack };
    }

    // ═════════════════════════════════════════════════════════════════════════
    describe('leg by leg: one message from the webhook to a delivered status', () => {
        it('enqueues before it acknowledges, runs the turn, owns the reply in a batch, '
            + 'delivers each effect once and records the provider status in the history', async () => {
            const wamid = `wamid.IN.${randomUUID()}`;
            const added: string[] = [];
            const realAdd = inboundQueue.add.bind(inboundQueue);
            const addSpy = jest.spyOn(inboundQueue, 'add').mockImplementation(async (...args: any[]) => {
                const job = await (realAdd as any)(...args);
                added.push(String(job.id));
                ackTrace.push('enqueued');
                return job;
            });

            (conversations as any).__pmid = wamid;
            const ack = await postWebhook(messageBody(wamid, '¿me confirmás la cita?'));
            addSpy.mockRestore();

            // LEG 1 — the webhook. The provider is told OK only after the work is
            // durable in Redis; the order is the whole property.
            expect(ack.status).toBe(200);
            expect(ackTrace).toEqual(['enqueued', 'ack:200']);
            expect(added).toHaveLength(1);
            expect(await inboundQueue.getJob(added[0])).toBeTruthy();

            // LEG 2 + 3 — the inbound queue, its processor, and the turn.
            await settleQueues();
            const inboundMessageId = await inboundMessageIdFor(wamid);
            const ledger = await ledgerRow(inboundMessageId);
            expect(ledger).toMatchObject({ state: 'settled', delivery_route: 'durable', attempts: 1 });
            expect(ledger.envelope).toMatchObject({
                text: REPLY_TEXT, chunks: [REPLY_TEXT],
                paymentLinks: [PAYMENT_LINK], media: [{ url: MEDIA_URL, caption: MEDIA_CAPTION }],
            });
            // The writers that produced the link travel with the envelope, so a
            // replay knows the business already ran.
            expect(ledger.writers).toEqual([expect.objectContaining({ tool: 'create_payment_link' })]);

            // LEG 3b — the batch. Four effects, in the order a person would send them.
            const rows = await outboxRows(inboundMessageId);
            expect(rows.map(row => [row.item_kind, bodyOf(row.payload)])).toEqual([
                ['text', REPLY_TEXT],
                ['payment_link', PAYMENT_LINK],
                ['media', MEDIA_URL],
                ['text', MEDIA_CAPTION],
            ]);
            expect(rows.every(row => row.state === 'sent')).toBe(true);

            // LEG 4 — the outbound queue and the strict transport.
            expect(remoteEffects.map(effect => effect.body)).toEqual(
                [REPLY_TEXT, PAYMENT_LINK, MEDIA_URL, MEDIA_CAPTION]);
            expect(remoteEffects.every(effect => effect.via === 'strict')).toBe(true);

            // The history says `sent`, not `delivered`: an acceptance is not an
            // arrival, and only the provider gets to say the second thing.
            const beforeStatus = await historyRows();
            expect(beforeStatus.filter(row => row.direction === 'outbound').map(row => row.status))
                .toEqual(['sent', 'sent', 'sent', 'sent']);

            // LEG 5 — the provider's status webhook, through the one shared writer.
            const receipts = rows.map(row => String(row.receipt));
            expect(await postWebhook(statusBody(receipts[0], 'delivered'))).toMatchObject({ status: 200 });
            expect(await postWebhook(statusBody(receipts[0], 'read'))).toMatchObject({ status: 200 });
            const afterStatus = await historyRows();
            const first = afterStatus.find(row => row.id === rows[0].message_id);
            expect(first!.status).toBe('read');

            // LEG 6 — Socket.IO. The worker had no server of its own, so this
            // travelled worker → Redis relay → API namespace → browser.
            await until('the browser to receive the inbound message',
                async () => inboxEvents.some(entry => entry.event === 'newMessage'), 15_000);
            const live = inboxEvents.find(entry => entry.event === 'newMessage')!;
            expect(live.payload).toMatchObject({
                conversationId: expect.any(String),
                message: expect.objectContaining({ external_id: wamid, direction: 'inbound',
                    channel_type: 'whatsapp' }),
            });
        });

        it('refuses to acknowledge a webhook it could not enqueue', async () => {
            const wamid = `wamid.IN.${randomUUID()}`;
            const addSpy = jest.spyOn(inboundQueue, 'add')
                .mockRejectedValue(new Error('valkey_unreachable'));
            try {
                const ack = await postWebhook(messageBody(wamid, 'nada de esto puede perderse'));
                // 500 on purpose: Meta redelivers what it was not told we have.
                expect(ack.status).toBe(500);
                expect(ackTrace).toEqual(['ack:500']);
            } finally { addSpy.mockRestore(); }
            expect(await sql('SELECT id FROM messages WHERE external_id=$1', [wamid])).toHaveLength(0);
            expect(remoteEffects).toHaveLength(0);
        });

        it('rejects an unsigned body without enqueuing anything', async () => {
            const body = messageBody(`wamid.IN.${randomUUID()}`, 'firma inválida');
            let status = 0;
            const res: any = { status(code: number) { status = code; return res; }, send() { return res; } };
            await controller.receiveWhatsApp(body, 'sha256=' + '0'.repeat(64),
                { rawBody: Buffer.from(JSON.stringify(body)) } as any, res);
            expect(status).toBe(401);
            expect(remoteEffects).toHaveLength(0);
        });
    });

    // ═════════════════════════════════════════════════════════════════════════
    describe('exactly one remote effect per item', () => {
        it('collapses a duplicate provider delivery of the same message onto one turn', async () => {
            const wamid = `wamid.IN.${randomUUID()}`;
            (conversations as any).__pmid = wamid;
            const body = messageBody(wamid, 'llegué dos veces');
            expect((await postWebhook(body)).status).toBe(200);
            expect((await postWebhook(body)).status).toBe(200);
            await settleQueues();

            const inboundMessageId = await inboundMessageIdFor(wamid);
            expect(await sql('SELECT id FROM messages WHERE external_id=$1', [wamid])).toHaveLength(1);
            expect((await outboxRows(inboundMessageId))).toHaveLength(4);
            expect(remoteEffects).toHaveLength(4);
            expect(new Set(remoteEffects.map(effect => effect.body)).size).toBe(4);
        });

        it('applies a repeated and an out-of-order status without moving the record backwards', async () => {
            const { wamid } = await deliverCustomerMessage('estados fuera de orden');
            const inboundMessageId = await inboundMessageIdFor(wamid);
            const [row] = await outboxRows(inboundMessageId);
            const receipt = String(row.receipt);
            const statusOf = async () =>
                (await sql('SELECT status FROM messages WHERE id=$1::uuid', [row.message_id]))[0].status;

            await postWebhook(statusBody(receipt, 'read'));
            expect(await statusOf()).toBe('read');
            // Late `delivered` after `read`, and a repeat of `read`: both are
            // older or equal claims, and neither may rewrite the record.
            await postWebhook(statusBody(receipt, 'delivered'));
            expect(await statusOf()).toBe('read');
            await postWebhook(statusBody(receipt, 'read'));
            expect(await statusOf()).toBe('read');
            // And the same event twice never produces a second remote effect.
            expect(remoteEffects).toHaveLength(4);
        });

        it('never lets a late failure overwrite a delivered or a read the provider already reported', async () => {
            const { wamid } = await deliverCustomerMessage('rechazo tardío');
            const inboundMessageId = await inboundMessageIdFor(wamid);
            const rows = await outboxRows(inboundMessageId);
            const statusOf = async (messageId: string) =>
                (await sql('SELECT status FROM messages WHERE id=$1::uuid', [messageId]))[0].status;

            await postWebhook(statusBody(String(rows[0].receipt), 'delivered'));
            await postWebhook(statusBody(String(rows[0].receipt), 'failed', 131047));
            expect(await statusOf(rows[0].message_id)).toBe('delivered');

            await postWebhook(statusBody(String(rows[1].receipt), 'read'));
            await postWebhook(statusBody(String(rows[1].receipt), 'failed', 131047));
            expect(await statusOf(rows[1].message_id)).toBe('read');

            // A rejection over an acceptance IS accepted — a provider may refuse
            // after acknowledging — and the code it gave is kept for diagnosis.
            await postWebhook(statusBody(String(rows[2].receipt), 'failed', 131053));
            expect(await statusOf(rows[2].message_id)).toBe('failed');
            const [refused] = await sql('SELECT error_code FROM agent_dispatch_outbox WHERE id=$1::uuid',
                [rows[2].id]);
            expect(refused.error_code).toBe('wa_131053');
        });

        it('settles a refusal and an unknown outcome without a second POST for the same item', async () => {
            const wamid = `wamid.IN.${randomUUID()}`;
            (conversations as any).__pmid = wamid;
            // The first bubble is refused permanently; the batch must not carry
            // on pretending the customer got it, and nothing may be re-sent.
            strictOutcome = async request => bodyOf(request.payload) === REPLY_TEXT
                ? { kind: 'rejected', errorCode: 'wa_131047', retryable: false }
                : { kind: 'accepted', receipt: `wamid.OUT.${randomUUID()}` };
            await postWebhook(messageBody(wamid, 'me lo rechazan'));
            await settleQueues();

            const inboundMessageId = await inboundMessageIdFor(wamid);
            const rows = await outboxRows(inboundMessageId);
            expect(rows[0]).toMatchObject({ state: 'suppressed', error_code: 'wa_131047', receipt: null });
            expect(remoteEffects.filter(effect => effect.body === REPLY_TEXT)).toHaveLength(1);

            // An unknown outcome on a fresh item: uncertain, never retried.
            const second = `wamid.IN.${randomUUID()}`;
            (conversations as any).__pmid = second;
            remoteEffects = [];
            strictOutcome = async request => bodyOf(request.payload) === REPLY_TEXT
                ? { kind: 'unknown', errorCode: 'timeout' }
                : { kind: 'accepted', receipt: `wamid.OUT.${randomUUID()}` };
            await postWebhook(messageBody(second, 'no sé si llegó'));
            await settleQueues();
            const uncertainId = await inboundMessageIdFor(second);
            const uncertain = await outboxRows(uncertainId);
            expect(uncertain[0]).toMatchObject({ state: 'reconciliation_required', error_code: 'timeout' });
            // `pending`, not `failed`: claiming failure would be as wrong as
            // claiming delivery when the provider may well have acted.
            const [history] = await sql('SELECT status FROM messages WHERE id=$1::uuid',
                [uncertain[0].message_id]);
            expect(history.status).toBe('pending');
            expect(remoteEffects.filter(effect => effect.body === REPLY_TEXT)).toHaveLength(1);
            // Recovery must not resurrect it either.
            await recovery.recoverPending();
            await settleQueues();
            expect(remoteEffects.filter(effect => effect.body === REPLY_TEXT)).toHaveLength(1);
        });
    });

    // ═════════════════════════════════════════════════════════════════════════
    describe('a crash at each boundary', () => {
        /**
         * The inbound job is durable before the worker exists, so a process that
         * dies between the 200 and the turn loses nothing.
         */
        it('after the enqueue: the message survives a worker that was not there', async () => {
            await inboundWorker!.close(true);
            inboundWorker = undefined;
            const wamid = `wamid.IN.${randomUUID()}`;
            (conversations as any).__pmid = wamid;
            expect((await postWebhook(messageBody(wamid, 'nadie escuchaba'))).status).toBe(200);
            expect(await sql('SELECT id FROM messages WHERE external_id=$1', [wamid])).toHaveLength(0);

            await startInboundWorker();
            await settleQueues();
            const inboundMessageId = await inboundMessageIdFor(wamid);
            expect((await ledgerRow(inboundMessageId)).state).toBe('settled');
            expect(remoteEffects.map(effect => effect.body))
                .toEqual([REPLY_TEXT, PAYMENT_LINK, MEDIA_URL, MEDIA_CAPTION]);
        });

        /**
         * The batch is what owns the reply, so a death after it committed is
         * finished by the next attempt rather than answered twice.
         */
        it('after the batch is prepared: the retry finishes the committed batch, once', async () => {
            const wamid = `wamid.IN.${randomUUID()}`;
            (conversations as any).__pmid = wamid;
            crashAt = 'after_batch_prepared';
            expect((await postWebhook(messageBody(wamid, 'muero con el lote escrito'))).status).toBe(200);
            await until('the retry to finish the batch', async () =>
                (await queueIdle(inboundQueue)) && (await queueIdle(outboundQueue))
                && (await sql('SELECT id FROM messages WHERE external_id=$1', [wamid])).length === 1
                && (await outboxRows(await inboundMessageIdFor(wamid)))
                    .every(row => row.state === 'sent'), 120_000);

            const inboundMessageId = await inboundMessageIdFor(wamid);
            const rows = await outboxRows(inboundMessageId);
            expect(rows).toHaveLength(4);
            expect(remoteEffects.map(effect => effect.body))
                .toEqual([REPLY_TEXT, PAYMENT_LINK, MEDIA_URL, MEDIA_CAPTION]);
            expect(remoteEffects.every(effect => effect.via === 'strict')).toBe(true);
            // Exactly one copy of every word, and the ledger says the durable
            // path owned it from the first attempt.
            expect(new Set(remoteEffects.map(effect => effect.body)).size).toBe(4);
            expect((await ledgerRow(inboundMessageId)).delivery_route).toBe('durable');
        });

        /**
         * Between two effects of one batch: the worker dies holding a permission
         * it never settled. The item is uncertain, the ones behind it still go
         * out in order, and nothing is sent twice.
         */
        it('between items: the batch continues in order and repeats nothing', async () => {
            const wamid = `wamid.IN.${randomUUID()}`;
            (conversations as any).__pmid = wamid;
            let reachedSecond!: () => void;
            const secondInFlight = new Promise<void>(resolve => { reachedSecond = resolve; });
            strictOutcome = async request => {
                if (bodyOf(request.payload) === PAYMENT_LINK) {
                    reachedSecond();
                    // Never answers: the process dies holding the permission.
                    return new Promise<StrictDispatchOutcome>(() => undefined);
                }
                return { kind: 'accepted', receipt: `wamid.OUT.${randomUUID()}` };
            };
            await postWebhook(messageBody(wamid, 'me muero a mitad del lote'));
            await secondInFlight;

            await outboundWorker!.close(true);
            outboundWorker = undefined;
            await outboundQueue.obliterate({ force: true }).catch(() => undefined);
            const inboundMessageId = await inboundMessageIdFor(wamid);
            // Production waits out the 120 s lease; the date is brought forward
            // because the transition is what is under test, not the wall clock.
            await sql("UPDATE agent_dispatch_outbox SET lease_expires_at = NOW() - INTERVAL '1 second' "
                + "WHERE inbound_message_id=$1::uuid AND state='admitted'", [inboundMessageId]);

            strictOutcome = async () => ({ kind: 'accepted', receipt: `wamid.OUT.${randomUUID()}` });
            await startOutboundWorker();
            await recovery.recoverPending();
            await until('the rest of the batch to arrive', async () =>
                (await queueIdle(outboundQueue))
                && (await outboxRows(inboundMessageId)).slice(2).every(row => row.state === 'sent'), 120_000);

            const rows = await outboxRows(inboundMessageId);
            expect(rows.map(row => row.state))
                .toEqual(['sent', 'reconciliation_required', 'sent', 'sent']);
            // The link left this process exactly once, uncertain or not.
            expect(remoteEffects.filter(effect => effect.body === PAYMENT_LINK)).toHaveLength(1);
            // And the caption still follows its own picture.
            expect(remoteEffects.map(effect => effect.body).indexOf(MEDIA_CAPTION))
                .toBeGreaterThan(remoteEffects.map(effect => effect.body).indexOf(MEDIA_URL));
        });

        /**
         * The ledger is the authority, and a redelivery can reach it.
         *
         * `saveMessage` answers `ON CONFLICT DO NOTHING` with the stored row's
         * id, so the retry opens the same ledger row, sees that NOTHING was
         * recorded, and does the only correct thing with that: it produces the
         * answer again, whole. The words-only Redis cache is written behind the
         * envelope now, so it can no longer offer a lossy memory in place of a
         * complete one — which is what used to cost this turn its payment link
         * and its attachment and push the reply onto the legacy producer.
         */
        it('after the model, before the ledger: the retry produces the whole answer again '
            + 'and delivers it once, through the durable route', async () => {
            const wamid = `wamid.IN.${randomUUID()}`;
            (conversations as any).__pmid = wamid;
            crashAt = 'after_model';
            expect((await postWebhook(messageBody(wamid, 'muero antes de anotar el resultado'))).status).toBe(200);
            await until('the retry to deliver the whole batch', async () =>
                (await queueIdle(inboundQueue)) && (await queueIdle(outboundQueue))
                && remoteEffects.length >= 4, 120_000);
            await settleQueues();

            const inboundMessageId = await inboundMessageIdFor(wamid);
            const ledger = await ledgerRow(inboundMessageId);
            // Both attempts are on the row, which is how an operator sees that
            // this turn was interrupted at all.
            expect(Number(ledger.attempts)).toBe(2);
            expect(ledger).toMatchObject({ state: 'settled', delivery_route: 'durable' });
            // The whole answer, not just its words: the link and the picture are
            // effects of this turn and they are back in the envelope.
            expect(ledger.envelope).toMatchObject({
                text: REPLY_TEXT, chunks: [REPLY_TEXT],
                paymentLinks: [PAYMENT_LINK], media: [{ url: MEDIA_URL, caption: MEDIA_CAPTION }],
            });
            expect((await outboxRows(inboundMessageId)).map(row => row.state))
                .toEqual(['sent', 'sent', 'sent', 'sent']);

            // Once, in order, and through the strict transport — no second copy
            // and nothing left on the loose gateway.
            expect(remoteEffects.map(effect => effect.body))
                .toEqual([REPLY_TEXT, PAYMENT_LINK, MEDIA_URL, MEDIA_CAPTION]);
            expect(remoteEffects.every(effect => effect.via === 'strict')).toBe(true);
        });

        /**
         * The durable record outlives the Redis marker, which is the reason it
         * exists.
         *
         * The crash takes `turn:done` with it, so Redis has forgotten that this
         * message was answered. The ledger has not: the retry finds the recorded
         * envelope and the committed batch, publishes a batch whose every item is
         * already sent, and adds nothing. Before the ledger could be reached on a
         * redelivery the retry went out through the legacy producer, whose job id
         * shares no deduplication identity with `dispatch-<uuid>` — so BullMQ
         * could not collapse them and the customer read the same answer twice.
         */
        it('before the turn-done marker: the ledger remembers what Redis forgot, and the '
            + 'customer is not answered twice', async () => {
            const wamid = `wamid.IN.${randomUUID()}`;
            (conversations as any).__pmid = wamid;
            crashAt = 'before_turn_done';
            expect((await postWebhook(messageBody(wamid, 'muero justo antes de la marca'))).status).toBe(200);
            await until('the retry to run to the end', async () =>
                (await queueIdle(inboundQueue)) && (await queueIdle(outboundQueue))
                && (await ledgerRow(await inboundMessageIdFor(wamid)))?.state === 'settled', 120_000);
            await settleQueues();

            const inboundMessageId = await inboundMessageIdFor(wamid);
            expect((await outboxRows(inboundMessageId)).map(row => row.state))
                .toEqual(['sent', 'sent', 'sent', 'sent']);
            // The whole answer went out exactly once, through the outbox…
            expect(remoteEffects.map(effect => effect.body))
                .toEqual([REPLY_TEXT, PAYMENT_LINK, MEDIA_URL, MEDIA_CAPTION]);
            // …and nothing at all went out through the legacy route.
            expect(remoteEffects.filter(effect => effect.via === 'loose')).toHaveLength(0);
            // The Redis marker is gone and the row is what says this is finished.
            expect(await redis.get(`turn:done:${tenantId}:${wamid}`)).toBeTruthy();
            expect((await ledgerRow(inboundMessageId)).state).toBe('settled');
        });
    });

    // ═════════════════════════════════════════════════════════════════════════
    describe('an erasure landing mid-flight', () => {
        /**
         * Every place the words survive, found rather than assumed.
         *
         * A list of three known tables would only ever prove that those three
         * were cleared. This scans every text and JSON column of the tenant
         * schema for the marker, so a fourth hiding place fails the test.
         */
        async function survivorsInPostgres(marker: string): Promise<string[]> {
            const columns = await sql(
                `SELECT table_name, column_name FROM information_schema.columns
                  WHERE table_schema = $1
                    AND data_type IN ('text','character varying','jsonb','json')
                  ORDER BY table_name, column_name`, [schema]);
            const found: string[] = [];
            for (const column of columns) {
                const [hit] = await sql(
                    `SELECT 1 AS present FROM "${column.table_name}"
                      WHERE "${column.column_name}"::text LIKE $1 LIMIT 1`, [`%${marker}%`]);
                if (hit) found.push(`${column.table_name}.${column.column_name}`);
            }
            return found;
        }

        it('clears the words from the outbox, the ledger and the history, and no recovery '
            + 'pass brings them back', async () => {
            const wamid = `wamid.IN.${randomUUID()}`;
            (conversations as any).__pmid = wamid;
            const marker = `SECRETO-${randomUUID().slice(0, 8)}`;
            conversations.generateResponse.mockImplementationOnce(async (...args: any[]) => {
                args[14].paymentLinks.push(`${PAYMENT_LINK}/${marker}`);
                return `Confirmado ${marker}`;
            });
            let held!: () => void;
            const release = new Promise<void>(resolve => { held = resolve; });
            let inFlight!: () => void;
            const reached = new Promise<void>(resolve => { inFlight = resolve; });
            strictOutcome = async () => {
                inFlight();
                await release;
                return { kind: 'accepted', receipt: `wamid.OUT.${randomUUID()}` };
            };
            await postWebhook(messageBody(wamid, `pedido ${marker}`));
            await reached;

            // The right to be forgotten lands while the request is in the air.
            // The three statements are the ones the shipped erasure runs on this
            // spine: the outbox payload, the turn envelope, the history.
            const inboundMessageId = await inboundMessageIdFor(wamid);
            const [{ contact_id: contactId }] = await sql(
                'SELECT contact_id FROM agent_dispatch_outbox WHERE inbound_message_id=$1::uuid LIMIT 1',
                [inboundMessageId]);
            let erased: { dispatchItems: number; envelopes: number };
            try {
                erased = await prisma.transactionInTenantSchema(schema, async (query: any) => {
                    await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
                        [`agent-privacy:${schema}`]);
                    const dispatchItems = await redactDispatchOutbox(query, schema,
                        { contactIds: [String(contactId)] });
                    const envelopes = await redactTurnLedger(query, schema, { contactIds: [String(contactId)] });
                    await query(
                        `WITH conv_ids AS (SELECT id FROM conversations WHERE contact_id = $1::uuid)
                         UPDATE messages SET content_text = '[REDACTED]', metadata = '{}'::jsonb
                          WHERE conversation_id IN (SELECT id FROM conv_ids)`, [String(contactId)]);
                    return { dispatchItems, envelopes };
                });
            } finally {
                // Whatever happened above, the transport is let go. A permission
                // still held here would leave the outbound queue busy forever,
                // and every later test in this file waits on a quiet queue — one
                // failed expectation would read as five.
                held();
            }
            await settleQueues();

            expect(erased.dispatchItems).toBeGreaterThanOrEqual(1);
            // Every envelope this person owns, not only the turn in the air. An
            // erasure is about a PERSON: the earlier turns in this file belong to
            // the same contact and must go with it, so the count is whatever the
            // contact had — what matters is that nothing of theirs is left.
            expect(erased.envelopes).toBeGreaterThanOrEqual(1);
            expect(await sql(
                'SELECT id FROM agent_turn_ledger WHERE contact_id=$1::uuid AND envelope IS NOT NULL',
                [String(contactId)])).toHaveLength(0);

            // Nothing in this tenant's schema still holds the words.
            expect(await survivorsInPostgres(marker)).toEqual([]);
            // The rows survive as the fact that stops a replay, with no payload.
            const rows = await outboxRows(inboundMessageId);
            expect(rows.every(row => row.payload === null && row.redacted_at !== null)).toBe(true);
            expect((await ledgerRow(inboundMessageId)).envelope).toBeNull();

            // And no recovery pass repopulates any of it.
            await recovery.recoverPending();
            await settleQueues();
            expect(await survivorsInPostgres(marker)).toEqual([]);
            expect(remoteEffects.filter(effect => effect.body.includes(marker)).length)
                .toBeLessThanOrEqual(1);
        });

        /**
         * DEFECT, PROVEN HERE — the words outlive the erasure in Valkey.
         *
         * `conversations.service.ts:1103-1105` caches the whole reply under
         * `turn:reply:{tenant}:{pmid}` for 24 h. The cache is skipped for replies
         * derived from learned examples — the authors reasoned about a withdrawn
         * RELEASE, which cannot find this key — but a CONTACT erasure has the same
         * problem and nothing clears it. `ComplianceService.eraseCustomerMemory`
         * touches PostgreSQL only. Within the TTL a provider redelivery replays
         * the erased words to the customer (`:823-828`).
         */
        it('leaves the erased words in the Redis reply cache, where a redelivery can '
            + 'still replay them (KNOWN DEFECT)', async () => {
            const wamid = `wamid.IN.${randomUUID()}`;
            (conversations as any).__pmid = wamid;
            const marker = `SECRETO-${randomUUID().slice(0, 8)}`;
            conversations.generateResponse.mockImplementationOnce(async () => `Confirmado ${marker}`);
            await postWebhook(messageBody(wamid, `otro pedido ${marker}`));
            await settleQueues();

            const inboundMessageId = await inboundMessageIdFor(wamid);
            const [{ contact_id: contactId }] = await sql(
                'SELECT contact_id FROM agent_dispatch_outbox WHERE inbound_message_id=$1::uuid LIMIT 1',
                [inboundMessageId]);
            await prisma.transactionInTenantSchema(schema, async (query: any) => {
                await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
                    [`agent-privacy:${schema}`]);
                await redactDispatchOutbox(query, schema, { contactIds: [String(contactId)] });
                await redactTurnLedger(query, schema, { contactIds: [String(contactId)] });
                await query(
                    `WITH conv_ids AS (SELECT id FROM conversations WHERE contact_id = $1::uuid)
                     UPDATE messages SET content_text = '[REDACTED]', metadata = '{}'::jsonb
                      WHERE conversation_id IN (SELECT id FROM conv_ids)`, [String(contactId)]);
            });

            expect(await survivorsInPostgres(marker)).toEqual([]);
            // But the whole reply is still sitting in Valkey, reachable only by
            // provider id and cleared by nothing.
            const cached = await redis.get(`turn:reply:${tenantId}:${wamid}`);
            expect(cached).toContain(marker);
        });
    });

    // ═════════════════════════════════════════════════════════════════════════
    describe('transaction-scoped pooling semantics (the PgBouncer stand-in)', () => {
        it('sets the tenant search_path with SET LOCAL, so it does not survive its transaction', async () => {
            const [inside] = await sql('SHOW search_path');
            expect(String(inside.search_path)).toContain(schema);
            // The same pool, the next statement: a session-scoped SET would have
            // leaked here, and under transaction pooling it would leak into
            // whichever client got the connection next.
            const [outside]: any[] = await client.$queryRawUnsafe('SHOW search_path');
            expect(String(outside.search_path)).not.toContain(schema);
        });

        it('cannot carry a multi-statement string on the primitive the turn uses', async () => {
            await expect(sql('SELECT 1 AS a; SELECT 2 AS b')).rejects.toBeDefined();
            // The single-statement form on the same primitive is fine, so the
            // rejection is about the multi-statement string and nothing else.
            expect(await sql('SELECT 1 AS a')).toEqual([{ a: 1 }]);
        });

        it('leaves no session-scoped advisory lock behind after a whole turn', async () => {
            await deliverCustomerMessage('sin candados de sesión');
            // Every lock this path takes is `pg_advisory_xact_lock*`, which ends
            // with its transaction. A session lock on a pooled connection would
            // be handed to the next client still held.
            const [held]: any[] = await client.$queryRawUnsafe(
                `SELECT count(*)::int AS held FROM pg_locks
                  WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database
                        WHERE datname = current_database())`);
            expect(Number(held.held)).toBe(0);
        });

        it('does not depend on a connection surviving between calls', async () => {
            const seen = new Set<number>();
            for (let attempt = 0; attempt < 12; attempt++) {
                const [row] = await sql('SELECT pg_backend_pid()::int AS pid');
                seen.add(Number(row.pid));
            }
            // Whether the pool happens to reuse one backend or several, the turn
            // that just ran carried no state across those boundaries — proven by
            // the two assertions above rather than by the pid count, which is
            // recorded here only to show the calls really are independent.
            expect(seen.size).toBeGreaterThanOrEqual(1);
            const { wamid } = await deliverCustomerMessage('conexiones independientes');
            expect((await ledgerRow(await inboundMessageIdFor(wamid))).state).toBe('settled');
        });
    });
});
