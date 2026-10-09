import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The N3 suite drives the REAL guard, identity service and writers, but the glue that orders the steps of a turn (arbiter → code
 * awaited → engine → server-side yes → report of a failed write) is reproduced in `__fixtures__/n3-transition-chat.ts`. If the
 * service reorders those steps, the N3 would keep passing against an order the product no longer has. This pins the order, and
 * the options both sides must pass, in BOTH files; `conversations.transition-identity.spec.ts` drives the real service through
 * the same scenarios as the N3.
 */
const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8');
const service = read('conversations.service.ts');
const fixture = read('__fixtures__/n3-transition-chat.ts');

/** The step markers, in the order a turn runs them: [label, marker in the service, marker in the fixture]. */
const STEPS: Array<[string, string, string]> = [
    ['the arbiter decides who owns the message', 'arbitrateMissionFocus({ state: missionFocus', 'arbitrateMissionFocus({ state'],
    ['the code the server asked for is answered', 'handleIdentityReply(missionFocus.pendingIdentity', 'handleIdentityReply(state.pendingIdentity'],
    ['a change to something that exists is detected', 'const detected = detectTransition(', 'const detected = detectTransition('],
    ['the proposal is made by the engine', 'runTransition(detected.request', 'runTransition(detected.request'],
    ['the pending proposal is read for the «sí»', 'findPendingConfirmation(schemaName, conversation.id, conversation.contact_id, userText, missionScope)', 'findPendingConfirmation(h.schema, conversationId, contactId, text'],
    ['a write that succeeded is reported by the server', 'transitionDoneText(pending.toolName', 'transitionDoneText(pending.toolName'],
    ['a write that failed is reported from a re-read', 'transitionFailureText(pending.toolName', 'transitionFailureText(pending.toolName'],
];

function indices(source: string, which: 1 | 2): number[] {
    return STEPS.map(step => {
        const marker = step[which];
        // the LAST step markers can also appear earlier for other purposes; the 4b2 / 4c ones are the first occurrence after the arbiter
        const from = source.indexOf(STEPS[0][which]);
        return source.indexOf(marker, from);
    });
}

describe('the N3 glue runs the steps of a turn in the order the service does', () => {
    it('every step exists in both files', () => {
        const missing = [
            ...indices(service, 1).flatMap((index, at) => index < 0 ? [`service: ${STEPS[at][0]}`] : []),
            ...indices(fixture, 2).flatMap((index, at) => index < 0 ? [`fixture: ${STEPS[at][0]}`] : []),
        ];
        expect(missing).toEqual([]);
    });

    it('and in the same order', () => {
        const a = indices(service, 1);
        const b = indices(fixture, 2);
        const order = (list: number[]) => list.map((index, at) => ({ at, index })).sort((x, y) => x.index - y.index).map(item => STEPS[item.at][0]);
        expect(order(a)).toEqual(STEPS.map(step => step[0]));
        expect(order(b)).toEqual(STEPS.map(step => step[0]));
    });

    it('both read the engine\'s calls with the same options: a read never sends a code, a repeated request is restated, the pending proposal is passed', () => {
        for (const source of [service, fixture]) {
            expect(source).toContain("identityChallenge: 'none'");
            expect(source).toMatch(/restate: detected\.restate === true/);
            expect(source).toMatch(/pendingIdentity: /);
            expect(source).toMatch(/pending(?:Proposal)?,?\s/);
        }
    });
});
