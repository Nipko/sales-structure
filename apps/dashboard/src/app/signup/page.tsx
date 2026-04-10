"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, User, Mail, Lock, Eye, EyeOff, AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import AnimatedLogo from "@/components/AnimatedLogo";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";

const INDUSTRIES = [
    { value: "retail", label: "Retail / Comercio" },
    { value: "education", label: "Educación" },
    { value: "healthcare", label: "Salud" },
    { value: "real_estate", label: "Bienes Raíces" },
    { value: "food_beverage", label: "Alimentos y Bebidas" },
    { value: "hospitality", label: "Hospitalidad / Turismo" },
    { value: "professional_services", label: "Servicios Profesionales" },
    { value: "technology", label: "Tecnología" },
    { value: "automotive", label: "Automotriz" },
    { value: "finance", label: "Finanzas / Seguros" },
    { value: "other", label: "Otra" },
];

const inputClasses = "w-full py-3 px-3.5 pl-11 rounded-xl border border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-foreground text-sm outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20";

export default function SignupPage() {
    const [form, setForm] = useState({
        companyName: "", industry: "", email: "",
        password: "", firstName: "", lastName: "",
    });
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();

    const updateField = (field: string, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        setIsSubmitting(true);

        try {
            const res = await fetch(`${API_URL}/auth/signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                setError(data.message || "Error al crear la cuenta");
                setIsSubmitting(false);
                return;
            }

            // Store tokens and user — same as login
            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

            // Redirect to dashboard
            router.push("/admin");
        } catch {
            setError("Error de conexión con el servidor");
        }
        setIsSubmitting(false);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gradient-to-br dark:from-[#0a0a14] dark:via-[#12122a] dark:to-[#1a0a2e] p-5">
            {/* Background glow effects (dark mode only) */}
            <div className="hidden dark:block fixed top-[20%] left-[30%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(108,92,231,0.15)_0%,transparent_70%)] blur-[60px] pointer-events-none" />
            <div className="hidden dark:block fixed bottom-[10%] right-[20%] w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(46,204,113,0.1)_0%,transparent_70%)] blur-[60px] pointer-events-none" />

            <div className="w-full max-w-[460px] relative z-10">
                {/* Logo */}
                <div className="text-center mb-6">
                    <div className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
                        <AnimatedLogo height={40} animate showPoweredBy={false} />
                    </div>
                    <p className="text-muted-foreground text-sm mt-2.5">
                        Plataforma de IA Conversacional
                    </p>
                </div>

                {/* Card */}
                <div className="p-8 rounded-2xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] shadow-lg dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)] dark:backdrop-blur-xl">
                    <h1 className="text-2xl font-bold text-foreground mb-1">
                        Crea tu cuenta
                    </h1>
                    <p className="text-muted-foreground text-sm mb-6">
                        Registra tu empresa y comienza en minutos
                    </p>

                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit}>
                        {/* Company Section */}
                        <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-600/80 mb-3">
                            Datos de la empresa
                        </p>

                        {/* Company Name */}
                        <div className="mb-3.5">
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                Nombre de la empresa
                            </label>
                            <div className="relative">
                                <Building2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                <input
                                    type="text"
                                    value={form.companyName}
                                    onChange={(e) => updateField("companyName", e.target.value)}
                                    placeholder="Mi Empresa SAS"
                                    required
                                    className={inputClasses}
                                />
                            </div>
                        </div>

                        {/* Industry */}
                        <div className="mb-5">
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                Industria
                            </label>
                            <div className="relative">
                                <Building2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
                                <select
                                    value={form.industry}
                                    onChange={(e) => updateField("industry", e.target.value)}
                                    required
                                    className={cn(inputClasses, "appearance-none cursor-pointer")}
                                >
                                    <option value="" disabled>Selecciona tu industria</option>
                                    {INDUSTRIES.map((i) => (
                                        <option key={i.value} value={i.value} className="bg-white dark:bg-[#1a1a2e] text-foreground">
                                            {i.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Admin Section */}
                        <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-600/80 mb-3">
                            Tu cuenta de administrador
                        </p>

                        {/* Name row */}
                        <div className="grid grid-cols-2 gap-3 mb-3.5">
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">Nombre</label>
                                <div className="relative">
                                    <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                    <input
                                        type="text"
                                        value={form.firstName}
                                        onChange={(e) => updateField("firstName", e.target.value)}
                                        placeholder="Juan"
                                        required
                                        className={inputClasses}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">Apellido</label>
                                <div className="relative">
                                    <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                    <input
                                        type="text"
                                        value={form.lastName}
                                        onChange={(e) => updateField("lastName", e.target.value)}
                                        placeholder="Pérez"
                                        required
                                        className={inputClasses}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Email */}
                        <div className="mb-3.5">
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                Email corporativo
                            </label>
                            <div className="relative">
                                <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => updateField("email", e.target.value)}
                                    placeholder="juan@miempresa.com"
                                    required
                                    className={inputClasses}
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div className="mb-6">
                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                Contraseña
                            </label>
                            <div className="relative">
                                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={form.password}
                                    onChange={(e) => updateField("password", e.target.value)}
                                    placeholder="Mínimo 6 caracteres"
                                    required
                                    minLength={6}
                                    className={cn(inputClasses, "pr-11")}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-muted-foreground/50 p-0 hover:text-muted-foreground"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className={cn(
                                "w-full py-3.5 rounded-xl border-none text-white text-[15px] font-semibold transition-all shadow-[0_4px_15px_rgba(108,92,231,0.3)]",
                                isSubmitting
                                    ? "bg-indigo-400 dark:bg-indigo-600/50 cursor-wait"
                                    : "bg-gradient-to-r from-indigo-600 to-indigo-400 cursor-pointer hover:shadow-[0_6px_20px_rgba(108,92,231,0.4)] hover:brightness-110"
                            )}
                        >
                            {isSubmitting ? "Creando tu cuenta..." : "Crear cuenta y comenzar"}
                        </button>
                    </form>

                    {/* Link to login */}
                    <div className="text-center mt-5">
                        <Link
                            href="/login"
                            className="text-muted-foreground text-[13px] no-underline inline-flex items-center gap-1.5 hover:text-indigo-500 transition-colors"
                        >
                            <ArrowLeft size={14} /> ¿Ya tienes cuenta? Inicia sesión
                        </Link>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-neutral-400 mt-6">Powered by <a href="https://parallext.com" target="_blank" className="text-indigo-500 hover:text-indigo-400">Parallext.com</a></p>
            </div>
        </div>
    );
}
