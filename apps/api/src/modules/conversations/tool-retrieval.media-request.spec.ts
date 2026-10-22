import { ToolRetrievalService } from './tool-retrieval.service';
import { staticToolsForAgentConfig } from './agent-tool-registry';
import { identityStepUpToolsFor, identityStepUpToolNames } from './identity-step-up-registration';
import { isConfirmableWriteTool } from './tool-policy-registry';
const cases = [
 {name: 'listing explicit photo', family:'realEstate', target: 'send_listing_image', readers:['search_listings','get_listing_details'], industry: 'inmobiliaria', tools: {crm:{enabled:true},faqs:{enabled:true},knowledge:{enabled:true},realEstate:{enabled:true},appointments:{enabled:true}}, message: 'Envieme aqui la foto publicada de "Spark QA Inmueble 20261018T2220Z". Necesito recibir la imagen, no un enlace ni una descripcion. No reserve, no agende ni transfiera. Referencia QA-MEDIA-2904-qa07-UNA.'},
 {name: 'lodging current replacement photo', family:'properties', target:'send_property_image',readers:['list_properties','get_property_details'], industry:'turismo', tools:{crm:{enabled:true},faqs:{enabled:true},properties:{enabled:true},appointments:{enabled:false}},message:'Muestreme aqui la foto actual de "Spark QA Habitacion 20261018T113247Z". Utilice la imagen publicada ahora, aunque ya me haya mostrado una antes; no reenvie una imagen anterior. No reserve, no agende ni transfiera. Referencia QA-MEDIA-2904-qa09-ACTUAL.'},
];
describe.each(cases)('actual photo request: $name', c => {
 function selection(message:string,config:Record<string,any>=c.tools){
  const base=staticToolsForAgentConfig(config);const candidates=[...base,...identityStepUpToolsFor(base)];
  const pinned=new Set(candidates.filter(t=>isConfirmableWriteTool(t.name)).map(t=>t.name));
  for(const name of identityStepUpToolNames())if(candidates.some(t=>t.name===name))pinned.add(name);
  return {pinned,names:new ToolRetrievalService().retrieveRelevantTools(`${message} ${c.industry} idle`,candidates,10,pinned).map(t=>t.name)};
 }
 it('retains the enabled image tool, grounding reads and existing safety pins',()=>{
  const {names,pinned}=selection(c.message);expect(names).toEqual(expect.arrayContaining([c.target,...c.readers,...pinned]));
 });
 it('cannot grant a disabled image family',()=>{
  const {names}=selection(c.message,{...c.tools,[c.family]:{enabled:false}});expect(names).not.toContain(c.target);
 });
 it.each(['Please send the current photo again.','Envie a imagem atual novamente.','Envoyez la photo actuelle.','Muéstreme las imágenes actuales.'])('keeps delivery and grounding in supported locales: %s',message=>{
  expect(selection(message).names).toEqual(expect.arrayContaining([c.target,...c.readers]));
 });
});
