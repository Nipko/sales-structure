"use client";

import type { OnboardingLanding } from "@parallext/shared";

/**
 * Quién manda en la pantalla de inicio, en una sola señal.
 *
 * `/admin` es el único lugar que lee `setup-status`. El aviso rojo de calidad
 * vive en el layout y la burbuja del asistente vive en el shell: ninguno de los
 * dos puede —ni debe— repetir esa consulta. Antes tampoco la miraban, así que
 * una cuenta recién creada se encontraba con ocho guías a la vez: la tarjeta de
 * puesta en marcha diciendo "conectá WhatsApp" y, encima, una barra roja
 * diciendo lo mismo en tono de alarma.
 *
 * Acá no se decide nada: `/admin` publica la guía que YA resolvió el contrato
 * compartido y las demás superficies se callan cuando no es su turno.
 */
export type OnboardingLandingSignal =
  | OnboardingLanding
  /** El visitante no tiene puesta en marcha que seguir (plataforma, o rol sin alcance). */
  | "not_applicable";

let current: OnboardingLandingSignal = "unknown";
const listeners = new Set<() => void>();

/** Sólo `/admin` publica. Repetir el mismo valor no despierta a nadie. */
export function publishOnboardingLanding(next: OnboardingLandingSignal): void {
  if (current === next) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export function subscribeOnboardingLanding(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getOnboardingLandingSignal(): OnboardingLandingSignal {
  return current;
}

/** En el servidor nunca se sabe: el fetch vive en el cliente. */
export function getOnboardingLandingServerSnapshot(): OnboardingLandingSignal {
  return "unknown";
}

/**
 * True mientras la puesta en marcha es dueña de `/admin`.
 *
 * `unknown` cuenta como suya: si la lectura todavía no volvió —o falló— nadie
 * puede afirmar que la cuenta está lista, y una barra roja que aparece y
 * desaparece medio segundo después es peor que no mostrarla.
 */
export function isOnboardingGuidanceOwningHome(signal: OnboardingLandingSignal): boolean {
  return signal !== "normal" && signal !== "not_applicable";
}

/** True mientras la tarjeta de puesta en marcha es la única guía en pantalla. */
export function isSetupCardTheActiveGuide(signal: OnboardingLandingSignal): boolean {
  return signal === "setup_card_only";
}
