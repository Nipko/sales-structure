/**
 * Descriptor de formulario de un requisito (C0 §1.6 «Formularios generados desde la especificación», C6).
 *
 * `formFor(requisito)` lee `data.structure` y arma un descriptor `{type, fields, validation, example, help}` que el
 * panel pinta con un componente por tipo de campo (texto, sí/no, enum, lista, horario por día, duración, dinero…).
 * La API lo sirve (`GET /readiness/:tenantId/requirements/:id`), así el panel y la API no se desfasan entre despliegues.
 *
 * Puro y determinista. Se genera **por tipo**, no por requisito: la descripción de cada campo («enum [a, b]», «bool»,
 * «duration», «lista de {…}», «weekly_hours»…) decide el componente. Solo los requisitos cuya prosa no dice la forma
 * que leen sus evaluadores tienen un ajuste explícito en `ADJUSTMENTS` (los 13 bloqueantes del núcleo y las
 * plantillas `OBJ.*.WRITE_MODE` / `OBJ.*.CHANGE_RULES`). Lo que no se entiende cae en texto libre, nunca en un error.
 *
 * Las restricciones que el servidor exige (`validateRequirementValue`: requeridos, booleanos y enums cerrados) salen
 * de la misma lectura de la descripción, así un valor que el formulario acepta no lo rechaza la API por forma. Las
 * restricciones de más (largo mínimo, patrón, «al menos uno») son las que el evaluador del requisito necesita para
 * cumplir: el formulario las pide para que guardar sirva para salir del hueco.
 */
import { OBJECT_NOUNS } from '../engine/primitives';
import { RESERVABLE_OBJECTS } from '../facts';
import { isValueRequirement } from '../validate-value';
import type { CompiledRequirement, CompiledSpec } from '../types';

export const FORM_SCHEMA = 'business-spec/form@1';

export type FormFieldKind =
    | 'text' | 'textarea' | 'number' | 'bool' | 'enum' | 'enum_list' | 'string_list'
    | 'duration' | 'money' | 'day_spans' | 'address' | 'url' | 'email'
    | 'object' | 'list' | 'ref_or_own' | 'fixed' | 'readonly' | 'json';

export interface FormOption { value: string; label: string }

/** Condición de visibilidad (y de obligatoriedad) según otro campo del mismo objeto. */
export interface FormCondition { field: string; in?: string[]; notIn?: string[] }

export interface FormField {
    key: string;
    /** Etiqueta por defecto (en el idioma de la especificación); el panel la traduce por `key` si tiene la clave. */
    label: string;
    kind: FormFieldKind;
    required: boolean;
    /** Descripción del campo en la especificación. */
    help?: string;
    /** enum / enum_list (y sugerencias de string_list). */
    options?: FormOption[];
    /** enum_list abierto: admite valores fuera de la lista (la especificación termina la lista en «…»). */
    open?: boolean;
    /** object, list (campos de cada elemento), ref_or_own (campos del valor propio). */
    fields?: FormField[];
    /** duration. */
    units?: string[];
    minLength?: number;
    maxLength?: number;
    /** Expresión regular (fuente) para text. */
    pattern?: string;
    /** list / enum_list / string_list: mínimo de elementos para cumplir. */
    minItems?: number;
    /** ref_or_own / readonly: requisito del que sale el valor. */
    ref?: string;
    /** fixed: valor que siempre lleva. */
    fixed?: unknown;
    /** Visible (y requerido, si `required`) solo cuando se cumple. */
    when?: FormCondition;
}

export type FormMode = 'form' | 'screen' | 'none';

export interface FormDescriptor {
    schema: typeof FORM_SCHEMA;
    requirementId: string;
    title: string;
    /** `data.type` de la especificación. */
    type: string;
    /**
     * `form`: se completa en el cajón del panel y se guarda por `business-facts`.
     * `screen`: el dato vive en una pantalla de objeto (catálogos): el panel enlaza a `screens`.
     * `none`: no lo completa el dueño (derivado, de plataforma o solo de una integración: `sources.allowed` sin `owner_form`).
     */
    mode: FormMode;
    reason?: 'catalog' | 'items' | 'derived' | 'platform' | 'not_owner';
    /** Pantallas donde vive el dato (modo `screen`), por objeto cuando depende del objeto habilitado. */
    screens: { object: string | null; uiTarget: string }[];
    /** Forma del valor: objeto con campos, lista de elementos (cada uno con `fields`) o JSON libre. */
    root: 'object' | 'list' | 'json';
    fields: FormField[];
    /** `[]` es un valor válido («no hay», confirmado). */
    emptyAllowed: boolean;
    /** Reglas en prosa de la especificación (se muestran como ayuda). */
    validation: string[];
    example: unknown;
    help: string;
    /** El requisito se cumple aceptando el valor por defecto de la plataforma (C0 §2.5). */
    defaults: { acceptable: boolean; behavior: string } | null;
}

export const DURATION_UNITS = ['min', 'h', 'd', 'semanas', 'meses'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const WEEK_DAYS: readonly string[] = DAY_KEYS;
const CANCELLATION = 'CORE.POLICY.CANCELLATION_CHANGES';

// ─────────────────────────── lectura de la descripción ───────────────────────────

const humanize = (key: string): string => {
    const s = key.replace(/[_.]+/g, ' ').trim();
    return s ? s[0].toUpperCase() + s.slice(1) : key;
};

/**
 * Etiquetas en español de los campos que la especificación nombra con una clave técnica (ADR 0031, fricción 3). Sin
 * esta tabla la etiqueta salía de la clave («Own urgent line», «Red flags», «Consent text»): inglés en un panel en
 * español. El panel aún traduce por `key` (`readinessForms.fields.*`) cuando tiene la clave.
 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
    accepted: 'Aceptados', accepted_currencies: 'Monedas aceptadas', access_delete: 'Acceso y borrado de datos',
    accessibility: 'Accesibilidad', address_privacy_default: 'Privacidad de la dirección por defecto', age_threshold: 'Edad límite',
    agent_languages: 'Idiomas del agente', allowed: 'Permitido', alternative: 'Alternativa', amenities: 'Comodidades', amount: 'Monto',
    answer_becomes_knowledge: 'La respuesta se guarda como dato', applies_to: 'Aplica a', assistance_line: 'Línea de asistencia',
    bookable_by_name: 'Se reserva por nombre', buffer: 'Margen entre reservas', business_additions: 'Casos que agrega el negocio',
    capacity: 'Capacidad', carriers: 'Transportadoras', case: 'Caso', channel: 'Canal', check_in_from: 'Check-in desde',
    check_in_until: 'Check-in hasta', check_out_until: 'Check-out hasta', claim_steps: 'Pasos para reclamar', code: 'Código',
    condition: 'Condición', conditions: 'Condiciones', confirms: 'Quién confirma', conflict_check: 'Revisión de conflicto de interés',
    consent_text: 'Texto de consentimiento', content_source_language: 'Idioma del contenido', cost: 'Costo', coverage: 'Cobertura',
    coverages: 'Coberturas', crisis_lines: 'Líneas de crisis', damage_procedure: 'Procedimiento por daños', deductible: 'Deducible',
    default_rule: 'Regla general', delivery_time: 'Tiempo de entrega', deposit: 'Depósito', directions: 'Cómo llegar',
    disclaimer: 'Aviso', discreet_notifications: 'Avisos discretos', distance: 'Distancia', documents: 'Documentos', duration: 'Duración',
    early_late: 'Llegada temprana o salida tarde', electronic_invoice: 'Factura electrónica', eta: 'Tiempo estimado', exceptions: 'Excepciones',
    exchanges: 'Cambios de producto', external: 'Servicio externo', feeding: 'Alimentación', fields_visible: 'Datos visibles',
    formats: 'Formatos', fraud_line: 'Línea de fraude', free_from: 'Gratis desde', freeze: 'Congelamiento', freshness: 'Vigencia del dato',
    general_statement: 'Declaración general', group: 'Grupo', group_menu: 'Menú para grupos', guardian_fields: 'Datos del acudiente',
    guest_registration: 'Registro de huéspedes', hazards: 'Riesgos', help_center_url: 'Centro de ayuda', hold_allowed: 'Permite apartar',
    hold_duration: 'Tiempo apartado', horizon: 'Horizonte', hours: 'Horario', human_languages: 'Idiomas del equipo',
    human_only: 'Solo una persona', identity_level: 'Nivel de identificación', installments: 'Cuotas', instructions: 'Instrucciones',
    insurer: 'Aseguradora', insurers_accepted: 'Aseguradoras aceptadas', item: 'Ítem', kitchen_contact: 'Contacto de cocina',
    kyc_process: 'Verificación de identidad', lang: 'Idioma', languages: 'Idiomas', large_groups: 'Grupos grandes',
    last_ingested_at: 'Última lectura', lead_time: 'Anticipación mínima', level: 'Nivel', license_id: 'Número de licencia', line: 'Línea',
    makeup_allowed: 'Permite recuperar', makeup_window: 'Plazo para recuperar', mandatory: 'Obligatorio', max: 'Máximo',
    max_detail_in_chat: 'Qué no contar por el chat', max_party_online: 'Máximo de personas por reserva en línea',
    max_wait_in_hours: 'Espera máxima en horario', max_without_call: 'Máximo sin llamada', medication: 'Medicación',
    message: 'Mensaje', min: 'Mínimo', min_fields: 'Datos de salud que se piden por chat', min_order: 'Pedido mínimo',
    min_spend: 'Consumo mínimo', minors_authorization: 'Autorización de menores', model: 'Modelo', never_request: 'Nunca pedir',
    no_valuation: 'Sin avalúo', notify_customer_on_answer: 'Avisar al cliente al responder', numbers: 'Números', objects: 'Aplica a',
    offer: 'Oferta', offered: 'Se ofrece', on_timeout: 'Si nadie responde', opt_out: 'Darse de baja', optional_waivers: 'Exenciones opcionales',
    options: 'Opciones', ordering: 'Orden', outside_zone_policy: 'Fuera de la zona', own_urgent_line: 'Línea propia de urgencias',
    owner: 'Responsable', parking: 'Parqueadero', partners: 'Aliados', password_reset_url: 'Recuperar contraseña', per_holiday: 'Por festivo',
    per_item: 'Por ítem', pharmacist_handoff: 'Paso al farmacéutico', place: 'Lugar', platform_defaults: 'Casos de la plataforma',
    portfolio: 'Portafolio', prescription_intake: 'Recepción de fórmulas', priority_assignees: 'Responsables prioritarios',
    procedure: 'Procedimiento', professional_alert: 'Aviso al profesional', protected_filters_blocked: 'Filtros protegidos bloqueados',
    provider: 'Proveedor', published_advice: 'Consejos publicados', published_first_aid: 'Primeros auxilios publicados',
    published_ranges: 'Rangos publicados', rate: 'Tarifa', readable: 'El cliente puede consultarlas', reason: 'Motivo',
    recipients: 'Destinatarios', recommend: 'Recomendar', recorded: 'Registrado', red_flags: 'Señales de alarma',
    reentry_times: 'Tiempos de reingreso', refunds: 'Reembolsos', requires_assessment: 'Requiere valoración',
    resource_model: 'Modelo de recursos', response: 'Respuesta', retention: 'Conservación de datos', returns: 'Devoluciones',
    rule: 'Regla', scope: 'Alcance', sector: 'Sector', self_check_in: 'Check-in autónomo', sensitive_never: 'Datos sensibles que nunca se piden',
    services: 'Servicios', single_notice: 'Un solo aviso', sla: 'Plazo de respuesta', source: 'Fuente', space: 'Espacio',
    special_order: 'Pedido especial', status: 'Estado', status_page_url: 'Página de estado', status_vocabulary: 'Estados que ve el cliente',
    surcharge: 'Recargo', title: 'Título', topic: 'Tema', towing: 'Grúa', tracking: 'Seguimiento', translate_content: 'Traducir el contenido',
    turns: 'Turnos', urgent_slot: 'Cupo de urgencias', url: 'Enlace', usage_rights: 'Derechos de uso', valid_from: 'Válido desde',
    valid_to: 'Válido hasta', verified_by: 'Verificado por', vet_emergency: 'Urgencia veterinaria', waitlist: 'Lista de espera',
    when: 'Cuándo', who_can_approve: 'Quién aprueba', why: 'Por qué', zones: 'Zonas',
    country_pack: 'Paquete del país', operating_country: 'País', timezone: 'Zona horaria', currency: 'Moneda', default_locale: 'Idioma por defecto',
    address_privacy: 'Privacidad de la dirección', human_hours: 'Horario de atención humana', sla_in_hours: 'Tiempo de respuesta en horario',
    sla_out_of_hours: 'Fuera de horario', out_of_hours_message: 'Mensaje fuera de horario', callback_offered: 'Ofrece devolver la llamada',
    notes: 'Notas', routing: 'Reparto', mode: 'Modo', kind: 'Tipo', value: 'Valor', label: 'Etiqueta', name: 'Nombre', line2: 'Complemento',
    region: 'Departamento o estado', postal_code: 'Código postal', map_url: 'Enlace del mapa', request_message: 'Mensaje al cliente',
    business_confirm_sla: 'Plazo para que el negocio confirme', required_fields: 'Datos que pide al cliente',
};

/** Ayudas que reemplazan una descripción de tipo («ISO-3166», «IANA», «BCP-47»…) por una frase para el dueño. */
const TOKEN_HELP: readonly [RegExp, string][] = [
    [/ISO-3166/g, 'código de país de 2 letras'],
    [/ISO-4217/g, 'código de moneda de 3 letras'],
    [/\bBCP-47 list\b/g, 'idiomas (p. ej. es, en)'],
    [/\bBCP-47\b/g, 'idioma (p. ej. es-CO)'],
    [/\bIANA\b/g, 'zona horaria (p. ej. America/Bogota)'],
    [/\bISO-8601\b/g, ''],
];

/** Tipos de la especificación al inicio de una descripción: el componente ya lo dice, el dueño no lo necesita. */
const TYPE_PREFIX = /^(?:union \[[^\]]*\]|enum_list \[[^\]]*\]|enum \[[^\]]*\]|enum_list|enum|bool|text_i18n\??|int|money\??|duration\??|url|URL|contact_point|weekly_hours|policy_terms|address|requerido|opcional|derivado|lista de \{[\s\S]*\}|ref (?:CORE|OBJ|DOM|PROF)\.[A-Za-z0-9_.*]+)\s*/;

/**
 * La descripción de un campo en palabras del dueño (ADR 0031, fricción 3): sin el tipo de la especificación («enum […]»,
 * «bool (ref …)», «text_i18n»), sin referencias a ADR ni a requisitos, y con los estándares en una frase. Si lo que
 * queda sigue siendo notación (llaves, corchetes), no hay ayuda.
 */
export function ownerHelp(desc: string | undefined): string | undefined {
    if (!desc) return undefined;
    let s = desc.trim().replace(/^contact_point \+ horario/, 'teléfono o canal, y su horario').replace(/^ref pack de país/i, 'paquete del país');
    for (let i = 0; i < 3; i++) {
        const next = s.replace(TYPE_PREFIX, '').replace(/^[+?,;:\s]+/, '').trim();
        if (next === s) break;
        s = next;
    }
    s = s.replace(/;?\s*ADR \d+/g, '').replace(/\bref (?:CORE|OBJ|DOM|PROF)\.[A-Za-z0-9_.*]+/g, '').replace(/\(\s*\)/g, '');
    if (/^\(([^()]*)\)$/.test(s)) s = s.slice(1, -1).trim();
    for (const [re, text] of TOKEN_HELP) s = s.replace(re, text);
    s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,.;)])/g, '$1').trim();
    if (!s || /[{}[\]]|\b(?:text_i18n|enum|bool|iso_duration)\b|\b(?:CORE|OBJ|DOM|PROF)\.[A-Z]/.test(s)) return undefined;
    return s[0].toUpperCase() + s.slice(1);
}

/** Parte una lista por comas de primer nivel (fuera de [], {} y ()). */
export function splitTop(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
        if ('[{('.includes(ch)) depth++;
        if (']})'.includes(ch)) depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

/** Elementos de una lista de enum, igual que los lee `validateRequirementValue` (sin «…»). */
const listItems = (inner: string): string[] => inner.split(',').map(x => x.trim()).filter(x => x && !/^(…|\.\.\.)$/.test(x));
const isOpen = (inner: string): boolean => /…|\.\.\./.test(inner);
const options = (values: string[]): FormOption[] => values.map(v => ({ value: v, label: v.replace(/_/g, ' ') }));

const field = (key: string, kind: FormFieldKind, extra: Partial<FormField> = {}): FormField =>
    ({ key, label: FIELD_LABELS[key] ?? humanize(key), kind, required: false, ...extra });

const addressFields = (): FormField[] => [
    field('line1', 'text', { label: 'Dirección' }),
    field('line2', 'text'),
    field('city', 'text', { required: true, label: 'Ciudad' }),
    field('region', 'text'),
    field('country', 'text', { required: true, label: 'País', pattern: '^[A-Z]{2}$', help: 'Código de 2 letras (CO, MX, BR…)' }),
    field('postal_code', 'text'),
];

const durationField = (key: string, extra: Partial<FormField> = {}) => field(key, 'duration', { units: DURATION_UNITS, ...extra });

/** Términos de una política (C0 §5 `policy_terms`): plazo, cargo y reembolso. */
const termsFields = (opts: { withStatus?: boolean } = {}): FormField[] => [
    durationField('deadline', { label: 'Plazo', help: 'Hasta cuánto antes se puede (p. ej. 24 h antes).' }),
    ...(opts.withStatus ? [field('cancel_until_status', 'text', { label: 'Hasta qué estado del pedido', help: "Último estado en que se puede cancelar o cambiar (p. ej. 'antes de preparación')." })] : []),
    field('charge', 'text', { label: 'Cargo', help: "Qué se cobra (p. ej. 'ninguno', '50 %')." }),
    field('refund', 'text', { label: 'Reembolso', help: 'Cómo y en qué plazo se devuelve.' }),
];

const contactPointFields = (): FormField[] => [
    field('kind', 'enum', { required: true, options: options(['phone', 'whatsapp', 'email', 'web', 'social']) }),
    field('value', 'text', { required: true }),
    field('label', 'text'),
];

const weeklyHoursFields = (): FormField[] => [
    field('always_open', 'bool', { label: 'Abierto 24/7' }),
    field('days', 'day_spans', { label: 'Días y tramos', required: true, when: { field: 'always_open', notIn: ['true'] } }),
];

/** Campos de `{a, b: tipo, c?}` (elementos de una lista). */
function braceFields(inner: string): FormField[] {
    return splitTop(inner).map(part => {
        const m = part.match(/^([^:]+?)(\?)?(?::\s*([\s\S]*))?$/);
        const rawKey = (m?.[1] ?? part).trim();
        const optional = Boolean(m?.[2]) || rawKey.endsWith('?');
        const key = rawKey.replace(/\?$/, '');
        const f = parseField(key, (m?.[3] ?? '').trim());
        if (optional) f.required = false;
        return f;
    }).filter(f => /^[\p{L}_][\p{L}\p{N}_/|]*$/u.test(f.key) && !f.key.includes('|'));
}

/**
 * Un campo a partir de su descripción. Las formas normativas (`requerido`, `bool`, `enum […]`, `enum_list […]`) se
 * leen igual que en `validateRequirementValue`; el resto, por el tipo nombrado o por el nombre del campo.
 */
export function parseField(key: string, rawDesc: unknown): FormField {
    const desc = typeof rawDesc === 'string' ? rawDesc.trim() : rawDesc === true ? 'true' : String(rawDesc ?? '').trim();
    const help = ownerHelp(desc);
    const base = { help };
    let m: RegExpMatchArray | null;

    // `union [siguiente_apertura, iso_duration]` (R3b): un literal o una duración ISO-8601; el literal viejo `duration`
    // sigue siendo válido para las filas guardadas antes (validateRequirementValue).
    if ((m = desc.match(/^union \[([^\]]*)\]/))) {
        const members = listItems(m[1]);
        const literals = members.filter(x => x !== 'iso_duration').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const iso = members.includes('iso_duration') ? ['P(?!$)(\\d+Y)?(\\d+M)?(\\d+W)?(\\d+D)?(T(?=\\d)(\\d+H)?(\\d+M)?(\\d+(\\.\\d+)?S)?)?', 'duration'] : [];
        return field(key, 'text', { ...base, options: options(members.filter(x => x !== 'iso_duration')), pattern: `^(${[...literals, ...iso].join('|')})$` });
    }
    if (/^requerido\b/.test(desc)) return field(key, 'text', { ...base, required: true });
    if (/^opcional\b/.test(desc)) return field(key, 'text', base);
    if ((m = desc.match(/^enum \[([^\]]*)\]/))) return field(key, 'enum', { ...base, options: options(listItems(m[1])) });
    if ((m = desc.match(/^enum_list \[([^\]]*)\]/))) return field(key, 'enum_list', { ...base, options: options(listItems(m[1])), open: isOpen(m[1]) });
    if (/^enum_list\b/.test(desc)) return field(key, 'string_list', base);
    if (/^bool\b/.test(desc)) return field(key, 'bool', base);
    if (/^(siempre true|true)\b/.test(desc)) return field(key, 'fixed', { ...base, fixed: true });
    if (/^derivado\b/.test(desc)) return field(key, 'readonly', base);
    if ((m = desc.match(/^ref ((?:CORE|OBJ|DOM|PROF)\.[A-Z0-9_.]+?)(?:[.\s(]|$)/))) {
        return field(key, 'readonly', { ...base, ref: m[1].replace(/\.[a-z_]+$/, '') });
    }
    if (/^duration\b/.test(desc)) return durationField(key, base);
    if (/^money\b/.test(desc)) return field(key, 'money', base);
    if (/^int\b/.test(desc)) return field(key, 'number', base);
    if (/^weekly_hours\b/.test(desc)) return field(key, 'object', { ...base, fields: weeklyHoursFields() });
    if (/^policy_terms\b/.test(desc)) return field(key, 'object', { ...base, fields: termsFields() });
    if (/^address\b/.test(desc)) return field(key, 'address', { ...base, fields: addressFields() });
    if (/^contact_point\b/.test(desc)) return field(key, 'object', { ...base, fields: contactPointFields() });
    if (/^text_i18n\b/.test(desc)) return field(key, 'textarea', base);
    if (/^(url|URL)\b/.test(desc)) return field(key, 'url', base);
    if ((m = desc.match(/^lista de \{([\s\S]*)\}/))) return field(key, 'list', { ...base, fields: braceFields(m[1]) });
    if (/^lista fija\b/.test(desc)) return field(key, 'readonly', base);
    if (/^lista\b/.test(desc)) return field(key, 'string_list', base);
    if (/^mapa\b/.test(desc)) return field(key, 'json', base);
    if ((m = desc.match(/^([\p{L}_]+(?:\|[\p{L}_]+)+)$/u))) return field(key, 'enum', { ...base, options: options(m[1].split('|')) });
    // sin tipo: por el nombre del campo
    if (/(^|_)url$/.test(key)) return field(key, 'url', base);
    if (/(^|_)email$/.test(key)) return field(key, 'email', base);
    if (/^(is|has|allows|accepts)_/.test(key)) return field(key, 'bool', base);
    if (key === 'address') return field(key, 'address', { ...base, fields: addressFields() });
    return field(key, 'text', base);
}

// ─────────────────────────── ajustes por requisito ───────────────────────────

type Adjust = (d: FormDescriptor, req: CompiledRequirement, spec?: CompiledSpec) => void;

const find = (fields: FormField[], key: string) => fields.find(f => f.key === key);
/** Reemplaza (o agrega) un campo conservando su posición. `null` lo quita. */
function put(d: FormDescriptor, key: string, f: FormField | null): void {
    const i = d.fields.findIndex(x => x.key === key);
    if (f === null) { if (i >= 0) d.fields.splice(i, 1); return; }
    const help = f.help ?? (i >= 0 ? d.fields[i].help : undefined);
    const next = { ...f, ...(help ? { help } : {}) };
    if (i >= 0) d.fields[i] = next; else d.fields.push(next);
}
const patch = (d: FormDescriptor, key: string, extra: Partial<FormField>) => {
    const f = find(d.fields, key);
    if (f) Object.assign(f, extra);
};

/**
 * Respaldo de WRITE_MODE.required_fields cuando no hay especificación a mano: los campos comunes del diccionario
 * (`customer_fields_common` de objects.yaml). Con especificación, la lista es la CERRADA del objeto (R4, ADR 0010).
 */
const BOOKING_FIELDS = ['nombre', 'telefono', 'email', 'documento', 'fecha_hora', 'servicio', 'cantidad', 'direccion', 'notas'];
const CONFIRMATION_TERMS = ['ítem', 'fecha_hora', 'cantidad', 'total', 'depósito', 'cancelación'];

const ADJUSTMENTS: Readonly<Record<string, Adjust>> = {
    'CORE.IDENTITY.NAME': d => {
        patch(d, 'display_name', { label: 'Nombre visible', maxLength: 120 });
        patch(d, 'legal_name', { label: 'Razón social' });
    },
    'CORE.IDENTITY.DESCRIPTION': d => {
        patch(d, 'short', { kind: 'textarea', required: true, minLength: 40, maxLength: 300 });
        patch(d, 'audience', { required: true, minItems: 1 });
    },
    'CORE.IDENTITY.PROFILE': (d, _req, spec) => {
        const subtypes = spec ? Object.keys(spec.subtypeToProfile).sort() : [];
        put(d, 'subtype', subtypes.length
            ? field('subtype', 'enum', { label: 'Tipo de negocio', required: true, options: subtypes.map(s => ({ value: s, label: s })) })
            : field('subtype', 'text', { label: 'Tipo de negocio', required: true }));
        put(d, 'profile', field('profile', 'readonly', { help: 'Se deduce del tipo de negocio.' }));
        const objects = spec ? Object.values(spec.objects).map(o => ({ value: o.object, label: o.label })) : [];
        put(d, 'objects_enabled', objects.length
            ? field('objects_enabled', 'enum_list', { label: 'Qué atiende el agente', options: objects, help: 'Vacío = los del perfil.' })
            : field('objects_enabled', 'string_list', { label: 'Qué atiende el agente' }));
        put(d, 'domains', field('domains', 'readonly', { help: 'Derivado del perfil.' }));
        const domainFacts = spec ? [...new Set(Object.values(spec.profiles).flatMap(p => Object.keys(p.conditionalDomainFacts)))].sort() : [];
        put(d, 'operating_facts', field('operating_facts', 'object', {
            label: 'Cómo opera el negocio',
            fields: [
                field('modality', 'enum_list', { options: options(['presencial', 'online', 'a_domicilio']) }),
                field('delivery_offered', 'bool'),
                field('has_prepayment', 'bool'),
                ...(domainFacts.length ? [field('conditional_domain_facts', 'object', { fields: domainFacts.map(f => field(f, 'bool')) })] : []),
            ],
        }));
    },
    'CORE.IDENTITY.REGION': d => {
        patch(d, 'operating_country', { kind: 'text', required: true, pattern: '^[A-Z]{2}$', help: 'Código de 2 letras del país donde operas (CO, MX, BR…).' });
        patch(d, 'timezone', { kind: 'text', required: true, pattern: '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$|^UTC$', help: 'Zona horaria del negocio, p. ej. America/Bogota.' });
        patch(d, 'currency', { kind: 'text', required: true, pattern: '^[A-Z]{3}$', help: 'Código de 3 letras de la moneda en que cobras (COP, MXN, USD…).' });
        patch(d, 'default_locale', { kind: 'text', pattern: '^[a-z]{2,3}(-[A-Z]{2})?$', help: 'Idioma con el que responde el agente, p. ej. es-CO.' });
        put(d, 'country_pack', field('country_pack', 'readonly', { help: 'Lo resuelve la plataforma a partir del país.' }));
    },
    // ADR 0031 fricción 4: el contacto se pintaba como lista sin campos (un cuadro de JSON por elemento) y guardaba una
    // lista suelta, mientras el evaluador y el copiloto leen `{points: [...]}`. Ahora: canal, dato, etiqueta y horario.
    'CORE.CONTACT.CHANNELS': d => {
        d.root = 'object';
        d.emptyAllowed = true;
        d.fields = [field('points', 'list', {
            label: 'Canales de contacto',
            help: 'Teléfono, WhatsApp, correo, web o redes. Sin ninguno, el agente dice que te escriban por este mismo canal.',
            fields: [
                field('kind', 'enum', { required: true, label: 'Canal', options: options(['phone', 'whatsapp', 'email', 'web', 'social']) }),
                field('value', 'text', { required: true, label: 'Dato', help: 'El número con indicativo (+57…), el correo o el enlace.' }),
                field('label', 'text', { label: 'Etiqueta' }),
                field('hours', 'text', { label: 'Horario de este canal' }),
            ],
        })];
    },
    'CORE.LOCATIONS.LIST': d => {
        put(d, 'modality', field('modality', 'readonly', { ref: 'CORE.IDENTITY.PROFILE', help: 'Se declara en «Cómo opera el negocio» (perfil).' }));
        put(d, 'locations', field('locations', 'list', {
            label: 'Sedes', minItems: 1,
            fields: [
                field('name', 'text', { required: true, label: 'Nombre' }),
                field('address', 'address', { required: true, fields: addressFields() }),
                field('map_url', 'url'),
                field('is_main', 'bool', { label: 'Sede principal' }),
            ],
        }));
    },
    'CORE.HOURS.REGULAR': d => {
        put(d, 'scope', null);
        patch(d, 'always_open', { label: 'Abierto 24/7' });
        put(d, 'days', field('days', 'day_spans', { label: 'Días y tramos', required: true, when: { field: 'always_open', notIn: ['true'] } }));
        put(d, 'timezone', field('timezone', 'text', { help: 'Solo si es distinta de la zona del negocio.' }));
    },
    'CORE.PAYMENT.METHODS': d => {
        patch(d, 'methods', { required: true, minItems: 1 });
        put(d, 'by_channel', null);
    },
    'CORE.POLICY.CANCELLATION_CHANGES': d => {
        put(d, 'cancel', field('cancel', 'object', {
            required: true,
            fields: termsFields().map(f => (f.key === 'deadline' || f.key === 'charge' ? { ...f, required: true } : f)),
        }));
        put(d, 'change', field('change', 'object', { fields: termsFields() }));
        put(d, 'no_show', field('no_show', 'object', { fields: [field('charge', 'text', { label: 'Cargo o consecuencia' })] }));
        put(d, 'scope', null);
    },
    'CORE.PRIVACY.NOTICE': d => {
        put(d, 'controller', field('controller', 'object', {
            required: true,
            fields: [field('name', 'text', { required: true, label: 'Razón social' }), field('email', 'email'), field('phone', 'text')],
        }));
        patch(d, 'url_or_text', { kind: 'textarea', required: true });
        patch(d, 'version', { kind: 'number' });
    },
    'CORE.HANDOFF.TEAM': d => {
        put(d, 'assignees', field('assignees', 'string_list', { required: true, minItems: 1, help: 'Correos o nombres de quienes atienden.' }));
        patch(d, 'routing', { required: true });
        patch(d, 'notify_channels', { required: true, minItems: 1 });
    },
    'CORE.HANDOFF.HOURS_SLA': d => {
        patch(d, 'human_hours', { required: true });
        patch(d, 'sla_in_hours', { required: true });
        patch(d, 'sla_out_of_hours', { required: true });
    },
    'OBJ.*.WRITE_MODE': (d, req, spec) => {
        const active = { field: 'mode', notIn: ['none'] };
        const request = { field: 'mode', in: ['request_to_business'] };
        patch(d, 'mode', { required: true });
        // R4 (ADR 0010): lista CERRADA, el diccionario del objeto (objects.yaml `customer_fields`)
        const dictionary = (req.object && spec?.objects[req.object]?.customerFields) || BOOKING_FIELDS;
        put(d, 'required_fields', field('required_fields', 'enum_list', { options: options(dictionary), open: false, required: true, minItems: 1, when: active }));
        put(d, 'confirmation_terms', field('confirmation_terms', 'enum_list', { options: options(CONFIRMATION_TERMS), open: true, required: true, minItems: 1, when: active }));
        patch(d, 'consent_required', { when: active });
        patch(d, 'payment_required_to_confirm', { when: active });
        put(d, 'business_confirm_sla', durationField('business_confirm_sla', { required: true, when: request }));
        patch(d, 'request_message', { required: true, when: request });
    },
    'OBJ.*.CHANGE_RULES': (d, req) => {
        patch(d, 'agent_can_modify', { required: true });
        patch(d, 'agent_can_cancel', { required: true });
        // como el evaluador: solo un objeto con fecha u hora puede remitir a la política general de cancelación
        const own = !req.object || !RESERVABLE_OBJECTS.has(req.object);
        put(d, 'terms', own
            ? field('terms', 'object', { required: true, fields: termsFields({ withStatus: true }).map(f => (f.key === 'charge' ? { ...f, required: true } : f)) })
            : field('terms', 'ref_or_own', { required: true, ref: CANCELLATION, fields: termsFields({ withStatus: true }).map(f => (f.key === 'charge' ? { ...f, required: true } : f)) }));
    },
};

/** Requisitos guardados como valor pero cuyo evaluador lee los ítems del catálogo o los textos: se completan en su pantalla. */
const SCREEN_REQUIREMENTS: Readonly<Record<string, 'items'>> = {
    'CORE.OFFER.PRICE_MODEL': 'items',
    'CORE.OFFER.ITEM_DETAILS': 'items',
    'CORE.KNOWLEDGE.FAQ_HYGIENE': 'items',
};

const adjustmentFor = (req: CompiledRequirement): Adjust | undefined =>
    ADJUSTMENTS[req.id] ?? (req.templateId ? ADJUSTMENTS[req.templateId] : undefined);

/** Pantallas de catálogo por objeto (uiTarget de `OBJ.<O>.CATALOG`). */
function catalogScreens(spec?: CompiledSpec): FormDescriptor['screens'] {
    if (!spec) return [];
    return Object.values(spec.requirements)
        .filter(r => r.templateId === 'OBJ.*.CATALOG' && r.object && r.uiTarget)
        .map(r => ({ object: r.object as string, uiTarget: r.uiTarget as string }));
}

/**
 * Descriptor del formulario de un requisito. `spec` completa las listas que dependen de la especificación entera
 * (subtipos, objetos, hechos condicionales y pantallas de catálogo); sin ella el formulario usa texto libre.
 */
/**
 * El texto del cajón sin marcadores sin resolver (ADR 0031, fricción 3: «{objeto}», «{reservas}», «{n} precios»). El
 * objeto pone su sustantivo; una cifra que solo conoce la evaluación se dice sin número. El cajón muestra el mensaje
 * de la evaluación (con la cifra) cuando lo hay.
 */
function helpText(req: CompiledRequirement, text: string): string {
    const noun = req.object ? OBJECT_NOUNS[req.object] : undefined;
    const known: Record<string, string> = noun
        ? { objeto: noun.records, reservas: noun.records, 'ítems': noun.items, 'servicio/producto/plato…': noun.item, 'trámite': 'el trámite principal' }
        : { objeto: 'tus reservas', reservas: 'reservas', 'ítems': 'ítems', 'servicio/producto/plato…': 'ítem', 'trámite': 'el trámite principal' };
    // «{n} precios» → «Algunos precios»; «{n} preguntas» → «Algunas preguntas»
    const some = (next: string, start: boolean) => {
        const w = /(as|ión|iones)$/i.test(next) ? 'algunas' : 'algunos';
        return start ? w[0].toUpperCase() + w.slice(1) : w;
    };
    return String(text)
        .replace(/\{([^{}]+)\}/g, (m, key: string) => known[key] ?? m)
        .replace(/\{n\} de \{m\}\s+/g, '{n} ')
        .replace(/(^|[.!?]\s+)\{(?:n|m)\}\s+(\p{L}+)/gu, (_m, pre: string, next: string) => `${pre}${some(next, true)} ${next}`)
        .replace(/\{(?:n|m)\}\s+(\p{L}+)/gu, (_m, next: string) => `${some(next, false)} ${next}`)
        .replace(/\{(lista|campos)\}/g, 'lo que falta')
        .replace(/\{([^{}]+)\}/g, (_m, key: string) => known[key] ?? key.replace(/_/g, ' '));
}

export function formFor(req: CompiledRequirement, spec?: CompiledSpec): FormDescriptor {
    const type = String(req.data?.type ?? '');
    const structure = req.data?.structure;
    const validation = Array.isArray(req.data?.validation) ? (req.data.validation as unknown[]).map(String) : [];
    const help = helpText(req, typeof req.gapMessage === 'string' ? req.gapMessage : (Object.values(req.gapMessage)[0] ?? req.title));
    const d: FormDescriptor = {
        schema: FORM_SCHEMA, requirementId: req.id, title: req.title, type, mode: 'form', screens: [], root: 'object', fields: [],
        emptyAllowed: req.predicateKind === 'value_or_empty', validation, example: req.data?.example ?? null, help: String(help),
        defaults: req.predicateKind === 'default_accepted' ? { acceptable: true, behavior: req.whenMissing.behavior } : null,
    };

    if (!isValueRequirement(req) || SCREEN_REQUIREMENTS[req.id]) {
        d.mode = req.platform ? 'none' : req.derived || type === 'derived' ? 'none' : 'screen';
        d.reason = req.platform ? 'platform' : req.derived || type === 'derived' ? 'derived' : SCREEN_REQUIREMENTS[req.id] ? 'items' : 'catalog';
        if (d.mode === 'screen') {
            const own = req.uiTarget ? [{ object: req.object ?? null, uiTarget: req.uiTarget }] : [];
            d.screens = d.reason === 'items' || req.id === 'CORE.OFFER.ITEMS' ? (catalogScreens(spec).length ? catalogScreens(spec) : own) : own;
            if (req.id === 'CORE.KNOWLEDGE.FAQ_HYGIENE') d.screens = own;
        }
        return d;
    }

    if (structure && typeof structure === 'object' && !Array.isArray(structure)) {
        d.fields = Object.entries(structure as Record<string, unknown>).map(([rawKey, desc]) => {
            const key = rawKey.replace(/\?$/, '');
            const f = parseField(key, desc);
            if (rawKey.endsWith('?')) f.required = false;
            return f;
        });
        if (type === 'weekly_hours' && !find(d.fields, 'timezone')) d.fields.push(field('timezone', 'text'));
    } else if (typeof structure === 'string') {
        const s = structure.trim();
        const m = s.match(/^lista de \{([\s\S]*)\}/);
        if (m) { d.root = 'list'; d.fields = braceFields(m[1]); }
        else if (/^lista\b/.test(s)) { d.root = 'list'; d.fields = []; }
        else d.root = 'json';
        if (/vac[ií]o confirmado/.test(s)) d.emptyAllowed = true;
    } else {
        d.root = 'json';
    }
    if (d.root === 'list' && (/vac[ií]o/.test(validation.join(' ')) || req.predicateKind === 'value_or_empty')) d.emptyAllowed = true;

    adjustmentFor(req)?.(d, req, spec);
    if (!req.sources.allowed.includes('owner_form')) { d.mode = 'none'; d.reason = 'not_owner'; }
    return d;
}

/** ¿Este requisito se completa en el cajón del panel? */
export const hasOwnerForm = (req: CompiledRequirement): boolean => formFor(req).mode === 'form';

/**
 * Pantalla de cada requisito cuyo dato vive en el catálogo (`CORE.OFFER.ITEMS`, `PRICE_MODEL`, `ITEM_DETAILS`): la del
 * primer objeto habilitado del tenant que tenga catálogo. `ui_target` solo nombra una pantalla fija (la de servicios),
 * que no sirve a un restaurante ni a una tienda.
 */
export function screenTargetsFor(spec: CompiledSpec, enabledObjects: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of spec.order) {
        const form = formFor(spec.requirements[id], spec);
        if (form.mode !== 'screen' || form.screens.length < 2) continue;
        const screen = enabledObjects.map(o => form.screens.find(s => s.object === o)).find(Boolean);
        if (screen) out[id] = screen.uiTarget;
    }
    return out;
}

/** Requisitos con formulario del cajón (para que el panel sepa qué huecos abren el cajón sin pedir cada descriptor). */
export function formRequirementIds(spec: CompiledSpec): string[] {
    return spec.order.filter(id => hasOwnerForm(spec.requirements[id]));
}
