import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import MaintenanceModeCard from "./_MaintenanceModeCard";

/**
 * The platform-wide incident banner, when its own state could not be read.
 *
 * This card is the one place a super_admin looks to answer "is an announcement
 * up right now?". Its load used to swallow every rejection, leaving the initial
 * `enabled = false` with an empty message — which is drawn identically to a
 * platform with nothing published. Two things follow from that, and both are
 * asserted here:
 *
 * 1. The screen must not answer a question it did not get an answer to.
 * 2. The Save button writes what is on screen. On a card that never loaded,
 *    one click clears a live incident notice for every tenant. So the editor
 *    must not be reachable at all, and the handler must refuse anyway.
 *
 * The API is stubbed at `@/lib/api` because a test must not do network; what is
 * under test is what the component does with each answer.
 */

const state = {
    enabled: true,
    message: "Mantenimiento programado 22:00-23:00",
    severity: "critical" as const,
    expiresAt: "2026-09-09T23:00:00.000Z",
    setBy: "nir@parallly.co",
    setAt: "2026-09-08T21:00:00.000Z",
};

/** Read through a ref so a case can change the answer mid-test. */
const answerRef: { current: unknown } = { current: null };

jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: {
        getPlatformMaintenance: jest.fn(async () => {
            const next = answerRef.current;
            if (next instanceof Error) throw next;
            return next;
        }),
        setPlatformMaintenance: jest.fn(async () => ({ success: true, data: {} })),
    },
}));

const { api } = jest.requireMock("@/lib/api") as {
    api: { getPlatformMaintenance: jest.Mock; setPlatformMaintenance: jest.Mock };
};

const textOf = (container: HTMLElement) => container.textContent ?? "";

beforeEach(() => {
    api.getPlatformMaintenance.mockClear();
    api.setPlatformMaintenance.mockClear();
});

describe("the maintenance banner card when its state could not be read", () => {
    it.each([
        ["the request rejects", new Error("network")],
        ["the API answers success: false", { success: false, error: "db_unreachable" }],
        ["the API answers success with no payload", { success: true, data: null }],
    ])("says the state is unknown rather than showing an empty banner (%s)", async (_case, reply) => {
        answerRef.current = reply;
        const screen = await renderScreen(<MaintenanceModeCard />);

        const alert = screen.container.querySelector('[role="alert"]');
        expect(alert).not.toBeNull();
        // "Unknown", not "off": the words the card would use for a real
        // no-banner state must not appear.
        expect(textOf(screen.container)).toContain("No pudimos leer el estado del banner");
        expect(textOf(screen.container)).not.toContain("Banner activo");

        screen.unmount();
    });

    it("offers no control that could publish or clear an unread state", async () => {
        answerRef.current = new Error("network");
        const screen = await renderScreen(<MaintenanceModeCard />);

        const labels = Array.from(screen.container.querySelectorAll("button"))
            .map((button) => button.textContent ?? "");
        expect(labels.join(" | ")).not.toContain("Publicar");
        expect(labels.join(" | ")).not.toContain("Limpiar banner");
        expect(labels.join(" | ")).not.toContain("Guardar");
        // Only the retry remains.
        expect(labels).toHaveLength(1);

        screen.unmount();
    });

    it("re-requests the state when the retry is pressed", async () => {
        answerRef.current = new Error("network");
        const screen = await renderScreen(<MaintenanceModeCard />);
        expect(api.getPlatformMaintenance).toHaveBeenCalledTimes(1);

        answerRef.current = { success: true, data: state };
        const retry = screen.container.querySelector("button") as HTMLButtonElement;
        await interact(() => retry.click());

        expect(api.getPlatformMaintenance).toHaveBeenCalledTimes(2);
        // And the answer that came back is what the card now shows.
        expect(textOf(screen.container)).toContain(state.message);
        expect(screen.container.querySelector('[role="alert"]')).toBeNull();

        screen.unmount();
    });

    it("never writes a state it did not read", async () => {
        answerRef.current = new Error("network");
        const screen = await renderScreen(<MaintenanceModeCard />);

        // Reaching past the render: even driven directly, no click on this card
        // may reach the API while the published state is unknown.
        for (const button of Array.from(screen.container.querySelectorAll("button"))) {
            await interact(() => button.click());
        }
        expect(api.setPlatformMaintenance).not.toHaveBeenCalled();

        screen.unmount();
    });

    it("shows the published banner once the read succeeds", async () => {
        answerRef.current = { success: true, data: state };
        const screen = await renderScreen(<MaintenanceModeCard />);

        expect(screen.container.querySelector('[role="alert"]')).toBeNull();
        expect(textOf(screen.container)).toContain(state.message);
        expect(textOf(screen.container)).toContain("Banner activo");

        screen.unmount();
    });

    it("has no machine-detectable accessibility violations in the unknown state", async () => {
        answerRef.current = new Error("network");
        const screen = await renderScreen(<MaintenanceModeCard />);
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });
});
