"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { HelpCircle, X, ChevronDown, Sparkles, Lightbulb, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import {
    GUIDED_TOUR_START_EVENT,
    canRoleRunGuidedTour,
    getGuidedTour,
    type GuidedTourId,
    type GuidedTourStartDetail,
} from "@parallext/shared";
import { useRole } from "@/hooks/useRole";
import { guidedTourAnchorId } from "@/lib/guided-tours";

/**
 * Media keys that actually have an asset in `apps/dashboard/public/help/`.
 *
 * Every page passes a `mediaKey`, but the folder only holds a README: without
 * this allow-list each open of the panel fires a GIF request that 404s (103
 * pages × one dead request per session). Add a key here the same commit the
 * `.gif` lands, never before — the guided tour replaces the GIF meanwhile.
 */
const HELP_MEDIA_KEYS: ReadonlySet<string> = new Set<string>([]);

export function hasHelpMedia(mediaKey: string | undefined): boolean {
    return Boolean(mediaKey && HELP_MEDIA_KEYS.has(mediaKey));
}

interface HelpPanelProps {
    title: string;
    description: string;
    videoUrl?: string;
    images?: Array<{ src: string; alt: string; caption?: string }>;
    /**
     * Convention-based animated GIF/screenshot. When set (and `images` is not),
     * the panel loads `/help/{mediaKey}.gif` — but ONLY for keys listed in
     * `HELP_MEDIA_KEYS`, so a page whose asset was never recorded does not fire
     * a dead request on every open.
     */
    mediaKey?: string;
    tips?: string[];
    defaultOpen?: boolean;
    /**
     * Guided tour this screen offers ("Mostrarme cómo"). The button renders only
     * when the signed-in role may run the tour; clicking it dispatches
     * `GUIDED_TOUR_START_EVENT` for the runner, which falls back to a spotlight
     * below 768 px — so the button is rendered at every width.
     */
    tourId?: GuidedTourId;
    /** Overrides the default "Mostrarme cómo" label. */
    tourLabel?: string;
}

/** Fires the guided tour the page declared. No-op until the runner is mounted. */
function startGuidedTour(tourId: GuidedTourId) {
    if (typeof window === "undefined") return;
    const detail: GuidedTourStartDetail = { tourId };
    window.dispatchEvent(new CustomEvent(GUIDED_TOUR_START_EVENT, { detail }));
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

export function HelpPanel({
    title, description, videoUrl, images, mediaKey, tips, defaultOpen = false, tourId, tourLabel,
}: HelpPanelProps) {
    const [open, setOpen] = useState(defaultOpen);
    const { role } = useRole();
    const tHelp = useTranslations("help");

    const tour = tourId ? getGuidedTour(tourId) : null;
    const canRunTour = Boolean(tour && canRoleRunGuidedTour(tour, role));
    const showMeLabel = tourLabel ?? tHelp("showMe");

    const showMeButton = (variant: "header" | "footer", anchor: boolean) =>
        canRunTour && tourId ? (
            <motion.button
                type="button"
                id={anchor ? guidedTourAnchorId("help-show-me") : undefined}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => startGuidedTour(tourId)}
                className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg font-semibold cursor-pointer transition-colors border",
                    variant === "header"
                        ? "px-2.5 py-1.5 text-[11.5px] border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/20"
                        : "px-3.5 py-2 text-[12.5px] border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/20 self-start",
                )}
            >
                <Compass size={variant === "header" ? 13 : 14} />
                {showMeLabel}
            </motion.button>
        ) : null;

    return (
        // El ancla del recorrido vive en el contenedor, no en el botón plegado:
        // el botón desaparece al abrir el panel, y el propio recorrido del
        // sistema de ayuda pasaba del paso 1 (el botón) al paso 2 (algo que sólo
        // existe con el panel abierto) sin nada que señalar en el medio.
        <div id={guidedTourAnchorId("help-panel")} className="relative z-10">
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
                            <div className="flex items-center gap-2">
                            {showMeButton("header", true)}
                            <motion.button
                                whileHover={{ scale: 1.08, rotate: 90 }}
                                whileTap={{ scale: 0.92 }}
                                onClick={() => setOpen(false)}
                                className="p-1.5 rounded-lg bg-indigo-500/5 dark:bg-neutral-800/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors cursor-pointer border-none"
                            >
                                <X size={14.5} />
                            </motion.button>
                            </div>
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

                            {/* Convention-based auto media (GIF/screenshot), only for recorded assets */}
                            {hasHelpMedia(mediaKey) && (!images || images.length === 0) && (
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

                            {/* Guided tour ("Mostrarme cómo") after the tips */}
                            {canRunTour && (
                                <div className="flex flex-col gap-1.5 pt-1 border-t border-neutral-100 dark:border-neutral-800/50">
                                    {showMeButton("footer", false)}
                                    <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                                        {tHelp("showMeHint")}
                                    </span>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
