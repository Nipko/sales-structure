"use client";

import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "motion/react";
import { useTranslations } from "next-intl";
import { Icon } from "../ui/Icon";

export function InboxDemo() {
  const t = useTranslations("demos");
  const L = (k: string, fb: string) => (t.has(k) ? t(k) : fb);
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { margin: "-50px" });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const cycle = () => {
      [1, 2, 3, 4].forEach((n, i) => {
        timeouts.push(setTimeout(() => setCount(n), i * 700));
      });
      timeouts.push(setTimeout(() => setCount(0), 4500));
      timeouts.push(setTimeout(cycle, 5500));
    };
    cycle();
    return () => timeouts.forEach(clearTimeout);
  }, [isInView]);

  const items = [
    {
      logo: "/logos/whatsapp.svg",
      name: L("inbox.item1.name", "Carlos R."),
      msg: L("inbox.item1.msg", "Hola, tienen apto en arriendo en Chapinero?"),
      time: L("inbox.item1.time", "ahora"),
    },
    {
      logo: "/logos/instagram.svg",
      name: L("inbox.item2.name", "@valeria.foto"),
      msg: L("inbox.item2.msg", "Vi su trabajo, info de bodas?"),
      time: "1m",
    },
    {
      logo: "/logos/messenger.svg",
      name: L("inbox.item3.name", "Daniel M."),
      msg: L("inbox.item3.msg", "Información de membresías mensuales"),
      time: "2m",
    },
    {
      logo: "",
      name: L("inbox.item4.name", "Telegram · Anita"),
      msg: L("inbox.item4.msg", "Necesito plomero urgente"),
      time: "3m",
    },
  ];

  return (
    <div
      ref={ref}
      className="bg-bg/60 rounded-xl border border-border p-3 h-full overflow-hidden"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-text-primary">
          {L("inbox.title", "Bandeja unificada")}
        </span>
        <span className="text-[10px] text-text-muted">
          {count} {L("inbox.unread", "sin leer")}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.slice(0, count).map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2.5 bg-surface border border-border rounded-lg p-2"
          >
            <div className="w-7 h-7 rounded-full bg-surface-elevated flex items-center justify-center flex-shrink-0">
              {item.logo ? (
                <img src={item.logo} alt="" className="w-4 h-4" />
              ) : (
                Icon.telegram("w-4 h-4 text-[#0088CC]")
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-text-primary truncate">
                  {item.name}
                </p>
                <span className="text-[9px] text-text-muted ml-2 flex-shrink-0">
                  {item.time}
                </span>
              </div>
              <p className="text-[10px] text-text-secondary truncate">
                {item.msg}
              </p>
            </div>
            <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
