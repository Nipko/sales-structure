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


describe.each(['es','en','pt','fr'])('Listing creation labels in %s',locale=>{
 it.each(['name','propertyKind','currency'])('connects %s to its actual field',async key=>{
  const messages=JSON.parse(fs.readFileSync(path.join(process.cwd(),'messages',locale+'.json'),'utf8'));
  const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages}><ListingsPage/></NextIntlClientProvider>);
  try{
   await interact(()=>[...screen.container.querySelectorAll('button')].find(b=>b.textContent?.trim()===messages.listings.createListing)!.click());
   const panel=[...screen.container.querySelectorAll('h3')].find(h=>h.textContent===messages.listings.createListing)!.closest('div.fixed')!;
   const text=messages.listings[key]+(key==='name'?' *':'');
   const label=[...panel.querySelectorAll('label')].find(l=>l.textContent?.trim()===text)!;expect(label).toBeDefined();
   const control=label.parentElement!.querySelector<HTMLInputElement|HTMLSelectElement>('input,select')!;expect(control).not.toBeNull();
   expect([...control.labels||[]]).toContain(label);expect(label.control).toBe(control);expect(api.createListing).not.toHaveBeenCalled();
  }finally{screen.unmount();}
 });
});

it.each(['es','en','pt','fr'])('names every unsaved creation control in %s',async locale=>{
 const messages=JSON.parse(fs.readFileSync(path.join(process.cwd(),'messages',locale+'.json'),'utf8'));
 const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages}><ListingsPage/></NextIntlClientProvider>);
 try{
   await interact(()=>[...screen.container.querySelectorAll('button')].find(b=>b.textContent?.trim()===messages.listings.createListing)!.click());
   const region=screen.container.querySelector('[role="region"]')!;
   expect(region?.getAttribute('aria-label')).toBe(messages.listings.creationFormLabel);
   const controls=[...region.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select')];
   expect(controls).toHaveLength(9);
   for(const control of controls){expect(control.labels?.length).toBe(1);expect(control.labels?.[0].control).toBe(control);expect(control.id).not.toBe('');}
   expect(new Set(controls.map(c=>c.id)).size).toBe(controls.length);
 }finally{screen.unmount();}
});
