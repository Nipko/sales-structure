/**
 * D9 / D13 (sep-2026) — la receta del negocio, como contrato.
 *
 * Todo lo que el día 0 prellena sale de una receta, y hasta hoy la receta era
 * el registro de verticales: un agente con nombre, unas FAQ, unos servicios y
 * un horario. Con eso la pantalla "Conoce a {Nombre}" podía mostrar la mitad
 * de sus tarjetas y las otras nacían vacías, porque los datos que pedían no
 * existían en ninguna parte: cómo le compran al negocio, qué hace el agente
 * cuando no sabe, por qué motivos pasa a una persona con palabras que se
 * puedan leer, por qué canal conviene empezar, y qué tres preguntas le puede
 * hacer el dueño para ver si sirve.
 *
 * Este archivo es la parte que faltaba. Se agrega COMO CAPA OPCIONAL sobre
 * `VerticalDefinition` en vez de reescribirla: las 18 industrias siguen
 * compilando sin tocar una línea, los conteos pinneados en las pruebas no se
 * mueven, y una industria sin receta escrita simplemente no tiene `recipe`.
 * El lint mide la cobertura y dice cuáles faltan, que es distinto de romper.
 *
 * REGLA QUE GOBIERNA TODO EL CONTENIDO: una receta no inventa datos del
 * negocio. No sabe la dirección, ni el teléfono, ni si aceptan tarjeta, ni
 * cuántas horas antes se puede cancelar. Donde iría ese dato va un espacio en
 * blanco con nombre (`[dirección]`, `[horas]`) que el dueño llena tocándolo.
 * Un dato inventado que suena bien es peor que un espacio vacío: el espacio se
 * ve y se llena; la invención se despliega y le miente al cliente final.
 */

import type { LocalizedString } from './index';

/**
 * La familia decide las 5 preguntas canónicas y el vocabulario de espacios.
 *
 * No es la industria: "pastelería por encargo" y "ferretería" son industrias
 * distintas con la misma familia (pedidos), y por eso comparten las mismas
 * cinco preguntas. Apéndice B del diseño.
 */
export const RECIPE_FAMILIES = ['booking', 'orders_retail', 'real_estate', 'restaurants', 'professional'] as const;

export type RecipeFamily = typeof RECIPE_FAMILIES[number];

/**
 * Cómo le compran al negocio. Varios a la vez es normal: un restaurante toma
 * pedidos y reserva mesas; una academia agenda clases y cotiza el salón.
 */
export const PURCHASE_MODES = ['appointment', 'class', 'table', 'order', 'quote', 'inform'] as const;

export type PurchaseMode = typeof PURCHASE_MODES[number];

/**
 * Los espacios en blanco que una receta tiene permitido dejar.
 *
 * Es una lista cerrada a propósito: cada uno se convierte en un campo que la
 * tarjeta sabe pedir. Un `[lo que sea]` suelto sería un hueco que nadie llena
 * porque ninguna pantalla lo reclama, y terminaría saliendo tal cual por
 * WhatsApp.
 */
export const RECIPE_BLANKS = [
    'precio', 'servicio', 'producto', 'minutos', 'horas', 'días', 'tiempo',
    'dirección', 'referencia', 'zonas', 'hora', 'asesor', 'documentos',
    'condición', 'opciones', 'áreas', 'monto', 'servicios', 'trámite',
    'tipo de inmueble', 'zona', 'plato', 'bebida',
    // Agregados al escribir las seis primeras recetas, porque sin ellos la
    // frase correcta no se podía escribir y había que rodearla:
    'personas',        // cuántas caben en una mesa o en un grupo
    'barrio',          // el domicilio se pregunta por barrio, no por zona
    'envío',           // el costo del envío es OTRO precio en la misma frase
    'medios de pago',  // efectivo / transferencia / tarjeta, que el negocio elige
    'profesional',     // quién atiende: "asesor" se lee a inmobiliaria en un salón
    'sesiones',        // cuántas trae el paquete
    'nivel',           // A1, básico, módulo 1: lo más tecleado en una academia
    'edad',            // "desde los [edad] años"; el propio §3.3 del diseño lo usa
    'frecuencia',      // "2 veces por semana", que es como se cotiza un curso
    'modalidad',       // presencial, por internet, híbrida
] as const;

export type RecipeBlank = typeof RECIPE_BLANKS[number];

/** `[precio]` a partir del nombre del espacio. */
export function recipeBlank(name: RecipeBlank): string {
    return `[${name}]`;
}

/** Todos los espacios que aparecen en un texto, en orden de aparición. */
export function blanksIn(text: string): string[] {
    return Array.from(text.matchAll(/\[([^\]]+)\]/g), (m) => m[1]);
}

/**
 * Una de las cinco preguntas que el negocio recibe todos los días, con su
 * respuesta escrita y sus espacios sin llenar.
 */
export interface RecipeQuestion {
    question: LocalizedString;
    answer: LocalizedString;
    /**
     * A qué tarjeta del día 0 manda el espacio sin llenar. Sin esto la persona
     * lee "[dirección]" y no sabe dónde se pone la dirección.
     */
    fills?: RecipeBlank[];
}

/**
 * Por qué a este negocio le conviene ese canal. El "por qué" es el dato: una
 * lista de cinco canales en pie de igualdad devuelve la decisión al dueño sin
 * ayudarlo, que es lo que hacía la pantalla vieja.
 */
export interface RecipeChannelHint {
    /** `whatsapp` | `instagram` | `messenger` | `telegram` | `web_widget`. */
    channel: string;
    why: LocalizedString;
}

/** Un ida y vuelta de ejemplo, para la pantalla "¿Por qué me preguntan esto?". */
export interface RecipeConversationExample {
    customer: LocalizedString;
    agent: LocalizedString;
}

/**
 * Un motivo VISIBLE de pase a una persona, con el disparador que lo hace cierto.
 *
 * El motivo es la etiqueta del dueño ("Dolor fuerte o urgencia"); el disparador
 * es la cadena SIN TILDE que `handoff.service.ts` busca como substring en el
 * mensaje crudo del cliente ("dolor intenso"). Son textos distintos a propósito
 * y por eso el vínculo tiene que estar ESCRITO, no adivinado: emparejarlos por
 * coincidencia de palabras aceptaba fichas que el motor nunca iba a cumplir —
 * "Solicitud de cupo o pago de la matrícula" pasaba por la palabra "solicitud"
 * mientras el único disparador real era la frase "solicitud de beca", así que
 * un cliente que escribía "quiero pagar la matrícula" no escalaba nunca.
 *
 * El lint verifica que `trigger` exista de verdad entre los disparadores de ese
 * agente. Lo que no puede verificar —que el cliente use esas palabras— al menos
 * queda a la vista de quien escribe la receta.
 */
export interface RecipeHandoffReason {
    text: LocalizedString;
    /** Una de las cadenas de `agent.handoffTriggers.es`, tal cual, sin tilde. */
    trigger: string;
}

/**
 * La capa nueva de la receta. Todo opcional: una industria sin escribir no
 * rompe nada, sale en el reporte de cobertura del lint.
 */
export interface VerticalRecipeExtras {
    /** Decide las 5 preguntas canónicas (Apéndice B). */
    family?: RecipeFamily;
    /** Uno o varios; el primero es el que la tarjeta propone. */
    purchaseModes?: PurchaseMode[];
    /**
     * Dos o tres frases en segunda persona que describen el trabajo del agente.
     * Es lo que el dueño lee para entender qué compró, y lo que el editor
     * muestra cuando abre "Instrucciones".
     */
    mainInstructions?: LocalizedString;
    /**
     * Las tres salidas cuando no sabe: confirmar con el equipo, ofrecer dejar
     * el dato, o pasar a una persona. Redactadas, no descritas.
     */
    whenUnsure?: LocalizedString[];
    /**
     * Los motivos VISIBLES de pase a una persona: texto con tildes, 3 a 5,
     * que se pueden mostrar como fichas y editar, cada uno emparejado con el
     * disparador que lo hace cierto. Ver `RecipeHandoffReason`.
     */
    handoffReasons?: RecipeHandoffReason[];
    /** Las cinco de la familia, ya redactadas para esta industria. */
    canonicalQuestions?: RecipeQuestion[];
    /** Por dónde empezar y por qué, en orden de conveniencia. */
    recommendedChannels?: RecipeChannelHint[];
    /** Tres preguntas que el dueño le puede hacer al agente para probarlo. */
    testQuestions?: LocalizedString[];
    /** Tres ejemplos de conversación real del rubro. */
    conversationExamples?: RecipeConversationExample[];
}

/**
 * Cuántas de cada cosa espera el diseño. El lint los usa como límites, no como
 * igualdades exactas salvo donde el diseño fija el número.
 */
export const RECIPE_SHAPE = {
    canonicalQuestions: 5,
    whenUnsure: 3,
    testQuestions: 3,
    conversationExamples: 3,
    handoffReasonsMin: 3,
    handoffReasonsMax: 5,
    recommendedChannelsMin: 1,
    recommendedChannelsMax: 3,
} as const;

/**
 * Palabras que hacen escalar antes de responder.
 *
 * `handoff.service.ts` compara cada disparador por substring contra el mensaje
 * crudo, así que una pregunta canónica que contenga una de estas palabras se
 * escala en vez de contestarse, y el dueño ve al agente pasando a una persona
 * una pregunta que tenía escrita. El lint falla; el runtime, cuando una FAQ
 * coincide, deja ganar a la FAQ.
 */
export const PLATFORM_ESCALATION_WORDS = ['devolución', 'devolucion', 'descuento', 'abogado', 'emergencia', 'reembolso'] as const;

/** Quita tildes para comparar contra los disparadores, que van sin tilde. */
export function foldAccents(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
