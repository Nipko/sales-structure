import { SlackListenerService } from '../slack/slack-listener.service';
import { PushListenerService } from '../push/push-listener.service';
import { SlackService } from '../slack/slack.service';

const event:any={tenantId:'11111111-1111-4111-8111-111111111111',conversationId:'22222222-2222-4222-8222-222222222222',
    contactName:'Ana',reason:'customer_request',assignedTo:'33333333-3333-4333-8333-333333333333'};

describe('handoff destination listeners preserve provider outcomes',()=>{
    it('offers strict transport methods without changing best-effort callers',async()=>{
        const slack=new SlackService({} as any,{} as any);
        jest.spyOn(slack,'getConfig').mockResolvedValue({enabled:true,webhookUrl:'https://hooks.slack.com/services/a/b/c',events:{handoff:true,appointment:true}});
        jest.spyOn(slack as any,'post').mockRejectedValue(new Error('slack_refused'));
        await expect(slack.notifyStrict(event.tenantId,'handoff','hola')).rejects.toThrow('slack_refused');
        await expect(slack.notify(event.tenantId,'handoff','hola')).resolves.toBeUndefined();
    });

    it('does not let Slack turn a rejected POST into an accepted handoff effect',async()=>{
        const failure=new Error('slack_unreachable');
        const listener=new SlackListenerService({notifyStrict:jest.fn().mockRejectedValue(failure)} as any);
        await expect(listener.onHandoff(event)).rejects.toBe(failure);
    });

    it('does not swallow a rejected push batch on the handoff road',async()=>{
        const push={sendToUser:jest.fn().mockRejectedValue(new Error('push_unreachable'))};
        const prisma={tenant:{findUnique:jest.fn().mockResolvedValue({language:'es'})}};
        const listener=new PushListenerService(push as any,prisma as any);
        await expect(listener.onHandoff(event)).rejects.toThrow('push_unreachable');
    });
});
