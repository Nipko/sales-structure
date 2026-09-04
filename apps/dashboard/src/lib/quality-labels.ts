"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

/**
 * One way to name a quality code.
 *
 * The card, the quality page and the focus bar each grew their own copy of the
 * same fallback ladder (`recommendations.<code>` → `recommendations.fix` with
 * the check name → `unknown`). Three copies drift: a code that reads
 * "Conexión operativa del canal" in one place read "Acción" in another, which
 * makes the same problem look like two different ones.
 */
export type QualityCodeGroup = "checks" | "recommendations" | "issues";

export function useQualityCodeLabel(): (group: QualityCodeGroup, code: string) => string {
  const t = useTranslations("agentQuality");

  return useCallback((group: QualityCodeGroup, code: string): string => {
    const direct = `${group}.${code}`;
    if (t.has(direct)) return t(direct);

    if (group === "recommendations" && code.startsWith("fix_")) {
      const checkKey = `checks.${code.slice(4)}`;
      return t("recommendations.fix", { item: t.has(checkKey) ? t(checkKey) : t("checks.unknown") });
    }
    if (group === "recommendations" && code.startsWith("investigate_")) {
      const issueKey = `issues.${code.slice(12)}`;
      return t("recommendations.investigate", { item: t.has(issueKey) ? t(issueKey) : t("issues.unknown") });
    }
    // Vertical tools and judge issue codes are open-ended by design: the
    // catalogue grows per industry, so they fall back to a family label
    // instead of showing the raw code to the tenant.
    if (group === "issues" && code.startsWith("qa_")) return t("issues.qa_generic");
    if (group === "checks" && code.startsWith("tool_")) return t("checks.vertical_tool");

    return t(`${group}.unknown`);
  }, [t]);
}

/** Shorthand for the recommendation label, the code most surfaces show. */
export function useRecommendationLabel(): (code: string) => string {
  const label = useQualityCodeLabel();
  return useCallback((code: string) => label("recommendations", code), [label]);
}

/** The check a `fix_<check>` recommendation refers to. */
export function qualityCheckCodeFor(recommendationCode: string): string {
  return recommendationCode.startsWith("fix_") ? recommendationCode.slice(4) : recommendationCode;
}
