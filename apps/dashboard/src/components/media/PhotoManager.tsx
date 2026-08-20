"use client";

/**
 * El gestor de fotos de un objeto del catálogo.
 *
 * Existía uno, completo y bueno, escrito adentro de la pestaña Fotos de una
 * propiedad de alquiler vacacional. Inmuebles, que soporta `images` en la base
 * y tiene una tool que las manda por WhatsApp, no tenía ninguno: la capacidad
 * existía entera salvo la única parte que el dueño podía tocar. Copiarlo
 * habría dejado dos validaciones de tamaño y dos límites que se corrigen por
 * separado, así que vive acá una sola vez.
 *
 * Persiste apenas cambia cuando el llamador le pasa `persist`. La versión
 * anterior guardaba con una barra aparte: el archivo ya estaba subido y lo
 * único pendiente era la asociación, así que cerrar la pestaña dejaba la foto
 * en el servidor y el objeto sin ella. Si el guardado falla se revierte y se
 * dice por qué, en vez de mostrar un orden que la base no tiene.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
    Check, ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Trash2,
} from "lucide-react";
import { MEDIA_UPLOAD_BASE, resolveMediaUrl } from "@/lib/media-url";

export const DEFAULT_MAX_PHOTOS = 5;
/** El API rechaza arriba de 5MB; se avisa antes de gastar la subida. */
export const DEFAULT_MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export interface PhotoManagerProps {
    tenantId: string;
    /** Carpeta lógica del archivo: `property`, `listing`, … */
    entityType: string;
    /** Ausente en un alta, donde el objeto todavía no existe. */
    entityId?: string;
    value: string[];
    onChange: (images: string[]) => void;
    /**
     * Guardado inmediato. Sin esto el llamador se hace cargo (el alta manda las
     * fotos junto con el resto del formulario).
     */
    persist?: (images: string[]) => Promise<{ success: boolean; error?: string }>;
    maxImages?: number;
    maxBytes?: number;
}

export function PhotoManager({
    tenantId,
    entityType,
    entityId,
    value,
    onChange,
    persist,
    maxImages = DEFAULT_MAX_PHOTOS,
    maxBytes = DEFAULT_MAX_PHOTO_BYTES,
}: PhotoManagerProps) {
    const t = useTranslations("photoManager");
    const tc = useTranslations("common");

    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
    const [errors, setErrors] = useState<string[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">("idle");

    const images = value;
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    /** Lo último que la base confirmó, para poder volver si el guardado falla. */
    const persisted = useRef<string[]>(value);
    useEffect(() => { persisted.current = value; }, [entityId]); // eslint-disable-line react-hooks/exhaustive-deps

    const commit = useCallback(async (next: string[]) => {
        const previous = persisted.current;
        onChange(next);
        if (!persist) {
            persisted.current = next;
            return;
        }
        setSavingState("saving");
        const res = await persist(next).catch((e: any) => ({ success: false, error: e?.message }));
        if (res?.success) {
            persisted.current = next;
            setSavingState("saved");
            setTimeout(() => setSavingState("idle"), 1800);
            return;
        }
        // Mostrar un orden que la base no tiene es peor que no reordenar.
        onChange(previous);
        setSavingState("idle");
        setErrors([res?.error || t("saveFailed")]);
    }, [onChange, persist, t]);

    async function uploadFiles(fileList: FileList | File[]) {
        const files = Array.from(fileList);
        const slotsLeft = maxImages - images.length;
        const errs: string[] = [];

        if (slotsLeft <= 0) {
            setErrors([t("limitReached", { max: maxImages })]);
            return;
        }

        const valid: File[] = [];
        for (const file of files) {
            if (valid.length >= slotsLeft) {
                errs.push(t("limitWillExceed", { max: maxImages, dropped: files.length - valid.length }));
                break;
            }
            if (!file.type.startsWith("image/")) {
                errs.push(`${file.name}: ${t("invalidType")}`);
                continue;
            }
            if (file.size > maxBytes) {
                errs.push(`${file.name}: ${t("tooLarge", { maxMb })}`);
                continue;
            }
            valid.push(file);
        }

        if (valid.length === 0) {
            setErrors(errs);
            return;
        }

        setErrors(errs);
        setUploading(true);
        setProgress({ current: 0, total: valid.length });

        const accessToken = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
        const uploaded: string[] = [];
        const query = new URLSearchParams({ entityType });
        if (entityId) query.set("entityId", entityId);

        for (let i = 0; i < valid.length; i++) {
            const file = valid[i];
            try {
                const body = new FormData();
                body.append("file", file);
                const res = await fetch(`${MEDIA_UPLOAD_BASE}/media/upload/${tenantId}?${query}`, {
                    method: "POST",
                    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
                    body,
                });
                const json = await res.json().catch(() => ({}));
                const url = json?.data?.url || json?.url;
                if (res.ok && url) {
                    uploaded.push(url);
                } else {
                    // Una subida que falla y no lo dice deja al dueño creyendo
                    // que la foto está cargada y al agente sin nada que mandar.
                    errs.push(`${file.name}: ${json?.error || json?.message || tc("errorSaving")}`);
                }
            } catch (err: any) {
                errs.push(`${file.name}: ${err?.message || tc("errorSaving")}`);
            }
            setProgress({ current: i + 1, total: valid.length });
        }

        setErrors(errs);
        setUploading(false);
        setProgress(null);
        if (uploaded.length) await commit([...images, ...uploaded]);
    }

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        if (e.target.files?.length) uploadFiles(e.target.files);
        e.target.value = "";
    }

    function handleDrop(e: React.DragEvent<HTMLDivElement>) {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
    }

    function removeAt(index: number) {
        commit(images.filter((_, i) => i !== index));
    }

    function setPrimary(index: number) {
        if (index === 0) return;
        const next = [...images];
        const [picked] = next.splice(index, 1);
        next.unshift(picked);
        commit(next);
    }

    function swap(index: number, target: number) {
        if (target < 0 || target >= images.length) return;
        const next = [...images];
        [next[index], next[target]] = [next[target], next[index]];
        commit(next);
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h3>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {t("description", { max: maxImages, maxMb })}
                    </p>
                    {/* El orden no es decorativo: la portada es lo que el
                        agente manda primero en el chat. */}
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("agentHint")}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {savingState === "saving" && <Loader2 size={14} className="animate-spin text-neutral-400" />}
                    {savingState === "saved" && <Check size={14} className="text-emerald-500" />}
                    <span className={`text-xs font-medium ${
                        images.length >= maxImages
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-neutral-500 dark:text-neutral-400"
                    }`}>
                        {images.length}/{maxImages}
                    </span>
                </div>
            </div>

            {images.length < maxImages && (
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    className={`relative rounded-xl border-2 border-dashed transition-colors px-6 py-8 text-center ${
                        dragOver
                            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                            : "border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900"
                    } ${uploading ? "opacity-60 pointer-events-none" : "cursor-pointer hover:border-indigo-400"}`}
                >
                    <label className="absolute inset-0 cursor-pointer">
                        <span className="sr-only">{t("dropTitle")}</span>
                        <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={handleFileChange}
                            disabled={uploading}
                        />
                    </label>
                    <ImageIcon size={30} className="mx-auto text-neutral-400 dark:text-neutral-500 mb-2" />
                    <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{t("dropTitle")}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                        {t("dropSubtitle", { remaining: maxImages - images.length, maxMb })}
                    </p>
                    {progress && (
                        <div className="mt-4 max-w-xs mx-auto">
                            <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                                <div
                                    className="h-full bg-indigo-500 transition-all"
                                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                />
                            </div>
                            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                                {t("uploadingProgress", { current: progress.current, total: progress.total })}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {errors.length > 0 && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3">
                    <ul className="text-xs text-red-700 dark:text-red-300 space-y-0.5">
                        {errors.map((message, i) => <li key={i}>{message}</li>)}
                    </ul>
                </div>
            )}

            {images.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-6">{t("empty")}</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {images.map((url, i) => (
                        <div
                            key={`${url}-${i}`}
                            className="group relative aspect-[4/3] rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-800"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={resolveMediaUrl(url)} alt="" className="w-full h-full object-cover" />

                            {i === 0 && (
                                <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-indigo-500 text-white text-[10px] font-semibold uppercase tracking-wide">
                                    {t("primary")}
                                </span>
                            )}

                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-end justify-between p-2 gap-1">
                                <div className="flex gap-1">
                                    {i > 0 && (
                                        <button
                                            onClick={() => setPrimary(i)}
                                            title={t("setPrimary")}
                                            aria-label={t("setPrimary")}
                                            className="p-1.5 rounded-lg bg-white/90 hover:bg-white text-neutral-700 transition-colors"
                                        >
                                            <Check size={14} />
                                        </button>
                                    )}
                                    {i > 0 && (
                                        <button
                                            onClick={() => swap(i, i - 1)}
                                            title={t("moveLeft")}
                                            aria-label={t("moveLeft")}
                                            className="p-1.5 rounded-lg bg-white/90 hover:bg-white text-neutral-700 transition-colors"
                                        >
                                            <ChevronLeft size={14} />
                                        </button>
                                    )}
                                    {i < images.length - 1 && (
                                        <button
                                            onClick={() => swap(i, i + 1)}
                                            title={t("moveRight")}
                                            aria-label={t("moveRight")}
                                            className="p-1.5 rounded-lg bg-white/90 hover:bg-white text-neutral-700 transition-colors"
                                        >
                                            <ChevronRight size={14} />
                                        </button>
                                    )}
                                </div>
                                <button
                                    onClick={() => removeAt(i)}
                                    title={tc("delete")}
                                    aria-label={tc("delete")}
                                    className="p-1.5 rounded-lg bg-red-500/90 hover:bg-red-600 text-white transition-colors"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
