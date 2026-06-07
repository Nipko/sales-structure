"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { SuperAdminGuard } from "@/components/SuperAdminGuard";
import { HelpPanel } from "@/components/ui/help-panel";
import { 
    Sparkles, Plus, Trash2, Globe, Image as ImageIcon, Eye, 
    Save, FileText, CheckCircle2, ChevronRight, Edit2, List, Trash, X
} from "lucide-react";
import { cn } from "@/lib/utils";

const LANGUAGES = [
    { code: "es", label: "Español" },
    { code: "en", label: "English" },
    { code: "pt", label: "Português" },
    { code: "fr", label: "Français" }
];

const categoryLabels: Record<string, Record<string, string>> = {
  new: { es: "NUEVO", en: "NEW", pt: "NOVO", fr: "NOUVEAU" },
  improved: { es: "MEJORA", en: "IMPROVED", pt: "MELHORIA", fr: "AMÉLIORATION" },
  fixed: { es: "CORREGIDO", en: "FIXED", pt: "CORRIGIDO", fr: "CORRIGÉ" }
};
const getCategoryLabel = (type: string, lang: string) => {
  return categoryLabels[type]?.[lang] || categoryLabels[type]?.['es'] || type.toUpperCase();
};

const ctaLabels: Record<string, string> = {
  es: "Entendido",
  en: "Got it",
  pt: "Entendido",
  fr: "Compris"
};
const getCtaLabel = (lang: string) => ctaLabels[lang] || ctaLabels['es'];


export default function PlatformChangelogPage() {
    return (
        <SuperAdminGuard>
            <ChangelogManagerContent />
        </SuperAdminGuard>
    );
}

function ChangelogManagerContent() {
    const tHelp = useTranslations("help");
    // --- Tabs ---
    const [activeTab, setActiveTab] = useState<"compose" | "history">("compose");

    // --- Editor State ---
    const [editingId, setEditingId] = useState<string | null>(null);
    const [version, setVersion] = useState("v1.4.0");
    const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
    const [title, setTitle] = useState<Record<string, string>>({ es: "", en: "", pt: "", fr: "" });
    const [description, setDescription] = useState<Record<string, string>>({ es: "", en: "", pt: "", fr: "" });
    const [features, setFeatures] = useState<any[]>([]);
    const [isActive, setIsActive] = useState(true);

    // --- UI State ---
    const [langTab, setLangTab] = useState<string>("es");
    const [previewLang, setPreviewLang] = useState<string>("es");
    const [loading, setLoading] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [historyItems, setHistoryItems] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // --- Refs ---
    const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

    // --- Load History ---
    const loadHistory = async () => {
        setLoadingHistory(true);
        try {
            const res = await api.getAdminSystemUpdates();
            if (res.success && Array.isArray(res.data)) {
                setHistoryItems(res.data);
            }
        } catch { /* ignore */ }
        setLoadingHistory(false);
    };

    useEffect(() => {
        loadHistory();
    }, []);

    // --- Form actions ---
    const addFeature = () => {
        setFeatures(prev => [
            ...prev,
            {
                type: "new",
                title: { es: "", en: "", pt: "", fr: "" },
                desc: { es: "", en: "", pt: "", fr: "" },
                image: ""
            }
        ]);
    };

    const removeFeature = (idx: number) => {
        setFeatures(prev => prev.filter((_, i) => i !== idx));
    };

    const updateFeatureType = (idx: number, type: 'new' | 'improved' | 'fixed') => {
        setFeatures(prev => prev.map((f, i) => i === idx ? { ...f, type } : f));
    };

    const updateFeatureText = (idx: number, field: 'title' | 'desc', lang: string, value: string) => {
        setFeatures(prev => prev.map((f, i) => {
            if (i === idx) {
                const subField = { ...f[field], [lang]: value };
                return { ...f, [field]: subField };
            }
            return f;
        }));
    };

    const handleFeatureImageUpload = async (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        try {
            const res = await api.uploadSystemUpdateImage(file);
            if (res.success && res.url) {
                setFeatures(prev => prev.map((f, i) => i === idx ? { ...f, image: res.url } : f));
            } else {
                alert("Error al subir la imagen: " + (res.error || "Desconocido"));
            }
        } catch (err) {
            alert("Error al subir la imagen.");
        }
        setLoading(false);
    };

    const resetForm = () => {
        setEditingId(null);
        setVersion("v1.4.0");
        setDate(new Date().toISOString().split("T")[0]);
        setTitle({ es: "", en: "", pt: "", fr: "" });
        setDescription({ es: "", en: "", pt: "", fr: "" });
        setFeatures([]);
        setIsActive(true);
    };

    const handleSubmit = async () => {
        if (!version.trim()) {
            alert("Por favor ingresa una versión (ej. v1.4.0)");
            return;
        }
        if (!title.es.trim()) {
            alert("Por favor ingresa un título en Español");
            return;
        }

        setLoading(true);
        const payload = {
            version,
            date: new Date(date),
            title,
            description,
            features,
            isActive
        };

        try {
            let res;
            if (editingId) {
                res = await api.updateSystemUpdate(editingId, payload);
            } else {
                res = await api.createSystemUpdate(payload);
            }

            if (res.success) {
                setSuccessMessage(editingId ? "¡Novedad actualizada con éxito!" : "¡Nueva novedad publicada con éxito!");
                setTimeout(() => setSuccessMessage(null), 4000);
                if (!editingId) resetForm();
                loadHistory();
                setActiveTab("history");
            } else {
                alert("Error al guardar: " + (res.error || "Desconocido"));
            }
        } catch (err) {
            alert("Error de conexión al guardar.");
        }
        setLoading(false);
    };

    const handleEdit = (item: any) => {
        setEditingId(item.id);
        setVersion(item.version);
        setDate(new Date(item.date).toISOString().split("T")[0]);
        
        // Handle potentially stringified JSON in some database adapters
        const parsedTitle = typeof item.title === "string" ? JSON.parse(item.title) : item.title;
        const parsedDesc = typeof item.description === "string" ? JSON.parse(item.description) : item.description;
        const parsedFeatures = typeof item.features === "string" ? JSON.parse(item.features) : item.features;

        setTitle({ es: "", en: "", pt: "", fr: "", ...parsedTitle });
        setDescription({ es: "", en: "", pt: "", fr: "", ...parsedDesc });
        setFeatures(parsedFeatures || []);
        setIsActive(item.isActive);
        setActiveTab("compose");
    };

    const handleDelete = async (id: string) => {
        if (!confirm("¿Estás seguro de que deseas eliminar permanentemente esta novedad? Se borrarán también sus imágenes asociadas.")) return;
        
        setLoading(true);
        try {
            const res = await api.deleteSystemUpdate(id);
            if (res.success) {
                loadHistory();
                if (editingId === id) resetForm();
            } else {
                alert("Error al eliminar: " + (res.error || "Desconocido"));
            }
        } catch {
            alert("Error de conexión.");
        }
        setLoading(false);
    };

    const inputClasses = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all duration-150";
    const textareaClasses = "w-full h-24 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all duration-150 leading-relaxed";

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                        <Sparkles className="text-indigo-500 animate-pulse" />
                        Compilador de Novedades (Changelog)
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        Crea, traduce y publica actualizaciones del sistema ("Qué hay de nuevo") visibles en el dashboard de todos los tenants.
                    </p>
                </div>
                
                {/* Save & Reset buttons */}
                {activeTab === "compose" && (
                    <div className="flex items-center gap-3">
                        {editingId && (
                            <button
                                onClick={resetForm}
                                className="px-4 py-2 text-sm font-semibold rounded-xl text-neutral-600 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-750 transition-all"
                            >
                                Cancelar Edición
                            </button>
                        )}
                        <button
                            onClick={handleSubmit}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 text-sm font-semibold shadow-md shadow-indigo-500/10 hover:shadow-indigo-500/20 transition-all"
                        >
                            <Save size={16} />
                            {editingId ? "Actualizar Cambios" : "Publicar Cambios"}
                        </button>
                    </div>
                )}
            </div>

            <HelpPanel
                title={tHelp("settingsPlatformChangelog.title")}
                description={tHelp("settingsPlatformChangelog.description")}
                tips={tHelp.raw("settingsPlatformChangelog.tips") as string[]}
                mediaKey="settingsPlatformChangelog"
            />

            {/* Notifications */}
            {successMessage && (
                <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800/30 p-4 rounded-xl text-emerald-800 dark:text-emerald-400 text-sm font-semibold">
                    <CheckCircle2 size={18} />
                    {successMessage}
                </div>
            )}

            {/* Tabs Selector */}
            <div className="flex border-b border-neutral-200 dark:border-neutral-800 select-none">
                <button
                    onClick={() => setActiveTab("compose")}
                    className={cn(
                        "px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2",
                        activeTab === "compose"
                            ? "border-indigo-500 text-indigo-600 dark:text-indigo-400 font-bold"
                            : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                    )}
                >
                    <FileText size={16} />
                    {editingId ? "Editar Novedad" : "Redactar Novedad"}
                </button>
                <button
                    onClick={() => setActiveTab("history")}
                    className={cn(
                        "px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2",
                        activeTab === "history"
                            ? "border-indigo-500 text-indigo-600 dark:text-indigo-400 font-bold"
                            : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                    )}
                >
                    <List size={16} />
                    Historial de Novedades ({historyItems.length})
                </button>
            </div>

            {/* --- COMPOSER VIEW --- */}
            {activeTab === "compose" && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
                    
                    {/* Left Pane: Composer Form */}
                    <div className="space-y-6 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 shadow-sm">
                        
                        {/* Meta: Version, Date, Active status */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-4 border-b border-neutral-100 dark:border-neutral-850">
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-1.5">Versión</label>
                                <input
                                    type="text"
                                    placeholder="ej. v1.4.0"
                                    value={version}
                                    onChange={e => setVersion(e.target.value)}
                                    className={inputClasses}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-1.5">Fecha Publicación</label>
                                <input
                                    type="date"
                                    value={date}
                                    onChange={e => setDate(e.target.value)}
                                    className={inputClasses}
                                />
                            </div>
                            <div className="flex flex-col justify-end">
                                <label className="flex items-center gap-3.5 bg-neutral-50 dark:bg-neutral-800/40 p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-750 cursor-pointer h-10 select-none">
                                    <input
                                        type="checkbox"
                                        checked={isActive}
                                        onChange={e => setIsActive(e.target.checked)}
                                        className="h-4 w-4 text-indigo-600 border-neutral-300 rounded focus:ring-indigo-500 cursor-pointer"
                                    />
                                    <span className="text-xs font-bold uppercase tracking-wider text-neutral-600 dark:text-neutral-400">Publicado</span>
                                </label>
                            </div>
                        </div>

                        {/* Language Selector Tabs for Title and Description */}
                        <div>
                            <div className="flex items-center justify-between mb-3 select-none">
                                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Cabecera de Novedad (Multiidioma)</span>
                                <div className="flex bg-neutral-100 dark:bg-neutral-800 p-0.5 rounded-lg border border-neutral-200/50 dark:border-neutral-700/50">
                                    {LANGUAGES.map(lang => (
                                        <button
                                            key={lang.code}
                                            type="button"
                                            onClick={() => setLangTab(lang.code)}
                                            className={cn(
                                                "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition-all duration-150 flex items-center gap-1",
                                                langTab === lang.code
                                                    ? "bg-white dark:bg-neutral-900 text-indigo-600 dark:text-indigo-400 shadow-sm"
                                                    : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                                            )}
                                        >
                                            <Globe size={10} />
                                            {lang.code}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Title and Description Inputs */}
                            <div className="space-y-4 bg-neutral-50/50 dark:bg-neutral-900/30 p-4 rounded-xl border border-neutral-100 dark:border-neutral-850">
                                {LANGUAGES.map(lang => (
                                    <div key={lang.code} className={cn("space-y-4", langTab !== lang.code && "hidden")}>
                                        <div>
                                            <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1.5 flex items-center gap-1">
                                                Título en {lang.label} <span className="text-red-500 font-bold">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                placeholder={`ej. ¡Nuevas analíticas de IA y agentes! (${lang.code.toUpperCase()})`}
                                                value={title[lang.code] || ""}
                                                onChange={e => setTitle(prev => ({ ...prev, [lang.code]: e.target.value }))}
                                                className={inputClasses}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1.5">
                                                Cuerpo / Introducción en {lang.label}
                                            </label>
                                            <textarea
                                                placeholder={`Ingresa un resumen conciso de los cambios en esta release... (${lang.code.toUpperCase()})`}
                                                value={description[lang.code] || ""}
                                                onChange={e => setDescription(prev => ({ ...prev, [lang.code]: e.target.value }))}
                                                className={textareaClasses}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Features Dynamic Section */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-t border-neutral-100 dark:border-neutral-850 pt-4 select-none">
                                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Secciones de Características ({features.length})</span>
                                <button
                                    type="button"
                                    onClick={addFeature}
                                    className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-200/40 dark:border-indigo-800/20 hover:bg-indigo-100/60 dark:hover:bg-indigo-500/20 transition-all"
                                >
                                    <Plus size={14} />
                                    Añadir Sección
                                </button>
                            </div>

                            {/* Features list items */}
                            <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1.5 custom-scrollbar">
                                {features.length === 0 ? (
                                    <div className="text-center py-8 rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800 bg-neutral-50/30 text-neutral-400 dark:text-neutral-500 text-xs font-semibold leading-relaxed">
                                        No has añadido ninguna sección de detalles todavía.<br />Haz clic en "Añadir Sección" para comenzar.
                                    </div>
                                ) : (
                                    features.map((feature, idx) => (
                                        <div key={idx} className="p-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl space-y-4 relative shadow-sm">
                                            {/* Delete feature button */}
                                            <button
                                                type="button"
                                                onClick={() => removeFeature(idx)}
                                                className="absolute top-4 right-4 text-neutral-400 hover:text-red-500 transition-colors p-1"
                                            >
                                                <Trash2 size={16} />
                                            </button>

                                            {/* Feature header: Type selector */}
                                            <div className="flex gap-4 items-center">
                                                <div>
                                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-1.5">Categoría</label>
                                                    <div className="flex bg-neutral-100 dark:bg-neutral-800 p-0.5 rounded-lg border border-neutral-200/50 dark:border-neutral-700/50 select-none">
                                                        {(['new', 'improved', 'fixed'] as const).map(type => (
                                                            <button
                                                                key={type}
                                                                type="button"
                                                                onClick={() => updateFeatureType(idx, type)}
                                                                className={cn(
                                                                    "px-2.5 py-1 rounded-md text-[9px] font-bold uppercase transition-all duration-150",
                                                                    feature.type === type
                                                                        ? type === 'new'
                                                                            ? "bg-indigo-500 text-white shadow-sm"
                                                                            : type === 'improved'
                                                                                ? "bg-emerald-500 text-white shadow-sm"
                                                                                : "bg-amber-500 text-white shadow-sm"
                                                                        : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                                                                )}
                                                            >
                                                                {type === 'new' ? "Nuevo" : type === 'improved' ? "Mejora" : "Corregido"}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Feature Translations input fields */}
                                            <div className="space-y-4 bg-neutral-50/30 dark:bg-neutral-900/30 p-3 rounded-lg border border-neutral-100 dark:border-neutral-850">
                                                {LANGUAGES.map(lang => (
                                                    <div key={lang.code} className={cn("grid grid-cols-1 md:grid-cols-2 gap-3", langTab !== lang.code && "hidden")}>
                                                        <div>
                                                            <label className="block text-[10px] font-bold text-neutral-500 dark:text-neutral-400 mb-1">
                                                                Título ({lang.label})
                                                            </label>
                                                            <input
                                                                type="text"
                                                                placeholder={`ej. Rendimiento IA (${lang.code.toUpperCase()})`}
                                                                value={feature.title[lang.code] || ""}
                                                                onChange={e => updateFeatureText(idx, 'title', lang.code, e.target.value)}
                                                                className={inputClasses}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] font-bold text-neutral-500 dark:text-neutral-400 mb-1">
                                                                Detalle / Explicación ({lang.label})
                                                            </label>
                                                            <input
                                                                type="text"
                                                                placeholder={`ej. Compara métricas en un panel interactivo. (${lang.code.toUpperCase()})`}
                                                                value={feature.desc[lang.code] || ""}
                                                                onChange={e => updateFeatureText(idx, 'desc', lang.code, e.target.value)}
                                                                className={inputClasses}
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Image upload block */}
                                            <div className="flex items-center gap-4">
                                                <input
                                                    type="file"
                                                    ref={el => { fileInputRefs.current[idx] = el; }}
                                                    onChange={e => handleFeatureImageUpload(idx, e)}
                                                    accept="image/*"
                                                    className="hidden"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => fileInputRefs.current[idx]?.click()}
                                                    className="flex items-center gap-1.5 text-xs font-bold text-neutral-600 bg-neutral-50 border border-neutral-200 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-750 px-3.5 py-2 rounded-lg transition-colors cursor-pointer select-none"
                                                >
                                                    <ImageIcon size={14} />
                                                    {feature.image ? "Reemplazar Imagen" : "Subir Captura/Imagen"}
                                                </button>

                                                {feature.image && (
                                                    <div className="flex items-center gap-2 bg-neutral-50 dark:bg-neutral-800 px-2 py-1 rounded-lg border border-neutral-200/50 dark:border-neutral-700/50 max-w-xs truncate text-[11px] font-semibold text-neutral-500">
                                                        <span className="truncate">{feature.image}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setFeatures(prev => prev.map((f, i) => i === idx ? { ...f, image: "" } : f))}
                                                            className="text-red-500 hover:text-red-600 p-0.5 rounded transition-colors"
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                    </div>

                    {/* Right Pane: Live Premium Visual Preview */}
                    <div className="sticky top-6 space-y-4">
                        <div className="flex items-center justify-between px-2 select-none">
                            <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 flex items-center gap-1">
                                <Eye size={14} />
                                Vista Previa del Modal en Tiempo Real
                            </span>
                            
                            <div className="flex bg-neutral-100 dark:bg-neutral-800 p-0.5 rounded-lg border border-neutral-200/50 dark:border-neutral-700/50">
                                {LANGUAGES.map(lang => (
                                    <button
                                        key={lang.code}
                                        type="button"
                                        onClick={() => setPreviewLang(lang.code)}
                                        className={cn(
                                            "px-2 py-0.5 rounded-md text-[9px] font-bold uppercase transition-all duration-150",
                                            previewLang === lang.code
                                                ? "bg-white dark:bg-neutral-900 text-indigo-600 dark:text-indigo-400 shadow-sm"
                                                : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                                        )}
                                    >
                                        {lang.code}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Framed glassmorphic modal simulator */}
                        <div className="w-full bg-neutral-100 dark:bg-neutral-950 border border-neutral-200/50 dark:border-neutral-800 rounded-2xl p-6 min-h-[480px] flex items-center justify-center relative overflow-hidden select-none">
                            {/* Simulator Background blur circles */}
                            <div className="absolute top-1/4 left-1/4 w-36 h-36 bg-indigo-500/20 dark:bg-indigo-500/10 rounded-full blur-3xl animate-pulse" />
                            <div className="absolute bottom-1/4 right-1/4 w-44 h-44 bg-pink-500/20 dark:bg-pink-500/10 rounded-full blur-3xl animate-pulse animate-delay-1000" />

                            {/* Render actual card */}
                            <div className="relative w-full max-w-md bg-white dark:bg-neutral-900 border border-neutral-200/50 dark:border-neutral-800/50 rounded-xl shadow-xl overflow-hidden flex flex-col z-10 transition-all duration-300">
                                {/* Header Gradient */}
                                <div className="relative bg-gradient-to-r from-indigo-500 via-purple-600 to-pink-500 p-5 text-white">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <div className="bg-white/20 backdrop-blur-md px-2 py-0.5 rounded-full text-[9px] font-extrabold tracking-wider uppercase">
                                            {version || "v1.4.0"}
                                        </div>
                                        <span className="text-white/60 text-[10px] font-semibold">
                                            • {new Date(date).toLocaleDateString(previewLang === "es" ? "es-ES" : previewLang, { day: 'numeric', month: 'long', year: 'numeric' })}
                                        </span>
                                    </div>
                                    <h2 className="text-base font-extrabold tracking-tight flex items-center gap-1.5">
                                        <Sparkles size={16} className="text-amber-300 animate-pulse shrink-0" />
                                        <span className="truncate">{title[previewLang] || title["es"] || `[Título en ${previewLang.toUpperCase()}]`}</span>
                                    </h2>
                                    <p className="text-[11px] text-white/90 mt-1.5 font-medium leading-relaxed max-h-16 overflow-y-auto custom-scrollbar">
                                        {description[previewLang] || description["es"] || `[Introducción en ${previewLang.toUpperCase()}]`}
                                    </p>
                                </div>

                                {/* Content list */}
                                <div className="max-h-56 overflow-y-auto p-5 space-y-4 bg-neutral-50/50 dark:bg-neutral-900/30 custom-scrollbar">
                                    {features.length === 0 ? (
                                        <div className="text-center py-6 text-[10px] font-semibold text-neutral-400 leading-normal">
                                            Las características dinámicas que añadas<br />aparecerán listadas aquí con sus imágenes.
                                        </div>
                                    ) : (
                                        features.map((feature, idx) => {
                                            const fTitle = feature.title[previewLang] || feature.title["es"] || `[Item ${idx + 1}]`;
                                            const fDesc = feature.desc[previewLang] || feature.desc["es"] || "";
                                            const labelText = getCategoryLabel(feature.type, previewLang);
                                            
                                            return (
                                                <div key={idx} className="flex gap-3 items-start border-b border-neutral-100 dark:border-neutral-800/40 pb-3.5 last:border-0 last:pb-0">
                                                    <div className="shrink-0">
                                                        <span className={cn(
                                                            "inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider",
                                                            feature.type === 'new' && "bg-indigo-50 text-indigo-700 border border-indigo-200/50 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-850",
                                                            feature.type === 'improved' && "bg-emerald-50 text-emerald-700 border border-emerald-200/50 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-indigo-850",
                                                            feature.type === 'fixed' && "bg-amber-50 text-amber-700 border border-amber-200/50 dark:bg-amber-500/10 dark:text-amber-400 dark:border-indigo-850"
                                                        )}>
                                                            {labelText}
                                                        </span>
                                                    </div>
                                                    <div className="flex-1 space-y-1">
                                                        <h4 className="text-[12px] font-bold text-neutral-800 dark:text-neutral-200 leading-tight">
                                                            {fTitle}
                                                        </h4>
                                                        {fDesc && (
                                                            <p className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-normal font-medium">
                                                                {fDesc}
                                                            </p>
                                                        )}
                                                        {feature.image && (
                                                            <div className="relative mt-2 rounded border border-neutral-200/50 dark:border-neutral-800 max-w-xs overflow-hidden bg-neutral-100">
                                                                <img
                                                                    src={feature.image.startsWith('/') ? `${process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/v1\/?$/, '') || 'https://api.parallly-chat.cloud'}${feature.image}` : feature.image}
                                                                    alt={fTitle}
                                                                    className="w-full h-auto object-cover max-h-32"
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>

                                {/* Close CTA */}
                                <div className="p-3.5 border-t border-neutral-100 dark:border-neutral-850 bg-white dark:bg-neutral-900 flex justify-end shrink-0">
                                    <button
                                        type="button"
                                        className="bg-indigo-600 text-white font-bold text-[11px] px-4 py-1.5 rounded-md shadow shadow-indigo-500/10"
                                    >
                                        {getCtaLabel(previewLang)}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            )}

            {/* --- HISTORY VIEW --- */}
            {activeTab === "history" && (
                <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 shadow-sm">
                    {loadingHistory ? (
                        <div className="flex flex-col items-center justify-center py-16">
                            <div className="w-8 h-8 border-2 border-neutral-200 dark:border-neutral-700 border-t-indigo-500 rounded-full animate-spin mb-3" />
                            <p className="text-sm text-neutral-500">Cargando historial de novedades...</p>
                        </div>
                    ) : historyItems.length === 0 ? (
                        <div className="text-center py-16 text-neutral-400">
                            <FileText className="mx-auto mb-3 text-neutral-300 dark:text-neutral-700" size={36} />
                            <h3 className="font-semibold text-neutral-700 dark:text-neutral-300 text-sm">Sin Novedades Registradas</h3>
                            <p className="text-xs text-neutral-500 dark:text-neutral-500 mt-1 max-w-sm mx-auto">
                                No has publicado ningún anuncio todavía. Redacta y publica tu primer changelog desde la pestaña anterior.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto select-none">
                            <table className="w-full border-collapse text-left text-sm text-neutral-500 dark:text-neutral-400">
                                <thead className="border-b border-neutral-200 dark:border-neutral-850 text-xs font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                    <tr>
                                        <th className="py-3 px-4">Versión</th>
                                        <th className="py-3 px-4">Título (ES)</th>
                                        <th className="py-3 px-4">Fecha</th>
                                        <th className="py-3 px-4">Características</th>
                                        <th className="py-3 px-4 text-center">Estado</th>
                                        <th className="py-3 px-4 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-850 font-medium text-neutral-800 dark:text-neutral-200">
                                    {historyItems.map((item) => {
                                        const parsedTitle = typeof item.title === "string" ? JSON.parse(item.title) : item.title;
                                        const parsedFeatures = typeof item.features === "string" ? JSON.parse(item.features) : item.features;
                                        
                                        return (
                                            <tr key={item.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/35 transition-colors">
                                                <td className="py-3.5 px-4 font-bold text-indigo-600 dark:text-indigo-400">
                                                    {item.version}
                                                </td>
                                                <td className="py-3.5 px-4 truncate max-w-xs font-semibold">
                                                    {parsedTitle?.es || parsedTitle?.en || ""}
                                                </td>
                                                <td className="py-3.5 px-4 text-xs font-semibold text-neutral-400 dark:text-neutral-550">
                                                    {new Date(item.date).toLocaleDateString("es-ES", { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </td>
                                                <td className="py-3.5 px-4 text-xs text-neutral-400">
                                                    <span className="bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded font-bold text-[10px]">
                                                        {parsedFeatures?.length || 0} items
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-4 text-center">
                                                    <span className={cn(
                                                        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold select-none",
                                                        item.isActive 
                                                            ? "bg-emerald-50 text-emerald-700 border border-emerald-250 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-850" 
                                                            : "bg-neutral-100 text-neutral-500 border border-neutral-200 dark:bg-neutral-800/50 dark:text-neutral-400 dark:border-neutral-850"
                                                    )}>
                                                        {item.isActive ? "Activo" : "Borrador"}
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-4 text-right">
                                                    <div className="flex items-center justify-end gap-2.5">
                                                        <button
                                                            onClick={() => handleEdit(item)}
                                                            className="text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                                                            title="Editar"
                                                        >
                                                            <Edit2 size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(item.id)}
                                                            className="text-neutral-400 hover:text-red-500 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-850 transition-colors"
                                                            title="Eliminar"
                                                        >
                                                            <Trash size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
