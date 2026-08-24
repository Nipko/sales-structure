import { Injectable, Logger } from '@nestjs/common';
import {
    profileSystemOfRecordPolicy,
    type ProfileSystemOfRecordPolicy,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_SYNC_INTERVAL_MINUTES = 60;
const STALE_MULTIPLIER = 3;

export interface SystemOfRecordBoundaryResolution {
    profileId: string;
    policy?: ProfileSystemOfRecordPolicy;
    owner: 'parallly' | 'conditional_binding' | 'external_provider' | 'unknown';
    readsAvailable: boolean;
    writerOwnerVerified: boolean;
    provider?: string;
    mirrorAsOf?: string;
    reason?: 'provider_unavailable' | 'provider_mirror_stale' | 'ownership_unknown';
}

/**
 * Resolves the authoritative owner of subtype domain objects.
 *
 * This service deliberately recognises only bindings the runtime can prove.
 * A string saved in generic settings is not certification. Today the only
 * provider-backed subtype mirror with a complete read path is Hostaway for
 * lodging. Every other provider-required profile remains fail-closed until a
 * dedicated adapter supplies the same evidence contract.
 */
@Injectable()
export class SystemOfRecordBoundaryService {
    private readonly logger = new Logger(SystemOfRecordBoundaryService.name);

    constructor(private readonly prisma: PrismaService) {}

    async resolve(input: {
        tenantId: string;
        schemaName: string;
        profileId: string;
    }): Promise<SystemOfRecordBoundaryResolution> {
        const policy = profileSystemOfRecordPolicy(input.profileId);
        if (!policy) {
            return {
                profileId: input.profileId,
                owner: 'unknown',
                readsAvailable: true,
                writerOwnerVerified: false,
            };
        }
        if (policy.boundary === 'native') {
            return {
                profileId: input.profileId,
                policy,
                owner: 'parallly',
                readsAvailable: true,
                writerOwnerVerified: true,
            };
        }

        if (policy.boundary === 'conditional_provider') {
            // Profile-level market fit is not ownership evidence. A tenant
            // without a binding keeps its native reads and commits. Resource
            // bindings (for example one Hostaway-mapped unit) are enforced at
            // the writer with the resource id, where mixed ownership can be
            // decided honestly.
            return {
                profileId: input.profileId,
                policy,
                owner: 'conditional_binding',
                readsAvailable: true,
                writerOwnerVerified: true,
            };
        }

        if (!['turismo/hotel', 'turismo/alquiler_vacacional'].includes(input.profileId)) {
            return this.unavailable(policy, 'provider_unavailable');
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: input.tenantId },
            select: { settings: true, schemaName: true },
        });
        if (!tenant || tenant.schemaName !== input.schemaName) {
            return this.unavailable(policy, 'ownership_unknown');
        }
        const config = (tenant.settings as any)?.channelManager;
        const provider = String(config?.provider || '').toLowerCase();
        // Guesty/iCal are intentionally not inferred as operational. Guesty
        // has no certified adapter; iCal is a feed, not an authoritative API.
        if (provider !== 'hostaway' || !config?.accountId || !(config?.apiSecret || config?.apiKey)) {
            return this.unavailable(policy, 'provider_unavailable', provider || undefined);
        }

        try {
            const rows = await this.prisma.executeInTenantSchema<Array<{
                last_synced_at: Date | string | null;
                listing_count: bigint | number | string;
            }>>(
                input.schemaName,
                `SELECT MAX(last_synced_at) AS last_synced_at, COUNT(*) AS listing_count
                   FROM cm_listings
                  WHERE provider = 'hostaway' AND status = 'active' AND is_deleted = false`,
                [],
            );
            const row = rows?.[0];
            const count = Number(row?.listing_count ?? 0);
            const mirrorMs = row?.last_synced_at ? new Date(row.last_synced_at).getTime() : NaN;
            const interval = Number(config.syncInterval) > 0
                ? Number(config.syncInterval)
                : DEFAULT_SYNC_INTERVAL_MINUTES;
            const fresh = count > 0
                && Number.isFinite(mirrorMs)
                && Date.now() - mirrorMs <= interval * STALE_MULTIPLIER * 60_000;
            if (!fresh) {
                return this.unavailable(
                    policy,
                    Number.isFinite(mirrorMs) ? 'provider_mirror_stale' : 'provider_unavailable',
                    provider,
                    Number.isFinite(mirrorMs) ? new Date(mirrorMs).toISOString() : undefined,
                );
            }
            return {
                profileId: input.profileId,
                policy,
                owner: 'external_provider',
                readsAvailable: true,
                // Reads are certified. Writes remain displaced until an
                // allowlisted provider adapter reconciles the remote commit.
                writerOwnerVerified: false,
                provider,
                mirrorAsOf: new Date(mirrorMs).toISOString(),
            };
        } catch (error: any) {
            this.logger.warn(
                `[SoR] mirror evidence unavailable tenant=${input.tenantId} `
                + `profile=${input.profileId}: ${error?.message}`,
            );
            return this.unavailable(policy, 'ownership_unknown', provider);
        }
    }

    private unavailable(
        policy: ProfileSystemOfRecordPolicy,
        reason: SystemOfRecordBoundaryResolution['reason'],
        provider?: string,
        mirrorAsOf?: string,
    ): SystemOfRecordBoundaryResolution {
        return {
            profileId: policy.profileId,
            policy,
            owner: 'external_provider',
            readsAvailable: false,
            writerOwnerVerified: false,
            provider,
            mirrorAsOf,
            reason,
        };
    }
}
