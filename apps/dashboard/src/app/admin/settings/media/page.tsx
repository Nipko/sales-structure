"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  ImageIcon,
  Trash2,
  Copy,
  Check,
  X,
  Loader2,
  Building2,
  ZoomIn,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MediaFile {
  id: string;
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
  entityType?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function buildFullUrl(relativeUrl: string): string {
  const base =
    process.env.NEXT_PUBLIC_API_URL?.replace("/api/v1", "") ?? "";
  return `${base}${relativeUrl}`;
}

const ENTITY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "product", label: "Producto" },
  { value: "course", label: "Curso" },
];

const inputCls =
  "w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border";
const labelCls =
  "block text-xs font-semibold text-muted-foreground mb-1";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MediaBankPage() {
  const { user } = useAuth();
  const { activeTenantId } = useTenant();
  const tenantId = activeTenantId || user?.tenantId || "";

  // --- State ---
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [entityType, setEntityType] = useState("general");
  const [filterType, setFilterType] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const [dragging, setDragging] = useState(false);

  // Logo
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // --- Toast ---
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // --- Load media list ---
  const loadMedia = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await api.getMediaList(tenantId, filterType || undefined);
      if (res.success && Array.isArray(res.data)) {
        setFiles(res.data);
      }
    } catch (err) {
      console.error("Error loading media:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, filterType]);

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  // --- Load logo on mount ---
  useEffect(() => {
    if (!tenantId) return;
    // The logo is fetched alongside the media list; we also check if there's
    // an existing logo by looking for the entity type or a dedicated endpoint.
    // For now, derive from media list.
    (async () => {
      try {
        const res = await api.getMediaList(tenantId, "logo");
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          setLogoUrl(buildFullUrl(res.data[0].url));
        }
      } catch {
        /* ignore */
      }
    })();
  }, [tenantId]);

  // --- Upload file ---
  async function handleFileUpload(file: File) {
    if (!tenantId) return;
    if (!file.type.startsWith("image/")) {
      showToast("Error: Solo se permiten imagenes");
      return;
    }
    if (file.size > MAX_SIZE) {
      showToast("Error: El archivo excede 10 MB");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    // Simulate progress since fetch doesn't provide it
    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => (prev >= 90 ? 90 : prev + 10));
    }, 200);

    try {
      const res = await api.uploadMedia(tenantId, file, entityType);
      clearInterval(progressInterval);
      setUploadProgress(100);
      if (res.success) {
        showToast("Imagen subida correctamente");
        loadMedia();
      } else {
        showToast(`Error: ${res.error || "No se pudo subir la imagen"}`);
      }
    } catch {
      clearInterval(progressInterval);
      showToast("Error: Fallo la conexion");
    } finally {
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
      }, 600);
    }
  }

  // --- Upload logo ---
  async function handleLogoUpload(file: File) {
    if (!tenantId) return;
    if (!file.type.startsWith("image/")) {
      showToast("Error: Solo se permiten imagenes");
      return;
    }
    setLogoUploading(true);
    try {
      const res = await api.uploadLogo(tenantId, file);
      if (res.success && res.data?.url) {
        setLogoUrl(buildFullUrl(res.data.url));
        showToast("Logo actualizado");
      } else {
        showToast(`Error: ${res.error || "No se pudo subir el logo"}`);
      }
    } catch {
      showToast("Error: Fallo la conexion");
    } finally {
      setLogoUploading(false);
    }
  }

  // --- Delete ---
  async function handleDelete(fileId: string) {
    if (!tenantId || !confirm("¿Eliminar esta imagen?")) return;
    try {
      const res = await api.deleteMedia(tenantId, fileId);
      if (res.success) {
        showToast("Imagen eliminada");
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
      } else {
        showToast(`Error: ${res.error || "No se pudo eliminar"}`);
      }
    } catch {
      showToast("Error: Fallo la conexion");
    }
  }

  // --- Copy URL ---
  function copyUrl(file: MediaFile) {
    const url = buildFullUrl(file.url);
    navigator.clipboard.writeText(url);
    setCopiedId(file.id);
    showToast("URL copiada al portapapeles");
    setTimeout(() => setCopiedId(null), 2000);
  }

  // --- Drag & drop ---
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileUpload(droppedFile);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed top-6 right-6 z-[9999] text-white px-6 py-3 rounded-[10px] text-sm font-semibold shadow-lg transition-all",
            toast.includes("Error") ? "bg-destructive" : "bg-[var(--success)]"
          )}
        >
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <Link
          href="/admin/settings"
          className="w-9 h-9 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center">
            <ImageIcon size={22} className="text-primary" />
          </div>
          <div>
            <h1 className="text-[22px] font-bold text-foreground m-0">
              Banco de Imagenes
            </h1>
            <p className="text-[13px] text-muted-foreground m-0">
              Gestiona el logo de tu empresa y las imagenes de tu cuenta
            </p>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* Logo section                                                       */}
      {/* ================================================================= */}
      <div className="bg-card rounded-[14px] border border-border p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Building2 size={18} className="text-primary" />
          <h2 className="text-base font-bold text-foreground m-0">
            Logo de la Empresa
          </h2>
        </div>

        <div className="flex items-center gap-6">
          {/* Preview */}
          <div className="w-24 h-24 rounded-xl border-2 border-dashed border-border bg-background flex items-center justify-center overflow-hidden shrink-0">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Logo"
                className="w-full h-full object-contain"
              />
            ) : (
              <Building2
                size={32}
                className="text-muted-foreground opacity-40"
              />
            )}
          </div>

          <div className="flex-1">
            <p className="text-sm text-muted-foreground mb-3">
              Este logo se usara en plantillas de correo y documentos.
            </p>
            <input
              ref={logoInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleLogoUpload(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => logoInputRef.current?.click()}
              disabled={logoUploading}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold transition-opacity",
                logoUploading && "opacity-60 cursor-not-allowed"
              )}
            >
              {logoUploading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Upload size={16} />
              )}
              {logoUploading ? "Subiendo..." : "Subir Logo"}
            </button>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* Upload section                                                     */}
      {/* ================================================================= */}
      <div className="bg-card rounded-[14px] border border-border p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Upload size={18} className="text-primary" />
            <h2 className="text-base font-bold text-foreground m-0">
              Subir Imagen
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <label className={labelCls}>Tipo:</label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className={cn(inputCls, "w-[140px]")}
            >
              {ENTITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={cn(
            "relative border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer transition-colors",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 bg-background"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileUpload(f);
              e.target.value = "";
            }}
          />

          {uploading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={32} className="text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">
                Subiendo... {uploadProgress}%
              </p>
              <div className="w-48 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <Upload
                size={32}
                className="text-muted-foreground opacity-50 mb-2"
              />
              <p className="text-sm text-foreground font-medium mb-1">
                Arrastra una imagen aqui o haz clic para seleccionar
              </p>
              <p className="text-xs text-muted-foreground">
                JPG, PNG, WebP o GIF — Maximo 10 MB
              </p>
            </>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* Gallery                                                            */}
      {/* ================================================================= */}
      <div className="bg-card rounded-[14px] border border-border p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <ImageIcon size={18} className="text-primary" />
            <h2 className="text-base font-bold text-foreground m-0">
              Galeria
            </h2>
            <span className="text-xs text-muted-foreground">
              ({files.length} {files.length === 1 ? "imagen" : "imagenes"})
            </span>
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className={cn(inputCls, "w-[160px]")}
          >
            <option value="">Todos los tipos</option>
            {ENTITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-12 text-center text-muted-foreground">
            <Loader2
              size={28}
              className="animate-spin mx-auto mb-2 opacity-60"
            />
            <p className="text-sm">Cargando imagenes...</p>
          </div>
        ) : files.length === 0 ? (
          <div className="p-12 text-center">
            <ImageIcon
              size={40}
              className="text-muted-foreground opacity-30 mx-auto mb-3"
            />
            <p className="text-sm text-muted-foreground">
              No hay imagenes en tu banco. Sube tu primera imagen arriba.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {files.map((file) => {
              const fullUrl = buildFullUrl(file.url);
              return (
                <div
                  key={file.id}
                  className="bg-background rounded-xl border border-border overflow-hidden group"
                >
                  {/* Thumbnail */}
                  <div
                    className="relative aspect-square bg-muted cursor-pointer overflow-hidden"
                    onClick={() => setPreviewFile(file)}
                  >
                    <img
                      src={fullUrl}
                      alt={file.originalName}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                      <ZoomIn
                        size={24}
                        className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      />
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    <p
                      className="text-xs font-medium text-foreground truncate mb-1"
                      title={file.originalName}
                    >
                      {file.originalName}
                    </p>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] text-muted-foreground">
                        {formatBytes(file.size)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(file.createdAt)}
                      </span>
                    </div>

                    {file.entityType && (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold mb-2">
                        {
                          ENTITY_OPTIONS.find(
                            (o) => o.value === file.entityType
                          )?.label ?? file.entityType
                        }
                      </span>
                    )}

                    {/* URL copy */}
                    <div
                      onClick={() => copyUrl(file)}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted cursor-pointer hover:bg-muted/80 transition-colors mb-2"
                    >
                      {copiedId === file.id ? (
                        <Check size={12} className="text-[var(--success)] shrink-0" />
                      ) : (
                        <Copy size={12} className="text-muted-foreground shrink-0" />
                      )}
                      <span className="text-[10px] text-muted-foreground truncate select-all">
                        {fullUrl}
                      </span>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(file.id)}
                      className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium cursor-pointer hover:bg-destructive/20 transition-colors"
                    >
                      <Trash2 size={12} />
                      Eliminar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* Full-size preview modal                                            */}
      {/* ================================================================= */}
      {previewFile && (
        <div
          className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] bg-card rounded-2xl border border-border overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewFile(null)}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/50 border-none text-white cursor-pointer flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              <X size={16} />
            </button>

            <img
              src={buildFullUrl(previewFile.url)}
              alt={previewFile.originalName}
              className="max-w-[85vw] max-h-[80vh] object-contain"
            />

            <div className="p-4 border-t border-border flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {previewFile.originalName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(previewFile.size)} —{" "}
                  {formatDate(previewFile.createdAt)}
                </p>
              </div>
              <button
                onClick={() => copyUrl(previewFile)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white border-none cursor-pointer text-sm font-medium"
              >
                {copiedId === previewFile.id ? (
                  <Check size={14} />
                ) : (
                  <Copy size={14} />
                )}
                Copiar URL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
