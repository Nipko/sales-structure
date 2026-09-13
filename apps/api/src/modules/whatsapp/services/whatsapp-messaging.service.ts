import {
  Injectable, Logger, BadRequestException, Optional, ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WhatsappConnectionService } from './whatsapp-connection.service';
import { toWhatsAppFormatting } from '../../../common/utils/channel-text-format.util';
import {
  WhatsappSendAdmissionService, fromSendContext, type Admission,
} from '../../billing/whatsapp-spend/whatsapp-send-admission.service';
import { SpendMeterUnavailable } from '../../billing/whatsapp-spend/spend-unavailable';
import { describeBlock, type SpendBlock } from '../../billing/whatsapp-spend/spend-diagnosis';
import { ChannelTokenService } from '../../channels/channel-token.service';
import { isConnectionRefusal } from '../../channels/connection-refusal';
import { AccountPauseStore } from '../../channels/account-pause-store';
import { approvedTemplateCategory } from '../../channels/dispatch-price-facts';
import {
    classifyTransportFailure, metaGraphAnswer, metaGraphClassifier,
} from '../../channels/provider-error-classification';
import { IncidentService } from '../../health/incident.service';

const META_GRAPH_VERSION = 'v21.0';

/**
 * What the money gate needs that a phone number and a payload cannot supply.
 *
 * Optional everywhere: a caller that does not pass it still sends, and the
 * effect is still reserved against the account. What it adds is the narrower
 * ceilings — the campaign's own budget, the per-contact limit — which cannot be
 * enforced against an effect that does not know which campaign or which contact
 * it belongs to.
 */
export interface WhatsappSendSpendContext {
    /** The campaign, broadcast or automation this message belongs to. */
    readonly taskId?: string | null;
    readonly contactId?: string | null;
    /** Distinguishes the second message of one effect from a repeat of the first. */
    readonly ordinal?: number;
    /**
     * Meta's own approved category for the template — `MARKETING`, `UTILITY`,
     * `AUTHENTICATION`. Supplied by the caller when it already read the
     * template row; otherwise this service reads it itself.
     */
    readonly templateCategory?: string | null;
    /**
     * The caller's own durable handle for this send, when it has one.
     *
     * A campaign passes `taskId` and gets its identity from that. A caller
     * that is retrying something it already recorded passes the id it
     * recorded, so the retry finds the first attempt's reservation instead of
     * paying for the message twice.
     *
     * Absent means "this is a fresh press": the service mints an id, and two
     * deliberate presses are two messages rather than one deduplicated away.
     */
    readonly effectRequestId?: string | null;
}

/** A refusal from the money gate, with the code the caller has to be told. */
interface SpendRefusal { readonly refused: true; readonly block: SpendBlock | null }

const isSpendRefusal = (value: unknown): value is SpendRefusal =>
    !!value && typeof value === 'object' && (value as any).refused === true;

@Injectable()
export class WhatsappMessagingService {
  private readonly logger = new Logger(WhatsappMessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly connectionService: WhatsappConnectionService,
    // The third and last sink. This service builds its own payload and posts
    // it to Meta itself, so a gate on the queue would never see it — and every
    // template, every interactive card and every media message sent from a
    // controller comes through here. NOT optional, for the same reason.
    private readonly spendGate: WhatsappSendAdmissionService,
    // The one thing that knows WHO PAYS for a send: which WABA Meta bills,
    // which credential it travels on, which number it leaves from. This
    // service used to assemble that identity from the arguments in scope,
    // which is how every REST send arrived with no payer at all.
    private readonly channelToken: ChannelTokenService,
    // The first of the two places Meta says the business cannot be billed: the
    // answer to this very request. The other is a status webhook minutes later.
    @Optional() private readonly pauses?: AccountPauseStore,
    /**
     * Where a broken provider contract goes.
     *
     * A 2xx with no message id is neither a transport failure nor a refusal:
     * it is Meta answering something its own documentation says it does not.
     * The effect may be on a phone and cannot be named, which no automatic
     * behaviour can resolve — so a person has to reconcile it.
     */
    @Optional() private readonly incidents?: IncidentService,
  ) {}

  // ============================================================
  // 1. ENVIAR PLANTILLA PRE-APROBADA (Template Message)
  //    Obligatorio para iniciar conversaciones fuera de la ventana 24h
  // ============================================================
  async sendTemplate(
    schemaName: string,
    toPhone: string,
    templateName: string,
    language: string,
    components: any[],
    fromPhoneNumberId?: string,
    spend?: WhatsappSendSpendContext,
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName, fromPhoneNumberId);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components,
      },
    };

    return this.sendToMeta(schemaName, channelId, phoneNumberId, accessToken, payload, templateName,
      undefined, spend);
  }

  // ============================================================
  // 2. ENVIAR TEXTO SIMPLE
  //    Solo funciona dentro de la ventana de 24h (customer-initiated)
  // ============================================================
  async sendTextMessage(
    schemaName: string,
    toPhone: string,
    text: string,
    conversationId?: string,
    fromPhoneNumberId?: string,
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName, fromPhoneNumberId);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      // Second live WhatsApp route: this service builds its own payload and
      // never passed through the adapter, so Markdown from any caller reached
      // the customer raw. Two WhatsApp paths have bitten this repo before.
      text: { body: toWhatsAppFormatting(text) },
    };

    return this.sendToMeta(schemaName, channelId, phoneNumberId, accessToken, payload, undefined, conversationId);
  }

  // ============================================================
  // 3. ENVIAR MENSAJE INTERACTIVO (Botones de Reply / Listas)
  //    Funciona dentro de la ventana de 24h
  // ============================================================
  async sendInteractiveMessage(
    schemaName: string,
    toPhone: string,
    interactive: {
      type: 'button' | 'list';
      header?: { type: 'text'; text: string };
      body: { text: string };
      footer?: { text: string };
      action: any; // buttons[] o sections[]
    },
    conversationId?: string,
    /**
     * Which of the tenant's numbers sends — and therefore which WhatsApp
     * Business Account Meta bills from 1 October 2026. It could not be expressed
     * here at all, so the resolver returned the tenant's oldest connection and
     * the account that paid was a property of row order.
     *
     * Optional because most tenants have one number and naming it would be
     * ceremony. Omitting it is not a default: the resolver answers an unnamed
     * request only while there is exactly one, and refuses otherwise.
     */
    fromPhoneNumberId?: string,
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName, fromPhoneNumberId);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'interactive',
      interactive: {
        ...interactive,
        body: { ...interactive.body, text: toWhatsAppFormatting(interactive.body.text) },
      },
    };

    return this.sendToMeta(schemaName, channelId, phoneNumberId, accessToken, payload, undefined, conversationId);
  }

  // ============================================================
  // 4. ENVIAR MULTIMEDIA (Imagen, Audio, Documento, Video)
  //    Funciona dentro de la ventana de 24h
  // ============================================================
  async sendMediaMessage(
    schemaName: string,
    toPhone: string,
    mediaType: 'image' | 'audio' | 'document' | 'video',
    mediaUrl: string,
    caption?: string,
    filename?: string,
    conversationId?: string,
    /** Which number sends, and therefore which WABA Meta bills. See above. */
    fromPhoneNumberId?: string,
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName, fromPhoneNumberId);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const mediaPayload: any = { link: mediaUrl };
    if (caption) mediaPayload.caption = toWhatsAppFormatting(caption);
    if (filename && mediaType === 'document') mediaPayload.filename = filename;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: mediaType,
      [mediaType]: mediaPayload,
    };

    return this.sendToMeta(schemaName, channelId, phoneNumberId, accessToken, payload, undefined, conversationId);
  }

  // ============================================================
  // 5. ENVIAR UBICACIÓN
  // ============================================================
  async sendLocationMessage(
    schemaName: string,
    toPhone: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
    conversationId?: string,
    /** Which number sends, and therefore which WABA Meta bills. See above. */
    fromPhoneNumberId?: string,
  ) {
    const { accessToken, phoneNumberId, channelId } = await this.connectionService.getValidAccessToken(schemaName, fromPhoneNumberId);
    const cleanPhone = toPhone.replace(/[+\s-]/g, '');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'location',
      location: { latitude, longitude, name, address },
    };

    return this.sendToMeta(schemaName, channelId, phoneNumberId, accessToken, payload, undefined, conversationId);
  }

  // ============================================================
  // PRIVATE: Método central que envía a Meta y loguea en BD
  // ============================================================
  private async sendToMeta(
    schemaName: string,
    channelId: string,
    phoneNumberId: string,
    accessToken: string,
    payload: any,
    templateName?: string,
    conversationId?: string,
    spend?: WhatsappSendSpendContext,
  ): Promise<{ success: boolean; messageId: string }> {
    // Reserved BEFORE the request. A reservation taken afterwards is a record
    // of money already spent, not a limit on spending it.
    const admission = await this.admitSpend(schemaName, phoneNumberId, payload, templateName, spend);
    // The intent to send, written BEFORE the request. After it, it would
    // distinguish nothing: anything recorded then already presupposes the POST
    // happened, and the point is to tell a crash before sending from one after.
    if (admission && !isSpendRefusal(admission)
      && !(await this.spendGate.beginTransmission(schemaName, admission as Admission))) {
      throw new BadRequestException(
        'Otro intento ya tiene el derecho de enviar este mensaje; no se envió dos veces.');
    }
    if (isSpendRefusal(admission)) {
      // ── SAY WHICH REFUSAL, NOT THE MOST FLATTERING ONE ────────────────────
      //
      // This used to answer "the WhatsApp spending limit configured for this
      // account rejected it" for EVERY refusal. Twenty codes reach here and
      // exactly three are ceilings; the rest are a paused account, a number
      // whose payer Meta has not disclosed, a missing timezone, a recipient
      // that cannot be addressed. Each already carries its own operator-facing
      // resolution, and this sink threw all of it away to name a limit that is
      // usually not the problem — sending whoever reads the 400 to a screen
      // where nothing is wrong.
      const block = (admission as { block: SpendBlock | null }).block;
      throw new BadRequestException(block
        ? `${describeBlock(block)}`
        : 'El envío fue rechazado por la autoridad de gasto de WhatsApp.');
    }

    try {
      this.logger.log(`Sending ${payload.type} message to ${payload.to}`);

      // Built here rather than at the top of the method, deliberately: a URL
      // assembled before the money was authorised reads — to a person and to
      // the census — as an egress that precedes its own admission.
      const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneNumberId}/messages`;
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })
      );

      // ── A 2xx IS NOT AN ACCEPTANCE UNTIL IT NAMES THE MESSAGE ───────────
      //
      // `messages[0].id` used to fall back to `unknown-${Date.now()}`. That
      // value is a lie with three consequences, and all of them are silent: the
      // caller is handed a receipt that identifies nothing; the ledger records
      // an ACCEPTANCE, so the reservation waits for a webhook that can never
      // match; and the log carries an id no support engineer can look up.
      //
      // Meta's contract is that a Graph answer either creates the message and
      // returns its id, or returns an error and creates nothing. A 2xx with
      // neither is the contract being broken, which is an INDETERMINATE
      // outcome — the effect may exist and cannot be named — and an incident,
      // not a success.
      const answer = metaGraphAnswer(response.status ?? 200, response.data, 'messages');
      const verdict = metaGraphClassifier(answer);
      if (verdict.kind !== 'accepted') {
        // Retained, never released and never re-sent: a message that may be on
        // a phone must not be paid for twice nor sent twice.
        await this.recordSpend(schemaName, admission,
          { kind: 'timeout', errorCode: verdict.errorCode });
        await this.reportContractBreach(schemaName, phoneNumberId, verdict.errorCode);
        // Marked so the catch below re-throws it untouched. Without the mark it
        // falls into the generic failure handler and the outcome is recorded a
        // SECOND time — two spend records for one message, the second of them
        // describing an exception this code raised itself.
        throw Object.assign(new BadRequestException(
          'Meta respondió 2xx sin identificar el mensaje. No se puede confirmar el envío ni '
          + 'reintentarlo automáticamente: quedó en conciliación.'),
        { parallllyOutcomeRecorded: true });
      }
      const messageId = verdict.receipt;
      this.logger.log(`Message sent successfully: ${messageId}`);

      // Accepted, not priced: Meta answers with an id long before it says what
      // the delivery cost, so the reservation stands until a status webhook or
      // a reconciliation settles it.
      await this.recordSpend(schemaName, admission, { kind: 'accepted', providerMessageId: messageId });

      // Meta took a message from this account. That is the only proof billing
      // works again, and it is produced by the platform rather than claimed by
      // anybody — so a pause that was in force lifts here, by itself.
      await this.resumeIfPaused(schemaName, phoneNumberId);

      // Loguear en BD
      await this.logMessage(schemaName, channelId, {
        providerMessageId: messageId,
        templateName: templateName || null,
        direction: 'outbound',
        status: 'sent',
        conversationId: conversationId || null,
        payload,
      });

      return { success: true, messageId };

    } catch (error: any) {
      // Already accounted for on the way out. Recording it again would file one
      // message twice, and the second record would describe our own exception
      // rather than anything the provider said.
      if (error?.parallllyOutcomeRecorded) throw error;
      const metaError = error?.response?.data?.error;
      const errorMessage = metaError?.message || error.message;
      const errorCode = metaError?.code || 'UNKNOWN';

      this.logger.error(`Failed to send message: [${errorCode}] ${errorMessage}`);

      // ── ONE CLASSIFIER, NOT A SECOND OPINION ────────────────────────────
      //
      // This used to read `metaError ? rejected : timeout`, which collapses the
      // three answers a provider can give into two and gets the middle one
      // exactly backwards. A 429 or a documented rate limit carries a Graph
      // error object, so it was recorded as a REJECTION: the reservation was
      // released and its transmission right resolved, so the retry found a
      // finished effect and was refused as `effect_already_resolved`. One rate
      // limit, one message abandoned for ever, with nothing in the product
      // saying so.
      //
      // `metaGraphClassifier` is the same rule the strict transport uses, and
      // it reads Meta's own documented transient codes rather than the presence
      // of an envelope.
      const failureAnswer = error?.response
        ? metaGraphAnswer(error.response.status ?? 0, error.response.data, 'messages')
        : null;
      const failure = failureAnswer
        ? metaGraphClassifier(failureAnswer)
        : classifyTransportFailure(error);
      await this.recordSpend(schemaName, admission, this.spendOutcomeFor(failure));

      // "This business account cannot be billed" is not a transport failure and
      // must not be retried: every attempt is identical and none can succeed
      // until a person adds a card, in Meta, on their own account. Recorded
      // here so the NEXT message is refused before it is even priced.
      await this.observeFunding(schemaName, phoneNumberId, errorCode,
        metaError?.error_data?.details ?? errorMessage);

      // Loguear fallo en BD
      await this.logMessage(schemaName, channelId, {
        providerMessageId: null,
        templateName: templateName || null,
        direction: 'outbound',
        status: 'failed',
        conversationId: conversationId || null,
        payload,
        errorMessage,
      });

      throw new BadRequestException(
        `Error al enviar mensaje de WhatsApp: ${errorMessage}`
      );
    }
  }

  /**
   * What the classifier's verdict does to the money.
   *
   * The three kinds are three different statements about whether the effect
   * happened, and they need three different answers:
   *
   *   · `accepted`            it exists and is named. Not reached here.
   *   · `rejected` + retryable  it does NOT exist and the provider invited a
   *                           repeat. The reservation stays, the send right
   *                           goes back, the next attempt re-claims the same
   *                           row — no second reservation, no second POST.
   *   · `rejected` permanent  it does not exist and never will. Money back.
   *   · `unknown`             it may exist and cannot be named. Retained,
   *                           never released, never re-sent.
   */
  private spendOutcomeFor(verdict: { kind: string; errorCode?: string; retryable?: boolean }): {
    kind: 'accepted' | 'rejected' | 'rejected_retryable' | 'timeout';
    errorCode?: string | null;
  } {
    const errorCode = String((verdict as any).errorCode ?? 'unknown');
    if (verdict.kind === 'rejected') {
      return { kind: (verdict as any).retryable ? 'rejected_retryable' : 'rejected', errorCode };
    }
    return { kind: 'timeout', errorCode };
  }

  /**
   * Say out loud that the provider broke its own contract.
   *
   * A 2xx with no message id is not a transport problem and not a refusal: it
   * is Meta answering something its documentation says it does not answer. It
   * leaves an effect that may be on a phone and cannot be named, which no
   * automatic behaviour can resolve — so it goes to the Ops Center, where a
   * person can reconcile it against Meta's own record.
   */
  private async reportContractBreach(
    schemaName: string, phoneNumberId: string, detail: string,
  ): Promise<void> {
    try {
      await this.incidents?.record('whatsapp_graph_contract_breach', 'warning',
        'Meta respondió 2xx sin identificar el mensaje',
        `El número ${phoneNumberId} (${schemaName}) recibió una respuesta 2xx sin `
        + `\`messages[0].id\` (${detail}). El efecto puede existir y no se puede nombrar: `
        + 'quedó retenido en conciliación y no se reintenta solo.', 1);
    } catch (error: any) {
      this.logger.error(`[WhatsApp] contract breach not recorded: ${error?.message}`);
    }
  }

  /**
   * Ask the money gate for this one message.
   *
   * A refusal means the send must not happen, and it CARRIES ITS CODE: twenty
   * conditions reach here and only three are ceilings. Collapsing them to one
   * word made every 400 blame a spending limit, which is usually not the
   * problem and is a screen where nothing is wrong.
   * A meter that cannot answer raises, and the REST caller gets a 503.
   */
  private async admitSpend(schemaName: string, phoneNumberId: string, payload: any,
    templateName?: string, spend?: WhatsappSendSpendContext) {
    try {
      // The approval category, from the row the template sync wrote. Read here
      // rather than demanded from every caller: five public methods and a dozen
      // producers would each have had to remember, and the one that forgot
      // would have priced a campaign as a reply.
      const category = spend?.templateCategory ?? (templateName
        ? await this.templateCategory(schemaName, templateName, phoneNumberId)
        : null);
      // ── THE IDENTITY COMES FROM THE RESOLVER, NEVER FROM THIS SCOPE ──
      //
      // A phone number id is not a connection. Who pays, on which credential,
      // from which display number: all of it is a property of the connection,
      // and this service used to hand the authority a triple it had assembled
      // itself. `payerKind` then came back undefined and the verdict was
      // `payer_unknown` — on EVERY template, card, image and location sent
      // from a controller.
      const tenantId = await this.spendGate.tenantForSchema(schemaName);
      if (!tenantId) {
        // Not "unmetered, carry on". A schema that maps to no tenant is a
        // lookup that failed or a schema that should not be sending; either
        // way nothing here can name a payer.
        throw new SpendMeterUnavailable(`schema ${schemaName} maps to no tenant`);
      }
      const resolved = await this.channelToken.resolveSendContext({
        tenantId, channelType: 'whatsapp', channelAccountId: phoneNumberId,
        recipient: { scope: 'customer', address: String(payload?.to ?? ''),
          contactId: spend?.contactId ?? null },
      });
      const admission = await this.spendGate.admit({
        schema: schemaName,
        connection: fromSendContext(resolved.context),
        // The recipient is hashed before it travels: this value ends up in an
        // effect key and in log lines.
        recipientRef: createHash('sha256').update(String(payload?.to ?? '')).digest('hex').slice(0, 32),
        // ── The category, from Meta's own approval ─────────────────────
        //
        // This used to pass the literal `'template'`, which is not one of
        // Meta's five: the rate card had no row for it, so every template send
        // priced as unknown and its exposure was invisible. The real category
        // is the one Meta approved the template AS, and it is read from the
        // templates table below.
        template: templateName ? { name: templateName, category } : null,
        // A session message can only be delivered inside the window — Meta
        // refuses it otherwise — so a non-template send here IS `service`.
        insideServiceWindow: templateName ? undefined : true,
        // The destination, read to derive the tariff country and then dropped.
        recipientAddress: String(payload?.to ?? ''),
        // A template is an initiation by definition — it exists to open a
        // conversation outside the 24-hour window — and a session message can
        // only be sent inside one, which means somebody wrote first. The
        // distinction comes from WhatsApp's own rules, not from a guess about
        // what the message says.
        disposition: templateName ? 'proactive' : 'reactive',
        producer: templateName ? 'whatsapp_rest_template' : `whatsapp_rest_${String(payload?.type ?? 'text')}`,
        contentDigest: createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex').slice(0, 32),
        admissionReason: 'whatsapp_messaging_service',
        // Without these two the effect can only be counted against the account.
        // With them it also lands on the campaign's own budget and the contact's
        // limit — which is what stops one batch, or one contact, from consuming
        // a whole month.
        taskId: spend?.taskId ?? null,
        contactId: spend?.contactId ?? null,
        ordinal: spend?.ordinal ?? 0,
        // ── THE DURABLE IDENTITY OF A SYNCHRONOUS SEND ────────────────
        //
        // There is no queue job and no row written yet, so this call mints
        // one. Deliberately not derived from the content: an operator who
        // presses send twice on purpose means two messages, and a
        // content-keyed effect would silently discard the second.
        //
        // A caller with a real handle — a campaign, a retry of something it
        // already recorded — passes it and gets that behaviour instead.
        binding: { requestId: spend?.effectRequestId ?? randomUUID() },
      });
      if (admission && !admission.permitted) {
        return { refused: true as const, block: admission.block ?? null };
      }
      return admission;
    } catch (error: any) {
      // ── A REFUSED CONNECTION IS NOT AN OUTAGE ───────────────────────
      //
      // "This number is not connected", "the credential was revoked", "you
      // named an account this tenant does not have" are answers, not
      // failures, and each already carries its own status and diagnosis.
      // Wrapping them in a 503 would tell the caller to try again in a
      // moment — for a condition that will still be true tomorrow.
      if (isConnectionRefusal(error)) throw error;
      // An unavailable meter DEFERS. Returning null here read as "no gate
      // wired — carry on", so a database that blinked produced a message on a
      // phone, a charge on the account and no record of either.
      //
      // A 503 so the caller retries: this is a synchronous REST surface, and
      // the honest answer is "try again in a moment", not a silent send.
      this.logger.error(`[Spend] meter unavailable for whatsapp REST: ${error?.message}. `
        + `Deferring rather than sending unmeasured.`);
      throw new ServiceUnavailableException(
        'El control de gasto de WhatsApp no está disponible ahora mismo. El mensaje no se envió; '
        + 'inténtalo de nuevo en unos segundos.');
    }
  }

  /**
   * Tell the pause store what Meta just said, if what it said was about money.
   *
   * Never throws and never blocks: this runs after a message has already
   * failed, and failing to record why must not become a second failure that
   * hides the first.
   */
  private async observeFunding(schemaName: string, phoneNumberId: string,
    code: unknown, detail: unknown) {
    if (!this.pauses) return;
    try {
      const tenantId = await this.spendGate.tenantForSchema(schemaName);
      if (!tenantId) return;
      await this.pauses.observeFunding(tenantId, phoneNumberId,
        { source: 'http_response', code, detail });
    } catch (error: any) {
      this.logger.error(`[Pause] funding signal not recorded: ${error?.message}`);
    }
  }

  private async resumeIfPaused(schemaName: string, phoneNumberId: string) {
    if (!this.pauses) return;
    try {
      const tenantId = await this.spendGate.tenantForSchema(schemaName);
      if (!tenantId) return;
      await this.pauses.clear(tenantId, phoneNumberId, { by: 'provider_accepted' });
    } catch { /* a resumed account that stays marked paused is visible and safe */ }
  }

  /**
   * Meta's approved category for one template, from the row the sync wrote.
   *
   * Returns null rather than throwing: a lookup that fails leaves the category
   * unknown, which is a diagnosis the admission already knows how to give. It
   * must never become a reason not to send.
   */
  private async templateCategory(schemaName: string, templateName: string,
    phoneNumberId?: string | null): Promise<string | null> {
    try {
      // ── THE CATEGORY IS A FACT ABOUT ONE WABA'S CATALOGUE ────────────────
      //
      // And the category decides the price: `marketing` and `service` are
      // different amounts, and from October the difference is billed. This used
      // to take the most recently synced row of that NAME across every WABA the
      // tenant has, so a tenant with two could price a service reply at the
      // marketing rate — or, worse, the other way round — because the sibling
      // WABA happened to sync last.
      //
      // The query itself lives in `dispatch-price-facts` so this lane and the
      // durable lane cannot drift into pricing the same template two ways.
      return await approvedTemplateCategory(
        (sql, params) => this.prisma.executeInTenantSchema(schemaName, sql, params ?? []),
        { templateName, channelAccountId: phoneNumberId ?? null });
    } catch (error: any) {
      this.logger.warn(`[Spend] template category unreadable for ${templateName}: ${error?.message}`);
      return null;
    }
  }

  private async recordSpend(schemaName: string, admission: unknown, outcome: {
    kind: 'delivered_priced' | 'accepted' | 'rejected' | 'rejected_retryable' | 'timeout';
    providerMessageId?: string | null; errorCode?: string | null;
  }) {
    if (!admission || isSpendRefusal(admission)) return;
    try {
      await this.spendGate.record(schemaName, admission as Admission, outcome);
    } catch (error: any) {
      this.logger.error(`[Spend] outcome not recorded: ${error?.message}`);
    }
  }

  private async logMessage(schemaName: string, channelId: string, data: {
    providerMessageId: string | null;
    templateName: string | null;
    direction: string;
    status: string;
    conversationId: string | null;
    payload: any;
    errorMessage?: string;
  }) {
    try {
      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_message_logs (
          channel_id, conversation_id, provider_message_id, template_name,
          direction, status, error_message, request_payload_json, sent_at
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          channelId,
          data.conversationId,
          data.providerMessageId,
          data.templateName,
          data.direction,
          data.status,
          data.errorMessage || null,
          JSON.stringify(data.payload),
        ]
      );
    } catch (e: any) {
      this.logger.warn(`Failed to log message: ${e.message}`);
    }
  }
}
