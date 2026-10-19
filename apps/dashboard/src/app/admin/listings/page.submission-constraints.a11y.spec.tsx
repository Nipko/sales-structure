import fs from 'fs';
import path from 'path';
import { NextIntlClientProvider } from 'next-intl';
import { interact, renderScreen } from '@/test/a11y';
import ListingsPage from './page';
import { api } from '@/lib/api';

let mockCurrency: string | null = 'USD';
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant-qa' }) }));
jest.mock('@/hooks/useOperatingCurrency', () => ({ useOperatingCurrency: () => mockCurrency }));
jest.mock('@/components/ui/help-panel', () => ({ HelpPanel: () => null }));
jest.mock('@/components/ui/page-header', () => ({ PageHeader: ({ action }: any) => <header>{action}</header> }));
jest.mock('@/components/media/PhotoManager', () => ({ PhotoManager: () => null }));
jest.mock('@/components/BulkImportModal', () => ({ BulkImportModal: () => null }));
jest.mock('@/lib/api', () => ({ api: { listListings: jest.fn(), createListing: jest.fn() } }));

beforeEach(() => {
    jest.clearAllMocks(); mockCurrency = 'USD';
    (api.listListings as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (api.createListing as jest.Mock).mockResolvedValue({ success: false, error: 'Synthetic rejection' });
});



const messages=Object.fromEntries(['es','en','pt','fr'].map(l=>[l,JSON.parse(fs.readFileSync(path.join(process.cwd(),'messages',l+'.json'),'utf8'))]));
async function fill(input:HTMLInputElement,value:string){await interact(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
function input(region:Element,text:string){const l=[...region.querySelectorAll('label')].find(l=>l.textContent?.trim()===text) as HTMLLabelElement;return l.control as HTMLInputElement;}

async function open(locale:string){const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages[locale]}><ListingsPage/></NextIntlClientProvider>);await interact(()=>[...screen.container.querySelectorAll('button')].find(b=>b.textContent?.trim()===messages[locale].listings.createListing)!.click());return screen;}
async function save(screen:any,locale:string){const panel=[...screen.container.querySelectorAll('h3')].find((h:any)=>h.textContent===messages[locale].listings.createListing)!.closest('div.fixed')!;await interact(()=>[...panel.querySelectorAll('button')].find((b:any)=>b.textContent?.trim()===messages[locale].listings.createListing)!.click());}
describe.each(['es','en','pt','fr'])('Listing Save HTML constraints in %s',locale=>{
 it.each([['price','-1'],['bathrooms','1.25'],['areaM2','-1']])('blocks %s=%s before API with translated feedback',async(key,value)=>{const screen=await open(locale);try{const region=screen.container.querySelector('[role="region"]')!;await fill(input(region,messages[locale].listings.name+' *'),'Synthetic unsaved listing');const target=input(region,messages[locale].listings[key]);await fill(target,value);expect(target.checkValidity()).toBe(false);await save(screen,locale);expect(api.createListing).not.toHaveBeenCalled();expect(screen.container.querySelector('[role="alert"]')?.textContent).toBe(messages[locale].listings.invalidValues);}finally{screen.unmount();}});
});
it('sends valid zero price and half bathroom boundary once',async()=>{const screen=await open('es');try{const region=screen.container.querySelector('[role="region"]')!;await fill(input(region,messages.es.listings.name+' *'),'Synthetic unsaved listing');await fill(input(region,messages.es.listings.bathrooms),'1.5');await save(screen,'es');expect(api.createListing).toHaveBeenCalledTimes(1);expect(api.createListing).toHaveBeenCalledWith('tenant-qa',expect.objectContaining({price:0,bathrooms:1.5,currency:'USD'}));}finally{screen.unmount();}});
it('allows corrected invalid listing to send once',async()=>{const screen=await open('es');try{const region=screen.container.querySelector('[role="region"]')!;await fill(input(region,messages.es.listings.name+' *'),'Synthetic unsaved listing');const price=input(region,messages.es.listings.price);await fill(price,'-1');await save(screen,'es');expect(api.createListing).not.toHaveBeenCalled();await fill(price,'1');await save(screen,'es');expect(api.createListing).toHaveBeenCalledTimes(1);}finally{screen.unmount();}});

it('preserves fractional property prices and areas',async()=>{const screen=await open('es');try{const region=screen.container.querySelector('[role="region"]')!;await fill(input(region,messages.es.listings.name+' *'),'Synthetic decimal listing');const price=input(region,messages.es.listings.price),area=input(region,messages.es.listings.areaM2);await fill(price,'250000.5');await fill(area,'80.5');expect(price.checkValidity()).toBe(true);expect(area.checkValidity()).toBe(true);await save(screen,'es');expect(api.createListing).toHaveBeenCalledTimes(1);expect(api.createListing).toHaveBeenCalledWith('tenant-qa',expect.objectContaining({price:250000.5,areaM2:80.5}));}finally{screen.unmount();}});


describe.each(['es','en','pt','fr'])('Listing close button in %s',locale=>{
 it('has a translated accessible name and closes without submitting',async()=>{const screen=await open(locale);try{const heading=[...screen.container.querySelectorAll('h3')].find(h=>h.textContent===messages[locale].listings.createListing)!;const close=heading.parentElement!.querySelector('button')!;expect(close.getAttribute('aria-label')).toBe(messages[locale].common.close);await interact(()=>close.click());expect([...screen.container.querySelectorAll('h3')].some(h=>h.textContent===messages[locale].listings.createListing)).toBe(false);expect(api.createListing).not.toHaveBeenCalled();}finally{screen.unmount();}});
});
