import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelTokenService } from './channel-token.service';
import { isConnectionRefusal } from './connection-refusal';
import { IncidentService } from '../health/incident.service';

/**
 * The connection could not be READ. Nobody chose anything wrong.
 *
 * Thrown rather than returned, because the two failures need opposite
 * treatment and a single `null` gave them the same one: a configuration
 * refusal means stop and ask a person, and this means try again later. A
 * caller that owns a retryable job re-runs on the throw; a caller that does
 * not still gets the incident, which is the part that stops it disappearing.
 */
export class ProactiveConnectionUnavailable extends Error {
    constructor(readonly purpose: string, readonly cause?: unknown) {
        super(`proactive_connection_unavailable:${purpose}`);
        this.name = 'ProactiveConnectionUnavailable';
    }
}

/**
 * ═══ WHICH NUMBER A PROACTIVE MESSAGE LEAVES FROM ═══
 *
 * A reply inherits its connection: the customer wrote to a number, and the
 * answer goes back out of that number. A PROACTIVE message — a reminder, a
 * nurture follow-up, a campaign — inherits nothing. Somebody has to choose.
 *
 * For a tenant with one WhatsApp number the choice is trivial and the resolver
 * makes it. For a tenant with two it is a real decision with a real
 * consequence: a reminder sent from a number the customer has never seen
 * arrives as a message from a stranger, and it is billed to a WABA the business
 * may not have meant to spend from.
 *
 * `ChannelTokenService` already refuses that: an unnamed connection on a
 * multi-number tenant is `connection_ambiguous`, never "the oldest one". The
 * gap was what happened NEXT. Each producer caught the refusal, logged a line,
 * and returned — so the reminder simply did not happen, nobody was told, and
 * the only trace was a warning in a container log.
 *
 * ── WHY A TASK AND NOT AN ALERT ─────────────────────────────────────────────
 *
 * Because the fix is a decision by the business, not an outage for us to
 * resolve: somebody has to say which number their reminders go out from. A task
 * lands in the place that tenant already looks at every day, carries the
 * sentence that says what to do, and stops being pending when they do it. An
 * incident in the Ops Center would tell the wrong person, in the wrong product,
 * about a choice only the business can make.
 *
 * The task is written once. A reminder cron that raised a new one every fifteen
 * minutes would bury the inbox it is trying to reach.
 */
@Injectable()
export class ProactiveSendConnection {
    private readonly logger = new Logger(ProactiveSendConnection.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly channelToken: ChannelTokenService,
        /**
         * Where an infrastructure failure goes so it does not vanish.
         *
         * A configuration refusal belongs to the business — it becomes a task
         * in their own product. A database or credential store that could not
         * be read belongs to us, and used to be a `logger.error` and nothing
         * else: every proactive message of that tenant stopped going out and
         * the only trace was a line in a container log.
         */
        @Optional() private readonly incidents?: IncidentService,
    ) {}

    /**
     * The connection this proactive send leaves from.
     *
     * Three outcomes, and they are three because they need three answers:
     *
     *   · credentials — send.
     *   · `null` — a CONFIGURATION refusal. The business has to choose a
     *     number, or connect one. A task is raised in their own product and
     *     this send does not happen. Retrying changes nothing, so nothing
     *     retries.
     *   · a thrown `ProactiveConnectionUnavailable` — INFRASTRUCTURE. Nobody
     *     chose anything wrong; something could not be read. It may well work
     *     in a minute, so a caller that owns a retryable job must retry rather
     *     than drop the message, and an incident is raised either way.
     *
     * It never picks a number. Returning nothing is the honest outcome when
     * there is a real choice to make: the alternative is writing to somebody's
     * customers from a number they have never seen, billed to a WABA the
     * business did not choose.
     */
    async resolve(input: {
        readonly tenantId: string;
        readonly schemaName: string;
        readonly channelType: string;
        /** What the producer already knows, when it knows anything. */
        readonly channelAccountId?: string | null;
        /** What this send is, in the words the task will use. */
        readonly purpose: string;
    }): Promise<{ accessToken: string; accountId: string } | null> {
        try {
            const creds = await this.channelToken.getChannelToken(
                input.tenantId, input.channelType as any,
                input.channelAccountId || undefined);
            return { accessToken: creds.accessToken, accountId: creds.accountId };
        } catch (error: any) {
            if (!isConnectionRefusal(error)) {
                // Not a decision anybody can make — a database or a credential
                // store that could not be read. This used to be logged and
                // dropped, which meant every proactive message of that tenant
                // stopped going out with nothing but a container log to say so.
                //
                // A task would be wrong: it would send somebody to change a
                // setting that is not the problem. An incident is right, and so
                // is raising, so a caller with a retryable job tries again.
                this.logger.error(`[Proactive] ${input.purpose} could not resolve a `
                    + `${input.channelType} connection: ${error?.message}`);
                await this.raiseIncident(input, error);
                throw new ProactiveConnectionUnavailable(input.purpose, error);
            }
            await this.raiseConfigurationTask(input, error.code ?? 'connection_unusable');
            return null;
        }
    }

    /**
     * Say it in the Ops Center, where an outage belongs.
     *
     * Deduplicated by key inside the incident service, so a cron that fails
     * every few minutes raises one incident with a rising count rather than a
     * wall of them. Never throws: the caller is already handling a failure and
     * a second one here would hide the first.
     */
    private async raiseIncident(input: {
        tenantId: string; channelType: string; purpose: string;
    }, error: any): Promise<void> {
        if (!this.incidents) return;
        try {
            await this.incidents.record(
                `proactive_connection_unavailable_${input.channelType}`,
                'warning',
                'No se pudo resolver la conexión de un envío proactivo',
                `${input.purpose} no pudo resolver una conexión de ${input.channelType} del `
                + `tenant ${input.tenantId}: ${String(error?.message ?? error).slice(0, 200)}. `
                + 'No es una decisión del negocio: algo no se pudo leer. Los mensajes '
                + 'proactivos de ese tenant no están saliendo.',
                1);
        } catch (incidentError: any) {
            this.logger.error(`[Proactive] the incident itself could not be recorded: `
                + `${incidentError?.message}`);
        }
    }

    private async raiseConfigurationTask(input: {
        tenantId: string; schemaName: string; channelType: string; purpose: string;
    }, code: string): Promise<void> {
        const title = `Elige el número de ${this.channelName(input.channelType)} `
            + `para ${input.purpose}`;
        const description = this.explain(input.channelType, input.purpose, code);
        try {
            await this.prisma.executeInTenantSchema(input.schemaName,
                // One open task per purpose and channel. A reminder cron runs
                // every few minutes; a new task each time would bury the inbox
                // it is trying to reach.
                `INSERT INTO tasks (title, description, type, status, due_at)
                 SELECT $1, $2, 'configuration', 'pending', NOW()
                  WHERE NOT EXISTS (
                        SELECT 1 FROM tasks
                         WHERE type = 'configuration' AND status = 'pending' AND title = $1)`,
                [title, description]);
            this.logger.warn(`[Proactive] ${input.purpose} is waiting on a connection choice `
                + `for tenant ${input.tenantId} (${code})`);
        } catch (error: any) {
            this.logger.error(`[Proactive] could not raise the configuration task for `
                + `${input.purpose}: ${error?.message}`);
        }
    }

    private channelName(channelType: string): string {
        const names: Record<string, string> = {
            whatsapp: 'WhatsApp', instagram: 'Instagram',
            messenger: 'Messenger', telegram: 'Telegram',
        };
        return names[channelType] ?? channelType;
    }

    /**
     * What to do, in the business's own terms.
     *
     * The two reasons need different sentences and collapsing them sends the
     * wrong person the wrong way: "you have several and none is chosen" is a
     * decision, and "you have none connected" is a connection.
     */
    private explain(channelType: string, purpose: string, code: string): string {
        const channel = this.channelName(channelType);
        if (code === 'connection_ambiguous') {
            return `Tienes más de un número de ${channel} conectado y ${purpose} no tiene uno `
                + `asignado, así que no se envió nada: elegir por nuestra cuenta significaría `
                + `escribirle a tus clientes desde un número que quizá no reconocen, y cobrarlo `
                + `a una cuenta que quizá no quisiste usar. Entra a Canales, elige el número `
                + `que quieres usar para ${purpose} y guarda.`;
        }
        if (code === 'connection_absent') {
            return `No hay ningún número de ${channel} conectado, así que ${purpose} no puede `
                + `salir. Conecta uno desde Canales.`;
        }
        return `El número de ${channel} que usa ${purpose} no está en condiciones de enviar `
            + `(${code}). Revísalo en Canales: puede necesitar reconectarse.`;
    }
}
