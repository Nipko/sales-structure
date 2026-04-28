import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import OpenAI from 'openai';

const STATUSES = ['open', 'under_review', 'planned', 'in_progress', 'shipped', 'declined'] as const;
type Status = (typeof STATUSES)[number];

const CATEGORIES = ['ai', 'integrations', 'analytics', 'crm', 'billing', 'ux', 'other'];

// Conversational hints that suggest the user wants a feature we don't have.
// Cheap regex first to avoid running an LLM on every message — we only embed
// matches and cluster them.
const SIGNAL_PATTERNS = [
    /\bojal[áa] (pudiera|pud[ií]eras|tuviera|hubiera)\b/i,
    /\b(deber[íi]as?|deber[íi]an) (poder|tener|agregar|incluir|permitir)\b/i,
    /\bme gustar[ií]a (poder|tener|que)\b/i,
    /\bser[íi]a (genial|buen[oa]|útil|util) (que|si|poder)\b/i,
    /\b(podr[íi]as?|pueden) (agregar|añadir|incluir|sumar|integrar)\b/i,
    /\bfaltar[íi]a\b/i,
    /\bno (puedo|se puede) (ver|hacer|configurar|exportar|enviar)\b.{0,80}\b(quisiera|necesito|esper[oa]ba)\b/i,
    /\b(would be (nice|great|awesome) (to|if))\b/i,
    /\b(can you (add|support|integrate))\b/i,
    /\b(it would help (if|to))\b/i,
    /\b(missing|lacks) (a|the) /i,
];

// Plan weights — represent what each tenant pays. Used as base; multiplied by
// MRR-tenure multiplier so a long-time starter customer can outweigh a brand
// new enterprise. See computeWeightedScore() for the full formula.
const PLAN_BASE_WEIGHT: Record<string, number> = {
    starter: 1.0,
    pro: 2.5,
    enterprise: 5.0,
    custom: 8.0,
};

@Injectable()
export class FeatureRequestsService {
    private readonly logger = new Logger(FeatureRequestsService.name);
    private readonly openai: OpenAI;

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
        private readonly email: EmailService,
    ) {
        this.openai = new OpenAI({
            apiKey: this.config.get<string>('OPENAI_API_KEY') || '',
        });
    }

    async list(filters: { status?: string; category?: string; search?: string; sort?: string; userId?: string }) {
        const where: string[] = ['fr.merged_into_id IS NULL'];
        const params: any[] = [];

        if (filters.status && STATUSES.includes(filters.status as Status)) {
            params.push(filters.status);
            where.push(`fr.status = $${params.length}`);
        }
        if (filters.category) {
            params.push(filters.category);
            where.push(`fr.category = $${params.length}`);
        }
        if (filters.search) {
            params.push(`%${filters.search}%`);
            where.push(`(fr.title ILIKE $${params.length} OR fr.description ILIKE $${params.length})`);
        }

        const orderBy =
            filters.sort === 'recent'
                ? 'fr.created_at DESC'
                : filters.sort === 'top'
                  ? 'fr.vote_count DESC, fr.weighted_score DESC'
                  : 'fr.weighted_score DESC, fr.vote_count DESC';

        const userVoteJoin = filters.userId
            ? `LEFT JOIN feature_request_votes uv ON uv.request_id = fr.id AND uv.user_id = $${params.length + 1}::uuid`
            : '';
        if (filters.userId) params.push(filters.userId);
        const userVotedSelect = filters.userId ? `, uv.id IS NOT NULL AS user_voted` : `, false AS user_voted`;

        const sql = `
            SELECT fr.id, fr.title, fr.description, fr.status, fr.category,
                   fr.author_user_id, fr.author_tenant_id,
                   fr.vote_count, fr.weighted_score, fr.comment_count,
                   fr.shipped_at, fr.created_at, fr.updated_at,
                   t.name AS author_tenant_name,
                   u.first_name || ' ' || u.last_name AS author_name
                   ${userVotedSelect}
            FROM feature_requests fr
            LEFT JOIN tenants t ON t.id = fr.author_tenant_id
            LEFT JOIN users u ON u.id = fr.author_user_id
            ${userVoteJoin}
            WHERE ${where.join(' AND ')}
            ORDER BY ${orderBy}
            LIMIT 200
        `;
        return this.prisma.$queryRawUnsafe(sql, ...params);
    }

    async changelog() {
        // Group shipped features by year-month so the dashboard can render a timeline.
        const sql = `
            SELECT id, title, description, category, shipped_at, vote_count,
                   to_char(shipped_at, 'YYYY-MM') AS month
            FROM feature_requests
            WHERE status = 'shipped' AND shipped_at IS NOT NULL AND merged_into_id IS NULL
            ORDER BY shipped_at DESC
            LIMIT 200
        `;
        return this.prisma.$queryRawUnsafe(sql);
    }

    async getById(id: string, userId?: string) {
        const params: any[] = [id];
        const userVoteJoin = userId
            ? `LEFT JOIN feature_request_votes uv ON uv.request_id = fr.id AND uv.user_id = $2::uuid`
            : '';
        const userVotedSelect = userId ? `, uv.id IS NOT NULL AS user_voted` : `, false AS user_voted`;
        if (userId) params.push(userId);

        const sql = `
            SELECT fr.*, t.name AS author_tenant_name,
                   u.first_name || ' ' || u.last_name AS author_name
                   ${userVotedSelect}
            FROM feature_requests fr
            LEFT JOIN tenants t ON t.id = fr.author_tenant_id
            LEFT JOIN users u ON u.id = fr.author_user_id
            ${userVoteJoin}
            WHERE fr.id = $1::uuid
            LIMIT 1
        `;
        const rows = (await this.prisma.$queryRawUnsafe(sql, ...params)) as any[];
        if (rows.length === 0) throw new NotFoundException('Feature request not found');
        return rows[0];
    }

    async create(input: { title: string; description: string; category?: string; userId: string; tenantId?: string }) {
        if (!input.title?.trim() || !input.description?.trim()) {
            throw new BadRequestException('Title and description required');
        }
        if (input.category && !CATEGORIES.includes(input.category)) {
            throw new BadRequestException('Invalid category');
        }

        const embedding = await this.embed(`${input.title}\n${input.description}`);
        const embeddingLiteral = embedding ? `[${embedding.join(',')}]` : null;

        const sql = `
            INSERT INTO feature_requests (title, description, category, author_user_id, author_tenant_id, embedding)
            VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6::vector)
            RETURNING id
        `;
        const rows = (await this.prisma.$queryRawUnsafe(
            sql,
            input.title.trim(),
            input.description.trim(),
            input.category ?? null,
            input.userId,
            input.tenantId ?? null,
            embeddingLiteral,
        )) as any[];

        const requestId = rows[0].id;
        // Author auto-votes and auto-subscribes.
        await this.vote(requestId, input.userId, input.tenantId);
        await this.subscribe(requestId, input.userId);
        return this.getById(requestId, input.userId);
    }

    // Real-time duplicate suggestions while user types. Returns top similar
    // open/under_review requests via cosine distance on embeddings.
    async findSimilar(text: string, limit = 5): Promise<any[]> {
        if (!text?.trim() || text.trim().length < 8) return [];
        const embedding = await this.embed(text);
        if (!embedding) return [];
        const literal = `[${embedding.join(',')}]`;
        const sql = `
            SELECT id, title, status, vote_count, comment_count,
                   1 - (embedding <=> $1::vector) AS similarity
            FROM feature_requests
            WHERE embedding IS NOT NULL
              AND merged_into_id IS NULL
              AND status NOT IN ('declined')
            ORDER BY embedding <=> $1::vector
            LIMIT $2
        `;
        const rows = (await this.prisma.$queryRawUnsafe(sql, literal, limit)) as any[];
        // Only return matches above similarity threshold so we do not flag every request.
        return rows.filter((r) => Number(r.similarity) >= 0.78);
    }

    async vote(requestId: string, userId: string, tenantId?: string) {
        // Idempotent: ignore conflict.
        await this.prisma.$queryRawUnsafe(
            `INSERT INTO feature_request_votes (request_id, user_id, tenant_id)
             VALUES ($1::uuid, $2::uuid, $3::uuid)
             ON CONFLICT (request_id, user_id) DO NOTHING`,
            requestId,
            userId,
            tenantId ?? null,
        );
        await this.refreshVoteCount(requestId);
        await this.subscribe(requestId, userId);
        return { ok: true };
    }

    async unvote(requestId: string, userId: string) {
        await this.prisma.$queryRawUnsafe(
            `DELETE FROM feature_request_votes WHERE request_id = $1::uuid AND user_id = $2::uuid`,
            requestId,
            userId,
        );
        await this.refreshVoteCount(requestId);
        return { ok: true };
    }

    async comment(requestId: string, userId: string, body: string, isAdminReply: boolean, tenantId?: string) {
        if (!body?.trim()) throw new BadRequestException('Empty comment');
        await this.prisma.$queryRawUnsafe(
            `INSERT INTO feature_request_comments (request_id, user_id, tenant_id, body, is_admin_reply)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)`,
            requestId,
            userId,
            tenantId ?? null,
            body.trim(),
            isAdminReply,
        );
        await this.prisma.$queryRawUnsafe(
            `UPDATE feature_requests SET comment_count = (
                SELECT COUNT(*) FROM feature_request_comments WHERE request_id = $1::uuid
             ), updated_at = NOW() WHERE id = $1::uuid`,
            requestId,
        );
        await this.subscribe(requestId, userId);
        return { ok: true };
    }

    async listComments(requestId: string) {
        const sql = `
            SELECT c.id, c.body, c.is_admin_reply, c.created_at,
                   c.user_id, u.first_name || ' ' || u.last_name AS author_name,
                   u.role AS author_role
            FROM feature_request_comments c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE c.request_id = $1::uuid
            ORDER BY c.created_at ASC
        `;
        return this.prisma.$queryRawUnsafe(sql, requestId);
    }

    async updateStatus(requestId: string, status: string, declinedReason?: string) {
        if (!STATUSES.includes(status as Status)) throw new BadRequestException('Invalid status');
        const shippedAt = status === 'shipped' ? new Date() : null;
        await this.prisma.$queryRawUnsafe(
            `UPDATE feature_requests
             SET status = $1, shipped_at = COALESCE($2::timestamp, shipped_at),
                 declined_reason = $3, updated_at = NOW()
             WHERE id = $4::uuid`,
            status,
            shippedAt,
            declinedReason ?? null,
            requestId,
        );
        // Fire-and-forget: notify subscribers of status change.
        this.notifySubscribersStatus(requestId, status, declinedReason).catch((e) =>
            this.logger.warn(`notifySubscribersStatus failed: ${e.message}`),
        );
        return { ok: true };
    }

    private async notifySubscribersStatus(requestId: string, status: string, declinedReason?: string) {
        const reqRows = (await this.prisma.$queryRawUnsafe(
            `SELECT id, title FROM feature_requests WHERE id = $1::uuid LIMIT 1`,
            requestId,
        )) as any[];
        if (reqRows.length === 0) return;
        const req = reqRows[0];

        const subscribers = (await this.prisma.$queryRawUnsafe(
            `SELECT u.email, u.first_name
             FROM feature_request_subscribers s
             INNER JOIN users u ON u.id = s.user_id
             WHERE s.request_id = $1::uuid AND u.email IS NOT NULL AND u.is_active = true`,
            requestId,
        )) as any[];

        if (subscribers.length === 0) return;

        const url = `${this.config.get<string>('DASHBOARD_URL', 'https://admin.parallly-chat.cloud')}/admin/feature-requests`;
        const statusLabel: Record<string, string> = {
            under_review: 'En revisión',
            planned: 'Planeada',
            in_progress: 'En desarrollo',
            shipped: 'Lanzada',
            declined: 'Rechazada',
            open: 'Abierta',
        };
        const subject = `[Parallly] "${req.title}" — ${statusLabel[status] ?? status}`;
        const declined =
            status === 'declined' && declinedReason
                ? `<p style="margin:16px 0;color:#666">${declinedReason}</p>`
                : '';
        const html = `
            <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222">
                <h2 style="font-size:18px;margin:0 0 8px">Tu sugerencia cambió de estado</h2>
                <p style="margin:0 0 16px">"<strong>${req.title}</strong>" ahora está marcada como <strong>${statusLabel[status] ?? status}</strong>.</p>
                ${declined}
                <a href="${url}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Ver sugerencia</a>
                <p style="font-size:12px;color:#999;margin-top:24px">Recibes este email porque votaste o comentaste esta sugerencia.</p>
            </div>
        `;

        // Send sequentially to avoid SMTP rate-limits — small lists in practice.
        for (const sub of subscribers) {
            await this.email.send({ to: sub.email, subject, html });
        }
        this.logger.log(`Notified ${subscribers.length} subscribers of "${req.title}" → ${status}`);
    }

    async merge(sourceId: string, targetId: string) {
        if (sourceId === targetId) throw new BadRequestException('Cannot merge a request into itself');
        // Move votes to target (ignore conflicts since same user may have voted both).
        await this.prisma.$queryRawUnsafe(
            `INSERT INTO feature_request_votes (request_id, user_id, tenant_id)
             SELECT $2::uuid, user_id, tenant_id FROM feature_request_votes WHERE request_id = $1::uuid
             ON CONFLICT (request_id, user_id) DO NOTHING`,
            sourceId,
            targetId,
        );
        // Reassign comments.
        await this.prisma.$queryRawUnsafe(
            `UPDATE feature_request_comments SET request_id = $2::uuid WHERE request_id = $1::uuid`,
            sourceId,
            targetId,
        );
        // Delete source votes (already transferred) and mark source as merged.
        await this.prisma.$queryRawUnsafe(
            `DELETE FROM feature_request_votes WHERE request_id = $1::uuid`,
            sourceId,
        );
        await this.prisma.$queryRawUnsafe(
            `UPDATE feature_requests SET merged_into_id = $2::uuid, updated_at = NOW() WHERE id = $1::uuid`,
            sourceId,
            targetId,
        );
        await this.refreshVoteCount(targetId);
        return { ok: true };
    }

    private async subscribe(requestId: string, userId: string) {
        await this.prisma.$queryRawUnsafe(
            `INSERT INTO feature_request_subscribers (request_id, user_id)
             VALUES ($1::uuid, $2::uuid)
             ON CONFLICT (request_id, user_id) DO NOTHING`,
            requestId,
            userId,
        );
    }

    private async refreshVoteCount(requestId: string) {
        await this.prisma.$queryRawUnsafe(
            `UPDATE feature_requests SET vote_count = (
                SELECT COUNT(*) FROM feature_request_votes WHERE request_id = $1::uuid
             ), updated_at = NOW() WHERE id = $1::uuid`,
            requestId,
        );
    }

    private async embed(text: string): Promise<number[] | null> {
        try {
            const r = await this.openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: text.slice(0, 8000),
            });
            return r.data[0].embedding;
        } catch (e: any) {
            this.logger.warn(`Embedding failed: ${e.message}`);
            return null;
        }
    }

    /**
     * Nightly recompute of weighted_score for every active request.
     *
     * Score = (Σ vote_weight) × recency_factor × engagement_bonus
     *   vote_weight per voter = plan_base × MRR_tenure_multiplier
     *     - plan_base from PLAN_BASE_WEIGHT
     *     - MRR_tenure_multiplier = 1 + min(months_paying / 24, 0.5) → up to +50%
     *   recency_factor = 1 / (1 + days_since_creation / 90) → 90-day half-life-ish
     *   engagement_bonus = 1 + min(comment_count / 10, 0.3) → up to +30%
     */
    @Cron(CronExpression.EVERY_DAY_AT_3AM)
    async recomputeRanking() {
        this.logger.log('Recomputing feature request weighted scores…');
        const requests = (await this.prisma.$queryRawUnsafe(
            `SELECT id, comment_count, created_at FROM feature_requests
             WHERE merged_into_id IS NULL AND status NOT IN ('shipped', 'declined')`,
        )) as any[];

        for (const r of requests) {
            const voters = (await this.prisma.$queryRawUnsafe(
                `SELECT v.tenant_id, t.plan,
                        EXTRACT(EPOCH FROM (NOW() - COALESCE(bs.created_at, t.created_at))) / 2629800.0 AS months_paying
                 FROM feature_request_votes v
                 LEFT JOIN tenants t ON t.id = v.tenant_id
                 LEFT JOIN billing_subscriptions bs ON bs.tenant_id = v.tenant_id
                 WHERE v.request_id = $1::uuid`,
                r.id,
            )) as any[];

            let voteWeightSum = 0;
            for (const v of voters) {
                const planBase = PLAN_BASE_WEIGHT[v.plan ?? 'starter'] ?? 1.0;
                const months = Math.max(0, Number(v.months_paying ?? 0));
                const tenureMult = 1 + Math.min(months / 24, 0.5);
                voteWeightSum += planBase * tenureMult;
            }

            const ageDays = (Date.now() - new Date(r.created_at).getTime()) / 86_400_000;
            const recencyFactor = 1 / (1 + ageDays / 90);
            const engagementBonus = 1 + Math.min(Number(r.comment_count ?? 0) / 10, 0.3);
            const score = voteWeightSum * recencyFactor * engagementBonus;

            await this.prisma.$queryRawUnsafe(
                `UPDATE feature_requests SET weighted_score = $1 WHERE id = $2::uuid`,
                score,
                r.id,
            );
        }
        this.logger.log(`Recomputed ${requests.length} feature requests.`);
    }

    /**
     * Nightly extraction of implicit feature signals from tenant conversations.
     *
     * Strategy (cheap by design):
     *  1. Iterate tenant schemas, scan messages from the last 24h via cheap regex.
     *  2. For each match, embed the message and search the existing feature_requests
     *     board for a similar one. If similarity >= 0.78, +1 to that request's
     *     weighted_score directly (does NOT inflate raw vote_count — keeps signal
     *     transparent vs. real votes).
     *  3. If no match, hold the candidate in memory. After scanning all tenants,
     *     cluster candidates by embedding similarity and create a synthetic
     *     feature_request only for clusters of size >= 3 with a system author tag.
     *
     * No LLM calls per message — only embeddings (cheap). Capped at 50 messages
     * per tenant per night to bound cost.
     */
    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    async extractConversationalSignals() {
        this.logger.log('Extracting implicit feature signals from conversations…');
        const tenants = (await this.prisma.$queryRawUnsafe(
            `SELECT id, schema_name FROM tenants WHERE is_active = true`,
        )) as any[];

        const candidates: Array<{ text: string; embedding: number[]; tenantId: string }> = [];
        let signalsBoosted = 0;

        for (const tenant of tenants) {
            try {
                const messages = (await this.prisma.executeInTenantSchema<any[]>(
                    tenant.schema_name,
                    `SELECT id, content
                     FROM messages
                     WHERE direction = 'inbound'
                       AND created_at > NOW() - INTERVAL '24 hours'
                       AND content IS NOT NULL
                       AND length(content) BETWEEN 20 AND 600
                     ORDER BY created_at DESC
                     LIMIT 200`,
                )) as any[];

                let scanned = 0;
                for (const m of messages) {
                    if (scanned >= 50) break;
                    const matches = SIGNAL_PATTERNS.some((p) => p.test(m.content));
                    if (!matches) continue;
                    scanned++;

                    const embedding = await this.embed(m.content);
                    if (!embedding) continue;
                    const literal = `[${embedding.join(',')}]`;

                    const hits = (await this.prisma.$queryRawUnsafe(
                        `SELECT id, 1 - (embedding <=> $1::vector) AS similarity
                         FROM feature_requests
                         WHERE embedding IS NOT NULL AND merged_into_id IS NULL
                           AND status NOT IN ('declined', 'shipped')
                         ORDER BY embedding <=> $1::vector
                         LIMIT 1`,
                        literal,
                    )) as any[];

                    if (hits.length > 0 && Number(hits[0].similarity) >= 0.78) {
                        // Boost weighted_score by 0.5 — softer than a real vote, fades over time
                        // because nightly recompute uses real votes only as the base.
                        await this.prisma.$queryRawUnsafe(
                            `UPDATE feature_requests
                             SET weighted_score = weighted_score + 0.5, updated_at = NOW()
                             WHERE id = $1::uuid`,
                            hits[0].id,
                        );
                        signalsBoosted++;
                    } else {
                        candidates.push({ text: m.content, embedding, tenantId: tenant.id });
                    }
                }
            } catch (e: any) {
                this.logger.warn(`Tenant ${tenant.id}: ${e.message}`);
            }
        }

        // Cluster candidates: greedy — for each candidate, group it with peers above 0.82 similarity.
        const clusters: Array<{ texts: string[]; embedding: number[]; tenants: Set<string> }> = [];
        for (const c of candidates) {
            let placed = false;
            for (const cluster of clusters) {
                const sim = cosineSim(c.embedding, cluster.embedding);
                if (sim >= 0.82) {
                    cluster.texts.push(c.text);
                    cluster.tenants.add(c.tenantId);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                clusters.push({ texts: [c.text], embedding: c.embedding, tenants: new Set([c.tenantId]) });
            }
        }

        // Promote clusters with >=3 tenants — only multi-tenant signal, avoids per-tenant noise.
        const SYSTEM_USER = await this.getSystemUser();
        let createdCount = 0;
        for (const cluster of clusters) {
            if (cluster.tenants.size < 3 || !SYSTEM_USER) continue;
            const sample = cluster.texts.slice(0, 3).join('\n— ');
            const summary = await this.summarizeSignalCluster(sample);
            if (!summary) continue;

            const literal = `[${cluster.embedding.join(',')}]`;
            await this.prisma.$queryRawUnsafe(
                `INSERT INTO feature_requests (title, description, category, author_user_id, embedding)
                 VALUES ($1, $2, 'other', $3::uuid, $4::vector)`,
                `[Auto] ${summary.title}`,
                `${summary.description}\n\n_Detectado automáticamente en ${cluster.tenants.size} conversaciones de distintos clientes._\n\nMensajes de muestra:\n— ${sample}`,
                SYSTEM_USER,
                literal,
            );
            createdCount++;
        }

        this.logger.log(
            `Signals: boosted ${signalsBoosted} existing requests, created ${createdCount} from ${clusters.length} clusters across ${candidates.length} candidates.`,
        );
    }

    private async getSystemUser(): Promise<string | null> {
        const rows = (await this.prisma.$queryRawUnsafe(
            `SELECT id FROM users WHERE role = 'super_admin' AND is_active = true ORDER BY created_at ASC LIMIT 1`,
        )) as any[];
        return rows[0]?.id ?? null;
    }

    private async summarizeSignalCluster(sampleText: string): Promise<{ title: string; description: string } | null> {
        try {
            const r = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content:
                            'Sos un PM. Te paso 3 frases que distintos clientes dijeron en chat sugiriendo una feature. Devolvé un JSON con {"title": <título corto en español, máx 60 chars>, "description": <descripción 1-2 frases en español>}. NO incluyas markdown, solo JSON puro.',
                    },
                    { role: 'user', content: sampleText },
                ],
                temperature: 0.3,
                response_format: { type: 'json_object' },
            });
            const parsed = JSON.parse(r.choices[0].message.content ?? '{}');
            if (!parsed.title || !parsed.description) return null;
            return parsed;
        } catch (e: any) {
            this.logger.warn(`summarize failed: ${e.message}`);
            return null;
        }
    }
}

function cosineSim(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
