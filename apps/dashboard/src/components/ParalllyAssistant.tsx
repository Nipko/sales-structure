"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Parallly — el personaje del asistente.
 *
 * La cabeza ES la insignia del logo (dos cuadrados redondeados superpuestos a
 * 45°) y los ojos son los dos checks del logo, paralelos (misma dirección que
 * la marca). Las manitas son mini insignias, eco de la cabeza.
 *
 * Todo es SVG inline animado con un solo requestAnimationFrame que se pausa
 * cuando la pestaña está oculta. Con `prefers-reduced-motion` queda estático.
 */

export type ParalllyState = "idle" | "hover" | "wave" | "think" | "happy";

const BLUE = "#3897f0";
const BLUE_DARK = "#2b7cd4";

interface Props {
    /** Ancho en px (la altura sale de la proporción 120:152). */
    size?: number;
    state?: ParalllyState;
    className?: string;
    /** Texto para lectores de pantalla. */
    label?: string;
}

export function ParalllyAssistant({ size = 60, state = "idle", className = "", label }: Props) {
    const uid = useId().replace(/:/g, "");
    const stateRef = useRef<ParalllyState>(state);

    const floatRef = useRef<SVGGElement>(null);
    const shadowRef = useRef<SVGEllipseElement>(null);
    const headRef = useRef<SVGGElement>(null);
    const eyesRef = useRef<SVGGElement>(null);
    const handLRef = useRef<SVGGElement>(null);
    const handRRef = useRef<SVGGElement>(null);

    // Mantener el estado accesible dentro del loop sin recrearlo en cada cambio.
    useEffect(() => { stateRef.current = state; }, [state]);

    useEffect(() => {
        const reduce = typeof window !== "undefined"
            && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

        if (reduce) {
            // Sin movimiento: pose neutra legible.
            floatRef.current?.setAttribute("transform", "");
            eyesRef.current?.setAttribute("transform", "");
            return;
        }

        let raf = 0;
        let t = 0;

        const tick = () => {
            if (!document.hidden) {
                t += 1 / 60;
                const st = stateRef.current;
                const y = Math.sin(t * 1.5) * 4;
                const blink = t % 4.2 > 4.06;
                const bob = st === "wave" ? Math.abs(Math.sin(t * 4)) * -5 : 0;

                floatRef.current?.setAttribute("transform", `translate(0 ${(y + bob).toFixed(2)})`);
                if (shadowRef.current) {
                    shadowRef.current.setAttribute("rx", (24 - (y + bob) * 0.8).toFixed(1));
                    shadowRef.current.setAttribute("opacity", (0.17 - (y + bob) * 0.006).toFixed(3));
                }

                // Cabeza: se inclina al saludar, se ladea contenta, oscila al pensar.
                const tilt = st === "wave" ? Math.sin(t * 3.4) * 7
                    : st === "happy" || st === "hover" ? -4
                        : st === "think" ? Math.sin(t * 1.2) * 2.5
                            : 0;
                headRef.current?.setAttribute("transform", `rotate(${tilt.toFixed(2)} 60 48)`);

                // Manitas: flotan desfasadas del cuerpo; la derecha saluda.
                handLRef.current?.setAttribute("transform", `translate(0 ${(Math.sin(t * 1.5 + 1.1) * 3).toFixed(2)})`);
                if (handRRef.current) {
                    if (st === "wave" || st === "hover") {
                        const speed = st === "wave" ? 7 : 4;
                        handRRef.current.setAttribute(
                            "transform",
                            `rotate(${(-24 + Math.sin(t * speed) * 24).toFixed(1)} 97 108) translate(0 -6)`,
                        );
                    } else {
                        handRRef.current.setAttribute("transform", `translate(0 ${(Math.sin(t * 1.5 + 0.4) * 3).toFixed(2)})`);
                    }
                }

                // Ojos-check.
                if (eyesRef.current) {
                    if (st === "think") {
                        const k = (0.55 + Math.abs(Math.sin(t * 4)) * 0.5).toFixed(3);
                        eyesRef.current.setAttribute("transform", `translate(0 50) scale(1 ${k}) translate(0 -50)`);
                        eyesRef.current.setAttribute("opacity", (0.75 + Math.abs(Math.sin(t * 4)) * 0.25).toFixed(2));
                    } else {
                        eyesRef.current.setAttribute("opacity", "1");
                        if (blink) {
                            eyesRef.current.setAttribute("transform", "translate(0 50) scale(1 0.1) translate(0 -50)");
                        } else if (st === "happy" || st === "hover") {
                            eyesRef.current.setAttribute("transform", "translate(0 50) scale(1.08 0.68) translate(0 -50)");
                        } else {
                            eyesRef.current.setAttribute("transform", "");
                        }
                    }
                }
            }
            raf = requestAnimationFrame(tick);
        };

        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    // Los dos checks del logo, paralelos (misma dirección).
    const check = "M -7 -1 L -2.5 4.5 L 7 -7";

    return (
        <svg
            viewBox="0 0 120 152"
            width={size}
            height={(size * 152) / 120}
            className={className}
            role="img"
            aria-label={label || "Parallly, asistente de ayuda"}
        >
            <defs>
                <linearGradient id={`pg${uid}`} x1=".2" y1="0" x2=".8" y2="1">
                    <stop offset="0" stopColor={BLUE} />
                    <stop offset="1" stopColor={BLUE_DARK} />
                </linearGradient>
            </defs>

            {/* Sombra de contacto: vende la levitación */}
            <ellipse ref={shadowRef} cx="60" cy="144" rx="24" ry="4.5" fill="#0b1230" opacity=".16" />

            <g ref={floatRef}>
                {/* Manitas = mini insignias */}
                <g ref={handLRef}>
                    <rect x="15" y="98" width="15" height="15" rx="5" fill={`url(#pg${uid})`} />
                    <rect x="15" y="98" width="15" height="15" rx="5" fill={`url(#pg${uid})`} transform="rotate(45 22.5 105.5)" />
                </g>
                <g ref={handRRef}>
                    <rect x="90" y="98" width="15" height="15" rx="5" fill={`url(#pg${uid})`} />
                    <rect x="90" y="98" width="15" height="15" rx="5" fill={`url(#pg${uid})`} transform="rotate(45 97.5 105.5)" />
                </g>

                {/* Cuerpo */}
                <ellipse cx="60" cy="112" rx="21" ry="23" fill={`url(#pg${uid})`} />
                <ellipse cx="52" cy="104" rx="6" ry="9" fill="#fff" opacity=".18" />

                {/* Cabeza = insignia del logo */}
                <g ref={headRef}>
                    <ellipse cx="60" cy="86" rx="20" ry="6" fill="#0b1230" opacity=".13" />
                    <rect x="24" y="12" width="72" height="72" rx="22" fill={`url(#pg${uid})`} />
                    <rect x="24" y="12" width="72" height="72" rx="22" fill={`url(#pg${uid})`} transform="rotate(45 60 48)" />
                    <g ref={eyesRef}>
                        <path d={check} stroke="#fff" strokeWidth="6.5" fill="none" strokeLinecap="square" strokeLinejoin="miter" transform="translate(45 50)" />
                        <path d={check} stroke="#fff" strokeWidth="6.5" fill="none" strokeLinecap="square" strokeLinejoin="miter" transform="translate(75 50)" />
                    </g>
                </g>
            </g>
        </svg>
    );
}
