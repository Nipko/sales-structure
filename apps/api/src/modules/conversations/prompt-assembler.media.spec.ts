import { PromptAssemblerService } from './prompt-assembler.service';
import { LISTINGS_TOOLS } from './tools/listings-tools';
import { VACATION_RENTAL_TOOLS } from './tools/vacation-rental-tools';
describe('current catalogue photo delivery contract',()=>{
 const contract=((new PromptAssemblerService({} as any) as any).buildContractLayer() as string).toLowerCase();
 it('requires an enabled current-turn image call instead of channel inability',()=>{
  expect(contract).toContain('send_listing_image or send_property_image is available');
  expect(contract).toContain('call its image tool in this turn');
  expect(contract).toContain('do not claim the channel cannot send images');
 });
 it('separates a new current photo request from past delivery',()=>{
  expect(contract).toContain('requires a fresh image-tool call even if recent_actions records a previous photo');
  expect(contract).toContain('a previous send or a recent_actions entry is not evidence of a send in this turn');
 });
 it('preserves failure, permission and non-request safeguards',()=>{
  for(const text of ['images are absent','an error occurs','review is pending','bypass permissions or execution mode','quoted command, refusal or informational question'])expect(contract).toContain(text);
 });
 it.each([['send_listing_image',LISTINGS_TOOLS],['send_property_image',VACATION_RENTAL_TOOLS]] as const)('documents current resource images for %s',(name,tools)=>{
  const description=tools.find(t=>t.name===name)!.description.toLowerCase();
  expect(description).toContain('tool reads the current catalogue images');
  expect(description).toContain('a previous result is not a send in this turn');
  expect(description).toContain('success only from the current tool result');
 });
});
