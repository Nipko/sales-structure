/**
 * País de facturación e idioma del tenant, inferidos del huso horario.
 *
 * Vive en el API y NO en `packages/shared` a propósito: ese paquete expone
 * `main: ./src/index.ts` (TypeScript crudo), así que el API solo puede importarle
 * **tipos** — TypeScript los borra al compilar. Importar un valor en runtime hace
 * que el JS compilado emita un `require()` del .ts y el arranque muera con
 * "SyntaxError: Unexpected token 'export'". El resto del API respeta ese límite;
 * esto lo respeta también.
 *
 * El dashboard no duplica esta lista: la recibe del backend (GET /fiscal/:id/data),
 * así que la validación y el selector no pueden divergir.
 */

/** Zona IANA → ISO 3166-1 alpha-2. Cubre las zonas del selector de onboarding. */
export const TIMEZONE_COUNTRY: Record<string, string> = {
    // Latinoamérica
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
    // Norteamérica
    'America/New_York': 'US',
    'America/Chicago': 'US',
    'America/Denver': 'US',
    'America/Phoenix': 'US',
    'America/Los_Angeles': 'US',
    'America/Anchorage': 'US',
    'Pacific/Honolulu': 'US',
    'America/Toronto': 'CA',
    'America/Vancouver': 'CA',
    // Europa
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
    // África y Medio Oriente
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
    // Oceanía
    'Australia/Perth': 'AU',
    'Australia/Adelaide': 'AU',
    'Australia/Brisbane': 'AU',
    'Australia/Sydney': 'AU',
    'Pacific/Auckland': 'NZ',
    'Pacific/Fiji': 'FJ',
};

/** Países cuyos tenants reciben contenido en español por defecto. */
export const SPANISH_SPEAKING_COUNTRIES = new Set([
    'MX', 'CO', 'PE', 'EC', 'PA', 'GT', 'CR', 'SV', 'HN', 'NI',
    'VE', 'BO', 'CL', 'PY', 'DO', 'PR', 'CU', 'AR', 'UY', 'ES',
]);

/**
 * Países que la plataforma RECONOCE como país de facturación de un tenant.
 * Derivados del mapa de husos, así que el selector del dashboard y la inferencia
 * del alta no pueden discrepar sobre qué es válido.
 *
 * Fuente de verdad ÚNICA de "en qué países podemos facturar": el DTO del alta
 * (`complete-onboarding.dto.ts`) y el PATCH fiscal (`fiscal.controller.ts`)
 * validan contra esta misma lista. Antes divergían — el alta aceptaba 17 y el
 * PATCH ~55 — así que un tenant podía terminar con un país que el otro camino
 * consideraba inválido.
 *
 * Este es el nivel ANCHO. El nivel angosto —"países con moneda de cobro
 * configurada"— vive en `billing/billing-country-config.ts`
 * (`BILLING_CURRENCY_BY_COUNTRY` / `hasBillingCurrency`) y es el que decide
 * precio local y cobro. Un país reconocido sin moneda configurada es un tenant
 * válido: el catálogo lo cotiza en USD.
 */
export const SUPPORTED_BILLING_COUNTRIES: string[] = Array.from(
    new Set(Object.values(TIMEZONE_COUNTRY)),
).sort();

/** Nivel ancho: ¿reconocemos este país como país de facturación? */
export function isSupportedBillingCountry(country?: string | null): boolean {
    const code = country?.trim().toUpperCase();
    return !!code && SUPPORTED_BILLING_COUNTRIES.includes(code);
}

/** País por defecto cuando no hay señal (mercado LatAm-first). */
export const DEFAULT_BILLING_COUNTRY = 'CO';
