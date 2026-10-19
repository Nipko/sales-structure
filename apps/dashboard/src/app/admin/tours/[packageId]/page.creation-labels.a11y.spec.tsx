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
});

describe.each(['es','en','pt','fr'])('Departure creation labels in %s',locale=>{
 it.each(['departureDate','departureTime','totalSeats'])('connects %s to its actual field',async key=>{
  const messages=JSON.parse(fs.readFileSync(path.join(process.cwd(),'messages',locale+'.json'),'utf8'));
  const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages}><TourDetailPage/></NextIntlClientProvider>);
  try{
   await interact(()=>screen.container.querySelector<HTMLButtonElement>('[data-tab-id="inventory"]')!.click());
   await interact(()=>[...screen.container.querySelectorAll('button')].find(b=>b.textContent?.trim()===messages.tours.addDeparture)!.click());
   const text=messages.tours[key]+(key==='departureTime'?'':' *');
   const label=[...screen.container.querySelectorAll('label')].find(l=>l.textContent?.trim()===text)!;expect(label).toBeDefined();
   const control=label.parentElement!.querySelector<HTMLInputElement>('input')!;expect(control).not.toBeNull();
   expect([...control.labels||[]]).toContain(label);expect(label.control).toBe(control);expect(api.createTourInventory).not.toHaveBeenCalled();
  }finally{screen.unmount();}
 });
});

it.each(['es','en','pt','fr'])('names every unsaved creation control in %s',async locale=>{
 const messages=JSON.parse(fs.readFileSync(path.join(process.cwd(),'messages',locale+'.json'),'utf8'));
 const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages}><TourDetailPage/></NextIntlClientProvider>);
 try{
   await interact(()=>screen.container.querySelector<HTMLButtonElement>('[data-tab-id="inventory"]')!.click());
   await interact(()=>[...screen.container.querySelectorAll('button')].find(b=>b.textContent?.trim()===messages.tours.addDeparture)!.click());
   const region=screen.container.querySelector('[role="region"]')!;
   expect(region?.getAttribute('aria-label')).toBe(messages.tours.creationFormLabel);
   const controls=[...region.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select')];
   expect(controls).toHaveLength(5);
   for(const control of controls){expect(control.labels?.length).toBe(1);expect(control.labels?.[0].control).toBe(control);expect(control.id).not.toBe('');}
   expect(new Set(controls.map(c=>c.id)).size).toBe(controls.length);
 }finally{screen.unmount();}
});
