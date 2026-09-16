import { renderScreen, scanScreen } from '@/test/a11y';
import { WhatsappFundingPanel } from './WhatsappFundingPanel';
import { PlanSpendOverview } from '@/app/admin/plans/_components/PlanSpendOverview';
jest.mock('@/lib/api',()=>({api:{
    getWhatsappFundingReadiness:async()=>({success:true,data:{numbers:[
        {channelAccountId:'12345',displayName:'Prueba',wabaId:'98765',state:'unknown'},
    ]}}),
    getAdminLlmSpend:async()=>({success:true,data:{month:'2026-09',tenants:[
        {tenantId:'t',name:'Prueba',plan:'starter',ceilingUsdCents:800,accountedUsdCents:0,unresolved:0,initialized:false},
    ]}}),
}}));
describe('funding and budget operator screens',()=>{
    it('names the external payment destination and does not equate unknown with missing card',async()=>{
        const screen=await renderScreen(<WhatsappFundingPanel canCheck={true}/>);
        expect(screen.container.textContent).toContain('No se pudo establecer');
        const link=screen.container.querySelector('a')!;
        expect(link.href).toBe('https://business.facebook.com/wa/manage/home/');
        expect(screen.container.querySelectorAll('input')).toHaveLength(0);
    });
    it('has accessible labels and does not advertise nonexistent measured zero cost',async()=>{
        expect(await scanScreen(<WhatsappFundingPanel canCheck={true}/>)).toEqual([]);
        expect(await scanScreen(<PlanSpendOverview/>)).toEqual([]);
        const screen=await renderScreen(<PlanSpendOverview/>);
        expect(screen.container.querySelector('tbody')!.textContent).toContain('—');
    });
});
