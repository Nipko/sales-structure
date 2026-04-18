"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useTranslations } from "next-intl";
import {
  MessageSquare, CheckCircle2, AlertCircle, Loader2,
  Phone, Key, Hash, Send, Unlink, Copy, ExternalLink,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export default function SmsChannelPage() {
  const { activeTenantId } = useTenant();
  const t = useTranslations("channels.sms");

  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/channels/sms/status`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const data = await res.json();
      if (data.success) setStatus(data.data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadStatus(); }, []);

  const handleConnect = async () => {
    if (!accountSid || !authToken || !phoneNumber) { setError(t("allRequired")); return; }
    setConnecting(true); setError("");
    try {
      const res = await fetch(`${API_URL}/channels/sms/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ accountSid, authToken, phoneNumber, displayName }),
      });
      const data = await res.json();
      if (data.success) { setSuccess(t("smsConnected")); setAccountSid(""); setAuthToken(""); loadStatus(); }
      else setError(data.message || t("connectionFailed"));
    } catch { setError(t("connectionFailed")); }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    try {
      await fetch(`${API_URL}/channels/sms/disconnect`, {
        method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      setStatus(null); setSuccess(t("smsDisconnected"));
    } catch {}
  };

  const handleTestSms = async () => {
    if (!testTo) return;
    setTesting(true);
    try {
      const res = await fetch(`${API_URL}/channels/sms/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ to: testTo }),
      });
      const data = await res.json();
      if (data.success) setSuccess(data.message || "Test sent!"); else setError(data.message || t("testFailed"));
    } catch { setError(t("testFailed")); }
    setTesting(false);
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-indigo-500" /></div>;

  const isConnected = status?.connected;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-xl bg-green-50 dark:bg-green-500/10">
          <MessageSquare size={24} className="text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("subtitle")}</p>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle size={16} /> {error}
          <button onClick={() => setError("")} className="ml-auto text-xs hover:underline bg-transparent border-none cursor-pointer text-red-500">{t("dismiss")}</button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm">
          <CheckCircle2 size={16} /> {success}
          <button onClick={() => setSuccess("")} className="ml-auto text-xs hover:underline bg-transparent border-none cursor-pointer text-emerald-500">{t("dismiss")}</button>
        </div>
      )}

      {/* Connected state */}
      {isConnected && (
        <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">{status.displayName || status.phoneNumber}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">{status.phoneNumber}</p>
              </div>
            </div>
            <button onClick={handleDisconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-500/30 text-red-500 text-xs font-medium cursor-pointer bg-transparent hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
              <Unlink size={13} /> {t("disconnect")}
            </button>
          </div>

          {status.metadata?.webhookUrl && (
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t("webhookUrl")}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 overflow-x-auto">{status.metadata.webhookUrl}</code>
                <button onClick={() => { navigator.clipboard.writeText(status.metadata.webhookUrl); setSuccess(t("webhookCopied")); }}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer border-none bg-transparent text-gray-500"><Copy size={14} /></button>
              </div>
              <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-xs text-indigo-600 hover:underline">
                {t("openConsole")} <ExternalLink size={11} />
              </a>
            </div>
          )}

          <div className="px-6 py-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t("testSms")}</p>
            <div className="flex gap-2">
              <input type="tel" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="+1234567890"
                className="flex-1 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
              <button onClick={handleTestSms} disabled={testing || !testTo}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium cursor-pointer border-none hover:bg-indigo-600 disabled:opacity-50 transition-colors">
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {t("testBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Setup form */}
      {!isConnected && (
        <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-white">{t("connectTitle")}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t("connectSubtitle")}</p>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"><Hash size={14} /> {t("accountSid")}</label>
              <input type="text" value={accountSid} onChange={e => setAccountSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono" />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"><Key size={14} /> {t("authToken")}</label>
              <input type="password" value={authToken} onChange={e => setAuthToken(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"><Phone size={14} /> {t("phoneNumber")}</label>
              <input type="tel" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="+1234567890"
                className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"><MessageSquare size={14} /> {t("displayName")}</label>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>
            <button onClick={handleConnect} disabled={connecting || !accountSid || !authToken || !phoneNumber}
              className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm cursor-pointer border-none hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              {connecting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {connecting ? t("connecting") : t("connectBtn")}
            </button>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-xs text-gray-600 dark:text-gray-400 space-y-2">
              <p className="font-semibold text-gray-700 dark:text-gray-300">{t("howTo")}</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>{t("step1")}</li>
                <li>{t("step2")}</li>
                <li>{t("step3")}</li>
                <li>{t("step4")}</li>
                <li>{t("step5")}</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
