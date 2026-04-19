"use client";

import { cn } from "@/lib/utils";
import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PersonaConfig } from "../_types";

interface AgentProfileCardProps {
  config: PersonaConfig;
  toolCount: number;
  ruleCount: number;
}

export function AgentProfileCard({ config, toolCount, ruleCount }: AgentProfileCardProps) {
  const name = config.persona.name || "Not configured";
  const role = config.persona.role || "No role defined";
  const hasName = !!config.persona.name;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 mb-4">
      <div className="flex items-center gap-4">
        {/* Avatar */}
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
          <Bot size={28} className="text-white" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className={cn(
              "text-lg font-semibold",
              hasName ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-400 dark:text-neutral-500 italic"
            )}>
              {name}
            </h2>
            <Badge
              variant={config.isActive ? "default" : "secondary"}
              className={cn(
                "text-[11px]",
                config.isActive
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                  : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              )}
            >
              {config.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
            {role}
          </p>
        </div>

        {/* Pills + stats */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          {config.language && (
            <span className="px-2.5 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {config.language}
            </span>
          )}
          {config.industry && config.industry !== "general" && (
            <span className="px-2.5 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-300 capitalize">
              {config.industry}
            </span>
          )}
          <span className="text-xs text-neutral-400 dark:text-neutral-500 ml-1">
            {ruleCount} rules, {toolCount} tools active
          </span>
        </div>
      </div>
    </div>
  );
}
