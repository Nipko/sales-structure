"use client";

/**
 * Import masivo compartido (CSV / XLSX) con mapeo de columnas.
 *
 * El punto de abandono del alta no es "no existe el botón de importar": es que
 * el archivo del dueño nunca tiene los nombres de columna que espera el
 * sistema. Su planilla dice "Habitaciones", "Precio de venta", "Barrio" — no
 * `bedrooms`, `price`, `neighborhood`. Un importador que exige una plantilla
 * exacta se abandona igual que cargar de a uno, solo que más tarde y con más
 * frustración.
 *
 * Por eso el paso central es el MAPEO: se leen los encabezados reales del
 * archivo, se pre-asignan por parecido y el dueño corrige lo que haga falta.
 *
 * El parseo es del lado del cliente (xlsx, ya es dependencia): el backend
 * recibe filas ya normalizadas y no tiene que saber nada de formatos de
 * planilla.
 */

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Upload, X, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet } from "lucide-react";

export interface BulkImportField {
    /** Nombre del campo que espera el backend (el que va en la fila enviada). */
    key: string;
    /** Etiqueta ya traducida que ve el dueño. */
    label: string;
    required?: boolean;
    /** Se castea antes de enviar: la planilla siempre trae texto. */
    type?: "string" | "number" | "boolean";
    /** Alias en el idioma del dueño para el pre-mapeo automático. */
    aliases?: string[];
}

interface Props {
    open: boolean;
    onClose: () => void;
    /** Ruta del endpoint de import, sin el prefijo del cliente HTTP. */
    endpoint: string;
    fields: BulkImportField[];
    title: string;
    onImported?: () => void;
    /**
     * Ajuste final de cada fila antes de enviarla.
     *
     * Existe por un caso muy concreto: el REST de vehículos recibe el precio en
     * CENTAVOS y la planilla del concesionario trae pesos. Sin esta conversión
     * un auto de 45.000.000 entraría como 450.000 y el agente lo ofrecería a
     * ese precio — un error que no se ve hasta que un cliente lo reclama.
     */
    transform?: (row: Row) => Row;
}

type Row = Record<string, unknown>;

const MAX_ROWS = 500;

/** Normaliza para comparar encabezados: sin acentos, sin símbolos, minúsculas. */
function norm(s: string): string {
    return String(s)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

export function BulkImportModal({ open, onClose, endpoint, fields, title, onImported, transform }: Props) {
    const t = useTranslations("bulkImport");
    const tc = useTranslations("common");

    const inputRef = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [headers, setHeaders] = useState<string[]>([]);
    const [rows, setRows] = useState<Row[]>([]);
    const [mapping, setMapping] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ created: number; failed: number; errors: { row: number; error: string }[] } | null>(null);

    function reset() {
        setFileName(null); setHeaders([]); setRows([]); setMapping({});
        setError(null); setResult(null); setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
    }

    async function handleFile(file: File) {
        setError(null); setResult(null);
        try {
            // Import dinámico: xlsx pesa y no tiene por qué entrar al bundle de
            // todas las páginas que solo declaran el botón.
            const XLSX = await import("xlsx");
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: "array" });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const parsed: Row[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

            if (!parsed.length) { setError(t("emptyFile")); return; }
            if (parsed.length > MAX_ROWS) { setError(t("tooManyRows", { max: MAX_ROWS, count: parsed.length })); return; }

            const cols = Object.keys(parsed[0]);
            setHeaders(cols);
            setRows(parsed);
            setFileName(file.name);

            // Pre-mapeo por parecido: clave, etiqueta traducida o alias. Que
            // acierte solo la mitad ya cambia el trabajo del dueño.
            const auto: Record<string, string> = {};
            for (const f of fields) {
                const candidates = [f.key, f.label, ...(f.aliases || [])].map(norm);
                const hit = cols.find(c => candidates.includes(norm(c)));
                if (hit) auto[f.key] = hit;
            }
            setMapping(auto);
        } catch {
            setError(t("parseFailed"));
        }
    }

    function cast(value: unknown, type?: BulkImportField["type"]) {
        if (value === "" || value === null || value === undefined) return undefined;
        if (type === "number") {
            // Las planillas locales traen "1.500.000" o "1,5". Se limpian los
            // separadores de miles y se acepta la coma como decimal.
            const raw = String(value).replace(/[^\d,.-]/g, "");
            const n = Number(raw.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
            return Number.isFinite(n) ? n : undefined;
        }
        if (type === "boolean") {
            const v = norm(String(value));
            return ["si", "yes", "true", "1", "x", "sim", "oui"].includes(v);
        }
        return String(value).trim() || undefined;
    }

    const missingRequired = fields.filter(f => f.required && !mapping[f.key]);

    async function handleImport() {
        setBusy(true); setError(null);
        try {
            const payload = rows.map(r => {
                const out: Row = {};
                for (const f of fields) {
                    const col = mapping[f.key];
                    if (!col) continue;
                    const v = cast(r[col], f.type);
                    if (v !== undefined) out[f.key] = v;
                }
                return transform ? transform(out) : out;
            });

            const res = await api.fetch(endpoint, { method: "POST", body: JSON.stringify({ rows: payload }) });
            if (res?.success) {
                setResult(res.data as any);
                // Refrescar aunque haya fallos: lo que entró, entró. PgBouncer
                // está en modo transaction, el resultado parcial es real.
                onImported?.();
            } else {
                setError((res as any)?.error || tc("errorSaving"));
            }
        } catch {
            setError(tc("errorSaving"));
        } finally {
            setBusy(false);
        }
    }

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <h3 className="text-base font-semibold flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-emerald-500" /> {title}
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded cursor-pointer"><X className="h-4 w-4" /></button>
                </div>

                <div className="p-5 overflow-y-auto space-y-4">
                    {error && (
                        <div className="flex items-start gap-2 p-3 rounded-lg text-sm border bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20">
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span>
                        </div>
                    )}

                    {result ? (
                        <div className="space-y-3">
                            <div className="flex items-start gap-2 p-3 rounded-lg text-sm border bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20">
                                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                                <span>{t("imported", { created: result.created, failed: result.failed })}</span>
                            </div>
                            {result.errors?.length > 0 && (
                                <div className="border border-border rounded-lg overflow-hidden">
                                    <div className="px-3 py-2 bg-muted/40 text-xs font-medium">{t("rowErrors")}</div>
                                    <div className="max-h-48 overflow-y-auto divide-y divide-border">
                                        {result.errors.map((e, i) => (
                                            <div key={i} className="px-3 py-2 text-xs flex gap-2">
                                                <span className="font-mono text-muted-foreground shrink-0">#{e.row}</span>
                                                <span>{e.error}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : !fileName ? (
                        <div>
                            <p className="text-sm text-muted-foreground mb-3">{t("intro", { max: MAX_ROWS })}</p>
                            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl p-8 cursor-pointer hover:bg-muted/30 transition-colors">
                                <Upload className="h-6 w-6 text-muted-foreground" />
                                <span className="text-sm font-medium">{t("pickFile")}</span>
                                <span className="text-xs text-muted-foreground">CSV, XLSX</span>
                                <input
                                    ref={inputRef}
                                    type="file"
                                    accept=".csv,.xlsx,.xls"
                                    className="hidden"
                                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                                />
                            </label>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="text-sm">
                                <span className="font-medium">{fileName}</span>
                                <span className="text-muted-foreground"> — {t("rowsDetected", { count: rows.length })}</span>
                            </div>

                            <div>
                                <p className="text-xs text-muted-foreground mb-2">{t("mapHint")}</p>
                                <div className="space-y-2">
                                    {fields.map(f => (
                                        <div key={f.key} className="flex items-center gap-3">
                                            <label className="text-sm w-40 shrink-0">
                                                {f.label}
                                                {f.required && <span className="text-red-500 ml-0.5">*</span>}
                                            </label>
                                            <select
                                                value={mapping[f.key] || ""}
                                                onChange={e => setMapping({ ...mapping, [f.key]: e.target.value })}
                                                className="flex-1 h-9 rounded-lg border border-border bg-card px-2 text-sm cursor-pointer"
                                            >
                                                <option value="">{t("ignore")}</option>
                                                {headers.map(h => <option key={h} value={h}>{h}</option>)}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {missingRequired.length > 0 && (
                                <div className="text-xs text-amber-600 dark:text-amber-400">
                                    {t("missingRequired", { fields: missingRequired.map(f => f.label).join(", ") })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={result ? () => { reset(); onClose(); } : onClose} className="px-3 py-1.5 bg-muted/30 hover:bg-muted border border-border rounded-lg text-sm cursor-pointer">
                        {result ? tc("close") : tc("cancel")}
                    </button>
                    {!result && fileName && (
                        <button
                            onClick={handleImport}
                            disabled={busy || missingRequired.length > 0}
                            className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium cursor-pointer"
                        >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            {t("importCount", { count: rows.length })}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
