import { Injectable, Logger } from '@nestjs/common';
import { FactusAdapter } from './adapters/factus.adapter';
import { UsRemoteAdapter } from './adapters/us-remote.adapter';
import { FiscalMode, IFiscalInvoiceProvider } from './interfaces/fiscal-provider.interface';

/**
 * Resolves the issuer using the fiscal mode, payment rail and historical
 * billing country. The rail is required in the hybrid CO_LOCAL mode so a
 * legacy non-Colombian Wompi payment cannot be assigned to the US issuer.
 *
 *   - US_REMOTE → UsRemoteAdapter for everyone (LLC issues; no DIAN FEV).
 *   - CO_LOCAL  → FactusAdapter for Colombian non-Stripe payments (DIAN FEV);
 *                 UsRemoteAdapter for international Stripe payments when the
 *                 LLC fiscal profile is ready; null for other combinations.
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

    resolve(mode: FiscalMode, billingCountry?: string | null, paymentProvider?: string | null): IFiscalInvoiceProvider | null {
        if (mode === 'US_REMOTE') {
            return this.usRemote;
        }
        // CO_LOCAL (hybrid, default)
        const country = (billingCountry || '').trim().toUpperCase();
        if (country === 'CO' && paymentProvider !== 'stripe') {
            return this.factus;
        }
        if (country && country !== 'CO' && paymentProvider === 'stripe') {
            return this.usRemote;
        }
        this.logger.debug(
            `No fiscal provider for billingCountry=${billingCountry ?? 'null'} rail=${paymentProvider ?? 'null'} in mode CO_LOCAL — issuer configuration required`,
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
