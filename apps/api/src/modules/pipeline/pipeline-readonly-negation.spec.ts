import { PipelineService, AUTO_PROGRESS_KEYWORDS } from './pipeline.service';

describe('read-only purchase negation', () => {
 const service: any = Object.create(PipelineService.prototype);
 it.each([
  ['es', 'solo consulta, sin reservar'], ['es', 'sin pagar'],
  ['pt', 'apenas consulta, sem reservar'], ['pt', 'sem pagar'],
  ['en', 'without having to pay'], ['fr', 'sans payer'],
 ])('%s rejects negated purchase: %s', (lang, text) => {
  expect(service.hasAnyKeyword(text, AUTO_PROGRESS_KEYWORDS[lang].purchase)).toBe(false);
 });
 it.each([
  ['es', 'sin duda quiero comprar'], ['es', 'sin problema quiero reservar'],
  ['es', 'sin costo adicional quiero reservar'], ['es', 'quiero reservar'], ['pt', 'sem duvida quero reservar'],
  ['en', 'without hesitation I want to pay'], ['fr', 'sans aucun doute je veux payer'],
 ])('%s retains affirmative intent: %s', (lang, text) => {
  expect(service.hasAnyKeyword(text, AUTO_PROGRESS_KEYWORDS[lang].purchase)).toBe(true);
 });
 it.each([['solo consulta, sin reservar', false], ['quiero reservar', true]])(
  'stage write requires positive purchase intent: %s', async (messageText, shouldWrite) => {
   const s: any = Object.create(PipelineService.prototype);
   const stages = [
    {slug:'cotizacion',position:0,prob:70,is_terminal:false,pipeline_id:'p'},
    {slug:'confirmado',position:1,prob:95,is_terminal:false,pipeline_id:'p'},
   ];
   s.getTenantSchema=jest.fn().mockResolvedValue('tenant_unit');
   s.getTenantStageCatalog=jest.fn().mockResolvedValue(stages);
   s.isAutoProgressEnabled=jest.fn().mockResolvedValue(true);
   s.prisma={executeInTenantSchema:jest.fn().mockResolvedValue([{opp_id:'op',opp_stage:'cotizacion',lead_id:'lead'}])};
   s.evaluateRulesForLead=jest.fn().mockResolvedValue(undefined);
   s.writeLeadStage=jest.fn().mockResolvedValue(undefined);
   s.logger={log:jest.fn(),warn:jest.fn()};
   await s.autoProgressFromConversation('tenant','conversation',{messageText,lang:'es',isCustomerReply:true});
   expect(s.writeLeadStage).toHaveBeenCalledTimes(shouldWrite?1:0);
  });
});
