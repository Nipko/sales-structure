import { createHash, randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
    authorizesEffect,
    normalizeCustomerIntent,
} from '../../common/conversation/intent-normalizer';
import {
    MEDIA_AI_CONSENT_VERSION,
    type MediaAiConsentAttestation,
    type MediaAiOperation,
    type MediaRetentionAttestation,
} from './media-ai-governance.policy';

const CONSENT_TTL_MS = 15 * 60_000;
const CONSENT_LIFETIME_MS = 365 * 24 * 60 * 60_000;
const EPHEMERAL_RETENTION_MS = 60 * 60_000;
const MEDIA_AI_SCOPE = 'media.ai';

interface PendingMediaConsent {
    version: 1;
    requestId: string;
    tenantId: string;
    contactId: string;
    conversationId: string;
    channel: string;
    purposes: MediaAiOperation[];
    policyId: string;
    policyTitle: string;
    policyVersion: number;
    legalTextHash: string;
    issuedAt: string;
    expiresAt: string;
}

export interface MediaConsentResolution {
    consent: MediaAiConsentAttestation;
    retention: MediaRetentionAttestation;
}

export interface MediaConsentRequest {
    available: boolean;
    message: string;
    reason: 'consent_required' | 'privacy_policy_missing';
}

export interface MediaConsentReply {
    handled: boolean;
    message?: string;
}

const COPY: Record<string, {
    request: (kind: string, policy: string, url: string) => string;
    missing: string;
    granted: string;
    declined: string;
    clarify: string;
}> = {
    es: {
        request: (kind, policy, url) => `Para analizar ${kind} con IA necesito tu autorización para ese uso. Puedes leer la política “${policy}” aquí: ${url}. Responde “sí, autorizo” si aceptas o “no” si prefieres que no la procese.`,
        missing: 'Recibí el archivo, pero el negocio aún no tiene una política de privacidad activa para autorizar su análisis con IA. Puedes escribir lo que necesitas.',
        granted: 'Autorización registrada. Por privacidad no conservé el archivo anterior; envíalo de nuevo y podré analizarlo.',
        declined: 'Entendido. No analizaré el archivo con IA. Puedes escribir lo que necesitas.',
        clarify: 'Necesito una respuesta clara para procesar archivos con IA: “sí, autorizo” o “no”.',
    },
    en: {
        request: (kind, policy, url) => `To analyze ${kind} with AI, I need your authorization for that use. You can read “${policy}” here: ${url}. Reply “yes, I confirm” if you agree, or “no” if you prefer that I do not process it.`,
        missing: 'I received the file, but the business does not yet have an active privacy policy that can authorize AI analysis. You can type what you need.',
        granted: 'Authorization recorded. For privacy, I did not keep the previous file; send it again and I can analyze it.',
        declined: 'Understood. I will not analyze the file with AI. You can type what you need.',
        clarify: 'I need a clear answer to process files with AI: “yes, I confirm” or “no”.',
    },
    pt: {
        request: (kind, policy, url) => `Para analisar ${kind} com IA, preciso da sua autorização para esse uso. Você pode ler “${policy}” aqui: ${url}. Responda “sim, confirmo” se concordar ou “não” se preferir que eu não processe.`,
        missing: 'Recebi o arquivo, mas o negócio ainda não tem uma política de privacidade ativa que autorize a análise com IA. Você pode escrever o que precisa.',
        granted: 'Autorização registrada. Por privacidade, não guardei o arquivo anterior; envie-o novamente e poderei analisá-lo.',
        declined: 'Entendido. Não analisarei o arquivo com IA. Você pode escrever o que precisa.',
        clarify: 'Preciso de uma resposta clara para processar arquivos com IA: “sim, confirmo” ou “não”.',
    },
    fr: {
        request: (kind, policy, url) => `Pour analyser ${kind} avec l’IA, j’ai besoin de votre autorisation pour cet usage. Vous pouvez lire « ${policy} » ici : ${url}. Répondez « oui, je confirme » si vous acceptez, ou « non » si vous préférez que je ne le traite pas.`,
        missing: 'J’ai reçu le fichier, mais l’entreprise n’a pas encore de politique de confidentialité active permettant son analyse par IA. Vous pouvez écrire votre demande.',
        granted: 'Autorisation enregistrée. Pour protéger votre vie privée, je n’ai pas conservé le fichier précédent ; envoyez-le à nouveau et je pourrai l’analyser.',
        declined: 'Compris. Je n’analyserai pas le fichier avec l’IA. Vous pouvez écrire votre demande.',
        clarify: 'J’ai besoin d’une réponse claire pour traiter les fichiers avec l’IA : « oui, je confirme » ou « non ».',
    },
};

function languageCopy(language?: string) {
    return COPY[String(language || 'es').slice(0, 2).toLowerCase()] || COPY.es;
}

function privacyUrl(slug: string): string {
    const configured = String(process.env.API_PUBLIC_URL || 'https://api.parallly-chat.cloud/api/v1')
        .replace(/\/+$/, '');
    return `${configured}/policies/public/${encodeURIComponent(slug)}/privacy`;
}

@Injectable()
export class MediaConsentService {
    private readonly logger = new Logger(MediaConsentService.name);

    constructor(
        private readonly prisma: PrismaService,
    ) {}

    async resolve(
        tenantId: string,
        contactId: string,
        operation: MediaAiOperation,
        now = new Date(),
    ): Promise<MediaConsentResolution | null> {
        if (!contactId) return null;
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return null;
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT cr.id, cr.created_at, cr.expires_at, cr.revoked_at,
                    cr.consent_scope, cr.policy_id, cr.policy_version, cr.legal_text_hash,
                    p.content AS policy_content
               FROM consent_records cr
               LEFT JOIN leads l ON l.id = cr.lead_id
               JOIN policies p ON p.id = cr.policy_id
              WHERE COALESCE(cr.contact_id, l.contact_id) = $1::uuid
                AND cr.policy_type = 'privacy'
                AND cr.consent_scope IN ('media.ai', $2)
                AND cr.revoked_at IS NULL
                AND cr.expires_at > $3::timestamptz
                AND p.id = cr.policy_id
                AND p.version = cr.policy_version
                AND p.is_active = true
              ORDER BY cr.created_at DESC
              LIMIT 1`,
            [contactId, `media.${operation}`, now.toISOString()],
        );
        const row = rows[0];
        if (!row || createHash('sha256').update(String(row.policy_content)).digest('hex') !== row.legal_text_hash) {
            return null;
        }
        return {
            consent: {
                version: MEDIA_AI_CONSENT_VERSION,
                proofId: String(row.id),
                subjectId: contactId,
                source: 'verified_consent_registry',
                purposes: [operation],
                grantedAt: new Date(row.created_at).toISOString(),
                expiresAt: new Date(row.expires_at).toISOString(),
            },
            retention: {
                scope: 'source_and_derived',
                mode: 'ephemeral',
                deleteAt: new Date(now.getTime() + EPHEMERAL_RETENTION_MS).toISOString(),
                enforcement: 'in_memory_only',
            },
        };
    }

    async request(
        tenantId: string,
        contactId: string,
        conversationId: string,
        channel: string,
        purposes: readonly MediaAiOperation[],
        language?: string,
    ): Promise<MediaConsentRequest> {
        const copy = languageCopy(language);
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName || !contactId) {
            return { available: false, message: copy.missing, reason: 'privacy_policy_missing' };
        }
        const [policyRows, tenant] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, title, content, version
                   FROM policies
                  WHERE type = 'privacy' AND is_active = true
                  LIMIT 1`,
            ),
            this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }),
        ]);
        const policy = policyRows[0];
        if (!policy || !tenant?.slug) {
            return { available: false, message: copy.missing, reason: 'privacy_policy_missing' };
        }

        const now = new Date();
        const requested = [...new Set(purposes)].sort();
        const pendingRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO media_ai_consent_challenges
                (request_id, contact_id, conversation_id, channel, purposes,
                 policy_id, policy_title, policy_version, legal_text_hash,
                 issued_at, expires_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::text[], $6::uuid, $7, $8, $9,
                     $10::timestamptz, $11::timestamptz)
             ON CONFLICT (conversation_id) WHERE resolved_at IS NULL
             DO UPDATE SET
                contact_id = EXCLUDED.contact_id,
                channel = EXCLUDED.channel,
                purposes = ARRAY(SELECT DISTINCT unnest(media_ai_consent_challenges.purposes || EXCLUDED.purposes)),
                policy_id = EXCLUDED.policy_id,
                policy_title = EXCLUDED.policy_title,
                policy_version = EXCLUDED.policy_version,
                legal_text_hash = EXCLUDED.legal_text_hash,
                issued_at = CASE
                    WHEN media_ai_consent_challenges.expires_at <= NOW()
                      OR media_ai_consent_challenges.policy_id <> EXCLUDED.policy_id
                    THEN EXCLUDED.issued_at ELSE media_ai_consent_challenges.issued_at END,
                expires_at = CASE
                    WHEN media_ai_consent_challenges.expires_at <= NOW()
                      OR media_ai_consent_challenges.policy_id <> EXCLUDED.policy_id
                    THEN EXCLUDED.expires_at ELSE media_ai_consent_challenges.expires_at END
             RETURNING request_id, contact_id, conversation_id, channel, purposes,
                       policy_id, policy_title, policy_version, legal_text_hash,
                       issued_at, expires_at`,
            [
                randomUUID(), contactId, conversationId, String(channel || 'conversation').slice(0, 50),
                requested, String(policy.id), String(policy.title), Number(policy.version),
                createHash('sha256').update(String(policy.content)).digest('hex'),
                now.toISOString(), new Date(now.getTime() + CONSENT_TTL_MS).toISOString(),
            ],
        );
        const row = pendingRows[0];
        if (!row) return { available: false, message: copy.missing, reason: 'privacy_policy_missing' };
        const pending: PendingMediaConsent = {
            version: 1,
            requestId: String(row.request_id),
            tenantId,
            contactId: String(row.contact_id),
            conversationId: String(row.conversation_id),
            channel: String(row.channel),
            purposes: row.purposes as MediaAiOperation[],
            policyId: String(row.policy_id),
            policyTitle: String(row.policy_title),
            policyVersion: Number(row.policy_version),
            legalTextHash: String(row.legal_text_hash),
            issuedAt: new Date(row.issued_at).toISOString(),
            expiresAt: new Date(row.expires_at).toISOString(),
        };
        const kind = requested.includes('audio_transcription') && requested.includes('image_analysis')
            ? (language?.startsWith('en') ? 'the audio and images' : language?.startsWith('pt') ? 'os áudios e as imagens' : language?.startsWith('fr') ? 'les audios et les images' : 'los audios y las imágenes')
            : requested.includes('audio_transcription')
                ? (language?.startsWith('en') ? 'this audio' : language?.startsWith('pt') ? 'este áudio' : language?.startsWith('fr') ? 'cet audio' : 'este audio')
                : (language?.startsWith('en') ? 'this image' : language?.startsWith('pt') ? 'esta imagem' : language?.startsWith('fr') ? 'cette image' : 'esta imagen');
        return {
            available: true,
            message: copy.request(kind, pending.policyTitle, privacyUrl(tenant.slug)),
            reason: 'consent_required',
        };
    }

    async handlePendingReply(
        tenantId: string,
        contactId: string,
        conversationId: string,
        messageText: string,
        language?: string,
    ): Promise<MediaConsentReply> {
        const intent = normalizeCustomerIntent(messageText, { answeringExplicitQuestion: true });
        const copy = languageCopy(language);
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName || !contactId) return { handled: false };
        const disposition = ['reject', 'cancel', 'opt_out'].includes(intent.intent)
            ? 'declined'
            : authorizesEffect(intent, 'high_impact', { answeringExplicitQuestion: true })
                ? 'granted'
                : 'unclear';
        const expiresAt = new Date(Date.now() + CONSENT_LIFETIME_MS).toISOString();
        try {
            const outcome = await this.prisma.transactionInTenantSchema(
                schemaName,
                async query => {
                    const pendingRows = await query<any[]>(
                        `SELECT request_id, contact_id, conversation_id, channel, purposes,
                                policy_id, policy_title, policy_version, legal_text_hash,
                                issued_at, expires_at
                           FROM media_ai_consent_challenges
                          WHERE conversation_id = $1::uuid AND resolved_at IS NULL
                          FOR UPDATE`,
                        [conversationId],
                    );
                    const pending = pendingRows[0];
                    if (!pending || String(pending.contact_id) !== contactId) return 'absent';
                    if (Date.parse(String(pending.expires_at)) <= Date.now()) {
                        await query(
                            `UPDATE media_ai_consent_challenges
                                SET resolved_at = NOW(), resolution = 'expired'
                              WHERE request_id = $1::uuid`,
                            [pending.request_id],
                        );
                        return 'expired';
                    }
                    if (disposition === 'unclear') return 'unclear';
                    if (disposition === 'declined') {
                        await query(
                            `UPDATE media_ai_consent_challenges
                                SET resolved_at = NOW(), resolution = 'declined'
                              WHERE request_id = $1::uuid`,
                            [pending.request_id],
                        );
                        return 'declined';
                    }
                    await query(
                        `INSERT INTO consent_records
                    (contact_id, channel, legal_version, legal_text_hash, policy_id, policy_type,
                     policy_version, consent_scope, conversation_id, capture_mode, expires_at,
                     consent_request_id)
                 VALUES ($1::uuid, $2, $3, $4, $5::uuid, 'privacy', $6, $7, $8::uuid,
                         'signed_media_ai_confirmation', $9::timestamptz, $10::uuid)
                 ON CONFLICT (consent_request_id) WHERE consent_request_id IS NOT NULL
                 DO UPDATE SET consent_request_id = EXCLUDED.consent_request_id
                 RETURNING id`,
                        [
                    contactId, pending.channel, `privacy:v${pending.policy_version}`,
                    pending.legal_text_hash, pending.policy_id, pending.policy_version,
                    MEDIA_AI_SCOPE,
                    conversationId,
                    expiresAt,
                    pending.request_id,
                ],
                    );
                    await query(
                        `UPDATE media_ai_consent_challenges
                            SET resolved_at = NOW(), resolution = 'granted'
                          WHERE request_id = $1::uuid`,
                        [pending.request_id],
                    );
                    return 'granted';
                },
            );
            if (outcome === 'absent' || outcome === 'expired') return { handled: false };
            if (outcome === 'declined') return { handled: true, message: copy.declined };
            if (outcome === 'unclear') return { handled: true, message: copy.clarify };
            return { handled: true, message: copy.granted };
        } catch (error: any) {
            this.logger.warn(`Failed to record media consent for ${conversationId}: ${error?.message}`);
            return { handled: true, message: copy.clarify };
        }
    }
}
