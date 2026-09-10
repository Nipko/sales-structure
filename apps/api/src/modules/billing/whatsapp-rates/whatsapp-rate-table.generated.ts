/*
 * DERIVED FILE — do not edit by hand.
 *
 * Regenerate:  node apps/api/scripts/generate-whatsapp-rates.cjs
 * Verify:      node apps/api/scripts/generate-whatsapp-rates.cjs --check
 *
 * Every number below was read from a preserved official rate card whose
 * SHA-256 was verified against the manifest, and carries the file and the line
 * or spreadsheet row it came from. `'unavailable'` is what the card printed as
 * `n/a`: a rate that could not be established, which is not the same thing as a
 * rate of zero and must never be treated as one.
 *
 * Prices are integer MICRO-UNITS: millionths of one whole unit of the currency
 * (1 USD = 1_000_000 micros). Every published rate has at most four decimal
 * places, so micro-units carry all of them exactly with two orders of magnitude
 * to spare, and no float is involved at any point.
 */

/** A price the card did not state. Never coerce this to a number. */
export type UnavailableRate = 'unavailable';

export type WhatsAppMessageCategory =
    | 'marketing'
    | 'utility'
    | 'authentication'
    | 'authentication_international'
    | 'service';

export const WHATSAPP_MESSAGE_CATEGORIES: readonly WhatsAppMessageCategory[] = Object.freeze([
    'marketing',
    'utility',
    'authentication',
    'authentication_international',
    'service',
]);

/** Micro-units per whole currency unit. The exponent this table is written in. */
export const MICROS_PER_UNIT = 1000000 as const;

export interface WhatsAppRateCardEntry {
    readonly market: string;
    /** Micro-units per delivered message, by category. */
    readonly micros: Readonly<Record<WhatsAppMessageCategory, number | UnavailableRate>>;
    /** Where in the source file this row is, for a dispute later. */
    readonly locator: string;
}

export interface WhatsAppRateCard {
    /** Names which card answered, so a price can be argued with. */
    readonly rateVersion: string;
    /** The currency of the WhatsApp account being billed. */
    readonly currency: string;
    /** Applies from midnight of this date IN THE WABA TIME ZONE. */
    readonly effectiveFrom: string;
    readonly sourceFile: string;
    readonly sourceSha256: string;
    readonly sourceUrl: string;
    readonly headerLocator: string;
    readonly entries: readonly WhatsAppRateCardEntry[];
}

/** Identifies the sources this table was derived from, content-addressed. */
export const WHATSAPP_RATE_TABLE_VERSION = 'meta-ratecards-2026@cdc5b132567ab1e7' as const;

export const WHATSAPP_RATE_CARDS: readonly WhatsAppRateCard[] = Object.freeze([
    {
        rateVersion: 'meta-ratecards-2026/USD/2026-07-01',
        currency: 'USD',
        effectiveFrom: '2026-07-01',
        sourceFile: 'meta-usd-rates-2026-07-01.csv',
        sourceSha256: '9aa0fcb64bd1455aa010b5738a3eca90d290f09ae1a71a153d0d148348408ffa',
        sourceUrl: 'https://scontent.fbog23-1.fna.fbcdn.net/v/t39.8562-6/735608455_876449615529066_702006520977041900_n.csv?_nc_cat=100&ccb=1-7&_nc_sid=b8d81d&_nc_ohc=6eDV8zVUjGUQ7kNvwEuc9VX&_nc_oc=AdqxD-b1KeokRbHMACpd-WCej71iqEz_qqd6WgBlZu-4Y8ROGaiyWrL9X7kO-NsddTA&_nc_zt=14&_nc_ht=scontent.fbog23-1.fna&_nc_gid=jyzMPmIqxWJLMFEO1j5-ng&_nc_ss=7a289&oh=00_AQIpnAVbrSLY1r8n10FeC9paOe1QxAyTA9oBidoEppjZLg&oe=6AA87FCA',
        headerLocator: 'line 6',
        entries: Object.freeze([
            { market: 'Argentina', locator: 'line 8', micros: Object.freeze({ marketing: 61800, utility: 26000, authentication: 26000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Brazil', locator: 'line 9', micros: Object.freeze({ marketing: 62500, utility: 6800, authentication: 6800, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Chile', locator: 'line 10', micros: Object.freeze({ marketing: 88900, utility: 20000, authentication: 20000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Colombia', locator: 'line 11', micros: Object.freeze({ marketing: 12500, utility: 800, authentication: 800, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Egypt', locator: 'line 12', micros: Object.freeze({ marketing: 64400, utility: 3600, authentication: 3600, authentication_international: 65000, service: 'unavailable' }) },
            { market: 'France', locator: 'line 13', micros: Object.freeze({ marketing: 85900, utility: 30000, authentication: 30000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Germany', locator: 'line 14', micros: Object.freeze({ marketing: 136500, utility: 55000, authentication: 55000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Hong Kong', locator: 'line 15', micros: Object.freeze({ marketing: 73200, utility: 26000, authentication: 26000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Hungary', locator: 'line 16', micros: Object.freeze({ marketing: 86000, utility: 35000, authentication: 35000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'India', locator: 'line 17', micros: Object.freeze({ marketing: 11800, utility: 1400, authentication: 1400, authentication_international: 30400, service: 'unavailable' }) },
            { market: 'Indonesia', locator: 'line 18', micros: Object.freeze({ marketing: 41100, utility: 25000, authentication: 25000, authentication_international: 136000, service: 'unavailable' }) },
            { market: 'Israel', locator: 'line 19', micros: Object.freeze({ marketing: 35300, utility: 5300, authentication: 5300, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Italy', locator: 'line 20', micros: Object.freeze({ marketing: 79500, utility: 30000, authentication: 30000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Malaysia', locator: 'line 21', micros: Object.freeze({ marketing: 86000, utility: 14000, authentication: 14000, authentication_international: 41800, service: 'unavailable' }) },
            { market: 'Mexico', locator: 'line 22', micros: Object.freeze({ marketing: 30500, utility: 8500, authentication: 8500, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Netherlands', locator: 'line 23', micros: Object.freeze({ marketing: 159700, utility: 50000, authentication: 50000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Nigeria', locator: 'line 24', micros: Object.freeze({ marketing: 51600, utility: 6700, authentication: 6700, authentication_international: 75000, service: 'unavailable' }) },
            { market: 'Pakistan', locator: 'line 25', micros: Object.freeze({ marketing: 47300, utility: 10000, authentication: 10000, authentication_international: 75000, service: 'unavailable' }) },
            { market: 'Peru', locator: 'line 26', micros: Object.freeze({ marketing: 70300, utility: 20000, authentication: 20000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Poland', locator: 'line 27', micros: Object.freeze({ marketing: 36600, utility: 12200, authentication: 12200, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Qatar', locator: 'line 28', micros: Object.freeze({ marketing: 34100, utility: 12000, authentication: 12000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Romania', locator: 'line 29', micros: Object.freeze({ marketing: 86000, utility: 29000, authentication: 29000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Russia', locator: 'line 30', micros: Object.freeze({ marketing: 80200, utility: 40000, authentication: 40000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Saudi Arabia', locator: 'line 31', micros: Object.freeze({ marketing: 50100, utility: 10700, authentication: 10700, authentication_international: 59800, service: 'unavailable' }) },
            { market: 'Singapore', locator: 'line 32', micros: Object.freeze({ marketing: 73200, utility: 16000, authentication: 16000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'South Africa', locator: 'line 33', micros: Object.freeze({ marketing: 37900, utility: 7600, authentication: 7600, authentication_international: 20000, service: 'unavailable' }) },
            { market: 'Spain', locator: 'line 34', micros: Object.freeze({ marketing: 70700, utility: 20000, authentication: 20000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Turkey', locator: 'line 35', micros: Object.freeze({ marketing: 10900, utility: 900, authentication: 900, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'United Arab Emirates', locator: 'line 36', micros: Object.freeze({ marketing: 49900, utility: 15700, authentication: 15700, authentication_international: 51000, service: 'unavailable' }) },
            { market: 'United Kingdom', locator: 'line 37', micros: Object.freeze({ marketing: 63500, utility: 22000, authentication: 22000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'North America', locator: 'line 38', micros: Object.freeze({ marketing: 25000, utility: 3400, authentication: 3400, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Africa', locator: 'line 39', micros: Object.freeze({ marketing: 22500, utility: 4000, authentication: 4000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Asia Pacific', locator: 'line 40', micros: Object.freeze({ marketing: 73200, utility: 11300, authentication: 11300, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Central & Eastern Europe', locator: 'line 41', micros: Object.freeze({ marketing: 86000, utility: 21200, authentication: 21200, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Latin America', locator: 'line 42', micros: Object.freeze({ marketing: 74000, utility: 11300, authentication: 11300, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Middle East', locator: 'line 43', micros: Object.freeze({ marketing: 34100, utility: 9100, authentication: 9100, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Western Europe', locator: 'line 44', micros: Object.freeze({ marketing: 59200, utility: 17100, authentication: 17100, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Other', locator: 'line 45', micros: Object.freeze({ marketing: 60400, utility: 7700, authentication: 7700, authentication_international: 'unavailable', service: 'unavailable' }) },
        ]),
    },
    {
        rateVersion: 'meta-ratecards-2026/COP/2026-07-01',
        currency: 'COP',
        effectiveFrom: '2026-07-01',
        sourceFile: 'meta-cop-rates-2026-07-01.csv',
        sourceSha256: 'a28188877b14ec23420e0d22fc5898beace2ab09272ef3696c1d63f6a0f09bc5',
        sourceUrl: 'https://scontent.fbog23-1.fna.fbcdn.net/v/t39.8562-6/735482743_2296023081140804_2474258772751213192_n.csv?_nc_cat=110&ccb=1-7&_nc_sid=b8d81d&_nc_ohc=vWv2DSfOKJgQ7kNvwGHAyGr&_nc_oc=AdpePGMVbpuYQpmuf80RAADON0S8li0EElPEJsLpm5UP6qQ2sK0_O7tY_GTiSl_ow98&_nc_zt=14&_nc_ht=scontent.fbog23-1.fna&_nc_gid=jyzMPmIqxWJLMFEO1j5-ng&_nc_ss=7a289&oh=00_AQLPSVIFTbTVODCw6UxdEIwJxuUwtNNgSi3Odl-uwifnZw&oe=6AA88EB1',
        headerLocator: 'line 6',
        entries: Object.freeze([
            { market: 'Argentina', locator: 'line 8', micros: Object.freeze({ marketing: 227536100, utility: 95727100, authentication: 95727100, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Brazil', locator: 'line 9', micros: Object.freeze({ marketing: 230113300, utility: 25036300, authentication: 25036300, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Chile', locator: 'line 10', micros: Object.freeze({ marketing: 327313200, utility: 73636300, authentication: 73636300, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Colombia', locator: 'line 11', micros: Object.freeze({ marketing: 46022700, utility: 2945500, authentication: 2945500, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Egypt', locator: 'line 12', micros: Object.freeze({ marketing: 237108800, utility: 13254500, authentication: 13254500, authentication_international: 239317900, service: 'unavailable' }) },
            { market: 'France', locator: 'line 13', micros: Object.freeze({ marketing: 316267800, utility: 110454400, authentication: 110454400, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Germany', locator: 'line 14', micros: Object.freeze({ marketing: 502567500, utility: 202499700, authentication: 202499700, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Hong Kong', locator: 'line 15', micros: Object.freeze({ marketing: 269508700, utility: 95727200, authentication: 95727200, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Hungary', locator: 'line 16', micros: Object.freeze({ marketing: 316636000, utility: 128863400, authentication: 128863400, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'India', locator: 'line 17', micros: Object.freeze({ marketing: 43445400, utility: 5154500, authentication: 5154500, authentication_international: 111927100, service: 'unavailable' }) },
            { market: 'Indonesia', locator: 'line 18', micros: Object.freeze({ marketing: 151322500, utility: 92045300, authentication: 92045300, authentication_international: 500726600, service: 'unavailable' }) },
            { market: 'Israel', locator: 'line 19', micros: Object.freeze({ marketing: 129968000, utility: 19513600, authentication: 19513600, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Italy', locator: 'line 20', micros: Object.freeze({ marketing: 292575300, utility: 110454400, authentication: 110454400, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Malaysia', locator: 'line 21', micros: Object.freeze({ marketing: 316636000, utility: 51545400, authentication: 51545400, authentication_international: 153899800, service: 'unavailable' }) },
            { market: 'Mexico', locator: 'line 22', micros: Object.freeze({ marketing: 112295300, utility: 31295400, authentication: 31295400, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Netherlands', locator: 'line 23', micros: Object.freeze({ marketing: 587985600, utility: 184090700, authentication: 184090700, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Nigeria', locator: 'line 24', micros: Object.freeze({ marketing: 189981600, utility: 24668100, authentication: 24668100, authentication_international: 276136000, service: 'unavailable' }) },
            { market: 'Pakistan', locator: 'line 25', micros: Object.freeze({ marketing: 174149800, utility: 36818100, authentication: 36818100, authentication_international: 276136000, service: 'unavailable' }) },
            { market: 'Peru', locator: 'line 26', micros: Object.freeze({ marketing: 258831500, utility: 73636300, authentication: 73636300, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Poland', locator: 'line 27', micros: Object.freeze({ marketing: 134754300, utility: 44918100, authentication: 44918100, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Qatar', locator: 'line 28', micros: Object.freeze({ marketing: 125549800, utility: 44181800, authentication: 44181800, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Romania', locator: 'line 29', micros: Object.freeze({ marketing: 316636000, utility: 106772500, authentication: 106772500, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Russia', locator: 'line 30', micros: Object.freeze({ marketing: 295281400, utility: 147272500, authentication: 147272500, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Saudi Arabia', locator: 'line 31', micros: Object.freeze({ marketing: 184458900, utility: 39395400, authentication: 39395400, authentication_international: 220172400, service: 'unavailable' }) },
            { market: 'Singapore', locator: 'line 32', micros: Object.freeze({ marketing: 269508700, utility: 58909000, authentication: 58909000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'South Africa', locator: 'line 33', micros: Object.freeze({ marketing: 139540700, utility: 27981800, authentication: 27981800, authentication_international: 73636300, service: 'unavailable' }) },
            { market: 'Spain', locator: 'line 34', micros: Object.freeze({ marketing: 260396200, utility: 73636300, authentication: 73636300, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Turkey', locator: 'line 35', micros: Object.freeze({ marketing: 40131800, utility: 3313600, authentication: 3313600, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'United Arab Emirates', locator: 'line 36', micros: Object.freeze({ marketing: 183722500, utility: 57804500, authentication: 57804500, authentication_international: 187772500, service: 'unavailable' }) },
            { market: 'United Kingdom', locator: 'line 37', micros: Object.freeze({ marketing: 233721500, utility: 80999900, authentication: 80999900, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'North America', locator: 'line 38', micros: Object.freeze({ marketing: 92045300, utility: 12518200, authentication: 12518200, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Africa', locator: 'line 39', micros: Object.freeze({ marketing: 82840800, utility: 14727300, authentication: 14727300, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Asia Pacific', locator: 'line 40', micros: Object.freeze({ marketing: 269508700, utility: 41604500, authentication: 41604500, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Central & Eastern Europe', locator: 'line 41', micros: Object.freeze({ marketing: 316636000, utility: 78054400, authentication: 78054400, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Latin America', locator: 'line 42', micros: Object.freeze({ marketing: 272454200, utility: 41604500, authentication: 41604500, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Middle East', locator: 'line 43', micros: Object.freeze({ marketing: 125549800, utility: 33504500, authentication: 33504500, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Rest of Western Europe', locator: 'line 44', micros: Object.freeze({ marketing: 217963400, utility: 62959000, authentication: 62959000, authentication_international: 'unavailable', service: 'unavailable' }) },
            { market: 'Other', locator: 'line 45', micros: Object.freeze({ marketing: 222381500, utility: 28350000, authentication: 28350000, authentication_international: 'unavailable', service: 'unavailable' }) },
        ]),
    },
    {
        rateVersion: 'meta-ratecards-2026/USD/2026-10-01',
        currency: 'USD',
        effectiveFrom: '2026-10-01',
        sourceFile: 'meta-usd-rates-2026-10-01.xlsx',
        sourceSha256: '94913fa225da00935cd50a69a317373302d90afd47b57eeabb5e7cd64e78d867',
        sourceUrl: 'https://scontent.fbog23-1.fna.fbcdn.net/v/t39.8562-6/789612890_1382606183999337_7470194220917189092_n.csv?_nc_cat=110&ccb=1-7&_nc_sid=b8d81d&_nc_ohc=VwBrRKSLaTMQ7kNvwGGpBru&_nc_oc=Adpri_GpzCh00X95QTs0xT1yDuEVP2jQaaIJCBrKQRFzjjqswP7kOdYK6nOYzQGNv1k&_nc_zt=14&_nc_ht=scontent.fbog23-1.fna&_nc_gid=jyzMPmIqxWJLMFEO1j5-ng&_nc_ss=7a289&oh=00_AQLtTXNKRiYjQ3vf2EHa4EliyBHuiDu21ilotxF-wytXCw&oe=6AA89950',
        headerLocator: 'row 4',
        entries: Object.freeze([
            { market: 'Argentina', locator: 'row 5', micros: Object.freeze({ marketing: 61800, utility: 26000, authentication: 26000, authentication_international: 'unavailable', service: 26000 }) },
            { market: 'Bangladesh', locator: 'row 6', micros: Object.freeze({ marketing: 73200, utility: 3700, authentication: 3700, authentication_international: 96000, service: 3700 }) },
            { market: 'Brazil', locator: 'row 7', micros: Object.freeze({ marketing: 62500, utility: 6800, authentication: 6800, authentication_international: 'unavailable', service: 6800 }) },
            { market: 'Chile', locator: 'row 8', micros: Object.freeze({ marketing: 88900, utility: 20000, authentication: 20000, authentication_international: 'unavailable', service: 20000 }) },
            { market: 'Colombia', locator: 'row 9', micros: Object.freeze({ marketing: 12500, utility: 800, authentication: 800, authentication_international: 'unavailable', service: 800 }) },
            { market: 'Egypt', locator: 'row 10', micros: Object.freeze({ marketing: 64400, utility: 3600, authentication: 3600, authentication_international: 65000, service: 3600 }) },
            { market: 'France', locator: 'row 11', micros: Object.freeze({ marketing: 85900, utility: 30000, authentication: 30000, authentication_international: 'unavailable', service: 30000 }) },
            { market: 'Germany', locator: 'row 12', micros: Object.freeze({ marketing: 136500, utility: 55000, authentication: 55000, authentication_international: 'unavailable', service: 55000 }) },
            { market: 'Hong Kong', locator: 'row 13', micros: Object.freeze({ marketing: 73200, utility: 26000, authentication: 26000, authentication_international: 'unavailable', service: 26000 }) },
            { market: 'Hungary', locator: 'row 14', micros: Object.freeze({ marketing: 86000, utility: 35000, authentication: 35000, authentication_international: 'unavailable', service: 35000 }) },
            { market: 'India', locator: 'row 15', micros: Object.freeze({ marketing: 11800, utility: 1400, authentication: 1400, authentication_international: 30400, service: 1400 }) },
            { market: 'Indonesia', locator: 'row 16', micros: Object.freeze({ marketing: 41100, utility: 25000, authentication: 25000, authentication_international: 136000, service: 25000 }) },
            { market: 'Iraq', locator: 'row 17', micros: Object.freeze({ marketing: 34100, utility: 7900, authentication: 7900, authentication_international: 128000, service: 7900 }) },
            { market: 'Israel', locator: 'row 18', micros: Object.freeze({ marketing: 35300, utility: 5300, authentication: 5300, authentication_international: 'unavailable', service: 5300 }) },
            { market: 'Italy', locator: 'row 19', micros: Object.freeze({ marketing: 79500, utility: 30000, authentication: 30000, authentication_international: 'unavailable', service: 30000 }) },
            { market: 'Kazakhstan', locator: 'row 20', micros: Object.freeze({ marketing: 60400, utility: 18000, authentication: 18000, authentication_international: 160000, service: 18000 }) },
            { market: 'Kuwait', locator: 'row 21', micros: Object.freeze({ marketing: 79200, utility: 44000, authentication: 44000, authentication_international: 120000, service: 44000 }) },
            { market: 'Malaysia', locator: 'row 22', micros: Object.freeze({ marketing: 86000, utility: 14000, authentication: 14000, authentication_international: 41800, service: 14000 }) },
            { market: 'Mexico', locator: 'row 23', micros: Object.freeze({ marketing: 39700, utility: 8500, authentication: 8500, authentication_international: 'unavailable', service: 8500 }) },
            { market: 'Morocco', locator: 'row 24', micros: Object.freeze({ marketing: 41400, utility: 23000, authentication: 23000, authentication_international: 81100, service: 23000 }) },
            { market: 'Netherlands', locator: 'row 25', micros: Object.freeze({ marketing: 159700, utility: 50000, authentication: 50000, authentication_international: 'unavailable', service: 50000 }) },
            { market: 'Nepal', locator: 'row 26', micros: Object.freeze({ marketing: 73200, utility: 3400, authentication: 3400, authentication_international: 112000, service: 3400 }) },
            { market: 'Nigeria', locator: 'row 27', micros: Object.freeze({ marketing: 51600, utility: 6700, authentication: 6700, authentication_international: 75000, service: 6700 }) },
            { market: 'Oman', locator: 'row 28', micros: Object.freeze({ marketing: 34100, utility: 24700, authentication: 24700, authentication_international: 60000, service: 24700 }) },
            { market: 'Pakistan', locator: 'row 29', micros: Object.freeze({ marketing: 47300, utility: 15000, authentication: 15000, authentication_international: 75000, service: 15000 }) },
            { market: 'Peru', locator: 'row 30', micros: Object.freeze({ marketing: 70300, utility: 30000, authentication: 30000, authentication_international: 'unavailable', service: 30000 }) },
            { market: 'Poland', locator: 'row 31', micros: Object.freeze({ marketing: 36600, utility: 12200, authentication: 12200, authentication_international: 'unavailable', service: 12200 }) },
            { market: 'Qatar', locator: 'row 32', micros: Object.freeze({ marketing: 34100, utility: 12000, authentication: 12000, authentication_international: 'unavailable', service: 12000 }) },
            { market: 'Romania', locator: 'row 33', micros: Object.freeze({ marketing: 86000, utility: 29000, authentication: 29000, authentication_international: 'unavailable', service: 29000 }) },
            { market: 'Russia', locator: 'row 34', micros: Object.freeze({ marketing: 80200, utility: 40000, authentication: 40000, authentication_international: 'unavailable', service: 40000 }) },
            { market: 'Saudi Arabia', locator: 'row 35', micros: Object.freeze({ marketing: 57600, utility: 10700, authentication: 10700, authentication_international: 59800, service: 10700 }) },
            { market: 'Singapore', locator: 'row 36', micros: Object.freeze({ marketing: 73200, utility: 16000, authentication: 16000, authentication_international: 'unavailable', service: 16000 }) },
            { market: 'South Africa', locator: 'row 37', micros: Object.freeze({ marketing: 37900, utility: 9500, authentication: 9500, authentication_international: 20000, service: 9500 }) },
            { market: 'Spain', locator: 'row 38', micros: Object.freeze({ marketing: 70700, utility: 20000, authentication: 20000, authentication_international: 'unavailable', service: 20000 }) },
            { market: 'Sri Lanka', locator: 'row 39', micros: Object.freeze({ marketing: 73200, utility: 2000, authentication: 2000, authentication_international: 144000, service: 2000 }) },
            { market: 'Turkey', locator: 'row 40', micros: Object.freeze({ marketing: 10900, utility: 900, authentication: 900, authentication_international: 'unavailable', service: 900 }) },
            { market: 'Ukraine', locator: 'row 41', micros: Object.freeze({ marketing: 86000, utility: 29800, authentication: 29800, authentication_international: 74600, service: 29800 }) },
            { market: 'United Arab Emirates', locator: 'row 42', micros: Object.freeze({ marketing: 57600, utility: 15700, authentication: 15700, authentication_international: 51000, service: 15700 }) },
            { market: 'United Kingdom', locator: 'row 43', micros: Object.freeze({ marketing: 63500, utility: 22000, authentication: 22000, authentication_international: 'unavailable', service: 22000 }) },
            { market: 'North America', locator: 'row 44', micros: Object.freeze({ marketing: 25000, utility: 3400, authentication: 3400, authentication_international: 'unavailable', service: 3400 }) },
            { market: 'Rest of Africa', locator: 'row 45', micros: Object.freeze({ marketing: 22500, utility: 4000, authentication: 4000, authentication_international: 'unavailable', service: 4000 }) },
            { market: 'Rest of Asia Pacific', locator: 'row 46', micros: Object.freeze({ marketing: 84200, utility: 11300, authentication: 11300, authentication_international: 'unavailable', service: 11300 }) },
            { market: 'Rest of Central & Eastern Europe', locator: 'row 47', micros: Object.freeze({ marketing: 86000, utility: 21200, authentication: 21200, authentication_international: 'unavailable', service: 21200 }) },
            { market: 'Rest of Latin America', locator: 'row 48', micros: Object.freeze({ marketing: 74000, utility: 11300, authentication: 11300, authentication_international: 'unavailable', service: 11300 }) },
            { market: 'Rest of Middle East', locator: 'row 49', micros: Object.freeze({ marketing: 39200, utility: 9100, authentication: 9100, authentication_international: 'unavailable', service: 9100 }) },
            { market: 'Rest of Western Europe', locator: 'row 50', micros: Object.freeze({ marketing: 59200, utility: 17100, authentication: 17100, authentication_international: 'unavailable', service: 17100 }) },
            { market: 'Other', locator: 'row 51', micros: Object.freeze({ marketing: 60400, utility: 7700, authentication: 7700, authentication_international: 'unavailable', service: 7700 }) },
        ]),
    },
    {
        rateVersion: 'meta-ratecards-2026/COP/2026-10-01',
        currency: 'COP',
        effectiveFrom: '2026-10-01',
        sourceFile: 'meta-cop-rates-2026-10-01.xlsx',
        sourceSha256: 'cd9fe8d22a7a9d0ca7cfeffb333df4863faf18a46625c36503be530df58b3c7c',
        sourceUrl: 'https://scontent.fbog23-1.fna.fbcdn.net/v/t39.8562-6/789740745_1989457894930581_212461347617315538_n.csv?_nc_cat=108&ccb=1-7&_nc_sid=b8d81d&_nc_ohc=0UgkcZ6c2ekQ7kNvwFZdsY6&_nc_oc=Ado0iErvb9toIuZXBcX1KhM07qFxL0nRlRSutRI7d_jtghTgSLEd28IXfa0WEZq1JTU&_nc_zt=14&_nc_ht=scontent.fbog23-1.fna&_nc_gid=jyzMPmIqxWJLMFEO1j5-ng&_nc_ss=7a289&oh=00_AQJy5BzZzbo6Y1M4w7mKWdEFp8o8aiTs4hMvcBHyUpezYQ&oe=6AA88C10',
        headerLocator: 'row 4',
        entries: Object.freeze([
            { market: 'Argentina', locator: 'row 5', micros: Object.freeze({ marketing: 227536100, utility: 95727100, authentication: 95727100, authentication_international: 'unavailable', service: 95727100 }) },
            { market: 'Bangladesh', locator: 'row 6', micros: Object.freeze({ marketing: 269508700, utility: 13622700, authentication: 13622700, authentication_international: 353454200, service: 13622700 }) },
            { market: 'Brazil', locator: 'row 7', micros: Object.freeze({ marketing: 230113300, utility: 25036300, authentication: 25036300, authentication_international: 'unavailable', service: 25036300 }) },
            { market: 'Chile', locator: 'row 8', micros: Object.freeze({ marketing: 327313200, utility: 73636300, authentication: 73636300, authentication_international: 'unavailable', service: 73636300 }) },
            { market: 'Colombia', locator: 'row 9', micros: Object.freeze({ marketing: 46022700, utility: 2945500, authentication: 2945500, authentication_international: 'unavailable', service: 2945500 }) },
            { market: 'Egypt', locator: 'row 10', micros: Object.freeze({ marketing: 237108800, utility: 13254500, authentication: 13254500, authentication_international: 239317900, service: 13254500 }) },
            { market: 'France', locator: 'row 11', micros: Object.freeze({ marketing: 316267800, utility: 110454400, authentication: 110454400, authentication_international: 'unavailable', service: 110454400 }) },
            { market: 'Germany', locator: 'row 12', micros: Object.freeze({ marketing: 502567500, utility: 202499700, authentication: 202499700, authentication_international: 'unavailable', service: 202499700 }) },
            { market: 'Hong Kong', locator: 'row 13', micros: Object.freeze({ marketing: 269508700, utility: 95727200, authentication: 95727200, authentication_international: 'unavailable', service: 95727200 }) },
            { market: 'Hungary', locator: 'row 14', micros: Object.freeze({ marketing: 316636000, utility: 128863400, authentication: 128863400, authentication_international: 'unavailable', service: 128863400 }) },
            { market: 'India', locator: 'row 15', micros: Object.freeze({ marketing: 43445400, utility: 5154500, authentication: 5154500, authentication_international: 111927100, service: 5154500 }) },
            { market: 'Indonesia', locator: 'row 16', micros: Object.freeze({ marketing: 151322500, utility: 92045300, authentication: 92045300, authentication_international: 500726600, service: 92045300 }) },
            { market: 'Iraq', locator: 'row 17', micros: Object.freeze({ marketing: 125549800, utility: 29086300, authentication: 29086300, authentication_international: 471272100, service: 29086300 }) },
            { market: 'Israel', locator: 'row 18', micros: Object.freeze({ marketing: 129968000, utility: 19513600, authentication: 19513600, authentication_international: 'unavailable', service: 19513600 }) },
            { market: 'Italy', locator: 'row 19', micros: Object.freeze({ marketing: 292575300, utility: 110454400, authentication: 110454400, authentication_international: 'unavailable', service: 110454400 }) },
            { market: 'Kazakhstan', locator: 'row 20', micros: Object.freeze({ marketing: 222381500, utility: 66272700, authentication: 66272700, authentication_international: 589090900, service: 66272700 }) },
            { market: 'Kuwait', locator: 'row 21', micros: Object.freeze({ marketing: 291652200, utility: 161999800, authentication: 161999800, authentication_international: 441817600, service: 161999800 }) },
            { market: 'Malaysia', locator: 'row 22', micros: Object.freeze({ marketing: 316636000, utility: 51545400, authentication: 51545400, authentication_international: 153899800, service: 51545400 }) },
            { market: 'Mexico', locator: 'row 23', micros: Object.freeze({ marketing: 145983900, utility: 31295400, authentication: 31295400, authentication_international: 'unavailable', service: 31295400 }) },
            { market: 'Morocco', locator: 'row 24', micros: Object.freeze({ marketing: 152427100, utility: 84682000, authentication: 84682000, authentication_international: 298596000, service: 84682000 }) },
            { market: 'Netherlands', locator: 'row 25', micros: Object.freeze({ marketing: 587985600, utility: 184090700, authentication: 184090700, authentication_international: 'unavailable', service: 184090700 }) },
            { market: 'Nepal', locator: 'row 26', micros: Object.freeze({ marketing: 269508700, utility: 12518200, authentication: 12518200, authentication_international: 412363200, service: 12518200 }) },
            { market: 'Nigeria', locator: 'row 27', micros: Object.freeze({ marketing: 189981600, utility: 24668100, authentication: 24668100, authentication_international: 276136000, service: 24668100 }) },
            { market: 'Oman', locator: 'row 28', micros: Object.freeze({ marketing: 125549800, utility: 90940800, authentication: 90940800, authentication_international: 220908800, service: 90940800 }) },
            { market: 'Pakistan', locator: 'row 29', micros: Object.freeze({ marketing: 174149800, utility: 55227200, authentication: 55227200, authentication_international: 276136000, service: 55227200 }) },
            { market: 'Peru', locator: 'row 30', micros: Object.freeze({ marketing: 258831500, utility: 110454500, authentication: 110454500, authentication_international: 'unavailable', service: 110454500 }) },
            { market: 'Poland', locator: 'row 31', micros: Object.freeze({ marketing: 134754300, utility: 44918100, authentication: 44918100, authentication_international: 'unavailable', service: 44918100 }) },
            { market: 'Qatar', locator: 'row 32', micros: Object.freeze({ marketing: 125549800, utility: 44181800, authentication: 44181800, authentication_international: 'unavailable', service: 44181800 }) },
            { market: 'Romania', locator: 'row 33', micros: Object.freeze({ marketing: 316636000, utility: 106772500, authentication: 106772500, authentication_international: 'unavailable', service: 106772500 }) },
            { market: 'Russia', locator: 'row 34', micros: Object.freeze({ marketing: 295281400, utility: 147272500, authentication: 147272500, authentication_international: 'unavailable', service: 147272500 }) },
            { market: 'Saudi Arabia', locator: 'row 35', micros: Object.freeze({ marketing: 212127700, utility: 39395400, authentication: 39395400, authentication_international: 220172400, service: 39395400 }) },
            { market: 'Singapore', locator: 'row 36', micros: Object.freeze({ marketing: 269508700, utility: 58909000, authentication: 58909000, authentication_international: 'unavailable', service: 58909000 }) },
            { market: 'South Africa', locator: 'row 37', micros: Object.freeze({ marketing: 139540700, utility: 34977300, authentication: 34977300, authentication_international: 73636300, service: 34977300 }) },
            { market: 'Spain', locator: 'row 38', micros: Object.freeze({ marketing: 260396200, utility: 73636300, authentication: 73636300, authentication_international: 'unavailable', service: 73636300 }) },
            { market: 'Sri Lanka', locator: 'row 39', micros: Object.freeze({ marketing: 269508700, utility: 7363600, authentication: 7363600, authentication_international: 530181200, service: 7363600 }) },
            { market: 'Turkey', locator: 'row 40', micros: Object.freeze({ marketing: 40131800, utility: 3313600, authentication: 3313600, authentication_international: 'unavailable', service: 3313600 }) },
            { market: 'Ukraine', locator: 'row 41', micros: Object.freeze({ marketing: 316636000, utility: 109718000, authentication: 109718000, authentication_international: 274663100, service: 109718000 }) },
            { market: 'United Arab Emirates', locator: 'row 42', micros: Object.freeze({ marketing: 212127700, utility: 57804500, authentication: 57804500, authentication_international: 187772500, service: 57804500 }) },
            { market: 'United Kingdom', locator: 'row 43', micros: Object.freeze({ marketing: 233721500, utility: 80999900, authentication: 80999900, authentication_international: 'unavailable', service: 80999900 }) },
            { market: 'North America', locator: 'row 44', micros: Object.freeze({ marketing: 92045300, utility: 12518200, authentication: 12518200, authentication_international: 'unavailable', service: 12518200 }) },
            { market: 'Rest of Africa', locator: 'row 45', micros: Object.freeze({ marketing: 82840800, utility: 14727300, authentication: 14727300, authentication_international: 'unavailable', service: 14727300 }) },
            { market: 'Rest of Asia Pacific', locator: 'row 46', micros: Object.freeze({ marketing: 309935000, utility: 41604500, authentication: 41604500, authentication_international: 'unavailable', service: 41604500 }) },
            { market: 'Rest of Central & Eastern Europe', locator: 'row 47', micros: Object.freeze({ marketing: 316636000, utility: 78054400, authentication: 78054400, authentication_international: 'unavailable', service: 78054400 }) },
            { market: 'Rest of Latin America', locator: 'row 48', micros: Object.freeze({ marketing: 272454200, utility: 41604500, authentication: 41604500, authentication_international: 'unavailable', service: 41604500 }) },
            { market: 'Rest of Middle East', locator: 'row 49', micros: Object.freeze({ marketing: 144382300, utility: 33504500, authentication: 33504500, authentication_international: 'unavailable', service: 33504500 }) },
            { market: 'Rest of Western Europe', locator: 'row 50', micros: Object.freeze({ marketing: 217963400, utility: 62959000, authentication: 62959000, authentication_international: 'unavailable', service: 62959000 }) },
            { market: 'Other', locator: 'row 51', micros: Object.freeze({ marketing: 222381500, utility: 28350000, authentication: 28350000, authentication_international: 'unavailable', service: 28350000 }) },
        ]),
    },
]);

/**
 * ISO 3166-1 alpha-2 → Meta market name, for the markets Meta names as
 * countries. Ours, not Meta's: the generator only guarantees that each market
 * named here appears verbatim in a preserved card.
 *
 * The regional buckets ("Rest of Latin America", "Other", …) are absent on
 * purpose. Meta assigns countries to them by calling code, on a page these
 * sources link to but do not contain, so routing an unlisted country into a
 * bucket would be a guess — and a guess towards a cheaper price.
 */
export const WHATSAPP_MARKET_BY_ISO_ALPHA2: Readonly<Record<string, string>> = Object.freeze({
    AE: 'United Arab Emirates',
    AR: 'Argentina',
    BD: 'Bangladesh',
    BR: 'Brazil',
    CL: 'Chile',
    CO: 'Colombia',
    DE: 'Germany',
    EG: 'Egypt',
    ES: 'Spain',
    FR: 'France',
    GB: 'United Kingdom',
    HK: 'Hong Kong',
    HU: 'Hungary',
    ID: 'Indonesia',
    IL: 'Israel',
    IN: 'India',
    IQ: 'Iraq',
    IT: 'Italy',
    KW: 'Kuwait',
    KZ: 'Kazakhstan',
    LK: 'Sri Lanka',
    MA: 'Morocco',
    MX: 'Mexico',
    MY: 'Malaysia',
    NG: 'Nigeria',
    NL: 'Netherlands',
    NP: 'Nepal',
    OM: 'Oman',
    PE: 'Peru',
    PK: 'Pakistan',
    PL: 'Poland',
    QA: 'Qatar',
    RO: 'Romania',
    RU: 'Russia',
    SA: 'Saudi Arabia',
    SG: 'Singapore',
    TR: 'Turkey',
    UA: 'Ukraine',
    ZA: 'South Africa',
});

/**
 * ISO 4217 minor-unit exponents for the currencies the cards are published in.
 * A currency absent from this map cannot be converted to minor units at all,
 * which is the correct answer rather than assuming two decimal places.
 */
export const CURRENCY_MINOR_EXPONENT: Readonly<Record<string, number>> = Object.freeze({
    USD: 2,
    COP: 2,
});

/**
 * The free service-message allowance, as the preserved evidence states it.
 *
 * Per NUMBER and per calendar MONTH — not per country, not per contact, not per
 * conversation — and it does not roll over. The two locators are two
 * independent sentences in the evidence that the generator requires to agree.
 */
export const WHATSAPP_FREE_SERVICE_ALLOWANCE = Object.freeze({
    deliveries: 1000,
    scope: 'per_phone_number_per_calendar_month' as const,
    rollsOver: false,
    /** Applies only to this category. Utility inside the window is charged. */
    category: 'service' as const,
    /** Nothing before this date is covered: the charge itself starts here. */
    effectiveFrom: '2026-10-01',
    sourceFile: 'meta-official-pricing-evidence.md',
    sourceLocators: Object.freeze(['line 26', 'line 139']),
    rollsOverLocator: 'line 26',
});
