"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Send, Bot, User, Loader2 } from "lucide-react";

interface AgentTestChatProps {
    tenantId: string;
}

type Turn = { role: "user" | "assistant"; content: string };

export default function AgentTestChat({ tenantId }: AgentTestChatProps) {
    const t = useTranslations("setupWizard.test");
    const [agentId, setAgentId] = useState<string | null>(null);
    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!tenantId) return;
        api.listAgents(tenantId)
            .then((res: any) => {
                const agents = res?.data || res?.agents || [];
                const active = Array.isArray(agents)
                    ? (agents.find((a: any) => a.is_active || a.is_default) || agents[0])
                    : null;
                if (active?.id) setAgentId(active.id);
            })
            .catch(() => {});
    }, [tenantId]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [turns, sending]);

    const send = async () => {
        if (!agentId || !input.trim() || sending) return;
        const msg = input.trim();
        setInput("");
        setError("");
        const history = turns.map((tr) => ({ role: tr.role, content: tr.content }));
        setTurns((prev) => [...prev, { role: "user", content: msg }]);
        setSending(true);
        try {
            const res: any = await api.testAgent(tenantId, agentId, { message: msg, conversationHistory: history });
            if (res?.success && res?.data?.reply) {
                setTurns((prev) => [...prev, { role: "assistant", content: res.data.reply }]);
            } else {
                setError(res?.error || t("error"));
            }
        } catch (e: any) {
            setError(e?.message || t("error"));
        }
        setSending(false);
    };

    return (
        <div className="flex flex-col h-[340px] rounded-xl border border-neutral-200 dark:border-white/10 overflow-hidden bg-white dark:bg-white/[0.02]">
            <p className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                {t("limitations")}
            </p>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {turns.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-2 px-4">
                        <Bot size={28} className="text-indigo-500" />
                        <p>{t("tryExamples")}</p>
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
            <div className="border-t border-neutral-200 dark:border-white/10 p-3">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                        disabled={sending || !agentId}
                        placeholder={t("placeholder")}
                        className="flex-1 h-10 rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3 text-sm text-foreground outline-none focus:border-indigo-500"
                    />
                    <button
                        onClick={send}
                        disabled={sending || !input.trim() || !agentId}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-4 text-sm font-medium text-white cursor-pointer"
                    >
                        <Send size={14} /> {t("send")}
                    </button>
                </div>
            </div>
        </div>
    );
}
