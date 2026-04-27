"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

export default function InstagramCallback() {
    const t = useTranslations("channels");
    const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
    const [errorMessage, setErrorMessage] = useState("");

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const error = params.get("error");

        if (error) {
            finish("error", params.get("error_description") || error);
            return;
        }

        if (!code) {
            finish("error", "Missing authorization code");
            return;
        }

        // Exchange code via backend
        api.instagramOAuthConnect(code)
            .then((data: any) => {
                if (data.success) {
                    finish("success");
                } else {
                    finish("error", data.error || "Connection failed");
                }
            })
            .catch((err: any) => {
                finish("error", err.message);
            });
    }, []);

    function finish(result: "success" | "error", message?: string) {
        setStatus(result);
        if (message) setErrorMessage(message);

        // Notify the opener via BroadcastChannel (works even when window.opener is lost)
        try {
            const channel = new BroadcastChannel("ig_oauth");
            channel.postMessage(
                message
                    ? { type: result === "success" ? "ig_oauth_success" : "ig_oauth_error", message }
                    : { type: "ig_oauth_success" }
            );
            channel.close();
        } catch (e) {
            // BroadcastChannel not supported — opener will reload on focus
        }

        // Close the popup
        setTimeout(() => window.close(), 800);
    }

    if (status === "success") {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a12" }}>
                <div className="text-center">
                    <div className="w-12 h-12 rounded-full bg-green-900/40 flex items-center justify-center mx-auto mb-4">
                        <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <p className="text-white font-semibold text-sm">{t("instagram.connectSuccess")}</p>
                    <p className="text-neutral-500 text-xs mt-2">{t("instagram.closeWindow")}</p>
                </div>
            </div>
        );
    }

    if (status === "error") {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a12" }}>
                <div className="text-center max-w-xs">
                    <div className="w-12 h-12 rounded-full bg-red-900/40 flex items-center justify-center mx-auto mb-4">
                        <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                    <p className="text-white font-semibold text-sm">{t("instagram.connectFailed")}</p>
                    <p className="text-neutral-500 text-xs mt-1">{errorMessage}</p>
                    <p className="text-neutral-600 text-xs mt-3">{t("instagram.closeWindow")}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a12" }}>
            <div className="text-center">
                <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-neutral-400 text-sm">{t("connectingInstagram")}</p>
            </div>
        </div>
    );
}
