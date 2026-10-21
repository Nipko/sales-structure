import { ToolRetrievalService } from './tool-retrieval.service';
import { staticToolsForAgentConfig } from './agent-tool-registry';
import { identityStepUpToolsFor, identityStepUpToolNames } from './identity-step-up-registration';
import { isConfirmableWriteTool } from './tool-policy-registry';

describe.each([
    { name: 'restaurant', tools: { crm: { enabled: true }, faqs: { enabled: true }, restaurants: { enabled: true } } },
    { name: 'lodging', tools: { crm: { enabled: true }, faqs: { enabled: true }, properties: { enabled: true } } },
])('follow-up task selection: $name', ({ tools: config }) => {
    const base = staticToolsForAgentConfig(config);
    const candidates = [...base, ...identityStepUpToolsFor(base)];
    const pinned = new Set(candidates.filter(t => isConfirmableWriteTool(t.name)).map(t => t.name));
    for (const name of identityStepUpToolNames()) if (candidates.some(t => t.name === name)) pinned.add(name);
    const message = 'Necesito que su equipo me contacte más adelante para revisar mi solicitud. Registre una única tarea de seguimiento con el título exacto "QA-AGENTE-QA09-SEGUIMIENTO-20261020-2112". No he indicado fecha: déjela sin fecha y sin oportunidad asociada. No guarde nuevas notas, no transfiera esta conversación ni afirme que ya se realizó una llamada o un envío. Confirme aquí el título de la tarea que quedó registrada.';
    it('retains the requested task without dropping confirmation or identity tools', () => {
        const result = new ToolRetrievalService().retrieveRelevantTools(message, candidates, 10, pinned).map(t => t.name);
        expect(result).toEqual(expect.arrayContaining(['create_follow_up_task', ...pinned]));
    });
    it('does not grant CRM permissions to an agent whose CRM is off', () => {
        const denied = staticToolsForAgentConfig({ ...config, crm: { enabled: false } });
        expect(new ToolRetrievalService().retrieveRelevantTools(message, denied).map(t => t.name)).not.toContain('create_follow_up_task');
    });
});
