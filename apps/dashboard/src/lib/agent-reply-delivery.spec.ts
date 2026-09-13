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

    it('keeps "nobody knows" separate from both, because the action differs', () => {
        // THE DEFECT. `reconciliation_required` — the row the API writes when
        // the provider gave NO answer — was an unrecognised value, and
        // unrecognised means accepted here. So the state that means "nobody
        // knows whether the customer has it" was shown as a delivered reply:
        // the opposite lie from the one this file exists to stop, and the
        // more expensive one, because nothing on screen says anything.
        //
        // The action is what separates the three. `failed`: send it again.
        // `pending`: nothing was attempted, send it again. This one: do NOT
        // send it again — on WhatsApp that is a second message the customer
        // may already have, and a second charge to the business's own WABA.
        const unknown = agentReplyDeliveryNotice('reconciliation_required');
        expect(unknown).toMatchObject({ state: 'unconfirmed', badgeKey: 'outcomeUnknown' });
        expect(unknown.state).not.toBe('sent');
        for (const other of ['failed', 'pending']) {
            const notice = agentReplyDeliveryNotice(other);
            expect(unknown.badgeKey).not.toBe(notice.badgeKey);
            expect(unknown.noticeKey).not.toBe(notice.noticeKey);
        }
    });

    it('tells the agent not to resend the one they must not resend', () => {
        // The sentence carries the instruction, not just the state: a badge
        // saying "unconfirmed" invites exactly the retype that costs money.
        const notice = agentReplyDeliveryNotice('reconciliation_required');
        expect(messages[notice.noticeKey!]).toMatch(/No la vuelvas a enviar/i);
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
        for (const status of ['failed', 'pending', 'reconciliation_required']) {
            const notice = agentReplyDeliveryNotice(status);
            expect(typeof messages[notice.badgeKey!]).toBe('string');
            // The one the agent reads has to say the customer does not have it,
            // not just that something went wrong.
            expect(messages[notice.noticeKey!].length).toBeGreaterThan(30);
        }
    });
});
