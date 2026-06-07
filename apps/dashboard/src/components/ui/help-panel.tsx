"use client";

import { useState } from "react";
import { HelpCircle, X, ChevronDown, Sparkles, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";

interface HelpPanelProps {
    title: string;
    description: string;
    videoUrl?: string;
    images?: Array<{ src: string; alt: string; caption?: string }>;
    /**
     * Convention-based animated GIF/screenshot. When set (and `images` is not),
     * the panel auto-loads `/help/{mediaKey}.gif` and renders it only if the file
     * exists — a missing asset hides itself silently (no broken image).
     * Drop assets into `apps/dashboard/public/help/` to light them up.
     */
    mediaKey?: string;
    tips?: string[];
    defaultOpen?: boolean;
}

/** Auto-loaded help media that removes itself if the asset is missing. */
function HelpMedia({ src, alt }: { src: string; alt: string }) {
    const [hidden, setHidden] = useState(false);
    if (hidden) return null;
    return (
        <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl overflow-hidden border border-border shadow-sm bg-background/50"
        >
            <img
                src={src}
                alt={alt}
                loading="lazy"
                onError={() => setHidden(true)}
                className="w-full h-auto object-cover"
            />
        </motion.div>
    );
}

export function HelpPanel({ title, description, videoUrl, images, mediaKey, tips, defaultOpen = false }: HelpPanelProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="relative z-10">
            <AnimatePresence mode="wait">
                {!open ? (
                    <motion.button
                        key="collapsed"
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        whileHover={{ scale: 1.015, translateY: -1 }}
                        whileTap={{ scale: 0.985 }}
                        onClick={() => setOpen(true)}
                        className="mb-5 flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-dashed border-indigo-500/35 bg-indigo-500/[0.04] dark:bg-indigo-500/[0.07] text-indigo-600 dark:text-indigo-400 text-[13px] font-semibold hover:border-indigo-500/50 hover:bg-indigo-500/[0.08] dark:hover:bg-indigo-500/[0.12] transition-all duration-200 cursor-pointer shadow-sm hover:shadow-indigo-500/5 backdrop-blur-[4px] relative overflow-hidden group"
                    >
                        {/* Shimmer effect */}
                        <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] pointer-events-none" />
                        <HelpCircle size={15.5} className="group-hover:rotate-12 transition-transform duration-200" />
                        <span className="tracking-wide">{title}</span>
                        <ChevronDown size={13.5} className="opacity-80 group-hover:translate-y-0.5 transition-transform duration-200" />
                    </motion.button>
                ) : (
                    <motion.div
                        key="expanded"
                        initial={{ opacity: 0, y: -10, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.985 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="mb-6 rounded-2xl border border-white/20 dark:border-neutral-800/40 bg-white/40 dark:bg-neutral-900/40 backdrop-blur-md shadow-lg shadow-indigo-500/[0.02] overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-3.5 border-b border-indigo-500/10 dark:border-neutral-800/50">
                            <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                                    <Sparkles size={14.5} className="text-indigo-600 dark:text-indigo-400 animate-pulse" />
                                </div>
                                <h3 className="text-[13.5px] font-bold text-neutral-800 dark:text-neutral-200 tracking-wide">{title}</h3>
                            </div>
                            <motion.button
                                whileHover={{ scale: 1.08, rotate: 90 }}
                                whileTap={{ scale: 0.92 }}
                                onClick={() => setOpen(false)}
                                className="p-1.5 rounded-lg bg-indigo-500/5 dark:bg-neutral-800/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors cursor-pointer border-none"
                            >
                                <X size={14.5} />
                            </motion.button>
                        </div>

                        {/* Content */}
                        <div className="px-5 py-4.5 space-y-4 text-sm">
                            {/* Description */}
                            <p className="text-[13px] text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium">
                                {description}
                            </p>

                            {/* YouTube Video */}
                            {videoUrl && (
                                <motion.div 
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="relative w-full aspect-video rounded-xl overflow-hidden border border-border bg-black/5 shadow-inner"
                                >
                                    <iframe
                                        src={videoUrl}
                                        title={title}
                                        className="absolute inset-0 w-full h-full"
                                        frameBorder="0"
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                        allowFullScreen
                                    />
                                </motion.div>
                            )}

                            {/* Images */}
                            {images && images.length > 0 && (
                                <div className={cn("grid gap-3.5", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
                                    {images.map((img, i) => (
                                        <motion.div 
                                            key={i} 
                                            initial={{ opacity: 0, scale: 0.97 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{ delay: i * 0.08 }}
                                            className="rounded-xl overflow-hidden border border-border shadow-sm bg-background/50 backdrop-blur-sm"
                                        >
                                            <img src={img.src} alt={img.alt} className="w-full h-auto object-cover" />
                                            {img.caption && (
                                                <p className="px-3 py-2 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-50/50 dark:bg-neutral-800/40 border-t border-border">
                                                    {img.caption}
                                                </p>
                                            )}
                                        </motion.div>
                                    ))}
                                </div>
                            )}

                            {/* Convention-based auto media (GIF/screenshot) */}
                            {mediaKey && (!images || images.length === 0) && (
                                <HelpMedia src={`/help/${mediaKey}.gif`} alt={title} />
                            )}

                            {/* Tips */}
                            {tips && tips.length > 0 && (
                                <div className="space-y-2.5 pt-1 border-t border-neutral-100 dark:border-neutral-800/50">
                                    {tips.map((tip, i) => (
                                        <motion.div 
                                            key={i}
                                            initial={{ opacity: 0, x: -8 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.05 }}
                                            className="flex items-start gap-2.5 p-2 rounded-xl hover:bg-indigo-500/[0.02] dark:hover:bg-neutral-800/10 transition-colors"
                                        >
                                            <div className="mt-0.5 w-5 h-5 rounded-md bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                                                <Lightbulb size={11} className="text-indigo-600 dark:text-indigo-400" />
                                            </div>
                                            <span className="text-[12.5px] font-medium text-neutral-600 dark:text-neutral-400 leading-normal">
                                                {tip}
                                            </span>
                                        </motion.div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
