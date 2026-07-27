// ---- Timezones (worldwide, curated IANA) ----
// Single source of truth for the timezone selectors (dashboard) and backend defaults.
// Every `value` is a valid IANA zone (Intl.supportedValuesOf('timeZone')); labels carry a
// representative city + GMT offset (English/neutral, like the rest of the tz UI). Grouped
// by region so the <select>s can render <optgroup>s without a search box. This is a curated
// ~75-zone list (not the 600+ from Intl.supportedValuesOf) for a usable picker; backend
// validation should still accept any valid IANA zone.

export interface TimezoneOption {
    value: string;
    label: string;
}

export interface TimezoneGroup {
    region: string;
    zones: TimezoneOption[];
}

export const TIMEZONE_GROUPS: TimezoneGroup[] = [
    {
        region: 'Latin America',
        zones: [
            { value: 'America/Mexico_City', label: 'Mexico City (GMT-6)' },
            { value: 'America/Bogota', label: 'Bogotá (GMT-5)' },
            { value: 'America/Lima', label: 'Lima (GMT-5)' },
            { value: 'America/Guayaquil', label: 'Quito, Guayaquil (GMT-5)' },
            { value: 'America/Panama', label: 'Panamá (GMT-5)' },
            { value: 'America/Guatemala', label: 'Guatemala (GMT-6)' },
            { value: 'America/Costa_Rica', label: 'San José (GMT-6)' },
            { value: 'America/El_Salvador', label: 'San Salvador (GMT-6)' },
            { value: 'America/Tegucigalpa', label: 'Tegucigalpa (GMT-6)' },
            { value: 'America/Managua', label: 'Managua (GMT-6)' },
            { value: 'America/Caracas', label: 'Caracas (GMT-4)' },
            { value: 'America/La_Paz', label: 'La Paz (GMT-4)' },
            { value: 'America/Santiago', label: 'Santiago (GMT-4)' },
            { value: 'America/Asuncion', label: 'Asunción (GMT-4)' },
            { value: 'America/Santo_Domingo', label: 'Santo Domingo (GMT-4)' },
            { value: 'America/Puerto_Rico', label: 'San Juan (GMT-4)' },
            { value: 'America/Havana', label: 'La Habana (GMT-5)' },
            { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (GMT-3)' },
            { value: 'America/Montevideo', label: 'Montevideo (GMT-3)' },
            { value: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)' },
        ],
    },
    {
        region: 'North America',
        zones: [
            { value: 'America/New_York', label: 'US Eastern — New York (GMT-5)' },
            { value: 'America/Chicago', label: 'US Central — Chicago (GMT-6)' },
            { value: 'America/Denver', label: 'US Mountain — Denver (GMT-7)' },
            { value: 'America/Phoenix', label: 'US Arizona — Phoenix (GMT-7)' },
            { value: 'America/Los_Angeles', label: 'US Pacific — Los Angeles (GMT-8)' },
            { value: 'America/Anchorage', label: 'US Alaska — Anchorage (GMT-9)' },
            { value: 'Pacific/Honolulu', label: 'US Hawaii — Honolulu (GMT-10)' },
            { value: 'America/Toronto', label: 'Canada Eastern — Toronto (GMT-5)' },
            { value: 'America/Vancouver', label: 'Canada Pacific — Vancouver (GMT-8)' },
        ],
    },
    {
        region: 'Europe',
        zones: [
            { value: 'Europe/London', label: 'London (GMT+0)' },
            { value: 'Europe/Lisbon', label: 'Lisbon (GMT+0)' },
            { value: 'Europe/Dublin', label: 'Dublin (GMT+0)' },
            { value: 'Europe/Madrid', label: 'Madrid (GMT+1)' },
            { value: 'Europe/Paris', label: 'Paris (GMT+1)' },
            { value: 'Europe/Berlin', label: 'Berlin (GMT+1)' },
            { value: 'Europe/Rome', label: 'Rome (GMT+1)' },
            { value: 'Europe/Amsterdam', label: 'Amsterdam (GMT+1)' },
            { value: 'Europe/Brussels', label: 'Brussels (GMT+1)' },
            { value: 'Europe/Zurich', label: 'Zurich (GMT+1)' },
            { value: 'Europe/Warsaw', label: 'Warsaw (GMT+1)' },
            { value: 'Europe/Athens', label: 'Athens (GMT+2)' },
            { value: 'Europe/Kyiv', label: 'Kyiv (GMT+2)' },
            { value: 'Europe/Istanbul', label: 'Istanbul (GMT+3)' },
            { value: 'Europe/Moscow', label: 'Moscow (GMT+3)' },
        ],
    },
    {
        region: 'Africa & Middle East',
        zones: [
            { value: 'Africa/Casablanca', label: 'Casablanca (GMT+1)' },
            { value: 'Africa/Lagos', label: 'Lagos (GMT+1)' },
            { value: 'Africa/Cairo', label: 'Cairo (GMT+2)' },
            { value: 'Africa/Johannesburg', label: 'Johannesburg (GMT+2)' },
            { value: 'Africa/Nairobi', label: 'Nairobi (GMT+3)' },
            { value: 'Asia/Jerusalem', label: 'Jerusalem (GMT+2)' },
            { value: 'Asia/Riyadh', label: 'Riyadh (GMT+3)' },
            { value: 'Asia/Dubai', label: 'Dubai (GMT+4)' },
            { value: 'Asia/Tehran', label: 'Tehran (GMT+3:30)' },
        ],
    },
    {
        region: 'Asia',
        zones: [
            { value: 'Asia/Karachi', label: 'Karachi (GMT+5)' },
            { value: 'Asia/Kolkata', label: 'India — Kolkata (GMT+5:30)' },
            { value: 'Asia/Dhaka', label: 'Dhaka (GMT+6)' },
            { value: 'Asia/Bangkok', label: 'Bangkok (GMT+7)' },
            { value: 'Asia/Jakarta', label: 'Jakarta (GMT+7)' },
            { value: 'Asia/Singapore', label: 'Singapore (GMT+8)' },
            { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (GMT+8)' },
            { value: 'Asia/Manila', label: 'Manila (GMT+8)' },
            { value: 'Asia/Hong_Kong', label: 'Hong Kong (GMT+8)' },
            { value: 'Asia/Shanghai', label: 'Shanghai (GMT+8)' },
            { value: 'Asia/Taipei', label: 'Taipei (GMT+8)' },
            { value: 'Asia/Seoul', label: 'Seoul (GMT+9)' },
            { value: 'Asia/Tokyo', label: 'Tokyo (GMT+9)' },
        ],
    },
    {
        region: 'Oceania',
        zones: [
            { value: 'Australia/Perth', label: 'Perth (GMT+8)' },
            { value: 'Australia/Adelaide', label: 'Adelaide (GMT+9:30)' },
            { value: 'Australia/Brisbane', label: 'Brisbane (GMT+10)' },
            { value: 'Australia/Sydney', label: 'Sydney (GMT+10)' },
            { value: 'Pacific/Auckland', label: 'Auckland (GMT+12)' },
            { value: 'Pacific/Fiji', label: 'Fiji (GMT+12)' },
        ],
    },
    {
        region: 'UTC',
        zones: [
            { value: 'UTC', label: 'UTC (GMT+0)' },
        ],
    },
];

/** Flat list of every supported timezone (value + label). */
export const ALL_TIMEZONES: TimezoneOption[] = TIMEZONE_GROUPS.flatMap((g) => g.zones);

/** Set of valid values for quick membership checks / validation. */
export const TIMEZONE_VALUES: string[] = ALL_TIMEZONES.map((t) => t.value);

/** Safe default when none is configured (LatAm-first market). */
export const DEFAULT_TIMEZONE = 'America/Bogota';

/**
 * Zone → ISO 3166-1 alpha-2 country. Used to infer the billing country and the tenant's
 * content language at signup, where the timezone is the only geographic signal we have.
 * Covers every zone in the curated list above — keep them in sync when adding a zone.
 */
export const TIMEZONE_COUNTRY: Record<string, string> = {
    // Latin America
    'America/Mexico_City': 'MX',
    'America/Bogota': 'CO',
    'America/Lima': 'PE',
    'America/Guayaquil': 'EC',
    'America/Panama': 'PA',
    'America/Guatemala': 'GT',
    'America/Costa_Rica': 'CR',
    'America/El_Salvador': 'SV',
    'America/Tegucigalpa': 'HN',
    'America/Managua': 'NI',
    'America/Caracas': 'VE',
    'America/La_Paz': 'BO',
    'America/Santiago': 'CL',
    'America/Asuncion': 'PY',
    'America/Santo_Domingo': 'DO',
    'America/Puerto_Rico': 'PR',
    'America/Havana': 'CU',
    'America/Argentina/Buenos_Aires': 'AR',
    'America/Montevideo': 'UY',
    'America/Sao_Paulo': 'BR',
    // North America
    'America/New_York': 'US',
    'America/Chicago': 'US',
    'America/Denver': 'US',
    'America/Phoenix': 'US',
    'America/Los_Angeles': 'US',
    'America/Anchorage': 'US',
    'Pacific/Honolulu': 'US',
    'America/Toronto': 'CA',
    'America/Vancouver': 'CA',
    // Europe
    'Europe/London': 'GB',
    'Europe/Lisbon': 'PT',
    'Europe/Dublin': 'IE',
    'Europe/Madrid': 'ES',
    'Europe/Paris': 'FR',
    'Europe/Berlin': 'DE',
    'Europe/Rome': 'IT',
    'Europe/Amsterdam': 'NL',
    'Europe/Brussels': 'BE',
    'Europe/Zurich': 'CH',
    'Europe/Warsaw': 'PL',
    'Europe/Athens': 'GR',
    'Europe/Kyiv': 'UA',
    'Europe/Istanbul': 'TR',
    'Europe/Moscow': 'RU',
    // Africa & Middle East
    'Africa/Casablanca': 'MA',
    'Africa/Lagos': 'NG',
    'Africa/Cairo': 'EG',
    'Africa/Johannesburg': 'ZA',
    'Africa/Nairobi': 'KE',
    'Asia/Jerusalem': 'IL',
    'Asia/Riyadh': 'SA',
    'Asia/Dubai': 'AE',
    'Asia/Tehran': 'IR',
    // Asia
    'Asia/Karachi': 'PK',
    'Asia/Kolkata': 'IN',
    'Asia/Dhaka': 'BD',
    'Asia/Bangkok': 'TH',
    'Asia/Jakarta': 'ID',
    'Asia/Singapore': 'SG',
    'Asia/Kuala_Lumpur': 'MY',
    'Asia/Manila': 'PH',
    'Asia/Hong_Kong': 'HK',
    'Asia/Shanghai': 'CN',
    'Asia/Taipei': 'TW',
    'Asia/Seoul': 'KR',
    'Asia/Tokyo': 'JP',
    // Oceania
    'Australia/Perth': 'AU',
    'Australia/Adelaide': 'AU',
    'Australia/Brisbane': 'AU',
    'Australia/Sydney': 'AU',
    'Pacific/Auckland': 'NZ',
    'Pacific/Fiji': 'FJ',
};

/** Countries whose tenants get Spanish content by default. */
export const SPANISH_SPEAKING_COUNTRIES = new Set([
    'MX', 'CO', 'PE', 'EC', 'PA', 'GT', 'CR', 'SV', 'HN', 'NI',
    'VE', 'BO', 'CL', 'PY', 'DO', 'PR', 'CU', 'AR', 'UY', 'ES',
]);

/**
 * Normalize legacy/alias zones to the canonical curated value so saved settings still
 * match a `<select>` option. (e.g. the deprecated `America/Buenos_Aires` → the canonical
 * `America/Argentina/Buenos_Aires`.)
 */
export function normalizeTimezone(tz?: string | null): string {
    if (!tz) return DEFAULT_TIMEZONE;
    const aliases: Record<string, string> = {
        'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
        'Asia/Calcutta': 'Asia/Kolkata',
        'Asia/Saigon': 'Asia/Ho_Chi_Minh',
        'Europe/Kiev': 'Europe/Kyiv',
    };
    return aliases[tz] || tz;
}
