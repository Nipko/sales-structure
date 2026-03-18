import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ActionExecutorService } from './action-executor.service';

@Injectable()
export class AutomationService {
    private readonly logger = new Logger(AutomationService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly executor: ActionExecutorService
    ) {}

    // ─── Event Listeners ──────────────────────────────────────────────────────

    @OnEvent('lead.captured')
    async handleLeadCaptured(payload: any) {
        this.logger.log(`[Automation] Received lead.captured event for lead: ${payload.leadId}`);
        await this.evaluateEvent(payload.tenantId, payload.schemaName, 'lead.captured', payload);
    }

    // ─── Core Rules Engine ────────────────────────────────────────────────────

    private async evaluateEvent(tenantId: string, schemaName: string, eventType: string, eventPayload: any) {
        try {
            // 1. Fetch active rules for this event type
            const activeRules = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM automation_rules WHERE trigger_type = $1 AND active = true`,
                [eventType]
            );

            if (!activeRules || activeRules.length === 0) {
                this.logger.debug(`[Automation] No active rules found for event: ${eventType}`);
                return;
            }

            // 2. Evaluate each rule
            for (const rule of activeRules) {
                const match = this.evaluateConditions(rule.conditions_json, eventPayload);
                if (match) {
                    this.logger.log(`[Automation] Rule '${rule.name}' matched for event ${eventType}. Executing actions...`);
                    
                    // Create an execution record
                    const execution = await this.prisma.executeInTenantSchema<any[]>(
                        schemaName,
                        `INSERT INTO automation_executions (rule_id, entity_type, entity_id, status)
                         VALUES ($1, $2, $3, $4) RETURNING *`,
                        [rule.id, eventPayload.isNew !== undefined ? 'lead' : 'unknown', eventPayload.leadId || null, 'processing']
                    );

                    // Execute actions asynchronously or synchronously
                    // Parse actions_json safely
                    let actions = [];
                    if (typeof rule.actions_json === 'string') {
                         try { actions = JSON.parse(rule.actions_json); } catch (e) { actions = []; }
                    } else if (Array.isArray(rule.actions_json)) {
                         actions = rule.actions_json;
                    }
                    
                    try {
                        await this.executor.executeActions(schemaName, actions, eventPayload);
                        
                        // Mark as success
                        await this.prisma.executeInTenantSchema(
                            schemaName,
                            `UPDATE automation_executions SET status = 'success', finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
                            [execution[0].id]
                        );
                    } catch (err) {
                        this.logger.error(`[Automation] Rule execution failed: ${err.message}`);
                        // Mark as failed
                         await this.prisma.executeInTenantSchema(
                            schemaName,
                            `UPDATE automation_executions 
                             SET status = 'failed', finished_at = CURRENT_TIMESTAMP, result_json = $2
                             WHERE id = $1`,
                            [execution[0].id, { error: err.message }]
                        );
                    }
                }
            }
        } catch (error) {
            this.logger.error(`[Automation] Failed to evaluate event ${eventType}: ${error.message}`);
        }
    }

    private evaluateConditions(conditions: any, payload: any): boolean {
        // Very simple condition evaluator for Sprint 2
        // E.g., { "campaignId": "uuid" } must match payload.campaignId
        if (!conditions || Object.keys(conditions).length === 0) return true; // generic rule

        // Check if all conditions match
        for (const [key, expectedValue] of Object.entries(conditions)) {
            if (payload[key] !== expectedValue) {
                return false;
            }
        }

        return true;
    }

    // ─── CRUD for Rules ───────────────────────────────────────────────────────

    async getRules(schemaName: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM automation_rules ORDER BY created_at DESC`
        );
    }

    async createRule(schemaName: string, payload: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO automation_rules (tenant_id, name, trigger_type, conditions_json, actions_json, active)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
                payload.tenant_id,
                payload.name,
                payload.trigger_type,
                payload.conditions_json || '{}',
                JSON.stringify(payload.actions_json || []),
                payload.active ?? true
            ]
        );
        return rows[0];
    }
}
