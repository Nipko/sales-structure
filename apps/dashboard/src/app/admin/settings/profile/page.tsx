"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { User, Mail, Phone, Briefcase, Save, CheckCircle, AlertCircle } from "lucide-react";

export default function ProfilePage() {
    const tc = useTranslations("common");
    const { user } = useAuth();
    const [form, setForm] = useState({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        jobTitle: "",
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (user) {
            setForm({
                firstName: user.firstName || "",
                lastName: user.lastName || "",
                email: user.email || "",
                phone: (user as any).phone || "",
                jobTitle: (user as any).jobTitle || "",
            });
        }
    }, [user]);

    const handleSave = async () => {
        setSaving(true);
        setError("");
        try {
            const result = await api.updateProfile({
                firstName: form.firstName,
                lastName: form.lastName,
                phone: form.phone || undefined,
                jobTitle: form.jobTitle || undefined,
            });
            if (result.success) {
                // Update localStorage user
                const saved = localStorage.getItem("user");
                if (saved) {
                    const u = JSON.parse(saved);
                    u.firstName = form.firstName;
                    u.lastName = form.lastName;
                    localStorage.setItem("user", JSON.stringify(u));
                }
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
            } else {
                setError(result.error || tc("errorSaving"));
            }
        } catch {
            setError(tc("connectionError"));
        }
        setSaving(false);
    };

    const inputClasses = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors";

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Profile</h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    Your personal information and contact details
                </p>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            {/* Avatar */}
            <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-2xl font-semibold text-white">
                    {form.firstName?.charAt(0) || "U"}
                </div>
                <div>
                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {form.firstName} {form.lastName}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {user?.role?.replace(/_/g, " ")}
                        {user?.tenantName ? ` · ${user.tenantName}` : ""}
                    </p>
                </div>
            </div>

            {/* Form */}
            <div className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                {/* Name row */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            First name
                        </label>
                        <div className="relative">
                            <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                            <input
                                type="text"
                                value={form.firstName}
                                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                                className={cn(inputClasses, "pl-9")}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            Last name
                        </label>
                        <div className="relative">
                            <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                            <input
                                type="text"
                                value={form.lastName}
                                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                                className={cn(inputClasses, "pl-9")}
                            />
                        </div>
                    </div>
                </div>

                {/* Email (read-only) */}
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        Email
                    </label>
                    <div className="relative">
                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="email"
                            value={form.email}
                            disabled
                            className={cn(inputClasses, "pl-9 opacity-60 cursor-not-allowed")}
                        />
                    </div>
                    <p className="mt-1 text-xs text-neutral-400">Email cannot be changed</p>
                </div>

                {/* Phone */}
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        Phone
                    </label>
                    <div className="relative">
                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="tel"
                            value={form.phone}
                            onChange={(e) => setForm({ ...form, phone: e.target.value })}
                            placeholder="+57 300 123 4567"
                            className={cn(inputClasses, "pl-9")}
                        />
                    </div>
                </div>

                {/* Job Title */}
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        Job title
                    </label>
                    <div className="relative">
                        <Briefcase size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="text"
                            value={form.jobTitle}
                            onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                            placeholder="Sales Director"
                            className={cn(inputClasses, "pl-9")}
                        />
                    </div>
                </div>
            </div>

            {/* Save */}
            <div className="flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                        "flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all",
                        saved
                            ? "bg-emerald-500 hover:bg-emerald-600"
                            : "bg-indigo-600 hover:bg-indigo-700",
                        saving && "opacity-70 cursor-wait"
                    )}
                >
                    {saved ? <CheckCircle size={16} /> : <Save size={16} />}
                    {saving ? tc("saving") : saved ? tc("saved") : tc("saveChanges")}
                </button>
            </div>
        </div>
    );
}
