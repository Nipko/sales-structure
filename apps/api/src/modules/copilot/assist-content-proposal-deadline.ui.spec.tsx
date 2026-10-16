/** @jest-environment node */
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';
import { getAgentOperation, validateAgentOperationInput, type AgentContentProposal, type AppliedAgentContentObject } from '@parallext/shared';
import { AgentContentProposalService } from './agent-content-proposal.service';
import { CopilotController } from './copilot.controller';
import { PROPOSAL_TTL_MINUTES } from './agent-proposal-digest';

/** PREPARED ONLY:8 cases,4locales x mounted deadline crossing / just-before deadline control.
 * Future destination apps/api/src/modules/copilot/assist-content-proposal-deadline.ui.spec.tsx.
 * Real component+NextIntl+service/controller/validator/digest/TTL; boundary-only strict
 * synthetic ledger/Knowledge/throttle/API. No model/DB/production or prior20 test import.
 * Primary: native apply after absolute expiry must not emit a known-obsolete command;
 * explain expired. No arbitrary automatic-timer precision requirement.
 */
jest.mock('@/lib/api', () => ({ api: { applyAgentContent: jest.fn() } }), { virtual: true });
const { api } = jest.requireMock('@/lib/api') as { api: { applyAgentContent: jest.Mock } };
const TENANT = '11111111-1111-4111-8111-111111111111';
const ACTOR = { id: '22222222-2222-4222-8222-222222222222', role: 'tenant_admin' };
const PROPOSAL = '33333333-3333-4333-8333-333333333333';
const OBJECT = '44444444-4444-4444-8444-444444444444';
const SCHEMA = 'tenant_receipt_local';
const INPUT = { title: 'Synthetic QA deadline', content: 'Synthetic local content, no customer or outbound message.' };
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [locale,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../dashboard/messages', locale + '.json'), 'utf8')),
])) as Record<typeof LOCALES[number], any>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local-deadline.test/' });
const replacements: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
};
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
// Load DOM consumers only after installing the local DOM. No production app bootstrap.
const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
const { NextIntlClientProvider } = require('next-intl') as typeof import('next-intl');
const { AgentContentReview } = require('../../../../dashboard/src/components/quality/AgentContentReview') as {
    AgentContentReview: ComponentType<{ tenantId: string; proposal: AgentContentProposal;
        onApplied?: (result: AppliedAgentContentObject) => void }>;
};
afterAll(() => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
    }
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}

async function producer() {
    const unexpected: string[] = [];
    const ledger: any[] = [];
    const objects: any[] = [];
    const fail = (label: string): never => { unexpected.push(label); throw new Error('Unexpected adapter call: ' + label); };
    const prisma = {
        getTenantSchemaName: jest.fn(async (id: string) => id === TENANT ? SCHEMA : fail('tenant')),
        ensureCanonicalTables: jest.fn(async (schema: string, tables: string[]) => {
            if (schema !== SCHEMA || JSON.stringify(tables) !== '["agent_content_proposals"]') fail('schema/table');
            // Boundary only: no SQL engine or canonical DDL is executed.
        }),
        executeInTenantSchema: jest.fn(async (schema: string, sql: string, args: any[] = []) => {
            if (schema !== SCHEMA) return fail('schema');
            if (sql === 'SELECT COUNT(*)::int AS c FROM knowledge_resources') return [{ c: objects.length }];
            if (sql.startsWith('SELECT * FROM agent_content_proposals WHERE requested_by')) {
                return clone(ledger.filter(row => row.requested_by === args[0] && row.request_key === args[1]));
            }
            if (sql.startsWith('INSERT INTO agent_content_proposals')) {
                if (ledger.length) return fail('duplicate fixture proposal');
                const row = { id: PROPOSAL, operation: args[0], requested_by: args[1], request_key: args[2],
                    digest: args[3], input: JSON.parse(args[4]), status: 'proposed',
                    expires_at: new Date(Date.now() + PROPOSAL_TTL_MINUTES * 60_000).toISOString(), created_object_id: null,
                    applied_at: null, applied_by: null };
                ledger.push(row); return [clone(row)];
            }
            if (sql.startsWith('SELECT * FROM agent_content_proposals WHERE id')) {
                return clone(ledger.filter(row => row.id === args[0]));
            }
            if (sql.includes("SET status='applied'")) {
                const row = ledger.find(row => row.id === args[0]);
                if (!row || row.status !== 'proposed' || Date.parse(row.expires_at) <= Date.now()) return [];
                Object.assign(row, { status: 'applied', applied_by: args[1], applied_at: new Date().toISOString() });
                return [clone(row)];
            }
            if (sql.startsWith('UPDATE agent_content_proposals SET created_object_id')) {
                const row = ledger.find(row => row.id === args[0]);
                if (!row) return fail('missing ledger on write'); row.created_object_id = args[1]; return [];
            }
            if (sql.startsWith('SELECT id, title FROM knowledge_resources WHERE id')) {
                return clone(objects.filter(row => row.id === args[0]).map(row => ({ id: row.id, title: row.title })));
            }
            return fail('SQL ' + sql);
        }),
        auditLog: { create: jest.fn(async ({ data }: any) => {
            if (data.tenantId !== TENANT || data.userId !== ACTOR.id || data.action !== 'assist.content_object_created') fail('audit');
            return {};
        }) },
    };
    const knowledge = { createResource: jest.fn(async (schema: string, tenant: string, input: any) => {
        if (schema !== SCHEMA || tenant !== TENANT || input.title !== INPUT.title
            || input.content !== INPUT.content || input.type !== 'faq') fail('createResource');
        const row = { id: OBJECT, title: input.title, content: input.content, type: input.type };
        objects.push(row); return clone(row);
    }) };
    const throttle = {
        enforcePlanLimit: jest.fn(async (tenant: string, key: string, count: number, resource: string) => {
            if (tenant !== TENANT || key !== 'knowledgeArticles' || count !== objects.length
                || resource !== 'documentos de conocimiento') fail('plan');
        }),
        isFeatureEnabled: jest.fn(async () => fail('unexpected feature gate')),
    };
    const forbidden = new Proxy({}, { get: (_target, key) => (..._args: unknown[]) => fail('unavailable provider ' + String(key)) });
    const service = new AgentContentProposalService(prisma as any, throttle as any, knowledge as any,
        forbidden as any, forbidden as any, forbidden as any, forbidden as any);
    const controller = new CopilotController(null as any, null as any, null as any, service);
    expect(getAgentOperation('knowledge.faq.create')?.availability).toBe('executable');
    expect(validateAgentOperationInput('knowledge.faq.create', INPUT).ok).toBe(true);
    const proposal = await service.propose(TENANT, 'knowledge.faq.create', INPUT, ACTOR, 'deadline-ui-local-01');
    expect(proposal.status).toBe('proposed'); expect(proposal.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(proposal.preview.after).toEqual([{ field: 'title', value: INPUT.title },
        { field: 'content', value: INPUT.content }, { field: 'type', value: 'faq' }]);
    expect(ledger).toHaveLength(1); expect(objects).toHaveLength(0); expect(unexpected).toEqual([]);
    let receipt: AppliedAgentContentObject | undefined;
    let controllerCalls = 0;
    async function apply(tenant: string, id: string, digest: string) {
        expect([tenant, id, digest]).toEqual([TENANT, proposal.id, proposal.digest]);
        try {
            controllerCalls += 1;
            const response = await controller.applyOperation(tenant, id, { digest }, { user: { sub: ACTOR.id, role: ACTOR.role } });
            receipt = response.data;
            return response;
        } catch (error: any) {
            // Faithful apiPost error envelope: backend JSON error -> errorCode,
            // message/status -> error; component must not claim success.
            const body = typeof error?.getResponse === 'function' ? error.getResponse() : null;
            const httpStatus = error?.getStatus?.() ?? 500;
            return { success: false, httpStatus,
                error: body?.message || 'Error ' + httpStatus, errorCode: body?.error };
        }
    }
    return { proposal, ledger, objects, knowledge, prisma, unexpected, apply, controllerCalls: () => controllerCalls, receipt: () => receipt };
}
async function mounted(locale: typeof LOCALES[number], proposal: AgentContentProposal) {
    const messages = MESSAGES[locale]; const copy = messages.agentContent;
    for (const value of [copy.willCreate, copy.created, copy.replayed, copy.apply, copy.applying,
        copy.verification.object_missing, copy.errors.apply_failed, copy.reviewObject, copy.expired]) {
        expect(typeof value).toBe('string'); expect(value.trim().length).toBeGreaterThan(0);
    }
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    const review = createElement(AgentContentReview, { tenantId: TENANT, proposal });
    await act(async () => { root.render(createElement(NextIntlClientProvider,
        { locale, messages, timeZone: 'America/Bogota', children: review })); });
    const button = () => container.querySelector<HTMLButtonElement>('button');
    expect(container.textContent).toContain(copy.willCreate);
    expect(button()?.textContent).toBe(copy.apply); expect(api.applyAgentContent).not.toHaveBeenCalled();
    async function click() { await act(async () => { button()!.click(); }); }
    return { container, copy, button, click,
        cleanup: () => { act(() => root.unmount()); container.remove(); } };
}

const T0 = Date.parse('2026-10-16T12:00:00.000Z');
const TTL_MS = PROPOSAL_TTL_MINUTES * 60_000;
function observed(view: Awaited<ReturnType<typeof mounted>>, kit: Awaited<ReturnType<typeof producer>>) {
    return {
        applyCalls: api.applyAgentContent.mock.calls.length, controllerCalls: kit.controllerCalls(),
        createCalls: kit.knowledge.createResource.mock.calls.length, objects: kit.objects.length,
        ledgerClaimCalls: kit.prisma.executeInTenantSchema.mock.calls.filter((call: any[]) => String(call[1]).includes("SET status='applied'")).length,
        objectIdWriteCalls: kit.prisma.executeInTenantSchema.mock.calls.filter((call: any[]) => String(call[1]).startsWith('UPDATE agent_content_proposals SET created_object_id')).length,
        auditCalls: kit.prisma.auditLog.create.mock.calls.length,
        ledgerStatus: kit.ledger[0].status,
        expiredNotice: Boolean(view.container.textContent?.includes(view.copy.expired)),
        genericApplyFailure: Boolean(view.container.textContent?.includes(view.copy.errors.apply_failed)),
        claimsCreated: Boolean(view.container.textContent?.includes(view.copy.created)),
        claimsReplayed: Boolean(view.container.textContent?.includes(view.copy.replayed)),
        reviewLink: view.container.querySelector('a')?.getAttribute('href') ?? null,
        enabledCreate: Boolean(view.button() && !view.button()!.disabled),
    };
}

describe.each(LOCALES)('Assist mounted proposal deadline stays functional (%s)', locale => {
    beforeEach(() => { api.applyAgentContent.mockReset(); jest.useFakeTimers({ now: T0 }); });
    afterEach(() => { jest.useRealTimers(); });

    it('product hypothesis: a proposal that expires during review blocks a native obsolete apply and explains expiry', async () => {
        const kit = await producer();
        expect(PROPOSAL_TTL_MINUTES).toBe(30);
        expect(kit.proposal.expiresAt).toBe(new Date(T0 + TTL_MS).toISOString());
        api.applyAgentContent.mockImplementation(kit.apply);
        const view = await mounted(locale, kit.proposal);
        try {
            // Fixed absolute source timestamp, no shortened synthetic TTL.
            await act(async () => { await jest.advanceTimersByTimeAsync(TTL_MS + 1); });
            expect(Date.now()).toBe(T0 + TTL_MS + 1);
            // Observe before interacting, but impose no timer precision contract.
            const preClick = { enabledCreate: Boolean(view.button() && !view.button()!.disabled),
                expiredNotice: Boolean(view.container.textContent?.includes(view.copy.expired)) };
            if (view.button() && !view.button()!.disabled) await view.click();
            // Collect complete outcome before assertions so backend-safe rejection
            // does not conceal that an already-expired command was emitted.
            const result = observed(view, kit);
            console.info(JSON.stringify({ kind: 'deadline-crossing-observation', locale, clock: Date.now(), preClick, afterNativeAttempt: result }));
            expect(result).toEqual({ applyCalls: 0, controllerCalls: 0, createCalls: 0, objects: 0,
                ledgerClaimCalls: 0, objectIdWriteCalls: 0, auditCalls: 0, ledgerStatus: 'proposed',
                expiredNotice: true, genericApplyFailure: false, claimsCreated: false, claimsReplayed: false,
                reviewLink: null, enabledCreate: false });
            expect(kit.unexpected).toEqual([]);
        } finally { view.cleanup(); }
    });

    it('control: the same mounted proposal is still applicable just before its absolute deadline', async () => {
        const kit = await producer();
        expect(kit.proposal.expiresAt).toBe(new Date(T0 + TTL_MS).toISOString());
        api.applyAgentContent.mockImplementation(kit.apply);
        const view = await mounted(locale, kit.proposal);
        try {
            await act(async () => { await jest.advanceTimersByTimeAsync(TTL_MS - 1); });
            expect(Date.now()).toBe(T0 + TTL_MS - 1);
            expect(view.button()?.disabled).toBe(false);
            await view.click();
            const result = observed(view, kit);
            console.info(JSON.stringify({ kind: 'deadline-before-control-observation', locale, clock: Date.now(), result }));
            expect(result).toEqual({ applyCalls: 1, controllerCalls: 1, createCalls: 1, objects: 1,
                ledgerClaimCalls: 1, objectIdWriteCalls: 1, auditCalls: 1, ledgerStatus: 'applied',
                expiredNotice: false, genericApplyFailure: false, claimsCreated: true, claimsReplayed: false,
                reviewLink: '/admin/knowledge/faqs', enabledCreate: false });
            expect(api.applyAgentContent.mock.calls[0]).toEqual([TENANT, kit.proposal.id, kit.proposal.digest]);
            expect(kit.receipt()).toMatchObject({ outcome: 'created', verification: 'verified', object: { id: OBJECT } });
            expect(view.container.textContent).not.toContain(view.copy.willCreate);
            expect(kit.objects[0]).toMatchObject({ id: OBJECT, title: INPUT.title, content: INPUT.content, type: 'faq' });
            expect(kit.unexpected).toEqual([]);
        } finally { view.cleanup(); }
    });
});

// Additional correction controls declared before first green: expiry can occur
// while the legitimate apply is in flight. Original8 above stay byte-identical.
describe.each(LOCALES)('Assist in-flight expiry response correction control (%s)', locale => {
    beforeEach(() => { api.applyAgentContent.mockReset(); jest.useFakeTimers({ now: T0 }); });
    afterEach(() => { jest.useRealTimers(); });

    it('correction control: an apply started before expiry explains a real expired response without a generic failure', async () => {
        const kit = await producer();
        expect(kit.proposal.expiresAt).toBe(new Date(T0 + TTL_MS).toISOString());
        const transport = deferred<void>();
        api.applyAgentContent.mockImplementation((tenant: string, id: string, digest: string) =>
            transport.promise.then(() => kit.apply(tenant, id, digest)));
        const view = await mounted(locale, kit.proposal);
        try {
            await act(async () => { await jest.advanceTimersByTimeAsync(TTL_MS - 1); });
            expect(Date.now()).toBe(T0 + TTL_MS - 1);
            await view.click();
            const pending = { applyCalls: api.applyAgentContent.mock.calls.length,
                controllerCalls: kit.controllerCalls(), busy: view.button()?.disabled,
                pendingCopy: view.button()?.textContent, objects: kit.objects.length };
            expect(pending).toEqual({ applyCalls: 1, controllerCalls: 0, busy: true,
                pendingCopy: view.copy.applying, objects: 0 });
            expect(api.applyAgentContent.mock.calls[0]).toEqual([TENANT, kit.proposal.id, kit.proposal.digest]);
            // Actual expiry is checked by the real service only after this
            // synthetic transport boundary releases the valid earlier command.
            await act(async () => { await jest.advanceTimersByTimeAsync(2); });
            expect(Date.now()).toBe(T0 + TTL_MS + 1);
            await act(async () => { transport.resolve(undefined); await Promise.resolve(); });
            const result = observed(view, kit);
            console.info(JSON.stringify({ kind: 'deadline-inflight-response-observation', locale,
                clock: Date.now(), pending, afterResponse: result }));
            expect(result).toEqual({ applyCalls: 1, controllerCalls: 1, createCalls: 0, objects: 0,
                ledgerClaimCalls: 0, objectIdWriteCalls: 0, auditCalls: 0, ledgerStatus: 'proposed',
                expiredNotice: true, genericApplyFailure: false, claimsCreated: false, claimsReplayed: false,
                reviewLink: null, enabledCreate: false });
            expect(kit.receipt()).toBeUndefined();
            expect(kit.unexpected).toEqual([]);
        } finally { view.cleanup(); }
    });
});
