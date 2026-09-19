import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  MetaGraphService,
  MetaApiError,
  MetaReadFailure,
  WabaInfo,
  TokenDebugInfo,
  META_RATE_LIMITED_USER_MESSAGE,
  classifyMetaReadFailure,
} from '../meta-graph/meta-graph.service';
import { AuditService } from '../audit/audit.service';
import { StartOnboardingDto } from './dto/start-onboarding.dto';
import { Cron } from '@nestjs/schedule';
import {
  OnboardingStatus,
  OnboardingMode,
  IN_PROGRESS_STATUSES,
  TERMINAL_STATUSES,
} from '../../common/enums/onboarding-status.enum';
import {
  OnboardingErrorCode,
  ONBOARDING_GATE_CODES,
  isRelaunchableFailure,
  isServerResumableFailure,
} from '../../common/enums/onboarding-error.enum';
import { disconnectedCoveragePhoneIds, liveCoverageWabaIds } from './live-coverage-wabas';
import {
  WHATSAPP_SIGNUP_WARNING_CODES,
  whatsAppSignupWarningCodes,
  type WhatsAppSignupWarningCode,
} from '@parallext/shared';
import * as crypto from 'crypto';

interface RequestUser {
  sub: string;
  role: string;
  tenantId?: string;
}

// ═══ THE BILLING FACTS META GAVE US, WRITTEN WHERE THE MONEY ENGINE READS THEM ═══
//
// The API's spend admission refuses every WhatsApp send with `timezone_missing`
// while `channel_accounts.waba_timezone` is NULL — in `observe` AND in
// `enforce` — and the normal dispatch always passes that gate. The manual
// connection (apps/api WhatsappConnectionService.saveConnection) keeps Meta's
// `timezone_id` and currency as evidence on the row; Embedded Signup, the road
// the dashboard actually uses, wrote neither, so its numbers were born mute.
//
// What Meta returns is `timezone_id`: an INTEGER from Facebook's own table, not
// an IANA zone, and the platform deliberately ships no table from memory
// (apps/api waba-timezone-authority.ts). So this writes exactly what is known
// and nothing more:
//
//   · `metadata.metaTimezoneId` — Meta's numeric id, as evidence, so a person's
//     one-field confirmation can later carry to every number reporting it.
//   · `waba_timezone` — only when another number of the SAME tenant, on the
//     SAME WABA, reporting the SAME numeric id already has a confirmed zone
//     (`same_waba_same_id`, the authority's second kind of evidence: Meta's
//     zone belongs to the WABA, so this reads one fact twice). Otherwise NULL,
//     logged, and left to the owner's confirmation. Never a default.
//   · a zone ALREADY on a reconnected row survives only while this connection
//     is the account it was confirmed for — same WABA, same Meta id
//     (`zoneStillConfirmedFor`). Reconnected to another WABA, or Meta now
//     reporting another id, it is cleared rather than kept beside the new
//     account's ids, where it would read as confirmed for them and be carried
//     to that account's next number. For the same reason a sibling whose zone
//     evidence names another account is never a donor.
//   · `metadata.billingCurrencyEvidence` — Meta's billing currency with its
//     source and date (`meta_waba`), the shape the currency authority accepts.
//
// TWIN: apps/api waba-timezone-authority.ts `resolveZone` (inheritance rule)
// and waba-currency-authority.ts `currencyFromMeta` (evidence shape). Change
// both.

/**
 * The CHECK `channel_accounts_waba_timezone_iana` (migration
 * 20260910120000_add_whatsapp_spend_ledger), verbatim: a value that fails it
 * would abort the routing write this runs inside, so nothing that fails it is
 * ever offered to the column.
 */
const WABA_TIMEZONE_CHECK = /^(UTC|[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+_.-]+)+)$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

/** An IANA zone the column accepts AND the runtime can format with, or null. */
export function usableBillingZone(candidate: unknown): string | null {
  const zone = String(candidate ?? '').trim();
  if (!zone || !WABA_TIMEZONE_CHECK.test(zone)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** Meta's numeric `timezone_id` as reported, or null. Never a zone. */
export function metaTimezoneIdOf(waba: Pick<WabaInfo, 'timezoneId'> | null | undefined): string | null {
  const id = String(waba?.timezoneId ?? '').trim();
  return id ? id : null;
}

/** Twin of apps/api `currencyFromMeta`: a code with its source and date, or null. */
export function billingCurrencyEvidenceFromMeta(currency: unknown, wabaId: string, now: Date = new Date()): {
  currency: string; source: 'meta_waba'; observedAt: string; wabaId: string;
} | null {
  const code = String(currency ?? '').trim().toUpperCase();
  if (!CURRENCY_CODE.test(code)) return null;
  return { currency: code, source: 'meta_waba', observedAt: now.toISOString(), wabaId };
}

/** Meta's numeric id in one spelling (`"12"`, `12` and `" 12 "` are one id), or null. */
function normalizeTimezoneId(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? String(numeric) : raw;
}

/**
 * The WhatsApp Business Account and Meta timezone id a row's zone was
 * confirmed FOR: the ones its evidence names, and — for a zone with no
 * evidence, or evidence that predates those fields — the ones the row itself
 * recorded. `null` = not known, which is never read as a change.
 */
export function zoneConfirmedFor(metadata: unknown): { wabaId: string | null; timezoneId: string | null } {
  const row = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
  const evidence = (row.wabaTimezoneEvidence && typeof row.wabaTimezoneEvidence === 'object'
    ? row.wabaTimezoneEvidence : {}) as Record<string, unknown>;
  const wabaId = String(evidence.wabaId ?? '').trim() || String(row.wabaId ?? '').trim();
  return {
    wabaId: wabaId || null,
    timezoneId: normalizeTimezoneId(evidence.timezoneId) ?? normalizeTimezoneId(row.metaTimezoneId),
  };
}

/**
 * Whether a zone confirmed for `confirmed` still answers for `account`.
 *
 * Meta's zone belongs to the WABA, and its numeric id is the WABA's own
 * report of it: a different WABA, or the same WABA now reporting a different
 * id, is an account nobody confirmed this zone for. What is unknown on either
 * side (no evidence, no id reported this time) is not a change.
 */
export function zoneStillConfirmedFor(
  confirmed: { wabaId: string | null; timezoneId: string | null },
  account: { wabaId: string | null; timezoneId: unknown },
): boolean {
  if (confirmed.wabaId && account.wabaId && confirmed.wabaId !== account.wabaId) return false;
  const reported = normalizeTimezoneId(account.timezoneId);
  return !(confirmed.timezoneId && reported && confirmed.timezoneId !== reported);
}

export interface BillingZoneSibling {
  accountId: string;
  wabaTimezone: string | null;
  metadata: unknown;
}

export type BillingZoneDecision =
  | { kind: 'inherited'; zone: string; from: string }
  | { kind: 'meta_no_timezone' }
  | { kind: 'unconfirmed_timezone_id' }
  | { kind: 'contradictory'; zones: string[] };

/**
 * The zone a newly connected number may be born with, given the tenant's other
 * WhatsApp numbers. Twin of `resolveZone` for a number with no zone of its own.
 */
export function decideBillingZone(
  target: { accountId: string; wabaId: string; timezoneId: string | null },
  siblings: readonly BillingZoneSibling[],
): BillingZoneDecision {
  if (!target.timezoneId) return { kind: 'meta_no_timezone' };
  const family = siblings.filter((sibling) => {
    const metadata = (sibling.metadata ?? {}) as Record<string, unknown>;
    return sibling.accountId !== target.accountId
      && !!target.wabaId && metadata.wabaId === target.wabaId
      && String(metadata.metaTimezoneId ?? '') === target.timezoneId
      && usableBillingZone(sibling.wabaTimezone) !== null
      // A zone whose evidence names another WABA or another Meta id was
      // confirmed for an account this row is no longer on (it was kept across
      // a reconnect): carrying it would be passing on a zone nobody confirmed.
      && zoneStillConfirmedFor(zoneConfirmedFor(metadata), {
        wabaId: String(metadata.wabaId ?? '') || null, timezoneId: metadata.metaTimezoneId,
      });
  });
  const zones = [...new Set(family.map((sibling) => usableBillingZone(sibling.wabaTimezone) as string))].sort();
  if (zones.length > 1) return { kind: 'contradictory', zones };
  if (zones.length === 1) {
    const donor = family.find((sibling) => usableBillingZone(sibling.wabaTimezone) === zones[0])!;
    return { kind: 'inherited', zone: zones[0], from: donor.accountId };
  }
  return { kind: 'unconfirmed_timezone_id' };
}

/**
 * Marca una excepción cuyo fallo YA quedó registrado (fila FAILED + auditoría).
 *
 * El incidente del 16-sep-2026 fue exactamente este: `startOnboarding`
 * envolvía en su try/catch la llamada a `continueOnboardingFromDiscovery`, que
 * ya había registrado su propio fallo, y la segunda pasada pisaba el código y
 * el mensaje con "Bad Request Exception". La estructura ya no anida los dos
 * catch; la marca es el cinturón por si alguien vuelve a hacerlo.
 */
const ONBOARDING_FAILURE_RECORDED = Symbol('onboardingFailureRecorded');

const GENERIC_ONBOARDING_FAILURE_MESSAGE =
  'No pudimos completar la conexión con WhatsApp. Intenta de nuevo en unos minutos y, si se repite, escríbenos a soporte.';

/**
 * Campos del cuerpo de una HttpException que pueden viajar al panel junto al
 * código: identificadores del propio tenant que ayudan a decir QUÉ falló. Nada
 * de texto libre, y nunca pueden renombrar `code`, `userMessage`, `retryable`
 * u `onboardingId`.
 */
const SAFE_FAILURE_EXTRAS = ['wabaId', 'targetWabaId', 'existingOnboardingId'] as const;

interface DescribedOnboardingFailure {
  code: string;
  userMessage: string;
  status: number;
  extras: Record<string, string>;
}

/**
 * The number being connected is in a business account the credential that
 * other live numbers depend on cannot read. Shared by COVERAGE_REQUIRED and
 * MISSING_WABA_SCOPE, which since the target has its own code are only ever
 * about ANOTHER, already-connected number. Neither is relaunchable: the same
 * Meta portfolio hands back the same access, so the text names the two ways
 * out and never says "try again".
 */
const OTHER_CONNECTED_NUMBER_MESSAGE =
  'Este número pertenece a otra cuenta de negocio en Meta, distinta a la de un número que ya tienes conectado, y no podemos atender los dos a la vez. Desconecta primero el número que ya tienes conectado o escríbenos a soporte para ayudarte.';

/**
 * Meta did not grant the number being connected. The Meta window lets the
 * person choose the business account and tick the numbers to share, and a
 * number left unticked comes back exactly like this — so here, unlike the
 * message above, opening the window again IS the way out.
 */
const TARGET_NOT_GRANTED_MESSAGE =
  'Meta no nos dio acceso al número que quieres conectar. Abre otra vez la ventana de Meta, elige la cuenta de negocio donde está ese número y márcalo. Si se repite, escríbenos a soporte.';

/**
 * Meta did not answer a coverage probe (no response, 5xx): nothing was learned
 * about access, so nothing is decided and nothing is written. The failure code
 * is server-resumable, so `retryOnboarding` runs the same attempt again with the
 * stored token. Same words as the API twin's WHATSAPP_COVERAGE_CHECK_UNAVAILABLE.
 */
const COVERAGE_CHECK_UNAVAILABLE_MESSAGE =
  'No pudimos confirmar el acceso con Meta en este momento. Intenta de nuevo en unos minutos.';

/**
 * The error `assertTokenCoverage` throws when a probe got no real answer from
 * Meta. Every other failure it throws is a coverage verdict (409).
 */
const isCoverageCheckUnavailable = (error: unknown): error is MetaApiError =>
  error instanceof MetaApiError && error.retryable;

/**
 * Rotation states a stored credential may still sign with: the same set and
 * the same reading (trim + lower-case, a missing state reads as `active`) as
 * `USABLE_ROTATION_STATES` / `assessCredential` in
 * apps/api/src/modules/channels/connection-usability.ts. This service cannot
 * import from the API, so the rule is copied — change both.
 *
 * Why it matters to onboarding: the retain rule never looked at the state. A
 * REVOKED permanent token that still read every WABA was retained, and storing
 * it back wrote `rotation_state='active'` on it — reactivating a token someone
 * revoked on purpose. One that did not cover refused a good new authorization.
 */
const USABLE_ROTATION_STATES: ReadonlySet<string> = new Set(['active']);

const normalizedRotationState = (rotationState: unknown): string =>
  String(rotationState ?? 'active').trim().toLowerCase();

/**
 * Códigos estables de advertencia de un onboarding COMPLETED_WITH_WARNINGS.
 *
 * Hasta acá el servicio solo devolvía los textos unidos por ' | ' en
 * `errorMessage`, un campo que el panel muestra únicamente cuando algo FALLÓ:
 * un onboarding con advertencias se veía como un éxito limpio y el dueño se
 * enteraba semanas después de que su negocio nunca se verificó o de que los
 * webhooks no quedaron suscritos. Con códigos, el panel traduce cada
 * advertencia y dice qué hacer.
 *
 * El catálogo vive en @parallext/shared (`WHATSAPP_SIGNUP_WARNING_CODES`)
 * porque la API también lo lee: devuelve la última advertencia persistida de
 * cada número en `GET /channels/whatsapp/status`, y una lista propia en cada
 * servicio dejaba caer en silencio el código que uno escribiera y el otro no
 * conociera.
 */
export const WHATSAPP_ONBOARDING_WARNING_CODES = WHATSAPP_SIGNUP_WARNING_CODES;

export type WhatsappOnboardingWarningCode = WhatsAppSignupWarningCode;

// ═══ STEP 8: A NUMBER META DID NOT REGISTER CANNOT SEND ═══
//
// Step 8 used to swallow every registration error as "may already be
// registered". Some are — and some are a number that will never send a word:
// Meta refused it, and the owner read "Conectado". The error alone cannot tell
// the two apart: Meta documents no "already registered" code for
// `POST /{phone-number-id}/register`, and a two-step PIN that no longer
// matches (133005) comes back the same whether the number is registered today
// or was deregistered last week. What does tell them apart is Meta's own
// reading of the number: "business phone numbers must have a status of
// connected in order to send and receive messages via the API". So:
//
//   · registration answered success          → registered;
//   · it failed, and Meta reads CONNECTED (or a quality state only a
//     registered number can be in)           → already registered, fine;
//   · it failed, and Meta reads anything else, or nothing could be read
//                                            → not registered: the signup
//     finishes with `phone_registration_deferred`, and the panel says the
//     agent cannot answer on it. Unknown is never read as registered.
//
// Meta's error code is kept as evidence (logs, audit) and says only WHICH kind
// of failure it was. Nothing re-registers the number afterwards, so even a
// "try later" code leaves it unregistered until somebody acts.

/**
 * Graph codes Meta's reference answers with "wait, then try again" on
 * registration: 133004 server temporarily unavailable, 133008/133009 two-step
 * PIN guessed too often / too fast, 133015 number recently deleted, 133016
 * register/deregister rate limit. Plus the platform's throttling codes.
 */
const REGISTRATION_RETRY_LATER_CODES: ReadonlySet<number> = new Set([
  133004, 133008, 133009, 133015, 133016, 4, 17, 32, 613, 130429,
]);

/**
 * Meta's phone statuses that exist only for a number already registered on the
 * platform: CONNECTED (sends), and the quality / throughput states Meta puts a
 * registered number in (FLAGGED, RESTRICTED, RATE_LIMITED). Those constrain
 * what it sends and have their own surfaces; none of them is a registration
 * problem. PENDING, DISCONNECTED, UNVERIFIED, DELETED, BANNED, MIGRATED,
 * UNKNOWN — or no status at all — are not a registered number.
 */
const REGISTERED_PHONE_STATUSES: ReadonlySet<string> = new Set(['CONNECTED', 'FLAGGED', 'RESTRICTED', 'RATE_LIMITED']);

/** What Meta said when a Graph call failed, from a MetaApiError or a raw Axios error. */
export interface MetaGraphErrorFacts {
  httpStatus: number | null;
  code: number | null;
  subcode: number | null;
  message: string | null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : null;
}

export function metaGraphErrorFacts(error: unknown): MetaGraphErrorFacts | null {
  if (!error || typeof error !== 'object') return null;
  const source = (error as any).originalError ?? error;
  const graph = source?.response?.data?.error;
  return {
    httpStatus: numberOrNull(source?.response?.status),
    code: numberOrNull(graph?.code),
    subcode: numberOrNull(graph?.error_subcode),
    message: typeof graph?.message === 'string' ? graph.message
      : typeof (error as any).message === 'string' ? (error as any).message : null,
  };
}

export type PhoneRegistrationOutcome =
  | { kind: 'registered' }
  | { kind: 'already_registered'; phoneStatus: string; graph: MetaGraphErrorFacts | null }
  | {
    kind: 'not_registered';
    /** Meta's reading of the number, or null when it could not be read. */
    phoneStatus: string | null;
    graph: MetaGraphErrorFacts | null;
    /** Meta's code says to wait and retry. Nothing retries it by itself. */
    retryLater: boolean;
  };

/** What step 8 established about the number. See the section above. */
export function classifyPhoneRegistration(input: {
  /** `registerPhoneNumber` resolved with `true` (Meta answered `success: true`). */
  registered: boolean;
  /** What it threw, when it threw. */
  error?: unknown;
  /** Meta's `status` for this phone number, as last read. */
  phoneStatus?: unknown;
}): PhoneRegistrationOutcome {
  if (input.registered) return { kind: 'registered' };
  const graph = input.error === undefined ? null : metaGraphErrorFacts(input.error);
  const status = typeof input.phoneStatus === 'string' && input.phoneStatus.trim()
    ? input.phoneStatus.trim().toUpperCase() : null;
  if (status && REGISTERED_PHONE_STATUSES.has(status)) return { kind: 'already_registered', phoneStatus: status, graph };
  const retryLater = !!graph && ((graph.code !== null && REGISTRATION_RETRY_LATER_CODES.has(graph.code))
    || (graph.httpStatus !== null && (graph.httpStatus === 429 || graph.httpStatus >= 500)));
  return { kind: 'not_registered', phoneStatus: status, graph, retryLater };
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
    this.logger.log(
      `[Onboarding] START for tenant=${tenantId}, mode=${dto.mode}, ` +
      `sessionBusinessId=${dto.businessId || 'none'}, sessionWabaId=${dto.wabaId || 'none'}, ` +
      `sessionPhoneNumberId=${dto.phoneNumberId || 'none'}`,
    );

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
        // Persist session identifiers immediately so a retry after token exchange
        // keeps the Business Portfolio separate from the WABA.
        metaBusinessId: dto.businessId,
        wabaId: dto.wabaId,
        phoneNumberId: dto.phoneNumberId,
        codeReceivedAt: new Date(),
      },
    });

    this.logger.log(`[Onboarding] Record created: ${onboarding.id}`);

    // This try covers ONLY the code exchange and its persistence. The rest of
    // the flow runs outside it because `continueOnboardingFromDiscovery`
    // records its own failures: wrapping it here recorded every one of them
    // twice, and the second pass overwrote the real code with the text of the
    // exception the first pass had thrown.
    let longLivedToken: string;
    let longLivedExpiresIn: number;
    try {
      // ---- 3. Exchange code → SHORT-LIVED user token ----
      await this.updateStatus(onboarding.id, OnboardingStatus.EXCHANGE_IN_PROGRESS);
      this.logger.log(`[Onboarding][${onboarding.id}] Step 3: Exchanging OAuth code for short-lived token`);

      const exchangeResult = await this.metaGraph.exchangeOnboardingCode(dto.code, dto.configId);

      this.logger.log(`[Onboarding][${onboarding.id}] Short-lived token obtained (type=${exchangeResult.tokenType}, expiresIn=${exchangeResult.expiresIn || 'unknown'})`);

      // ---- 4. Convert to LONG-LIVED token ----
      this.logger.log(`[Onboarding][${onboarding.id}] Step 4: Converting short-lived token to long-lived token`);

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
    } catch (error: any) {
      return this.handleOnboardingFailure(error, onboarding.id, tenantId, userId);
    }

    // Continue from step 5 onward with the long-lived token. Outside the try on
    // purpose: this call records its own failures exactly once.
    return this.continueOnboardingFromDiscovery(
      onboarding.id, tenantId, userId, longLivedToken, longLivedExpiresIn, dto,
    );
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
    dto: Pick<StartOnboardingDto, 'businessId' | 'phoneNumberId' | 'wabaId' | 'mode'>,
  ) {
    try {
      // ---- 5. Debug/validate token ----
      this.logger.log(`[Onboarding][${onboardingId}] Step 5: Debugging/validating long-lived token`);
      let tokenDebugData: any = null;
      try {
        const tokenDebug = await this.metaGraph.debugToken(longLivedToken);
        tokenDebugData = tokenDebug;
        this.logger.log(`[Onboarding][${onboardingId}] Token debug: valid=${tokenDebug.isValid}, type=${tokenDebug.type}, scopes=[${tokenDebug.scopes?.join(', ')}], expiresAt=${tokenDebug.expiresAt}`);
        if (tokenDebug.granularScopes) {
          this.logger.log(`[Onboarding][${onboardingId}] Granular scopes: ${JSON.stringify(tokenDebug.granularScopes)}`);
        }
      } catch (debugError: any) {
        this.logger.warn(`[Onboarding][${onboardingId}] Token debug call failed (non-blocking): ${debugError.message}`);
      }

      // ---- 5b. Classify what the Embedded Signup token IS ----
      // Outside the non-blocking debug try on purpose: a token that belongs to
      // the provider must stop the flow, not be logged and stored.
      const esuTokenExpiresIn = this.classifyEmbeddedSignupToken(
        onboardingId, tokenDebugData, longLivedExpiresIn,
      );

      // ---- 6. Discover WABA and phone number ----
      await this.updateStatus(onboardingId, OnboardingStatus.ASSET_DISCOVERY_IN_PROGRESS);

      let wabaId: string;
      let waba: WabaInfo;
      let primaryPhone: any;
      let businessId = dto.businessId;
      let businessIdSource = businessId ? 'session_info' : 'unresolved';
      let wabaSource = dto.wabaId ? 'session_info' : 'api_discovery';
      const usedSessionInfo = !!(dto.phoneNumberId && dto.wabaId);

      if (dto.wabaId) {
        // Session info provides WABA ID — use it directly for WABA discovery.
        // /me/businesses may still be used later solely to resolve its parent portfolio.
        wabaId = dto.wabaId;
        this.logger.log(`[Onboarding][${onboardingId}] Step 6: Using session info WABA ID=${wabaId}`);

        try {
          waba = await this.metaGraph.getWabaDirectly(wabaId, longLivedToken);
        } catch (wabaError: any) {
          this.logger.warn(`[Onboarding][${onboardingId}] Direct WABA fetch failed, falling back to discovery: ${wabaError.message}`);
          waba = await this.discoverWabaViaApi(longLivedToken, wabaId);
          wabaId = waba.id;
          wabaSource = 'api_discovery';
        }
      } else {
        // No session info — try extracting WABA from token scopes first, then /me/businesses
        let scopeWabaId: string | null = null;
        if (tokenDebugData?.granularScopes) {
          const wbmScope = tokenDebugData.granularScopes.find((s: any) => s.scope === 'whatsapp_business_management');
          if (wbmScope?.target_ids?.length > 0) {
            scopeWabaId = wbmScope.target_ids[0];
            this.logger.log(`[Onboarding][${onboardingId}] Step 6: Extracted WABA ID from token scopes: ${scopeWabaId}`);
          }
        }

        if (scopeWabaId) {
          wabaId = scopeWabaId;
          wabaSource = 'token_scope';
          try {
            waba = await this.metaGraph.getWabaDirectly(wabaId, longLivedToken);
          } catch (e: any) {
            this.logger.warn(`[Onboarding][${onboardingId}] Direct WABA fetch failed: ${e.message}`);
            waba = { id: wabaId, name: 'WhatsApp Business Account' };
          }
        } else {
          this.logger.log(`[Onboarding][${onboardingId}] Step 6: No session info — falling back to /me/businesses discovery`);
          waba = await this.discoverWabaViaApi(longLivedToken);
          wabaId = waba.id;
        }
      }

      // /me/businesses is the authoritative correlation between a WABA and its
      // parent Business Portfolio. Validate session_info when possible so a
      // stale or manually forged browser payload cannot bind the wrong portfolio.
      let correlatedBusinessId = waba.businessId;
      if (!correlatedBusinessId) {
        try {
          const discoveredWaba = await this.discoverWabaViaApi(longLivedToken, wabaId);
          correlatedBusinessId = discoveredWaba.businessId;
        } catch (businessDiscoveryError: any) {
          // Session WABA + phone identifiers are sufficient to finish onboarding.
          // If Meta does not expose /me/businesses, keep the Embedded Signup
          // event value when present and skip verification only when neither is known.
          this.logger.warn(
            `[Onboarding][${onboardingId}] Could not correlate Business Portfolio for WABA ${wabaId} ` +
            `(non-blocking): ${businessDiscoveryError.message}`,
          );
        }
      }

      if (correlatedBusinessId) {
        if (businessId && businessId !== correlatedBusinessId) {
          this.logger.warn(
            `[Onboarding][${onboardingId}] Session Business ID ${businessId} does not match ` +
            `portfolio ${correlatedBusinessId} correlated to WABA ${wabaId}; using the correlated portfolio`,
          );
        }
        businessIdSource = businessId === correlatedBusinessId
          ? 'session_info_validated'
          : 'api_discovery';
        businessId = correlatedBusinessId;
      }

      this.logger.log(
        `[Onboarding][${onboardingId}] Resolved Meta assets: businessId=${businessId || 'unresolved'}, ` +
        `wabaId=${wabaId}, wabaName=${waba.name}, businessIdSource=${businessIdSource}, ` +
        `wabaSource=${wabaSource}`,
      );

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
      // Never fatal: the connection is still worth finishing. But a number
      // Meta did not register cannot send, so that ends as a warning the
      // panel shows (`phone_registration_deferred`), not as a log line.
      this.logger.log(`[Onboarding][${onboardingId}] Step 8: Registering phone number ${primaryPhone.id} with Meta`);
      const phoneRegistration = await this.registerPhoneForCloudApi(
        onboardingId, primaryPhone, wabaId, longLivedToken,
      );

      await this.prisma.whatsappOnboarding.update({
        where: { id: onboardingId },
        data: {
          status: OnboardingStatus.ASSETS_DISCOVERED,
          metaBusinessId: businessId || null,
          wabaId,
          phoneNumberId: primaryPhone.id,
          displayPhoneNumber: primaryPhone.displayPhoneNumber,
          verifiedName: primaryPhone.verifiedName,
          assetsSyncedAt: new Date(),
        },
      });

      this.logger.log(
        `[Onboarding][${onboardingId}] Assets discovered: Business=${businessId || 'unresolved'}, ` +
        `WABA=${wabaId}, Phone=${primaryPhone.id}, businessSource=${businessIdSource}, wabaSource=${wabaSource}`,
      );

      // Gate quota before any channel or credential mutation. Previously the
      // tenant-schema row was inserted first and a later quota rejection left a
      // number that looked connected but had no public routing account.
      await this.assertChannelAccountQuotaViaApi(tenantId, 'whatsapp', primaryPhone.id);

      // ---- 9. Resolve a credential that covers ALL connected WABAs ----
      let finalToken = longLivedToken;
      // 0 when step 5b established that the Embedded Signup token itself never
      // expires; the long-lived window otherwise.
      let finalExpiresIn = esuTokenExpiresIn;
      try {
        this.logger.log(`[Onboarding][${onboardingId}] Step 11a: Attempting System User Token generation for WABA=${wabaId}`);
        const systemUserResult = await this.metaGraph.generateSystemUserToken(wabaId, longLivedToken);
        if (systemUserResult) {
          finalToken = systemUserResult.accessToken;
          finalExpiresIn = 0; // permanent — no expiry
          this.logger.log(`[Onboarding][${onboardingId}] System User Token generated — permanent, no expiry`);
        } else {
          this.logger.log(`[Onboarding][${onboardingId}] System User Token not available — using the Embedded Signup token (expiresIn=${esuTokenExpiresIn}s)`);
        }
      } catch (sysUserError: any) {
        this.logger.warn(`[Onboarding][${onboardingId}] System User Token failed (non-blocking): ${sysUserError.message}`);
      }

      const usableCredential = await this.resolveCredentialForCoverage(
        tenantId,
        wabaId,
        finalToken,
        finalExpiresIn,
      );
      finalToken = usableCredential.accessToken;
      finalExpiresIn = usableCredential.expiresInSeconds;
      this.logger.log(`[Onboarding][${onboardingId}] Step 9b: Storing coverage-verified credential (expiresIn=${finalExpiresIn}s)`);
      // The WHOSE, written beside the token while it is still known.
      //
      // `credential_type` says `system_user_token`, and two different things
      // live under that name: a Business Integration System User minted for
      // ONE client through Embedded Signup, and the provider's own System
      // User token. Signing a tenant's message with the second attributes it
      // to the provider and bills another portfolio. The guard that refuses
      // that exists in `channel-token.service.ts` and could never fire,
      // because nothing had ever written the evidence it reads.
      //
      // This is the one place the evidence exists: the token came through
      // this flow, for this client's own WABA, and `businessId` above was
      // correlated against that WABA rather than taken on the session's word.
      // Written only when that correlation produced something — an
      // unresolved business id leaves the row NULL, which is the third state
      // the column exists for and NOT a claim that the credential is the
      // provider's.
      // Stamped ONLY on a token this flow obtained, and only when the business
      // id was CORRELATED against the WABA rather than taken from the browser.
      //
      // Two holes the review found here, both of which made the write assert
      // more than was known. `resolveCredentialForCoverage` can RETAIN the
      // token already in the table — this flow did not obtain it and knows
      // nothing about whose portfolio it is — and `businessId` falls back to
      // `dto.businessId`, the value the client posted, whenever discovery is
      // unavailable. The qualifier was logged and never persisted, so a
      // session-supplied id became verified provenance.
      const provenanceEstablished = usableCredential.minted
        && !!businessId && businessIdSource !== 'session_info';
      if (!provenanceEstablished) {
        this.logger.log(`[Onboarding][${onboardingId}] provenance NOT recorded `
          + `(minted=${usableCredential.minted}, businessSource=${businessIdSource}) — the `
          + 'credential stays unverified, which still sends');
      }
      await this.storeEncryptedCredential(tenantId, finalToken, finalExpiresIn,
        provenanceEstablished
          ? { ownerBusinessId: businessId as string, source: businessIdSource }
          : null,
        { minted: usableCredential.minted });

      // ---- 10-11. Persist channel + routing only after entitlement and token
      // coverage have both passed (CRITICAL — any failure aborts onboarding). ----
      this.logger.log(`[Onboarding][${onboardingId}] Step 10: Persisting WhatsApp channel in tenant schema`);
      await this.persistWhatsAppChannel(
        tenantId,
        onboardingId,
        businessId,
        waba,
        primaryPhone,
        dto.mode === OnboardingMode.COEXISTENCE,
      );

      this.logger.log(`[Onboarding][${onboardingId}] Step 11: Registering channel_account for webhook routing`);
      await this.registerChannelAccount(tenantId, primaryPhone, wabaId, businessId, waba);

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

        // Coexistence mode: log that additional webhook fields are expected.
        // Meta automatically sends history, smb_message_echoes, and smb_app_state_sync
        // webhooks when the phone is onboarded with featureType='whatsapp_business_app_onboarding'.
        // The fields are configured in Meta App Dashboard > WhatsApp > Configuration.
        if (dto.mode === OnboardingMode.COEXISTENCE) {
          this.logger.log(
            `[Onboarding][${onboardingId}] Coexistence mode — expecting additional webhook fields: ` +
            `history, smb_message_echoes, smb_app_state_sync`,
          );
        }
      } else {
        this.logger.warn(`[Onboarding][${onboardingId}] Webhook subscription returned false — may need manual verification`);
      }

      // ---- 13. Check business verification status ----
      let businessVerified: boolean | null = null;
      let businessVerificationStatus = 'not_checked';
      let verificationWarning: string | null = null;
      if (businessId) {
        this.logger.log(
          `[Onboarding][${onboardingId}] Step 13: Checking business verification status ` +
          `for Business Portfolio=${businessId} (WABA=${wabaId})`,
        );
        try {
          // The freshly exchanged user token owns the customer's authorization.
          // A generated System User token only has WhatsApp scopes and may not
          // be allowed to read the parent Business Portfolio.
          businessVerificationStatus = await this.metaGraph.getBusinessVerificationStatus(
            businessId,
            longLivedToken,
          );
          businessVerified = businessVerificationStatus === 'verified';
          this.logger.log(
            `[Onboarding][${onboardingId}] Business Portfolio ${businessId} verification status: ` +
            `${businessVerificationStatus}`,
          );
          if (!businessVerified) {
            verificationWarning = 'La verificación del negocio en Meta aún no está completa. Algunas funciones pueden estar limitadas hasta que se verifique.';
            this.logger.warn(`[Onboarding][${onboardingId}] Business NOT verified — will set COMPLETED_WITH_WARNINGS`);
          }
        } catch (verifyError: any) {
          businessVerificationStatus = 'check_failed';
          this.logger.warn(`[Onboarding][${onboardingId}] Business verification check failed (non-blocking): ${verifyError.message}`);
        }
      } else {
        this.logger.warn(
          `[Onboarding][${onboardingId}] Step 13: Skipping business verification because no Business Portfolio ID ` +
          `was returned for WABA=${wabaId}`,
        );
      }

      // ---- 14. Sync templates en background (no bloquea) ----
      this.logger.log(`[Onboarding][${onboardingId}] Step 14: Starting background template sync for WABA=${wabaId}`);
      this.syncTemplatesInBackground(tenantId, wabaId, finalToken, onboardingId);

      // ---- 15. Marcar completado ----
      const warnings: string[] = [];
      const warningCodes: WhatsappOnboardingWarningCode[] = [];
      // First: while it stands nothing is sent from the number, whatever else holds.
      if (phoneRegistration.kind === 'not_registered') {
        warnings.push('Meta no registró el número en la API de WhatsApp — no puede enviar mensajes hasta completarlo');
        warningCodes.push('phone_registration_deferred');
      }
      if (!webhookSuccess) {
        warnings.push('La suscripción de webhooks pudo haber fallado — verificar manualmente');
        warningCodes.push('webhook_subscription_failed');
      }
      if (!businessVerified && verificationWarning) {
        warnings.push(verificationWarning);
        warningCodes.push('business_not_verified');
      }

      const finalStatus = warnings.length > 0
        ? OnboardingStatus.COMPLETED_WITH_WARNINGS
        : OnboardingStatus.COMPLETED;

      // Los códigos se persisten junto al payload del intercambio (JSONB ya
      // existente, nunca se devuelve al cliente) para que el sondeo posterior
      // del panel siga viendo las advertencias, no solo la respuesta inmediata.
      const currentPayload = await this.prisma.whatsappOnboarding.findUnique({
        where: { id: onboardingId },
        select: { exchangePayload: true },
      });
      const basePayload = (currentPayload?.exchangePayload && typeof currentPayload.exchangePayload === 'object'
        && !Array.isArray(currentPayload.exchangePayload))
        ? currentPayload.exchangePayload as Record<string, unknown>
        : {};

      const completed = await this.prisma.whatsappOnboarding.update({
        where: { id: onboardingId },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          errorMessage: warnings.length > 0 ? warnings.join(' | ') : null,
          exchangePayload: { ...basePayload, warnings: warningCodes } as any,
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
          businessId: businessId || null,
          wabaId,
          phoneNumberId: primaryPhone.id,
          displayPhoneNumber: primaryPhone.displayPhoneNumber,
          mode: dto.mode,
          finalStatus,
          usedSessionInfo,
          businessIdSource,
          wabaSource,
          businessVerified,
          businessVerificationStatus,
          // Ids, statuses and Meta's code — never the token.
          phoneRegistration: {
            outcome: phoneRegistration.kind,
            phoneStatus: phoneRegistration.kind === 'registered' ? null : phoneRegistration.phoneStatus,
            graphCode: phoneRegistration.kind === 'registered' ? null : phoneRegistration.graph?.code ?? null,
            graphSubcode: phoneRegistration.kind === 'registered' ? null : phoneRegistration.graph?.subcode ?? null,
          },
          warnings,
        },
      });

      // Agent Quality lives in the API process. Notify it only after routing,
      // credentials and the onboarding terminal state are durably committed.
      await this.notifyAgentQualityChannelUpdated(tenantId, primaryPhone.id);

      this.logger.log(`[Onboarding][${onboardingId}] ${finalStatus} for tenant=${tenantId}${warnings.length ? ' (warnings: ' + warnings.join('; ') + ')' : ''}`);

      return this.formatOnboardingResponse(completed);

    } catch (error: any) {
      return this.handleOnboardingFailure(error, onboardingId, tenantId, userId);
    }
  }

  /**
   * Step 8: register the number for the Cloud API, and say what that
   * established (`classifyPhoneRegistration`).
   *
   * Never throws. When the registration did not answer success, Meta is asked
   * once more how it reads the number now; the reading from step 7 stands in
   * when that fails, because a refused registration changes nothing about it.
   */
  private async registerPhoneForCloudApi(
    onboardingId: string,
    phone: { id: string; status?: unknown },
    wabaId: string,
    accessToken: string,
  ): Promise<PhoneRegistrationOutcome> {
    let registered = false;
    let error: unknown;
    try {
      registered = (await this.metaGraph.registerPhoneNumber(phone.id, accessToken)) === true;
    } catch (registrationError) {
      error = registrationError;
    }
    if (registered) {
      this.logger.log(`[Onboarding][${onboardingId}] Phone number registered successfully`);
      return { kind: 'registered' };
    }

    let phoneStatus: unknown = phone?.status;
    try {
      const phones = await this.metaGraph.getPhoneNumbersForWaba(wabaId, accessToken);
      const current = (phones || []).find((candidate: any) => candidate?.id === phone.id);
      if (current?.status) phoneStatus = current.status;
    } catch (readError: any) {
      this.logger.warn(`[Onboarding][${onboardingId}] Could not re-read phone ${phone.id} after its registration `
        + `failed (${readError?.message}); judging by the reading from step 7 (status=${String(phone?.status ?? 'none')})`);
    }

    const outcome = classifyPhoneRegistration({ registered, error, phoneStatus });
    const graph = outcome.kind === 'registered' ? null : outcome.graph;
    const cause = error === undefined
      ? 'Meta did not answer success'
      : `Meta error code=${graph?.code ?? 'none'} subcode=${graph?.subcode ?? 'none'} `
        + `http=${graph?.httpStatus ?? 'none'}: ${graph?.message ?? 'no message'}`;
    if (outcome.kind === 'already_registered') {
      this.logger.log(`[Onboarding][${onboardingId}] Registration of ${phone.id} was refused (${cause}), `
        + `but Meta reads the number as ${outcome.phoneStatus}: it is already registered`);
    } else if (outcome.kind === 'not_registered') {
      this.logger.warn(`[Onboarding][${onboardingId}] Phone ${phone.id} is NOT registered for the Cloud API (${cause}; `
        + `Meta reads status=${outcome.phoneStatus ?? 'unknown'}${outcome.retryLater ? '; Meta asks to retry later' : ''}): `
        + 'it cannot send, and the signup finishes with phone_registration_deferred');
    }
    return outcome;
  }

  /**
   * Discovers WABA via the /me/businesses API (backwards compat fallback).
   */
  private async discoverWabaViaApi(accessToken: string, preferredWabaId?: string): Promise<WabaInfo> {
    const wabas = await this.metaGraph.getBusinessAccountsForToken(accessToken);

    if (!wabas || wabas.length === 0) {
      throw new MetaApiError(
        OnboardingErrorCode.WABA_NOT_FOUND,
        'No se encontró ninguna cuenta de WhatsApp Business asociada. Verifica que completaste el flujo de Embedded Signup correctamente.',
        'No WABAs found via /me/businesses discovery',
        false,
      );
    }

    if (preferredWabaId) {
      const preferredWaba = wabas.find(waba => waba.id === preferredWabaId);
      if (!preferredWaba) {
        throw new MetaApiError(
          OnboardingErrorCode.WABA_NOT_FOUND,
          'No se encontró la cuenta de WhatsApp Business seleccionada en los negocios autorizados.',
          `WABA ${preferredWabaId} not found via /me/businesses discovery`,
          false,
        );
      }
      return preferredWaba;
    }

    return wabas[0];
  }

  /**
   * What the Embedded Signup token is, decided from `debug_token`.
   *
   * Returns the expiry to store: 0 (permanent) for a valid SYSTEM_USER token
   * that Meta reports as never expiring — a Business Integration System User
   * minted for this client — and the long-lived window otherwise. Before this,
   * only a token returned by `generateSystemUserToken` counted as permanent,
   * so a BISU that never expires was stored with 60 days of life (incident
   * cotes-asociados, 16-sep-2026).
   *
   * A never-expiring SYSTEM_USER whose user id is OUR configured system user is
   * the provider's own token, not the client's: signing a tenant's messages with
   * it attributes them to the provider and bills another portfolio. That fails
   * closed here, before anything is stored.
   *
   * A failed or unrecognised `debug_token` keeps today's behaviour.
   */
  private classifyEmbeddedSignupToken(
    onboardingId: string,
    debug: TokenDebugInfo | null,
    longLivedExpiresIn: number,
  ): number {
    const expiresAt: unknown = debug?.expiresAt;
    const neverExpires = (typeof expiresAt === 'number' || (typeof expiresAt === 'string' && expiresAt.trim() !== ''))
      && Number(expiresAt) === 0;
    const isPermanentSystemUser = !!debug?.isValid
      && String(debug?.type ?? '').toUpperCase() === 'SYSTEM_USER'
      && neverExpires;

    if (!isPermanentSystemUser) {
      this.logger.log(
        `[Onboarding][${onboardingId}] Token classification: ${debug ? 'long_lived' : 'unverified'} ` +
        `(type=${debug?.type ?? 'unknown'}, expiresAt=${debug?.expiresAt ?? 'unknown'}) — expiresIn=${longLivedExpiresIn}s`,
      );
      return longLivedExpiresIn;
    }

    const providerSystemUserId = String(this.config.get<string>('meta.systemUserId') ?? '').trim();
    if (providerSystemUserId && String(debug?.userId ?? '').trim() === providerSystemUserId) {
      this.logger.error(
        `[Onboarding][${onboardingId}] Token classification: provider_system_user — refusing to store a token ` +
        `that belongs to the provider's own system user`,
      );
      throw new MetaApiError(
        OnboardingErrorCode.PERMISSIONS_INSUFFICIENT,
        'Meta devolvió una credencial que no pertenece a tu negocio. Vuelve a conectar desde la ventana de Meta.',
        'Embedded Signup returned a never-expiring SYSTEM_USER token whose user_id is the configured provider system user',
        false,
      );
    }

    this.logger.log(
      `[Onboarding][${onboardingId}] Token classification: business_integration_system_user ` +
      `(type=SYSTEM_USER, expiresAt=0) — stored as permanent`,
    );
    return 0;
  }

  /**
   * What a failure means for the person: a stable code, a message written to be
   * read, and the HTTP status the dashboard maps.
   *
   * Only `MetaApiError` used to keep its code. Every Nest exception thrown by
   * this flow's own boundaries — token coverage (409), plan (400), entitlement
   * check (503) — carries `{ code, userMessage }` in its body, and all of them
   * became `WA_ES_GRAPH_API_ERROR` with the framework's English text
   * ("Conflict Exception") as the message.
   */
  private describeOnboardingFailure(error: any): DescribedOnboardingFailure {
    if (error instanceof MetaApiError) {
      return {
        code: error.code,
        userMessage: error.userMessage || GENERIC_ONBOARDING_FAILURE_MESSAGE,
        status: 400,
        extras: {},
      };
    }

    if (error instanceof HttpException) {
      const body = error.getResponse();
      if (body && typeof body === 'object' && typeof (body as any).code === 'string' && (body as any).code) {
        const record = body as Record<string, unknown>;
        const extras: Record<string, string> = {};
        for (const key of SAFE_FAILURE_EXTRAS) {
          if (typeof record[key] === 'string' && (record[key] as string).trim()) {
            extras[key] = record[key] as string;
          }
        }
        return {
          code: record.code as string,
          userMessage: typeof record.userMessage === 'string' && record.userMessage.trim()
            ? record.userMessage
            : GENERIC_ONBOARDING_FAILURE_MESSAGE,
          status: error.getStatus(),
          extras,
        };
      }
    }

    return {
      code: OnboardingErrorCode.GRAPH_API_ERROR,
      userMessage: GENERIC_ONBOARDING_FAILURE_MESSAGE,
      status: 400,
      extras: {},
    };
  }

  /**
   * Handles onboarding failure — marks the record FAILED, audits, throws.
   *
   * Exactly once per attempt: an exception this method already threw is
   * rethrown untouched, without writing, logging or auditing again.
   */
  private async handleOnboardingFailure(error: any, onboardingId: string, tenantId: string, userId: string): Promise<never> {
    if (error && typeof error === 'object' && (error as any)[ONBOARDING_FAILURE_RECORDED]) {
      throw error;
    }

    const { code, userMessage, status, extras } = this.describeOnboardingFailure(error);
    const retryable = isRelaunchableFailure(code);
    // The technical text is for the log and the audit trail. It never reaches
    // `userMessage`: a person reading "Bad Request Exception" has no next step.
    const technicalMessage = String(error?.message ?? error ?? 'unknown error');

    // `exchange_payload` holds the short- and long-lived tokens IN PLAIN TEXT
    // so `retryOnboarding` can resume without a new authorisation. For a code
    // it cannot resume, `retryOnboarding` refuses before ever reading them:
    // from here on they only sit in the table. The case that made this urgent
    // is the provider-token refusal — the token that must never be stored was
    // left stored. Same write as the FAILED mark, so there is no window where
    // the row says "failed" and still carries them. Resumable codes keep the
    // payload: that is what the resume runs on.
    const scrubbedPayload = isServerResumableFailure(code)
      ? null
      : await this.scrubbedExchangePayload(onboardingId, code);

    await this.prisma.whatsappOnboarding.update({
      where: { id: onboardingId },
      data: {
        status: OnboardingStatus.FAILED,
        errorCode: code,
        errorMessage: userMessage,
        ...(scrubbedPayload ? { exchangePayload: scrubbedPayload } : {}),
      },
    });

    this.logger.error(`[Onboarding][${onboardingId}] FAILED: ${code} (HTTP ${status}) — ${technicalMessage}`);

    await this.audit.log({
      action: 'onboarding_failed',
      tenantId,
      userId,
      entityType: 'whatsapp_onboarding',
      entityId: onboardingId,
      metadata: { errorCode: code, errorMessage: userMessage, technicalMessage, httpStatus: status, retryable },
    });

    const failure = new HttpException({
      code,
      userMessage,
      retryable,
      onboardingId,
      ...extras,
    }, status);
    Object.defineProperty(failure, ONBOARDING_FAILURE_RECORDED, { value: true, enumerable: false });
    throw failure;
  }

  /**
   * The payload to write in place of one that may hold tokens, or `null` when
   * the row has none — a failure during the code exchange must not gain a
   * payload it never had.
   *
   * Allow-list, not deny-list: only `exchangedAt` survives, so a token field
   * added to the payload later is dropped without anyone remembering this
   * method. Never logs the payload.
   */
  private async scrubbedExchangePayload(
    onboardingId: string,
    code: string,
  ): Promise<Record<string, string> | null> {
    const marker: Record<string, string> = {
      tokensScrubbedAt: new Date().toISOString(),
      scrubReason: code,
    };

    let current: unknown;
    try {
      const row = await this.prisma.whatsappOnboarding.findUnique({
        where: { id: onboardingId },
        select: { exchangePayload: true },
      });
      current = row?.exchangePayload;
    } catch (readError: any) {
      // Not knowing what is there is not a reason to leave tokens behind: the
      // marker replaces whatever it was, and the failure is still recorded.
      this.logger.warn(`[Onboarding][${onboardingId}] Could not read exchange payload before scrubbing (${readError?.message}) — overwriting it`);
      return marker;
    }

    if (current === null || current === undefined) return null;

    const exchangedAt = current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>).exchangedAt
      : undefined;
    return typeof exchangedAt === 'string' ? { exchangedAt, ...marker } : marker;
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
        metaBusinessId: true,
        wabaId: true,
        completedAt: true,
        // OJO: trae el token de larga duración. Se saca del spread a propósito
        // (abajo) y de él solo se derivan los códigos de advertencia — nunca
        // debe viajar al cliente.
        exchangePayload: true,
      },
    });
    if (!onboarding) throw new NotFoundException('Onboarding no encontrado');
    this.assertTenantAccess(user, onboarding.tenantId);
    const { metaBusinessId, exchangePayload, ...status } = onboarding;
    return {
      ...status,
      businessId: metaBusinessId,
      warnings: this.extractWarningCodes(exchangePayload),
    };
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

    // Besides transient errors, the gate failures an operator or a plan change
    // fixes without the client authorising again (WABA access granted, dead
    // number disconnected, plan upgraded, entitlement check back) resume here
    // with the stored token.
    if (onboarding.errorCode && !isServerResumableFailure(onboarding.errorCode)) {
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
        businessId: onboarding.metaBusinessId || null,
        wabaId: onboarding.wabaId || null,
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
        businessId: onboarding.metaBusinessId || undefined,
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
      await this.syncPhoneNumbersToDb(
        onboarding.tenantId,
        onboarding.metaBusinessId || undefined,
        onboarding.wabaId,
        phones,
      );
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
  // CRON: Auto-expire stuck onboardings
  // ==========================================

  /**
   * Every 10 minutes, check for onboardings stuck in IN_PROGRESS for > 30 min
   * and mark them as FAILED so users can retry.
   */
  @Cron('*/10 * * * *')
  async expireStuckOnboardings(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago

    const stuck = await this.prisma.whatsappOnboarding.findMany({
      where: {
        status: { in: IN_PROGRESS_STATUSES },
        createdAt: { lt: cutoff },
      },
    });

    if (stuck.length === 0) return;

    this.logger.warn(`[Onboarding] Found ${stuck.length} stuck onboarding(s) — auto-expiring`);

    for (const ob of stuck) {
      await this.prisma.whatsappOnboarding.update({
        where: { id: ob.id },
        data: {
          status: OnboardingStatus.FAILED,
          errorCode: 'TIMEOUT',
          errorMessage: `Onboarding expirado automaticamente (creado ${ob.createdAt.toISOString()}, status: ${ob.status})`,
          completedAt: new Date(),
        },
      });

      this.logger.warn(`[Onboarding] Expired: ${ob.id} for tenant ${ob.tenantId} (status was: ${ob.status})`);
    }
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

    // Plan gate (early): when the number id is known up-front (session flow),
    // block over-quota connections before running the whole ESU. The discovery
    // flow is gated authoritatively at registerChannelAccount.
    if (dto.phoneNumberId) {
      await this.assertChannelAccountQuotaViaApi(tenantId, 'whatsapp', dto.phoneNumberId);
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
      // Auto-expire stuck onboardings older than 30 minutes
      const ageMs = Date.now() - new Date(existingInProgress.createdAt).getTime();
      const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

      if (ageMs > TIMEOUT_MS) {
        this.logger.warn(
          `[Onboarding] Auto-expiring stuck onboarding ${existingInProgress.id} for tenant ${tenantId} ` +
          `(age: ${Math.round(ageMs / 60000)}min, status: ${existingInProgress.status})`,
        );
        await this.prisma.whatsappOnboarding.update({
          where: { id: existingInProgress.id },
          data: {
            status: OnboardingStatus.FAILED,
            errorCode: 'TIMEOUT',
            errorMessage: `Onboarding expirado automaticamente tras ${Math.round(ageMs / 60000)} minutos sin completar`,
            completedAt: new Date(),
          },
        });
        // Allow the new onboarding to proceed
      } else {
        throw new ConflictException({
          code: OnboardingErrorCode.DUPLICATE_CUSTOMER_BINDING,
          userMessage: `Ya hay un onboarding en progreso (iniciado hace ${Math.round(ageMs / 60000)} minutos). Si el proceso se quedo pegado, espera unos minutos e intenta de nuevo.`,
          existingOnboardingId: existingInProgress.id,
        });
      }
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
    businessId: string | undefined,
    waba: WabaInfo,
    phone: any,
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
        $8, $9::uuid
      )`,
      [
        businessId || null, waba.id, phone.id,
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

    this.logger.log(
      `WhatsApp channel persisted in tenant schema: ${tenant.schemaName} ` +
      `(businessId=${businessId || 'unresolved'}, wabaId=${waba.id}, verified)`,
    );
  }

  /**
   * Gate connecting an additional channel account behind the plan's
   * maxChannelAccounts limit, delegating to the API's internal endpoint (single
   * source of truth incl. per-tenant overrides). Throws BadRequestException when
   * over quota or when the subscription is not writable. This gate is a
   * security/entitlement boundary: missing credentials, network errors and
   * unexpected API responses fail closed so a transient outage cannot connect
   * a channel for an unpaid tenant.
   */
  private async assertChannelAccountQuotaViaApi(
    tenantId: string,
    channelType: string,
    excludeAccountId?: string,
  ): Promise<void> {
    const apiUrl = this.config.get<string>('API_INTERNAL_URL') || 'http://api:3000/api/v1';
    const internalKey =
      this.config.get<string>('INTERNAL_API_KEY') || this.config.get<string>('INTERNAL_JWT_SECRET');
    if (!internalKey) {
      throw new ServiceUnavailableException({
        code: 'CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE',
        userMessage: 'No fue posible validar temporalmente el acceso para conectar el canal.',
      });
    }
    const fetchFn: any = (globalThis as any).fetch;
    if (!fetchFn) {
      throw new ServiceUnavailableException({
        code: 'CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE',
        userMessage: 'No fue posible validar temporalmente el acceso para conectar el canal.',
      });
    }
    let res: any;
    try {
      res = await fetchFn(`${apiUrl}/internal/channel-account-quota-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ tenantId, channelType, excludeAccountId }),
      });
    } catch (e: any) {
      this.logger.warn(`channel-account quota check unreachable (${e?.message}) — blocking`);
      throw new ServiceUnavailableException({
        code: 'CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE',
        userMessage: 'No fue posible validar temporalmente el acceso para conectar el canal.',
      });
    }
    if (res.status === 403) {
      let msg =
        'Tu plan no permite conectar otro número de WhatsApp. Actualizá tu plan o desconectá otro número para agregar uno nuevo.';
      let code = 'CHANNEL_ACCESS_DENIED';
      try {
        const b = await res.json();
        if (b?.message) msg = b.message;
        if (b?.error === 'plan_limit_reached') code = 'PLAN_LIMIT_REACHED';
      } catch { /* keep default message */ }
      throw new BadRequestException({ code, userMessage: msg });
    }
    if (!res.ok) {
      this.logger.warn(`channel-account quota check returned ${res.status} — blocking`);
      throw new ServiceUnavailableException({
        code: 'CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE',
        userMessage: 'No fue posible validar temporalmente el acceso para conectar el canal.',
      });
    }
  }

  /**
   * Tell the API a WhatsApp number was connected here.
   *
   * The API records the connection on this call — first-connection instant,
   * the default agent's assignment to WhatsApp, the onboarding stage — because
   * this service writes `channel_accounts` itself and none of the API's connect
   * paths runs for Embedded Signup. The API re-reads the row before recording,
   * so the number is sent only to narrow that read to the one just connected.
   */
  private async notifyAgentQualityChannelUpdated(tenantId: string, accountId?: string): Promise<void> {
    const apiUrl = this.config.get<string>('API_INTERNAL_URL') || 'http://api:3000/api/v1';
    const internalKey =
      this.config.get<string>('INTERNAL_API_KEY') || this.config.get<string>('INTERNAL_JWT_SECRET');
    const fetchFn: any = (globalThis as any).fetch;
    if (!internalKey || !fetchFn) return;
    try {
      const response = await fetchFn(`${apiUrl}/internal/agent-quality-channel-updated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ tenantId, channelType: 'whatsapp', ...(accountId ? { accountId } : {}) }),
      });
      if (!response.ok) {
        this.logger.warn(`Agent Quality channel notification returned ${response.status}`);
      }
    } catch (error: any) {
      // The connection is already complete; the API cron remains the fallback.
      this.logger.warn(`Agent Quality channel notification unavailable (${error?.message})`);
    }
  }

  /**
   * Registrar en channel_accounts público para routing de webhooks
   *
   * Also the one write that carries what the money engine needs to let this
   * number answer at all: Meta's time zone evidence (and the zone itself when
   * it can be established without guessing) and Meta's billing currency. See
   * the section above `decideBillingZone` for why the zone is so often NULL.
   */
  private async registerChannelAccount(
    tenantId: string,
    phone: any,
    wabaId: string,
    businessId?: string,
    waba?: Pick<WabaInfo, 'timezoneId' | 'currency'> | null,
  ) {
    // Upsert — actualiza si ya existe
    const existing = await this.prisma.channelAccount.findFirst({
      where: {
        channelType: 'whatsapp',
        accountId: phone.id,
      },
    });

    const billing = await this.resolveBillingFacts(tenantId, phone.id, wabaId, waba ?? null, existing);

    if (existing) {
      await this.prisma.channelAccount.update({
        where: { id: existing.id },
        data: {
          tenantId,
          displayName: phone.verifiedName || phone.displayPhoneNumber,
          accessToken: 'encrypted_ref', // No en texto plano
          isActive: true,
          // `undefined` leaves the column as it is; `null` clears a zone that
          // was confirmed for another account (see `resolveBillingFacts`).
          ...(billing.wabaTimezone !== undefined ? { wabaTimezone: billing.wabaTimezone } : {}),
          metadata: {
            ...((existing.metadata as Record<string, unknown>) || {}),
            displayPhoneNumber: phone.displayPhoneNumber,
            qualityRating: phone.qualityRating,
            phoneNumberId: phone.id,
            wabaId,
            businessId: businessId || null,
            source: 'embedded_signup',
            ...billing.metadata,
          } as any,
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
          ...(billing.wabaTimezone ? { wabaTimezone: billing.wabaTimezone } : {}),
          metadata: {
            displayPhoneNumber: phone.displayPhoneNumber,
            qualityRating: phone.qualityRating,
            phoneNumberId: phone.id,
            wabaId,
            businessId: businessId || null,
            source: 'embedded_signup',
            ...billing.metadata,
          } as any,
        },
      });
    }

    this.logger.log(`Channel account registered for phone: ${phone.id}`);
  }

  /**
   * What this connection can say about billing, without inventing anything.
   *
   * Best effort by construction: the routing row it feeds is CRITICAL (without
   * it no inbound message reaches this tenant), so a failed sibling read costs
   * the inherited zone and nothing else.
   */
  private async resolveBillingFacts(
    tenantId: string,
    phoneId: string,
    wabaId: string,
    waba: Pick<WabaInfo, 'timezoneId' | 'currency'> | null,
    existing: { wabaTimezone?: string | null; metadata?: unknown } | null,
  ): Promise<{
    /** `undefined` = leave the column alone; a zone = write it; `null` = clear it. */
    wabaTimezone: string | null | undefined;
    metadata: Record<string, unknown>;
  }> {
    const metadata: Record<string, unknown> = {};
    const previous = (existing?.metadata && typeof existing.metadata === 'object'
      ? existing.metadata : {}) as Record<string, unknown>;
    const timezoneId = metaTimezoneIdOf(waba);
    if (timezoneId) {
      metadata.metaTimezoneId = timezoneId;
    } else if (previous.metaTimezoneId != null && previous.wabaId && previous.wabaId !== wabaId) {
      // Meta's id is a report ABOUT a WABA. Moved to another WABA that reported
      // none, the old id would claim the new WABA reports it — and pair with
      // any zone later confirmed on this row as if it were that account's.
      metadata.metaTimezoneId = null;
    }
    const currency = billingCurrencyEvidenceFromMeta(waba?.currency, wabaId);
    if (currency) metadata.billingCurrencyEvidence = currency;

    // A zone already on the row was confirmed by a person, or carried from
    // one, for a specific account: a WABA and the timezone id Meta reported
    // for it. While this connection is that same account it is never
    // overwritten from here. A reconnect to ANOTHER account — another WABA, or
    // the same WABA now reporting another id — is different: this write
    // replaces `wabaId` and `metaTimezoneId` with the new account's, and a zone
    // kept beside them would read as confirmed FOR it, and be carried to the
    // next number on it as `same_waba_same_id`. So it is cleared, and the new
    // account gets only what can be established for it below.
    const ownZone = existing ? usableBillingZone(existing.wabaTimezone) : null;
    let supersededZone: string | null = null;
    if (ownZone) {
      const confirmed = zoneConfirmedFor(previous);
      if (zoneStillConfirmedFor(confirmed, { wabaId, timezoneId })) return { wabaTimezone: undefined, metadata };
      supersededZone = ownZone;
      metadata.wabaTimezoneEvidence = null;
      this.logger.warn(`[Billing zone] phone=${phoneId} no longer keeps ${ownZone}: it was confirmed for `
        + `WABA ${confirmed.wabaId ?? 'unknown'} / Meta timezone_id=${confirmed.timezoneId ?? 'unknown'}, `
        + `and this connection is WABA ${wabaId} / timezone_id=${timezoneId ?? 'none'}`);
    }

    let siblings: BillingZoneSibling[] = [];
    if (timezoneId) {
      try {
        siblings = await this.prisma.channelAccount.findMany({
          where: { tenantId, channelType: 'whatsapp', wabaTimezone: { not: null } },
          select: { accountId: true, wabaTimezone: true, metadata: true },
        });
      } catch (error: any) {
        this.logger.warn(`[Billing zone] could not read the other numbers of tenant=${tenantId}: ${error?.message}`);
      }
    }

    const decision = decideBillingZone({ accountId: phoneId, wabaId, timezoneId }, siblings);
    if (decision.kind === 'inherited') {
      metadata.wabaTimezoneEvidence = {
        source: 'same_waba_same_id', at: new Date().toISOString(),
        timezoneId: Number(timezoneId) || null, wabaId, from: decision.from,
      };
      this.logger.log(`[Billing zone] phone=${phoneId} billed in ${decision.zone}, carried from ${decision.from} `
        + `(same WABA ${wabaId}, same Meta timezone_id=${timezoneId})`);
      return { wabaTimezone: decision.zone, metadata };
    }

    const consequence = 'waba_timezone stays NULL, and every reply from this number is refused '
      + '(timezone_missing) until the owner confirms the zone';
    if (decision.kind === 'meta_no_timezone') {
      this.logger.warn(`[Billing zone] Meta reported no timezone_id for WABA ${wabaId} (phone=${phoneId}): ${consequence}`);
    } else if (decision.kind === 'contradictory') {
      this.logger.warn(`[Billing zone] numbers on WABA ${wabaId} disagree about the zone (${decision.zones.join(', ')}); `
        + `phone=${phoneId} inherits none: ${consequence}`);
    } else {
      this.logger.warn(`[Billing zone] Meta reports timezone_id=${timezoneId} for WABA ${wabaId} (phone=${phoneId}), `
        + `a numeric Facebook id and not a zone, and no number on this WABA has confirmed it: ${consequence}`);
    }
    // Clear only what this write superseded; a column that was already NULL
    // is left alone.
    return { wabaTimezone: supersededZone ? null : undefined, metadata };
  }

  /**
   * Select a tenant-wide credential without sacrificing an already permanent
   * token. Direct WABA reads are stronger evidence than merely seeing a scope
   * name in debug_token: every required asset must be accessible now.
   *
   * The stored permanent token is retained when it covers every live WABA, and
   * never traded for one that expires while ANOTHER live number depends on it.
   * It stops counting when the send path would refuse it (rotation state) or
   * when the number being connected is the only live WABA and it cannot read
   * it: then it protects nobody and the covering candidate replaces it.
   *
   * "Cannot read" means Meta REFUSED (rule T). A probe Meta did not answer — a
   * timeout, a 5xx, a throttle — says nothing about access: it aborts the whole
   * decision with a retryable, server-resumable error before anything is minted
   * or written, whichever credential was being probed. Otherwise a bad minute
   * at Meta swapped a permanent credential that covers for one that expires.
   *
   * TWIN: apps/api WhatsappConnectionService.saveConnection applies the same
   * probe order, rotation-state rule, no-downgrade refinement and rule T.
   * Change both.
   */
  private async resolveCredentialForCoverage(
    tenantId: string,
    targetWabaId: string,
    candidateToken: string,
    candidateExpiresIn: number,
  ): Promise<{ accessToken: string; expiresInSeconds: number; minted: boolean }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { schemaName: true },
    });
    if (!tenant?.schemaName) throw new NotFoundException('Tenant no válido para validar la credencial');

    const rows = await this.prisma.executeInTenantSchema<any[]>(
      tenant.schemaName,
      `SELECT DISTINCT meta_waba_id, channel_status, phone_number_id
         FROM whatsapp_channels
        WHERE meta_waba_id IS NOT NULL`,
    );
    // Only LIVE WABAs must be covered — rule R-S3 in live-coverage-wabas.ts,
    // with its twin in the API. The second authority lives in public
    // `channel_accounts`, which `executeInTenantSchema` cannot see (its
    // search_path is the tenant schema), so it is read through the Prisma
    // client, and only for the rows whose status already says disconnected.
    //
    // NO tenant filter, on purpose: the table is unique on (channel_type,
    // account_id) and `registerChannelAccount` moves the row to whichever
    // tenant connected the number last. A number that moved away is dead for
    // this tenant even though its row is active — for someone else.
    const disconnectedPhoneIds = disconnectedCoveragePhoneIds(rows || []);
    const accounts = disconnectedPhoneIds.length > 0
      ? await this.prisma.channelAccount.findMany({
        where: {
          channelType: 'whatsapp',
          accountId: { in: disconnectedPhoneIds },
        },
        select: { tenantId: true, accountId: true, isActive: true },
      })
      : [];
    const requiredWabas = liveCoverageWabaIds({
      tenantId,
      rows: rows || [],
      accounts,
      targetWabaId,
    });
    const knownWabas = new Set((rows || [])
      .map((row: any) => String(row.meta_waba_id ?? '').trim())
      .filter(Boolean));
    const skippedWabas = [...knownWabas].filter(waba => !requiredWabas.includes(waba));
    if (skippedWabas.length > 0) {
      this.logger.log(
        `[Credential] Coverage for tenant=${tenantId} skips ${skippedWabas.length} dead WABA(s) ` +
        `(disconnected + account inactive or moved to another tenant): ${skippedWabas.join(', ')}`,
      );
    }
    const existing = await this.prisma.whatsappCredential.findFirst({
      where: { tenantId, credentialType: 'system_user_token' },
    });
    // The only stored credential any retain / no-downgrade rule below may look
    // at. A refused rotation state makes it `null`: it is never retained (so
    // never written back as active) and never blocks the candidate, which then
    // has to cover every live WABA on its own and replaces it.
    const storedPermanent = this.storedPermanentToConsider(tenantId, existing);

    // A permanent candidate (a generated System User token, or an Embedded
    // Signup token `classifyEmbeddedSignupToken` found never expires) is the
    // preferred one, but it still has to prove coverage of every live WABA
    // before replacing anything.
    if (candidateExpiresIn === 0) {
      try {
        await this.assertTokenCoverage(candidateToken, requiredWabas, targetWabaId);
        return { accessToken: candidateToken, expiresInSeconds: 0, minted: true };
      } catch (candidateFailure) {
        // Since round 1 the permanent candidate is the COMMON case, and this
        // branch used to throw without looking at the table. Before that, the
        // same attempt fell through to the retain branch below: a tenant whose
        // permanent token already covers every WABA kept sending, and the
        // connection went through with it. Keep that outcome — also after a
        // candidate probe Meta did not answer: a stored token that PROVES it
        // covers every live WABA is safe to keep whatever the candidate reads.
        if (storedPermanent) {
          let permanentToken: string | null = null;
          try {
            permanentToken = this.decryptToken(storedPermanent.encryptedValue);
          } catch (decryptError: any) {
            // An unreadable stored token retains nothing; the person still
            // hears about the attempt they made.
            this.logger.warn(`[Credential] Stored permanent token for tenant=${tenantId} could not be decrypted: ${decryptError?.message}`);
          }
          let retained: { accessToken: string; expiresInSeconds: number; minted: boolean } | null = null;
          if (permanentToken) {
            try {
              retained = await this.retainPermanentIfItCovers(tenantId, permanentToken, requiredWabas, targetWabaId);
            } catch (storedUnavailable) {
              // Rule T: Meta did not answer for the stored token, so nobody
              // knows whether it covers — the candidate's refusal is not the
              // verdict either. When the candidate blipped too, that is the
              // attempt the person made.
              throw isCoverageCheckUnavailable(candidateFailure) ? candidateFailure : storedUnavailable;
            }
          }
          if (retained) return retained;
        }
        // The ORIGINAL failure: the person is told about the attempt they
        // made, not about the token that happened to be in the table. A
        // candidate probe Meta did not answer stays retryable, never a verdict.
        throw candidateFailure;
      }
    }

    if (storedPermanent) {
      const permanentToken = this.decryptToken(storedPermanent.encryptedValue);
      // Rule T: throws, before anything below runs, when Meta did not answer
      // for the stored token. Only a refusal returns `null` and reaches the
      // no-downgrade rule and P2's replacement.
      const retained = await this.retainPermanentIfItCovers(tenantId, permanentToken, requiredWabas, targetWabaId);
      if (retained) return retained;

      // The no-downgrade rule protects the OTHER live numbers that sign with
      // the stored permanent token: swapping it for one that expires would
      // take them down in 60 days. When no other live WABA is required, the
      // stored token protects nobody — it cannot read the only number left —
      // and refusing locked the tenant out for good (dead rows around, or the
      // same number re-connected after its token lost access).
      const dependentWabas = requiredWabas.filter(wabaId => wabaId !== String(targetWabaId));
      if (dependentWabas.length > 0) {
        throw new ConflictException({
          code: ONBOARDING_GATE_CODES.TOKEN_COVERAGE_REQUIRED,
          // No new Meta window fixes this (the failure is not relaunchable):
          // the permanent connection other numbers depend on cannot see the
          // new number's business account, and it is never swapped for one
          // that expires.
          userMessage: OTHER_CONNECTED_NUMBER_MESSAGE,
          targetWabaId,
        });
      }

      await this.assertTokenCoverage(candidateToken, requiredWabas, targetWabaId);
      this.logger.log(
        `[Credential] Replacing the stored permanent token for tenant=${tenantId}: it cannot read ` +
        `target WABA=${targetWabaId} and no other live WABA depends on it (new expiresIn=${candidateExpiresIn}s)`,
      );
      return { accessToken: candidateToken, expiresInSeconds: candidateExpiresIn, minted: true };
    }

    await this.assertTokenCoverage(candidateToken, requiredWabas, targetWabaId);
    return { accessToken: candidateToken, expiresInSeconds: candidateExpiresIn, minted: true };
  }

  /**
   * The stored credential the retain and no-downgrade rules may consider: a
   * permanent one (`expires_at IS NULL`) in a rotation state the send path
   * still signs with. `null` otherwise — including for a revoked or rotating
   * permanent token, which must be neither retained (storing it would write
   * `rotation_state='active'` back on it) nor allowed to refuse a candidate on
   * the strength of a credential nothing can send with.
   */
  private storedPermanentToConsider<T extends { expiresAt: Date | null; rotationState?: string | null }>(
    tenantId: string,
    existing: T | null,
  ): T | null {
    if (!existing || existing.expiresAt !== null) return null;
    const state = normalizedRotationState(existing.rotationState);
    if (!USABLE_ROTATION_STATES.has(state)) {
      this.logger.log(
        `[Credential] Stored permanent token for tenant=${tenantId} is not usable ` +
        `(rotation_state=${state || 'unset'}) — ignored: never retained, never blocks the new authorization`,
      );
      return null;
    }
    return existing;
  }

  /**
   * The permanent token already in the table, when it covers every required
   * WABA; `null` when Meta REFUSED one of them, so the caller decides which
   * conflict the person sees.
   *
   * A probe Meta did not answer is neither: the retryable error is rethrown
   * (rule T). Returning `null` for it told every caller "does not cover" and
   * let a temporary candidate replace a permanent token that did.
   */
  private async retainPermanentIfItCovers(
    tenantId: string,
    permanentToken: string,
    requiredWabas: string[],
    targetWabaId: string,
  ): Promise<{ accessToken: string; expiresInSeconds: number; minted: boolean } | null> {
    try {
      await this.assertTokenCoverage(permanentToken, requiredWabas, targetWabaId);
    } catch (coverageFailure) {
      if (isCoverageCheckUnavailable(coverageFailure)) throw coverageFailure;
      return null;
    }
    this.logger.log(`[Credential] Retaining permanent token for tenant=${tenantId}; it covers ${requiredWabas.length} WABA(s)`);
    // RETAINED, not minted. This is the token that was already in the
    // table; this flow did not obtain it and knows nothing about whose
    // portfolio it belongs to. Stamping provenance on it would assert a
    // verification nobody performed — and the writer's own comment says
    // "it is not an inference about a token found lying in the table",
    // which is exactly what this one is.
    return { accessToken: permanentToken, expiresInSeconds: 0, minted: false };
  }

  /**
   * Proves `accessToken` reads every WABA in `wabaIds` by reading each one.
   *
   * The TARGET is probed first, then the rest in the order given (row order).
   * `liveCoverageWabaIds` lists the old numbers before the target, and walking
   * it as-is blamed a token that could not read the number being connected on
   * whichever old WABA came first: the person was told to disconnect another
   * number when what was missing was ticking THIS one in the Meta window.
   *
   * Two codes, because the two failures have opposite ways out:
   *   - the target → TARGET_NOT_GRANTED: a new Meta authorization fixes it;
   *   - another, already-connected WABA → MISSING_WABA_SCOPE: the same
   *     portfolio hands back the same access, so it is not relaunchable.
   *
   * Both are verdicts, so both need Meta to have REFUSED: a 4xx Graph error
   * that is not throttling, or a 200 for another WABA (`classifyMetaReadFailure`).
   * A probe Meta did not answer — no response, 5xx, 429, a throttling code —
   * stops the walk with a retryable MetaApiError instead (rule T): RATE_LIMITED
   * for a throttle, GRAPH_API_ERROR otherwise. Both are server-resumable, so the
   * failure keeps `exchange_payload` and `retryOnboarding` can run it again.
   */
  private async assertTokenCoverage(accessToken: string, wabaIds: string[], targetWabaId: string): Promise<void> {
    const target = String(targetWabaId);
    const probeOrder = [target, ...wabaIds.filter(wabaId => wabaId !== target)];
    for (const wabaId of probeOrder) {
      const isTarget = wabaId === target;
      let resolved: WabaInfo;
      try {
        resolved = await this.metaGraph.getWabaDirectly(wabaId, accessToken);
      } catch (error: any) {
        const failure = classifyMetaReadFailure(error);
        if (failure.kind === 'transient') throw this.coverageCheckUnavailable(wabaId, isTarget, failure);
        this.logger.warn(`Credential coverage check failed for WABA=${wabaId}${isTarget ? ' (target)' : ''}: ${error?.message}`);
        throw this.coverageRefused(wabaId, target);
      }
      // A 200 for another WABA is Meta answering too: this token does not
      // reach the one that was asked for.
      if (String(resolved?.id || '') !== wabaId) {
        this.logger.warn(`Credential coverage check failed for WABA=${wabaId}${isTarget ? ' (target)' : ''}: asset mismatch`);
        throw this.coverageRefused(wabaId, target);
      }
    }
  }

  private coverageRefused(wabaId: string, target: string): ConflictException {
    const isTarget = wabaId === target;
    return new ConflictException({
      code: isTarget
        ? ONBOARDING_GATE_CODES.TOKEN_TARGET_NOT_GRANTED
        : ONBOARDING_GATE_CODES.TOKEN_MISSING_WABA_SCOPE,
      userMessage: isTarget ? TARGET_NOT_GRANTED_MESSAGE : OTHER_CONNECTED_NUMBER_MESSAGE,
      wabaId,
      targetWabaId: target,
    });
  }

  /**
   * The retryable error for a coverage probe Meta did not answer. The technical
   * text carries ids, the HTTP status and the Graph code — never a token, and
   * never the axios error (its request config holds the access token).
   */
  private coverageCheckUnavailable(wabaId: string, isTarget: boolean, failure: MetaReadFailure): MetaApiError {
    const answer = failure.httpStatus === undefined ? 'no response' : `HTTP ${failure.httpStatus}`;
    const graphCode = failure.graphCode === undefined ? '' : `, Graph code ${failure.graphCode}`;
    const technical = `Coverage check for WABA=${wabaId}${isTarget ? ' (target)' : ''} got no usable answer from Meta ` +
      `(${answer}${graphCode}${failure.rateLimited ? ', rate limited' : ''}) — no coverage decision taken`;
    this.logger.warn(`[Credential] ${technical}`);
    return failure.rateLimited
      ? new MetaApiError(OnboardingErrorCode.RATE_LIMITED, META_RATE_LIMITED_USER_MESSAGE, technical, true)
      : new MetaApiError(OnboardingErrorCode.GRAPH_API_ERROR, COVERAGE_CHECK_UNAVAILABLE_MESSAGE, technical, true);
  }

  /**
   * Almacenar token cifrado en la tabla de credenciales con expiración
   */
  private async storeEncryptedCredential(
    tenantId: string,
    accessToken: string,
    expiresInSeconds: number,
    /**
     * Whose portfolio this token was minted for, when the caller established it.
     *
     * `null` means nobody established it, which is not the same as saying it
     * is the provider's — the reader treats an absent kind as unverified and
     * still sends, because every tenant connected before this column existed
     * has one and refusing them would be an outage caused by bookkeeping.
     */
    provenance: { ownerBusinessId: string; source: string } | null,
    /**
     * Whether THIS flow obtained the token (`resolveCredentialForCoverage`'s
     * `minted`) or retained the one already in the table.
     *
     * A minted token replaces the previous one, and the provenance columns
     * describe the previous one: left alone, a new token nobody attributed
     * inherited another token's kind, owner and scopes, and the send-time guard
     * read them as this token's. So a minted token always rewrites them — with
     * what was established, or with NULL. A retained token is the same token,
     * and its provenance stays exactly as it was.
     */
    origin: { minted: boolean },
  ) {
    const encryptedValue = this.encryptToken(accessToken);

    // expiresInSeconds === 0 means PERMANENT (a System User token). It must clear
    // any previous expiry, not be ignored: the old code only assigned expiresAt
    // when truthy, so upgrading a 60-day long-lived token to a permanent one left
    // the stale date behind. The platform monitor then read that date and warned
    // that a token which never expires was about to expire — a false alarm that
    // sent operators chasing a re-authorisation nobody needed.
    const expiresAt = expiresInSeconds && expiresInSeconds > 0
      ? new Date(Date.now() + expiresInSeconds * 1000)
      : null;

    // Upsert — reemplaza si ya existe
    const existing = await this.prisma.whatsappCredential.findFirst({
      where: { tenantId, credentialType: 'system_user_token' },
    });

    const data: any = {
      encryptedValue,
      rotationState: 'active',
      // Always written, including null, so the stored expiry always reflects the
      // token actually held.
      expiresAt,
    };

    if (provenance?.ownerBusinessId) {
      // A token that reached this method through Embedded Signup, for a WABA
      // that belongs to `ownerBusinessId`, IS the client-scoped kind. That is
      // what this flow does; it is not an inference about a token found lying
      // in the table.
      data.credentialKind = 'business_integration_system_user';
      data.ownerBusinessId = provenance.ownerBusinessId;
      data.metaAppId = process.env.META_APP_ID ?? null;
      data.provenanceVerifiedAt = new Date();
      // This flow never reads the scopes, so whatever sits in the column
      // belongs to the token being replaced — and the send guard refuses a
      // BISU whose recorded scopes lack messaging.
      if (origin.minted) data.grantedScopes = null;
      this.logger.log(`[Onboarding] credential provenance recorded: business_integration_system_user `
        + `owner=${provenance.ownerBusinessId} (${provenance.source})`);
    } else if (origin.minted) {
      data.credentialKind = null;
      data.ownerBusinessId = null;
      data.metaAppId = null;
      data.grantedScopes = null;
      data.provenanceVerifiedAt = null;
      this.logger.log('[Onboarding] credential provenance cleared: new token, provenance not established');
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
  private async syncPhoneNumbersToDb(
    tenantId: string,
    businessId: string | undefined,
    wabaId: string,
    phones: any[],
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { schemaName: true },
    });

    if (!tenant) return;

    for (const p of phones) {
      await this.prisma.executeInTenantSchema(
        tenant.schemaName,
        `WITH updated AS (
          UPDATE whatsapp_channels
          SET meta_business_id = $1,
              meta_waba_id = $2,
              display_phone_number = $4,
              display_name = $5,
              quality_rating = $6,
              channel_status = 'connected',
              updated_at = NOW()
          WHERE phone_number_id = $3
          RETURNING id
        )
        INSERT INTO whatsapp_channels (
          provider_type, meta_business_id, meta_waba_id, phone_number_id,
          display_phone_number, display_name, quality_rating,
          channel_status, connected_at
        )
        SELECT 'meta_cloud', $1, $2, $3, $4, $5, $6, 'connected', NOW()
        WHERE NOT EXISTS (SELECT 1 FROM updated)`,
        [businessId || null, wabaId, p.id, p.displayPhoneNumber, p.verifiedName, p.qualityRating || 'GREEN'],
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

  /**
   * Advertencias persistidas, filtradas contra el catálogo: lo que se devuelve
   * al panel es un código que sabe traducir, nunca texto libre de la base.
   */
  private extractWarningCodes(exchangePayload: unknown): WhatsappOnboardingWarningCode[] {
    if (!exchangePayload || typeof exchangePayload !== 'object' || Array.isArray(exchangePayload)) return [];
    return whatsAppSignupWarningCodes((exchangePayload as Record<string, unknown>).warnings);
  }

  private formatOnboardingResponse(onboarding: any) {
    if (!onboarding) return null;
    return {
      id: onboarding.id,
      tenantId: onboarding.tenantId,
      mode: onboarding.mode,
      status: onboarding.status,
      businessId: onboarding.metaBusinessId,
      wabaId: onboarding.wabaId,
      phoneNumberId: onboarding.phoneNumberId,
      displayPhoneNumber: onboarding.displayPhoneNumber,
      verifiedName: onboarding.verifiedName,
      isCoexistence: onboarding.isCoexistence,
      errorCode: onboarding.errorCode,
      // `errorMessage` se mantiene por compatibilidad (clientes viejos y
      // soporte); `warnings` es lo que el panel traduce y muestra en la tarjeta
      // ámbar de "conectado, pero con pendientes".
      errorMessage: onboarding.errorMessage,
      warnings: this.extractWarningCodes(onboarding.exchangePayload),
      codeReceivedAt: onboarding.codeReceivedAt,
      exchangeCompletedAt: onboarding.exchangeCompletedAt,
      assetsSyncedAt: onboarding.assetsSyncedAt,
      webhookValidatedAt: onboarding.webhookValidatedAt,
      completedAt: onboarding.completedAt,
      createdAt: onboarding.createdAt,
    };
  }
}
