import fs from 'fs';
import path from 'path';
import { NextIntlClientProvider } from 'next-intl';
import { renderScreen, interact } from '@/test/a11y';
import { api } from '@/lib/api';
import Page from './page';
jest.mock('@/contexts/TenantContext',()=>({useTenant:()=>({activeTenantId:'synthetic-tenant'})}));
jest.mock('@/components/ui/page-header',()=>({PageHeader:({title}:any)=><h1>{title}</h1>}));
jest.mock('@/components/ui/skeleton-loader',()=>({SkeletonPage:()=>null}));
const messages=Object.fromEntries(['es','en','pt','fr'].map(locale=>[locale,JSON.parse(fs.readFileSync(path.join(process.cwd(),'messages',locale+'.json'),'utf8'))]));
jest.mock('next/navigation',()=>({useParams:()=>({listingId:'synthetic-listing'})}));
jest.mock('@/components/media/PhotoManager',()=>({PhotoManager:()=>null}));
jest.mock('@/lib/api',()=>({api:{getListing:jest.fn(),updateListing:jest.fn()}}));
beforeEach(()=>{jest.clearAllMocks();(api.updateListing as jest.Mock).mockResolvedValue({success:true});(api.getListing as jest.Mock).mockResolvedValue({success:true,data:{id:'synthetic-listing',name:'Synthetic listing',transaction_type:'sale',property_kind:'apartment',price:250000,currency:'EUR',financing_available:false,bedrooms:2,bathrooms:1,area_m2:80,parking_spots:0,status:'available',is_active:true,images:[]}});});

function field(container:HTMLElement,key:string,locale='es') {const text=messages[locale].listings[key]+(key==='price'?' (EUR)':'');const label=[...container.querySelectorAll('label')].find(l=>l.textContent?.trim()===text)!;return document.getElementById(label.htmlFor) as HTMLInputElement;}
async function fill(input:HTMLInputElement,value:string) {await interact(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
async function save(container:HTMLElement,locale='es') {const button=[...container.querySelectorAll('button')].find(b=>b.textContent?.trim()===messages[locale].common.save)!;await interact(()=>button.click());}
it.each(['es','en','pt','fr'])('rejects negative edit price with translated feedback in %s',async locale=>{const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages[locale]}><Page/></NextIntlClientProvider>);try{await fill(field(screen.container,'price',locale),'-1');await save(screen.container,locale);expect(api.updateListing).not.toHaveBeenCalled();expect(screen.container.querySelector('[role="alert"]')?.textContent).toBe(messages[locale].listings.invalidValues);}finally{screen.unmount();}});
it.each([['areaM2','-1'],['bathrooms','-1'],['bathrooms','1.25']])('blocks invalid edit %s=%s',async(key,value)=>{const screen=await renderScreen(<Page/>);try{const input=field(screen.container,key);await fill(input,value);expect(input.checkValidity()).toBe(false);await save(screen.container);expect(api.updateListing).not.toHaveBeenCalled();}finally{screen.unmount();}});
it('preserves valid decimals and permits absent optional stratum',async()=>{const screen=await renderScreen(<Page/>);try{await fill(field(screen.container,'price'),'250000.75');await fill(field(screen.container,'areaM2'),'80.25');await fill(field(screen.container,'bathrooms'),'1.5');await save(screen.container);expect(api.updateListing).toHaveBeenCalledTimes(1);expect(api.updateListing).toHaveBeenCalledWith('synthetic-tenant','synthetic-listing',expect.objectContaining({price:250000.75,areaM2:80.25,bathrooms:1.5,stratum:0}));}finally{screen.unmount();}});
it('accepts zero boundaries',async()=>{const screen=await renderScreen(<Page/>);try{for(const key of ['price','areaM2','bathrooms'])await fill(field(screen.container,key),'0');await save(screen.container);expect(api.updateListing).toHaveBeenCalledTimes(1);}finally{screen.unmount();}});
it('allows correction after an invalid Save and clears feedback',async()=>{const screen=await renderScreen(<Page/>);try{const input=field(screen.container,'price');await fill(input,'-1');await save(screen.container);expect(api.updateListing).not.toHaveBeenCalled();await fill(input,'12.75');await save(screen.container);expect(api.updateListing).toHaveBeenCalledTimes(1);expect(screen.container.querySelector('[role="alert"]')).toBeNull();}finally{screen.unmount();}});
