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

const buttonNames:Record<string,Record<string,string>>={es:{includes:'Agregar elemento incluido',excludes:'Agregar elemento excluido'},en:{includes:'Add included item',excludes:'Add excluded item'},pt:{includes:'Adicionar item incluído',excludes:'Adicionar item excluído'},fr:{includes:'Ajouter un élément inclus',excludes:'Ajouter un élément exclu'}};
describe.each(['es','en','pt','fr'])('Tour list add controls in %s',locale=>{
 it.each(['includes','excludes'])('names %s add button and keeps its draft action local',async key=>{
  const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC"><TourDetailPage/></NextIntlClientProvider>);
  try{const label=[...screen.container.querySelectorAll('label')].find(l=>l.textContent?.trim()===messages[locale].tours[key]) as HTMLLabelElement;const input=label.control as HTMLInputElement;const button=label.parentElement!.querySelector('button')!;expect(button.getAttribute('aria-label')).toBe(buttonNames[locale][key]);expect(button.type).toBe('button');await interact(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Synthetic '+key);input.dispatchEvent(new Event('input',{bubbles:true}));});await interact(()=>button.click());expect(input.value).toBe('');expect([...label.parentElement!.querySelectorAll('span')].some(s=>s.textContent?.trim()==='Synthetic '+key)).toBe(true);expect(api.updateTourPackage).not.toHaveBeenCalled();}finally{screen.unmount();}
 });
});
