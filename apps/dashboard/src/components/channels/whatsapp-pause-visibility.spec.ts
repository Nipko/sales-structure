import * as fs from 'fs';
import * as path from 'path';

/**
 * ═══ THE PAUSE THAT NOBODY COULD SEE ═══
 *
 * From 1 October 2026 Meta bills the business's own WhatsApp account per
 * delivered message, and refuses to deliver for an account it cannot bill. The
 * engine handles that correctly: error 131042 pauses the number's billable
 * producers, and `GET /whatsapp/spend/pauses` reports which numbers are paused,
 * why, and — separately — which ones we could not read the state of at all.
 *
 * The panel had the markup for all of it. It just never received the fact.
 *
 * It filtered `readiness.filter(number => number.paused)`, and `readiness` came
 * from `GET /channels/whatsapp/connection/billing-readiness` — an endpoint about the
 * billing TIME ZONE, whose payload has no `paused` field and never had one. So
 * the filter was permanently empty: the explanation never rendered, the resume
 * button never rendered, and the endpoint that actually knows was not called by
 * the dashboard at all.
 *
 * The panel's own suite was green throughout, because its fixture built a
 * readiness row with `paused: true` by hand. Both sides of the seam agreed with
 * each other and disagreed with production — so the assertions below are about
 * the SEAM rather than about the component, and they read the shipped source
 * instead of a fixture that can be made to say anything.
 *
 * What a tenant saw in the meantime: a green "Conectado" pill, an agent that
 * had stopped answering, and nothing on the screen connecting the two.
 */

const read = (...segments: string[]): string =>
    // `core.autocrlf` is on, so the working tree is CRLF and the blob is LF.
    // Normalised here because every assertion below is about a substring that
    // would otherwise depend on which of the two this machine wrote.
    fs.readFileSync(path.join(__dirname, ...segments), 'utf8').replace(/\r\n/g, '\n');

const PAGE = read('..', '..', 'app', 'admin', 'channels', 'whatsapp', 'page.tsx');
const PANEL = read('WhatsappSpendPanel.tsx');

describe('a number Meta refuses to bill', () => {
    it('is read from the endpoint that knows it is paused', () => {
        // `/whatsapp/spend/pauses` is the only source of this fact. Asserting
        // the call rather than a rendered string because the failure this
        // guards against was invisible at every other layer: the component
        // rendered correctly for input it was never given.
        //
        // Matched as a whole quoted path so that the POST to
        // `.../pauses/${id}/resume` — which the page already had, and which
        // writes rather than reads — cannot satisfy it. Being able to lift a
        // pause is not the same as being able to see one.
        expect(PAGE).toMatch(/"\/whatsapp\/spend\/pauses"/);
    });

    it('does not take its pause state from the billing time-zone reading', () => {
        // `billingZoneReadiness` answers "can this number price anything" — the
        // zone and the currency. It returns no `paused` and must never be asked
        // for one: a screen that infers an outage from an endpoint about time
        // zones is a screen that will be wrong the next time either changes.
        const readinessBlock = PANEL.match(/interface WhatsappReadinessNumber \{[\s\S]*?\n\}/)?.[0] ?? '';
        // Guards the guard: a typo in the interface name would leave this
        // asserting against an empty string and passing for ever.
        expect(readinessBlock).toContain('channelAccountId');
        // A property DECLARATION, not the word. The block's own comment explains
        // at length why there is no `paused` here, and matching prose would make
        // the explanation the thing that fails.
        expect(readinessBlock).not.toMatch(/^\s*paused\??\s*:/m);
    });

    it('distinguishes a pause from a pause state nobody could read', () => {
        // The API is deliberate about this: `stateUnknown` is never the same as
        // `paused: false`. A panel that renders an unreadable state as a healthy
        // one is how an operator concludes nothing is wrong while nothing is
        // going out — the same mistake the admission used to make, wearing a
        // user interface.
        expect(PANEL).toContain('stateUnknown');
    });
});
