/**
 * Dev-only logger. No-op in production/release builds so tokens, socket IDs,
 * push tokens and other sensitive data never leak into device logs (logcat /
 * Console). Use instead of console.log for any diagnostic logging. (GATE 0 — seguridad)
 */
export const log: (...args: any[]) => void = __DEV__
    ? (...args: any[]) => console.log(...args)
    : () => { /* stripped in release */ };
