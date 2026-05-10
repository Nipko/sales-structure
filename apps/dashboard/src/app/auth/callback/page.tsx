"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export default function AuthCallbackPage() {
    const searchParams = useSearchParams();

    useEffect(() => {
        const exchangeCode = searchParams.get("code");
        if (!exchangeCode) {
            window.location.href = "/login?error=auth_failed";
            return;
        }

        api.exchangeOAuthCode(exchangeCode).then((res) => {
            if (!res.success || !res.data) {
                window.location.href = "/login?error=auth_failed";
                return;
            }

            const data = res.data;

            if (data.requires2FA) {
                sessionStorage.setItem("pending2FA", JSON.stringify({
                    token: data.twoFAToken || "",
                    method: data.twoFactorMethod || "totp",
                }));
                window.location.href = "/login?requires2FA=true";
                return;
            }

            if (data.accessToken && data.refreshToken) {
                localStorage.setItem("accessToken", data.accessToken);
                localStorage.setItem("refreshToken", data.refreshToken);

                let redirectPath = "/admin";
                if (data.user) {
                    try {
                        localStorage.setItem("user", typeof data.user === "string" ? data.user : JSON.stringify(data.user));
                        const user = typeof data.user === "string" ? JSON.parse(data.user) : data.user;
                        if (!user.emailVerified) redirectPath = "/verify-email";
                        else if (!user.onboardingCompleted && !user.tenantId) redirectPath = "/onboarding";
                    } catch { /* noop */ }
                }

                window.location.href = redirectPath;
            } else {
                window.location.href = "/login?error=auth_failed";
            }
        }).catch(() => {
            window.location.href = "/login?error=auth_failed";
        });
    }, [searchParams]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-[#0a0a14]">
            <Loader2 size={24} className="animate-spin text-indigo-500" />
        </div>
    );
}
