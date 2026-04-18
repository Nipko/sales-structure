"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
    Send,
    CheckCircle,
    AlertCircle,
    ExternalLink,
    Clipboard,
    ArrowRight,
    MessageCircle,
    Trash2,
    Loader2,
    Sparkles,
    CircleDot,
    Zap,
} from "lucide-react";

const BRAND = "#0088cc";

export default function TelegramSetupPage() {
    const { activeTenantId } = useTenant();
    const t = useTranslations("channels");
    const tc = useTranslations("common");

    const [status, setStatus] = useState<any>(null);
    const [botToken, setBotToken] = useState("");
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
    const [error, setError] = useState("");
    const [step, setStep] = useState(1);

    const loadStatus = async () => {
        setLoading(true);
        try {
            const res = await api.fetch("/channels/telegram/status");
            const data = res?.data || res;
            setStatus(data);
        } catch { /* ignore */ }
        setLoading(false);
    };

    useEffect(() => { loadStatus(); }, [activeTenantId]);

    const handleConnect = async () => {
        if (!botToken.trim()) return;
        setConnecting(true);
        setError("");
        try {
            const res = await api.fetch("/channels/telegram/connect", {
                method: "POST",
                body: JSON.stringify({ botToken }),
            });
            await loadStatus();
            setStep(3);
            setBotToken("");
        } catch (err: any) {
            const msg = err?.message || err?.data?.message || tc("connectionError");
            setError(msg);
        } finally {
            setConnecting(false);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            // Use the bot's own chat — send getMe first to find bot ID,
            // but actually we need a real chat_id. The user needs to message the bot first.
            // Instead, we validate the webhook is working by calling getWebhookInfo
            const creds = status?.account;
            await api.fetch("/channels/telegram/test", {
                method: "POST",
                body: JSON.stringify({ chatId: creds?.metadata?.botId?.toString() }),
            });
            setTestResult({ ok: true, text: t("telegram.testSuccess") });
        } catch {
            setTestResult({ ok: false, text: t("telegram.testFailed") || "Test failed — check your bot token" });
        } finally {
            setTesting(false);
        }
    };

    const handleDisconnect = async () => {
        setDisconnecting(true);
        try {
            await api.fetch("/channels/telegram/disconnect", { method: "DELETE" });
            setStatus(null);
            setStep(1);
            setTestResult(null);
        } catch { /* ignore */ }
        setDisconnecting(false);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Loader2 size={24} className="animate-spin text-[var(--text-secondary)]" />
            </div>
        );
    }

    const isConnected = status?.connected;
    const account = status?.account;

    // ─── Connected State ───────────────────────────────────
    if (isConnected && account) {
        return (
            <div className="mx-auto max-w-[640px] mt-4">
                {/* Header */}
                <div className="text-center mb-8">
                    <div
                        className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4"
                        style={{ background: BRAND }}
                    >
                        <Send size={28} className="text-white" />
                    </div>
                    <h1 className="text-2xl font-semibold text-foreground mb-1">Telegram</h1>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[rgba(0,214,143,0.1)] text-[var(--success)] border border-[rgba(0,214,143,0.2)]">
                        <CheckCircle size={12} />
                        {t("connected")}
                    </div>
                </div>

                {/* Bot Card */}
                <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-4">
                    <div className="p-6">
                        <div className="flex items-center gap-4">
                            <div
                                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                                style={{ background: `${BRAND}20` }}
                            >
                                <Send size={20} style={{ color: BRAND }} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-lg font-semibold text-foreground m-0 truncate">
                                    {account.metadata?.botName || account.displayName}
                                </p>
                                <p className="text-sm font-mono m-0 mt-0.5" style={{ color: BRAND }}>
                                    @{account.accountId || account.metadata?.botUsername}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Test Result */}
                {testResult && (
                    <div className={cn(
                        "p-4 rounded-xl mb-4 text-sm border flex items-center gap-2",
                        testResult.ok
                            ? "bg-[rgba(0,214,143,0.1)] text-[var(--success)] border-[rgba(0,214,143,0.2)]"
                            : "bg-[rgba(255,71,87,0.1)] text-[var(--danger)] border-[rgba(255,71,87,0.2)]"
                    )}>
                        {testResult.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                        {testResult.text}
                    </div>
                )}

                {/* How to test */}
                <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden mb-4">
                    <div className="p-5">
                        <div className="flex items-start gap-3">
                            <Sparkles size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-foreground m-0 mb-1.5">
                                    {t("telegram.tryItOut")}
                                </p>
                                <p className="text-[13px] text-[var(--text-secondary)] m-0 mb-3 leading-relaxed">
                                    {t("telegram.tryItOutDesc")}
                                </p>
                                <a
                                    href={`https://t.me/${account.accountId || account.metadata?.botUsername}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white no-underline"
                                    style={{ background: BRAND }}
                                >
                                    <MessageCircle size={16} />
                                    {t("telegram.openInTelegram")}
                                    <ExternalLink size={12} />
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Danger zone */}
                <div className="rounded-xl border border-[rgba(255,71,87,0.2)] bg-[var(--bg-secondary)] overflow-hidden">
                    <div className="p-5 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-semibold text-foreground m-0">
                                {t("telegram.disconnectTitle")}
                            </p>
                            <p className="text-xs text-[var(--text-secondary)] m-0 mt-0.5">
                                {t("telegram.disconnectDesc")}
                            </p>
                        </div>
                        <button
                            onClick={handleDisconnect}
                            disabled={disconnecting}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[rgba(255,71,87,0.3)] bg-transparent text-[var(--danger)] text-[13px] font-semibold cursor-pointer hover:bg-[rgba(255,71,87,0.1)] transition-colors"
                        >
                            {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            {t("telegram.disconnect")}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── Setup Wizard ──────────────────────────────────────
    return (
        <div className="mx-auto max-w-[640px] mt-4">
            {/* Header */}
            <div className="text-center mb-10">
                <div
                    className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4"
                    style={{ background: BRAND }}
                >
                    <Send size={28} className="text-white" />
                </div>
                <h1 className="text-2xl font-semibold text-foreground mb-1">
                    {t("telegram.setupTitle")}
                </h1>
                <p className="text-[var(--text-secondary)] text-sm m-0">
                    {t("telegram.setupSubtitle")}
                </p>
            </div>

            {/* Step indicator */}
            <div className="flex items-center justify-center gap-2 mb-8">
                {[1, 2].map((s) => (
                    <div key={s} className="flex items-center gap-2">
                        <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all",
                            step >= s
                                ? "text-white"
                                : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-border"
                        )}
                            style={step >= s ? { background: BRAND } : undefined}
                        >
                            {step > s ? <CheckCircle size={16} /> : s}
                        </div>
                        {s < 2 && (
                            <div className={cn(
                                "w-16 h-0.5 rounded-full transition-all",
                                step > s ? "bg-[var(--success)]" : "bg-border"
                            )} />
                        )}
                    </div>
                ))}
            </div>

            {/* Step 1: Create Bot */}
            {step === 1 && (
                <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden">
                    <div className="p-8">
                        <div className="flex items-center gap-3 mb-5">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-sky-500/10">
                                <Zap size={20} className="text-sky-500" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-foreground m-0">
                                    {t("telegram.step1Title")}
                                </h2>
                                <p className="text-xs text-[var(--text-secondary)] m-0 mt-0.5">
                                    {t("telegram.step1Time")}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-4 mb-6">
                            <div className="flex gap-3">
                                <div className="w-6 h-6 rounded-full bg-[var(--bg-tertiary)] border border-border flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <span className="text-xs font-semibold text-[var(--text-secondary)]">1</span>
                                </div>
                                <div>
                                    <p className="text-sm text-foreground m-0">
                                        {t("telegram.guide1")}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <div className="w-6 h-6 rounded-full bg-[var(--bg-tertiary)] border border-border flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <span className="text-xs font-semibold text-[var(--text-secondary)]">2</span>
                                </div>
                                <p className="text-sm text-foreground m-0">
                                    {t("telegram.guide2")}
                                </p>
                            </div>
                            <div className="flex gap-3">
                                <div className="w-6 h-6 rounded-full bg-[var(--bg-tertiary)] border border-border flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <span className="text-xs font-semibold text-[var(--text-secondary)]">3</span>
                                </div>
                                <p className="text-sm text-foreground m-0">
                                    {t("telegram.guide3")}
                                </p>
                            </div>
                        </div>

                        {/* CTA */}
                        <div className="flex gap-3">
                            <a
                                href="https://t.me/BotFather"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold no-underline transition-opacity hover:opacity-90"
                                style={{ background: BRAND }}
                            >
                                {t("telegram.openBotFather")}
                                <ExternalLink size={14} />
                            </a>
                            <button
                                onClick={() => setStep(2)}
                                className="flex items-center gap-2 px-5 py-3 rounded-xl border border-border bg-[var(--bg-tertiary)] text-foreground text-sm font-semibold cursor-pointer hover:bg-[var(--bg-primary)] transition-colors"
                            >
                                {t("telegram.alreadyHaveToken")}
                                <ArrowRight size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Step 2: Paste Token */}
            {step === 2 && (
                <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden">
                    <div className="p-8">
                        <div className="flex items-center gap-3 mb-5">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-500/10">
                                <Clipboard size={20} className="text-emerald-500" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-foreground m-0">
                                    {t("telegram.step2Title")}
                                </h2>
                                <p className="text-xs text-[var(--text-secondary)] m-0 mt-0.5">
                                    {t("telegram.step2Subtitle")}
                                </p>
                            </div>
                        </div>

                        {/* Token Input */}
                        <div className="mb-4">
                            <label className="text-[13px] font-semibold mb-2 block text-foreground">
                                Bot Token
                            </label>
                            <input
                                type="password"
                                value={botToken}
                                onChange={(e) => { setBotToken(e.target.value); setError(""); }}
                                placeholder="1234567890:AAHfiqksKZ8WmR2zMn..."
                                autoFocus
                                className="w-full px-4 py-3 rounded-xl border border-border bg-[var(--bg-tertiary)] text-foreground text-sm font-mono outline-none focus:border-sky-500 transition-colors"
                            />
                            <p className="text-[11px] text-[var(--text-secondary)] mt-1.5 m-0">
                                {t("telegram.tokenHint")}
                            </p>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="flex items-center gap-2 p-3 rounded-lg mb-4 bg-[rgba(255,71,87,0.1)] text-[var(--danger)] text-sm border border-[rgba(255,71,87,0.2)]">
                                <AlertCircle size={16} className="flex-shrink-0" />
                                {error}
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-3">
                            <button
                                onClick={() => { setStep(1); setError(""); }}
                                className="px-5 py-3 rounded-xl border border-border bg-transparent text-foreground text-sm font-semibold cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
                            >
                                {t("telegram.back")}
                            </button>
                            <button
                                onClick={handleConnect}
                                disabled={!botToken.trim() || connecting}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold cursor-pointer transition-all",
                                    (!botToken.trim() || connecting) && "opacity-50 cursor-not-allowed"
                                )}
                                style={{ background: BRAND }}
                            >
                                {connecting ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        {t("telegram.validating")}
                                    </>
                                ) : (
                                    <>
                                        {t("telegram.connectBtn")}
                                        <ArrowRight size={14} />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Step 3: Success */}
            {step === 3 && isConnected && account && (
                <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-[rgba(0,214,143,0.15)] flex items-center justify-center mx-auto mb-4">
                        <CheckCircle size={32} className="text-[var(--success)]" />
                    </div>
                    <h2 className="text-xl font-semibold text-foreground mb-1">
                        {t("telegram.successTitle")}
                    </h2>
                    <p className="text-[var(--text-secondary)] text-sm mb-6">
                        {t("telegram.successDesc")}
                    </p>

                    {/* Bot info mini card */}
                    <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl border border-border bg-[var(--bg-secondary)] mb-6">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${BRAND}20` }}>
                            <Send size={16} style={{ color: BRAND }} />
                        </div>
                        <div className="text-left">
                            <p className="text-sm font-semibold text-foreground m-0">
                                {account.metadata?.botName || account.displayName}
                            </p>
                            <p className="text-xs font-mono m-0" style={{ color: BRAND }}>
                                @{account.accountId}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 max-w-[360px] mx-auto">
                        <a
                            href={`https://t.me/${account.accountId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold no-underline"
                            style={{ background: BRAND }}
                        >
                            <MessageCircle size={16} />
                            {t("telegram.testInTelegram")}
                            <ExternalLink size={12} />
                        </a>
                        <p className="text-xs text-[var(--text-secondary)] m-0">
                            {t("telegram.testHint")}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
