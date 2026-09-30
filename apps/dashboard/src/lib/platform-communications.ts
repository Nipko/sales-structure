export type CommunicationLanguage = "es" | "en" | "pt" | "fr";

export interface CommunicationContent {
  subject: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export interface CommunicationDraft {
  name: string;
  audience: "all" | "whatsapp_connected";
  recipientRole: "all" | "admins";
  tenantIds?: string[];
  content: Partial<Record<CommunicationLanguage, CommunicationContent>> & { es: CommunicationContent };
}

export type CommunicationRecipientStatus = "pending" | "processing" | "accepted" | "failed" | "unknown" | "skipped";

export interface PlatformCommunication extends CommunicationDraft {
  id: string;
  status: "draft" | "ready" | "queued" | "sending" | "completed";
  revision: number;
  previewVersion: string | null;
  createdAt: string;
  updatedAt: string;
  previewedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  updatedBy: string;
  sentBy: string | null;
  counters: Record<CommunicationRecipientStatus | "total", number>;
}

export interface CommunicationRecipient {
  id: string;
  tenantId: string;
  tenantName: string;
  email: string;
  name: string;
  language: CommunicationLanguage;
  status: CommunicationRecipientStatus;
  errorCode: string | null;
  attempts: number;
}

export interface CommunicationPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
