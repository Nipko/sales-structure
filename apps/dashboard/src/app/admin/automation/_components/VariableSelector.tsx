"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Braces, User, Handshake, MessageCircle, Target, Zap, ChevronDown } from "lucide-react";

const VARIABLE_GROUPS = [
    {
        key: "contact" as const,
        icon: User,
        variables: ["contact.name", "contact.phone", "contact.email", "contact.tags"],
    },
    {
        key: "deal" as const,
        icon: Handshake,
        variables: ["deal.id", "deal.stage", "deal.value"],
    },
    {
        key: "conversation" as const,
        icon: MessageCircle,
        variables: ["conversation.id", "conversation.channel"],
    },
    {
        key: "lead" as const,
        icon: Target,
        variables: ["lead.id", "lead.score", "lead.source"],
    },
    {
        key: "trigger" as const,
        icon: Zap,
        variables: ["trigger.event_type", "trigger.timestamp"],
    },
];

const GROUP_I18N: Record<string, string> = {
    contact: "httpVariableContact",
    deal: "httpVariableDeal",
    conversation: "httpVariableConversation",
    lead: "httpVariableLead",
    trigger: "httpVariableTrigger",
};

interface VariableSelectorProps {
    onInsert: (variable: string) => void;
}

export default function VariableSelector({ onInsert }: VariableSelectorProps) {
    const t = useTranslations("automation");
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as HTMLElement)) {
                setOpen(false);
            }
        }
        if (open) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [open]);

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 text-teal-400 text-xs font-medium hover:bg-teal-500/20 transition-colors"
            >
                <Braces size={13} />
                {t("httpVariables")}
                <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
                <div className="absolute z-50 top-full mt-1 left-0 w-64 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
                    {VARIABLE_GROUPS.map((group) => {
                        const Icon = group.icon;
                        return (
                            <div key={group.key}>
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border">
                                    <Icon size={13} className="text-teal-400" />
                                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                        {t(GROUP_I18N[group.key])}
                                    </span>
                                </div>
                                {group.variables.map((v) => (
                                    <button
                                        key={v}
                                        type="button"
                                        onClick={() => { onInsert(`{{${v}}}`); setOpen(false); }}
                                        className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-teal-500/10 transition-colors flex items-center gap-2"
                                    >
                                        <code className="text-xs text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded font-mono">
                                            {`{{${v}}}`}
                                        </code>
                                    </button>
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
