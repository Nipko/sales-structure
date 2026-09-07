import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolApprovalReviewCard } from './ToolApprovalsPanel';
import { actAndReloadToolApprovals, approvalActions, approvalDomainStates, approvalEventMatches, approvalExecutionState,
    approvalsForConversation, safeApprovalDetails, TOOL_ARGUMENT_GROUPS, type ToolApprovalItem } from '@/lib/tool-approvals';

let mockLocale = 'es';
const mockMessages: Record<string, any> = Object.fromEntries(['es','en','pt','fr'].map(locale => [locale,
    require(`../../../messages/${locale}.json`).toolApprovals]));
jest.mock('next-intl', () => ({ useLocale: () => mockLocale, useTranslations: () => {
    const lookup = (key: string) => key.split('.').reduce((node: any, part) => node?.[part], mockMessages[mockLocale]);
    const t = (key: string, values?: Record<string, unknown>) => String(lookup(key) ?? key).replace(/\{(\w+)\}/g, (_match, variable) => String(values?.[variable] ?? variable));
    t.has = (key: string) => typeof lookup(key) === 'string'; return t;
} }));
jest.mock('@/lib/api', () => ({ api: {} }));

const ticket = (overrides: Partial<ToolApprovalItem> = {}): ToolApprovalItem => ({
    id: 'ticket', toolName: 'create_appointment', contactId: 'contact', conversationId: 'conversation', status: 'pending',
    kind: 'draft_action', request: { serviceId: '11111111-1111-4111-8111-111111111111', date: '2026-12-05', time: '14:30',
        customerName: '<customer>', unknownArgument: 'exact extra value', confirmationToken: 'secret-proof' },
    requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
    decidedAt: null, decidedBy: null, decisionReason: null, resumeState: 'not_requested', resumeAttempts: 0,
    resumedAt: null, resumeResult: null, resumeError: null, agentVersion: 3, executionStatus: 'awaiting_approval', ...overrides,
});
const render = (item = ticket(), role = 'tenant_admin', verified = true) => renderToStaticMarkup(createElement(ToolApprovalReviewCard,
    { ticket: item, role, verified, busy: false, onAction: jest.fn() }));
beforeEach(() => { mockLocale = 'es'; });

describe('Human action review has readable scope and honest execution state', () => {
    it.each(['es','en','pt','fr'])('localizes the action, all argument groups and outcomes in %s', locale => {
        mockLocale = locale;
        const html = render();
        for (const text of [mockMessages[locale].tools.create_appointment, mockMessages[locale].arguments.serviceId,
            mockMessages[locale].approval.pending, mockMessages[locale].execution.not_started, '2026-12-05', '14:30']) expect(html).toContain(text);
        for (const group of Object.values(TOOL_ARGUMENT_GROUPS)) for (const key of group) expect(mockMessages[locale].arguments[key]).toEqual(expect.any(String));
    });
    it('shows exact arguments with escaped text, full references only in details and hidden credentials', () => {
        const html = render();
        expect(html).toContain('&lt;customer&gt;'); expect(html).not.toContain('<customer>');
        expect(html).toContain('exact extra value'); expect(html).not.toContain('secret-proof');
        const primary = html.replace(/<details[\s\S]*?<\/details>/g, '');
        expect(primary).not.toContain('unknownArgument'); expect(primary).not.toContain('create_appointment');
        expect(primary).not.toContain('11111111-1111-4111-8111-111111111111');
        expect(primary).toContain('Referencia 11111111');
    });
    it.each(['tenant_agent','tenant_viewer','unknown',''])('does not expose review data or controls to %s', role => {
        expect(render(ticket(), role)).toBe(''); expect(approvalActions(ticket(), role)).toMatchObject({ approve: false, reject: false, resume: false });
    });
    it.each(['tenant_admin','tenant_supervisor','super_admin'])('allows authorized review for %s', role => {
        expect(approvalActions(ticket(), role)).toMatchObject({ approve: true, reject: true });
        expect(render(ticket(), role)).toContain(mockMessages.es.reviewed);
    });
    it('workflow completion and success-looking prose never become operational success', () => {
        const item = ticket({ status: 'approved', resumeState: 'completed', resumeResult: { success: true, message: 'Done successfully' }, executionStatus: null });
        expect(approvalExecutionState(item)).toBe('unverified');
        expect(render(item)).toContain(mockMessages.es.execution.unverified);
        expect(render(item)).not.toContain(mockMessages.es.execution.succeeded);
    });
    it('a successful command can still have pending payment, shown separately', () => {
        const item = ticket({ status: 'approved', resumeState: 'completed', executionStatus: 'succeeded', resumeResult: { paymentStatus: 'pending_payment' } });
        expect(approvalDomainStates(item)).toEqual(['pending_payment']);
        const html = render(item); expect(html).toContain(mockMessages.es.execution.succeeded);
        expect(html).toContain(mockMessages.es.domainStates.pending_payment); expect(html).not.toContain('<button');
    });
    it.each(['es', 'en', 'pt', 'fr'])('separates provider acceptance from receipt, and handoff recording, in %s', locale => {
        mockLocale = locale;
        const item = ticket({ status: 'approved', executionStatus: 'succeeded', resumeState: 'completed', deliveryState: 'completed',
            deliveryEffects: [{ id: 'technical-effect-id', kind: 'media', state: 'sent' }, { id: 'handoff-id', kind: 'handoff', state: 'completed' }] });
        const html = render(item);
        for (const text of [mockMessages[locale].delivery.states.completed, mockMessages[locale].delivery.effects.sent,
            mockMessages[locale].delivery.handoffRecorded, mockMessages[locale].delivery.explanation]) expect(html).toContain(text);
        expect(html).not.toContain('technical-effect-id'); expect(html).not.toContain('<button');
    });
    it.each(['pending', 'queued', 'processing', 'failed', 'suppressed', 'reconciliation_required'] as const)(
        'a delivery state of %s does not allow repeating a successful operation', deliveryState => {
            const item = ticket({ status: 'approved', executionStatus: 'succeeded', resumeState: 'failed', deliveryState,
                deliveryEffects: [{ id: 'effect', kind: 'payment_link', state: deliveryState, errorCode: 'private_provider_error' }] });
            const html = render(item);
            expect(html).toContain(mockMessages.es.delivery.states[deliveryState]);
            expect(html).toContain(mockMessages.es.delivery.error); expect(html).not.toContain('private_provider_error');
            expect(approvalActions(item, 'tenant_admin').resume).toBe(false); expect(html).not.toContain('<button');
        });
    it.each(['es','en','pt','fr'])('describes stored Web Chat content without asserting provider delivery in %s',locale=>{
        mockLocale=locale;
        const html=render(ticket({status:'approved',executionStatus:'succeeded',resumeState:'completed',deliveryState:'completed',
            deliveryEffects:[{id:'stored-effect',kind:'media',state:'stored'}]}));
        expect(html).toContain(mockMessages[locale].delivery.effects.stored);
        expect(html).not.toContain(mockMessages[locale].delivery.effects.sent);
        expect(html).not.toContain('stored-effect');
    });
    it('does not invent delivery success for legacy tickets without delivery evidence', () => {
        const html = render(ticket({ status: 'approved', executionStatus: 'succeeded', resumeState: 'completed' }));
        expect(html).toContain(mockMessages.es.delivery.unknown);
        expect(html).not.toContain(mockMessages.es.delivery.states.completed);
    });
    it.each(['succeeded','executing','reconciliation_required'])('never offers a duplicate resume for ledger state %s', executionStatus => {
        const item = ticket({ status: 'approved', resumeState: 'failed', executionStatus });
        expect(approvalActions(item, 'tenant_admin').resume).toBe(false);
        expect(render(item)).not.toContain('<button');
    });
    it('expired or invalid expiry and rejected tickets cannot execute', () => {
        for (const item of [ticket({ expiresAt: new Date(Date.now() - 1000).toISOString() }), ticket({ expiresAt: 'not-a-date' }), ticket({ status: 'rejected' })]) {
            expect(approvalActions(item, 'tenant_admin')).toMatchObject({ approve: false, resume: false });
            expect(render(item)).not.toContain('<button');
        }
    });
    it('unknown tools have a readable fallback while the exact identifier stays in details', () => {
        const html = render(ticket({ toolName: 'mcp__private_operation' }));
        expect(html).toContain(mockMessages.es.unknownTool);
        expect(html).toContain('mcp__private_operation');
        expect(html.replace(/<details[\s\S]*?<\/details>/g, '')).not.toContain('mcp__private_operation');
    });
    it('redacts nested execution tokens without removing the reviewable operation arguments', () => {
        expect(safeApprovalDetails({ booking: { customerName: 'Ana', lease_token: 'lease', apiKey: 'secret' } }))
            .toEqual({ booking: { customerName: 'Ana', lease_token: '••••', apiKey: '••••' } });
    });
});

describe('Review mutations re-read server authority and stay bound to one conversation', () => {
    const transport = () => ({ getToolApprovals: jest.fn().mockResolvedValue({ success: true, data: [ticket({ status: 'approved', resumeState: 'pending' })] }),
        decideToolApproval: jest.fn().mockResolvedValue({ success: true }), resumeToolApproval: jest.fn().mockResolvedValue({ success: true }) });
    it('approval is followed by a fresh scoped GET, not an optimistic success state', async () => {
        const api = transport(); const result = await actAndReloadToolApprovals(api, 'tenant', 'conversation', ticket(), 'approved', 'tenant_supervisor', ' reviewed ');
        expect(api.decideToolApproval).toHaveBeenCalledWith('tenant', 'ticket', 'approved', 'reviewed');
        expect(api.getToolApprovals).toHaveBeenCalledWith('tenant', 'conversation');
        expect(api.getToolApprovals.mock.invocationCallOrder[0]).toBeGreaterThan(api.decideToolApproval.mock.invocationCallOrder[0]);
        expect(approvalExecutionState(result.items[0])).toBe('pending');
    });
    it('an uncertain POST is read back without retrying the mutation automatically', async () => {
        const api = transport(); api.decideToolApproval.mockRejectedValue(new Error('network response lost'));
        const result = await actAndReloadToolApprovals(api, 'tenant', 'conversation', ticket(), 'approved', 'tenant_admin');
        expect(result).toMatchObject({ acknowledged: false, items: [{ status: 'approved' }] });
        expect(api.decideToolApproval).toHaveBeenCalledTimes(1); expect(api.resumeToolApproval).not.toHaveBeenCalled();
    });
    it('failure to verify after a mutation does not return actionable stale tickets', async () => {
        const api = transport(); api.getToolApprovals.mockResolvedValue({ success: false });
        await expect(actAndReloadToolApprovals(api, 'tenant', 'conversation', ticket(), 'approved', 'tenant_admin'))
            .rejects.toThrow('tool_approval_verification_unavailable');
    });
    it('manual resume reuses the approved ticket and then fetches its actual result', async () => {
        const api = transport(); const item = ticket({ status: 'approved', resumeState: 'failed', executionStatus: 'failed' });
        await actAndReloadToolApprovals(api, 'tenant', 'conversation', item, 'resume', 'super_admin');
        expect(api.resumeToolApproval).toHaveBeenCalledWith('tenant', 'ticket');
        expect(api.decideToolApproval).not.toHaveBeenCalled(); expect(api.getToolApprovals).toHaveBeenCalledTimes(1);
    });
    it('a different conversation or an insufficient role cannot dispatch a mutation', async () => {
        const api = transport();
        for (const [conversation, role] of [['other', 'tenant_admin'], ['conversation', 'tenant_agent']]) {
            await expect(actAndReloadToolApprovals(api, 'tenant', conversation, ticket(), 'approved', role)).rejects.toThrow('tool_approval_action_not_available');
        }
        expect(api.decideToolApproval).not.toHaveBeenCalled(); expect(api.getToolApprovals).not.toHaveBeenCalled();
    });
    it('filters unexpected list rows and events by exact tenant/conversation scope', () => {
        expect(approvalsForConversation([ticket(), ticket({ id: 'foreign', conversationId: 'other' })], 'conversation')).toHaveLength(1);
        expect(approvalEventMatches({ tenantId: 'tenant', conversationId: 'conversation' }, 'tenant', 'conversation')).toBe(true);
        expect(approvalEventMatches({ tenantId: 'other', conversationId: 'conversation' }, 'tenant', 'conversation')).toBe(false);
        expect(approvalEventMatches({ tenantId: 'tenant', conversationId: 'other' }, 'tenant', 'conversation')).toBe(false);
        expect(approvalEventMatches({ tenantId: 'tenant' }, 'tenant', 'conversation')).toBe(false);
    });
});
