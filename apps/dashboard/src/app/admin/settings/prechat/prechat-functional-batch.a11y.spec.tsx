// PREPARED ONLY. Intended target: settings/prechat/prechat-functional-batch.a11y.spec.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import * as fs from "fs";
import * as path from "path";
import PrechatPage from "./page";

jest.mock("@/lib/api", () => ({ api: { fetch: jest.fn() } }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }) }));
jest.mock("@/hooks/useRole", () => ({ useRole: () => ({ role: "tenant_admin" }) }));
const { api } = jest.requireMock("@/lib/api") as { api: { fetch: jest.Mock } };
const ENDPOINT="/conversations/prechat-form/11111111-1111-4111-8111-111111111111";
const CONFIG={id:"synthetic-disabled-form",name:"default",is_active:false,greeting_message:"QA local: saludo conservado",fields:[
    {key:"email",label:"QA Correo",type:"email",required:true,options:[],map_to:"contact.email"},
    {key:"trip",label:"QA Viaje",type:"select",required:false,options:["Norte","Sur"],map_to:"metadata.trip"},
]};
const clone=()=>JSON.parse(JSON.stringify(CONFIG));

describe.each(["es","en","pt","fr"])("prechat inactive admin configuration real page in %s",locale=>{
    beforeEach(()=>{api.fetch.mockReset();jest.useFakeTimers();});
    afterEach(()=>{jest.clearAllTimers();jest.useRealTimers();});
    async function mounted(check:(container:HTMLDivElement,m:any,payloads:any[])=>Promise<void>){
        const m=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../../../../messages",locale+".json"),"utf8"));
        for(const key of ["preview","formDisabled","labelPlaceholder","saved","exampleEmail"]){
            expect(typeof m.prechatPage[key]).toBe("string");expect(m.prechatPage[key].trim().length).toBeGreaterThan(0);
        }
        expect(typeof m.common.saveChanges).toBe("string");
        const payloads:any[]=[];
        api.fetch.mockImplementation(async(endpoint:string,options?:RequestInit)=>{
            if(endpoint!==ENDPOINT)throw new Error("Unexpected prechat endpoint");
            if(!options?.method){expect(options).toBeUndefined();return {success:true,data:clone()};}
            expect(options.method).toBe("POST");
            expect(options.headers).toEqual({"Content-Type":"application/json"});
            const payload=JSON.parse(String(options.body));payloads.push(payload);
            return {success:true,data:{id:CONFIG.id,name:"default",...payload}};
        });
        const container=document.createElement("div");document.body.appendChild(container);const root=createRoot(container);
        try{
            await act(async()=>{root.render(<NextIntlClientProvider locale={locale} messages={m} timeZone="America/Bogota"><PrechatPage/></NextIntlClientProvider>);});
            await act(async()=>{await Promise.resolve();});
            expect(api.fetch).toHaveBeenCalledTimes(1);expect(api.fetch.mock.calls[0]).toEqual([ENDPOINT]);
            await check(container,m,payloads);
        }finally{act(()=>root.unmount());container.remove();}
    }
    it("control: inactive saved fields hydrate and preview required flags without becoming an empty form",async()=>{
        await mounted(async(container,m,payloads)=>{
            expect(container.querySelector("textarea")?.value).toBe(CONFIG.greeting_message);
            const labels=Array.from(container.querySelectorAll<HTMLInputElement>("input")).filter(input=>input.placeholder===m.prechatPage.labelPlaceholder);
            expect(labels.map(input=>input.value)).toEqual(CONFIG.fields.map(field=>field.label));
            expect(Array.from(container.querySelectorAll("select")).map(select=>select.value)).toEqual(["email","contact.email","select","metadata"]);
            expect(Array.from(container.querySelectorAll<HTMLInputElement>("input")).some(input=>input.value==="Norte, Sur")).toBe(true);
            const title=Array.from(container.querySelectorAll("span")).find(node=>node.textContent?.trim()===m.prechatPage.preview);
            expect(title).toBeDefined();const preview=title!.parentElement!.parentElement!;
            expect(preview.textContent).toContain(CONFIG.greeting_message);expect(preview.textContent).toContain(m.prechatPage.formDisabled);
            const prompts=CONFIG.fields.map(field=>Array.from(preview.querySelectorAll("p")).find(node=>node.textContent?.replace(/\*/g,"").trim()===field.label));
            expect(prompts.every(Boolean)).toBe(true);
            expect(prompts.map(node=>Boolean(node!.querySelector("span")?.textContent?.includes("*")))).toEqual([true,false]);
            expect(preview.textContent).toContain("1. Norte");expect(preview.textContent).toContain("2. Sur");
            expect(payloads).toEqual([]);expect(api.fetch).toHaveBeenCalledTimes(1);
        });
    });
    it("control: explicit admin save preserves inactive state and the complete field payload once",async()=>{
        await mounted(async(container,m,payloads)=>{
            const save=Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(button=>button.textContent?.trim()===m.common.saveChanges);
            expect(save).toHaveLength(1);
            await act(async()=>{save[0].click();});await act(async()=>{await Promise.resolve();});
            expect(payloads).toEqual([{is_active:false,greeting_message:CONFIG.greeting_message,fields:CONFIG.fields}]);
            expect(api.fetch).toHaveBeenCalledTimes(2);
            expect(container.textContent).toContain(m.prechatPage.saved);
            expect(container.querySelector("textarea")?.value).toBe(CONFIG.greeting_message);
        });
    });
});
