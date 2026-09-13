/*
 * DERIVED FILE — do not edit by hand.
 *
 * Regenerate:  node scripts/generate-whatsapp-rate-projection.cjs
 * Verify:      node scripts/generate-whatsapp-rate-projection.cjs --check
 *
 * Projected from apps/api/src/modules/billing/whatsapp-rates/
 * whatsapp-rate-table.generated.ts — the same table the engine prices
 * against — so a rate on the public page cannot disagree with a rate on an
 * invoice. `check:claims` fails when this file and that table diverge.
 *
 * Prices are integer MICRO-UNITS: millionths of one whole unit of the card's
 * currency. `'unavailable'` is what the card printed as n/a — a rate that could
 * not be established, which is NOT zero and must never be summed as zero.
 */

/** A price the card did not state. Never coerce this to a number. */
export type UnavailableRate = 'unavailable';

export type WhatsAppMessageCategory =
    | 'marketing'
    | 'utility'
    | 'authentication'
    | 'authentication_international'
    | 'service';

export interface ProjectedRateEntry {
    /** Meta's own market name. The row a dispute has to point at. */
    readonly market: string;
    /** i18n key under `whatsappCosts.market.*` when Meta names a bucket. */
    readonly aggregateKey?: string;
    readonly locator: string;
    readonly micros: Readonly<Record<WhatsAppMessageCategory, number | UnavailableRate>>;
}

export interface ProjectedRateCard {
    readonly rateVersion: string;
    /** Currency of the WhatsApp account BEING BILLED, not of the recipient. */
    readonly currency: string;
    /** Applies from midnight of this date IN THE WABA'S OWN TIME ZONE. */
    readonly effectiveFrom: string;
    readonly sourceFile: string;
    readonly sourceSha256: string;
    readonly headerLocator: string;
    readonly entries: readonly ProjectedRateEntry[];
}

export const WHATSAPP_RATE_PROJECTION = Object.freeze({
    rateTableVersion: 'meta-ratecards-2026@ddb62cc8458b94a3',
    microsPerUnit: 1000000,
    categories: Object.freeze(['marketing', 'utility', 'authentication', 'authentication_international', 'service'] as const),
    allowance: Object.freeze({
        deliveries: 1000,
        scope: 'per_phone_number_per_calendar_month' as const,
        rollsOver: false,
        category: 'service' as const,
        effectiveFrom: '2026-10-01',
    }),
    currencyMinorExponent: Object.freeze({
        USD: 2,
        COP: 2,
    }),
    cards: Object.freeze<readonly ProjectedRateCard[]>([
        Object.freeze({
            rateVersion: 'meta-ratecards-2026/USD/2026-07-01',
            currency: 'USD',
            effectiveFrom: '2026-07-01',
            sourceFile: 'meta-usd-rates-2026-07-01.csv',
            sourceSha256: '9aa0fcb64bd1455aa010b5738a3eca90d290f09ae1a71a153d0d148348408ffa',
            headerLocator: 'line 6',
            entries: Object.freeze([
                Object.freeze({ market: 'Argentina', locator: 'line 8', micros: Object.freeze({ marketing: 61800, utility: 26000, authentication: 26000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Brazil', locator: 'line 9', micros: Object.freeze({ marketing: 62500, utility: 6800, authentication: 6800, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Chile', locator: 'line 10', micros: Object.freeze({ marketing: 88900, utility: 20000, authentication: 20000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Colombia', locator: 'line 11', micros: Object.freeze({ marketing: 12500, utility: 800, authentication: 800, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Egypt', locator: 'line 12', micros: Object.freeze({ marketing: 64400, utility: 3600, authentication: 3600, authentication_international: 65000, service: 'unavailable' }) }),
                Object.freeze({ market: 'France', locator: 'line 13', micros: Object.freeze({ marketing: 85900, utility: 30000, authentication: 30000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Germany', locator: 'line 14', micros: Object.freeze({ marketing: 136500, utility: 55000, authentication: 55000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Hong Kong', locator: 'line 15', micros: Object.freeze({ marketing: 73200, utility: 26000, authentication: 26000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Hungary', locator: 'line 16', micros: Object.freeze({ marketing: 86000, utility: 35000, authentication: 35000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'India', locator: 'line 17', micros: Object.freeze({ marketing: 11800, utility: 1400, authentication: 1400, authentication_international: 30400, service: 'unavailable' }) }),
                Object.freeze({ market: 'Indonesia', locator: 'line 18', micros: Object.freeze({ marketing: 41100, utility: 25000, authentication: 25000, authentication_international: 136000, service: 'unavailable' }) }),
                Object.freeze({ market: 'Israel', locator: 'line 19', micros: Object.freeze({ marketing: 35300, utility: 5300, authentication: 5300, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Italy', locator: 'line 20', micros: Object.freeze({ marketing: 79500, utility: 30000, authentication: 30000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Malaysia', locator: 'line 21', micros: Object.freeze({ marketing: 86000, utility: 14000, authentication: 14000, authentication_international: 41800, service: 'unavailable' }) }),
                Object.freeze({ market: 'Mexico', locator: 'line 22', micros: Object.freeze({ marketing: 30500, utility: 8500, authentication: 8500, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Netherlands', locator: 'line 23', micros: Object.freeze({ marketing: 159700, utility: 50000, authentication: 50000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Nigeria', locator: 'line 24', micros: Object.freeze({ marketing: 51600, utility: 6700, authentication: 6700, authentication_international: 75000, service: 'unavailable' }) }),
                Object.freeze({ market: 'Pakistan', locator: 'line 25', micros: Object.freeze({ marketing: 47300, utility: 10000, authentication: 10000, authentication_international: 75000, service: 'unavailable' }) }),
                Object.freeze({ market: 'Peru', locator: 'line 26', micros: Object.freeze({ marketing: 70300, utility: 20000, authentication: 20000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Poland', locator: 'line 27', micros: Object.freeze({ marketing: 36600, utility: 12200, authentication: 12200, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Qatar', locator: 'line 28', micros: Object.freeze({ marketing: 34100, utility: 12000, authentication: 12000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Romania', locator: 'line 29', micros: Object.freeze({ marketing: 86000, utility: 29000, authentication: 29000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Russia', locator: 'line 30', micros: Object.freeze({ marketing: 80200, utility: 40000, authentication: 40000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Saudi Arabia', locator: 'line 31', micros: Object.freeze({ marketing: 50100, utility: 10700, authentication: 10700, authentication_international: 59800, service: 'unavailable' }) }),
                Object.freeze({ market: 'Singapore', locator: 'line 32', micros: Object.freeze({ marketing: 73200, utility: 16000, authentication: 16000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'South Africa', locator: 'line 33', micros: Object.freeze({ marketing: 37900, utility: 7600, authentication: 7600, authentication_international: 20000, service: 'unavailable' }) }),
                Object.freeze({ market: 'Spain', locator: 'line 34', micros: Object.freeze({ marketing: 70700, utility: 20000, authentication: 20000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Turkey', locator: 'line 35', micros: Object.freeze({ marketing: 10900, utility: 900, authentication: 900, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'United Arab Emirates', locator: 'line 36', micros: Object.freeze({ marketing: 49900, utility: 15700, authentication: 15700, authentication_international: 51000, service: 'unavailable' }) }),
                Object.freeze({ market: 'United Kingdom', locator: 'line 37', micros: Object.freeze({ marketing: 63500, utility: 22000, authentication: 22000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'North America', aggregateKey: 'northAmerica', locator: 'line 38', micros: Object.freeze({ marketing: 25000, utility: 3400, authentication: 3400, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Africa', aggregateKey: 'restOfAfrica', locator: 'line 39', micros: Object.freeze({ marketing: 22500, utility: 4000, authentication: 4000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Asia Pacific', aggregateKey: 'restOfAsiaPacific', locator: 'line 40', micros: Object.freeze({ marketing: 73200, utility: 11300, authentication: 11300, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Central & Eastern Europe', aggregateKey: 'restOfCentralEasternEurope', locator: 'line 41', micros: Object.freeze({ marketing: 86000, utility: 21200, authentication: 21200, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Latin America', aggregateKey: 'restOfLatinAmerica', locator: 'line 42', micros: Object.freeze({ marketing: 74000, utility: 11300, authentication: 11300, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Middle East', aggregateKey: 'restOfMiddleEast', locator: 'line 43', micros: Object.freeze({ marketing: 34100, utility: 9100, authentication: 9100, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Western Europe', aggregateKey: 'restOfWesternEurope', locator: 'line 44', micros: Object.freeze({ marketing: 59200, utility: 17100, authentication: 17100, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Other', aggregateKey: 'other', locator: 'line 45', micros: Object.freeze({ marketing: 60400, utility: 7700, authentication: 7700, authentication_international: 'unavailable', service: 'unavailable' }) }),
            ]),
        }),
        Object.freeze({
            rateVersion: 'meta-ratecards-2026/COP/2026-07-01',
            currency: 'COP',
            effectiveFrom: '2026-07-01',
            sourceFile: 'meta-cop-rates-2026-07-01.csv',
            sourceSha256: 'a28188877b14ec23420e0d22fc5898beace2ab09272ef3696c1d63f6a0f09bc5',
            headerLocator: 'line 6',
            entries: Object.freeze([
                Object.freeze({ market: 'Argentina', locator: 'line 8', micros: Object.freeze({ marketing: 227536100, utility: 95727100, authentication: 95727100, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Brazil', locator: 'line 9', micros: Object.freeze({ marketing: 230113300, utility: 25036300, authentication: 25036300, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Chile', locator: 'line 10', micros: Object.freeze({ marketing: 327313200, utility: 73636300, authentication: 73636300, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Colombia', locator: 'line 11', micros: Object.freeze({ marketing: 46022700, utility: 2945500, authentication: 2945500, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Egypt', locator: 'line 12', micros: Object.freeze({ marketing: 237108800, utility: 13254500, authentication: 13254500, authentication_international: 239317900, service: 'unavailable' }) }),
                Object.freeze({ market: 'France', locator: 'line 13', micros: Object.freeze({ marketing: 316267800, utility: 110454400, authentication: 110454400, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Germany', locator: 'line 14', micros: Object.freeze({ marketing: 502567500, utility: 202499700, authentication: 202499700, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Hong Kong', locator: 'line 15', micros: Object.freeze({ marketing: 269508700, utility: 95727200, authentication: 95727200, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Hungary', locator: 'line 16', micros: Object.freeze({ marketing: 316636000, utility: 128863400, authentication: 128863400, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'India', locator: 'line 17', micros: Object.freeze({ marketing: 43445400, utility: 5154500, authentication: 5154500, authentication_international: 111927100, service: 'unavailable' }) }),
                Object.freeze({ market: 'Indonesia', locator: 'line 18', micros: Object.freeze({ marketing: 151322500, utility: 92045300, authentication: 92045300, authentication_international: 500726600, service: 'unavailable' }) }),
                Object.freeze({ market: 'Israel', locator: 'line 19', micros: Object.freeze({ marketing: 129968000, utility: 19513600, authentication: 19513600, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Italy', locator: 'line 20', micros: Object.freeze({ marketing: 292575300, utility: 110454400, authentication: 110454400, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Malaysia', locator: 'line 21', micros: Object.freeze({ marketing: 316636000, utility: 51545400, authentication: 51545400, authentication_international: 153899800, service: 'unavailable' }) }),
                Object.freeze({ market: 'Mexico', locator: 'line 22', micros: Object.freeze({ marketing: 112295300, utility: 31295400, authentication: 31295400, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Netherlands', locator: 'line 23', micros: Object.freeze({ marketing: 587985600, utility: 184090700, authentication: 184090700, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Nigeria', locator: 'line 24', micros: Object.freeze({ marketing: 189981600, utility: 24668100, authentication: 24668100, authentication_international: 276136000, service: 'unavailable' }) }),
                Object.freeze({ market: 'Pakistan', locator: 'line 25', micros: Object.freeze({ marketing: 174149800, utility: 36818100, authentication: 36818100, authentication_international: 276136000, service: 'unavailable' }) }),
                Object.freeze({ market: 'Peru', locator: 'line 26', micros: Object.freeze({ marketing: 258831500, utility: 73636300, authentication: 73636300, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Poland', locator: 'line 27', micros: Object.freeze({ marketing: 134754300, utility: 44918100, authentication: 44918100, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Qatar', locator: 'line 28', micros: Object.freeze({ marketing: 125549800, utility: 44181800, authentication: 44181800, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Romania', locator: 'line 29', micros: Object.freeze({ marketing: 316636000, utility: 106772500, authentication: 106772500, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Russia', locator: 'line 30', micros: Object.freeze({ marketing: 295281400, utility: 147272500, authentication: 147272500, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Saudi Arabia', locator: 'line 31', micros: Object.freeze({ marketing: 184458900, utility: 39395400, authentication: 39395400, authentication_international: 220172400, service: 'unavailable' }) }),
                Object.freeze({ market: 'Singapore', locator: 'line 32', micros: Object.freeze({ marketing: 269508700, utility: 58909000, authentication: 58909000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'South Africa', locator: 'line 33', micros: Object.freeze({ marketing: 139540700, utility: 27981800, authentication: 27981800, authentication_international: 73636300, service: 'unavailable' }) }),
                Object.freeze({ market: 'Spain', locator: 'line 34', micros: Object.freeze({ marketing: 260396200, utility: 73636300, authentication: 73636300, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Turkey', locator: 'line 35', micros: Object.freeze({ marketing: 40131800, utility: 3313600, authentication: 3313600, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'United Arab Emirates', locator: 'line 36', micros: Object.freeze({ marketing: 183722500, utility: 57804500, authentication: 57804500, authentication_international: 187772500, service: 'unavailable' }) }),
                Object.freeze({ market: 'United Kingdom', locator: 'line 37', micros: Object.freeze({ marketing: 233721500, utility: 80999900, authentication: 80999900, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'North America', aggregateKey: 'northAmerica', locator: 'line 38', micros: Object.freeze({ marketing: 92045300, utility: 12518200, authentication: 12518200, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Africa', aggregateKey: 'restOfAfrica', locator: 'line 39', micros: Object.freeze({ marketing: 82840800, utility: 14727300, authentication: 14727300, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Asia Pacific', aggregateKey: 'restOfAsiaPacific', locator: 'line 40', micros: Object.freeze({ marketing: 269508700, utility: 41604500, authentication: 41604500, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Central & Eastern Europe', aggregateKey: 'restOfCentralEasternEurope', locator: 'line 41', micros: Object.freeze({ marketing: 316636000, utility: 78054400, authentication: 78054400, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Latin America', aggregateKey: 'restOfLatinAmerica', locator: 'line 42', micros: Object.freeze({ marketing: 272454200, utility: 41604500, authentication: 41604500, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Middle East', aggregateKey: 'restOfMiddleEast', locator: 'line 43', micros: Object.freeze({ marketing: 125549800, utility: 33504500, authentication: 33504500, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Rest of Western Europe', aggregateKey: 'restOfWesternEurope', locator: 'line 44', micros: Object.freeze({ marketing: 217963400, utility: 62959000, authentication: 62959000, authentication_international: 'unavailable', service: 'unavailable' }) }),
                Object.freeze({ market: 'Other', aggregateKey: 'other', locator: 'line 45', micros: Object.freeze({ marketing: 222381500, utility: 28350000, authentication: 28350000, authentication_international: 'unavailable', service: 'unavailable' }) }),
            ]),
        }),
        Object.freeze({
            rateVersion: 'meta-ratecards-2026/USD/2026-10-01',
            currency: 'USD',
            effectiveFrom: '2026-10-01',
            sourceFile: 'meta-usd-rates-2026-10-01.xlsx',
            sourceSha256: '94913fa225da00935cd50a69a317373302d90afd47b57eeabb5e7cd64e78d867',
            headerLocator: 'row 4',
            entries: Object.freeze([
                Object.freeze({ market: 'Argentina', locator: 'row 5', micros: Object.freeze({ marketing: 61800, utility: 26000, authentication: 26000, authentication_international: 'unavailable', service: 26000 }) }),
                Object.freeze({ market: 'Bangladesh', locator: 'row 6', micros: Object.freeze({ marketing: 73200, utility: 3700, authentication: 3700, authentication_international: 96000, service: 3700 }) }),
                Object.freeze({ market: 'Brazil', locator: 'row 7', micros: Object.freeze({ marketing: 62500, utility: 6800, authentication: 6800, authentication_international: 'unavailable', service: 6800 }) }),
                Object.freeze({ market: 'Chile', locator: 'row 8', micros: Object.freeze({ marketing: 88900, utility: 20000, authentication: 20000, authentication_international: 'unavailable', service: 20000 }) }),
                Object.freeze({ market: 'Colombia', locator: 'row 9', micros: Object.freeze({ marketing: 12500, utility: 800, authentication: 800, authentication_international: 'unavailable', service: 800 }) }),
                Object.freeze({ market: 'Egypt', locator: 'row 10', micros: Object.freeze({ marketing: 64400, utility: 3600, authentication: 3600, authentication_international: 65000, service: 3600 }) }),
                Object.freeze({ market: 'France', locator: 'row 11', micros: Object.freeze({ marketing: 85900, utility: 30000, authentication: 30000, authentication_international: 'unavailable', service: 30000 }) }),
                Object.freeze({ market: 'Germany', locator: 'row 12', micros: Object.freeze({ marketing: 136500, utility: 55000, authentication: 55000, authentication_international: 'unavailable', service: 55000 }) }),
                Object.freeze({ market: 'Hong Kong', locator: 'row 13', micros: Object.freeze({ marketing: 73200, utility: 26000, authentication: 26000, authentication_international: 'unavailable', service: 26000 }) }),
                Object.freeze({ market: 'Hungary', locator: 'row 14', micros: Object.freeze({ marketing: 86000, utility: 35000, authentication: 35000, authentication_international: 'unavailable', service: 35000 }) }),
                Object.freeze({ market: 'India', locator: 'row 15', micros: Object.freeze({ marketing: 11800, utility: 1400, authentication: 1400, authentication_international: 30400, service: 1400 }) }),
                Object.freeze({ market: 'Indonesia', locator: 'row 16', micros: Object.freeze({ marketing: 41100, utility: 25000, authentication: 25000, authentication_international: 136000, service: 25000 }) }),
                Object.freeze({ market: 'Iraq', locator: 'row 17', micros: Object.freeze({ marketing: 34100, utility: 7900, authentication: 7900, authentication_international: 128000, service: 7900 }) }),
                Object.freeze({ market: 'Israel', locator: 'row 18', micros: Object.freeze({ marketing: 35300, utility: 5300, authentication: 5300, authentication_international: 'unavailable', service: 5300 }) }),
                Object.freeze({ market: 'Italy', locator: 'row 19', micros: Object.freeze({ marketing: 79500, utility: 30000, authentication: 30000, authentication_international: 'unavailable', service: 30000 }) }),
                Object.freeze({ market: 'Kazakhstan', locator: 'row 20', micros: Object.freeze({ marketing: 60400, utility: 18000, authentication: 18000, authentication_international: 160000, service: 18000 }) }),
                Object.freeze({ market: 'Kuwait', locator: 'row 21', micros: Object.freeze({ marketing: 79200, utility: 44000, authentication: 44000, authentication_international: 120000, service: 44000 }) }),
                Object.freeze({ market: 'Malaysia', locator: 'row 22', micros: Object.freeze({ marketing: 86000, utility: 14000, authentication: 14000, authentication_international: 41800, service: 14000 }) }),
                Object.freeze({ market: 'Mexico', locator: 'row 23', micros: Object.freeze({ marketing: 39700, utility: 8500, authentication: 8500, authentication_international: 'unavailable', service: 8500 }) }),
                Object.freeze({ market: 'Morocco', locator: 'row 24', micros: Object.freeze({ marketing: 41400, utility: 23000, authentication: 23000, authentication_international: 81100, service: 23000 }) }),
                Object.freeze({ market: 'Netherlands', locator: 'row 25', micros: Object.freeze({ marketing: 159700, utility: 50000, authentication: 50000, authentication_international: 'unavailable', service: 50000 }) }),
                Object.freeze({ market: 'Nepal', locator: 'row 26', micros: Object.freeze({ marketing: 73200, utility: 3400, authentication: 3400, authentication_international: 112000, service: 3400 }) }),
                Object.freeze({ market: 'Nigeria', locator: 'row 27', micros: Object.freeze({ marketing: 51600, utility: 6700, authentication: 6700, authentication_international: 75000, service: 6700 }) }),
                Object.freeze({ market: 'Oman', locator: 'row 28', micros: Object.freeze({ marketing: 34100, utility: 24700, authentication: 24700, authentication_international: 60000, service: 24700 }) }),
                Object.freeze({ market: 'Pakistan', locator: 'row 29', micros: Object.freeze({ marketing: 47300, utility: 15000, authentication: 15000, authentication_international: 75000, service: 15000 }) }),
                Object.freeze({ market: 'Peru', locator: 'row 30', micros: Object.freeze({ marketing: 70300, utility: 30000, authentication: 30000, authentication_international: 'unavailable', service: 30000 }) }),
                Object.freeze({ market: 'Poland', locator: 'row 31', micros: Object.freeze({ marketing: 36600, utility: 12200, authentication: 12200, authentication_international: 'unavailable', service: 12200 }) }),
                Object.freeze({ market: 'Qatar', locator: 'row 32', micros: Object.freeze({ marketing: 34100, utility: 12000, authentication: 12000, authentication_international: 'unavailable', service: 12000 }) }),
                Object.freeze({ market: 'Romania', locator: 'row 33', micros: Object.freeze({ marketing: 86000, utility: 29000, authentication: 29000, authentication_international: 'unavailable', service: 29000 }) }),
                Object.freeze({ market: 'Russia', locator: 'row 34', micros: Object.freeze({ marketing: 80200, utility: 40000, authentication: 40000, authentication_international: 'unavailable', service: 40000 }) }),
                Object.freeze({ market: 'Saudi Arabia', locator: 'row 35', micros: Object.freeze({ marketing: 57600, utility: 10700, authentication: 10700, authentication_international: 59800, service: 10700 }) }),
                Object.freeze({ market: 'Singapore', locator: 'row 36', micros: Object.freeze({ marketing: 73200, utility: 16000, authentication: 16000, authentication_international: 'unavailable', service: 16000 }) }),
                Object.freeze({ market: 'South Africa', locator: 'row 37', micros: Object.freeze({ marketing: 37900, utility: 9500, authentication: 9500, authentication_international: 20000, service: 9500 }) }),
                Object.freeze({ market: 'Spain', locator: 'row 38', micros: Object.freeze({ marketing: 70700, utility: 20000, authentication: 20000, authentication_international: 'unavailable', service: 20000 }) }),
                Object.freeze({ market: 'Sri Lanka', locator: 'row 39', micros: Object.freeze({ marketing: 73200, utility: 2000, authentication: 2000, authentication_international: 144000, service: 2000 }) }),
                Object.freeze({ market: 'Turkey', locator: 'row 40', micros: Object.freeze({ marketing: 10900, utility: 900, authentication: 900, authentication_international: 'unavailable', service: 900 }) }),
                Object.freeze({ market: 'Ukraine', locator: 'row 41', micros: Object.freeze({ marketing: 86000, utility: 29800, authentication: 29800, authentication_international: 74600, service: 29800 }) }),
                Object.freeze({ market: 'United Arab Emirates', locator: 'row 42', micros: Object.freeze({ marketing: 57600, utility: 15700, authentication: 15700, authentication_international: 51000, service: 15700 }) }),
                Object.freeze({ market: 'United Kingdom', locator: 'row 43', micros: Object.freeze({ marketing: 63500, utility: 22000, authentication: 22000, authentication_international: 'unavailable', service: 22000 }) }),
                Object.freeze({ market: 'North America', aggregateKey: 'northAmerica', locator: 'row 44', micros: Object.freeze({ marketing: 25000, utility: 3400, authentication: 3400, authentication_international: 'unavailable', service: 3400 }) }),
                Object.freeze({ market: 'Rest of Africa', aggregateKey: 'restOfAfrica', locator: 'row 45', micros: Object.freeze({ marketing: 22500, utility: 4000, authentication: 4000, authentication_international: 'unavailable', service: 4000 }) }),
                Object.freeze({ market: 'Rest of Asia Pacific', aggregateKey: 'restOfAsiaPacific', locator: 'row 46', micros: Object.freeze({ marketing: 84200, utility: 11300, authentication: 11300, authentication_international: 'unavailable', service: 11300 }) }),
                Object.freeze({ market: 'Rest of Central & Eastern Europe', aggregateKey: 'restOfCentralEasternEurope', locator: 'row 47', micros: Object.freeze({ marketing: 86000, utility: 21200, authentication: 21200, authentication_international: 'unavailable', service: 21200 }) }),
                Object.freeze({ market: 'Rest of Latin America', aggregateKey: 'restOfLatinAmerica', locator: 'row 48', micros: Object.freeze({ marketing: 74000, utility: 11300, authentication: 11300, authentication_international: 'unavailable', service: 11300 }) }),
                Object.freeze({ market: 'Rest of Middle East', aggregateKey: 'restOfMiddleEast', locator: 'row 49', micros: Object.freeze({ marketing: 39200, utility: 9100, authentication: 9100, authentication_international: 'unavailable', service: 9100 }) }),
                Object.freeze({ market: 'Rest of Western Europe', aggregateKey: 'restOfWesternEurope', locator: 'row 50', micros: Object.freeze({ marketing: 59200, utility: 17100, authentication: 17100, authentication_international: 'unavailable', service: 17100 }) }),
                Object.freeze({ market: 'Other', aggregateKey: 'other', locator: 'row 51', micros: Object.freeze({ marketing: 60400, utility: 7700, authentication: 7700, authentication_international: 'unavailable', service: 7700 }) }),
            ]),
        }),
        Object.freeze({
            rateVersion: 'meta-ratecards-2026/COP/2026-10-01',
            currency: 'COP',
            effectiveFrom: '2026-10-01',
            sourceFile: 'meta-cop-rates-2026-10-01.xlsx',
            sourceSha256: 'cd9fe8d22a7a9d0ca7cfeffb333df4863faf18a46625c36503be530df58b3c7c',
            headerLocator: 'row 4',
            entries: Object.freeze([
                Object.freeze({ market: 'Argentina', locator: 'row 5', micros: Object.freeze({ marketing: 227536100, utility: 95727100, authentication: 95727100, authentication_international: 'unavailable', service: 95727100 }) }),
                Object.freeze({ market: 'Bangladesh', locator: 'row 6', micros: Object.freeze({ marketing: 269508700, utility: 13622700, authentication: 13622700, authentication_international: 353454200, service: 13622700 }) }),
                Object.freeze({ market: 'Brazil', locator: 'row 7', micros: Object.freeze({ marketing: 230113300, utility: 25036300, authentication: 25036300, authentication_international: 'unavailable', service: 25036300 }) }),
                Object.freeze({ market: 'Chile', locator: 'row 8', micros: Object.freeze({ marketing: 327313200, utility: 73636300, authentication: 73636300, authentication_international: 'unavailable', service: 73636300 }) }),
                Object.freeze({ market: 'Colombia', locator: 'row 9', micros: Object.freeze({ marketing: 46022700, utility: 2945500, authentication: 2945500, authentication_international: 'unavailable', service: 2945500 }) }),
                Object.freeze({ market: 'Egypt', locator: 'row 10', micros: Object.freeze({ marketing: 237108800, utility: 13254500, authentication: 13254500, authentication_international: 239317900, service: 13254500 }) }),
                Object.freeze({ market: 'France', locator: 'row 11', micros: Object.freeze({ marketing: 316267800, utility: 110454400, authentication: 110454400, authentication_international: 'unavailable', service: 110454400 }) }),
                Object.freeze({ market: 'Germany', locator: 'row 12', micros: Object.freeze({ marketing: 502567500, utility: 202499700, authentication: 202499700, authentication_international: 'unavailable', service: 202499700 }) }),
                Object.freeze({ market: 'Hong Kong', locator: 'row 13', micros: Object.freeze({ marketing: 269508700, utility: 95727200, authentication: 95727200, authentication_international: 'unavailable', service: 95727200 }) }),
                Object.freeze({ market: 'Hungary', locator: 'row 14', micros: Object.freeze({ marketing: 316636000, utility: 128863400, authentication: 128863400, authentication_international: 'unavailable', service: 128863400 }) }),
                Object.freeze({ market: 'India', locator: 'row 15', micros: Object.freeze({ marketing: 43445400, utility: 5154500, authentication: 5154500, authentication_international: 111927100, service: 5154500 }) }),
                Object.freeze({ market: 'Indonesia', locator: 'row 16', micros: Object.freeze({ marketing: 151322500, utility: 92045300, authentication: 92045300, authentication_international: 500726600, service: 92045300 }) }),
                Object.freeze({ market: 'Iraq', locator: 'row 17', micros: Object.freeze({ marketing: 125549800, utility: 29086300, authentication: 29086300, authentication_international: 471272100, service: 29086300 }) }),
                Object.freeze({ market: 'Israel', locator: 'row 18', micros: Object.freeze({ marketing: 129968000, utility: 19513600, authentication: 19513600, authentication_international: 'unavailable', service: 19513600 }) }),
                Object.freeze({ market: 'Italy', locator: 'row 19', micros: Object.freeze({ marketing: 292575300, utility: 110454400, authentication: 110454400, authentication_international: 'unavailable', service: 110454400 }) }),
                Object.freeze({ market: 'Kazakhstan', locator: 'row 20', micros: Object.freeze({ marketing: 222381500, utility: 66272700, authentication: 66272700, authentication_international: 589090900, service: 66272700 }) }),
                Object.freeze({ market: 'Kuwait', locator: 'row 21', micros: Object.freeze({ marketing: 291652200, utility: 161999800, authentication: 161999800, authentication_international: 441817600, service: 161999800 }) }),
                Object.freeze({ market: 'Malaysia', locator: 'row 22', micros: Object.freeze({ marketing: 316636000, utility: 51545400, authentication: 51545400, authentication_international: 153899800, service: 51545400 }) }),
                Object.freeze({ market: 'Mexico', locator: 'row 23', micros: Object.freeze({ marketing: 145983900, utility: 31295400, authentication: 31295400, authentication_international: 'unavailable', service: 31295400 }) }),
                Object.freeze({ market: 'Morocco', locator: 'row 24', micros: Object.freeze({ marketing: 152427100, utility: 84682000, authentication: 84682000, authentication_international: 298596000, service: 84682000 }) }),
                Object.freeze({ market: 'Netherlands', locator: 'row 25', micros: Object.freeze({ marketing: 587985600, utility: 184090700, authentication: 184090700, authentication_international: 'unavailable', service: 184090700 }) }),
                Object.freeze({ market: 'Nepal', locator: 'row 26', micros: Object.freeze({ marketing: 269508700, utility: 12518200, authentication: 12518200, authentication_international: 412363200, service: 12518200 }) }),
                Object.freeze({ market: 'Nigeria', locator: 'row 27', micros: Object.freeze({ marketing: 189981600, utility: 24668100, authentication: 24668100, authentication_international: 276136000, service: 24668100 }) }),
                Object.freeze({ market: 'Oman', locator: 'row 28', micros: Object.freeze({ marketing: 125549800, utility: 90940800, authentication: 90940800, authentication_international: 220908800, service: 90940800 }) }),
                Object.freeze({ market: 'Pakistan', locator: 'row 29', micros: Object.freeze({ marketing: 174149800, utility: 55227200, authentication: 55227200, authentication_international: 276136000, service: 55227200 }) }),
                Object.freeze({ market: 'Peru', locator: 'row 30', micros: Object.freeze({ marketing: 258831500, utility: 110454500, authentication: 110454500, authentication_international: 'unavailable', service: 110454500 }) }),
                Object.freeze({ market: 'Poland', locator: 'row 31', micros: Object.freeze({ marketing: 134754300, utility: 44918100, authentication: 44918100, authentication_international: 'unavailable', service: 44918100 }) }),
                Object.freeze({ market: 'Qatar', locator: 'row 32', micros: Object.freeze({ marketing: 125549800, utility: 44181800, authentication: 44181800, authentication_international: 'unavailable', service: 44181800 }) }),
                Object.freeze({ market: 'Romania', locator: 'row 33', micros: Object.freeze({ marketing: 316636000, utility: 106772500, authentication: 106772500, authentication_international: 'unavailable', service: 106772500 }) }),
                Object.freeze({ market: 'Russia', locator: 'row 34', micros: Object.freeze({ marketing: 295281400, utility: 147272500, authentication: 147272500, authentication_international: 'unavailable', service: 147272500 }) }),
                Object.freeze({ market: 'Saudi Arabia', locator: 'row 35', micros: Object.freeze({ marketing: 212127700, utility: 39395400, authentication: 39395400, authentication_international: 220172400, service: 39395400 }) }),
                Object.freeze({ market: 'Singapore', locator: 'row 36', micros: Object.freeze({ marketing: 269508700, utility: 58909000, authentication: 58909000, authentication_international: 'unavailable', service: 58909000 }) }),
                Object.freeze({ market: 'South Africa', locator: 'row 37', micros: Object.freeze({ marketing: 139540700, utility: 34977300, authentication: 34977300, authentication_international: 73636300, service: 34977300 }) }),
                Object.freeze({ market: 'Spain', locator: 'row 38', micros: Object.freeze({ marketing: 260396200, utility: 73636300, authentication: 73636300, authentication_international: 'unavailable', service: 73636300 }) }),
                Object.freeze({ market: 'Sri Lanka', locator: 'row 39', micros: Object.freeze({ marketing: 269508700, utility: 7363600, authentication: 7363600, authentication_international: 530181200, service: 7363600 }) }),
                Object.freeze({ market: 'Turkey', locator: 'row 40', micros: Object.freeze({ marketing: 40131800, utility: 3313600, authentication: 3313600, authentication_international: 'unavailable', service: 3313600 }) }),
                Object.freeze({ market: 'Ukraine', locator: 'row 41', micros: Object.freeze({ marketing: 316636000, utility: 109718000, authentication: 109718000, authentication_international: 274663100, service: 109718000 }) }),
                Object.freeze({ market: 'United Arab Emirates', locator: 'row 42', micros: Object.freeze({ marketing: 212127700, utility: 57804500, authentication: 57804500, authentication_international: 187772500, service: 57804500 }) }),
                Object.freeze({ market: 'United Kingdom', locator: 'row 43', micros: Object.freeze({ marketing: 233721500, utility: 80999900, authentication: 80999900, authentication_international: 'unavailable', service: 80999900 }) }),
                Object.freeze({ market: 'North America', aggregateKey: 'northAmerica', locator: 'row 44', micros: Object.freeze({ marketing: 92045300, utility: 12518200, authentication: 12518200, authentication_international: 'unavailable', service: 12518200 }) }),
                Object.freeze({ market: 'Rest of Africa', aggregateKey: 'restOfAfrica', locator: 'row 45', micros: Object.freeze({ marketing: 82840800, utility: 14727300, authentication: 14727300, authentication_international: 'unavailable', service: 14727300 }) }),
                Object.freeze({ market: 'Rest of Asia Pacific', aggregateKey: 'restOfAsiaPacific', locator: 'row 46', micros: Object.freeze({ marketing: 309935000, utility: 41604500, authentication: 41604500, authentication_international: 'unavailable', service: 41604500 }) }),
                Object.freeze({ market: 'Rest of Central & Eastern Europe', aggregateKey: 'restOfCentralEasternEurope', locator: 'row 47', micros: Object.freeze({ marketing: 316636000, utility: 78054400, authentication: 78054400, authentication_international: 'unavailable', service: 78054400 }) }),
                Object.freeze({ market: 'Rest of Latin America', aggregateKey: 'restOfLatinAmerica', locator: 'row 48', micros: Object.freeze({ marketing: 272454200, utility: 41604500, authentication: 41604500, authentication_international: 'unavailable', service: 41604500 }) }),
                Object.freeze({ market: 'Rest of Middle East', aggregateKey: 'restOfMiddleEast', locator: 'row 49', micros: Object.freeze({ marketing: 144382300, utility: 33504500, authentication: 33504500, authentication_international: 'unavailable', service: 33504500 }) }),
                Object.freeze({ market: 'Rest of Western Europe', aggregateKey: 'restOfWesternEurope', locator: 'row 50', micros: Object.freeze({ marketing: 217963400, utility: 62959000, authentication: 62959000, authentication_international: 'unavailable', service: 62959000 }) }),
                Object.freeze({ market: 'Other', aggregateKey: 'other', locator: 'row 51', micros: Object.freeze({ marketing: 222381500, utility: 28350000, authentication: 28350000, authentication_international: 'unavailable', service: 28350000 }) }),
            ]),
        }),
    ]),
});
