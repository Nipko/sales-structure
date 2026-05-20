"use client";

import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";

const COMP_ROWS = [
  { key: "row1", manual: false, basic: true, parallly: true },
  { key: "row2", manual: false, basic: false, parallly: true },
  { key: "row3", manual: false, basic: false, parallly: true },
  { key: "row4", manual: false, basic: false, parallly: true },
  { key: "row5", manual: true, basic: false, parallly: true },
  { key: "row6", manual: true, basic: false, parallly: true },
  { key: "row7", manual: false, basic: false, parallly: true },
  { key: "row8", manual: false, basic: false, parallly: true },
] as const;

function CheckMark() {
  return (
    <span className="text-emerald-400 inline-block">{Icon.check()}</span>
  );
}

function XMark() {
  return (
    <span className="text-zinc-600 inline-block">{Icon.x()}</span>
  );
}

export function ComparisonTable() {
  const t = useTranslations("comparison");

  return (
    <Section className="bg-surface/30">
      <h2 className="text-3xl sm:text-4xl font-bold text-center mb-14 tracking-tight">
        {t("title")}
      </h2>

      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full max-w-3xl mx-auto text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-4 pr-4 text-text-secondary font-medium" />
              <th className="py-4 px-4 text-text-secondary font-medium text-center">
                {t("manual")}
              </th>
              <th className="py-4 px-4 text-text-secondary font-medium text-center">
                {t("basicBots")}
              </th>
              <th className="py-4 px-4 text-text-primary font-bold text-center bg-accent/10 rounded-t-xl border-x border-t border-accent/30">
                Parallly
              </th>
            </tr>
          </thead>
          <tbody>
            {COMP_ROWS.map((row, i) => (
              <tr key={i} className="border-b border-border/40">
                <td className="py-3.5 pr-4 text-text-secondary">
                  {t(row.key)}
                </td>
                <td className="py-3.5 px-4 text-center">
                  {row.manual ? <CheckMark /> : <XMark />}
                </td>
                <td className="py-3.5 px-4 text-center">
                  {row.basic ? <CheckMark /> : <XMark />}
                </td>
                <td className="py-3.5 px-4 text-center bg-accent/10 border-x border-accent/30">
                  <CheckMark />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} />
              <td className="bg-accent/10 border-x border-b border-accent/30 rounded-b-xl h-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );
}
