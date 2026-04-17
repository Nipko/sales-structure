"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function AuthCallbackPage() {
    const searchParams = useSearchParams();

    useEffect(() => {
        const accessToken = searchParams.get("accessToken");
        const refreshToken = searchParams.get("refreshToken");
        const userStr = searchParams.get("user");

        if (accessToken && refreshToken) {
            localStorage.setItem("accessToken", accessToken);
            localStorage.setItem("refreshToken", refreshToken);

            // Determine redirect based on user state
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
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0a0a14]">
            <Loader2 size={24} className="animate-spin text-indigo-500" />
        </div>
    );
}
