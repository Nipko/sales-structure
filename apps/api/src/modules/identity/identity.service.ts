import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { normalizePhoneE164 } from '../../common/utils/phone.util';

@Injectable()
export class IdentityService {
    private readonly logger = new Logger(IdentityService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    /**
     * Resolve or create a unified customer profile for a contact.
     * A single exact phone match is linked directly under a shared advisory lock.
     * Ambiguous-phone and email-only matches keep separate live profiles and a
     * pending review suggestion; no match creates and links a new profile.
     */
    async resolveOrCreateProfile(
        tenantId: string,
        contact: {
            id: string;
            phone?: string;
            email?: string;
            name?: string;
            channelType: string;
            externalId: string;
            /** False when the caller already proved that a phone is shared. */
            allowPhoneAutoLink?: boolean;
        },
    ): Promise<void> {
        const schemaName = await this.getSchema(tenantId);
        const rawPhone = contact.phone && /^\+?[\d\s()-]{7,20}$/.test(contact.phone) ? contact.phone : null;
        const phoneNorm = rawPhone ? normalizePhoneE164(rawPhone) : null;
        const email = contact.email && contact.email.includes('@') ? contact.email.toLowerCase().trim() : null;
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidPattern.test(contact.id)) {
            this.logger.warn(`[Identity] Ignoring invalid contact id ${contact.id}`);
            return;
        }

        const outcome = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            // All channel adapters converge here. Locking the normalized identity
            // keys prevents two first contacts (for example WhatsApp + a public
            // booking retry) from both observing "no profile" and creating one.
            const lockKeys = [
                `identity:contact:${contact.id}`,
                ...(phoneNorm ? [`identity:phone:${phoneNorm}`] : []),
                ...(email ? [`identity:email:${email}`] : []),
            ].sort();
            for (const key of lockKeys) {
                await query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [key]);
            }

            const contactRows = await query<any[]>(
                `SELECT id FROM contacts WHERE id = $1::uuid LIMIT 1 FOR UPDATE`,
                [contact.id],
            );
            if (!contactRows?.length) return { kind: 'missing' as const, profileId: null };

            // Recheck only after acquiring the locks. A concurrent resolver may
            // have linked this contact while this request waited.
            const existing = await query<any[]>(
                `SELECT customer_profile_id
                   FROM contact_identities
                  WHERE contact_id = $1::uuid
                  LIMIT 1
                  FOR UPDATE`,
                [contact.id],
            );
            if (existing?.length) {
                return { kind: 'existing' as const, profileId: existing[0].customer_profile_id };
            }

            const phoneMatches = phoneNorm
                ? await query<any[]>(
                    `SELECT id, display_name, phone, email
                       FROM customer_profiles
                      WHERE phone IS NOT NULL AND (phone = $1 OR phone = $2)
                      ORDER BY created_at ASC, id ASC
                      LIMIT 2
                      FOR UPDATE`,
                    [phoneNorm, rawPhone],
                )
                : [];

            // A single exact normalized-phone profile is the high-confidence
            // path. Link directly: never manufacture a temporary profile, delete
            // it, and then reference its deleted UUID from merge_suggestions.
            if (contact.allowPhoneAutoLink !== false && phoneMatches.length === 1) {
                const profileId = phoneMatches[0].id;
                await query(
                    `INSERT INTO contact_identities
                        (customer_profile_id, contact_id, channel_type, external_id, is_primary)
                     VALUES ($1::uuid, $2::uuid, $3, $4, false)
                     ON CONFLICT (contact_id) DO NOTHING`,
                    [profileId, contact.id, contact.channelType, contact.externalId],
                );
                await query(
                    `UPDATE customer_profiles
                        SET display_name = COALESCE(NULLIF(display_name, ''), $2),
                            email = COALESCE(email, $3),
                            updated_at = NOW()
                      WHERE id = $1::uuid`,
                    [profileId, contact.name || null, email],
                );
                return { kind: 'phone_link' as const, profileId };
            }

            const emailMatches = email
                ? await query<any[]>(
                    `SELECT id, display_name, phone, email
                       FROM customer_profiles
                      WHERE email IS NOT NULL AND LOWER(email) = $1
                      ORDER BY created_at ASC, id ASC
                      LIMIT 2
                      FOR UPDATE`,
                    [email],
                )
                : [];
            const emailCandidate = emailMatches.length === 1 ? emailMatches[0] : null;

            const newProfiles = await query<any[]>(
                `INSERT INTO customer_profiles (display_name, phone, email)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [contact.name || null, phoneNorm || rawPhone, email],
            );
            if (!newProfiles?.length) return { kind: 'missing_profile' as const, profileId: null };
            const newProfileId = newProfiles[0].id;

            const linked = await query<any[]>(
                `INSERT INTO contact_identities
                    (customer_profile_id, contact_id, channel_type, external_id, is_primary)
                 VALUES ($1::uuid, $2::uuid, $3, $4, true)
                 ON CONFLICT (contact_id) DO NOTHING
                 RETURNING customer_profile_id`,
                [newProfileId, contact.id, contact.channelType, contact.externalId],
            );
            if (!linked?.length) {
                // Defensive cleanup for a legacy caller that did not participate
                // in the advisory-lock protocol.
                await query(`DELETE FROM customer_profiles WHERE id = $1::uuid`, [newProfileId]);
                const winner = await query<any[]>(
                    `SELECT customer_profile_id FROM contact_identities WHERE contact_id = $1::uuid LIMIT 1`,
                    [contact.id],
                );
                return { kind: 'existing' as const, profileId: winner?.[0]?.customer_profile_id || null };
            }

            // A shared phone or an email-only match is not silently attached to
            // an arbitrary person. Keep both valid profiles and create pending
            // suggestions; every referenced UUID still exists, so no FK 23503.
            const candidates = contact.allowPhoneAutoLink === false || phoneMatches.length > 1
                ? phoneMatches.map(profile => ({ profile, matchType: 'ambiguous_phone_match', confidence: 0.50 }))
                : (emailCandidate ? [{ profile: emailCandidate, matchType: 'email_match', confidence: 0.80 }] : []);
            for (const candidate of candidates) {
                const primaryContacts = await query<any[]>(
                    `SELECT contact_id
                       FROM contact_identities
                      WHERE customer_profile_id = $1::uuid AND is_primary = true
                      ORDER BY linked_at ASC
                      LIMIT 1`,
                    [candidate.profile.id],
                );
                if (!primaryContacts?.length || primaryContacts[0].contact_id === contact.id) continue;

                const otherContactId = primaryContacts[0].contact_id;
                const duplicateSuggestions = await query<any[]>(
                    `SELECT id FROM merge_suggestions
                      WHERE ((contact_id_a = $1::uuid AND contact_id_b = $2::uuid)
                         OR (contact_id_a = $2::uuid AND contact_id_b = $1::uuid))
                      LIMIT 1`,
                    [otherContactId, contact.id],
                );
                if (duplicateSuggestions?.length) continue;
                await query(
                    `INSERT INTO merge_suggestions
                        (customer_profile_id_a, customer_profile_id_b, contact_id_a, contact_id_b,
                         match_type, confidence, status)
                     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'pending')`,
                    [candidate.profile.id, newProfileId, otherContactId, contact.id,
                        candidate.matchType, candidate.confidence],
                );
            }

            return { kind: 'created' as const, profileId: newProfileId };
        });

        if (outcome.kind === 'missing') {
            this.logger.warn(`[Identity] Contact ${contact.id} disappeared before identity resolution`);
        } else if (outcome.kind === 'missing_profile') {
            this.logger.error(`[Identity] Failed to create customer_profile for contact ${contact.id}`);
        } else if (outcome.kind === 'phone_link') {
            this.logger.log(`[Identity] Linked ${contact.channelType}:${contact.externalId} to profile ${outcome.profileId}`);
        } else if (outcome.kind === 'created') {
            this.logger.log(`[Identity] Profile ${outcome.profileId} created for ${contact.channelType}:${contact.externalId}`);
        }
    }

    /**
     * Get pending merge suggestions for a tenant.
     */
    async getMergeSuggestions(tenantId: string, status: string = 'pending') {
        const schemaName = await this.getSchema(tenantId);

        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT ms.*,
                    ca.name as contact_a_name, ca.external_id as contact_a_external, ca.channel_type as contact_a_channel,
                    cb.name as contact_b_name, cb.external_id as contact_b_external, cb.channel_type as contact_b_channel,
                    pa.display_name as profile_a_name, pa.phone as profile_a_phone,
                    pb.display_name as profile_b_name, pb.phone as profile_b_phone
             FROM merge_suggestions ms
             LEFT JOIN contacts ca ON ca.id = ms.contact_id_a
             LEFT JOIN contacts cb ON cb.id = ms.contact_id_b
             LEFT JOIN customer_profiles pa ON pa.id = ms.customer_profile_id_a
             LEFT JOIN customer_profiles pb ON pb.id = ms.customer_profile_id_b
             WHERE ms.status = $1
             ORDER BY ms.confidence DESC, ms.created_at DESC
             LIMIT 100`,
            [status],
        );
    }

    /**
     * Approve a merge: move all contact_identities from profile B to profile A,
     * then delete the orphan profile B.
     */
    async approveMerge(tenantId: string, suggestionId: string, userId: string): Promise<void> {
        const schemaName = await this.getSchema(tenantId);

        // Get the suggestion
        const suggestions = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM merge_suggestions WHERE id = $1::uuid AND status = 'pending' LIMIT 1`,
            [suggestionId],
        );
        if (!suggestions?.length) throw new Error('Merge suggestion not found or already processed');

        const suggestion = suggestions[0];
        const keepProfileId = suggestion.customer_profile_id_a;
        const removeProfileId = suggestion.customer_profile_id_b;

        // Move all contact_identities from B to A
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE contact_identities SET customer_profile_id = $1::uuid, is_primary = false
             WHERE customer_profile_id = $2::uuid`,
            [keepProfileId, removeProfileId],
        );

        // Merge metadata: update profile A with phone/email from B if missing
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE customer_profiles SET
                 phone = COALESCE(phone, (SELECT phone FROM customer_profiles WHERE id = $2::uuid)),
                 email = COALESCE(email, (SELECT email FROM customer_profiles WHERE id = $2::uuid)),
                 updated_at = NOW()
             WHERE id = $1::uuid`,
            [keepProfileId, removeProfileId],
        );

        // Delete orphan profile B
        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM customer_profiles WHERE id = $1::uuid`,
            [removeProfileId],
        );

        // Mark suggestion as approved
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE merge_suggestions SET status = 'approved', reviewed_by = $2::uuid, reviewed_at = NOW()
             WHERE id = $1::uuid`,
            [suggestionId, userId],
        );

        this.logger.log(`[Identity] Merge approved: kept profile ${keepProfileId}, removed ${removeProfileId}`);
    }

    /**
     * Reject a merge suggestion.
     */
    async rejectMerge(tenantId: string, suggestionId: string, userId: string): Promise<void> {
        const schemaName = await this.getSchema(tenantId);

        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE merge_suggestions SET status = 'rejected', reviewed_by = $1::uuid, reviewed_at = NOW()
             WHERE id = $2::uuid`,
            [userId, suggestionId],
        );

        this.logger.log(`[Identity] Merge rejected: suggestion ${suggestionId}`);
    }

    /**
     * Get a unified customer profile with all linked contacts and their conversations.
     */
    async getCustomerProfile(tenantId: string, profileId: string) {
        const schemaName = await this.getSchema(tenantId);

        const profiles = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM customer_profiles WHERE id = $1::uuid LIMIT 1`,
            [profileId],
        );
        if (!profiles?.length) return null;

        const contacts = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT ci.*, c.name, c.phone, c.email, c.external_id, c.channel_type, c.tags
             FROM contact_identities ci
             JOIN contacts c ON c.id = ci.contact_id
             WHERE ci.customer_profile_id = $1::uuid
             ORDER BY ci.is_primary DESC, ci.linked_at ASC`,
            [profileId],
        );

        const conversations = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT conv.id, conv.channel_type, conv.status, conv.stage, conv.created_at,
                    (SELECT content_text FROM messages WHERE conversation_id = conv.id ORDER BY created_at DESC LIMIT 1) as last_message
             FROM conversations conv
             WHERE conv.contact_id IN (
                 SELECT contact_id FROM contact_identities WHERE customer_profile_id = $1::uuid
             )
             ORDER BY conv.created_at DESC
             LIMIT 20`,
            [profileId],
        );

        return {
            profile: profiles[0],
            contacts: contacts || [],
            conversations: conversations || [],
        };
    }

    /**
     * Manually merge two contacts into one unified profile.
     * Creates a merge suggestion and auto-approves it.
     */
    async manualMerge(tenantId: string, contactIdA: string, contactIdB: string, userId: string): Promise<void> {
        const schemaName = await this.getSchema(tenantId);

        // Get or create profiles for both contacts
        const getOrCreateProfile = async (contactId: string) => {
            const existing = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT ci.customer_profile_id FROM contact_identities ci WHERE ci.contact_id = $1::uuid LIMIT 1`,
                [contactId],
            );
            if (existing?.length) return existing[0].customer_profile_id;

            // Create profile from contact data
            const contact = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT name, phone, email FROM contacts WHERE id = $1::uuid LIMIT 1`,
                [contactId],
            );
            if (!contact?.length) throw new Error(`Contact ${contactId} not found`);

            const profile = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO customer_profiles (display_name, phone, email) VALUES ($1, $2, $3) RETURNING id`,
                [contact[0].name, contact[0].phone, contact[0].email],
            );
            const profileId = profile[0].id;

            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO contact_identities (customer_profile_id, contact_id, channel_type, external_id, is_primary)
                 SELECT $1::uuid, id, channel_type, external_id, true FROM contacts WHERE id = $2::uuid
                 ON CONFLICT (contact_id) DO UPDATE SET customer_profile_id = $1::uuid`,
                [profileId, contactId],
            );
            return profileId;
        };

        const profileIdA = await getOrCreateProfile(contactIdA);
        const profileIdB = await getOrCreateProfile(contactIdB);

        if (profileIdA === profileIdB) {
            this.logger.log(`[Identity] Contacts already in same profile: ${profileIdA}`);
            return;
        }

        // Create suggestion and auto-approve
        const suggestion = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO merge_suggestions (customer_profile_id_a, customer_profile_id_b, contact_id_a, contact_id_b, match_type, confidence, status, reviewed_by, reviewed_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'manual', 1.0, 'pending', $5, NOW()) RETURNING id`,
            [profileIdA, profileIdB, contactIdA, contactIdB, userId],
        );

        if (suggestion?.length) {
            await this.approveMerge(tenantId, suggestion[0].id, userId);
        }

        this.logger.log(`[Identity] Manual merge: contacts ${contactIdA} + ${contactIdB} → profile ${profileIdA}`);
    }

    private async getSchema(tenantId: string): Promise<string> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.redis.set(`tenant:${tenantId}:schema`, schema, 600);
        return schema;
    }
}
