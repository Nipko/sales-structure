import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BUSINESS_FACT_WRITTEN, type BusinessFactWrittenEvent } from '../readiness/business-facts.service';
import { CopilotProposalsService } from './copilot-proposals.service';

/**
 * Un valor más nuevo que llega por otra puerta (el formulario del cajón, la bandeja de pendientes, los defaults) deja en
 * `superseded` las propuestas abiertas del copiloto para ese requisito y alcance (C0 §2.8, ADR 0012). La aprobación de
 * una propuesta (`origin=copilot`) ya resuelve las demás ella misma.
 */
@Injectable()
export class CopilotProposalsListener {
    private readonly logger = new Logger(CopilotProposalsListener.name);

    constructor(private readonly proposals: CopilotProposalsService) {}

    @OnEvent(BUSINESS_FACT_WRITTEN, { async: true })
    async onFactWritten(event: BusinessFactWrittenEvent | undefined): Promise<void> {
        if (!event?.tenantId || !event.requirementId || event.origin === 'copilot') return;
        await this.proposals.supersedeForWrittenValue(event.tenantId, event.requirementId, event.scopeKey ?? '')
            .catch(err => this.logger.warn(`copilot: no se pudieron reemplazar las propuestas de ${event.requirementId}: ${(err as Error).message}`));
    }
}
