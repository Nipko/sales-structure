import fs from 'fs';
import path from 'path';
import type { ComponentProps } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderScreen, findAccessibilityViolations } from '@/test/a11y';
import ServiceModal from './ServiceModal';

const props: ComponentProps<typeof ServiceModal> = {
 form:{name:'QA service',duration:30,durationMax:60,durationType:'flexible',buffer:0,price:100,priceStatus:'confirmed',color:'#6c5ce7',category:'QA',maxConcurrent:1,rebookAfterDays:null,requiredFields:[],locationType:'hybrid',locationAddress:'QA street',meetingLink:'https://example.invalid/meeting',paymentPolicy:'none',depositPercent:null,depositAmount:null},
 onChange:jest.fn(),editingService:null,saving:false,onSave:jest.fn(),onClose:jest.fn(),currency:'COP',
};
const selector='input:not([type=radio]):not([type=checkbox]),select,textarea';
describe('Service editor accessible field names',()=>{
 it.each(['es','en','pt','fr'])('associates all visible fields with translated labels in %s',async(locale)=>{
  const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../messages',locale+'.json'),'utf-8'));
  const screen=await renderScreen(<NextIntlClientProvider locale={locale} messages={messages}><ServiceModal {...props}/></NextIntlClientProvider>);
  try {
   const controls=[...screen.container.querySelectorAll<HTMLInputElement|HTMLSelectElement>(selector)];
   expect(controls).toHaveLength(11);
   for(const control of controls){expect(control.labels?.length).toBeGreaterThan(0);expect(control.labels?.[0].textContent?.trim()).toBeTruthy();}
   expect(controls[0].labels?.[0].textContent).toContain(messages.appointments.serviceName);
   expect(await findAccessibilityViolations(screen.container)).toEqual([]);
   expect(props.onSave).not.toHaveBeenCalled();
  }finally{screen.unmount();}
 });
 it('keeps field targets unique when two editors are mounted',async()=>{
  const screen=await renderScreen(<><ServiceModal {...props}/><ServiceModal {...props}/></>);
  try {const ids=[...screen.container.querySelectorAll<HTMLElement>(selector)].map(x=>x.id);expect(ids.every(Boolean)).toBe(true);expect(new Set(ids).size).toBe(ids.length);}finally{screen.unmount();}
 });
 it('names every color choice and exposes the selected color',async()=>{
  const screen=await renderScreen(<ServiceModal {...props}/>);
  try {
   const swatches=[...screen.container.querySelectorAll<HTMLButtonElement>('button[style]')];expect(swatches.length).toBeGreaterThan(3);
   for(const b of swatches){expect(b.getAttribute('aria-label')).toBeTruthy();expect(b.hasAttribute('aria-pressed')).toBe(true);}
   expect(swatches.filter(b=>b.getAttribute('aria-pressed')==='true')).toHaveLength(1);
   expect(swatches.find(b=>b.getAttribute('aria-pressed')==='true')?.getAttribute('aria-label')).toContain('#6c5ce7');
  }finally{screen.unmount();}
 });
});
