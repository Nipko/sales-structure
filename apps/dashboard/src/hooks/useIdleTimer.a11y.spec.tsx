import { act } from "react";
import { renderScreen } from "@/test/a11y";
import { useIdleTimer } from "./useIdleTimer";

const MINUTE = 60_000;

class SessionChannel {
    static opened: SessionChannel[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage = jest.fn();
    close = jest.fn();

    constructor(readonly name: string) {
        SessionChannel.opened.push(this);
    }
}

function Timer({ onWarning, onTimeout }: { onWarning: () => void; onTimeout: () => void }) {
    useIdleTimer({ timeout: 60 * MINUTE, warningBefore: 2 * MINUTE, enabled: true, onWarning, onTimeout });
    return <input aria-label="Business name" />;
}

describe("idle timeout follows user activity and leaves logout to AuthProvider", () => {
    const originalChannel = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");

    beforeEach(() => {
        jest.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z") });
        SessionChannel.opened = [];
        Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: SessionChannel });
    });

    afterEach(() => {
        jest.useRealTimers();
        if (originalChannel) Object.defineProperty(globalThis, "BroadcastChannel", originalChannel);
        else Reflect.deleteProperty(globalThis, "BroadcastChannel");
    });

    it.each(["input", "change"])("restarts the idle window when a form emits %s", async eventName => {
        const onWarning = jest.fn();
        const onTimeout = jest.fn();
        const screen = await renderScreen(<Timer onWarning={onWarning} onTimeout={onTimeout} />);
        try {
            await act(async () => { await jest.advanceTimersByTimeAsync(57 * MINUTE); });
            await act(async () => {
                screen.container.querySelector("input")!.dispatchEvent(new Event(eventName, { bubbles: true }));
            });

            // The old deadline passes while the person is still active.
            await act(async () => { await jest.advanceTimersByTimeAsync(3 * MINUTE); });
            expect(onWarning).not.toHaveBeenCalled();
            expect(onTimeout).not.toHaveBeenCalled();
            expect(SessionChannel.opened[0].postMessage).toHaveBeenCalledWith({ type: "activity", ts: Date.now() - 3 * MINUTE });

            await act(async () => { await jest.advanceTimersByTimeAsync(55 * MINUTE); });
            expect(onWarning).toHaveBeenCalledTimes(1);
            expect(onTimeout).not.toHaveBeenCalled();
            await act(async () => { await jest.advanceTimersByTimeAsync(2 * MINUTE); });
            expect(onTimeout).toHaveBeenCalledTimes(1);
        } finally { screen.unmount(); }
    });

    it("does not turn another tab's logout into a timeout or broadcast it again", async () => {
        const onWarning = jest.fn();
        const onTimeout = jest.fn();
        const screen = await renderScreen(<Timer onWarning={onWarning} onTimeout={onTimeout} />);
        try {
            await act(async () => { await jest.advanceTimersByTimeAsync(59 * MINUTE); });
            const channel = SessionChannel.opened[0];
            expect(channel.name).toBe("parallly-session");
            await act(async () => {
                channel.onmessage?.(new MessageEvent("message", { data: { type: "logout", reason: "session_replaced" } }));
            });
            expect(onTimeout).not.toHaveBeenCalled();
            expect(channel.postMessage).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
    });

    it("warns after 58 idle minutes and expires at the unchanged 60-minute deadline", async () => {
        const onWarning = jest.fn();
        const onTimeout = jest.fn();
        const screen = await renderScreen(<Timer onWarning={onWarning} onTimeout={onTimeout} />);
        try {
            await act(async () => { await jest.advanceTimersByTimeAsync(58 * MINUTE); });
            expect(onWarning).toHaveBeenCalledTimes(1);
            expect(onTimeout).not.toHaveBeenCalled();
            await act(async () => { await jest.advanceTimersByTimeAsync(2 * MINUTE - 1); });
            expect(onTimeout).not.toHaveBeenCalled();
            await act(async () => { await jest.advanceTimersByTimeAsync(1); });
            expect(onTimeout).toHaveBeenCalledTimes(1);
            expect(SessionChannel.opened[0].postMessage).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
        expect(SessionChannel.opened[0].close).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });
});
