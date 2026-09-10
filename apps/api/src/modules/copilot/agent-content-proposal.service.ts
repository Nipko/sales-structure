import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
    AGENT_OPERATION_REGISTRY,
    getAgentOperation,
    isExecutableAgentOperation,
    validateAgentOperationInput,
    type AgentContentProposal,
    type AgentExecutableOperation,
    type AgentExecutableOperationKey,
    type AgentOperationAvailability,
    type AgentOperationBlockedReason,
    type AppliedAgentContentObject,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ComplianceService } from '../compliance/compliance.service';
import { CatalogService } from '../catalog/catalog.service';
import { ServicesService } from '../appointments/services.service';
import { VerticalsService } from '../verticals/verticals.service';
import { ensureContentProposalSchema } from './agent-configuration-proposal-schema';
import { PROPOSAL_TTL_MINUTES, proposalHash } from './agent-proposal-digest';
import {
    AGENT_CONTENT_OPERATION_HANDLERS,
    type ContentOperationActor,
    type ContentOperationContext,
    type ContentOperationHandler,
} from './agent-content-operations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEY = /^[a-zA-Z0-9_-]{8,80}$/;

/**
 * Creating content the tenant owns, under the guarantees the configuration
 * proposals already carry: a reviewed digest, an expiry, idempotent replay, an
 * audit row naming the real actor, and a read-back afterwards.
 *
 * It is a sibling of `AgentConfigurationService`, not a second copy of it. The
 * digest lives in `agent-proposal-digest.ts` and is shared, so "the same
 * reviewed content" means one thing across both. The ledger is its own table
 * because `agent_config_proposals.agent_id` is `NOT NULL REFERENCES
 * agent_personas(id)` and a FAQ has no agent to point at — squeezing a creation
 * into that row would have meant nulling out the column the configuration
 * ledger's own integrity check depends on.
 *
 * Nothing here can send, publish, charge or touch a credential: the operations
 * that would are declared in the shared registry as routes to the screen that
 * owns them, and are rejected by `propose` with their reason.
 */
@Injectable()
export class AgentContentProposalService {
    private readonly logger = new Logger(AgentContentProposalService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
        private readonly knowledge: KnowledgeService,
        private readonly compliance: ComplianceService,
        private readonly catalog: CatalogService,
        private readonly services: ServicesService,
        private readonly verticals: VerticalsService,
    ) {}

    // ─── The registry, as this caller sees it ───────────────────────────────

    /**
     * Every declared operation with a verdict for this caller. A person asking
     * "can Assist do X?" gets the same answer the propose path would give, and
     * the ones it will never do come back with the screen that owns them
     * instead of an apology.
     */
    async listOperations(tenantId: string, actor: ContentOperationActor): Promise<AgentOperationAvailability[]> {
        const context = await this.context(tenantId, actor).catch(() => null);
        const result: AgentOperationAvailability[] = [];
        for (const definition of AGENT_OPERATION_REGISTRY) {
            const base = { key: definition.key, domain: definition.domain, route: definition.route };
            if (!isExecutableAgentOperation(definition)) {
                result.push({ ...base, availability: 'route_to_screen', reason: definition.reason });
                continue;
            }
            if (!definition.roles.includes(actor.role as any)) {
                result.push({ ...base, availability: 'blocked', reason: 'role_not_permitted' });
                continue;
            }
            if (!context) {
                result.push({ ...base, availability: 'blocked', reason: 'gate_unavailable' });
                continue;
            }
            const blocked = await this.capabilityVerdict(definition, context)
                ?? await this.gateVerdict(definition, context);
            result.push(blocked
                ? { ...base, availability: 'blocked', reason: blocked }
                : { ...base, availability: 'executable', reason: null });
        }
        return result;
    }

    // ─── Propose ────────────────────────────────────────────────────────────

    async propose(tenantId: string, operation: unknown, input: unknown, actor: ContentOperationActor,
        requestKey: string = randomUUID()): Promise<AgentContentProposal> {
        const definition = this.executable(operation);
        this.authorize(actor, definition);
        if (typeof requestKey !== 'string' || !REQUEST_KEY.test(requestKey)) throw new BadRequestException('Invalid idempotency key');
        const validated = validateAgentOperationInput(definition.key, input);
        if (!validated.ok) {
            throw new BadRequestException({ error: 'operation_input_invalid', operation: definition.key, violations: validated.violations });
        }

        const context = await this.context(tenantId, actor);
        const prior = await this.readByRequestKey(context, actor.id, requestKey);
        if (prior) {
            // The same key must always mean the same proposal. A key reused for
            // different content is a caller bug, and returning the old proposal
            // would let them apply something they never asked for.
            if (prior.operation !== definition.key || proposalHash(prior.input) !== proposalHash(validated.value)) {
                throw new ConflictException('Idempotency key belongs to a different proposal');
            }
            return this.publicProposal(prior);
        }

        await this.assertGate(definition, context);
        const digest = this.proposalDigest({ operation: definition.key, requested_by: actor.id, input: validated.value });
        const inserted = await this.prisma.executeInTenantSchema<any[]>(context.schemaName,
            `INSERT INTO agent_content_proposals (operation, requested_by, request_key, digest, input, expires_at)
             VALUES ($1,$2::uuid,$3,$4,$5::jsonb,NOW()+interval '${PROPOSAL_TTL_MINUTES} minutes')
             ON CONFLICT (requested_by, request_key) DO NOTHING RETURNING *`,
            [definition.key, actor.id, requestKey, digest, JSON.stringify(validated.value)]);
        if (inserted[0]) return this.publicProposal(inserted[0]);

        // Lost a race on the same key. Whatever landed first is authoritative,
        // and it only counts as this request if its content matches.
        const raced = await this.readByRequestKey(context, actor.id, requestKey);
        if (!raced || raced.digest !== digest) throw new ConflictException('Idempotency key belongs to a different proposal');
        return this.publicProposal(raced);
    }

    // ─── Apply ──────────────────────────────────────────────────────────────

    async apply(tenantId: string, proposalId: string, digest: string, actor: ContentOperationActor): Promise<AppliedAgentContentObject> {
        if (typeof proposalId !== 'string' || !UUID.test(proposalId) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
            throw new BadRequestException('An exact reviewed proposal is required');
        }
        const context = await this.context(tenantId, actor);
        const rows = await this.prisma.executeInTenantSchema<any[]>(context.schemaName,
            'SELECT * FROM agent_content_proposals WHERE id = $1::uuid', [proposalId]);
        const row = rows[0];
        if (!row) throw new NotFoundException('Proposal not found');
        // Both directions: the digest the reviewer saw, and the digest the row's
        // own content still produces. The second catches a stored input edited
        // out from under a digest that was never re-derived.
        if (row.digest !== digest || this.proposalDigest(row) !== digest) throw new ConflictException('Proposal content changed');

        const definition = this.executable(row.operation);
        this.authorize(actor, definition);
        if (row.status === 'applied') return this.receipt(context, definition, row, 'replayed');
        if (row.status !== 'proposed' || new Date(row.expires_at).getTime() <= Date.now()) {
            throw new ConflictException({ error: 'operation_proposal_expired' });
        }

        // Re-validated and re-gated at apply time, not trusted from propose: a
        // deploy may have narrowed the rules, and a plan may have been
        // downgraded, in the minutes the reviewer spent reading.
        const validated = validateAgentOperationInput(definition.key, row.input);
        if (!validated.ok) {
            throw new ConflictException({ error: 'operation_input_invalid', operation: definition.key, violations: validated.violations });
        }
        await this.assertGate(definition, context);

        // The claim is taken BEFORE the effect, and that ordering is the whole
        // point. The create runs through the module that owns the table, on its
        // own connection, so it cannot join this ledger's transaction. Claiming
        // first means a crash between the two leaves a spent proposal and no
        // object; claiming after would leave a proposal that still looks
        // appliable next to an object that already exists, and the retry would
        // create a second one. Fail toward zero, never toward two.
        const claimed = await this.prisma.executeInTenantSchema<any[]>(context.schemaName,
            `UPDATE agent_content_proposals SET status='applied', applied_at=NOW(), applied_by=$2::uuid
             WHERE id=$1::uuid AND status='proposed' AND expires_at > NOW() RETURNING *`,
            [proposalId, actor.id]);
        if (!claimed[0]) {
            const current = await this.prisma.executeInTenantSchema<any[]>(context.schemaName,
                'SELECT * FROM agent_content_proposals WHERE id = $1::uuid', [proposalId]);
            if (current[0]?.status === 'applied') return this.receipt(context, definition, current[0], 'replayed');
            throw new ConflictException({ error: 'operation_proposal_expired' });
        }

        const handler = this.handler(definition.key);
        const created = await handler.create(context, validated.value as any);
        await this.prisma.executeInTenantSchema(context.schemaName,
            'UPDATE agent_content_proposals SET created_object_id = $2::uuid WHERE id = $1::uuid', [proposalId, created.id]);

        // Audited with the real actor. Under impersonation `actor.id` is the
        // tenant's own admin — recording only that would read as the customer
        // doing it to themselves — so `delegation` carries the super_admin who
        // is actually holding the keyboard.
        let auditFailed = false;
        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    userId: actor.id,
                    action: 'assist.content_object_created',
                    resource: `${definition.target.table}/${created.id}`,
                    details: {
                        operation: definition.key, domain: definition.domain, proposalId, digest,
                        objectId: created.id,
                        // Flattened rather than nested: Prisma's JSON input type
                        // rejects an interface without an index signature.
                        target: `${definition.target.service}.${definition.target.method}`,
                        table: definition.target.table,
                        ...actor.delegation,
                    },
                },
            });
        } catch (error: any) {
            auditFailed = true;
            this.logger.error(`Assist content audit failed for ${definition.key} ${created.id}: ${error?.message || error}`);
        }

        const receipt = await this.receipt(context, definition, { ...claimed[0], created_object_id: created.id }, 'created');
        // An object that exists with no record of who asked for it is not a
        // verified apply, even though the row is there.
        return auditFailed && receipt.verification === 'verified'
            ? { ...receipt, verification: 'unavailable', verificationReason: 'audit_unavailable' }
            : receipt;
    }

    // ─── Internals ──────────────────────────────────────────────────────────

    /** Resolves a key against the whitelist. Anything else never reaches a service. */
    private executable(operation: unknown): AgentExecutableOperation {
        const definition = typeof operation === 'string' ? getAgentOperation(operation) : undefined;
        if (!definition) throw new BadRequestException({ error: 'operation_unknown' });
        if (!isExecutableAgentOperation(definition)) {
            // Not a failure: the honest answer, plus where the person goes.
            throw new BadRequestException({
                error: 'operation_not_executable', operation: definition.key,
                reason: definition.reason, route: definition.route,
            });
        }
        return definition;
    }

    private authorize(actor: ContentOperationActor, definition: AgentExecutableOperation): void {
        if (!actor || typeof actor.role !== 'string' || !definition.roles.includes(actor.role as any)) {
            throw new ForbiddenException({ error: 'operation_role_not_permitted', operation: definition.key, roles: [...definition.roles] });
        }
        if (typeof actor.id !== 'string' || !UUID.test(actor.id)) throw new BadRequestException('Invalid operation scope');
    }

    /**
     * The handler map is a total map over the executable keys, checked where it
     * is declared. Widening to `any` here is the one place a runtime key meets
     * it, and the correspondence has already been proven by the compiler.
     */
    private handler(key: AgentExecutableOperationKey): ContentOperationHandler<any> {
        return AGENT_CONTENT_OPERATION_HANDLERS[key] as ContentOperationHandler<any>;
    }

    private async context(tenantId: string, actor: ContentOperationActor): Promise<ContentOperationContext> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        await ensureContentProposalSchema(this.prisma, schemaName);
        return {
            tenantId, schemaName, actor, prisma: this.prisma,
            knowledge: this.knowledge, compliance: this.compliance, catalog: this.catalog, services: this.services,
        };
    }

    private readByRequestKey(context: ContentOperationContext, actorId: string, requestKey: string): Promise<any> {
        return this.prisma.executeInTenantSchema<any[]>(context.schemaName,
            'SELECT * FROM agent_content_proposals WHERE requested_by = $1::uuid AND request_key = $2', [actorId, requestKey])
            .then(rows => rows[0] ?? null);
    }

    /**
     * The vertical gate, asked before the plan gate.
     *
     * A plan says how much of a thing a tenant may have; a vertical says whether
     * the thing exists for them at all. `catalogue.course.create` is gated by
     * neither a plan feature nor a limit, so before this a restaurant's admin
     * could have Assist prepare a course, apply it, and write a row into a
     * table whose screen the dashboard hides from them — created, audited, and
     * unreachable.
     *
     * Fail-closed, and narrowly: an operation with no `requiresCapability` never
     * reaches this method, so a vertical service that is down cannot block a FAQ
     * or a legal text.
     */
    private async assertCapability(definition: AgentExecutableOperation, context: ContentOperationContext): Promise<void> {
        const required = definition.requiresCapability;
        if (!required) return;
        const config = await this.verticals.getVerticalConfig(context.tenantId).catch((error: any) => {
            this.logger.warn(`vertical capability read failed for ${context.tenantId}: ${error?.message}`);
            return null;
        });
        const capabilities = Array.isArray(config?.effectiveCapabilities) ? config!.effectiveCapabilities : [];
        if (!capabilities.includes(required as any)) {
            throw new ForbiddenException({
                error: 'vertical_capability_missing', operation: definition.key, capability: required,
            });
        }
    }

    /** The same vertical gate, asked as a question instead of an assertion. */
    private async capabilityVerdict(definition: AgentExecutableOperation, context: ContentOperationContext): Promise<AgentOperationBlockedReason | null> {
        if (!definition.requiresCapability) return null;
        return this.assertCapability(definition, context)
            .then(() => null)
            .catch(() => 'vertical_capability_missing' as const);
    }

    private async assertGate(definition: AgentExecutableOperation, context: ContentOperationContext): Promise<void> {
        await this.assertCapability(definition, context);
        const gate = definition.gate;
        if (gate.kind === 'none') return;
        if (gate.kind === 'plan_feature') {
            const enabled = await this.throttle.isFeatureEnabled(context.tenantId, gate.featureKey);
            if (!enabled) throw new ForbiddenException({ error: 'plan_feature_missing', featureKey: gate.featureKey });
            return;
        }
        const handler = this.handler(definition.key);
        if (!handler.count) {
            // Unreachable while the contract test holds; fail closed rather than
            // let a limit key with nothing to count read as "no limit".
            throw new ForbiddenException({ error: 'operation_gate_unavailable', operation: definition.key });
        }
        await this.throttle.enforcePlanLimit(context.tenantId, gate.limitKey, await handler.count(context), handler.planResourceLabel);
    }

    /** The same gate, asked as a question instead of an assertion. */
    private async gateVerdict(definition: AgentExecutableOperation, context: ContentOperationContext): Promise<AgentOperationBlockedReason | null> {
        try {
            await this.assertGate(definition, context);
            return null;
        } catch (error: any) {
            const code = typeof error?.getResponse === 'function' ? (error.getResponse() as any)?.error : undefined;
            if (code === 'vertical_capability_missing') return 'vertical_capability_missing';
            if (code === 'plan_limit_reached') return 'plan_limit_reached';
            if (code === 'plan_feature_missing') return 'plan_feature_missing';
            return 'gate_unavailable';
        }
    }

    private proposalDigest(row: { operation: string; requested_by: string; input: unknown }): string {
        return proposalHash({ operation: row.operation, requestedBy: row.requested_by, input: row.input });
    }

    private publicProposal(row: any): AgentContentProposal {
        const definition = getAgentOperation(row.operation);
        if (!isExecutableAgentOperation(definition)) throw new ConflictException({ error: 'operation_no_longer_executable', operation: row.operation });
        const expired = row.status === 'proposed' && new Date(row.expires_at).getTime() <= Date.now();
        return {
            id: row.id,
            operation: definition.key,
            domain: definition.domain,
            target: definition.target,
            route: definition.route,
            digest: row.digest,
            status: expired ? 'expired' : row.status,
            expiresAt: new Date(row.expires_at).toISOString(),
            preview: {
                // Said out loud rather than rendered as an empty diff: an empty
                // `before` reads as "nothing changes", which is the opposite of
                // what applying this does.
                before: null,
                beforeState: 'does_not_exist',
                after: this.renderPreview(definition.key, row.input),
            },
            ...(row.created_object_id ? { createdObjectId: row.created_object_id } : {}),
        };
    }

    private renderPreview(key: AgentExecutableOperationKey, input: unknown): AgentContentProposal['preview']['after'] {
        try {
            return this.handler(key).preview(input as any)
                .filter(entry => ['string', 'number', 'boolean'].includes(typeof entry.value));
        } catch {
            // A stored input the current preview cannot read must not blank the
            // review: show the raw primitives so the person still sees content.
            const record = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
            return Object.entries(record)
                .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
                .map(([field, value]) => ({ field, value: value as string | number | boolean }));
        }
    }

    private async receipt(context: ContentOperationContext, definition: AgentExecutableOperation, row: any,
        outcome: AppliedAgentContentObject['outcome']): Promise<AppliedAgentContentObject> {
        const proposal = this.publicProposal(row);
        const objectId = row.created_object_id ?? null;
        if (!objectId) {
            // Claimed but never created: the proposal is spent and there is
            // nothing to show. Saying `verified` here would be a receipt for an
            // object that does not exist.
            return { proposal, outcome, object: null, verification: 'unavailable', verificationReason: 'object_missing' };
        }
        const object = await this.handler(definition.key).read(context, objectId).catch(() => null);
        return {
            proposal,
            outcome,
            object: object ? { id: object.id, label: object.label, route: definition.route } : null,
            verification: object ? 'verified' : 'unavailable',
            verificationReason: object ? null : 'reread_failed',
        };
    }
}
