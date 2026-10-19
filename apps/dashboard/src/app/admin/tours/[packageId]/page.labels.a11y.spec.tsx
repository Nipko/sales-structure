import fs from 'fs';
import path from 'path';
import { NextIntlClientProvider } from 'next-intl';
import { renderScreen } from '@/test/a11y';
import { api } from '@/lib/api';
import Page from './page';
jest.mock('@/contexts/TenantContext',()=>({useTenant:()=>({activeTenantId:'synthetic-tenant'})}));
jest.mock('@/components/ui/page-header',()=>({PageHeader:({title}:any)=><h1>{title}</h1>}));
jest.mock('@/components/ui/skeleton-loader',()=>({SkeletonPage:()=>null}));
const messages=Object.fromEntries(['es','en','pt','fr'].map(locale=>[locale,JSON.parse(fs.readFileSync(path.join(process.cwd(),'messages',locale+'.json'),'utf8'))]));
jest.mock('next/navigation',()=>({useParams:()=>({packageId:'synthetic-package'})}));
jest.mock('@/lib/api',()=>({api:{getTourPackage:jest.fn(),updateTourPackage:jest.fn()}}));
beforeEach(()=>{jest.clearAllMocks();(api.getTourPackage as jest.Mock).mockResolvedValue({success:true,data:{id:'synthetic-package',name:'Synthetic tour',duration_type:'hours',duration_value:4,price:125,currency:'EUR',max_capacity:10,min_party_size:1,languages:['es'],includes:[],excludes:[],tags:[],images:[],child_discount_pct:0,is_active:true}});});
describe.each(['es','en','pt','fr'])('Visible tour labels in %s',locale=>{
 it.each(['includes','cancellationPolicy','maxCapacity'])('connects %s to its actual control',async key=>{
  const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages[locale]}><Page/></NextIntlClientProvider>);
  try{
   const label=[...screen.container.querySelectorAll('label')].find(l=>l.textContent?.trim()===messages[locale].tours[key]);expect(label).toBeDefined();
   const control=label!.parentElement!.querySelector<HTMLInputElement|HTMLTextAreaElement>('input,textarea')!;expect(control).not.toBeNull();
   expect([...control.labels||[]]).toContain(label);expect(label!.control).toBe(control);expect(api.updateTourPackage).not.toHaveBeenCalled();
  }finally{screen.unmount();}
 });
});

describe.each(['es','en','pt','fr'])('Complete details form labels in %s',locale=>{
 it.each(["tour"])('names every rendered control in %s mode',async mode=>{

  const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages[locale]}><Page/></NextIntlClientProvider>);
  try{
   expect(screen.container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(messages[locale].tours.detailsFormLabel);
   const controls=[...screen.container.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')];expect(controls.length).toBe(15);
   for(const control of controls)expect((control.labels?.length||0)>0).toBe(true);
   const ids=controls.map(c=>c.id).filter(Boolean);expect(new Set(ids).size).toBe(ids.length);
  }finally{screen.unmount();}
 });
});
