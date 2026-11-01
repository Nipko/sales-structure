import type { TurnKnowledgeContract } from '@parallext/business-spec';
import { evidenceVerifierRequest, EVIDENCE_VERIFIER_MODEL, parseEvidenceVerdict, repairReply, splitSentences, turnEvidence, unknownNotice } from './evidence-verifier';

const contract = (offers: Partial<TurnKnowledgeContract['offers']> = {}): TurnKnowledgeContract => ({
    schema: 'business-spec/turn-contract@1' as any, specVersion: '1', verdict: 'limitado' as any, resultHash: 'h',
    facts: [{ id: 'CORE.IDENTITY.NAME', topic: 'nombre', state: 'confirmed', source: 'value', value: { display_name: 'Clínica QA' } }],
    unknown: [
        { id: 'CORE.HOURS.REGULAR', topic: 'horario', state: 'seeded', code: 'NC+AV', never: ['asumir horario estándar'] },
        { id: 'OBJ.APPOINTMENT.AVAILABILITY_SOURCE', topic: 'disponibilidad', state: 'absent', code: 'NC+AV', never: [] },
    ],
    never: [],
    offers: { pendingQuestion: false, handoff: { available: false }, writes: {}, ...offers },
});

describe('EvidenceVerifier (D1b)', () => {
    it('la solicitud lleva lo que no consta, los hechos y la evidencia, con otro modelo que el juez del ensayo', () => {
        const req = evidenceVerifierRequest({ customerMessage: '¿Abren el sábado?', reply: 'Sí, abrimos de 8 a 13.', contract: contract(), evidence: ['{"slots":[]}'] });
        expect(req).toMatchObject({ task: 'classify', model: EVIDENCE_VERIFIER_MODEL, temperature: 0, jsonMode: true });
        expect(EVIDENCE_VERIFIER_MODEL).not.toBe('deepseek-chat');
        const payload = JSON.parse(req.messages[0].content);
        expect(payload.unknown.map((u: any) => u.id)).toEqual(['CORE.HOURS.REGULAR', 'OBJ.APPOINTMENT.AVAILABILITY_SOURCE']);
        expect(payload.facts[0].id).toBe('CORE.IDENTITY.NAME');
        expect(payload.evidence).toContain('slots');
    });

    it('solo acepta frases que están en la respuesta; JSON inválido es «sin veredicto»', () => {
        const reply = 'Abrimos de lunes a viernes de 8 a 18. ¿Le agendo una cita?';
        const v = parseEvidenceVerdict(JSON.stringify({ violations: [
            { sentence: 'Abrimos de lunes a viernes de 8 a 18.', kind: 'claim', requirementId: 'CORE.HOURS.REGULAR' },
            { sentence: 'Una frase inventada por el clasificador.', kind: 'claim' },
        ] }), reply);
        expect(v?.violations).toEqual([{ sentence: 'Abrimos de lunes a viernes de 8 a 18.', kind: 'claim', requirementId: 'CORE.HOURS.REGULAR' }]);
        expect(parseEvidenceVerdict('no es json', reply)).toBeNull();
        expect(parseEvidenceVerdict('{"violations": "x"}', reply)).toBeNull();
        expect(parseEvidenceVerdict('{"violations": []}', reply)).toEqual({ violations: [] });
    });

    it('repara: quita la frase sin respaldo, agrega el aviso una vez y deja la pregunta final al final', () => {
        const reply = 'Nuestro horario es de lunes a viernes de 8 a 18. No hay disponibilidad el sábado. ¿Le gustaría otra fecha?';
        const violations = [
            { sentence: 'Nuestro horario es de lunes a viernes de 8 a 18.', kind: 'claim' as const, requirementId: 'CORE.HOURS.REGULAR' },
            { sentence: 'No hay disponibilidad el sábado.', kind: 'denial' as const, requirementId: 'OBJ.APPOINTMENT.AVAILABILITY_SOURCE' },
        ];
        const r = repairReply(reply, violations, contract({ pendingQuestion: true }), 'es');
        expect(r.removed).toHaveLength(2);
        expect(r.reply).toBe('No tengo ese dato confirmado; si quiere, lo consulto con el equipo y le aviso. ¿Le gustaría otra fecha?');
    });

    it('sin violaciones o sin coincidencias, la respuesta sale igual', () => {
        const reply = 'Somos Clínica QA.';
        expect(repairReply(reply, [], contract(), 'es')).toEqual({ reply, removed: [], noticeAdded: false });
        expect(repairReply(reply, [{ sentence: 'Otra cosa.', kind: 'claim', requirementId: null }], contract(), 'es').reply).toBe(reply);
    });

    it('el aviso nunca ofrece lo que el negocio no tiene definido, y sale en el idioma del turno', () => {
        expect(unknownNotice(contract({ pendingQuestion: true }), 'es')).toContain('lo consulto con el equipo');
        expect(unknownNotice(contract({ handoff: { available: true } }), 'en')).toContain('connect you with someone');
        expect(unknownNotice(contract(), 'pt-BR')).toBe('Não tenho essa informação confirmada.');
        expect(unknownNotice(contract(), 'de')).toBe('No tengo ese dato confirmado.');
    });

    it('D1c: la evidencia lleva lo que el agente vio como autoridad, con los hechos y el catálogo primero', () => {
        const evidence = turnEvidence({
            facts: [{ subject: { id: 'p1', name: 'apartment en Spark QA Ciudad' }, field: 'price', value: 250000, currency: 'EUR' }],
            catalog: [{ id: 'p1', title: 'apartment en Spark QA Ciudad', price: 250000 }],
            services: [{ id: 's1', name: 'Visita guiada', durationMinutes: 60 }],
            reads: [{ name: 'get_property_details', result: { address: 'Calle 1' } }],
            knowledge: [{ q: 'horario' }],
            business: { name: 'Inmobiliaria QA' },
        });
        expect(evidence.map(e => e.split(':')[0])).toEqual(['facts', 'catalog', 'services', 'get_property_details', 'knowledge', 'business']);
        expect(evidence[0]).toBe('facts: apartment en Spark QA Ciudad · price = 250000 EUR');
        expect(turnEvidence({})).toEqual([]);
        const req = evidenceVerifierRequest({ customerMessage: '¿Precio?', reply: 'Cuesta 250.000 EUR.', contract: contract(), evidence });
        expect(JSON.parse(req.messages[0].content).evidence).toContain('250000');
        expect(req.systemPrompt).toContain('está respaldado aunque el tema esté en unknown');
    });

    it('parte frases por . ! ? … con cierres', () => {
        expect(splitSentences('Hola. ¿Qué tal? Bien… «Listo.» Fin')).toEqual(['Hola.', '¿Qué tal?', 'Bien…', '«Listo.»', 'Fin']);
    });
});
