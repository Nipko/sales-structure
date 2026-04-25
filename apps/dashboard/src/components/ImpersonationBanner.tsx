"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { LogOut, Eye } from "lucide-react";

interface ImpersonationState {
  originalAccessToken: string;
  originalRefreshToken: string;
  originalUser: string;
  tenantName: string;
}

export default function ImpersonationBanner() {
  const t = useTranslations("tenants");
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("impersonation");
      if (raw) {
        setImpersonation(JSON.parse(raw));
      }
    } catch {
      // ignore
    }
  }, []);

  if (!impersonation) return null;

  const handleExit = () => {
    // Restore original tokens
    if (impersonation.originalAccessToken) {
      localStorage.setItem("accessToken", impersonation.originalAccessToken);
    }
    if (impersonation.originalRefreshToken) {
      localStorage.setItem("refreshToken", impersonation.originalRefreshToken);
    }
    if (impersonation.originalUser) {
      localStorage.setItem("user", impersonation.originalUser);
    }
    localStorage.removeItem("impersonation");
    window.location.href = "/admin/tenants";
  };

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2 bg-amber-500 text-neutral-900 text-sm font-medium shrink-0">
      <Eye size={16} />
      <span>{t("impersonation.banner", { name: impersonation.tenantName })}</span>
      <button
        onClick={handleExit}
        className="ml-2 flex items-center gap-1.5 px-3 py-1 rounded-md bg-neutral-900/20 text-neutral-900 text-xs font-semibold cursor-pointer border-none hover:bg-neutral-900/30 transition-colors"
      >
        <LogOut size={13} />
        {t("impersonation.exit")}
      </button>
    </div>
  );
}
