import { DAY_ZERO_MAX_DAYS } from "@parallext/shared";
import { isSessionInDayZero, mergeOnboardingSessionFacts } from "./onboarding-session-facts";

/**
 * The day 0 of an account, as the session carries it.
 *
 * Until this wave the panel only knew the stage, and `completed` counted as
 * live: the wizard's last button lifted the day-0 silence before the agent had
 * answered anybody. The two facts that now end it (the first real reply and
 * the account's age) travel on the user object and are refreshed from the
 * server; these specs pin how a refresh may and may not change them.
 */

const NOW = Date.parse("2026-09-17T15:00:00.000Z");
const TODAY = "2026-09-17T12:00:00.000Z";
const LONG_AGO = new Date(NOW - (DAY_ZERO_MAX_DAYS + 2) * 86_400_000).toISOString();

const baseUser = {
    id: "user-1",
    tenantId: "tenant-1",
    onboardingStage: "agent_reviewed",
    firstReplyAt: null as string | null,
    tenantCreatedAt: TODAY,
};

describe("mergeOnboardingSessionFacts", () => {
    it("takes the stage, the first reply and the creation date the server sent", () => {
        const merged = mergeOnboardingSessionFacts(baseUser, {
            onboardingStage: "completed",
            firstReplyAt: "2026-09-17T14:59:00.000Z",
            tenantCreatedAt: TODAY,
        });
        expect(merged).toEqual({
            ...baseUser,
            onboardingStage: "completed",
            firstReplyAt: "2026-09-17T14:59:00.000Z",
        });
        expect(merged).not.toBe(baseUser);
    });

    it("returns the same object when nothing changed, so nobody redraws or rewrites storage", () => {
        expect(mergeOnboardingSessionFacts(baseUser, {
            onboardingStage: "agent_reviewed",
            firstReplyAt: null,
            tenantCreatedAt: TODAY,
        })).toBe(baseUser);
        expect(mergeOnboardingSessionFacts(baseUser, null)).toBe(baseUser);
        expect(mergeOnboardingSessionFacts(baseUser, "nope")).toBe(baseUser);
    });

    it("never degrades what it already had on a missing or unknown value", () => {
        const withReply = { ...baseUser, onboardingStage: "live", firstReplyAt: "2026-09-17T14:00:00.000Z" };
        // A read that could not establish anything is not a fact.
        expect(mergeOnboardingSessionFacts(withReply, {
            onboardingStage: undefined,
            firstReplyAt: undefined,
            tenantCreatedAt: undefined,
        })).toBe(withReply);
        expect(mergeOnboardingSessionFacts(withReply, { onboardingStage: "not-a-stage" })).toBe(withReply);
        // A first reply cannot un-happen: `null` never erases a recorded one,
        // or a failed read would put a replying agent back into day-0 silence.
        expect(mergeOnboardingSessionFacts(withReply, { firstReplyAt: null }).firstReplyAt)
            .toBe("2026-09-17T14:00:00.000Z");
        expect(mergeOnboardingSessionFacts(withReply, { firstReplyAt: "yesterday-ish" }).firstReplyAt)
            .toBe("2026-09-17T14:00:00.000Z");
    });

    it("does not mix another tenant's facts into this session", () => {
        expect(mergeOnboardingSessionFacts(baseUser, {
            tenantId: "tenant-2",
            onboardingStage: "live",
            firstReplyAt: TODAY,
        })).toBe(baseUser);
    });

    it("accepts the /auth/me payload, which is the whole user plus the three facts", () => {
        const merged = mergeOnboardingSessionFacts(baseUser, {
            id: "user-1",
            email: "owner@example.com",
            role: "tenant_admin",
            tenantId: "tenant-1",
            onboardingStage: "channel_connected",
            firstReplyAt: null,
            tenantCreatedAt: TODAY,
        });
        expect(merged.onboardingStage).toBe("channel_connected");
        // Only the three facts move; the rest of the session stays as it was.
        expect(Object.keys(merged).sort()).toEqual(Object.keys(baseUser).sort());
    });
});

describe("isSessionInDayZero", () => {
    it("keeps a completed wizard in day 0 until the agent answers somebody", () => {
        // The regression this wave closes: "Ir al panel" writes `completed`.
        expect(isSessionInDayZero({ onboardingStage: "completed", firstReplyAt: null, tenantCreatedAt: TODAY }, NOW)).toBe(true);
        expect(isSessionInDayZero({ onboardingStage: "channel_connected", tenantCreatedAt: TODAY }, NOW)).toBe(true);
    });

    it("ends day 0 with the first real reply", () => {
        expect(isSessionInDayZero({
            onboardingStage: "completed",
            firstReplyAt: "2026-09-17T14:59:00.000Z",
            tenantCreatedAt: TODAY,
        }, NOW)).toBe(false);
        expect(isSessionInDayZero({ onboardingStage: "live", tenantCreatedAt: TODAY }, NOW)).toBe(false);
    });

    it("ends day 0 on its own after the cap, so an account that never connects still sees its notices", () => {
        expect(isSessionInDayZero({ onboardingStage: "channel_deferred", firstReplyAt: null, tenantCreatedAt: LONG_AGO }, NOW)).toBe(false);
    });

    it("treats an account without a stage (older than the contract, or no tenant) as live", () => {
        expect(isSessionInDayZero({ firstReplyAt: null, tenantCreatedAt: TODAY }, NOW)).toBe(false);
        expect(isSessionInDayZero(null, NOW)).toBe(false);
    });
});
