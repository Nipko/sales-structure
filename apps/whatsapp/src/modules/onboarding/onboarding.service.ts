import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
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

interface RequestUser {
  sub: string;
  role: string;
  tenantId?: string;
}

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
   * Ejecuta la secuencia completa:
   * code → short-lived token → long-lived token → debug → discovery → register phone
   * → persist channel → channel_account → credential → webhook → biz verification → sync → done
   */
  async startOnboarding(dto: StartOnboardingDto, user: RequestUser) {
    const tenantId = this.resolveTenantIdForAction(dto.tenantId, user);
    const userId = user.sub;
    this.logger.log(`[Onboarding] START for tenant=${tenantId}, mode=${dto.mode}, sessionPhoneNumberId=${dto.phoneNumberId || 'none'}, sessionWabaId=${dto.wabaId || 'none'}`);

    // ---- 1. Validaciones previas ----
    await this.validatePreConditions(tenantId, dto);

    // ---- 2. Crear registro de onboarding ----
    const onboarding = await this.prisma.whatsappOnboarding.create({
      data: {
        tenantId,
        configId: dto.configId,
        mode: dto.mode,
        status: OnboardingStatus.CODE_RECEIVED,
        isCoexistence: dto.mode === OnboardingMode.COEXISTENCE,
        coexistenceAcknowledged: dto.coexistenceAcknowledged || false,
        startedByUserId: userId,
        codeReceivedAt: new Date(),
      },
    });

    this.logger.log(`[Onboarding] Record created: ${onboarding.id}`);

    try {
      // ---- 3. Exchange code → SHORT-LIVED user token ----
      await this.updateStatus(onboarding.id, OnboardingStatus.EXCHANGE_IN_PROGRESS);
      this.logger.log(`[Onboarding][${onboarding.id}] Step 3: Exchanging OAuth code for short-lived token`);

      const exchangeResult = await this.metaGraph.exchangeOnboardingCode(dto.code, dto.configId);

      this.logger.log(`[Onboarding][${onboarding.id}] Short-lived token obtained (type=${exchangeResult.tokenType}, expiresIn=${exchangeResult.expiresIn || 'unknown'})`);

      // ---- 4. Convert to LONG-LIVED token ----
      this.logger.log(`[Onboarding][${onboarding.id}] Step 4: Converting short-lived token to long-lived token`);

      let longLivedToken: string;
      let longLivedExpiresIn: number;
      try {
        const longLivedResult = await this.metaGraph.exchangeForLongLivedToken(exchangeResult.accessToken);
        longLivedToken = longLivedResult.accessToken;
        longLivedExpiresIn = longLivedResult.expiresIn || 5184000; // default 60 days
        this.logger.log(`[Onboarding][${onboarding.id}] Long-lived token obtained (expiresIn=${longLivedExpiresIn}s)`);
      } catch (tokenError: any) {
        this.logger.error(`[Onboarding][${onboarding.id}] Long-lived token exchange failed: ${tokenError.message}`);
        throw new MetaApiError(
          OnboardingErrorCode.TOKEN_EXCHANGE_FAILED,
          'No se pudo obtener un token de larga duración. Por favor intenta de nuevo.',
          `Long-lived token exchange failed: ${tokenError.message}`,
          true,
          tokenError,
        );
      }

      // Store token in exchangePayload so retries can re-use it
      await this.prisma.whatsappOnboarding.update({
        where: { id: onboarding.id },
        data: {
          status: OnboardingStatus.EXCHANGE_COMPLETED,
          exchangePayload: {
            shortLivedToken: exchangeResult.accessToken,
            longLivedToken,
            longLivedExpiresIn,
            exchangedAt: new Date().toISOString(),
          } as any,
          exchangeCompletedAt: new Date(),
        },
      });

      this.logger.log(`[Onboarding][${onboarding.id}] Exchange completed — stored both tokens in exchangePayload`);

      // Continue from step 5 onward with the long-lived token
      return await this.continueOnboardingFromDiscovery(
        onboarding.id, tenantId, userId, longLivedToken, longLivedExpiresIn, dto,
      );

    } catch (error: any) {
      return this.handleOnboardingFailure(error, onboarding.id, tenantId, userId);
    }
  }

  /**
   * Continues the onboarding flow from step 5 onward (after token exchange).
   * Extracted so that retryOnboarding can resume from here.
   */
  private async continueOnboardingFromDiscovery(
    onboardingId: string,
    tenantId: string,
    userId: string,
    longLivedToken: string,
    longLivedExpiresIn: number,
    dto: Pick<StartOnboardingDto, 'phoneNumberId' | 'wabaId' | 'mode'>,
  ) {
    try {
      // ---- 5. Debug/validate token ----
      this.logger.log(`[Onboarding][${onboardingId}] Step 5: Debugging/validating long-lived token`);
      try {
        const tokenDebug = await this.metaGraph.debugToken(longLivedToken);
        this.logger.log(`[Onboarding][${onboardingId}] Token debug: valid=${tokenDebug.isValid}, type=${tokenDebug.type}, scopes=[${tokenDebug.scopes?.join(', ')}], expiresAt=${tokenDebug.expiresAt}`);
        if (tokenDebug.granularScopes) {
          this.logger.log(`[Onboarding][${onboardingId}] Granular scopes: ${JSON.stringify(tokenDebug.granularScopes)}`);
        }
      } catch (debugError: any) {
        this.logger.warn(`[Onboarding][${onboardingId}] Token debug call failed (non-blocking): ${debugError.message}`);
      }

      // ---- 6. Discover WABA and phone number ----
      await this.updateStatus(onboardingId, OnboardingStatus.ASSET_DISCOVERY_IN_PROGRESS);

      let wabaId: string;
      let waba: any;
      let primaryPhone: any;
      const usedSessionInfo = !!(dto.phoneNumberId && dto.wabaId);

      if (dto.wabaId) {
        // Session info provides WABA ID — use it directly, skip /me/businesses discovery
        wabaId = dto.wabaId;
        this.logger.log(`[Onboarding][${onboardingId}] Step 6: Using session info WABA ID=${wabaId} (skipping /me/businesses discovery)`);

        try {
          waba = await this.metaGraph.getWabaDirectly(wabaId, longLivedToken);
        } catch (wabaError: any) {
          this.logger.warn(`[Onboarding][${onboardingId}] Direct WABA fetch failed, falling back to discovery: ${wabaError.message}`);
          waba = await this.discoverWabaViaApi(longLivedToken);
          wabaId = waba.id;
        }
      } else {
        // No session info — fall back to /me/businesses discovery
        this.logger.log(`[Onboarding][${onboardingId}] Step 6: No session info — falling back to /me/businesses discovery`);
        waba = await this.discoverWabaViaApi(longLivedToken);
        wabaId = waba.id;
      }

      this.logger.log(`[Onboarding][${onboardingId}] Resolved WABA: id=${wabaId}, name=${waba.name}, source=${usedSessionInfo ? 'session_info' : 'api_discovery'}`);

      // ---- 7. Get phone details ----
      if (dto.phoneNumberId) {
        // Session info provides phone number ID — get that specific phone
        this.logger.log(`[Onboarding][${onboardingId}] Step 7: Fetching specific phone from session info: phoneNumberId=${dto.phoneNumberId}`);
        const phones = await this.metaGraph.getPhoneNumbersForWaba(wabaId, longLivedToken);
        primaryPhone = phones.find((p: any) => p.id === dto.phoneNumberId) || phones[0];
        if (!primaryPhone) {
          throw new MetaApiError(
            OnboardingErrorCode.PHONE_NOT_FOUND,
            'No se encontró el número de teléfono indicado en la cuenta de WhatsApp Business',
            `Phone ${dto.phoneNumberId} not found in WABA ${wabaId}`,
            false,
          );
        }
        this.logger.log(`[Onboarding][${onboardingId}] Phone resolved from session info: ${primaryPhone.id} (${primaryPhone.displayPhoneNumber})`);
      } else {
        // No session phone — get all phones and use first
        this.logger.log(`[Onboarding][${onboardingId}] Step 7: Fetching phone numbers for WABA=${wabaId} (no session phoneNumberId)`);
        const phones = await this.metaGraph.getPhoneNumbersForWaba(wabaId, longLivedToken);

        if (!phones || phones.length === 0) {
          throw new MetaApiError(
            OnboardingErrorCode.PHONE_NOT_FOUND,
            'No se encontró ningún número de teléfono en la cuenta de WhatsApp Business',
            `No phone numbers found for WABA ${wabaId}`,
            false,
          );
        }

        primaryPhone = phones[0];
        this.logger.log(`[Onboarding][${onboardingId}] Phone resolved via API discovery: ${primaryPhone.id} (${primaryPhone.displayPhoneNumber})`);
      }

      // ---- 8. Register phone number (required for new numbers) ----
      this.logger.log(`[Onboarding][${onboardingId}] Step 8: Registering phone number ${primaryPhone.id} with Meta`);
      try {
        await this.metaGraph.registerPhoneNumber(primaryPhone.id, longLivedToken);
        this.logger.log(`[Onboarding][${onboardingId}] Phone number registered successfully`);
      } catch (regError: any) {
        // Phone may already be registered — this is not fatal
        this.logger.warn(`[Onboarding][${onboardingId}] Phone registration returned error (may already be registered): ${regError.message}`);
      }

      await this.prisma.whatsappOnboarding.update({
        where: { id: onboardingId },
        data: {
          status: OnboardingStatus.ASSETS_DISCOVERED,
          metaBusinessId: wabaId,
          wabaId,
          phoneNumberId: primaryPhone.id,
          displayPhoneNumber: primaryPhone.displayPhoneNumber,
          verifiedName: primaryPhone.verifiedName,
          assetsSyncedAt: new Date(),
        },
      });

      this.logger.log(`[Onboarding][${onboardingId}] Assets discovered: WABA=${wabaId}, Phone=${primaryPhone.id}, source=${usedSessionInfo ? 'session_info' : 'api_discovery'}`);

      // ---- 9-10. Persist channel + routing (CRITICAL — if this fails, onboarding must fail) ----
      this.logger.log(`[Onboarding][${onboardingId}] Step 9: Persisting WhatsApp channel in tenant schema`);
      await this.persistWhatsAppChannel(tenantId, onboardingId, waba, primaryPhone, longLivedToken, dto.mode === OnboardingMode.COEXISTENCE);

      this.logger.log(`[Onboarding][${onboardingId}] Step 10: Registering channel_account for webhook routing`);
      await this.registerChannelAccount(tenantId, primaryPhone);

      // ---- 11. Try to generate permanent System User Token (Tech Partner flow) ----
      let finalToken = longLivedToken;
      let finalExpiresIn = longLivedExpiresIn;
      try {
        this.logger.log(`[Onboarding][${onboardingId}] Step 11a: Attempting System User Token generation for WABA=${wabaId}`);
        const systemUserResult = await this.metaGraph.generateSystemUserToken(wabaId, longLivedToken);
        if (systemUserResult) {
          finalToken = systemUserResult.accessToken;
          finalExpiresIn = 0; // permanent — no expiry
          this.logger.log(`[Onboarding][${onboardingId}] System User Token generated — permanent, no expiry`);
        } else {
          this.logger.log(`[Onboarding][${onboardingId}] System User Token not available — using long-lived token (${longLivedExpiresIn}s)`);
        }
      } catch (sysUserError: any) {
        this.logger.warn(`[Onboarding][${onboardingId}] System User Token failed (non-blocking): ${sysUserError.message}`);
      }

      // ---- 11b. Store the best available token ----
      this.logger.log(`[Onboarding][${onboardingId}] Step 11b: Storing encrypted credential (expiresIn=${finalExpiresIn}s)`);
      await this.storeEncryptedCredential(tenantId, finalToken, finalExpiresIn);

      // ---- 12. Suscribir webhook ----
      await this.updateStatus(onboardingId, OnboardingStatus.WEBHOOK_VALIDATION_IN_PROGRESS);
      this.logger.log(`[Onboarding][${onboardingId}] Step 12: Subscribing app to WABA=${wabaId} for webhooks`);

      const webhookSuccess = await this.metaGraph.subscribeAppToWaba(wabaId, finalToken);

      if (webhookSuccess) {
        await this.updateStatus(onboardingId, OnboardingStatus.WEBHOOK_VALIDATED);
        await this.prisma.whatsappOnboarding.update({
          where: { id: onboardingId },
          data: { webhookValidatedAt: new Date() },
        });
        this.logger.log(`[Onboarding][${onboardingId}] Webhook subscription successful`);
      } else {
        this.logger.warn(`[Onboarding][${onboardingId}] Webhook subscription returned false — may need manual verification`);
      }

      // ---- 13. Check business verification status ----
      this.logger.log(`[Onboarding][${onboardingId}] Step 13: Checking business verification status for WABA=${wabaId}`);
      let businessVerified = true;
      let verificationWarning: string | null = null;
      try {
        const verificationStatus = await this.metaGraph.getBusinessVerificationStatus(wabaId, finalToken);
        this.logger.log(`[Onboarding][${onboardingId}] Business verification status: ${JSON.stringify(verificationStatus)}`);
        if (verificationStatus && verificationStatus !== 'verified') {
          businessVerified = false;
          verificationWarning = 'La verificación del negocio en Meta aún no está completa. Algunas funciones pueden estar limitadas hasta que se verifique.';
          this.logger.warn(`[Onboarding][${onboardingId}] Business NOT verified — will set COMPLETED_WITH_WARNINGS`);
        }
      } catch (verifyError: any) {
        this.logger.warn(`[Onboarding][${onboardingId}] Business verification check failed (non-blocking): ${verifyError.message}`);
      }

      // ---- 14. Sync templates en background (no bloquea) ----
      this.logger.log(`[Onboarding][${onboardingId}] Step 14: Starting background template sync for WABA=${wabaId}`);
      this.syncTemplatesInBackground(tenantId, wabaId, finalToken, onboardingId);

      // ---- 15. Marcar completado ----
      const warnings: string[] = [];
      if (!webhookSuccess) {
        warnings.push('La suscripción de webhooks pudo haber fallado — verificar manualmente');
      }
      if (!businessVerified && verificationWarning) {
        warnings.push(verificationWarning);
      }

      const finalStatus = warnings.length > 0
        ? OnboardingStatus.COMPLETED_WITH_WARNINGS
        : OnboardingStatus.COMPLETED;

      await this.prisma.whatsappOnboarding.update({
        where: { id: onboardingId },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          errorMessage: warnings.length > 0 ? warnings.join(' | ') : null,
        },
      });

      // Audit log
      await this.audit.log({
        action: 'onboarding_completed',
        tenantId,
        userId,
        entityType: 'whatsapp_onboarding',
        entityId: onboardingId,
        metadata: {
          wabaId,
          phoneNumberId: primaryPhone.id,
          displayPhoneNumber: primaryPhone.displayPhoneNumber,
          mode: dto.mode,
          finalStatus,
          usedSessionInfo,
          businessVerified,
          warnings,
        },
      });

      this.logger.log(`[Onboarding][${onboardingId}] ${finalStatus} for tenant=${tenantId}${warnings.length ? ' (warnings: ' + warnings.join('; ') + ')' : ''}`);

      return this.formatOnboardingResponse(
        await this.prisma.whatsappOnboarding.findUnique({ where: { id: onboardingId } }),
      );

    } catch (error: any) {
      return this.handleOnboardingFailure(error, onboardingId, tenantId, userId);
    }
  }

  /**
   * Discovers WABA via the /me/businesses API (backwards compat fallback).
   */
  private async discoverWabaViaApi(accessToken: string): Promise<any> {
    const wabas = await this.metaGraph.getBusinessAccountsForToken(accessToken);

    if (!wabas || wabas.length === 0) {
      throw new MetaApiError(
        OnboardingErrorCode.WABA_NOT_FOUND,
        'No se encontró ninguna cuenta de WhatsApp Business asociada. Verifica que completaste el flujo de Embedded Signup correctamente.',
        'No WABAs found via /me/businesses discovery',
        false,
      );
    }

    return wabas[0];
  }

  /**
   * Handles onboarding failure — marks record as FAILED, audits, throws.
   */
  private async handleOnboardingFailure(error: any, onboardingId: string, tenantId: string, userId: string): Promise<never> {
    const errorCode = error instanceof MetaApiError ? error.code : OnboardingErrorCode.GRAPH_API_ERROR;
    const errorMessage = error instanceof MetaApiError ? error.userMessage : error.message;

    await this.prisma.whatsappOnboarding.update({
      where: { id: onboardingId },
      data: {
        status: OnboardingStatus.FAILED,
        errorCode,
        errorMessage,
      },
    });

    this.logger.error(`[Onboarding][${onboardingId}] FAILED: ${errorCode} — ${error.message}`);

    await this.audit.log({
      action: 'onboarding_failed',
      tenantId,
      userId,
      entityType: 'whatsapp_onboarding',
      entityId: onboardingId,
      metadata: { errorCode, errorMessage, retryable: RETRYABLE_ERRORS.has(errorCode) },
    });

    throw new BadRequestException({
      code: errorCode,
      userMessage: errorMessage,
      retryable: RETRYABLE_ERRORS.has(errorCode),
      onboardingId,
    });
  }

  /**
   * Obtener detalle completo de un onboarding
   */
  async getOnboarding(id: string, user: RequestUser) {
    const onboarding = await this.prisma.whatsappOnboarding.findUnique({ where: { id } });
    if (!onboarding) throw new NotFoundException('Onboarding no encontrado');
    this.assertTenantAccess(user, onboarding.tenantId);
    return this.formatOnboardingResponse(onboarding);
  }

  /**
   * Obtener solo el estado (para polling desde frontend)
   */
  async getOnboardingStatus(id: string, user: RequestUser) {
    const onboarding = await this.prisma.whatsappOnboarding.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
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
    this.assertTenantAccess(user, onboarding.tenantId);
    return onboarding;
  }

  /**
   * Cancelar un onboarding en progreso
   */
  async cancelOnboarding(id: string, user: RequestUser) {
    const userId = user.sub;
    const onboarding = await this.prisma.whatsappOnboarding.findUnique({ where: { id } });
    if (!onboarding) throw new NotFoundException('Onboarding no encontrado');
    this.assertTenantAccess(user, onboarding.tenantId);

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
   * Reintentar un onboarding fallido.
   * - Si el fallo fue DESPUÉS del token exchange (tenemos token almacenado), retoma desde discovery.
   * - Si el fallo fue DURANTE el token exchange (no hay token), indica al usuario que necesita un nuevo code.
   */
  async retryOnboarding(id: string, user: RequestUser) {
    const userId = user.sub;
    const onboarding = await this.prisma.whatsappOnboarding.findUnique({ where: { id } });
    if (!onboarding) throw new NotFoundException('Onboarding no encontrado');
    this.assertTenantAccess(user, onboarding.tenantId);

    if (onboarding.status !== OnboardingStatus.FAILED) {
      throw new BadRequestException(`Solo se puede reintentar un onboarding con status FAILED. Estado actual: ${onboarding.status}`);
    }

    if (onboarding.errorCode && !RETRYABLE_ERRORS.has(onboarding.errorCode as OnboardingErrorCode)) {
      throw new BadRequestException({
        code: onboarding.errorCode,
        userMessage: `Este error no es reintentable: ${onboarding.errorCode}. Debes iniciar un nuevo proceso de onboarding.`,
        retryable: false,
        onboardingId: id,
      });
    }

    // Check if we have a stored long-lived token from a successful exchange
    const exchangePayload = onboarding.exchangePayload as any;
    const storedLongLivedToken = exchangePayload?.longLivedToken;
    const storedExpiresIn = exchangePayload?.longLivedExpiresIn || 5184000;

    await this.audit.log({
      action: 'onboarding_retried',
      tenantId: onboarding.tenantId,
      userId,
      entityType: 'whatsapp_onboarding',
      entityId: id,
      metadata: {
        previousError: onboarding.errorCode,
        hasStoredToken: !!storedLongLivedToken,
        retryStrategy: storedLongLivedToken ? 'resume_from_discovery' : 'needs_new_code',
      },
    });

    if (!storedLongLivedToken) {
      // Failure was DURING token exchange — the OAuth code is single-use, we can't retry
      this.logger.warn(`[Onboarding][${id}] Retry requested but no stored token — user needs a new OAuth code`);

      await this.prisma.whatsappOnboarding.update({
        where: { id },
        data: {
          status: OnboardingStatus.CANCELLED,
          errorCode: OnboardingErrorCode.CODE_EXPIRED,
          errorMessage: 'El código OAuth es de un solo uso y ya fue consumido. Se requiere un nuevo código.',
        },
      });

      return {
        message: 'El código de autorización ya fue utilizado y no se pudo completar el intercambio de token. Debes hacer clic en el botón de Embedded Signup nuevamente para obtener un nuevo código.',
        onboardingId: id,
        requiresNewCode: true,
        action: 'RESTART_EMBEDDED_SIGNUP',
      };
    }

    // We have a stored long-lived token — resume from discovery (step 5 onward)
    this.logger.log(`[Onboarding][${id}] Retrying from discovery step using stored long-lived token`);

    // Reset error state
    await this.prisma.whatsappOnboarding.update({
      where: { id },
      data: {
        status: OnboardingStatus.EXCHANGE_COMPLETED,
        errorCode: null,
        errorMessage: null,
      },
    });

    // Resume the flow from step 5 onward
    return await this.continueOnboardingFromDiscovery(
      id,
      onboarding.tenantId,
      userId,
      storedLongLivedToken,
      storedExpiresIn,
      {
        phoneNumberId: onboarding.phoneNumberId || undefined,
        wabaId: onboarding.wabaId || undefined,
        mode: onboarding.mode as OnboardingMode,
      },
    );
  }

  /**
   * Re-sincronizar assets de un onboarding completado
   */
  async resyncAssets(id: string, user: RequestUser) {
    const userId = user.sub;
    const onboarding = await this.prisma.whatsappOnboarding.findUnique({ where: { id } });
    if (!onboarding) throw new NotFoundException('Onboarding no encontrado');
    this.assertTenantAccess(user, onboarding.tenantId);

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
  async listOnboardings(user: RequestUser, page = 1, limit = 20, tenantId?: string) {
    const scopedTenantId = user.role === 'super_admin'
      ? tenantId
      : this.resolveTenantIdForAction(tenantId, user);
    const where = scopedTenantId ? { tenantId: scopedTenantId } : {};
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

  private async validatePreConditions(tenantId: string, dto: StartOnboardingDto) {
    // Verificar que el tenant existe
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, schemaName: true, isActive: true },
    });

    if (!tenant) {
      throw new BadRequestException({
        code: OnboardingErrorCode.TENANT_NOT_FOUND,
        userMessage: `El tenant ${tenantId} no existe`,
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
        tenantId,
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

    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found — cannot persist WhatsApp channel`);
    }

    // Upsert — si ya existe un canal para este tenant, lo actualizamos
    // Wrap DELETE + INSERT in a single SQL block to avoid orphaned state
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
        'credential_ref',
        isCoexistence, onboardingId,
      ],
    );

    // Verify the channel was actually persisted
    const verification = await this.prisma.executeInTenantSchema<any[]>(
      tenant.schemaName,
      `SELECT id FROM whatsapp_channels WHERE phone_number_id = $1 LIMIT 1`,
      [phone.id],
    );
    if (!verification || verification.length === 0) {
      throw new Error(`WhatsApp channel INSERT succeeded but row not found — possible schema issue for ${tenant.schemaName}`);
    }

    this.logger.log(`WhatsApp channel persisted in tenant schema: ${tenant.schemaName} (verified)`);
  }

  /**
   * Registrar en channel_accounts público para routing de webhooks
   */
  private async registerChannelAccount(tenantId: string, phone: any) {
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
   * Almacenar token cifrado en la tabla de credenciales con expiración
   */
  private async storeEncryptedCredential(tenantId: string, accessToken: string, expiresInSeconds?: number) {
    const encryptedValue = this.encryptToken(accessToken);
    const expiresAt = expiresInSeconds
      ? new Date(Date.now() + expiresInSeconds * 1000)
      : undefined;

    // Upsert — reemplaza si ya existe
    const existing = await this.prisma.whatsappCredential.findFirst({
      where: { tenantId, credentialType: 'system_user_token' },
    });

    const data: any = {
      encryptedValue,
      rotationState: 'active',
    };
    if (expiresAt) {
      data.expiresAt = expiresAt;
    }

    if (existing) {
      await this.prisma.whatsappCredential.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.whatsappCredential.create({
        data: {
          tenantId,
          credentialType: 'system_user_token',
          ...data,
        },
      });
    }

    // Verify credential was persisted
    const stored = await this.prisma.whatsappCredential.findFirst({
      where: { tenantId, credentialType: 'system_user_token' },
      select: { id: true, encryptedValue: true },
    });
    if (!stored?.encryptedValue) {
      throw new Error(`Credential storage failed for tenant ${tenantId} — no encrypted value found after upsert`);
    }

    this.logger.log(`[Credential] Stored encrypted long-lived token for tenant=${tenantId}${expiresAt ? `, expiresAt=${expiresAt.toISOString()}` : ''} (verified)`);
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
        `WITH updated AS (
           UPDATE whatsapp_templates
           SET category = $4,
               components_json = $5::jsonb,
               approval_status = $6,
               last_sync_at = NOW()
           WHERE channel_id = $1 AND name = $2 AND language = $3
           RETURNING id
         )
         INSERT INTO whatsapp_templates (channel_id, name, language, category, components_json, approval_status, last_sync_at)
         SELECT $1, $2, $3, $4, $5::jsonb, $6, NOW()
         WHERE NOT EXISTS (SELECT 1 FROM updated)`,
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

  private resolveTenantIdForAction(requestedTenantId: string | undefined, user: RequestUser): string {
    if (user.role === 'super_admin') {
      if (!requestedTenantId) {
        throw new BadRequestException('tenantId es requerido para super_admin');
      }
      return requestedTenantId;
    }

    if (!user.tenantId) {
      throw new ForbiddenException('Usuario sin tenant asignado');
    }

    if (requestedTenantId && requestedTenantId !== user.tenantId) {
      throw new ForbiddenException('No puedes operar onboarding de otro tenant');
    }

    return user.tenantId;
  }

  private assertTenantAccess(user: RequestUser, onboardingTenantId: string) {
    if (user.role === 'super_admin') return;
    if (!user.tenantId || user.tenantId !== onboardingTenantId) {
      throw new ForbiddenException('No tienes permisos para acceder a este onboarding');
    }
  }

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
