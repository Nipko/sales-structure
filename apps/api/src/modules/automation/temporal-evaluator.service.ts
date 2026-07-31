import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { AutomationListenerService } from './automation-listener.service';
import { TEMPORAL_FLAVORS, TemporalFlavor } from './temporal-flavors';

/**
 * H-3 — El motor temporal que le faltaba a las automatizaciones.
 *
 * El motor de reglas sólo reaccionaba a eventos ENTRANTES (`lead.captured` era
 * su único `@OnEvent`), así que nada podía dispararse por el simple paso del
 * tiempo. Las plantillas con `trigger_type='inactivity'` que el seed ya
 * sembraba eran decoración: nadie las evaluaba nunca.
 *
 * Un solo cron diario recorre los tenants activos y, para cada sabor temporal
 * declarado en `temporal-flavors.ts`, dispara las reglas que ese tenant tenga
 * configuradas. Es una inversión compartida por siete verticales; hacerla por
 * vertical sería pagarla siete veces.
 *
 * Tres cosas que no son opcionales y están resueltas acá para los ocho sabores
 * de una sola vez:
 *
 *  1. **Regla primero, consulta después.** Se mira si el tenant tiene alguna
 *     regla activa para ese trigger ANTES de escanear la tabla vertical. Un
 *     tenant sin la regla configurada no paga ninguna consulta.
 *  2. **Dedupe.** Un cron diario sin memoria le escribe al mismo cliente todos
 *     los días hasta que la fecha pase. Cada sabor declara su `cooldownDays` y
 *     se comprueba contra `automation_executions`, que ya guarda
 *     (rule_id, entity_type, entity_id, started_at) e incluso tiene el índice.
 *  3. **Opt-out.** Quien pidió no recibir mensajes no recibe tampoco los
 *     automáticos. Se filtra contra `opt_out_records` por contacto.
 *
 * Nota sobre el horario: corre a las 9:00 del servidor, no del tenant. Para un
 * recordatorio con días de anticipación la hora exacta no cambia nada; si
 * alguna vez se agrega un sabor sensible a la hora local, esto hay que
 * repensarlo.
 *
 * Nota sobre la ventana de 24h de WhatsApp: casi nunca está abierta para estos
 * casos. Cada sabor necesita su plantilla de utilidad aprobada del lado de la
 * acción — el envío ya resuelve plantilla-vs-texto libre, esto sólo dispara.
 */
@Injectable()
export class TemporalEvaluatorService {
    private readonly logger = new Logger(TemporalEvaluatorService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly throttle: TenantThrottleService,
        private readonly listener: AutomationListenerService,
    ) {}

    @Cron('0 9 * * *')
    async evaluateAll(): Promise<void> {
        // La API y el worker cargan el MISMO AppModule con ScheduleModule, así
        // que todo @Cron se dispara en los dos contenedores. Para casi todos los
        // crons eso es idempotente y da igual; este le escribe a clientes
        // finales. El dedupe de abajo cubre el caso secuencial, pero dos
        // corridas simultáneas leen antes de que cualquiera escriba: el lock es
        // lo que cierra esa ventana. TTL de 6h, muy por encima de lo que tarda
        // la corrida y muy por debajo de las 24h hasta la próxima.
        const today = new Date().toISOString().slice(0, 10);
        const lockKey = `lock:temporal-evaluator:${today}`;
        if (!(await this.redis.acquireLock(lockKey, 6 * 3600))) {
            this.logger.debug('[Temporal] otra instancia ya está corriendo la evaluación de hoy');
            return;
        }

        let tenants: any[] = [];
        try {
            tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;
        } catch (err: any) {
            this.logger.error(`No se pudieron listar los tenants: ${err.message}`);
            return;
        }
        if (!tenants?.length) return;

        let fired = 0;
        for (const tenant of tenants) {
            // Un tenant que falla no puede cortar la corrida de los demás.
            try {
                fired += await this.evaluateTenant(tenant.id, tenant.schema_name);
            } catch (err: any) {
                this.logger.error(`[Temporal] tenant ${tenant.id} falló: ${err.message}`);
            }
        }
        this.logger.log(`[Temporal] Evaluación diaria completa — ${fired} disparos sobre ${tenants.length} tenants`);
    }

    private async evaluateTenant(tenantId: string, schemaName: string): Promise<number> {
        if (!schemaName) return 0;

        // Las reglas de los ocho sabores en una sola consulta: si el tenant no
        // tiene ninguna, no se toca ninguna tabla vertical.
        const triggers = TEMPORAL_FLAVORS.map(f => f.trigger);
        const rules = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM automation_rules WHERE active = true AND trigger_type = ANY($1::text[])`,
            [triggers],
        ).catch(() => [] as any[]);
        if (!rules.length) return 0;

        if (await this.throttle.isLimited(tenantId, 'automation')) {
            this.logger.warn(`[Temporal] tenant ${tenantId} rate limited — se omite la corrida`);
            return 0;
        }
        const priority = await this.throttle.getPriority(tenantId);

        let fired = 0;
        for (const flavor of TEMPORAL_FLAVORS) {
            const flavorRules = rules.filter(r => r.trigger_type === flavor.trigger);
            if (!flavorRules.length) continue;
            fired += await this.runFlavor(tenantId, schemaName, flavor, flavorRules, priority);
        }
        return fired;
    }

    private async runFlavor(
        tenantId: string,
        schemaName: string,
        flavor: TemporalFlavor,
        rules: any[],
        priority: number,
    ): Promise<number> {
        // Las tablas verticales son lazy: que no exista significa "esta vertical
        // no aplica a este tenant", no que algo se rompió.
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            flavor.sql,
            [String(flavor.windowDays)],
        ).catch(() => null);
        if (!rows) return 0;
        if (!rows.length) return 0;

        const optedOut = await this.loadOptedOutContacts(schemaName, rows.map(r => r.contact_id));

        let fired = 0;
        for (const row of rows) {
            if (optedOut.has(row.contact_id)) continue;

            for (const rule of rules) {
                if (await this.firedRecently(schemaName, rule.id, row.entity_type, row.entity_id, flavor.cooldownDays)) {
                    continue;
                }
                await this.listener.dispatchRule({
                    tenantId,
                    schemaName,
                    rule,
                    entityType: row.entity_type,
                    entityId: row.entity_id,
                    // El payload es lo que las condiciones y las plantillas de
                    // mensaje pueden leer por nombre de campo.
                    payload: {
                        tenantId,
                        schemaName,
                        trigger: flavor.trigger,
                        contactId: row.contact_id,
                        entityId: row.entity_id,
                        entityType: row.entity_type,
                        label: row.label ?? null,
                        detail: row.detail ?? null,
                        dueDate: row.due_date ?? null,
                    },
                    priority,
                });
                fired++;
            }
        }

        if (fired) {
            this.logger.log(`[Temporal] ${flavor.trigger}: ${fired} disparos en ${schemaName}`);
        }
        return fired;
    }

    /**
     * Contactos que pidieron no recibir mensajes. Se resuelve de una sola vez
     * por sabor en vez de una consulta por fila.
     */
    private async loadOptedOutContacts(schemaName: string, contactIds: string[]): Promise<Set<string>> {
        const ids = [...new Set(contactIds.filter(Boolean))];
        if (!ids.length) return new Set();
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            // El vocabulario es pending | confirmed | rejected, y 'rejected'
            // significa "falso positivo". Cuenta como opt-out todo lo que no sea
            // eso: un pedido de baja todavía sin revisar pesa más que un mensaje
            // automático de más.
            `SELECT DISTINCT l.contact_id
             FROM opt_out_records o
             JOIN leads l ON l.id = o.lead_id
             WHERE l.contact_id = ANY($1::uuid[]) AND o.status <> 'rejected'`,
            [ids],
        ).catch(() => [] as any[]);
        return new Set(rows.map(r => r.contact_id));
    }

    /**
     * ¿Ya disparamos esta regla sobre esta entidad hace poco?
     *
     * `automation_executions` ya registra cada disparo con su entidad y su
     * fecha, y ya tiene el índice (entity_type, entity_id). Usarla como memoria
     * evita agregarle una columna de dedupe a todos los schemas de tenant —y la
     * ventana por tiempo es más honesta que una clave de período: si la corrida
     * de ayer falló a mitad de camino, mañana se reintenta sola.
     */
    private async firedRecently(
        schemaName: string,
        ruleId: string,
        entityType: string,
        entityId: string,
        cooldownDays: number,
    ): Promise<boolean> {
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT 1 FROM automation_executions
                 WHERE rule_id = $1::uuid AND entity_type = $2 AND entity_id = $3::uuid
                   AND started_at >= NOW() - ($4 || ' days')::interval
                 LIMIT 1`,
                [ruleId, entityType, entityId, String(cooldownDays)],
            );
            return rows.length > 0;
        } catch (err: any) {
            // Si no se pudo LEER la memoria, se asume que ya se disparó. Repetirle
            // el mensaje al cliente es peor que saltearlo un día, y mañana el cron
            // vuelve a pasar.
            this.logger.warn(`[Temporal] dedupe ilegible (regla ${ruleId}): ${err.message} — se omite el disparo`);
            return true;
        }
    }
}
