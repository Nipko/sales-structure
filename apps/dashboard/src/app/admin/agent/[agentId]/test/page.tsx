"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTenant } from "@/contexts/TenantContext";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { ArrowLeft, Send, Wrench, Search, FileCode, Activity, RotateCcw, Bot, User, Loader2 } from "lucide-react";

type Turn = {
    role: "user" | "assistant";
    content: string;
    debug?: DebugInfo;
};

type DebugInfo = {
    systemPrompt: string;
    toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown; durationMs: number }>;
    ragHits: Array<{ source: string; id: string; score?: number; title?: string; content: string }>;
    tokens: { input: number; output: number };
    cost: number;
    model: string;
    latencyMs: number;
    turnContext: Record<string, unknown>;
};

type DebugTab = "prompt" | "tools" | "rag" | "metrics" | "turn";

export default function TestAgentPage() {
    const params = useParams();
    const router = useRouter();
    const agentId = params.agentId as string;
    const { activeTenantId } = useTenant();
    const t = useTranslations("agent.test");
    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const [debugTab, setDebugTab] = useState<DebugTab>("prompt");
    const [selectedDebug, setSelectedDebug] = useState<DebugInfo | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [turns]);

    const send = async () => {
        if (!activeTenantId || !input.trim() || sending) return;
        const userMsg = input.trim();
        setInput("");
        setError("");
        const history = turns.map(tr => ({ role: tr.role, content: tr.content }));
        setTurns(prev => [...prev, { role: "user", content: userMsg }]);
        setSending(true);

        try {
            const result = await api.testAgent(activeTenantId, agentId, {
                message: userMsg,
                conversationHistory: history,
            });
            if (result.success && result.data) {
                const debug = result.data.debug as DebugInfo;
                setTurns(prev => [...prev, { role: "assistant", content: result.data.reply, debug }]);
                setSelectedDebug(debug);
            } else {
                setError(result.error || t("errors.sendFailed"));
            }
        } catch (e: any) {
            setError(e.message || t("errors.connection"));
        }
        setSending(false);
    };

    const reset = () => {
        setTurns([]);
        setSelectedDebug(null);
        setError("");
    };

    return (
        <div className="h-[calc(100vh-64px)] flex flex-col">
            <div className="border-b border-neutral-200 dark:border-neutral-800 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Link href={`/admin/agent/${agentId}`} className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        <ArrowLeft size={18} />
                    </Link>
                    <div>
                        <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                            <Bot size={16} className="text-indigo-600" />
                            {t("title")}
                        </h1>
                        <p className="text-xs text-neutral-500">{t("subtitle")}</p>
                    </div>
                </div>
                <button
                    onClick={reset}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                    <RotateCcw size={12} />
                    {t("reset")}
                </button>
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_420px] overflow-hidden">
                {/* Chat */}
                <div className="flex flex-col border-r border-neutral-200 dark:border-neutral-800">
                    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
                        {turns.length === 0 && (
                            <div className="h-full flex items-center justify-center text-sm text-neutral-500">
                                {t("startHint")}
                            </div>
                        )}
                        {turns.map((turn, i) => (
                            <div key={i} className={`flex gap-3 ${turn.role === "user" ? "justify-end" : ""}`}>
                                {turn.role === "assistant" && (
                                    <div className="h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                                        <Bot size={14} className="text-indigo-600" />
                                    </div>
                                )}
                                <div
                                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm cursor-pointer transition-all ${
                                        turn.role === "user"
                                            ? "bg-indigo-600 text-white rounded-br-sm"
                                            : `bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-bl-sm hover:ring-2 hover:ring-indigo-500/30 ${selectedDebug === turn.debug ? "ring-2 ring-indigo-500/50" : ""}`
                                    }`}
                                    onClick={() => turn.debug && setSelectedDebug(turn.debug)}
                                >
                                    <p className="whitespace-pre-wrap">{turn.content}</p>
                                    {turn.debug && (
                                        <div className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
                                            <span>{turn.debug.model}</span>
                                            <span>·</span>
                                            <span>{turn.debug.latencyMs}ms</span>
                                            {turn.debug.toolCalls.length > 0 && (
                                                <>
                                                    <span>·</span>
                                                    <span>{turn.debug.toolCalls.length} {t("toolsUsed")}</span>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {turn.role === "user" && (
                                    <div className="h-8 w-8 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center flex-shrink-0">
                                        <User size={14} className="text-neutral-600 dark:text-neutral-300" />
                                    </div>
                                )}
                            </div>
                        ))}
                        {sending && (
                            <div className="flex gap-3">
                                <div className="h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                                    <Bot size={14} className="text-indigo-600" />
                                </div>
                                <div className="rounded-2xl px-4 py-2.5 bg-neutral-100 dark:bg-neutral-800">
                                    <Loader2 size={14} className="animate-spin text-neutral-500" />
                                </div>
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="mx-6 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                            {error}
                        </div>
                    )}

                    <div className="border-t border-neutral-200 dark:border-neutral-800 p-4">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
                                disabled={sending}
                                placeholder={t("inputPlaceholder")}
                                className="flex-1 h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500"
                            />
                            <button
                                onClick={send}
                                disabled={sending || !input.trim()}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 px-4 py-2 text-sm font-medium text-white"
                            >
                                <Send size={14} />
                                {t("send")}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Debug panel */}
                <div className="flex flex-col bg-neutral-50 dark:bg-neutral-950 overflow-hidden">
                    <div className="border-b border-neutral-200 dark:border-neutral-800 px-4">
                        <div className="flex gap-1 -mb-px">
                            {([
                                { key: "prompt", label: t("tabs.prompt"), icon: FileCode },
                                { key: "tools", label: t("tabs.tools"), icon: Wrench },
                                { key: "rag", label: t("tabs.rag"), icon: Search },
                                { key: "metrics", label: t("tabs.metrics"), icon: Activity },
                                { key: "turn", label: t("tabs.turn"), icon: FileCode },
                            ] as const).map(tab => {
                                const Icon = tab.icon;
                                const active = debugTab === tab.key;
                                return (
                                    <button
                                        key={tab.key}
                                        onClick={() => setDebugTab(tab.key)}
                                        className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-xs border-b-2 transition-colors ${
                                            active
                                                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                                                : "border-transparent text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                                        }`}
                                    >
                                        <Icon size={12} />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4">
                        {!selectedDebug ? (
                            <div className="h-full flex items-center justify-center text-xs text-neutral-500">
                                {t("selectHint")}
                            </div>
                        ) : debugTab === "prompt" ? (
                            <pre className="text-[11px] font-mono text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words leading-relaxed">
                                {selectedDebug.systemPrompt}
                            </pre>
                        ) : debugTab === "tools" ? (
                            <div className="space-y-3">
                                {selectedDebug.toolCalls.length === 0 ? (
                                    <p className="text-xs text-neutral-500">{t("noTools")}</p>
                                ) : (
                                    selectedDebug.toolCalls.map((tc, i) => (
                                        <div key={i} className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">{tc.name}</span>
                                                <span className="text-[10px] text-neutral-500">{tc.durationMs}ms</span>
                                            </div>
                                            <p className="text-[10px] text-neutral-500 mb-1">{t("args")}:</p>
                                            <pre className="text-[10px] font-mono bg-neutral-50 dark:bg-neutral-800 p-2 rounded mb-2 overflow-x-auto">
                                                {JSON.stringify(tc.args, null, 2)}
                                            </pre>
                                            <p className="text-[10px] text-neutral-500 mb-1">{t("result")}:</p>
                                            <pre className="text-[10px] font-mono bg-neutral-50 dark:bg-neutral-800 p-2 rounded overflow-x-auto max-h-48 overflow-y-auto">
                                                {JSON.stringify(tc.result, null, 2)}
                                            </pre>
                                        </div>
                                    ))
                                )}
                            </div>
                        ) : debugTab === "rag" ? (
                            <div className="space-y-3">
                                {selectedDebug.ragHits.length === 0 ? (
                                    <p className="text-xs text-neutral-500">{t("noRag")}</p>
                                ) : (
                                    selectedDebug.ragHits.map((hit, i) => (
                                        <div key={i} className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-[10px] rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 px-1.5 py-0.5">
                                                    {hit.source}
                                                </span>
                                                {hit.score != null && (
                                                    <span className="text-[10px] font-mono text-neutral-500">
                                                        {hit.score.toFixed(3)}
                                                    </span>
                                                )}
                                            </div>
                                            {hit.title && (
                                                <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100 mb-1">{hit.title}</p>
                                            )}
                                            <p className="text-[11px] text-neutral-600 dark:text-neutral-400 line-clamp-4">
                                                {hit.content}
                                            </p>
                                        </div>
                                    ))
                                )}
                            </div>
                        ) : debugTab === "metrics" ? (
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <MetricCard label={t("metric.model")} value={selectedDebug.model} />
                                    <MetricCard label={t("metric.latency")} value={`${selectedDebug.latencyMs}ms`} />
                                    <MetricCard label={t("metric.inputTokens")} value={selectedDebug.tokens.input} />
                                    <MetricCard label={t("metric.outputTokens")} value={selectedDebug.tokens.output} />
                                    <MetricCard label={t("metric.cost")} value={`$${selectedDebug.cost.toFixed(5)}`} />
                                    <MetricCard label={t("metric.toolCalls")} value={selectedDebug.toolCalls.length} />
                                </div>
                            </div>
                        ) : debugTab === "turn" ? (
                            <pre className="text-[11px] font-mono text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words leading-relaxed">
                                {JSON.stringify(selectedDebug.turnContext, null, 2)}
                            </pre>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3">
            <p className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{value}</p>
        </div>
    );
}
