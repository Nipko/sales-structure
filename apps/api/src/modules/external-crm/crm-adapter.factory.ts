import { Injectable } from '@nestjs/common';
import { ICrmAdapter } from './adapters/crm-adapter.interface';
import { HubSpotAdapter } from './adapters/hubspot.adapter';

@Injectable()
export class CrmAdapterFactory {
    constructor(
        private readonly hubspot: HubSpotAdapter,
        // Future: pipedrive, kommo, zoho, salesforce
    ) {}

    get(provider: string): ICrmAdapter {
        switch (provider) {
            case 'hubspot':
                return this.hubspot;
            default:
                throw new Error(`Unsupported CRM provider: ${provider}`);
        }
    }

    listSupported(): string[] {
        return ['hubspot'];
    }
}
