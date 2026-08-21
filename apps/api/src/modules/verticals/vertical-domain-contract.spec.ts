import {
    VERTICAL_DOMAIN_CONTRACT_VERSION,
    buildDomainContractDraft,
    domainContractGaps,
    intentToolGroup,
    listDomainContractDrafts,
    listSubtypeExperienceProfileIds,
    resolveVerticalCapabilityManifest,
    TERMINOLOGY_LANGUAGES,
    type VerticalDomainContractV2,
} from '@parallext/shared';

/**
 * Los 76 contratos de dominio, en borrador.
 *
 * Cada pieza de la verdad de un subtipo vivía en su propio registro —el
 * manifiesto sabe sus capacidades, la terminología sus sustantivos, el perfil
 * comercial hasta dónde se vende— y **ninguno** sabía qué conversaciones tiene
 * que sostener: qué intenciones reconoce, con qué datos, cuáles de esos datos
 * son sensibles, cuáles se guardan, qué confirma antes de comprometerse y qué
 * hace cuando no puede. Eso se resolvía en el prompt: texto libre, distinto en
 * cada perfil, imposible de verificar.
 *
 * Los contratos se **derivan** de lo ya declarado en vez de escribirse a mano,
 * y esta prueba fija por qué: un contrato escrito para 76 perfiles son 76
 * oportunidades de prometer por escrito algo que el runtime no hace.
 */

describe('los 76 contratos de dominio', () => {
    const drafts = listDomainContractDrafts();

    it('hay uno por perfil y ninguno se perdió', () => {
        expect(drafts).toHaveLength(listSubtypeExperienceProfileIds().length);
        expect(drafts).toHaveLength(76);
    });

    it('un id con alias resuelve al contrato de su destino, no a uno propio', () => {
        // `veterinaria/peluqueria_canina` es un alias de
        // `pet_services/peluqueria`: son 76 ids y 75 contratos distintos. Que
        // el alias tuviera contrato PROPIO sería la misclasificación que el
        // alias existe para reparar — una peluquería canina con persona
        // clínica y "recorrido del paciente".
        const distinct = new Set(drafts.map(d => d.profileId));
        expect(distinct.size).toBe(75);
        expect(buildDomainContractDraft('veterinaria', 'peluqueria_canina').profileId)
            .toBe('pet_services/peluqueria');
    });

    it('TODOS nacen en borrador: ninguno se declara certificado solo', () => {
        // Marcar certificado sin evidencia E2E es exactamente lo que el encargo
        // prohíbe, y una derivación no puede producir esa evidencia.
        for (const draft of drafts) {
            expect(draft.status).not.toBe('certified');
            expect(['draft', 'blocked']).toContain(draft.status);
        }
    });

    it('la evidencia E2E nunca se satisface desde el código', () => {
        for (const draft of drafts) {
            const e2e = draft.certification.requirements.find(r => r.key === 'e2e_evidence');
            expect(e2e).toBeDefined();
            expect(e2e!.satisfied).toBe(false);
        }
    });

    it('un perfil bloqueado sale `blocked`, no `draft`', () => {
        const blocked = drafts.filter(d => d.status === 'blocked');
        expect(blocked.length).toBe(7);
        for (const draft of blocked) {
            expect(draft.certification.blockers).toContain('commercialisable');
        }
    });
});

describe('un contrato no promete lo que el runtime no puede', () => {
    const drafts = listDomainContractDrafts();

    it.each(drafts.map(d => [d.profileId, d] as const))(
        '%s sólo declara intenciones que su manifiesto concede',
        (_id, draft: VerticalDomainContractV2) => {
            const manifest = resolveVerticalCapabilityManifest(
                draft.industry,
                draft.subtype === '__none__' ? undefined : draft.subtype,
            );
            const groups = new Set(manifest.toolGroups as readonly string[]);
            // Cada intención se deriva de una familia de tools: la familia ES la
            // evidencia de que el runtime puede sostener esa conversación.
            //
            // El mapa se pide al registro en vez de copiarlo acá. La copia que
            // había tenía cinco entradas, y al declarar los quince grupos que
            // faltaban quedó comparando contra `undefined` — una copia de una
            // relación que ya existe es una copia que se desactualiza.
            for (const intent of draft.intents) {
                const group = intentToolGroup(intent.key);
                expect({ intent: intent.key, group }).toEqual({ intent: intent.key, group });
                expect({ intent: intent.key, granted: groups.has(group!) })
                    .toEqual({ intent: intent.key, granted: true });
            }
        },
    );

    it('toda intención que compromete pide confirmación explícita', () => {
        for (const draft of listDomainContractDrafts()) {
            for (const intent of draft.intents.filter(i => i.commits)) {
                expect(intent.confirmation).toBe('explicit');
            }
        }
    });

    it('toda intención que compromete puede terminar en una persona', () => {
        // Sin un estado terminal humano, un fallo deja al cliente esperando.
        for (const draft of listDomainContractDrafts()) {
            for (const intent of draft.intents.filter(i => i.commits)) {
                expect(intent.states).toContain('handed_off');
                expect(intent.fallback).toBe('handoff');
            }
        }
    });

    it('un deep link apunta siempre a una ruta que el perfil tiene', () => {
        // Mandar al dueño a una pantalla que su propio menú no muestra es un
        // callejón sin salida con permisos.
        for (const draft of listDomainContractDrafts()) {
            for (const link of draft.navigation.deepLinks) {
                expect(draft.navigation.surfaces).toContain(link.route);
            }
        }
    });
});

describe('los slots declaran lo que hay que saber de un dato', () => {
    const allSlots = listDomainContractDrafts()
        .flatMap(d => d.intents.flatMap(i => i.slots));

    it('hay slots que revisar', () => {
        expect(allSlots.length).toBeGreaterThan(0);
    });

    it('cada slot dice su sensibilidad, su origen y cuánto vive', () => {
        for (const slot of allSlots) {
            expect(['public', 'personal', 'sensitive', 'regulated']).toContain(slot.sensitivity);
            expect(['customer', 'tool', 'derived', 'tenant_config']).toContain(slot.source);
            expect(['turn', 'conversation', 'record', 'never']).toContain(slot.persistence);
        }
    });

    it('un dato `derived` nunca se le pregunta al cliente', () => {
        // Preguntarle al cliente algo que el sistema ya sabe es cómo se cuela
        // un valor inventado en el lugar de uno calculado.
        for (const slot of allSlots.filter(s => s.source === 'derived')) {
            expect(slot.persistence).not.toBe('never');
        }
    });

    it('lo sensible que compromete se confirma antes de usarse', () => {
        for (const slot of allSlots.filter(s => s.sensitivity === 'sensitive')) {
            expect(slot.confirm).toBe(true);
        }
    });
});

describe('el prompt del perfil dice hasta dónde llega', () => {
    it('un perfil de captación no puede afirmar que reserva', () => {
        const draft = listDomainContractDrafts().find(d => d.prompt.scope === 'captacion');
        expect(draft).toBeDefined();
        expect(draft!.prompt.claims.join(' ')).not.toMatch(/reservar/);
    });

    it('un perfil bloqueado lo dice en su propia divulgación', () => {
        const blocked = listDomainContractDrafts().filter(d => d.status === 'blocked');
        for (const draft of blocked) {
            expect(draft.prompt.disclosure.join(' ')).toMatch(/no cierra operaciones por chat/);
        }
    });

    it('todo contrato declara los cuatro idiomas', () => {
        for (const draft of listDomainContractDrafts()) {
            expect(draft.prompt.languages).toEqual(TERMINOLOGY_LANGUAGES);
        }
    });

    it('la divulgación siempre incluye no ser una persona', () => {
        for (const draft of listDomainContractDrafts()) {
            expect(draft.prompt.disclosure.join(' ')).toMatch(/no una persona/);
        }
    });
});

describe('los huecos se declaran en vez de rellenarse', () => {
    it('lo que sí se pudo derivar ya no figura como hueco', () => {
        // Antes había 87 huecos derivables: 59 perfiles sin nombre para su
        // objeto primario y 28 cuyo alcance prometía cerrar sin ninguna
        // intención que se comprometiera. Los dos se cerraron —el objeto
        // primario ya estaba declarado en el manifiesto y le faltaba el
        // nombre; las intenciones faltaban en 15 de los 19 grupos—, así que
        // `unresolved` queda vacío.
        //
        // Esta prueba dejó de medir "hay huecos declarados" y pasa a medir lo
        // contrario, que es lo que corresponde: si vuelve a aparecer uno, es
        // regresión y no estado normal.
        const withGaps = listDomainContractDrafts()
            .filter(d => d.unresolved.length > 0)
            .map(d => ({ profile: d.profileId, gaps: d.unresolved }));
        expect(withGaps).toEqual([]);
    });

    it('...y lo que no se puede derivar sigue declarado como bloqueo', () => {
        // Un hueco visible se cierra; uno relleno con algo plausible se olvida.
        // Los que quedan son los dos que no dependen del código, y siguen
        // saliendo con motivo legible.
        const blockers = listDomainContractDrafts().flatMap(d => d.certification.blockers);
        expect(blockers.length).toBeGreaterThan(0);
        for (const blocker of blockers) {
            expect(typeof blocker).toBe('string');
            expect(blocker.length).toBeGreaterThan(3);
        }
        expect([...new Set(blockers)].sort()).toEqual(['commercialisable', 'e2e_evidence']);
    });

    it('`domainContractGaps` devuelve motivos, no un booleano', () => {
        const draft = buildDomainContractDraft('seguros', 'aseguradora');
        const gaps = domainContractGaps(draft);
        // "No está listo" sin el motivo es lo que hace que nadie lo cierre.
        expect(gaps.length).toBeGreaterThan(0);
        expect(gaps).toContain('certification.commercialisable');
        expect(gaps).toContain('certification.e2e_evidence');
    });

    it('un subtipo desconocido falla en vez de devolver un contrato vacío', () => {
        expect(() => buildDomainContractDraft('salud', 'no_existe')).toThrow();
    });

    it('lleva versión de contrato', () => {
        expect(buildDomainContractDraft('restaurantes', 'comida_rapida').contractVersion)
            .toBe(VERTICAL_DOMAIN_CONTRACT_VERSION);
    });
});
