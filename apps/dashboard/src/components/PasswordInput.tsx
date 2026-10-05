"use client";

import { useState, useCallback } from "react";
import { Lock, Eye, EyeOff, RefreshCw, Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const VALIDATIONS = [
    { key: "minLength", test: (p: string) => p.length >= 8 },
    { key: "uppercase", test: (p: string) => /[A-Z]/.test(p) },
    { key: "lowercase", test: (p: string) => /[a-z]/.test(p) },
    { key: "number", test: (p: string) => /[0-9]/.test(p) },
    { key: "special", test: (p: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p) },
];

function secureIndex(length: number): number {
    const range = 0x100000000;
    const limit = range - (range % length);
    const sample = new Uint32Array(1);
    do {
        globalThis.crypto.getRandomValues(sample);
    } while (sample[0] >= limit);
    return sample[0] % length;
}

export function generatePassword(): string {
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const digits = "0123456789";
    const special = "!@#$%^&*_+-=";
    const all = upper + lower + digits + special;

    // Ensure at least one of each type
    const pass = [
        upper[secureIndex(upper.length)],
        lower[secureIndex(lower.length)],
        digits[secureIndex(digits.length)],
        special[secureIndex(special.length)],
    ];

    // Fill rest to 16 chars
    for (let i = 4; i < 16; i++) {
        pass.push(all[secureIndex(all.length)]);
    }

    // Shuffle
    for (let i = pass.length - 1; i > 0; i--) {
        const j = secureIndex(i + 1);
        [pass[i], pass[j]] = [pass[j], pass[i]];
    }
    return pass.join("");
}

interface PasswordInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    showValidation?: boolean;
    showGenerator?: boolean;
    className?: string;
    /**
     * The id the surrounding form's `<label htmlFor>` points at.
     *
     * Optional only because two callers predate it. Without one, the field has
     * no accessible name at all: the label beside it is not associated with
     * anything, so a screen reader reads "edit text" and clicking the label
     * focuses nothing.
     */
    id?: string;
    autoComplete?: string;
}

export default function PasswordInput({
    value, onChange, placeholder, showValidation = true, showGenerator = true, className, id,
    autoComplete = "new-password",
}: PasswordInputProps) {
    const t = useTranslations("auth");
    const [show, setShow] = useState(false);

    const results = VALIDATIONS.map(v => ({ ...v, valid: v.test(value) }));
    const allValid = results.every(r => r.valid);
    const hasInput = value.length > 0;

    const handleGenerate = useCallback(() => {
        const pass = generatePassword();
        onChange(pass);
        setShow(true); // Show generated password

    }, [onChange]);

    return (
        <div className={className}>
            <div className="relative">
                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                <input
                    id={id}
                    type={show ? "text" : "password"}
                    autoComplete={autoComplete}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder || t("passwordRequirements.minLength")}
                    required
                    className="w-full py-3 px-3.5 pl-11 pr-24 rounded-xl border border-neutral-300 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-foreground text-sm outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    {showGenerator && (
                        <button
                            type="button"
                            onClick={handleGenerate}
                            title={t("generatePassword")}
                            aria-label={t("generatePassword")}
                            className="p-1.5 rounded-lg bg-transparent text-muted-foreground/50 hover:text-indigo-500 hover:bg-indigo-500/10 transition-colors"
                        >
                            <RefreshCw size={16} />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setShow(!show)}
                        aria-label={show ? t("hidePassword") : t("showPassword")}
                        aria-pressed={show}
                        className="p-1.5 bg-transparent border-none cursor-pointer text-muted-foreground/50 hover:text-muted-foreground"
                    >
                        {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                </div>
            </div>

            {/* Validation checklist */}
            {showValidation && hasInput && (
                <div className="mt-2 space-y-1">
                    {results.map(r => (
                        <div key={r.key} className="flex items-center gap-2">
                            {r.valid
                                ? <Check size={12} className="text-emerald-500 shrink-0" />
                                : <X size={12} className="text-red-400 shrink-0" />
                            }
                            <span className={cn("text-[11px]", r.valid ? "text-emerald-500" : "text-muted-foreground")}>
                                {t(`passwordRequirements.${r.key}`)}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/** Check if a password meets all requirements */
export function isPasswordValid(password: string): boolean {
    return VALIDATIONS.every(v => v.test(password));
}
