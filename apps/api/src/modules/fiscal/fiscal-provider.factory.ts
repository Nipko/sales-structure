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
 *                 (international fiscal issuance is not configured by this
 *                 mode; the service records a durable blocked_config decision).
 *
 * Returning null means routing needs explicit issuer configuration. It makes
 * no determination about the seller's legal obligations outside Colombia.
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
        if ((billingCountry || '').trim().toUpperCase() === 'CO') {
            return this.factus;
        }
        this.logger.debug(
            `No fiscal provider for billingCountry=${billingCountry ?? 'null'} in mode CO_LOCAL — issuer configuration required`,
        );
        return null;
    }

    /** Resolve the immutable provider name persisted on FiscalInvoice. */
    getByName(name: string): IFiscalInvoiceProvider | null {
        if (name === this.factus.name) return this.factus;
        if (name === this.usRemote.name) return this.usRemote;
        this.logger.error(`Unknown stored fiscal provider: ${name}`);
        return null;
    }
}
