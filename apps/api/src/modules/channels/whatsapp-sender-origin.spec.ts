import { senderOriginProblem, whatsappSenderFrom } from './whatsapp-sender-origin';

/**
 * ═══ AN INSTAGRAM ID IS NOT A WHATSAPP NUMBER ═══
 *
 * `conversations.channel_account_id` holds whichever account the customer wrote
 * to. Three producers read that column and handed the value straight to
 * `sendTemplate` as `fromPhoneNumberId`, so an Instagram lead asked the WhatsApp
 * resolver for a connection called `IG_ACCOUNT`.
 *
 * The failure is not that the ids look different — they are two opaque strings
 * and nothing in the type system tells them apart. That is the whole reason the
 * channel has to travel WITH the account, and why this function takes both.
 */
describe('which origins may lend a WhatsApp sender', () => {
    const ACCOUNT = '15550001111';

    it('lends the connection of a WhatsApp conversation', () => {
        expect(whatsappSenderFrom({ channelType: 'whatsapp', channelAccountId: ACCOUNT })).toBe(ACCOUNT);
    });

    it.each(['instagram', 'messenger', 'telegram', 'web_widget', 'email', 'sms'])(
        'lends nothing from a %s conversation', channelType => {
            // The id is perfectly well-formed for its own channel, which is
            // exactly why this cannot be caught downstream.
            expect(whatsappSenderFrom({ channelType, channelAccountId: 'IG_ACCOUNT' })).toBeUndefined();
        });

    it('is not fooled by case or padding, in either field', () => {
        expect(whatsappSenderFrom({ channelType: ' WhatsApp ', channelAccountId: `  ${ACCOUNT} ` })).toBe(ACCOUNT);
        expect(whatsappSenderFrom({ channelType: 'whatsapp', channelAccountId: '   ' })).toBeUndefined();
    });

    it('lends nothing when the channel is unknown, rather than assuming WhatsApp', () => {
        // Absent is the case that used to be treated as WhatsApp by default,
        // because `source` was hardcoded to `whatsapp_inbound`.
        expect(whatsappSenderFrom({ channelAccountId: ACCOUNT })).toBeUndefined();
        expect(whatsappSenderFrom({ channelType: null, channelAccountId: ACCOUNT })).toBeUndefined();
        expect(whatsappSenderFrom(null)).toBeUndefined();
        expect(whatsappSenderFrom(undefined)).toBeUndefined();
    });

    describe('the reason, in words an operator can act on', () => {
        it('names nothing wrong when the origin is a usable WhatsApp conversation', () => {
            expect(senderOriginProblem({ channelType: 'whatsapp', channelAccountId: ACCOUNT })).toBeNull();
        });

        it('tells the three failures apart, because their fixes differ', () => {
            // "there is no origin" is a rule that has to name a connection;
            // "the origin is another channel" is a rule pointed at the wrong
            // conversation; "the origin has no account" is a conversation row
            // that never bound one. Collapsing them sends the wrong person
            // looking.
            expect(senderOriginProblem(null)).toBe('origin_missing');
            expect(senderOriginProblem({ channelAccountId: ACCOUNT })).toBe('origin_missing');
            expect(senderOriginProblem({ channelType: 'instagram', channelAccountId: 'IG' }))
                .toBe('origin_is_another_channel');
            expect(senderOriginProblem({ channelType: 'whatsapp', channelAccountId: '  ' }))
                .toBe('origin_has_no_account');
        });
    });
});
