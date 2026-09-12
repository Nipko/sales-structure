"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";

/**
 * ═══ AN ORDER, AND A PAYMENT LINK THAT IS NOT A PAYMENT ═════════════════════
 *
 * The one demo the site did not have, and the one where a drawing most easily
 * becomes a lie. The tempting final frame is a green tick reading "paid", and
 * it would be false in two directions at once:
 *
 *   - THE MONEY IS NOT OURS. A customer of the tenant pays the TENANT, through
 *     the tenant's own gateway, with the tenant's own credentials. Parallly
 *     never holds, reconciles or refunds it, and cannot confirm it settled.
 *   - A LINK IS NOT A PAYMENT. Issuing a checkout link is an act we can do;
 *     settlement is an event at somebody else's provider that arrives later, or
 *     never. So the last frame says the link was sent and the order is waiting
 *     for the provider's confirmation — which is what the product can honestly
 *     show — and there is no tick.
 *
 * The prices are deliberately absent: the frozen claim rules forbid inventing
 * per-item figures for an illustrative panel, and a total nobody can trace is
 * exactly the kind of detail that makes a drawing read as a record.
 */

const STEP_COUNT = 4;

export function OrderPaymentDemo() {
  const t = useTranslations("demos");
  const L = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });
  // With reduced motion the panel opens on its final frame instead of cycling:
  // the information is the sequence's OUTCOME, and a reader who asked the
  // system for less movement should not have to wait through four timers to
  // reach it.
  const [step, setStep] = useState(reduceMotion ? STEP_COUNT - 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      setStep(STEP_COUNT - 1);
      return;
    }
    if (!isInView) return;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const cycle = () => {
      timeouts.push(setTimeout(() => setStep(1), 900));
      timeouts.push(setTimeout(() => setStep(2), 2100));
      timeouts.push(setTimeout(() => setStep(3), 3300));
      timeouts.push(setTimeout(() => setStep(0), 6200));
      timeouts.push(setTimeout(cycle, 7000));
    };
    cycle();
    return () => timeouts.forEach(clearTimeout);
  }, [isInView, reduceMotion]);

  const items = [
    L("orderPayment.item1", "2 × plato del día"),
    L("orderPayment.item2", "1 × postre"),
  ];

  return (
    <div ref={ref} className="h-full rounded-xl border border-border bg-bg/60 p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-text-primary">
          {L("orderPayment.header", "Pedido en preparación")}
        </span>
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-text-muted">
          {L("orderPayment.channel", "WhatsApp")}
        </span>
      </div>

      <ul className="mb-3 space-y-1.5">
        {items.map((item, index) => (
          <motion.li
            key={item}
            className="flex items-center justify-between rounded-lg border border-border bg-surface px-2.5 py-2 text-[11px] text-text-secondary"
            animate={reduceMotion ? undefined : { opacity: step > index ? 1 : 0.45 }}
            transition={{ duration: 0.3 }}
          >
            <span className="truncate">{item}</span>
            <span className="ml-2 shrink-0 text-text-muted">
              {step > index ? L("orderPayment.added", "agregado") : "…"}
            </span>
          </motion.li>
        ))}
      </ul>

      <AnimatePresence>
        {step >= 2 && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-2 rounded-lg border border-accent/30 bg-accent/10 p-2.5"
          >
            <p className="text-[11px] font-semibold text-accent">
              {L("orderPayment.linkTitle", "Link de pago enviado")}
            </p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-text-secondary">
              {L(
                "orderPayment.linkDetail",
                "Se genera con la pasarela del negocio. El cobro va a su cuenta, no a la nuestra.",
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {step >= 3 && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-lg border border-border bg-surface p-2.5"
          >
            {/* No tick, and no "paid". The order waits for the provider's
                confirmation, because that is the state the product can read. */}
            <p className="text-[11px] font-semibold text-text-primary">
              {L("orderPayment.pendingTitle", "Pedido a la espera de confirmación")}
            </p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-text-secondary">
              {L(
                "orderPayment.pendingDetail",
                "El pago lo confirma la pasarela del negocio. Hasta que lo informe, el pedido no se da por pagado.",
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
