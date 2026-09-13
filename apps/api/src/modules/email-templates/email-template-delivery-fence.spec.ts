import { EmailTemplatesService } from './email-templates.service';

describe('deferred notification privacy fence',()=>{
    it('checks the active delivery lease after rendering and immediately before SMTP',async()=>{
        const sent=jest.fn(async()=>'smtp-message-id');
        const prepare=jest.fn(()=>sent);
        const service=new EmailTemplatesService({executeInTenantSchema:async()=>[]} as any,
            {send:sent,prepareBoundedSend:prepare} as any);
        jest.spyOn(service as any,'refreshManagedDefaults').mockResolvedValue(undefined);
        jest.spyOn(service as any,'getBySlug').mockResolvedValue({subject:'Hello {{name}}',bodyHtml:'<p>{{name}}</p>'});
        const beforeSend=jest.fn(async()=>{throw new Error('privacy fence expired');});
        await expect(service.renderAndSend('tenant_test','handoff_notification','synthetic@example.test',{name:'Synthetic'},'es',{beforeSend}))
            .rejects.toThrow('privacy fence expired');
        // Rendering and the transport handshake happen first; the fence is the
        // last thing between a prepared message and the wire.
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(beforeSend).toHaveBeenCalledTimes(1);expect(sent).not.toHaveBeenCalled();
        await service.renderAndSend('tenant_test','handoff_notification','synthetic@example.test',{name:'Synthetic'},'es',{beforeSend:async()=>{}});
        expect(sent).toHaveBeenCalledTimes(1);
    });
});
