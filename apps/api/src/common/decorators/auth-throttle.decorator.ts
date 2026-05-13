import { SetMetadata } from '@nestjs/common';

export const AUTH_THROTTLE_KEY = 'auth_throttle';

export interface AuthThrottleOptions {
    limit: number;
    windowSeconds: number;
}

/**
 * Rate-limit decorator for auth endpoints.
 * @param limit       Max attempts within the window
 * @param windowSeconds  Sliding window duration in seconds
 */
export const AuthThrottle = (limit: number, windowSeconds: number) =>
    SetMetadata(AUTH_THROTTLE_KEY, { limit, windowSeconds } as AuthThrottleOptions);
