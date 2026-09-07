import { isSupervisor } from './roles';

export type ApprovalDeliveryState = 'not_required' | 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'suppressed' | 'reconciliation_required';
export interface ApprovalDeliveryEffect {
    id: string;
    kind: 'media' | 'handoff' | 'payment_link';
    state: Exclude<ApprovalDeliveryState, 'not_required'> | 'sent';
    errorCode?: string;
}

export interface ToolApprovalItem {
    id: string;
    toolName: string;
    contactId: string | null;
    conversationId: string | null;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    request: Record<string, unknown>;
    requestedAt: string;
    expiresAt: string;
    decidedAt: string | null;
    decidedBy: string | null;
    decisionReason: string | null;
    resumeState: 'not_requested' | 'pending' | 'processing' | 'completed' | 'failed';
    resumeAttempts: number;
    resumedAt: string | null;
    resumeResult: Record<string, unknown> | null;
    resumeError: string | null;
    kind?: 'draft_action' | 'policy';
    agentId?: string | null;
    agentVersion?: number | null;
    executionStatus?: string | null;
    executionErrorCode?: string | null;
    deliveryState?: ApprovalDeliveryState;
    deliveryEffects?: ApprovalDeliveryEffect[];
}
export type ToolApprovalAction = 'approved' | 'rejected' | 'resume';
export type ApprovalExecutionState = 'succeeded' | 'reconciliation' | 'failed' | 'processing' | 'pending' | 'not_started' | 'unverified';
export const canReviewToolApprovals = isSupervisor;

export function approvalExecutionState(ticket: ToolApprovalItem): ApprovalExecutionState {
    // Workflow completion may be a denied action. Only the authoritative ledger
    // status establishes an operational success, never prose or resumeState.
    if (ticket.executionStatus === 'succeeded') return 'succeeded';
    if (ticket.executionStatus === 'reconciliation_required') return 'reconciliation';
    if (ticket.executionStatus === 'executing' || ticket.resumeState === 'processing') return 'processing';
    if (['failed', 'rejected'].includes(ticket.executionStatus || '') || ticket.resumeState === 'failed' || ticket.resumeError ||
        ticket.executionErrorCode || ticket.resumeResult?.error) return 'failed';
    if (ticket.resumeState === 'completed') return 'unverified';
    if (ticket.status === 'approved') return 'pending';
    return 'not_started';
}

export function approvalActions(ticket: ToolApprovalItem, role?: string | null, now = Date.now()) {
    const expires = Date.parse(ticket.expiresAt);
    const expired = ticket.status === 'expired' || !Number.isFinite(expires) || expires <= now;
    const operational = approvalExecutionState(ticket);
    const terminal = ['succeeded', 'processing', 'reconciliation'].includes(operational);
    const authorized = canReviewToolApprovals(role) && !expired && !terminal;
    return { expired, approve: authorized && ticket.status === 'pending', reject: authorized && ticket.status === 'pending',
        resume: authorized && ticket.status === 'approved' && ['not_requested', 'pending', 'failed'].includes(ticket.resumeState) };
}

export function approvalsForConversation(items: ToolApprovalItem[], conversationId: string): ToolApprovalItem[] {
    return items.filter(item => item && item.conversationId === conversationId && typeof item.id === 'string' &&
        ['pending', 'approved', 'rejected', 'expired'].includes(item.status));
}

export function approvalEventMatches(event: unknown, tenantId: string, conversationId: string): boolean {
    if (!event || typeof event !== 'object') return false;
    const value = event as Record<string, unknown>;
    return value.tenantId === tenantId && value.conversationId === conversationId;
}

interface ApprovalTransport {
    getToolApprovals(tenantId: string, conversationId: string): Promise<{ success: boolean; data?: ToolApprovalItem[] }>;
    decideToolApproval(tenantId: string, id: string, decision: 'approved' | 'rejected', reason?: string): Promise<{ success: boolean }>;
    resumeToolApproval(tenantId: string, id: string): Promise<{ success: boolean }>;
}

/** After an uncertain POST, read the server rather than optimistic UI changes or
 * automatic retries. A manual resume reuses the ticket; it never creates a new action. */
export async function actAndReloadToolApprovals(transport: ApprovalTransport, tenantId: string, conversationId: string,
    ticket: ToolApprovalItem, action: ToolApprovalAction, role: string | null | undefined, reason?: string) {
    const allowed = approvalActions(ticket, role);
    if (ticket.conversationId !== conversationId || !(action === 'approved' ? allowed.approve : action === 'rejected' ? allowed.reject : allowed.resume)) {
        throw new Error('tool_approval_action_not_available');
    }
    let acknowledged = false;
    try {
        const response = action === 'resume' ? await transport.resumeToolApproval(tenantId, ticket.id) :
            await transport.decideToolApproval(tenantId, ticket.id, action, reason?.trim() || undefined);
        acknowledged = response.success;
    } catch { /* the mutation may have committed; the next GET is authoritative */ }
    const fresh = await transport.getToolApprovals(tenantId, conversationId);
    if (!fresh.success || !Array.isArray(fresh.data)) throw new Error('tool_approval_verification_unavailable');
    return { acknowledged, items: approvalsForConversation(fresh.data, conversationId) };
}

// Keys are grouped for readable review. Unknown tool-specific fields remain in
// the exact details, instead of inventing labels or silently dropping arguments.
export const TOOL_ARGUMENT_GROUPS: Record<string, readonly string[]> = {
    customer: ['customerName','customerEmail','customerPhone','name','email','phone','address','city','documentType','documentNumber','petName','species','breed'],
    scheduling: ['serviceId','serviceName','staffId','staffName','appointmentId','date','time','newDate','newTime','startDate','endDate','startTime','endTime','duration','timezone','location','modality'],
    purchase: ['orderId','productId','productName','quantity','amount','currency','discount','discountPercent','discountAmount','paymentId','bookingId','propertyId','tourId','courseId','cohortId','classId','membershipId','vehicleId','rentalId','repairOrderId','sessionId','packageId','quoteId','items'],
    content: ['reason','notes','description','message','text','caption','title','url','mediaUrl','fileName','tags','stageId','pipelineId','dueDate','priority','interest','consentType','granted'],
};
export const normalizeApprovalArgument = (key: string) => key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
export const isTechnicalReference = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export function safeApprovalDetails(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(safeApprovalDetails);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
        /(?:password|secret|authorization|access.?token|refresh.?token|confirmation.?token|lease.?token|api.?key)/i.test(key) ? '••••' : safeApprovalDetails(entry)]));
}

/** Domain state remains distinct from the successful execution of a tool. A
 * created payment link or pending reservation does not prove settlement. */
export function approvalDomainStates(ticket: ToolApprovalItem): string[] {
    const result = ticket.resumeResult;
    if (!result) return [];
    const records = [result, ...['activeObject','appointment','booking','order','payment','enrollment','rental','repairOrder','serviceRequest','quote']
        .map(key => result[key]).filter(value => value && typeof value === 'object' && !Array.isArray(value))] as Record<string, unknown>[];
    return [...new Set(records.flatMap(record => [record.status, record.paymentStatus, record.payment_status])
        .filter((status): status is string => typeof status === 'string' && !['ok', 'succeeded', 'error', 'failed'].includes(status)))];
}
