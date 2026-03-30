import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappMessagingService } from '../whatsapp/services/whatsapp-messaging.service';

@Injectable()
export class ActionExecutorService {
    private readonly logger = new Logger(ActionExecutorService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly whatsappMessaging: WhatsappMessagingService,
    ) {}

    async executeActions(schemaName: string, actions: any[], eventPayload: any) {
        if (!Array.isArray(actions) || actions.length === 0) {
            this.logger.debug(`[ActionExecutor] No actions to execute.`);
            return;
        }

        for (const action of actions) {
            this.logger.log(`[ActionExecutor] Executing action of type: ${action.type}`);
            
            try {
                switch (action.type) {
                    case 'sendTemplate':
                        await this.executeSendTemplate(schemaName, action.config, eventPayload);
                        break;
                    case 'sendEmail':
                        await this.executeSendEmail(schemaName, action.config, eventPayload);
                        break;
                    case 'updateStage':
                        await this.executeUpdateStage(schemaName, action.config, eventPayload);
                        break;
                    case 'addTag':
                        await this.executeAddTag(schemaName, action.config, eventPayload);
                        break;
                    default:
                        this.logger.warn(`[ActionExecutor] Unknown action type: ${action.type}`);
                }
            } catch (err) {
                this.logger.error(`[ActionExecutor] Action ${action.type} failed: ${err.message}`);
                throw err; // Allow rule engine to catch and fail the execution record
            }
        }
    }

    private async executeSendTemplate(schemaName: string, config: any, payload: any) {
        const templateName = config.templateName || config.template_name;
        const language = config.language || 'es';
        const components = config.components || config.parameters || [];
        const phone = payload.phone;

        if (!templateName || !phone) {
            this.logger.warn(`[ActionExecutor] Faltan datos para enviar plantilla: template=${templateName}, phone=${phone}`);
            return;
        }

        this.logger.log(`[ActionExecutor] Enviando plantilla WhatsApp '${templateName}' a ${phone}`);

        await this.whatsappMessaging.sendTemplate(
            schemaName,
            phone,
            templateName,
            language,
            components,
        );
    }

    private async executeSendEmail(schemaName: string, config: any, payload: any) {
        this.logger.log(`[ActionExecutor] Sending Email Template ${config.templateName}`);
        // Similar to WhatsApp, call EmailService
    }

    private async executeUpdateStage(schemaName: string, config: any, payload: any) {
         if (!payload.leadId) return;
         this.logger.log(`[ActionExecutor] Updating Lead ${payload.leadId} step to ${config.stage}`);
         await this.prisma.executeInTenantSchema(
             schemaName,
             `UPDATE leads SET stage = $1 WHERE id = $2`,
             [config.stage, payload.leadId]
         );
    }

    private async executeAddTag(schemaName: string, config: any, payload: any) {
        this.logger.log(`[ActionExecutor] Adding tag(s) to lead: ${config.tags}`);
        // Append tags to lead or opportunities, depending on schema definition
    }
}
