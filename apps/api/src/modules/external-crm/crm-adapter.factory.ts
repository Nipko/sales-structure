import { Injectable } from '@nestjs/common';
import { ICrmAdapter } from './adapters/crm-adapter.interface';
import { HubSpotAdapter } from './adapters/hubspot.adapter';
import { PipedriveAdapter } from './adapters/pipedrive.adapter';

@Injectable()
export class CrmAdapterFactory {
    constructor(
        private readonly hubspot: HubSpotAdapter,
        private readonly pipedrive: PipedriveAdapter,
        // Future: kommo, zoho, salesforce
    ) {}

    get(provider: string): ICrmAdapter {
        switch (provider) {
            case 'hubspot':
                return this.hubspot;
            case 'pipedrive':
                return this.pipedrive;
            default:
                throw new Error(`Unsupported CRM provider: ${provider}`);
        }
    }

    listSupported(): string[] {
        return ['hubspot', 'pipedrive'];
    }
}
