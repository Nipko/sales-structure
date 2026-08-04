"use client";

/**
 * Aviso persistente mientras el correo del dueño sigue sin verificar.
 *
 * El código de 6 dígitos se mandaba en el registro y verificarlo no bloqueaba
 * nada, así que se podía crear el tenant y usar todo sin abrirlo. Peor: una vez
 * creado el tenant no quedaba NINGÚN camino de vuelta — ni pantalla ni aviso —
 * y el correo quedaba sin verificar para siempre. Eso es el canal de
 * recuperación de la cuenta y el destino de las facturas.
 *
 * Decisión: no bloquear el alta (cada punto de fricción en el registro es un
 * trial perdido, y el envío de correo puede fallar en silencio) pero insistir
 * acá, y bloquear en el backend sólo invitar usuarios y cargar el medio de pago.
 *
 * No se muestra a quien entró con Google o Microsoft: esos proveedores ya
 * probaron la casilla, así que `emailVerified` viene en true y este componente
 * ni se renderiza.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { MailWarning, Loader2, CheckCircle2 } from "lucide-react";

export function EmailVerificationBanner() {
    const t = useTranslations("emailVerification");
    const { user } = useAuth();
    const router = useRouter();

    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState(false);

    // `emailVerified` puede no venir en tokens viejos: sólo se avisa cuando el
    // backend dice explícitamente que NO está verificado, nunca por ausencia del
    // campo. Un banner que aparece por un dato faltante es peor que no tenerlo.
    if (!user || user.emailVerified !== false) return null;

    async function handleResend() {
        setSending(true);
        setError(false);
        try {
            const res = await api.sendVerification();
            if (res?.success) setSent(true);
            else setError(true);
        } catch {
            // El endpoint devuelve 503 cuando el correo no salió: eso es
            // exactamente lo que hay que mostrar, no un "listo" mentiroso.
            setError(true);
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-[13px]">
            <MailWarning className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-amber-800 dark:text-amber-200">
                {t("message", { email: user.email })}
            </span>

            {sent ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-medium">
                    <CheckCircle2 className="h-4 w-4" /> {t("sent")}
                </span>
            ) : (
                <button
                    onClick={handleResend}
                    disabled={sending}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-500/40 hover:bg-amber-500/15 font-medium text-amber-800 dark:text-amber-200 disabled:opacity-50 cursor-pointer transition-colors"
                >
                    {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t("resend")}
                </button>
            )}

            <button
                onClick={() => router.push("/verify-email")}
                className="underline text-amber-800 dark:text-amber-200 cursor-pointer"
            >
                {t("enterCode")}
            </button>

            {error && (
                <span className="text-red-700 dark:text-red-300">{t("sendFailed")}</span>
            )}
        </div>
    );
}
