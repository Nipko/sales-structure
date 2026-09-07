import { EmailTemplatesService } from './email-templates.service';

describe('deferred notification privacy fence',()=>{
    it('checks the active delivery lease after rendering and immediately before SMTP',async()=>{
        const sent=jest.fn(async()=>true);
        const service=new EmailTemplatesService({executeInTenantSchema:async()=>[]} as any,{send:sent} as any);
        jest.spyOn(service as any,'refreshManagedDefaults').mockResolvedValue(undefined);
        jest.spyOn(service as any,'getBySlug').mockResolvedValue({subject:'Hello {{name}}',bodyHtml:'<p>{{name}}</p>'});
        const beforeSend=jest.fn(async()=>{throw new Error('privacy fence expired');});
        await expect(service.renderAndSend('tenant_test','handoff_notification','synthetic@example.test',{name:'Synthetic'},'es',{beforeSend}))
            .rejects.toThrow('privacy fence expired');
        expect(beforeSend).toHaveBeenCalledTimes(1);expect(sent).not.toHaveBeenCalled();
        await service.renderAndSend('tenant_test','handoff_notification','synthetic@example.test',{name:'Synthetic'},'es',{beforeSend:async()=>{}});
        expect(sent).toHaveBeenCalledTimes(1);
    });
});
