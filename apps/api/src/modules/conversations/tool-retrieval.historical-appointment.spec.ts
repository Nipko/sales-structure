import { ToolRetrievalService } from './tool-retrieval.service';
import { staticToolsForAgentConfig } from './agent-tool-registry';
import { identityStepUpToolsFor, identityStepUpToolNames } from './identity-step-up-registration';
import { isConfirmableWriteTool } from './tool-policy-registry';
describe('historic appointment read with the actual Luna tool families',()=>{
 it('retains own-detail reader and existing identity pins for the completed appointment question',()=>{
 const base=staticToolsForAgentConfig({appointments:{enabled:true},crm:{enabled:true},faqs:{enabled:true}});
 const tools=[...base,...identityStepUpToolsFor(base)];
 const pinned=new Set(tools.filter(t=>isConfirmableWriteTool(t.name)).map(t=>t.name));
 for(const name of identityStepUpToolNames())if(tools.some(t=>t.name===name))pinned.add(name);
 const names=new ToolRetrievalService().retrieveRelevantTools("Consulte la cita f0080b9a-c062-47c3-8318-b592a82da9a3 de mi ficha: servicio, fecha, hora, estado y si su precio historico esta confirmado o sigue por confirmar. Use lo guardado para esa cita; no la cambie. Referencia QA-APPT-3096-QA05-COMPLETADA."+' moda_belleza idle',tools,10,pinned).map(t=>t.name);
 expect(names).toEqual(expect.arrayContaining(['get_appointment_details',...pinned]));
 });
});
