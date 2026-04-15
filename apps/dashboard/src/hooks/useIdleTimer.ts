"use client";

import { useEffect, useRef, useCallback } from "react";

const ACTIVITY_EVENTS = [
    "mousedown",
    "keydown",
    "scroll",
    "touchstart",
    "click",
] as const;

const THROTTLE_MS = 30_000; // Only record activity once per 30s

interface UseIdleTimerOptions {
    /** Idle timeout in ms (default: 60 min) */
    timeout: number;
    /** Time before timeout to trigger warning in ms (default: 2 min) */
    warningBefore: number;
    /** Called when warning threshold is reached */
    onWarning: () => void;
    /** Called when timeout is reached */
    onTimeout: () => void;
    /** Whether the timer is active */
    enabled: boolean;
}

/**
 * Tracks user activity and fires callbacks before/at idle timeout.
 * Syncs activity across browser tabs via BroadcastChannel.
 */
export function useIdleTimer({
    timeout,
    warningBefore,
    onWarning,
    onTimeout,
    enabled,
}: UseIdleTimerOptions) {
    const lastActivityRef = useRef(Date.now());
    const warningFiredRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const channelRef = useRef<BroadcastChannel | null>(null);
    const throttleRef = useRef(0);

    const resetActivity = useCallback(() => {
        lastActivityRef.current = Date.now();
        warningFiredRef.current = false;

        // Broadcast to other tabs
        try {
            channelRef.current?.postMessage({ type: "activity", ts: Date.now() });
        } catch {
            // BroadcastChannel may be closed
        }
    }, []);

    // Expose resetActivity for external use (e.g., after API calls)
    const touchActivity = useCallback(() => {
        lastActivityRef.current = Date.now();
        warningFiredRef.current = false;
    }, []);

    useEffect(() => {
        if (!enabled || typeof window === "undefined") return;

        // ── BroadcastChannel for multi-tab sync ──
        let bc: BroadcastChannel | null = null;
        try {
            bc = new BroadcastChannel("parallly-session");
            bc.onmessage = (evt) => {
                if (evt.data?.type === "activity") {
                    lastActivityRef.current = evt.data.ts;
                    warningFiredRef.current = false;
                }
                if (evt.data?.type === "logout") {
                    onTimeout();
                }
            };
            channelRef.current = bc;
        } catch {
            // Fallback: no cross-tab sync (e.g., old browsers)
        }

        // ── DOM event listeners (throttled) ──
        const handleActivity = () => {
            const now = Date.now();
            if (now - throttleRef.current < THROTTLE_MS) return;
            throttleRef.current = now;
            resetActivity();
        };

        for (const evt of ACTIVITY_EVENTS) {
            document.addEventListener(evt, handleActivity, { passive: true });
        }

        // ── Tab visibility: validate session on focus ──
        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                const idle = Date.now() - lastActivityRef.current;
                if (idle >= timeout) {
                    onTimeout();
                } else if (idle >= timeout - warningBefore && !warningFiredRef.current) {
                    warningFiredRef.current = true;
                    onWarning();
                }
            }
        };
        document.addEventListener("visibilitychange", handleVisibility);

        // ── Check interval (every 30s) ──
        timerRef.current = setInterval(() => {
            const idle = Date.now() - lastActivityRef.current;

            if (idle >= timeout) {
                onTimeout();
                return;
            }

            if (idle >= timeout - warningBefore && !warningFiredRef.current) {
                warningFiredRef.current = true;
                onWarning();
            }
        }, 30_000);

        return () => {
            for (const evt of ACTIVITY_EVENTS) {
                document.removeEventListener(evt, handleActivity);
            }
            document.removeEventListener("visibilitychange", handleVisibility);
            if (timerRef.current) clearInterval(timerRef.current);
            try { bc?.close(); } catch { /* noop */ }
        };
    }, [enabled, timeout, warningBefore, onWarning, onTimeout, resetActivity]);

    return { resetActivity, touchActivity };
}
