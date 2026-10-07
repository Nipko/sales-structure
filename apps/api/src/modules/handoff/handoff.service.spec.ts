import { HandoffService } from './handoff.service';
import { isActionOrientedRefundQuestion } from './handoff-policy-question';

describe('HandoffService structured handoff', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const schemaName = 'tenant_acme_11111111111141118111111111111111';
    const contactId = '33333333-3333-4333-8333-333333333333';

    function makeHarness() {
        // Status, resolution flag and internal note now commit as one transition.
        const transition = jest.fn().mockResolvedValue([]);
        const prisma: any = {
            transactionInTenantSchema: jest.fn().mockImplementation(
                async (_schema: string, callback: any) => callback(transition)),
            getTenantSchemaName: jest.fn().mockResolvedValue(schemaName),
            tenant: {
                findUnique: jest.fn().mockImplementation(async (args: any) => (
                    args?.select?.language ? { language: 'es-CO' } : { billingEmail: null }
                )),
            },
            user: { findFirst: jest.fn().mockResolvedValue(null) },
            executeInTenantSchema: jest.fn().mockImplementation(async (_schema: string, sql: string) => {
                if (sql.includes('FROM messages') && sql.includes('LIMIT 20')) {
                    return [{
                        id: '44444444-4444-4444-8444-444444444444',
                        direction: 'inbound',
                        content_text: 'Quiero cancelar mi pedido',
                        metadata: {},
                        created_at: '2026-08-08T00:00:00.000Z',
                    }];
                }
                if (sql.includes('FROM turn_traces')) {
                    return [{
                        id: '55555555-5555-4555-8555-555555555555',
                        steps: [{
                            type: 'tool_result',
                            label: 'lookup_order',
                            startedAt: '2026-08-08T00:00:00.000Z',
                            metadata: { ok: true },
                        }],
                    }];
                }
                if (sql.includes('FROM conversation_traces')) return [];
                if (sql.includes('LEFT JOIN contacts')) {
                    return [{
                        contact_id: contactId,
                        contact_name: 'Cliente',
                        contact_phone: '+573001234567',
                        last_message: 'Quiero cancelar mi pedido',
                    }];
                }
                return [];
            }),
        };
        const redis = {
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
            get: jest.fn(),
        };
        const events = { emit: jest.fn().mockReturnValue(true), emitAsync: jest.fn().mockResolvedValue([]) };
        const email = { send: jest.fn().mockResolvedValue(undefined) };
        const templates = { renderAndSend: jest.fn() };
        const llm = {
            execute: jest.fn().mockResolvedValue({
                content: JSON.stringify({
                    customerIntent: 'Cancelar el pedido',
                    knownFacts: ['El cliente pidió una cancelación'],
                    pendingActions: ['Validar si aún se puede cancelar'],
                    confidence: 0.9,
                    uncertainty: ['No se conoce el número de pedido'],
                }),
            }),
        };
        const aiResolution = { ensureResolutionColumns: jest.fn().mockResolvedValue(undefined) };
        const service = new HandoffService(
            prisma,
            redis as any,
            events as any,
            email as any,
            templates as any,
            llm as any,
            aiResolution as any,
            { runExclusive: jest.fn() } as any,
        );
        jest.spyOn(service as any, 'tryAutoAssign').mockResolvedValue(null);
        return { service, prisma, redis, events, llm, aiResolution, transition };
    }

    it('persists and emits the structured summary while preserving the legacy string', async () => {
        const h = makeHarness();
        const result = await h.service.executeHandoff(
            tenantId,
            conversationId,
            {
                id: 'provider-message-1',
                tenantId,
                conversationId,
                channelType: 'whatsapp',
                channelAccountId: 'wa-1',
                contactId: 'external-contact-1',
                direction: 'inbound',
                content: { type: 'text', text: 'Quiero cancelar' },
                timestamp: new Date('2026-08-08T00:00:00.000Z'),
                status: 'delivered',
                metadata: { traceId: 'request-trace-1' },
            },
            'human_request',
        );

        const persistenceCall = h.transition.mock.calls.find((call: any[]) =>
            String(call[0]).includes('handoff_summary = $3::jsonb'));
        expect(persistenceCall).toBeDefined();
        const metadataHandoff = JSON.parse(persistenceCall[1][1]);
        const structured = JSON.parse(persistenceCall[1][2]);
        expect(metadataHandoff.summary).toEqual(expect.any(String));
        expect(metadataHandoff.structuredSummary).toEqual(structured);
        expect(structured).toMatchObject({
            version: 1,
            reason: 'human_request',
            customerIntent: 'Cancelar el pedido',
            traceId: 'request-trace-1',
            generatedBy: 'llm',
        });
        expect(result.summary).toEqual(expect.any(String));
        expect(result.structuredSummary).toEqual(structured);

        // One event per destination. The single `handoff.escalated` used to
        // reach six consumers at once, so a failure in any of them re-announced
        // the transfer to the five that had already succeeded.
        for (const destination of ['inbox', 'crm', 'webhooks', 'push', 'slack', 'sms']) {
            expect(h.events.emitAsync).toHaveBeenCalledWith(`handoff.escalated.${destination}`,
                expect.objectContaining({
                    tenantId,
                    schemaName,
                    conversationId,
                    summary: result.summary,
                    structuredSummary: structured,
                    traceId: 'request-trace-1',
                }));
        }
        const cached = JSON.parse(h.redis.set.mock.calls[0][1]);
        expect(cached.summary).toBe(result.summary);
        expect(cached.structuredSummary).toEqual(structured);
        expect(h.aiResolution.ensureResolutionColumns).toHaveBeenCalledWith(schemaName);
    });

    it('uses a deterministic fallback when the LLM and persisted trace are unavailable', async () => {
        const h = makeHarness();
        h.llm.execute.mockRejectedValue(new Error('provider unavailable'));
        const context = {
            tenantId,
            conversationId,
            reason: 'complaint',
            language: 'es',
            generatedAt: '2026-08-08T00:00:00.000Z',
            messages: [{
                id: '44444444-4444-4444-8444-444444444444',
                direction: 'inbound',
                content_text: 'Necesito ayuda',
                metadata: {},
            }],
            turnTrace: null,
            conversationTrace: null,
        };

        const first = await (h.service as any).generateStructuredSummary(context);
        const second = await (h.service as any).generateStructuredSummary(context);

        expect(first.generatedBy).toBe('deterministic_fallback');
        expect(first.traceId).toMatch(/^handoff_[a-f0-9]{32}$/);
        expect(second.traceId).toBe(first.traceId);
    });
});

describe('HandoffService canonical auto-assignment event', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const schemaName = 'tenant_acme_11111111111141118111111111111111';
    const agentId = '33333333-3333-4333-8333-333333333333';
    const contactId = '44444444-4444-4444-8444-444444444444';

    function makeHarness(transactionFails = false) {
        const order: string[] = [];
        const query = jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('RETURNING contact_id')) return [{ contact_id: contactId }];
            if (sql.includes('SELECT phone FROM contacts')) return [{ phone: '+573001234567' }];
            return [];
        });
        const prisma: any = {
            executeInTenantSchema: jest.fn().mockImplementation(async (_schema: string, sql: string) => {
                if (sql.includes('SELECT contact_id')) return [{ contact_id: contactId }];
                if (sql.includes('SELECT score')) return [{ score: 10 }];
                return [];
            }),
            $queryRawUnsafe: jest.fn()
                .mockResolvedValueOnce([{ settings: {} }])
                .mockResolvedValueOnce([{
                    id: agentId,
                    name: 'Agente Uno',
                    active_count: 0,
                    matching_skills_count: 1,
                }]),
            transactionInTenantSchema: jest.fn().mockImplementation(async (_schema: string, callback: any) => {
                if (transactionFails) throw new Error('assignment transaction failed');
                const value = await callback(query);
                order.push('commit');
                return value;
            }),
        };
        const events = {
            emit: jest.fn().mockImplementation(() => { order.push('event'); return true; }),
        };
        const service = new HandoffService(
            prisma,
            {} as any,
            events as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { runExclusive: jest.fn() } as any,
        );
        return { service, prisma, events, query, order };
    }

    it('emits conversation.assigned only after the assignment transaction commits', async () => {
        const h = makeHarness();

        await expect((h.service as any).tryAutoAssign(
            tenantId,
            schemaName,
            conversationId,
            'human_request',
        )).resolves.toMatchObject({ agentId, contactId, phone: '+573001234567' });

        expect(h.order).toEqual(['commit', 'event']);
        expect(h.events.emit).toHaveBeenCalledWith('conversation.assigned', expect.objectContaining({
            tenantId,
            schemaName,
            conversationId,
            agentId,
            contactId,
            phone: '+573001234567',
            assignmentSource: 'auto',
            assignedAt: expect.any(String),
        }));
    });

    it('does not emit conversation.assigned when the auto-assignment transaction fails', async () => {
        const h = makeHarness(true);

        await expect((h.service as any).tryAutoAssign(
            tenantId,
            schemaName,
            conversationId,
            'human_request',
        )).resolves.toBeNull();

        expect(h.events.emit).not.toHaveBeenCalledWith('conversation.assigned', expect.anything());
    });
});

/**
 * D13 (sep-2026): una ficha de "paso a una persona" solo vale si el motor la
 * cumple. Al emparejar los motivos visibles con sus disparadores apareció que
 * un disparador CON tilde no podía coincidir nunca: el mensaje del cliente ya
 * llegaba sin tildes y el disparador no, así que los dos no se encontraban.
 * El dueño veía su regla en pantalla, escrita, sin hacer nada.
 */
describe('custom handoff triggers match however the word is spelled', () => {
    const service: any = Object.create(HandoffService.prototype);
    const conversation = { metadata: {} };

    function config(triggers: string[]) {
        return { behavior: { handoffTriggers: triggers } } as any;
    }

    it('fires on an accented trigger the owner typed in the editor', () => {
        expect(service.shouldHandoff('creo que hubo electrocución', conversation, config(['electrocución'])))
            .toBe('custom_trigger:electrocución');
    });

    it('still fires on the unaccented trigger the recipes seed', () => {
        expect(service.shouldHandoff('hubo una electrocucion', conversation, config(['electrocucion'])))
            .toBe('custom_trigger:electrocucion');
    });

    it('catches the accented spelling a phone keyboard produces', () => {
        expect(service.shouldHandoff('pido la homologación de materias', conversation, config(['homologacion'])))
            .toBe('custom_trigger:homologacion');
    });

    it('does not invent a match out of an empty trigger', () => {
        expect(service.shouldHandoff('hola, quiero info', conversation, config(['   ']))).toBeNull();
    });
});

/**
 * Production (Telegram, store): "¿Cuál es la política de devoluciones del
 * audífono QA de prueba?" was escalated as a complaint and the bot went mute.
 * A question ABOUT a policy is informational; a real complaint still escalates.
 */
describe('policy questions are answered, real complaints still escalate', () => {
    const service: any = Object.create(HandoffService.prototype);
    const conversation = { metadata: {} };
    const config = { behavior: { handoffTriggers: [] } } as any;
    const ask = (m: string) => service.shouldHandoff(m, conversation, config);

    it.each([
        '¿Cuál es la política de devoluciones del audífono QA de prueba?',
        '¿Aceptan devoluciones?',
        '¿Hacen reembolsos?',
        '¿Tienen descuentos?',
        'do you have a refund policy?',
        'Do you accept returns? what is your discount policy?',
        'qual é a política de reembolso?',
        'tem desconto para pagamento à vista?',
        'quelle est votre politique de remboursement ?',
        'avez-vous des remises ?',
        'cual es la politica de devolucion',
    ])('does not hand off on %s', (m) => {
        expect(ask(m)).toBeNull();
    });

    it.each([
        ['quiero devolver el audífono, llegó dañado', 'complaint'],
        ['exijo un reembolso', 'complaint'],
        ['quiero mi dinero de vuelta, esto es una estafa', 'complaint'],
        ['esto es una estafa', 'complaint'],
        ['¿Cuál es la política de devoluciones? el audífono llegó dañado', 'complaint'],
        ['¿cuál es la política de devoluciones? esto es una estafa', 'complaint'],
        ['¿por qué no me han hecho el reembolso?', 'complaint'],
        ['je veux un remboursement', 'complaint'],
        ['quero devolver o aparelho, chegou danificado', 'complaint'],
        ['je veux retourner le produit, il est arrivé endommagé', 'complaint'],
        ['quero meu reembolso agora', 'complaint'],
        ['¿me hace un descuento?', 'discount_request'],
        ['¿me lo deja más barato?', 'discount_request'],
        ['¿tienen descuentos? ¿me lo deja más barato?', 'discount_request'],
        ['¿me pueden hacer un descuento?', 'discount_request'],
        ['¿me hacen un descuento?', 'discount_request'],
        ['el audífono está defectuoso, ¿cuál es la política de devoluciones?', 'complaint'],
        ['ustedes no aceptan devoluciones', 'complaint'],
        ['¿me hacen un reembolso?', 'complaint'],
        ['¿hacen reembolsos? tengo una queja', 'complaint'],
    ])('still hands off on %s', (m, reason) => {
        expect(ask(m)).toBe(reason);
    });
});

/**
 * Review of the exemption above: a sentence shaped like a question must not hide
 * a customer's own case. Personal refund / return problems and price negotiation
 * still reach a person; only a GENERAL question about the policy is answered.
 */
describe('a personal case is never hidden behind a policy question', () => {
    const service: any = Object.create(HandoffService.prototype);
    const conversation = { metadata: {} };
    const config = { behavior: { handoffTriggers: [] } } as any;
    const ask = (m: string) => service.shouldHandoff(m, conversation, config);

    it.each([
        '¿hay reembolso? me cobraron dos veces',
        '¿Por qué no hay reembolso todavía?',
        '¿Por qué todavía no tienen mi reembolso?',
        '¿Cuánto tiempo tarda mi reembolso? ya van 3 semanas',
        '¿Hay devolución? el producto no sirve',
        '¿hay reembolso para mi pedido 123? nunca llegó',
        'Quiero mi reembolso. ¿Tienen política de devolución?',
        'tem reembolso? me cobraram duas vezes',
        'existe reembolso? o produto veio com defeito',
        "avez-vous une politique de remboursement? je n'ai pas reçu mon colis",
        'compré el audífono y no me gustó, ¿aceptan devoluciones?',
        '¿hay reembolso? el pedido no me llegó',
        '¿aceptan devoluciones? el audífono no funciona',
        '¿hay reembolso? ya compré y me arrepentí',
    ])('hands off on %s', (m) => {
        expect(ask(m)).toBe('complaint');
    });

    it.each([
        '¿hacen descuento para mí?',
        '¿Me tienen algún descuento?',
        'tem como me dar um desconto?',
        'tem desconto pra mim?',
        'faites-vous une remise pour moi ?',
    ])('keeps price negotiation with a person: %s', (m) => {
        expect(ask(m)).toBe('discount_request');
    });

    it.each([
        '¿tienen descuento si compro 3?',
        '¿hay descuento por pago en efectivo?',
        '¿Cuánto tiempo tarda un reembolso?',
        '¿Cuál es el plazo para devoluciones?',
        '¿Aceptan devoluciones de productos abiertos?',
        'do you offer refunds for 30 days?',
    ])('answers the general question %s', (m) => {
        // A volume or payment-method discount is a published policy, not a negotiation.
        expect(ask(m)).toBeNull();
    });

    it.each([
        ['¿cuál es la política de devoluciones? quiero hacer una reclamación', 'complaint'],
        ['¿tienen descuento? lo quiero más barato', 'discount_request'],
        ['¿tienen descuentos? necesito un precio especial', 'discount_request'],
        ['¿cuál es la política de devoluciones? tengo una queja', 'complaint'],
        ['¿hacen reembolsos? quiero hablar con un abogado', 'complaint'],
        ['¿qué hago si el producto llegó roto? esto es una estafa', 'complaint'],
    ])('a non-topic escalation word still escalates inside a policy question: %s', (m, reason) => {
        // Kills the mutation "a policy question cancels EVERY keyword".
        expect(ask(m)).toBe(reason);
    });
});

/**
 * "quiero devolver" is an ordinary verb: the rental customer returning a car,
 * the guest returning the keys. It escalates only with a defect or grievance.
 */
describe('returning something is not a complaint by itself', () => {
    const service: any = Object.create(HandoffService.prototype);
    const conversation = { metadata: {} };
    const config = { behavior: { handoffTriggers: [] } } as any;
    const ask = (m: string) => service.shouldHandoff(m, conversation, config);

    it.each([
        'quiero devolver la llamada',
        'quisiera devolver el carro mañana a las 5',
        'necesito devolver las llaves del apartamento',
        'quero devolver o carro alugado amanhã',
        'je veux retourner au menu',
        '¿Qué hago si el producto llegó roto?',
        '¿qué pasa si llega dañado?',
        '¿qué hago si el producto llega roto?',
        '¿Cuál es la política de devolución si el producto llega dañado?',
        '¿Aceptan devoluciones si el producto llegó roto?',
        'what happens if the product arrives broken?',
        'o que acontece se o produto chegou quebrado?',
    ])('does not hand off on %s', (m) => {
        expect(ask(m)).toBeNull();
    });

    it.each([
        'quiero devolver el audífono, llegó dañado',
        'me llegó roto',
        'llegó roto el audífono que compré',
        '¿qué hago? me llegó roto el audífono',
        '¿qué hago si me llegó roto?',
        '¿Qué hago? el producto llegó roto',
        'quero devolver o aparelho, chegou danificado',
        'je veux retourner le produit, il est arrivé endommagé',
        '¿hay devolución? el audífono llegó dañado, sí llegó roto',
    ])('hands off on %s', (m) => {
        expect(ask(m)).toBe('complaint');
    });
});

/**
 * The platform seeds `reembolso` as a custom trigger on most personas, so the
 * same policy question reached a person through `custom_trigger:reembolso`.
 */
describe('seeded custom triggers follow the same policy-question exemption', () => {
    const service: any = Object.create(HandoffService.prototype);
    const conversation = { metadata: {} };
    const config = (triggers: string[]) => ({ behavior: { handoffTriggers: triggers } }) as any;
    const ask = (m: string, triggers: string[]) => service.shouldHandoff(m, conversation, config(triggers));

    it.each([
        ['¿hacen reembolsos?', ['reembolso']],
        ['¿Hay reembolso?', ['reembolso']],
        ['¿Cuál es la política de devoluciones?', ['devolucion']],
        ['do you offer refunds?', ['refund']],
        ['do you accept returns?', ['returns']],
        ['¿tienen descuento?', ['descuento']],
        ['tem desconto para pagamento à vista?', ['desconto']],
        ['quelle est votre politique de remboursement ?', ['remboursement']],
    ])('answers %s', (m, triggers) => {
        expect(ask(m, triggers)).toBeNull();
    });

    it.each([
        ['quiero mi reembolso', ['reembolso'], 'complaint'],
        ['i want my refund', ['refund'], 'custom_trigger:refund'],
        ['¿hay reembolso? me cobraron dos veces', ['reembolso'], 'complaint'],
        ['¿hacen reembolsos? el pedido nunca llegó', ['reembolso'], 'complaint'],
        ['¿Por qué no hay reembolso todavía?', ['reembolso'], 'complaint'],
        ['¿Cuánto tiempo tarda mi reembolso?', ['reembolso'], 'complaint'],
        ['do you accept returns? my order never arrived', ['returns'], 'custom_trigger:returns'],
        ['do you have a refund policy? i was charged twice', ['refund'], 'custom_trigger:refund'],
    ])('still hands off on %s', (m, triggers, reason) => {
        expect(ask(m, triggers as string[])).toBe(reason);
    });

    it('leaves every other custom trigger untouched', () => {
        expect(ask('¿hacen reembolsos? tengo una mordedura', ['reembolso', 'mordedura']))
            .toBe('custom_trigger:mordedura');
        expect(ask('¿cuál es el precio de la boda?', ['boda'])).toBe('custom_trigger:boda');
        expect(ask('¿hacen reembolso > USD 200?', ['reembolso > usd 200']))
            .toBe('custom_trigger:reembolso > usd 200');
    });
});

/**
 * Each wording of "this is MY case" is enough on its own to keep a question about
 * refunds with a person. One sentence per signal, so a signal that stops working
 * is noticed even though the others still cover the usual messages.
 */
describe('every personal-case signal escalates by itself', () => {
    const service: any = Object.create(HandoffService.prototype);
    const conversation = { metadata: {} };
    const config = { behavior: { handoffTriggers: [] } } as any;
    const ask = (m: string) => service.shouldHandoff(m, conversation, config);

    it.each([
        // a delay
        '¿Por qué todavía hacen esperar con el reembolso?',
        'tem reembolso? por que não aceitam o meu?',
        'avez-vous une politique de remboursement ? pourquoi n y a-t-il pas de réponse ?',
        '¿hay reembolso? aún no me responden',
        'tem reembolso? ainda não respondem',
        'avez-vous une politique de remboursement ? toujours pas de réponse',
        '¿hay reembolso? ya llevo una semana esperando',
        // an order or a purchase of theirs
        '¿hay devolución para el pedido 4521?',
        '¿hay reembolso? ya compré el audífono',
        'tem reembolso? cobraram duas vezes',
        'avez-vous une politique de remboursement ? j\'ai acheté ce produit hier',
        'avez-vous une politique de remboursement ? je n\'ai pas de réponse',
        // it did not arrive
        '¿hay reembolso? se perdió el envío',
        'avez-vous une politique de remboursement ? le colis n\'est pas arrivé',
        'tem reembolso? não recebi o pedido',
        '¿hay reembolso? nunca recibí nada',
        // it does not work or was not liked
        '¿aceptan devoluciones? dejó de funcionar',
        '¿hay reembolso? se rompió al abrirlo',
        'existe reembolso? o produto tem defeito',
        'existe reembolso? o produto veio com uma peça solta',
        'avez-vous une politique de remboursement ? le produit est défectueux',
        'avez-vous une politique de remboursement ? ça ne me plaît pas',
        'tem reembolso? não gostei do produto',
        // a fraud that is not one of the plain keywords
        '¿hay reembolso? esto es un fraude',
    ])('hands off on %s', (m) => {
        expect(ask(m)).toBe('complaint');
    });

    it.each([
        'tem desconto para mim?',
        'tem como me fazer um desconto?',
        'avez-vous des remises ? vous pouvez me faire un prix',
        'tem desconto? vocês me fazem um preço',
        'tem desconto? vocês me dão um preço',
    ])('keeps price negotiation with a person: %s', (m) => {
        expect(ask(m)).toBe('discount_request');
    });

    it('does not answer a refund question that has no policy framing', () => {
        expect(ask('¿Dónde está el reembolso?')).toBe('complaint');
    });

    it('treats a conditional statement (not a question) as a report', () => {
        expect(ask('si el producto llegó roto lo devuelvo')).toBe('complaint');
    });

    it('does not let a hypothetical hide a personal case', () => {
        expect(ask('¿Qué hago si llegó roto? el pedido nunca llegó')).toBe('complaint');
    });

    it('answers a general policy question that mentions a topic noun in the plural or by another name', () => {
        expect(ask('¿Hacen rebajas?')).toBeNull();
        expect(ask('¿Tienen remises?')).toBeNull();
    });
});

describe('custom triggers: the policy-topic words and the personal-case signals', () => {
    const service: any = Object.create(HandoffService.prototype);
    const conversation = { metadata: {} };
    const ask = (m: string, triggers: string[]) => service.shouldHandoff(m, conversation, { behavior: { handoffTriggers: triggers } } as any);

    it.each([
        ['¿hacen reembolsos?', ['reembolsos']],
        ['¿tienen descuentos?', ['descuentos']],
        ['¿aceptan devoluciones?', ['devoluciones']],
        ['¿hacen rebajas?', ['rebaja']],
        ['¿hacen rebajas?', ['rebajas']],
        ['tem descontos?', ['descontos']],
        ['avez-vous des remises ?', ['remises']],
        ['quelle est votre politique de remboursements ?', ['remboursements']],
        ['do you offer refunds?', ['refunds']],
        ['what is your return policy?', ['return']],
        ['what is your return policy?', ['returns']],
    ])('answers %s with trigger %j', (m, triggers) => {
        expect(ask(m, triggers as string[])).toBeNull();
    });

    it.each([
        'is there a refund policy? why isn\'t there an answer',
        'is there a refund policy? why no answer',
        'do you have a refund policy? i bought it yesterday',
        'do you have a refund policy? the package never arrived',
        'is there a refund policy? the package hasn\'t arrived',
        'is there a refund policy? it broke after a week',
        'is there a refund policy? the app is not working',
        'do you have a refund for me?',
    ])('hands off on %s', (m) => {
        expect(ask(m, ['refund'])).toBe('custom_trigger:refund');
    });
});

/**
 * Round 2. An affirmative «sí» ("yes, it arrived broken") folds into the
 * conditional «si», and the Spanish noun «caso» looks like the Portuguese
 * conditional. Neither is a hypothetical: it is a damage report.
 */
describe('a damage report is not read as a hypothetical question', () => {
    const service: any = Object.create(HandoffService.prototype);
    const conversation = { metadata: {} };
    const config = { behavior: { handoffTriggers: [] } } as any;
    const ask = (m: string) => service.shouldHandoff(m, conversation, config);

    it.each([
        'Sí, llegó roto, ¿qué hago?',
        'sí, llegó dañado ¿qué hago?',
        'Hola, sí llegó roto ¿cómo lo cambio?',
        'Pues sí, llegó roto. ¿Qué opciones hay?',
        'Y si, llegó roto ¿qué hago?',
        'El caso es que llegó roto, ¿qué hago?',
        '¿qué hago? llegó roto',
        'si, llegó roto',
        '¿qué pasa si me llegó dañado y ya lo abrí?',
        'sim, chegou quebrado, o que faço?',
        'oui, il est arrivé endommagé, que faire ?',
        'Hola si llegó roto ¿cómo lo cambio?',
        'Hola, si llegó roto ¿cómo lo cambio?',
        'Pues si llegó roto ¿qué hago?',
        'El producto sí llegó roto ¿qué hago?',
        'si llegó roto ¿qué hago?',
        'llegó dañado, ¿qué pasa si llegó roto?',
    ])('hands off on %s', (m) => {
        expect(ask(m)).toBe('complaint');
    });

    it.each([
        '¿Qué hago si el producto llegó roto?',
        'e se chegou quebrado?',
        'et si le colis est arrivé endommagé ?',
        'o que faço caso o produto chegue quebrado?',
        '¿y si llegó roto?',
        '¿Qué hago en caso de que llegue roto?',
        '¿Qué pasa si llegó dañado?',
        // the damage word alone would hide a refund question, unless it is a condition
        '¿Aceptan devoluciones en caso de que llegue roto?',
        'tem reembolso caso o produto chegue quebrado?',
        '¿Aceptan devoluciones si el producto llegó roto?',
    ])('still answers the hypothetical %s', (m) => {
        expect(ask(m)).toBeNull();
    });
});

/**
 * "How do I / can I / is it possible / how long" about a refund or return is a
 * policy question: the agent answers it and offers a person. Explicit requests
 * and personal cases still escalate directly.
 */
describe('how-do-I questions about refunds are answered', () => {
    const service: any = Object.create(HandoffService.prototype);
    const conversation = { metadata: {} };
    const config = { behavior: { handoffTriggers: [] } } as any;
    const ask = (m: string) => service.shouldHandoff(m, conversation, config);

    it.each([
        // cuánto tarda / demora
        '¿cuánto tarda un reembolso?',
        '¿Cuánto demora la devolución?',
        // cómo solicito / pido / hago / tramito
        '¿Cómo solicito una devolución?',
        '¿Cómo pido un reembolso?',
        '¿Cómo tramito una devolución?',
        // se puede / es posible / puedo pedir
        '¿Se puede hacer devolución?',
        '¿Es posible un reembolso?',
        '¿Puedo pedir un reembolso?',
        '¿Puedo solicitar una devolución?',
        // pt
        'quanto tempo demora um reembolso?',
        'como solicito um reembolso?',
        'como peço um reembolso?',
        'é possível reembolso?',
        'posso pedir reembolso?',
        // fr
        'combien de temps prend un remboursement ?',
        'comment demander un remboursement ?',
        "est-il possible d'obtenir un remboursement ?",
        'puis-je demander un remboursement ?',
        // en (custom trigger tests below cover the English words)
    ])('does not hand off on %s', (m) => {
        expect(ask(m)).toBeNull();
    });

    it.each([
        'necesito hacer una devolución',
        'quiero mi reembolso',
        'me pueden hacer la devolución',
        'quiero devolver el audífono, llegó dañado',
        '¿puedo pedir un reembolso? me cobraron dos veces',
        '¿Cómo solicito mi reembolso?',
        '¿cómo hago la devolución? el audífono llegó dañado',
        '¿es posible un reembolso? esto es una estafa',
        '¿se puede hacer devolución? compré el audífono ayer',
        '¿cuánto tarda un reembolso? ya van 3 semanas',
    ])('hands off on %s', (m) => {
        expect(ask(m)).toBe('complaint');
    });

    it.each([
        ['how do I request a refund?', 'refund'],
        ['can I get a refund?', 'refund'],
        ['is it possible to return an item?', 'return'],
        ['how much time does a refund take?', 'refund'],
    ])('answers %s even with the seeded trigger', (m, trigger) => {
        expect(service.shouldHandoff(m, conversation, { behavior: { handoffTriggers: [trigger] } } as any)).toBeNull();
    });

    it.each([
        ['how do I request a refund? my order never arrived', 'refund'],
        ['can I get a refund? i bought it yesterday', 'refund'],
    ])('hands off on %s', (m, trigger) => {
        expect(service.shouldHandoff(m, conversation, { behavior: { handoffTriggers: [trigger] } } as any))
            .toBe('custom_trigger:' + trigger);
    });
});

describe('discount negotiation is not a policy question just because it says "can I"', () => {
    const service: any = Object.create(HandoffService.prototype);
    const conversation = { metadata: {} };
    const config = { behavior: { handoffTriggers: [] } } as any;
    const ask = (m: string) => service.shouldHandoff(m, conversation, config);

    it.each([
        '¿Se puede hacer un descuento?',
        '¿Es posible un descuento?',
        '¿Puedo pedir un descuento?',
        '¿Cómo pido un descuento?',
        '¿se puede una rebaja si pago de contado?',
        'é possível um desconto?',
        'est-il possible d\'avoir une remise ?',
        // refund AND discount in one how-frame: the refund word is answered, the discount is not
        '¿Puedo pedir un reembolso o un descuento?',
    ])('hands off to a person on %s', (m) => {
        expect(ask(m)).toBe('discount_request');
    });

    it.each([
        '¿tienen descuentos?',
        '¿hay descuentos?',
        '¿Hacen rebajas?',
        '¿tienen descuento si compro 3?',
    ])('still answers the plain policy question %s', (m) => {
        expect(ask(m)).toBeNull();
    });

    it('the discount custom trigger-free word is judged the same way', () => {
        expect(service.shouldHandoff('¿Es posible un descuento?', conversation, { behavior: { handoffTriggers: ['descuento'] } } as any))
            .toBe('discount_request');
        expect(service.shouldHandoff('¿tienen descuentos?', conversation, { behavior: { handoffTriggers: ['descuento'] } } as any)).toBeNull();
    });
});

describe('English "return" is a refund topic only as a policy or an act of returning goods', () => {
    const service: any = Object.create(HandoffService.prototype);
    const conversation = { metadata: {} };
    const ask = (m: string, triggers: string[]) => service.shouldHandoff(m, conversation, { behavior: { handoffTriggers: triggers } } as any);

    it.each([
        'what is the return time for the shuttle?',
        'what is the return flight time?',
        'what are the return hours?',
    ])('keeps the tenant "return" trigger on %s', (m) => {
        expect(ask(m, ['return'])).toBe('custom_trigger:return');
    });

    it.each([
        'what is your return policy?',
        'do you accept returns?',
        'what is the returns policy?',
        'how do I return an item?',
        'can I return the product?',
        'how do I make a return?',
    ])('answers %s', (m) => {
        expect(ask(m, ['return'])).toBeNull();
    });

    it('does not offer a person for a shuttle question, and does for a real return', () => {
        expect(isActionOrientedRefundQuestion('what is the return time for the shuttle?')).toBe(false);
        expect(isActionOrientedRefundQuestion('can I return the product?')).toBe(true);
    });
});

describe('the refund / return questions that also offer a person', () => {
    it.each([
        '¿cuánto tarda un reembolso?',
        '¿Cuánto tiempo tarda un reembolso?',
        '¿Cómo solicito una devolución?',
        '¿Se puede hacer devolución?',
        '¿Es posible un reembolso?',
        '¿Puedo pedir un reembolso?',
        '¿Cuál es la política? ¿Puedo pedir un reembolso?',
        'como solicito um reembolso?',
        'posso pedir reembolso?',
        'comment demander un remboursement ?',
        'puis-je demander un remboursement ?',
        'how do I request a refund?',
        'can I get a refund?',
        'is it possible to return an item?',
    ])('offers a person after answering %s', (m) => {
        expect(isActionOrientedRefundQuestion(m)).toBe(true);
    });

    it.each([
        // a plain policy question gets the policy only
        '¿Cuál es la política de devoluciones del audífono QA de prueba?',
        '¿Hacen reembolsos?',
        '¿Aceptan devoluciones?',
        'quelle est votre politique de remboursement ?',
        'do you have a refund policy?',
        // the frame and the topic are in different sentences
        '¿se puede pagar con tarjeta? ¿y hay devoluciones?',
        // not a refund topic
        '¿Es posible un descuento?',
        '¿tienen descuentos?',
        '¿cuál es el horario?',
        '¿Se puede pagar con tarjeta?',
        // a personal case or a direct request is escalated, never offered
        '¿hay reembolso? me cobraron dos veces',
        '¿puedo pedir un reembolso? me cobraron dos veces',
        'quiero mi reembolso',
        'necesito hacer una devolución',
    ])('does not apply to %s', (m) => {
        expect(isActionOrientedRefundQuestion(m)).toBe(false);
    });
});
