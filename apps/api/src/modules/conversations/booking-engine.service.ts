import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { InterpretedIntent } from './intent-interpreter.service';
import type { ToolExecutionAuthority, MissionExecutionScopeV1 } from '@parallext/shared';
import { holdStillAliveSql } from '../../common/utils/payment-policy.util';
import { bookingEngineAuthorityDecision, deniedOperationalIntent } from './turn-authority';
import { bookingConfirmationHash } from './booking-confirmation';
import { appointmentPriceSql, appointmentCurrencySql, type AppointmentServiceTerms } from '../appointments/appointment-service-terms';
import { isInformationSeekingMessage, isPauseMessage, isResumeMessage, normalizeCustomerIntent } from '../../common/conversation/intent-normalizer';
import { normalizeForIntent } from '@parallext/shared';
import { procedureDialogueMessages } from './procedure-dialogue-messages';
import { containsMissionDirective, isCollectionCancellation, isDirectedCorrection, isNamedMissionResume, mentionedMissionDomains, missionDialogue, parseDirectedSlotCorrection } from './mission-focus';
import { coerceProcedureSlot } from './procedure-slot-interpolation';
import { nearestSlots, selectSlotWindow } from './slot-window';
import { answerToOffer, asksDuration, bookingActKind, isAboutBooking, isInformationalDetour, isOnlyInquiry, isPushingToBook, isServiceSwitchDirective } from './informational-detour';
import { BOOKING_OFFER_TTL_MS } from './booking-offer';

/**
 * Lo que el motor necesita saber del turno además del estado de la reserva.
 *
 * Existe como objeto —y no como tres parámetros más al final— porque `authority`
 * tiene que ser **obligatoria**, y en una lista posicional que ya venía con
 * opcionales al final no hay dónde poner un parámetro requerido sin que el
 * compilador deje de avisar cuando falta.
 */
export interface BookingTurnContext {
    /** Con qué permiso escribe este motor. Sin esto, el ejecutor deniega. */
    authority: ToolExecutionAuthority;
    /**
     * Opt-in WhatsApp Flows: the caller decides capability (flag ON + flowId set +
     * channel is WhatsApp). The engine stays pure (doesn't read tenant.settings),
     * same principle as `language`. `flowData` carries the parsed nfm_reply fields.
     */
    flowCapable?: boolean;
    flowData?: Record<string, unknown>;
    conversationId?: string;
    missionScope?: MissionExecutionScopeV1;
    flowResponseToken?: string;
    resumeSelected?: boolean;
    startSelected?: boolean;
}


/**
 * DECIDE phase — pure deterministic booking flow.
 *
 * Receives structured intent from INTERPRET phase.
 * Makes ALL decisions: what to do, what tool to call, what to respond.
 * ZERO LLM calls. Pure code.
 *
 * Pipeline: INTERPRET → [DECIDE] → EXPRESS
 */

/** Booking engine messages in 4 languages */
const MESSAGES: Record<string, Record<string, string | string[]>> = {
    es: {
        bookingPrice: "Precio: {amount}",
        servicePriceExample: "precio por confirmar",
        servicePriceQuote: "se cotiza según el caso",
        bookingPriceToConfirm: "Precio: por confirmar con el negocio",
        bookingPriceQuote: "Precio: se cotiza según el caso",
        bookingDuration: 'Duración reservada: {minutes} minutos',
        bookingLocation: 'Lugar: {location}',
        bookingOnline: 'En línea',
        bookingPaymentDue: "Pago para confirmar: {amount}",
        bookingPending: "La solicitud de cita para {service} el {date} a las {time} quedó registrada y pendiente de confirmación.",
        bookingAwaitingPayment: "La cita para {service} el {date} a las {time} está pendiente del pago de {amount}. El horario se retiene temporalmente; la confirmación llegará cuando se acredite el pago.",
        serviceSelected: [
            '{service} seleccionado. ¿Qué fecha le queda bien?',
            '¡Excelente elección! Reservaremos {service}. ¿Qué día le gustaría agendar?',
            'Listo, he seleccionado {service} para usted. ¿Para qué fecha desea la cita?',
            'Perfecto, agendaremos {service}. Cuénteme, ¿qué día le viene mejor?'
        ],
        switchedService: [
            'Cambiamos a {service}. ¿Qué fecha le queda bien?',
            'Entendido, cambiamos al servicio {service}. ¿Qué día prefiere para la cita?',
            'Listo, ahora estamos agendando {service}. ¿Qué fecha le gustaría?'
        ],
        cancelled: '¡Sin problema! ¿Hay algo más en lo que pueda ayudarle?',
        resumeOffer: 'Quedó a medio agendar una cita de {service}. ¿Desea continuar o prefiere empezar de nuevo?',
        resumeOfferNoService: 'Quedó una cita a medio agendar. ¿Desea continuar o prefiere empezar de nuevo?',
        resumeDiscarded: 'Listo, dejé esa reserva de lado. ¿En qué puedo ayudarle?',
        switchDeclined: 'Está bien, dejamos su cita en curso de {service} como estaba.',
        switchDuration: '{service} dura {minutes} minutos.',
        switchDurationRange: '{service} dura entre {min} y {max} minutos.',
        switchDurationOpen: '{service} tiene un horario flexible.',
        switchPrice: 'El precio de {service} es {amount}.',
        switchPriceNote: 'Sobre el precio de {service}: {note}.',
        switchSlotFree: 'Sí, hay cupo el {date} a las {time} para {service}.',
        switchSlotTaken: 'El {date} a las {time} no hay cupo para {service}. Hay disponibilidad a las {slots}.',
        switchDayFree: 'El {date} hay cupo para {service} a las {slots}.',
        switchDayFull: 'El {date} no hay disponibilidad para {service}.',
        switchOffer: '¿Desea cambiar su cita de {from} por {service}?',
        switchOfferDate: '¿Desea cambiar su cita de {from} por {service} el {date}? Si es así, indíqueme el horario que prefiere.',
        switchOfferSlot: '¿Desea cambiar su cita de {from} por {service} el {date} a las {time}?',
        switchOfferOtherDate: '¿Desea cambiar su cita de {from} por {service} para otra fecha?',
        changeOfferSlot: '¿Desea cambiar su cita de {service} al {date} a las {time}?',
        changeOfferDate: '¿Desea cambiar su cita de {service} al {date}? Si es así, indíqueme el horario que prefiere.',
        draftStays: 'Su cita de {service} sigue en curso, tal como estaba (todavía sin confirmar).',
        servicesHeader: 'Estos son nuestros servicios:',
        servicesFooter: '¿Cuál le interesa?',
        slotsAvailable: 'Horarios disponibles para {service} el {date}: {slots}. ¿Cuál horario prefiere?',
        noAvailability: [
            'No hay disponibilidad el {date}. ¿Le gustaría probar otra fecha?',
            'El {date} ya está completamente lleno. ¿Qué tal si intentamos con otro día?',
            'Lamentablemente no tenemos horarios libres el {date}. ¿Le sirve alguna otra fecha?',
            'Disculpe, no encontré espacios el {date}. ¿Qué otro día le gustaría intentar?'
        ],
        slotUnavailable: 'El horario de las {time} no está disponible. Horarios disponibles: {slots}. ¿Cuál le funciona?',
        slotSuggest: 'El horario de las {time} no está disponible. Le recomiendo {suggestion}. ¿Le sirve?',
        slotSuggestMany: 'El horario de las {time} no está disponible. Le recomiendo {suggestion}. ¿Cuál le sirve?',
        slotSuggestOr: 'o',
        slotSuggestItem: 'las {t}',
        schedulingUnavailable: 'Todavía no tenemos la agenda disponible por acá. Le paso con alguien del equipo para coordinar su cita.',
        bookingFailedHandoff: 'No pude completar la reserva por acá. Le paso con alguien del equipo para confirmarla con usted.',
        askName: '{time} seleccionado para {service}. ¿Cuál es su nombre completo?',
        askEmail: '¡Gracias {name}! Necesito su correo electrónico para la invitación del calendario.',
        confirmPrompt: 'Por favor confirme:\n{summary}\n¿Lo agendo?',
        confirmShort: '¿Confirmo la cita? Responda sí o no.',
        confirmButton: '¿Confirmar cita?\n\n{summary}',
        btnConfirm: 'Confirmar',
        btnCancel: 'Cancelar',
        booked: '¡Cita confirmada!\nServicio: {service}\nFecha: {date} a las {time}\nNombre: {name}\n¿Algo más?',
        bookingError: 'Error al crear la cita: {error}. ¿Probamos otro horario?',
        askDate: [
            '¿Qué fecha le gustaría para {service}?',
            '¿Para qué día quiere programar {service}?',
            '¿Qué fecha tiene disponible en su agenda para {service}?',
            'Dígame qué día le queda mejor para {service} y revisamos horarios.'
        ],
        whichTime: '¿Cuál horario? {slots}',
        whichName: '¿Cuál es su nombre completo?',
        whichEmail: '¿Cuál es su correo electrónico?',
        minutes: 'minutos',
        flexibleTime: 'horario libre',
        flowHeader: 'Agende su cita',
        flowBody: 'Toque el botón para elegir servicio, fecha y hora en un solo paso.',
        flowCta: 'Agendar',
    },
    en: {
        bookingPrice: "Price: {amount}",
        servicePriceExample: "price to be confirmed",
        servicePriceQuote: "quoted case by case",
        bookingPriceToConfirm: "Price: to be confirmed by the business",
        bookingPriceQuote: "Price: quoted case by case",
        bookingDuration: 'Reserved duration: {minutes} minutes',
        bookingLocation: 'Location: {location}',
        bookingOnline: 'Online',
        bookingPaymentDue: "Payment to confirm: {amount}",
        bookingPending: "Your appointment request for {service} on {date} at {time} was recorded and is awaiting confirmation.",
        bookingAwaitingPayment: "Your appointment for {service} on {date} at {time} is awaiting payment of {amount}. The slot is held temporarily; confirmation follows verified payment.",
        serviceSelected: '{service} selected. What date works for you?',
        switchedService: 'Switched to {service}. What date works for you?',
        cancelled: 'No problem! Is there anything else I can help you with?',
        resumeOffer: 'An appointment for {service} was left half-scheduled. Would you like to continue it or start over?',
        resumeOfferNoService: 'An appointment was left half-scheduled. Would you like to continue it or start over?',
        resumeDiscarded: 'Done, I set that booking aside. How can I help you?',
        switchDeclined: 'Understood, your {service} appointment in progress stays as it was.',
        switchDuration: '{service} takes {minutes} minutes.',
        switchDurationRange: '{service} takes between {min} and {max} minutes.',
        switchDurationOpen: '{service} has a flexible duration.',
        switchPrice: 'The price of {service} is {amount}.',
        switchPriceNote: 'About the price of {service}: {note}.',
        switchSlotFree: 'Yes, there is availability on {date} at {time} for {service}.',
        switchSlotTaken: 'There is no availability for {service} on {date} at {time}. Available times: {slots}.',
        switchDayFree: 'On {date} there is availability for {service} at {slots}.',
        switchDayFull: 'There is no availability for {service} on {date}.',
        switchOffer: 'Would you like to change your {from} appointment to {service}?',
        switchOfferDate: 'Would you like to change your {from} appointment to {service} on {date}? If so, tell me which time you prefer.',
        switchOfferSlot: 'Would you like to change your {from} appointment to {service} on {date} at {time}?',
        switchOfferOtherDate: 'Would you like to change your {from} appointment to {service} on another date?',
        changeOfferSlot: 'Would you like to move your {service} appointment to {date} at {time}?',
        changeOfferDate: 'Would you like to move your {service} appointment to {date}? If so, tell me which time you prefer.',
        draftStays: 'Your {service} appointment stays in progress as it was (not confirmed yet).',
        servicesHeader: 'These are our services:',
        servicesFooter: 'Which one interests you?',
        slotsAvailable: 'Available times for {service} on {date}: {slots}. Which time do you prefer?',
        noAvailability: 'No availability on {date}. Would you like to try another date?',
        slotUnavailable: 'The {time} slot is not available. Available times: {slots}. Which one works for you?',
        slotSuggest: '{time} is not available. I recommend {suggestion}. Does that work for you?',
        slotSuggestMany: '{time} is not available. I recommend {suggestion}. Which one works for you?',
        slotSuggestOr: 'or',
        slotSuggestItem: '{t}',
        schedulingUnavailable: 'Our booking calendar is not available here yet. Let me connect you with someone from our team to arrange your appointment.',
        bookingFailedHandoff: 'I could not complete the booking here. Let me connect you with someone from our team to confirm it with you.',
        askName: '{time} selected for {service}. What is your full name?',
        askEmail: 'Thanks {name}! I need your email for the calendar invitation.',
        confirmPrompt: 'Please confirm:\n{summary}\nShall I book this?',
        confirmShort: 'Shall I confirm the appointment? Please answer yes or no.',
        confirmButton: 'Confirm booking?\n\n{summary}',
        btnConfirm: 'Confirm',
        btnCancel: 'Cancel',
        booked: 'Appointment confirmed!\nService: {service}\nDate: {date} at {time}\nName: {name}\nAnything else?',
        bookingError: 'Issue creating appointment: {error}. Try another time?',
        askDate: 'What date would you like for {service}?',
        whichTime: 'Which time? {slots}',
        whichName: 'What is your full name?',
        whichEmail: 'What is your email address?',
        minutes: 'minutes',
        flexibleTime: 'flexible time',
        flowHeader: 'Book your appointment',
        flowBody: 'Tap the button to pick a service, date and time in one step.',
        flowCta: 'Book',
    },
    pt: {
        bookingPrice: "Preço: {amount}",
        servicePriceExample: "preço a confirmar",
        servicePriceQuote: "sob orçamento",
        bookingPriceToConfirm: "Preço: a confirmar com o negócio",
        bookingPriceQuote: "Preço: sob orçamento, conforme o caso",
        bookingDuration: 'Duração reservada: {minutes} minutos',
        bookingLocation: 'Local: {location}',
        bookingOnline: 'Online',
        bookingPaymentDue: "Pagamento para confirmar: {amount}",
        bookingPending: "A solicitação de agendamento de {service} em {date} às {time} foi registrada e aguarda confirmação.",
        bookingAwaitingPayment: "O agendamento de {service} em {date} às {time} aguarda o pagamento de {amount}. O horário fica reservado temporariamente; a confirmação ocorre após a aprovação do pagamento.",
        serviceSelected: '{service} selecionado. Qual data funciona para você?',
        switchedService: 'Mudamos para {service}. Qual data funciona para você?',
        cancelled: 'Sem problema! Posso ajudar com mais alguma coisa?',
        resumeOffer: 'Ficou um agendamento de {service} pela metade. Deseja continuar ou prefere começar de novo?',
        resumeOfferNoService: 'Ficou um agendamento pela metade. Deseja continuar ou prefere começar de novo?',
        resumeDiscarded: 'Pronto, deixei essa reserva de lado. Como posso ajudar?',
        switchDeclined: 'Tudo bem, mantemos o seu agendamento em andamento de {service} como estava.',
        switchDuration: '{service} dura {minutes} minutos.',
        switchDurationRange: '{service} dura entre {min} e {max} minutos.',
        switchDurationOpen: '{service} tem horário flexível.',
        switchPrice: 'O preço de {service} é {amount}.',
        switchPriceNote: 'Sobre o preço de {service}: {note}.',
        switchSlotFree: 'Sim, há vaga em {date} às {time} para {service}.',
        switchSlotTaken: 'Não há vaga para {service} em {date} às {time}. Horários disponíveis: {slots}.',
        switchDayFree: 'Em {date} há vaga para {service} nos horários: {slots}.',
        switchDayFull: 'Não há disponibilidade para {service} em {date}.',
        switchOffer: 'Deseja trocar o seu agendamento de {from} por {service}?',
        switchOfferDate: 'Deseja trocar o seu agendamento de {from} por {service} em {date}? Se sim, diga-me o horário que prefere.',
        switchOfferSlot: 'Deseja trocar o seu agendamento de {from} por {service} em {date} às {time}?',
        switchOfferOtherDate: 'Deseja trocar o seu agendamento de {from} por {service} para outra data?',
        changeOfferSlot: 'Deseja mudar o seu agendamento de {service} para {date} às {time}?',
        changeOfferDate: 'Deseja mudar o seu agendamento de {service} para {date}? Se sim, diga-me o horário que prefere.',
        draftStays: 'O seu agendamento de {service} continua em andamento, como estava (ainda sem confirmação).',
        servicesHeader: 'Estes são nossos serviços:',
        servicesFooter: 'Qual deles interessa a você?',
        slotsAvailable: 'Horários disponíveis para {service} em {date}: {slots}. Qual horário prefere?',
        noAvailability: 'Sem disponibilidade em {date}. Gostaria de tentar outra data?',
        slotUnavailable: 'O horário das {time} não está disponível. Horários disponíveis: {slots}. Qual funciona para você?',
        slotSuggest: 'O horário das {time} não está disponível. Recomendo {suggestion}. Serve para você?',
        slotSuggestMany: 'O horário das {time} não está disponível. Recomendo {suggestion}. Qual serve para você?',
        slotSuggestOr: 'ou',
        slotSuggestItem: 'as {t}',
        schedulingUnavailable: 'Ainda não temos a agenda disponível por aqui. Vou encaminhar você para alguém da equipe para combinar seu horário.',
        bookingFailedHandoff: 'Não consegui concluir o agendamento por aqui. Vou encaminhar você para alguém da equipe para confirmar com você.',
        askName: '{time} selecionado para {service}. Qual é seu nome completo?',
        askEmail: 'Obrigado {name}! Preciso do seu e-mail para o convite do calendário.',
        confirmPrompt: 'Por favor confirme:\n{summary}\nAgendar?',
        confirmShort: 'Confirmo o agendamento? Responda sim ou não.',
        confirmButton: 'Confirmar agendamento?\n\n{summary}',
        btnConfirm: 'Confirmar',
        btnCancel: 'Cancelar',
        booked: 'Agendamento confirmado!\nServiço: {service}\nData: {date} às {time}\nNome: {name}\nMais alguma coisa?',
        bookingError: 'Erro ao criar agendamento: {error}. Tentar outro horário?',
        askDate: 'Qual data gostaria para {service}?',
        whichTime: 'Qual horário? {slots}',
        whichName: 'Qual é seu nome completo?',
        whichEmail: 'Qual é seu e-mail?',
        minutes: 'minutos',
        flexibleTime: 'horário livre',
        flowHeader: 'Agende seu horário',
        flowBody: 'Toque no botão para escolher serviço, data e horário em um só passo.',
        flowCta: 'Agendar',
    },
    fr: {
        bookingPrice: "Prix : {amount}",
        servicePriceExample: "prix à confirmer",
        servicePriceQuote: "sur devis",
        bookingPriceToConfirm: "Prix : à confirmer par l'entreprise",
        bookingPriceQuote: "Prix : sur devis, selon le cas",
        bookingDuration: 'Durée réservée : {minutes} minutes',
        bookingLocation: 'Lieu : {location}',
        bookingOnline: 'En ligne',
        bookingPaymentDue: "Paiement pour confirmer : {amount}",
        bookingPending: "Votre demande de rendez-vous pour {service} le {date} à {time} est enregistrée et attend une confirmation.",
        bookingAwaitingPayment: "Le rendez-vous pour {service} le {date} à {time} attend le paiement de {amount}. Le créneau est retenu temporairement ; la confirmation suivra le paiement vérifié.",
        serviceSelected: '{service} sélectionné. Quelle date vous convient ?',
        switchedService: 'Changé pour {service}. Quelle date vous convient ?',
        cancelled: 'Pas de problème ! Puis-je vous aider avec autre chose ?',
        resumeOffer: 'Un rendez-vous pour {service} est resté à moitié planifié. Voulez-vous continuer ou recommencer ?',
        resumeOfferNoService: 'Un rendez-vous est resté à moitié planifié. Voulez-vous continuer ou recommencer ?',
        resumeDiscarded: "C'est noté, j'ai mis cette réservation de côté. Comment puis-je vous aider ?",
        switchDeclined: 'Très bien, votre rendez-vous en cours pour {service} reste tel quel.',
        switchDuration: '{service} dure {minutes} minutes.',
        switchDurationRange: '{service} dure entre {min} et {max} minutes.',
        switchDurationOpen: '{service} a une durée flexible.',
        switchPrice: 'Le prix de {service} est de {amount}.',
        switchPriceNote: 'À propos du prix de {service} : {note}.',
        switchSlotFree: 'Oui, il y a de la disponibilité le {date} à {time} pour {service}.',
        switchSlotTaken: "Il n'y a pas de disponibilité pour {service} le {date} à {time}. Créneaux disponibles : {slots}.",
        switchDayFree: 'Le {date}, il y a de la disponibilité pour {service} : {slots}.',
        switchDayFull: "Il n'y a pas de disponibilité pour {service} le {date}.",
        switchOffer: 'Souhaitez-vous remplacer votre rendez-vous pour {from} par {service} ?',
        switchOfferDate: "Souhaitez-vous remplacer votre rendez-vous pour {from} par {service} le {date} ? Si oui, indiquez-moi l'horaire souhaité.",
        switchOfferSlot: 'Souhaitez-vous remplacer votre rendez-vous pour {from} par {service} le {date} à {time} ?',
        switchOfferOtherDate: 'Souhaitez-vous remplacer votre rendez-vous pour {from} par {service} pour une autre date ?',
        changeOfferSlot: 'Souhaitez-vous déplacer votre rendez-vous pour {service} au {date} à {time} ?',
        changeOfferDate: "Souhaitez-vous déplacer votre rendez-vous pour {service} au {date} ? Si oui, indiquez-moi l'horaire souhaité.",
        draftStays: 'Votre rendez-vous pour {service} reste en cours, tel quel (pas encore confirmé).',
        servicesHeader: 'Voici nos services :',
        servicesFooter: 'Lequel vous intéresse ?',
        slotsAvailable: 'Créneaux disponibles pour {service} le {date} : {slots}. Quel horaire préférez-vous ?',
        noAvailability: 'Pas de disponibilité le {date}. Souhaitez-vous essayer une autre date ?',
        slotUnavailable: 'Le créneau de {time} n\'est pas disponible. Créneaux disponibles : {slots}. Lequel vous convient ?',
        slotSuggest: 'Le créneau de {time} n\'est pas disponible. Je vous recommande {suggestion}. Cela vous convient-il ?',
        slotSuggestMany: 'Le créneau de {time} n\'est pas disponible. Je vous recommande {suggestion}. Lequel vous convient ?',
        slotSuggestOr: 'ou',
        slotSuggestItem: '{t}',
        schedulingUnavailable: 'La prise de rendez-vous n\'est pas encore disponible par ici. Je vous mets en relation avec une personne de l\'équipe pour organiser votre rendez-vous.',
        bookingFailedHandoff: 'Je n\'ai pas pu finaliser la réservation par ici. Je vous mets en relation avec une personne de l\'équipe pour la confirmer avec vous.',
        askName: '{time} sélectionné pour {service}. Quel est votre nom complet ?',
        askEmail: 'Merci {name} ! J\'ai besoin de votre e-mail pour l\'invitation du calendrier.',
        confirmPrompt: 'Veuillez confirmer :\n{summary}\nJe réserve ?',
        confirmShort: 'Je confirme le rendez-vous ? Répondez oui ou non.',
        confirmButton: 'Confirmer le rendez-vous ?\n\n{summary}',
        btnConfirm: 'Confirmer',
        btnCancel: 'Annuler',
        booked: 'Rendez-vous confirmé !\nService : {service}\nDate : {date} à {time}\nNom : {name}\nAutre chose ?',
        bookingError: 'Erreur lors de la création : {error}. Essayer un autre horaire ?',
        askDate: 'Quelle date souhaitez-vous pour {service} ?',
        whichTime: 'Quel horaire ? {slots}',
        whichName: 'Quel est votre nom complet ?',
        whichEmail: 'Quel est votre e-mail ?',
        minutes: 'minutes',
        flexibleTime: 'horaire libre',
        flowHeader: 'Réservez votre rendez-vous',
        flowBody: 'Touchez le bouton pour choisir service, date et heure en une étape.',
        flowCta: 'Réserver',
    },
};

/** The message asks what a service costs (already folded: lowercase, no accents). */
const PRICE_QUESTION = /\b(?:cuanto (?:cuesta|vale|cobran|sale)|how much|quanto custa|combien|precio|price)\b/;

const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.]+/;

/**
 * The shape of an answer to "¿cuál es su nombre?": "Me llamo Carlos Barba", "soy Ana", or one to three
 * capitalised words. Such a message is a name even when a word of it is also the name of a service.
 */
function looksLikeNameAnswer(raw: string): boolean {
    const text = raw.trim().replace(/[.,!;:]+$/g, '');
    if (/^(?:me llamo|mi nombre es|mi nombre completo es|soy|i am|i'm|my name is|je m'appelle|je suis|meu nome [eé]|me chamo|sou)\s+\S/iu.test(text)) return true;
    return /^\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){0,2}$/u.test(text);
}

/** "sábado 10 de octubre": how the customer reads a date, from the ISO day the engine keeps. */
function friendlyDate(lang: string, iso: string): string {
    try {
        return new Intl.DateTimeFormat((lang || 'es').slice(0, 2), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
            .format(new Date(`${iso}T00:00:00Z`)).replace(',', '');
    } catch {
        return iso;
    }
}

/** Get message in the given language, with variable substitution */
function msg(lang: string, key: string, vars: Record<string, string> = {}): string {
    const langCode = (lang || 'es').substring(0, 2).toLowerCase();
    const msgs = MESSAGES[langCode] || MESSAGES['es'];
    const val = msgs[key] || MESSAGES['es'][key] || key;
    
    let text = '';
    if (Array.isArray(val)) {
        const idx = Math.floor(Math.random() * val.length);
        text = val[idx];
    } else {
        text = val;
    }

    for (const [k, v] of Object.entries(vars)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return text;
}

/**
 * Un importe agrupado como lo escribe quien lo está leyendo.
 *
 * Estaba fijo en `es-CO`, así que un precio mexicano confirmado en MXN salía
 * con los separadores colombianos: el número y su moneda contaban dos historias
 * distintas en la misma línea. La agrupación sigue al idioma de la
 * conversación, que es el único dato de locale que este motor tiene en la mano
 * (el mismo que alimenta `msg()`).
 *
 * `useGrouping: 'always'` es necesario: el CLDR del `es` genérico no agrupa
 * números de cuatro dígitos (`minimumGroupingDigits = 2`), así que 1500 saldría
 * "1500" y se lee como un código, no como un precio. El cast existe porque la
 * lib de TS de este target todavía tipa `useGrouping` como booleano.
 */
const PRICE_GROUPING_OPTIONS = {
    maximumFractionDigits: 2,
    useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions;

export function formatPriceAmount(lang: string, value: unknown): string {
    // `Number(null)` y `Number('')` valen 0, y un 0 en una línea de precio dice
    // "gratis". Ausencia de número no es cero: es no tener nada que decir.
    if (value === null || value === undefined || value === '') return '';
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '';
    const langCode = (lang || 'es').substring(0, 2).toLowerCase();
    const locale = MESSAGES[langCode] ? langCode : 'es';
    try {
        return new Intl.NumberFormat(locale, PRICE_GROUPING_OPTIONS).format(amount);
    } catch {
        // Un ICU recortado no puede tumbar una reserva: el número crudo es
        // menos legible pero sigue siendo el número correcto.
        return String(amount);
    }
}

/**
 * "80.000 MXN", o "80.000" a secas cuando la fila no tiene moneda.
 *
 * Sin moneda no se inventa una: una fila sembrada antes de que el negocio
 * declarara su país nace con `currency` en NULL, y concatenarlo produciría
 * "80.000 null" — o, peor, un código de otro país si alguien "rellenara" el
 * hueco. El número desnudo es incómodo; el número con la moneda equivocada es
 * una cifra que el cliente puede terminar pagando.
 */
export function formatPriceWithCurrency(lang: string, value: unknown, currency?: string | null): string {
    const amount = formatPriceAmount(lang, value);
    if (!amount) return '';
    const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency.trim())
        ? currency.trim().toUpperCase()
        : '';
    return code ? `${amount} ${code}` : amount;
}

/**
 * Tool errors the booking flow can NOT recover from by itself:
 *  - `appointments_not_configured` → the tenant never loaded availability_slots,
 *    so every date will come back empty (ai-tool-executor.service.ts).
 *  - `tool_failed` → generic tool crash (DB down, bad schema…), same executor.
 * Answering "no availability, try another date" to these loops forever, so the
 * engine tells the truth and escalates to a human instead.
 */
const UNRECOVERABLE_TOOL_ERRORS = new Set(['appointments_not_configured', 'tool_failed', 'outside_business_hours']);
/** `appointment_subject_*`: the engine collects no listing/pet/vehicle, so it cannot repair these itself. */
const UNRECOVERABLE_TOOL_ERROR_PREFIXES = ['appointment_subject_'];

export interface BookingState {
    missionId?: string;
    step: 'idle' | 'show_services' | 'ask_date' | 'show_slots' | 'ask_name' | 'ask_email' | 'confirm' | 'booked' | 'waiting_flow';
    services?: Array<{ id: string; name: string; durationMinutes: number; durationMinutesMax?: number; durationType?: string; price: number | null; currency: string | null; priceStatus?: 'example' | 'confirmed' | 'quote'; requiresPaymentToConfirm?: boolean; amountDueToConfirm?: number | null; appointmentTerms?: AppointmentServiceTerms }>;
    serviceId?: string;
    serviceName?: string;
    date?: string;
    // `staffId`/`staffName` viajan por slot desde check_availability, que ya los
    // resuelve (ai-tool-executor: userIds -> nombres). El motor los descartaba al
    // quedarse solo con time/endTime, y create_appointment terminaba escribiendo
    // assigned_to = NULL en TODA reserva hecha por la ruta determinista — que es
    // la que usan justamente las verticales de agenda pura.
    slots?: Array<{ time: string; endTime: string; staffId?: string; staffName?: string }>;
    time?: string;
    /** Huecos recomendados porque la hora pedida no estaba libre; esperan un "sí" del cliente. */
    suggestedSlots?: Array<{ time: string; endTime: string; staffId?: string; staffName?: string }>;
    /** Profesional del slot elegido. Se persiste como `appointments.assigned_to`. */
    staffId?: string;
    staffName?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    appointmentId?: string;
    appointmentStatus?: string;
    payableReference?: string | null;
    /** ISO timestamp set when a WhatsApp Flow was sent; used to expire stale Flows (>1h). */
    flowStartedAt?: string;
    flowToken?: string;
    flowRevision?: number;
    /** Backend timestamp; a conversational pause does not discard the mission. */
    savedAt?: string;
    pausedAt?: string | null;
    resumedAfterExpiry?: boolean;
    /**
     * A mission left untouched past the continuity window is dormant: it is kept
     * but never consumes a message silently. `pending` = the customer has not
     * been asked yet; `offered` = the resume/discard question was sent;
     * `lapsed` = it went unanswered: it is not asked again until the customer
     * brings a booking datum, and until then the mission consumes nothing.
     */
    resumeOffer?: 'pending' | 'offered' | 'lapsed';
    /**
     * `question`: the mission was opened by a message that was a question ("¿cuánto dura X?"),
     * so it is an interest, not yet a booking. It becomes a real mission when the customer gives
     * a booking datum or answers with a statement; until then it expires instead of going dormant
     * and is never shown to the model or the customer as a pending reservation.
     */
    origin?: 'question';
    /** When the model last offered to book while the mission was tentative: a bare "ok" then accepts it. */
    offeredBookingAt?: string;
    /**
     * The customer ASKED about another service while this draft was open ("¿cuánto dura color y
     * tratamiento y tienen cupo el sábado a las 16:00?"). The engine answered and offered the change; the
     * draft itself is untouched. Only a yes right after the offer applies it; any other message drops it.
     */
    pendingSwitch?: { serviceId: string; serviceName: string; date?: string; time?: string; offeredAt: string };
    /**
     * Last real customer activity before the mission went dormant. Retention is
     * measured from here: `savedAt` is refreshed on every turn (even turns the
     * engine declines), so it cannot bound the life of a mission by itself.
     */
    dormantSince?: string;
    confirmationId?: string;
    confirmationHash?: string;
    confirmationIssuedAt?: string;
}

/** Revoking a proposal does not erase collected customer/service preferences. */
export function invalidateBookingProposal(state: BookingState): void {
    state.confirmationId = undefined;
    state.confirmationHash = undefined;
    state.confirmationIssuedAt = undefined;
    state.flowToken = undefined;
    state.flowRevision = undefined;
    state.flowStartedAt = undefined;
    if (state.step === 'waiting_flow') state.step = state.serviceId ? 'ask_date' : 'show_services';
}

export interface EngineResult {
    handled: boolean;
    state: BookingState;
    text?: string;
    /**
     * Writes this engine performed on its own, reported so the caller's output
     * guardrail can tell a real confirmation from an invented one.
     *
     * The engine calls `create_appointment` itself, outside the LLM tool loop, so
     * the turn's executed-tool list was empty and every truthful "your
     * appointment is booked" was audited as a false claim and rewritten to say
     * the booking was still pending — in front of a customer who had just been
     * booked.
     */
    executedTools?: Array<{ name: string; result: any }>;
    /**
     * The booking flow hit a dead end that only a human can solve (agenda never
     * configured, tool failure). Same contract as ProcedureEngineService: the
     * engine only FLAGS it, the caller runs HandoffService.executeHandoff().
     * `text` is always populated too, so a caller that ignores these fields still
     * gives the customer an honest answer instead of a "no availability" loop.
     */
    handoff?: boolean;
    handoffReason?: string;
    listMessage?: {
        body: string;
        buttonText: string;
        sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
    };
    buttonMessage?: {
        body: string;
        buttons: Array<{ id: string; title: string }>;
    };
    /**
     * Opt-in WhatsApp Flow to send instead of the text flow (one-step booking form).
     * Additive: `text` is ALWAYS populated too, so a disabled flag / non-WhatsApp
     * channel / send failure degrades to the text flow without any extra branching.
     */
    flowMessage?: {
        headerText?: string;
        body: string;
        footerText?: string;
        flowCta?: string;
        initialScreen?: string;
        initialData?: Record<string, unknown>;
    };
}

@Injectable()
export class BookingEngineService {
    private readonly logger = new Logger(BookingEngineService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private toolExecutor: AIToolExecutorService,
    ) {}

    /** Reuses this engine with request-scoped boundaries; never rewires a singleton. */
    forExecution(ports: { redis: RedisService; toolExecutor: AIToolExecutorService }): BookingEngineService {
        return new BookingEngineService(this.prisma, ports.redis, ports.toolExecutor);
    }

    /**
     * Process using INTERPRETED intent (not raw text).
     */
    async process(
        schemaName: string,
        tenantId: string,
        contactId: string,
        intent: InterpretedIntent,
        rawText: string,
        currentState: BookingState,
        customerProfile: { name?: string; email?: string; phone?: string },
        todayDate: string,
        language: string = 'es',
        turn: BookingTurnContext,
    ): Promise<EngineResult> {
        const isOpen = (s: BookingState) => !!s.step && !['idle', 'booked'].includes(s.step);
        const wasOpen = isOpen(currentState);
        // "Solo consulto": information only. It never changes, starts or confirms a booking, so an
        // open mission (a draft the customer was building for another service) is left untouched.
        // The model answers next, so an offer the engine made last turn is no longer what a bare yes answers.
        if (isOnlyInquiry(rawText)) return { handled: false, state: currentState.pendingSwitch ? { ...currentState, pendingSwitch: undefined } : currentState };
        const tentativeOpen = wasOpen && currentState.origin === 'question';
        const offeredAt = Date.parse(currentState.offeredBookingAt || '');
        const offerLive = tentativeOpen && Number.isFinite(offeredAt) && Date.now() - offeredAt >= 0 && Date.now() - offeredAt <= BOOKING_OFFER_TTL_MS;
        const act = bookingActKind(rawText, intent, currentState.step, { tentative: tentativeOpen, offerLive });
        // TENTATIVE mission (opened without a booking act, e.g. "¿cuánto dura color y tratamiento?"):
        // the engine stays out of the way. It becomes real only through a booking act (a date or
        // time, a clear yes, a service picked from the list, name/email, an explicit request);
        // thanks, greetings, a bare "ok" or an unrelated question leave it tentative and silent, and
        // a refusal ("no gracias") drops it. The model answers and offers the booking.
        if (wasOpen && currentState.origin === 'question') {
            if (act === 'refusal') return { handled: false, state: { step: 'idle' } };
            if (act === 'none') return { handled: false, state: { ...currentState, offeredBookingAt: undefined } };
        }
        const entering: BookingState = currentState.origin || currentState.offeredBookingAt ? { ...currentState, origin: undefined, offeredBookingAt: undefined } : currentState;
        // A draft the customer built (not an interest the engine opened for a question) is theirs to change.
        const result = await this.processCore(schemaName, tenantId, contactId, intent, rawText, entering,
            customerProfile, todayDate, language, turn, wasOpen && currentState.origin !== 'question');
        if (!isOpen(result.state)) { result.state.origin = undefined; result.state.offeredBookingAt = undefined; result.state.pendingSwitch = undefined; return result; }
        // Only a mission OPENED by this message can be tentative; one the customer already
        // confirmed (act) or that was real before stays real.
        const tentative = !wasOpen && act !== 'act';
        result.state.origin = tentative ? 'question' : undefined;
        result.state.offeredBookingAt = undefined;
        // The engine's next-step prompt ("Perfecto, agendaremos...") asserts a booking the customer
        // only asked about. For a tentative mission the model answers the question with its tools
        // and offers the booking; the engine says nothing.
        if (tentative && result.handled && !result.handoff && !result.flowMessage
            && result.state.step === 'ask_date' && !result.state.date) {
            return { ...result, handled: false, text: undefined };
        }
        // A real request that also asks how long or how much: the engine speaks (it asks for the
        // date), so give the voice the facts it already has instead of dropping the question.
        if (!tentative && result.handled && result.text && result.state.step === 'ask_date' && !result.state.date) {
            const note = this.serviceFactsNote(result.state, rawText, language);
            if (note) return { ...result, text: `${result.text} ${note}` };
        }
        return result;
    }

    /**
     * The duration / confirmed price the customer asked for, as a plain sentence for the voice that
     * phrases the reply (price already formatted, so no raw "120000 COP" is copied).
     */
    private serviceFactsNote(state: BookingState, rawText: string, lang: string): string {
        const svc = state.services?.find(s => s.id === state.serviceId);
        if (!svc) return '';
        const parts: string[] = [];
        if (asksDuration(rawText) && svc.durationMinutes) parts.push(`${svc.name} lasts ${svc.durationMinutes} minutes`);
        const asksPrice = PRICE_QUESTION.test(normalizeForIntent(rawText));
        if (asksPrice && Number(svc.price) > 0 && (!svc.priceStatus || svc.priceStatus === 'confirmed')) {
            parts.push(`its price is ${formatPriceWithCurrency(lang, svc.price, svc.currency)}`);
        }
        return parts.length ? `The customer also asked about the service: ${parts.join(' and ')}. Answer that in your own words along with the next step.` : '';
    }

    private async processCore(
        schemaName: string,
        tenantId: string,
        contactId: string,
        intent: InterpretedIntent,
        rawText: string,
        currentState: BookingState,
        customerProfile: { name?: string; email?: string; phone?: string },
        todayDate: string,
        language: string = 'es',
        turn: BookingTurnContext,
        liveDraft = false,
    ): Promise<EngineResult> {
        // ═══ LA AUTORIDAD ES UN PARÁMETRO, NO UN DETALLE OPCIONAL ═══
        //
        // Este motor escribe citas POR FUERA del bucle de tools, así que
        // filtrar la lista de tools del turno nunca lo alcanzó. Antes recibía
        // sólo `conversationId` y llamaba al ejecutor sin decir con qué
        // permiso: era el camino por el que un perfil bloqueado seguía
        // agendando. Ahora la autoridad viaja junto con el turno y el ejecutor
        // la exige.
        const { authority, flowCapable = false, flowData, conversationId } = turn;
        const state = { ...currentState };
        if (turn.startSelected && state.step === 'idle' && (!intent.intent || intent.intent === 'unknown')) intent = { ...intent, intent: 'ask_availability' };
        state.missionId ||= turn.missionScope?.missionId || randomUUID();
        const L = language; // shorthand for msg() calls
        const domains = mentionedMissionDomains(rawText);
        const active = !['idle', 'booked'].includes(state.step);
        // A draft the customer built (not a tentative interest, not paused) is theirs to change: a question
        // about another service, or about another day, never rewrites it. A dormant draft counts too: the
        // customer who comes back with such a question gets the same offer instead of a silent switch.
        const draftIsLive = liveDraft && active && !state.pausedAt;
        const draftWasDormant = !!state.resumeOffer || !!state.resumedAfterExpiry;
        // The answer to the switch offer made last turn. Any message that is not a clear yes/no drops the
        // offer (a "no" must not read as cancelling the whole draft, and a later yes must not revive it).
        let acceptedSwitch: NonNullable<BookingState['pendingSwitch']> | undefined;
        if (state.pendingSwitch) {
            const pending = state.pendingSwitch;
            state.pendingSwitch = undefined;
            const age = Date.now() - Date.parse(pending.offeredAt);
            const answer = draftIsLive && !draftWasDormant && Number.isFinite(age) && age >= 0 && age <= BOOKING_OFFER_TTL_MS
                ? answerToOffer(rawText, intent) : null;
            if (answer === 'yes') acceptedSwitch = pending;
            if (answer === 'no') {
                const back = this.repromptCurrentStep(state, L);
                return back.handled ? { ...back, text: `${msg(L, 'switchDeclined', { service: state.serviceName || '' })} ${back.text ?? ''}`.trim() } : { handled: false, state };
            }
        }
        // An informational question (hours, price, services, address, policy) is
        // not a step of the open mission: the engine has no tool to answer it and
        // used to re-prompt the step instead. Leave it to the model with its
        // tools; the mission, dormant or not, is returned untouched.
        if (active && isInformationalDetour(rawText, intent, state.step)) {
            this.logger.log(`[Decide] Informational question mid-mission, letting the LLM answer (booking state preserved: ${state.step})`);
            // The model speaks next: a bare yes/no after its answer must not be
            // read as the reply to a resume offer that is no longer the last message.
            if (state.resumeOffer === 'offered') state.resumeOffer = 'pending';
            return { handled: false, state };
        }
        if (active && state.resumeOffer && bookingEngineAuthorityDecision(authority).allowed && !isPauseMessage(rawText)) {
            const dormant = this.decideDormantMission(state, intent, rawText, L);
            if (dormant) return dormant;
        }
        if (active && containsMissionDirective(rawText) && domains.length > 1) {
            return { handled: true, state, text: missionDialogue(L, 'clarify') };
        }
        if (active && intent.intent === 'cancel' && !isCollectionCancellation(rawText)
            || active && containsMissionDirective(rawText) && !isDirectedCorrection(rawText)
                && domains.length > 0 && !domains.includes('appointment')) {
            state.pausedAt ||= new Date().toISOString();
            invalidateBookingProposal(state);
            return { handled: false, state };
        }
        if (!['idle', 'booked'].includes(state.step) && isPauseMessage(rawText)) {
            state.pausedAt = new Date().toISOString();
            invalidateBookingProposal(state);
            return { handled: true, state, text: procedureDialogueMessages(L).paused };
        }
        if (state.pausedAt) {
            const namedResume = isNamedMissionResume(rawText) && domains.length === 1 && domains[0] === 'appointment';
            if (!turn.resumeSelected && !namedResume && !isResumeMessage(rawText) && intent.intent !== 'cancel') return { handled: false, state };
            state.pausedAt = null;
            if (turn.resumeSelected || namedResume || isResumeMessage(rawText)) {
                invalidateBookingProposal(state);
                return this.repromptCurrentStep(state, L);
            }
        }
        // Defense in depth: the orchestrator checks this before entering the
        // engine, and the engine checks again before reading cached services or
        // collecting customer data. A stale appointments toggle must not start a
        // flow whose `create_appointment` is absent from the effective contract.
        const bookingAuthority = bookingEngineAuthorityDecision(authority);
        if (!bookingAuthority.allowed) {
            const activeFlow = !!state.step && !['idle', 'booked'].includes(state.step);
            // With a draft open, only a customer who is pushing to book or confirm is handed to a person:
            // thanks, a lone e-mail or name, a greeting or a question about the business go to the model,
            // which answers (and may offer a person) without a transfer nobody asked for.
            const bookingRequested = activeFlow
                ? isPushingToBook(rawText, intent) || deniedOperationalIntent(rawText) === 'booking'
                : deniedOperationalIntent(rawText) === 'booking'
                    || ['ask_availability', 'select_service', 'select_time', 'confirm'].includes(intent.intent);
            if (bookingRequested) {
                return this.escalateToHuman(
                    state,
                    L,
                    'schedulingUnavailable',
                    `booking_not_authorised:${bookingAuthority.reason || 'unknown'}`,
                );
            }
            return { handled: false, state };
        }
        // D3 fix: stale PG booking state (age <=1h) can resucitar ask_name with date vencida.
        // Validar state.date antes de cualquier intent; si ya pasó, resetear a ask_date.
        if (state.date && state.date < todayDate) {
            this.logger.log(`[Engine] Discarding stale state.date ${state.date} < ${todayDate} → reset to ask_date`);
            state.date = undefined;
            state.time = undefined;
            (state as any).slots = undefined; state.suggestedSlots = undefined;
            if (state.step && state.step !== 'idle' && state.step !== 'show_services') {
                state.step = 'ask_date';
            }
        }
        // Per-turn signal (NOT persisted): set when the user asks for a time with
        // no nearby available slot, consumed later this same turn. Previously this
        // lived on `state` and leaked into Redis/PG, firing a stale "time
        // unavailable" message on later turns.
        let requestedUnavailableTime: string | undefined;

        // ── Reload services fresh on EVERY process() call ──────────────────────────────────
        // We ALWAYS overwrite state.services from the tenantId-scoped cache or DB.
        // We never trust state.services from the persisted conversation state because
        // it could be hours old (created before the admin deactivated/edited a service).
        // The booking:services:{tenantId} cache has a 5min TTL and is invalidated
        // immediately when any service is created/updated/deleted from the panel.
        const cacheKey = `booking:services:${tenantId}`;
        try {
            const cached = await this.redis.get(cacheKey);
            if (cached) {
                state.services = JSON.parse(cached);
                this.logger.debug(`[Engine] Services loaded from cache (${state.services?.length ?? 0} active)`);
            } else {
                const result = await this.toolExecutor.execute(
                    schemaName, tenantId, contactId, 'list_services', {},
                    conversationId, { authority },
                );
                if (result?.services?.length) {
                    state.services = result.services;
                    await this.redis.set(cacheKey, JSON.stringify(result.services), 300); // 5 min TTL
                } else if (result?.error) {
                    // The tool FAILED (it didn't answer "there are no services"). Wiping
                    // the list would make the engine act as if the tenant sold nothing;
                    // keep whatever we had, same as the catch below.
                    this.logger.warn(`[Engine] list_services failed (${result.error}) — keeping previous services`);
                } else {
                    state.services = [];
                }
                this.logger.debug(`[Engine] Services reloaded from DB (${state.services?.length ?? 0} active)`);
            }
        } catch (err: any) {
            this.logger.warn(`[Engine] Failed to reload services (non-fatal): ${err.message}`);
            // Keep previous state.services as last resort — better than crashing
        }

        // ── The customer agreed to the service switch we offered ──
        // Their yes is the consent: the draft moves to the other service and the slot is checked again
        // for it (what was free a moment ago is not evidence), never booked from the earlier peek.
        if (acceptedSwitch) {
            const target = state.services?.find(s => s.id === acceptedSwitch!.serviceId);
            if (target) {
                const date = [intent.dateMentioned, acceptedSwitch.date].find(d => !!d && d >= todayDate) || undefined;
                // "sí, pero el domingo": a different day without an hour of its own does not inherit the hour
                // that was offered for the old one.
                const newDay = !!intent.dateMentioned && intent.dateMentioned !== acceptedSwitch.date;
                const time = intent.timeMentioned ?? (newDay ? undefined : acceptedSwitch.time);
                this.logger.log(`[Decide] Customer accepted the offered change (${target.id === state.serviceId ? 'day/hour' : `switch to ${target.name}`})`);
                Object.assign(state, {
                    serviceId: target.id, serviceName: target.name, date, slots: undefined, suggestedSlots: undefined,
                    time: undefined, staffId: undefined, staffName: undefined,
                });
                invalidateBookingProposal(state);
                if (!date) {
                    state.step = 'ask_date';
                    return { handled: true, state, text: msg(L, 'switchedService', { service: target.name }) };
                }
                return this.checkAvailability(schemaName, tenantId, contactId, state, L, authority, conversationId, time);
            }
        }

        // ── A QUESTION about another service while a draft is open: answer it, offer the change ──
        // "¿Cuánto dura color y tratamiento y tienen cupo el sábado a las 16:00?" with a draft for
        // another service is not a change of mind: the date and time belong to the question. The draft
        // stays as the customer built it until they agree to move it.
        let serviceSwitchOrdered = false;
        if (draftIsLive) {
            const offered = await this.offerServiceSwitch(schemaName, tenantId, contactId, state, intent, rawText, L, todayDate, authority, conversationId);
            if (offered) return offered;
            // An ORDER to change service ("mejor cámbiala a X", "quiero X el sábado a las 16:00"): at the late
            // steps the interpreter does not read service names, so hand it the one found by full name. The
            // text is the order, not a name or e-mail answer, and not a correction of a slot.
            const ordered = this.directSwitchTarget(state, intent, rawText);
            if (ordered) {
                intent = {
                    ...intent, serviceMentioned: ordered.name, nameProvided: null, isConfirmation: false,
                    intent: ['unknown', 'provide_info', 'general_question', 'confirm'].includes(intent.intent) ? 'select_service' : intent.intent,
                };
                serviceSwitchOrdered = true;
            }
        }

        // ── Directed correction of a collected slot ("el correo es x@y.com", "cambia la hora a las 5") ──
        // After the service check: "cambia mi cita a color y tratamiento" is a switch, not a slot to correct.
        if (active && !serviceSwitchOrdered && isDirectedCorrection(rawText)) {
            const correction = parseDirectedSlotCorrection(rawText, [
                { field: 'customerName', type: 'name' }, { field: 'customerEmail', type: 'email' },
                { field: 'customerPhone', type: 'phone' }, { field: 'date', type: 'date' }, { field: 'time', type: 'time' },
            ]);
            const type = correction?.field === 'customerName' ? 'name' : correction?.field === 'customerEmail' ? 'email'
                : correction?.field === 'customerPhone' ? 'phone' : 'string';
            const value = correction ? coerceProcedureSlot(correction.value, type) : null;
            const temporalValid = correction?.field === 'date' ? /^\d{4}-\d{2}-\d{2}$/.test(correction.value) && correction.value >= todayDate
                : correction?.field === 'time' ? /^([01]\d|2[0-3]):[0-5]\d$/.test(correction.value) : true;
            if (!correction || !value?.ok || !temporalValid) return { handled: true, state, text: missionDialogue(L, 'invalidCorrection') };
            (state as any)[correction.field] = value.value;
            invalidateBookingProposal(state);
            if (correction.field === 'date') { state.time = undefined; state.slots = undefined; state.suggestedSlots = undefined; state.staffId = undefined; state.staffName = undefined; }
            if (correction.field === 'date' || correction.field === 'time') {
                // Revalidate availability on a later selection turn, never book
                // merely because this correction contains a previously valid time.
                state.step = 'ask_date';
                return { handled: true, state, text: missionDialogue(L, 'correction') };
            }
            return { ...this.repromptCurrentStep(state, L), handled: true };
        }

        // ── Incoming WhatsApp Flow completion (opt-in) ──
        // The customer submitted the one-step Flow form; its fields arrived parsed in
        // `flowData`. Hydrate the state and reuse the SAME createBooking() path as the
        // text flow (the double-booking guard is included there). Missing/expired/
        // malformed data abandons the Flow and resumes the text flow gracefully.
        let flowJustAbandoned = false;
        if (state.step === 'waiting_flow') {
            const expired = !!state.flowStartedAt
                && (Date.now() - Date.parse(state.flowStartedAt)) > 3_600_000;
            const validFlowBinding = !!state.flowToken && turn.flowResponseToken === state.flowToken
                && (!turn.missionScope || state.missionId === turn.missionScope.missionId && state.flowRevision === turn.missionScope.revision);
            if (rawText === '__flow_response__' && state.flowToken && !expired && !validFlowBinding) {
                return { handled: true, state, text: missionDialogue(L, 'clarify') };
            }
            if (rawText === '__flow_response__' && flowData && !expired && validFlowBinding) {
                const pick = (...keys: string[]): string => {
                    for (const k of keys) {
                        const v = (flowData as any)[k];
                        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
                    }
                    return '';
                };
                const svcId = pick('service_id', 'serviceId', 'service');
                const svc = state.services?.find(s => s.id === svcId);
                state.serviceId = svc?.id || svcId || state.serviceId;
                state.serviceName = svc?.name || pick('service_name', 'serviceName') || state.serviceName;
                state.date = pick('date', 'booking_date', 'appointment_date');
                state.time = pick('time', 'booking_time', 'appointment_time');
                state.customerName = pick('customer_name', 'name', 'full_name') || customerProfile.name || '';
                state.customerEmail = pick('customer_email', 'email') || customerProfile.email || '';
                state.customerPhone = customerProfile.phone;
                const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(state.date || '');
                const timeOk = /^\d{2}:\d{2}$/.test(state.time || '');
                // Require: a service that resolves to a REAL one (svc), valid date/time
                // FORMAT, a non-past date, and contact info. A stale/unknown service_id
                // would otherwise reach createBooking and yield a hard "service not found".
                if (svc && dateOk && timeOk && (state.date as string) >= todayDate && state.customerName && state.customerEmail) {
                    // The static Flow's date/time pickers are UNCONSTRAINED, so re-validate
                    // the chosen slot against REAL availability (business hours, blocked
                    // dates, staff schedule) — the same guard the text flow applies at
                    // show_slots. Without this, a closed/out-of-hours slot books blindly.
                    const avail = await this.toolExecutor.execute(
                        schemaName, tenantId, contactId, 'check_availability',
                        { date: state.date, serviceId: state.serviceId, ...(state.time ? { time: state.time } : {}) },
                        conversationId, { authority },
                    );
                    // Dead end (agenda not configured / tool failure): re-asking for a
                    // date would loop, so be honest and hand over to a human.
                    const availFatal = this.unrecoverableToolError(avail);
                    if (availFatal) {
                        return this.escalateToHuman(state, L, 'schedulingUnavailable', `booking_unavailable:${availFatal}`);
                    }
                    const realSlots: Array<{ time: string; endTime: string }> = (avail?.available && avail.slots?.length) ? avail.slots : [];
                    if (realSlots.some(s => s.time === state.time)) {
                        state.step = 'confirm';
                        state.flowStartedAt = undefined;
                        return this.createBooking(
                            schemaName,
                            tenantId,
                            contactId,
                            state,
                            L,
                            conversationId,
                            authority,
                            'flow_response',
                        );
                    }
                    // The picked slot isn't actually bookable → show the real availability
                    // in text so the customer chooses a valid one (or is asked for a new date).
                    this.logger.warn(`[Engine] Flow slot ${state.date} ${state.time} not available — showing real slots`);
                    state.flowStartedAt = undefined;
                    return this.checkAvailability(schemaName, tenantId, contactId, state, L, authority, conversationId, state.time);
                }
                // Flow returned incomplete/invalid/past/unknown-service data → restart in text.
                this.logger.warn('[Engine] Flow response incomplete/invalid — falling back to text flow');
                Object.assign(state, { step: 'idle', flowStartedAt: undefined });
                return this.showServices(state, L);
            }
            // The sentinel arrived but the Flow expired (>1h) → recover in text rather than
            // leaking '__flow_response__' to the LLM. If instead the user typed real text,
            // resume the text flow and don't re-offer the Flow this turn (avoid a loop).
            if (rawText === '__flow_response__') {
                Object.assign(state, { step: 'idle', flowStartedAt: undefined });
                return this.showServices(state, L);
            }
            Object.assign(state, { step: 'idle', flowStartedAt: undefined });
            flowJustAbandoned = true;
        }

        // Safety net: a Flow response whose booking state was already lost (both the
        // Redis and PG backups expired, >1h) skips the waiting_flow branch entirely;
        // recover in text instead of forwarding the raw sentinel to the LLM.
        if (rawText === '__flow_response__' && state.step !== 'waiting_flow') {
            Object.assign(state, { step: 'idle', flowStartedAt: undefined });
            return this.showServices(state, L);
        }

        // ── Re-booking after a completed booking ──
        // step='booked' is a terminal state; without this a fresh booking intent
        // would never be handled by the engine again (it returns handled:false
        // forever at the booked guard below). Reset to idle so the new flow runs
        // clean and the customer can book a second appointment.
        if (state.step === 'booked') {
            const wantsNewBooking = intent.intent === 'ask_availability'
                || intent.intent === 'select_service'
                || !!intent.serviceMentioned
                || !!intent.dateMentioned;
            if (wantsNewBooking) {
                Object.assign(state, { step: 'idle', serviceId: undefined, serviceName: undefined, date: undefined, slots: undefined, suggestedSlots: undefined, time: undefined });
                this.logger.log('[Decide] New booking intent after a completed booking — resetting to idle');
            }
        }

        // ── Opt-in WhatsApp Flow: offer the one-step form at the START of booking ──
        // Only when step is idle (booking start) so we never yank a customer out of an
        // in-progress text flow, and only on a real booking intent. `text` is populated
        // as the fallback body, so a send failure / disabled flag degrades to text.
        if (flowCapable && !flowJustAbandoned && state.step === 'idle' && state.services?.length) {
            const wantsBooking = intent.intent === 'ask_availability'
                || intent.intent === 'select_service'
                || !!intent.serviceMentioned
                || !!intent.dateMentioned;
            if (wantsBooking) {
                state.step = 'waiting_flow';
                state.flowStartedAt = new Date().toISOString();
                state.flowToken = randomUUID();
                state.flowRevision = turn.missionScope?.revision ?? 0;
                return {
                    handled: true,
                    state,
                    text: msg(L, 'flowBody'),
                    flowMessage: {
                        headerText: msg(L, 'flowHeader'),
                        body: msg(L, 'flowBody'),
                        flowCta: msg(L, 'flowCta'),
                        initialScreen: 'SERVICE_SELECTION',
                        initialData: {
                            available_services: state.services.map(s => ({
                                id: s.id,
                                name: s.name,
                                duration: String(s.durationMinutes ?? ''),
                                // The Flow screen prints whatever it gets: an
                                // unconfirmed price is sent as nothing at all.
                                price: s.priceStatus && s.priceStatus !== 'confirmed' ? '' : String(s.price ?? ''),
                                currency: s.currency ?? '',
                            })),
                            language: L,
                        },
                    },
                };
            }
        }

        // ── Numeric/ordinal service selection: "El 1", "el primero", "la segunda"... ──
        // Runs AFTER services are loaded. Overrides intent when the user picks by index.
        // This runs in the engine (not only in the intent interpreter) so it also covers
        // the case where the interpreter already ran with the OLD step before this refresh.
        if (state.services?.length && !intent.serviceMentioned && state.step === 'show_services') {
            const tNorm = rawText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
            // "El 1", "la 2", "opcion 3", "numero 1", "#2"
            const numMatch = tNorm.match(/(?:el|la|opcion|numero|el numero|la opcion|quiero el|quiero la|#)\s*(\d+)/);
            if (numMatch) {
                const idx = parseInt(numMatch[1]) - 1;
                if (idx >= 0 && idx < state.services.length) {
                    intent.serviceMentioned = state.services[idx].name;
                    intent.intent = 'select_service';
                }
            }
            // Bare number: "1", "2" — only in show_services step to avoid false positives
            if (!intent.serviceMentioned && (state.step === 'show_services') && /^\d+$/.test(tNorm)) {
                const idx = parseInt(tNorm) - 1;
                if (idx >= 0 && idx < state.services.length) {
                    intent.serviceMentioned = state.services[idx].name;
                    intent.intent = 'select_service';
                }
            }
            // Ordinals: "el primero", "la primera", "el segundo"...
            if (!intent.serviceMentioned) {
                const ordinals: Record<string, number> = {
                    primer: 0, primero: 0, primera: 0,
                    segund: 1, segundo: 1, segunda: 1,
                    tercer: 2, tercero: 2, tercera: 2,
                    cuart: 3, cuarto: 3, cuarta: 3,
                    quint: 4, quinto: 4, quinta: 4,
                };
                for (const [word, idx] of Object.entries(ordinals)) {
                    if (tNorm.includes(word) && idx < state.services.length) {
                        intent.serviceMentioned = state.services[idx].name;
                        intent.intent = 'select_service';
                        break;
                    }
                }
            }
        }

        // ── Numeric/ordinal SLOT selection at show_slots: "el 1", "la primera", "2" ──
        // Mirrors the service-index selection but maps to the offered time slots, so
        // picking "el primero" at show_slots no longer fell through to the service
        // matcher and reset the flow.
        if (state.step === 'show_slots' && state.slots?.length && !intent.timeMentioned) {
            const tNorm = rawText.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
            const ordinals: Record<string, number> = {
                primer: 0, primero: 0, primera: 0, segund: 1, segundo: 1, segunda: 1,
                tercer: 2, tercero: 2, tercera: 2, cuart: 3, cuarto: 3, cuarta: 3,
                quint: 4, quinto: 4, quinta: 4,
            };
            let slotIdx = -1;
            const numMatch = tNorm.match(/^(?:el|la|opcion|numero|#)?\s*(\d+)$/);
            if (numMatch) {
                slotIdx = parseInt(numMatch[1]) - 1;
            } else {
                for (const [word, idx] of Object.entries(ordinals)) {
                    if (tNorm.includes(word)) { slotIdx = idx; break; }
                }
            }
            // Con recomendaciones pendientes, "la primera" es la primera RECOMENDADA.
            const pool = state.suggestedSlots?.length ? state.suggestedSlots : state.slots; // ordinal-pool
            if (slotIdx >= 0 && slotIdx < pool.length) {
                const chosen = pool[slotIdx];
                intent.timeMentioned = chosen.time;
                // Al elegir por número se sabe EXACTAMENTE qué slot es. Buscarlo
                // después por hora tomaría el primero con esa hora, que con dos
                // profesionales libres a la misma hora no tiene por qué ser el
                // que el cliente vio en esa posición de la lista.
                state.staffId = chosen.staffId;
                state.staffName = chosen.staffName;
            }
        }

        // ── If selected service was disabled/deleted, reset booking flow ──
        if (state.serviceId && state.services?.length) {
            const stillExists = state.services.some(s => s.id === state.serviceId);
            if (!stillExists) {
                this.logger.warn(`[Decide] Selected service ${state.serviceId} no longer active — resetting booking`);
                state.serviceId = undefined;
                state.serviceName = undefined;
                state.date = undefined;
                state.slots = undefined; state.suggestedSlots = undefined;
                state.time = undefined;
                state.staffId = undefined;
                state.staffName = undefined;
                state.step = state.services.length ? 'show_services' : 'idle';
            }
        }

        // ── Apply customer profile ──
        if (customerProfile.name && !state.customerName) state.customerName = customerProfile.name;
        if (customerProfile.email && !state.customerEmail) state.customerEmail = customerProfile.email;
        if (customerProfile.phone && !state.customerPhone) state.customerPhone = customerProfile.phone;

        // ── Apply intent data to state ──
        if (intent.serviceMentioned && !state.serviceId && state.services?.length) {
            const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            const matched = state.services.find(s => norm(s.name) === norm(intent.serviceMentioned!));
            const fuzzy = !matched ? state.services.find(s => {
                const words = norm(s.name).split(/\s+/).filter(w => w.length > 3);
                const hit = words.filter(w => norm(intent.serviceMentioned!).includes(w));
                return words.length > 0 && hit.length / words.length >= 0.5;
            }) : null;
            const svc = matched || fuzzy;
            if (svc) {
                state.serviceId = svc.id;
                state.serviceName = svc.name;
            }
        }
        if (intent.dateMentioned) {
            // Bug #4: Reject past dates — the agent should never book in the past.
            // If the extracted date is before today, reset it so the bot re-asks.
            if (intent.dateMentioned < todayDate) {
                this.logger.warn(`[Decide] dateMentioned=${intent.dateMentioned} is in the past (today=${todayDate}) — ignoring`);
                // Clear state values so they don't persist
                state.date = undefined;
                state.slots = undefined; state.suggestedSlots = undefined; // past-date-clear
                state.time = undefined;
                state.staffId = undefined;
                state.staffName = undefined;
                state.step = 'ask_date';

                // Friendly past-date feedback, localized (deterministic layer).
                const PD: Record<string, (d: string) => string> = {
                    es: d => `Disculpa, el ${d} ya pasó. 🗓️ ¿Qué otra fecha futura te gustaría seleccionar?`,
                    en: d => `Sorry, ${d} has already passed. 🗓️ What other future date works for you?`,
                    pt: d => `Desculpa, ${d} já passou. 🗓️ Que outra data futura você prefere?`,
                    fr: d => `Désolé, ${d} est déjà passé. 🗓️ Quelle autre date future préférez-vous ?`,
                };
                const text = (PD[(language || 'es').slice(0, 2)] || PD.es)(intent.dateMentioned);
                return { handled: true, state, text };
            } else {
                // Date changed → clear slots so availability is re-checked
                if (state.date && state.date !== intent.dateMentioned) {
                    state.slots = undefined;
                    state.suggestedSlots = undefined;
                    state.time = undefined;
                    state.staffId = undefined;
                    state.staffName = undefined;
                }
                state.date = intent.dateMentioned;
            }
        }
        // El cliente acepta la hora que se le recomendó: solo con un "sí" explícito
        // y una única recomendación pendiente se fija. Con dos, debe elegir una.
        if (state.suggestedSlots?.length === 1 && intent.isConfirmation && !intent.timeMentioned) {
            const accepted = state.suggestedSlots[0];
            // Solo si seguimos mostrando huecos y el recomendado sigue en la lista.
            if (state.step === 'show_slots' /* accept-step */ && state.slots?.some(s => s.time === accepted.time && s.staffId === accepted.staffId)) {
                state.time = accepted.time;
                state.staffId = accepted.staffId;
                state.staffName = accepted.staffName;
            }
            state.suggestedSlots = undefined;
        }
        // La hora pedida puede estar fuera de la tanda que se ve (huecos de la
        // mañana en pantalla, cliente pide las 16:00): se vuelve a consultar con
        // esa hora antes de decidir, en vez de buscarla solo en la lista vieja.
        const askedTime = intent.timeMentioned ?? undefined;
        const lateStep = ['ask_name', 'ask_email', 'confirm'].includes(state.step);
        // Si el mismo mensaje cambia de servicio, la hora se usa DESPUÉS con el
        // servicio nuevo (más abajo); consultar ahora preguntaría por el viejo.
        const normSvc = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        // Es un cambio solo si el texto se resuelve a OTRO servicio del catálogo
        // (mismo criterio que el bloque de cambio de opinión): "la consulta" o un
        // servicio que no existe no son un cambio.
        const switchTo = intent.serviceMentioned && state.serviceName
            ? state.services?.find(sv => normSvc(sv.name).includes(normSvc(intent.serviceMentioned!))) : undefined;
        const switchingService = !!switchTo && switchTo.id !== state.serviceId;
        const needsRefresh = !!askedTime && !!state.serviceId && !!state.date /* refresh-guard */
            && !switchingService
            && !state.slots?.some(s => s.time === askedTime)
            && (['idle', 'show_services', 'ask_date', 'show_slots'].includes(state.step)
                || (lateStep /* late-guard */ && askedTime !== state.time));
        if (needsRefresh) {
            const failed = await this.loadSlots(schemaName, tenantId, contactId, state, L, authority, conversationId, askedTime);
            if (failed) return failed;
        }
        const prevTime = state.time;
        if (intent.timeMentioned && state.slots?.length && !(lateStep && intent.timeMentioned === state.time)) {
            state.suggestedSlots = undefined;
            // El profesional se toma del MISMO slot que la hora: elegir la franja
            // es elegir con quién, y separarlos era lo que hacía que la reserva
            // llegara sin dueño.
            const takeSlot = (s: { time: string; staffId?: string; staffName?: string }) => {
                state.time = s.time;
                state.staffId = s.staffId;
                state.staffName = s.staffName;
            };
            const exactSlot = state.slots.find(s => s.time === intent.timeMentioned);
            if (exactSlot) {
                takeSlot(exactSlot);
                // Otra hora en un paso tardío: la propuesta anterior ya no vale.
                if (lateStep && state.time !== prevTime) invalidateBookingProposal(state);
            } else {
                if (lateStep) {
                    // Nunca se queda la hora vieja si el cliente pidió otra que no está libre.
                    state.time = undefined; state.staffId = undefined; state.staffName = undefined;
                    invalidateBookingProposal(state);
                    state.step = 'show_slots';
                }
                // La hora pedida no está libre. Nunca se reserva otra en silencio:
                // se dice y se recomienda el hueco más cercano (±30 min) para que
                // el cliente lo confirme.
                const near = nearestSlots(state.slots, intent.timeMentioned);
                if (near.length) {
                    this.logger.log(`[Decide] ${intent.timeMentioned} not free — recommending ${near.map(n => n.time).join(', ')}`);
                    state.suggestedSlots = near;
                }
                requestedUnavailableTime = intent.timeMentioned;
            }
        }
        this.logger.log(`[Decide] State after intent: step=${state.step} svc=${state.serviceName || '-'} date=${state.date || '-'} time=${state.time || '-'} slots=${state.slots?.length || 0}`);
        if (intent.nameProvided) state.customerName = intent.nameProvided;
        if (intent.emailProvided) state.customerEmail = intent.emailProvided;

        // ── Auto-select single service ──
        const hasDateOrTime = !!(intent.dateMentioned || intent.timeMentioned);
        // A bare confirmation ("sí") only triggers booking when a flow is already
        // in progress — otherwise answering "sí" to an unrelated LLM question would
        // start a booking for single-service tenants.
        const confirmInFlow = intent.isConfirmation && state.step !== 'idle' && state.step !== 'booked';
        const isBookingTrigger = confirmInFlow || intent.intent === 'select_service' || (intent.intent === 'ask_availability' && hasDateOrTime);
        if (!state.serviceId && state.services?.length === 1 && isBookingTrigger) {
            state.serviceId = state.services[0].id;
            state.serviceName = state.services[0].name;
            this.logger.log(`[Decide] Auto-selected single service: ${state.serviceName}`);
        }

        this.logger.log(`[Decide] intent=${intent.intent} svc=${state.serviceName || '-'} date=${state.date || '-'} step=${state.step}`);

        // ── HANDLE INTERACTIVE REPLIES (svc_, slot_, confirm_) ──
        if (rawText.startsWith('svc_') && state.services?.length) {
            const svc = state.services.find(s => s.id === rawText.replace('svc_', ''));
            if (svc) {
                state.serviceId = svc.id; state.serviceName = svc.name; state.step = 'ask_date';
                return { handled: true, state, text: msg(L, 'serviceSelected', { service: svc.name }) };
            }
        }
        if (rawText.startsWith('slot_') && state.slots?.length) {
            const time = rawText.replace('slot_', '');
            const slot = state.slots.find(s => s.time === time);
            if (slot) { state.time = slot.time; state.suggestedSlots = undefined; return this.collectMissingInfo(state, L); }
        }
        if (rawText === 'confirm_yes' || rawText.startsWith('confirm_yes:')) {
            if (!state.confirmationId || rawText !== `confirm_yes:${state.confirmationId}` || state.step !== 'confirm') {
                return this.repromptCurrentStep(state, L);
            }
            return this.createBooking(
                schemaName,
                tenantId,
                contactId,
                state,
                L,
                conversationId,
                authority,
                'confirm_yes',
            );
        }
        if ((rawText === 'confirm_no' || rawText.startsWith('confirm_no:')) && state.confirmationId
            && rawText === `confirm_no:${state.confirmationId}`) {
            Object.assign(state, { step: 'idle', serviceId: undefined, serviceName: undefined, date: undefined, slots: undefined, suggestedSlots: undefined, time: undefined });
            return { handled: true, state, text: msg(L, 'cancelled') };
        }

        // ═══════════════════════════════════════════════════
        // STATE MACHINE — deterministic transitions
        // ═══════════════════════════════════════════════════

        // ── Already booked — don't re-process ──
        if (state.step === 'booked') {
            return { handled: false, state }; // Let LLM handle any follow-up naturally
        }

        // ── CHANGE OF OPINION: user mentions a DIFFERENT service mid-flow ──
        if (intent.serviceMentioned && state.serviceId && state.serviceName) {
            const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            if (norm(intent.serviceMentioned) !== norm(state.serviceName)) {
                // User changed their mind — reset and apply new service
                const newSvc = state.services?.find(s => norm(s.name).includes(norm(intent.serviceMentioned!)));
                if (newSvc) {
                    const keptDate = state.date;
                    // The draft's own hour travels with its day: «mejor cámbiala a X» keeps «el sábado a las 16:00».
                    const keptTime = intent.timeMentioned ?? state.time;
                    state.serviceId = newSvc.id; state.serviceName = newSvc.name;
                    state.date = undefined; state.slots = undefined; state.suggestedSlots = undefined; state.time = undefined; state.staffId = undefined; state.staffName = undefined;
                    state.step = 'ask_date';
                    invalidateBookingProposal(state);
                    // "Mejor el masaje a las 17:30" / "mejor el masaje el sábado" / "mejor cámbiala al masaje": the day
                    // and the hour the customer already gave stay valid for the new service, which is checked for
                    // them right now (never carried over unverified); what is still missing is asked next.
                    if (keptDate) {
                        state.date = keptDate;
                        return this.checkAvailability(schemaName, tenantId, contactId, state, L, authority, conversationId, keptTime ?? undefined);
                    }
                    this.logger.log(`[Decide] Changed service to: ${newSvc.name}`);
                    return { handled: true, state, text: msg(L, 'switchedService', { service: newSvc.name }) };
                }
            }
        }

        // ── GENERAL QUESTION mid-booking: let LLM answer BUT keep booking state ──
        // "a las 16:00, ¿cuánto dura?" while slots are shown: the time is the answer, the duration
        // is left for the model; the engine advances.
        const pickingSlotWithDurationQuestion = state.step === 'show_slots' && !!intent.timeMentioned && asksDuration(rawText);
        if (intent.intent === 'general_question' && state.step !== 'idle' && !pickingSlotWithDurationQuestion) {
            // Don't handle — let LLM answer the general question.
            // But DON'T reset the booking state. Next message will resume the flow.
            this.logger.log(`[Decide] General question mid-booking, letting LLM handle (booking state preserved: ${state.step})`);
            return { handled: false, state };
        }

        // ── FAREWELL mid-booking: a goodbye is not an answer to the current step ──
        if (intent.intent === 'farewell' && state.step !== 'idle') {
            return { handled: false, state };
        }

        // ── GREET mid-booking: don't reset, just acknowledge ──
        if (intent.intent === 'greet' && state.step !== 'idle') {
            return this.repromptCurrentStep(state, L);
        }

        // ── CANCEL: user wants to abort booking ──
        if (intent.intent === 'cancel' && state.step !== 'idle') {
            Object.assign(state, { step: 'idle', serviceId: undefined, serviceName: undefined, date: undefined, slots: undefined, suggestedSlots: undefined, time: undefined });
            return { handled: true, state, text: msg(L, 'cancelled') };
        }

        // ── INTENT: ask_services — but only if no service already selected ──
        if (intent.intent === 'ask_services' && !state.serviceId && state.services?.length) {
            return this.showServices(state, L);
        }

        // ── Have service + date → check availability ──
        //
        // Unless the customer is confirming a slot they already picked. A state
        // parked on `confirm` has a time; if its `slots` list was lost (Redis
        // expired and the PG backup was rehydrated without it), a typed "sí"
        // fell into this branch and answered a confirmation with a fresh list of
        // times. The button never hit it because it short-circuits earlier.
        const confirmingChosenSlot = state.step === 'confirm' && !!state.time && intent.isConfirmation;
        if (state.serviceId && state.date && (!state.slots || !state.slots.length) && !confirmingChosenSlot) {
            return this.checkAvailability(schemaName, tenantId, contactId, state, L, authority, conversationId, intent.timeMentioned ?? undefined);
        }

        // ── Have service + date + time → collect info or confirm ──
        if (state.serviceId && state.date && state.time) {
            if (intent.isConfirmation && state.customerName && state.customerEmail) {
                // The customer typed their confirmation instead of tapping the
                // button. Same consent, same evidence: without it the central
                // guard opened its OWN confirmation challenge and the customer
                // read "Error al crear la cita: confirmation_required" and had to
                // say yes twice — always on Telegram/Instagram/Messenger/widget,
                // which have no confirm button at all.
                return this.createBooking(
                    schemaName, tenantId, contactId, state, L, conversationId, authority,
                    'text_confirmation',
                );
            }
            // A yes the engine could not take as consent ("sí, pero a las 5", "sí, si hay descuento"): the whole summary
            // is not sent again, only the question the customer has to answer. Nothing was booked this turn.
            if (state.step === 'confirm' && !intent.isConfirmation && this.isNearYes(rawText)) {
                return { handled: true, state, text: msg(L, 'confirmShort') };
            }
            return this.collectMissingInfo(state, L);
        }

        // ── Have service but no date ──
        if (state.serviceId && !state.date) {
            state.step = 'ask_date';
            return { handled: true, state, text: msg(L, 'serviceSelected', { service: state.serviceName || '' }) };
        }

        // ── User asked for a specific time that's NOT available ──
        if (requestedUnavailableTime && state.step === 'show_slots' && state.slots?.length) {
            const requested = requestedUnavailableTime;
            if (state.suggestedSlots?.length) {
                return {
                    handled: true, state,
                    text: this.suggestionText(L, requested, state.suggestedSlots),
                };
            }
            const available = (state.slots ?? []).map(s => `${s.time}-${s.endTime}`).join(', ');
            return {
                handled: true, state,
                text: msg(L, 'slotUnavailable', { time: requested, slots: available }),
            };
        }

        // ── Booking intent without service → show services ──
        if ((intent.intent === 'ask_availability' || intent.intent === 'select_service') && !state.serviceId && state.services?.length) {
            return this.showServices(state, L);
        }

        // ── Mid-flow protection: if we're in a booking step, re-prompt ──
        if (state.step !== 'idle') {
            return this.repromptCurrentStep(state, L);
        }

        // ── Not booking-related ──
        return { handled: false, state };
    }

    /**
     * A QUESTION about another service while the customer's draft is open ("¿cuánto dura color y
     * tratamiento y tienen cupo el sábado a las 16:00?"). The date and the time belong to the question:
     * reading them as the draft's own data (the old behaviour) moved the booking to the other service and
     * skipped asking for the slot. Here the question is answered with what the engine can verify (the
     * service's duration, a read-only availability check for THAT service) and the change is offered; the
     * draft is not touched. A yes right after (see `pendingSwitch`) applies it.
     *
     * Returns null when this is not that situation, so the normal flow runs (a statement such as "mejor
     * cámbiala a X" still switches directly). When availability cannot be verified the draft is left
     * alone and the model answers with its own tools.
     */
    private async offerServiceSwitch(
        schema: string, tenantId: string, contactId: string, state: BookingState, intent: InterpretedIntent,
        rawText: string, lang: string, todayDate: string, authority: ToolExecutionAuthority, conversationId?: string,
    ): Promise<EngineResult | null> {
        if (!state.serviceId || !['ask_date', 'show_slots', 'ask_name', 'ask_email', 'confirm'].includes(state.step)) return null;
        const draft = state.services?.find(s => s.id === state.serviceId);
        if (!draft || !isInformationSeekingMessage(rawText) || isServiceSwitchDirective(rawText)) return null;
        let target = this.otherServiceNamed(state, draft.id, intent, rawText, false);
        // `slot`: the same question about the draft's own service on ANOTHER day or hour. Only once the
        // customer has a slot (the late steps): earlier, the day and hour are what the engine is asking for.
        let kind: 'service' | 'slot' = 'service';
        if (!target) {
            if (!['ask_name', 'ask_email', 'confirm'].includes(state.step)) return null;
            const movesDay = !!intent.dateMentioned && intent.dateMentioned !== state.date;
            const movesHour = !!intent.timeMentioned && intent.timeMentioned !== state.time;
            if ((!movesDay && !movesHour) || (!!intent.dateMentioned && intent.dateMentioned < todayDate)) return null;
            target = draft;
            kind = 'slot';
        }
        this.logger.log(kind === 'service'
            ? `[Decide] Question about ${target.name} with a draft for ${draft.name} open — offering the switch instead of applying it`
            : `[Decide] Question about another day/hour for ${draft.name} with the draft at ${state.step} — answering and offering the change, draft untouched`);

        const from = state.serviceName || draft.name;
        const parts: string[] = [];
        if (asksDuration(rawText)) {
            const dtype = target.durationType || 'fixed';
            if (dtype === 'open') parts.push(msg(lang, 'switchDurationOpen', { service: target.name }));
            else if (dtype === 'flexible' && target.durationMinutesMax && target.durationMinutesMax !== target.durationMinutes) {
                parts.push(msg(lang, 'switchDurationRange', { service: target.name, min: String(target.durationMinutes), max: String(target.durationMinutesMax) }));
            } else if (target.durationMinutes > 0) parts.push(msg(lang, 'switchDuration', { service: target.name, minutes: String(target.durationMinutes) }));
        }
        if (PRICE_QUESTION.test(normalizeForIntent(rawText))) {
            if (target.priceStatus && target.priceStatus !== 'confirmed') {
                parts.push(msg(lang, 'switchPriceNote', { service: target.name, note: msg(lang, target.priceStatus === 'quote' ? 'servicePriceQuote' : 'servicePriceExample') }));
            } else if (Number(target.price) > 0) {
                parts.push(msg(lang, 'switchPrice', { service: target.name, amount: formatPriceWithCurrency(lang, target.price, target.currency) }));
            }
        }

        // The customer's day: the one they name, or the draft's day when they only name an hour.
        const date = intent.dateMentioned ? (intent.dateMentioned >= todayDate ? intent.dateMentioned : undefined)
            : intent.timeMentioned ? state.date : undefined;
        const time = intent.timeMentioned ?? undefined;
        let offerKey: 'switchOffer' | 'switchOfferDate' | 'switchOfferSlot' | 'switchOfferOtherDate' | 'changeOfferSlot' | 'changeOfferDate' | 'draftStays' = 'switchOffer';
        let offeredDate: string | undefined;
        let offeredTime: string | undefined;
        if (date) {
            const result = await this.toolExecutor.execute(
                schema, tenantId, contactId, 'check_availability',
                { date, serviceId: target.id, ...(time ? { time } : {}) },
                conversationId, { authority },
            );
            // Nothing is claimed about a slot that could not be checked: the model answers, the draft stays.
            if (!result || result.error) return { handled: false, state };
            const slots = result.available && result.slots?.length ? selectSlotWindow<{ time: string }>(result.slots, time) : [];
            const times = (list: Array<{ time: string }>) => Array.from(new Set(list.map(s => s.time))).join(', ');
            const vars = { service: target.name, date: friendlyDate(lang, date), time: time || '' };
            const slotKind = kind === 'slot';
            if (!slots.length) {
                parts.push(msg(lang, 'switchDayFull', vars));
                offerKey = slotKind ? 'draftStays' : 'switchOfferOtherDate';
            } else if (time && slots.some(s => s.time === time)) {
                parts.push(msg(lang, 'switchSlotFree', vars));
                offerKey = slotKind ? 'changeOfferSlot' : 'switchOfferSlot'; offeredDate = date; offeredTime = time;
            } else if (time) {
                const near = nearestSlots(slots, time);
                parts.push(msg(lang, 'switchSlotTaken', { ...vars, slots: times(near.length ? near : slots) }));
                offerKey = slotKind ? 'changeOfferDate' : 'switchOfferDate'; offeredDate = date;
            } else {
                parts.push(msg(lang, 'switchDayFree', { ...vars, slots: times(slots) }));
                offerKey = slotKind ? 'changeOfferDate' : 'switchOfferDate'; offeredDate = date;
            }
        }
        // A question about another day with no way to change to it (no availability, or nothing to ask the
        // customer, e.g. a time but no day) only says so: the draft simply stays.
        if (kind === 'slot' && offerKey === 'switchOffer') offerKey = 'draftStays';
        parts.push(msg(lang, offerKey, {
            from, service: target.name, date: offeredDate ? friendlyDate(lang, offeredDate) : '', time: offeredTime || '',
        }));
        if (offerKey !== 'draftStays') {
            state.pendingSwitch = {
                serviceId: target.id, serviceName: target.name,
                ...(offeredDate ? { date: offeredDate } : {}), ...(offeredTime ? { time: offeredTime } : {}),
                offeredAt: new Date().toISOString(),
            };
        }
        return { handled: true, state, text: parts.join(' ') };
    }

    /**
     * The customer ORDERS a change of service ("mejor cámbiala a X", "prefiero X", "quiero X el sábado a
     * las 16:00", "X el sábado") with a draft open. At the late steps the interpreter does not read service
     * names (a surname must not be taken for one), so the engine finds the other service by its FULL name.
     */
    private directSwitchTarget(state: BookingState, intent: InterpretedIntent, rawText: string): NonNullable<BookingState['services']>[number] | undefined {
        if (!state.serviceId || !['ask_date', 'show_slots', 'ask_name', 'ask_email', 'confirm'].includes(state.step)) return undefined;
        const directive = isServiceSwitchDirective(rawText);
        if (isInformationSeekingMessage(rawText) && !directive) return undefined;
        const target = this.otherServiceNamed(state, state.serviceId, intent, rawText, directive);
        if (!target || !['ask_name', 'ask_email', 'confirm'].includes(state.step)) return target;
        // The late steps are where the customer types a NAME or an E-MAIL, and both can contain a service word
        // ("Carlos Barba", "carlos.barba@gmail.com"): the name of a service inside the text is not an order.
        if (EMAIL_IN_TEXT.test(rawText) || intent.emailProvided) return undefined;
        if (state.step === 'ask_name' && !directive && looksLikeNameAnswer(rawText)) return undefined;
        if (directive || intent.dateMentioned || intent.timeMentioned) return target;
        // Otherwise only the bare service name, as the whole message, counts ("Barba por favor"), and only if
        // the interpreter did not read it as a name.
        const fold = (value: string) => normalizeForIntent(value).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        const whole = fold(rawText).replace(/\b(?:por favor|porfa|gracias|please|obrigad[oa]|merci|el|la|un|una|para)\b/g, ' ').replace(/\s+/g, ' ').trim();
        return whole === fold(target.name) && !intent.nameProvided ? target : undefined;
    }

    /** The message opens with a yes (or an ok) but is not consent as a whole: a qualifier, a second task, leftover words. */
    private isNearYes(rawText: string): boolean {
        const read = normalizeCustomerIntent(rawText, { answeringExplicitQuestion: true });
        return !!read.matched && read.intent === 'unclear';
    }

    /**
     * The catalog service, other than the draft's, that the message is about: the one the interpreter
     * extracted, or (for the late steps, where the interpreter deliberately does not read service names so
     * a surname is not taken for one) a service whose full name appears in the text.
     */
    private otherServiceNamed(
        state: BookingState, draftId: string, intent: InterpretedIntent, rawText: string, orderedChange: boolean,
    ): NonNullable<BookingState['services']>[number] | undefined {
        const services = state.services ?? [];
        const fold = (value: string) => normalizeForIntent(value).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (intent.serviceMentioned) {
            const wanted = fold(intent.serviceMentioned);
            const named = services.find(s => fold(s.name) === wanted) ?? services.find(s => fold(s.name).includes(wanted));
            if (named) return named.id === draftId ? undefined : named;
        }
        // Full name only: a customer called "Cortés" is not asking for "Corte y estilo".
        const text = ` ${fold(rawText)} `;
        const found = services
            .filter(s => fold(s.name).length >= 4)
            .map(s => ({ service: s, at: text.lastIndexOf(` ${fold(s.name)} `) }))
            .filter(entry => entry.at >= 0);
        const others = found.filter(entry => entry.service.id !== draftId);
        // Naming the draft's own service as well is ambiguous in a question; an order names where it goes last
        // ("cambia de corte y estilo a color y tratamiento").
        if (!others.length || (found.length > others.length && !orderedChange)) return undefined;
        return others.sort((a, b) => b.at - a.at)[0].service;
    }

    /**
     * Returns the tool's error code when the booking flow can't recover from it,
     * null otherwise. A tool answering `{available:false}` WITHOUT an error code
     * (e.g. "the business doesn't work that weekday") is a normal outcome and
     * must keep the existing "try another date" behaviour.
     */
    private unrecoverableToolError(result: any): string | null {
        const code = typeof result?.error === 'string' ? result.error : null;
        return code && (UNRECOVERABLE_TOOL_ERRORS.has(code)
            || UNRECOVERABLE_TOOL_ERROR_PREFIXES.some(prefix => code.startsWith(prefix))) ? code : null;
    }

    /**
     * Abort the booking flow honestly and ask for a human. Resets the state like
     * a cancel so nothing keeps re-prompting, and flags the handoff for the caller
     * (the engine has no conversationId, so it can't run HandoffService itself —
     * exactly how ProcedureEngineService does it).
     */
    private escalateToHuman(state: BookingState, lang: string, msgKey: string, reason: string): EngineResult {
        this.logger.warn(`[Decide] Booking dead end (${reason}) — escalating to a human`);
        Object.assign(state, {
            step: 'idle', serviceId: undefined, serviceName: undefined,
            date: undefined, slots: undefined, suggestedSlots: undefined, time: undefined, flowStartedAt: undefined,
        });
        return { handled: true, state, text: msg(lang, msgKey), handoff: true, handoffReason: reason };
    }

    // ── Show services ──
    private showServices(state: BookingState, lang: string): EngineResult {
        state.step = 'show_services';
        const svcList = (state.services || []).map((s, i) => {
            let durLabel = '';
            const dtype = s.durationType || 'fixed';
            if (dtype === 'open') {
                durLabel = ` (${msg(lang, 'flexibleTime')})`;
            } else if (dtype === 'flexible' && s.durationMinutesMax) {
                durLabel = ` (${s.durationMinutes}-${s.durationMinutesMax} ${msg(lang, 'minutes')})`;
            } else if (s.durationMinutes > 0) {
                durLabel = ` (${s.durationMinutes} ${msg(lang, 'minutes')})`;
            }
            // D10: an example or quote-only price is words, never a number.
            const priceLabel = s.priceStatus && s.priceStatus !== 'confirmed'
                ? ` - ${msg(lang, s.priceStatus === 'quote' ? 'servicePriceQuote' : 'servicePriceExample')}`
                : (Number(s.price) > 0 ? ` - ${formatPriceWithCurrency(lang, s.price, s.currency)}` : '');
            return `${i + 1}. ${s.name}${durLabel}${priceLabel}`;
        }).join('\n');
        return {
            handled: true, state,
            text: `${msg(lang, 'servicesHeader')}\n${svcList}\n${msg(lang, 'servicesFooter')}`,
        };
    }

    /** "Las 16:00 no está disponible. Te recomiendo 16:30. ¿Te sirve?" */
    private suggestionText(lang: string, requested: string, near: Array<{ time: string }>): string {
        // Solo horas de inicio: un rango "15:30 - 16:00" parece ofrecer las 16:00.
        const suggestion = near.map(s => msg(lang, 'slotSuggestItem', { t: s.time })).join(` ${msg(lang, 'slotSuggestOr')} `);
        return msg(lang, near.length > 1 ? 'slotSuggestMany' : 'slotSuggest', { time: requested, suggestion });
    }

    /**
     * Pide huecos a la herramienta (centrados en la hora pedida, si la hay) y los
     * deja en `state.slots` con `step = show_slots`. Devuelve un resultado solo
     * cuando no hay huecos que mostrar (sin disponibilidad o callejón sin salida).
     */
    private async loadSlots(
        schema: string, tenantId: string, contactId: string, state: BookingState, lang: string,
        authority: ToolExecutionAuthority, conversationId?: string, requestedTime?: string,
    ): Promise<EngineResult | null> {
        this.logger.log(`[Decide] Checking availability: ${state.serviceName} on ${state.date}`);
        const result = await this.toolExecutor.execute(
            schema, tenantId, contactId, 'check_availability',
            // La hora pedida viaja a la herramienta solo si existe: sin ella el
            // contrato de la llamada es el de siempre.
            { date: state.date, serviceId: state.serviceId, ...(requestedTime ? { time: requestedTime } : {}) },
            conversationId, { authority },
        );

        if (result?.available && result.slots?.length) {
            state.slots = selectSlotWindow(result.slots, requestedTime);
            state.step = 'show_slots';
            state.suggestedSlots = undefined;
            return null;
        }

        // The tool distinguishes "closed that weekday" (retry another date) from a
        // dead end (agenda never configured / tool failure). Offering another date
        // for a dead end loops forever and never reaches a human, so escalate.
        const fatal = this.unrecoverableToolError(result);
        if (fatal) {
            return this.escalateToHuman(state, lang, 'schedulingUnavailable', `booking_unavailable:${fatal}`);
        }

        const noDate = state.date;
        state.time = undefined; state.staffId = undefined; state.staffName = undefined;
        invalidateBookingProposal(state);
        state.date = undefined; state.step = 'ask_date';
        return { handled: true, state, text: msg(lang, 'noAvailability', { date: noDate || '' }) };
    }

    // ── Check availability ──
    private async checkAvailability(
        schema: string, tenantId: string, contactId: string, state: BookingState, lang: string,
        authority: ToolExecutionAuthority, conversationId?: string, requestedTime?: string,
    ): Promise<EngineResult> {
        const failed = await this.loadSlots(schema, tenantId, contactId, state, lang, authority, conversationId, requestedTime);
        if (failed) return failed;
        if (requestedTime) {
            const exact = state.slots?.find(s => s.time === requestedTime);
            if (exact) {
                state.time = exact.time; state.staffId = exact.staffId; state.staffName = exact.staffName;
                return this.collectMissingInfo(state, lang);
            }
            // Nunca se conserva ni se reserva otra hora sin que el cliente la confirme.
            state.time = undefined;
            const near = nearestSlots(state.slots ?? [], requestedTime);
            if (near.length) {
                state.suggestedSlots = near;
                return { handled: true, state, text: this.suggestionText(lang, requestedTime, near) };
            }
            return {
                handled: true, state,
                text: msg(lang, 'slotUnavailable', {
                    time: requestedTime,
                    slots: (state.slots ?? []).map(s => `${s.time}-${s.endTime}`).join(', '),
                }),
            };
        }
        // El nombre del profesional se muestra solo cuando hay MÁS DE UNO en
        // la tanda: en un local de una sola persona repetirlo en cada franja
        // es ruido, y en una clínica con tres doctoras es justo el dato con
        // el que el paciente elige.
        const staffNames = new Set((state.slots ?? []).map(s => s.staffName).filter(Boolean));
        const showStaff = staffNames.size > 1;
        const slotList = (state.slots ?? [])
            .map(s => `${s.time} - ${s.endTime}${showStaff && s.staffName ? ` (${s.staffName})` : ''}`)
            .join(', ');
        return {
            handled: true, state,
            text: msg(lang, 'slotsAvailable', { service: state.serviceName || '', date: state.date || '', slots: slotList }),
        };
    }

    // ── Collect missing info or show confirmation ──
    private collectMissingInfo(state: BookingState, lang: string): EngineResult {
        if (!state.customerName) {
            state.step = 'ask_name';
            return { handled: true, state, text: msg(lang, 'askName', { time: state.time || '', service: state.serviceName || '' }) };
        }
        if (!state.customerEmail) {
            state.step = 'ask_email';
            return { handled: true, state, text: msg(lang, 'askEmail', { name: state.customerName }) };
        }
        // All info collected → confirmation. Localized labels so the summary doesn't
        // mix English ("on"/"at"/"Name") into an otherwise translated prompt.
        const SL: Record<string, { on: string; at: string; name: string; email: string; with: string }> = {
            es: { on: 'el', at: 'a las', name: 'Nombre', email: 'Email', with: 'Con' },
            en: { on: 'on', at: 'at', name: 'Name', email: 'Email', with: 'With' },
            pt: { on: 'em', at: 'às', name: 'Nome', email: 'Email', with: 'Com' },
            fr: { on: 'le', at: 'à', name: 'Nom', email: 'Email', with: 'Avec' },
        };
        const sl = SL[(lang || 'es').slice(0, 2)] || SL.es;
        state.step = 'confirm';
        // El profesional entra en el resumen que el cliente confirma: si va a ver
        // a la Dra. X y no a la Dra. Y, ese es el momento de decirlo — y de que
        // el cliente pueda corregirlo antes de que la cita exista.
        const withStaff = state.staffName ? `\n${sl.with}: ${state.staffName}` : '';
        const service = state.services?.find(s => s.id === state.serviceId);
        // Mismo formateo que el listado: la línea que el cliente CONFIRMA no
        // puede agrupar los miles distinto que la que leyó al elegir. Cuando la
        // fila no tiene número (o no tiene moneda que decir), el resumen dice
        // "por confirmar" en vez de imprimir un hueco.
        const confirmedPrice = service && (!service.priceStatus || service.priceStatus === 'confirmed')
            ? formatPriceWithCurrency(lang, service.price, service.currency)
            : '';
        const priceSummary = !service ? ''
            : service.priceStatus && service.priceStatus !== 'confirmed'
                ? '\n' + msg(lang, service.priceStatus === 'quote' ? 'bookingPriceQuote' : 'bookingPriceToConfirm')
                : confirmedPrice
                    ? '\n' + msg(lang, 'bookingPrice', { amount: confirmedPrice })
                    : '\n' + msg(lang, 'bookingPriceToConfirm');
        const terms = service?.appointmentTerms;
        const duration = terms?.durationType === 'flexible' ? terms.durationMinutesMax || terms.durationMinutes : terms?.durationMinutes;
        const durationSummary = duration ? '\n' + msg(lang, 'bookingDuration', { minutes: String(duration) }) : '';
        const location = terms?.locationType === 'online' ? msg(lang, 'bookingOnline') : terms?.locationAddress;
        const locationSummary = location ? '\n' + msg(lang, 'bookingLocation', { location }) : '';
        const termsHash = bookingConfirmationHash(state);
        if (!state.confirmationId || state.confirmationHash !== termsHash
            || Date.now() - Date.parse(state.confirmationIssuedAt || '') > 30 * 60 * 1000
            || !Number.isFinite(Date.parse(state.confirmationIssuedAt || ''))) {
            state.confirmationId = randomUUID();
            state.confirmationHash = termsHash;
            state.confirmationIssuedAt = new Date().toISOString();
        }
        // El monto que el cliente va a PAGAR usa el mismo formateo que el que
        // leyó: dos agrupaciones distintas para la misma cifra en la misma
        // pantalla es cómo se discute una seña después.
        const dueAmount = service?.requiresPaymentToConfirm
            ? formatPriceWithCurrency(lang, service.amountDueToConfirm ?? service.price, service.currency)
            : '';
        const dueSummary = dueAmount ? '\n' + msg(lang, 'bookingPaymentDue', { amount: dueAmount }) : '';
        const summary = `${state.serviceName} ${sl.on} ${state.date} ${sl.at} ${state.time}${withStaff}\n${sl.name}: ${state.customerName}\n${sl.email}: ${state.customerEmail}${durationSummary}${locationSummary}${priceSummary}${dueSummary}`;
        return {
            handled: true, state,
            text: msg(lang, 'confirmPrompt', { summary }),
            buttonMessage: {
                body: msg(lang, 'confirmButton', { summary }),
                buttons: [
                    { id: `confirm_yes:${state.confirmationId}`, title: msg(lang, 'btnConfirm') },
                    { id: `confirm_no:${state.confirmationId}`, title: msg(lang, 'btnCancel') },
                ],
            },
        };
    }

    // ── Create booking ──
    private async createBooking(
        schema: string,
        tenantId: string,
        contactId: string,
        state: BookingState,
        lang: string,
        conversationId: string | undefined,
        authority: ToolExecutionAuthority,
        confirmationSource?: 'confirm_yes' | 'flow_response' | 'text_confirmation',
    ): Promise<EngineResult> {
        this.logger.log(`[Decide] BOOKING: ${state.serviceName} ${state.date} ${state.time} for ${state.customerName}`);
        if (confirmationSource && confirmationSource !== 'flow_response'
            && (!state.confirmationId || state.confirmationHash !== bookingConfirmationHash(state)
                || !Number.isFinite(Date.parse(state.confirmationIssuedAt || ''))
                || Date.now() - Date.parse(state.confirmationIssuedAt!) > 30 * 60 * 1000)) {
            return this.collectMissingInfo(state, lang);
        }

        // Appointment columns store tenant-local wall-clock timestamps. A replay
        // must preserve that clock and exclude payment holds that have expired.
        try {
            const startAt = `${state.date}T${state.time}:00`;
            const existing: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT a.id, a.status, a.payment_status, a.amount_due, a.hold_expires_at,
                        ${appointmentPriceSql('a', 's')} AS price, ${appointmentCurrencySql('a', 's')} AS currency
                 FROM "${schema}".appointments a LEFT JOIN "${schema}".services s ON s.id = a.service_id
                 WHERE a.contact_id = $1::uuid
                   AND a.service_id = $2::uuid
                   AND a.start_at = $3::timestamp
                   AND a.status NOT IN ('cancelled', 'completed', 'no_show') AND ${holdStillAliveSql('a')} LIMIT 1`,
                contactId, state.serviceId, startAt,
            );
            if (existing?.length) {
                this.logger.warn(`[Decide] Duplicate booking prevented — appointment ${existing[0].id} already exists`);
                const apt = existing[0];
                const awaitingPayment = apt.status === 'pending_payment';
                return this.bookingOutcome(state, lang, {
                    success: true, idempotentReplay: true, appointmentId: apt.id,
                    appointment: { id: apt.id, status: apt.status, awaitingPayment,
                        amountDueToConfirm: apt.amount_due ?? apt.price, currency: apt.currency,
                        holdExpiresAt: apt.hold_expires_at,
                        payableReference: awaitingPayment ? `appointment:${apt.id}` : null },
                });
            }
        } catch (err) {
            this.logger.warn(`[Decide] Duplicate check failed (non-blocking): ${(err as any).message}`);
        }

        const result = await this.toolExecutor.execute(schema, tenantId, contactId, 'create_appointment', {
            serviceId: state.serviceId, date: state.date, time: state.time,
            // Quién atiende. La tool ya lo aceptaba y lo escribía en assigned_to;
            // era el motor el que no se lo pasaba nunca.
            staffId: state.staffId,
            customerName: state.customerName, customerEmail: state.customerEmail, customerPhone: state.customerPhone,
        }, conversationId, {
            authority,
            ...(confirmationSource ? {
                authorityEvidence: {
                    kind: 'booking_engine_confirmation' as const,
                    source: confirmationSource,
                    flowToken: confirmationSource === 'flow_response' ? state.flowToken : undefined,
                },
            } : {}),
        });
        const executedTools = [{ name: 'create_appointment', result }];
        if (result?.success) return this.bookingOutcome(state, lang, result);
        if (result?.error === 'appointment_terms_changed' && result.service?.id === state.serviceId) {
            state.services = [...(state.services || []).filter(service => service.id !== state.serviceId), result.service];
            state.serviceName = result.service.name;
            state.confirmationId = undefined;
            state.confirmationHash = undefined;
            // The next confirmation summary and persisted state use the new
            // canonical facts; clear the discovery cache so it cannot revert them.
            await this.redis.del(`booking:services:${tenantId}`).catch(() => {});
            return { ...this.collectMissingInfo(state, lang), executedTools };
        }
        // Same criterion as checkAvailability: on an unrecoverable failure the
        // appointment was NOT created and "try another time" is both a lie and a
        // way to leak the internal error code into the customer's chat.
        const fatal = this.unrecoverableToolError(result);
        if (fatal) {
            return { ...this.escalateToHuman(state, lang, 'bookingFailedHandoff', `booking_failed:${fatal}`), executedTools };
        }
        return { handled: true, state, executedTools, text: msg(lang, 'bookingError', { error: result?.error || 'Unknown' }) };
    }

    private bookingOutcome(state: BookingState, lang: string, result: any): EngineResult {
        const appointment = result.appointment || {};
        const pendingPayment = appointment.awaitingPayment === true || appointment.status === 'pending_payment';
        state.step = 'booked'; // Collection is complete; resource status is stored separately.
        state.appointmentId = appointment.id || result.appointmentId;
        state.appointmentStatus = appointment.status || 'pending';
        state.payableReference = appointment.payableReference || null;
        return {
            handled: true, state, executedTools: [{ name: 'create_appointment', result }],
            text: msg(lang, pendingPayment ? 'bookingAwaitingPayment'
                : appointment.status === 'confirmed' ? 'booked' : 'bookingPending', {
                service: state.serviceName || '', date: state.date || '', time: state.time || '',
                name: state.customerName || '', email: state.customerEmail || '',
                // Mismo formateo que la propuesta que el cliente acaba de leer:
                // el importe a pagar no puede cambiar de aspecto entre la
                // pantalla donde lo aceptó y la que le dice cuánto pagar.
                amount: formatPriceWithCurrency(lang, appointment.amountDueToConfirm, appointment.currency),
            }),
        };
    }

    /**
     * A mission untouched past the continuity window is dormant (see
     * `restoreBookingMission`). It never consumes a message silently: the
     * customer is asked once whether to resume it or start over. Returns null
     * when the message already carries concrete booking data, which resumes the
     * mission implicitly and lets the normal flow (fresh availability, fresh
     * consent) take over.
     */
    private decideDormantMission(state: BookingState, intent: InterpretedIntent, rawText: string, lang: string): EngineResult | null {
        const clear = () => { state.resumeOffer = undefined; state.dormantSince = undefined; state.resumedAfterExpiry = undefined; };
        if (intent.serviceMentioned || intent.dateMentioned || intent.timeMentioned) { clear(); return null; }
        const text = normalizeForIntent(rawText);
        if (state.resumeOffer === 'offered') {
            const resumeWords = isResumeMessage(rawText)
                || /\b(?:retom\w*|continu\w*|segu\w+|sigamos|reanud\w*|resume|reprend\w*|reprenons)\b/.test(text);
            const startOver = /\b(?:empez\w*|nuevo|nueva|de cero|descart\w*|olvid\w*|start over|from scratch|new one|recomenc\w*|commencer|comecar|comeco)\b/.test(text);
            if (resumeWords && !startOver) { clear(); return this.repromptCurrentStep(state, lang); }
            if (startOver || intent.isNegation || intent.intent === 'cancel') {
                Object.assign(state, {
                    step: 'idle', serviceId: undefined, serviceName: undefined, date: undefined, slots: undefined,
                    suggestedSlots: undefined, time: undefined, staffId: undefined, staffName: undefined,
                });
                clear();
                return { handled: true, state, text: msg(lang, 'resumeDiscarded') };
            }
            if (intent.isConfirmation) { clear(); return this.repromptCurrentStep(state, lang); }
            // Neither answer nor booking data: the model replies next, so the offer
            // is no longer the last outgoing message and a later yes/no (to the
            // model's own question) must not resume or discard the old mission.
            // It is also not repeated: "gracias" or "chao" must not bring it back.
            state.resumeOffer = 'lapsed';
            return { handled: false, state };
        }
        if (state.resumeOffer === 'lapsed') {
            // An explicit wish to book is as good as a datum: the mission resumes.
            if (['ask_availability', 'select_service', 'select_time'].includes(intent.intent)) { clear(); return null; }
            return { handled: false, state };
        }
        // The offer is for a message about booking. "hola", a question about the business or an
        // unrelated message gets the model's answer and the offer stays pending (the mission is
        // already hidden from the prompt).
        if (!isAboutBooking(rawText, intent)) return { handled: false, state };
        state.resumeOffer = 'offered';
        return {
            handled: true, state,
            text: state.serviceName ? msg(lang, 'resumeOffer', { service: state.serviceName }) : msg(lang, 'resumeOfferNoService'),
        };
    }

    // ── Re-prompt current step (mid-flow protection) ──
    private repromptCurrentStep(state: BookingState, lang: string): EngineResult {
        switch (state.step) {
            case 'show_services':
                return this.showServices(state, lang);
            case 'ask_date':
                return { handled: true, state, text: msg(lang, 'askDate', { service: state.serviceName || '' }) };
            case 'show_slots':
                // Con recomendaciones pendientes se repiten solo ellas: es la lista que
                // el cliente acaba de leer y sobre la que contará "la primera".
                return { handled: true, state, text: msg(lang, 'whichTime', { slots: (state.suggestedSlots?.length ? state.suggestedSlots : state.slots ?? []).map(s => s.time).join(', ') }) };
            case 'ask_name':
                return { handled: true, state, text: msg(lang, 'whichName') };
            case 'ask_email':
                return { handled: true, state, text: msg(lang, 'whichEmail') };
            case 'confirm':
                return this.collectMissingInfo(state, lang);
            default:
                return { handled: false, state };
        }
    }
}
