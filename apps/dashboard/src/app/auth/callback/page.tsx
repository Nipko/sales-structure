"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function AuthCallbackPage() {
    const searchParams = useSearchParams();

    useEffect(() => {
        if (searchParams.get("requires2FA") === "true") {
            const twoFAToken = searchParams.get("twoFAToken") || "";
            const method = searchParams.get("twoFactorMethod") || "totp";
            window.location.href = `/login?requires2FA=true&twoFAToken=${encodeURIComponent(twoFAToken)}&twoFactorMethod=${encodeURIComponent(method)}`;
            return;
        }

        const accessToken = searchParams.get("accessToken");
        const refreshToken = searchParams.get("refreshToken");
        const userStr = searchParams.get("user");

        if (accessToken && refreshToken) {
            localStorage.setItem("accessToken", accessToken);
            localStorage.setItem("refreshToken", refreshToken);

            let redirectPath = "/admin";
            if (userStr) {
                try {
                    localStorage.setItem("user", userStr);
                    const user = JSON.parse(userStr);
                    if (!user.emailVerified) redirectPath = "/verify-email";
                    else if (!user.onboardingCompleted && !user.tenantId) redirectPath = "/onboarding";
                } catch { /* noop */ }
            }

            window.location.href = redirectPath;
        } else {
            window.location.href = "/login?error=auth_failed";
        }
    }, [searchParams]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-[#0a0a14]">
            <Loader2 size={24} className="animate-spin text-indigo-500" />
        </div>
    );
}
