import { interact,renderScreen,findAccessibilityViolations } from '@/test/a11y';
import InventoryPage from './page';
import { api } from '@/lib/api';

jest.mock('@/contexts/TenantContext',()=>({useTenant:()=>({activeTenantId:'tenant-qa'})}));
jest.mock('@/hooks/useOperatingCurrency',()=>({useOperatingCurrency:()=> 'COP'}));
jest.mock('@/components/ui/help-panel',()=>({HelpPanel:()=>null}));
jest.mock('@/components/ui/page-header',()=>({PageHeader:({action}:any)=><header>{action}</header>}));
jest.mock('@/hooks/useApiData',()=>({DataSourceBadge:()=>null}));
jest.mock('@/lib/api',()=>({api:{getInventoryOverview:jest.fn(),createInventoryProduct:jest.fn()}}));

beforeEach(()=>{
    jest.clearAllMocks();
    (api.getInventoryOverview as jest.Mock).mockResolvedValue({success:true,data:{totalProducts:0,
        activeProducts:0,totalValue:0,lowStockAlerts:0,outOfStockCount:0,categories:[],products:[],recentMovements:[]}});
});

async function openAndFill(){
    const screen=await renderScreen(<InventoryPage/>);
    const create=()=>[...screen.container.querySelectorAll('button')].find(e=>e.textContent?.trim()==='Crear')!;
    await interact(()=>{const trigger=create();trigger.focus();trigger.click();});
    const inputs=[...screen.container.querySelectorAll('input')];
    const name=inputs.find(e=>e.placeholder==='Tour Rafting Río Fonce')!;
    const sku=inputs.find(e=>e.placeholder==='TOUR-RAFT-001')!;
    const price=inputs.find(e=>e.placeholder==='120000')!;
    await interact(()=>{
        for(const [input,value] of [[name,'QA invalid'],[sku,'QA-NEG'],[price,'-1']] as const){
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
            input.dispatchEvent(new Event('input',{bubbles:true}));
        }
    });
    const save=()=>[...screen.container.querySelectorAll('button')].filter(e=>e.textContent?.trim()==='Crear').at(-1)!;
    return {screen,save,name,sku,price};
}

it.each([
    [{success:false,httpStatus:409,error:'catalog_price_invalid'},false],
    [{success:false,error:'Error de conexión'},true],
    [{success:false,httpStatus:500,error:'Internal error'},true],
] as const)('preserves the form for %j and disables retry when uncertain=%s',async(result,uncertain)=>{
    (api.createInventoryProduct as jest.Mock).mockResolvedValue(result);
    const {screen,save,name,sku,price}=await openAndFill();
    try{
        await interact(()=>save().click());
        expect(api.createInventoryProduct).toHaveBeenCalledTimes(1);
        expect(api.createInventoryProduct).toHaveBeenCalledWith('tenant-qa',expect.objectContaining({sku:'QA-NEG',price:-1}));
        expect(screen.container.contains(sku)).toBe(true);
        expect([name.value,sku.value,price.value]).toEqual(['QA invalid','QA-NEG','-1']);
        expect(screen.container.querySelector('[role="alert"]')?.textContent?.trim()).toBeTruthy();
        expect(save().disabled).toBe(uncertain);
        if(uncertain){
            await interact(()=>save().click());
            expect(api.createInventoryProduct).toHaveBeenCalledTimes(1);
        }
    }finally{screen.unmount();}
});

it('keeps the form and prevents another submission if the transport throws',async()=>{
    (api.createInventoryProduct as jest.Mock).mockRejectedValue(new Error('connection interrupted'));
    const {screen,save,sku}=await openAndFill();
    try{
        await interact(()=>save().click());
        expect(screen.container.contains(sku)).toBe(true);
        expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain('confirmar');
        expect(save().disabled).toBe(true);
        await interact(()=>save().click());
        expect(api.createInventoryProduct).toHaveBeenCalledTimes(1);
    }finally{screen.unmount();}
});

it('gives the actual create form machine-checkable accessible control names',async()=>{
    const {screen}=await openAndFill();
    try{
        const title=[...screen.container.querySelectorAll('h2')].find(h=>h.textContent==='Nuevo producto')!;
        const modal=title.parentElement!.parentElement!;
        expect(await findAccessibilityViolations(modal)).toEqual([]);
        for(const input of modal.querySelectorAll('input:not([type="checkbox"]),select')){
            expect((input as HTMLInputElement|HTMLSelectElement).labels?.length).toBeGreaterThan(0);
        }
    }finally{screen.unmount();}
});

it('contains keyboard focus, closes with Escape and returns focus to its trigger',async()=>{
    const {screen,save}=await openAndFill();
    try{
        const dialog=screen.container.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
        expect(dialog).not.toBeNull();
        const title=document.getElementById(dialog.getAttribute('aria-labelledby')!);
        expect(title?.textContent).toBe('Nuevo producto');
        const first=dialog.querySelector('button')!;
        const last=save();
        await interact(()=>{last.focus();last.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));});
        expect(document.activeElement).toBe(first);
        await interact(()=>first.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));
        expect(document.activeElement).toBe(last);
        await interact(()=>dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
        expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement?.textContent?.trim()).toBe('Crear');
        expect(api.createInventoryProduct).not.toHaveBeenCalled();
    }finally{screen.unmount();}
});
