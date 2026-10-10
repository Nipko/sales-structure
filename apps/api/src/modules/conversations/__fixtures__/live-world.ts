import { agentTurnFixture, publishTools } from './agent-turn.fixture';
import { randomUUID } from 'crypto';
import { classifyExplicitToolConfirmation } from '../tool-execution-control.service';
import { ToolRetrievalService } from '../tool-retrieval.service';
import { missionToolAllowed } from '../mission-focus';

/**
 * The live-Telegram world shared by the 2026-10-09 / 2026-10-10 live-regression specs: a tenant with a catalogue (or a salon), the central
 * guard reproduced with the rules that matter (signed proposals bound to the mission, the server-side «sí»), and a prose model that never
 * calls a writer unless the spec says so. See live-regression-20261009c.spec.ts for the production history it reproduces.
 */
export const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const PRODUCT = 'b1b48c4a-0000-4000-8000-000000000001';
export const ORDER = 'c03ebdd7-226a-40b0-afc1-cba45b5a0073';
export const APPOINTMENT = '17f69a1b-3333-4333-8333-333333333333';
export const STORE = ['place_catalog_order', 'list_my_catalog_orders', 'get_catalog_order', 'cancel_catalog_order', 'search_products', 'check_stock'];
export const SALON = ['list_services', 'check_availability', 'create_appointment', 'cancel_appointment', 'reschedule_appointment', 'list_customer_appointments', 'search_faqs'];
export const answer = (content: string) => ({ content, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
export const toolCall = (name: string, args: any) => ({ content: '', toolCalls: [{ id: 'c' + Math.random(), function: { name, arguments: JSON.stringify(args) } }], model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
export const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface Product { id: string; name: string; price: number; currency: string; stock: number | null; category: string }
export const AURORA: Product = { id: PRODUCT, name: 'Audífono QA Aurora', price: 119900, currency: 'COP', stock: 2, category: 'Audio' };
export const WRITERS = ['place_catalog_order', 'cancel_catalog_order', 'create_appointment'];

export interface Ledger { id: string; tool: string; args: any; missionId: string; revision: number; source: string; status: 'awaiting' | 'done' }
export interface Options {
    tools: string[]; industry: string; products?: Product[]; orders?: any[];
    /** What the model does with the turn: the production model of that round never calls a writer by itself. */
    writes?: (message: string) => { name: string; args: any } | null;
    voice?: (outcome: any) => string;
    prose?: (message: string) => string;
    /** The conversation so far is handed to the model on every turn (what a live conversation does). */
    history?: boolean;
    /** The tenant has spent its monthly LLM budget (the router is clamped to the cheap tiers). */
    overBudget?: boolean;
}

export function world(options: Options) {
    const f = agentTurnFixture({ toolRetrieval: new ToolRetrievalService() });
    const products = options.products ?? [];
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    const conversationId = randomUUID();
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: { language: 'es', industry: options.industry, tools: {}, rag: { enabled: false }, llm: {} } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: options.industry, subType: 'general' });
    publishTools(f, options.tools);
    if (options.overBudget) {
        f.throttle.getPlanFeatures.mockResolvedValue({ llmTier: 'tier_2', llmCostBudgetUsdCents: 100 });
        f.throttle.getLlmSpendUsdCents.mockResolvedValue(500);
    }
    // The tenant's own catalogue, as `loadOwnCatalogForTurn` reads it.
    const readRows = f.prisma.executeInTenantSchema.getMockImplementation()!;
    f.prisma.executeInTenantSchema.mockImplementation(async (schema: string, sql: string, params?: any[]) => {
        if (/FROM products/.test(sql)) {
            const said = fold(String(params?.[0] ?? ''));
            return products.map(p => ({ id: p.id, name: p.name, price: p.price, currency: p.currency, stock: p.stock, category: p.category,
                mentioned: said.includes(fold(p.name)), total: products.length }));
        }
        return (readRows as any)(schema, sql, params);
    });

    const calls: Array<{ name: string; args: any; result: any }> = [];
    const ledgers: Ledger[] = [];
    let latestText = '';
    const executed: Array<{ name: string; args: any; result: any }> = [];
    const key = (a: any) => JSON.stringify(a);
    const termsOf = (args: any) => {
        const items = (args.items ?? []).map((item: any) => {
            const p = products.find(candidate => candidate.id === item.productId)!;
            return { productId: p.id, productName: p.name, quantity: item.quantity, unitAmountCents: String(p.price * 100),
                totalAmountCents: String(p.price * item.quantity * 100), tracksStock: p.stock !== null };
        });
        const total = items.reduce((sum: number, item: any) => sum + Number(item.totalAmountCents), 0);
        return { version: 1, action: 'create', currency: products[0]?.currency ?? 'COP', totalAmountCents: String(total), items, notes: String(args.notes ?? '').trim() };
    };
    const successOf = (name: string, args: any) => name === 'place_catalog_order'
        ? { success: true, order: { id: ORDER, status: 'pending', paymentStatus: 'pending', currency: 'COP', totalAmount: termsOf(args).items.reduce((s: number, i: any) => s + Number(i.totalAmountCents), 0) / 100,
            // the notes the real writer returns (catalog-order-commands: `notes: row.notes || ''`)
            notes: String(args.notes ?? ''),
            items: termsOf(args).items.map((i: any) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })) } }
        : name === 'create_appointment'
            ? { success: true, appointment: { id: APPOINTMENT, service: 'Corte y estilo', date: args.date, time: args.time, status: 'confirmed', customerName: args.customerName } }
            : { success: true, order: { id: args.orderId, status: 'cancelled' } };

    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any, _cid: string, opts: any) => {
        let result: any;
        const scope = opts?.missionScope;
        if (name === 'list_my_catalog_orders') result = { success: true, orders: options.orders ?? [] };
        else if (name === 'list_customer_appointments') result = { appointments: [] };
        else if (WRITERS.includes(name)) {
            if (scope && !missionToolAllowed(scope, name)) {
                result = { error: 'mission_selection_required', controlBlocked: true, persisted: false };
            } else {
                const ledger = ledgers.find(l => l.status === 'awaiting' && l.tool === name && key(l.args) === key(args));
                const challenge = (existing?: Ledger) => {
                    const l = existing ?? { id: randomUUID(), tool: name, args, missionId: '', revision: 0, source: '', status: 'awaiting' as const };
                    l.missionId = scope?.missionId; l.revision = scope?.revision; l.source = scope?.inboundMessageId;
                    if (!existing) ledgers.push(l);
                    return { error: 'confirmation_required', confirmationId: l.id, message: 'Confirmación requerida',
                        ...(name === 'place_catalog_order' ? { catalogTerms: termsOf(args) } : {}) };
                };
                if (!ledger) result = challenge();
                else {
                    const expected = scope?.expectedReply;
                    const answers = !!scope && ledger.missionId === scope.missionId && ledger.revision === scope.revision
                        && expected?.kind === 'confirmation' && expected.missionId === scope.missionId && expected.ledgerId === ledger.id
                        && expected.sourceMessageId !== scope.inboundMessageId && ledger.source !== scope.inboundMessageId;
                    if (answers && classifyExplicitToolConfirmation(latestText, { effect: 'transactional', pendingTool: name }) === 'confirmed') {
                        ledger.status = 'done';
                        result = successOf(name, args);
                        executed.push({ name, args, result });
                    } else result = challenge(ledger);
                }
            }
        } else result = { items: [] };
        calls.push({ name, args, result });
        return result;
    });
    f.toolExecutionControl.findPendingConfirmation.mockImplementation(async (_s: string, _c: string, _k: string, reply: string | undefined, scope: any) => {
        const bound = scope?.expectedReply?.kind === 'confirmation' ? scope.expectedReply.ledgerId : undefined;
        const row = ledgers.filter(l => l.status === 'awaiting' && (!bound || l.id === bound)).slice(-1)[0];
        if (!row) return null;
        if (reply !== undefined) {
            if (!scope || row.missionId !== scope.missionId || row.revision !== scope.revision || scope.expectedReply?.kind !== 'confirmation'
                || scope.expectedReply.ledgerId !== row.id || scope.expectedReply.missionId !== scope.missionId) return null;
            if (classifyExplicitToolConfirmation(reply, { effect: 'transactional', pendingTool: row.tool }) !== 'confirmed') return null;
        }
        return { ledgerId: row.id, toolName: row.tool, args: row.args };
    });

    const modelSaw: string[] = [];
    const routed: Array<{ task: string; allowedTiers: string[]; budgetConstrained: boolean }> = [];
    f.llmRouter.execute.mockImplementation(async (request: any) => {
        if (!['conversation', 'tool_calling'].includes(request.task)) return answer('{}');
        routed.push({ task: request.task, allowedTiers: request.allowedTiers, budgetConstrained: request.budgetConstrained === true });
        const last = String((request.messages ?? []).slice(-1)[0]?.content ?? '');
        const thread = JSON.stringify(request.messages ?? []);
        if (thread.includes('confirmation_required') || thread.includes('"success":true')) {
            const lastCall = calls[calls.length - 1];
            return answer(options.voice?.(lastCall) ?? (lastCall?.result?.success === true ? '¡Listo! Todo quedó registrado.'
                : 'Para confirmar su pedido, estos son los detalles: 1 Audífono QA Aurora. ¿Confirma que desea realizar este pedido?'));
        }
        modelSaw.push(last);
        const write = options.writes?.(last);
        if (write) return toolCall(write.name, write.args);
        return answer(options.prose?.(last) ?? 'Entiendo que desea hacer el pedido. ¿Confirma que desea realizar este pedido?');
    });
    let id: string | undefined;
    const thread: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const turn = async (message: string) => {
        latestText = message;
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: id,
            ...(options.history ? { conversationHistory: thread.map(row => ({ ...row })) } : {}) }, {
            evalMode: true, sandboxContactId: '00000000-0000-4000-8000-00000000eba1', sandboxConversationId: conversationId,
            sandboxNamespace: namespace, sandboxInboundMessageId: randomUUID(),
        });
        id = result.debug.runtimeSessionId;
        thread.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply });
        return result;
    };
    const ran = (name: string) => calls.filter(call => call.name === name);
    return { f, turn, ran, calls, executed, modelSaw, routed, get created() { return executed.filter(call => call.name === 'place_catalog_order').length; } };
}
