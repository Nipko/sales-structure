"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Lightbulb, ChevronUp, MessageSquare, Plus, X, AlertCircle, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const STATUS_TABS = [
    { id: "all", labelKey: "all" },
    { id: "open", labelKey: "open" },
    { id: "under_review", labelKey: "under_review" },
    { id: "planned", labelKey: "planned" },
    { id: "in_progress", labelKey: "in_progress" },
    { id: "shipped", labelKey: "shipped" },
];

const STATUS_COLOR: Record<string, string> = {
    open: "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400",
    under_review: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    planned: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    in_progress: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    shipped: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    declined: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const CATEGORIES = ["ai", "integrations", "analytics", "crm", "billing", "ux", "other"];

export default function FeatureRequestsPage() {
    const t = useTranslations("featureRequests");
    const { user } = useAuth();
    const isAdmin = user?.role === "super_admin";

    const [view, setView] = useState<"board" | "changelog">("board");
    const [requests, setRequests] = useState<any[]>([]);
    const [changelog, setChangelog] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusTab, setStatusTab] = useState("all");
    const [categoryFilter, setCategoryFilter] = useState<string>("");
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState<"score" | "top" | "recent">("score");
    const [showCreate, setShowCreate] = useState(false);
    const [selected, setSelected] = useState<any | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(null), 2500);
    }

    useEffect(() => {
        if (view === "board") load();
        else loadChangelog();
    }, [statusTab, categoryFilter, sort, view]);

    async function load() {
        setLoading(true);
        const params: any = { sort };
        if (statusTab !== "all") params.status = statusTab;
        if (categoryFilter) params.category = categoryFilter;
        if (search.trim()) params.search = search.trim();
        const r = await api.listFeatureRequests(params);
        setRequests(r.data || []);
        setLoading(false);
    }

    async function loadChangelog() {
        setLoading(true);
        const r = await api.getFeatureRequestChangelog();
        setChangelog(r.data || []);
        setLoading(false);
    }

    const changelogByMonth = useMemo(() => {
        const map = new Map<string, any[]>();
        for (const item of changelog) {
            const key = item.month;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(item);
        }
        return Array.from(map.entries());
    }, [changelog]);

    async function toggleVote(req: any) {
        try {
            if (req.user_voted) {
                await api.unvoteFeatureRequest(req.id);
            } else {
                await api.voteFeatureRequest(req.id);
            }
            setRequests((rs) =>
                rs.map((r) =>
                    r.id === req.id
                        ? { ...r, user_voted: !r.user_voted, vote_count: r.vote_count + (r.user_voted ? -1 : 1) }
                        : r
                )
            );
        } catch (e: any) {
            showToast(e.message || "Error");
        }
    }

    return (
        <div>
            {toast && (
                <div className="fixed top-6 right-6 z-[9999] bg-neutral-900 text-white px-4 py-2 rounded-xl text-sm shadow-lg">
                    {toast}
                </div>
            )}
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={Lightbulb}
                action={
                    <button
                        onClick={() => setShowCreate(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-xl text-sm font-medium hover:bg-indigo-600 transition-colors"
                    >
                        <Plus size={16} />
                        {t("submit")}
                    </button>
                }
            />

            <div className="flex gap-1 mb-4 border-b border-neutral-200 dark:border-neutral-800">
                <button
                    onClick={() => setView("board")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        view === "board"
                            ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                            : "border-transparent text-neutral-500 hover:text-neutral-700"
                    }`}
                >
                    {t("viewBoard")}
                </button>
                <button
                    onClick={() => setView("changelog")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        view === "changelog"
                            ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                            : "border-transparent text-neutral-500 hover:text-neutral-700"
                    }`}
                >
                    {t("viewChangelog")}
                </button>
            </div>

            {view === "changelog" ? (
                <div className="space-y-8">
                    {loading ? (
                        <div className="text-sm text-neutral-500 py-12 text-center">{t("loading")}</div>
                    ) : changelogByMonth.length === 0 ? (
                        <div className="text-sm text-neutral-500 py-12 text-center">{t("changelogEmpty")}</div>
                    ) : (
                        changelogByMonth.map(([month, items]) => (
                            <div key={month}>
                                <h3 className="text-sm font-medium text-neutral-500 mb-3 sticky top-0 bg-white dark:bg-neutral-950 py-1">
                                    {new Date(month + "-01").toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                                </h3>
                                <div className="space-y-2">
                                    {items.map((item: any) => (
                                        <div
                                            key={item.id}
                                            className="p-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl"
                                        >
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                                    {t("status.shipped")}
                                                </span>
                                                {item.category && (
                                                    <span className="text-xs px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                                                        {t(`category.${item.category}`)}
                                                    </span>
                                                )}
                                                <span className="text-xs text-neutral-500">
                                                    {item.vote_count} {t("votesShort")}
                                                </span>
                                            </div>
                                            <h4 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.title}</h4>
                                            <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{item.description}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ) : (
                <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && load()}
                        placeholder={t("searchPlaceholder")}
                        className="w-full pl-9 pr-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl text-sm"
                    />
                </div>
                <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl text-sm"
                >
                    <option value="">{t("allCategories")}</option>
                    {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                            {t(`category.${c}`)}
                        </option>
                    ))}
                </select>
                <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as any)}
                    className="px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl text-sm"
                >
                    <option value="score">{t("sort.smart")}</option>
                    <option value="top">{t("sort.topVoted")}</option>
                    <option value="recent">{t("sort.recent")}</option>
                </select>
            </div>

            <TabNav
                tabs={STATUS_TABS.map((s) => ({
                    id: s.id,
                    label: t(`status.${s.labelKey}`),
                }))}
                activeTab={statusTab}
                onTabChange={setStatusTab}
            />

            <div className="mt-4 space-y-2">
                {loading ? (
                    <div className="text-sm text-neutral-500 py-12 text-center">{t("loading")}</div>
                ) : requests.length === 0 ? (
                    <div className="text-sm text-neutral-500 py-12 text-center">{t("empty")}</div>
                ) : (
                    requests.map((req: any) => (
                        <RequestRow key={req.id} req={req} onVote={() => toggleVote(req)} onClick={() => setSelected(req)} t={t} />
                    ))
                )}
            </div>

                </>
            )}

            {showCreate && (
                <CreateModal
                    onClose={() => setShowCreate(false)}
                    onCreated={(req: any) => {
                        setShowCreate(false);
                        setRequests((rs) => [req, ...rs]);
                        setSelected(req);
                    }}
                    notify={showToast}
                    t={t}
                />
            )}

            {selected && (
                <DetailPanel
                    request={selected}
                    onClose={() => setSelected(null)}
                    onVote={() => toggleVote(selected)}
                    onUpdate={() => {
                        load();
                    }}
                    isAdmin={isAdmin}
                    notify={showToast}
                    t={t}
                />
            )}
        </div>
    );
}

function RequestRow({ req, onVote, onClick, t }: any) {
    return (
        <div className="flex items-stretch gap-3 p-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors">
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onVote();
                }}
                className={`flex flex-col items-center justify-center min-w-[60px] py-2 rounded-lg border transition-all ${
                    req.user_voted
                        ? "bg-indigo-500/10 border-indigo-500/40 text-indigo-600 dark:text-indigo-400"
                        : "bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 hover:border-indigo-500/40"
                }`}
            >
                <ChevronUp size={18} />
                <span className="text-sm font-medium">{req.vote_count}</span>
            </button>
            <button onClick={onClick} className="flex-1 text-left min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{req.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-md ${STATUS_COLOR[req.status]}`}>
                        {t(`status.${req.status}`)}
                    </span>
                    {req.category && (
                        <span className="text-xs px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                            {t(`category.${req.category}`)}
                        </span>
                    )}
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">{req.description}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-neutral-500">
                    <span>{req.author_name || t("anonymous")}</span>
                    {req.author_tenant_name && <span>· {req.author_tenant_name}</span>}
                    <span className="flex items-center gap-1">
                        <MessageSquare size={12} />
                        {req.comment_count}
                    </span>
                </div>
            </button>
        </div>
    );
}

function CreateModal({ onClose, onCreated, notify, t }: any) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [similar, setSimilar] = useState<any[]>([]);
    const [similarLoading, setSimilarLoading] = useState(false);

    // Real-time duplicate detection — ping similar endpoint after user pauses typing.
    useEffect(() => {
        const text = `${title} ${description}`.trim();
        if (text.length < 12) {
            setSimilar([]);
            return;
        }
        setSimilarLoading(true);
        const handle = setTimeout(async () => {
            const r = await api.findSimilarFeatureRequests(text);
            setSimilar(r.data || []);
            setSimilarLoading(false);
        }, 500);
        return () => clearTimeout(handle);
    }, [title, description]);

    async function submit() {
        if (!title.trim() || !description.trim()) return;
        setSubmitting(true);
        const r = await api.createFeatureRequest({ title, description, category: category || undefined });
        setSubmitting(false);
        if (r.success) {
            notify(t("submitted"));
            onCreated(r.data);
        } else {
            notify(r.error || "Error");
        }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-5 border-b border-neutral-200 dark:border-neutral-800">
                    <h2 className="text-lg font-semibold">{t("createTitle")}</h2>
                    <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("titleLabel")}</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={t("titlePlaceholder")}
                            className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("descriptionLabel")}</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={t("descriptionPlaceholder")}
                            rows={5}
                            className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">{t("categoryLabel")}</label>
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm"
                        >
                            <option value="">{t("noCategory")}</option>
                            {CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                    {t(`category.${c}`)}
                                </option>
                            ))}
                        </select>
                    </div>

                    {similar.length > 0 && (
                        <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                            <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400 mb-2">
                                <AlertCircle size={16} />
                                {t("similarFound")}
                            </div>
                            <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-3">{t("similarHint")}</p>
                            <div className="space-y-2">
                                {similar.map((s: any) => (
                                    <div
                                        key={s.id}
                                        className="flex items-center justify-between p-2 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm truncate">{s.title}</p>
                                            <p className="text-xs text-neutral-500">
                                                {s.vote_count} {t("votesShort")} · {Math.round(s.similarity * 100)}% {t("match")}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex items-center justify-end gap-2 p-5 border-t border-neutral-200 dark:border-neutral-800">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl"
                    >
                        {t("cancel")}
                    </button>
                    <button
                        onClick={submit}
                        disabled={submitting || !title.trim() || !description.trim()}
                        className="px-4 py-2 bg-indigo-500 text-white rounded-xl text-sm font-medium hover:bg-indigo-600 disabled:opacity-50"
                    >
                        {submitting ? t("submitting") : t("submit")}
                    </button>
                </div>
            </div>
        </div>
    );
}

function DetailPanel({ request, onClose, onVote, onUpdate, isAdmin, notify, t }: any) {
    const [comments, setComments] = useState<any[]>([]);
    const [newComment, setNewComment] = useState("");
    const [statusUpdate, setStatusUpdate] = useState(request.status);
    const [declinedReason, setDeclinedReason] = useState(request.declined_reason || "");

    useEffect(() => {
        api.listFeatureRequestComments(request.id).then((r) => setComments(r.data || []));
    }, [request.id]);

    async function postComment() {
        if (!newComment.trim()) return;
        const r = await api.commentFeatureRequest(request.id, newComment);
        if (r.success) {
            setNewComment("");
            const fresh = await api.listFeatureRequestComments(request.id);
            setComments(fresh.data || []);
            onUpdate();
        }
    }

    async function applyStatus() {
        await api.updateFeatureRequestStatus(request.id, {
            status: statusUpdate,
            declinedReason: statusUpdate === "declined" ? declinedReason : undefined,
        });
        notify(t("statusUpdated"));
        onUpdate();
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-end" onClick={onClose}>
            <div
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-800 w-full max-w-xl h-full overflow-y-auto"
            >
                <div className="sticky top-0 bg-white dark:bg-neutral-900 z-10 flex items-center justify-between p-5 border-b border-neutral-200 dark:border-neutral-800">
                    <span className={`text-xs px-2 py-0.5 rounded-md ${STATUS_COLOR[request.status]}`}>
                        {t(`status.${request.status}`)}
                    </span>
                    <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-5">
                    <div className="flex items-start gap-3 mb-4">
                        <button
                            onClick={onVote}
                            className={`flex flex-col items-center justify-center min-w-[60px] py-2 rounded-lg border transition-all ${
                                request.user_voted
                                    ? "bg-indigo-500/10 border-indigo-500/40 text-indigo-600 dark:text-indigo-400"
                                    : "bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
                            }`}
                        >
                            <ChevronUp size={18} />
                            <span className="text-sm font-medium">{request.vote_count}</span>
                        </button>
                        <div className="flex-1 min-w-0">
                            <h2 className="text-lg font-semibold">{request.title}</h2>
                            <p className="text-xs text-neutral-500 mt-1">
                                {request.author_name} · {new Date(request.created_at).toLocaleDateString()}
                            </p>
                        </div>
                    </div>
                    <p className="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap mb-6">
                        {request.description}
                    </p>

                    {request.declined_reason && (
                        <div className="mb-6 p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                            <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">{t("declinedReason")}</p>
                            <p className="text-sm text-neutral-700 dark:text-neutral-300">{request.declined_reason}</p>
                        </div>
                    )}

                    {isAdmin && (
                        <div className="mb-6 p-4 bg-violet-500/5 border border-violet-500/20 rounded-xl">
                            <p className="text-xs font-medium mb-2">{t("adminActions")}</p>
                            <div className="flex gap-2">
                                <select
                                    value={statusUpdate}
                                    onChange={(e) => setStatusUpdate(e.target.value)}
                                    className="flex-1 px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl text-sm"
                                >
                                    {["open", "under_review", "planned", "in_progress", "shipped", "declined"].map((s) => (
                                        <option key={s} value={s}>
                                            {t(`status.${s}`)}
                                        </option>
                                    ))}
                                </select>
                                <button onClick={applyStatus} className="px-4 py-2 bg-violet-500 text-white rounded-xl text-sm">
                                    {t("apply")}
                                </button>
                            </div>
                            {statusUpdate === "declined" && (
                                <textarea
                                    value={declinedReason}
                                    onChange={(e) => setDeclinedReason(e.target.value)}
                                    placeholder={t("declinedReasonPlaceholder")}
                                    rows={2}
                                    className="w-full mt-2 px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl text-sm"
                                />
                            )}
                        </div>
                    )}

                    <div>
                        <h3 className="text-sm font-medium mb-3">
                            {t("comments")} ({comments.length})
                        </h3>
                        <div className="space-y-3 mb-4">
                            {comments.map((c: any) => (
                                <div
                                    key={c.id}
                                    className={`p-3 rounded-xl border ${
                                        c.is_admin_reply
                                            ? "bg-indigo-500/5 border-indigo-500/30"
                                            : "bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
                                    }`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-medium">{c.author_name}</span>
                                        {c.is_admin_reply && (
                                            <span className="text-xs px-1.5 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded">
                                                {t("teamReply")}
                                            </span>
                                        )}
                                        <span className="text-xs text-neutral-500">
                                            {new Date(c.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <textarea
                                value={newComment}
                                onChange={(e) => setNewComment(e.target.value)}
                                placeholder={t("commentPlaceholder")}
                                rows={2}
                                className="flex-1 px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm"
                            />
                            <button
                                onClick={postComment}
                                disabled={!newComment.trim()}
                                className="px-4 py-2 bg-indigo-500 text-white rounded-xl text-sm font-medium disabled:opacity-50"
                            >
                                {t("post")}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
