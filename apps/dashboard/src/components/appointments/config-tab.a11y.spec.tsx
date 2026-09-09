import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import ConfigTab from "./ConfigTab";

/**
 * The Configuración tab of the agenda, when its reads did not come back.
 *
 * Each of the three editors here opens on a convenient default — a Mon-Fri
 * 09:00-18:00 week, four reminders switched on, WhatsApp Flows off with an
 * empty ID — and each used to swallow a failed read and leave that default on
 * screen looking saved. The schedule is the one that destroys data: its Save
 * posts all seven days at once, so one click after a dropped request replaces
 * the tenant's real opening hours with the component's stock week, and the
 * agent then answers "no hay disponibilidad" to every customer.
 *
 * So the assertions are about refusal, not about pixels: no control that can
 * write may be reachable from a state nobody read, the three cards fail
 * independently, and the retry actually re-requests.
 */

jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: {
        getTenantUsers: jest.fn(async () => ({ success: true, data: [] })),
        getBusinessInfo: jest.fn(async () => ({ success: true, data: {} })),
        updateCalendarAssignment: jest.fn(async () => ({ success: true })),
    },
}));

jest.mock("@/contexts/AuthContext", () => ({
    __esModule: true,
    useAuth: () => ({ user: { id: "u1", role: "tenant_admin" } }),
}));

const slots = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
    dayOfWeek,
    startTime: "09:00",
    endTime: "18:00",
    active: dayOfWeek < 6,
}));

const baseProps = {
    activeTenantId: "11111111-1111-4111-8111-111111111111",
    availabilitySlots: slots,
    setAvailabilitySlots: () => {},
    hasSavedAvailability: true,
    blockedDates: [],
    calendarIntegrations: [],
    externalEventsCount: 0,
    onConnectCalendar: () => {},
    onDisconnectCalendar: () => {},
    onAddBlockedDate: () => {},
    onDeleteBlockedDate: () => {},
    onRefresh: () => {},
    showToast: () => {},
    services: [],
};

const textOf = (container: HTMLElement) => container.textContent ?? "";

describe("the agenda configuration tab when a read failed", () => {
    it("refuses to offer a Save that would replace all seven days", async () => {
        const onSaveAvailability = jest.fn();
        const screen = await renderScreen(
            <ConfigTab
                {...baseProps}
                onSaveAvailability={onSaveAvailability}
                availabilityUnavailable
                onRetryAvailability={() => {}}
            />,
        );

        expect(textOf(screen.container)).toContain("No pudimos leer tus horarios");
        // The day rows are gone with the button: there is nothing left to edit
        // and nothing left to submit.
        expect(screen.container.querySelectorAll('input[type="time"]')).toHaveLength(0);

        for (const button of Array.from(screen.container.querySelectorAll("button"))) {
            await interact(() => button.click());
        }
        expect(onSaveAvailability).not.toHaveBeenCalled();

        screen.unmount();
    });

    it("does not say the tenant never saved a schedule when it could not check", async () => {
        const screen = await renderScreen(
            <ConfigTab
                {...baseProps}
                hasSavedAvailability={false}
                onSaveAvailability={() => {}}
                availabilityUnavailable
                onRetryAvailability={() => {}}
            />,
        );

        // The red "you have no availability saved" warning is a conclusion
        // about the account; an unread schedule does not license it.
        expect(textOf(screen.container)).not.toContain("Horarios no guardados");
        expect(textOf(screen.container)).toContain("No pudimos leer tus horarios");

        screen.unmount();
    });

    it("does not present unread reminders as switched on", async () => {
        const onUpdateReminderSettings = jest.fn();
        const screen = await renderScreen(
            <ConfigTab
                {...baseProps}
                onSaveAvailability={() => {}}
                remindersUnavailable
                onUpdateReminderSettings={onUpdateReminderSettings}
                onRetryReminders={() => {}}
            />,
        );

        expect(textOf(screen.container)).toContain("No pudimos leer la configuración de recordatorios");
        expect(textOf(screen.container)).not.toContain("Recordatorio 24 horas antes");

        for (const button of Array.from(screen.container.querySelectorAll("button"))) {
            await interact(() => button.click());
        }
        expect(onUpdateReminderSettings).not.toHaveBeenCalled();

        screen.unmount();
    });

    it("does not let an unread Flows config be toggled over the real Flow ID", async () => {
        const onUpdateBookingFlows = jest.fn();
        const screen = await renderScreen(
            <ConfigTab
                {...baseProps}
                onSaveAvailability={() => {}}
                flowsUnavailable
                onUpdateBookingFlows={onUpdateBookingFlows}
                onRetryFlows={() => {}}
            />,
        );

        expect(textOf(screen.container)).toContain("No pudimos leer la configuración de Flows");

        for (const button of Array.from(screen.container.querySelectorAll("button"))) {
            await interact(() => button.click());
        }
        expect(onUpdateBookingFlows).not.toHaveBeenCalled();

        screen.unmount();
    });

    it("fails one card at a time", async () => {
        const screen = await renderScreen(
            <ConfigTab {...baseProps} onSaveAvailability={() => {}} remindersUnavailable onRetryReminders={() => {}} />,
        );

        // The schedule read succeeded, so its editor stays usable.
        expect(screen.container.querySelectorAll('input[type="time"]').length).toBeGreaterThan(0);
        expect(textOf(screen.container)).not.toContain("No pudimos leer tus horarios");
        expect(textOf(screen.container)).toContain("No pudimos leer la configuración de recordatorios");

        screen.unmount();
    });

    it("re-requests the schedule when its retry is pressed", async () => {
        const onRetryAvailability = jest.fn();
        const screen = await renderScreen(
            <ConfigTab
                {...baseProps}
                onSaveAvailability={() => {}}
                availabilityUnavailable
                onRetryAvailability={onRetryAvailability}
            />,
        );

        const retry = Array.from(screen.container.querySelectorAll("button"))
            .find((button) => (button.textContent ?? "").includes("Reintentar"));
        expect(retry).toBeDefined();
        await interact(() => retry!.click());
        expect(onRetryAvailability).toHaveBeenCalledTimes(1);

        screen.unmount();
    });

    it("has no machine-detectable accessibility violations with all three unknown", async () => {
        const screen = await renderScreen(
            <ConfigTab
                {...baseProps}
                onSaveAvailability={() => {}}
                availabilityUnavailable
                remindersUnavailable
                flowsUnavailable
                onRetryAvailability={() => {}}
                onRetryReminders={() => {}}
                onRetryFlows={() => {}}
            />,
        );
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });
});
