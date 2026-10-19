import { renderScreen, interact } from '@/test/a11y';
import FaqsPage from './page';
import { api } from '@/lib/api';
jest.mock('@/contexts/TenantContext',()=>({useTenant:()=>({activeTenantId:'synthetic-tenant'})}));
jest.mock('@/hooks/useRole',()=>({useRole:()=>({canEditKnowledge:true})}));
jest.mock('@/components/ui/help-panel',()=>({HelpPanel:()=>null}));
jest.mock('@/lib/api',()=>({api:{listFaqs:jest.fn(),createFaq:jest.fn(),updateFaq:jest.fn(),deleteFaq:jest.fn()}}));
beforeEach(()=>{jest.clearAllMocks();(api.listFaqs as jest.Mock).mockResolvedValue({success:true,data:[{id:'faq-1',question:'Pregunta QA Uno',answer:'Solo datos sintéticos uno',tags:[],orderIndex:0,isPublished:false,views:0},{id:'faq-2',question:'Pregunta QA Dos',answer:'Solo datos sintéticos dos',tags:[],orderIndex:0,isPublished:false,views:0}]});});
it('names each edit action by question and opens the corresponding record',async()=>{
 const screen=await renderScreen(<FaqsPage/>);
 try{const button=screen.container.querySelector<HTMLButtonElement>('button[aria-label="Editar FAQ: Pregunta QA Dos"]');expect(button).not.toBeNull();await interact(()=>button!.click());expect(screen.container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Solo datos sintéticos dos');expect(api.updateFaq).not.toHaveBeenCalled();}finally{screen.unmount();}
});
it('associates the editor fields and announces empty required fields without a request',async()=>{
 const screen=await renderScreen(<FaqsPage/>);
 try{const newButton=[...screen.container.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Nueva FAQ')!;await interact(()=>newButton.click());const controls=[...screen.container.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input:not([type=checkbox]),textarea')];expect(controls).toHaveLength(5);for(const c of controls)expect(c.labels?.length).toBeGreaterThan(0);const save=[...screen.container.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Guardar')!;await interact(()=>save.click());expect(screen.container.querySelector('[role=alert]')?.textContent).toContain('Pregunta y respuesta son obligatorias');expect(api.createFaq).not.toHaveBeenCalled();expect(api.updateFaq).not.toHaveBeenCalled();const close=screen.container.querySelector<HTMLButtonElement>('button[aria-label="Cerrar editor de FAQ"]');expect(close).not.toBeNull();await interact(()=>close!.click());expect(screen.container.querySelector('textarea')).toBeNull();}finally{screen.unmount();}
});
