"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Clock, TrendingUp, Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonPage } from "@/components/ui/skeleton-loader";
import { useTenant } from "@/contexts/TenantContext";
import { api, type SalesMoneySummary } from "@/lib/api";

/**
 * Cómo va el negocio, en plata.
 *
 * Toda la pantalla existe para sostener una distinción: **un anticipo no es una
 * venta cobrada**. Un solo número grande de "ventas" miente en las dos
 * direcciones — infla el ingreso y esconde el saldo. Por eso el cobrado va
 * separado del saldo, y lo que todavía se está pagando no se suma a ninguno.
 *
 * Y se muestra lo PERDIDO, que casi ningún panel enseña: retenciones que
 * vencieron sin pagar. Es la venta que el negocio no cerró, y es de lo poco que
 * un reporte puede decir que sirva para cambiar algo.
 */

const mes = () => {
  const hoy = new Date();
  return {
    start: new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10),
    end: hoy.toISOString().slice(0, 10),
  };
};

function money(cents: number, currency: string) {
  // Los centavos nunca se muestran crudos: 72000000 leído como pesos son 72
  // millones en vez de 720.000.
  return new Intl.NumberFormat("es-CO", {
    style: "currency", currency, maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default function SalesPage() {
  const t = useTranslations("sales");
  const { activeTenantId } = useTenant();
  const [rango, setRango] = useState(mes);
  const [filas, setFilas] = useState<SalesMoneySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!activeTenantId) return;
    setError(null);
    const res = await api.getSalesSummary(activeTenantId, rango.start, rango.end);
    // apiGet envuelve los errores del backend como {success:false} con HTTP 200,
    // así que sin mirar `success` una falla se vería como "no vendiste nada".
    if (!res.success) {
      setError(t("loadError"));
      setFilas([]);
      return;
    }
    setFilas(res.data || []);
  }, [activeTenantId, rango, t]);

  useEffect(() => { cargar(); }, [cargar]);

  if (!filas) return <SkeletonPage />;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} icon={Wallet} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">{t("from")}</label>
          <input
            type="date" value={rango.start}
            onChange={(e) => setRango(r => ({ ...r, start: e.target.value }))}
            className="px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">{t("to")}</label>
          <input
            type="date" value={rango.end}
            onChange={(e) => setRango(r => ({ ...r, end: e.target.value }))}
            className="px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {!error && filas.length === 0 && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-8 text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("empty")}</p>
        </div>
      )}

      {filas.map((f) => (
        <div key={f.currency} className="space-y-4">
          {filas.length > 1 && (
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{f.currency}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card
              icon={<Wallet size={16} className="text-emerald-500" />}
              label={t("collected")} help={t("collectedHelp")}
              value={money(f.netCents, f.currency)}
              foot={f.refundedCents > 0 ? t("afterRefunds", { amount: money(f.refundedCents, f.currency) }) : t("paymentsCount", { n: f.counts.paid })}
              tone="emerald"
            />
            <Card
              icon={<TrendingUp size={16} className="text-indigo-500" />}
              label={t("outstanding")} help={t("outstandingHelp")}
              value={money(f.outstandingCents, f.currency)}
              foot={t("withDepositCount", { n: f.counts.withDeposit })}
              tone="indigo"
            />
            <Card
              icon={<Clock size={16} className="text-amber-500" />}
              label={t("inProgress")} help={t("inProgressHelp")}
              value={money(f.inProgressCents, f.currency)}
              foot={t("inProgressCount", { n: f.counts.inProgress })}
              tone="amber"
            />
            <Card
              icon={<AlertTriangle size={16} className="text-neutral-400" />}
              label={t("lost")} help={t("lostHelp")}
              value={money(f.lostCents, f.currency)}
              foot={t("lostCount", { n: f.counts.lost })}
              tone="neutral"
            />
          </div>

          {/* De dónde viene lo cobrado. Las dos partes suman el total por
              construcción: los pagos completos se derivan del resto. */}
          {f.collectedCents > 0 && (
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
              <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3">
                {t("breakdownTitle")}
              </p>
              <div className="flex h-2 rounded-full overflow-hidden bg-neutral-100 dark:bg-neutral-800 mb-3">
                <div
                  className="bg-emerald-500"
                  style={{ width: `${(f.fromFullPaymentsCents / f.collectedCents) * 100}%` }}
                />
                <div
                  className="bg-indigo-400"
                  style={{ width: `${(f.fromDepositsCents / f.collectedCents) * 100}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                <span className="text-neutral-600 dark:text-neutral-300">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />
                  {t("fullPayments")}: {money(f.fromFullPaymentsCents, f.currency)}
                </span>
                <span className="text-neutral-600 dark:text-neutral-300">
                  <span className="inline-block w-2 h-2 rounded-full bg-indigo-400 mr-1.5" />
                  {t("deposits")}: {money(f.fromDepositsCents, f.currency)}
                </span>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Lo que este reporte NO cubre. Decirlo evita que un cero se lea como
          "no vendí nada" cuando en realidad esa vertical no tiene cobro. */}
      <p className="text-xs text-neutral-400 dark:text-neutral-500">{t("scopeNote")}</p>
    </div>
  );
}

function Card({ icon, label, help, value, foot, tone }: {
  icon: React.ReactNode; label: string; help: string; value: string; foot: string;
  tone: "emerald" | "indigo" | "amber" | "neutral";
}) {
  const ring = {
    emerald: "border-emerald-200 dark:border-emerald-900/40",
    indigo: "border-indigo-200 dark:border-indigo-900/40",
    amber: "border-amber-200 dark:border-amber-900/40",
    neutral: "border-neutral-200 dark:border-neutral-800",
  }[tone];

  return (
    <div className={`rounded-xl border ${ring} bg-white dark:bg-neutral-900 p-4`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{label}</p>
      </div>
      <p className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">{value}</p>
      {/* La explicación va SIEMPRE, no en un tooltip: la diferencia entre
          "cobrado" y "por cobrar" es justo lo que el dueño necesita entender. */}
      <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">{help}</p>
      <p className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">{foot}</p>
    </div>
  );
}
