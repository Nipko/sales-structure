import { mergeOnboardingSessionFacts, type OnboardingSessionFacts } from "./onboarding-session-facts";

/**
 * `hasAnyChannel` in the session: the proof of a channel the day-0 delivery
 * alarm reads.
 *
 * The stage cannot prove a channel once the wizard's last button wrote
 * `completed` (it outranks `channel_connected`), so the server now sends the
 * channel fact itself — on every login payload, on `/auth/refresh` and on
 * `/auth/me`. Unlike the first reply, a channel CAN go away, so a read `false`
 * replaces a `true`; a read that failed (`undefined`) changes nothing.
 */

const baseUser: OnboardingSessionFacts & { id: string } = {
    id: "user-1",
    tenantId: "tenant-1",
    onboardingStage: "completed",
    firstReplyAt: null,
    tenantCreatedAt: "2026-09-17T12:00:00.000Z",
};

describe("mergeOnboardingSessionFacts — the channel fact", () => {
    it("takes a channel the server reports", () => {
        const merged = mergeOnboardingSessionFacts(baseUser, { hasAnyChannel: true });
        expect(merged).toEqual({ ...baseUser, hasAnyChannel: true });
        expect(merged).not.toBe(baseUser);
    });

    it("lets a channel go away: a read false replaces a true", () => {
        const withChannel = { ...baseUser, hasAnyChannel: true };
        expect(mergeOnboardingSessionFacts(withChannel, { hasAnyChannel: false }).hasAnyChannel).toBe(false);
    });

    it("a read that failed changes nothing, and the same value is the same object", () => {
        const withChannel = { ...baseUser, hasAnyChannel: true };
        for (const unknown of [undefined, null, "true", 1]) {
            expect(mergeOnboardingSessionFacts(withChannel, { hasAnyChannel: unknown })).toBe(withChannel);
        }
        expect(mergeOnboardingSessionFacts(withChannel, { hasAnyChannel: true })).toBe(withChannel);
    });

    it("does not take another tenant's channel", () => {
        expect(mergeOnboardingSessionFacts(baseUser, { tenantId: "tenant-2", hasAnyChannel: true })).toBe(baseUser);
    });

    it("moves together with the other facts in one /auth/me payload", () => {
        const merged = mergeOnboardingSessionFacts(baseUser, {
            id: "user-1",
            tenantId: "tenant-1",
            email: "owner@example.com",
            onboardingStage: "completed",
            firstReplyAt: null,
            tenantCreatedAt: baseUser.tenantCreatedAt,
            hasAnyChannel: true,
        });
        expect(merged.hasAnyChannel).toBe(true);
        // Only the facts move; the rest of the payload stays out of the session.
        expect(Object.keys(merged).sort()).toEqual([...Object.keys(baseUser), "hasAnyChannel"].sort());
    });
});
