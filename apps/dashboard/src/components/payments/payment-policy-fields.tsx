"use client";

import { useTranslations } from "next-intl";

/**
 * Cómo se confirma lo que vendés: con o sin pago.
 *
 * Es el mismo concepto en cada vertical (un alojamiento, un servicio, un tour),
 * así que vive una sola vez. Lo que el dueño elige acá es lo que el agente lee
 * ANTES de confirmarle algo a un cliente: sin esto decía "tu reserva quedó
 * confirmada" y recién después salía a buscar el enlace de pago.
 *
 * La consecuencia importante se muestra en pantalla y no en la documentación:
 * mientras no se pague, **la fecha o el turno siguen a la venta**. Gana quien
 * pague primero. El dueño tiene que poder decidir con eso a la vista.
 */

export type PaymentPolicyMode = "none" | "full" | "deposit" | "any";

export interface PaymentPolicyValue {
  paymentPolicy: PaymentPolicyMode;
  depositPercent: number | null;
  depositAmount: number | null;
}

const MODES: PaymentPolicyMode[] = ["none", "full", "deposit", "any"];

export function PaymentPolicyFields({
  value,
  onChange,
  currencySymbol,
  inputCls,
  disabled,
}: {
  value: PaymentPolicyValue;
  onChange: (next: PaymentPolicyValue) => void;
  currencySymbol?: string;
  inputCls: string;
  disabled?: boolean;
}) {
  const t = useTranslations("paymentPolicy");
  const asksDeposit = value.paymentPolicy === "deposit" || value.paymentPolicy === "any";
  // Pedir anticipo sin decir cuánto le cobraría el total al cliente, creyendo el
  // dueño que configuró una seña. El backend lo rechaza; acá se avisa antes.
  const missingDeposit = asksDeposit && !value.depositPercent && !value.depositAmount;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-4">
      <div>
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t("title")}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t("subtitle")}</p>
      </div>

      <div className="space-y-2">
        {MODES.map((mode) => (
          <label
            key={mode}
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
              value.paymentPolicy === mode
                ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/20"
                : "border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
            }`}
          >
            <input
              type="radio"
              name="paymentPolicy"
              className="mt-0.5"
              checked={value.paymentPolicy === mode}
              disabled={disabled}
              onChange={() => onChange({ ...value, paymentPolicy: mode })}
            />
            <span>
              <span className="block text-sm text-neutral-900 dark:text-neutral-100">{t(`mode.${mode}.label`)}</span>
              <span className="block text-xs text-neutral-500 dark:text-neutral-400">{t(`mode.${mode}.help`)}</span>
            </span>
          </label>
        ))}
      </div>

      {asksDeposit && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
              {t("depositPercent")}
            </label>
            <input
              type="number"
              min={1}
              max={100}
              className={inputCls}
              disabled={disabled}
              value={value.depositPercent ?? ""}
              onChange={(e) =>
                onChange({ ...value, depositPercent: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
              {t("depositAmount")}
            </label>
            <div className="relative">
              {currencySymbol && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
                  {currencySymbol}
                </span>
              )}
              <input
                type="number"
                min={1}
                className={`${inputCls} ${currencySymbol ? "pl-8" : ""}`}
                disabled={disabled}
                value={value.depositAmount ?? ""}
                onChange={(e) =>
                  onChange({ ...value, depositAmount: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
          </div>
          {/* El monto fijo le gana al porcentaje: el dueño puede decir
              "cincuenta mil y listo" sin pensar en proporciones. */}
          <p className="col-span-2 text-[11px] text-neutral-500 dark:text-neutral-400">{t("depositHint")}</p>
        </div>
      )}

      {missingDeposit && (
        <p className="text-xs text-red-600 dark:text-red-400">{t("depositRequired")}</p>
      )}

      {value.paymentPolicy !== "none" && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{t("slotNotHeld")}</p>
      )}
    </div>
  );
}

/** Lee la política de una fila del API, tolerando filas viejas sin columnas. */
export function readPaymentPolicy(row: any): PaymentPolicyValue {
  const raw = String(row?.payment_policy ?? row?.paymentPolicy ?? "none").toLowerCase();
  const toNumberOrNull = (v: unknown) =>
    v === null || v === undefined || v === "" ? null : Number(v);
  return {
    paymentPolicy: (MODES as string[]).includes(raw) ? (raw as PaymentPolicyMode) : "none",
    depositPercent: toNumberOrNull(row?.deposit_percent ?? row?.depositPercent),
    depositAmount: toNumberOrNull(row?.deposit_amount ?? row?.depositAmount),
  };
}
