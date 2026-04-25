"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { CheckCircle } from "lucide-react";

interface Props {
  onRefresh: () => void;
}

const COST_CATEGORIES = ["server", "database", "storage", "whatsapp_api", "other"] as const;

export default function SettingsTab({ onRefresh }: Props) {
  const t = useTranslations("financials");
  const tc = useTranslations("common");

  const [toast, setToast] = useState<string | null>(null);

  // Infra costs state
  const [infraCosts, setInfraCosts] = useState<any[]>([]);
  const [infraForm, setInfraForm] = useState({
    month: new Date().toISOString().slice(0, 7),
    category: "server" as string,
    amountDollars: "",
    description: "",
  });
  const [savingInfra, setSavingInfra] = useState(false);

  // Exchange rate state
  const [rateForm, setRateForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    fromCurrency: "COP",
    toCurrency: "USD",
    rate: "",
  });
  const [savingRate, setSavingRate] = useState(false);

  // Snapshot state
  const [snapshotMonth, setSnapshotMonth] = useState(new Date().toISOString().slice(0, 7));
  const [generatingSnapshot, setGeneratingSnapshot] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Load infra costs for current year
  const loadInfraCosts = useCallback(async () => {
    const year = new Date().getFullYear();
    const res = await api.getInfraCosts(year);
    if (res.success && Array.isArray(res.data)) {
      setInfraCosts(res.data);
    }
  }, []);

  useEffect(() => {
    loadInfraCosts();
  }, [loadInfraCosts]);

  const handleSaveInfraCost = async () => {
    if (!infraForm.amountDollars) return;
    setSavingInfra(true);
    const res = await api.saveInfraCost({
      month: infraForm.month,
      category: infraForm.category,
      amountCents: Math.round(parseFloat(infraForm.amountDollars) * 100),
      description: infraForm.description,
    });
    setSavingInfra(false);
    if (res.success) {
      showToast(tc("saved"));
      setInfraForm({ ...infraForm, amountDollars: "", description: "" });
      loadInfraCosts();
      onRefresh();
    } else {
      showToast(res.error || tc("errorSaving"));
    }
  };

  const handleSaveRate = async () => {
    if (!rateForm.rate) return;
    setSavingRate(true);
    const res = await api.saveExchangeRate({
      date: rateForm.date,
      fromCurrency: rateForm.fromCurrency,
      toCurrency: rateForm.toCurrency,
      rate: parseFloat(rateForm.rate),
    });
    setSavingRate(false);
    if (res.success) {
      showToast(tc("saved"));
      setRateForm({ ...rateForm, rate: "" });
    } else {
      showToast(res.error || tc("errorSaving"));
    }
  };

  const handleGenerateSnapshot = async () => {
    setGeneratingSnapshot(true);
    const res = await api.generateSnapshot(snapshotMonth);
    setGeneratingSnapshot(false);
    if (res.success) {
      showToast(tc("saved"));
      onRefresh();
    } else {
      showToast(res.error || tc("errorSaving"));
    }
  };

  return (
    <div className="space-y-6">
      {/* Infrastructure Costs */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
          {t("settings.infraCosts")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">{t("table.date")}</label>
            <input
              type="month"
              value={infraForm.month}
              onChange={(e) => setInfraForm({ ...infraForm, month: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">{t("table.category")}</label>
            <select
              value={infraForm.category}
              onChange={(e) => setInfraForm({ ...infraForm, category: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {COST_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{t(`categories.${cat}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">{t("table.amount")} (USD)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={infraForm.amountDollars}
              onChange={(e) => setInfraForm({ ...infraForm, amountDollars: e.target.value })}
              placeholder="0.00"
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">{t("table.description")}</label>
            <input
              type="text"
              value={infraForm.description}
              onChange={(e) => setInfraForm({ ...infraForm, description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSaveInfraCost}
              disabled={savingInfra || !infraForm.amountDollars}
              className="w-full px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect border-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingInfra ? tc("saving") : t("settings.saveCost")}
            </button>
          </div>
        </div>

        {/* Existing infra costs table */}
        {infraCosts.length > 0 && (
          <div className="overflow-x-auto mt-4 border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.date")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.category")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.amount")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.description")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {infraCosts.map((cost: any, i: number) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-neutral-900 dark:text-neutral-100">{cost.month}</td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                        {t(`categories.${cost.category}` as any)}
                      </span>
                    </td>
                    <td className="px-4 py-2 tabular-nums">${((cost.amountCents || 0) / 100).toLocaleString()}</td>
                    <td className="px-4 py-2 text-neutral-500 text-xs">{cost.description || "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Exchange Rates */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
          {t("settings.exchangeRates")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">{t("table.date")}</label>
            <input
              type="date"
              value={rateForm.date}
              onChange={(e) => setRateForm({ ...rateForm, date: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">From</label>
            <input
              type="text"
              value={rateForm.fromCurrency}
              onChange={(e) => setRateForm({ ...rateForm, fromCurrency: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">To</label>
            <input
              type="text"
              value={rateForm.toCurrency}
              onChange={(e) => setRateForm({ ...rateForm, toCurrency: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Rate</label>
            <input
              type="number"
              step="0.000001"
              min="0"
              value={rateForm.rate}
              onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })}
              placeholder="0.000234"
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSaveRate}
              disabled={savingRate || !rateForm.rate}
              className="w-full px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect border-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingRate ? tc("saving") : t("settings.saveRate")}
            </button>
          </div>
        </div>
      </div>

      {/* Snapshot Management */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
          {t("settings.snapshotManagement")}
        </h3>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">{t("table.date")}</label>
            <input
              type="month"
              value={snapshotMonth}
              onChange={(e) => setSnapshotMonth(e.target.value)}
              className="px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={handleGenerateSnapshot}
            disabled={generatingSnapshot}
            className="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect border-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generatingSnapshot ? tc("saving") : t("settings.generateSnapshot")}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle size={16} className="text-emerald-400 dark:text-emerald-600" />
          {toast}
        </div>
      )}
    </div>
  );
}
