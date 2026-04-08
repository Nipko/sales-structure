"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

type ThemeMode = "dark" | "light" | "system";
type ResolvedTheme = "dark" | "light";

interface ThemeContextValue {
    theme: ThemeMode;
    resolvedTheme: ResolvedTheme;
    setTheme: (theme: ThemeMode) => void;
}

const STORAGE_KEY = "parallly-theme";

const ThemeContext = createContext<ThemeContextValue>({
    theme: "dark",
    resolvedTheme: "dark",
    setTheme: () => {},
});

function getSystemTheme(): ResolvedTheme {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
    if (mode === "system") return getSystemTheme();
    return mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<ThemeMode>("dark");
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");

    // Read from localStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
        const mode = stored && ["dark", "light", "system"].includes(stored) ? stored : "dark";
        setThemeState(mode);
        const resolved = resolveTheme(mode);
        setResolvedTheme(resolved);
        document.documentElement.dataset.theme = resolved;
    }, []);

    // Listen for OS theme changes when in system mode
    useEffect(() => {
        if (theme !== "system") return;

        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e: MediaQueryListEvent) => {
            const resolved: ResolvedTheme = e.matches ? "dark" : "light";
            setResolvedTheme(resolved);
            document.documentElement.dataset.theme = resolved;
        };
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, [theme]);

    const setTheme = useCallback((mode: ThemeMode) => {
        setThemeState(mode);
        localStorage.setItem(STORAGE_KEY, mode);
        const resolved = resolveTheme(mode);
        setResolvedTheme(resolved);
        document.documentElement.dataset.theme = resolved;
    }, []);

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
