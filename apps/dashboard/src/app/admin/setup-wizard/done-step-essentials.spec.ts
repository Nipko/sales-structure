import { doneStepEssentials, readSetupActivationFacts, readSetupProgressFacts } from "./done-step-essentials";

/**
 * ═══ "LISTO" LISTS WHAT IS PENDING, AND SAYS WHAT IS DONE AS DONE ═══
 *
 * The last screen printed the same three chores for everybody, numbered as
 * pending. These pin that it follows setup-status: done is done, pending is
 * pending, and a count nobody could read is left out rather than guessed.
 */

function status(data: Record<string, unknown>) {
    return { success: true, data };
}

describe("the essentials of 'Listo'", () => {
    it("says done what setup-status counted as done", () => {
        const facts = readSetupProgressFacts(status({ hasKnowledge: true, hasTeam: true }));
        expect(doneStepEssentials(facts)).toEqual([
            { key: "channel", done: null },
            { key: "knowledge", done: true },
            { key: "team", done: true },
        ]);
    });

    it("keeps pending what is still missing", () => {
        expect(doneStepEssentials(readSetupProgressFacts(status({ hasKnowledge: false, hasTeam: false })))).toEqual([
            { key: "channel", done: null },
            { key: "knowledge", done: false },
            { key: "team", done: false },
        ]);
    });

    it("leaves out a count nobody could read, and always keeps the channel", () => {
        // The endpoint omits the flag (undefined) when its count failed.
        expect(doneStepEssentials(readSetupProgressFacts(status({ hasTeam: true })))).toEqual([
            { key: "channel", done: null },
            { key: "team", done: true },
        ]);
        expect(doneStepEssentials(readSetupProgressFacts(null))).toEqual([{ key: "channel", done: null }]);
        expect(doneStepEssentials(readSetupProgressFacts({ success: false }))).toEqual([{ key: "channel", done: null }]);
        expect(doneStepEssentials(readSetupProgressFacts(status({ hasKnowledge: "yes" })))).toEqual([{ key: "channel", done: null }]);
    });
});

describe("the day-0 facts setup-status carries", () => {
    it("reads the stage, the first reply and the creation date", () => {
        expect(readSetupActivationFacts(status({
            onboardingStage: "agent_reviewed",
            firstReplyAt: null,
            tenantCreatedAt: "2026-09-17T10:00:00.000Z",
        }))).toEqual({ stage: "agent_reviewed", firstReplyAt: null, tenantCreatedAt: "2026-09-17T10:00:00.000Z" });
    });

    it("treats an unreadable date as not known, never as a date", () => {
        expect(readSetupActivationFacts(status({ firstReplyAt: "ayer", tenantCreatedAt: 12 })))
            .toEqual({ stage: undefined, firstReplyAt: undefined, tenantCreatedAt: undefined });
        expect(readSetupActivationFacts(null)).toEqual({});
    });
});
