import { PlatformSmsService } from './platform-sms.service';

describe('PlatformSmsService after the SMS retirement (ADR 0020)',()=>{
    const originalFetch=global.fetch;
    afterEach(()=>{global.fetch=originalFetch;});

    it('fails in preparation and never reaches a provider',async()=>{
        const fetchMock=jest.fn();global.fetch=fetchMock as any;
        const sms=new PlatformSmsService();
        expect(sms.enabled).toBe(false);
        await expect(sms.prepareBoundedSend('+573001112233','codigo')).rejects.toThrow('platform_sms_retired');
        await expect(sms.sendTo('+573001112233','codigo')).resolves.toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
