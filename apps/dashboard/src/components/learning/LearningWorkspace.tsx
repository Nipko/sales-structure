"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, BookOpen, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { canApproveLearningExample, canSelectLearningExample, learningEvaluationSummary, parseLearningTranscript,
    type LearningExample, type LearningRelease, type LearningWorkspaceData } from "@/lib/agent-learning";

const field = "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700";
const button = "rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800";
const primary = `${button} bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-700`;
const panel = "space-y-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";
type Envelope = { success: boolean; data?: any; errorCode?: string; error?: unknown };
type Run = (action: () => Promise<Envelope>, success?: string) => Promise<boolean>;

function Label({ text, children }: { text: string; children: ReactNode }) {
    return <label className="block space-y-1.5 text-sm font-medium"><span>{text}</span>{children}</label>;
}

export function LearningReviewAvailability({ unavailable }: { unavailable: boolean }) {
    const t = useTranslations('agentLearning');
    return <p role="status">{t(unavailable ? 'evidenceUnavailable' : 'loading')}</p>;
}

export function LearningCoverage({ data, unavailable }: { data: LearningWorkspaceData | null; unavailable: boolean }) {
    const t = useTranslations('agentLearning');
    if (!data) return <p role="status" className="text-sm">{t(unavailable ? 'coverageUnavailable' : 'coverageLoading')}</p>;
    const heldout = data.coverage.find(item => item.split === 'holdout')?.count ?? 0;
    return <><p className="text-sm">{t('reserved', { count: heldout })}</p>
        {heldout < 3 && <p className="text-sm text-amber-700 dark:text-amber-300">{t('moreHoldout')}</p>}</>;
}

export function LearningWorkspace({ tenantId, agentId }: { tenantId: string; agentId: string }) {
    const t = useTranslations("agentLearning");
    const locale = useLocale().slice(0, 2);
    const [data, setData] = useState<LearningWorkspaceData | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [selected, setSelected] = useState<string[]>([]);
    const [mode, setMode] = useState("inbox");
    const [conversations, setConversations] = useState<Array<{ id: string; name: string; preview: string }>>([]);
    const [conversationId, setConversationId] = useState("");
    const [sourceKey, setSourceKey] = useState("");
    const [contactKey, setContactKey] = useState("");
    const [transcript, setTranscript] = useState("");
    const [redactTerms, setRedactTerms] = useState("");
    const [channel, setChannel] = useState("web_widget");
    const [language, setLanguage] = useState(["es", "en", "pt", "fr"].includes(locale) ? locale : "es");
    // Raw uploads stay only in this mounted browser view, never localStorage or the server.
    const [uploadOriginals, setUploadOriginals] = useState<Record<string, string>>({});
    const mounted = useRef(true);
    const requestId = useRef(0);
    const actionLock = useRef(false);

    const errorText = useCallback((result: Envelope | Error) => {
        const code = result instanceof Error ? result.message : result.errorCode;
        if (code === 'learning_inbox_source_changed' || code === 'learning_source_identity_changed') return t('sourceChanged');
        if (code === 'learning_release_source_withdrawn') return t('releaseSourceChanged');
        return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.requestFailed");
    }, [t]);
    const refresh = useCallback(async () => {
        const id = ++requestId.current;
        const result = await api.getAgentLearning(tenantId, agentId);
        if (!mounted.current || id !== requestId.current) return;
        if (!result.success || !result.data) throw new Error(result.errorCode || "requestFailed");
        setData(result.data);
        const valid = new Set(result.data.examples.filter(canSelectLearningExample).map(example => example.id));
        setSelected(current => current.filter(id => valid.has(id)));
    }, [tenantId, agentId]);

    useEffect(() => {
        mounted.current = true;
        void refresh().catch(error => { if (mounted.current) setError(errorText(error)); });
        return () => { mounted.current = false; requestId.current++; };
    }, [refresh, errorText]);

    const run: Run = async (action, success = "saved") => {
        if (actionLock.current) return false;
        actionLock.current = true; setBusy(true); setError(""); setNotice("");
        try {
            const result = await action();
            if (!result.success) throw new Error(result.errorCode || "requestFailed");
            if (!mounted.current) return false;
            // A successful write must be followed by an authoritative re-read.
            await refresh();
            if (mounted.current) setNotice(t(success));
            return true;
        } catch (error) {
            if (mounted.current) setError(errorText(error as Error));
            return false;
        } finally { actionLock.current = false; if (mounted.current) setBusy(false); }
    };

    const running = data?.releases.some(release => release.evaluation_status === "running") ||
        data?.examples.some(example => example.status === "analyzing");
    useEffect(() => {
        if (!running || busy) return;
        const timer = setTimeout(() => { void refresh().catch(error => { if (mounted.current) setError(errorText(error)); }); }, 5000);
        return () => clearTimeout(timer);
    }, [running, busy, data, refresh, errorText]);

    const loadInbox = () => run(async () => {
        const result = await api.getInbox(tenantId, "all");
        if (result.success && Array.isArray(result.data)) setConversations(result.data.map(item => ({ id: item.id,
            name: item.contact_name || item.contactName || t("unknownContact"),
            preview: (item.last_message || item.lastMessage || "").slice(0, 90) })));
        return result;
    }, "inboxLoaded");
    const importConversation = () => run(async () => {
        if (mode === "inbox") return api.importInboxLearning(tenantId, agentId, conversationId);
        const messages = parseLearningTranscript(transcript);
        const result = await api.importAgentLearning(tenantId, agentId, { sourceKey: sourceKey.trim(), contactKey: contactKey.trim(), channel, language,
            messages, redactTerms: redactTerms.split(/\r?\n/).map(term => term.trim()).filter(Boolean) });
        if (result.success && result.data?.sourceId && result.data.split === 'train') {
            setUploadOriginals(current => ({ ...current, [result.data.sourceId]: transcript }));
        }
        return result;
    }, "imported").then(ok => { if (ok) { setTranscript(""); setRedactTerms(""); setSourceKey(""); setContactKey(""); } });
    const heldout = data?.coverage.find(item => item.split === "holdout")?.count || 0;

    return <div className="mx-auto max-w-6xl space-y-6 p-4 text-neutral-900 md:p-6 dark:text-neutral-100">
        <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
                <Link href={`/admin/agent/${agentId}`} className="inline-flex items-center gap-1 text-sm text-indigo-600"><ArrowLeft size={15} />{t("back")}</Link>
                <h1 className="flex items-center gap-2 text-2xl font-semibold"><BookOpen size={24} />{t("title")}</h1>
                <p className="max-w-3xl text-sm text-neutral-500">{t("intro")}</p>
            </div>
            <button className={button} disabled={busy} onClick={() => run(async () => ({ success: true }), "refreshed")}><RefreshCw size={14} className="mr-2 inline" />{t("refresh")}</button>
        </header>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{notice}</p>}
        {busy && <p role="status" className="text-sm"><Loader2 size={15} className="mr-2 inline animate-spin" />{t("working")}</p>}

        <section className={panel} aria-labelledby="learning-import">
            <h2 id="learning-import" className="text-lg font-semibold">{t("importTitle")}</h2>
            <p className="text-sm text-neutral-500">{t("importHelp")}</p>
            <fieldset disabled={busy} className="space-y-4">
                <Label text={t("source")}><select className={field} value={mode} onChange={event => setMode(event.target.value)}><option value="inbox">{t("fromInbox")}</option><option value="file">{t("fromText")}</option></select></Label>
                {mode === "inbox" ? <div className="space-y-3">
                    <button className={button} onClick={loadInbox}>{t("loadInbox")}</button>
                    <Label text={t("conversation")}><select className={field} value={conversationId} onChange={event => setConversationId(event.target.value)}><option value="">{t("chooseConversation")}</option>{conversations.map(item => <option key={item.id} value={item.id}>{item.name} — {item.preview}</option>)}</select></Label>
                </div> : <>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Label text={t("sourceName")}><input className={field} value={sourceKey} maxLength={300} onChange={event => setSourceKey(event.target.value)} /></Label>
                        <Label text={t("contactGroup")}><input className={field} value={contactKey} maxLength={300} onChange={event => setContactKey(event.target.value)} aria-describedby="learning-contact-help" /></Label>
                    </div>
                    <p id="learning-contact-help" className="text-xs text-neutral-500">{t("contactGroupHelp")}</p>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Label text={t("language")}><select className={field} value={language} onChange={event => setLanguage(event.target.value)}>{["es", "en", "pt", "fr"].map(value => <option key={value} value={value}>{t(`languages.${value}`)}</option>)}</select></Label>
                        <Label text={t("channel")}><select className={field} value={channel} onChange={event => setChannel(event.target.value)}>{["web_widget", "whatsapp", "instagram", "messenger", "telegram"].map(value => <option key={value} value={value}>{t(`channels.${value}`)}</option>)}</select></Label>
                    </div>
                    <Label text={t("textFile")}><input type="file" accept=".txt,text/plain" className={field} onChange={async event => {
                        const file = event.target.files?.[0]; if (!file) return;
                        if (file.size > 800_000) { setError(t("errors.tooLarge")); return; }
                        setTranscript(await file.text()); if (!sourceKey) setSourceKey(file.name);
                    }} /></Label>
                    <Label text={t("transcript")}><textarea className={field} rows={8} value={transcript} maxLength={200_000} placeholder={t("transcriptExample")} onChange={event => setTranscript(event.target.value)} /></Label>
                    <Label text={t("redactions")}><textarea className={field} rows={2} value={redactTerms} onChange={event => setRedactTerms(event.target.value)} placeholder={t("redactionsHelp")} /></Label>
                </>}
                <button className={primary} disabled={mode === "inbox" ? !conversationId : !sourceKey.trim() || !contactKey.trim() || !transcript.trim()} onClick={importConversation}>{t("importAction")}</button>
            </fieldset>
        </section>

        <section className="space-y-4" aria-labelledby="learning-review">
            <div><h2 id="learning-review" className="text-lg font-semibold">{t("reviewTitle")}</h2><p className="text-sm text-neutral-500">{t("reviewHelp")}</p></div>
            {!data ? <LearningReviewAvailability unavailable={Boolean(error)} /> : !data.examples.length ? <p className={panel}>{t("noExamples")}</p> : data.examples.map(example =>
                <ExampleCard key={`${example.id}:${example.revision}:${example.status}:${example.sourceAvailability}`} example={example} tenantId={tenantId} agentId={agentId} busy={busy} run={run} uploadOriginal={uploadOriginals[example.source_id]}
                    selected={selected.includes(example.id)} onSelect={checked => setSelected(current => checked ? [...new Set([...current, example.id])] : current.filter(id => id !== example.id))} />)}
        </section>

        <section className={panel} aria-labelledby="learning-compare">
            <h2 id="learning-compare" className="text-lg font-semibold">{t("compareTitle")}</h2>
            <p className="text-sm text-neutral-500">{t("compareHelp")}</p>
            <LearningCoverage data={data} unavailable={Boolean(error)} />
            <button className={primary} disabled={!data || busy || !selected.length || heldout < 3} onClick={() => run(() => api.createLearningRelease(tenantId, agentId, selected), "candidateCreated").then(ok => { if (ok) setSelected([]); })}>{t("createCandidate", { count: selected.length })}</button>
            {data?.releases.map((release, index) => <ReleaseCard key={release.id} release={release} number={data.releases.length - index} busy={busy} run={run} tenantId={tenantId} agentId={agentId} />)}
        </section>
    </div>;
}

export function ExampleCard({ example, tenantId, agentId, busy, run, selected, onSelect, uploadOriginal }: { example: LearningExample; tenantId: string; agentId: string; busy: boolean; run: Run; selected: boolean; onSelect: (checked: boolean) => void; uploadOriginal?: string }) {
    const t = useTranslations("agentLearning");
    const [pattern, setPattern] = useState(example.response_pattern || "");
    const [note, setNote] = useState("");
    const [privacy, setPrivacy] = useState(false);
    const [correctness, setCorrectness] = useState(false);
    const [original, setOriginal] = useState<Array<{ direction: string; content_text: string }> | null>(null);
    const status = t.has(`statuses.${example.status}`) ? t(`statuses.${example.status}`) : t("statuses.pending");
    const changed = pattern !== (example.response_pattern || "");
    const sourceChanged = example.sourceAvailability === 'changed';
    const reviewable = !sourceChanged && !['approved', 'rejected', 'retired', 'analyzing'].includes(example.status);
    return <article className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{t.has(`intents.${example.intent}`) ? t(`intents.${example.intent}`) : t("intents.general")}</h3><span className="text-xs text-neutral-500">{status} · {t("revision", { number: example.revision })}</span></div>
        {sourceChanged && <div role="status" className="space-y-2 text-sm text-amber-700 dark:text-amber-300"><p>{t('sourceChanged')}</p>
            {example.source_kind === 'inbox' && example.source_conversation_id && <button className={button} disabled={busy}
                onClick={() => run(() => api.importInboxLearning(tenantId,agentId,example.source_conversation_id!), 'imported')}>{t('reimportSource')}</button>}
        </div>}
        <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2"><h4 className="text-sm font-medium">{t("sourceExcerpt")}</h4>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg bg-neutral-50 p-3 dark:bg-neutral-950">{example.episode.map((message, index) => <p key={index} className="whitespace-pre-wrap text-sm"><strong>{t(message.role)}: </strong>{message.text}</p>)}</div>
                {example.source_kind === "inbox" && <button className={button} disabled={busy || sourceChanged} onClick={() => original ? setOriginal(null) : run(async () => {
                    const result = await api.getLearningOriginal(tenantId, agentId, example.source_id);
                    if (result.success && Array.isArray(result.data)) setOriginal(result.data); return result;
                }, "originalLoaded")}>{t(original ? "hideOriginal" : "showOriginal")}</button>}
                {original && <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">{original.map((message, index) => <p key={index} className="whitespace-pre-wrap text-sm"><strong>{t(message.direction === "inbound" ? "customer" : "assistant")}: </strong>{message.content_text}</p>)}</div>}
                {uploadOriginal && <details className="text-sm"><summary className="cursor-pointer">{t("uploadOriginal")}</summary><p className="my-2 text-xs text-neutral-500">{t("uploadOriginalHelp")}</p><pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border p-3 font-sans">{uploadOriginal}</pre></details>}
            </div>
            <div className="space-y-3"><Label text={t("pattern")}><textarea className={field} rows={6} maxLength={1800} value={pattern} disabled={busy} onChange={event => setPattern(event.target.value)} /></Label>
                {example.rationale && <p className="text-sm text-neutral-500">{example.rationale}</p>}
                {!!example.facts_required?.length && <p className="text-sm"><strong>{t("factsRequired")}: </strong>{example.facts_required.join(" · ")}</p>}
                <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || sourceChanged || !changed || !pattern.trim()} onClick={() => run(() => api.reviseLearningExample(tenantId, agentId, example.id, example.revision, pattern), "revisionSaved")}>{t("saveRevision")}</button>
                    <button className={button} disabled={busy || sourceChanged || changed || example.status === "approved" || example.status === "analyzing"} onClick={() => run(() => api.analyzeLearningExample(tenantId, agentId, example.id), "analyzed")}>{t("analyze")}</button></div>
            </div>
        </div>
        {example.analysis?.scores && <dl className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">{Object.entries(example.analysis.scores).map(([name, score]) => <div key={name} className="flex justify-between rounded-lg bg-neutral-50 p-2 dark:bg-neutral-950"><dt>{t.has(`dimensions.${name}`) ? t(`dimensions.${name}`) : t("quality")}</dt><dd>{score}/4</dd></div>)}</dl>}
        {!!example.analysis?.exclusions?.length && <div className="space-y-1 text-sm text-amber-700 dark:text-amber-300"><p>{t("excludedHelp")}</p><ul className="list-disc pl-5">{example.analysis.exclusions.map((reason, index) => <li key={index}>{t.has(`exclusions.${reason}`) ? t(`exclusions.${reason}`) : reason}</li>)}</ul></div>}
        {example.kind && t.has(`kinds.${example.kind}`) && <p className="text-sm text-neutral-500">{t(`kinds.${example.kind}`)}</p>}
        {example.status === 'analyzed' && !canApproveLearningExample(example) && <p className="text-sm text-amber-700 dark:text-amber-300">{t("qualityThreshold")}</p>}
        {reviewable && <fieldset disabled={busy || changed} className="space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <Label text={t("reviewNote")}><textarea className={field} rows={2} value={note} minLength={10} maxLength={2000} onChange={event => setNote(event.target.value)} /></Label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={privacy} onChange={event => setPrivacy(event.target.checked)} />{t("privacyChecked")}</label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={correctness} onChange={event => setCorrectness(event.target.checked)} />{t("correctnessChecked")}</label>
            <div className="flex gap-2">{(["approved", "rejected"] as const).map(decision => <button key={decision} className={decision === "approved" ? primary : button} disabled={note.trim().length < 10 || (decision === "approved" && (!privacy || !correctness || !canApproveLearningExample(example)))} onClick={() => run(() => api.reviewLearningExample(tenantId, agentId, example.id, { decision, revision: example.revision, note, privacyChecked: privacy, correctnessChecked: correctness }), "reviewSaved")}>{t(decision === "approved" ? "approve" : "reject")}</button>)}</div>
        </fieldset>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
            {canSelectLearningExample(example) ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected} disabled={busy} onChange={event => onSelect(event.target.checked)} />{t("selectExample")}</label> : <p className="text-xs text-neutral-500">{t("onlyReviewed")}</p>}
            <button className={button} disabled={busy} onClick={() => run(() => api.withdrawLearningSource(tenantId, agentId, example.source_id), "withdrawn")}>{t("withdraw")}</button>
        </div>
    </article>;
}

export function ReleaseCard({ release, number, busy, run, tenantId, agentId }: { release: LearningRelease; number: number; busy: boolean; run: Run; tenantId: string; agentId: string }) {
    const t = useTranslations("agentLearning");
    const [traffic, setTraffic] = useState(10);
    const summary = learningEvaluationSummary(release);
    const status = release.status === "candidate" ? release.evaluation_status : release.status;
    const sourceChanged = release.sourceAvailability === 'changed';
    return <article className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{t("candidate", { number })}</h3><span className="text-sm">{t.has(`statuses.${status}`) ? t(`statuses.${status}`) : t("statuses.pending")}</span></div>
        {sourceChanged && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{t('releaseSourceChanged')}</p>}
        {release.evaluation_status === "running" && <p className="text-sm">{t("evaluating")}</p>}
        {release.evaluation && <>
            <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt>{t("baselineScore")}</dt><dd className="text-xl font-semibold">{release.evaluation.baselineAverage?.toFixed(1) ?? t("unavailable")}</dd></div><div><dt>{t("candidateScore")}</dt><dd className="text-xl font-semibold">{release.evaluation.candidateAverage?.toFixed(1) ?? t("unavailable")}</dd></div></dl>
            <p className="text-sm">{t("evaluationCounts", summary)}</p>
            {release.evaluation.error && <p className="text-sm text-amber-700 dark:text-amber-300">{t("evaluationFailed")}</p>}
        </>}
        {release.status === "candidate" && !sourceChanged && <div className="flex flex-wrap items-end gap-3">
            <button className={button} disabled={busy || release.evaluation_status === "running"} onClick={() => run(() => api.evaluateLearningRelease(tenantId, agentId, release.id), "evaluationStarted")}>{t("evaluate")}</button>
            {release.evaluation_status === "passed" && <><Label text={t("traffic")}><select className={field} value={traffic} disabled={busy} onChange={event => setTraffic(Number(event.target.value))}>{[10, 25, 50, 100].map(value => <option key={value} value={value}>{value}%</option>)}</select></Label><button className={primary} disabled={busy} onClick={() => run(() => api.publishLearningRelease(tenantId, agentId, release.id, traffic), "published")}>{t("publish")}</button></>}
        </div>}
        {release.status === "published" && <div className="flex flex-wrap items-center justify-between gap-3">{!sourceChanged && <p className="text-sm">{t("liveTraffic", { percent: release.traffic_percent })}</p>}<button className={button} disabled={busy} onClick={() => run(() => api.rollbackLearningRelease(tenantId, agentId, release.id), "rolledBack")}>{t("rollback")}</button></div>}
    </article>;
}
