/** @jest-environment node */
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';
import { getAgentOperation, validateAgentOperationInput, type AgentContentProposal, type AppliedAgentContentObject } from '@parallext/shared';
import { AgentContentProposalService } from './agent-content-proposal.service';
import { CopilotController } from './copilot.controller';

/** PREPARED ONLY. Future destination apps/api/src/modules/copilot/assist-content-receipt.ui.spec.tsx
 * 20 cases, four locales x missing-object contradiction / verified creation /
 * verified replay / pending control / rejected apply control.
 * REAL service.propose/apply + handler preview/read + controller envelope +
 * REAL AgentContentReview + real NextIntl/messages. Strict memory adapters at
 * Prisma/owning-module boundaries only. No private method interception.
 * Not a new backend idempotency test: backend receipts are fixture producers;
 * primary new oracle is what the person sees AFTER an async apply in the card.
 * Node environment plus OWN JSDOM avoids API PostgreSQL setup under browser
 * exports; root must configure TSX+decorators and NextIntl ESM transform, mapping
 * shared to source, before first Jest. Use isolated runner WITHOUT DB globalSetup.
 */
jest.mock('@/lib/api', () => ({ api: { applyAgentContent: jest.fn() } }), { virtual: true });
const { api } = jest.requireMock('@/lib/api') as { api: { applyAgentContent: jest.Mock } };
const TENANT = '11111111-1111-4111-8111-111111111111';
const ACTOR = { id: '22222222-2222-4222-8222-222222222222', role: 'tenant_admin' };
const PROPOSAL = '33333333-3333-4333-8333-333333333333';
const OBJECT = '44444444-4444-4444-8444-444444444444';
const SCHEMA = 'tenant_receipt_local';
const INPUT = { title: 'Synthetic QA receipt', content: 'Synthetic local content, no customer or outbound message.' };
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [locale,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../dashboard/messages', locale + '.json'), 'utf8')),
])) as Record<typeof LOCALES[number], any>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://local-receipts.test/' });
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
                    expires_at: new Date(Date.now() + 600_000).toISOString(), created_object_id: null,
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
    const proposal = await service.propose(TENANT, 'knowledge.faq.create', INPUT, ACTOR, 'receipt-ui-local-01');
    expect(proposal.status).toBe('proposed'); expect(proposal.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(proposal.preview.after).toEqual([{ field: 'title', value: INPUT.title },
        { field: 'content', value: INPUT.content }, { field: 'type', value: 'faq' }]);
    expect(ledger).toHaveLength(1); expect(objects).toHaveLength(0); expect(unexpected).toEqual([]);
    let receipt: AppliedAgentContentObject | undefined;
    async function apply(tenant: string, id: string, digest: string) {
        expect([tenant, id, digest]).toEqual([TENANT, proposal.id, proposal.digest]);
        try {
            const response = await controller.applyOperation(tenant, id, { digest }, { user: { sub: ACTOR.id, role: ACTOR.role } });
            receipt = response.data;
            return response;
        } catch (error: any) {
            // Faithful apiPost error envelope: backend JSON error -> errorCode,
            // message/status -> error; component must not claim success.
            const body = typeof error?.getResponse === 'function' ? error.getResponse() : null;
            return { success: false, httpStatus: error?.getStatus?.() ?? 500,
                error: body?.message || error.message, errorCode: body?.error };
        }
    }
    return { proposal, ledger, objects, knowledge, prisma, unexpected, apply, receipt: () => receipt };
}
async function mounted(locale: typeof LOCALES[number], proposal: AgentContentProposal) {
    const messages = MESSAGES[locale]; const copy = messages.agentContent;
    for (const value of [copy.willCreate, copy.created, copy.replayed, copy.apply, copy.applying,
        copy.verification.object_missing, copy.errors.apply_failed, copy.reviewObject]) {
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
function noUnauthorizedEffects(kit: Awaited<ReturnType<typeof producer>>) {
    expect(kit.unexpected).toEqual([]);
    expect(api.applyAgentContent).toHaveBeenCalledTimes(1);
    expect(api.applyAgentContent.mock.calls[0]).toEqual([TENANT, kit.proposal.id, kit.proposal.digest]);
}

describe.each(LOCALES)('Assist actual content receipt rendered after apply (%s)', locale => {
    beforeEach(() => api.applyAgentContent.mockReset());
    it('product: a consumed proposal with no created object says so without claiming it had already been created', async () => {
        const kit = await producer();
        // A concurrent earlier claim/crash is an explicit source row fixture,
        // NOT a replacement of the private receipt method or a fake API result.
        Object.assign(kit.ledger[0], { status: 'applied', created_object_id: null });
        api.applyAgentContent.mockImplementation(kit.apply);
        const view = await mounted(locale, kit.proposal);
        try {
            await view.click();
            expect(kit.receipt()).toMatchObject({ outcome: 'replayed', object: null,
                verification: 'unavailable', verificationReason: 'object_missing' });
            expect(view.container.textContent).toContain(view.copy.verification.object_missing);
            expect({ claimsCreated: view.container.textContent?.includes(view.copy.created),
                claimsPreviouslyCreated: view.container.textContent?.includes(view.copy.replayed) })
                .toEqual({ claimsCreated: false, claimsPreviouslyCreated: false });
            expect(view.container.querySelector('a')).toBeNull(); expect(view.button()).toBeNull();
            expect(kit.knowledge.createResource).not.toHaveBeenCalled(); expect(kit.objects).toHaveLength(0);
            noUnauthorizedEffects(kit);
        } finally { view.cleanup(); }
    });
    it('product: a verified creation stops claiming that the object does not exist yet', async () => {
        const kit = await producer(); api.applyAgentContent.mockImplementation(kit.apply);
        const view = await mounted(locale, kit.proposal);
        try {
            await view.click();
            expect(kit.receipt()).toMatchObject({ outcome: 'created', verification: 'verified', object: { id: OBJECT } });
            expect(view.container.textContent).toContain(view.copy.created);
            expect(view.container.textContent).not.toContain(view.copy.willCreate);
            expect(view.container.querySelector('a')?.getAttribute('href')).toBe('/admin/knowledge/faqs');
            expect(view.button()).toBeNull(); expect(kit.objects).toHaveLength(1);
            expect(kit.knowledge.createResource).toHaveBeenCalledTimes(1); noUnauthorizedEffects(kit);
        } finally { view.cleanup(); }
    });
    it('product: a verified replay stops claiming future creation and creates no second object', async () => {
        const kit = await producer();
        Object.assign(kit.ledger[0], { status: 'applied', created_object_id: OBJECT });
        kit.objects.push({ id: OBJECT, ...INPUT, type: 'faq' });
        api.applyAgentContent.mockImplementation(kit.apply);
        const view = await mounted(locale, kit.proposal);
        try {
            await view.click();
            expect(kit.receipt()).toMatchObject({ outcome: 'replayed', verification: 'verified', object: { id: OBJECT } });
            expect(view.container.textContent).toContain(view.copy.replayed);
            expect(view.container.textContent).not.toContain(view.copy.willCreate);
            expect(view.container.querySelector('a')?.getAttribute('href')).toBe('/admin/knowledge/faqs');
            expect(view.button()).toBeNull(); expect(kit.knowledge.createResource).not.toHaveBeenCalled();
            expect(kit.objects).toHaveLength(1); noUnauthorizedEffects(kit);
        } finally { view.cleanup(); }
    });
    it('control: pending apply disables the normal button and makes no premature creation claim', async () => {
        const kit = await producer(); const gate = deferred<boolean>();
        api.applyAgentContent.mockImplementation(async (...args: [string, string, string]) => { await gate.promise; return kit.apply(...args); });
        const view = await mounted(locale, kit.proposal);
        try {
            await view.click();
            expect(view.button()?.disabled).toBe(true); expect(view.button()?.textContent).toBe(view.copy.applying);
            expect(view.container.textContent).toContain(view.copy.willCreate);
            expect(view.container.textContent).not.toContain(view.copy.created);
            expect(view.container.textContent).not.toContain(view.copy.replayed);
            await act(async () => { view.button()!.click(); });
            expect(api.applyAgentContent).toHaveBeenCalledTimes(1);
            expect(kit.knowledge.createResource).not.toHaveBeenCalled(); expect(kit.objects).toHaveLength(0);
            await act(async () => { gate.resolve(true); await Promise.resolve(); });
            expect(kit.receipt()).toMatchObject({ outcome: 'created', verification: 'verified' });
            expect(view.container.textContent).toContain(view.copy.created); noUnauthorizedEffects(kit);
        } finally { view.cleanup(); }
    });
    it('control: rejected stale digest renders an error, releases the button and never says the object was created', async () => {
        const kit = await producer();
        kit.ledger[0].input = { ...INPUT, content: 'Synthetic changed content after this review' };
        api.applyAgentContent.mockImplementation(kit.apply);
        const view = await mounted(locale, kit.proposal);
        try {
            await view.click();
            expect(kit.receipt()).toBeUndefined();
            expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(view.copy.errors.apply_failed);
            expect(view.container.textContent).toContain(view.copy.willCreate);
            expect(view.container.textContent).not.toContain(view.copy.created);
            expect(view.container.textContent).not.toContain(view.copy.replayed);
            expect(view.button()?.disabled).toBe(false); expect(view.button()?.textContent).toBe(view.copy.apply);
            expect(view.container.querySelector('a')).toBeNull(); expect(kit.objects).toHaveLength(0);
            expect(kit.knowledge.createResource).not.toHaveBeenCalled(); noUnauthorizedEffects(kit);
        } finally { view.cleanup(); }
    });
});