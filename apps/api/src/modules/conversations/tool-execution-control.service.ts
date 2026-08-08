import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import {
    ASSURANCE_LEVEL_MATRIX,
    type VerticalAssuranceLevel,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChatIdentityService } from './chat-identity.service';
import { getToolPolicy, type ToolPolicy } from './tool-policy-registry';

const CONFIRMATION_TTL_MS = 15 * 60 * 1000;
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const APPROVAL_RESUME_LEASE_SECONDS = 90;
const APPROVAL_RESUME_MAX_ATTEMPTS = 8;
const APPROVAL_EXPIRY_SWEEP_BATCH = 100;
const EXECUTION_LEASE_SECONDS = 90;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ConfirmationDisposition = 'confirmed' | 'rejected' | 'unclear';

interface ExecutionLedgerRow {
    id: string;
    idempotency_key: string;
    tool_name: string;
    args_hash: string;
    status: string;
    assurance_level: VerticalAssuranceLevel;
    confirmation_token: string | null;
    request_source_message_id: string | null;
    confirmation_source_message_id: string | null;
    confirmed_by_message_id: string | null;
    confirmation_expires_at: Date | string | null;
    confirmed_at: Date | string | null;
    approval_ticket_id: string | null;
    contact_id: string | null;
    conversation_id: string | null;
    request_payload: any;
    channel_type: string | null;
    execution_lease_token: string | null;
    execution_lease_expires_at: Date | string | null;
    response_payload: any;
}

interface ApprovalTicketRow {
    id: string;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    expires_at: Date | string;
    approval_source_message_id: string | null;
}

export type ToolApprovalStatus = ApprovalTicketRow['status'];
export type ToolApprovalResumeState = 'not_requested' | 'pending' | 'processing' | 'completed' | 'failed';

export interface ToolApprovalListItem {
    id: string;
    toolName: string;
    contactId: string | null;
    conversationId: string | null;
    status: ToolApprovalStatus;
    request: Record<string, unknown>;
    requestedAt: string;
    expiresAt: string;
    decidedAt: string | null;
    decidedBy: string | null;
    decisionReason: string | null;
    resumeState: ToolApprovalResumeState;
    resumeAttempts: number;
    resumedAt: string | null;
    resumeResult: Record<string, unknown> | null;
    resumeError: string | null;
}

export interface ToolApprovalResumeClaim {
    tenantId: string;
    schemaName: string;
    ticketId: string;
    leaseToken: string;
    toolName: string;
    contactId: string;
    conversationId: string;
    channelType?: string;
    args: Record<string, unknown>;
}

export type ToolApprovalResumeClaimResult =
    | { state: 'claimed'; claim: ToolApprovalResumeClaim }
    | { state: 'completed'; result: Record<string, unknown> }
    | { state: 'in_progress' }
    | { state: 'none' };

export interface ToolApprovalOutboxEvent {
    id: string;
    eventType: string;
    payload: Record<string, unknown>;
    leaseToken: string;
}

type TenantQuery = <T = any[]>(sql: string, params?: any[]) => Promise<T>;

export interface ToolExecutionControlRequest {
    schemaName: string;
    tenantId: string;
    contactId: string;
    conversationId?: string;
    channelType?: string;
    toolName: string;
    args: Record<string, unknown>;
    idempotencyKey?: string;
    readOnlyExecution?: boolean;
    authorityEvidence?: {
        kind: 'booking_engine_confirmation';
        source: 'confirm_yes' | 'flow_response';
    };
}

export type ToolExecutionControlDecision =
    | { allowed: false; result: Record<string, unknown> }
    | {
        allowed: true;
        policy: ToolPolicy;
        ledgerId?: string;
        idempotencyKey?: string;
        executionLeaseToken?: string;
    };

interface ConfirmationClaims {
    version: 1;
    tenantId: string;
    contactId: string;
    conversationId: string;
    ledgerId: string;
    toolName: string;
    argsHash: string;
    sourceMessageId: string;
    issuedAt: string;
    expiresAt: string;
}

/** Exact, deliberately narrow confirmations in the four supported languages. */
export function classifyExplicitToolConfirmation(value: unknown): ConfirmationDisposition {
    if (typeof value !== 'string') return 'unclear';
    const normalized = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[.!¡¿?]+$/g, '')
        .replace(/\s+/g, ' ');
    if (!normalized || normalized.length > 120) return 'unclear';

    if (/^(no|no lo hagas|cancelar|cancela|rechazo|nao|nao faca|annuler|non|je refuse)$/.test(normalized)) {
        return 'rejected';
    }
    if (/^(si|confirmo|si confirmo|autorizo|si autorizo|dale|hazlo|ok|okay|yes|i confirm|confirm|go ahead|sim|confirmo sim|autorizo sim|pode fazer|oui|je confirme|confirme|allez-y)$/.test(normalized)) {
        return 'confirmed';
    }
    return 'unclear';
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([key]) => !['_control', 'confirmationToken', 'approvalTicketId'].includes(key))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, stableValue(item)]),
        );
    }
    return value;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function base64Url(value: Buffer | string): string {
    return Buffer.from(value).toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function fromBase64Url(value: string): Buffer {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    return Buffer.from(padded, 'base64');
}

/**
 * Central authority boundary executed before AIToolExecutor's handler switch.
 * Domain handlers keep their own CAS/transactions; this service supplies the
 * cross-cutting assurance, confirmation, approval and retry ledger.
 */
@Injectable()
export class ToolExecutionControlService {
    private readonly logger = new Logger(ToolExecutionControlService.name);
    private readonly initializedSchemas = new Map<string, Promise<void>>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
        private readonly chatIdentity: ChatIdentityService,
        private readonly redis: RedisService,
    ) {}

    async decideApprovalTicket(input: {
        tenantId: string;
        ticketId: string;
        actorId: string;
        decision: 'approved' | 'rejected';
        reason?: string;
    }): Promise<{
        tenantId: string;
        schemaName: string;
        ticketId: string;
        status: 'approved' | 'rejected';
        decidedBy: string;
        decidedAt: string;
        idempotentReplay?: boolean;
    }> {
        if (!UUID_RE.test(input.tenantId) || !UUID_RE.test(input.ticketId) || !UUID_RE.test(input.actorId)) {
            throw new NotFoundException('Approval ticket not found');
        }
        const schemaName = await this.prisma.getTenantSchemaName(input.tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        await this.ensureControlTables(schemaName);

        const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) : null;
        const decision: any = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const existing = await query<Array<{
                id: string;
                execution_ledger_id: string;
                tool_name: string;
                contact_id: string | null;
                conversation_id: string | null;
                status: ToolApprovalStatus;
                expires_at: Date | string;
                approval_source_message_id: string | null;
                resume_state: ToolApprovalResumeState;
                decided_by: string | null;
                decided_at: Date | string | null;
            }>>(
                `SELECT id, execution_ledger_id, tool_name, contact_id, conversation_id,
                        status, expires_at, approval_source_message_id,
                        resume_state, decided_by, decided_at
                   FROM tool_approval_tickets
                  WHERE id = $1::uuid
                  FOR UPDATE`,
                [input.ticketId],
            );
            const ticket = existing[0];
            if (!ticket) throw new NotFoundException('Approval ticket not found');

            const decisionCanStillTriggerExecution = ticket.status === 'pending'
                || (ticket.status === 'approved'
                    && ['not_requested', 'pending', 'failed'].includes(ticket.resume_state));
            if (decisionCanStillTriggerExecution
                && await this.hasNewInboundSinceApproval(
                    query,
                    ticket.conversation_id,
                    ticket.approval_source_message_id,
                )) {
                await this.closeStaleApprovalWithQuery(query, ticket);
                return { stale: true };
            }
            if (ticket.status === input.decision && ticket.decided_at && ticket.decided_by) {
                return { ...ticket, idempotentReplay: true };
            }
            if (ticket.status !== 'pending') {
                throw new ConflictException('Approval ticket is no longer pending');
            }
            if (new Date(ticket.expires_at).getTime() <= Date.now()) {
                const expiredResult = {
                    error: 'approval_expired',
                    message: 'La aprobación humana venció. Solicita una nueva revisión.',
                };
                await query(
                    `UPDATE tool_approval_tickets
                        SET status = 'expired', resume_state = 'not_requested', updated_at = NOW()
                      WHERE id = $1::uuid AND status = 'pending'`,
                    [input.ticketId],
                );
                await query(
                    `UPDATE tool_execution_ledger
                        SET status = 'failed', response_payload = $2::jsonb,
                            last_error_code = 'approval_expired', completed_at = NOW(), updated_at = NOW()
                      WHERE id = $1::uuid AND status = 'awaiting_approval'`,
                    [ticket.execution_ledger_id, JSON.stringify(expiredResult)],
                );
                await this.insertApprovalOutboxWithQuery(query, ticket.id, 'tool.approval.expired', {
                    ticketId: ticket.id,
                    toolName: ticket.tool_name,
                    contactId: ticket.contact_id,
                    conversationId: ticket.conversation_id,
                });
                return { expired: true };
            }

            const rows = await query<Array<{
                id: string;
                status: 'approved' | 'rejected';
                decided_by: string;
                decided_at: Date | string;
            }>>(
                `UPDATE tool_approval_tickets
                    SET status = $2, decided_by = $3::uuid, decided_at = NOW(),
                        decision_reason = $4,
                        resume_state = CASE WHEN $2 = 'approved' THEN 'pending' ELSE 'not_requested' END,
                        next_resume_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE next_resume_at END,
                        updated_at = NOW()
                  WHERE id = $1::uuid AND status = 'pending'
                  RETURNING id, status, decided_by, decided_at`,
                [input.ticketId, input.decision, input.actorId, reason],
            );
            const updated = rows[0];
            if (!updated) throw new ConflictException('Approval ticket is no longer pending');

            if (input.decision === 'rejected') {
                const rejectedResult = {
                    error: 'approval_rejected',
                    message: 'Una persona autorizada rechazó la acción.',
                };
                await query(
                    `UPDATE tool_execution_ledger
                        SET status = 'rejected', response_payload = $2::jsonb,
                            last_error_code = 'approval_rejected', completed_at = NOW(), updated_at = NOW()
                      WHERE id = $1::uuid AND status = 'awaiting_approval'`,
                    [ticket.execution_ledger_id, JSON.stringify(rejectedResult)],
                );
            }
            await this.insertApprovalOutboxWithQuery(
                query,
                ticket.id,
                `tool.approval.${input.decision}`,
                {
                    ticketId: ticket.id,
                    toolName: ticket.tool_name,
                    contactId: ticket.contact_id,
                    conversationId: ticket.conversation_id,
                    decidedBy: input.actorId,
                },
            );
            return { ...updated, idempotentReplay: false };
        });
        if (decision.expired) throw new ConflictException('Approval ticket expired');
        if (decision.stale) throw new ConflictException('Approval ticket is stale due to a newer inbound message');

        return {
            tenantId: input.tenantId,
            schemaName,
            ticketId: decision.id,
            status: decision.status as 'approved' | 'rejected',
            decidedBy: decision.decided_by as string,
            decidedAt: new Date(decision.decided_at as Date | string).toISOString(),
            ...(decision.idempotentReplay ? { idempotentReplay: true } : {}),
        };
    }

    async listApprovalTickets(input: {
        tenantId: string;
        status?: ToolApprovalStatus;
        limit?: number;
    }): Promise<ToolApprovalListItem[]> {
        if (!UUID_RE.test(input.tenantId)) throw new NotFoundException('Tenant not found');
        const schemaName = await this.prisma.getTenantSchemaName(input.tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        await this.ensureControlTables(schemaName);
        const allowedStatuses = new Set<ToolApprovalStatus>(['pending', 'approved', 'rejected', 'expired']);
        if (input.status && !allowedStatuses.has(input.status)) {
            throw new BadRequestException('Unknown approval status');
        }
        const limit = Math.max(1, Math.min(100, Number.isInteger(input.limit) ? Number(input.limit) : 50));
        const params: any[] = [];
        let where = '';
        if (input.status) {
            params.push(input.status);
            where = `WHERE t.status = $1`;
        }
        params.push(limit);
        const rows = await this.query<any[]>(
            schemaName,
            `SELECT t.id, t.tool_name, t.contact_id, t.conversation_id, t.status,
                    t.requested_at, t.expires_at, t.decided_at, t.decided_by,
                    t.decision_reason, t.resume_state, t.resume_attempts,
                    t.resumed_at, t.resume_result, t.resume_error,
                    l.request_payload
               FROM tool_approval_tickets t
               JOIN tool_execution_ledger l ON l.id = t.execution_ledger_id
               ${where}
              ORDER BY CASE WHEN t.status = 'pending' THEN 0 ELSE 1 END,
                       t.requested_at DESC, t.id DESC
              LIMIT $${params.length}`,
            params,
        );
        return (rows || []).map((row) => ({
            id: row.id,
            toolName: row.tool_name,
            contactId: row.contact_id || null,
            conversationId: row.conversation_id || null,
            status: row.status,
            request: this.approvalRequestFromPayload(row.request_payload),
            requestedAt: new Date(row.requested_at).toISOString(),
            expiresAt: new Date(row.expires_at).toISOString(),
            decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
            decidedBy: row.decided_by || null,
            decisionReason: row.decision_reason || null,
            resumeState: row.resume_state || 'not_requested',
            resumeAttempts: Number(row.resume_attempts || 0),
            resumedAt: row.resumed_at ? new Date(row.resumed_at).toISOString() : null,
            resumeResult: row.resume_result && typeof row.resume_result === 'object' ? row.resume_result : null,
            resumeError: row.resume_error || null,
        }));
    }

    async claimApprovalResume(input: {
        tenantId: string;
        ticketId?: string;
    }): Promise<ToolApprovalResumeClaimResult> {
        if (!UUID_RE.test(input.tenantId) || (input.ticketId && !UUID_RE.test(input.ticketId))) {
            throw new NotFoundException('Approval ticket not found');
        }
        const schemaName = await this.prisma.getTenantSchemaName(input.tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        await this.ensureControlTables(schemaName);
        const leaseToken = randomUUID();

        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const params: any[] = [];
            let predicate = `t.status = 'approved'
                AND (
                    t.resume_state IN ('pending', 'failed', 'not_requested')
                    OR (t.resume_state = 'processing' AND t.resume_lease_expires_at < NOW())
                )
                AND t.next_resume_at <= NOW()`;
            if (input.ticketId) {
                params.push(input.ticketId);
                predicate = `t.id = $1::uuid`;
            }
            const rows = await query<any[]>(
                `SELECT t.id AS ticket_id, t.status AS ticket_status, t.expires_at,
                        t.resume_state, t.resume_attempts, t.resume_lease_expires_at,
                        t.approval_source_message_id,
                        t.resume_result, t.resume_error,
                        l.id AS ledger_id, l.tool_name, l.contact_id, l.conversation_id,
                        l.args_hash, l.request_payload, l.channel_type,
                        l.status AS ledger_status, l.response_payload
                   FROM tool_approval_tickets t
                   JOIN tool_execution_ledger l ON l.id = t.execution_ledger_id
                  WHERE ${predicate}
                  ORDER BY t.next_resume_at, t.requested_at
                  FOR UPDATE OF t, l SKIP LOCKED
                  LIMIT 1`,
                params,
            );
            const row = rows[0];
            if (!row) {
                if (input.ticketId) {
                    const current = await query<any[]>(
                        `SELECT status, resume_state, resume_result, resume_lease_expires_at
                           FROM tool_approval_tickets WHERE id = $1::uuid LIMIT 1`,
                        [input.ticketId],
                    );
                    if (!current[0]) throw new NotFoundException('Approval ticket not found');
                    if (current[0].resume_state === 'completed') {
                        return {
                            state: 'completed' as const,
                            result: this.recordPayload(current[0].resume_result),
                        };
                    }
                    if (current[0].status !== 'approved') {
                        throw new ConflictException('Approval ticket is not approved');
                    }
                    return { state: 'in_progress' as const };
                }
                return { state: 'none' as const };
            }

            if (row.ticket_status !== 'approved') {
                if (input.ticketId) throw new ConflictException('Approval ticket is not approved');
                return { state: 'none' as const };
            }
            const terminalStatuses = new Set([
                'succeeded', 'failed', 'handoff_required', 'reconciliation_required', 'rejected',
            ]);
            if (!terminalStatuses.has(row.ledger_status)
                && await this.hasNewInboundSinceApproval(
                    query,
                    row.conversation_id,
                    row.approval_source_message_id,
                )) {
                const result = await this.closeStaleApprovalWithQuery(query, {
                    id: row.ticket_id,
                    execution_ledger_id: row.ledger_id,
                    tool_name: row.tool_name,
                    contact_id: row.contact_id,
                    conversation_id: row.conversation_id,
                });
                return { state: 'completed' as const, result };
            }
            if (terminalStatuses.has(row.ledger_status)) {
                const result = this.recordPayload(row.response_payload);
                await query(
                    `UPDATE tool_approval_tickets
                        SET resume_state = 'completed', resumed_at = COALESCE(resumed_at, NOW()),
                            resume_result = $2::jsonb, resume_error = NULL,
                            resume_lease_token = NULL, resume_lease_expires_at = NULL,
                            updated_at = NOW()
                      WHERE id = $1::uuid`,
                    [row.ticket_id, JSON.stringify(result)],
                );
                await this.insertApprovalOutboxWithQuery(query, row.ticket_id, 'tool.approval.resumed', {
                    ticketId: row.ticket_id,
                    toolName: row.tool_name,
                    contactId: row.contact_id,
                    conversationId: row.conversation_id,
                    ledgerStatus: row.ledger_status,
                });
                return { state: 'completed' as const, result };
            }
            if (row.resume_state === 'processing'
                && row.resume_lease_expires_at
                && new Date(row.resume_lease_expires_at).getTime() > Date.now()) {
                return { state: 'in_progress' as const };
            }
            const attempts = Number(row.resume_attempts || 0);
            if (attempts >= APPROVAL_RESUME_MAX_ATTEMPTS) {
                const result = {
                    error: 'approval_resume_exhausted',
                    message: 'La acción aprobada requiere revisión operativa; no se volverá a ejecutar automáticamente.',
                    shouldHandoff: true,
                };
                await query(
                    `UPDATE tool_approval_tickets
                        SET resume_state = 'failed', resume_result = $2::jsonb,
                            resume_error = 'approval_resume_exhausted', updated_at = NOW()
                      WHERE id = $1::uuid`,
                    [row.ticket_id, JSON.stringify(result)],
                );
                await this.insertApprovalOutboxWithQuery(query, row.ticket_id, 'tool.approval.resume_failed', {
                    ticketId: row.ticket_id,
                    toolName: row.tool_name,
                    contactId: row.contact_id,
                    conversationId: row.conversation_id,
                    error: 'approval_resume_exhausted',
                });
                return { state: 'completed' as const, result };
            }
            if (!row.contact_id || !row.conversation_id) {
                const result = {
                    error: 'approval_resume_context_missing',
                    message: 'El contacto o la conversación ya no están disponibles.',
                    shouldHandoff: true,
                };
                await query(
                    `UPDATE tool_approval_tickets
                        SET resume_state = 'failed', resume_result = $2::jsonb,
                            resume_error = 'approval_resume_context_missing', updated_at = NOW()
                      WHERE id = $1::uuid`,
                    [row.ticket_id, JSON.stringify(result)],
                );
                return { state: 'completed' as const, result };
            }

            const args = this.approvalRequestFromPayload(row.request_payload);
            const actualHash = sha256(JSON.stringify(stableValue(args)));
            if (actualHash !== row.args_hash) {
                const result = {
                    error: 'approval_resume_payload_mismatch',
                    message: 'La solicitud aprobada no coincide con el ledger y no puede ejecutarse.',
                    shouldHandoff: true,
                };
                await query(
                    `UPDATE tool_approval_tickets
                        SET resume_state = 'failed', resume_result = $2::jsonb,
                            resume_error = 'approval_resume_payload_mismatch', updated_at = NOW()
                      WHERE id = $1::uuid`,
                    [row.ticket_id, JSON.stringify(result)],
                );
                await this.insertApprovalOutboxWithQuery(query, row.ticket_id, 'tool.approval.resume_failed', {
                    ticketId: row.ticket_id,
                    toolName: row.tool_name,
                    contactId: row.contact_id,
                    conversationId: row.conversation_id,
                    error: 'approval_resume_payload_mismatch',
                });
                return { state: 'completed' as const, result };
            }

            const claimed = await query<any[]>(
                `UPDATE tool_approval_tickets
                    SET resume_state = 'processing', resume_attempts = resume_attempts + 1,
                        resume_lease_token = $2::uuid,
                        resume_lease_expires_at = NOW() + make_interval(secs => $3),
                        resume_error = NULL, updated_at = NOW()
                  WHERE id = $1::uuid
                  RETURNING id`,
                [row.ticket_id, leaseToken, APPROVAL_RESUME_LEASE_SECONDS],
            );
            if (!claimed[0]) return { state: 'in_progress' as const };
            return {
                state: 'claimed' as const,
                claim: {
                    tenantId: input.tenantId,
                    schemaName,
                    ticketId: row.ticket_id,
                    leaseToken,
                    toolName: row.tool_name,
                    contactId: row.contact_id,
                    conversationId: row.conversation_id,
                    channelType: row.channel_type || undefined,
                    args,
                },
            };
        });
    }

    async finishApprovalResume(
        claim: ToolApprovalResumeClaim,
        resultInput: Record<string, unknown>,
    ): Promise<{ state: 'completed' | 'pending' | 'in_progress'; result: Record<string, unknown> }> {
        const result = this.recordPayload(resultInput);
        return this.prisma.transactionInTenantSchema(claim.schemaName, async (query) => {
            const rows = await query<any[]>(
                `SELECT t.resume_attempts, t.resume_state, t.resume_lease_token,
                        l.status AS ledger_status, l.response_payload
                   FROM tool_approval_tickets t
                   JOIN tool_execution_ledger l ON l.id = t.execution_ledger_id
                  WHERE t.id = $1::uuid
                  FOR UPDATE OF t, l`,
                [claim.ticketId],
            );
            const row = rows[0];
            if (!row || row.resume_lease_token !== claim.leaseToken || row.resume_state !== 'processing') {
                return { state: 'in_progress' as const, result };
            }
            const terminalStatuses = new Set([
                'succeeded', 'failed', 'handoff_required', 'reconciliation_required', 'rejected',
            ]);
            if (terminalStatuses.has(row.ledger_status)) {
                const committedResult = this.recordPayload(row.response_payload || result);
                await query(
                    `UPDATE tool_approval_tickets
                        SET resume_state = 'completed', resumed_at = NOW(),
                            resume_result = $3::jsonb, resume_error = NULL,
                            resume_lease_token = NULL, resume_lease_expires_at = NULL,
                            updated_at = NOW()
                      WHERE id = $1::uuid AND resume_lease_token = $2::uuid`,
                    [claim.ticketId, claim.leaseToken, JSON.stringify(committedResult)],
                );
                await this.insertApprovalOutboxWithQuery(query, claim.ticketId, 'tool.approval.resumed', {
                    ticketId: claim.ticketId,
                    toolName: claim.toolName,
                    contactId: claim.contactId,
                    conversationId: claim.conversationId,
                    ledgerStatus: row.ledger_status,
                });
                return { state: 'completed' as const, result: committedResult };
            }

            const attempts = Number(row.resume_attempts || 1);
            const exhausted = attempts >= APPROVAL_RESUME_MAX_ATTEMPTS;
            const error = typeof result.error === 'string' ? result.error : 'approval_resume_not_committed';
            const delaySeconds = Math.min(3600, 2 ** Math.min(attempts, 8) * 15);
            await query(
                `UPDATE tool_approval_tickets
                    SET resume_state = 'failed', resume_result = $3::jsonb,
                        resume_error = $4, next_resume_at = NOW() + make_interval(secs => $5),
                        resume_lease_token = NULL, resume_lease_expires_at = NULL,
                        updated_at = NOW()
                  WHERE id = $1::uuid AND resume_lease_token = $2::uuid`,
                [claim.ticketId, claim.leaseToken, JSON.stringify(result), error.slice(0, 160), delaySeconds],
            );
            if (exhausted) {
                await this.insertApprovalOutboxWithQuery(query, claim.ticketId, 'tool.approval.resume_failed', {
                    ticketId: claim.ticketId,
                    toolName: claim.toolName,
                    contactId: claim.contactId,
                    conversationId: claim.conversationId,
                    error: error.slice(0, 160),
                });
            }
            return { state: exhausted ? 'completed' as const : 'pending' as const, result };
        });
    }

    async claimApprovalOutboxEvents(
        schemaName: string,
        limit = 25,
    ): Promise<ToolApprovalOutboxEvent[]> {
        await this.ensureControlTables(schemaName);
        const leaseToken = randomUUID();
        const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
        const rows = await this.prisma.transactionInTenantSchema(schemaName, async (query) => query<any[]>(
            `WITH due AS (
                SELECT id
                  FROM tool_approval_outbox
                 WHERE (status IN ('pending', 'failed') AND next_attempt_at <= NOW())
                    OR (status = 'processing'
                        AND (lease_expires_at IS NULL OR lease_expires_at <= NOW()))
                 ORDER BY created_at
                 FOR UPDATE SKIP LOCKED
                 LIMIT $1
             )
             UPDATE tool_approval_outbox o
                SET status = 'processing', attempts = o.attempts + 1,
                    lease_token = $2::uuid,
                    lease_expires_at = NOW() + INTERVAL '60 seconds', updated_at = NOW()
               FROM due
              WHERE o.id = due.id
              RETURNING o.id, o.event_type, o.payload`,
            [boundedLimit, leaseToken],
        ));
        return (rows || []).map((row) => ({
            id: row.id,
            eventType: row.event_type,
            payload: this.recordPayload(row.payload),
            leaseToken,
        }));
    }

    async finishApprovalOutboxEvent(
        schemaName: string,
        event: ToolApprovalOutboxEvent,
        error?: unknown,
    ): Promise<void> {
        if (!error) {
            await this.query(
                schemaName,
                `UPDATE tool_approval_outbox
                    SET status = 'published', published_at = NOW(),
                        lease_token = NULL, lease_expires_at = NULL, last_error = NULL,
                        updated_at = NOW()
                  WHERE id = $1::uuid AND lease_token = $2::uuid AND status = 'processing'`,
                [event.id, event.leaseToken],
            );
            return;
        }
        const message = String((error as any)?.message || error || 'approval_event_publish_failed').slice(0, 500);
        await this.query(
            schemaName,
            `UPDATE tool_approval_outbox
                SET status = 'failed', next_attempt_at = NOW() + make_interval(secs => LEAST(3600, attempts * 30)),
                    lease_token = NULL, lease_expires_at = NULL, last_error = $3,
                    updated_at = NOW()
              WHERE id = $1::uuid AND lease_token = $2::uuid AND status = 'processing'`,
            [event.id, event.leaseToken, message],
        );
    }

    async preflight(request: ToolExecutionControlRequest): Promise<ToolExecutionControlDecision> {
        const policy = getToolPolicy(request.toolName);
        if (!policy) return this.block('unknown_tool', 'La herramienta no está registrada.');
        if (request.toolName.startsWith('mcp__')) {
            return this.block(
                'opaque_tool_not_approved',
                'La herramienta externa no tiene controles revisados y no puede ejecutarse.',
                true,
            );
        }
        if (policy.assuranceEnforcement === 'missing'
            || policy.idempotency === 'missing'
            || policy.confirmation === 'required_missing'
            || policy.humanApproval === 'required_missing') {
            return this.block(
                'tool_controls_incomplete',
                'La acción no tiene todos los controles de seguridad requeridos.',
                true,
            );
        }

        // Agent Test's persistence-disabled path has its own static allowlist
        // and audited read-only handler modes. The central guard must not turn
        // those reads back into writes by creating ledgers or sending OTPs.
        if (request.readOnlyExecution) {
            return policy.agentTestAllowed
                ? { allowed: true, policy }
                : this.block('read_only_tool_blocked', 'La herramienta no está permitida en ejecución de solo lectura.');
        }

        const assurance = ASSURANCE_LEVEL_MATRIX[policy.assurance];
        if (assurance.requiresContactContext && !UUID_RE.test(request.contactId)) {
            return this.block(
                'contact_context_required',
                'La acción requiere un contacto válido vinculado a esta conversación.',
            );
        }

        if (assurance.requiresStepUpIdentity) {
            const identityGate = await this.requireStepUpIdentity(request);
            if (identityGate) return { allowed: false, result: identityGate };
        }

        if (policy.effect === 'read') return { allowed: true, policy };
        if (!request.conversationId || !UUID_RE.test(request.conversationId)) {
            return this.block(
                'conversation_context_required',
                'La acción requiere una conversación válida para confirmar y deduplicar el cambio.',
            );
        }

        await this.ensureControlTables(request.schemaName);
        const canonicalArgs = JSON.stringify(stableValue(request.args));
        const argsHash = sha256(canonicalArgs);
        const needsConfirmation = policy.confirmation === 'runtime_enforced';
        const latestInbound = await this.latestInboundMessage(request.schemaName, request.conversationId);
        if (!latestInbound) {
            return this.block('idempotency_source_missing', 'No hay un mensaje de origen para vincular la acción.');
        }

        let ledger = await this.findContinuableLedger(request, argsHash, latestInbound.id);
        const idempotencyKey = ledger?.idempotency_key
            || this.buildIdempotencyKey(request, argsHash, latestInbound.id);
        if (!ledger) {
            ledger = await this.createOrLoadLedger(
                request,
                policy.assurance,
                idempotencyKey,
                argsHash,
                canonicalArgs,
                latestInbound.id,
                needsConfirmation,
            );
        }
        if (!ledger
            || ledger.tool_name !== request.toolName
            || ledger.args_hash !== argsHash
            || ledger.contact_id !== request.contactId
            || ledger.conversation_id !== request.conversationId) {
            return this.block(
                'idempotency_conflict',
                'La clave de idempotencia ya pertenece a otra operación.',
                true,
            );
        }

        ledger = await this.failClosedExpiredExecution(request.schemaName, ledger);

        const terminal = this.terminalLedgerResult(ledger);
        if (terminal) return terminal;

        if (needsConfirmation && !ledger.confirmed_at) {
            const bookingConfirmation = request.authorityEvidence
                ? await this.resolveBookingAuthorityEvidence(request, ledger, argsHash, latestInbound)
                : null;
            const confirmation = bookingConfirmation
                || await this.resolveConfirmation(request, ledger, argsHash);
            if (!confirmation.allowed) return confirmation;
            ledger = confirmation.ledger;
        }

        const needsApproval = policy.humanApproval === 'runtime_enforced'
            || (ASSURANCE_LEVEL_MATRIX[policy.assurance].humanApproval === 'writes');
        if (needsApproval) {
            const approval = await this.resolveApproval(request, ledger);
            if (!approval.allowed) return approval;
            ledger = approval.ledger;
        }

        const executionLeaseToken = randomUUID();
        const acquired = await this.query<ExecutionLedgerRow[]>(
            request.schemaName,
            `UPDATE tool_execution_ledger
                SET status = 'executing', attempt_count = attempt_count + 1,
                    execution_lease_token = $2::uuid,
                    execution_lease_expires_at = NOW() + make_interval(secs => $3),
                    updated_at = NOW()
              WHERE id = $1::uuid
                AND status IN ('ready', 'awaiting_confirmation', 'awaiting_approval')
                AND (
                    assurance_level <> 'A4'
                    OR EXISTS (
                        SELECT 1
                          FROM tool_approval_tickets ticket
                          JOIN messages source
                            ON source.id = ticket.approval_source_message_id
                           AND source.conversation_id = ticket.conversation_id
                           AND source.direction = 'inbound'
                         WHERE ticket.id = tool_execution_ledger.approval_ticket_id
                           AND ticket.status = 'approved'
                           AND NOT EXISTS (
                               SELECT 1
                                 FROM messages newer
                                WHERE newer.conversation_id = ticket.conversation_id
                                  AND newer.direction = 'inbound'
                                  AND (newer.created_at, newer.id::text)
                                      > (source.created_at, source.id::text)
                           )
                    )
                )
              RETURNING *`,
            [ledger.id, executionLeaseToken, EXECUTION_LEASE_SECONDS],
        );
        if (!acquired[0]) {
            if (ledger.assurance_level === 'A4' && ledger.approval_ticket_id) {
                await this.expireApprovalIfStale(request.schemaName, ledger.approval_ticket_id);
            }
            const current = await this.loadLedger(request.schemaName, ledger.id);
            return this.terminalLedgerResult(current) || this.block(
                'operation_in_progress',
                'La operación ya está siendo procesada. No la repitas.',
            );
        }

        return {
            allowed: true,
            policy,
            ledgerId: ledger.id,
            idempotencyKey,
            executionLeaseToken,
        };
    }

    async complete(
        schemaName: string,
        decision: ToolExecutionControlDecision,
        result: Record<string, unknown>,
    ): Promise<void> {
        if (!decision.allowed || !decision.ledgerId) return;
        if (!decision.executionLeaseToken) throw new Error('tool_execution_lease_missing');
        const status = result?.shouldHandoff === true
            ? 'handoff_required'
            : result?.error
                ? 'failed'
                : 'succeeded';
        const updated = await this.query<Array<{ id: string }>>(
            schemaName,
            `UPDATE tool_execution_ledger
                SET status = $2, response_payload = $3::jsonb, completed_at = NOW(),
                    execution_lease_token = NULL, execution_lease_expires_at = NULL,
                    updated_at = NOW()
              WHERE id = $1::uuid AND status = 'executing'
                AND execution_lease_token = $4::uuid
                AND execution_lease_expires_at > NOW()
              RETURNING id`,
            [decision.ledgerId, status, JSON.stringify(result ?? {}), decision.executionLeaseToken],
        );
        if (updated[0]) return;

        const current = await this.loadLedger(schemaName, decision.ledgerId);
        const reconciled = await this.failClosedExpiredExecution(schemaName, current);
        if (['succeeded', 'failed', 'handoff_required', 'reconciliation_required', 'rejected'].includes(reconciled.status)) {
            if (reconciled.status === status
                && JSON.stringify(this.recordPayload(reconciled.response_payload)) === JSON.stringify(result ?? {})) {
                return;
            }
        }
        throw new Error('tool_execution_lease_expired_or_lost');
    }

    async fail(
        schemaName: string,
        decision: ToolExecutionControlDecision | undefined,
        errorCode: string,
    ): Promise<void> {
        if (!decision?.allowed || !decision.ledgerId) return;
        const status = decision.policy.externalEffect === 'none' ? 'failed' : 'reconciliation_required';
        const failureResult = {
            error: status === 'reconciliation_required' ? 'reconciliation_required' : errorCode,
            message: status === 'reconciliation_required'
                ? 'El resultado de la acción es incierto y requiere reconciliación humana.'
                : 'La acción no pudo completarse.',
            ...(status === 'reconciliation_required' ? { shouldHandoff: true } : {}),
        };
        await this.query(
            schemaName,
            `UPDATE tool_execution_ledger
                SET status = CASE
                        WHEN execution_lease_expires_at IS NULL OR execution_lease_expires_at <= NOW()
                            THEN 'reconciliation_required'
                        ELSE $2
                    END,
                    response_payload = CASE
                        WHEN execution_lease_expires_at IS NULL OR execution_lease_expires_at <= NOW()
                            THEN $5::jsonb
                        ELSE $4::jsonb
                    END,
                    last_error_code = CASE
                        WHEN execution_lease_expires_at IS NULL OR execution_lease_expires_at <= NOW()
                            THEN 'execution_lease_expired'
                        ELSE $3
                    END,
                    completed_at = NOW(), execution_lease_token = NULL,
                    execution_lease_expires_at = NULL, updated_at = NOW()
              WHERE id = $1::uuid AND status = 'executing'
                AND ($6::uuid IS NULL OR execution_lease_token = $6::uuid)`,
            [
                decision.ledgerId,
                status,
                errorCode.slice(0, 80),
                JSON.stringify(failureResult),
                JSON.stringify(this.executionLeaseExpiredResult()),
                decision.executionLeaseToken || null,
            ],
        );
    }

    /**
     * A worker may die after the domain side effect and before `complete`.
     * Expired leases therefore become an explicit reconciliation obligation;
     * they are never moved back to `ready` or executed automatically again.
     */
    async reconcileExpiredExecutionLeases(schemaName: string): Promise<number> {
        await this.ensureControlTables(schemaName);
        const rows = await this.query<Array<{ id: string }>>(
            schemaName,
            `UPDATE tool_execution_ledger
                SET status = 'reconciliation_required',
                    response_payload = $1::jsonb,
                    last_error_code = 'execution_lease_expired', completed_at = NOW(),
                    execution_lease_token = NULL, execution_lease_expires_at = NULL,
                    updated_at = NOW()
              WHERE status = 'executing'
                AND (execution_lease_expires_at IS NULL OR execution_lease_expires_at <= NOW())
              RETURNING id`,
            [JSON.stringify(this.executionLeaseExpiredResult())],
        );
        return rows.length;
    }

    /**
     * Pending human approvals have no request path that is guaranteed to touch
     * them again. Recovery therefore closes expired tickets and their waiting
     * ledgers as one tenant transaction, and records one durable event per
     * ticket. Row locks plus the pending-status CAS make concurrent/repeated
     * sweeps idempotent.
     */
    async expirePendingApprovalTickets(schemaName: string): Promise<number> {
        await this.ensureControlTables(schemaName);
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const expired = await query<Array<{
                ticket_id: string;
                ledger_id: string;
                tool_name: string;
                contact_id: string | null;
                conversation_id: string | null;
                expires_at: Date | string;
            }>>(
                `SELECT t.id AS ticket_id, t.execution_ledger_id AS ledger_id,
                        t.tool_name, t.contact_id, t.conversation_id, t.expires_at
                   FROM tool_approval_tickets t
                   JOIN tool_execution_ledger l ON l.id = t.execution_ledger_id
                  WHERE t.status = 'pending' AND t.expires_at <= NOW()
                  ORDER BY t.expires_at, t.id
                  FOR UPDATE OF t, l SKIP LOCKED
                  LIMIT $1`,
                [APPROVAL_EXPIRY_SWEEP_BATCH],
            );
            const result = {
                error: 'approval_expired',
                message: 'La aprobación humana venció. Solicita una nueva revisión.',
            };
            let transitioned = 0;
            for (const row of expired || []) {
                const tickets = await query<Array<{ id: string }>>(
                    `UPDATE tool_approval_tickets
                        SET status = 'expired', resume_state = 'not_requested',
                            resume_lease_token = NULL, resume_lease_expires_at = NULL,
                            updated_at = NOW()
                      WHERE id = $1::uuid AND status = 'pending' AND expires_at <= NOW()
                      RETURNING id`,
                    [row.ticket_id],
                );
                if (!tickets[0]) continue;

                await query(
                    `UPDATE tool_execution_ledger
                        SET status = 'failed', response_payload = $2::jsonb,
                            last_error_code = 'approval_expired', completed_at = NOW(),
                            updated_at = NOW()
                      WHERE id = $1::uuid AND status = 'awaiting_approval'`,
                    [row.ledger_id, JSON.stringify(result)],
                );
                await this.insertApprovalOutboxWithQuery(
                    query,
                    row.ticket_id,
                    'tool.approval.expired',
                    {
                        ticketId: row.ticket_id,
                        toolName: row.tool_name,
                        contactId: row.contact_id,
                        conversationId: row.conversation_id,
                        expiresAt: new Date(row.expires_at).toISOString(),
                    },
                );
                transitioned += 1;
            }
            return transitioned;
        });
    }

    private async requireStepUpIdentity(
        request: ToolExecutionControlRequest,
    ): Promise<Record<string, unknown> | null> {
        if (!request.conversationId || !UUID_RE.test(request.conversationId)) {
            return {
                error: 'identity_context_required',
                message: 'Esta gestión sensible requiere una conversación vinculada y verificación de identidad.',
            };
        }
        if (await this.chatIdentity.isVerified(request.conversationId, request.contactId)) return null;

        const started = await this.chatIdentity.startVerification(
            request.tenantId,
            request.schemaName,
            request.contactId,
            request.conversationId,
            request.channelType || '',
        );
        if (started.status === 'already_verified') return null;
        if (started.status === 'no_channel') {
            return {
                error: 'identity_unverifiable',
                message: 'No hay un canal independiente para verificar la identidad. Escala la gestión a una persona.',
                shouldHandoff: true,
            };
        }
        return {
            error: 'identity_verification_required',
            needsVerification: true,
            sentVia: started.status === 'sent' ? started.via : undefined,
            sentTo: started.status === 'sent' ? started.hint : undefined,
            message: started.status === 'pending'
                ? 'Ya hay una verificación en curso. Solicita el código recibido.'
                : 'Se envió un código por un canal independiente. Verifícalo antes de continuar.',
        };
    }

    /**
     * Continue only a live handshake for the same intent, or replay a terminal
     * result in the same inbound turn. A later inbound message starts a fresh
     * operation, so identical legitimate actions are not deduplicated forever.
     */
    private async findContinuableLedger(
        request: ToolExecutionControlRequest & { conversationId?: string },
        argsHash: string,
        latestInboundMessageId: string,
    ): Promise<ExecutionLedgerRow | null> {
        const supplied = request.idempotencyKey?.trim();
        if (supplied && /^[A-Za-z0-9_.:-]{8,128}$/.test(supplied)) {
            const key = this.buildIdempotencyKey(request, argsHash, latestInboundMessageId);
            const rows = await this.query<ExecutionLedgerRow[]>(
                request.schemaName,
                `SELECT * FROM tool_execution_ledger WHERE idempotency_key = $1 LIMIT 1`,
                [key],
            );
            return rows[0] || null;
        }

        const pending = await this.query<ExecutionLedgerRow[]>(
            request.schemaName,
            `SELECT * FROM tool_execution_ledger
              WHERE conversation_id = $1::uuid
                AND contact_id = $2::uuid
                AND tool_name = $3
                AND args_hash = $4
                AND status IN ('awaiting_confirmation', 'awaiting_approval', 'ready', 'executing')
              ORDER BY created_at DESC
              LIMIT 1`,
            [request.conversationId, request.contactId, request.toolName, argsHash],
        );
        if (pending[0]) return pending[0];

        const sameTurn = await this.query<ExecutionLedgerRow[]>(
            request.schemaName,
            `SELECT * FROM tool_execution_ledger
              WHERE conversation_id = $1::uuid
                AND contact_id = $2::uuid
                AND tool_name = $3
                AND args_hash = $4
                AND (request_source_message_id = $5::uuid OR confirmed_by_message_id = $5::uuid)
              ORDER BY created_at DESC
              LIMIT 1`,
            [request.conversationId, request.contactId, request.toolName, argsHash, latestInboundMessageId],
        );
        return sameTurn[0] || null;
    }

    private async createOrLoadLedger(
        request: ToolExecutionControlRequest,
        assurance: VerticalAssuranceLevel,
        idempotencyKey: string,
        argsHash: string,
        canonicalArgs: string,
        sourceMessageId: string,
        needsConfirmation: boolean,
    ): Promise<ExecutionLedgerRow | null> {
        const inserted = await this.query<ExecutionLedgerRow[]>(
            request.schemaName,
            `INSERT INTO tool_execution_ledger
                (idempotency_key, tool_name, args_hash, contact_id, conversation_id,
                 assurance_level, status, request_source_message_id, request_payload, channel_type)
             VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7, $8::uuid, $9::jsonb, $10)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [
                idempotencyKey,
                request.toolName,
                argsHash,
                request.contactId,
                request.conversationId,
                assurance,
                needsConfirmation ? 'awaiting_confirmation' : 'ready',
                sourceMessageId,
                JSON.stringify({ args: JSON.parse(canonicalArgs) }),
                request.channelType || null,
            ],
        );
        if (inserted[0]) return inserted[0];
        const rows = await this.query<ExecutionLedgerRow[]>(
            request.schemaName,
            `SELECT * FROM tool_execution_ledger WHERE idempotency_key = $1 LIMIT 1`,
            [idempotencyKey],
        );
        return rows[0] || null;
    }

    private async resolveConfirmation(
        request: ToolExecutionControlRequest,
        ledger: ExecutionLedgerRow,
        argsHash: string,
    ): Promise<
        | { allowed: false; result: Record<string, unknown> }
        | { allowed: true; ledger: ExecutionLedgerRow }
    > {
        const conversationId = request.conversationId as string;
        const latest = await this.latestInboundMessage(request.schemaName, conversationId);
        if (!latest) {
            return this.block('confirmation_context_missing', 'No hay un mensaje del cliente que pueda confirmar la acción.');
        }

        const expiresAt = ledger.confirmation_expires_at
            ? new Date(ledger.confirmation_expires_at).getTime()
            : 0;
        if (!ledger.confirmation_token || !ledger.confirmation_source_message_id || expiresAt <= Date.now()) {
            const issued = await this.issueConfirmationToken(
                { ...request, conversationId },
                ledger,
                argsHash,
                latest.id,
            );
            if (!issued) {
                return this.block(
                    'confirmation_signing_unavailable',
                    'No se pudo emitir una confirmación segura. Escala la acción a una persona.',
                    true,
                );
            }
            ledger = issued;
            return this.confirmationRequired(ledger.id);
        }

        if (latest.id === ledger.confirmation_source_message_id) return this.confirmationRequired(ledger.id);
        const disposition = classifyExplicitToolConfirmation(latest.content_text);
        if (disposition === 'rejected') {
            await this.query(
                request.schemaName,
                `UPDATE tool_execution_ledger SET status = 'rejected', updated_at = NOW() WHERE id = $1::uuid`,
                [ledger.id],
            );
            return this.block('action_rejected', 'El cliente rechazó la acción. No la ejecutes.');
        }
        if (disposition !== 'confirmed') return this.confirmationRequired(ledger.id);

        const claims = this.verifyConfirmationToken(ledger.confirmation_token);
        if (!claims
            || claims.tenantId !== request.tenantId
            || claims.contactId !== request.contactId
            || claims.conversationId !== conversationId
            || claims.ledgerId !== ledger.id
            || claims.toolName !== request.toolName
            || claims.argsHash !== argsHash
            || claims.sourceMessageId !== ledger.confirmation_source_message_id
            || new Date(claims.expiresAt).getTime() <= Date.now()) {
            this.logger.warn(`Rejected invalid confirmation token for ledger ${ledger.id}`);
            return this.block(
                'invalid_confirmation_token',
                'La confirmación no es válida o fue alterada. Escala la acción a una persona.',
                true,
            );
        }

        const updated = await this.query<ExecutionLedgerRow[]>(
            request.schemaName,
            `UPDATE tool_execution_ledger
                SET confirmed_at = NOW(), confirmed_by_message_id = $2::uuid,
                    status = 'ready', updated_at = NOW()
              WHERE id = $1::uuid AND confirmed_at IS NULL
              RETURNING *`,
            [ledger.id, latest.id],
        );
        return { allowed: true, ledger: updated[0] || await this.loadLedger(request.schemaName, ledger.id) };
    }

    /**
     * The deterministic BookingEngine already collected confirmation through a
     * server-rendered button/Flow. Accept it only after independently checking
     * the latest inbound message and the previously persisted Redis state.
     */
    private async resolveBookingAuthorityEvidence(
        request: ToolExecutionControlRequest,
        ledger: ExecutionLedgerRow,
        argsHash: string,
        latest: { id: string; content_text: string | null },
    ): Promise<
        | { allowed: false; result: Record<string, unknown> }
        | { allowed: true; ledger: ExecutionLedgerRow }
    > {
        const evidence = request.authorityEvidence;
        const conversationId = request.conversationId as string;
        if (!evidence || request.toolName !== 'create_appointment') {
            return this.block('authority_evidence_invalid', 'La evidencia interna no corresponde a esta acción.', true);
        }
        const expectedInbound = evidence.source === 'confirm_yes' ? 'confirm_yes' : '__flow_response__';
        if (String(latest.content_text || '').trim().toLowerCase() !== expectedInbound) {
            return this.block('authority_evidence_invalid', 'El mensaje de origen no confirma esta reserva.', true);
        }

        const rawState = await this.redis.get(`booking:${conversationId}`).catch(() => null);
        if (!rawState) {
            return this.block('booking_confirmation_state_missing', 'La confirmación de reserva ya no está vigente.', true);
        }
        let state: Record<string, any>;
        try { state = JSON.parse(String(rawState)); } catch {
            return this.block('booking_confirmation_state_invalid', 'El estado de confirmación no es válido.', true);
        }

        const interactive = evidence.source === 'confirm_yes';
        const expectedStep = interactive ? 'confirm' : 'waiting_flow';
        if (state.step !== expectedStep) {
            return this.block('booking_confirmation_state_mismatch', 'La reserva no estaba esperando esta confirmación.', true);
        }
        if (interactive) {
            const boundFields: Array<[unknown, unknown]> = [
                [state.serviceId, request.args.serviceId],
                [state.date, request.args.date],
                [state.time, request.args.time],
                [state.staffId || null, request.args.staffId || null],
                [state.customerName, request.args.customerName],
                [state.customerEmail, request.args.customerEmail],
            ];
            if (boundFields.some(([stored, requested]) => String(stored ?? '') !== String(requested ?? ''))) {
                return this.block('booking_confirmation_args_mismatch', 'La reserva cambió después de ser confirmada.', true);
            }
        } else {
            const startedAt = Date.parse(String(state.flowStartedAt || ''));
            const serviceKnown = Array.isArray(state.services)
                && state.services.some((service: any) => service?.id === request.args.serviceId);
            if (!serviceKnown || !Number.isFinite(startedAt) || Date.now() - startedAt > 3_600_000) {
                return this.block('booking_flow_evidence_expired', 'La respuesta del formulario no está vigente.', true);
            }
        }

        const issued = await this.issueConfirmationToken(
            { ...request, conversationId },
            ledger,
            argsHash,
            latest.id,
        );
        if (!issued) {
            return this.block('confirmation_signing_unavailable', 'No se pudo firmar la confirmación.', true);
        }
        const updated = await this.query<ExecutionLedgerRow[]>(
            request.schemaName,
            `UPDATE tool_execution_ledger
                SET confirmed_at = NOW(), confirmed_by_message_id = $2::uuid,
                    status = 'ready', updated_at = NOW()
              WHERE id = $1::uuid AND confirmed_at IS NULL
              RETURNING *`,
            [ledger.id, latest.id],
        );
        return { allowed: true, ledger: updated[0] || await this.loadLedger(request.schemaName, ledger.id) };
    }

    private async issueConfirmationToken(
        request: ToolExecutionControlRequest & { conversationId: string },
        ledger: ExecutionLedgerRow,
        argsHash: string,
        sourceMessageId: string,
    ): Promise<ExecutionLedgerRow | null> {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS);
        const claims: ConfirmationClaims = {
            version: 1,
            tenantId: request.tenantId,
            contactId: request.contactId,
            conversationId: request.conversationId,
            ledgerId: ledger.id,
            toolName: request.toolName,
            argsHash,
            sourceMessageId,
            issuedAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
        };
        const token = this.signConfirmationToken(claims);
        if (!token) return null;
        const updated = await this.query<ExecutionLedgerRow[]>(
            request.schemaName,
            `UPDATE tool_execution_ledger
                SET confirmation_token = $2,
                    confirmation_source_message_id = $3::uuid,
                    confirmation_expires_at = $4::timestamptz,
                    confirmed_at = NULL,
                    status = 'awaiting_confirmation',
                    updated_at = NOW()
              WHERE id = $1::uuid
              RETURNING *`,
            [ledger.id, token, sourceMessageId, expiresAt.toISOString()],
        );
        return updated[0] || null;
    }

    private async resolveApproval(
        request: ToolExecutionControlRequest,
        ledger: ExecutionLedgerRow,
    ): Promise<
        | { allowed: false; result: Record<string, unknown> }
        | { allowed: true; ledger: ExecutionLedgerRow }
    > {
        let ticket: ApprovalTicketRow | null = null;
        if (ledger.approval_ticket_id) {
            const rows = await this.query<ApprovalTicketRow[]>(
                request.schemaName,
                `SELECT id, status, expires_at, approval_source_message_id
                   FROM tool_approval_tickets WHERE id = $1::uuid LIMIT 1`,
                [ledger.approval_ticket_id],
            );
            ticket = rows[0] || null;
        }
        if (!ticket) {
            const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
            const created = await this.prisma.transactionInTenantSchema(
                request.schemaName,
                async (query) => {
                    const locked = await query<ExecutionLedgerRow[]>(
                        `SELECT * FROM tool_execution_ledger WHERE id = $1::uuid FOR UPDATE`,
                        [ledger.id],
                    );
                    const current = locked[0];
                    if (!current) return null;
                    const rows = await query<ApprovalTicketRow[]>(
                        `INSERT INTO tool_approval_tickets
                            (execution_ledger_id, tool_name, contact_id, conversation_id, status, expires_at,
                             approval_source_message_id)
                         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, 'pending', $5::timestamptz, $6::uuid)
                         ON CONFLICT (execution_ledger_id) DO UPDATE SET updated_at = NOW()
                         RETURNING id, status, expires_at, approval_source_message_id`,
                        [
                            ledger.id,
                            request.toolName,
                            request.contactId,
                            request.conversationId,
                            expiresAt,
                            ledger.confirmed_by_message_id || ledger.request_source_message_id,
                        ],
                    );
                    const createdTicket = rows[0];
                    if (!createdTicket) return null;
                    const updated = await query<ExecutionLedgerRow[]>(
                        `UPDATE tool_execution_ledger
                            SET approval_ticket_id = $2::uuid, status = 'awaiting_approval', updated_at = NOW()
                          WHERE id = $1::uuid
                          RETURNING *`,
                        [ledger.id, createdTicket.id],
                    );
                    await this.insertApprovalOutboxWithQuery(
                        query,
                        createdTicket.id,
                        'tool.approval.requested',
                        {
                            ticketId: createdTicket.id,
                            toolName: request.toolName,
                            contactId: request.contactId,
                            conversationId: request.conversationId,
                            expiresAt,
                        },
                    );
                    return { ticket: createdTicket, ledger: updated[0] || current };
                },
            );
            if (!created) {
                return this.block('approval_ticket_failed', 'No se pudo crear la aprobación humana.', true);
            }
            ticket = created.ticket;
            ledger = created.ledger;
        }

        if ((ticket.status === 'pending' || ticket.status === 'approved')
            && await this.expireApprovalIfStale(request.schemaName, ticket.id)) {
            return this.block(
                'approval_stale_due_to_new_inbound',
                'La conversación cambió después de solicitar la aprobación. Requiere una nueva revisión humana.',
                true,
            );
        }

        if (ticket.status === 'rejected') {
            return this.block('approval_rejected', 'Una persona autorizada rechazó la acción.');
        }
        if (ticket.status === 'approved') {
            const updated = await this.query<ExecutionLedgerRow[]>(
                request.schemaName,
                `UPDATE tool_execution_ledger
                    SET status = 'ready', updated_at = NOW()
                  WHERE id = $1::uuid AND status = 'awaiting_approval'
                  RETURNING *`,
                [ledger.id],
            );
            return { allowed: true, ledger: updated[0] || ledger };
        }
        if (new Date(ticket.expires_at).getTime() <= Date.now() || ticket.status === 'expired') {
            const expiredResult = {
                error: 'approval_expired',
                message: 'La aprobación humana venció. Solicita una nueva revisión.',
            };
            await this.prisma.transactionInTenantSchema(request.schemaName, async (query) => {
                await query(
                    `UPDATE tool_approval_tickets
                        SET status = 'expired', resume_state = 'not_requested', updated_at = NOW()
                      WHERE id = $1::uuid AND status = 'pending'`,
                    [ticket!.id],
                );
                await query(
                    `UPDATE tool_execution_ledger
                        SET status = 'failed', response_payload = $2::jsonb,
                            last_error_code = 'approval_expired', completed_at = NOW(), updated_at = NOW()
                      WHERE id = $1::uuid AND status = 'awaiting_approval'`,
                    [ledger.id, JSON.stringify(expiredResult)],
                );
                await this.insertApprovalOutboxWithQuery(query, ticket!.id, 'tool.approval.expired', {
                    ticketId: ticket!.id,
                    toolName: request.toolName,
                    contactId: request.contactId,
                    conversationId: request.conversationId,
                });
            });
            return this.block('approval_expired', expiredResult.message, true);
        }
        return this.block('approval_required', 'La acción requiere aprobación humana antes de ejecutarse.', true);
    }

    private terminalLedgerResult(ledger: ExecutionLedgerRow | null): ToolExecutionControlDecision | null {
        if (!ledger) return null;
        if (ledger.status === 'succeeded'
            || ledger.status === 'failed'
            || ledger.status === 'handoff_required'
            || ledger.status === 'reconciliation_required') {
            const payload = ledger.response_payload && typeof ledger.response_payload === 'object'
                ? ledger.response_payload
                : {
                    error: ledger.status,
                    message: 'La operación ya tiene un resultado registrado y no se repetirá automáticamente.',
                    shouldHandoff: ledger.status !== 'succeeded',
                };
            return { allowed: false, result: { ...payload, idempotentReplay: true } };
        }
        if (ledger.status === 'executing') {
            return this.block('operation_in_progress', 'La operación ya está en proceso. No la repitas.');
        }
        if (ledger.status === 'rejected') {
            return this.block('action_rejected', 'El cliente rechazó la acción.');
        }
        return null;
    }

    private executionLeaseExpiredResult(): Record<string, unknown> {
        return {
            error: 'execution_lease_expired',
            message: 'El resultado de la acción es incierto y requiere reconciliación humana.',
            shouldHandoff: true,
        };
    }

    private async failClosedExpiredExecution(
        schemaName: string,
        ledger: ExecutionLedgerRow,
    ): Promise<ExecutionLedgerRow> {
        if (ledger.status !== 'executing') return ledger;
        const rows = await this.query<ExecutionLedgerRow[]>(
            schemaName,
            `UPDATE tool_execution_ledger
                SET status = 'reconciliation_required',
                    response_payload = $2::jsonb,
                    last_error_code = 'execution_lease_expired', completed_at = NOW(),
                    execution_lease_token = NULL, execution_lease_expires_at = NULL,
                    updated_at = NOW()
              WHERE id = $1::uuid AND status = 'executing'
                AND (execution_lease_expires_at IS NULL OR execution_lease_expires_at <= NOW())
              RETURNING *`,
            [ledger.id, JSON.stringify(this.executionLeaseExpiredResult())],
        );
        return rows[0] || ledger;
    }

    private confirmationRequired(ledgerId: string): { allowed: false; result: Record<string, unknown> } {
        return {
            allowed: false,
            result: {
                error: 'confirmation_required',
                confirmationId: ledgerId,
                message: 'Pide al cliente una confirmación explícita. La acción no se ejecutará en este mismo turno.',
            },
        };
    }

    private async latestInboundMessage(
        schemaName: string,
        conversationId: string,
    ): Promise<{ id: string; content_text: string | null } | null> {
        const rows = await this.query<Array<{ id: string; content_text: string | null }>>(
            schemaName,
            `SELECT id::text, content_text
               FROM messages
              WHERE conversation_id = $1::uuid AND direction = 'inbound'
              ORDER BY created_at DESC, id DESC
              LIMIT 1`,
            [conversationId],
        );
        return rows[0] || null;
    }

    private buildIdempotencyKey(
        request: ToolExecutionControlRequest,
        argsHash: string,
        sourceMessageId: string,
    ): string {
        const supplied = request.idempotencyKey?.trim();
        const source = supplied && /^[A-Za-z0-9_.:-]{8,128}$/.test(supplied)
            ? `caller:${supplied}`
            : `derived:${sourceMessageId}`;
        return sha256([
            request.tenantId,
            request.contactId,
            request.conversationId,
            request.toolName,
            argsHash,
            source,
        ].join(':'));
    }

    private signConfirmationToken(claims: ConfirmationClaims): string | null {
        const secret = this.config.get<string>('auth.jwtSecret');
        if (!secret || secret.length < 16) return null;
        const encoded = base64Url(JSON.stringify(claims));
        const signature = base64Url(createHmac('sha256', secret).update(encoded).digest());
        return `${encoded}.${signature}`;
    }

    private verifyConfirmationToken(token: string): ConfirmationClaims | null {
        const secret = this.config.get<string>('auth.jwtSecret');
        if (!secret || secret.length < 16) return null;
        const [encoded, suppliedSignature, extra] = token.split('.');
        if (!encoded || !suppliedSignature || extra) return null;
        const expected = createHmac('sha256', secret).update(encoded).digest();
        const supplied = fromBase64Url(suppliedSignature);
        if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
        try {
            const claims = JSON.parse(fromBase64Url(encoded).toString('utf8')) as ConfirmationClaims;
            return claims?.version === 1 ? claims : null;
        } catch {
            return null;
        }
    }

    private async loadLedger(schemaName: string, ledgerId: string): Promise<ExecutionLedgerRow> {
        const rows = await this.query<ExecutionLedgerRow[]>(
            schemaName,
            `SELECT * FROM tool_execution_ledger WHERE id = $1::uuid LIMIT 1`,
            [ledgerId],
        );
        if (!rows[0]) throw new Error('tool_execution_ledger_missing');
        return rows[0];
    }

    private ensureControlTables(schemaName: string): Promise<void> {
        const pending = this.initializedSchemas.get(schemaName);
        if (pending) return pending;
        const initialization = (async () => {
            await this.query(
                schemaName,
                `CREATE TABLE IF NOT EXISTS tool_execution_ledger (
                    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
                    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
                    tool_name VARCHAR(160) NOT NULL,
                    args_hash CHAR(64) NOT NULL,
                    request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    channel_type VARCHAR(40),
                    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
                    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
                    assurance_level VARCHAR(2) NOT NULL
                        CONSTRAINT tool_execution_ledger_assurance_chk
                        CHECK (assurance_level IN ('A0', 'A1', 'A2', 'A3', 'A4')),
                    status VARCHAR(40) NOT NULL
                        CONSTRAINT tool_execution_ledger_status_chk
                        CHECK (status IN ('awaiting_confirmation', 'awaiting_approval', 'ready', 'executing', 'succeeded', 'failed', 'handoff_required', 'reconciliation_required', 'rejected')),
                    confirmation_token TEXT,
                    request_source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
                    confirmation_source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
                    confirmed_by_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
                    confirmation_expires_at TIMESTAMPTZ,
                    confirmed_at TIMESTAMPTZ,
                    approval_ticket_id UUID,
                    response_payload JSONB,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    execution_lease_token UUID,
                    execution_lease_expires_at TIMESTAMPTZ,
                    last_error_code VARCHAR(80),
                    completed_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )`,
            );
            await this.query(
                schemaName,
                `CREATE TABLE IF NOT EXISTS tool_approval_tickets (
                    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
                    execution_ledger_id UUID NOT NULL UNIQUE REFERENCES tool_execution_ledger(id) ON DELETE CASCADE,
                    tool_name VARCHAR(160) NOT NULL,
                    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
                    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
                    approval_source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CONSTRAINT tool_approval_tickets_status_chk
                        CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
                    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    expires_at TIMESTAMPTZ NOT NULL,
                    decided_at TIMESTAMPTZ,
                    decided_by UUID,
                    decision_reason TEXT,
                    resume_state VARCHAR(20) NOT NULL DEFAULT 'not_requested'
                        CONSTRAINT tool_approval_tickets_resume_state_chk
                        CHECK (resume_state IN ('not_requested', 'pending', 'processing', 'completed', 'failed')),
                    resume_attempts INTEGER NOT NULL DEFAULT 0,
                    next_resume_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    resume_lease_token UUID,
                    resume_lease_expires_at TIMESTAMPTZ,
                    resumed_at TIMESTAMPTZ,
                    resume_result JSONB,
                    resume_error TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )`,
            );
            await this.query(
                schemaName,
                `CREATE TABLE IF NOT EXISTS tool_approval_outbox (
                    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
                    ticket_id UUID NOT NULL REFERENCES tool_approval_tickets(id) ON DELETE CASCADE,
                    event_type VARCHAR(80) NOT NULL,
                    event_key VARCHAR(240) NOT NULL UNIQUE,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CONSTRAINT tool_approval_outbox_status_chk
                        CHECK (status IN ('pending', 'processing', 'published', 'failed')),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    lease_token UUID,
                    lease_expires_at TIMESTAMPTZ,
                    last_error TEXT,
                    published_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )`,
            );
            await this.query(
                schemaName,
                `ALTER TABLE tool_execution_ledger
                    ADD COLUMN IF NOT EXISTS request_source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL`,
            );
            await this.query(
                schemaName,
                `ALTER TABLE tool_execution_ledger
                    ADD COLUMN IF NOT EXISTS confirmed_by_message_id UUID REFERENCES messages(id) ON DELETE SET NULL`,
            );
            await this.query(
                schemaName,
                `ALTER TABLE tool_execution_ledger
                    ADD COLUMN IF NOT EXISTS request_payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
            );
            await this.query(
                schemaName,
                `ALTER TABLE tool_execution_ledger
                    ADD COLUMN IF NOT EXISTS channel_type VARCHAR(40)`,
            );
            await this.query(
                schemaName,
                `ALTER TABLE tool_execution_ledger
                    ADD COLUMN IF NOT EXISTS execution_lease_token UUID`,
            );
            await this.query(
                schemaName,
                `ALTER TABLE tool_execution_ledger
                    ADD COLUMN IF NOT EXISTS execution_lease_expires_at TIMESTAMPTZ`,
            );
            for (const ddl of [
                `ALTER TABLE tool_approval_tickets ADD COLUMN IF NOT EXISTS approval_source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL`,
                `ALTER TABLE tool_approval_tickets ADD COLUMN IF NOT EXISTS resume_state VARCHAR(20) NOT NULL DEFAULT 'not_requested'`,
                `ALTER TABLE tool_approval_tickets ADD COLUMN IF NOT EXISTS resume_attempts INTEGER NOT NULL DEFAULT 0`,
                `ALTER TABLE tool_approval_tickets ADD COLUMN IF NOT EXISTS next_resume_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
                `ALTER TABLE tool_approval_tickets ADD COLUMN IF NOT EXISTS resume_lease_token UUID`,
                `ALTER TABLE tool_approval_tickets ADD COLUMN IF NOT EXISTS resume_lease_expires_at TIMESTAMPTZ`,
                `ALTER TABLE tool_approval_tickets ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ`,
                `ALTER TABLE tool_approval_tickets ADD COLUMN IF NOT EXISTS resume_result JSONB`,
                `ALTER TABLE tool_approval_tickets ADD COLUMN IF NOT EXISTS resume_error TEXT`,
            ]) {
                await this.query(schemaName, ddl);
            }
            // CREATE TABLE IF NOT EXISTS does not retrofit constraints on old
            // schemas. Add the same closed-world invariants as tenant-schema.sql
            // without dropping a live constraint or validating legacy rows.
            for (const ddl of [
                `DO $ddl$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_execution_ledger_assurance_chk' AND conrelid = 'tool_execution_ledger'::regclass) THEN
                        ALTER TABLE tool_execution_ledger ADD CONSTRAINT tool_execution_ledger_assurance_chk CHECK (assurance_level IN ('A0', 'A1', 'A2', 'A3', 'A4')) NOT VALID;
                    END IF;
                 END $ddl$`,
                `DO $ddl$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_execution_ledger_status_chk' AND conrelid = 'tool_execution_ledger'::regclass) THEN
                        ALTER TABLE tool_execution_ledger ADD CONSTRAINT tool_execution_ledger_status_chk CHECK (status IN ('awaiting_confirmation', 'awaiting_approval', 'ready', 'executing', 'succeeded', 'failed', 'handoff_required', 'reconciliation_required', 'rejected')) NOT VALID;
                    END IF;
                 END $ddl$`,
                `DO $ddl$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_approval_tickets_status_chk' AND conrelid = 'tool_approval_tickets'::regclass) THEN
                        ALTER TABLE tool_approval_tickets ADD CONSTRAINT tool_approval_tickets_status_chk CHECK (status IN ('pending', 'approved', 'rejected', 'expired')) NOT VALID;
                    END IF;
                 END $ddl$`,
                `DO $ddl$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_approval_tickets_resume_state_chk' AND conrelid = 'tool_approval_tickets'::regclass) THEN
                        ALTER TABLE tool_approval_tickets ADD CONSTRAINT tool_approval_tickets_resume_state_chk CHECK (resume_state IN ('not_requested', 'pending', 'processing', 'completed', 'failed')) NOT VALID;
                    END IF;
                 END $ddl$`,
                `DO $ddl$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_approval_outbox_status_chk' AND conrelid = 'tool_approval_outbox'::regclass) THEN
                        ALTER TABLE tool_approval_outbox ADD CONSTRAINT tool_approval_outbox_status_chk CHECK (status IN ('pending', 'processing', 'published', 'failed')) NOT VALID;
                    END IF;
                 END $ddl$`,
                `DO $ddl$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tool_execution_ledger_approval_fk' AND conrelid = 'tool_execution_ledger'::regclass) THEN
                        ALTER TABLE tool_execution_ledger ADD CONSTRAINT tool_execution_ledger_approval_fk FOREIGN KEY (approval_ticket_id) REFERENCES tool_approval_tickets(id) ON DELETE SET NULL NOT VALID;
                    END IF;
                 END $ddl$`,
            ]) {
                await this.query(schemaName, ddl);
            }
            await this.query(
                schemaName,
                `CREATE INDEX IF NOT EXISTS idx_tool_execution_ledger_status
                    ON tool_execution_ledger (status, updated_at)`,
            );
            await this.query(
                schemaName,
                `CREATE INDEX IF NOT EXISTS idx_tool_approval_tickets_status
                    ON tool_approval_tickets (status, expires_at)`,
            );
            await this.query(
                schemaName,
                `CREATE INDEX IF NOT EXISTS idx_tool_approval_tickets_resume
                    ON tool_approval_tickets (resume_state, next_resume_at)
                    WHERE status = 'approved' AND resume_state IN ('pending', 'processing', 'failed')`,
            );
            await this.query(
                schemaName,
                `CREATE INDEX IF NOT EXISTS idx_tool_approval_outbox_due
                    ON tool_approval_outbox (status, next_attempt_at)
                    WHERE status IN ('pending', 'failed')`,
            );
        })().catch(error => {
            this.initializedSchemas.delete(schemaName);
            throw error;
        });
        this.initializedSchemas.set(schemaName, initialization);
        return initialization;
    }

    private approvalRequestFromPayload(payload: unknown): Record<string, unknown> {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
        const args = (payload as Record<string, unknown>).args;
        if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
        return args as Record<string, unknown>;
    }

    private recordPayload(payload: unknown): Record<string, unknown> {
        return payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload as Record<string, unknown>
            : {};
    }

    private async hasNewInboundSinceApproval(
        query: TenantQuery,
        conversationId: string | null,
        sourceMessageId: string | null,
    ): Promise<boolean> {
        if (!conversationId || !sourceMessageId) return true;
        const rows = await query<Array<{ stale: boolean }>>(
            `SELECT (
                NOT EXISTS (
                    SELECT 1 FROM messages source
                     WHERE source.id = $2::uuid
                       AND source.conversation_id = $1::uuid
                       AND source.direction = 'inbound'
                )
                OR EXISTS (
                    SELECT 1
                      FROM messages newer
                      JOIN messages source ON source.id = $2::uuid
                     WHERE newer.conversation_id = $1::uuid
                       AND newer.direction = 'inbound'
                       AND (newer.created_at, newer.id::text)
                           > (source.created_at, source.id::text)
                )
            ) AS stale`,
            [conversationId, sourceMessageId],
        );
        return rows[0]?.stale === true;
    }

    private async closeStaleApprovalWithQuery(
        query: TenantQuery,
        ticket: {
            id: string;
            execution_ledger_id: string;
            tool_name: string;
            contact_id: string | null;
            conversation_id: string | null;
        },
    ): Promise<Record<string, unknown>> {
        const result = {
            error: 'approval_stale_due_to_new_inbound',
            message: 'La conversación cambió después de solicitar la aprobación. Requiere una nueva revisión humana.',
            shouldHandoff: true,
        };
        await query(
            `UPDATE tool_approval_tickets
                SET status = 'expired', resume_state = 'failed', resume_result = $2::jsonb,
                    resume_error = 'approval_stale_due_to_new_inbound',
                    resume_lease_token = NULL, resume_lease_expires_at = NULL,
                    updated_at = NOW()
              WHERE id = $1::uuid AND status IN ('pending', 'approved')`,
            [ticket.id, JSON.stringify(result)],
        );
        await query(
            `UPDATE tool_execution_ledger
                SET status = 'failed', response_payload = $2::jsonb,
                    last_error_code = 'approval_stale_due_to_new_inbound',
                    completed_at = NOW(), updated_at = NOW()
              WHERE id = $1::uuid
                AND status IN ('awaiting_approval', 'ready', 'awaiting_confirmation')`,
            [ticket.execution_ledger_id, JSON.stringify(result)],
        );
        await this.insertApprovalOutboxWithQuery(query, ticket.id, 'tool.approval.stale', {
            ticketId: ticket.id,
            toolName: ticket.tool_name,
            contactId: ticket.contact_id,
            conversationId: ticket.conversation_id,
            error: 'approval_stale_due_to_new_inbound',
        });
        return result;
    }

    private async expireApprovalIfStale(schemaName: string, ticketId: string): Promise<boolean> {
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows = await query<Array<{
                id: string;
                execution_ledger_id: string;
                tool_name: string;
                contact_id: string | null;
                conversation_id: string | null;
                status: ToolApprovalStatus;
                approval_source_message_id: string | null;
            }>>(
                `SELECT id, execution_ledger_id, tool_name, contact_id, conversation_id,
                        status, approval_source_message_id
                   FROM tool_approval_tickets
                  WHERE id = $1::uuid
                  FOR UPDATE`,
                [ticketId],
            );
            const ticket = rows[0];
            if (!ticket || !['pending', 'approved'].includes(ticket.status)) return false;
            if (!await this.hasNewInboundSinceApproval(
                query,
                ticket.conversation_id,
                ticket.approval_source_message_id,
            )) return false;
            await this.closeStaleApprovalWithQuery(query, ticket);
            return true;
        });
    }

    private async insertApprovalOutboxWithQuery(
        query: TenantQuery,
        ticketId: string,
        eventType: string,
        payload: Record<string, unknown>,
    ): Promise<void> {
        const eventKey = `${eventType}:${ticketId}`;
        await query(
            `INSERT INTO tool_approval_outbox
                (id, ticket_id, event_type, event_key, payload, status, next_attempt_at)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, 'pending', NOW())
             ON CONFLICT (event_key) DO NOTHING`,
            [randomUUID(), ticketId, eventType, eventKey, JSON.stringify(payload)],
        );
    }

    private query<T = any[]>(schemaName: string, sql: string, params: any[] = []): Promise<T> {
        return this.prisma.executeInTenantSchema<T>(schemaName, sql, params);
    }

    private block(
        error: string,
        message: string,
        shouldHandoff = false,
    ): { allowed: false; result: Record<string, unknown> } {
        return {
            allowed: false,
            result: {
                error,
                message,
                ...(shouldHandoff ? { shouldHandoff: true } : {}),
            },
        };
    }
}
