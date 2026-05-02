"use client";

import { useState } from "react";
import { HelpCircle, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface HelpPanelProps {
    title: string;
    description: string;
    videoUrl?: string;
    images?: Array<{ src: string; alt: string; caption?: string }>;
    tips?: string[];
    defaultOpen?: boolean;
}

export function HelpPanel({ title, description, videoUrl, images, tips, defaultOpen = false }: HelpPanelProps) {
    const [open, setOpen] = useState(defaultOpen);

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-indigo-500/30 bg-indigo-500/5 text-indigo-500 text-[13px] font-medium hover:bg-indigo-500/10 transition-colors cursor-pointer"
            >
                <HelpCircle size={16} />
                <span>{title}</span>
                <ChevronDown size={14} />
            </button>
        );
    }

    return (
        <div className="mb-6 rounded-xl border border-indigo-500/20 bg-indigo-500/5 dark:bg-indigo-500/10 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-indigo-500/10">
                <div className="flex items-center gap-2">
                    <HelpCircle size={18} className="text-indigo-500" />
                    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                </div>
                <button
                    onClick={() => setOpen(false)}
                    className="p-1 rounded-md hover:bg-indigo-500/10 transition-colors cursor-pointer"
                >
                    <X size={16} className="text-indigo-400" />
                </button>
            </div>

            {/* Content */}
            <div className="px-5 py-4 space-y-4">
                {/* Description */}
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{description}</p>

                {/* YouTube Video */}
                {videoUrl && (
                    <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black/5">
                        <iframe
                            src={videoUrl}
                            title={title}
                            className="absolute inset-0 w-full h-full"
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    </div>
                )}

                {/* Images */}
                {images && images.length > 0 && (
                    <div className={cn("grid gap-3", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
                        {images.map((img, i) => (
                            <div key={i} className="rounded-lg overflow-hidden border border-border">
                                <img src={img.src} alt={img.alt} className="w-full h-auto" />
                                {img.caption && (
                                    <p className="px-2 py-1.5 text-[11px] text-[var(--text-secondary)] bg-[var(--bg-tertiary)]">
                                        {img.caption}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Tips */}
                {tips && tips.length > 0 && (
                    <div className="space-y-1.5">
                        {tips.map((tip, i) => (
                            <div key={i} className="flex items-start gap-2">
                                <span className="text-indigo-500 mt-0.5 text-xs">💡</span>
                                <span className="text-[13px] text-[var(--text-secondary)]">{tip}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
