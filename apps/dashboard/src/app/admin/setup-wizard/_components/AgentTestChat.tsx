"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Send, Bot, User, Loader2, Pencil } from "lucide-react";

interface AgentTestChatProps {
    tenantId: string;
    agentId: string | null;
    configurationRevisionId?: string;
    blocked?: boolean;
    suggestions?: string[];
}

type Turn = { role: "user" | "assistant"; content: string };

/** What `POST /agent-test` answers when the plan's AI messages ran out this period. */
const QUOTA_EXHAUSTED = "ai_message_quota_exceeded";

/**
 * The one sentence a failed try gets.
 *
 * The quota is the only limit worth naming, and only once the server says it
 * was reached: a first try on a new agent is not the moment to be warned about
 * spending messages. Before this the raw code reached the owner as the error.
 */
export function agentTestErrorKey(response: { error?: unknown; errorCode?: unknown } | null | undefined): "quotaReached" | null {
    return response?.errorCode === QUOTA_EXHAUSTED || response?.error === QUOTA_EXHAUSTED ? "quotaReached" : null;
}

/**
 * The status line above the chat, or nothing.
 *
 * Immediate mode — the default — tests what answers customers, and there is
 * nothing to tell apart: the line used to say "Estás probando la versión
 * operativa" to an owner who has one agent and no versions. It speaks only
 * when there is something to say: the change she is typing is not saved yet,
 * or (reviewed mode) the chat runs the saved draft rather than what answers.
 */
export function agentTestStatusKey({ blocked, agentId, configurationRevisionId }: {
    blocked?: boolean; agentId: string | null; configurationRevisionId?: string;
}): { namespace: "setupWizard.test" | "agentDraft"; key: string } | null {
    if (blocked && agentId) return { namespace: "setupWizard.test", key: "saveFirst" };
    if (!blocked && configurationRevisionId) return { namespace: "agentDraft", key: "testingDraft" };
    return null;
}

export default function AgentTestChat({ tenantId, agentId, configurationRevisionId, blocked, suggestions = [] }: AgentTestChatProps) {
    const t = useTranslations("setupWizard.test");
    const tDraft = useTranslations('agentDraft');
    const runtimeSessionId = useRef<string | undefined>(undefined);
    const requestScope = useRef(0);
    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const [correcting, setCorrecting] = useState<number | null>(null);
    const [correction, setCorrection] = useState("");
    const [savingCorrection, setSavingCorrection] = useState(false);
    const [correctionSaved, setCorrectionSaved] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        requestScope.current++; runtimeSessionId.current = undefined;
        setTurns([]); setError(''); setSending(false); setCorrecting(null); setCorrectionSaved(false);
    }, [tenantId, agentId, configurationRevisionId, blocked]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [turns, sending]);

    const send = async () => {
        if (!agentId || !input.trim() || sending || blocked) return;
        const scope = requestScope.current;
        const msg = input.trim();
        setInput("");
        setError("");
        const history = turns.map((tr) => ({ role: tr.role, content: tr.content }));
        setTurns((prev) => [...prev, { role: "user", content: msg }]);
        setSending(true);
        try {
            const res: any = await api.testAgent(tenantId, agentId, {
                message: msg, conversationHistory: history, configurationRevisionId,
                runtimeSessionId: runtimeSessionId.current,
                options: { surface: 'setup_wizard' },
            });
            if (scope !== requestScope.current) return;
            if (res?.success && res?.data?.reply) {
                setTurns((prev) => [...prev, { role: "assistant", content: res.data.reply }]);
                runtimeSessionId.current = res.data.debug?.runtimeSessionId;
            } else {
                const known = agentTestErrorKey(res);
                setError(known ? t(known) : res?.error || t("error"));
            }
        } catch (e: any) {
            if (scope !== requestScope.current) return;
            setError(e?.message || t("error"));
        }
        setSending(false);
    };

    const status = agentTestStatusKey({ blocked, agentId, configurationRevisionId });
    const statusText = status ? (status.namespace === "agentDraft" ? tDraft(status.key) : t(status.key)) : "";

    const saveCorrection = async (assistantIndex: number) => {
        const question = [...turns.slice(0, assistantIndex)].reverse().find((turn) => turn.role === "user")?.content;
        if (!question || !correction.trim() || savingCorrection) return;
        setSavingCorrection(true);
        setError("");
        try {
            await api.createFaq(tenantId, {
                question,
                answer: correction.trim(),
                category: "onboarding_correction",
                tags: ["onboarding"],
                isPublished: true,
            });
            setCorrecting(null);
            setCorrectionSaved(true);
        } catch {
            setError(t("correctionError"));
        } finally {
            setSavingCorrection(false);
        }
    };

    return (
        <div className="flex flex-col h-[340px] rounded-xl border border-neutral-200 dark:border-white/10 overflow-hidden bg-white dark:bg-white/[0.02]">
            {/* Always mounted, so a status that appears later is announced;
                visually present only when it has something to say. */}
            <p role="status" data-agent-test-status className={statusText ? "px-3 py-2 text-xs font-medium" : "sr-only"}>{statusText}</p>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {turns.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-2 px-4">
                        <Bot size={28} className="text-indigo-500" />
                        <p>{t("tryExamples")}</p>
                    </div>
                )}
                {turns.length === 0 && suggestions.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2 px-2">
                        {suggestions.slice(0, 3).map((suggestion) => (
                            <button key={suggestion} type="button" disabled={blocked || !agentId}
                                onClick={() => setInput(suggestion)}
                                className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-800 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
                                {suggestion}
                            </button>
                        ))}
                    </div>
                )}
                {turns.map((turn, i) => (
                    <div key={i} className={`flex gap-2.5 ${turn.role === "user" ? "justify-end" : ""}`}>
                        {turn.role === "assistant" && (
                            <div className="h-7 w-7 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center shrink-0">
                                <Bot size={13} className="text-indigo-600" />
                            </div>
                        )}
                        <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${turn.role === "user" ? "bg-indigo-600 text-white rounded-br-sm" : "bg-neutral-100 dark:bg-white/[0.06] text-foreground rounded-bl-sm"}`}>
                            <p className="whitespace-pre-wrap">{turn.content}</p>
                            {turn.role === "assistant" && correcting !== i && (
                                <button type="button" onClick={() => { setCorrecting(i); setCorrection(turn.content); setCorrectionSaved(false); }}
                                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300">
                                    <Pencil size={11} aria-hidden="true" /> {t("correctAnswer")}
                                </button>
                            )}
                            {turn.role === "assistant" && correcting === i && (
                                <div className="mt-2">
                                    <label className="sr-only" htmlFor={`correction-${i}`}>{t("correctionLabel")}</label>
                                    <textarea id={`correction-${i}`} value={correction} onChange={(event) => setCorrection(event.target.value)} rows={3}
                                        className="w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs text-foreground dark:border-white/10 dark:bg-neutral-900" />
                                    <div className="mt-1.5 flex gap-2">
                                        <button type="button" disabled={savingCorrection || !correction.trim()} onClick={() => void saveCorrection(i)}
                                            className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
                                            {savingCorrection ? t("savingCorrection") : t("saveCorrection")}
                                        </button>
                                        <button type="button" onClick={() => setCorrecting(null)} className="px-2 text-[11px] text-muted-foreground">
                                            {t("cancelCorrection")}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        {turn.role === "user" && (
                            <div className="h-7 w-7 rounded-full bg-neutral-200 dark:bg-white/10 flex items-center justify-center shrink-0">
                                <User size={13} className="text-muted-foreground" />
                            </div>
                        )}
                    </div>
                ))}
                {sending && (
                    <div className="flex gap-2.5">
                        <div className="h-7 w-7 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                            <Bot size={13} className="text-indigo-600" />
                        </div>
                        <div className="rounded-2xl px-3.5 py-2 bg-neutral-100 dark:bg-white/[0.06]">
                            <Loader2 size={14} className="animate-spin text-muted-foreground" />
                        </div>
                    </div>
                )}
            </div>
            {error && <p className="px-4 py-1.5 text-xs text-red-500">{error}</p>}
            {correctionSaved && <p role="status" className="px-4 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">{t("correctionSaved")}</p>}
            <div className="border-t border-neutral-200 dark:border-white/10 p-3">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                        disabled={sending || !agentId || blocked}
                        placeholder={t("placeholder")}
                        className="flex-1 h-10 rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3 text-sm text-foreground outline-none focus:border-indigo-500"
                    />
                    <button
                        onClick={send}
                        disabled={sending || !input.trim() || !agentId || blocked}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-4 text-sm font-medium text-white cursor-pointer"
                    >
                        <Send size={14} /> {t("send")}
                    </button>
                </div>
                {/* A footnote, not a warning: what a try does not do. */}
                <p data-agent-test-footnote className="mt-2 text-[11px] text-muted-foreground">{t("limitations")}</p>
            </div>
        </div>
    );
}
