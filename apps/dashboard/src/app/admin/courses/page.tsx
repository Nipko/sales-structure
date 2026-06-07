"use client";

/**
 * Course catalog + cohorts + enrollments dashboard for education
 * tenants. Three tabs:
 *   - Cursos (catálogo)
 *   - Cohortes (instancias programadas — bookable units)
 *   - Inscripciones (estudiantes inscritos)
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    GraduationCap, Plus, Edit2, Trash2, X, Loader2, Save, Calendar,
    Users, BookOpen, AlertTriangle, CheckCircle, AlertCircle,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

interface Course {
    id: string;
    name: string;
    description?: string;
    subject?: string;
    level?: string;
    modality: string;
    duration_hours?: number;
    duration_weeks?: number;
    price: number;
    currency: string;
    certification?: string;
    is_active: boolean;
}

interface Cohort {
    id: string;
    course_id: string;
    course_name?: string;
    course_subject?: string;
    course_level?: string;
    cohort_code?: string;
    instructor_name?: string;
    starts_at: string;
    ends_at?: string;
    schedule?: string;
    max_capacity: number;
    available_seats: number;
    status: string;
}

interface Enrollment {
    id: string;
    cohort_id: string;
    course_id: string;
    course_name?: string;
    cohort_code?: string;
    cohort_starts_at?: string;
    student_name: string;
    student_email?: string;
    student_phone?: string;
    status: string;
    payment_status: string;
    completion_percent: number;
    enrolled_at: string;
}

type TabId = "courses" | "cohorts" | "enrollments";

const MODALITY_OPTIONS = ["presencial", "online", "hybrid"];
const STATUS_COLORS: Record<string, string> = {
    enrolled: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dropped: "bg-red-500/10 text-red-700 dark:text-red-300",
    refunded: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

export default function CoursesPage() {
    const t = useTranslations("courses");
    const tHelp = useTranslations("help");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [tab, setTab] = useState<TabId>("courses");
    const [courses, setCourses] = useState<Course[]>([]);
    const [cohorts, setCohorts] = useState<Cohort[]>([]);
    const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCourseForm, setShowCourseForm] = useState<Course | "new" | null>(null);
    const [showCohortForm, setShowCohortForm] = useState<Course | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

    async function load() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const [coursesRes, cohortsRes, enrollmentsRes] = await Promise.all([
                api.listCourses(activeTenantId),
                api.listCourseCohorts(activeTenantId),
                api.listEnrollments(activeTenantId),
            ]);
            if (coursesRes.success) setCourses(coursesRes.data || []);
            if (cohortsRes.success) setCohorts(cohortsRes.data || []);
            if (enrollmentsRes.success) setEnrollments(enrollmentsRes.data || []);
        } finally { setLoading(false); }
    }

    useEffect(() => { load(); }, [activeTenantId]);

    async function handleDeleteCourse(id: string) {
        if (!activeTenantId || !confirm(t("deleteCourseConfirm"))) return;
        try {
            await api.deleteCourse(activeTenantId, id);
            showToast(tc("saved"));
            load();
        } catch {
            showToast(tc("errorSaving"));
        }
    }

    async function handleCancelCohort(id: string) {
        if (!activeTenantId || !confirm(t("cancelCohortConfirm"))) return;
        try {
            await api.cancelCohort(activeTenantId, id);
            showToast(tc("saved"));
            load();
        } catch {
            showToast(tc("errorSaving"));
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <GraduationCap className="h-6 w-6 text-violet-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                {tab === "courses" && (
                    <button onClick={() => setShowCourseForm("new")} className="inline-flex items-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium">
                        <Plus className="h-4 w-4" /> {t("addCourse")}
                    </button>
                )}
            </div>

            <HelpPanel
                title={tHelp("courses.title")}
                description={tHelp("courses.description")}
                tips={tHelp.raw("courses.tips") as string[]}
                mediaKey="courses"
            />

            <div className="flex bg-card border border-border rounded-lg p-0.5 w-fit">
                {([
                    { id: "courses" as const, label: t("coursesTab"), icon: BookOpen, count: courses.length },
                    { id: "cohorts" as const, label: t("cohortsTab"), icon: Calendar, count: cohorts.length },
                    { id: "enrollments" as const, label: t("enrollmentsTab"), icon: Users, count: enrollments.length },
                ]).map(tabDef => {
                    const Icon = tabDef.icon;
                    return (
                        <button key={tabDef.id} onClick={() => setTab(tabDef.id)} className={cn(
                            "px-3 py-1.5 text-sm font-medium rounded transition inline-flex items-center gap-1.5",
                            tab === tabDef.id ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground",
                        )}>
                            <Icon className="h-3.5 w-3.5" />
                            {tabDef.label}
                            <span className="text-xs opacity-70">({tabDef.count})</span>
                        </button>
                    );
                })}
            </div>

            {/* Courses tab */}
            {tab === "courses" && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {loading ? (
                        <>
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="skeleton h-36 w-full rounded-xl" />
                            ))}
                        </>
                    ) : courses.length === 0 ? (
                        <div className="col-span-full text-center py-12 text-sm text-muted-foreground">{t("noCourses")}</div>
                    ) : courses.map(course => (
                        <div key={course.id} className="bg-card border border-border rounded-xl p-4">
                            <div className="flex items-start justify-between gap-2 mb-2">
                                <div>
                                    <h3 className="font-semibold">{course.name}</h3>
                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                        {course.subject && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{course.subject}</span>}
                                        {course.level && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-700 dark:text-violet-300 font-mono">{course.level}</span>}
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300">{course.modality}</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-lg font-bold font-mono">{Number(course.price).toLocaleString()}</div>
                                    <div className="text-xs text-muted-foreground font-mono">{course.currency}</div>
                                </div>
                            </div>
                            {course.description && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{course.description}</p>}
                            <div className="text-xs text-muted-foreground space-y-0.5 mb-3">
                                {course.duration_weeks && <div>📅 {course.duration_weeks} {t("weeks")}</div>}
                                {course.duration_hours && <div>⏱ {course.duration_hours} {t("hours")}</div>}
                                {course.certification && <div>🎓 {course.certification}</div>}
                            </div>
                            <div className="flex gap-1 justify-end pt-2 border-t border-border">
                                <button onClick={() => setShowCohortForm(course)} className="text-xs px-2 py-1 hover:bg-muted rounded inline-flex items-center gap-1" title={t("addCohort")}>
                                    <Calendar className="h-3 w-3" /> {t("addCohort")}
                                </button>
                                <button onClick={() => setShowCourseForm(course)} className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors">
                                    <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => handleDeleteCourse(course.id)} className="p-1.5 hover:bg-red-500/10 rounded">
                                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Cohorts tab */}
            {tab === "cohorts" && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                            <tr className="text-left">
                                <th className="px-4 py-2 font-semibold">{t("course")}</th>
                                <th className="px-4 py-2 font-semibold">{t("instructor")}</th>
                                <th className="px-4 py-2 font-semibold">{t("schedule")}</th>
                                <th className="px-4 py-2 font-semibold">{t("starts")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("seats")}</th>
                                <th className="px-4 py-2 font-semibold">{t("status")}</th>
                                <th className="px-4 py-2"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {cohorts.length === 0 ? (
                                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">{t("noCohorts")}</td></tr>
                            ) : cohorts.map(c => {
                                const fillPct = (1 - c.available_seats / c.max_capacity) * 100;
                                return (
                                    <tr key={c.id} className="hover:bg-muted/20">
                                        <td className="px-4 py-2">
                                            <div className="font-medium">{c.course_name}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {c.cohort_code && <span className="font-mono">{c.cohort_code}</span>}
                                                {c.course_level && <span className="ml-1">· {c.course_level}</span>}
                                            </div>
                                        </td>
                                        <td className="px-4 py-2 text-xs">{c.instructor_name || "—"}</td>
                                        <td className="px-4 py-2 text-xs font-mono">{c.schedule || "—"}</td>
                                        <td className="px-4 py-2 text-xs font-mono">{new Date(c.starts_at).toLocaleDateString()}</td>
                                        <td className="px-4 py-2 text-right">
                                            <div className="text-xs font-mono">{c.max_capacity - c.available_seats}/{c.max_capacity}</div>
                                            <div className="h-1 w-16 bg-muted rounded-full overflow-hidden mt-0.5">
                                                <div className={cn("h-full", fillPct >= 100 ? "bg-red-500" : fillPct >= 80 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${fillPct}%` }} />
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">
                                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
                                                c.status === "open" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                                c.status === "full" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                                                c.status === "cancelled" && "bg-red-500/10 text-red-700 dark:text-red-300",
                                                c.status === "finished" && "bg-neutral-500/10 text-neutral-600",
                                            )}>
                                                {t(`cohortStatus.${c.status}` as any)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                            {c.status === "open" && (
                                                <button onClick={() => handleCancelCohort(c.id)} className="text-xs text-red-600 hover:underline">
                                                    {tc("cancel")}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Enrollments tab */}
            {tab === "enrollments" && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                            <tr className="text-left">
                                <th className="px-4 py-2 font-semibold">{t("student")}</th>
                                <th className="px-4 py-2 font-semibold">{t("course")}</th>
                                <th className="px-4 py-2 font-semibold">{t("status")}</th>
                                <th className="px-4 py-2 font-semibold">{t("payment")}</th>
                                <th className="px-4 py-2 font-semibold text-right">{t("progress")}</th>
                                <th className="px-4 py-2 font-semibold">{t("enrolledAt")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {enrollments.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">{t("noEnrollments")}</td></tr>
                            ) : enrollments.map(e => (
                                <tr key={e.id} className="hover:bg-muted/20">
                                    <td className="px-4 py-2">
                                        <div className="font-medium">{e.student_name}</div>
                                        <div className="text-xs text-muted-foreground">{e.student_email || e.student_phone || "—"}</div>
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="text-xs">{e.course_name}</div>
                                        {e.cohort_starts_at && <div className="text-[10px] text-muted-foreground font-mono">{new Date(e.cohort_starts_at).toLocaleDateString()}</div>}
                                    </td>
                                    <td className="px-4 py-2">
                                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", STATUS_COLORS[e.status] || "bg-muted text-muted-foreground")}>
                                            {e.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2">
                                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
                                            e.payment_status === "paid" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                            e.payment_status === "partial" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                                            e.payment_status === "pending" && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
                                            e.payment_status === "refunded" && "bg-red-500/10 text-red-700 dark:text-red-300",
                                        )}>
                                            {e.payment_status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <div className="text-xs font-mono">{e.completion_percent}%</div>
                                    </td>
                                    <td className="px-4 py-2 text-xs text-muted-foreground font-mono">
                                        {new Date(e.enrolled_at).toLocaleDateString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showCourseForm && (
                <CourseFormModal course={showCourseForm === "new" ? null : showCourseForm} onClose={() => setShowCourseForm(null)} onSaved={() => { setShowCourseForm(null); showToast(tc("saved")); load(); }} onError={() => showToast(tc("errorSaving"))} />
            )}

            {showCohortForm && (
                <CohortFormModal course={showCohortForm} onClose={() => setShowCohortForm(null)} onSaved={() => { setShowCohortForm(null); showToast(tc("saved")); load(); }} onError={() => showToast(tc("errorSaving"))} />
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

function CourseFormModal({ course, onClose, onSaved, onError }: { course: Course | null; onClose: () => void; onSaved: () => void; onError?: () => void }) {
    const t = useTranslations("courses");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [form, setForm] = useState({
        name: course?.name || "",
        description: course?.description || "",
        subject: course?.subject || "",
        level: course?.level || "",
        modality: course?.modality || "presencial",
        durationHours: course?.duration_hours?.toString() || "",
        durationWeeks: course?.duration_weeks?.toString() || "",
        price: course?.price?.toString() || "",
        currency: course?.currency || "COP",
        certification: course?.certification || "",
    });
    const [busy, setBusy] = useState(false);

    async function handleSubmit() {
        if (!activeTenantId || !form.name) return;
        setBusy(true);
        const payload = {
            name: form.name,
            description: form.description || undefined,
            subject: form.subject || undefined,
            level: form.level || undefined,
            modality: form.modality,
            durationHours: form.durationHours ? parseInt(form.durationHours, 10) : undefined,
            durationWeeks: form.durationWeeks ? parseInt(form.durationWeeks, 10) : undefined,
            price: form.price ? parseFloat(form.price) : 0,
            currency: form.currency,
            certification: form.certification || undefined,
        };
        try {
            if (course) await api.updateCourse(activeTenantId, course.id, payload);
            else await api.createCourse(activeTenantId, payload);
            onSaved();
        } catch {
            onError?.();
        } finally { setBusy(false); }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <h3 className="text-base font-semibold">{course ? t("editCourse") : t("newCourse")}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
                </div>
                <div className="p-5 space-y-3">
                    <input type="text" placeholder={t("courseName")} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    <textarea placeholder={t("description")} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    <div className="grid grid-cols-3 gap-2">
                        <input type="text" placeholder={t("subject")} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} className="bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        <input type="text" placeholder={t("level")} value={form.level} onChange={e => setForm({ ...form, level: e.target.value })} className="bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        <select value={form.modality} onChange={e => setForm({ ...form, modality: e.target.value })} className="bg-card border border-border rounded-lg px-2 py-1.5 text-sm">
                            {MODALITY_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <input type="number" placeholder={t("durationHoursPlaceholder")} value={form.durationHours} onChange={e => setForm({ ...form, durationHours: e.target.value })} className="bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        <input type="number" placeholder={t("durationWeeksPlaceholder")} value={form.durationWeeks} onChange={e => setForm({ ...form, durationWeeks: e.target.value })} className="bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <input type="number" step="0.01" placeholder={t("price")} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="col-span-2 bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        <input type="text" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className="bg-card border border-border rounded-lg px-2 py-1.5 text-sm font-mono" />
                    </div>
                    <input type="text" placeholder={t("certificationPlaceholder")} value={form.certification} onChange={e => setForm({ ...form, certification: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} className="px-3 py-1.5 bg-muted/30 hover:bg-muted text-foreground border border-border rounded-lg text-sm transition-colors">{tc("cancel")}</button>
                    <button onClick={handleSubmit} disabled={busy || !form.name} className="inline-flex items-center gap-2 px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}

function CohortFormModal({ course, onClose, onSaved, onError }: { course: Course; onClose: () => void; onSaved: () => void; onError?: () => void }) {
    const t = useTranslations("courses");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 7);
    const [form, setForm] = useState({
        cohortCode: "",
        instructorName: "",
        startsAt: tomorrow.toISOString().slice(0, 10),
        endsAt: "",
        schedule: "",
        maxCapacity: "20",
        room: "",
    });
    const [busy, setBusy] = useState(false);

    async function handleSubmit() {
        if (!activeTenantId) return;
        setBusy(true);
        try {
            await api.createCohort(activeTenantId, {
                courseId: course.id,
                cohortCode: form.cohortCode || undefined,
                instructorName: form.instructorName || undefined,
                startsAt: form.startsAt,
                endsAt: form.endsAt || undefined,
                schedule: form.schedule || undefined,
                maxCapacity: parseInt(form.maxCapacity, 10),
                room: form.room || undefined,
            });
            onSaved();
        } catch {
            onError?.();
        } finally { setBusy(false); }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <div>
                        <h3 className="text-base font-semibold">{t("newCohort")}</h3>
                        <p className="text-xs text-muted-foreground">{course.name}</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
                </div>
                <div className="p-5 space-y-3">
                    <input type="text" placeholder={t("cohortCodePlaceholder")} value={form.cohortCode} onChange={e => setForm({ ...form, cohortCode: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm font-mono" />
                    <input type="text" placeholder={t("instructorPlaceholder")} value={form.instructorName} onChange={e => setForm({ ...form, instructorName: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    <input type="text" placeholder={t("schedulePlaceholder")} value={form.schedule} onChange={e => setForm({ ...form, schedule: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs mb-1">{t("startsAt")}</label>
                            <input type="date" value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">{t("endsAt")}</label>
                            <input type="date" value={form.endsAt} onChange={e => setForm({ ...form, endsAt: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">{t("capacity")}</label>
                            <input type="number" value={form.maxCapacity} onChange={e => setForm({ ...form, maxCapacity: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">{t("room")}</label>
                            <input type="text" value={form.room} onChange={e => setForm({ ...form, room: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} className="px-3 py-1.5 bg-muted/30 hover:bg-muted text-foreground border border-border rounded-lg text-sm transition-colors">{tc("cancel")}</button>
                    <button onClick={handleSubmit} disabled={busy} className="inline-flex items-center gap-2 px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
