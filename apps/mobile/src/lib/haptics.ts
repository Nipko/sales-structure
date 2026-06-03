/**
 * Tactile feedback wrapper. Centralizes haptics so screens just call
 * `haptic.success()` / `haptic.error()` / `haptic.tap()` without worrying about
 * the platform module being present.
 *
 * `expo-haptics` is a native module: it only works in a dev/standalone build, not
 * in Expo Go, and is absent until the next native rebuild. We `require()` it lazily
 * and swallow any error so a missing module degrades to a silent no-op instead of
 * crashing — critical for the field agent (manos ocupadas) but never load-bearing.
 */
let H: any = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    H = require('expo-haptics');
} catch {
    H = null;
}

function notify(type: 'success' | 'warning' | 'error') {
    try {
        if (H?.notificationAsync && H?.NotificationFeedbackType) {
            const map = {
                success: H.NotificationFeedbackType.Success,
                warning: H.NotificationFeedbackType.Warning,
                error: H.NotificationFeedbackType.Error,
            } as const;
            H.notificationAsync(map[type]);
        }
    } catch { /* no-op */ }
}

export const haptic = {
    /** Light selection tick — filter change, row/chip tap. */
    tap() {
        try { H?.selectionAsync?.(); } catch { /* no-op */ }
    },
    /** Positive confirmation — message sent, assigned, resolved, moved. */
    success() { notify('success'); },
    /** Soft warning — queued offline, snoozed. */
    warning() { notify('warning'); },
    /** Failure — API error, send failed. */
    error() { notify('error'); },
};
