import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MetaGraphService, MetaApiError } from '../meta-graph/meta-graph.service';
import { AuditService } from '../audit/audit.service';
import { StartOnboardingDto } from './dto/start-onboarding.dto';
import {
  OnboardingStatus,
  OnboardingMode,
  IN_PROGRESS_STATUSES,
  TERMINAL_STATUSES,
} from '../../common/enums/onboarding-status.enum';
import {
  OnboardingErrorCode,
  RETRYABLE_ERRORS,
} from '../../common/enums/onboarding-error.enum';
import * as crypto from 'crypto';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaGraph: MetaGraphService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * === FLUJO PRINCIPAL DE ONBOARDING ===
   * Ejecuta la secuencia completa: code → exchange → discovery → webhook → sync
   */
  async startOnboarding(dto: StartOnboardingDto, userId: string) {
    this.logger.log(`Starting onboarding for tenant: ${dto.tenantId}, mode: ${dto.mode}`);

    // ---- 1. Validaciones previas ----
    await this.validatePreConditions(dto);

    // ---- 2. Crear registro de onboarding ----
    const onboarding = await this.prisma.whatsappOnboarding.create({
      data: {
        tenantId: dto.tenantId,
        configId: dto.configId,
        mode: dto.mode,
        status: OnboardingStatus.CODE_RECEIVED,
        isCoexistence: dto.mode === OnboardingMode.COEXISTENCE,
        coexistenceAcknowledged: dto.coexistenceAcknowledged || false,
        startedByUserId: userId,
        codeReceivedAt: new Date(),
      },
    });

    this.logger.log(`Onboarding record created: ${onboarding.id}`);

    try {
      // ---- 3. Exchange del code con Meta ----
      await this.updateStatus(onboarding.id, OnboardingStatus.EXCHANGE_IN_PROGRESS);

      const exchangeResult = await this.metaGraph.exchangeOnboardingCode(dto.code, dto.configId);

      await this.prisma.whatsappOnboarding.update({
        where: { id: onboarding.id },
        data: {
          status: OnboardingStatus.EXCHANGE_COMPLETED,
          exchangePayload: exchangeResult as any,
          exchangeCompletedAt: new Date(),
        },
      });

      this.logger.log(`Exchange completed for onboarding: ${onboarding.id}`);

      // ---- 4. Descubrimiento de assets ----
      await this.updateStatus(onboarding.id, OnboardingStatus.ASSET_DISCOVERY_IN_PROGRESS);

      const wabas = await this.metaGraph.getBusinessAccountsForToken(exchangeResult.accessToken);

      if (!wabas || wabas.length === 0) {
        throw new MetaApiError(
          OnboardingErrorCode.WABA_NOT_FOUND,
          'No se encontró ninguna cuenta de WhatsApp Business asociada',
          'No WABAs found after exchange',
          false,
        );
      }

      // Usar la primera WABA (en Embedded Signup v4, generalmente solo devuelve 1)
      const waba = wabas[0];
      const phones = await this.metaGraph.getPhoneNumbersForWaba(waba.id, exchangeResult.accessToken);

      if (!phones || phones.length === 0) {
        throw new MetaApiError(
          OnboardingErrorCode.PHONE_NOT_FOUND,
          'No se encontró ningún número de teléfono en la cuenta de WhatsApp Business',
          `No phone numbers found for WABA ${waba.id}`,
          false,
        );
      }

      const primaryPhone = phones[0];

      await this.prisma.whatsappOnboarding.update({
        where: { id: onboarding.id },
        data: {
          status: OnboardingStatus.ASSETS_DISCOVERED,
          metaBusinessId: waba.id,
          wabaId: waba.id,
          phoneNumberId: primaryPhone.id,
          displayPhoneNumber: primaryPhone.displayPhoneNumber,
          verifiedName: primaryPhone.verifiedName,
          assetsSyncedAt: new Date(),
        },
      });

      this.logger.log(`Assets discovered: WABA=${waba.id}, Phone=${primaryPhone.id}`);

      // ---- 5. Persistir canal en el tenant schema ----
      await this.persistWhatsAppChannel(dto.tenantId, onboarding.id, waba, primaryPhone, exchangeResult.accessToken, dto.mode === OnboardingMode.COEXISTENCE);

      // ---- 6. Registrar en channel_accounts (público) para routing de webhooks ----
      await this.registerChannelAccount(dto.tenantId, primaryPhone, exchangeResult.accessToken);

      // ---- 7. Guardar credenciales cifradas ----
      await this.storeEncryptedCredential(dto.tenantId, exchangeResult.accessToken);

      // ---- 8. Suscribir webhook ----
      await this.updateStatus(onboarding.id, OnboardingStatus.WEBHOOK_VALIDATION_IN_PROGRESS);

      const webhookSuccess = await this.metaGraph.subscribeAppToWaba(waba.id, exchangeResult.accessToken);

      if (webhookSuccess) {
        await this.updateStatus(onboarding.id, OnboardingStatus.WEBHOOK_VALIDATED);
        await this.prisma.whatsappOnboarding.update({
          where: { id: onboarding.id },
          data: { webhookValidatedAt: new Date() },
        });
      }

      // ---- 9. Sync templates en background (no bloquea) ----
      this.syncTemplatesInBackground(dto.tenantId, waba.id, exchangeResult.accessToken, onboarding.id);

      // ---- 10. Marcar completado ----
      const finalStatus = webhookSuccess
        ? OnboardingStatus.COMPLETED
        : OnboardingStatus.COMPLETED_WITH_WARNINGS;

      await this.prisma.whatsappOnboarding.update({
        where: { id: onboarding.id },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          errorMessage: webhookSuccess ? null : 'Webhook subscription may have failed — verify manually',
        },
      });

      // Audit log
      await this.audit.log({
        action: 'onboarding_completed',
        tenantId: dto.tenantId,
        userId,
        entityType: 'whatsapp_onboarding',
        entityId: onboarding.id,
        metadata: {
          wabaId: waba.id,
          phoneNumberId: primaryPhone.id,
          displayPhoneNumber: primaryPhone.displayPhoneNumber,
          mode: dto.mode,
          finalStatus,
        },
      });

      this.logger.log(`Onboarding ${finalStatus} for tenant: ${dto.tenantId}`);

      return this.formatOnboardingResponse(
        await this.prisma.whatsappOnboarding.findUnique({ where: { id: onboarding.id } }),
      );

    } catch (error: any) {
      // Marcar como FAILED
      const errorCode = error instanceof MetaApiError ? error.code : OnboardingErrorCode.GRAPH_API_ERROR;
      const errorMessage = error instanceof MetaApiError ? error.userMessage : error.message;

      await this.prisma.whatsappOnboarding.update({
        where: { id: onboarding.id },
        data: {
          status: OnboardingStatus.FAILED,
          errorCode,
          errorMessage,
        },
      });

      this.logger.error(`Onboarding FAILED: ${errorCode} — ${error.message}`);

      await this.audit.log({
        action: 'onboarding_failed',
        tenantId: dto.tenantId,
        userId,
        entityType: 'whatsapp_onboarding',
        entityId: onboarding.id,
        metadata: { errorCode, errorMessage, retryable: RETRYABLE_ERRORS.has(errorCode) },
      });

      throw new BadRequestException({
        code: errorCode,
        userMessage: errorMessage,
        retryable: RETRYABLE_ERRORS.has(errorCode),
        onboardingId: onboarding.id,
      });
    }
  }

  /**
   * Obtener detalle completo de un onboarding
   */
  async getOnboarding(id: string) {
    const onboarding = await this.prisma.whatsappOnboarding.findUnique({ where: { id } });
    if (!onboarding) throw new NotFoundException('Onboarding no encontrado');
    return this.formatOnboardingResponse(onboarding);
  }

  /**
   * Obtener solo el estado (para polling desde frontend)
   */
  async getOnboardingStatus(id: string) {
    const onboarding = await this.prisma.whatsappOnboarding.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        errorCode: true,
        errorMessage: true,
        displayPhoneNumber: true,
        verifiedName: true,
        wabaId: true,
        completedAt: true,
      },
    });
    if (!onboarding) throw new NotFoundException('Onboarding no encontrado');
    return onboarding;
  }

  /**
   * Cancelar un onboarding en progreso
   */
  async cancelOnboarding(id: string, userId: string) {
    const onboarding = await this.prisma.whatsappOnboarding.findUnique({ where: { id } });
    if (!onboarding) throw new NotFoundException('Onboarding no encontrado');

    if (TERMINAL_STATUSES.includes(onboarding.status as OnboardingStatus)) {
      throw new BadRequestException(`El onboarding ya está en estado terminal: ${onboarding.status}`);
    }

    const updated = await this.prisma.whatsappOnboarding.update({
      where: { id },
      data: {
        status: OnboardingStatus.CANCELLED,
        errorCode: OnboardingErrorCode.USER_CANCELLED,
        errorMessage: 'Cancelado por el usuario',
      },
    });

    await this.audit.log({
      action: 'onboarding_cancelled',
      tenantId: onboarding.tenantId,
      userId,
      entityType: 'whatsapp_onboarding',
      entityId: id,
      metadata: { previousStatus: onboarding.status },
    });

    return this.formatOnboardingResponse(updated);
  }

  /**
   * Reintentar un onboarding fallido (retoma desde el punto de fallo)
   */
  async retryOnboarding(id: string, userId: string) {
    const onboarding = await this.prisma.whatsappOnboarding.findUnique({ where: { id } });
    if (!onboarding) throw new NotFoundException('Onboarding no encontrado');

    if (onboarding.status !== OnboardingStatus.FAILED) {
      throw new BadRequestException(`Solo se puede reintentar un onboarding con status FAILED. Actual: ${onboarding.status}`);
    }

    if (onboarding.errorCode && !RETRYABLE_ERRORS.has(onboarding.errorCode as OnboardingErrorCode)) {
      throw new BadRequestException(`Este error no es reintentable: ${onboarding.errorCode}`);
    }

    await this.audit.log({
      action: 'onboarding_retried',
      tenantId: onboarding.tenantId,
      userId,
      entityType: 'whatsapp_onboarding',
      entityId: id,
      metadata: { previousError: onboarding.errorCode },
    });

    // TODO: En una versión futura, retomar desde el punto exacto de fallo
    // Por ahora: resetear y arrancar desde CREATED
    await this.prisma.whatsappOnboarding.update({
      where: { id },
      data: {
        status: OnboardingStatus.CREATED,
        errorCode: null,
        errorMessage: null,
      },
    });

    return { message: 'Onboarding marcado para reintento. Inicia un nuevo flujo con el code.', onboardingId: id };
  }

  /**
   * Re-sincronizar assets de un onboarding completado
   */
  async resyncAssets(id: string, userId: string) {
    const onboarding = await this.prisma.whatsappOnboarding.findUnique({ where: { id } });
    if (!onboarding) throw new NotFoundException('Onboarding no encontrado');

    if (onboarding.status !== OnboardingStatus.COMPLETED &&
        onboarding.status !== OnboardingStatus.COMPLETED_WITH_WARNINGS) {
      throw new BadRequestException('Solo se pueden re-sincronizar assets de onboardings completados');
    }

    // Obtener token del tenant
    const credential = await this.prisma.whatsappCredential.findFirst({
      where: { tenantId: onboarding.tenantId, credentialType: 'system_user_token' },
    });

    if (!credential) {
      throw new BadRequestException('No se encontró el token de acceso para este tenant');
    }

    const accessToken = this.decryptToken(credential.encryptedValue);

    // Re-sincronizar templates
    if (onboarding.wabaId) {
      const templates = await this.metaGraph.getTemplatesForWaba(onboarding.wabaId, accessToken);
      await this.syncTemplatesToDb(onboarding.tenantId, onboarding.wabaId, templates);
    }

    // Re-sincronizar números
    if (onboarding.wabaId) {
      const phones = await this.metaGraph.getPhoneNumbersForWaba(onboarding.wabaId, accessToken);
      await this.syncPhoneNumbersToDb(onboarding.tenantId, onboarding.wabaId, phones);
    }

    await this.prisma.whatsappOnboarding.update({
      where: { id },
      data: { assetsSyncedAt: new Date() },
    });

    await this.audit.log({
      action: 'assets_resynced',
      tenantId: onboarding.tenantId,
      userId,
      entityType: 'whatsapp_onboarding',
      entityId: id,
      metadata: {},
    });

    return { message: 'Assets re-sincronizados exitosamente', onboardingId: id };
  }

  /**
   * Lista todos los onboardings (admin panel)
   */
  async listOnboardings(page = 1, limit = 20, tenantId?: string) {
    const where = tenantId ? { tenantId } : {};
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.whatsappOnboarding.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.whatsappOnboarding.count({ where }),
    ]);

    return {
      items: items.map(i => this.formatOnboardingResponse(i)),
      total,
      page,
      limit,
    };
  }

  // ==========================================
  // PRIVATE HELPERS
  // ==========================================

  private async validatePreConditions(dto: StartOnboardingDto) {
    // Verificar que el tenant existe
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
      select: { id: true, schemaName: true, isActive: true },
    });

    if (!tenant) {
      throw new BadRequestException({
        code: OnboardingErrorCode.TENANT_NOT_FOUND,
        userMessage: `El tenant ${dto.tenantId} no existe`,
      });
    }

    if (!tenant.isActive) {
      throw new BadRequestException({
        code: OnboardingErrorCode.TENANT_NOT_FOUND,
        userMessage: 'El tenant no está activo',
      });
    }

    // Verificar que el configId es válido
    const allowedConfigId = this.config.get<string>('meta.configId');
    if (allowedConfigId && dto.configId !== allowedConfigId) {
      throw new BadRequestException({
        code: OnboardingErrorCode.CONFIG_INVALID,
        userMessage: 'Config ID no válido',
      });
    }

    // Verificar que no hay onboarding en progreso para este tenant
    const existingInProgress = await this.prisma.whatsappOnboarding.findFirst({
      where: {
        tenantId: dto.tenantId,
        status: { in: IN_PROGRESS_STATUSES },
      },
    });

    if (existingInProgress) {
      throw new ConflictException({
        code: OnboardingErrorCode.DUPLICATE_CUSTOMER_BINDING,
        userMessage: 'Ya hay un onboarding en progreso para este tenant',
        existingOnboardingId: existingInProgress.id,
      });
    }

    // Coexistencia requiere acknowledgment explícito
    if (dto.mode === OnboardingMode.COEXISTENCE && !dto.coexistenceAcknowledged) {
      throw new BadRequestException({
        code: OnboardingErrorCode.COEXISTENCE_NOT_ACKNOWLEDGED,
        userMessage: 'El modo coexistencia requiere confirmación explícita del usuario',
      });
    }
  }

  /**
   * Persistir el canal WhatsApp en el tenant schema
   */
  private async persistWhatsAppChannel(
    tenantId: string,
    onboardingId: string,
    waba: any,
    phone: any,
    accessToken: string,
    isCoexistence: boolean,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { schemaName: true },
    });

    if (!tenant) return;

    // Upsert — si ya existe un canal para este tenant, lo actualizamos
    await this.prisma.executeInTenantSchema(
      tenant.schemaName,
      `DELETE FROM whatsapp_channels WHERE phone_number_id = $1`,
      [phone.id],
    );

    await this.prisma.executeInTenantSchema(
      tenant.schemaName,
      `INSERT INTO whatsapp_channels (
        provider_type, meta_business_id, meta_waba_id, phone_number_id,
        display_phone_number, display_name, quality_rating,
        access_token_ref, channel_status, connected_at,
        is_coexistence, onboarding_id
      ) VALUES (
        'meta_cloud', $1, $2, $3,
        $4, $5, $6,
        $7, 'connected', NOW(),
        $8, $9
      )`,
      [
        waba.id, waba.id, phone.id,
        phone.displayPhoneNumber, phone.verifiedName, phone.qualityRating || 'GREEN',
        'credential_ref', // No almacenamos el token en texto, usamos referencia a whatsapp_credentials
        isCoexistence, onboardingId,
      ],
    );

    this.logger.log(`WhatsApp channel persisted in tenant schema: ${tenant.schemaName}`);
  }

  /**
   * Registrar en channel_accounts público para routing de webhooks
   */
  private async registerChannelAccount(tenantId: string, phone: any, accessToken: string) {
    // Upsert — actualiza si ya existe
    const existing = await this.prisma.channelAccount.findFirst({
      where: {
        channelType: 'whatsapp',
        accountId: phone.id,
      },
    });

    if (existing) {
      await this.prisma.channelAccount.update({
        where: { id: existing.id },
        data: {
          tenantId,
          displayName: phone.verifiedName || phone.displayPhoneNumber,
          accessToken: 'encrypted_ref', // No en texto plano
          isActive: true,
        },
      });
    } else {
      await this.prisma.channelAccount.create({
        data: {
          tenantId,
          channelType: 'whatsapp',
          accountId: phone.id,
          displayName: phone.verifiedName || phone.displayPhoneNumber,
          accessToken: 'encrypted_ref',
          isActive: true,
          metadata: {
            displayPhoneNumber: phone.displayPhoneNumber,
            qualityRating: phone.qualityRating,
          },
        },
      });
    }

    this.logger.log(`Channel account registered for phone: ${phone.id}`);
  }

  /**
   * Almacenar token cifrado en la tabla de credenciales
   */
  private async storeEncryptedCredential(tenantId: string, accessToken: string) {
    const encryptedValue = this.encryptToken(accessToken);

    // Upsert — reemplaza si ya existe
    const existing = await this.prisma.whatsappCredential.findFirst({
      where: { tenantId, credentialType: 'system_user_token' },
    });

    if (existing) {
      await this.prisma.whatsappCredential.update({
        where: { id: existing.id },
        data: { encryptedValue, rotationState: 'active' },
      });
    } else {
      await this.prisma.whatsappCredential.create({
        data: {
          tenantId,
          credentialType: 'system_user_token',
          encryptedValue,
          rotationState: 'active',
        },
      });
    }
  }

  /**
   * Sincronizar templates en background (no bloquea el flujo principal)
   */
  private async syncTemplatesInBackground(tenantId: string, wabaId: string, accessToken: string, onboardingId: string) {
    try {
      const templates = await this.metaGraph.getTemplatesForWaba(wabaId, accessToken);
      await this.syncTemplatesToDb(tenantId, wabaId, templates);
      this.logger.log(`Templates synced in background for onboarding: ${onboardingId}`);
    } catch (error: any) {
      this.logger.warn(`Background template sync failed (non-critical): ${error.message}`);
    }
  }

  /**
   * Persistir templates en el tenant schema
   */
  private async syncTemplatesToDb(tenantId: string, wabaId: string, templates: any[]) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { schemaName: true },
    });

    if (!tenant || !templates.length) return;

    // Obtener el channel_id del WABA en el tenant schema
    const channels = await this.prisma.executeInTenantSchema<any[]>(
      tenant.schemaName,
      `SELECT id FROM whatsapp_channels WHERE meta_waba_id = $1 LIMIT 1`,
      [wabaId],
    );

    if (!channels || channels.length === 0) return;
    const channelId = channels[0].id;

    for (const t of templates) {
      await this.prisma.executeInTenantSchema(
        tenant.schemaName,
        `INSERT INTO whatsapp_templates (channel_id, name, language, category, components_json, approval_status, last_sync_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (channel_id, name) DO NOTHING`,
        [channelId, t.name, t.language, t.category, JSON.stringify(t.components), t.status],
      );
    }
  }

  /**
   * Persistir números de teléfono sincronizados
   */
  private async syncPhoneNumbersToDb(tenantId: string, wabaId: string, phones: any[]) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { schemaName: true },
    });

    if (!tenant) return;

    for (const p of phones) {
      await this.prisma.executeInTenantSchema(
        tenant.schemaName,
        `INSERT INTO whatsapp_channels (
          provider_type, meta_waba_id, phone_number_id,
          display_phone_number, display_name, quality_rating,
          channel_status, connected_at
        ) VALUES (
          'meta_cloud', $1, $2, $3, $4, $5, 'connected', NOW()
        ) ON CONFLICT DO NOTHING`,
        [wabaId, p.id, p.displayPhoneNumber, p.verifiedName, p.qualityRating || 'GREEN'],
      );
    }
  }

  // ---- Cifrado AES-256-GCM ----

  private encryptToken(plaintext: string): string {
    const key = this.config.get<string>('app.encryptionKey');
    if (!key || key.length < 32) {
      this.logger.warn('ENCRYPTION_KEY not set or too short — storing token without encryption (DEV ONLY)');
      return Buffer.from(plaintext).toString('base64');
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex').subarray(0, 32), iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${tag}:${encrypted}`;
  }

  private decryptToken(ciphertext: string): string {
    const key = this.config.get<string>('app.encryptionKey');
    if (!key || key.length < 32) {
      return Buffer.from(ciphertext, 'base64').toString('utf8');
    }

    const [ivHex, tagHex, encryptedHex] = ciphertext.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex').subarray(0, 32), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // ---- Helpers ----

  private async updateStatus(id: string, status: OnboardingStatus) {
    await this.prisma.whatsappOnboarding.update({
      where: { id },
      data: { status },
    });
  }

  private formatOnboardingResponse(onboarding: any) {
    if (!onboarding) return null;
    return {
      id: onboarding.id,
      tenantId: onboarding.tenantId,
      mode: onboarding.mode,
      status: onboarding.status,
      wabaId: onboarding.wabaId,
      phoneNumberId: onboarding.phoneNumberId,
      displayPhoneNumber: onboarding.displayPhoneNumber,
      verifiedName: onboarding.verifiedName,
      isCoexistence: onboarding.isCoexistence,
      errorCode: onboarding.errorCode,
      errorMessage: onboarding.errorMessage,
      codeReceivedAt: onboarding.codeReceivedAt,
      exchangeCompletedAt: onboarding.exchangeCompletedAt,
      assetsSyncedAt: onboarding.assetsSyncedAt,
      webhookValidatedAt: onboarding.webhookValidatedAt,
      completedAt: onboarding.completedAt,
      createdAt: onboarding.createdAt,
    };
  }
}
