import { WhatsappConnectionService } from './whatsapp-connection.service';
describe('WhatsApp funding verification',()=>{
    const originalFetch=global.fetch;
    afterEach(()=>{global.fetch=originalFetch;});
    function harness(body:any, status=200) {
        const prisma:any={$executeRawUnsafe:jest.fn().mockResolvedValue(1)};
        const service=new WhatsappConnectionService(prisma,{} as any,{} as any,{} as any);
        const resolve=jest.spyOn(service as any,'resolveConnection').mockResolvedValue({tenantId:'tenant',phoneNumberId:'123456',wabaId:'987654',accessToken:'synthetic-secret'});
        global.fetch=jest.fn().mockResolvedValue({ok:status===200,status,json:async()=>body});
        return {service,prisma,resolve};
    }
    it('asks the selected WABA and stores no token or funding identifier',async()=>{
        const h=harness({id:'987654',primary_funding_id:'funding-secret'});
        expect(await h.service.checkFunding('tenant_schema','123456')).toMatchObject({state:'attached',wabaId:'987654'});
        expect(h.resolve).toHaveBeenCalledWith('tenant_schema','123456');
        expect(global.fetch).toHaveBeenCalledWith('https://graph.facebook.com/v21.0/987654?fields=id,primary_funding_id',expect.objectContaining({headers:{Authorization:'Bearer synthetic-secret'}}));
        const stored=JSON.stringify(h.prisma.$executeRawUnsafe.mock.calls);
        expect(stored).not.toContain('synthetic-secret');expect(stored).not.toContain('funding-secret');
    });
    it.each([{id:'wrong',primary_funding_id:'f'},{id:'987654'},{id:'987654',error:{code:10,message:'sensitive'}}])(
        'does not certify incomplete, wrong-resource or denied evidence: %p',async body=>{
            const h=harness(body);expect(await h.service.checkFunding('tenant_schema','123456')).toMatchObject({state:'unknown'});
        });
    it('rejects a connection changed while Meta was being read',async()=>{
        const h=harness({id:'987654',primary_funding_id:null});h.prisma.$executeRawUnsafe.mockResolvedValue(0);
        await expect(h.service.checkFunding('tenant_schema','123456')).rejects.toThrow('funding_connection_changed');
    });
});
