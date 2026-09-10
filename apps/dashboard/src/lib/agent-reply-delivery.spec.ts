import { agentReplyDeliveryNotice } from './agent-reply-delivery';
import es from '../../messages/es.json';

const messages = es.inbox;

/**
 * The rule that decides whether an agent is told their reply did not leave.
 *
 * Kept out of the page so it can be stated rather than inferred from a render:
 * the failure it exists for is silent by nature, and a silent failure needs a
 * test that fails loudly.
 */
describe('what the console says about a reply that was saved', () => {
    it('says nothing when the provider accepted it', () => {
        expect(agentReplyDeliveryNotice('sent')).toEqual({ state: 'sent', badgeKey: null, noticeKey: null });
    });

    it('tells the agent when the channel refused it', () => {
        expect(agentReplyDeliveryNotice('failed')).toMatchObject({ state: 'failed', badgeKey: 'notDelivered' });
    });

    it('keeps "nothing was attempted" separate from "the channel refused"', () => {
        // Not a milder failure: no send happened at all, so there is nothing to
        // have gone wrong at the provider and nothing to check there either.
        const pending = agentReplyDeliveryNotice('pending');
        expect(pending).toMatchObject({ state: 'pending', badgeKey: 'notConfirmed' });
        expect(pending.noticeKey).not.toBe(agentReplyDeliveryNotice('failed').noticeKey);
    });

    it('does not warn on a value it does not recognise', () => {
        // An older API sends no status. A console that warned on everything
        // unknown would teach agents to ignore the warning, which costs more
        // than it saves.
        for (const value of [undefined, null, '', 'delivered', 'read', 42]) {
            expect(agentReplyDeliveryNotice(value)).toMatchObject({ state: 'sent', badgeKey: null });
        }
    });

    it('has a real sentence behind every key it returns', () => {
        for (const status of ['failed', 'pending']) {
            const notice = agentReplyDeliveryNotice(status);
            expect(typeof messages[notice.badgeKey!]).toBe('string');
            // The one the agent reads has to say the customer does not have it,
            // not just that something went wrong.
            expect(messages[notice.noticeKey!].length).toBeGreaterThan(30);
        }
    });
});
