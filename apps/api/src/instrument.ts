/**
 * Sentry Instrumentation — MUST be imported BEFORE any other module
 * This file is loaded via --require in the Docker CMD or NODE_OPTIONS
 */
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { scrubSentryEvent } from './common/utils/sentry-redaction.util';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
    Sentry.init({
        dsn,
        environment: process.env.NODE_ENV || 'development',
        release: process.env.GIT_SHA || 'unknown',

        // Performance: sample 20% of transactions in production
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
        // Profiling: sample 10% of transactions
        profilesSampleRate: 0.1,

        integrations: [
            nodeProfilingIntegration(),
        ],

        // Don't send PII (personal identifiable information)
        sendDefaultPii: false,

        // The tenant Wompi webhook carries its opaque callback token in the URL
        // path. sendDefaultPii does not cover it, so strip it from both errors
        // and sampled transactions before anything leaves the process.
        beforeSend: (event) => scrubSentryEvent(event),
        beforeSendTransaction: (event) => scrubSentryEvent(event),

        // Filter noisy errors
        ignoreErrors: [
            'ECONNRESET',
            'EPIPE',
            'socket hang up',
        ],
    });

    console.log('[Sentry] Initialized for error tracking and performance monitoring');
} else {
    console.log('[Sentry] Skipped — SENTRY_DSN not configured');
}
