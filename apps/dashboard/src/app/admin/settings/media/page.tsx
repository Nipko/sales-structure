"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  ArrowLeft, Upload, ImageIcon, Trash2, Copy, Check, X,
  Loader2, Building2, ZoomIn, Pencil, Save, Tag, Plus,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface MediaFile {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  entityType: string;
  label: string | null;
  description: string | null;
  tags: string[];
  createdAt: string;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_SIZE = 5 * 1024 * 1024;

// Media files are served under /api/v1/media/file/...
// The API returns URLs like /api/v1/media/file/{tenantId}/{file}
// We prepend the API base domain (without /api/v1 since the path already has it)
function mediaUrl(relPath: string): string {
  const base = (process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1")
    .replace(/\/api\/v1\/?$/, "");
  return `${base}${relPath}`;
}

function fmtBytes(b: number): string {
  if (!b) return "0 B";
  const k = 1024;
  const s = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${s[i]}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

// Entity options labels are resolved via t() inside the component
const ENTITY_KEYS = [
  { value: "general", key: "types.general" },
  { value: "product", key: "types.product" },
  { value: "course", key: "types.course" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MediaBankPage() {
  const t = useTranslations('media');
    const tc = useTranslations("common");
  const { user } = useAuth();
  const { activeTenantId } = useTenant();
  const tenantId = activeTenantId || user?.tenantId || "";

  const ENTITY_OPTIONS = ENTITY_KEYS.map(e => ({ value: e.value, label: t(e.key) }));

  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [entityType, setEntityType] = useState("general");
  const [filterType, setFilterType] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const [dragging, setDragging] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);

  // Logo
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  // --- Load ---
  const loadMedia = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      let url = `/media/list/${tenantId}`;
      const params = new URLSearchParams();
      if (filterType) params.set("entityType", filterType);
      if (filterTag) params.set("tag", filterTag);
      if (params.toString()) url += `?${params}`;

      const res = await api.fetch(url);
      if (res.success && Array.isArray(res.data)) setFiles(res.data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [tenantId, filterType, filterTag]);

  const loadTags = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await api.getMediaTags(tenantId);
      if (res.success && Array.isArray(res.data)) setAllTags(res.data);
    } catch { /* ignore */ }
  }, [tenantId]);

  useEffect(() => { loadMedia(); }, [loadMedia]);
  useEffect(() => { loadTags(); }, [loadTags]);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      try {
        const res = await api.getMediaList(tenantId, "tenant_logo");
        if (res.success && res.data?.length > 0) setLogoUrl(mediaUrl(res.data[0].url));
      } catch { /* ignore */ }
    })();
  }, [tenantId]);

  // --- Upload ---
  async function handleFileUpload(file: File) {
    if (!tenantId) return;
    if (!file.type.startsWith("image/")) { showToast(`Error: ${t('onlyImages')}`); return; }
    if (file.size > MAX_SIZE) {
      showToast(`Error: ${t('tooLarge', { size: (file.size / 1024 / 1024).toFixed(1) })}`);
      return;
    }
    setUploading(true); setUploadProgress(0);
    const iv = setInterval(() => setUploadProgress(p => p >= 90 ? 90 : p + 10), 200);
    try {
      const res = await api.uploadMedia(tenantId, file, entityType);
      clearInterval(iv); setUploadProgress(100);
      if (res.success) {
        showToast(t('imageUploaded'));
        // Add immediately to gallery for instant feedback
        if (res.data) setFiles(prev => [res.data, ...prev]);
        loadTags();
      } else showToast(`Error: ${res.error || "Could not upload"}`);
    } catch { clearInterval(iv); showToast("Error: Connection failed"); }
    finally { setTimeout(() => { setUploading(false); setUploadProgress(0); }, 600); }
  }

  async function handleLogoUpload(file: File) {
    if (!tenantId || !file.type.startsWith("image/")) { showToast(`Error: ${t('onlyImages')}`); return; }
    if (file.size > MAX_SIZE) { showToast(`Error: ${t('tooLarge', { size: (file.size / 1024 / 1024).toFixed(1) })}`); return; }
    setLogoUploading(true);
    try {
      const res = await api.uploadLogo(tenantId, file);
      if (res.success && res.data?.logoUrl) {
        setLogoUrl(mediaUrl(res.data.logoUrl));
        showToast("Logo updated");
        loadMedia(); // Refresh gallery to show logo in list too
      }
      else showToast(`Error: ${res.error || "Could not upload"}`);
    } catch { showToast("Error: Connection failed"); }
    finally { setLogoUploading(false); }
  }

  // --- Edit ---
  function startEdit(f: MediaFile) {
    setEditingId(f.id); setEditLabel(f.label || ""); setEditDesc(f.description || ""); setEditTags([...f.tags]); setNewTag("");
  }
  function addTag() {
    const t = newTag.trim().toLowerCase();
    if (t && !editTags.includes(t)) setEditTags([...editTags, t]);
    setNewTag("");
  }
  function removeTag(t: string) { setEditTags(editTags.filter(x => x !== t)); }

  async function saveEdit() {
    if (!tenantId || !editingId) return;
    setSaving(true);
    try {
      const res = await api.updateMedia(tenantId, editingId, { label: editLabel, description: editDesc, tags: editTags });
      if (res.success) {
        setFiles(prev => prev.map(f => f.id === editingId ? { ...f, label: editLabel, description: editDesc, tags: editTags } : f));
        showToast(tc("saved")); setEditingId(null); loadTags();
      } else showToast(`Error: ${res.error}`);
    } catch { showToast(tc("errorSaving")); }
    finally { setSaving(false); }
  }

  async function handleDelete(fileId: string) {
    if (!tenantId || !confirm("Delete this image?")) return;
    try {
      const res = await api.deleteMedia(tenantId, fileId);
      if (res.success) { showToast(t('imageDeleted')); setFiles(prev => prev.filter(f => f.id !== fileId)); }
      else showToast(`Error: ${res.error}`);
    } catch { showToast(tc("errorSaving")); }
  }

  function copyUrl(f: MediaFile) {
    navigator.clipboard.writeText(mediaUrl(f.url));
    setCopiedId(f.id); showToast(t('urlCopied'));
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Drag & drop
  function onDragOver(e: React.DragEvent) { e.preventDefault(); setDragging(true); }
  function onDragLeave(e: React.DragEvent) { e.preventDefault(); setDragging(false); }
  function onDrop(e: React.DragEvent) { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f); }

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      {/* Toast */}
      {toast && (
        <div className={cn("fixed top-6 right-6 z-[9999] text-white px-6 py-3 rounded-[10px] text-sm font-semibold shadow-lg max-w-[400px]",
          toast.includes("Error") ? "bg-red-500" : "bg-emerald-500")}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <Link href="/admin/settings" className="w-9 h-9 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/15 flex items-center justify-center">
            <ImageIcon size={22} className="text-indigo-500" />
          </div>
          <div>
            <h1 className="text-[22px] font-semibold text-foreground m-0">{t('title')}</h1>
            <p className="text-[13px] text-muted-foreground m-0">{t('subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Logo Section */}
      <div className="bg-card rounded-[14px] border border-border p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Building2 size={18} className="text-indigo-500" />
          <h2 className="text-base font-semibold text-foreground m-0">{t('companyLogo')}</h2>
        </div>
        <div className="flex items-center gap-6">
          <div className="w-24 h-24 rounded-xl border-2 border-dashed border-border bg-neutral-50 dark:bg-neutral-800 flex items-center justify-center overflow-hidden shrink-0">
            {logoUrl ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" /> : <Building2 size={32} className="text-muted-foreground opacity-40" />}
          </div>
          <div className="flex-1">
            <p className="text-sm text-muted-foreground mb-3">{t('logoDescription')}</p>
            <input ref={logoInputRef} type="file" accept={ACCEPT} className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = ""; }} />
            <button onClick={() => logoInputRef.current?.click()} disabled={logoUploading}
              className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-indigo-600 text-white border-none cursor-pointer text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors">
              {logoUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {logoUploading ? "Uploading..." : t('uploadLogo')}
            </button>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div className="bg-card rounded-[14px] border border-border p-6 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Upload size={18} className="text-indigo-500" />
            <h2 className="text-base font-semibold text-foreground m-0">{t('uploadImage')}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Type:</span>
            <select value={entityType} onChange={e => setEntityType(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm outline-none w-[140px]">
              {ENTITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={cn("border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer transition-colors",
            dragging ? "border-indigo-500 bg-indigo-500/5" : "border-border hover:border-indigo-500/50 bg-background")}>
          <input ref={fileInputRef} type="file" accept={ACCEPT} className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ""; }} />
          {uploading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={32} className="text-indigo-500 animate-spin" />
              <p className="text-sm text-muted-foreground">Uploading... {uploadProgress}%</p>
              <div className="w-48 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          ) : (
            <>
              <Upload size={32} className="text-muted-foreground opacity-50 mb-2" />
              <p className="text-sm text-foreground font-medium mb-1">{t('dragOrClick')}</p>
              <p className="text-xs text-muted-foreground">{t('maxSize')}</p>
            </>
          )}
        </div>
      </div>

      {/* Gallery */}
      <div className="bg-card rounded-[14px] border border-border p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <ImageIcon size={18} className="text-indigo-500" />
            <h2 className="text-base font-semibold text-foreground m-0">{t('gallery')}</h2>
            <span className="text-xs text-muted-foreground">({files.length})</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm outline-none w-[140px]">
              <option value="">{t('allTypes')}</option>
              {ENTITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {allTags.length > 0 && (
              <select value={filterTag} onChange={e => setFilterTag(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm outline-none w-[160px]">
                <option value="">{t('allTags')}</option>
                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Tag pills for quick filter */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button onClick={() => setFilterTag("")}
              className={cn("px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer",
                !filterTag ? "bg-indigo-500 text-white border-indigo-500" : "bg-background text-muted-foreground border-border hover:border-indigo-400")}>
              All
            </button>
            {allTags.map(t => (
              <button key={t} onClick={() => setFilterTag(filterTag === t ? "" : t)}
                className={cn("px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer",
                  filterTag === t ? "bg-indigo-500 text-white border-indigo-500" : "bg-background text-muted-foreground border-border hover:border-indigo-400")}>
                <Tag size={10} className="inline mr-1" />{t}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="p-12 text-center text-muted-foreground">
            <Loader2 size={28} className="animate-spin mx-auto mb-2 opacity-60" />
            <p className="text-sm">Loading images...</p>
          </div>
        ) : files.length === 0 ? (
          <div className="p-12 text-center">
            <ImageIcon size={40} className="text-muted-foreground opacity-30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{filterTag || filterType ? tc("noResults") : tc("noData")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {files.map(file => {
              const fullUrl = mediaUrl(file.url);
              const thumbUrl = file.thumbnailUrl ? mediaUrl(file.thumbnailUrl) : fullUrl;
              const isEditing = editingId === file.id;

              return (
                <div key={file.id} className="bg-background rounded-xl border border-border overflow-hidden group">
                  {/* Thumbnail */}
                  <div className="relative aspect-square bg-neutral-100 dark:bg-neutral-800 cursor-pointer overflow-hidden"
                    onClick={() => !isEditing && setPreviewFile(file)}>
                    <img src={thumbUrl} alt={file.label || file.originalName}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105" loading="lazy"
                      onError={e => {
                        const img = e.target as HTMLImageElement;
                        // Retry once after 1s (file might not be ready yet)
                        if (!img.dataset.retried) {
                          img.dataset.retried = "1";
                          setTimeout(() => { img.src = thumbUrl + "?t=" + Date.now(); }, 1000);
                        } else {
                          img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23f0f0f0'/%3E%3Ctext x='50' y='55' text-anchor='middle' fill='%23999' font-size='11'%3ELoading...%3C/text%3E%3C/svg%3E";
                        }
                      }} />
                    {!isEditing && (
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <ZoomIn size={24} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    )}
                    {file.entityType && file.entityType !== "general" && (
                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-semibold">
                        {ENTITY_OPTIONS.find(o => o.value === file.entityType)?.label ?? file.entityType}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    {isEditing ? (
                      <div className="space-y-2 mb-2">
                        <input value={editLabel} onChange={e => setEditLabel(e.target.value)} placeholder={`${t('label')}...`}
                          className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-foreground text-xs outline-none" />
                        <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder={`${t('description')}...`}
                          rows={2} className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-foreground text-xs outline-none resize-none" />

                        {/* Tags editor */}
                        <div>
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            {editTags.map(t => (
                              <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 text-[10px] font-semibold">
                                {t}
                                <button onClick={() => removeTag(t)} className="hover:text-red-500 cursor-pointer bg-transparent border-none p-0 text-inherit">
                                  <X size={10} />
                                </button>
                              </span>
                            ))}
                          </div>
                          <div className="flex gap-1">
                            <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="New tag..."
                              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                              className="flex-1 px-2 py-1 rounded-md border border-border bg-background text-foreground text-[11px] outline-none" />
                            <button onClick={addTag}
                              className="px-2 py-1 rounded-md bg-indigo-500/10 text-indigo-500 text-[11px] cursor-pointer border border-indigo-500/20 hover:bg-indigo-500/20">
                              <Plus size={12} />
                            </button>
                          </div>
                        </div>

                        <div className="flex gap-1.5">
                          <button onClick={saveEdit} disabled={saving}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium cursor-pointer border-none disabled:opacity-60">
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
                          </button>
                          <button onClick={() => setEditingId(null)}
                            className="px-2 py-1.5 rounded-md bg-neutral-200 dark:bg-neutral-700 text-foreground text-xs cursor-pointer border-none">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs font-medium text-foreground truncate mb-0.5" title={file.label || file.originalName}>
                          {file.label || file.originalName}
                        </p>
                        {file.description && <p className="text-[11px] text-muted-foreground truncate mb-1">{file.description}</p>}
                        {file.tags?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            {file.tags.map(t => (
                              <span key={t} className="px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 text-[9px] font-semibold">{t}</span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] text-muted-foreground">{fmtBytes(file.sizeBytes)}</span>
                          <span className="text-[11px] text-muted-foreground">{fmtDate(file.createdAt)}</span>
                        </div>
                        <div onClick={() => copyUrl(file)}
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-neutral-100 dark:bg-neutral-800 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors mb-2">
                          {copiedId === file.id ? <Check size={12} className="text-emerald-500 shrink-0" /> : <Copy size={12} className="text-muted-foreground shrink-0" />}
                          <span className="text-[10px] text-muted-foreground truncate select-all">{mediaUrl(file.url)}</span>
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => startEdit(file)}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 text-xs font-medium cursor-pointer hover:bg-indigo-500/20 transition-colors">
                            <Pencil size={12} /> Edit
                          </button>
                          <button onClick={() => handleDelete(file.id)}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-medium cursor-pointer hover:bg-red-500/20 transition-colors">
                            <Trash2 size={12} /> Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setPreviewFile(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh] bg-card rounded-xl border border-border overflow-hidden" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPreviewFile(null)}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/50 border-none text-white cursor-pointer flex items-center justify-center hover:bg-black/70 transition-colors">
              <X size={16} />
            </button>
            <img src={mediaUrl(previewFile.url)} alt={previewFile.label || previewFile.originalName}
              className="max-w-[85vw] max-h-[75vh] object-contain block"
              onError={e => { (e.target as HTMLImageElement).alt = "Could not load image"; }} />
            <div className="p-4 border-t border-border">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{previewFile.label || previewFile.originalName}</p>
                  {previewFile.description && <p className="text-xs text-muted-foreground truncate">{previewFile.description}</p>}
                  <p className="text-xs text-muted-foreground">{fmtBytes(previewFile.sizeBytes)} — {fmtDate(previewFile.createdAt)}</p>
                </div>
                <button onClick={() => copyUrl(previewFile)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white border-none cursor-pointer text-sm font-medium shrink-0 hover:bg-indigo-700 transition-colors">
                  {copiedId === previewFile.id ? <Check size={14} /> : <Copy size={14} />} {t('copyUrl')}
                </button>
              </div>
              {previewFile.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {previewFile.tags.map(t => (
                    <span key={t} className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 text-[11px] font-semibold">{t}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
