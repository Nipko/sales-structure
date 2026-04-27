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
     * If a matching profile exists (by phone or email), creates a merge suggestion.
     * If no match, creates a new profile and links the contact to it.
     */
    async resolveOrCreateProfile(
        tenantId: string,
        contact: { id: string; phone?: string; email?: string; name?: string; channelType: string; externalId: string },
    ): Promise<void> {
        const schemaName = await this.getSchema(tenantId);

        // Check if this contact already has an identity link
        const existing = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT ci.customer_profile_id FROM contact_identities ci WHERE ci.contact_id = $1::uuid LIMIT 1`,
            [contact.id],
        );
        if (existing && existing.length > 0) return; // Already linked

        // Normalize phone for matching
        const rawPhone = contact.phone && /^\+?[\d\s()-]{7,20}$/.test(contact.phone) ? contact.phone : null;
        const phone = rawPhone;
        const phoneNorm = rawPhone ? normalizePhoneE164(rawPhone) : null;
        const email = contact.email && contact.email.includes('@') ? contact.email.toLowerCase().trim() : null;

        // Search for matching profiles by normalized phone or email (skip if null)
        let matchedProfile: any = null;
        let matchType = '';

        if (phoneNorm) {
            // Match on normalized phone for better dedup ("+57 300 123 4567" = "3001234567")
            const phoneMatches = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT cp.id, cp.display_name, cp.phone FROM customer_profiles cp
                 WHERE cp.phone IS NOT NULL AND (cp.phone = $1 OR cp.phone = $2) LIMIT 1`,
                [phoneNorm, phone],
            );
            if (phoneMatches?.length > 0) {
                matchedProfile = phoneMatches[0];
                matchType = 'phone_match';
            }
        }

        if (!matchedProfile && email) {
            const emailMatches = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT cp.id, cp.display_name, cp.email FROM customer_profiles cp
                 WHERE cp.email IS NOT NULL AND LOWER(cp.email) = $1 LIMIT 1`,
                [email],
            );
            if (emailMatches?.length > 0) {
                matchedProfile = emailMatches[0];
                matchType = 'email_match';
            }
        }

        // Create a new profile for this contact (store normalized phone for dedup)
        const newProfile = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO customer_profiles (display_name, phone, email)
             VALUES ($1, $2, $3) RETURNING id`,
            [contact.name || null, phoneNorm || phone, email],
        );

        if (!newProfile || newProfile.length === 0) {
            this.logger.error(`[Identity] Failed to create customer_profile for contact ${contact.id}`);
            return;
        }
        const newProfileId = newProfile[0].id;

        // Link contact to the new profile
        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO contact_identities (customer_profile_id, contact_id, channel_type, external_id, is_primary)
             VALUES ($1::uuid, $2::uuid, $3, $4, true)
             ON CONFLICT (contact_id) DO NOTHING`,
            [newProfileId, contact.id, contact.channelType, contact.externalId],
        );

        // If there's a match, auto-merge (high confidence) or create suggestion (low confidence)
        if (matchedProfile) {
            const matchedContact = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT contact_id FROM contact_identities WHERE customer_profile_id = $1::uuid AND is_primary = true LIMIT 1`,
                [matchedProfile.id],
            );

            if (matchedContact?.length > 0) {
                // Check if this suggestion already exists
                const existingSuggestion = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT id FROM merge_suggestions
                     WHERE ((contact_id_a = $1::uuid AND contact_id_b = $2::uuid)
                        OR (contact_id_a = $2::uuid AND contact_id_b = $1::uuid))
                     LIMIT 1`,
                    [matchedContact[0].contact_id, contact.id],
                );

                if (!existingSuggestion?.length) {
                    const confidence = matchType === 'phone_match' ? 0.95 : 0.80;

                    if (confidence >= 0.95) {
                        // Auto-merge: link new contact to existing profile instead of creating a new one
                        await this.prisma.executeInTenantSchema(
                            schemaName,
                            `UPDATE contact_identities SET customer_profile_id = $1::uuid WHERE contact_id = $2::uuid`,
                            [matchedProfile.id, contact.id],
                        );
                        // Delete the duplicate profile we just created
                        await this.prisma.executeInTenantSchema(
                            schemaName,
                            `DELETE FROM customer_profiles WHERE id = $1::uuid`,
                            [newProfileId],
                        );
                        // Record as auto-merged suggestion
                        await this.prisma.executeInTenantSchema(
                            schemaName,
                            `INSERT INTO merge_suggestions (customer_profile_id_a, customer_profile_id_b, contact_id_a, contact_id_b, match_type, confidence, status, reviewed_by, reviewed_at)
                             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'approved', 'system-auto', NOW())`,
                            [matchedProfile.id, newProfileId, matchedContact[0].contact_id, contact.id, matchType, confidence],
                        );
                        this.logger.log(`[Identity] Auto-merged: ${matchType} (${confidence}) → profile ${matchedProfile.id}`);
                    } else {
                        // Low confidence: create pending suggestion for manual review
                        await this.prisma.executeInTenantSchema(
                            schemaName,
                            `INSERT INTO merge_suggestions (customer_profile_id_a, customer_profile_id_b, contact_id_a, contact_id_b, match_type, confidence, status)
                             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'pending')`,
                            [matchedProfile.id, newProfileId, matchedContact[0].contact_id, contact.id, matchType, confidence],
                        );
                        this.logger.log(`[Identity] Merge suggestion: ${matchType} (${confidence}) tenant=${tenantId}`);
                    }
                }
            }
        }

        this.logger.log(`[Identity] Profile ${newProfileId} created for ${contact.channelType}:${contact.externalId}`);
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

    private async getSchema(tenantId: string): Promise<string> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.redis.set(`tenant:${tenantId}:schema`, schema, 600);
        return schema;
    }
}
