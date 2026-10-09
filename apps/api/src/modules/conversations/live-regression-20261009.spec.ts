import { ConversationsService } from './conversations.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { LanguageDetectorService } from './language-detector.service';
import { attendanceAckText, isAttendanceReassurance } from './customer-reassurance';
import { hasPolicyEvidence, isCancellationPolicyQuestion, isUngroundedPolicyAnswer, noPolicyInformationText, replyAdmitsNotKnowing, replyStatesTerms } from './policy-grounding';
import { toUsted } from './register-adapt';
import { localizeStatusWords, orderListing, orderStatusLabel, transitionTexts } from './transition-engine';
import {
    catalogDomainOf, emptyCatalogText, pastDepartureIn, pastDepartureText, replyAcknowledgesPast, replyAsksCriteria, replySaysEmpty,
} from './catalog-first';
import { stripInternalMarkers } from '../../common/utils/internal-markers.util';

/**
 * The defects of the live Telegram regression of 2026-10-09 (after PR #78/#80/#81) that are not about the reschedule date:
 * each block quotes what production answered.
 */

// ── A5c «¿Se puede cancelar sin costo?» invented a policy ─────────────────────────────────────────────────────────────────────
describe('policy questions are answered from the business\'s own sources only', () => {
    const INVENTED = 'Por lo general, nuestras políticas permiten cancelar sin costo con un aviso previo adecuado. ¿Quiere que le confirme la política específica para su cita o servicio?';

    it.each([
        '¿Se puede cancelar sin costo?', '¿Cuál es la política de cancelación?', '¿Cobran por cancelar la cita?', '¿Tiene costo reprogramar?',
        'Is there a fee to cancel?', 'Se eu cancelar, tem custo?',
    ])('"%s" is a cancellation-terms question', text => {
        expect(isCancellationPolicyQuestion(text)).toBe(true);
    });

    it.each([
        'quiero cancelar mi cita', 'cancela la cita AE3D0C86', '¿Cuánto cuesta el corte?', '¿A qué hora abren?', '¿Cuál es la política de privacidad?',
        'Tengo una cita mañana, ¿dónde queda el local?', '',
    ])('"%s" is not', text => {
        expect(isCancellationPolicyQuestion(text)).toBe(false);
    });

    it('recognises a reply that states terms and one that admits it does not know', () => {
        expect(replyStatesTerms(INVENTED)).toBe(true);
        expect(replyStatesTerms('Normalmente se puede cancelar hasta 24 horas antes.')).toBe(true);
        expect(replyAdmitsNotKnowing('No tengo información sobre la política de cancelación. ¿Quiere que le pida a una persona del equipo que lo confirme?')).toBe(true);
        expect(replyAdmitsNotKnowing(INVENTED)).toBe(false);
    });

    it('evidence is a policy, an FAQ, a knowledge chunk, a package\'s own terms or the owner\'s persona text', () => {
        expect(hasPolicyEvidence({})).toBe(false);
        // the cancellation of the customer's own appointments (status «cancelled») is not a policy
        expect(hasPolicyEvidence({ executedTools: [{ name: 'list_customer_appointments', result: { appointments: [{ status: 'cancelled' }] } }] })).toBe(false);
        expect(hasPolicyEvidence({ executedTools: [{ name: 'get_policy', result: { error: 'No cancellation policy is configured for this business.' } }] })).toBe(false);
        expect(hasPolicyEvidence({ executedTools: [{ name: 'get_policy', result: { type: 'cancellation', content: 'Cancelaciones con 24 horas.' } }] })).toBe(true);
        expect(hasPolicyEvidence({ executedTools: [{ name: 'search_faqs', result: { faqs: [{ question: '¿Cómo cancelo?', answer: 'Escríbanos.' }] } }] })).toBe(true);
        expect(hasPolicyEvidence({ executedTools: [{ name: 'search_faqs', result: { faqs: [{ question: '¿Horario?', answer: 'Lunes a sábado.' }] } }] })).toBe(false);
        expect(hasPolicyEvidence({ retrievedKnowledge: [{ title: 'Política de cancelación', content: 'Sin costo hasta 24 horas antes.' }] })).toBe(true);
        expect(hasPolicyEvidence({ executedTools: [{ name: 'get_package_details', result: { cancellationPolicy: 'flexible' } }] })).toBe(true);
        expect(hasPolicyEvidence({ executedTools: [{ name: 'get_package_details', result: { cancellationPolicy: 'none' } }] })).toBe(false);
        // a field of the record's own data that holds its terms (a fee), but not an empty or zero one
        expect(hasPolicyEvidence({ executedTools: [{ name: 'get_catalog_order', result: { order: { id: 'x', cancellation_fee: 25000 } } }] })).toBe(true);
        expect(hasPolicyEvidence({ executedTools: [{ name: 'get_catalog_order', result: { order: { id: 'x', cancellationFee: 0 } } }] })).toBe(false);
        expect(hasPolicyEvidence({ systemPrompt: '<contract>never invent policies</contract><persona>Cancelaciones sin costo hasta 24 horas antes.</persona>' })).toBe(true);
        expect(hasPolicyEvidence({ systemPrompt: '<contract>never invent policies</contract><persona>Soy Luna.</persona>' })).toBe(false);
    });

    it('the invented answer is ungrounded without a source, and fine with one', () => {
        const input = { userText: '¿Se puede cancelar sin costo?', reply: INVENTED };
        expect(isUngroundedPolicyAnswer(input)).toBe(true);
        expect(isUngroundedPolicyAnswer({ ...input, retrievedKnowledge: [{ title: 'Cancelaciones', content: 'Sin costo hasta 24 horas antes de la cita.' }] })).toBe(false);
        expect(isUngroundedPolicyAnswer({ ...input, reply: 'No tengo información sobre la política de cancelación de este negocio.' })).toBe(false);
        expect(isUngroundedPolicyAnswer({ userText: '¿Cuánto cuesta el corte?', reply: 'Cuesta 40.000 COP, sin costo de envío.' })).toBe(false);
    });

    it.each([
        ['es', /No tengo información sobre la política de cancelación/, /¿Quiere que le pida a una persona del equipo que lo confirme\?/],
        ['en', /do not have information about this business’s cancellation policy/, /Would you like me to ask someone from the team to confirm it\?/],
        ['pt', /Não tenho informações sobre a política de cancelamento/, /Quer que eu peça a alguém da equipe para confirmar\?/],
        ['fr', /Je n’ai pas d’informations sur la politique d’annulation/, /Souhaitez-vous que je demande à quelqu'un de l'équipe/],
    ])('the honest reply in %s offers a person (and only when one can be reached)', (lang, sentence, offer) => {
        expect(noPolicyInformationText(lang, true)).toMatch(sentence);
        expect(noPolicyInformationText(lang, true)).toMatch(offer);
        expect(noPolicyInformationText(lang, false)).toMatch(sentence);
        expect(noPolicyInformationText(lang, false)).not.toMatch(offer);
    });

    describe('applyOutputGuardrails', () => {
        const build = () => {
            const service: any = Object.create(ConversationsService.prototype);
            Object.assign(service, {
                logger: { warn: jest.fn() },
                eventEmitter: { emit: jest.fn() },
                responseValidator: { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) },
                recordAgentSignal: jest.fn(),
                llmRouter: { execute: jest.fn() },
            });
            return service;
        };
        const run = (service: any, user: string, reply: string, extra: { tools?: any[]; context?: any; system?: string; lang?: string; offer?: boolean } = {}) =>
            service.applyOutputGuardrails(reply, extra.system ?? 'sys', [{ role: 'user', content: user }], [], 'tenant', 'conv', extra.tools ?? [],
                extra.lang ?? 'es', [], extra.context ?? {}, undefined, undefined, extra.offer ?? true);

        it('replaces the invented policy with «no tengo esa información» + the offer of a person', async () => {
            const service = build();
            const reply = await run(service, '¿Se puede cancelar sin costo?', INVENTED);
            expect(reply).toBe(noPolicyInformationText('es', true));
            expect(reply).not.toMatch(/por lo general|sin costo con/i);
            expect(service.recordAgentSignal).toHaveBeenCalledWith('tenant', 'policy_answer_ungrounded', undefined);
            expect(service.llmRouter.execute).not.toHaveBeenCalled();
        });

        it('offers nobody when no person can be reached from the conversation', async () => {
            const reply = await run(build(), '¿Se puede cancelar sin costo?', INVENTED, { offer: false });
            expect(reply).toBe(noPolicyInformationText('es', false));
        });

        it('lets the answer through when the turn holds the business\'s policy', async () => {
            const service = build();
            const grounded = 'Puede cancelar sin costo hasta 24 horas antes de la cita.';
            const reply = await run(service, '¿Se puede cancelar sin costo?', grounded, {
                context: { retrievedKnowledge: [{ source: 'faq', id: 'f1', title: '¿Cuál es la política de cancelación?', content: 'Sin costo hasta 24 horas antes.' }] },
            });
            expect(reply).toBe(grounded);
        });
    });
});

// ── A5a «Por favor no cancelen mi cita, voy en camino» offered a person ───────────────────────────────────────────────────────
describe('a customer who says they are coming is acknowledged, not handed to a person', () => {
    it.each([
        'Por favor no cancelen mi cita, voy en camino', 'No cancelen mi turno, llego en 10 minutos', 'ya voy en camino', "Please don't cancel my appointment, I'm on my way",
        'Não cancele minha consulta, estou chegando', "N'annulez pas mon rendez-vous, je suis en route",
    ])('"%s" is a reassurance', text => {
        expect(isAttendanceReassurance(text)).toBe(true);
    });

    it.each([
        'quiero cancelar mi cita', '¿puedo llegar más tarde?', 'Necesito mover mi cita, voy a llegar tarde', 'no cancelen mi cita, ¿a qué hora cierran?', 'hola', '',
        'Tengo una cita mañana, ¿dónde queda el local?',
    ])('"%s" is not', text => {
        expect(isAttendanceReassurance(text)).toBe(false);
    });

    const build = () => {
        const service: any = Object.create(ConversationsService.prototype);
        Object.assign(service, {
            logger: { warn: jest.fn() }, eventEmitter: { emit: jest.fn() },
            responseValidator: { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) },
            recordAgentSignal: jest.fn(), llmRouter: { execute: jest.fn() },
        });
        return service;
    };

    it('when the model claims an outcome nothing backed, the reply is «Perfecto, le esperamos» — with no offer of a person, no model round trip', async () => {
        const service = build();
        const reply = await service.applyOutputGuardrails('Listo, su cita quedó confirmada y no será cancelada.', 'sys',
            [{ role: 'user', content: 'Por favor no cancelen mi cita, voy en camino' }], [], 'tenant', 'conv', [], 'es', [], {});
        expect(reply).toBe(attendanceAckText('es'));
        expect(reply).toMatch(/Perfecto, le esperamos/);
        expect(reply).not.toMatch(/persona del equipo|no puedo darle esa acción/i);
        expect(service.llmRouter.execute).not.toHaveBeenCalled();
    });

    it('a request that is NOT a reassurance keeps the honest fallback', async () => {
        const service = build();
        service.llmRouter.execute.mockResolvedValue({ content: 'Listo, su cita quedó cancelada.' });
        const reply = await service.applyOutputGuardrails('Listo, su cita quedó cancelada.', 'sys',
            [{ role: 'user', content: 'cancela mi cita por favor' }], [], 'tenant', 'conv', [], 'es', [], {});
        expect(reply).toMatch(/No puedo darle esa acción por confirmada/);
    });
});

// ── A5b the address ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('where the business is: the address reaches the prompt when configured, and the contract says to use it', () => {
    const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '<persona/>' } as any);
    const turn: any = {
        language: 'es', timezone: 'America/Bogota', now: '2026-10-09T10:00:00.000Z', upcomingDays: [], businessHoursStatus: 'open',
        business: { companyName: 'Salón QA', address: 'Calle 85 # 15-20', city: 'Bogotá' },
    };

    it('the configured address and city are in <business>', () => {
        const prompt = assembler.assemble({ persona: {} } as any, turn);
        expect(prompt).toContain('<address>Calle 85 # 15-20</address>');
        expect(prompt).toContain('<city>Bogotá</city>');
    });

    it('rule 13f: answer with the address first, never ask «¿quiere la dirección?» when it is known, never invent it when it is not', () => {
        const prompt = assembler.assemble({ persona: {} } as any, turn);
        expect(prompt).toMatch(/13f\. WHERE THE BUSINESS IS/);
        // (the contract is XML-escaped: «<turn>» is written «&lt;turn&gt;»)
        expect(prompt).toContain('answer in the FIRST sentence with &lt;turn&gt;&lt;business&gt;&lt;address&gt;');
        expect(prompt).toContain('Never answer with a question like "do you want the address?" when you have it');
        expect(prompt).toContain('When &lt;address&gt; is absent, say plainly that you do not have the address on file');
    });
});

// ── the greeting: «tu asistente» in a tenant that is addressed as usted ───────────────────────────────────────────────────────
describe('the persona greeting follows the tenant\'s register', () => {
    const GREETING = '¡Hola! Soy Luna, tu asistente de belleza. ¿Te gustaría agendar una cita o conocer nuestros servicios?';

    it('toUsted rewrites the production greeting', () => {
        expect(toUsted(GREETING)).toBe('¡Hola! Soy Luna, su asistente de belleza. ¿Le gustaría agendar una cita o conocer nuestros servicios?');
    });

    it.each([
        ['¡Hola! Soy Maya, tu asesora de viajes. ¿A dónde te gustaría ir?', '¡Hola! Soy Maya, su asesora de viajes. ¿A dónde le gustaría ir?'],
        ['Hola, soy Carlos, asesor inmobiliario. ¿Estás buscando comprar, arrendar o vender una propiedad?', 'Hola, soy Carlos, asesor inmobiliario. ¿Está buscando comprar, arrendar o vender una propiedad?'],
        ['¡Hola! Gracias por escribirnos. Cuéntame qué tienes en mente y te ayudo.', '¡Hola! Gracias por escribirnos. Cuénteme qué tiene en mente y le ayudo.'],
        ['Hola, soy Sofía. ¿Necesitas agendar una cita o tienes alguna consulta?', 'Hola, soy Sofía. ¿Necesita agendar una cita o tiene alguna consulta?'],
        ['¡Hola! Puedo ayudarte a agendar una cita ahora mismo. ¿Qué servicio te interesa?', '¡Hola! Puedo ayudarle a agendar una cita ahora mismo. ¿Qué servicio le interesa?'],
        ['Hola, soy Marco, te espero en la parte norte del corte de pelo', 'Hola, soy Marco, le espero en la parte norte del corte de pelo'],
    ])('"%s"', (input, expected) => {
        expect(toUsted(input)).toBe(expected);
    });

    it('leaves text that is already in usted (and nouns like parte/corte) untouched', () => {
        const usted = 'Hola, soy Marco, asesor automotriz. ¿Busca un vehículo nuevo o necesita servicio de taller? Cuéntenos.';
        expect(toUsted(usted)).toBe(usted);
        expect(toUsted('')).toBe('');
    });

    it('the prompt of an usted tenant carries the greeting in usted; a tú tenant keeps it as written', () => {
        const persona = { buildSystemPrompt: jest.fn((config: any) => `<persona>${config.persona.greeting}</persona>`) };
        const assembler = new PromptAssemblerService(persona as any);
        const REGIONAL = { operatingCountry: 'CO', currency: 'COP', locale: 'es-CO', countryPackId: 'co', countryPackVersion: '1', countryPackStatus: 'active' };
        const config: any = { industry: 'beauty', persona: { name: 'Luna', greeting: GREETING, fallbackMessage: '' } };
        const base: any = { language: 'es', timezone: 'America/Bogota', now: '2026-10-09T10:00:00.000Z', upcomingDays: [], businessHoursStatus: 'open' };
        expect(assembler.assemble(config, { ...base, regional: { ...REGIONAL, addressForm: 'usted' } })).toContain('Soy Luna, su asistente de belleza. ¿Le gustaría');
        expect(assembler.assemble(config, { ...base, regional: { ...REGIONAL, addressForm: 'tu' } })).toContain('Soy Luna, tu asistente de belleza. ¿Te gustaría');
        expect(assembler.assemble(config, { ...base, language: 'en', regional: { ...REGIONAL, addressForm: 'usted' } })).toContain('tu asistente');
        // the stored configuration is not mutated
        expect(config.persona.greeting).toBe(GREETING);
    });
});

// ── order status in English ────────────────────────────────────────────────────────────────────────────────────────────────────
describe('internal status words are put in the customer\'s language', () => {
    it('«El estado es pending» (production, Tienda QA)', () => {
        expect(localizeStatusWords('Perfecto, confirmo que el pedido 0743D15C ya quedó realizado. El estado es pending, el monto es 119.900 COP y el pago sigue pendiente.', 'es'))
            .toBe('Perfecto, confirmo que el pedido 0743D15C ya quedó realizado. El estado es pendiente, el monto es 119.900 COP y el pago sigue pendiente.');
    });

    it.each([
        ['es', 'El pedido está in_transit y el pago paid.', 'El pedido está en camino y el pago pagado.'],
        ['pt', 'O pedido está shipped.', 'O pedido está enviado.'],
        ['fr', 'La commande est confirmed et le paiement est unpaid.', 'La commande est confirmée et le paiement est non payée.'],
        ['en', 'The order is pending.', 'The order is pending.'],
    ])('%s: %s', (lang, input, expected) => {
        expect(localizeStatusWords(input, lang)).toBe(expected);
    });

    it('never touches a quoted name, a URL or a longer word', () => {
        const text = 'Mire "Pending Things" en https://tienda.example/orders/pending o el pendingtray y el product_pending.';
        expect(localizeStatusWords(text, 'es')).toBe(text);
        expect(orderStatusLabel('pending', 'pt')).toBe('pendente');
    });
});

// ── Inmobiliaria RX01: Spanish without accents answered in English ──────────────────────────────────────────────────────────────
describe('Spanish typed without accents is Spanish', () => {
    const detector = new LanguageDetectorService();

    it.each([
        'Busco apartamento en venta en Usaquen de 3 habitaciones, hasta 600 millones',
        'Quiero un apartamento en Chapinero por menos de 50 millones',
        'Necesito algo de 3 habitaciones y 2 banos en Chapinero',
    ])('after an English conversation, "%s" is Spanish', text => {
        expect(detector.detect(text, 'en', 'en')).toBe('es');
        expect(detector.detectDetailed(text, 'en', 'en').persist).toBe(true);
    });

    it('from a fresh conversation (no stored language) it is Spanish whatever the tenant default says', () => {
        expect(detector.detect('Busco apartamento en venta en Usaquen de 3 habitaciones, hasta 600 millones', 'en')).toBe('es');
        expect(detector.detect('Busco apartamento en venta en Usaquen de 3 habitaciones, hasta 600 millones', 'es-CO')).toBe('es');
    });

    it('English stays English, and a single borrowed Spanish word does not switch an English chat', () => {
        expect(detector.detect('Hi, do you have apartments for sale?', 'es-CO', 'es')).toBe('en');
        expect(detector.detect('I am looking for a house with 3 bedrooms, up to 600 million', 'es', 'en')).toBe('en');
        expect(detector.detect('I want the venta pack please', 'en', 'en')).toBe('en');
    });
});

// ── Viajes ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('internal citation markup never reaches the customer', () => {
    it('«[Artículo: ¿Cuál es la política de cancelación?]» (RV07) is removed', () => {
        expect(stripInternalMarkers('Le confirmamos las condiciones exactas antes de que reserve. ¿Quiere que alguien del equipo le contacte? [Artículo: ¿Cuál es la política de cancelación?]'))
            .toBe('Le confirmamos las condiciones exactas antes de que reserve. ¿Quiere que alguien del equipo le contacte?');
        expect(stripInternalMarkers('Política flexible [Artigo: Política de cancelamento do pacote] ok')).toBe('Política flexible ok');
    });

    it('a product reference written with the same label is still the customer\'s', () => {
        for (const text of ['Ref [Artículo: 4512] disponible', 'Ref [Artículo: Aurora] disponible', 'Ref [Articles: 4512] ok']) expect(stripInternalMarkers(text)).toBe(text);
        // the English label is always the internal citation
        expect(stripInternalMarkers('Hola [Article: Envíos]')).toBe('Hola');
    });
});

describe('Viajes / Inmobiliaria: what the customer is owed first', () => {
    const TODAY = '2026-10-09';

    it('a departure date that already passed is read (RV02 15-ago-2026, RV03 3-jul-2026, RV01 1-sep-2026)', () => {
        expect(pastDepartureIn('Somos 40 personas y queremos salir el 15 de agosto de 2026, ¿qué paquetes hay?', TODAY)).toEqual({ iso: '2026-08-15', yearStated: true });
        expect(pastDepartureIn('¿Qué paquetes tienen para el 3 de julio de 2026?', TODAY)).toEqual({ iso: '2026-07-03', yearStated: true });
        expect(pastDepartureIn('Quiero un paquete a Cartagena para 2 personas con salida el 1 de septiembre de 2026, ¿hay disponibilidad?', TODAY))
            .toEqual({ iso: '2026-09-01', yearStated: true });
    });

    it('a day with no year that already went by this year is flagged, with next year offered back as a question', () => {
        expect(pastDepartureIn('¿Qué paquetes tienen para el 3 de julio?', TODAY)).toEqual({ iso: '2026-07-03', yearStated: false, nextYearIso: '2027-07-03' });
    });

    it('future dates, other topics and bookings already made are not departures in the past', () => {
        expect(pastDepartureIn('¿Qué paquetes hay para el 20 de diciembre de 2026?', TODAY)).toBeNull();
        expect(pastDepartureIn('Quiero ir a Cartagena del 10 al 15 de noviembre para 2 personas', TODAY)).toBeNull();
        expect(pastDepartureIn('Mi reserva del 3 de julio de 2026 estuvo bien', TODAY)).toBeNull();
        expect(pastDepartureIn('Llámenme el 3 de julio de 2026', TODAY)).toBeNull();
    });

    it('says it first, in four languages, and recognises a reply that already did', () => {
        const past = { iso: '2026-07-03', yearStated: true };
        expect(pastDepartureText('es', past)).toBe('Esa fecha de salida, 3 de julio de 2026, ya pasó. ¿Para qué otra fecha desea que busque?');
        expect(pastDepartureText('en', past)).toMatch(/July 3, 2026, has already passed/);
        expect(pastDepartureText('pt', past)).toMatch(/já passou/);
        expect(pastDepartureText('fr', past)).toMatch(/déjà passée/);
        expect(pastDepartureText('es', { iso: '2026-07-03', yearStated: false, nextYearIso: '2027-07-03' }))
            .toBe('El 3 de julio de este año ya pasó. ¿Se refiere al 3 de julio de 2027? Si es otra fecha, indíquemela y busco.');
        expect(replyAcknowledgesPast('Esa fecha de salida ya pasó, así que no hay paquetes.')).toBe(true);
        expect(replyAcknowledgesPast('¿Para cuántas personas y qué destino?')).toBe(false);
    });

    it('an empty catalogue is said before asking for criteria (RV06, RV10, RN08)', () => {
        expect(replyAsksCriteria('¿Para qué destino y fechas le gustaría viajar?')).toBe(true);
        expect(replyAsksCriteria('Actualmente no hay paquetes publicados.')).toBe(false);
        expect(replySaysEmpty('Actualmente no tengo paquetes de viaje publicados en el catálogo.')).toBe(true);
        expect(replySaysEmpty('Todavía no hay inmuebles publicados.')).toBe(true);
        expect(replySaysEmpty('¿A qué destino desea viajar?')).toBe(false);
        expect(catalogDomainOf('Somos 4 adultos y 2 niños, ¿qué paquetes hay para diciembre de 2026?')).toEqual(['packages']);
        expect(catalogDomainOf('Could you please confirm if you are looking to buy or rent a house?')).toEqual(['listings']);
        expect(emptyCatalogText('es', 'packages', true)).toBe('Actualmente no hay paquetes de viaje publicados en nuestro catálogo. ¿Le gustaría que alguien del equipo se ponga en contacto con usted cuando haya opciones disponibles?');
        expect(emptyCatalogText('en', 'listings', false)).toBe('There are currently no properties published in our catalogue.');
    });

    describe('catalogFirstReply', () => {
        const service: any = Object.create(ConversationsService.prototype);
        Object.assign(service, { prisma: { executeInTenantSchema: jest.fn() } });
        const base = { schemaName: 'tenant_x', tools: ['search_packages', 'check_package_availability'], lang: 'es', todayIso: TODAY, executed: [] as any[], canOfferPerson: true };

        it('replaces a question-back with the past-date answer', async () => {
            const reply = await service.catalogFirstReply({ ...base, userText: '¿Qué paquetes tienen para el 3 de julio de 2026?', reply: '¿Podría decirme para cuántas personas y si tiene algún destino en mente?' });
            expect(reply).toBe('Esa fecha de salida, 3 de julio de 2026, ya pasó. ¿Para qué otra fecha desea que busque?');
        });

        it('leaves a reply that already says the date passed', async () => {
            expect(await service.catalogFirstReply({ ...base, userText: '¿Qué paquetes tienen para el 3 de julio de 2026?', reply: 'Esa fecha ya pasó. ¿Qué otra fecha le sirve?' })).toBeNull();
        });

        it('says the catalogue is empty first when the probe finds no row and the model only asked for criteria', async () => {
            service.prisma.executeInTenantSchema.mockResolvedValue([]);
            const reply = await service.catalogFirstReply({ ...base, userText: 'Somos 4 adultos y 2 niños, ¿qué paquetes hay para diciembre de 2026?', reply: '¿A qué destino desean viajar en diciembre?' });
            expect(reply).toBe(emptyCatalogText('es', 'packages', true));
        });

        it('does nothing when the catalogue has rows, when the model already searched, or when the tool is not available', async () => {
            service.prisma.executeInTenantSchema.mockResolvedValue([{ present: 1 }]);
            const ask = { userText: '¿Qué paquetes de viaje tienen?', reply: '¿A qué destino desea viajar?' };
            expect(await service.catalogFirstReply({ ...base, ...ask })).toBeNull();
            service.prisma.executeInTenantSchema.mockResolvedValue([]);
            expect(await service.catalogFirstReply({ ...base, ...ask, executed: [{ name: 'search_packages', result: { packages: [], catalog_empty: true } }] })).toBeNull();
            expect(await service.catalogFirstReply({ ...base, ...ask, tools: ['search_faqs'] })).toBeNull();
        });
    });
});

// ── Tienda QA: «Si desea anular alguno» offered for orders that are already anulados ─────────────────────────────────────────────
describe('the orders listing offers to cancel only when something can still be cancelled', () => {
    const rows = (statuses: string[]) => orderListing({ orders: statuses.map((status, i) => ({
        id: `d1d0d14a-000${i}-4000-8000-000000000000`, status, paymentStatus: 'pending', totalAmount: 119900, currency: 'COP', items: [{ productName: 'Audífono QA Aurora', quantity: 1 }],
    })) }, 'es-CO', 'es');

    it('all anulados: the listing ends there', () => {
        const text = transitionTexts('es', 'usted').listOrders(rows(['cancelled', 'canceled', 'cancelled']));
        expect(text).toContain('— anulado (Ref. D1D0D14A)');
        expect(text).not.toMatch(/anular alguno/);
        expect(text.endsWith('(Ref. D1D0D14A)')).toBe(true);
    });

    it('one still pending: the offer stays, in the four languages', () => {
        const list = rows(['cancelled', 'pending']);
        expect(transitionTexts('es', 'usted').listOrders(list)).toMatch(/Si desea anular alguno, indíqueme la referencia\.$/);
        expect(transitionTexts('en', 'usted').listOrders(list)).toMatch(/If you want to cancel one, tell me its reference\.$/);
        expect(transitionTexts('pt', 'usted').listOrders(list)).toMatch(/Se quiser cancelar algum, informe a referência\.$/);
        expect(transitionTexts('fr', 'usted').listOrders(list)).toMatch(/Pour en annuler une, indiquez sa référence\.$/);
    });
});
