import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import * as fs from 'node:fs';
import * as path from 'node:path';
import axe from 'axe-core';
import DateRangePicker from './DateRangePicker';

it.each(['es','en','pt','fr'])('names both custom date controls distinctly (%s)', async locale => {
 const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../messages',locale+'.json'),'utf8'));
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try {
  await React.act(async()=>root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC"><DateRangePicker start="2026-10-01" end="2026-10-08" onChange={()=>{}} /></NextIntlClientProvider>));
  const custom=[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===messages.analyticsV2.custom)!;
  await React.act(async()=>custom.click());
  expect(host.querySelectorAll('input[type=date]').length).toBe(2);
  const result=await axe.run(host,{runOnly:{type:'rule',values:['label']}});
  expect(result.violations.map(v=>v.id)).toEqual([]);
  const names=[...host.querySelectorAll('input[type=date]')].map(e=>e.getAttribute('aria-label'));
  expect(names).toEqual([messages.analyticsV2.rangeStart,messages.analyticsV2.rangeEnd]);
  expect(names.every(n=>!!n)).toBe(true);expect(new Set(names).size).toBe(2);
 } finally {React.act(()=>root.unmount());host.remove();}
});
