import { canonicalSubtypeId } from './subtype-experience-profile';

/**
 * ═══ TRES NÚMEROS QUE DECIDÍAN LO MISMO Y NO SE HABLABAN ═══
 *
 * "¿Este dato del proveedor sigue sirviendo?" se contestaba en tres lugares con
 * tres respuestas distintas, y las tres eran defendibles por separado:
 *
 * | Quién | Qué decía | Efecto |
 * |---|---|---|
 * | El cron de re-sync | corre **1 vez por día** (`0 5 * * *`) | el espejo tiene ~24h de edad normal |
 * | El contrato efectivo | presupuesto de **900s** (Mindbody/Cliniko) | a los 15 minutos deja de publicar la tool |
 * | La salud / el panel | `stale` a las **36h** | verde durante todo ese tiempo |
 *
 * El resultado en producción: las lecturas espejadas quedaban despublicadas
 * **23 horas y 45 minutos de cada día**, y el dueño veía la integración en
 * verde todo el tiempo. Un panel que dice "sincronizado hace 2 horas, sano"
 * mientras el agente contesta que no puede consultar la grilla es peor que un
 * error: nadie puede reconciliarlo mirando la pantalla.
 *
 * El origen del desacuerdo es que "frescura" son **dos cosas distintas**:
 *
 * - **Frescura del espejo.** Cuán viejo es lo que copiamos. Gobierna las
 *   lecturas servidas desde `vi_items` y sólo tiene sentido comparada contra
 *   **cada cuánto corre el sync**: un presupuesto más chico que la cadencia
 *   apaga la función siempre, por definición.
 * - **Liveza de la conexión.** Si la credencial y el circuito funcionan ahora.
 *   Gobierna las lecturas que van **en vivo** al proveedor, a las que no les
 *   importa cuándo se sincronizó el espejo.
 *
 * `check_clinic_availability` va en vivo a Cliniko: aplicarle el presupuesto
 * del espejo era medirle la edad a un dato que se acababa de traer.
 */

export type VerticalProviderName = 'toast' | 'mindbody' | 'cliniko';

/**
 * Exact API family exercised by each native connector. This is runtime
 * identity, not certification evidence: a healthy connector on a known
 * version still remains uncertified until its capability evidence is stored.
 */
export const PROVIDER_API_VERSIONS: Readonly<Record<VerticalProviderName, string>> =
    Object.freeze({
        toast: 'menus-v2',
        mindbody: 'public-v6',
        cliniko: 'v1',
    });

export interface ProviderFreshnessPolicy {
    /**
     * Cada cuánto se refresca el espejo, en segundos.
     *
     * Es un dato del sistema, no una preferencia: si el cron cambia de cadencia
     * y esto no, el presupuesto de abajo deja de tener sentido — y el modo de
     * falla es silencioso, porque la función simplemente deja de publicarse.
     * `providerFreshnessContradictions()` lo verifica.
     */
    mirrorSyncIntervalSeconds: number;
    /**
     * Cuánto puede tener el espejo antes de que repetirlo deje de ser honesto.
     *
     * Tiene que ser **mayor** que la cadencia, con margen para que un sync
     * fallido no apague la integración en el acto.
     */
    mirrorMaxAgeSeconds: number;
    /** Las lecturas servidas desde el espejo: les aplica el presupuesto. */
    mirrorBackedTools: readonly string[];
    /**
     * Las lecturas que van en vivo al proveedor. No se les mide la edad del
     * espejo; lo único que las gobierna es que la conexión esté sana.
     */
    liveTools: readonly string[];
}

export type ProviderToolDataMode = 'mirrored_discovery' | 'available_live';

export const PROVIDER_TOOL_DATA_MODES: Readonly<Record<string, ProviderToolDataMode>> = Object.freeze({
    get_restaurant_menu: 'mirrored_discovery',
    get_fitness_schedule: 'mirrored_discovery',
    list_clinic_services: 'mirrored_discovery',
    check_clinic_availability: 'available_live',
});

export function providerToolDataMode(tool: string): ProviderToolDataMode | undefined {
    return PROVIDER_TOOL_DATA_MODES[tool];
}

/**
 * Cadencia ejecutable del re-sync de integraciones verticales.
 *
 * La expresión y el presupuesto viven juntos para que el cron real no pueda
 * separarse silenciosamente de la política de frescura que publica las tools.
 */
export const VERTICAL_INTEGRATION_SYNC_CRON = '0 5 * * *';

/** El re-sync de integraciones verticales corre una vez por día, a las 5. */
export const VERTICAL_INTEGRATION_SYNC_INTERVAL_SECONDS = 24 * 60 * 60;

/**
 * Margen sobre la cadencia. Con un solo sync diario, un día que falle no puede
 * apagar la integración al minuto siguiente — pero dos días seguidos sí.
 */
const MIRROR_MAX_AGE_SECONDS = 36 * 60 * 60;

export const PROVIDER_FRESHNESS: Readonly<Record<VerticalProviderName, ProviderFreshnessPolicy>> =
    Object.freeze({
        toast: Object.freeze({
            mirrorSyncIntervalSeconds: VERTICAL_INTEGRATION_SYNC_INTERVAL_SECONDS,
            mirrorMaxAgeSeconds: MIRROR_MAX_AGE_SECONDS,
            mirrorBackedTools: Object.freeze(['get_restaurant_menu']),
            liveTools: Object.freeze([]),
        }),
        mindbody: Object.freeze({
            mirrorSyncIntervalSeconds: VERTICAL_INTEGRATION_SYNC_INTERVAL_SECONDS,
            mirrorMaxAgeSeconds: MIRROR_MAX_AGE_SECONDS,
            mirrorBackedTools: Object.freeze(['get_fitness_schedule']),
            liveTools: Object.freeze([]),
        }),
        cliniko: Object.freeze({
            mirrorSyncIntervalSeconds: VERTICAL_INTEGRATION_SYNC_INTERVAL_SECONDS,
            mirrorMaxAgeSeconds: MIRROR_MAX_AGE_SECONDS,
            mirrorBackedTools: Object.freeze(['list_clinic_services']),
            // Va en vivo a `available_times`: su respuesta nace fresca.
            liveTools: Object.freeze(['check_clinic_availability']),
        }),
    });

export function providerFreshnessFor(provider: string): ProviderFreshnessPolicy | undefined {
    return (PROVIDER_FRESHNESS as Record<string, ProviderFreshnessPolicy>)[provider];
}

/** Si esta tool se sirve del espejo y por lo tanto tiene edad que medir. */
export function isMirrorBackedProviderTool(tool: string): boolean {
    return Object.values(PROVIDER_FRESHNESS).some(p => p.mirrorBackedTools.includes(tool));
}

/**
 * Los proveedores cuyo presupuesto NO es coherente con su propia cadencia.
 *
 * Devuelve una lista en vez de tirar: se usa desde una prueba de contrato, y
 * ahí un mensaje que diga *cuáles* y *por cuánto* es lo que hace falta para
 * arreglarlo. Un presupuesto menor o igual a la cadencia significa que la
 * integración pasa la mayor parte del día despublicada **por diseño**, y ese
 * era exactamente el estado anterior.
 */
export function providerFreshnessContradictions(): Array<{
    provider: string;
    syncIntervalSeconds: number;
    maxAgeSeconds: number;
}> {
    return Object.entries(PROVIDER_FRESHNESS)
        .filter(([, p]) => p.mirrorMaxAgeSeconds <= p.mirrorSyncIntervalSeconds)
        .map(([provider, p]) => ({
            provider,
            syncIntervalSeconds: p.mirrorSyncIntervalSeconds,
            maxAgeSeconds: p.mirrorMaxAgeSeconds,
        }));
}

/**
 * En qué industrias significa algo cada proveedor.
 *
 * Vive acá y no en el servicio del contrato porque **la pantalla también la
 * necesita**: el panel puede mostrar una integración conectada, sana y fresca
 * cuya lectura el contrato no publica —porque este negocio no es de ese
 * rubro—, y el dueño no tiene forma de saberlo desde ahí. Un estado que sólo
 * conoce el runtime es un estado que la pantalla contradice.
 */
export const PROVIDER_INDUSTRIES: Readonly<Record<VerticalProviderName, readonly string[]>> =
    Object.freeze({
        toast: Object.freeze(['restaurantes']),
        mindbody: Object.freeze(['gimnasios']),
        cliniko: Object.freeze(['salud']),
    });

/**
 * Exact subtype profiles for which each connector models the same business.
 * Industry-only matching made `salud/farmacia` inherit Cliniko, even though a
 * pharmacy has inventory/dispensing workflows rather than a clinic schedule.
 */
export const PROVIDER_PROFILE_IDS: Readonly<Record<VerticalProviderName, readonly string[]>> =
    Object.freeze({
        toast: Object.freeze([
            'restaurantes/casual_dining',
            'restaurantes/comida_rapida',
            'restaurantes/cafeteria',
            'restaurantes/dark_kitchen',
        ]),
        mindbody: Object.freeze([
            'gimnasios/gimnasio_general',
            'gimnasios/crossfit',
            'gimnasios/yoga_pilates',
            'gimnasios/cycling',
            'gimnasios/martial_arts',
        ]),
        cliniko: Object.freeze([
            'salud/dental',
            'salud/medica_general',
            'salud/dermatologia',
            'salud/psicologia',
        ]),
    });

/**
 * Si este proveedor tiene sentido para la industria de este negocio.
 *
 * Sin industria conocida devuelve `true`: no saber el rubro no es motivo para
 * declarar inelegible una integración que el dueño conectó a mano. La puerta
 * que decide de verdad es la del contrato, que sí resuelve el perfil.
 */
export function providerFitsIndustry(
    provider: string,
    industry: string | null | undefined,
): boolean {
    const industries = (PROVIDER_INDUSTRIES as Record<string, readonly string[]>)[provider];
    if (!industries) return false;
    if (!industry) return true;
    return industries.includes(industry);
}

/** Match against the canonical profile whenever the subtype is known. */
export function providerFitsProfile(
    provider: string,
    industry: string | null | undefined,
    subtype: string | null | undefined,
): boolean {
    if (!providerFitsIndustry(provider, industry)) return false;
    // Old tenants without a subtype still get an industry-level diagnostic;
    // the effective runtime always has a resolved profile and uses the exact
    // list below.
    if (!industry || !subtype) return true;
    const canonical = canonicalSubtypeId(industry, subtype);
    if (!canonical) return false;
    const profileId = `${canonical.industry}/${canonical.subtype}`;
    const profiles = (PROVIDER_PROFILE_IDS as Record<string, readonly string[]>)[provider];
    return !!profiles?.includes(profileId);
}
