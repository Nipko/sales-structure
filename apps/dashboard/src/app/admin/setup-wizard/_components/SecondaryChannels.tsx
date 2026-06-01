"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Instagram, Facebook, Send, Mail, Globe, ArrowRight } from "lucide-react";

const CHANNELS = [
    { id: "instagram", href: "/admin/channels/instagram", icon: Instagram, color: "#E4405F" },
    { id: "messenger", href: "/admin/channels/messenger", icon: Facebook, color: "#0084FF" },
    { id: "telegram", href: "/admin/channels/telegram", icon: Send, color: "#0088CC" },
    { id: "email", href: "/admin/channels/email", icon: Mail, color: "#6c5ce7" },
    { id: "webchat", href: "/admin/settings/integrations/web-chat", icon: Globe, color: "#00b894" },
];

export default function SecondaryChannels() {
    const router = useRouter();
    const t = useTranslations("setupWizard.connect");
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {CHANNELS.map((ch) => {
                const Icon = ch.icon;
                return (
                    <button
                        key={ch.id}
                        onClick={() => router.push(ch.href)}
                        className="flex items-center gap-3 p-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] hover:border-indigo-500/30 text-left transition-all cursor-pointer"
                    >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: ch.color }}>
                            <Icon size={16} />
                        </div>
                        <span className="text-[13px] text-foreground flex-1">{t(`channel_${ch.id}`)}</span>
                        <ArrowRight size={14} className="text-muted-foreground shrink-0" />
                    </button>
                );
            })}
        </div>
    );
}
