import { randomUUID } from 'crypto';
import { normalizeForIntent, type ConversationMissionFocusV1, type ConversationMissionRefV1, type MissionExecutionScopeV1 } from '@parallext/shared';
import { isInformationSeekingMessage, isPauseMessage, isResumeMessage, normalizeCustomerIntent } from '../../common/conversation/intent-normalizer';

export interface MissionCandidate {
    ref: ConversationMissionRefV1;
    aliases: string[];
    paused: boolean;
    /** A saved task may be resumed; an unstarted procedure is discovery only. */
    saved: boolean;
}

const DOMAINS: Record<string, RegExp> = {
    appointment: /\b(?:cita|citas|appointment|appointments|consulta|consultas|rendez vous|agendar|schedule an appointment)\b/,
    order: /\b(?:pedido|pedidos|order|orders|commande|commandes)\b/,
    education: /\b(?:curso|cursos|course|courses|cohorte|cohort|matricula|inscripcion|inscricao|inscription)\b/,
    gym: /\b(?:clase|clases|class|classes|aula|aulas|spinning|pilates|zumba|seance)\b/,
    property: /\b(?:habitacion|hotel|room|quarto|chambre|alojamiento|hospedagem)\b/,
    repair: /\b(?:reparacion|reparacao|repair|reparation|taller|oficina|atelier)\b/,
    tour: /\b(?:tour|excursion|excursao|passeio)\b/,
    return: /\b(?:devolucion|devolucao|return|retour)\b/,
};
const TASK_VERB = /\b(?:quiero|necesito|quisiera|agendar|reservar|cancelar|retomar|retomemos|reanudar|consultar|inscribir|matricular|i want|i need|book|schedule|cancel|resume|continue with|quero|preciso|inscrever|continuar com|je veux|je souhaite|reserver|annuler|reprendre|reprenons|continuer avec)\b/;
const NAMED_RESUME = /^(?:(?:por favor|please|s il vous plait)\s+)?(?:retoma|retomar|retome|retomemos|reanuda|reanudar|continuar con|resume|continue with|continuar com|reprendre|reprenez|reprenons|continuer avec)\b/;
const CORRECTION = /\b(?:cambia|cambiar|cambie|change|update|altere|alterar|mude|modifiez|modifier|corrijo|corrige|corregir|correction|correct|quise decir|queria decir|me equivoque|en realidad|mas bien|actually|i meant|corrigindo|corrigir|na verdade|quis dizer|je voulais dire|rectifier|corriger)\b/;
const COLLECTION_CANCEL = /^(?:(?:por favor|please)\s+)?(?:cancelar|cancela|cancelalo|cancel|annuler|arretez|olvidalo|olvidate|dejemoslo|deixa pra la|ya no quiero(?: continuar)?|no quiero continuar|nao quero continuar|i don't want to continue|i do not want to continue|je ne veux plus continuer|mejor nada|nada de eso)(?:\s+(?:por favor|please))?[.!\s]*$/;

export function isCollectionCancellation(text: string): boolean { return COLLECTION_CANCEL.test(normalizeForIntent(text)); }
export function isNamedMissionResume(text: string): boolean { return NAMED_RESUME.test(normalizeForIntent(text)); }
export function isDirectedCorrection(text: string): boolean { return CORRECTION.test(normalizeForIntent(text)); }
export function mentionedMissionDomains(text: string): string[] {
    const normalized = normalizeForIntent(text).replace(/-/g, ' ');
    return Object.entries(DOMAINS).filter(([, pattern]) => pattern.test(normalized)).map(([domain]) => domain);
}
export function toolMissionDomain(name: string): string | undefined {
    if (/appointment/.test(name)) return 'appointment';
    if (/enroll|student|course|cohort/.test(name)) return 'education';
    if (/class|membership|gym/.test(name)) return 'gym';
    if (/property/.test(name)) return 'property';
    if (/repair/.test(name)) return 'repair';
    if (/order/.test(name)) return 'order';
    if (/tour/.test(name)) return 'tour';
    return undefined;
}
/** Ownership constrains authority; matching a domain never grants authority. */
export function missionToolAllowed(scope: MissionExecutionScopeV1, name: string): boolean {
    if (scope.writeBlocked) return false;
    if (scope.kind !== scope.executionOwner) return false;
    if (scope.kind === 'booking') return name === 'create_appointment';
    if (scope.kind === 'procedure') return true; // Only the compiled procedure port can enter here.
    const domain = toolMissionDomain(name);
    return scope.domain ? domain === scope.domain : !scope.toolName || name === scope.toolName;
}
export function toolMissionAliases(ref: ConversationMissionRefV1): string[] {
    const aliases: Record<string, string[]> = {
        appointment: ['cita', 'appointment', 'consulta', 'rendez-vous'], order: ['pedido', 'order', 'commande'],
        education: ['matricula', 'inscripcion', 'enrollment', 'inscricao', 'inscription', 'curso', 'course'],
        gym: ['clase', 'class', 'aula', 'seance'], property: ['habitacion', 'room', 'quarto', 'chambre'],
        repair: ['reparacion', 'repair', 'reparacao', 'reparation'], tour: ['tour', 'excursion', 'passeio'],
    };
    return [...(aliases[ref.domain || ''] || []), ...(ref.toolName ? [ref.toolName] : [])];
}
/** Control language anywhere in a message is not a free-text form value. */
export function containsMissionDirective(text: string): boolean {
    return isNamedMissionResume(text) || isDirectedCorrection(text)
        || (TASK_VERB.test(normalizeForIntent(text)) && mentionedMissionDomains(text).length > 0);
}

export function newMissionFocus(now = new Date().toISOString()): ConversationMissionFocusV1 {
    return { version: 1, revision: 0, writeVersion: 0, selected: null, expectedReply: null, updatedAt: now };
}
export function readMissionFocus(value: unknown): ConversationMissionFocusV1 {
    const state = value as ConversationMissionFocusV1 | null;
    if (!state || state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0
        || !Number.isSafeInteger(state.writeVersion) || state.writeVersion < 0) return newMissionFocus();
    if (state.selected && (!['booking', 'procedure', 'tool'].includes(state.selected.kind)
        || typeof state.selected.id !== 'string' || !state.selected.id)) return newMissionFocus();
    const copy = structuredClone(state);
    copy.pausedTools = (Array.isArray(copy.pausedTools) ? copy.pausedTools : []).filter(item => item?.ref?.kind === 'tool'
        && typeof item.ref.id === 'string' && Number.isFinite(Date.parse(item.pausedAt))
        && Date.now() - Date.parse(item.pausedAt) < 7 * 86400_000).slice(0, 6);
    if (copy.expectedReply && (copy.expectedReply.missionId !== copy.selected?.id
        || typeof copy.expectedReply.proposalId !== 'string'
        || !['slot', 'confirmation', 'flow'].includes(copy.expectedReply.kind))) copy.expectedReply = null;
    return copy;
}

export interface MissionFocusDecision {
    state: ConversationMissionFocusV1;
    route: 'booking' | 'procedure' | 'tools' | 'clarify' | 'dialogue';
    action: 'continue' | 'select' | 'resume' | 'pause' | 'cancel' | 'correct' | 'clarify' | 'replay';
    selectedProcedureId?: string;
    /** Engines are paused through their own persistence ports, not copied here. */
    pauseBooking: boolean;
    pauseProcedure: boolean;
    invalidateConfirmation: boolean;
}

/** Chooses ownership only. Capability/identity/terms/ledger remain authoritative. */
export function arbitrateMissionFocus(input: {
    state: ConversationMissionFocusV1; candidates: MissionCandidate[]; text: string; messageId: string;
}): MissionFocusDecision {
    const state = structuredClone(input.state);
    if (state.lastConsumed?.messageId === input.messageId) return {
        state, route: 'dialogue', action: 'replay', pauseBooking: false, pauseProcedure: false, invalidateConfirmation: false,
    };
    const normalized = normalizeForIntent(input.text);
    const dialogue = normalizeCustomerIntent(input.text);
    const domains = mentionedMissionDomains(input.text);
    const candidates = [...input.candidates, ...(state.pausedTools || []).map(item => ({ ref: item.ref, aliases: toolMissionAliases(item.ref), paused: true, saved: true }))];
    if (state.selected?.kind === 'tool' && state.selected.reference && !candidates.some(candidate => candidate.ref.id === state.selected!.id)) {
        candidates.push({ ref: state.selected, aliases: toolMissionAliases(state.selected), paused: false, saved: true });
    }
    const saved = candidates.filter(candidate => candidate.saved);
    const current = saved.find(candidate => candidate.ref.id === state.selected?.id)
        || (saved.filter(candidate => !candidate.paused).length === 1 ? saved.find(candidate => !candidate.paused) : undefined);
    const matches = candidates.filter(candidate => candidate.aliases.some(alias => {
        const name = normalizeForIntent(alias).replace(/-/g, ' ');
        return name.length >= 3 && (` ${normalized.replace(/-/g, ' ')} `).includes(` ${name} `);
    }));
    const unique = [...new Map(matches.map(candidate => [candidate.ref.id, candidate])).values()];
    let selected = current?.ref || state.selected;
    let route: MissionFocusDecision['route'] = current?.ref.kind === 'booking' ? 'booking'
        : current?.ref.kind === 'procedure' ? 'procedure' : 'tools';
    let action: MissionFocusDecision['action'] = 'continue';
    let invalidate = false;
    const resume = isResumeMessage(input.text) || isNamedMissionResume(input.text);
    const taskDirective = containsMissionDirective(input.text) && !isInformationSeekingMessage(input.text);
    const unqualifiedCancel = dialogue.intent === 'cancel' && isCollectionCancellation(input.text);
    const choose = (candidate: MissionCandidate) => {
        selected = candidate.ref;
        route = candidate.ref.kind === 'tool' ? 'tools' : candidate.ref.kind;
        action = candidate.saved && candidate.paused ? 'resume' : 'select';
        invalidate = true;
    };
    // No wording can select two owners, including a correction combined with a
    // new task. Keeping the slots intact is preferable to inventing ownership.
    if ((taskDirective || resume) && (domains.length > 1 || unique.length > 1)) {
        action = 'clarify'; route = 'clarify'; invalidate = true;
    } else if (resume) {
        const targets = isNamedMissionResume(input.text) ? unique.filter(candidate => candidate.saved) : saved;
        if (targets.length === 1) choose(targets[0]);
        else { action = 'clarify'; route = 'clarify'; invalidate = true; }
    } else if (isPauseMessage(input.text)) {
        action = 'pause'; route = 'dialogue'; invalidate = true;
    } else if (dialogue.intent === 'cancel' && !unqualifiedCancel) {
        if (domains.length !== 1) { route = 'clarify'; action = 'clarify'; }
        else {
            selected = { id: randomUUID(), kind: 'tool', domain: domains[0] };
            route = 'tools'; action = 'cancel';
        }
        invalidate = true;
    } else if (isDirectedCorrection(input.text)) {
        action = 'correct'; invalidate = true;
        if (!current || current.paused || (domains.length && current.ref.domain && !domains.includes(current.ref.domain))) route = 'clarify';
    } else if ((taskDirective || !current && !isInformationSeekingMessage(input.text)) && unique.length === 1) {
        choose(unique[0]);
    } else if (taskDirective && domains.length === 1) {
        selected = { id: randomUUID(), kind: domains[0] === 'appointment' ? 'booking' : 'tool', domain: domains[0] };
        route = selected.kind === 'booking' ? 'booking' : 'tools'; action = 'select'; invalidate = true;
    } else if (unqualifiedCancel && current) {
        action = 'cancel'; invalidate = true;
    } else if (!current && saved.length > 1 && ['affirm', 'continue', 'acknowledge'].includes(dialogue.intent)) {
        route = 'clarify'; action = 'clarify'; invalidate = true;
    } else if (current?.paused) {
        route = 'tools'; selected = null;
        if (['affirm', 'continue', 'acknowledge'].includes(dialogue.intent)) { route = 'clarify'; action = 'clarify'; }
        invalidate = true;
    } else if (isInformationSeekingMessage(input.text)) {
        // A question is not an answer to a pending authorization challenge.
        // Retain the task, but any later yes needs a new proposal.
        invalidate = true;
    }
    if (selected?.id !== state.selected?.id) invalidate = true;
    if (state.selected?.kind === 'tool' && state.selected.reference
        && (selected?.id !== state.selected.id || action === 'pause' || action === 'clarify')) {
        const otherPaused = (state.pausedTools || []).filter(item => item.ref.id !== state.selected!.id);
        if (otherPaused.length >= 6) { action = 'clarify'; route = 'clarify'; selected = state.selected; }
        else state.pausedTools = [...otherPaused, { ref: state.selected, pausedAt: new Date().toISOString() }];
    }
    if (action === 'pause') selected = null;
    if ((action as MissionFocusDecision['action']) === 'resume') state.pausedTools = (state.pausedTools || []).filter(item => item.ref.id !== selected?.id);
    if (invalidate) { state.revision += 1; state.expectedReply = null; }
    state.selected = selected;
    if (!state.selected && route === 'tools') state.selected = { id: randomUUID(), kind: 'tool' };
    const switching = action === 'select' || (action as MissionFocusDecision['action']) === 'resume' || action === 'cancel';
    return { state, route, action,
        selectedProcedureId: selected?.kind === 'procedure' ? selected.reference : undefined,
        pauseBooking: saved.some(candidate => candidate.ref.kind === 'booking' && !candidate.paused)
            && (route === 'clarify' || action === 'pause' || (switching && route !== 'booking')),
        pauseProcedure: saved.some(candidate => candidate.ref.kind === 'procedure' && !candidate.paused)
            && (route === 'clarify' || action === 'pause' || (switching && route !== 'procedure')),
        invalidateConfirmation: invalidate,
    };
}

export function missionDialogue(language: string, kind: 'clarify' | 'paused' | 'correction' | 'invalidCorrection' | 'replay'): string {
    const messages = {
        es: { clarify: 'Hay más de una gestión posible. ¿Cuál quieres continuar?', paused: 'La gestión queda pausada y conserva sus datos. ¿Qué necesitas hacer ahora?', correction: 'Actualicé ese dato. Revisa la propuesta de nuevo antes de confirmar.', invalidCorrection: 'Necesito identificar un solo dato para corregirlo. ¿Qué campo quieres cambiar y cuál es el valor correcto?' },
        en: { clarify: 'There is more than one possible task. Which one would you like to continue?', paused: 'The task is paused and its details are saved. What would you like to do now?', correction: 'I updated that detail. Review the proposal again before confirming.', invalidCorrection: 'I need to identify a single detail to correct. Which field would you like to change, and what is its correct value?' },
        pt: { clarify: 'Há mais de uma tarefa possível. Qual você quer continuar?', paused: 'A tarefa está pausada e os dados foram mantidos. O que você precisa fazer agora?', correction: 'Atualizei esse dado. Revise a proposta novamente antes de confirmar.', invalidCorrection: 'Preciso identificar um único dado para corrigir. Qual campo você quer alterar e qual é o valor correto?' },
        fr: { clarify: 'Plusieurs démarches sont possibles. Laquelle souhaitez-vous poursuivre ?', paused: 'La démarche est en pause et ses informations sont conservées. Que souhaitez-vous faire maintenant ?', correction: 'Cette information a été mise à jour. Vérifiez à nouveau la proposition avant de confirmer.', invalidCorrection: 'Je dois identifier une seule information à corriger. Quel champ souhaitez-vous modifier et quelle est sa valeur correcte ?' },
    };
    if (kind === 'replay') return ({ es: 'Este mensaje ya se procesó. ¿Qué necesitas hacer ahora?', en: 'This message has already been processed. What would you like to do now?', pt: 'Esta mensagem já foi processada. O que você precisa fazer agora?', fr: 'Ce message a déjà été traité. Que souhaitez-vous faire maintenant ?' } as Record<string, string>)[language] || 'Este mensaje ya se procesó. ¿Qué necesitas hacer ahora?';
    return (messages[language as keyof typeof messages] || messages.es)[kind];
}

const SLOT_ALIASES: Record<string, string[]> = {
    email: ['correo', 'correo electronico', 'email', 'e mail', 'courriel'],
    name: ['nombre', 'name', 'nome', 'nom'],
    phone: ['telefono', 'numero', 'phone', 'telephone', 'telefone'],
    date: ['fecha', 'date', 'data'], time: ['hora', 'time', 'heure'],
};
/** A correction must name exactly one known field and one value. No LLM inference. */
export function parseDirectedSlotCorrection(text: string, fields: Array<{ field: string; type: string }>): { field: string; value: string } | null {
    if (!isDirectedCorrection(text) || mentionedMissionDomains(text).length > 1) return null;
    const original = text.normalize('NFC');
    const normalized = original.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const matches = fields.flatMap(field => {
        const aliases = [...(SLOT_ALIASES[field.type] || []), normalizeForIntent(field.field)];
        const found = aliases.map(alias => ({ alias, match: new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).exec(normalized) }))
            .filter(item => item.match).sort((a, b) => (a.match!.index - b.match!.index) || b.alias.length - a.alias.length)[0];
        return found ? [{ ...field, start: found.match!.index, end: found.match!.index + found.alias.length }] : [];
    });
    if (matches.length !== 1) return null;
    // Normalization strips accents but preserves character positions for these
    // prefixes. Use the original suffix so names/email retain their spelling.
    const suffix = original.slice(matches[0].end)
        .replace(/^\s*(?:(?:correcto|correct|certo|correto|nouveau|nova|nuevo)\s*)?(?:(?:es|is|e|est|a|to|para)\b\s*|[:=]\s*)/i, '').trim();
    if (!suffix || /\b(?:y tambien|y ademas|and|also|e tambem|et|puis|pero|but|mais)\b/i.test(suffix)
        || containsMissionDirective(suffix)) return null;
    return { field: matches[0].field, value: suffix };
}
