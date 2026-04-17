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
            if (userStr) {
                try { localStorage.setItem("user", userStr); } catch { /* noop */ }
            }
            // Full reload so AuthContext reads the new tokens
            window.location.href = "/admin";
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
