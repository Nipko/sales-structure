import { act } from 'react';
import { renderScreen } from '@/test/a11y';
import AppointmentModal from './AppointmentModal';
jest.mock('@/lib/api', () => ({ __esModule: true, api: {} }));
const props = {
 form: {serviceName:'',date:'',startTime:'',endTime:'',location:'',notes:'',assignedTo:'',contactId:''},
 onChange:jest.fn(),services:[{id:'s1',name:'Consulta',duration:30,active:true} as any],
 contacts:[],contactsLoading:false,contactsLoadFailed:false,contactSearch:'',onContactSearchChange:jest.fn(),
 contactsHasMore:false,onLoadMoreContacts:jest.fn(),onRetryContacts:jest.fn(),editingAppointment:null,saving:false,
 onSave:jest.fn(),onSaveRecurring:jest.fn(),onClose:jest.fn(),
};
describe('appointment creation accessible field names',()=>{
 it('associates visible labels with every main input and selector',async()=>{
  const screen=await renderScreen(<AppointmentModal {...props}/>);
  try {
   const controls=[...screen.container.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('fieldset input:not([type=search]),fieldset select,fieldset textarea')];
   expect(controls).toHaveLength(8);
   for(const control of controls){expect(control.labels?.length).toBeGreaterThan(0);expect(control.labels?.[0].textContent?.trim()).toBeTruthy();}
   const contact=screen.container.querySelector<HTMLSelectElement>('select[aria-invalid]')!;
   expect(contact.labels?.[0].textContent).toContain('Contacto');
  }finally{screen.unmount();}
 });
 it('names recurrence frequency and count after enabling a series without saving',async()=>{
  const screen=await renderScreen(<AppointmentModal {...props}/>);
  try {
   await act(async()=>{screen.container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();});
   const count=screen.container.querySelector<HTMLInputElement>('input[type=number]')!;
   const frequency=screen.container.querySelector<HTMLSelectElement>('select[value]') ?? [...screen.container.querySelectorAll('select')].find(s=>s.value==='weekly');
   expect(count.getAttribute('aria-label')).toBe('Número de citas');
   expect(frequency?.getAttribute('aria-label')).toBe('Frecuencia de repetición');
   expect(props.onSave).not.toHaveBeenCalled();expect(props.onSaveRecurring).not.toHaveBeenCalled();
  }finally{screen.unmount();}
 });
 it('keeps label targets unique across mounted instances',async()=>{
  const screen=await renderScreen(<><AppointmentModal {...props}/><AppointmentModal {...props}/></>);
  try {
   const controls=[...screen.container.querySelectorAll<HTMLElement>('fieldset input:not([type=search]),fieldset select,fieldset textarea')];
   const ids=controls.map(c=>c.id);expect(ids.every(Boolean)).toBe(true);expect(new Set(ids).size).toBe(ids.length);
  }finally{screen.unmount();}
 });
});
