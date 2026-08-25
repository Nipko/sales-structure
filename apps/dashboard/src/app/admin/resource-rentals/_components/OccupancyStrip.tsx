"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ResourceRental } from "@/lib/api";

/**
 * Quién tiene qué, y hasta cuándo.
 *
 * La pantalla era una lista de alquileres ordenada por fecha. Para saber si el
 * auto 3 está libre el jueves había que leerla entera y cruzar fechas a mano; y
 * la persona que arma los patios de la guardería por la mañana necesita
 * exactamente lo contrario de una lista: **una fila por recurso** y las
 * ocupaciones puestas encima.
 *
 * Es la misma vista para los dos rubros porque es el mismo dato: una flota y
 * una guardería tienen recursos que se ocupan por rangos de días. Hacer dos
 * pantallas distintas habría duplicado el mismo cálculo con dos bugs.
 *
 * Sin proveedor externo: son las filas que el negocio ya tiene.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_STYLE: Record<string, string> = {
    reserved: "bg-amber-400/80 text-amber-950",
    picked_up: "bg-emerald-500/80 text-emerald-950",
    checked_in: "bg-emerald-500/80 text-emerald-950",
    returned: "bg-neutral-300 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
    checked_out: "bg-neutral-300 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
    cancelled: "bg-red-300/60 text-red-900 line-through",
};
const OCCUPYING_STATUSES = new Set(["reserved", "picked_up", "checked_in"]);

function toUtcDay(value: string): number {
    // Las fechas llegan como `YYYY-MM-DD`. Parsearlas con `new Date(str)` las
    // interpreta en UTC y después `getDate()` las corre un día en cualquier
    // huso al oeste — que es medio continente.
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return Date.UTC(year, (month || 1) - 1, day || 1);
}

export interface OccupancyStripProps {
    rentals: ResourceRental[];
    /** Cuántos días muestra la tira. */
    days?: number;
    /** Desde qué día, `YYYY-MM-DD`. Por defecto hoy. */
    from?: string;
    onSelect?: (rental: ResourceRental) => void;
}

export function OccupancyStrip({ rentals, days = 14, from, onSelect }: OccupancyStripProps) {
    const t = useTranslations("resourceRentals.occupancy");

    const start = useMemo(() => {
        if (from) return toUtcDay(from);
        const now = new Date();
        return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    }, [from]);

    const columns = useMemo(
        () => Array.from({ length: days }, (_, index) => start + index * DAY_MS),
        [start, days],
    );

    /** Una fila por recurso, con sus ocupaciones. */
    const rows = useMemo(() => {
        const byResource = new Map<string, { label: string; items: ResourceRental[] }>();
        for (const rental of rentals.filter((item) => OCCUPYING_STATUSES.has(item.status))) {
            const label = rental.resource_name
                || [rental.vehicle_make, rental.vehicle_model].filter(Boolean).join(" ")
                || rental.pet_name
                || rental.resource_id.slice(0, 8);
            const existing = byResource.get(rental.resource_id);
            if (existing) existing.items.push(rental);
            else byResource.set(rental.resource_id, { label, items: [rental] });
        }
        return [...byResource.entries()]
            .map(([resourceId, value]) => ({ resourceId, ...value }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [rentals]);

    if (!rows.length) return null;

    return (
        <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3">
                <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
                <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
            </div>

            {/* Ancho propio y scroll horizontal: la tira no puede empujar el
                ancho de la página ni obligar a hacer scroll al documento. */}
            <div className="overflow-x-auto">
                <div className="min-w-[46rem]">
                    <div
                        className="grid items-center gap-px text-[10px] text-muted-foreground"
                        style={{ gridTemplateColumns: `10rem repeat(${days}, minmax(0, 1fr))` }}
                    >
                        <span />
                        {columns.map((day) => (
                            <span key={day} className="text-center">
                                {new Date(day).getUTCDate()}
                            </span>
                        ))}
                    </div>

                    {rows.map((row) => (
                        <div
                            key={row.resourceId}
                            className="grid items-center gap-px border-t border-border/60 py-1"
                            style={{ gridTemplateColumns: `10rem repeat(${days}, minmax(0, 1fr))` }}
                        >
                            <span className="truncate pr-2 text-xs text-foreground" title={row.label}>
                                {row.label}
                            </span>
                            {columns.map((day) => {
                                // La salida es el día en que se libera: un
                                // alquiler que termina el jueves deja el auto
                                // disponible ESE jueves, no el viernes. Pintarlo
                                // ocupado perdería un día de flota por reserva.
                                const occupying = row.items.find((rental) =>
                                    toUtcDay(rental.start_date) <= day
                                    && toUtcDay(rental.end_date) > day);
                                if (!occupying) {
                                    return <span key={day} className="h-5 rounded-sm bg-muted/40" />;
                                }
                                return (
                                    <button
                                        key={day}
                                        type="button"
                                        onClick={() => onSelect?.(occupying)}
                                        title={`${occupying.contact_name || occupying.customer_name || ""} · ${occupying.status}`}
                                        className={cn(
                                            "h-5 rounded-sm text-[9px] font-medium",
                                            STATUS_STYLE[occupying.status] || "bg-muted",
                                        )}
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
