"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { BookOpen, Megaphone, Tag, ArrowRight, type LucideIcon } from "lucide-react";

interface Card {
    label: string;
    description: string;
    href: string;
    icon: LucideIcon;
    iconColor: string;
    iconBg: string;
}

export default function CatalogHub() {
    const router = useRouter();
    const t = useTranslations("catalog.hub");

    const cards: Card[] = [
        {
            label: t("courses.label"),
            description: t("courses.description"),
            href: "/admin/catalog/courses",
            icon: BookOpen,
            iconColor: "text-indigo-500",
            iconBg: "bg-indigo-500/10",
        },
        {
            label: t("campaigns.label"),
            description: t("campaigns.description"),
            href: "/admin/catalog/campaigns",
            icon: Megaphone,
            iconColor: "text-rose-500",
            iconBg: "bg-rose-500/10",
        },
        {
            label: t("offers.label"),
            description: t("offers.description"),
            href: "/admin/catalog/offers",
            icon: Tag,
            iconColor: "text-amber-500",
            iconBg: "bg-amber-500/10",
        },
    ];

    return (
        <div className="space-y-8 max-w-5xl">
            <div>
                <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {cards.map((card) => {
                    const Icon = card.icon;
                    return (
                        <button
                            key={card.href}
                            onClick={() => router.push(card.href)}
                            className="group flex items-center gap-3.5 rounded-xl border border-neutral-200 bg-white px-5 py-4 text-left hover-lift hover:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-indigo-500"
                        >
                            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", card.iconBg)}>
                                <Icon size={20} className={card.iconColor} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                    {card.label}
                                </div>
                                <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-1">
                                    {card.description}
                                </div>
                            </div>
                            <ArrowRight size={16} className="shrink-0 text-neutral-300 dark:text-neutral-600 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
