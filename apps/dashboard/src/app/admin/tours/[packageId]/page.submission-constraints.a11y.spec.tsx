import fs from 'fs';
import path from 'path';
import { NextIntlClientProvider } from 'next-intl';
import { interact, renderScreen } from '@/test/a11y';
import TourDetailPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({ useParams: () => ({ packageId: 'synthetic-package' }) }));
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'synthetic-tenant' }) }));
jest.mock('@/components/ui/page-header', () => ({ PageHeader: ({ title }: any) => <h1>{title}</h1> }));
jest.mock('@/components/ui/skeleton-loader', () => ({ SkeletonPage: () => null }));
jest.mock('@/lib/api', () => ({ api: { getTourPackage: jest.fn(), listTourInventory: jest.fn(), deleteTourInventory: jest.fn(), createTourInventory: jest.fn() } }));

beforeEach(() => {
    jest.clearAllMocks();
    (api.getTourPackage as jest.Mock).mockResolvedValue({ success: true, data: {
        id: 'synthetic-package', name: 'Synthetic tour', duration_type: 'hours', duration_value: 4,
        price: 125, currency: 'EUR', max_capacity: 10, min_party_size: 1, languages: ['es'],
        includes: [], excludes: [], tags: [], images: [], child_discount_pct: 0, is_active: true,
    } });
    (api.listTourInventory as jest.Mock).mockResolvedValue({success:true,data:[]});
    (api.createTourInventory as jest.Mock).mockResolvedValue({success:false,error:'Synthetic rejection'});
});


const messages=Object.fromEntries(['es','en','pt','fr'].map(l=>[l,JSON.parse(fs.readFileSync(path.join(process.cwd(),'messages',l+'.json'),'utf8'))]));
async function fill(input:HTMLInputElement,value:string){await interact(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
function input(region:Element,text:string){const l=[...region.querySelectorAll('label')].find(l=>l.textContent?.trim()===text) as HTMLLabelElement;return l.control as HTMLInputElement;}

async function open(locale:string){const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC"><TourDetailPage/></NextIntlClientProvider>);await interact(()=>screen.container.querySelector<HTMLButtonElement>('[data-tab-id="inventory"]')!.click());await interact(()=>[...screen.container.querySelectorAll('button')].find(b=>b.textContent?.trim()===messages[locale].tours.addDeparture)!.click());return screen;}
async function save(region:Element,locale:string){await interact(()=>[...region.querySelectorAll('button')].find(b=>b.textContent?.trim()===messages[locale].common.save)!.click());}
describe.each(['es','en','pt','fr'])('Departure Save HTML constraints in %s',locale=>{
 it.each(['pastDate','negativeOverride'])('blocks %s before API with translated feedback',async bad=>{const screen=await open(locale);try{const region=screen.container.querySelector('[role="region"]')!;const date=input(region,messages[locale].tours.departureDate+' *');await fill(date,bad==='pastDate'?'2000-01-01':'2026-12-16');const target=bad==='pastDate'?date:input(region,messages[locale].tours.priceOverride+' (EUR)');if(bad!=='pastDate')await fill(target,'-1');expect(target.checkValidity()).toBe(false);await save(region,locale);expect(api.createTourInventory).not.toHaveBeenCalled();expect(region.querySelector('[role="alert"]')?.textContent).toBe(messages[locale].tours.inventoryInvalidValues);}finally{screen.unmount();}});
});
it('sends valid departure with zero override exactly once',async()=>{const screen=await open('es');try{const region=screen.container.querySelector('[role="region"]')!;await fill(input(region,messages.es.tours.departureDate+' *'),'2026-12-16');await fill(input(region,messages.es.tours.priceOverride+' (EUR)'),'0');await save(region,'es');expect(api.createTourInventory).toHaveBeenCalledTimes(1);expect(api.createTourInventory).toHaveBeenCalledWith('synthetic-tenant','synthetic-package',expect.objectContaining({departureDate:'2026-12-16',priceOverride:0,totalSeats:10}));}finally{screen.unmount();}});
it('recovers from invalid departure without stale validation alert',async()=>{const screen=await open('es');try{const region=screen.container.querySelector('[role="region"]')!;const date=input(region,messages.es.tours.departureDate+' *');await fill(date,'2000-01-01');await save(region,'es');expect(api.createTourInventory).not.toHaveBeenCalled();await fill(date,'2026-12-16');await save(region,'es');expect(api.createTourInventory).toHaveBeenCalledTimes(1);expect(region.querySelector('[role="alert"]')).toBeNull();}finally{screen.unmount();}});

it('preserves fractional departure override prices',async()=>{const screen=await open('es');try{const region=screen.container.querySelector('[role="region"]')!;await fill(input(region,messages.es.tours.departureDate+' *'),'2026-12-16');const price=input(region,messages.es.tours.priceOverride+' (EUR)');await fill(price,'12.5');expect(price.checkValidity()).toBe(true);await save(region,'es');expect(api.createTourInventory).toHaveBeenCalledTimes(1);expect(api.createTourInventory).toHaveBeenCalledWith('synthetic-tenant','synthetic-package',expect.objectContaining({priceOverride:12.5}));}finally{screen.unmount();}});
