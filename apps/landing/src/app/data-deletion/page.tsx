"use client";

import { useState } from "react";
import Link from "next/link";
import { useLang } from "@/components/LangProvider";
import LegalLangSwitcher from "@/components/LegalLangSwitcher";

const API_BASE =
    (process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1").replace(/\/$/, "");

const STRINGS = {
    es: {
        backHome: "Volver al inicio",
        title: "Solicitud de eliminación de datos",
        subtitle:
            "Envía esta solicitud para que eliminemos los datos personales asociados a tu correo electrónico. Procesaremos la petición en un máximo de 30 días (15 días para residentes de Brasil bajo la LGPD).",
        introHeading: "Antes de continuar",
        introBody:
            "Si recibes mensajes desde una empresa que utiliza Parallly y deseas que esa empresa elimine tus datos, debes contactarla directamente — Parallly actúa como encargado del tratamiento (processor), no como responsable. Si tu cuenta es de Parallly o quieres revocar el acceso de Parallly a tu cuenta de Meta (Facebook/Instagram/WhatsApp), continúa con el formulario.",
        emailLabel: "Correo electrónico",
        emailPlaceholder: "tucorreo@ejemplo.com",
        descLabel: "Descripción adicional (opcional)",
        descPlaceholder: "Cuenta de qué empresa, qué canales (WhatsApp/Instagram/Messenger), motivo, etc.",
        submit: "Enviar solicitud",
        submitting: "Enviando...",
        successHeading: "Solicitud recibida",
        successBody: (code: string) =>
            `Tu solicitud fue registrada con el código `,
        codeIs: "tu código de seguimiento",
        statusLink: "Consultar estado",
        emailSentNote:
            "También enviamos una confirmación a tu correo. Procesaremos la eliminación dentro del plazo legal aplicable.",
        errorGeneric: "No pudimos enviar tu solicitud. Inténtalo de nuevo o escríbenos a cloud.manager@parallext.com.",
        errorEmail: "Ingresa un correo electrónico válido.",
        legalRefHeading: "Marco legal aplicable",
        legalRefBody:
            "Esta solicitud se procesa conforme al Reglamento General de Protección de Datos (GDPR), la Ley General de Protección de Datos de Brasil (LGPD), la California Consumer Privacy Act (CCPA), la Ley 1581 de 2012 de Colombia y las políticas de Meta Platforms para revocación de acceso.",
        contactNote: "Para casos sensibles puedes escribir a ",
    },
    en: {
        backHome: "Back to home",
        title: "Data deletion request",
        subtitle:
            "Submit this request to delete the personal data associated with your email. We will process the request within 30 days (15 days for Brazilian residents under LGPD).",
        introHeading: "Before you continue",
        introBody:
            "If you receive messages from a business using Parallly and you want that business to delete your data, you must contact them directly — Parallly acts as a data processor, not as the controller. If you have a Parallly account, or you want to revoke Parallly's access to your Meta (Facebook/Instagram/WhatsApp) account, continue with the form below.",
        emailLabel: "Email address",
        emailPlaceholder: "you@example.com",
        descLabel: "Additional description (optional)",
        descPlaceholder: "Which business account, which channels (WhatsApp/Instagram/Messenger), reason, etc.",
        submit: "Submit request",
        submitting: "Submitting...",
        successHeading: "Request received",
        successBody: () => "Your request was registered with the code ",
        codeIs: "your tracking code",
        statusLink: "Check status",
        emailSentNote:
            "We also sent a confirmation to your email. We will process the deletion within the applicable legal period.",
        errorGeneric:
            "We couldn't submit your request. Please try again or write to cloud.manager@parallext.com.",
        errorEmail: "Please enter a valid email address.",
        legalRefHeading: "Applicable legal framework",
        legalRefBody:
            "This request is processed under the General Data Protection Regulation (GDPR), Brazil's General Data Protection Law (LGPD), the California Consumer Privacy Act (CCPA), Colombia's Law 1581 of 2012, and Meta Platforms' access-revocation policies.",
        contactNote: "For sensitive cases you can also write to ",
    },
    pt: {
        backHome: "Voltar ao início",
        title: "Solicitação de exclusão de dados",
        subtitle:
            "Envie esta solicitação para que excluamos os dados pessoais associados ao seu e-mail. Processaremos a solicitação em até 30 dias (15 dias para residentes do Brasil sob a LGPD).",
        introHeading: "Antes de continuar",
        introBody:
            "Se você recebe mensagens de uma empresa que usa o Parallly e deseja que essa empresa exclua seus dados, você deve contatá-la diretamente — o Parallly atua como operador (processor), não como controlador. Se sua conta é do Parallly, ou se você quer revogar o acesso do Parallly à sua conta da Meta (Facebook/Instagram/WhatsApp), continue com o formulário abaixo.",
        emailLabel: "E-mail",
        emailPlaceholder: "voce@exemplo.com",
        descLabel: "Descrição adicional (opcional)",
        descPlaceholder: "Conta de qual empresa, quais canais (WhatsApp/Instagram/Messenger), motivo, etc.",
        submit: "Enviar solicitação",
        submitting: "Enviando...",
        successHeading: "Solicitação recebida",
        successBody: () => "Sua solicitação foi registrada com o código ",
        codeIs: "seu código de acompanhamento",
        statusLink: "Consultar status",
        emailSentNote:
            "Também enviamos uma confirmação ao seu e-mail. Processaremos a exclusão dentro do prazo legal aplicável.",
        errorGeneric:
            "Não conseguimos enviar sua solicitação. Tente novamente ou escreva para cloud.manager@parallext.com.",
        errorEmail: "Insira um e-mail válido.",
        legalRefHeading: "Marco legal aplicável",
        legalRefBody:
            "Esta solicitação é processada de acordo com o Regulamento Geral de Proteção de Dados (RGPD/GDPR), a Lei Geral de Proteção de Dados do Brasil (LGPD), a California Consumer Privacy Act (CCPA), a Lei 1581 de 2012 da Colômbia e as políticas da Meta Platforms para revogação de acesso.",
        contactNote: "Para casos sensíveis você também pode escrever para ",
    },
    fr: {
        backHome: "Retour à l'accueil",
        title: "Demande de suppression de données",
        subtitle:
            "Envoyez cette demande pour que nous supprimions les données personnelles associées à votre e-mail. Nous traiterons la demande dans un délai maximum de 30 jours (15 jours pour les résidents du Brésil sous la LGPD).",
        introHeading: "Avant de continuer",
        introBody:
            "Si vous recevez des messages d'une entreprise utilisant Parallly et que vous souhaitez que cette entreprise supprime vos données, vous devez la contacter directement — Parallly agit en tant que sous-traitant, pas en tant que responsable du traitement. Si vous avez un compte Parallly, ou si vous souhaitez révoquer l'accès de Parallly à votre compte Meta (Facebook/Instagram/WhatsApp), continuez avec le formulaire ci-dessous.",
        emailLabel: "Adresse e-mail",
        emailPlaceholder: "vous@exemple.com",
        descLabel: "Description additionnelle (facultatif)",
        descPlaceholder: "Compte de quelle entreprise, quels canaux (WhatsApp/Instagram/Messenger), motif, etc.",
        submit: "Envoyer la demande",
        submitting: "Envoi...",
        successHeading: "Demande reçue",
        successBody: () => "Votre demande a été enregistrée avec le code ",
        codeIs: "votre code de suivi",
        statusLink: "Consulter le statut",
        emailSentNote:
            "Nous avons également envoyé une confirmation à votre e-mail. Nous traiterons la suppression dans le délai légal applicable.",
        errorGeneric:
            "Nous n'avons pas pu envoyer votre demande. Réessayez ou écrivez-nous à cloud.manager@parallext.com.",
        errorEmail: "Veuillez saisir un e-mail valide.",
        legalRefHeading: "Cadre juridique applicable",
        legalRefBody:
            "Cette demande est traitée conformément au Règlement Général sur la Protection des Données (RGPD), à la Loi Générale brésilienne de Protection des Données (LGPD), au California Consumer Privacy Act (CCPA), à la Loi 1581 de 2012 de Colombie et aux politiques de Meta Platforms en matière de révocation d'accès.",
        contactNote: "Pour les cas sensibles, vous pouvez également écrire à ",
    },
} as const;

export default function DataDeletionPage() {
    const { locale } = useLang();
    const t = STRINGS[(locale as keyof typeof STRINGS) || "es"] || STRINGS.es;

    const [email, setEmail] = useState("");
    const [description, setDescription] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmationCode, setConfirmationCode] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            setError(t.errorEmail);
            return;
        }
        setSubmitting(true);
        try {
            const res = await fetch(`${API_BASE}/meta/data-deletion-request`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim(), description: description.trim() || undefined }),
            });
            const data = await res.json();
            if (!res.ok || !data?.confirmation_code) {
                setError(t.errorGeneric);
            } else {
                setConfirmationCode(data.confirmation_code);
            }
        } catch {
            setError(t.errorGeneric);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-bg text-text-primary">
            <div className="mx-auto max-w-3xl px-6 py-16">
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-accent transition-colors mb-12"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    {t.backHome}
                </Link>

                <LegalLangSwitcher />

                <h1 className="text-4xl font-bold tracking-tight mb-3">{t.title}</h1>
                <p className="text-text-muted text-base mb-10">{t.subtitle}</p>

                <section className="mb-10 rounded-xl border border-border bg-surface p-6">
                    <h2 className="text-lg font-semibold text-text-primary mb-2">
                        {t.introHeading}
                    </h2>
                    <p className="text-sm text-text-secondary leading-relaxed">{t.introBody}</p>
                </section>

                {confirmationCode ? (
                    <section className="mb-10 rounded-xl border border-accent/40 bg-accent/5 p-6">
                        <h2 className="text-lg font-semibold text-text-primary mb-3">
                            {t.successHeading}
                        </h2>
                        <p className="text-sm text-text-secondary mb-4 leading-relaxed">
                            {t.successBody(confirmationCode)}
                            <code className="font-mono text-text-primary bg-bg px-2 py-1 rounded">
                                {confirmationCode}
                            </code>
                            {" "}({t.codeIs}).
                        </p>
                        <p className="text-sm text-text-secondary mb-5">{t.emailSentNote}</p>
                        <Link
                            href={`/data-deletion/status?code=${confirmationCode}`}
                            className="inline-flex items-center gap-2 text-sm bg-accent text-white px-4 py-2 rounded-lg font-medium hover:bg-accent/90 transition-colors"
                        >
                            {t.statusLink}
                        </Link>
                    </section>
                ) : (
                    <form
                        onSubmit={submit}
                        className="space-y-6 mb-10 rounded-xl border border-border bg-surface p-6"
                    >
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-text-primary mb-2">
                                {t.emailLabel} <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={t.emailPlaceholder}
                                required
                                disabled={submitting}
                                className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors disabled:opacity-60"
                            />
                        </div>
                        <div>
                            <label htmlFor="description" className="block text-sm font-medium text-text-primary mb-2">
                                {t.descLabel}
                            </label>
                            <textarea
                                id="description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t.descPlaceholder}
                                rows={4}
                                disabled={submitting}
                                className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors disabled:opacity-60 resize-none"
                            />
                        </div>
                        {error && (
                            <p className="text-sm text-red-500" role="alert">
                                {error}
                            </p>
                        )}
                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full bg-accent text-white py-3 rounded-lg font-medium hover:bg-accent/90 transition-colors disabled:opacity-60"
                        >
                            {submitting ? t.submitting : t.submit}
                        </button>
                    </form>
                )}

                <section className="text-sm text-text-muted leading-relaxed border-t border-border pt-8">
                    <h3 className="text-base font-medium text-text-secondary mb-2">
                        {t.legalRefHeading}
                    </h3>
                    <p className="mb-3">{t.legalRefBody}</p>
                    <p>
                        {t.contactNote}
                        <a href="mailto:cloud.manager@parallext.com" className="text-accent hover:underline">
                            cloud.manager@parallext.com
                        </a>
                        .
                    </p>
                </section>
            </div>
        </div>
    );
}
