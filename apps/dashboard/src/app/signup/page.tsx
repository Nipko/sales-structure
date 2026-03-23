"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, User, Mail, Lock, Eye, EyeOff, AlertCircle, Zap, ArrowLeft } from "lucide-react";
import Link from "next/link";

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

const inputStyle: React.CSSProperties = {
    width: "100%", padding: "12px 14px 12px 44px", borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)",
    color: "white", fontSize: 14, outline: "none", boxSizing: "border-box" as const,
    transition: "border-color 0.2s ease",
};

const selectStyle: React.CSSProperties = {
    ...inputStyle,
    paddingLeft: 44,
    appearance: "none" as const,
    cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 6, fontWeight: 500,
};

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

    const onFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) =>
        (e.target.style.borderColor = "rgba(108, 92, 231, 0.5)");
    const onBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) =>
        (e.target.style.borderColor = "rgba(255,255,255,0.1)");

    return (
        <div style={{
            minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, #0a0a14 0%, #12122a 50%, #1a0a2e 100%)",
            padding: 20,
        }}>
            {/* Background glow */}
            <div style={{
                position: "fixed", top: "20%", left: "30%", width: 400, height: 400,
                borderRadius: "50%", background: "radial-gradient(circle, rgba(108, 92, 231, 0.15) 0%, transparent 70%)",
                filter: "blur(60px)", pointerEvents: "none",
            }} />
            <div style={{
                position: "fixed", bottom: "10%", right: "20%", width: 300, height: 300,
                borderRadius: "50%", background: "radial-gradient(circle, rgba(46, 204, 113, 0.1) 0%, transparent 70%)",
                filter: "blur(60px)", pointerEvents: "none",
            }} />

            <div style={{ width: "100%", maxWidth: 460, position: "relative", zIndex: 1 }}>
                {/* Logo */}
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                    <div style={{
                        display: "inline-flex", alignItems: "center", gap: 10,
                        padding: "10px 20px", borderRadius: 12,
                        background: "rgba(108, 92, 231, 0.1)", border: "1px solid rgba(108, 92, 231, 0.2)",
                    }}>
                        <Zap size={24} color="#6c5ce7" />
                        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, color: "white" }}>
                            Parallext
                        </span>
                    </div>
                    <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, marginTop: 10 }}>
                        Plataforma de IA Conversacional
                    </p>
                </div>

                {/* Card */}
                <div style={{
                    padding: "32px", borderRadius: 20,
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    backdropFilter: "blur(20px)",
                    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
                }}>
                    <h1 style={{ fontSize: 24, fontWeight: 700, color: "white", margin: "0 0 4px" }}>
                        Crea tu cuenta
                    </h1>
                    <p style={{ color: "rgba(255,255,255,0.5)", margin: "0 0 24px", fontSize: 14 }}>
                        Registra tu empresa y comienza en minutos
                    </p>

                    {/* Error */}
                    {error && (
                        <div style={{
                            padding: "10px 14px", borderRadius: 10, marginBottom: 16,
                            background: "rgba(231, 76, 60, 0.1)", border: "1px solid rgba(231, 76, 60, 0.2)",
                            display: "flex", alignItems: "center", gap: 8,
                            color: "#e74c3c", fontSize: 13,
                        }}>
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit}>
                        {/* ── Company Section ── */}
                        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "rgba(108,92,231,0.8)", margin: "0 0 12px" }}>
                            Datos de la empresa
                        </p>

                        {/* Company Name */}
                        <div style={{ marginBottom: 14 }}>
                            <label style={labelStyle}>Nombre de la empresa</label>
                            <div style={{ position: "relative" }}>
                                <Building2 size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
                                <input
                                    type="text" value={form.companyName}
                                    onChange={(e) => updateField("companyName", e.target.value)}
                                    placeholder="Mi Empresa SAS" required
                                    style={inputStyle} onFocus={onFocus} onBlur={onBlur}
                                />
                            </div>
                        </div>

                        {/* Industry */}
                        <div style={{ marginBottom: 20 }}>
                            <label style={labelStyle}>Industria</label>
                            <div style={{ position: "relative" }}>
                                <Building2 size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", pointerEvents: "none" }} />
                                <select
                                    value={form.industry}
                                    onChange={(e) => updateField("industry", e.target.value)}
                                    required style={selectStyle} onFocus={onFocus} onBlur={onBlur}
                                >
                                    <option value="" disabled>Selecciona tu industria</option>
                                    {INDUSTRIES.map((i) => (
                                        <option key={i.value} value={i.value} style={{ background: "#1a1a2e", color: "white" }}>
                                            {i.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* ── Admin Section ── */}
                        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "rgba(108,92,231,0.8)", margin: "0 0 12px" }}>
                            Tu cuenta de administrador
                        </p>

                        {/* Name row */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                            <div>
                                <label style={labelStyle}>Nombre</label>
                                <div style={{ position: "relative" }}>
                                    <User size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
                                    <input
                                        type="text" value={form.firstName}
                                        onChange={(e) => updateField("firstName", e.target.value)}
                                        placeholder="Juan" required
                                        style={inputStyle} onFocus={onFocus} onBlur={onBlur}
                                    />
                                </div>
                            </div>
                            <div>
                                <label style={labelStyle}>Apellido</label>
                                <div style={{ position: "relative" }}>
                                    <User size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
                                    <input
                                        type="text" value={form.lastName}
                                        onChange={(e) => updateField("lastName", e.target.value)}
                                        placeholder="Pérez" required
                                        style={inputStyle} onFocus={onFocus} onBlur={onBlur}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Email */}
                        <div style={{ marginBottom: 14 }}>
                            <label style={labelStyle}>Email corporativo</label>
                            <div style={{ position: "relative" }}>
                                <Mail size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
                                <input
                                    type="email" value={form.email}
                                    onChange={(e) => updateField("email", e.target.value)}
                                    placeholder="juan@miempresa.com" required
                                    style={inputStyle} onFocus={onFocus} onBlur={onBlur}
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div style={{ marginBottom: 24 }}>
                            <label style={labelStyle}>Contraseña</label>
                            <div style={{ position: "relative" }}>
                                <Lock size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)" }} />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={form.password}
                                    onChange={(e) => updateField("password", e.target.value)}
                                    placeholder="Mínimo 6 caracteres" required minLength={6}
                                    style={{ ...inputStyle, paddingRight: 44 }}
                                    onFocus={onFocus} onBlur={onBlur}
                                />
                                <button
                                    type="button" onClick={() => setShowPassword(!showPassword)}
                                    style={{
                                        position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                                        background: "none", border: "none", cursor: "pointer",
                                        color: "rgba(255,255,255,0.3)", padding: 0,
                                    }}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {/* Submit */}
                        <button
                            type="submit" disabled={isSubmitting}
                            style={{
                                width: "100%", padding: "14px", borderRadius: 12, border: "none",
                                background: isSubmitting
                                    ? "rgba(108, 92, 231, 0.5)"
                                    : "linear-gradient(135deg, #6c5ce7, #a29bfe)",
                                color: "white", fontSize: 15, fontWeight: 600,
                                cursor: isSubmitting ? "wait" : "pointer",
                                transition: "all 0.2s ease",
                                boxShadow: "0 4px 15px rgba(108, 92, 231, 0.3)",
                            }}
                        >
                            {isSubmitting ? "Creando tu cuenta..." : "Crear cuenta y comenzar"}
                        </button>
                    </form>

                    {/* Link to login */}
                    <div style={{ textAlign: "center", marginTop: 20 }}>
                        <Link
                            href="/login"
                            style={{
                                color: "rgba(255,255,255,0.5)", fontSize: 13, textDecoration: "none",
                                display: "inline-flex", alignItems: "center", gap: 6,
                                transition: "color 0.2s",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "#a29bfe")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.5)")}
                        >
                            <ArrowLeft size={14} /> ¿Ya tienes cuenta? Inicia sesión
                        </Link>
                    </div>
                </div>

                {/* Footer */}
                <p style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 20 }}>
                    Parallext Engine v1.0 · ©2026 Nipko
                </p>
            </div>
        </div>
    );
}
