"use client";

/**
 * Menu management for restaurant tenants. Two halves: categories on
 * the left (collapsible groups) and items on the right (the catalog
 * with tags + allergens + price). Aimed at the operator who wants to
 * mark something sold-out for the day, add a special, or tweak prices
 * before service.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    UtensilsCrossed, Plus, Trash2, Edit2, X, Loader2, Save,
    AlertTriangle, CheckCircle, FolderTree, ChevronDown, ChevronRight,
    Tag, Wheat, Sparkles, BadgeAlert,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

interface Category {
    id: string;
    name: string;
    description?: string;
    sort_order: number;
    is_active: boolean;
}

interface MenuItem {
    id: string;
    category_id?: string;
    category_name?: string;
    name: string;
    description?: string;
    price: number;
    currency: string;
    image_url?: string;
    allergens: string[];
    tags: string[];
    prep_time_minutes?: number;
    calories?: number;
    is_available: boolean;
    is_active: boolean;
    sort_order: number;
}

const ALLERGEN_OPTIONS = ["gluten", "lactosa", "huevo", "mariscos", "pescado", "mani", "soja", "frutos_secos"];
const TAG_OPTIONS = ["vegetariano", "vegano", "sin_gluten", "picante", "saludable", "popular"];

export default function MenuPage() {
    const t = useTranslations("menu");
    const tHelp = useTranslations("help");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [categories, setCategories] = useState<Category[]>([]);
    const [items, setItems] = useState<MenuItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterCategory, setFilterCategory] = useState<string>("");
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const [showItemForm, setShowItemForm] = useState<MenuItem | "new" | null>(null);
    const [showCategoryForm, setShowCategoryForm] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");
    const [toast, setToast] = useState<string | null>(null);
    const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

    async function load() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const [catsRes, itemsRes] = await Promise.all([
                api.listMenuCategories(activeTenantId),
                api.listMenuItems(activeTenantId, { includeInactive: false }),
            ]);
            if (catsRes.success) setCategories(catsRes.data || []);
            if (itemsRes.success) setItems(itemsRes.data || []);
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, [activeTenantId]);

    async function handleCreateCategory() {
        if (!activeTenantId || !newCategoryName.trim()) return;
        try {
            const res = await api.createMenuCategory(activeTenantId, { name: newCategoryName.trim() });
            if (res.success) {
                setNewCategoryName("");
                setShowCategoryForm(false);
                showToast(tc("saved"));
                load();
            }
        } catch {
            showToast(tc("errorSaving"));
        }
    }

    async function handleDeleteCategory(id: string) {
        if (!activeTenantId) return;
        if (!confirm(t("deleteCategoryConfirm"))) return;
        try {
            await api.deleteMenuCategory(activeTenantId, id);
            showToast(tc("saved"));
            load();
        } catch {
            showToast(tc("errorSaving"));
        }
    }

    async function handleToggleAvailability(item: MenuItem) {
        if (!activeTenantId) return;
        try {
            await api.updateMenuItem(activeTenantId, item.id, { isAvailable: !item.is_available });
            load();
        } catch {
            showToast(tc("errorSaving"));
        }
    }

    async function handleDeleteItem(id: string) {
        if (!activeTenantId) return;
        if (!confirm(t("deleteItemConfirm"))) return;
        try {
            await api.deleteMenuItem(activeTenantId, id);
            showToast(tc("saved"));
            load();
        } catch {
            showToast(tc("errorSaving"));
        }
    }

    const filteredItems = filterCategory
        ? items.filter(i => i.category_id === filterCategory)
        : items;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <UtensilsCrossed className="h-6 w-6 text-orange-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <button
                    onClick={() => setShowItemForm("new")}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition"
                >
                    <Plus className="h-4 w-4" /> {t("addItem")}
                </button>
            </div>

            <HelpPanel
                title={tHelp("menu.title")}
                description={tHelp("menu.description")}
                tips={tHelp.raw("menu.tips") as string[]}
                mediaKey="menu"
            />

            {feedback && (
                <div className={cn(
                    "p-3 rounded-lg text-sm border flex items-start gap-2",
                    feedback.type === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
                    feedback.type === "error" && "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
                )}>
                    {feedback.type === "success" ? <CheckCircle className="h-4 w-4 mt-0.5" /> : <AlertTriangle className="h-4 w-4 mt-0.5" />}
                    <span>{feedback.text}</span>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
                {/* Categories sidebar */}
                <div className="bg-card border border-border rounded-xl">
                    <div className="p-4 border-b border-border flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <FolderTree className="h-4 w-4 text-orange-500" />
                            <span className="font-semibold text-sm">{t("categories")}</span>
                        </div>
                        <button
                            onClick={() => setShowCategoryForm(!showCategoryForm)}
                            className="p-1 hover:bg-muted rounded"
                        >
                            <Plus className="h-4 w-4" />
                        </button>
                    </div>
                    {showCategoryForm && (
                        <div className="p-3 border-b border-border bg-muted/20 flex gap-2">
                            <input
                                type="text"
                                value={newCategoryName}
                                onChange={e => setNewCategoryName(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && handleCreateCategory()}
                                placeholder={t("newCategoryPlaceholder")}
                                className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm"
                                autoFocus
                            />
                            <button onClick={handleCreateCategory} className="text-xs px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded">
                                {tc("save")}
                            </button>
                        </div>
                    )}
                    <div className="p-2 space-y-0.5">
                        <button
                            onClick={() => setFilterCategory("")}
                            className={cn(
                                "w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between transition",
                                !filterCategory ? "bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold" : "hover:bg-muted",
                            )}
                        >
                            <span>{t("allCategories")}</span>
                            <span className="text-xs text-muted-foreground">{items.length}</span>
                        </button>
                        {categories.map(c => {
                            const count = items.filter(i => i.category_id === c.id).length;
                            return (
                                <div key={c.id} className="group flex items-center">
                                    <button
                                        onClick={() => setFilterCategory(c.id)}
                                        className={cn(
                                            "flex-1 text-left px-2 py-1.5 rounded text-sm flex items-center justify-between transition",
                                            filterCategory === c.id ? "bg-orange-500/10 text-orange-700 dark:text-orange-300 font-semibold" : "hover:bg-muted",
                                        )}
                                    >
                                        <span className="truncate">{c.name}</span>
                                        <span className="text-xs text-muted-foreground">{count}</span>
                                    </button>
                                    <button
                                        onClick={() => handleDeleteCategory(c.id)}
                                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 rounded"
                                        title={t("deleteCategory")}
                                    >
                                        <Trash2 className="h-3 w-3 text-red-600" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Items grid */}
                <div className="bg-card border border-border rounded-xl">
                    <div className="p-4 border-b border-border">
                        <h2 className="font-semibold text-sm">
                            {filterCategory
                                ? categories.find(c => c.id === filterCategory)?.name
                                : t("allItems")}
                            <span className="ml-2 text-xs text-muted-foreground font-normal">
                                {filteredItems.length} {t("itemsCount")}
                            </span>
                        </h2>
                    </div>
                    {loading ? (
                        <div className="p-3 space-y-2">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="skeleton h-14 w-full rounded-lg" />
                            ))}
                        </div>
                    ) : filteredItems.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground text-sm">
                            {t("noItems")}
                        </div>
                    ) : (
                        <div className="divide-y divide-border">
                            {filteredItems.map(item => (
                                <div key={item.id} className={cn(
                                    "p-4 hover:bg-muted/20 transition",
                                    !item.is_available && "opacity-60",
                                )}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium">{item.name}</span>
                                                <span className="text-sm font-mono">
                                                    {Number(item.price).toLocaleString()} {item.currency}
                                                </span>
                                                {!item.is_available && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 font-medium">
                                                        {t("soldOut")}
                                                    </span>
                                                )}
                                            </div>
                                            {item.description && (
                                                <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                                            )}
                                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                                {(item.tags || []).map(tag => (
                                                    <span key={tag} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                                                        <Tag className="h-2.5 w-2.5" />
                                                        {tag}
                                                    </span>
                                                ))}
                                                {(item.allergens || []).map(a => (
                                                    <span key={a} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                                        <Wheat className="h-2.5 w-2.5" />
                                                        {a}
                                                    </span>
                                                ))}
                                                {item.prep_time_minutes && (
                                                    <span className="text-[10px] text-muted-foreground">
                                                        ⏱ {item.prep_time_minutes}m
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                                            <button
                                                onClick={() => handleToggleAvailability(item)}
                                                className={cn(
                                                    "px-2 py-1 rounded text-xs font-medium transition",
                                                    item.is_available
                                                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                                                        : "bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/20",
                                                )}
                                            >
                                                {item.is_available ? t("available") : t("unavailable")}
                                            </button>
                                            <div className="flex gap-1">
                                                <button onClick={() => setShowItemForm(item)} className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors" title={tc("edit") || "Edit"}>
                                                    <Edit2 className="h-3.5 w-3.5" />
                                                </button>
                                                <button onClick={() => handleDeleteItem(item.id)} className="p-1.5 hover:bg-red-500/10 rounded" title={tc("delete") || "Delete"}>
                                                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {showItemForm && (
                <ItemFormModal
                    item={showItemForm === "new" ? null : showItemForm}
                    categories={categories}
                    onClose={() => setShowItemForm(null)}
                    onSaved={() => { setShowItemForm(null); load(); setFeedback({ type: "success", text: t("itemSaved") }); }}
                />
            )}

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold bg-emerald-500 text-white shadow-lg animate-in">
                    {toast}
                </div>
            )}
        </div>
    );
}

function ItemFormModal({
    item, categories, onClose, onSaved,
}: {
    item: MenuItem | null;
    categories: Category[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const t = useTranslations("menu");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [form, setForm] = useState({
        name: item?.name || "",
        description: item?.description || "",
        categoryId: item?.category_id || "",
        price: item?.price?.toString() || "",
        currency: item?.currency || "COP",
        prepTimeMinutes: item?.prep_time_minutes?.toString() || "",
        tags: item?.tags || [],
        allergens: item?.allergens || [],
    });
    const [busy, setBusy] = useState(false);

    function toggleArrayValue(field: "tags" | "allergens", value: string) {
        setForm(f => ({
            ...f,
            [field]: f[field].includes(value) ? f[field].filter(v => v !== value) : [...f[field], value],
        }));
    }

    async function handleSubmit() {
        if (!activeTenantId || !form.name || !form.price) return;
        setBusy(true);
        const payload = {
            name: form.name,
            description: form.description || undefined,
            categoryId: form.categoryId || undefined,
            price: parseFloat(form.price),
            currency: form.currency,
            prepTimeMinutes: form.prepTimeMinutes ? parseInt(form.prepTimeMinutes, 10) : undefined,
            tags: form.tags,
            allergens: form.allergens,
        };
        try {
            if (item) {
                await api.updateMenuItem(activeTenantId, item.id, payload);
            } else {
                await api.createMenuItem(activeTenantId, payload);
            }
            onSaved();
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <h3 className="text-base font-semibold">{item ? t("editItem") : t("newItem")}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
                </div>

                <div className="p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                            <label className="block text-sm font-medium mb-1">{t("itemName")}</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })}
                                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                        <div className="col-span-2">
                            <label className="block text-sm font-medium mb-1">{t("description")}</label>
                            <textarea
                                value={form.description}
                                onChange={e => setForm({ ...form, description: e.target.value })}
                                rows={2}
                                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">{t("category")}</label>
                            <select
                                value={form.categoryId}
                                onChange={e => setForm({ ...form, categoryId: e.target.value })}
                                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                            >
                                <option value="">{t("noCategory")}</option>
                                {categories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">{t("price")}</label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    step="0.01"
                                    value={form.price}
                                    onChange={e => setForm({ ...form, price: e.target.value })}
                                    className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm"
                                />
                                <input
                                    type="text"
                                    value={form.currency}
                                    onChange={e => setForm({ ...form, currency: e.target.value })}
                                    className="w-20 bg-card border border-border rounded-lg px-3 py-2 text-sm font-mono"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">{t("prepTimeMinutes")}</label>
                            <input
                                type="number"
                                value={form.prepTimeMinutes}
                                onChange={e => setForm({ ...form, prepTimeMinutes: e.target.value })}
                                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2 flex items-center gap-1">
                            <Sparkles className="h-3.5 w-3.5" /> {t("tags")}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {TAG_OPTIONS.map(tag => (
                                <button
                                    key={tag}
                                    onClick={() => toggleArrayValue("tags", tag)}
                                    className={cn(
                                        "px-2.5 py-1 rounded-full text-xs transition",
                                        form.tags.includes(tag)
                                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                                            : "bg-card border border-border text-muted-foreground hover:bg-muted",
                                    )}
                                >
                                    {tag}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2 flex items-center gap-1">
                            <BadgeAlert className="h-3.5 w-3.5" /> {t("allergens")}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {ALLERGEN_OPTIONS.map(a => (
                                <button
                                    key={a}
                                    onClick={() => toggleArrayValue("allergens", a)}
                                    className={cn(
                                        "px-2.5 py-1 rounded-full text-xs transition",
                                        form.allergens.includes(a)
                                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                                            : "bg-card border border-border text-muted-foreground hover:bg-muted",
                                    )}
                                >
                                    {a}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} className="px-3 py-1.5 bg-muted/30 hover:bg-muted text-foreground border border-border rounded-lg text-sm transition-colors">{tc("cancel")}</button>
                    <button onClick={handleSubmit} disabled={busy || !form.name || !form.price} className="inline-flex items-center gap-2 px-4 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
