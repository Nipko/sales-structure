import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// import { WhatsappService } from '../whatsapp/whatsapp.service'; // Adjust if WhatsappModule has an exposed service

@Injectable()
export class ActionExecutorService {
    private readonly logger = new Logger(ActionExecutorService.name);

    constructor(
        private readonly prisma: PrismaService,
        // private readonly whatsappService: WhatsappService
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
        this.logger.log(`[ActionExecutor] Sending WhatsApp Template ${config.templateName} to +${payload.phone}`);
        // In a real implementation:
        // await this.whatsappService.sendTemplate({
        //     tenantId: payload.tenantId,
        //     to: payload.phone,
        //     templateName: config.templateName,
        //     parameters: config.parameters
        // });
        
        // Let's pretend we sent it
        await new Promise(resolve => setTimeout(resolve, 100));
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
