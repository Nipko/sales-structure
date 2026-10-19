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
jest.mock('next/navigation',()=>({useParams:()=>({listingId:'synthetic-listing'})}));
jest.mock('@/components/media/PhotoManager',()=>({PhotoManager:()=>null}));
jest.mock('@/lib/api',()=>({api:{getListing:jest.fn(),updateListing:jest.fn()}}));
beforeEach(()=>{jest.clearAllMocks();(api.getListing as jest.Mock).mockResolvedValue({success:true,data:{id:'synthetic-listing',name:'Synthetic listing',transaction_type:'sale',property_kind:'apartment',price:250000,currency:'EUR',financing_available:false,bedrooms:2,bathrooms:1,area_m2:80,parking_spots:0,status:'available',is_active:true,images:[]}});});
describe.each(['es','en','pt','fr'])('Visible listing labels in %s',locale=>{
 it.each(['areaM2','status','externalUrl'])('connects %s to its actual control',async key=>{
  const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages[locale]}><Page/></NextIntlClientProvider>);
  try{
   const text=key==='status'?messages[locale].listings.status.label:messages[locale].listings[key];const label=[...screen.container.querySelectorAll('label')].find(l=>l.textContent?.trim()===text);expect(label).toBeDefined();
   const control=label!.parentElement!.querySelector<HTMLInputElement|HTMLSelectElement>('input,select')!;expect(control).not.toBeNull();
   expect([...control.labels||[]]).toContain(label);expect(label!.control).toBe(control);expect(api.updateListing).not.toHaveBeenCalled();
  }finally{screen.unmount();}
 });
});

describe.each(['es','en','pt','fr'])('Complete details form labels in %s',locale=>{
 it.each(["sale", "rent"])('names every rendered control in %s mode',async mode=>{
 if(mode==='rent')(api.getListing as jest.Mock).mockResolvedValue({success:true,data:{id:'synthetic-listing',name:'Synthetic rent',transaction_type:'rent',property_kind:'apartment',price:250000,currency:'EUR',financing_available:false,bedrooms:2,bathrooms:1,area_m2:80,parking_spots:0,status:'available',is_active:true,images:[],hoa_fee:10,deposit:20}});
  const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages[locale]}><Page/></NextIntlClientProvider>);
  try{
   expect(screen.container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(messages[locale].listings.detailsFormLabel);
   const controls=[...screen.container.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')];expect(controls.length).toBe(mode==='rent'?16:15);
   for(const control of controls)expect((control.labels?.length||0)>0).toBe(true);
   const ids=controls.map(c=>c.id).filter(Boolean);expect(new Set(ids).size).toBe(ids.length);
  }finally{screen.unmount();}
 });
});
