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
jest.mock('@/lib/api', () => ({ api: { getTourPackage: jest.fn(), updateTourPackage: jest.fn() } }));
const messages = Object.fromEntries(['es', 'en', 'pt', 'fr'].map(locale => [locale, JSON.parse(fs.readFileSync(path.join(process.cwd(), 'messages', locale + '.json'), 'utf8'))]));
beforeEach(() => {
 jest.clearAllMocks();
 (api.getTourPackage as jest.Mock).mockResolvedValue({ success: true, data: {
  id:'synthetic-package',name:'Synthetic tour',duration_type:'hours',duration_value:4,price:125,currency:'EUR',max_capacity:10,min_party_size:1,languages:['es'],includes:[],excludes:[],tags:[],images:[],child_discount_pct:0,is_active:true,
 } });
 (api.updateTourPackage as jest.Mock).mockResolvedValue({success:true});
});
function field(container: HTMLElement, text: string) {
 const label=[...container.querySelectorAll('label')].find(l=>l.textContent?.trim()===text)!;
 return label.parentElement!.querySelector('input')!;
}
async function fill(input: HTMLInputElement,value:string) {
 await interact(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
}
async function save(container:HTMLElement,locale='es') {
 const button=[...container.querySelectorAll('button')].find(b=>b.textContent?.trim()===messages[locale].common.save)!;
 await interact(()=>button.click());
}
it.each(['es','en','pt','fr'])('blocks invalid discount with translated feedback in %s',async locale=>{
 const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="America/Bogota"><TourDetailPage/></NextIntlClientProvider>);
 try {
  const input=field(screen.container,messages[locale].tours.childDiscountPct);await fill(input,'101');expect(input.validity.rangeOverflow).toBe(true);
  await save(screen.container,locale);expect(api.updateTourPackage).not.toHaveBeenCalled();
  expect(screen.container.querySelector('[role="alert"]')?.textContent).toBe(messages[locale].tours.invalidValues);
 }finally{screen.unmount();}
});
it.each([['childDiscountPct','-1'],['hours','-1'],['maxCapacity','-1'],['minPartySize','-1'],['price','-1']])('does not send invalid %s=%s to update',async(key,value)=>{
 const screen=await renderScreen(<TourDetailPage/>);
 try{const input=field(screen.container,messages.es.tours[key]);await fill(input,value);expect(input.checkValidity()).toBe(false);await save(screen.container);expect(api.updateTourPackage).not.toHaveBeenCalled();}finally{screen.unmount();}
});
it('saves valid boundary values once',async()=>{
 const screen=await renderScreen(<TourDetailPage/>);
 try{await fill(field(screen.container,messages.es.tours.childDiscountPct),'100');await fill(field(screen.container,messages.es.tours.price),'0');await save(screen.container);expect(api.updateTourPackage).toHaveBeenCalledTimes(1);expect(api.updateTourPackage).toHaveBeenCalledWith('synthetic-tenant','synthetic-package',expect.objectContaining({childDiscountPct:100,price:0}));}finally{screen.unmount();}
});
it('allows correction after invalid input and clears the error',async()=>{
 const screen=await renderScreen(<TourDetailPage/>);
 try{const input=field(screen.container,messages.es.tours.childDiscountPct);await fill(input,'101');await save(screen.container);expect(api.updateTourPackage).not.toHaveBeenCalled();await fill(input,'20');await save(screen.container);expect(api.updateTourPackage).toHaveBeenCalledTimes(1);expect(screen.container.querySelector('[role="alert"]')).toBeNull();}finally{screen.unmount();}
});
