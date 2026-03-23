"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Lock, Mail, Eye, EyeOff, AlertCircle, Zap } from "lucide-react";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { login } = useAuth();
    const router = useRouter();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        setIsSubmitting(true);

        const result = await login(email, password);

        if (result.success) {
            router.push("/admin");
        } else {
            setError(result.error || "Error al iniciar sesión");
        }
        setIsSubmitting(false);
    };

    return (
        <div style={{
            minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, #0a0a14 0%, #12122a 50%, #1a0a2e 100%)",
            padding: 20,
        }}>
            {/* Background glow effects */}
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

            <div style={{
                width: "100%", maxWidth: 420, position: "relative", zIndex: 1,
            }}>
                {/* Logo */}
                <div style={{ textAlign: "center", marginBottom: 32 }}>
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
                    <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, marginTop: 12 }}>
                        Plataforma de IA Conversacional
                    </p>
                </div>

                {/* Login Card */}
                <div style={{
                    padding: "32px", borderRadius: 20,
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    backdropFilter: "blur(20px)",
                    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
                }}>
                    <h1 style={{ fontSize: 24, fontWeight: 700, color: "white", margin: "0 0 4px" }}>
                        Iniciar sesión
                    </h1>
                    <p style={{ color: "rgba(255,255,255,0.5)", margin: "0 0 24px", fontSize: 14 }}>
                        Ingresa tus credenciales para continuar
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
                        {/* Email */}
                        <div style={{ marginBottom: 16 }}>
                            <label style={{ display: "block", fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 6, fontWeight: 500 }}>
                                Email
                            </label>
                            <div style={{ position: "relative" }}>
                                <Mail size={18} style={{
                                    position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                                    color: "rgba(255,255,255,0.3)",
                                }} />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="admin@parallext.com"
                                    required
                                    style={{
                                        width: "100%", padding: "12px 14px 12px 44px", borderRadius: 12,
                                        border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)",
                                        color: "white", fontSize: 14, outline: "none", boxSizing: "border-box",
                                        transition: "border-color 0.2s ease",
                                    }}
                                    onFocus={e => e.target.style.borderColor = "rgba(108, 92, 231, 0.5)"}
                                    onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div style={{ marginBottom: 24 }}>
                            <label style={{ display: "block", fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 6, fontWeight: 500 }}>
                                Contraseña
                            </label>
                            <div style={{ position: "relative" }}>
                                <Lock size={18} style={{
                                    position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                                    color: "rgba(255,255,255,0.3)",
                                }} />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    style={{
                                        width: "100%", padding: "12px 44px 12px 44px", borderRadius: 12,
                                        border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)",
                                        color: "white", fontSize: 14, outline: "none", boxSizing: "border-box",
                                        transition: "border-color 0.2s ease",
                                    }}
                                    onFocus={e => e.target.style.borderColor = "rgba(108, 92, 231, 0.5)"}
                                    onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
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
                            type="submit"
                            disabled={isSubmitting}
                            style={{
                                width: "100%", padding: "14px", borderRadius: 12, border: "none",
                                background: isSubmitting
                                    ? "rgba(108, 92, 231, 0.5)"
                                    : "linear-gradient(135deg, #6c5ce7, #a29bfe)",
                                color: "white", fontSize: 15, fontWeight: 600, cursor: isSubmitting ? "wait" : "pointer",
                                transition: "all 0.2s ease",
                                boxShadow: "0 4px 15px rgba(108, 92, 231, 0.3)",
                            }}
                        >
                            {isSubmitting ? "Iniciando sesión..." : "Iniciar sesión"}
                        </button>
                    </form>
                </div>

                {/* Signup Link */}
                <div style={{ textAlign: "center", marginTop: 20 }}>
                    <Link
                        href="/signup"
                        style={{
                            color: "rgba(255,255,255,0.5)", fontSize: 13, textDecoration: "none",
                            transition: "color 0.2s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#a29bfe")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.5)")}
                    >
                        ¿Primera vez? <span style={{ fontWeight: 600 }}>Crea tu cuenta gratuita →</span>
                    </Link>
                </div>

                {/* Footer */}
                <p style={{
                    textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 12,
                }}>
                    Parallext Engine v1.0 · ©2026 Nipko
                </p>
            </div>
        </div>
    );
}
