import { absentServicesIn, annotateKnowledgeItems, annotateKnowledgeToolResult, AbsentSubjects, notOfferedReply, offerClaimForAbsent, serviceSubjectsIn } from './catalog-over-faq';
import { resolveEvaluationTurnContext } from '../evaluation-turn-context';

/**
 * F4300-24 (dental tenant, production QA): the catalogue lists three services and a seeded FAQ talks about orthodontics.
 * The pure pieces of `agentRuntime.catalogOverFaq`: which knowledge names a service the catalogue lacks, which reply
 * presents such a service as offered, and the not-offered answer.
 */
const DENTAL = [{ name: 'Consulta general' }, { name: 'Consulta especializada' }, { name: 'Control y seguimiento' }];
const ORTHO_FAQ = { id: 'faq-ortho', question: '¿Cuánto tiempo dura un tratamiento de ortodoncia?',
    answer: 'Depende de tu caso, pero generalmente entre 12 y 24 meses.', category: 'tratamientos' };
const PARKING_FAQ = { id: 'faq-parking', question: '¿Tienen parqueadero?', answer: 'Sí, contamos con parqueadero gratuito.', category: 'general' };
const CONTROL_FAQ = { id: 'faq-control', question: '¿Qué incluye el servicio de control y seguimiento?', answer: 'Una revisión del avance de tu tratamiento.', category: 'servicios' };

describe('catalogue over FAQ: subjects', () => {
    it('names the service a generic head introduces, in the four languages', () => {
        expect(serviceSubjectsIn(ORTHO_FAQ.question).map(s => s.phrase)).toEqual(['tratamiento de ortodoncia']);
        expect(serviceSubjectsIn('How long does a treatment for braces take?').map(s => s.key)).toEqual(['braces']);
        expect(serviceSubjectsIn('Quanto custa o tratamento de clareamento dental?').map(s => s.key)).toEqual(['clareamento dental']);
        expect(serviceSubjectsIn("Combien dure un traitement d'orthodontie ?").map(s => s.phrase)).toEqual(["traitement d'orthodontie"]);
    });

    it('a FAQ without a service head (parking, hours) names no service', () => {
        expect(serviceSubjectsIn(`${PARKING_FAQ.question}\n${PARKING_FAQ.answer}`)).toEqual([]);
        expect(serviceSubjectsIn('¿A qué hora abren los sábados?')).toEqual([]);
    });

    it('orthodontics is absent from the dental catalogue; control y seguimiento is present', () => {
        expect(absentServicesIn(`${ORTHO_FAQ.question}\n${ORTHO_FAQ.answer}`, DENTAL).map(s => s.key)).toEqual(['ortodoncia']);
        expect(absentServicesIn(`${CONTROL_FAQ.question}\n${CONTROL_FAQ.answer}`, DENTAL)).toEqual([]);
    });

    it('a catalogue description that mentions the service covers it; an empty catalogue decides nothing', () => {
        expect(absentServicesIn(ORTHO_FAQ.question, [...DENTAL, { name: 'Consulta especializada', description: 'Evaluación de ortodoncia y endodoncia' }])).toEqual([]);
        expect(absentServicesIn(ORTHO_FAQ.question, [])).toEqual([]);
    });
});

describe('catalogue over FAQ: annotations', () => {
    it('marks the FAQ result naming an absent service and leaves the others as they were', () => {
        const collect = new AbsentSubjects();
        const result = { faqs: [ORTHO_FAQ, PARKING_FAQ, CONTROL_FAQ] };
        const annotated = annotateKnowledgeToolResult('search_faqs', result, DENTAL, collect);
        expect(annotated.faqs[0]).toEqual(expect.objectContaining({ id: 'faq-ortho', not_in_catalogue: ['tratamiento de ortodoncia'] }));
        expect(annotated.faqs[0].catalogue_note).toContain('not proof that the service is offered');
        expect(annotated.faqs[1]).toBe(PARKING_FAQ);
        expect(annotated.faqs[2]).toBe(CONTROL_FAQ);
        expect(collect.list().map(s => s.key)).toEqual(['ortodoncia']);
    });

    it('a result with nothing to mark, another tool, an error or no catalogue is the same object', () => {
        const clean = { faqs: [PARKING_FAQ] };
        expect(annotateKnowledgeToolResult('search_faqs', clean, DENTAL)).toBe(clean);
        const ortho = { faqs: [ORTHO_FAQ] };
        expect(annotateKnowledgeToolResult('list_services', ortho, DENTAL)).toBe(ortho);
        expect(annotateKnowledgeToolResult('search_faqs', ortho, [])).toBe(ortho);
        const failed = { error: 'tool_failed', faqs: [ORTHO_FAQ] };
        expect(annotateKnowledgeToolResult('search_faqs', failed, DENTAL)).toBe(failed);
    });

    it('marks RAG chunks and retrieved knowledge items too', () => {
        const chunks = { chunks: [{ title: 'Guía', content: 'El tratamiento de ortodoncia invisible usa alineadores.' }] };
        expect(annotateKnowledgeToolResult('search_knowledge_base', chunks, DENTAL).chunks[0].not_in_catalogue).toEqual(['tratamiento de ortodoncia invisible']);
        const items = annotateKnowledgeItems([
            { source: 'faq', id: 'faq-ortho', title: ORTHO_FAQ.question, content: ORTHO_FAQ.answer },
            { source: 'faq', id: 'faq-parking', title: PARKING_FAQ.question, content: PARKING_FAQ.answer },
        ], DENTAL)!;
        expect(items[0].notInCatalogue).toEqual(['tratamiento de ortodoncia']);
        expect(items[1].notInCatalogue).toBeUndefined();
    });
});

describe('catalogue over FAQ: the reply', () => {
    const absent = absentServicesIn(ORTHO_FAQ.question, DENTAL);

    it('«Sí, ofrecemos tratamiento de ortodoncia» is a claim; the not-offered answer lists the catalogue', () => {
        const claimed = offerClaimForAbsent('Sí, ofrecemos tratamiento de ortodoncia. Generalmente dura entre 12 y 24 meses.', absent, DENTAL);
        expect(claimed?.key).toBe('ortodoncia');
        // R3b (D9): absent from the catalogue is «no lo veo», never «no lo hacemos»
        expect(notOfferedReply(claimed!, DENTAL, 'es', 'usted')).toBe(
            'No veo tratamiento de ortodoncia entre nuestros servicios. Los servicios que ofrecemos son Consulta general, Consulta especializada y Control y seguimiento. ¿Le interesa alguno?');
        expect(notOfferedReply(claimed!, DENTAL, 'es', 'tu')).toMatch(/¿Te interesa alguno\?$/);
        expect(notOfferedReply(claimed!, DENTAL, 'en', 'usted')).toContain("I don't see tratamiento de ortodoncia among our services");
        // only what the business declared in CORE.OFFER.NOT_OFFERED is «no ofrecemos»
        const declared = ['ortodoncia invisible (alternative: brackets estéticos)'];
        expect(notOfferedReply(claimed!, DENTAL, 'es', 'usted', declared)).toBe(
            'Por ahora no ofrecemos tratamiento de ortodoncia: no está entre nuestros servicios. Los servicios que ofrecemos son Consulta general, Consulta especializada y Control y seguimiento. ¿Le interesa alguno?');
        expect(notOfferedReply(claimed!, DENTAL, 'en', 'usted', declared)).toContain('it is not among our services');
        expect(notOfferedReply(claimed!, DENTAL, 'es', 'usted', ['blanqueamiento'])).toMatch(/^No veo /);
        expect(offerClaimForAbsent('¡Sí! El tratamiento de ortodoncia dura entre 12 y 24 meses.', absent, DENTAL)?.key).toBe('ortodoncia');
        expect(offerClaimForAbsent('Yes, we offer orthodontic treatment.', absentServicesIn('treatment of orthodontics', DENTAL), DENTAL)?.key).toBe('orthodontics');
    });

    it('a denial, a reply about a catalogue service or a reply that does not name the service is not a claim', () => {
        expect(offerClaimForAbsent('No ofrecemos tratamiento de ortodoncia; tenemos Consulta general.', absent, DENTAL)).toBeNull();
        expect(offerClaimForAbsent('Por ahora la ortodoncia no está entre nuestros servicios.', absent, DENTAL)).toBeNull();
        expect(offerClaimForAbsent('Sí, ofrecemos Consulta especializada, donde se evalúa si necesita ortodoncia.', absent, DENTAL)).toBeNull();
        expect(offerClaimForAbsent('Sí, tenemos parqueadero gratuito.', absent, DENTAL)).toBeNull();
        expect(offerClaimForAbsent('Sí, ofrecemos tratamiento de ortodoncia.', [], DENTAL)).toBeNull();
    });
});

describe('catalogue over FAQ: Agent Test snapshot', () => {
    const base = { version: 1 as const, tenantId: 't1', businessHours: null, business: null, activeObjectPolicy: {} as any,
        regional: { version: 1, tenantId: 't1' } as any, vertical: { es: null, en: null, pt: null, fr: null } };

    it('the sealed value is read as captured; a snapshot without it reads as off; a non-boolean is refused', () => {
        expect(resolveEvaluationTurnContext({ ...base, catalogOverFaq: true }, 't1').catalogOverFaq).toBe(true);
        expect(resolveEvaluationTurnContext(base, 't1').catalogOverFaq).toBeUndefined();
        expect(() => resolveEvaluationTurnContext({ ...base, catalogOverFaq: 'yes' as any }, 't1')).toThrow('agent_snapshot_context_inputs_required');
    });
});
