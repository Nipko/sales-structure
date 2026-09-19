"use client";

import { useParams } from "next/navigation";
import PublicChatShell from "./_components/PublicChatShell";

/**
 * `/w/<widgetId>` — the agent's public link (owner decision D11).
 *
 * The route reads the id and nothing else; the shell owns the states, so it
 * can be rendered and scanned without a router. Listed in `PUBLIC_PATHS`
 * (`AuthContext`), and deliberately NOT in the navigation contract or the
 * page-access registry: those are admin registries, and a visitor's page has
 * no role to check.
 */
export default function PublicChatPage() {
  const params = useParams();
  const widgetId = typeof params?.widgetId === "string" ? params.widgetId : "";
  return <PublicChatShell widgetId={widgetId} />;
}
