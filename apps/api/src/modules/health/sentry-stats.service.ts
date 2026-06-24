import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Reads the platform's application error rate from the Sentry API (stats_v2,
 * category=error, last hour) so the ops center can alert on error spikes —
 * the one class of problem the infra/business signals don't see.
 *
 * Needs a Sentry internal/integration auth token (SENTRY_AUTH_TOKEN) with
 * org:read + project:read, plus SENTRY_ORG (slug). SENTRY_PROJECT (numeric id)
 * narrows to one project; otherwise it's org-wide. SENTRY_API_URL defaults to
 * https://sentry.io (set it for self-hosted). No-op (null) when unconfigured.
 */
@Injectable()
export class SentryStatsService {
    private readonly logger = new Logger(SentryStatsService.name);
    private readonly token?: string;
    private readonly org?: string;
    private readonly projectId?: string;
    private readonly baseUrl: string;

    constructor(config: ConfigService) {
        this.token = config.get<string>('SENTRY_AUTH_TOKEN');
        this.org = config.get<string>('SENTRY_ORG');
        const project = config.get<string>('SENTRY_PROJECT');
        // stats_v2 `project` expects a numeric id; ignore a slug and go org-wide.
        this.projectId = project && /^\d+$/.test(project) ? project : undefined;
        this.baseUrl = (config.get<string>('SENTRY_API_URL') || 'https://sentry.io').replace(/\/+$/, '');
    }

    get enabled(): boolean {
        return !!(this.token && this.org);
    }

    /** Error events in the last hour. null when unconfigured or on any failure. */
    async getErrorsLastHour(): Promise<number | null> {
        if (!this.enabled) return null;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        try {
            let url = `${this.baseUrl}/api/0/organizations/${encodeURIComponent(this.org!)}/stats_v2/`
                + `?field=sum(quantity)&category=error&statsPeriod=1h&interval=1h`;
            if (this.projectId) url += `&project=${this.projectId}`;

            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${this.token}` },
                signal: ctrl.signal,
            });
            if (!res.ok) {
                this.logger.debug(`Sentry stats failed: ${res.status}`);
                return null;
            }
            const data: any = await res.json();
            const groups: any[] = Array.isArray(data?.groups) ? data.groups : [];
            let total = 0;
            for (const g of groups) {
                const v = g?.totals?.['sum(quantity)'];
                if (typeof v === 'number') total += v;
            }
            return total;
        } catch (e: any) {
            this.logger.debug(`Sentry stats error: ${e.message}`);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }
}
