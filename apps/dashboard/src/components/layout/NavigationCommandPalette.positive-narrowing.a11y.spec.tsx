/** @jest-environment node */
/**
 * PREPARED ONLY: four locale cases for positive palette narrowing after keyboard
 * selection. Real palette/NextIntl/useRole/preferences/registry/access/label path.
 * No full shell, route activation, quick create, favorites, recents write or API.
 */
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';

const mockUnexpected: string[] = [];
const mockStorageWrites: string[] = [];
const mockPush = jest.fn((href: string) => { mockUnexpected.push('router.push:' + href); });
const mockCurrentPath = '/admin/agent/44444444-4444-4444-8444-444444444444/test';
const mockSearchParams = new URLSearchParams();
const mockLabels = {
    es: 'Personas Cobre QA', en: 'Copper people QA',
    pt: 'Pessoas Cobre QA', fr: 'Personnes cuivre QA',
};
const mockUser = {
    id: '33333333-3333-4333-8333-333333333333',
    role: 'tenant_admin', tenantId: '11111111-1111-4111-8111-111111111111',
};
const mockVerticalConfig = {
    industry: 'technology', manifestVersion: 2,
    effectiveCapabilities: ['crm_pipeline','faq_search','appointment_booking'],
    sidebar: { labelOverrides: { crm: mockLabels } },
};
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({user:mockUser,verticalConfig:mockVerticalConfig}) }), {virtual:true});
jest.mock('next/navigation', () => ({
    usePathname:()=>mockCurrentPath, useSearchParams:()=>mockSearchParams, useParams:()=>({}),
    useRouter:()=>({push:mockPush,replace:(..._args:unknown[])=>{mockUnexpected.push('router.replace');}}),
}));
jest.mock('@/lib/api', () => ({api:new Proxy({}, {get(_target,key) {
    mockUnexpected.push('api.'+String(key)); throw new Error('No local API call is allowed');
}})}), {virtual:true});

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {url:'https://palette-local.test'+mockCurrentPath});
dom.window.Element.prototype.scrollIntoView = () => {};
dom.window.matchMedia = ((query:string)=>({matches:false,media:query,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent:()=>false})) as any;
const originalSetItem = dom.window.Storage.prototype.setItem;
dom.window.Storage.prototype.setItem = function(key:string,_value:string) {
    mockStorageWrites.push(key); mockUnexpected.push('localDOM.storage.setItem');
    throw new Error('Unexpected preference write in read-only palette criterion');
};
const previous = new Map<string,PropertyDescriptor|undefined>();
for (const [key,value] of Object.entries({
    window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
    HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,
    HTMLButtonElement:dom.window.HTMLButtonElement,Element:dom.window.Element,
    DocumentFragment:dom.window.DocumentFragment,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,
    Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,MutationObserver:dom.window.MutationObserver,
    getComputedStyle:dom.window.getComputedStyle.bind(dom.window),
    localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT:true,
    fetch:async()=>{mockUnexpected.push('fetch');throw new Error('No network');},
    WebSocket:class {constructor(){mockUnexpected.push('WebSocket');throw new Error('No socket');}},
})) {
    previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
}
const {createRoot} = require('react-dom/client') as typeof import('react-dom/client');
const {NextIntlClientProvider} = require('next-intl') as typeof import('next-intl');
const {default:NavigationCommandPalette} = require('./NavigationCommandPalette') as {default:ComponentType};
const {getNavigationRoute,resolveNavigationRoute} = require('../../lib/navigation-contract') as typeof import('../../lib/navigation-contract');
const {canAccessDashboardNavigationPath} = require('../../lib/navigation-access') as typeof import('../../lib/navigation-access');
afterAll(()=>{
    dom.window.Storage.prototype.setItem=originalSetItem;dom.window.close();
    for(const [key,descriptor] of previous) {
        if(descriptor)Object.defineProperty(globalThis,key,descriptor);
        else delete (globalThis as Record<string,unknown>)[key];
    }
});
type Locale = keyof typeof mockLabels;
const LOCALES:Locale[]=['es','en','pt','fr'];
const DASHBOARD=path.resolve(__dirname,'../../..');
const TARGET='/admin/contacts';
const TARGET_ID='navigation-command-route:contacts';
function snapshot() {
    const dialog=document.querySelector<HTMLElement>('[role="dialog"]');
    const input=dialog?.querySelector<HTMLInputElement>('[role="combobox"]');
    const options=Array.from(dialog?.querySelectorAll<HTMLElement>('[role="option"]')??[]);
    return {
        dialog_open:Boolean(dialog),query:input?.value??null,
        active_descendant:input?.getAttribute('aria-activedescendant')??null,
        selected_ids:options.filter(node=>node.getAttribute('aria-selected')==='true').map(node=>node.id),
        options:options.map(node=>({id:node.id,text:node.textContent||''})),
        active_element_id:(document.activeElement as HTMLElement|null)?.id??null,
    };
}
async function flush() {
    await act(async()=>{await Promise.resolve();});
}
async function key(target:Element,keyValue:string,extra:KeyboardEventInit={}) {
    await act(async()=>{target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:keyValue,bubbles:true,cancelable:true,...extra}));});
    await flush();
}
describe.each(LOCALES)('real command palette positive narrowing and keyboard state (%s)',locale=>{
    it('keeps a selected reachable destination when keyboard-selected results narrow, then wraps and returns focus without navigation',async()=>{
        mockUnexpected.length=0;mockStorageWrites.length=0;mockPush.mockClear();
        // Empty own JSDOM storage; no auth keys/recents/favorites are seeded.
        dom.window.localStorage.clear();dom.window.sessionStorage.clear();
        const messages=JSON.parse(fs.readFileSync(path.join(DASHBOARD,'messages',locale+'.json'),'utf8'));
        for(const value of [messages.navigation.command.open,messages.navigation.command.placeholder,messages.navigation.command.title,messages.nav.items.crm])
            if(typeof value!=='string'||!value.trim())throw new Error('Translation prerequisite missing');
        const route=getNavigationRoute('contacts');
        const current=resolveNavigationRoute(mockCurrentPath);
        if(route?.pattern!==TARGET||route.titleKey!=='nav.items.crm'||route.discoverable===false)
            throw new Error('Positive existing destination prerequisite changed');
        if(!current?.definition.pattern.includes(':'))throw new Error('Current path must skip real recents writer');
        if(!fs.existsSync(path.join(DASHBOARD,'src/app/admin/contacts/page.tsx'))
            ||!fs.existsSync(path.join(DASHBOARD,'src/app/admin/agent/[agentId]/test/page.tsx')))
            throw new Error('Fixture destination/current-route source page missing');
        if(!canAccessDashboardNavigationPath(TARGET,'tenant_admin',false,mockVerticalConfig))
            throw new Error('Positive destination not eligible for this synthetic actor/config');
        const container=document.createElement('div');document.body.appendChild(container);
        const root=createRoot(container);
        const observations:any={locale,fixture_geometry:null,initial:null,after_arrows:null,narrowed:null,wrapped:null,closed:null};
        let trigger:HTMLButtonElement|null=null;
        let primary:unknown;let failed=false;
        try {
            await act(async()=>{
                root.render(
                    <NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota">
                        {createElement('main',{id:'main-content',tabIndex:-1},
                        createElement('button',{
                            id:'local-palette-trigger',type:'button',
                            ref:(element:HTMLButtonElement|null)=>{trigger=element;},
                        },messages.navigation.command.open),
                        createElement(NavigationCommandPalette))}
                    </NextIntlClientProvider>,
                );
            });
            if(!trigger)throw new Error('Local initiating button missing');
            const opener=trigger as HTMLButtonElement;
            // Browser geometry boundary ONLY on this fixture button. Product
            // palette/results/hidden elements retain normal JSDOM geometry.
            const rect: DOMRect={x:20,y:20,width:160,height:32,top:20,right:180,bottom:52,left:20,
                toJSON:()=>({x:20,y:20,width:160,height:32,top:20,right:180,bottom:52,left:20})};
            Object.defineProperty(opener,'getClientRects',{configurable:true,value:()=>({
                0:rect,length:1,item:(index:number)=>index===0?rect:null,
                [Symbol.iterator]:function*(){yield rect;},
            } as DOMRectList)});
            observations.fixture_geometry={only:'local-palette-trigger',count:opener.getClientRects().length,width:rect.width,height:rect.height,
                synthetic_geometry:true,paint_certified:false};
            if(opener.getClientRects().length!==1||rect.width<=0||rect.height<=0)
                throw new Error('Fixture geometry prerequisite invalid');
            opener.focus();
            await key(opener,'k',{ctrlKey:true});
            const input=document.querySelector<HTMLInputElement>('[role="dialog"] [role="combobox"]');
            if(!input||document.activeElement!==input)throw new Error('Palette/input focus prerequisite unavailable');
            observations.initial=snapshot();
            if(observations.initial.options.length<3)throw new Error('Positive initial destination set needs at least3 entries');
            await key(input,'ArrowDown');await key(input,'ArrowDown');
            observations.after_arrows=snapshot();
            await act(async()=>{
                Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,mockLabels[locale]);
                input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
            });await flush();
            observations.narrowed=snapshot();
            await key(input,'ArrowDown');
            observations.wrapped=snapshot();
            await key(input,'Escape');
            // Real Radix focus-scope close-autofocus runs on its documented
            // setTimeout0 cleanup. Two turns drain it; no focus implementation stub.
            await act(async()=>{await new Promise<void>(resolve=>setTimeout(resolve,0));});
            await act(async()=>{await new Promise<void>(resolve=>setTimeout(resolve,0));});
            observations.closed=snapshot();
            // All states captured before primary functional oracles.
            expect(observations.after_arrows.active_descendant).toBe(observations.initial.options[2].id);
            expect(observations.narrowed.options).toHaveLength(1);
            expect(observations.narrowed.options[0]).toEqual({id:TARGET_ID,text:expect.stringContaining(mockLabels[locale])});
            expect(observations.narrowed.options[0].text).toContain(TARGET);
            expect(observations.narrowed.active_descendant).toBe(TARGET_ID);
            expect(observations.narrowed.selected_ids).toEqual([TARGET_ID]);
            expect(observations.wrapped.active_descendant).toBe(TARGET_ID);
            expect(observations.wrapped.selected_ids).toEqual([TARGET_ID]);
            expect(observations.closed.dialog_open).toBe(false);
            expect(document.activeElement).toBe(opener);
            expect(mockPush).not.toHaveBeenCalled();
            expect(mockStorageWrites).toEqual([]);expect(mockUnexpected).toEqual([]);
        } catch(error){failed=true;primary=error;}
        finally {
            console.info('NAV_SEARCH_LOCAL_OBSERVATION '+JSON.stringify({...observations,router_calls:mockPush.mock.calls,
                storage_writes:mockStorageWrites.slice(),unexpected_ports:mockUnexpected.slice(),
                limit:'Local component+synthetic fixture geometry; no route activated, paint/AT/production or business effects certified'}));
            try {await act(async()=>{root.unmount();});}
            catch(error){if(!failed){failed=true;primary=error;}}
            container.remove();
        }
        if(failed)throw primary;
    });
});
