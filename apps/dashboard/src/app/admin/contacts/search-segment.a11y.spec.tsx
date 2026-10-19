import { interact,renderScreen } from '@/test/a11y';
import ContactsPage from './page';
import { api } from '@/lib/api';
jest.mock('@/contexts/TenantContext',()=>({useTenant:()=>({activeTenantId:'tenant-qa'})}));
jest.mock('@/hooks/useVerticalTerms',()=>({useVerticalTerms:()=>({customerNoun:'contacto',customerNounPlural:'contactos',countCustomers:(n:number)=>`${n} contactos`,industry:'otro'})}));
jest.mock('@/hooks/usePlanLimits',()=>({usePlanLimits:()=>({canCreate:()=>true,getLimit:()=>100})}));
jest.mock('@/components/ui/help-panel',()=>({HelpPanel:()=>null}));
jest.mock('@/components/ui/upgrade-banner',()=>({UpgradeBanner:()=>null}));
jest.mock('@/lib/api',()=>({api:{fetch:jest.fn()}}));

it.each(['sparkqa','@example.invalid','+1202555'])('intersects %s search with the selected segment and preserves it when cleared',async term=>{
 (api.fetch as jest.Mock).mockReset().mockResolvedValue({success:true,data:[
  {id:'qa-qualified',first_name:'SparkQA Qualified',stage:'calificado',email:'qualified@example.invalid',phone:'+12025550101'},
  {id:'qa-new',first_name:'SparkQA New',stage:'nuevo',email:'new@example.invalid',phone:'+12025550102'},
 ]});
 const screen=await renderScreen(<ContactsPage/>);
 try{
  const input=screen.container.querySelector<HTMLInputElement>('input[placeholder]')!;
  const type=async(value:string)=>interact(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
  await type(term);
  expect(screen.container.querySelectorAll('tbody tr')).toHaveLength(2);
  const qualified=[...screen.container.querySelectorAll('button')].find(b=>b.textContent?.includes('Calificados'))!;
  await interact(()=>qualified.click());
  expect(screen.container.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(screen.container.querySelector('button[aria-label="Ver contacto: SparkQA Qualified"]')).not.toBeNull();
  expect(screen.container.querySelector('button[aria-label="Ver contacto: SparkQA New"]')).toBeNull();
  await type('');expect(screen.container.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(api.fetch).toHaveBeenCalledTimes(1);expect(api.fetch).toHaveBeenCalledWith('/crm/leads/tenant-qa');
 }finally{screen.unmount();}
});
