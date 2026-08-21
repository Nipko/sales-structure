import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { PersonaService, type PersonaResolution } from '../persona/persona.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { ConversationsGateway } from './conversations.gateway';
import { HandoffService } from '../handoff/handoff.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LeadScoringService } from '../crm/services/lead-scoring/lead-scoring.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { NurturingService } from '../automation/nurturing.service';
import { DripSequenceService } from '../automation/drip-sequence.service';
import {
    NormalizedMessage, OutboundMessage, TenantConfig, TurnContext, RetrievedKnowledgeItem,
    ModelTier, RoutingFactors,
    localizedTerm, subtypeTerminologyFor, resolveSubtypeExperienceProfile,
    type LocalizedTerm,
} from '@parallext/shared';
import { outboundDedupeId, providerMessageId } from '../../common/utils/provider-message-id.util';
import { IdentityService } from '../identity/identity.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { buildUnverifiedPriceReply, enforceVerifiedPriceReply, ResponseValidatorService } from './response-validator.service';
import {
    auditTurnClaim,
    promisesLaterDelivery,
    toolResultSucceeded,
} from '../../common/utils/outcome-claim.util';
import { sanitizeToolResultForModel } from '../../common/utils/tool-error-sanitizer.util';
import { CustomerMemoryService } from './customer-memory.service';
import { GET_RESTAURANT_MENU_TOOL, GET_FITNESS_SCHEDULE_TOOL, LIST_CLINIC_SERVICES_TOOL, CHECK_CLINIC_AVAILABILITY_TOOL } from './tools/vertical-integration-tools';
import { VerticalIntegrationsService } from '../vertical-integrations/vertical-integrations.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { AttributionService } from '../attribution/attribution.service';
import { identityStepUpToolNames, identityStepUpToolsFor } from './identity-step-up-registration';
import { BookingEngineService, type BookingState } from './booking-engine.service';
import { ProcedureEngineService } from './procedure-engine.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import { PromptAssemblerService } from './prompt-assembler.service';
import { LanguageDetectorService } from './language-detector.service';
import { BusinessInfoService } from '../business-info/business-info.service';
import { PaymentOperationService } from './payment-operation.service';
import { discountToolsForRuntime, paymentToolsForRuntime } from './payment-tool-registration';
import { staticToolsForAgentConfig } from './agent-tool-registry';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { EffectiveCapabilityService } from './effective-capability.service';
import { ComplianceService as AnalyticsComplianceService } from '../analytics/compliance.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { MediaProcessingService } from '../media-processing/media-processing.service';
import { AiResolutionService } from '../analytics/ai-resolution.service';
import {
    isBusinessWriteTool,
    isConfirmableWriteTool,
    toolBatchRequiresSequentialExecution,
    toolRequiresSequentialExecution,
} from './tool-policy-registry';
import {
    CONTROL_ERRORS_REQUIRING_HUMAN,
    ToolExecutionControlService,
    classifyExplicitToolConfirmation,
} from './tool-execution-control.service';
import { ActiveOperationsContextService } from './active-operations-context.service';
import { ToolRetrievalService } from './tool-retrieval.service';
import { EmotionService } from './emotion.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';

/** Max characters of history to send to the LLM to avoid exceeding context window */
// History budget in TOKENS (not chars), measured against the smallest context window
// reachable by ANY plan: every plan's allowedTiers includes tier_4_budget, whose chain
// entry deepseek-chat has maxContextTokens=64_000. We reserve room for the system prompt
// + the reply, and cap the history so very long conversations don't blow up cost.
const MIN_MODEL_CONTEXT_TOKENS = 64_000;
const SYSTEM_PROMPT_RESERVE_TOKENS = 6_000;     // fallback when systemPrompt length unknown
const DEFAULT_RESPONSE_RESERVE_TOKENS = 1_500;  // when persona doesn't pin maxTokens
const HISTORY_SAFETY_MARGIN_TOKENS = 2_000;     // chars/4 underestimates JSON/emoji/non-latin
const HISTORY_MAX_TOKENS = 8_000;               // cap: ~32k chars (~2.6× the old 12k-char budget)
const CHARS_PER_TOKEN = 4;                       // repo-wide token estimator (chars/4)
/** How many of the turn's tool outcomes are carried into the next turn. */
const RECENT_ACTIONS_MAX = 6;

/**
 * The order in which each industry actually closes its sale.
 *
 * `<guidance>` has been in the prompt assembler for months and nothing outside a
 * spec ever filled it, so the agent knew the vertical's vocabulary but not its
 * sequence: it offered to book before checking availability, quoted without
 * looking the product up, and enrolled students into schedules it had not read.
 * One line per industry, naming the real tools, because a model follows a
 * concrete sequence far better than an abstract instruction to "be careful".
 *
 * Gated by the tools the tenant actually has enabled: guidance that names a tool
 * the agent cannot call is worse than no guidance at all.
 */
const VERTICAL_FLOW_GUIDANCE: Array<{
    industry: string;
    requires: string;
    guidance: string;
}> = [
    { industry: 'turismo', requires: 'properties', guidance: 'Para una estadía: list_properties → check_property_availability para las fechas exactas → resumí precio total y fechas → pedí confirmación → create_property_booking. Nunca ofrezcas una propiedad sin haber verificado esas fechas.' },
    { industry: 'turismo', requires: 'tours', guidance: 'Para un paquete: search_packages → check_package_availability para la fecha de salida → resumí precio y cupos → pedí confirmación → create_tour_booking.' },
    { industry: 'restaurantes', requires: 'restaurants', guidance: 'Para un pedido: get_menu → armá el pedido con el cliente → repetí los ítems, el total y la dirección → pedí confirmación → place_order. Para una mesa usá el flujo de reservas de agenda.' },
    { industry: 'gimnasios', requires: 'gyms', guidance: 'Para una clase: get_class_schedule → verificá que el contacto tenga membresía con get_my_membership → pedí confirmación → book_class. Si no es socio, ofrecé get_membership_plans antes de intentar reservar.' },
    { industry: 'education', requires: 'education', guidance: 'Para una inscripción: get_courses → get_course_schedule del curso elegido → resumí curso, horario y precio → pedí confirmación → enroll_student.' },
    { industry: 'seguros', requires: 'insurance', guidance: 'Para cotizar: get_insurance_plans → pedí sólo los datos que falten → calculate_quote y presentá el resultado. Para un reclamo, file_claim requiere verificar identidad primero (request_identity_code y verify_identity_code).' },
    { industry: 'servicios_hogar', requires: 'homeServices', guidance: 'Para una solicitud: entendé el problema y la dirección → resumí lo que vas a registrar → create_service_request. Después del registro la conversación pasa a una persona del equipo.' },
    { industry: 'fotografia', requires: 'photography', guidance: 'Para una sesión: list_photo_packages → send_portfolio si el cliente quiere ver trabajo previo → check_date_availability de la fecha → request_photo_quote.' },
    { industry: 'inmobiliaria', requires: 'realEstate', guidance: 'Para una visita: search_listings → get_listing_details del inmueble concreto → send_listing_image si ayuda → agendá la visita dejando SIEMPRE registrado de qué inmueble se trata.' },
    { industry: 'automotriz', requires: 'vehicles', guidance: 'Para una prueba de manejo: search_vehicles → get_vehicle_details del vehículo concreto → send_vehicle_image si ayuda → acordá día y hora → schedule_test_drive. Si el horario está tomado, ofrecé otro; nunca digas que quedó agendada sin que schedule_test_drive haya tenido éxito.' },
    { industry: 'veterinaria', requires: 'pets', guidance: 'Registrá la mascota con register_pet antes de agendar (list_pets_for_contact primero para no duplicarla). Ante señales de urgencia usá triage_pet_emergency de inmediato.' },
    // `salud` + catálogo es la farmacia: ninguna otra subespecialidad de salud
    // enciende catálogo. La regla de la fórmula médica vive en el writer, no
    // acá; esto sólo hace que el agente sepa POR QUÉ le van a decir que no y
    // qué ofrecer en su lugar.
    { industry: 'salud', requires: 'catalog', guidance: 'Para una venta de mostrador: search_products → check_stock antes de prometer disponibilidad → confirmá qué y cuántos → place_catalog_order. Lo que sale marcado como venta bajo fórmula médica NO se pide por chat: decilo con el nombre del producto y pasá la conversación a una persona del equipo para validar la receta. Nunca sugieras un medicamento para un síntoma, ni una dosis, ni un reemplazo de otro producto.' },
    { industry: 'retail', requires: 'catalog', guidance: 'Para una venta: search_products → get_product → check_stock antes de prometer disponibilidad → send_product_image si ayuda → confirmá qué y cuántos → place_catalog_order. Los precios salen del catálogo: vos sólo pasás productId y cantidad.' },
    { industry: 'otro', requires: 'catalog', guidance: 'Para una venta: search_products → get_product → check_stock → confirmá qué y cuántos → place_catalog_order. Nunca digas que el pedido quedó registrado sin que place_catalog_order haya tenido éxito.' },
];

function verticalFlowGuidance(industry: unknown, tools: any): string | undefined {
    if (typeof industry !== 'string' || !industry) return undefined;
    const enabled = (key: string) => tools?.[key]?.enabled === true;
    const lines = VERTICAL_FLOW_GUIDANCE
        .filter(entry => entry.industry === industry && enabled(entry.requires))
        .map(entry => entry.guidance);
    return lines.length ? lines.join(' ') : undefined;
}
// Returned when the LLM pipeline errors out. Sent to the customer but NOT counted
// as a successful AI response (no monthly-quota increment, no message_sent event).
// i18n'd like HANDOFF_MSG — errorFallbackText(lang) picks the customer's language.
// CRITICAL: the gating checks (quota at ~534, draft-mode at ~549, RAG-grounding at
// ~2177) must recognise this sentinel in ANY language, so they test membership via
// isErrorFallback() instead of a single-string === comparison.
const ERROR_FALLBACK_MSG: Record<string, string> = {
    es: 'Disculpa, tuve un problema procesando tu mensaje. ¿Podrías repetirlo?',
    en: 'Sorry, I ran into a problem processing your message. Could you say that again?',
    pt: 'Desculpe, tive um problema ao processar sua mensagem. Você poderia repetir?',
    fr: "Désolé, j'ai rencontré un problème en traitant votre message. Pourriez-vous le répéter ?",
};
const errorFallbackText = (lang?: string) =>
    ERROR_FALLBACK_MSG[(lang || 'es').slice(0, 2).toLowerCase()] || ERROR_FALLBACK_MSG.es;
const ERROR_FALLBACK_VALUES = new Set(Object.values(ERROR_FALLBACK_MSG));
/** True when a pipeline result IS the error fallback (in any supported language). */
const isErrorFallback = (text?: string | null): boolean => !!text && ERROR_FALLBACK_VALUES.has(text);

const WIDGET_HANDOFF_UNAVAILABLE: Record<string, string> = {
    es: 'En este canal todavía no puedo transferirte a una persona. Detuve la respuesta automática para no darte una expectativa falsa.',
    en: 'I cannot transfer you to a person in this channel yet. I stopped the automated reply so I do not set a false expectation.',
    pt: 'Ainda não posso transferir você para uma pessoa neste canal. Interrompi a resposta automática para não criar uma expectativa falsa.',
    fr: "Je ne peux pas encore vous transférer à une personne sur ce canal. J'ai arrêté la réponse automatique pour ne pas créer de fausse attente.",
};
const widgetHandoffUnavailableText = (lang?: string) => (
    WIDGET_HANDOFF_UNAVAILABLE[(lang || 'es').slice(0, 2).toLowerCase()]
    || WIDGET_HANDOFF_UNAVAILABLE.es
);

// Handoff messages, localized — deterministic layer (not persona copy) so it must be
// i18n'd here. Keyed by 2-letter language; falls back to Spanish.
const HANDOFF_MSG: Record<string, {
    withAgent: (n: string) => string;
    queueHead: string;
    queueN: (p: number) => string;
    transferring: string;
}> = {
    es: {
        withAgent: n => `Entiendo tu solicitud. Te estoy transfiriendo con *${n}* de nuestro equipo. Te responderá en un momento. 🙋`,
        queueHead: 'Entiendo tu solicitud. Te estoy transfiriendo con nuestro equipo de atención. Un agente te responderá en breve. 🙋',
        queueN: p => `Entiendo tu solicitud. Te estoy transfiriendo con nuestro equipo de atención. Eres el #${p} en cola. Un agente te atenderá lo antes posible. 🙋`,
        transferring: 'Te voy a transferir con un agente de nuestro equipo.',
    },
    en: {
        withAgent: n => `Got it. I'm transferring you to *${n}* from our team. They'll reply shortly. 🙋`,
        queueHead: `Got it. I'm transferring you to our support team. An agent will reply shortly. 🙋`,
        queueN: p => `Got it. I'm transferring you to our support team. You're #${p} in the queue. An agent will assist you as soon as possible. 🙋`,
        transferring: `I'll transfer you to an agent from our team.`,
    },
    pt: {
        withAgent: n => `Entendi. Estou te transferindo para *${n}* da nossa equipe. Em breve responderá. 🙋`,
        queueHead: 'Entendi. Estou te transferindo para nossa equipe de atendimento. Um atendente responderá em breve. 🙋',
        queueN: p => `Entendi. Estou te transferindo para nossa equipe. Você é o #${p} na fila. Um atendente vai te atender o quanto antes. 🙋`,
        transferring: 'Vou te transferir para um atendente da nossa equipe.',
    },
    fr: {
        withAgent: n => `Compris. Je vous transfère à *${n}* de notre équipe. Il/elle vous répondra dans un instant. 🙋`,
        queueHead: 'Compris. Je vous transfère à notre équipe support. Un agent vous répondra sous peu. 🙋',
        queueN: p => `Compris. Je vous transfère à notre équipe. Vous êtes #${p} dans la file. Un agent vous répondra dès que possible. 🙋`,
        transferring: 'Je vais vous transférer à un agent de notre équipe.',
    },
};
const handoffText = (lang?: string) => HANDOFF_MSG[(lang || 'es').slice(0, 2).toLowerCase()] || HANDOFF_MSG.es;

// Directive templates for an operation the SERVER executed after the customer
// confirmed. Deterministic layer, so i18n'd here like HANDOFF_MSG. The failure
// wording is deliberate: the model is told not to claim success, because the
// whole point of executing server-side is that the outcome is no longer a guess.
const EXECUTED_OPERATION_MSG: Record<string, { done: string; doneNoDetails: string; failed: string; awaitingPayment: string }> = {
    es: {
        done: 'La operación que el cliente acaba de confirmar YA quedó realizada. Confírmasela con naturalidad usando estos datos reales:',
        doneNoDetails: 'La operación que el cliente acaba de confirmar YA quedó realizada. Confírmasela con naturalidad.',
        failed: 'La operación NO se pudo completar. Explícaselo al cliente con claridad, NO afirmes que quedó hecha, y ofrécele una alternativa concreta. Motivo interno (no lo cites textualmente): {reason}',
        awaitingPayment: 'La solicitud quedó registrada pero NO está confirmada: este ítem requiere pago para confirmarse, y las fechas siguen disponibles para otros hasta que el pago se acredite. NO digas que quedó confirmada ni reservada. Decile con naturalidad qué falta pagar y pasale el enlace de pago. Datos reales:',
    },
    en: {
        done: 'The operation the customer just confirmed HAS been completed. Confirm it naturally using these real details:',
        doneNoDetails: 'The operation the customer just confirmed HAS been completed. Confirm it naturally.',
        failed: 'The operation could NOT be completed. Explain it clearly, do NOT claim it is done, and offer a concrete alternative. Internal reason (do not quote it verbatim): {reason}',
        awaitingPayment: 'The request was recorded but is NOT confirmed: this item requires payment to be confirmed, and the dates stay available to others until the payment clears. Do NOT say it is confirmed or booked. Tell them naturally what is left to pay and send the payment link. Real details:',
    },
    pt: {
        done: 'A operação que o cliente acabou de confirmar JÁ foi realizada. Confirme com naturalidade usando estes dados reais:',
        doneNoDetails: 'A operação que o cliente acabou de confirmar JÁ foi realizada. Confirme com naturalidade.',
        failed: 'A operação NÃO pôde ser concluída. Explique com clareza, NÃO afirme que está feita e ofereça uma alternativa concreta. Motivo interno (não cite textualmente): {reason}',
        awaitingPayment: 'A solicitação foi registrada mas NÃO está confirmada: este item exige pagamento para se confirmar, e as datas seguem disponíveis para outros até o pagamento ser compensado. NÃO diga que está confirmada nem reservada. Diga com naturalidade o que falta pagar e envie o link de pagamento. Dados reais:',
    },
    fr: {
        done: "L'opération que le client vient de confirmer A ÉTÉ réalisée. Confirmez-la naturellement avec ces données réelles :",
        doneNoDetails: "L'opération que le client vient de confirmer A ÉTÉ réalisée. Confirmez-la naturellement.",
        failed: "L'opération n'a PAS pu être effectuée. Expliquez-le clairement, n'affirmez PAS qu'elle est faite et proposez une alternative concrète. Raison interne (ne la citez pas telle quelle) : {reason}",
        awaitingPayment: "La demande a été enregistrée mais n'est PAS confirmée : cet article exige un paiement pour être confirmé, et les dates restent disponibles pour d'autres jusqu'à ce que le paiement soit encaissé. Ne dites PAS qu'elle est confirmée ni réservée. Dites naturellement ce qu'il reste à payer et envoyez le lien de paiement. Données réelles :",
    },
};

// Sent when the model insists on claiming an action that no tool performed, and
// the corrective rewrite also insisted. Better a flat, honest sentence than a
// confident lie about a booking that does not exist.
const UNVERIFIED_CLAIM_FALLBACK: Record<string, string> = {
    es: 'Todavía no puedo darte esa acción por confirmada: no me consta que se haya completado. Déjame verificarlo y te confirmo en un momento.',
    en: 'I cannot treat that as done yet: I have no confirmation that it completed. Let me check and get back to you in a moment.',
    pt: 'Ainda não posso considerar isso concluído: não tenho confirmação de que foi finalizado. Vou verificar e já te confirmo.',
    fr: "Je ne peux pas encore considérer cela comme fait : je n'ai pas de confirmation que l'opération a abouti. Je vérifie et je reviens vers vous.",
};
const unverifiedClaimFallbackText = (lang?: string) =>
    UNVERIFIED_CLAIM_FALLBACK[(lang || 'es').slice(0, 2).toLowerCase()] || UNVERIFIED_CLAIM_FALLBACK.es;

// The turn broke AFTER something real was committed. The generic error would
// have the customer believe nothing happened and ask for it all over again.
const PARTIAL_SUCCESS_MSG: Record<string, string> = {
    es: 'Tu solicitud quedó registrada correctamente, pero tuve un problema al terminar de responderte. No la repitas: alguien del equipo la revisa y te confirma los detalles enseguida.',
    en: 'Your request was recorded successfully, but I ran into a problem finishing my reply. Please do not send it again: someone from the team is checking it and will confirm the details shortly.',
    pt: 'Sua solicitação foi registrada corretamente, mas tive um problema ao terminar de responder. Não repita: alguém da equipe está verificando e confirma os detalhes em breve.',
    fr: "Votre demande a bien été enregistrée, mais j'ai eu un problème pour terminer ma réponse. Ne la renvoyez pas : quelqu'un de l'équipe vérifie et vous confirmera les détails sous peu.",
};
const partialSuccessText = (lang?: string) =>
    PARTIAL_SUCCESS_MSG[(lang || 'es').slice(0, 2).toLowerCase()] || PARTIAL_SUCCESS_MSG.es;

// Deterministic replies to appointment reminder / attendance buttons (not persona
// copy) — i18n'd here like HANDOFF_MSG. Keyed by 2-letter language; falls back to es.
const APPOINTMENT_REPLIES: Record<string, {
    confirmed: (service: string) => string;
    rescheduleLink: (link: string) => string;
    rescheduleNoLink: string;
    attendanceThanks: (service: string) => string;
    noShow: (service: string) => string;
}> = {
    es: {
        confirmed: s => `¡Perfecto! Tu cita de *${s}* ha sido confirmada. ¡Te esperamos!`,
        rescheduleLink: l => `¡Claro! Puedes reagendar tu cita aquí: ${l}\n\nSi prefieres, dime el día y hora que te convenga y te ayudo.`,
        rescheduleNoLink: `¡Claro! Dime el día y hora que te convenga y te ayudo a reagendar tu cita.`,
        attendanceThanks: s => `¡Excelente! Gracias por confirmar tu asistencia a *${s}*. ¿Hay algo más en lo que pueda ayudarte?`,
        noShow: s => `Entendido. Lamentamos que no hayas podido asistir a *${s}*. ¿Te gustaría agendar una nueva cita?`,
    },
    en: {
        confirmed: s => `Perfect! Your *${s}* appointment is confirmed. We look forward to seeing you!`,
        rescheduleLink: l => `Sure! You can reschedule your appointment here: ${l}\n\nOr just tell me the day and time that work for you and I'll help.`,
        rescheduleNoLink: `Sure! Just tell me the day and time that work for you and I'll help you reschedule.`,
        attendanceThanks: s => `Great! Thanks for confirming you attended *${s}*. Is there anything else I can help you with?`,
        noShow: s => `Got it. Sorry you couldn't make it to *${s}*. Would you like to book a new appointment?`,
    },
    pt: {
        confirmed: s => `Perfeito! Seu agendamento de *${s}* foi confirmado. Esperamos por você!`,
        rescheduleLink: l => `Claro! Você pode remarcar seu agendamento aqui: ${l}\n\nOu me diga o dia e horário que preferir e eu ajudo.`,
        rescheduleNoLink: `Claro! Me diga o dia e horário que preferir e eu ajudo a remarcar seu agendamento.`,
        attendanceThanks: s => `Excelente! Obrigado por confirmar sua presença em *${s}*. Posso ajudar em algo mais?`,
        noShow: s => `Entendido. Lamentamos que não tenha podido comparecer a *${s}*. Gostaria de agendar um novo horário?`,
    },
    fr: {
        confirmed: s => `Parfait ! Votre rendez-vous *${s}* est confirmé. Nous avons hâte de vous voir !`,
        rescheduleLink: l => `Bien sûr ! Vous pouvez reprogrammer votre rendez-vous ici : ${l}\n\nOu dites-moi le jour et l'heure qui vous conviennent et je vous aide.`,
        rescheduleNoLink: `Bien sûr ! Dites-moi le jour et l'heure qui vous conviennent et je vous aide à reprogrammer votre rendez-vous.`,
        attendanceThanks: s => `Excellent ! Merci d'avoir confirmé votre présence à *${s}*. Puis-je vous aider pour autre chose ?`,
        noShow: s => `Entendu. Nous sommes désolés que vous n'ayez pas pu venir à *${s}*. Souhaitez-vous prendre un nouveau rendez-vous ?`,
    },
};
const apptReplies = (lang?: string) => APPOINTMENT_REPLIES[(lang || 'es').slice(0, 2).toLowerCase()] || APPOINTMENT_REPLIES.es;
// Per-tool execution ceiling — a single tool (esp. an external MCP server) must
// never hang the whole conversational turn.
const TOOL_TIMEOUT_MS = 25_000;
// Tool concurrency comes from the canonical registry. This includes writers that
// the former name-based list missed (quotes, placement tests, identity codes and
// outbound media), while unknown/MCP tools remain serialized fail-safe.
const isWriteTool = (name: string): boolean => toolRequiresSequentialExecution(name);
// Burst debounce window: WhatsApp users send a thought across several quick
// messages. We wait this long for follow-ups and process the batch as one turn.
const DEBOUNCE_MS = 800;

/**
 * Marks that a turn ran to completion for a given provider message id.
 *
 * Deliberately a NEW namespace, separate from every edge-level `idem:*` key:
 * those answer "did we see this webhook", which a retry INSIDE the API sails
 * straight past. This answers "did we already finish answering it".
 */
const turnDoneKey = (tenantId: string, providerMsgId: string) => `turn:done:${tenantId}:${providerMsgId}`;

/**
 * The reply a turn decided on, stored before the first bubble is sent.
 *
 * A turn that dies mid-send (deploy restart, PgBouncer blip) is retried, and the
 * retry used to ask the LLM again — producing different words and a different
 * number of bubbles. The first bubble was dropped by its job id and the rest
 * were not, so the customer read the opening of one answer followed by the
 * middle of another. Same lifetime as `turn:done`.
 */
const turnReplyKey = (tenantId: string, providerMsgId: string) => `turn:reply:${tenantId}:${providerMsgId}`;

@Injectable()
export class ConversationsService {
    private readonly logger = new Logger(ConversationsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private personaService: PersonaService,
        private llmRouter: LLMRouterService,
        private channelGateway: ChannelGatewayService,
        private outboundQueue: OutboundQueueService,
        private channelToken: ChannelTokenService,
        private gateway: ConversationsGateway,
        private handoffService: HandoffService,
        private knowledgeService: KnowledgeService,
        private leadScoring: LeadScoringService,
        private pipelineService: PipelineService,
        private eventEmitter: EventEmitter2,
        private nurturingService: NurturingService,
        private dripSequenceService: DripSequenceService,
        private identityService: IdentityService,
        private toolExecutor: AIToolExecutorService,
        private responseValidator: ResponseValidatorService,
        private customerMemory: CustomerMemoryService,
        private bookingEngine: BookingEngineService,
        private procedureEngine: ProcedureEngineService,
        private intentInterpreter: IntentInterpreterService,
        private complianceService: AnalyticsComplianceService,
        private analyticsService: AnalyticsService,
        private promptAssembler: PromptAssemblerService,
        private languageDetector: LanguageDetectorService,
        private businessInfoService: BusinessInfoService,
        private throttle: TenantThrottleService,
        private mediaProcessing: MediaProcessingService,
        private aiResolutionService: AiResolutionService,
        private verticalIntegrations: VerticalIntegrationsService,
        private mcpClient: McpClientService,
        private attributionService: AttributionService,
        private activeOperationsContext: ActiveOperationsContextService,
        private paymentOperations: PaymentOperationService,
        private toolRetrieval: ToolRetrievalService,
        private emotionService: EmotionService,
        private toolExecutionControl: ToolExecutionControlService,
        // Optional so the specs that build this orchestrator by hand keep
        // compiling; the turn falls back to the previous behaviour when absent.
        private regionalProfile?: RegionalProfileService,
        private effectiveCapability?: EffectiveCapabilityService,
    ) {}

    /**
     * Main entry point for incoming messages from any channel
     */
    async processIncomingMessage(normalizedMsg: NormalizedMessage): Promise<void> {
        const { tenantId, contactId, channelType, content } = normalizedMsg;
        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
        if (!entitlement.allowed) {
            // Channel webhooks bypass JWT/HTTP subscription enforcement. Stop
            // before persistence, queues, tools or an LLM call.
            this.logger.warn(
                `[Entitlement] Dropped inbound ${channelType} message for tenant ${tenantId}: ${entitlement.error}`,
            );
            return;
        }
        const traceId = providerMessageId(normalizedMsg) || normalizedMsg.id || 'unknown';
        this.logger.log(`Processing inbound message from ${contactId} on ${channelType} for tenant ${tenantId} trace=${traceId}`);

        // Store-only sources: NEVER run an AI turn for them.
        //  - 'waba_echo': a message the BUSINESS sent from its own WhatsApp app
        //    (coexistence). Replying to it would mean the AI answering our own
        //    outbound text.
        //  - 'historical': coexistence backfill of up to 6 MONTHS of past chats.
        //    One onboarding would otherwise fire thousands of LLM turns and
        //    message customers about long-closed conversations.
        // The whatsapp microservice has always sent these to this same endpoint
        // assuming the API filtered them (see its comments at
        // jobs/webhook.processor.ts), but nothing here ever read metadata.source
        // or direction — so both ran the full pipeline.
        const source = (normalizedMsg.metadata as any)?.source;
        if (source === 'waba_echo' || source === 'historical') {
            await this.storeOnlyMessage(normalizedMsg, source);
            return;
        }

        await this.runTurn(normalizedMsg);

        // The turn finished without throwing. Mark it so a LATER provider
        // redelivery of the same message is recognised as already answered and
        // aborted — while a retry of an INTERRUPTED turn (no marker, because we
        // never got here) is allowed to resume and finally reply to the customer.
        // That distinction is what lets the inbound path be retried safely:
        // without it, the external_id dedupe would abort the very retry that a
        // restart-interrupted turn depends on, and the customer would get no
        // answer at all.
        const pmid = providerMessageId(normalizedMsg);
        if (pmid) {
            await this.redis.set(turnDoneKey(tenantId, pmid), '1', 86400).catch(() => { /* best-effort */ });
        }
    }

    /** The full AI turn. Split out so processIncomingMessage can stamp completion. */
    private async runTurn(normalizedMsg: NormalizedMessage): Promise<void> {
        const { tenantId, contactId, channelType, content } = normalizedMsg;

        // Server-clock receipt time (transient, not persisted) for the customer→reply
        // latency metric — avoids mixing the provider's clock (msg.timestamp) with the
        // worker's clock at send time. Same VPS for API + worker → negligible skew.
        (normalizedMsg as any).receivedAt = Date.now();

        // 0. Debounce bursts: WhatsApp users often send one thought as 3-5 short
        // messages. Buffer them and process the batch as ONE turn (less LLM cost,
        // no interleaved/double replies, better intent). Returns the combined text
        // for the LAST message of the burst; the earlier ones bail here.
        const combined = await this.debounceBurst(normalizedMsg).catch(() => undefined);
        if (combined === null) return; // a newer message arrived — it will flush the batch
        if (combined !== undefined) normalizedMsg.content.text = combined;

        // 1. Resolve Contact & Conversation.
        // Serialize find-or-create per contact: two near-simultaneous first
        // messages would otherwise each create a duplicate lead/conversation.
        // The conversation lock below can't prevent this — it keys on
        // conversation.id, which doesn't exist yet at this point.
        const contactLockKey = `lock:contact:${tenantId}:${channelType}:${contactId}`;
        let contactLockToken: string | null = null;
        for (let i = 0; i < 6 && !contactLockToken; i++) {
            contactLockToken = await this.redis.acquireLockToken(contactLockKey, 10).catch(() => null);
            if (!contactLockToken) await new Promise(r => setTimeout(r, 300));
        }
        let resolved: { contact: any; lead: any; conversation: any };
        try {
            resolved = await this.resolveConversation(tenantId, contactId, channelType, normalizedMsg);
        } finally {
            if (contactLockToken) await this.redis.releaseLockToken(contactLockKey, contactLockToken).catch(() => {});
        }
        const { contact, lead, conversation } = resolved;
        normalizedMsg.conversationId = conversation.id;

        // Click-to-WhatsApp ads attribution (T3.22): capture the ad referral on
        // the first ad-originated message. Best-effort, never blocks the pipeline.
        const referral = (normalizedMsg.metadata as any)?.referral;
        if (referral && contact?.id) {
            this.attributionService.captureReferral(tenantId, {
                contactId: contact.id, conversationId: conversation.id, referral,
            }).catch(() => {});
        }

        // Serialize message processing per conversation to prevent race conditions.
        // If a user sends 2 messages in quick succession, the second waits for the
        // first. The lock uses an ownership token so the release can't delete a
        // lock re-acquired by another turn after a TTL expiry, and a heartbeat
        // renews the TTL so a long turn (media + LLM fallback chains) never loses
        // the lock mid-flight.
        const lockKey = `lock:conv:${conversation.id}`;
        const LOCK_TTL = 30;
        let lockToken = await this.redis.acquireLockToken(lockKey, LOCK_TTL);
        if (!lockToken) {
            // Another message is being processed — wait (budget > TTL) for it to finish.
            for (let i = 0; i < 18; i++) {
                await new Promise(r => setTimeout(r, 2000));
                lockToken = await this.redis.acquireLockToken(lockKey, LOCK_TTL);
                if (lockToken) break;
            }
            if (!lockToken) {
                // Processing anyway meant two LLM turns on one conversation:
                // tools executed twice (two bookings, two orders), the booking
                // state overwritten by whichever finished last, and two replies
                // crossing in the customer's chat. With real turns running 10-60s
                // this was ordinary, not exotic — a second message 800ms after
                // the first is already past the burst window.
                //
                // Throwing hands the message back to BullMQ, which retries it
                // with backoff: it lands in the NEXT turn, in order, once. The
                // burst this turn had already merged goes back to the buffer
                // first, or the retry would answer only the last fragment.
                if (combined !== undefined && combined !== null) {
                    await this.restoreBurst(normalizedMsg, combined);
                }
                this.recordAgentSignal(tenantId, 'concurrent_turn_deferred');
                this.logger.warn(`[Pipeline] Could not acquire lock for conversation ${conversation.id} after waiting — re-queueing instead of running a concurrent turn`);
                throw new Error(`conversation_locked:${conversation.id}`);
            }
        }
        // Heartbeat: keep the lock alive while we process so a turn that legitimately
        // exceeds the TTL doesn't expire its lock and let a concurrent turn in.
        let lockHeartbeat: ReturnType<typeof setInterval> | undefined;
        if (lockToken) {
            const token = lockToken;
            lockHeartbeat = setInterval(() => {
                this.redis.renewLockToken(lockKey, token, LOCK_TTL).catch(() => {});
            }, 10_000);
            lockHeartbeat.unref?.();
        }

        try {

        const schemaName = await this.tenantSchema(tenantId);

        // Re-read the conversation snapshot AFTER acquiring the lock. While we
        // waited, the turn that held the lock may have changed status (e.g.
        // escalated to handoff) or bumped updated_at. The pre-lock snapshot from
        // resolveConversation can be stale, which would mis-route the handoff and
        // new-session checks below.
        try {
            const fresh = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT status, updated_at FROM conversations WHERE id = $1::uuid`,
                [conversation.id],
            );
            if (fresh?.length) {
                conversation.status = fresh[0].status;
                conversation.updated_at = fresh[0].updated_at;
            }
        } catch (e: any) {
            this.logger.debug(`[Pipeline] Snapshot re-read skipped: ${e.message}`);
        }

        // Capture the timestamp of the last message BEFORE we save the new one.
        // This is used later for new-session detection (30 min gap = fresh start).
        const previousMessageAt = conversation.updated_at || conversation.created_at;

        // Track conversation event (contactId here is the normalized external id
        // like a phone number — analytics needs the internal UUID)
        this.analyticsService.trackEvent({
            tenantId, eventType: 'conversation_started',
            conversationId: conversation.id, contactId: contact.id,
            data: { channelType },
        }).catch(() => {});

        // Cancel any pending nurturing follow-ups — customer responded
        this.nurturingService.cancelFollowUp(tenantId, conversation.id).catch(e =>
            this.logger.warn(`Nurturing cancel failed (non-fatal): ${e.message}`),
        );

        // Stop drip sequences when customer replies
        this.dripSequenceService.stopOnReply(tenantId, conversation.id).catch(e =>
            this.logger.warn(`Drip stop-on-reply failed (non-fatal): ${(e as Error).message}`),
        );

        // Auto-progress from the tenant's own initial/replied stages. Compatibility
        // aliases in the predicate repair legacy generic rows without persisting them.
        const [initialStage, repliedStage] = await Promise.all([
            this.pipelineService.resolveTenantStage(tenantId, undefined, { schemaName }),
            this.pipelineService.resolveTenantStage(tenantId, 'respondio', { schemaName }),
        ]);
        const replyOpportunities = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT id, lead_id, stage
               FROM opportunities
              WHERE conversation_id = $1::uuid`,
            [conversation.id],
        );
        for (const opportunity of replyOpportunities || []) {
            const current = await this.pipelineService.resolveTenantStage(
                tenantId,
                opportunity.stage,
                { schemaName },
            );
            if (current.slug !== initialStage.slug) continue;
            await this.pipelineService.writeLeadStage(
                tenantId,
                String(opportunity.lead_id),
                repliedStage.slug,
                {
                    schemaName,
                    opportunityId: String(opportunity.id),
                    triggeredBy: 'customer_reply',
                },
            );
        }

        // 2. Load Persona & Check Business Hours — per-connection agent resolution
        //    (two accounts of the same type can run different agents).
        const personaResolution = await this.personaService.resolvePersonaForChannel(
            tenantId,
            channelType,
            normalizedMsg.channelAccountId,
        );
        const config = personaResolution.config;
        this.logger.log(`[Pipeline] Persona loaded: ${config?.persona?.name || 'default'} (mode: ${(config as any)?._mode || 'wizard'})`);

        if (!config) {
            this.recordAgentSignal(tenantId, 'silent_turn');
            this.logger.error(`No active persona found for tenant ${tenantId}`);
            return;
        }

        const bizHours = await this.loadTenantBusinessHours(tenantId);
        const isOpen = this.isWithinBusinessHours(config, bizHours);
        const aiOutsideHours = config.hours?.aiOutsideHours ?? true;

        if (!isOpen && !aiOutsideHours) {
            this.logger.log(`[Pipeline] Outside business hours & AI off — sending after-hours message`);
            const afterHoursMsg = config.hours?.afterHoursMessageOverride || bizHours?.afterHoursMessage || config.hours?.afterHoursMessage;
            await this.sendAfterHoursMessage(tenantId, normalizedMsg, config, afterHoursMsg);
            return;
        }

        // 3. Check if in human handoff mode — skip AI, just save message
        if (conversation.status === 'waiting_human' || conversation.status === 'with_human') {
            this.logger.log(`Conversation ${conversation.id} is in HUMAN HANDOFF mode. Skipping AI.`);
            await this.saveMessage(tenantId, conversation.id, normalizedMsg);
            return;
        }

        // 4. Save User Message. A duplicate row means this exact provider message
        // was stored before — but that alone does NOT mean it was answered:
        //   · turn marked done  → a genuine redelivery of an answered message:
        //                         abort, or the customer gets a second reply.
        //   · no marker         → an earlier attempt stored it and then died
        //                         (deploy restart mid-LLM). Resume the turn so
        //                         the customer finally gets an answer; anything
        //                         that attempt already sent is dropped by the
        //                         outbound dedupeId, so no duplicate reaches them.
        let resumedReply: string | null = null;
        const saved = await this.saveMessage(tenantId, conversation.id, normalizedMsg);
        if (saved.duplicate) {
            const dupPmid = providerMessageId(normalizedMsg);
            const alreadyAnswered = dupPmid
                ? await this.redis.get(turnDoneKey(tenantId, dupPmid)).catch(() => null)
                : null;
            if (alreadyAnswered) {
                this.logger.warn(`[Pipeline] Redelivery of already-answered ${dupPmid} — skipping turn`);
                return;
            }
            this.logger.warn(`[Pipeline] Resuming interrupted turn for ${dupPmid} (message already stored)`);
            // What the interrupted attempt had already decided to say. Without
            // it the retry called the LLM again and got a DIFFERENT wording with
            // a different number of bubbles: bubble 0 was deduped by its job id
            // and bubbles 1..n were not, so the customer received the first half
            // of one answer followed by the second half of another.
            if (dupPmid) {
                resumedReply = await this.redis.get(turnReplyKey(tenantId, dupPmid)).catch(() => null);
                if (resumedReply) {
                    this.logger.warn(`[Pipeline] Reusing the reply the interrupted attempt had already produced for ${dupPmid}`);
                }
            }
        }
        const inboundMessageId = saved.id;
        this.logger.log(`[Pipeline] Message saved for conversation ${conversation.id}`);

        // Customer language for the deterministic appointment-button replies below:
        // the language detected on prior turns (persisted on the conversation), then
        // the tenant default, then Spanish.
        const apptReplyLang = (conversation.metadata as any)?.detectedLanguage || config.language || 'es';

        // 4.2 Check if this is a response to an appointment reminder template (Confirm/Reschedule buttons)
        if (content?.text) {
            const btnText = content.text.toLowerCase().trim();
            const isConfirmBtn = /^(✅\s*)?(confirmar asistencia|confirm attendance|confirmar presen[çc]a|confirmer)/i.test(btnText);
            const isRescheduleBtn = /^(🔄\s*)?(reagendar|reschedule|remarcar|reporter)/i.test(btnText);

            if (isConfirmBtn || isRescheduleBtn) {
                try {
                    const upcomingAppt = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                        `SELECT id, service_name FROM appointments
                         WHERE contact_id = $1::uuid
                           AND status IN ('pending', 'confirmed')
                           AND start_at > NOW()
                         ORDER BY start_at ASC LIMIT 1`,
                        [contact.id],
                    );
                    if (upcomingAppt?.length > 0) {
                        if (isConfirmBtn) {
                            await this.prisma.executeInTenantSchema(schemaName,
                                `UPDATE appointments SET status = 'confirmed', updated_at = NOW() WHERE id = $1::uuid`,
                                [upcomingAppt[0].id],
                            );
                            this.logger.log(`[Reminder] Client confirmed appointment ${upcomingAppt[0].id}`);
                            const confirmMsg = apptReplies(apptReplyLang).confirmed(upcomingAppt[0].service_name);
                            await this.sendResponse(tenantId, confirmMsg, normalizedMsg, undefined, 'appt:confirm');
                            await this.saveAiMessage(tenantId, conversation.id, confirmMsg, normalizedMsg.channelType);
                        } else {
                            this.logger.log(`[Reminder] Client wants to reschedule appointment ${upcomingAppt[0].id}`);
                            const tenantRows = await this.prisma.$queryRawUnsafe(
                                `SELECT slug FROM tenants WHERE id = $1::uuid LIMIT 1`, tenantId,
                            ) as any[];
                            const slug = tenantRows?.[0]?.slug;
                            const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://admin.parallly-chat.cloud';
                            const bookingLink = slug ? `${dashboardUrl}/book/${slug}` : '';
                            const R = apptReplies(apptReplyLang);
                            const rescheduleMsg = bookingLink ? R.rescheduleLink(bookingLink) : R.rescheduleNoLink;
                            await this.sendResponse(tenantId, rescheduleMsg, normalizedMsg, undefined, 'appt:reschedule');
                            await this.saveAiMessage(tenantId, conversation.id, rescheduleMsg, normalizedMsg.channelType);
                        }
                        return;
                    }
                } catch (e: any) {
                    this.logger.warn(`Reminder button handler failed (non-fatal): ${e.message}`);
                }
            }
        }

        // 4.3 Check if this is a response to an attendance confirmation
        if (content?.text) {
            const textLower = content.text.toLowerCase().trim();
            // Flag `u` obligatorio: 🔄 es U+1F504, fuera del BMP, así que sin `u`
            // el motor lo mete en la clase como sus DOS mitades sustitutas por
            // separado. Una de ellas (\uD83D) la comparten cientos de emojis
            // (😀😊👍…), de modo que un mensaje que empiece con cualquiera de
            // esos perdía su mitad alta y quedaba con un sustituto huérfano —
            // texto corrupto justo antes de evaluar si el cliente confirmó.
            const cleanText = textLower.replace(/^[✅❌🔄\s]+/u, '');
            const isYes = /^(s[ií]|yes|sim|oui|claro|por supuesto|asist[ií]|fui|s[ií],?\s*asist[ií]|confirmar asistencia|confirm attendance|confirmar presen[çc]a|confirmer|yes,?\s*i attended|sim,?\s*compareci|oui,?\s*j'y [eé]tais)\b/i.test(cleanText);
            const isNo = /^(no|n[aã]o|non|no pude|no asist[ií]|no fui|no pude asistir|could not attend|n[aã]o pude ir|je n'ai pas pu)\b/i.test(cleanText);

            if (isYes || isNo) {
                try {
                    // An attendance answer answers the attendance QUESTION.
                    //
                    // "Sí" is the most common word in these conversations, and
                    // for 48 hours after a follow-up this shortcut swallowed
                    // every one of them: a customer saying yes to something the
                    // agent had just asked got "¡gracias por confirmar tu
                    // asistencia!" and their real message never reached the AI.
                    // The follow-up is a WhatsApp template, so its wording is not
                    // in our hands — but its timing is: it went out when the
                    // appointment row was flagged, so only the FIRST inbound
                    // after that flag can be answering it.
                    const pendingAppt = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                        `SELECT a.id, a.service_name FROM appointments a
                         WHERE a.contact_id = $1::uuid
                           AND a.status IN ('pending', 'confirmed')
                           AND a.no_show_followed_up = true
                           AND a.end_at < NOW()
                           AND a.end_at > NOW() - INTERVAL '48 hours'
                           AND NOT EXISTS (
                               SELECT 1 FROM messages m
                                WHERE m.conversation_id = $2::uuid
                                  AND m.direction = 'inbound'
                                  AND m.created_at > a.updated_at
                                  AND ($3::uuid IS NULL OR m.id <> $3::uuid)
                           )
                         ORDER BY a.end_at DESC LIMIT 1`,
                        [contact.id, conversation.id, inboundMessageId || null],
                    );
                    if (pendingAppt?.length > 0) {
                        const apptId = pendingAppt[0].id;
                        if (isYes) {
                            await this.prisma.executeInTenantSchema(schemaName,
                                `UPDATE appointments SET status = 'completed', completed_at = NOW(), completed_by = 'client', updated_at = NOW() WHERE id = $1::uuid`,
                                [apptId],
                            );
                            this.logger.log(`[Attendance] Client confirmed attendance for appointment ${apptId}`);
                            const thankYou = apptReplies(apptReplyLang).attendanceThanks(pendingAppt[0].service_name);
                            await this.sendResponse(tenantId, thankYou, normalizedMsg, undefined, 'appt:thankyou');
                            await this.saveAiMessage(tenantId, conversation.id, thankYou, normalizedMsg.channelType);
                        } else {
                            await this.prisma.executeInTenantSchema(schemaName,
                                `UPDATE appointments SET status = 'no_show', updated_at = NOW() WHERE id = $1::uuid`,
                                [apptId],
                            );
                            this.logger.log(`[Attendance] Client confirmed no-show for appointment ${apptId}`);
                            const noShowMsg = apptReplies(apptReplyLang).noShow(pendingAppt[0].service_name);
                            await this.sendResponse(tenantId, noShowMsg, normalizedMsg, undefined, 'appt:noshow');
                            await this.saveAiMessage(tenantId, conversation.id, noShowMsg, normalizedMsg.channelType);
                        }
                        return; // Don't process through AI — attendance handled
                    }
                } catch (e: any) {
                    this.logger.warn(`Attendance check failed (non-fatal): ${e.message}`);
                }
            }
        }

        // 4.5 Opt-out detection (all channels)
        if (content?.text && this.complianceService.detectOptOut(content.text)) {
            this.logger.warn(`Opt-out detected from ${contactId} on ${channelType}`);
            await this.complianceService.processOptOut(tenantId, {
                leadId: lead?.id,
                phone: contactId,
                channel: channelType,
                triggerMessage: content.text,
                detectedFrom: 'keyword',
            }).catch(e => this.logger.warn(`Opt-out processing failed (non-fatal): ${e.message}`));
        }

        // 5. Check handoff triggers BEFORE generating AI response
        const handoffReason = this.handoffService.shouldHandoff(
            content?.text || '', conversation, config,
        );
        if (handoffReason) {
            // A configured handoff rule is an agent outcome even though it
            // deliberately avoids an LLM call.
            await this.persistConversationPersonaResolution(
                schemaName,
                String(conversation.id),
                personaResolution,
            );
            this.logger.warn(`HANDOFF TRIGGERED for conversation ${conversation.id}: ${handoffReason}`);
            this.analyticsService.trackEvent({
                tenantId, eventType: 'handoff_triggered',
                conversationId: conversation.id, contactId: contact.id,
                data: { reason: handoffReason },
            }).catch(() => {});
            const handoffResult = await this.handoffService.executeHandoff(tenantId, conversation.id, normalizedMsg, handoffReason);
            const agentName = handoffResult.assignedTo ? (handoffResult as any).assignedAgentName : null;
            // Handoff runs before userLanguage is computed — derive it from this message.
            const hl = handoffText(this.languageDetector.detect(content?.text || '', config.language || 'es'));
            let handoffMsg: string;
            if (agentName) {
                handoffMsg = hl.withAgent(agentName);
            } else {
                // Count how many conversations are in queue to give a position
                const queueCount = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                    `SELECT COUNT(*) as cnt FROM conversations WHERE status = 'waiting_human' AND assigned_to IS NULL`,
                    [],
                ).catch(() => [{ cnt: 0 }]);
                const position = Number(queueCount?.[0]?.cnt || 1);
                handoffMsg = position <= 1 ? hl.queueHead : hl.queueN(position);
            }
            await this.sendResponse(tenantId, handoffMsg, normalizedMsg, undefined, 'handoff');
            await this.saveAiMessage(tenantId, conversation.id, handoffMsg, normalizedMsg.channelType);
            return;
        }

        // 5b. Send typing indicator before AI generates response
        try {
            const accessToken = await this.resolveAccessToken(tenantId, channelType, normalizedMsg.channelAccountId);
            if (accessToken) {
                await this.channelGateway.sendTypingIndicator(
                    channelType as any, normalizedMsg.channelAccountId,
                    normalizedMsg.contactId, accessToken,
                );
            }
        } catch { /* non-blocking */ }

        // 6. AI message quota check (per-tenant, per-month)
        // Plans cap monthly AI volume (5K starter / 25K pro / 100K enterprise).
        // Over-quota: skip the LLM call and send a fallback that nudges the
        // tenant to upgrade. We never break the conversation thread for
        // customers — just stop calling the LLM.
        const hasQuota = await this.throttle.hasAiMessageQuota(tenantId);
        if (!hasQuota) {
            this.logger.warn(`[Pipeline] Tenant ${tenantId} exhausted AI message quota for the month. Sending fallback.`);
            const fallback = await this.buildQuotaFallbackMessage(tenantId);
            if (fallback) {
                await this.sendResponse(tenantId, fallback, normalizedMsg, undefined, 'fallback');
                await this.saveAiMessage(tenantId, conversation.id, fallback, channelType);
            }
            this.eventEmitter.emit('billing.quota.ai_messages_exhausted', { tenantId });
            return;
        }

        // 7. Generate AI Response
        await this.persistConversationPersonaResolution(
            schemaName,
            String(conversation.id),
            personaResolution,
        );
        this.logger.log(`[Pipeline] Generating AI response...`);
        const response = resumedReply
            || await this.generateResponse(tenantId, conversation, normalizedMsg, config, contact, lead, previousMessageAt, bizHours, inboundMessageId);

        // Persist the decision BEFORE any of it goes out, so a crash between the
        // first bubble and the last one is resumed with the same words instead of
        // a freshly generated answer stitched onto the old one.
        const replyPmid = providerMessageId(normalizedMsg);
        if (response && !resumedReply && replyPmid && !isErrorFallback(response)) {
            await this.redis.set(turnReplyKey(tenantId, replyPmid), response, 86400).catch(() => {});
        }

        // Auto-progress signals from the RESOLVED inbound text (post audio/image processing,
        // set by generateResponse on normalizedMsg) so voice-note / image purchase intent
        // isn't invisible, plus this turn's detected language for keyword selection.
        const resolvedInboundText = (normalizedMsg as any).resolvedText || content?.text || '';
        const complexity = this.llmRouter.analyzeComplexity(resolvedInboundText);
        const sentiment = this.llmRouter.analyzeSentiment(resolvedInboundText);
        const autoProgressLang = (normalizedMsg as any).detectedLang || (conversation.metadata as any)?.detectedLanguage || config.language || 'es';
        this.logger.log(`[Pipeline] AI response generated: ${response ? response.substring(0, 80) + '...' : 'NULL/EMPTY'}`);

        // Track AI response event + increment monthly quota counter — but NOT for
        // the error fallback (it isn't a real AI answer; counting it inflates the
        // monthly quota and emits a spurious message_sent event).
        if (response && !isErrorFallback(response)) {
            this.throttle.incrementAiMessageCount(tenantId).catch(() => {});
            this.analyticsService.trackEvent({
                tenantId, eventType: 'message_sent',
                conversationId: conversation.id, contactId: contact.id,
                data: { channelType, responseLength: response.length, source: 'ai' },
            }).catch(() => {});
        }

        // 7. Send Response via Channel Gateway
        // NOTE: Never block responses to inbound messages. If a customer writes,
        // we always respond. Opt-out blocking only applies to proactive outbound
        // (broadcasts, automations, reminders) — not to conversation replies.
        if (response) {
            const draftMode = (config.behavior as any)?.draftMode === true;
            if (draftMode && !isErrorFallback(response)) {
                // Draft-for-approval (WS3 #6): a human reviews/edits/sends in the
                // console instead of the AI replying directly. Store the suggestion
                // and notify the inbox; the customer gets nothing until approval.
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE conversations SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{pendingDraft}', $2::jsonb), updated_at = NOW() WHERE id = $1::uuid`,
                    [conversation.id, JSON.stringify({ text: response, createdAt: new Date().toISOString() })],
                ).catch(e => this.logger.warn(`Draft persist failed: ${e.message}`));
                this.eventEmitter.emit('draft.suggested', {
                    tenantId, conversationId: conversation.id, text: response, contactName: contact?.name,
                });
                this.logger.log(`[Pipeline] Draft mode — reply suggested to console (not sent to customer)`);
            } else {
                // Deliver long, multi-paragraph replies as 2-3 natural bubbles (more
                // human than a wall of text). Short replies go as one message. Bubbles
                // are staggered so they arrive in order with a brief pause.
                const chunks = this.splitResponseIntoChunks(response);
                const CHUNK_GAP_MS = 1200;
                this.logger.log(`[Pipeline] Sending response via outbound queue (${chunks.length} bubble(s))...`);
                const turnPmid = providerMessageId(normalizedMsg) || normalizedMsg.id || '';
                for (let i = 0; i < chunks.length; i++) {
                    await this.sendResponse(tenantId, chunks[i], normalizedMsg, i * CHUNK_GAP_MS, `reply:${i}`);
                    await this.saveAiMessage(
                        tenantId, conversation.id, chunks[i], normalizedMsg.channelType,
                        turnPmid ? `out:${turnPmid}:reply:${i}` : undefined,
                    );
                }
                this.logger.log(`[Pipeline] Response sent and saved`);
            }
        } else {
            this.logger.warn(`[Pipeline] No response generated — customer gets no reply`);
            this.recordAgentSignal(tenantId, 'silent_turn');
        }

        // 8. Auto-progress pipeline stage based on conversation signals
        this.pipelineService.autoProgressFromConversation(tenantId, conversation.id, {
            complexity,
            sentiment,
            messageText: resolvedInboundText,
            isFirstAiResponse: !!response,
            isCustomerReply: true,
            lang: autoProgressLang,
        }).catch(e =>
            this.logger.warn(`Pipeline auto-progress failed (non-fatal): ${e.message}`),
        );

        // 9. Fire-and-forget scoring update
        this.leadScoring.scoreAfterMessage(tenantId, conversation.id).catch(e =>
            this.logger.warn(`Scoring update failed: ${e.message}`),
        );

        // 10. Schedule nurturing follow-up in case customer doesn't respond
        if (response) {
            this.nurturingService.scheduleFollowUp(tenantId, conversation.id, lead.id).catch(e =>
                this.logger.warn(`Nurturing schedule failed (non-fatal): ${e.message}`),
            );
        }

        } finally {
            // Stop the heartbeat and release the conversation lock — but only if we
            // still own it (compare-and-delete), so we never delete a lock another
            // turn re-acquired after a TTL expiry.
            if (lockHeartbeat) clearInterval(lockHeartbeat);
            if (lockToken) {
                await this.redis.releaseLockToken(lockKey, lockToken).catch(e => this.logger.warn(`Lock release failed for ${lockKey}: ${e.message}`));
            }
        }
    }

    /**
     * Resolve or create contact, lead, conversation, and opportunity
     */
    private async resolveConversation(tenantId: string, contactId: string, channelType: string, msg: NormalizedMessage) {
        const schemaName = await this.tenantSchema(tenantId);

        // 1. Find or create contact
        let contact = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM contacts WHERE external_id = $1 AND channel_type = $2`,
            [contactId, channelType],
        ).then(res => res[0]);

        const metaName = (msg.metadata as any)?.contactName || '';
        const metaPic = (msg.metadata as any)?.contactProfilePic || '';

        if (!contact) {
            const phoneNorm = normalizePhoneE164(contactId);
            contact = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO contacts (external_id, channel_type, name, phone, phone_normalized, avatar_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [contactId, channelType, metaName || 'Unknown', contactId, phoneNorm, metaPic || null],
            ).then(res => res[0]);
        } else {
            // Update name/avatar if we now have better data
            const updates: string[] = [];
            const updateParams: any[] = [];
            let pn = 1;

            if (contact.name === 'Unknown' && metaName) {
                updates.push(`name = $${pn++}`);
                updateParams.push(metaName);
            }
            if (!contact.avatar_url && metaPic) {
                updates.push(`avatar_url = $${pn++}`);
                updateParams.push(metaPic);
            }

            if (updates.length > 0) {
                updateParams.push(contact.id);
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE contacts SET ${updates.join(', ')} WHERE id = $${pn}::uuid`,
                    updateParams,
                );
                if (metaName && contact.name === 'Unknown') contact.name = metaName;
                if (metaPic && !contact.avatar_url) contact.avatar_url = metaPic;
            }
        }

        // 1b. Resolve unified identity
        try {
            await this.identityService.resolveOrCreateProfile(tenantId, {
                id: contact.id, phone: contact.phone, email: contact.email,
                name: contact.name, channelType, externalId: contactId,
            });
        } catch (e: any) {
            this.logger.warn(`[Pipeline] Identity resolution failed (non-fatal): ${e.message}`);
        }

        // 2. Find or create lead
        const initialPipelineStage = await this.pipelineService.resolveTenantStage(
            tenantId,
            undefined,
            { schemaName },
        );
        const contactIdStr = String(contact.id);
        let lead = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM leads WHERE contact_id = $1::uuid LIMIT 1`,
            [contactIdStr],
        ).then(res => res[0]);

        let isNewLead = false;
        const resolvedName = (msg.metadata as any)?.contactName as string || '';
        if (!lead) {
            const nameParts = resolvedName.split(' ');
            const firstName = nameParts[0] || 'Unknown';
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

            lead = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                // Seed score=1 (the lead-scoring service's own neutral default, see
                // lead-scoring.service defaultResult). A brand-new lead has zero
                // behavioral signal — seeding 10 (the hottest) wrongly flagged every new
                // lead as "ready" and, via value-routing, inflated ticketValue to max.
                // The scoring cron recalculates on the next message.
                `INSERT INTO leads (contact_id, first_name, last_name, phone, stage, score)
                 VALUES ($1::uuid, $2, $3, $4, $5, 1) RETURNING *`,
                [contactIdStr, firstName, lastName, contactId, initialPipelineStage.slug],
            ).then(res => res[0]);
            isNewLead = true;
        } else if (lead.first_name === 'Unknown' && resolvedName) {
            const nameParts = resolvedName.split(' ');
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE leads SET first_name = $1, last_name = $2 WHERE id = $3::uuid`,
                [nameParts[0], nameParts.length > 1 ? nameParts.slice(1).join(' ') : null, lead.id],
            );
        }

        // 3. Find active conversation for the same channel ACCOUNT, or create new.
        //    Multi-account aware: a customer writing to two different numbers/pages of
        //    the same tenant gets a separate conversation per account. Historical rows
        //    with a NULL channel_account_id still match (backward compat) and are
        //    preferred least; an exact account match wins. When the inbound has no
        //    account id ($3 NULL), this degrades to the legacy contact+type match.
        let conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM conversations
             WHERE contact_id = $1::uuid AND channel_type = $2
               AND ($3::text IS NULL OR channel_account_id = $3 OR channel_account_id IS NULL)
               AND status IN ('active', 'waiting_human', 'with_human', 'snoozed')
             ORDER BY (channel_account_id IS NOT DISTINCT FROM $3::text) DESC, created_at DESC
             LIMIT 1`,
            [contactIdStr, msg.channelType, msg.channelAccountId ?? null],
        ).then(res => res[0]);

        // El cliente escribió: el "posponer hasta mañana" quedó sin efecto.
        // Antes 'snoozed' no entraba en el IN de arriba, así que se le abría una
        // conversación NUEVA y el historial se partía en dos justo con el
        // cliente al que el agente había decidido seguir después.
        if (conversation?.status === 'snoozed') {
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET status = 'active', snoozed_until = NULL, updated_at = NOW() WHERE id = $1::uuid`,
                [String(conversation.id)],
            ).catch(() => { /* el turno sigue; a lo sumo lo despierta el barrido */ });
            conversation.status = 'active';
        }

        // Backfill a legacy NULL-account conversation with the account it's now being
        // used from, so future routing is exact.
        if (conversation && !conversation.channel_account_id && msg.channelAccountId) {
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET channel_account_id = $1 WHERE id = $2::uuid`,
                [msg.channelAccountId, String(conversation.id)],
            ).catch(() => { /* non-fatal */ });
            conversation.channel_account_id = msg.channelAccountId;
        }

        if (!conversation) {
            conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO conversations (contact_id, channel_type, channel_account_id, status, stage) VALUES ($1::uuid, $2, $3, 'active', 'greeting') RETURNING *`,
                [contactIdStr, msg.channelType, msg.channelAccountId],
            ).then(res => res[0]);

            // A returning customer is not a stranger.
            //
            // History is read per conversation, so once the previous one was
            // resolved (the 72h cron does this routinely) the customer came back
            // three days later to an agent with a blank slate: "¿quedó mi
            // reserva?" met "¿me das tu nombre?". Carrying the tail of the last
            // conversation forward is enough for the agent to pick up the thread;
            // the booking itself still comes from <active_objects>.
            try {
                const previous = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                    `SELECT m.direction, m.content_text
                       FROM messages m
                       JOIN conversations c ON c.id = m.conversation_id
                      WHERE c.contact_id = $1::uuid
                        AND c.id <> $2::uuid
                        AND m.content_text IS NOT NULL
                        AND m.created_at > NOW() - INTERVAL '30 days'
                      ORDER BY m.created_at DESC
                      LIMIT 6`,
                    [contactIdStr, String(conversation.id)],
                );
                if (previous?.length) {
                    const carried = previous.reverse().map((m: any) => ({
                        direction: m.direction,
                        content_text: String(m.content_text || '').slice(0, 400),
                    }));
                    await this.prisma.executeInTenantSchema(schemaName,
                        `UPDATE conversations
                            SET metadata = jsonb_set(
                                COALESCE(metadata, '{}'::jsonb), '{carriedContext}', $2::jsonb, true
                            )
                          WHERE id = $1::uuid`,
                        [String(conversation.id), JSON.stringify(carried)],
                    );
                    conversation.metadata = { ...(conversation.metadata || {}), carriedContext: carried };
                    this.logger.log(`[Pipeline] Carried ${carried.length} message(s) of context from the contact's previous conversation`);
                }
            } catch (e: any) {
                this.logger.debug(`Carried-context lookup skipped: ${e.message}`);
            }

            // Create an opportunity only if the lead doesn't already have an active one
            const existingOpp = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT id FROM opportunities
                 WHERE lead_id = $1::uuid AND won_at IS NULL AND lost_at IS NULL LIMIT 1`,
                [String(lead.id)],
            );
            if (!existingOpp?.length) {
                await this.prisma.executeInTenantSchema(schemaName,
                    `INSERT INTO opportunities (lead_id, conversation_id, stage, score)
                     VALUES ($1::uuid, $2::uuid, $3, 10)
                     RETURNING id`,
                    [String(lead.id), String(conversation.id), initialPipelineStage.slug],
                );
            }
        }

        if (lead?.id) {
            const activeOpp = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT id, stage FROM opportunities
                 WHERE lead_id = $1::uuid AND won_at IS NULL AND lost_at IS NULL LIMIT 1`,
                [String(lead.id)],
            );
            const oppStage = activeOpp?.[0]?.stage || initialPipelineStage.slug;
            const oppId = activeOpp?.[0]?.id;
            if (oppId) await this.pipelineService.syncOpportunityToDeal(
                tenantId,
                String(lead.id),
                oppStage,
                String(oppId),
            ).catch(e =>
                this.logger.error(`Failed to sync opportunity to deal on conversation start: ${e.message}`)
            );
        }

        // Emit lead.captured event for new leads so automation rules can fire
        if (isNewLead) {
            this.eventEmitter.emit('lead.captured', {
                tenantId,
                schemaName,
                leadId: lead.id,
                contactId: contact.id,
                conversationId: conversation.id,
                phone: contactId,
                name: contact.name,
                channel: channelType,
                source: 'whatsapp_inbound',
            });
            this.logger.log(`Emitted lead.captured for new lead ${lead.id}`);
        }

        return { contact, lead, conversation };
    }

    private async loadTenantBusinessHours(tenantId: string): Promise<any | null> {
        const cacheKey = `biz_hours:${tenantId}`;
        const cached = await this.redis.getJson(cacheKey);
        if (cached) return cached;

        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { settings: true },
            });
            const settings = (tenant?.settings as any) || {};
            const bh = settings.businessHours || null;
            if (bh) {
                await this.redis.setJson(cacheKey, bh, 300);
            }
            return bh;
        } catch (e) {
            this.logger.warn(`Failed to load tenant business hours: ${(e as Error).message}`);
            return null;
        }
    }

    /**
     * Persist the exact first durable live agent/configuration for a conversation.
     * If another agent/version later handles the same conversation, retain the
     * original identity for audit history but mark the attribution conflicted so
     * neither version receives production credit for a mixed transcript.
     */
    private async persistConversationPersonaResolution(
        schemaName: string,
        conversationId: string,
        resolution: PersonaResolution,
    ): Promise<void> {
        if (!resolution.agentId || resolution.version == null) return;
        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE conversations
                    SET agent_attribution_conflicted =
                            COALESCE(agent_attribution_conflicted, false)
                            OR (
                                agent_persona_id IS NOT NULL
                                AND (
                                    agent_persona_id IS DISTINCT FROM $2::uuid
                                    OR agent_config_version IS DISTINCT FROM $3::integer
                                )
                            ),
                        agent_config_version = CASE
                            WHEN agent_persona_id IS NULL THEN $3::integer
                            ELSE agent_config_version
                        END,
                        agent_persona_id = COALESCE(agent_persona_id, $2::uuid)
                  WHERE id = $1::uuid`,
                [conversationId, resolution.agentId, resolution.version],
            );
        } catch (error: any) {
            // Observability cannot block the customer-facing turn; lazy DDL is
            // retried by persona resolution on a later message.
            this.logger.warn(
                `[Attribution] Could not stamp conversation ${conversationId}: ${error?.message || error}`,
            );
        }
    }

    private isWithinBusinessHours(config: TenantConfig, bizHours?: any): boolean {
        // Priority: tenant-level business hours > agent-level schedule (backward compat)
        if (bizHours) {
            if (bizHours.is247) return true;

            const schedule = bizHours.schedule;
            if (!schedule || Object.keys(schedule).length === 0) return true;

            const timezone = bizHours.timezone || config.hours?.timezone || 'America/Bogota';
            return this.checkScheduleTime(schedule, timezone, 'english');
        }

        // Fallback: agent-level schedule (legacy)
        if (!config.hours || !config.hours.schedule) return true;

        const schedule: Record<string, any> = config.hours.schedule as any;
        if (Object.keys(schedule).length === 0) return true;

        const values = Object.values(schedule);
        if (values.length >= 7) {
            const all247 = values.every(v =>
                v && typeof v === 'object' && (v as any).start === '00:00' && (v as any).end === '23:59'
            );
            if (all247) return true;
        }

        const timezone = config.hours.timezone || 'America/Bogota';
        return this.checkScheduleTime(schedule, timezone, 'spanish');
    }

    private checkScheduleTime(schedule: Record<string, any>, timezone: string, keyFormat: 'english' | 'spanish'): boolean {
        const now = new Date();
        const localTime = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(now);

        const dayFull = localTime.find(p => p.type === 'weekday')?.value?.toLowerCase() || '';
        const hourPart = localTime.find(p => p.type === 'hour')?.value || '0';
        const minutePart = localTime.find(p => p.type === 'minute')?.value || '0';
        const currentMinutes = parseInt(hourPart) * 60 + parseInt(minutePart);

        let todaySchedule: any;

        if (keyFormat === 'english') {
            // Tenant business hours use English day keys (monday, tuesday, etc.)
            todaySchedule = schedule[dayFull];
            // New format: { enabled, open, close }
            if (todaySchedule && typeof todaySchedule === 'object' && 'enabled' in todaySchedule) {
                if (!todaySchedule.enabled) return false;
                const openKey = todaySchedule.open || todaySchedule.start;
                const closeKey = todaySchedule.close || todaySchedule.end;
                if (!openKey || !closeKey) return false;
                const [startH, startM] = openKey.split(':').map(Number);
                const [endH, endM] = closeKey.split(':').map(Number);
                return currentMinutes >= (startH * 60 + startM) && currentMinutes <= (endH * 60 + endM);
            }
        }

        if (keyFormat === 'spanish') {
            // Agent schedule uses Spanish keys (lun, mar, etc.)
            const dayMapToSpanish: Record<string, string> = {
                sunday: 'dom', monday: 'lun', tuesday: 'mar', wednesday: 'mie',
                thursday: 'jue', friday: 'vie', saturday: 'sab',
            };
            const dayKey = dayMapToSpanish[dayFull] || dayFull;
            todaySchedule = schedule[dayKey] || schedule[dayFull];
        }

        this.logger.debug(`[BusinessHours] day=${dayFull} time=${hourPart}:${minutePart} schedule=${JSON.stringify(todaySchedule)} format=${keyFormat}`);

        if (!todaySchedule || typeof todaySchedule === 'string') return false;

        const startKey = todaySchedule.start || todaySchedule.open;
        const endKey = todaySchedule.end || todaySchedule.close;
        if (!startKey || !endKey) return false;

        const [startH, startM] = startKey.split(':').map(Number);
        const [endH, endM] = endKey.split(':').map(Number);
        return currentMinutes >= (startH * 60 + startM) && currentMinutes <= (endH * 60 + endM);
    }

    private async sendAfterHoursMessage(tenantId: string, msg: NormalizedMessage, config: TenantConfig, afterHoursText?: string) {
        const rawText = afterHoursText || config.hours?.afterHoursMessage;
        if (!rawText) return;

        this.logger.log(`Sending after hours message to ${msg.contactId}`);

        let text = rawText;
        try {
            const lang = config.language || 'es-CO';
            const personaName = config.persona?.name || 'Assistant';
            const result = await this.llmRouter.execute({
                model: 'grok-4-1-fast-non-reasoning',
                messages: [{ role: 'user', content: `Rewrite naturally:\n${text}` }],
                systemPrompt: `You are ${personaName}. Rewrite this after-hours message in ${lang}. Be warm and concise.`,
                temperature: 0.7,
                tenantId,
            });
            text = result.content || text;
        } catch {} // Fallback to raw message

        const outbound: OutboundMessage = {
            tenantId,
            channelType: msg.channelType,
            channelAccountId: msg.channelAccountId,
            to: msg.contactId,
            content: { type: 'text', text },
            // Keep e2e latency coverage consistent with sendResponse/sendMedia.
            metadata: { inboundTs: this.inboundTs(msg) },
            // This branch replies and returns WITHOUT saving the inbound message,
            // so the external_id dedupe never sees it — the jobId is the only
            // thing stopping a redelivery from sending the notice twice.
            dedupeId: outboundDedupeId(msg, 'after-hours'),
        };

        const accessToken = await this.resolveAccessToken(tenantId, msg.channelType, msg.channelAccountId);
        await this.outboundQueue.enqueue(outbound, accessToken);
    }

    /**
     * Persist a message into its conversation WITHOUT running the AI pipeline.
     *
     * Used by coexistence sources ('waba_echo' = the business replying from its
     * own WhatsApp app, 'historical' = the 6-month chat backfill). They must
     * appear in the inbox timeline and keep the contact/conversation threaded,
     * but must never trigger a reply, a handoff, booking, or automations.
     *
     * Direction is honoured here (an echo is OUTBOUND); saveMessage() hardcodes
     * 'inbound' because that is all the live pipeline ever produces.
     */
    private async storeOnlyMessage(msg: NormalizedMessage, source: string): Promise<void> {
        const { tenantId, contactId, channelType } = msg;
        try {
            // Same contact lock as the live path: two near-simultaneous first
            // messages would otherwise each create a duplicate lead/conversation.
            const contactLockKey = `lock:contact:${tenantId}:${channelType}:${contactId}`;
            let contactLockToken: string | null = null;
            for (let i = 0; i < 6 && !contactLockToken; i++) {
                contactLockToken = await this.redis.acquireLockToken(contactLockKey, 10).catch(() => null);
                if (!contactLockToken) await new Promise(r => setTimeout(r, 300));
            }
            let conversation: any;
            try {
                ({ conversation } = await this.resolveConversation(tenantId, contactId, channelType, msg));
            } finally {
                if (contactLockToken) await this.redis.releaseLockToken(contactLockKey, contactLockToken).catch(() => {});
            }

            const schemaName = await this.tenantSchema(tenantId);
            const direction = msg.direction === 'outbound' ? 'outbound' : 'inbound';
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, metadata)
                 VALUES ($1::uuid, $2, $3, $4, 'delivered', $5::jsonb)`,
                [conversation.id, direction, msg.content.type, msg.content.text, JSON.stringify(msg.metadata || {})],
            );

            this.logger.log(`[StoreOnly] Stored ${source} message (${direction}) for tenant ${tenantId} — AI skipped`);
        } catch (err: any) {
            this.logger.error(`[StoreOnly] Failed to store ${source} message for tenant ${tenantId}: ${err.message}`);
            throw err;
        }
    }

    /**
     * Persist the inbound message. Returns `{ duplicate: true }` when the
     * provider already delivered this exact message before.
     *
     * The dedupe is the DB's partial unique index on `external_id` (the
     * provider's own message id), so it holds across processes, restarts and
     * Redis flushes — the durable backstop under every edge-level `idem:*` key.
     * On conflict NOTHING downstream runs: no timeline event, no push, no
     * tenant webhook, and the caller aborts the turn instead of replying twice.
     */
    private async saveMessage(tenantId: string, conversationId: string, msg: NormalizedMessage): Promise<{ id?: string; duplicate: boolean }> {
        const schemaName = await this.tenantSchema(tenantId);
        const metadataJson = JSON.stringify(msg.metadata || {});
        const externalId = providerMessageId(msg);

        // The WHERE clause must match the index predicate literally or Postgres
        // cannot infer the partial unique index (runtime error, not compile-time).
        const params = [conversationId, msg.content.type, msg.content.text, externalId, metadataJson];
        let result: any[];
        try {
            result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, external_id, metadata)
                 VALUES ($1::uuid, 'inbound', $2, $3, 'delivered', $4, $5::jsonb)
                 ON CONFLICT ("external_id") WHERE "external_id" IS NOT NULL DO NOTHING
                 RETURNING *`,
                params,
            );
        } catch (err: any) {
            // 42P10 = no unique/exclusion constraint matches the ON CONFLICT spec,
            // i.e. uidx_messages_external_id is missing from THIS tenant schema
            // (the deploy applies tenant-schema.sql tolerantly, so one schema can
            // lag). Degrade to a plain insert — losing dedupe for this tenant is
            // vastly better than failing every inbound message it receives — and
            // log loudly so the missing index gets fixed.
            const code = err?.code || err?.meta?.code;
            if (code !== '42P10' && !/no unique or exclusion constraint/i.test(err?.message || '')) throw err;
            this.logger.error(
                `[Pipeline] uidx_messages_external_id missing on ${schemaName} — inserting without dedupe. ` +
                `Re-apply prisma/tenant-schema.sql to this schema.`,
            );
            result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, external_id, metadata)
                 VALUES ($1::uuid, 'inbound', $2, $3, 'delivered', $4, $5::jsonb) RETURNING *`,
                params,
            );
        }

        if (result.length === 0) {
            // Only reachable with a non-null external_id — a genuine redelivery.
            this.logger.warn(`[Pipeline] Duplicate inbound ${externalId} for tenant ${tenantId} — already stored`);
            return { duplicate: true };
        }

        // Funnel stage 3: stamp first inbound message arrival on the tenant
        // exactly once. The conditional UPDATE is idempotent so subsequent
        // messages skip the write at the row level (no extra read).
        this.prisma.$executeRawUnsafe(
            `UPDATE public.tenants SET first_message_at = NOW()
             WHERE id = $1::uuid AND first_message_at IS NULL`,
            tenantId,
        ).catch(() => { /* non-blocking */ });
        // Update conversation timestamp so new-session detection works correctly
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations SET updated_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
        );
        // Enrich payload so the dashboard can render the right channel icon /
        // contact label even when the conversation is not yet in its list.
        // The messages table has no channel_type column — that lives on
        // conversations — so the frontend was defaulting to 'whatsapp' for
        // first-message-of-an-unknown-conversation events.
        this.gateway.emitNewMessage(tenantId, {
            ...result[0],
            channel_type: msg.channelType,
        }, conversationId);

        this.eventEmitter.emit('message.inbound', {
            tenantId,
            conversationId,
            contactId: msg.contactId,
            phone: msg.metadata?.phone,
            channel: msg.channelType,
            messageType: msg.content.type,
            text: msg.content.text,
        });

        return { id: result[0]?.id as string | undefined, duplicate: false };
    }

    private async saveAiMessage(
        tenantId: string,
        conversationId: string,
        text: string,
        channelType?: string,
        /**
         * Stable identity of this outbound within its turn (the same string used
         * as the send's dedupe key). A retried turn re-saved every chunk it had
         * already stored, so the history the model reads back showed the agent
         * answering the same message twice — and then it behaved accordingly.
         */
        externalId?: string,
    ) {
        const schemaName = await this.tenantSchema(tenantId);

        const plainInsert = () => this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status)
             VALUES ($1::uuid, 'outbound', 'text', $2, 'delivered') RETURNING *`,
            [conversationId, text],
        );

        let result: any[];
        if (!externalId) {
            result = await plainInsert();
        } else {
            try {
                // `uidx_messages_external_id` is a PARTIAL unique index
                // (WHERE external_id IS NOT NULL), and Postgres only matches a
                // partial index when ON CONFLICT repeats its predicate. Without
                // it every reply raised 42P10 and the whole turn failed — the
                // customer received nothing at all.
                result = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                    `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, external_id)
                     VALUES ($1::uuid, 'outbound', 'text', $2, 'delivered', $3)
                     ON CONFLICT ("external_id") WHERE "external_id" IS NOT NULL DO NOTHING
                     RETURNING *`,
                    [conversationId, text, externalId],
                );
            } catch (err: any) {
                // Same degradation the inbound path already had: a schema whose
                // index lagged the deploy loses dedupe, never the reply.
                const code = err?.code || err?.meta?.code;
                if (code !== '42P10' && !/no unique or exclusion constraint/i.test(err?.message || '')) throw err;
                this.logger.error(
                    `[Pipeline] uidx_messages_external_id missing on ${schemaName} — saving the reply without dedupe. ` +
                    `Re-apply prisma/tenant-schema.sql to this schema.`,
                );
                result = await plainInsert();
            }
        }
        // Already stored by the interrupted attempt: nothing new to broadcast.
        if (externalId && !result?.[0]) {
            this.logger.warn(`[Pipeline] Outbound ${externalId} already stored — skipping duplicate history row`);
            return;
        }
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations SET updated_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
        );

        // Increment AI message count for resolution tracking (fire-and-forget)
        this.aiResolutionService.ensureResolutionColumns(schemaName).then(() =>
            this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET ai_message_count = COALESCE(ai_message_count, 0) + 1 WHERE id = $1::uuid`,
                [conversationId],
            ),
        ).catch(e => this.logger.warn(`ai_message_count increment failed (non-fatal): ${(e as Error).message}`));
        // If the caller didn't supply channelType (legacy path), fall back to
        // looking it up on the conversation row so the WS payload is honest.
        let resolvedChannel = channelType;
        if (!resolvedChannel) {
            try {
                const conv = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                    `SELECT channel_type FROM conversations WHERE id = $1::uuid`,
                    [conversationId],
                );
                resolvedChannel = conv?.[0]?.channel_type;
            } catch {}
        }
        this.gateway.emitNewMessage(tenantId, {
            ...result[0],
            channel_type: resolvedChannel,
        }, conversationId);
    }

    /**
     * @param dedupe stable identity of this send WITHIN the turn (e.g. 'reply:0',
     * 'handoff'), turned into a BullMQ jobId so a replay of the turn cannot send
     * the same message to the customer twice. Omit only where no stable position
     * exists; then the send behaves exactly as before (un-deduped).
     */
    private async sendResponse(tenantId: string, text: string, inboundMsg: NormalizedMessage, delayMs?: number, dedupe?: string) {
        const outbound: OutboundMessage = {
            tenantId,
            channelType: inboundMsg.channelType,
            channelAccountId: inboundMsg.channelAccountId,
            to: inboundMsg.contactId,
            content: { type: 'text', text },
            // Server-receipt time (see inboundTs) → the outbound processor computes the
            // customer→reply latency on send, both ends on the server clock.
            metadata: { inboundTs: this.inboundTs(inboundMsg) },
            ...(dedupe ? { dedupeId: outboundDedupeId(inboundMsg, dedupe) } : {}),
        };

        const accessToken = await this.resolveAccessToken(tenantId, inboundMsg.channelType, inboundMsg.channelAccountId);
        // Use BullMQ queue for retry resilience (3 attempts, exponential backoff).
        // delayMs staggers chunked bubbles so they arrive in order with a pause.
        await this.outboundQueue.enqueue(outbound, accessToken, delayMs);
    }

    /** Send an image (or other media) to the customer on their channel. */
    /**
     * El enlace de pago sale del backend, no de la boca del modelo.
     *
     * El 19-ago el enlace se creó bien y el modelo igual contestó "voy a generar
     * el enlace… un momento", así que nunca llegó. Se le puede pedir mejor y se
     * le pidió —la directiva ahora es corta y clara— pero pedir no es garantizar,
     * y esto es plata. Una URL transcrita por un modelo también puede salir
     * cortada o con un carácter de más y no abrir.
     *
     * Va como mensaje aparte y con un retardo corto: llega justo después del
     * texto, en el orden en que una persona lo mandaría.
     */
    private async sendPaymentLink(tenantId: string, inboundMsg: NormalizedMessage, url: string, delayMs = 1200) {
        const outbound: OutboundMessage = {
            tenantId,
            channelType: inboundMsg.channelType,
            channelAccountId: inboundMsg.channelAccountId,
            to: inboundMsg.contactId,
            content: { type: 'text', text: url },
            metadata: { inboundTs: this.inboundTs(inboundMsg) },
            // Atado al enlace, no al turno: si el turno se reprocesa tras un
            // reinicio, el cliente no recibe el mismo enlace dos veces.
            dedupeId: `paylink-${url.slice(-64)}`,
        };
        const accessToken = await this.resolveAccessToken(tenantId, inboundMsg.channelType, inboundMsg.channelAccountId);
        await this.outboundQueue.enqueue(outbound, accessToken, delayMs);
    }

    private async sendMedia(tenantId: string, inboundMsg: NormalizedMessage, mediaUrl: string, caption: string | undefined, delayMs?: number) {
        const outbound: OutboundMessage = {
            tenantId,
            channelType: inboundMsg.channelType,
            channelAccountId: inboundMsg.channelAccountId,
            to: inboundMsg.contactId,
            content: { type: 'image', mediaUrl, caption },
            metadata: { inboundTs: this.inboundTs(inboundMsg) },
        };
        const accessToken = await this.resolveAccessToken(tenantId, inboundMsg.channelType, inboundMsg.channelAccountId);
        await this.outboundQueue.enqueue(outbound, accessToken, delayMs);
    }

    /**
     * Read the opt-in WhatsApp Flows config (tenant.settings.bookingFlows). Fetched
     * fresh per WhatsApp booking turn so a toggle takes effect immediately; the
     * global Tenant table is a PK lookup, so the cost is negligible.
     */
    private async getBookingFlowsCfg(tenantId: string): Promise<{ enabled: boolean; flowId: string; flowCta: string; flowMode: 'published' | 'draft' } | null> {
        try {
            const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
            const saved = (tenant?.settings as any)?.bookingFlows || {};
            return { enabled: false, flowId: '', flowCta: 'Agendar', flowMode: 'published', ...saved };
        } catch (e: any) {
            this.logger.debug(`bookingFlows config read failed (non-fatal): ${e.message}`);
            return null;
        }
    }

    /**
     * Enqueue an opt-in WhatsApp Flow message (one-step booking form). The gateway
     * routes it by `metadata.flowId`; `content.text` is the fallback body delivered
     * if the Flow can't render. Uses the same BullMQ outbound path as every reply.
     */
    private async sendFlow(
        tenantId: string,
        inboundMsg: NormalizedMessage,
        flow: { headerText?: string; body: string; footerText?: string; flowCta?: string; initialScreen?: string; initialData?: Record<string, unknown> },
        cfg: { flowId: string; flowCta: string; flowMode: 'published' | 'draft' },
        flowToken: string,
    ) {
        const outbound: OutboundMessage = {
            tenantId,
            channelType: inboundMsg.channelType,
            channelAccountId: inboundMsg.channelAccountId,
            to: inboundMsg.contactId,
            content: { type: 'text', text: flow.body },
            metadata: {
                flowId: cfg.flowId,
                flowToken,
                flowCta: flow.flowCta || cfg.flowCta,
                flowMode: cfg.flowMode,
                headerText: flow.headerText,
                footerText: flow.footerText,
                initialScreen: flow.initialScreen,
                initialData: flow.initialData,
                inboundTs: this.inboundTs(inboundMsg),
            },
        };
        const accessToken = await this.resolveAccessToken(tenantId, inboundMsg.channelType, inboundMsg.channelAccountId);
        await this.outboundQueue.enqueue(outbound, accessToken);
    }

    /**
     * Epoch ms used as the start of the customer→reply latency metric. Prefers the
     * server-clock receipt time (`receivedAt`, stamped at pipeline entry) so it matches
     * the worker's clock at send time — no cross-clock skew. Falls back to the provider's
     * message timestamp (Meta/Telegram clock, second granularity) only when receivedAt is
     * absent (e.g. a path that didn't go through processIncomingMessage).
     */
    private inboundTs(inboundMsg: NormalizedMessage): number {
        const received = (inboundMsg as any).receivedAt;
        if (typeof received === 'number' && received > 0) return received;
        const t = inboundMsg.timestamp as any;
        return t instanceof Date ? t.getTime() : new Date(t).getTime();
    }

    /**
     * Resolve real Meta access token for a given tenantId and channel type.
     */
    private async resolveAccessToken(tenantId: string, channelType: string = 'whatsapp', accountId?: string): Promise<string> {
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, channelType, accountId);
            if (!creds.accessToken) {
                this.logger.error(`[Pipeline] Access token is EMPTY for tenant ${tenantId} channel ${channelType}`);
            }
            return creds.accessToken;
        } catch (e: any) {
            this.logger.error(`[Pipeline] FAILED to resolve WhatsApp token for tenant ${tenantId}: ${e.message}`);
            return '';
        }
    }

    /**
     * Orchestrate the LLM call using the Router and Persona System Prompt.
     * Includes smart history truncation to stay within context window limits.
     */
    private async generateResponse(tenantId: string, conversation: any, msg: NormalizedMessage, config: TenantConfig, contact?: any, lead?: any, previousMessageAt?: any, bizHours?: any, inboundMessageId?: string): Promise<string> {
        let userText = msg.content.text || '';

        // Opt-in WhatsApp Flow completion: the adapter sets content.text to the
        // '__flow_response__' sentinel and stashes the submitted fields on
        // interactiveReply.data — surface them for the booking engine fast-forward.
        const flowResponseData: Record<string, unknown> | undefined =
            (msg.content as any)?.interactiveReply?.type === 'flow_response'
                ? (msg.content as any).interactiveReply.data
                : undefined;

        // ── Media processing: transcribe audio / describe images ──
        if (msg.content.type === 'audio' || msg.content.type === 'image') {
            const contactDbId = conversation.contact_id || contact?.id || '';
            const recentContext = userText || msg.content.caption || '';

            const mediaResult = await this.mediaProcessing.processMedia(
                msg, contactDbId, conversation.id, recentContext,
            );

            if (mediaResult) {
                userText = mediaResult.text;
                this.logger.log(`[Pipeline] Media processed (${msg.content.type}): ${userText.substring(0, 100)}...`);

                if (mediaResult.governance.allowDurablePersistence) {
                    // Persist only when source+derived deletion has a verified
                    // enforcement adapter. Current governance permits ephemeral
                    // processing only, so this remains off by construction.
                    const schemaForUpdate = await this.tenantSchema(tenantId);
                    this.prisma.executeInTenantSchema(schemaForUpdate,
                        `UPDATE messages SET content_text = $1
                         WHERE id = (SELECT id FROM messages WHERE conversation_id = $2::uuid AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1)`,
                        [userText, conversation.id],
                    ).catch(e => this.logger.warn(`Failed to persist media text (non-fatal): ${e.message}`));
                }
            } else {
                const configuredLang = config.language || 'es';
                return this.mediaProcessing.getFallbackMessage(msg.content.type, configuredLang);
            }
        } else if (msg.content.type !== 'text') {
            const configuredLang = config.language || 'es';
            const lang = (configuredLang).slice(0, 2).toLowerCase();
            const fallbacks: Record<string, string> = {
                es: 'Recibí tu mensaje, pero por ahora solo puedo procesar texto, imágenes y audios. ¿Podrías escribirme lo que necesitas?',
                en: 'I received your message, but I can only process text, images, and audio right now. Could you type what you need?',
                pt: 'Recebi sua mensagem, mas só consigo processar texto, imagens e áudios. Poderia escrever o que precisa?',
                fr: 'J\'ai reçu votre message, mais je ne peux traiter que le texte, les images et l\'audio. Pourriez-vous écrire ce dont vous avez besoin ?',
            };
            return fallbacks[lang] || fallbacks.es;
        }

        // Expose the RESOLVED inbound text (post audio-transcription / image-description)
        // to the caller so auto-progress can classify purchase intent from voice notes.
        (msg as any).resolvedText = userText;

        // 1. Analyze routing factors
        const complexity = this.llmRouter.analyzeComplexity(userText);
        const sentiment = this.llmRouter.analyzeSentiment(userText);
        const stageScore = this.llmRouter.stageToScore(conversation.stage);

        this.logger.log(`Routing Factors - Complexity: ${complexity}, Sentiment: ${sentiment}, Stage: ${stageScore}`);

        // Value-based routing (#8): bias the model tier by the turn's value — hot lead /
        // closing stage / complexity → higher tier within the plan; small talk → cheapest.
        const routingFactors: RoutingFactors = {
            ticketValue: this.computeTicketValue(lead),
            complexity,
            conversationStage: stageScore,
            sentiment,
            intentType: this.computeIntentType(complexity),
        };

        // 2. Resolve schema + new-session detection (must happen before engine/tools)
        const schemaName = await this.tenantSchema(tenantId);

        const lastMsgTime = previousMessageAt || conversation.updated_at || conversation.created_at;
        const timeSinceLastMessage = Date.now() - new Date(lastMsgTime).getTime();
        // A WhatsApp Flow completion always continues an in-progress booking (the engine
        // expires it on its own after 1h), so it must NOT be treated as a new session —
        // otherwise the waiting_flow state is wiped and the submitted booking is lost.
        const isNewSession = timeSinceLastMessage > 30 * 60 * 1000 && !flowResponseData; // 30 minutes

        if (isNewSession) {
            this.logger.log(`[Pipeline] New session detected (${Math.round(timeSinceLastMessage / 60000)} min gap) — clearing stale context`);
            try {
                // One session, one epoch. Each of these used to expire on its own
                // clock (booking 1h, procedure 1h, affinity 30m, confirmation
                // 15m), so a customer coming back after 35 minutes met an agent
                // that had forgotten the booking but was still walking them
                // through step 4 of a procedure, on a model pinned by a turn that
                // no longer existed. What ends, ends together.
                await Promise.all([
                    this.redis.del(`booking:${conversation.id}`),
                    this.redis.del(`procedure:${conversation.id}`),
                    this.redis.del(`llm:affinity:${conversation.id}`),
                    this.redis.del(`llm:affinity:${conversation.id}:conversation`),
                    this.redis.del(`llm:affinity:${conversation.id}:tool_calling`),
                ]);
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE conversations SET metadata = metadata - 'toolContext' - 'toolContextUpdatedAt' - 'bookingState' - 'bookingStateUpdatedAt' WHERE id = $1::uuid`,
                    [conversation.id],
                );
            } catch {}
            if (conversation.metadata) {
                delete (conversation.metadata as any).toolContext;
                delete (conversation.metadata as any).toolContextUpdatedAt;
                delete (conversation.metadata as any).bookingState;
                delete (conversation.metadata as any).bookingStateUpdatedAt;
            }
        }

        // 3. Start building TURN CONTEXT (Layer 3 of prompt assembly).
        // Prompt is composed later by PromptAssemblerService: Layer 1 (contract) +
        // Layer 2 (persona from config) + Layer 3 (this turn context).
        // Language: default from config, then auto-detect from the inbound text
        // so we follow the customer when they switch languages mid-conversation.
        const configuredLanguage = config.language || 'es-CO';
        // Use the LAST detected language as the fallback (not the tenant default):
        // the detector falls back for inputs under ~3 chars or low margin, so short
        // replies like "ok", "yes", "gracias" were reverting an English/Portuguese
        // conversation back to the tenant default mid-chat.
        const previousLanguage = (conversation.metadata as any)?.detectedLanguage;
        const detectedLanguage = this.languageDetector.detect(userText, previousLanguage || configuredLanguage);
        const userLanguage = detectedLanguage;
        (msg as any).detectedLang = detectedLanguage; // expose this turn's language to auto-progress
        // Persist when it changes so the stickiness carries to the next turn.
        if (detectedLanguage && detectedLanguage !== previousLanguage) {
            this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1::uuid`,
                [conversation.id, JSON.stringify({ detectedLanguage })],
            ).catch(() => { /* non-blocking */ });
        }
        // The turn's clock comes from the tenant's OPERATING identity, not from
        // a Colombian literal. `America/Bogota` was the last resort in four
        // separate places, so a Mexican restaurant computed "hoy" and "mañana"
        // in Bogota time and told guests the wrong day.
        const regional = await this.regionalProfile?.resolve(tenantId).catch(() => null);
        const tz = bizHours?.timezone
            || config.hours?.timezone
            || regional?.timezone.value
            || 'America/Bogota';
        const now = new Date();
        const businessHoursStatus: 'open' | 'closed' = this.isWithinBusinessHours(config, bizHours) ? 'open' : 'closed';

        // Step-by-step turn trace (WS5 #1) — accumulated in memory, persisted
        // fire-and-forget at the end. Never affects the turn's behaviour or latency.
        const turnTrace = new TurnTraceContext({ tenantId, conversationId: conversation.id, messageId: inboundMessageId });

        const turnContext: TurnContext = {
            language: userLanguage,
            timezone: tz,
            // One resolved operating identity for the whole turn: prompt,
            // formats, tool arguments and jurisdiction filters read the same
            // country instead of each inferring its own from a different signal.
            regional: regional ? {
                operatingCountry: regional.operatingCountry.value,
                currency: regional.operatingCurrency.value,
                locale: regional.locale.value,
                addressForm: regional.addressForm.value,
                countryPackId: regional.countryPackId,
                countryPackVersion: regional.countryPackVersion,
                countryPackStatus: regional.countryPackStatus,
            } : undefined,
            now: now.toISOString(),
            upcomingDays: this.promptAssembler.computeUpcomingDays(now, tz, 8),
            businessHoursStatus,
        };

        // Long-term memory (#1): inject what we know about this customer across
        // conversations, when the agent has it enabled.
        if (config.llm?.memory?.longTerm && conversation.contact_id) {
            const mem = await this.customerMemory.getMemory(schemaName, conversation.contact_id, userText, tenantId).catch(() => null);
            if (mem) turnContext.customerMemory = mem;
        }

        if (contact) {
            const contactName = contact.name || lead?.first_name || lead?.firstName;
            turnContext.contact = {
                name: contactName,
                email: contact.email,
                phone: contact.phone,
                isKnown: !!(contactName || contact.email),
                knownSince: contact.first_contact_at || contact.created_at,
            };

            // One capability-driven, ownership-scoped loader now feeds both the
            // canonical activeObjects contract and its temporary legacy views.
            await this.activeOperationsContext.populateTurnContext(turnContext, {
                tenantId,
                schemaName,
                contactId: contact.id,
                config: config as any,
                timezone: tz,
                now,
            });
        }

        // Business identity — the "who we are" data the agent uses to answer
        // questions about the company. Cached in Redis inside BusinessInfoService.
        try {
            const businessIdentity = await this.businessInfoService.getPrimary(tenantId);
            if (businessIdentity) {
                turnContext.business = {
                    companyName: businessIdentity.companyName,
                    industry: businessIdentity.industry,
                    about: businessIdentity.about,
                    phone: businessIdentity.phone,
                    email: businessIdentity.email,
                    website: businessIdentity.website,
                    address: businessIdentity.address,
                    city: businessIdentity.city,
                    country: businessIdentity.country,
                    socialLinks: businessIdentity.socialLinks,
                };
            }
        } catch (e: any) {
            this.logger.warn(`Business identity lookup failed (non-fatal): ${e.message}`);
        }

        // 3.5 Vertical context — inject industry-specific terminology for the LLM
        try {
            const cacheKey = `vertical:${tenantId}`;
            let verticalConfig = await this.redis.getJson<any>(cacheKey);
            if (!verticalConfig) {
                const tenant = await this.prisma.tenant.findUnique({
                    where: { id: tenantId },
                    select: { settings: true },
                });
                verticalConfig = (tenant?.settings as any)?.verticalConfig;
                if (verticalConfig) {
                    await this.redis.setJson(cacheKey, verticalConfig, 600);
                }
            }
            // Industria y sub-tipo al prompt. El dueño elige con cuidado entre 4-6
            // sub-tipos en el alta y en la mayoría de las verticales no cambiaba
            // NADA. Bajarlos acá hace que muchos no necesiten rama de bootstrap: el
            // modelo ya sabe que atiende una clínica dental y no un consultorio
            // genérico, un hotel y no una agencia de tours.
            if (verticalConfig?.industry || verticalConfig?.subType) {
                turnContext.verticalContext = {
                    ...(turnContext.verticalContext || {}),
                    industry: verticalConfig.industry || undefined,
                    subType: verticalConfig.subType || undefined,
                };
            }
            if (verticalConfig?.terminology) {
                const lang = userLanguage || 'es';
                const t = verticalConfig.terminology;
                turnContext.verticalContext = {
                    // spread: industry/subType se setean arriba y este bloque los
                    // pisaría al reasignar el objeto entero.
                    ...(turnContext.verticalContext || {}),
                    customerNoun: t.customerNoun?.[lang] || t.customerNoun?.es,
                    customerNounPlural: t.customerNounPlural?.[lang] || t.customerNounPlural?.es,
                    transactionNoun: t.transactionNoun?.[lang] || t.transactionNoun?.es,
                    serviceNoun: t.serviceNoun?.[lang] || t.serviceNoun?.es,
                };
            }

            // La terminología de la industria es el mínimo común denominador de
            // hasta cinco negocios distintos: un hotel y un alquiler vacacional
            // comparten "Turismo" y no comparten casi nada más. Donde el
            // sub-tipo tiene palabra propia, gana sobre la de su vertical.
            const subtypeTerms = subtypeTerminologyFor(
                verticalConfig?.industry,
                verticalConfig?.subType,
            );
            // Lo que el perfil declara que NO hace. Se resuelve aparte de la
            // terminología porque un perfil puede tener límites sin tener
            // sustantivos propios — de hecho la mayoría está en ese caso.
            try {
                const profile = resolveSubtypeExperienceProfile(
                    verticalConfig?.industry,
                    verticalConfig?.subType ?? null,
                );
                if (profile.exclusions?.length) {
                    turnContext.verticalContext = {
                        ...(turnContext.verticalContext || {}),
                        notOffered: [...profile.exclusions],
                    };
                }
            } catch {
                // Un perfil que el registro no conoce no declara límites. No
                // inventar ninguno es lo correcto: un límite falso hace que el
                // agente rechace algo que el negocio sí hace.
            }

            if (subtypeTerms) {
                const lang = userLanguage || 'es';
                const pick = (term?: LocalizedTerm) => localizedTerm(term, lang) || undefined;
                const base = turnContext.verticalContext || {};
                turnContext.verticalContext = {
                    ...base,
                    customerNoun: pick(subtypeTerms.customerNoun) || base.customerNoun,
                    customerNounPlural: pick(subtypeTerms.customerNounPlural) || base.customerNounPlural,
                    transactionNoun: pick(subtypeTerms.transactionNoun) || base.transactionNoun,
                    primaryObjectNoun: pick(subtypeTerms.primaryObject),
                    primaryObjectNounPlural: pick(subtypeTerms.primaryObjectPlural),
                    avoidTerms: subtypeTerms.avoid?.length ? [...subtypeTerms.avoid] : undefined,
                };
            }

            // Objetivos y audiencia que el dueño declaró en el alta. Eran write-only:
            // se guardaban en tenant.settings y ningún código los leía jamás — el
            // tenant "otro", que es justo el que más necesita describir su negocio,
            // le hablaba a la nada. Los "other:texto" libres son los más valiosos.
            const goalsCacheKey = `bizgoals:${tenantId}`;
            let bizGoals = await this.redis.getJson<{ goals: string[]; audiences: string[] }>(goalsCacheKey);
            if (!bizGoals) {
                const tenantRow = await this.prisma.tenant.findUnique({
                    where: { id: tenantId },
                    select: { settings: true },
                });
                const s = (tenantRow?.settings as any) || {};
                const clean = (arr: any): string[] => (Array.isArray(arr) ? arr : [])
                    .filter((x: any) => typeof x === 'string' && x.trim())
                    .map((x: string) => x.startsWith('other:') ? x.slice(6).trim() : x)
                    .filter(Boolean)
                    .slice(0, 8);
                bizGoals = { goals: clean(s.chatReasons), audiences: clean(s.customerTypes) };
                await this.redis.setJson(goalsCacheKey, bizGoals, 600);
            }
            if (bizGoals.goals.length > 0 || bizGoals.audiences.length > 0) {
                turnContext.verticalContext = {
                    ...(turnContext.verticalContext || {}),
                    businessGoals: bizGoals.goals.length ? bizGoals.goals : undefined,
                    targetAudiences: bizGoals.audiences.length ? bizGoals.audiences : undefined,
                };
            }

            // Cómo se cierra la venta en esta industria. El assembler ya sabía
            // imprimir <guidance> desde hace meses, pero NADIE lo poblaba fuera de
            // un spec: el agente conocía los sustantivos de la vertical y no el
            // orden de las herramientas, así que ofrecía reservar antes de
            // consultar disponibilidad, o cotizaba sin buscar el producto.
            const guidance = verticalFlowGuidance(
                (turnContext.verticalContext as any)?.industry,
                (config.tools ?? (config as any)?.tools) as any,
            );
            if (guidance) {
                turnContext.verticalContext = {
                    ...(turnContext.verticalContext || {}),
                    industryGuidance: guidance,
                };
            }
        } catch (e: any) {
            this.logger.debug(`Vertical context lookup skipped: ${e.message}`);
        }

        // 4. Deterministic Booking Engine (runs BEFORE the LLM — emits interactive
        // messages directly for WhatsApp, or produces text for the LLM to voice).
        const toolsConfig = config.tools?.appointments ?? (config as any)?.tools?.appointments;
        const toolsEnabled = toolsConfig?.enabled === true;
        let tools: any[] = [];
        let bookingState: BookingState = await this.loadBookingState(conversation.id, conversation.metadata);
        let engineProducedText: string | null = null;
        // Writes performed OUTSIDE the LLM tool loop (booking engine, server-side
        // confirmation). Without these the output guardrail audits a real booking
        // as an invented one and rewrites the reply to say it is still pending.
        let engineExecutedTools: Array<{ name: string; result: any }> = [];
        // An escalation asked for by a tool executed outside the loop.
        let pendingOperationHandoff: string | null = null;

        // If a procedure (AOP/SOP) is mid-flow waiting for a field, the current
        // message is the ANSWER to that field — give the procedure engine priority
        // so the booking engine doesn't hijack it and leave the procedure hung.
        const procedureAwaiting = await this.procedureEngine.getState(conversation.id)
            .then(s => !!s?.awaitingField).catch(() => false);

        if (toolsEnabled && !procedureAwaiting) {
            // Tenant-local "today" — toISOString() would be UTC, which rolls over
            // to tomorrow during the evening across all of LatAm (UTC-3…-6) and
            // would make the booking engine treat "hoy" as the next day.
            const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
            const customerProfile = {
                name: contact?.name || lead?.first_name || lead?.firstName,
                email: contact?.email,
                phone: contact?.phone,
            };

            // Opt-in WhatsApp Flows: capability = flag ON + Flow ID set + WhatsApp channel.
            // Only read the config for WhatsApp booking turns (negligible PK lookup).
            let flowCfg: { enabled: boolean; flowId: string; flowCta: string; flowMode: 'published' | 'draft' } | null = null;
            let flowCapable = false;
            if (msg.channelType === 'whatsapp') {
                flowCfg = await this.getBookingFlowsCfg(tenantId);
                flowCapable = !!flowCfg?.enabled && !!flowCfg?.flowId;
            }

            // ═══ PHASE 1: INTERPRET — extract structured intent ═══
            const serviceNames = bookingState.services?.map(s => s.name) || [];
            const upcoming = turnContext.upcomingDays || [];
            const intent = await this.intentInterpreter.interpret(
                userText, bookingState.step, serviceNames, todayISO, upcoming, tenantId,
                regional?.operatingCountry.value,
            );
            this.logger.log(`[Pipeline] INTERPRET: intent=${intent.intent} svc=${intent.serviceMentioned || '-'} date=${intent.dateMentioned || '-'} confirm=${intent.isConfirmation}`);

            // ═══ GREETING & FAREWELL at idle: let LLM handle naturally ═══
            const isGreetOrFarewell = intent.intent === 'greet' || intent.intent === 'farewell';
            const isIdleOrBooked = bookingState.step === 'idle' || bookingState.step === 'booked' || !bookingState.step;

            if (isGreetOrFarewell && isIdleOrBooked) {
                this.logger.log(`[Pipeline] ${intent.intent} (idle): LLM handles with full persona`);
                // Refresh services from DB and update cache so booking engine gets fresh data next turn
                try {
                    const result = await this.toolExecutor.execute(schemaName, tenantId, conversation.contact_id || '', 'list_services', {});
                    bookingState.services = result?.services?.length ? result.services : [];
                    // Update the tenantId-scoped cache so next booking engine call is consistent
                    const svcCacheKey = `booking:services:${tenantId}`;
                    await this.redis.set(svcCacheKey, JSON.stringify(bookingState.services), 300).catch(() => {});
                } catch {}
                await this.persistBookingState(schemaName, conversation.id, bookingState);
                // Skip engine entirely — fall through to LLM
            } else if (this.shouldYieldToVerticalTools(config, userText, bookingState)) {
                // ═══ YIELD VERTICAL ═══
                // El motor determinista captura "reservar/agendar/turno" por regex y
                // cierra el turno con tools=[]: la vertical pierde sus herramientas
                // justo en el momento de conversión. Un gimnasio no podía inscribir a
                // una clase, un hotel no podía cotizar una habitación y una
                // inmobiliaria agendaba la visita sin saber de qué propiedad se venía
                // hablando (en modo directivo solo viajan los últimos 4 mensajes).
                // Acá el motor cede el turno a la IA CON sus tools.
                this.logger.log(`[Pipeline] YIELD vertical: el agente tiene tools propias de reserva/inventario y el texto menciona un objeto de la vertical`);
                await this.persistBookingState(schemaName, conversation.id, bookingState);
            } else {
                // ═══ PHASE 2: DECIDE — deterministic booking engine ═══
                const engineResult = await this.bookingEngine.process(
                    schemaName, tenantId, conversation.contact_id || '',
                    intent, userText, bookingState, customerProfile, todayISO, userLanguage,
                    flowCapable, flowResponseData, conversation.id,
                );

                bookingState = engineResult.state;
                this.logger.log(`[Pipeline] Booking state: ${bookingState.step} | service: ${bookingState.serviceName || '-'} | date: ${bookingState.date || '-'} | time: ${bookingState.time || '-'}`);

                if (engineResult.handled) {
                    this.logger.log(`[Pipeline] Booking engine handled (step: ${bookingState.step})`);

                    // Opt-in WhatsApp Flow: send the interactive one-step form directly,
                    // bypassing the LLM express phase. The gateway routes by metadata.flowId;
                    // on any send failure the engine resets waiting_flow→idle next turn and
                    // resumes the text flow. Persist + save for history, then short-circuit.
                    if (engineResult.flowMessage && flowCapable && flowCfg) {
                        await this.persistBookingState(schemaName, conversation.id, engineResult.state);
                        // Correlation id Meta echoes back in nfm_reply. Idempotency is
                        // already covered by webhook dedup + the duplicate-appointment guard,
                        // so we don't persist/validate it (that would be a no-op anti-replay).
                        const flowToken = randomUUID();
                        await this.sendFlow(tenantId, msg, engineResult.flowMessage, flowCfg, flowToken);
                        await this.saveAiMessage(tenantId, conversation.id, engineResult.flowMessage.body, msg.channelType);
                        this.throttle.incrementAiMessageCount(tenantId).catch(() => {});
                        this.logger.log(`[Pipeline] WhatsApp Flow sent (flow_id=${flowCfg.flowId}) — bypassing LLM`);
                        return ''; // Flow already enqueued; caller sends no extra text.
                    }

                    // ═══ PHASE 3: EXPRESS — LLM voices the engine's output naturally ═══
                    engineProducedText = engineResult.text || null;
                    // The appointment the engine just created; reported so the
                    // claim guardrail knows "your appointment is booked" is true.
                    if (engineResult.executedTools?.length) {
                        engineExecutedTools = [...engineExecutedTools, ...engineResult.executedTools];
                    }
                    tools = []; // NO TOOLS for express phase
                    await this.persistBookingState(schemaName, conversation.id, engineResult.state);

                    // Dead end the booking flow can't solve alone (agenda never
                    // configured, tool failure): the engine only FLAGS it, we run the
                    // escalation — same contract as the procedure engine below. Without
                    // this the customer gets an honest message but no human ever hears
                    // about it. `escalateToHuman` never returns a flowMessage, so the
                    // Flow short-circuit above can't skip this.
                    if (engineResult.handoff) {
                        if (!engineProducedText) engineProducedText = handoffText(userLanguage).transferring;
                        try {
                            await this.handoffService.executeHandoff(
                                tenantId, conversation.id, msg, engineResult.handoffReason || 'booking_unavailable',
                            );
                        } catch (e: any) {
                            this.logger.warn(`[Booking] handoff failed: ${e.message}`);
                        }
                    }
                } else {
                    // Not booking-related — LLM handles.
                    if (bookingState.services?.length) {
                        turnContext.availableServices = bookingState.services.map(s => ({
                            id: s.id,
                            name: s.name,
                            durationMinutes: s.durationMinutes,
                            price: s.price,
                            currency: s.currency,
                        }));
                    }
                    this.logger.log(`[Pipeline] Not booking-related, LLM handles`);
                    await this.persistBookingState(schemaName, conversation.id, engineResult.state);
                }
            }
        }

        // 4b. Deterministic Procedure Engine (T2.12 — AOP/SOP). Runs only when the
        // booking engine didn't take over. If an active procedure is in progress or
        // a trigger matches, it produces a directive the LLM voices (like booking),
        // keeping the flow deterministic. Fully guarded so it can never break chat.
        if (!engineProducedText) {
            try {
                const procResult = await this.procedureEngine.process(
                    schemaName, tenantId, conversation.id, conversation.contact_id || '', userText,
                    {
                        industry: turnContext.verticalContext?.industry,
                        subType: turnContext.verticalContext?.subType,
                        toolsConfig: (config.tools ?? (config as any)?.tools) ?? {},
                        channelType: msg.channelType,
                    },
                );
                if (procResult.handled) {
                    tools = [];
                    if (procResult.text) engineProducedText = procResult.text;
                    if (procResult.handoff) {
                        if (!engineProducedText) engineProducedText = handoffText(userLanguage).transferring;
                        try {
                            await this.handoffService.executeHandoff(
                                tenantId, conversation.id, msg, procResult.handoffReason || `Procedimiento: ${procResult.procedureName || ''}`,
                            );
                        } catch (e: any) {
                            this.logger.warn(`[Procedure] handoff failed: ${e.message}`);
                        }
                    }
                    this.logger.log(`[Procedure] handled (proc="${procResult.procedureName}", completed=${!!procResult.completed}, handoff=${!!procResult.handoff})`);
                }
            } catch (e: any) {
                this.logger.warn(`[Procedure] engine error (non-fatal): ${e.message}`);
            }
        }

        // 4c. THE CUSTOMER SAID YES — the server executes, not the model.
        //
        // Every write gated by a confirmation used to depend on the model
        // spontaneously re-issuing the identical call with byte-identical
        // arguments, out of a history that carries no tool calls. When it
        // answered in prose nothing ran and the customer was told it was done;
        // when it rebuilt the arguments and a date format or an accent differed,
        // the hash changed and the guard asked for confirmation AGAIN over
        // something already confirmed. Both are the loop the owner reported.
        //
        // The booking engine never had this problem because it executes the
        // appointment itself on a button press. This does the same for every
        // other operation: read the pending row, run it with the arguments the
        // customer was actually shown, and let the LLM voice the outcome. The
        // signed token, the args hash and the ledger status stay in charge.
        let preExecutedTools: Array<{ name: string; result: any }> = engineExecutedTools;
        if (!engineProducedText
            && conversation.contact_id
            && classifyExplicitToolConfirmation(userText) === 'confirmed') {
            try {
                const pending = await this.toolExecutionControl.findPendingConfirmation(
                    schemaName, conversation.id, conversation.contact_id,
                );
                if (pending) {
                    this.logger.log(`[Confirm] Customer confirmed — executing pending ${pending.toolName} server-side (ledger ${pending.ledgerId})`);
                    const result = await this.withTimeout(
                        this.toolExecutor.execute(
                            schemaName, tenantId, conversation.contact_id, pending.toolName,
                            pending.args, conversation.id, {
                                channelType: msg.channelType,
                                maxDiscountPercent: (config as any)?.upsell?.maxDiscountPercent,
                                jurisdiction: regional?.operatingCountry.value,
                            },
                        ),
                        TOOL_TIMEOUT_MS,
                        pending.toolName,
                    );
                    if (result?._mediaToSend) delete result._mediaToSend;
                    // Still asking for confirmation means the token expired
                    // between the lookup and the call. Say nothing here and let
                    // the normal turn run: inventing an outcome is exactly the
                    // failure this block exists to prevent.
                    if (result?.error === 'confirmation_required') {
                        this.logger.warn(`[Confirm] Pending ${pending.toolName} still requires confirmation — falling through to the normal turn`);
                    } else {
                        preExecutedTools = [...preExecutedTools, { name: pending.toolName, result }];
                        if (result?.shouldHandoff === true
                            && (result.controlBlocked !== true
                                || CONTROL_ERRORS_REQUIRING_HUMAN.has(String(result.error)))) {
                            pendingOperationHandoff = `intake:${pending.toolName}`;
                        } else if (!toolResultSucceeded(result) && isBusinessWriteTool(pending.toolName)) {
                            // Se escala por RESULTADO, no por declaracion.
                            //
                            // El cliente ya dijo que si: la operacion estaba
                            // validada cuando se lo preguntamos y aun asi fallo.
                            // Antes esto dependia de que la herramienta pusiera
                            // `shouldHandoff`, y createPropertyBooking nunca lo
                            // pone: la reserva fallaba, el modelo escribia
                            // "dejame revisar el estado de tu reserva" —que no
                            // afirma nada, asi que el guardrail de falsos exitos
                            // no lo toca— y el huesped se quedaba esperando un
                            // pago que no existia, sin que nadie lo rescatara.
                            pendingOperationHandoff = `failed:${pending.toolName}`;
                            this.recordAgentSignal(tenantId, 'commit_then_failure');
                            this.logger.error(
                                `[Confirm] ${pending.toolName} fallo DESPUES de la confirmacion del cliente ` +
                                `(ledger ${pending.ledgerId}): ${String(result?.error || result?.message || 'sin motivo')} ` +
                                `— escalando a humano`,
                            );
                        }
                        engineProducedText = this.buildExecutedOperationDirective(
                            pending.toolName, result, userLanguage,
                        );
                        this.recordAgentSignal(tenantId, 'pending_confirmation_executed');
                        if (toolResultSucceeded(result)) {
                            tools = [];
                        } else {
                            // La operacion fallo DESPUES del "si" del cliente.
                            // Vaciar todo aca dejaba a la agente sabiendo que
                            // fallo y sin poder hacer nada al respecto: solo
                            // prosa, y la conversacion se atascaba. Se conservan
                            // las lecturas para que pueda encontrar el dato
                            // correcto en el mismo turno; las escrituras salen
                            // para que no reintente a ciegas sobre lo mismo.
                            tools = tools.filter((t: any) => !isBusinessWriteTool(t?.function?.name));
                        }
                    }
                }
            } catch (e: any) {
                this.logger.warn(`[Confirm] Server-side confirmation failed (non-fatal): ${e.message}`);
            }
        }

        // Every static tool family this agent's config authorises, resolved from
        // the ONE registry that the procedure engine and Agent Test also compile
        // against. This was an inline chain of `if (cfgTools?.x?.enabled)`
        // duplicated in three places — which is exactly why a Procedure could
        // call a family the agent had switched off and Agent Test could
        // advertise a different set than production.
        //
        // Plan, quota, provider health and readiness are NOT decided here: the
        // money families below and the central guard apply those per turn, so a
        // tool can be authorised by config and still be refused at execution.
        const cfgTools = (config.tools ?? (config as any)?.tools) as any;
        tools = [...tools, ...staticToolsForAgentConfig(cfgTools)];

        // Customer checkout is independent from ecommerce and fails closed on
        // every turn. A saved agent toggle alone never advertises a money tool:
        // the runtime plan and the tenant-owned provider must both be ready.
        // The discount tool shares this gate because it is a money action too:
        // it was published from a saved toggle while the only live provider
        // supports payment links and nothing else, so every call the model made
        // ended in an apology and a handoff.
        const needsPaymentCapability = cfgTools?.payments?.enabled === true
            || cfgTools?.ecommerce?.canApplyDiscount === true;
        if (needsPaymentCapability) {
            try {
                const capability = await this.paymentOperations.getRuntimeCapability(tenantId);
                if (cfgTools?.payments?.enabled === true) {
                    tools = [...tools, ...paymentToolsForRuntime(cfgTools.payments, capability)];
                }
                tools = [...tools, ...discountToolsForRuntime(
                    {
                        canApplyDiscount: cfgTools?.ecommerce?.canApplyDiscount,
                        maxDiscountPercent: (config as any)?.upsell?.maxDiscountPercent,
                    },
                    capability,
                )];
            } catch (error: any) {
                this.logger.warn(`[TenantPayments] capability unavailable for ${tenantId}: ${error?.message || 'unknown'}`);
            }
        }

        // Vertical integration tools (T3.19) — registered per connected provider
        // (Toast / Mindbody / Cliniko). Connection state is cached (5min), so this
        // is a cheap per-turn check. Guarded so it never breaks the pipeline.
        try {
            const connected = await this.verticalIntegrations.getConnectedProviders(tenantId);
            if (connected.toast) tools = [...tools, GET_RESTAURANT_MENU_TOOL];
            if (connected.mindbody) tools = [...tools, GET_FITNESS_SCHEDULE_TOOL];
            if (connected.cliniko) tools = [...tools, LIST_CLINIC_SERVICES_TOOL, CHECK_CLINIC_AVAILABILITY_TOOL];
        } catch (e: any) {
            this.logger.debug(`[T3.19] vertical integration tool gating skipped: ${e.message}`);
        }

        // External MCP tools (T3.20). Discovery is not authorisation: the model
        // only ever sees tools whose effect, confirmation and human-approval
        // policy a person reviewed and signed. Publishing everything a server
        // reported while the central guard rejected every `mcp__*` call was a
        // dead end the model kept walking into.
        try {
            const { tools: mcpTools, discoveredCount, approvedCount } =
                await this.mcpClient.listPublishableTools(tenantId);
            if (mcpTools.length) tools = [...tools, ...mcpTools];
            if (discoveredCount > approvedCount) {
                this.logger.debug(
                    `[MCP] ${discoveredCount - approvedCount} tool(s) connected for inspection but not approved for the agent`,
                );
            }
        } catch (e: any) {
            this.logger.debug(`[T3.20] MCP tool registration skipped: ${e.message}`);
        }

        // The identity step-up is the only key to the A2-guarded reads, and it
        // is derived from the tools actually published this turn — not from a
        // hand-kept list of four families. Any A2 tool outside that list (a
        // rental's check-in instructions, a groomer's vaccination status, a case
        // status) made the guard send a code the agent had no tool to consume:
        // the customer typed it into a conversation that could not read it.
        // Derivation runs last, after every family, so it sees the real set.
        tools = [...tools, ...identityStepUpToolsFor(tools)];

        // The effective capability contract has the last word on WHAT may be
        // published. Registration above answers "what did the agent switch on";
        // this answers "what may this agent actually do, this turn" — subtype
        // ceiling, plan, quota and readiness together, resolved server-side and
        // fail-closed. It only ever NARROWS the set: a contract that cannot be
        // resolved leaves the turn exactly as it was rather than silencing an
        // agent that works.
        if (tools.length && this.effectiveCapability) {
            try {
                const contract = await this.effectiveCapability.resolve({
                    tenantId,
                    schemaName,
                    industry: turnContext.verticalContext?.industry || config.industry,
                    subType: turnContext.verticalContext?.subType,
                    toolsConfig: cfgTools ?? {},
                    agentId: (config as any)?.agentId,
                });
                const allowed = new Set(contract.publishedTools);
                const before = tools.length;
                // Families resolved asynchronously (payments, integrations, MCP,
                // the OTP pair) are not part of the static contract and keep
                // their own gates, so they pass through untouched.
                const staticNames = new Set(staticToolsForAgentConfig(cfgTools ?? {}).map(t => String(t.name)));
                tools = tools.filter(t => !staticNames.has(String(t?.name)) || allowed.has(String(t?.name)));
                if (tools.length !== before) {
                    this.logger.log(
                        `[Capability] ${before} → ${tools.length} tools for ${contract.subtypeProfileId}`
                        + ` (${contract.excluded.map(e => `${e.subject}:${e.reason}`).join(', ') || 'none excluded'})`,
                    );
                }
                turnTrace.add('capability_contract', 'Capability', {
                    profile: contract.subtypeProfileId,
                    plan: contract.planSnapshot,
                    published: contract.publishedGroups,
                    unmetReadiness: contract.unmetReadiness,
                    degraded: contract.degraded,
                });
            } catch (error: any) {
                this.logger.warn(`[Capability] contract unresolved: ${error?.message}`);
            }
        }

        // D2: Tool retrieval — keep the turn's toolset small (Gorilla: >30 tools
        // degrades selection). Relevance is scored against the CURRENT message,
        // which is why the writers are pinned: the message that closes a sale is
        // "sí", it matches nothing, and the unpinned version handed the model the
        // appointment family while `create_property_booking` — the tool the
        // pending confirmation was waiting on — was cut from the turn.
        if (!engineProducedText && tools.length > 10) {
            const retrievalQuery = `${userText || (msg as any).resolvedText || ''} ${turnContext.verticalContext?.industry || ''} ${bookingState.step || ''}`;
            const before = tools.length;
            const pinned = new Set(
                tools.filter(t => isConfirmableWriteTool(t?.name)).map(t => t.name as string),
            );
            // The OTP pair is not a confirmable writer, so the writer pin missed
            // it — and the cut could drop `verify_identity_code` on exactly the
            // turn the customer typed their code. Two slots buy back a dead end
            // that only shows up once a tenant has many tools enabled.
            for (const name of identityStepUpToolNames()) {
                if (tools.some(t => t?.name === name)) pinned.add(name);
            }
            tools = this.toolRetrieval.retrieveRelevantTools(retrievalQuery, tools, 10, pinned);
            this.logger.log(`[ToolRetrieval] ${before} → ${tools.length} tools (${pinned.size} pinned) for query "${retrievalQuery.slice(0,80)}"`);
        }

        // When the booking/procedure engine produced a directive, the LLM must
        // ONLY voice that directive — never call tools. The registration block
        // above re-adds tools from the agent's feature flags, overriding the
        // `tools = []` set in the express phase, so enforce it as the last word.
        if (engineProducedText) tools = [];

        if (bookingState.step && bookingState.step !== 'idle') {
            const selectedService = bookingState.serviceId
                ? bookingState.services?.find(s => s.id === bookingState.serviceId)
                : undefined;
            turnContext.bookingState = {
                step: bookingState.step,
                service: bookingState.serviceId ? {
                    id: bookingState.serviceId,
                    name: bookingState.serviceName || selectedService?.name || '',
                    durationMinutes: selectedService?.durationMinutes,
                } : undefined,
                date: bookingState.date,
                slot: bookingState.time,
            };
        }

        // 5. Knowledge retrieval — runs on EVERY turn (booking and non-booking alike).
        // When the booking engine produced a directive, the Layer 1 contract rule
        // "When <directive> is present, communicate ONLY that information" ensures
        // the LLM prioritizes the directive over RAG content. But RAG is still
        // available in context so the LLM can enrich pricing/policy answers naturally.
        try {
            const hasKnowledge = await this.knowledgeService.tenantHasKnowledge(tenantId);
            const ragConfig = config.rag;
            const ragEnabled = ragConfig?.enabled !== false;
            if (hasKnowledge && ragEnabled) {
                // Clamp topK so a misconfigured agent can't flood the prompt with
                // dozens of chunks (cost + context blowout). Chunks are already
                // capped at CHUNK_MAX_CHARS each at ingest time.
                const topK = Math.min(Math.max(1, ragConfig?.topK ?? 5), 10);
                // Default 0.35 — filters out irrelevant chunks. Agents can lower
                // this in their RAG config if they need broader recall.
                const similarityThreshold = ragConfig?.similarityThreshold ?? 0.35;
                const searchThreshold = Math.min(0.25, similarityThreshold);
                // RAG 2.0: rewrite follow-up questions into a standalone search query
                // so anaphora ("¿y eso cuánto sale?") don't embed garbage.
                const searchQuery = await this.rewriteSearchQuery(userText, schemaName, conversation.id, tenantId);
                const ragResults = await this.knowledgeService.searchRelevant(
                    tenantId, searchQuery, topK,
                    {
                        similarityThreshold: searchThreshold,
                        conversationId: conversation.id,
                        language: userLanguage,
                        // Regulated sources are filtered by the tenant's operating
                        // country, not by language. Two countries sharing a
                        // language is exactly how a Colombian norm ended up
                        // answering a Mexican customer.
                        jurisdiction: regional?.operatingCountry.value,
                        // Opt-in LLM reranker (adds latency/cost) — off unless the agent enables it.
                        rerank: (config as any).llm?.kbReranker === true,
                    },
                );
                turnTrace.add('kb_retrieval', 'RAG', {
                    topK, threshold: similarityThreshold, retrievedCount: ragResults.length,
                    sources: ragResults.slice(0, 5).map((r: any) => r.title),
                });
                if (ragResults.length > 0) {
                    const retrieved = ragResults.filter((r: any) => r.score >= similarityThreshold);
                    const possible = ragResults.filter((r: any) => r.score >= 0.25 && r.score < similarityThreshold);

                    if (retrieved.length > 0) {
                        turnContext.retrievedKnowledge = retrieved.map((r: any, idx: number) => ({
                            source: 'kb_article' as const,
                            id: String(r.id ?? r.document_id ?? idx),
                            score: typeof r.score === 'number' ? r.score : (typeof r.similarity === 'number' ? r.similarity : undefined),
                            title: r.title,
                            content: r.chunk_text,
                            // Carried through so a regulatory answer can be
                            // attributed and audited, not just asserted.
                            isRegulated: r.doc_is_regulated === true || undefined,
                            jurisdiction: r.doc_jurisdiction || undefined,
                            authority: r.doc_authority || undefined,
                            validFrom: r.doc_valid_from ? String(r.doc_valid_from).slice(0, 10) : undefined,
                            validTo: r.doc_valid_to ? String(r.doc_valid_to).slice(0, 10) : undefined,
                        })) as RetrievedKnowledgeItem[];
                        this.logger.log(`RAG: Injected ${retrieved.length} chunks (topK=${topK}, threshold=${similarityThreshold}) for tenant ${tenantId}`);
                    }

                    if (possible.length > 0) {
                        (turnContext as any).possibleKnowledge = possible.map((r: any, idx: number) => ({
                            source: 'kb_article' as const,
                            id: String(r.id ?? r.document_id ?? idx),
                            score: typeof r.score === 'number' ? r.score : (typeof r.similarity === 'number' ? r.similarity : undefined),
                            title: r.title,
                            content: r.chunk_text,
                        })) as RetrievedKnowledgeItem[];
                        this.logger.log(`RAG (Fuzzy): Injected ${possible.length} possible chunks (score 0.25-${similarityThreshold}) for tenant ${tenantId}`);
                    }
                }
            }
        } catch (ragError: any) {
            this.logger.warn(`RAG search failed (non-fatal): ${ragError.message}`);
        }

        // 5b. E-commerce context (T2.17 — dual-skillset). Inject a small sample of
        // REAL store products + the customer's recent orders so the agent grounds
        // recommendations and support without inventing data. Best-effort.
        if (cfgTools?.ecommerce?.enabled === true) {
            try {
                const products = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                    `SELECT external_id, title, price_cents, currency, inventory_quantity, product_type
                     FROM ecommerce_products WHERE status = 'active'
                     ORDER BY synced_at DESC LIMIT 12`,
                    [],
                );
                if (products?.length) {
                    turnContext.catalog = products.map((p: any) => ({
                        id: String(p.external_id),
                        title: p.title,
                        price: p.price_cents != null ? Number(p.price_cents) / 100 : undefined,
                        currency: p.currency || 'USD',
                        inStock: (p.inventory_quantity ?? 0) > 0,
                        category: p.product_type || undefined,
                    }));
                }
            } catch (e: any) {
                this.logger.debug(`[T2.17] catalog injection skipped: ${e.message}`);
            }
        }
        // 6. Assemble system prompt.
        // ALWAYS use full 3-layer prompt (contract + persona + turn context).
        // When engine handled: add a directive to the turn context so the LLM
        // knows WHAT to communicate, but generates the HOW naturally.
        // This is directive-based, not template-based — the LLM converses, not translates.
        if (engineProducedText) {
            // Add directive to turn context — tells LLM what to communicate
            turnContext.directive = engineProducedText;
        }

        // 3. Get Conversation History with smart truncation.
        // Fetch the 30 MOST RECENT messages (DESC), not the 30 oldest — long
        // conversations were sending the LLM the start of the chat and losing all
        // recent context. LIMIT 31 + drop the first row removes the current
        // inbound message (already saved above), which is re-added separately as
        // the live user turn — otherwise it would be duplicated in the prompt.
        // Reverse back to chronological order (oldest→newest) for the builders below.
        const historyDesc = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT direction, content_text FROM messages WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 31`,
            [conversation.id],
        );
        let history = (historyDesc || []).slice(1).reverse();

        // The tail of the customer's PREVIOUS conversation, when this one was
        // opened because the old one had been auto-resolved. Prepended so the
        // agent picks up the thread instead of greeting a stranger who is asking
        // about the booking it made for them last week.
        const carriedContext = (conversation.metadata as any)?.carriedContext;
        if (Array.isArray(carriedContext) && carriedContext.length && history.length <= carriedContext.length) {
            history = [...carriedContext, ...history];
            this.logger.log(`[Pipeline] Prepended ${carriedContext.length} carried message(s) from the previous conversation`);
        }

        // Anti-repetition: tell the LLM how many messages exist in this conversation.
        // message_count > 1 means it's a CONTINUATION — don't re-introduce yourself.
        turnContext.messageCount = (history?.length || 0) + 1; // +1 for current message (excluded from history above)

        // D6 affective detection (Hume EVI style) — before assemble so it enters <turn>
        try {
            const affective = this.emotionService.detect(userText, (history || []).slice(-3).map((h: any) => h.content_text));
            (turnContext as any).affective = affective;
            if (affective.frustration > 0.5 || affective.confusion > 0.5) {
                this.logger.log(`[Affective] frustration=${affective.frustration.toFixed(2)} confusion=${affective.confusion.toFixed(2)} urgency=${affective.urgency} trace=${providerMessageId(msg) || 'none'}`);
            }
        } catch {}

        // La foto del estado se toma ANTES de resolver el turno, y el bloque de
        // confirmacion de mas arriba pudo haber creado la reserva desde entonces.
        // Sin refrescarla, el prompt le llegaba al modelo con un directivo que
        // decia "ya quedo reservado" y un bloque <active_objects> que lo
        // desmentia — que es parte de lo que lo empujaba a reservar de nuevo.
        if (preExecutedTools.some(t => isBusinessWriteTool(t.name) && toolResultSucceeded(t.result))
            && conversation.contact_id) {
            try {
                await this.activeOperationsContext.populateTurnContext(turnContext, {
                    tenantId,
                    schemaName,
                    contactId: conversation.contact_id,
                    config: config as any,
                    timezone: turnContext.timezone,
                    now: new Date(),
                });
            } catch (e: any) {
                // Una foto vieja es peor que ninguna, pero perder el turno es
                // peor todavia: el directivo ya dice lo que paso.
                this.logger.warn(`[Pipeline] no se pudo refrescar el estado tras la escritura: ${e.message}`);
            }
        }

        // What the PREVIOUS turns already did. Dropped on a new session with the
        // rest of the epoch, so it can never resurrect a stale identifier.
        //
        // TIENE que quedar ANTES del ensamblado: el assembler lee turnContext de
        // forma sincrónica y devuelve un string. Esto vivía 30 lineas mas abajo,
        // o sea que se le colgaba el recuerdo a un objeto YA consumido y el
        // bloque <recent_actions> no se emitio nunca — mientras la regla 18 del
        // contrato le ordenaba al modelo reusar identificadores de ahi. El
        // modelo hacia lo unico que podia: inventarlos.
        const priorActions: Array<{ tool?: string; ok?: boolean; awaiting?: boolean }> = !isNewSession
            && Array.isArray((conversation.metadata as any)?.toolContext)
            ? (conversation.metadata as any).toolContext.slice(-RECENT_ACTIONS_MAX)
            : [];
        if (priorActions.length) {
            (turnContext as any).recentActions = priorActions;
        }

        // Assemble with a cache boundary: the contract+persona prefix is stable
        // across turns and can be cached by the provider (90% off on Anthropic;
        // better OpenAI auto-cache hit-rate). Only the <turn> block changes.
        const { systemPrompt, cachePrefixChars } = this.promptAssembler.assembleWithCacheBoundary(config, turnContext, bizHours);

        // Hoisted (also used inside the tool loop): the agent's reply-token cap, if pinned.
        const personaMaxTokens = typeof config.llm?.maxTokens === 'number' && config.llm.maxTokens > 0
            ? config.llm.maxTokens : undefined;
        const personaTemp = typeof config.llm?.temperature === 'number' ? config.llm.temperature : 0.8;

        let messages: Array<{ role: string; content: string }>;
        if (engineProducedText) {
            // Directive-based: send MINIMAL context. The directive in <turn> tells
            // the LLM WHAT to say. Too much history causes the LLM to ignore the
            // directive and respond to old messages instead.
            // Only include the last 2 exchanges (4 messages) for tone continuity.
            const recentHistory = (history || []).slice(-4);
            messages = recentHistory.map((m: any) => ({
                role: m.direction === 'inbound' ? 'user' : 'assistant',
                content: m.content_text || '',
            }));
            messages.push({ role: 'user', content: userText });
            this.logger.log(`[Pipeline] Express: directive-based with ${messages.length} recent messages`);
        } else if (isNewSession) {
            messages = [{ role: 'user', content: userText }];
            this.logger.log(`[Pipeline] New session: sending only current message (discarded ${history?.length || 0} old messages)`);
        } else {
            messages = this.truncateHistory(history || [], userText, systemPrompt, personaMaxTokens);
        }

        // Every write this turn performed, wherever it ran. Declared OUTSIDE the
        // try because the catch below needs it: an exception thrown AFTER a
        // booking was created (a guardrail retry timing out, a media send
        // failing) used to answer "estoy teniendo problemas técnicos" and lose
        // all trace of the tool — so the next turn had no idea the reservation
        // existed and either denied it or made it again.
        const executedToolsThisTurn: Array<{ name: string; result: any }> = [];

        // 4. Execute LLM Call using Router (with tool execution loop)
        try {
            // El servidor ya cometio una escritura y este turno se la va a
            // contar al cliente: no es un turno barato aunque no tenga tools.
            const voicedWrite = preExecutedTools.some(t => isBusinessWriteTool(t.name));
            const MAX_TOOL_ITERATIONS = 5;
            const currentMessages = [...messages] as any[];
            let finalResponse = '';
            // Media the LLM asked to send (e.g. product images), collected across
            // tool iterations and dispatched after the text reply.
            const mediaToSend: Array<{ url: string; caption?: string }> = [];

            const planFeatures = await this.throttle.getPlanFeatures(tenantId);
            let allowedTiers = this.mapLlmTierToAllowed(planFeatures.llmTier);

            // LLM cost circuit breaker: once month-to-date LLM spend exceeds the
            // plan's budget, clamp routing to budget models (tier_3/tier_4) so a
            // tenant on a premium tier can't run the plan into a loss via
            // value-routing escalation or tool-call multiplication. The agent
            // keeps replying — just on cheaper models — until the month rolls over.
            const llmBudgetUsdCents = typeof planFeatures.llmCostBudgetUsdCents === 'number'
                ? planFeatures.llmCostBudgetUsdCents : -1;
            // Also tells the router to stand down its tool-calling floor: over
            // budget, replying on a weaker model beats not replying.
            let budgetConstrained = false;
            if (llmBudgetUsdCents > 0) {
                const spentUsdCents = await this.throttle.getLlmSpendUsdCents(tenantId);
                if (spentUsdCents >= llmBudgetUsdCents) {
                    const clamped = allowedTiers.filter(t => t === 'tier_3_efficient' || t === 'tier_4_budget');
                    allowedTiers = clamped.length ? clamped : ['tier_4_budget'];
                    budgetConstrained = true;
                    this.logger.warn(
                        `[LLM budget] tenant ${tenantId} over monthly LLM budget ` +
                        `($${(spentUsdCents / 100).toFixed(2)}/$${(llmBudgetUsdCents / 100).toFixed(2)}) — ` +
                        `clamping tiers to ${allowedTiers.join(',')}`,
                    );
                }
            }

            // Escalada pedida por una tool de intake durante el turno (ver runTool).
            // Vive FUERA del loop: la tool puede correr en la iteración 1 y el texto
            // final producirse en la 2.
            let postToolHandoff: string | null = pendingOperationHandoff;
            executedToolsThisTurn.push(...preExecutedTools);

            // The model that made the first decision of this turn. Every later
            // iteration stays on it: a mid-turn failover left the second half of
            // the turn to a different model reasoning about tool calls it never
            // made, with its own idea of what to do next.
            let turnModel: { provider: string; model: string } | undefined;

            for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
                const hasTools = tools.length > 0;

                // Honor the agent's configured temperature/maxTokens (previously
                // ignored). Tool-calling stays deterministic (0.3) regardless, since
                // a high temperature degrades tool-argument accuracy.
                const response = await this.llmRouter.execute({
                    task: hasTools ? 'tool_calling' : 'conversation',
                    messages: currentMessages,
                    systemPrompt,
                    cacheableSystemPromptChars: cachePrefixChars,
                    temperature: hasTools ? 0.3 : personaTemp,
                    maxTokens: personaMaxTokens,
                    routingFactors,
                    tools: hasTools ? tools : undefined,
                    allowedTiers,
                    budgetConstrained,
                    voicedWrite,
                    pinnedModel: turnModel,
                    tenantId,
                    traceContext: {
                        conversationId: conversation.id,
                        kbSources: ((turnContext.retrievedKnowledge as any[]) || [])
                            .map((k: any) => k?.title)
                            .filter(Boolean),
                        stage: engineProducedText ? 'booking' : 'conversation',
                    },
                });

                const chosen = response.routingDecision?.selectedModel;
                if (!turnModel && chosen?.provider && chosen?.id) {
                    turnModel = { provider: String(chosen.provider), model: chosen.id };
                }

                // Check if LLM wants to call tools
                if (response.toolCalls?.length && hasTools) {
                    this.logger.log(`[Pipeline] LLM requested ${response.toolCalls.length} tool call(s) (iteration ${iteration + 1})`);

                    // Add assistant message with tool calls (using ChatMessage format)
                    currentMessages.push({
                        role: 'assistant',
                        content: response.content || '',
                        toolCalls: response.toolCalls,
                    });

                    // Execute the turn's tools. Read-only tools run concurrently via
                    // Promise.all (each isolated + per-tool timeout). Tools with write
                    // side-effects can race (double booking, two orders), so when the
                    // LLM asks for >1 writer in the same turn we serialize ALL of them
                    // and run them sequentially — never two writers in flight at once.
                    // Tool RESULT order in currentMessages is preserved regardless of
                    // completion order: we collect into a fixed-index array (matched by
                    // toolCallId) and push in the original toolCalls order afterwards.
                    const contactId = conversation.contact_id || '';
                    // Deduplicate identical tool calls in same iteration (D2 fix for 1787112547697 duplicate check_property_availability)
                    // LLM often requests same check twice; executing twice wastes 2s+ and doubles latency to 9.5s.
                    const originalToolCalls: any[] = response.toolCalls as any[];
                    const _seenToolKeys = new Map<string, number>();
                    const dedupedToolCalls: any[] = [];
                    const _keyFor = (tc: any): string => {
                        try {
                            const args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments || {};
                            return `${tc.function.name}:${JSON.stringify(Object.keys(args).sort().reduce((o: any, k) => (o[k]=args[k], o), {}))}`;
                        } catch { return `${tc.function.name}:${tc.id}`; }
                    };
                    for (const tc of originalToolCalls) {
                        const key = _keyFor(tc);
                        if (_seenToolKeys.has(key)) {
                            this.logger.warn(`[Pipeline] Deduplicating duplicate tool call ${tc.function.name} ${key} (keeping first)`);
                            continue;
                        }
                        _seenToolKeys.set(key, dedupedToolCalls.length);
                        dedupedToolCalls.push(tc);
                    }
                    if (dedupedToolCalls.length !== originalToolCalls.length) {
                        this.logger.log(`[Pipeline] Deduped ${originalToolCalls.length - dedupedToolCalls.length} duplicate tool call(s) this iteration`);
                    }
                    // Execute only deduped set; fan-out results below maps back to originalToolCalls
                    const toolCalls = dedupedToolCalls;

                    // Run a single tool call: parse args, timeout-guard, isolate errors,
                    // emit its trace, and capture any _mediaToSend marker. Returns the
                    // sanitized result (media marker stripped) for the tool message.
                    const runTool = async (tc: any): Promise<any> => {
                        let result: any;
                        try {
                            const args = typeof tc.function.arguments === 'string'
                                ? JSON.parse(tc.function.arguments)
                                : (tc.function.arguments || {});
                            result = await this.withTimeout(
                                this.toolExecutor.execute(schemaName, tenantId, contactId, tc.function.name, args, conversation.id, {
                                    channelType: msg.channelType,
                                    maxDiscountPercent: (config as any)?.upsell?.maxDiscountPercent,
                                    jurisdiction: regional?.operatingCountry.value,
                                }),
                                TOOL_TIMEOUT_MS,
                                tc.function.name,
                            );
                        } catch (e: any) {
                            this.logger.warn(`[Pipeline] Tool ${tc.function.name} failed/timed out: ${e.message}`);
                            result = { error: 'tool_failed', retryable: false, message: 'No se pudo ejecutar esta acción en este momento.' };
                        }

                        this.logger.log(`[Pipeline] Tool ${tc.function.name} executed in LLM loop`);
                        executedToolsThisTurn.push({ name: tc.function.name, result });
                        turnTrace.add('tool_result', tc.function.name, {
                            ok: !(result && result.error),
                            error: result?.error,
                        });

                        // Capture any media the tool wants sent (e.g. a product image)
                        // and strip the marker so it never reaches the LLM. mediaToSend
                        // is only mutated AFTER the awaited result resolves — one push
                        // per tool, no interleaved access, so it's safe under Promise.all.
                        //
                        // Acepta una imagen o varias: send_portfolio manda un
                        // conjunto (un portafolio de una sola foto no es un
                        // portafolio) y las tools de producto/inmueble mandan una.
                        if (result?._mediaToSend) {
                            const items = Array.isArray(result._mediaToSend)
                                ? result._mediaToSend
                                : [result._mediaToSend];
                            for (const m of items) {
                                if (m?.url) mediaToSend.push({ url: m.url, caption: m.caption });
                            }
                            delete result._mediaToSend;
                        }

                        // CAPTURAR-Y-ESCALAR: varias tools de intake (file_claim,
                        // create_service_request, triage veterinario) devuelven
                        // shouldHandoff:true y hasta ahora NADIE lo leía. El caso que
                        // esto resuelve: el cliente dice "tuve un siniestro" o "hay una
                        // fuga de gas" y la escalada por keyword lo mandaba a la cola
                        // ANTES de que la tool capturara póliza, dirección y datos —
                        // el humano recibía la conversación sin el intake que la propia
                        // vertical construyó para eso. Ahora la tool corre primero y la
                        // escalada ocurre después, con los datos ya registrados.
                        // ...pero SOLO cuando lo pide el dominio. El guard central
                        // marca `controlBlocked` cuando lo que falló es un
                        // invariante técnico (token sin firmar, lease vencido,
                        // conflicto de idempotencia): eso se arregla del lado
                        // nuestro, no mandando al cliente a una cola humana por un
                        // problema interno que él nunca vio. Las excepciones son
                        // las que pueden haber movido plata o cupo.
                        if (result && result.shouldHandoff === true
                            && (result.controlBlocked !== true
                                || CONTROL_ERRORS_REQUIRING_HUMAN.has(String(result.error)))) {
                            postToolHandoff = postToolHandoff || `intake:${tc.function.name}`;
                        } else if (result?.controlBlocked === true) {
                            this.logger.warn(`[Pipeline] Control block on ${tc.function.name} (${result.error}) — handled internally, not escalated`);
                        }
                        return result;
                    };

                    // Parallelize only a read-only batch. A writer followed by a
                    // read must preserve order so the read sees the committed write.
                    const writerCount = toolCalls.filter((tc: any) => isWriteTool(tc.function.name)).length;
                    const runSequential = toolBatchRequiresSequentialExecution(
                        toolCalls.map((tc: any) => tc.function.name),
                    );

                    let results: any[];
                    if (runSequential) {
                        this.logger.warn(`[Pipeline] ${writerCount} write-tool(s) this turn — running all ${toolCalls.length} tool(s) sequentially to preserve write/read visibility`);
                        results = [];
                        for (const tc of toolCalls) {
                            results.push(await runTool(tc));
                        }
                    } else {
                        // Every tool is a registered read.
                        results = await Promise.all(toolCalls.map((tc: any) => runTool(tc)));
                    }

                    // Fan-out deduped results to original toolCallIds (LLM expects result per toolCallId)
                    const _resultByKey = new Map<string, any>();
                    dedupedToolCalls.forEach((tc: any, i: number) => _resultByKey.set(_keyFor(tc), results[i]));
                    originalToolCalls.forEach((tc: any) => {
                        const key = _keyFor(tc);
                        const res = _resultByKey.get(key);
                        currentMessages.push({
                            role: 'tool',
                            toolCallId: tc.id,
                            // Borde unico por el que un resultado de herramienta
                            // llega al modelo, y por eso el lugar donde se sanea:
                            // los handlers devuelven `{ error: e.message }` con el
                            // texto crudo de la excepcion y el modelo se lo
                            // parafraseaba al cliente.
                            content: JSON.stringify(
                                sanitizeToolResultForModel(res ?? { error: 'tool_failed' }, userLanguage),
                            ),
                        });
                    });

                    continue; // Loop back for another LLM call with tool results
                }

                // No tool calls — this is the final text response
                finalResponse = response.content || '[Error Generating AI Response]';
                break;
            }

            // Tool loop exhausted all iterations without ever producing a final text
            // answer (the LLM kept requesting tools). The side effects already ran,
            // so force one last call WITHOUT tools to get a natural reply instead of
            // returning empty and leaving the customer with no response.
            if (!finalResponse) {
                this.logger.warn(`[Pipeline] Tool loop exhausted ${MAX_TOOL_ITERATIONS} iterations without a final answer — forcing a no-tools response`);
                try {
                    const closing = await this.llmRouter.execute({
                        task: 'conversation',
                        messages: currentMessages,
                        systemPrompt,
                        temperature: personaTemp,
                        maxTokens: personaMaxTokens,
                        routingFactors,
                        allowedTiers,
                        tenantId,
                        traceContext: { conversationId: conversation.id, stage: 'conversation' },
                    });
                    finalResponse = closing.content || '';
                } catch (e: any) {
                    this.logger.warn(`[Pipeline] Forced no-tools response failed: ${e.message}`);
                }
                if (!finalResponse) {
                    finalResponse = 'Disculpa, estoy teniendo problemas para completar tu solicitud en este momento. ¿Podrías intentarlo de nuevo o reformular tu mensaje?';
                }
            }

            // Booking state already persisted earlier in the engine block

            // Output guardrail (#3): catch invented prices before the reply leaves.
            // Corpus = the system prompt (services/KB/directive/business info) + the
            // whole message thread (history + tool results) — everything the model saw.
            finalResponse = await this.applyOutputGuardrails(
                finalResponse, systemPrompt, currentMessages, allowedTiers, tenantId, conversation.id,
                executedToolsThisTurn, userLanguage, priorActions,
            );
            turnTrace.add('guardrail', 'output', { responseLength: finalResponse?.length || 0 });

            // Long-term memory (#1): periodically distill the conversation into
            // durable facts (fire-and-forget, cheap tier). Cadence keeps cost low.
            if (config.llm?.memory?.longTerm && conversation.contact_id && (turnContext.messageCount || 0) % 6 === 0) {
                this.customerMemory.extractFromConversation(tenantId, schemaName, conversation.id, conversation.contact_id)
                    .catch(() => { /* best-effort */ });
            }

            // El enlace de pago sale del backend, no de la boca del modelo: es
            // plata, y ya vimos al modelo prometerlo y no mandarlo. Va primero
            // que las imágenes porque es lo que el cliente está esperando.
            const paymentLinks = executedToolsThisTurn
                .map(t => (t?.result as any)?.paymentLink)
                .filter((u): u is string => typeof u === 'string' && /^https:\/\//i.test(u));
            for (const url of new Set(paymentLinks)) {
                await this.sendPaymentLink(tenantId, msg, url);
                await this.saveAiMessage(tenantId, conversation.id, url, msg.channelType);
            }

            // Multimodal out (#13): dispatch product images the LLM requested,
            // staggered AFTER the text reply so they land in a natural order.
            for (let i = 0; i < mediaToSend.length; i++) {
                await this.sendMedia(tenantId, msg, mediaToSend[i].url, mediaToSend[i].caption, 2000 + i * 1200);
                await this.saveAiMessage(tenantId, conversation.id, `[📷 ${mediaToSend[i].caption || 'imagen'}]`, msg.channelType);
            }

            // Reset failedAttempts on successful AI response
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations
                 SET metadata = jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{failedAttempts}',
                     '0'::jsonb
                 )
                 WHERE id = $1::uuid`,
                [conversation.id],
            );

            // CAPTURAR-Y-ESCALAR (2/2): la tool de intake ya corrió y registró los
            // datos; recién ahora se pasa a un humano, con el caso creado. El orden
            // importa — al revés (keyword antes de la IA) el humano recibía la
            // conversación sin el siniestro/solicitud registrado.
            if (postToolHandoff) {
                try {
                    this.logger.warn(`[Pipeline] HANDOFF post-intake (${postToolHandoff}) para conversación ${conversation.id}`);
                    this.analyticsService.trackEvent({
                        tenantId, eventType: 'handoff_triggered',
                        conversationId: conversation.id, contactId: conversation.contact_id || undefined,
                        data: { reason: postToolHandoff, afterIntake: true },
                    }).catch(() => {});
                    await this.handoffService.executeHandoff(tenantId, conversation.id, msg, postToolHandoff);
                } catch (e: any) {
                    // Nunca romper el turno por la escalada: el cliente ya recibió su
                    // respuesta y el intake quedó guardado.
                    this.logger.error(`[Pipeline] No se pudo escalar tras el intake: ${e?.message}`);
                }
            }

            // What this turn actually did, kept for the next one.
            //
            // The history the model reads back is text only: its own tool calls
            // and their results vanish at the end of the turn. So it re-listed
            // the same properties every turn, re-checked availability it had just
            // checked, and — worse — lost the payable reference that
            // `create_property_booking` had returned, which the payment link then
            // had to be invented from.
            await this.persistToolContext(schemaName, conversation.id, executedToolsThisTurn);

            turnTrace.add('decision', 'final_response', {
                finalResponseLength: finalResponse?.length || 0,
                mediaCount: mediaToSend.length,
                postToolHandoff: postToolHandoff || undefined,
            });
            // Persist the step-by-step trace, fire-and-forget — tracing never breaks the turn.
            try { this.eventEmitter.emit('llm.turn.steps', turnTrace.toEvent()); } catch { /* ignore */ }

            return finalResponse;
        } catch (e: any) {
            this.logger.error(`[Pipeline] LLM call FAILED: ${e.message}`, e.stack);

            // Something was already done for this customer before the turn broke.
            // The generic "I had a problem, could you repeat that?" is a lie by
            // omission here: the booking exists, the payment link was issued, and
            // the customer — told nothing happened — asks for it again.
            const committed = executedToolsThisTurn.filter(
                t => (isBusinessWriteTool(t.name) || t.name.startsWith('mcp__')) && toolResultSucceeded(t.result),
            );
            if (committed.length) {
                this.logger.error(`[Pipeline] Turn failed AFTER committing ${committed.map(t => t.name).join(', ')} — telling the customer the truth instead of the generic error`);
                this.recordAgentSignal(tenantId, 'commit_then_failure');
                turnTrace.add('decision', 'error_after_commit', {
                    error: e?.message,
                    committed: committed.map(t => t.name),
                });
                try { this.eventEmitter.emit('llm.turn.steps', turnTrace.toEvent()); } catch { /* ignore */ }
                return partialSuccessText(userLanguage);
            }

            // Increment failed attempts for handoff threshold
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations
                 SET metadata = jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{failedAttempts}',
                     (COALESCE((metadata->>'failedAttempts')::int, 0) + 1)::text::jsonb
                 )
                 WHERE id = $1::uuid`,
                [conversation.id],
            );

            // Trace failed turns too — they're the most valuable for debugging/evals.
            turnTrace.add('decision', 'error', { error: e?.message });
            try { this.eventEmitter.emit('llm.turn.steps', turnTrace.toEvent()); } catch { /* ignore */ }

            return errorFallbackText(userLanguage);
        }
    }

    /** CRM lead score → 0-100 ticket value (defensively normalizes a 1-10 scale to 0-100). */
    private computeTicketValue(lead?: any): number {
        let s = Number(lead?.score);
        if (!Number.isFinite(s)) return 10;
        if (s > 0 && s <= 10) s *= 10; // some scorers emit 1-10; scale to 0-100
        return Math.max(0, Math.min(100, Math.round(s)));
    }

    /** Intent-type signal for value routing — derived from complexity (no explicit intent here). */
    private computeIntentType(complexity: number): number {
        return Math.round(complexity * 0.5) + 25;
    }

    /**
     * Truncate conversation history to a dynamic TOKEN budget (vs the model's context
     * window minus the system prompt + reply reserve, capped at HISTORY_MAX_TOKENS).
     * Keeps the most recent messages and always includes the current user message.
     */
    /**
     * Debounce a burst of messages from the same contact into one turn.
     * Returns: a combined string for the LAST message of the burst (flusher),
     * `null` for earlier messages (a newer one will flush — caller should bail),
     * or `undefined` when not debounced (media/non-text or Redis unavailable).
     *
     * Coordination is Redis-based (works across processes): each message bumps a
     * sequence and appends its text; after the window only the message still
     * holding the latest sequence drains the buffer (atomic Lua check+drain+del).
     */
    private async debounceBurst(msg: NormalizedMessage): Promise<string | null | undefined> {
        // A WhatsApp Flow completion is a structured turn (sentinel + interactiveReply.data);
        // never debounce/combine it or the strict sentinel match breaks and the booking is lost.
        if ((msg.content as any)?.interactiveReply?.type === 'flow_response') return undefined;
        const text = msg.content?.type === 'text' ? (msg.content?.text || '') : '';
        if (!text) return undefined; // media/buttons are distinct turns — no debounce

        const base = `buf:conv:${msg.tenantId}:${msg.channelType}:${msg.contactId}`;
        const seqKey = `${base}:seq`;
        const msgsKey = `${base}:msgs`;

        let mySeq: number;
        try {
            mySeq = await this.redis.incr(seqKey);
            await this.redis.expire(seqKey, 60);
            await this.redis.rpush(msgsKey, text);
            await this.redis.expire(msgsKey, 60);
        } catch {
            return undefined; // Redis hiccup → process this message as-is
        }

        await new Promise(r => setTimeout(r, DEBOUNCE_MS));

        // Atomic flush: only the holder of the latest sequence drains the buffer.
        let parts: string[] | null;
        try {
            parts = await this.redis.getClient().eval(
                `if redis.call('get', KEYS[1]) == ARGV[1] then
                   local m = redis.call('lrange', KEYS[2], 0, -1)
                   redis.call('del', KEYS[2]); redis.call('del', KEYS[1]); return m
                 else return false end`,
                2, seqKey, msgsKey, String(mySeq),
            ) as string[] | null;
        } catch {
            return text; // Redis hiccup → process just this message's text
        }

        if (!parts) return null; // a newer fragment arrived — it will flush the batch
        if (parts.length > 1) {
            this.logger.log(`[Debounce] Flushed ${parts.length} messages as one turn for ${msg.contactId}`);
        }
        // Consecutive identical lines collapse. A turn that had to give its lock
        // back returns its merged burst to the buffer, and the retry appends its
        // own text again — the last fragment would otherwise be read twice.
        const joined = (parts.length ? parts : [text]).join('\n');
        const lines = joined.split('\n');
        const deduped = lines.filter((line, i) => i === 0 || line.trim() !== lines[i - 1].trim());
        return deduped.join('\n').trim() || text;
    }

    /**
     * Stores a compact record of what the tools returned this turn, so the next
     * turn knows what has already been looked up and what was already created.
     *
     * Deliberately small: names, outcome and a handful of identifying fields.
     * This is a memory of ACTIONS, not a cache of payloads — enough for the model
     * to stop repeating itself and to reuse an identifier it was given, not
     * enough to become another context-bloat problem.
     */
    private async persistToolContext(
        schemaName: string,
        conversationId: string,
        executed: Array<{ name: string; result: any }>,
    ): Promise<void> {
        if (!executed.length) return;
        try {
            const entries = executed.slice(-RECENT_ACTIONS_MAX).map(t => ({
                tool: t.name,
                ok: toolResultSucceeded(t.result),
                // Sobrevive al turno porque el guardrail lo necesita: una
                // operacion escrita pero impaga no respalda un "confirmada",
                // ni ahora ni dentro de tres turnos.
                awaiting: (t.result as any)?.awaitingPayment === true || undefined,
                facts: this.describeOperationResult(t.result).slice(0, 400) || undefined,
            }));
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations
                    SET metadata = jsonb_set(
                        jsonb_set(COALESCE(metadata, '{}'::jsonb), '{toolContext}', $2::jsonb),
                        '{toolContextUpdatedAt}', to_jsonb(NOW()::text)
                    )
                  WHERE id = $1::uuid`,
                [conversationId, JSON.stringify(entries)],
            );
        } catch (e: any) {
            this.logger.warn(`[Pipeline] Could not persist tool context (non-fatal): ${e.message}`);
        }
    }

    /**
     * Counts something worth knowing about how the agent behaved.
     *
     * These are the four numbers nobody had: how often the agent claimed an
     * action no tool performed, how often a turn ended with the customer getting
     * nothing, how often a second message had to wait for the first, and how
     * often the server closed a confirmation the model would have dropped.
     * Cheap Redis counters keyed by day, read by the Ops Center.
     */
    private recordAgentSignal(tenantId: string, signal: string): void {
        const day = new Date().toISOString().slice(0, 10);
        const tenantKey = `agent:signal:${signal}:${tenantId}:${day}`;
        // Platform-wide total and the set of tenants that contributed to it.
        // The Ops Center needs a bounded, deterministic set of keys to read on
        // every tick: scanning `agent:signal:*` would grow with the tenant base
        // and is exactly the kind of check that gets disabled when it gets slow.
        const totalKey = `agent:signal:${signal}:${day}`;
        const tenantsKey = `agent:signal:${signal}:tenants:${day}`;
        const TTL = 8 * 86400;
        Promise.all([
            this.redis.incr(tenantKey).then(() => this.redis.expire(tenantKey, TTL)),
            this.redis.incr(totalKey).then(() => this.redis.expire(totalKey, TTL)),
            this.redis.sadd(tenantsKey, tenantId).then(() => this.redis.expire(tenantsKey, TTL)),
        ]).catch(() => { /* metrics must never break a turn */ });
    }

    /**
     * Puts an already-merged burst back where the next attempt will find it.
     *
     * Used when a turn has to give up its slot (the conversation is busy): the
     * fragments were drained from the buffer before the lock was attempted, so
     * without this the retry would answer only the last message of the burst.
     */
    private async restoreBurst(msg: NormalizedMessage, combinedText: string): Promise<void> {
        if (!combinedText.trim()) return;
        const base = `buf:conv:${msg.tenantId}:${msg.channelType}:${msg.contactId}`;
        try {
            await this.redis.rpush(`${base}:msgs`, combinedText);
            await this.redis.expire(`${base}:msgs`, 60);
        } catch { /* best-effort: the retry still carries its own text */ }
    }

    /**
     * RAG 2.0 query rewriting. Follow-up questions ("¿y eso cuánto sale?", "el
     * segundo") embed poorly because the raw text lacks the referent. When the
     * message looks like a follow-up, rewrite it into a standalone search query
     * using recent history (cheap tier). Self-contained questions pass through
     * unchanged so we don't add latency where it isn't needed.
     */
    private async rewriteSearchQuery(userText: string, schemaName: string, conversationId: string, tenantId: string): Promise<string> {
        // Una confirmación no tiene nada que expandir.
        //
        // El guard de abajo es `length < 80`, así que "sí" entraba: una consulta
        // a la base MÁS una llamada al LLM para reescribir dos letras que no
        // tienen referente. Y justo en el turno que cierra la venta, que es el
        // que menos puede permitirse latencia de más.
        //
        // Sin `` a propósito: en JavaScript se apoya en `\w`, que no incluye
        // `í`, así que `sí` no casa nunca. El anclaje al final ya exige que la
        // confirmación sea todo el mensaje — "si tienen lugar" no entra.
        // El patrón es el mismo que usa el intérprete de intención para decidir
        // `isConfirmation`, a propósito: si mañana alguien agrega una forma de
        // decir que sí, los dos lugares tienen que verla igual.
        if (/^(si|sí|yes|ok|oka|okay|confirmo|confirmar|confirma|confirmado|dale|listo|perfecto|claro|correcto|de acuerdo|por supuesto|sure|oui|sim|va|vamos|exacto|gracias|thanks|obrigad|merci)[\s.!]*$/i.test(userText.trim())) {
            return userText;
        }

        // Only worth a rewrite for likely follow-ups (short or anaphoric) — a
        // self-contained question passes through so we don't add a call/latency.
        const looksLikeFollowUp = userText.length < 80 ||
            /\b(eso|esa|ese|esos|esas|esto|estos|aquello|ello|lo mismo|tambi[eé]n|el primero|el segundo|la primera|la segunda|cu[aá]nto|y\s)\b/i.test(userText);
        if (!looksLikeFollowUp) return userText;

        // Fetch a little prior context (decoupled from the main history fetch,
        // which happens later in the pipeline). Skip the current inbound (OFFSET 1).
        let recent = '';
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT direction, content_text FROM messages
                 WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 5 OFFSET 1`,
                [conversationId]);
            if (!rows?.length) return userText; // no prior context → nothing to resolve
            recent = rows.reverse()
                .map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${(m.content_text || '').slice(0, 200)}`)
                .join('\n');
        } catch {
            return userText;
        }
        if (!recent) return userText;

        try {
            const resp = await this.llmRouter.execute({
                task: 'conversation',
                messages: [{
                    role: 'user',
                    content: `Dada la conversación, reescribe la ÚLTIMA pregunta del cliente como una consulta de búsqueda autónoma, resolviendo referencias ("eso", "ese", "el segundo") con el contexto. Si ya es autónoma, devuélvela igual. Devuelve SOLO la consulta, sin comillas ni explicación.\n\n${recent}\nCliente: ${userText}`,
                }],
                systemPrompt: 'Reescribes preguntas en consultas de búsqueda autónomas. Devuelves solo la consulta.',
                temperature: 0,
                tenantId,
            });
            const rewritten = resp.content?.trim().replace(/^["']|["']$/g, '');
            if (rewritten && rewritten.length > 2 && rewritten.length < 300) {
                this.logger.debug(`[RAG] Query rewritten: "${userText}" → "${rewritten}"`);
                return rewritten;
            }
        } catch (e: any) {
            this.logger.debug(`[RAG] Query rewrite skipped: ${e.message}`);
        }
        return userText;
    }

    /**
     * Output guardrail:
     * 1. Action claims: ensure past-tense completion claims ("tu reserva está confirmada",
     *    "pago confirmado", etc.) are only made when a backing write tool succeeded this turn.
     * 2. Price verification: ensure prices stated in the response exist in context/corpus.
     */
    /**
     * Turns the raw result of a server-executed operation into the directive the
     * LLM voices.
     *
     * The model never sees the tool result here, so it cannot narrate an outcome
     * of its own: it receives the facts the backend produced and a sentence
     * telling it whether the deed happened. On failure it is explicitly told not
     * to claim success — the failure mode this whole block exists to remove.
     */
    private buildExecutedOperationDirective(
        toolName: string,
        result: any,
        lang?: string,
    ): string {
        const L = (lang || 'es').slice(0, 2).toLowerCase();
        const T = EXECUTED_OPERATION_MSG[L] || EXECUTED_OPERATION_MSG.es;
        const succeeded = !!result && !result.error && result.success !== false;
        if (!succeeded) {
            const reason = String(result?.message || result?.error || 'unknown').slice(0, 200);
            return T.failed.replace('{reason}', reason);
        }
        const facts = this.describeOperationResult(result);
        // Cuando hay enlace, el backend lo manda como mensaje aparte. Hay que
        // decírselo al modelo o va a intentar transcribir uno que ya no está en
        // los datos, o peor, va a prometer generarlo.
        const linkNote = result?.paymentLink
            ? '\nEl enlace de pago se le envía en un mensaje aparte que sale JUSTO DESPUÉS del tuyo: '
                + 'no lo escribas ni prometas generarlo, sólo decile qué tiene que pagar y que el enlace va enseguida.'
            : '';
        // La operación se escribió, pero el dueño exige pago para confirmarla y
        // el cupo sigue a la venta. "Realizada" y "confirmada" no son lo mismo:
        // sin esta rama el agente cerraba la venta que todavia no ocurrio.
        if (result?.awaitingPayment === true) {
            return (facts ? `${T.awaitingPayment}\n${facts}` : T.awaitingPayment) + linkNote;
        }
        return (facts ? `${T.done}\n${facts}` : T.doneNoDetails) + linkNote;
    }

    /**
     * Flattens a tool result into `- field: value` lines the model can read out.
     * Only primitives, one nested level, control fields dropped, values capped —
     * a directive is not a place to dump a payload.
     */
    private describeOperationResult(result: any): string {
        const SKIP = new Set([
            'success', 'error', 'retryable', 'message', 'shouldHandoff',
            'idempotentReplay', 'confirmationId', 'ledgerId', 'raw',
            // Fontaneria interna. El 19-ago la directiva del enlace de pago
            // llego con `operationId`, `payableReference`, `linkCreated` y
            // `linkStatus` sepultando al unico dato que el huesped necesitaba
            // —la URL—, y el modelo termino ignorando la directiva entera.
            // Tampoco tiene por que ver identificadores nuestros.
            // El enlace lo manda el backend como burbuja aparte: si además
            // estuviera acá, el cliente lo recibiría dos veces.
            'paymentLink',
            'operationId', 'payableReference', 'paymentIntentId',
            'executionLedgerId', 'providerOperationId', 'provider',
            'linkCreated', 'linkStatus', 'requiresNewConfirmation',
        ]);
        const lines: string[] = [];
        // La plata viaja en centavos por dentro y NUNCA puede salir asi.
        // `amountCents: 72000000` son 720.000 COP: si el modelo lo vocea tal
        // cual le dice al huesped setenta y dos millones. Se convierte a la
        // unidad real y se le pone la moneda al lado.
        const currency = String((result as any)?.currency || '').toUpperCase();
        // Si la moneda ya viaja pegada al importe, repetirla sola es una linea
        // menos de directiva util. Solo se suprime cuando de verdad se uso.
        const currencyConsumed = !!currency
            && Object.keys(result || {}).some(k => /cents$/i.test(k));
        const renderMoney = (cents: unknown): string | null => {
            const n = typeof cents === 'number' ? cents : Number(cents);
            if (!Number.isFinite(n)) return null;
            const amount = (n / 100).toLocaleString('es-CO', { maximumFractionDigits: 2 });
            return currency ? `${amount} ${currency}` : amount;
        };
        const push = (key: string, value: unknown) => {
            if (lines.length >= 10) return;
            if (value === null || value === undefined || value === '') return;
            if (typeof value === 'object') return;
            if (/cents$/i.test(key)) {
                const money = renderMoney(value);
                if (money) lines.push(`- ${key.replace(/cents$/i, '').trim() || 'importe'}: ${money}`);
                return;
            }
            const text = String(value).slice(0, 160);
            if (!text.trim()) return;
            lines.push(`- ${key}: ${text}`);
        };
        for (const [key, value] of Object.entries(result || {})) {
            if (key.startsWith('_') || SKIP.has(key)) continue;
            if (key === 'currency' && currencyConsumed) continue;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
                    if (k2.startsWith('_') || SKIP.has(k2)) continue;
                    push(k2, v2);
                }
                continue;
            }
            push(key, value);
        }
        return lines.join('\n');
    }

    /**
     * Lo que respalda un "ya quedó hecho": lo de este turno MÁS lo que hicieron
     * los turnos anteriores de esta conversación.
     *
     * La auditoría miraba sólo el turno actual. Eso estuvo bien mientras el
     * modelo no tenía memoria de sus herramientas — pero desde que
     * `<recent_actions>` por fin se emite, el modelo PUEDE referirse
     * correctamente a una reserva hecha dos turnos atrás, y el guardrail la
     * marcaba como mentira y la reescribía. En producción tapó tres veces
     * seguidas una reserva que existía y estaba confirmada: el huésped
     * preguntaba, el agente respondía la verdad, y nosotros la borrábamos.
     *
     * Se acota solo: son a lo sumo RECENT_ACTIONS_MAX entradas, de ESTA
     * conversación, y se descartan al abrir una sesión nueva junto con el resto
     * de la época. Una operación pendiente de pago sigue sin respaldar nada.
     */
    private backingEvidence(
        executed?: Array<{ name: string; result: any }>,
        prior?: Array<{ tool?: string; ok?: boolean; awaiting?: boolean }>,
    ): Array<{ name: string; result: any }> {
        const fromPrior = (prior || [])
            .filter(a => a?.ok === true && typeof a.tool === 'string')
            .map(a => ({
                name: a.tool as string,
                result: { success: true, awaitingPayment: a.awaiting === true },
            }));
        return [...(executed || []), ...fromPrior];
    }

    private async applyOutputGuardrails(
        response: string,
        systemPrompt: string,
        currentMessages: any[],
        allowedTiers: ModelTier[],
        tenantId: string,
        conversationId: string,
        executedTools?: Array<{ name: string; result: any }>,
        lang?: string,
        priorActions?: Array<{ tool?: string; ok?: boolean; awaiting?: boolean }>,
    ): Promise<string> {
        if (!response || isErrorFallback(response)) return response;

        // Guardrail 1: False completion claims (claiming an action happened when no tool ran/succeeded)
        //
        // `isBackingTool` comes from the canonical policy registry rather than a
        // name pattern: the pattern missed place_order, book_class,
        // enroll_student, register_pet and file_claim, so a real sale closed by
        // any of those was audited as invented. Unknown/MCP tools that succeeded
        // count as backing — we cannot prove they did nothing, and calling a real
        // booking a lie is the more expensive mistake.
        const isBackingTool = (name: string) => (
            isBusinessWriteTool(name) || name.startsWith('mcp__')
        );
        const backing = this.backingEvidence(executedTools, priorActions);
        const claimAudit = auditTurnClaim(response, backing, { isBackingTool });
        if (claimAudit.falseClaim) {
            this.recordAgentSignal(tenantId, 'claim_unbacked');
            this.logger.warn(`[Guardrail] Response claimed completed action without backing tool execution — corrective retry: "${response.slice(0, 100)}"`);
            try {
                const correctedClaim = await this.llmRouter.execute({
                    task: 'conversation',
                    messages: [
                        ...currentMessages,
                        { role: 'assistant', content: response },
                        { role: 'user', content: 'Tu respuesta afirmó que una reserva, cobro, cita o cancelación ya fue confirmada o completada, pero ninguna herramienta ejecutó esa acción con éxito en este turno. Reescribe tu mensaje explicando con total claridad qué paso o confirmación está pendiente para realizar la acción, sin afirmar que ya está confirmada o completada. Devuelve solo el mensaje corregido.' },
                    ],
                    systemPrompt,
                    temperature: 0.3,
                    allowedTiers,
                    tenantId,
                });
                const fixedClaim = correctedClaim.content?.trim();
                const secondAudit = fixedClaim
                    ? auditTurnClaim(fixedClaim, backing, { isBackingTool })
                    : null;
                if (secondAudit && !secondAudit.falseClaim) {
                    response = fixedClaim as string;
                } else {
                    // The rewrite insisted (or never came back). Sending the
                    // ORIGINAL was the old behaviour and it means shipping the
                    // very sentence we just proved false — a customer walking
                    // away believing they hold a reservation that does not exist.
                    this.logger.warn('[Guardrail] Corrective rewrite still claimed an unbacked action — replacing with the deterministic fallback');
                    response = unverifiedClaimFallbackText(lang);
                }
            } catch (e: any) {
                this.logger.warn(`[Guardrail] False claim corrective retry failed: ${e.message}`);
                response = unverifiedClaimFallbackText(lang);
            }
        }

        // Prometer para después algo que YA se hizo deja al cliente esperando.
        //
        // Cuando el backend ejecutó la operación antes de llamar al modelo —el
        // camino del "sí" del cliente— el resultado ya está en la mano y en la
        // directiva. Una respuesta que difiere ("voy a generar el enlace… un
        // momento") es un callejón sin salida: cada turno es pregunta→respuesta
        // y no existe nada que mande ese segundo mensaje. Pasó en producción el
        // 19-ago con `create_payment_link` y la conversación quedó congelada.
        //
        // Sólo se controla en ese caso: fuera de él, "dame un momento" es una
        // frase legítima y el auditor de reclamos la excluye a propósito.
        const outcomeAlreadyKnown = (executedTools || []).some(t => isBackingTool(t?.name));
        // Excepción: si el backend va a mandar el enlace en una burbuja aparte,
        // "el enlace va enseguida" es CIERTO y no hay que reescribirlo. Sin esta
        // salvedad los dos arreglos se pisan: uno le pide al modelo que anuncie
        // el envío y el otro lo castiga por anunciarlo.
        const backendWillDeliver = (executedTools || []).some(t => !!(t?.result as any)?.paymentLink);
        if (outcomeAlreadyKnown && !backendWillDeliver && promisesLaterDelivery(response)) {
            this.recordAgentSignal(tenantId, 'deferred_after_execution');
            this.logger.warn(`[Guardrail] La operacion ya se ejecuto y la respuesta la difiere — reintento correctivo: "${response.slice(0, 100)}"`);
            try {
                const corrected = await this.llmRouter.execute({
                    task: 'conversation',
                    messages: [
                        ...currentMessages,
                        { role: 'assistant', content: response },
                        { role: 'user', content: 'La operación YA se ejecutó y su resultado está en las instrucciones de este turno. No prometas hacerla después ni pidas esperar: no vas a poder enviar otro mensaje. Reescribe tu respuesta diciendo AHORA el resultado concreto —el enlace, el dato o el problema— tal como figura en las instrucciones. Devuelve solo el mensaje corregido.' },
                    ],
                    systemPrompt,
                    temperature: 0.3,
                    allowedTiers,
                    tenantId,
                });
                const fixed = corrected.content?.trim();
                if (fixed && !promisesLaterDelivery(fixed)) {
                    response = fixed;
                } else {
                    // Se insistió en diferir. No hay texto determinista honesto
                    // que sirva acá —inventar "te contactamos" sería otra
                    // promesa que nadie cumple—, así que queda la señal para que
                    // el dueño lo vea en Salud del agente.
                    this.logger.warn('[Guardrail] El reintento volvio a diferir una operacion ya ejecutada');
                    this.recordAgentSignal(tenantId, 'deferred_after_execution_unfixed');
                }
            } catch (e: any) {
                this.logger.warn(`[Guardrail] Reintento de promesa diferida fallo: ${e.message}`);
            }
        }

        // Lo que las herramientas DEVOLVIERON entra al corpus.
        //
        // El validador solo reconoce importes dentro de regiones `<...>` o
        // `{...}`, y el directivo de una operacion ya ejecutada los lleva como
        // texto plano (`- nightPrice: 180000`). O sea que un precio que produjo
        // nuestro propio backend era estructuralmente imposible de aprobar: en
        // el turno que confirmaba la reserva el guardrail descarto la respuesta
        // correcta por "precio inventado" y, si el reintento volvia a nombrarlo,
        // el fail-closed le contaba la reserva al huesped SIN su precio.
        //
        // El resultado de la tool es la fuente de verdad del importe, asi que va
        // serializado: no depende del formato del directivo ni de que alguien
        // recuerde mantener los dos alineados.
        const executedToolsCorpus = (executedTools || []).length
            ? '\n' + JSON.stringify(executedTools)
            : '';
        const corpus = systemPrompt + '\n' + (currentMessages || [])
            .map(m => (typeof m?.content === 'string' ? m.content : '')).join('\n')
            + executedToolsCorpus;

        const check = this.responseValidator.validatePrices(response, corpus);
        if (check.ok) return response;

        this.logger.warn(`[Guardrail] Response stated price(s) not in context: ${check.hallucinatedPrices.join(', ')} — corrective retry`);
        try {
            const corrected = await this.llmRouter.execute({
                task: 'conversation',
                messages: [
                    ...currentMessages,
                    { role: 'assistant', content: response },
                    { role: 'user', content: 'Tu respuesta anterior mencionó uno o más precios que NO aparecen en la información que tienes. Reescríbela usando ÚNICAMENTE precios presentes en el contexto; si no tienes el precio exacto, dilo con naturalidad y ofrece confirmarlo. Devuelve solo el mensaje corregido.' },
                ],
                systemPrompt,
                temperature: 0.3,
                allowedTiers,
                tenantId,
            });
            const fixed = corrected.content?.trim();
            if (fixed) {
                const enforced = enforceVerifiedPriceReply(fixed, corpus, systemPrompt, this.responseValidator);
                if (enforced.blocked) {
                    this.eventEmitter.emit('response.guardrail.failed', { tenantId, conversationId, prices: enforced.validation.hallucinatedPrices });
                }
                return enforced.reply;
            }
        } catch (e: any) {
            this.logger.warn(`[Guardrail] corrective retry failed: ${e.message}`);
        }
        // Couldn't correct: surface for monitoring and fail closed on the price.
        this.eventEmitter.emit('response.guardrail.failed', { tenantId, conversationId, prices: check.hallucinatedPrices });
        return buildUnverifiedPriceReply(systemPrompt);
    }

    /**
     * One turn, one message — unless the text genuinely does not fit.
     *
     * Splitting every reply over 600 characters into two or three bubbles cost
     * us three ways. The bubbles are separate queue jobs ordered only by a delay,
     * so one retried send arrives after the bubble that followed it and the
     * customer reads the answer out of order. Each bubble is a separate service
     * message, which Meta bills individually from October 2026, so a chatty
     * agent costs three times a concise one. And a wall of text arriving in
     * pieces reads as an agent talking over itself, not as a person.
     *
     * The threshold now exists only to stay under the channel's own limit
     * (WhatsApp rejects a body over 4096 characters), which is a real constraint
     * rather than a stylistic one.
     */
    private splitResponseIntoChunks(text: string): string[] {
        const MIN_LEN_TO_CHUNK = 3500;
        const MAX_CHUNKS = 3;
        if (!text || text.length <= MIN_LEN_TO_CHUNK) return [text];

        const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
        if (paras.length <= 1) return [text]; // no natural break — don't split mid-paragraph

        const targetLen = Math.ceil(text.length / Math.min(MAX_CHUNKS, paras.length));
        const chunks: string[] = [];
        let cur = '';
        for (const p of paras) {
            if (cur && cur.length + p.length > targetLen && chunks.length < MAX_CHUNKS - 1) {
                chunks.push(cur);
                cur = p;
            } else {
                cur = cur ? `${cur}\n\n${p}` : p;
            }
        }
        if (cur) chunks.push(cur);
        return chunks.length ? chunks : [text];
    }

    /** Resolve `p`, or reject after `ms` so one slow tool can't stall the turn. */
    private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
        return Promise.race([
            p,
            new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Tool ${label} timed out after ${ms}ms`)), ms)),
        ]);
    }

    private truncateHistory(
        history: any[],
        currentMessage: string,
        systemPrompt = '',
        responseMaxTokens?: number,
    ): Array<{ role: string; content: string }> {
        // Token budget left for history after reserving the system prompt + the reply,
        // floored at the smallest reachable context window and capped so very long
        // conversations don't inflate cost. Estimator is chars/4 (repo-wide).
        const systemTokens = Math.ceil((systemPrompt.length || 0) / CHARS_PER_TOKEN) || SYSTEM_PROMPT_RESERVE_TOKENS;
        const responseTokens = (typeof responseMaxTokens === 'number' && responseMaxTokens > 0)
            ? responseMaxTokens : DEFAULT_RESPONSE_RESERVE_TOKENS;
        const dynamicBudget = MIN_MODEL_CONTEXT_TOKENS - systemTokens - responseTokens - HISTORY_SAFETY_MARGIN_TOKENS;
        const historyBudgetTokens = Math.max(0, Math.min(dynamicBudget, HISTORY_MAX_TOKENS));
        const maxHistoryChars = historyBudgetTokens * CHARS_PER_TOKEN;

        const messages: Array<{ role: string; content: string }> = [];
        let totalChars = currentMessage.length; // the current message always counts and is never dropped

        // Build from newest to oldest, then reverse — keeps the MOST RECENT context.
        for (let i = history.length - 1; i >= 0; i--) {
            const h = history[i];
            const content = h.content_text || '';
            if (totalChars + content.length > maxHistoryChars) break;
            totalChars += content.length;
            messages.unshift({
                role: h.direction === 'inbound' ? 'user' : 'assistant',
                content,
            });
        }

        // Add current message (always included even if it alone exceeds the budget).
        messages.push({ role: 'user', content: currentMessage });

        return messages;
    }

    /** Persist booking state to BOTH Redis (fast, reliable) and PostgreSQL (durable). */
    /**
     * ¿El motor determinista debe CEDER el turno a la IA con sus tools?
     *
     * El motor gana en la agenda pura (salud, belleza, veterinaria, fotografía):
     * servicio → fecha → hora, sin que el modelo decida el flujo. Pero su regex
     * de intención (`agendar|cita|reservar|turno|…`) también captura "quiero
     * reservar una clase de yoga", "reservar una habitación" o "agendar visita al
     * apartamento de Chapinero" — casos donde la reserva NO es una cita contra
     * `services`, sino una tool vertical con su propio inventario y capacidad.
     *
     * Regla, deliberadamente conservadora (el default NO se invierte): solo cede
     * si el agente tiene encendida una tool vertical de reserva/inventario Y el
     * texto nombra un objeto de esa vertical. Ante la duda, entra el motor.
     */
    private shouldYieldToVerticalTools(config: any, userText: string, bookingState: any): boolean {
        // A mitad de un flujo de reserva el motor manda: cederlo dejaría al
        // cliente colgado entre dos conductores.
        const step = bookingState?.step;
        if (step && step !== 'idle' && step !== 'booked') return false;

        const tools = (config?.tools ?? {}) as Record<string, any>;
        const on = (k: string) => tools?.[k]?.enabled === true;

        // Objetos por vertical: la tool encendida sola no alcanza (una peluquería
        // canina con `pets` no debe perder el motor por decir "turno").
        //
        // En los CUATRO idiomas que atendemos. Con el patrón sólo en español, un
        // cliente que escribía "book a room", "reservar uma aula" o "réserver une
        // chambre" nunca cedía el turno: el motor de citas genéricas se quedaba
        // con la conversación y la vertical perdía justo sus herramientas de
        // venta — el hotel no podía cotizar la habitación ni el gimnasio inscribir
        // en la clase.
        const VERTICAL_OBJECTS: Array<{ tool: string; re: RegExp }> = [
            { tool: 'gyms', re: /\b(clase|clases|entrenamiento|spinning|yoga|crossfit|funcional|pilates|zumba|cupo|class|classes|workout|training|aula|aulas|treino|cours|s[ée]ance)\b/i },
            { tool: 'tours', re: /\b(tour|tours|excursi[óo]n|salida|paseo|city ?tour|excursion|trip|passeio|excurs[ãa]o|visite|circuit)\b/i },
            { tool: 'properties', re: /\b(habitaci[óo]n|habitaciones|noche|noches|alojamiento|hosped|cabaña|apartamento completo|room|rooms|night|nights|stay|lodging|quarto|quartos|noite|noites|hospedagem|chambre|chambres|nuit|nuits|s[ée]jour)\b/i },
            { tool: 'realEstate', re: /\b(propiedad|propiedades|inmueble|apartamento|apto|casa|local|lote|visita|property|properties|listing|viewing|house|im[óo]vel|apartamento|visita|propri[ée]t[ée]|logement|bien immobilier)\b/i },
            { tool: 'restaurants', re: /\b(mesa|mesas|comensal|comensales|personas|pedido|domicilio|delivery|carta|men[úu]|table|tables|order|takeaway|menu|mesa|pedido|card[áa]pio|entrega|commande|carte)\b/i },
            { tool: 'education', re: /\b(curso|cursos|clase|inscripci[óo]n|matr[íi]cula|cohorte|nivel|examen|course|courses|enroll|enrolment|enrollment|tuition|curso|matr[íi]cula|inscri[çc][ãa]o|cours|inscription)\b/i },
            { tool: 'vehicles', re: /\b(auto|carro|veh[íi]culo|camioneta|moto|prueba de manejo|test drive|car|cars|vehicle|suv|truck|carro|ve[íi]culo|voiture|v[ée]hicule|essai)\b/i },
        ];

        const mentionsVerticalObject = VERTICAL_OBJECTS.some(v => on(v.tool) && v.re.test(userText));
        if (!mentionsVerticalObject) return false;

        // Si el texto además nombra un servicio sembrado, el motor sigue siendo el
        // camino correcto (p. ej. una vet con `pets` que pide "baño y corte").
        const services: any[] = Array.isArray(bookingState?.services) ? bookingState.services : [];
        const lower = userText.toLowerCase();
        const matchesSeededService = services.some((s: any) => {
            const name = String(s?.name || '').toLowerCase().trim();
            return name.length > 3 && lower.includes(name);
        });
        return !matchesSeededService;
    }

    private async persistBookingState(schemaName: string, conversationId: string, state: any): Promise<void> {
        // Redis first — always succeeds, survives PG failures
        const redisKey = `booking:${conversationId}`;
        try {
            await this.redis.set(redisKey, JSON.stringify(state), 3600); // 1h TTL
        } catch (e: any) {
            this.logger.warn(`Redis booking state save failed: ${e.message}`);
        }
        // PostgreSQL — durable but may fail under shared memory pressure
        try {
            const update = { bookingState: state, bookingStateUpdatedAt: new Date().toISOString() };
            await this.prisma.executeInTenantSchema(schemaName,
                `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1::uuid`,
                [conversationId, JSON.stringify(update)],
            );
        } catch (e: any) {
            this.logger.warn(`PG booking state save failed (Redis has backup): ${e.message}`);
        }
    }

    /** Load booking state: Redis first (fast), fallback to conversation metadata. */
    private async loadBookingState(conversationId: string, conversationMetadata: any): Promise<BookingState> {
        try {
            const redisKey = `booking:${conversationId}`;
            const cached = await this.redis.get(redisKey);
            if (cached) {
                const state = JSON.parse(cached);
                if (state.step) {
                    this.logger.log(`[Pipeline] Booking state loaded from Redis: step=${state.step} svc=${state.serviceName || '-'}`);
                    return state;
                }
            }
        } catch {}
        // Fallback to PG metadata — but only if it's FRESH. The PG backup has no
        // TTL (unlike the 1h Redis key), so without this an abandoned booking could
        // be restored days later and, with date+time already captured, book a slot
        // in the past. Mirror the Redis 1h expiry.
        const state = conversationMetadata?.bookingState;
        if (state?.step && state.step !== 'idle') {
            const updatedAt = conversationMetadata?.bookingStateUpdatedAt;
            const ageMs = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) : Infinity;
            if (ageMs > 3600_000) {
                this.logger.log(`[Pipeline] Discarding stale PG booking state (age ${Math.round(ageMs / 60000)}min) — restarting idle`);
                return { step: 'idle' } as BookingState;
            }
            this.logger.log(`[Pipeline] Booking state loaded from PG metadata: step=${state.step}`);
            return state;
        }
        return state || { step: 'idle' };
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        const cacheKey = `tenant:${tenantId}:schema`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached;
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.redis.set(cacheKey, schema, 600);
        return schema;
    }

    /**
     * Static fallback when the tenant has exhausted their monthly AI quota.
     * We do NOT call the LLM — that's the point of the cap. We pick a polite
     * message in the tenant's preferred language so customers aren't left
     * staring at a black hole. Translation strings are intentionally plain
     * (no variables) to avoid pulling i18n into a hot path.
     */
    private async buildQuotaFallbackMessage(tenantId: string): Promise<string> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { language: true },
        }).catch(() => null);
        const lang = (tenant?.language || 'es').slice(0, 2).toLowerCase();
        const messages: Record<string, string> = {
            es: 'Gracias por tu mensaje. En breve un agente humano te atenderá.',
            en: 'Thanks for your message. A human agent will reach out shortly.',
            pt: 'Obrigado pela sua mensagem. Um atendente humano entrará em contato em breve.',
            fr: 'Merci pour votre message. Un agent humain vous répondra sous peu.',
        };
        return messages[lang] || messages.es;
    }

    async processWidgetMessage(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        contactId: string,
        text: string,
        options?: { allowHumanHandoff?: boolean },
    ): Promise<string | null> {
        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
        if (!entitlement.allowed) {
            this.logger.warn(`[Entitlement] Dropped widget message for tenant ${tenantId}: ${entitlement.error}`);
            return null;
        }
        const personaResolution = await this.personaService.resolvePersonaForChannel(tenantId, 'web_widget');
        const config = personaResolution.config;
        if (!config) return null;

        // Serialize widget turns per conversation, same mutex as the main pipeline
        // (token + heartbeat), so two quick widget messages don't process in parallel.
        const lockKey = `lock:conv:${conversationId}`;
        let lockToken = await this.redis.acquireLockToken(lockKey, 30);
        // 2 seconds of patience against turns that routinely take 10-60s: the
        // widget gave up almost immediately and ran a second turn on top of the
        // first. Wait for a realistic turn, and if the conversation is still busy
        // say so instead of answering twice.
        for (let i = 0; i < 30 && !lockToken; i++) {
            await new Promise(r => setTimeout(r, 1000));
            lockToken = await this.redis.acquireLockToken(lockKey, 30);
        }
        if (!lockToken) {
            this.logger.warn(`[Widget] Conversation ${conversationId} still busy after waiting — refusing to run a concurrent turn`);
            throw new Error(`conversation_locked:${conversationId}`);
        }
        let lockHeartbeat: ReturnType<typeof setInterval> | undefined;
        if (lockToken) {
            const tk = lockToken;
            lockHeartbeat = setInterval(() => { this.redis.renewLockToken(lockKey, tk, 30).catch(() => {}); }, 10_000);
            lockHeartbeat.unref?.();
        }

        try {

        const history = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT direction, content_text FROM messages
             WHERE conversation_id = $1::uuid ORDER BY created_at ASC LIMIT 20`,
            [conversationId],
        );

        const conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId],
        );

        if (conversation?.[0]?.status === 'waiting_human' || conversation?.[0]?.status === 'with_human') {
            return null;
        }

        const handoffReason = this.handoffService.shouldHandoff(text, conversation?.[0] || {}, config);
        if (handoffReason && options?.allowHumanHandoff === true) {
            await this.persistConversationPersonaResolution(schemaName, conversationId, personaResolution);
            await this.handoffService.executeHandoff(tenantId, conversationId, {
                tenantId, conversationId, contactId, channelType: 'web_widget',
                content: { type: 'text', text },
            } as any, handoffReason);
            return handoffText(this.languageDetector.detect(text, config.language || 'es')).queueHead;
        }
        if (handoffReason) {
            await this.persistConversationPersonaResolution(schemaName, conversationId, personaResolution);
            this.logger.warn(`[Widget] Handoff blocked: no verified human-delivery capability for ${conversationId}`);
            return widgetHandoffUnavailableText(
                this.languageDetector.detect(text, config.language || 'es'),
            );
        }

        const turnContext = await this.buildWidgetTurnContext(
            tenantId, schemaName, conversation?.[0], contactId, text, config,
            (history?.length || 0) + 1,
        );
        const systemPrompt = this.promptAssembler.assemble(config, turnContext);

        const chatMessages = (history || []).map((m: any) => ({
            role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.content_text || '',
        }));
        chatMessages.push({ role: 'user' as const, content: text });

        try {
            await this.persistConversationPersonaResolution(schemaName, conversationId, personaResolution);
            const response = await this.llmRouter.execute({
                model: 'grok-4-1-fast-non-reasoning',
                messages: chatMessages,
                systemPrompt,
                temperature: 0.8,
                tenantId,
            });
            return response.content || null;
        } catch (err: any) {
            this.logger.warn(`Widget AI failed: ${err.message}`);
            return null;
        }
        } finally {
            if (lockHeartbeat) clearInterval(lockHeartbeat);
            if (lockToken) await this.redis.releaseLockToken(lockKey, lockToken).catch(() => {});
        }
    }

    /**
     * Streaming variant of processWidgetMessage for the web chat widget (#6 Fase-2).
     * Same lock/history/persona/handoff logic, but yields the AI reply token-by-token
     * via the router's executeStream so the widget renders progressively (lower TTFT).
     * It does NOT persist the outbound message nor emit sockets — the gateway does that
     * once the stream closes (mirroring how the gateway persists today). On error it
     * propagates so the gateway can emit widget:stream_error. Messaging channels are
     * untouched (they stay non-streaming).
     */
    async *streamWidgetMessage(
        tenantId: string,
        schemaName: string,
        conversationId: string,
        contactId: string,
        text: string,
        inboundMessageId?: string,
        options?: { allowHumanHandoff?: boolean },
    ): AsyncGenerator<string, void, unknown> {
        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
        if (!entitlement.allowed) {
            this.logger.warn(`[Entitlement] Stopped widget stream for tenant ${tenantId}: ${entitlement.error}`);
            return;
        }
        const personaResolution = await this.personaService.resolvePersonaForChannel(tenantId, 'web_widget');
        const config = personaResolution.config;
        if (!config) return;

        const lockKey = `lock:conv:${conversationId}`;
        let lockToken: string | null = null;
        try {
            lockToken = await this.redis.acquireLockToken(lockKey, 30);
            for (let i = 0; i < 4 && !lockToken; i++) {
                await new Promise(r => setTimeout(r, 500));
                lockToken = await this.redis.acquireLockToken(lockKey, 30);
            }
        } catch (e: any) {
            this.logger.warn(`[Widget] Conversation lock unavailable: ${e?.message || 'redis_error'}`);
        }
        if (!lockToken) {
            // Never fail open. The former path continued without ownership after 2s,
            // allowing concurrent paid turns and out-of-order replies.
            const lang = (config.language || 'es').slice(0, 2).toLowerCase();
            const busy: Record<string, string> = {
                es: 'Estoy procesando tu mensaje anterior. Inténtalo de nuevo en un momento.',
                en: 'I am still processing your previous message. Please try again in a moment.',
                pt: 'Ainda estou processando sua mensagem anterior. Tente novamente em instantes.',
                fr: 'Je traite encore votre message précédent. Réessayez dans un instant.',
            };
            yield busy[lang] || busy.es;
            return;
        }
        const tk = lockToken;
        const lockHeartbeat = setInterval(() => { this.redis.renewLockToken(lockKey, tk, 30).catch(() => {}); }, 10_000);
        lockHeartbeat.unref?.();

        try {
            const historyDesc = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT id, direction, content_text FROM messages
                 WHERE conversation_id = $1::uuid
                   AND ($2::uuid IS NULL OR id <> $2::uuid)
                 ORDER BY created_at DESC, id DESC LIMIT 20`,
                [conversationId, inboundMessageId || null],
            );
            const history = (historyDesc || []).reverse();
            const conversation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT * FROM conversations WHERE id = $1::uuid LIMIT 1`,
                [conversationId],
            );

            if (conversation?.[0]?.status === 'waiting_human' || conversation?.[0]?.status === 'with_human') {
                return;
            }

            const handoffReason = this.handoffService.shouldHandoff(text, conversation?.[0] || {}, config);
            if (handoffReason && options?.allowHumanHandoff === true) {
                await this.persistConversationPersonaResolution(schemaName, conversationId, personaResolution);
                await this.handoffService.executeHandoff(tenantId, conversationId, {
                    tenantId, conversationId, contactId, channelType: 'web_widget',
                    content: { type: 'text', text },
                } as any, handoffReason);
                yield handoffText(this.languageDetector.detect(text, config.language || 'es')).queueHead;
                return;
            }
            if (handoffReason) {
                await this.persistConversationPersonaResolution(schemaName, conversationId, personaResolution);
                this.logger.warn(`[Widget] Handoff blocked: no verified human-delivery capability for ${conversationId}`);
                yield widgetHandoffUnavailableText(
                    this.languageDetector.detect(text, config.language || 'es'),
                );
                return;
            }
            // Resolve entitlement, allowed model tiers and cost circuit before any
            // provider request. Direct model selection bypassed provider health and
            // plan limits; the task-based router path keeps normal fallback behavior.
            const planFeatures = await this.throttle.getPlanFeatures(tenantId);
            if (planFeatures.widget !== true) return;
            let allowedTiers = this.mapLlmTierToAllowed(planFeatures.llmTier);
            const budgetUsdCents = typeof planFeatures.llmCostBudgetUsdCents === 'number'
                ? planFeatures.llmCostBudgetUsdCents : -1;
            if (budgetUsdCents > 0) {
                const spentUsdCents = await this.throttle.getLlmSpendUsdCents(tenantId);
                if (spentUsdCents >= budgetUsdCents) {
                    const economical = allowedTiers.filter(
                        tier => tier === 'tier_3_efficient' || tier === 'tier_4_budget',
                    );
                    allowedTiers = economical.length ? economical : ['tier_4_budget'];
                    this.logger.warn(`[Widget LLM budget] tenant ${tenantId} over budget; clamped to ${allowedTiers.join(',')}`);
                }
            }

            const turnContext = await this.buildWidgetTurnContext(
                tenantId, schemaName, conversation?.[0], contactId, text, config,
                (history?.length || 0) + 1,
            );
            const systemPrompt = this.promptAssembler.assemble(config, turnContext);
            const chatMessages = (history || []).map((m: any) => ({
                role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: m.content_text || '',
            }));
            chatMessages.push({ role: 'user' as const, content: text });

            // Atomically reserve this monthly AI message immediately before the
            // provider. A concurrent conversation that crosses the limit rolls its
            // reservation back and receives the deterministic fallback.
            const usage = await this.throttle.getAiMessageUsage(tenantId);
            if (Number.isFinite(usage.limit) && usage.used >= (usage.limit as number)) {
                yield await this.buildQuotaFallbackMessage(tenantId);
                return;
            }
            const reserved = await this.throttle.incrementAiMessageCount(tenantId);
            if (Number.isFinite(usage.limit) && reserved > (usage.limit as number)) {
                await this.throttle.incrementAiMessageCount(tenantId, -1).catch(() => {});
                yield await this.buildQuotaFallbackMessage(tenantId);
                return;
            }

            await this.persistConversationPersonaResolution(schemaName, conversationId, personaResolution);

            const personaMaxTokens = typeof config.llm?.maxTokens === 'number' && config.llm.maxTokens > 0
                ? config.llm.maxTokens : undefined;
            const personaTemperature = typeof config.llm?.temperature === 'number'
                ? config.llm.temperature : 0.8;
            for await (const chunk of this.llmRouter.executeStream({
                task: 'conversation',
                messages: chatMessages,
                systemPrompt,
                temperature: personaTemperature,
                maxTokens: personaMaxTokens,
                allowedTiers,
                tenantId,
            })) {
                yield chunk;
            }
        } finally {
            if (lockHeartbeat) clearInterval(lockHeartbeat);
            if (lockToken) await this.redis.releaseLockToken(lockKey, lockToken).catch(() => {});
        }
    }

    private async buildWidgetTurnContext(
        tenantId: string,
        schemaName: string,
        conversation: any,
        contactId: string,
        text: string,
        config: TenantConfig,
        messageCount: number,
    ): Promise<TurnContext> {
        const configuredLanguage = config.language || 'es-CO';
        const previousLanguage = conversation?.metadata?.detectedLanguage;
        const language = this.languageDetector.detect(
            text,
            previousLanguage || configuredLanguage,
        );
        const businessHours = await this.loadTenantBusinessHours(tenantId);
        const widgetRegional = await this.regionalProfile?.resolve(tenantId).catch(() => null);
        const timezone = businessHours?.timezone
            || config.hours?.timezone
            || widgetRegional?.timezone.value
            || 'America/Bogota';
        const now = new Date();
        const turnContext: TurnContext & Record<string, any> = {
            userMessage: text,
            language,
            channelType: 'web_widget',
            messageCount,
            timezone,
            now: now.toISOString(),
            upcomingDays: this.promptAssembler.computeUpcomingDays(now, timezone, 8),
            businessHoursStatus: this.isWithinBusinessHours(config, businessHours)
                ? 'open' : 'closed',
        };

        const contacts = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, name, email, phone, first_contact_at, created_at
             FROM contacts WHERE id = $1::uuid LIMIT 1`,
            [contactId],
        ).catch(() => []);
        const contact = contacts?.[0];
        if (contact) {
            turnContext.contact = {
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                isKnown: Boolean(contact.name || contact.email || contact.phone),
                knownSince: contact.first_contact_at || contact.created_at,
            };
            await this.activeOperationsContext.populateTurnContext(turnContext, {
                tenantId,
                schemaName,
                contactId,
                config: config as any,
                timezone,
                now,
            });
        }

        const businessIdentity = await this.businessInfoService.getPrimary(tenantId).catch(() => null);
        if (businessIdentity) {
            turnContext.business = {
                companyName: businessIdentity.companyName,
                industry: businessIdentity.industry,
                about: businessIdentity.about,
                phone: businessIdentity.phone,
                email: businessIdentity.email,
                website: businessIdentity.website,
                address: businessIdentity.address,
                city: businessIdentity.city,
                country: businessIdentity.country,
                socialLinks: businessIdentity.socialLinks,
            };
        }
        return turnContext;
    }

    private mapLlmTierToAllowed(planTier: string | undefined): ModelTier[] {
        switch (planTier) {
            case 'tier_1':
                return ['tier_1_premium', 'tier_2_standard', 'tier_3_efficient', 'tier_4_budget'];
            case 'tier_2':
                return ['tier_2_standard', 'tier_3_efficient', 'tier_4_budget'];
            case 'tier_4':
                return ['tier_4_budget'];
            case 'tier_3':
            default:
                return ['tier_3_efficient', 'tier_4_budget'];
        }
    }
}
