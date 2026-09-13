import { PlatformSmsService } from './platform-sms.service';

describe('PlatformSmsService bounded transport',()=>{
    const originalFetch=global.fetch;
    afterEach(()=>{global.fetch=originalFetch;jest.restoreAllMocks();});

    function service(enabled=true){
        const values:Record<string,string|undefined>={SMS_ALERT_ACCOUNT_SID:'AC_TEST',
            SMS_ALERT_AUTH_TOKEN:'secret',SMS_ALERT_FROM:'+15550001111'};
        return new PlatformSmsService({get:jest.fn((key:string)=>values[key])} as any,
            {isEnabled:jest.fn().mockResolvedValue(enabled)} as any);
    }

    it('does not cross Twilio during preparation and returns its SID from the send closure',async()=>{
        const fetchMock=jest.fn().mockResolvedValue({ok:true,status:201,
            text:jest.fn().mockResolvedValue(JSON.stringify({sid:'SM_STRICT_1',status:'queued'}))});
        global.fetch=fetchMock as any;
        const send=await service().prepareBoundedSend('+573001112233','codigo');
        expect(fetchMock).not.toHaveBeenCalled();
        await expect(send()).resolves.toBe('SM_STRICT_1');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fails before a POST when the platform kill switch is off',async()=>{
        const fetchMock=jest.fn();global.fetch=fetchMock as any;
        await expect(service(false).prepareBoundedSend('+573001112233','codigo'))
            .rejects.toThrow('platform_sms_kill_switch_disabled');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
