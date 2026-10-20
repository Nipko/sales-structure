import { ToolRetrievalService } from './tool-retrieval.service';
import { staticToolsForAgentConfig } from './agent-tool-registry';
import { identityStepUpToolsFor, identityStepUpToolNames } from './identity-step-up-registration';
import { isConfirmableWriteTool } from './tool-policy-registry';

// These core/vertical sets are present in the persisted capability snapshots of
// the two real QA note turns. OTP publication consumes two relevance slots too.
describe.each([
    { name: 'restaurant', count: 18, tools: { crm: { enabled: true }, faqs: { enabled: true }, restaurants: { enabled: true } } },
    { name: 'lodging', count: 20, tools: { crm: { enabled: true }, faqs: { enabled: true }, properties: { enabled: true } } },
])('note selection with persisted core and identity tools: $name', ({ tools: config, count }) => {
    const base = staticToolsForAgentConfig(config);
    const candidates = [...base, ...identityStepUpToolsFor(base)];
    const pinned = new Set(candidates.filter(t => isConfirmableWriteTool(t.name)).map(t => t.name));
    for (const name of identityStepUpToolNames()) {
        if (candidates.some(t => t.name === name)) pinned.add(name);
    }
    const service = new ToolRetrievalService();
    it.each([
        'Guarda una nota interna en mi ficha: prefiero que me contacten los martes.',
        'Guarda una única nota interna en mi ficha con este texto exacto: "QA-AGENTE-QA09-NOTE-1953-20261020". Es un dato sintético. No crees tareas, pedidos, oportunidades ni reservas; no programes contactos ni transfieras a una persona. Confirma aquí el texto que quedó guardado.',
    ])('retains note and both verification tools for %s', message => {
        expect(candidates).toHaveLength(count);
        const names = service.retrieveRelevantTools(message, candidates, 10, pinned).map(t => t.name);
        expect(names).toEqual(expect.arrayContaining(['add_contact_note', ...pinned]));
    });
    it('does not promote the note writer for an explicit refusal', () => {
        const names = service.retrieveRelevantTools('No guardes ninguna nota interna en mi ficha.', candidates, 10, pinned).map(t => t.name);
        expect(names).not.toContain('add_contact_note');
        expect(names).toEqual(expect.arrayContaining([...pinned]));
    });
});
