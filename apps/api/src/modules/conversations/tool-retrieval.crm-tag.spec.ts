import { ToolRetrievalService } from './tool-retrieval.service';
import { staticToolsForAgentConfig } from './agent-tool-registry';
import { identityStepUpToolNames, identityStepUpToolsFor } from './identity-step-up-registration';
import { isConfirmableWriteTool } from './tool-policy-registry';

const select = (message: string, step: string, crm = true) => {
    const configured = staticToolsForAgentConfig({ crm: { enabled: crm }, faqs: { enabled: true }, restaurants: { enabled: true } });
    const candidates = [...configured, ...identityStepUpToolsFor(configured)];
    const pins = new Set(candidates.filter(t => isConfirmableWriteTool(t.name)).map(t => t.name));
    for (const name of identityStepUpToolNames()) if (candidates.some(t => t.name === name)) pins.add(name);
    return { names: new ToolRetrievalService().retrieveRelevantTools(`${message} restaurantes ${step}`, candidates, 10, pins).map(t => t.name), pins };
};

describe('explicit CRM tag request survives unrelated booking-state vocabulary', () => {
    it.each(['idle', 'show_services', 'ask_date', 'show_slots', 'ask_name', 'ask_email', 'confirm', 'booked', 'waiting_flow'])(
        'retains the configured tag writer with booking step %s', step => {
            const { names, pins } = select('Añade a mi ficha la etiqueta QA2510_INEXISTENTE. Referencia QA-REGISTRO-2510-A.', step);
            expect(names).toContain('tag_contact');
            for (const name of pins) expect(names).toContain(name);
            expect(names).toContain('get_menu');
            expect(names).toContain('list_my_orders');
        },
    );
    it.each([
        'Add the tag QA_TEST to my profile.',
        'Adicione a etiqueta QA_TEST ao meu cadastro.',
        'Ajoutez l’étiquette QA_TEST à ma fiche.',
    ])('retains the tag writer for %s', message => {
        expect(select(message, 'booked').names).toContain('tag_contact');
    });
    it('does not create a tag capability when CRM is disabled', () => {
        expect(select('Añade a mi ficha la etiqueta QA_TEST.', 'booked', false).names).not.toContain('tag_contact');
    });
});
