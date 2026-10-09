import { randomUUID } from 'crypto';
import { arbitrateMissionFocus, newMissionFocus, toolMissionDomain } from '../mission-focus';
import {
    detectTransition, handleIdentityReply, runTransition, transitionDoneText, transitionFailureText, TRANSITION_TOOLS, TRANSITION_WRITER,
    type TransitionIO, type TransitionOutcome,
} from '../transition-engine';
import { authorityFor } from './tool-authority.fixture';
import type { openLive } from './n3-live-harness';

/**
 * One customer's conversation with the transition engine, wired the way ConversationsService wires it (arbiter → pending
 * verification code → engine → server-side yes → report of a failed write), but over the REAL executor, the REAL central guard
 * (ledger, signed confirmation, mission claims, identity step-up per business type) and the real writers on disposable
 * PostgreSQL. Only the glue is reproduced; every decision it relies on is the production module.
 *
 * `identityChallenge: 'none'` is what the service passes for the engine's own calls: a read never sends a code by itself.
 */
export function transitionChat(h: Awaited<ReturnType<typeof openLive>>, scope: any, contactId: string, conversationId: string, options: {
    available: ReadonlySet<string>; todayIso: string; language?: string;
}) {
    let state = newMissionFocus();
    let loadedAt = Date.now();
    const log: Array<{ by: string; text: string | null }> = [];

    const turn = async (text: string): Promise<{ by: 'engine' | 'server-yes' | 'model'; reply: string | null; detected?: any; result?: any }> => {
        const messageId = await h.inbound(conversationId, text);
        const priorPendingTool = state.expectedReply?.kind === 'confirmation' && state.selected?.kind === 'tool' ? state.selected.toolName : undefined;
        const decision = arbitrateMissionFocus({ state, candidates: [], text, messageId });
        state = decision.state;
        const scopeOf = () => ({ version: 1, missionId: state.selected?.id || 'unselected', revision: state.revision, inboundMessageId: messageId,
            kind: state.selected?.kind || 'tool', executionOwner: 'tool', domain: state.selected?.domain, toolName: state.selected?.toolName,
            writeBlocked: decision.route === 'clarify', expectedReply: state.expectedReply ? structuredClone(state.expectedReply) : null });
        const execute = async (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
            const result = await h.call(contactId, conversationId, name, args, scope, {
                missionScope: scopeOf(), authority: authorityFor(name), identityChallenge: 'none', ...extra,
            });
            if (result?.error === 'confirmation_required' && typeof result.confirmationId === 'string') {
                state.selected ||= { id: randomUUID(), kind: 'tool' };
                Object.assign(state.selected, { reference: result.confirmationId, toolName: name, domain: toolMissionDomain(name) });
                state.expectedReply = { missionId: state.selected.id, proposalId: result.confirmationId, ledgerId: result.confirmationId, sourceMessageId: messageId, kind: 'confirmation' } as any;
            }
            return result;
        };
        const io: TransitionIO = { execute, interpretTarget: async () => null, todayIso: options.todayIso, language: options.language ?? 'es', form: 'usted' };
        const record = (outcome: TransitionOutcome) => {
            if (outcome.awaitingIdentity !== undefined) {
                if (outcome.awaitingIdentity) state.pendingIdentity = outcome.awaitingIdentity; else delete state.pendingIdentity;
            }
            if (outcome.awaitingWriter && state.selected?.kind === 'tool' && !state.selected.reference) state.selected.toolName = outcome.awaitingWriter;
        };

        // 4b1 — the customer answers the code the server asked for
        if (state.pendingIdentity) {
            const outcome = await handleIdentityReply(state.pendingIdentity, text, io);
            record(outcome);
            if (outcome.handled && outcome.text) { log.push({ by: 'engine', text: outcome.text }); return { by: 'engine', reply: outcome.text }; }
        }

        // 4b2 — a change to something that exists
        const awaitingWriter = state.selected?.kind === 'tool' && !state.selected.reference && state.selected.toolName && TRANSITION_TOOLS.has(state.selected.toolName)
            && !state.expectedReply ? state.selected.toolName : undefined;
        const detected = detectTransition({ text, available: options.available, missionDomain: state.selected?.domain, missionToolName: priorPendingTool ?? state.selected?.toolName,
            awaitingWriter, awaitingFresh: Date.now() - loadedAt < 15 * 60_000, pendingConfirmation: !!priorPendingTool || state.expectedReply?.kind === 'confirmation' });
        loadedAt = Date.now();
        if (detected?.kind === 'request') {
            const writer = TRANSITION_WRITER[`${detected.request.verb}:${detected.request.domain}`];
            const pending = priorPendingTool && writer && priorPendingTool === writer
                ? await h.control.findPendingConfirmation(h.schema, conversationId, contactId, undefined, scopeOf() as any) : null;
            const outcome = await runTransition(detected.request, text, io, {
                continuation: detected.continuation, restate: detected.restate === true, pending,
                pendingIdentity: state.pendingIdentity && state.pendingIdentity.verb === detected.request.verb && state.pendingIdentity.domain === detected.request.domain ? state.pendingIdentity : null,
            });
            record(outcome);
            if (outcome.handled && outcome.text) { log.push({ by: 'engine', text: outcome.text }); return { by: 'engine', reply: outcome.text, detected }; }
        }

        // 4c — the yes: the server executes the pending proposal
        const pending = await h.control.findPendingConfirmation(h.schema, conversationId, contactId, text, scopeOf() as any);
        if (pending) {
            const result = await execute(pending.toolName, pending.args, { identityChallenge: TRANSITION_TOOLS.has(pending.toolName) ? 'none' : 'start' });
            const success = result && !result.error && result.success !== false;
            const reply = success ? transitionDoneText(pending.toolName, pending.args, result, io.language, 'usted')
                : TRANSITION_TOOLS.has(pending.toolName) ? await transitionFailureText(pending.toolName, pending.args, io) : null;
            log.push({ by: 'server-yes', text: reply });
            return { by: 'server-yes', reply, result, detected };
        }
        return { by: 'model', reply: null, detected };
    };
    return { turn, log, get state() { return state; } };
}
