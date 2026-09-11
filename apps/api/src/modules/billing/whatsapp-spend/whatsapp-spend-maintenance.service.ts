import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CronLockService } from '../../redis/cron-lock.service';
import { IncidentService } from '../../health/incident.service';
import { WhatsappSpendService } from './whatsapp-spend.service';

/**
 * ═══ THE LEDGER DOES NOT MAINTAIN ITSELF ═══
 *
 * Three things go wrong on their own, quietly, and all three end the same way —
 * money counted against a business that nothing will ever uncount:
 *
 *   1. a worker takes the right to send and dies before the POST, so the effect
 *      is owed to a customer and nobody may claim it;
 *   2. a reservation outlives its lease with no outcome at all, so it sits in
 *      `held` for ever and its ceiling never frees up;
 *   3. a delivery arrives whose price nobody could compute, and waits in
 *      `pending_reconciliation` for an invoice that is not an API.
 *
 * Every one of those already had a writer. None of them had a CALLER — the
 * sweep existed and ran nowhere, which is this repository's oldest pattern and
 * the reason the audit calls it out by name.
 *
 * ── WHY A CRON AND NOT A QUEUE ──────────────────────────────────────────────
 *
 * The work is per tenant, small, idempotent and time-based, and it must happen
 * whether or not anything is being sent. A queue would need a producer that is
 * itself a cron. What it does need from a queue is the discipline: a lease so
 * two processes do not both sweep, a bounded batch, and a backoff that stops a
 * broken tenant from consuming every pass.
 */
@Injectable()
export class WhatsappSpendMaintenanceService {
    private readonly logger = new Logger(WhatsappSpendMaintenanceService.name);

    /** How long a delivery may wait for a price before its reservation stands. */
    private readonly GRACE_HOURS = 72;

    /** Per pass, per tenant. A ceiling, so one huge tenant cannot starve the rest. */
    private readonly BATCH = 200;

    /**
     * Tenants whose last pass threw, and when they may be tried again.
     *
     * In memory on purpose: it is a politeness, not a correctness property. A
     * restart clearing it means the next pass tries everybody, which is the
     * safe direction — the work is idempotent and the alternative is a tenant
     * that stays skipped because a Redis key outlived the outage.
     */
    private readonly backoff = new Map<string, number>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly spend: WhatsappSpendService,
        private readonly cronLock: CronLockService,
        // The Ops Center. Optional because the maintenance itself must run in
        // any process that has a scheduler, and an alert nobody can raise is
        // still better than a sweep nobody runs.
        @Optional() private readonly incidents?: IncidentService,
    ) {}

    /**
     * Every ten minutes, on exactly one process.
     *
     * Ten rather than one: the shortest thing this recovers is a transmission
     * lease, and those are minutes long by design — sweeping faster than they
     * expire is a query per minute that finds nothing. Long enough that a
     * customer waiting on a crashed worker's message waits minutes, not hours.
     */
    @Cron('*/10 * * * *')
    async run(): Promise<void> {
        await this.cronLock.runExclusive('whatsapp-spend.maintenance', 540,
            () => this.sweepEveryTenant(), { prefer: 'worker' });
    }

    /**
     * One pass over every tenant that can spend on WhatsApp.
     *
     * Returns the totals so a test — and an operator running it by hand — sees
     * what happened rather than reading it out of a log.
     */
    async sweepEveryTenant(at: Date = new Date()): Promise<{
        tenants: number; skipped: number; recovered: number; uncertain: number;
        expired: number; reconciled: number; needsPerson: number; failed: number;
    }> {
        const totals = { tenants: 0, skipped: 0, recovered: 0, uncertain: 0, expired: 0,
            reconciled: 0, needsPerson: 0, failed: 0 };
        for (const tenant of await this.spendingTenants()) {
            const until = this.backoff.get(tenant.id);
            if (until && until > at.getTime()) { totals.skipped += 1; continue; }
            totals.tenants += 1;
            try {
                const outcome = await this.sweepTenant(tenant.schemaName, at);
                totals.recovered += outcome.recovered;
                totals.uncertain += outcome.uncertain;
                totals.expired += outcome.expired;
                totals.reconciled += outcome.reconciled;
                totals.needsPerson += outcome.needsPerson;
                this.backoff.delete(tenant.id);
            } catch (error: any) {
                totals.failed += 1;
                // Ten minutes of quiet for this tenant, and only this tenant.
                // Without it a schema that raises on every query burns the pass
                // and everybody else stops being swept.
                this.backoff.set(tenant.id, at.getTime() + 10 * 60_000);
                this.logger.error(`[Spend] maintenance failed for ${tenant.schemaName}: `
                    + `${error?.message}`);
            }
        }
        await this.report(totals);
        return totals;
    }

    /** The three passes, in the order that makes each one see less work. */
    async sweepTenant(schema: string, at: Date = new Date()): Promise<{
        recovered: number; uncertain: number; expired: number;
        reconciled: number; needsPerson: number;
    }> {
        // 1. Transmission leases first. A worker that died holding the right to
        //    send leaves an effect nobody may claim; recovering it is the only
        //    one of the three that puts a message back on its way to a person.
        const transmissions = await this.spend.sweepTransmissions(schema, this.BATCH);
        // 2. Reservation leases. `held` past its lease with no outcome becomes
        //    `indeterminate` — visible exposure, never a quiet release.
        const expired = await this.spend.sweep(schema, this.BATCH);
        // 3. And the deliveries that have waited long enough for a price.
        const reconciled = await this.spend.reconcile(schema,
            { graceHours: this.GRACE_HOURS, limit: this.BATCH, at });
        return {
            recovered: transmissions.recovered.length,
            // Claimed-but-never-sent is recoverable; in-flight is not. The
            // second number is exposure, not repair, and collapsing them would
            // report a crash mid-POST as a message put back on its way.
            uncertain: transmissions.uncertain.length,
            expired: expired.length,
            reconciled: reconciled.settled,
            needsPerson: reconciled.needsPerson,
        };
    }

    /**
     * Which tenants have a WhatsApp number at all.
     *
     * Read from the connection, not from the ledger: a tenant with no
     * reservations yet still needs sweeping the moment it sends its first
     * message, and a query that looked for existing rows would skip exactly the
     * tenant whose first send crashed.
     */
    private async spendingTenants(): Promise<Array<{ id: string; schemaName: string }>> {
        const rows = await this.prisma.tenant.findMany({
            where: {
                isActive: true,
                channelAccounts: { some: { channelType: 'whatsapp' } },
            },
            select: { id: true, schemaName: true },
        });
        return rows.filter((row): row is { id: string; schemaName: string } =>
            Boolean(row.schemaName));
    }

    /**
     * Metrics an operator can see, and an incident when there is one to raise.
     *
     * The two numbers that matter are different in kind. `failed` is our
     * problem — a schema that cannot be swept. `needsPerson` is the business's:
     * money counted against an account for messages nobody can confirm, which
     * no amount of retrying will decide.
     */
    private async report(totals: { tenants: number; skipped: number; recovered: number;
        uncertain: number; expired: number; reconciled: number; needsPerson: number;
        failed: number }): Promise<void> {
        this.logger.log(`[Spend] maintenance: ${totals.tenants} tenant(s), `
            + `${totals.recovered} transmission lease(s) recovered, ${totals.uncertain} left `
            + `uncertain mid-POST, ${totals.expired} reservation(s) expired, `
            + `${totals.reconciled} reconciled, ${totals.needsPerson} awaiting a person, `
            + `${totals.failed} failed, ${totals.skipped} in backoff`);
        if (!this.incidents) return;
        try {
            if (totals.failed) {
                await this.incidents.record('whatsapp_spend_maintenance_failing', 'warning',
                    'El barrido de gasto de WhatsApp falló en algunos tenants',
                    `${totals.failed} tenant(s) no pudieron barrerse. Sus reservas siguen contadas `
                    + 'y sus topes no se liberan hasta que el barrido vuelva a correr.',
                    totals.failed);
            }
            if (totals.needsPerson) {
                await this.incidents.record('whatsapp_spend_awaiting_resolution', 'warning',
                    'Hay envíos de WhatsApp que nadie puede confirmar',
                    `${totals.needsPerson} efecto(s) llevan más de ${this.GRACE_HOURS} h sin `
                    + 'respuesta del proveedor. El dinero sigue contado contra la cuenta y sólo '
                    + 'una persona puede decidir si se entregaron.',
                    totals.needsPerson);
            }
        } catch (error: any) {
            this.logger.warn(`[Spend] maintenance metrics not reported: ${error?.message}`);
        }
    }
}
