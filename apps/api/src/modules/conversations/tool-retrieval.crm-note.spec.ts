import { ToolRetrievalService } from './tool-retrieval.service';
import { staticToolsForAgentConfig } from './agent-tool-registry';
import { isConfirmableWriteTool } from './tool-policy-registry';

const configurations = [
    { name: 'restaurant', tools: { crm: { enabled: true }, faqs: { enabled: true }, restaurants: { enabled: true } } },
    { name: 'lodging', tools: { crm: { enabled: true }, faqs: { enabled: true }, properties: { enabled: true } } },
];
const service = new ToolRetrievalService();
const select = (config: unknown, message: string) => {
    const candidates = staticToolsForAgentConfig(config);
    const pinned = new Set(candidates.filter(t => isConfirmableWriteTool(t.name)).map(t => t.name));
    return service.retrieveRelevantTools(`${message} idle`, candidates, 10, pinned).map(t => t.name);
};
describe.each(configurations)('explicit customer note request: $name', ({ tools }) => {
    it.each([
        'Guarda una nota interna en mi ficha: prefiero que me contacten los martes.',
        'Guarda una única nota interna en mi ficha con este texto exacto: "QA-AGENTE-QA09-NOTE-1953-20261020". Es un dato sintético. No crees tareas, pedidos, oportunidades ni reservas; no programes contactos ni transfieras a una persona. Confirma aquí el texto que quedó guardado.',
        '¿Puedes guardar una nota en mi ficha indicando que prefiero los martes?',
    ])('keeps the configured note writer for %s', message => {
        const names = select(tools, message);
        expect(names).toContain('add_contact_note');
        for (const candidate of staticToolsForAgentConfig(tools).filter(t => isConfirmableWriteTool(t.name))) {
            expect(names).toContain(candidate.name);
        }
    });
    it('cannot invent a note writer when CRM is disabled', () => {
        expect(select({ ...tools, crm: { enabled: false } }, 'Guarda una nota interna en mi ficha: prefiero los martes.')).not.toContain('add_contact_note');
    });
});
