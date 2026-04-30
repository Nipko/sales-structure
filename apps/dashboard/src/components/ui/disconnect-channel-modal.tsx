"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, X } from "lucide-react";

interface DisconnectChannelModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    channelName: string;
    description: string;
    loading?: boolean;
}

export function DisconnectChannelModal({
    open,
    onClose,
    onConfirm,
    channelName,
    description,
    loading = false,
}: DisconnectChannelModalProps) {
    const tc = useTranslations("common");

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
        >
            <div className="w-full max-w-[420px] rounded-xl border border-border bg-[var(--bg-secondary)] shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-6 pb-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[rgba(231,76,60,0.1)] flex items-center justify-center">
                            <AlertTriangle size={20} className="text-[#e74c3c]" />
                        </div>
                        <h3 className="text-base font-semibold text-foreground m-0">
                            {tc("disconnectChannel.title", { channel: channelName })}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer bg-transparent border-none"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5">
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed m-0">
                        {description}
                    </p>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 pb-6">
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="px-4 py-2.5 rounded-lg border border-border bg-[var(--bg-tertiary)] text-foreground text-[13px] font-medium cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={loading}
                        className="px-4 py-2.5 rounded-lg border border-[rgba(231,76,60,0.3)] bg-[rgba(231,76,60,0.1)] text-[#e74c3c] text-[13px] font-semibold cursor-pointer hover:bg-[rgba(231,76,60,0.2)] transition-colors disabled:opacity-50"
                    >
                        {loading ? tc("disconnectChannel.disconnecting") : tc("disconnectChannel.confirm")}
                    </button>
                </div>
            </div>
        </div>
    );
}
