"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTenant } from "@/contexts/TenantContext";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { HelpCircle, Plus, Trash2, Save, X, Edit2, Eye, EyeOff, Tag, BookOpen, Search } from "lucide-react";

type Faq = {
    id: string;
    question: string;
    answer: string;
    category?: string;
    tags: string[];
    orderIndex: number;
    isPublished: boolean;
    views: number;
    createdAt: string;
    updatedAt: string;
};

type FaqForm = {
    question: string;
    answer: string;
    category: string;
    tagsRaw: string;
    isPublished: boolean;
    orderIndex: number;
};

const EMPTY_FORM: FaqForm = {
    question: "",
    answer: "",
    category: "",
    tagsRaw: "",
    isPublished: true,
    orderIndex: 0,
};

export default function FaqsPage() {
    const { activeTenantId } = useTenant();
    const t = useTranslations("knowledge.faqs");
    const tKb = useTranslations("knowledge");
    const [faqs, setFaqs] = useState<Faq[]>([]);
    const [loading, setLoading] = useState(true);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<Faq | null>(null);
    const [form, setForm] = useState<FaqForm>(EMPTY_FORM);
    const [error, setError] = useState("");

    const load = () => {
        if (!activeTenantId) return;
        setLoading(true);
        api.listFaqs(activeTenantId).then((res: any) => {
            if (res.success && Array.isArray(res.data)) setFaqs(res.data);
            setLoading(false);
        });
    };

    useEffect(() => { load(); }, [activeTenantId]);

    const openNew = () => {
        setEditing(null);
        setForm(EMPTY_FORM);
        setError("");
        setEditorOpen(true);
    };

    const openEdit = (faq: Faq) => {
        setEditing(faq);
        setForm({
            question: faq.question,
            answer: faq.answer,
            category: faq.category || "",
            tagsRaw: (faq.tags || []).join(", "),
            isPublished: faq.isPublished,
            orderIndex: faq.orderIndex,
        });
        setError("");
        setEditorOpen(true);
    };

    const save = async () => {
        if (!activeTenantId) return;
        if (!form.question.trim() || !form.answer.trim()) {
            setError(t("errors.required"));
            return;
        }
        const payload = {
            question: form.question.trim(),
            answer: form.answer.trim(),
            category: form.category.trim() || undefined,
            tags: form.tagsRaw.split(",").map(s => s.trim()).filter(Boolean),
            isPublished: form.isPublished,
            orderIndex: form.orderIndex,
        };
        const result = editing
            ? await api.updateFaq(activeTenantId, editing.id, payload)
            : await api.createFaq(activeTenantId, payload);
        if (result.success) {
            setEditorOpen(false);
            load();
        } else {
            setError(result.error || t("errors.saveFailed"));
        }
    };

    const remove = async (id: string) => {
        if (!activeTenantId) return;
        if (!confirm(t("confirmDelete"))) return;
        const result = await api.deleteFaq(activeTenantId, id);
        if (result.success) load();
    };

    const categories = Array.from(new Set(faqs.map(f => f.category).filter(Boolean))) as string[];

    const inputCls = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500";
    const textareaCls = "w-full min-h-[120px] rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 resize-y";

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                        <HelpCircle size={20} className="text-indigo-600" />
                        {t("title")}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
                </div>
                <button
                    onClick={openNew}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-medium text-white transition-colors"
                >
                    <Plus size={16} />
                    {t("newFaq")}
                </button>
            </div>

            {/* Sub-nav mirrors the Knowledge landing for consistency */}
            <div className="flex gap-1 bg-card rounded-xl p-1 border border-border w-fit">
                <Link href="/admin/knowledge" className="px-4 py-2 rounded-lg font-semibold text-[13px] flex items-center gap-1.5 bg-transparent text-muted-foreground hover:text-foreground transition-colors">
                    <BookOpen size={16} /> {tKb("tabs.library")}
                </Link>
                <span className="px-4 py-2 rounded-lg font-semibold text-[13px] flex items-center gap-1.5 bg-primary text-primary-foreground">
                    <HelpCircle size={16} /> {tKb("tabs.faqs")}
                </span>
                <Link href="/admin/knowledge?tab=search" className="px-4 py-2 rounded-lg font-semibold text-[13px] flex items-center gap-1.5 bg-transparent text-muted-foreground hover:text-foreground transition-colors">
                    <Search size={16} /> {tKb("tabs.search")}
                </Link>
            </div>

            {loading ? (
                <div className="text-sm text-neutral-500">{t("loading")}</div>
            ) : faqs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-12 text-center">
                    <HelpCircle size={32} className="mx-auto text-neutral-400 mb-3" />
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("empty")}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {categories.map((cat) => {
                        const items = faqs.filter(f => f.category === cat);
                        return (
                            <div key={cat || "uncat"}>
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-2 flex items-center gap-1">
                                    <Tag size={12} />
                                    {cat}
                                </h3>
                                <div className="space-y-2">
                                    {items.map(faq => <FaqRow key={faq.id} faq={faq} onEdit={openEdit} onDelete={remove} t={t} />)}
                                </div>
                            </div>
                        );
                    })}
                    {faqs.filter(f => !f.category).length > 0 && (
                        <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-2">{t("uncategorized")}</h3>
                            <div className="space-y-2">
                                {faqs.filter(f => !f.category).map(faq => <FaqRow key={faq.id} faq={faq} onEdit={openEdit} onDelete={remove} t={t} />)}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {editorOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setEditorOpen(false)}>
                    <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                                {editing ? t("editTitle") : t("newTitle")}
                            </h2>
                            <button onClick={() => setEditorOpen(false)} className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                                <X size={18} />
                            </button>
                        </div>

                        {error && (
                            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                                {error}
                            </div>
                        )}

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.question")} *</label>
                                <input className={inputCls} value={form.question} onChange={e => setForm({ ...form, question: e.target.value })} placeholder={t("placeholders.question")} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.answer")} *</label>
                                <textarea className={textareaCls} value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} placeholder={t("placeholders.answer")} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.category")}</label>
                                    <input className={inputCls} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder={t("placeholders.category")} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.order")}</label>
                                    <input type="number" className={inputCls} value={form.orderIndex} onChange={e => setForm({ ...form, orderIndex: parseInt(e.target.value) || 0 })} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">{t("fields.tags")}</label>
                                <input className={inputCls} value={form.tagsRaw} onChange={e => setForm({ ...form, tagsRaw: e.target.value })} placeholder={t("placeholders.tags")} />
                            </div>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={form.isPublished} onChange={e => setForm({ ...form, isPublished: e.target.checked })} className="rounded" />
                                <span className="text-neutral-700 dark:text-neutral-300">{t("fields.published")}</span>
                            </label>
                        </div>

                        <div className="mt-6 flex justify-end gap-2">
                            <button onClick={() => setEditorOpen(false)} className="px-4 py-2 rounded-lg text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                                {t("cancel")}
                            </button>
                            <button onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-medium text-white">
                                <Save size={16} />
                                {t("save")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function FaqRow({ faq, onEdit, onDelete, t }: { faq: Faq; onEdit: (f: Faq) => void; onDelete: (id: string) => void; t: any }) {
    return (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        {faq.isPublished ? (
                            <Eye size={12} className="text-green-600 dark:text-green-400" />
                        ) : (
                            <EyeOff size={12} className="text-neutral-400" />
                        )}
                        <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{faq.question}</h3>
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">{faq.answer}</p>
                    {faq.tags?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                            {faq.tags.map((tag, i) => (
                                <span key={i} className="inline-flex items-center rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-600 dark:text-neutral-400">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] text-neutral-400 mr-2">{faq.views} {t("views")}</span>
                    <button onClick={() => onEdit(faq)} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("edit")}>
                        <Edit2 size={14} className="text-neutral-600 dark:text-neutral-400" />
                    </button>
                    <button onClick={() => onDelete(faq.id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20" title={t("delete")}>
                        <Trash2 size={14} className="text-red-600 dark:text-red-400" />
                    </button>
                </div>
            </div>
        </div>
    );
}
