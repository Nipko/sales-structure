import { Injectable, Logger } from '@nestjs/common';
import { FactusAdapter } from './adapters/factus.adapter';
import { UsRemoteAdapter } from './adapters/us-remote.adapter';
import { FiscalMode, IFiscalInvoiceProvider } from './interfaces/fiscal-provider.interface';

/**
 * Resolves the active fiscal provider. The GLOBAL fiscal mode is checked first
 * (it decides which legal entity issues), then the tenant's billing country:
 *
 *   - US_REMOTE → UsRemoteAdapter for everyone (LLC issues; no DIAN FEV).
 *   - CO_LOCAL  → FactusAdapter for CO tenants (DIAN FEV); null for the rest
 *                 (no fiscal document issued for non-Colombian customers while
 *                 the Colombian entity is the issuer).
 *
 * Returning null is a valid outcome meaning "nothing to issue here" — the
 * service skips fiscal issuance for that payment.
 */
@Injectable()
export class FiscalProviderFactory {
    private readonly logger = new Logger(FiscalProviderFactory.name);

    constructor(
        private readonly factus: FactusAdapter,
        private readonly usRemote: UsRemoteAdapter,
    ) {}

    resolve(mode: FiscalMode, billingCountry?: string | null): IFiscalInvoiceProvider | null {
        if (mode === 'US_REMOTE') {
            return this.usRemote;
        }
        // CO_LOCAL (hybrid, default)
        if ((billingCountry || '').toUpperCase() === 'CO') {
            return this.factus;
        }
        this.logger.debug(
            `No fiscal provider for billingCountry=${billingCountry ?? 'null'} in mode CO_LOCAL — skipping issuance`,
        );
        return null;
    }
}
