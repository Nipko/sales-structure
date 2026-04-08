"use client";

import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Palette, Sun, Moon, Monitor, Check } from "lucide-react";

const themes = [
  {
    key: "light",
    label: "Claro",
    icon: Sun,
    description: "Fondo blanco con texto oscuro",
    preview: {
      bg: "bg-white",
      card: "bg-neutral-100",
      text: "bg-neutral-300",
      accent: "bg-indigo-400",
    },
  },
  {
    key: "dark",
    label: "Oscuro",
    icon: Moon,
    description: "Fondo oscuro con texto claro",
    preview: {
      bg: "bg-neutral-900",
      card: "bg-neutral-800",
      text: "bg-neutral-600",
      accent: "bg-indigo-500",
    },
  },
  {
    key: "system",
    label: "Sistema",
    icon: Monitor,
    description: "Sigue la preferencia del sistema operativo",
    preview: {
      bg: "bg-gradient-to-br from-white to-neutral-900",
      card: "bg-neutral-500",
      text: "bg-neutral-400",
      accent: "bg-indigo-500",
    },
  },
] as const;

export default function AppearancePage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950">
          <Palette size={22} className="text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            Apariencia
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Personaliza el aspecto visual de la plataforma
          </p>
        </div>
      </div>

      {/* Theme selector cards */}
      <div>
        <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
          Tema
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {themes.map((t) => {
            const Icon = t.icon;
            const selected = theme === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTheme(t.key)}
                className={cn(
                  "relative rounded-xl border-2 p-4 text-left transition-all",
                  selected
                    ? "border-indigo-500 ring-2 ring-indigo-500/20"
                    : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
                )}
              >
                {/* Selected badge */}
                {selected && (
                  <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
                    <Check size={12} className="text-white" />
                  </div>
                )}

                {/* Preview thumbnail */}
                <div
                  className={cn(
                    "w-full h-20 rounded-lg mb-3 p-2 flex flex-col gap-1.5",
                    t.preview.bg
                  )}
                >
                  <div className={cn("h-2 w-16 rounded-full", t.preview.accent)} />
                  <div className={cn("h-1.5 w-24 rounded-full", t.preview.text)} />
                  <div className={cn("flex-1 rounded", t.preview.card)} />
                </div>

                {/* Label */}
                <div className="flex items-center gap-2">
                  <Icon
                    size={16}
                    className={cn(
                      selected
                        ? "text-indigo-600 dark:text-indigo-400"
                        : "text-neutral-400 dark:text-neutral-500"
                    )}
                  />
                  <span
                    className={cn(
                      "text-sm font-medium",
                      selected
                        ? "text-indigo-700 dark:text-indigo-300"
                        : "text-neutral-700 dark:text-neutral-300"
                    )}
                  >
                    {t.label}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                  {t.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Component preview */}
      <div>
        <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
          Vista previa de componentes
        </h2>
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-6 space-y-6 bg-white dark:bg-neutral-950">
          {/* Buttons */}
          <div>
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3 uppercase tracking-wider">
              Botones
            </p>
            <div className="flex flex-wrap gap-3">
              <button className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
                Primary
              </button>
              <button className="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors">
                Secondary
              </button>
              <button className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors">
                Destructive
              </button>
            </div>
          </div>

          {/* Card */}
          <div>
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3 uppercase tracking-wider">
              Tarjeta
            </p>
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 max-w-sm">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Ejemplo de tarjeta
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                Esta es una descripción de ejemplo para mostrar cómo se ven las
                tarjetas con el tema actual.
              </p>
            </div>
          </div>

          {/* Badges */}
          <div>
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3 uppercase tracking-wider">
              Badges
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
                Active
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                Inactive
              </span>
            </div>
          </div>

          {/* Input */}
          <div>
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3 uppercase tracking-wider">
              Campo de texto
            </p>
            <input
              type="text"
              placeholder="Escribe algo aqui..."
              className="w-full max-w-sm h-9 px-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
