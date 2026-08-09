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
        title: "Solicitud de eliminación de cuenta y datos",
        subtitle:
            "Envía esta solicitud para eliminar permanentemente tu cuenta de Parallly y los datos personales asociados. La procesaremos sin demora indebida y, en general, dentro de 30 días, salvo que la ley aplicable exija otro plazo.",
        introHeading: "Antes de continuar",
        introBody:
            "Si recibes mensajes desde una empresa que utiliza Parallly y deseas que esa empresa elimine tus datos, debes contactarla directamente — Parallly actúa como encargado del tratamiento (processor), no como responsable. Si eres titular de una cuenta de Parallly, este formulario solicita eliminar la cuenta y sus datos asociados. Verificaremos tu identidad por correo antes de procesarla. También puedes usarlo para revocar el acceso de Parallly a tu cuenta de Meta (Facebook/Instagram/WhatsApp).",
        emailLabel: "Correo electrónico",
        emailPlaceholder: "tucorreo@ejemplo.com",
        descLabel: "Descripción adicional (opcional)",
        descPlaceholder: "Empresa o cuenta, tu rol, canales vinculados y cualquier dato que nos ayude a localizarla.",
        submit: "Solicitar eliminación de cuenta y datos",
        submitting: "Enviando...",
        successHeading: "Solicitud de eliminación recibida",
        successBody: (code: string) =>
            `Tu solicitud fue registrada con el código `,
        codeIs: "tu código de seguimiento",
        statusLink: "Consultar estado",
        emailSentNote:
            "Guarda tu código de seguimiento. Podremos contactarte por correo para verificar tu identidad antes de procesar la eliminación dentro del plazo legal aplicable.",
        errorGeneric: "No pudimos enviar tu solicitud. Inténtalo de nuevo o escríbenos a cloud.manager@parallext.com.",
        errorEmail: "Ingresa un correo electrónico válido.",
        legalRefHeading: "Marco legal aplicable",
        legalRefBody:
            "Esta solicitud se procesa conforme al Reglamento General de Protección de Datos (GDPR), la Ley General de Protección de Datos de Brasil (LGPD), la California Consumer Privacy Act (CCPA), la Ley 1581 de 2012 de Colombia y las políticas de Meta Platforms para revocación de acceso.",
        contactNote: "Para casos sensibles puedes escribir a ",
    },
    en: {
        backHome: "Back to home",
        title: "Account and data deletion request",
        subtitle:
            "Submit this request to permanently delete your Parallly account and its associated personal data. We will process it without undue delay, normally within 30 days unless applicable law requires a different period.",
        introHeading: "Before you continue",
        introBody:
            "If you receive messages from a business using Parallly and want that business to delete your data, contact it directly — Parallly acts as its data processor, not its controller. If you own a Parallly account, this form requests deletion of the account and its associated data. We will verify your identity by email before processing it. You can also use it to revoke Parallly's access to your Meta (Facebook/Instagram/WhatsApp) account.",
        emailLabel: "Email address",
        emailPlaceholder: "you@example.com",
        descLabel: "Additional description (optional)",
        descPlaceholder: "Business or account, your role, linked channels, and anything that helps us locate it.",
        submit: "Request account and data deletion",
        submitting: "Submitting...",
        successHeading: "Deletion request received",
        successBody: () => "Your request was registered with the code ",
        codeIs: "your tracking code",
        statusLink: "Check status",
        emailSentNote:
            "Keep your tracking code. We may contact you by email to verify your identity before processing the deletion within the applicable legal period.",
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
        title: "Solicitação de exclusão da conta e dos dados",
        subtitle:
            "Envie esta solicitação para excluir permanentemente sua conta do Parallly e os dados pessoais associados. Nós a processaremos sem demora indevida, normalmente em até 30 dias, salvo se a lei aplicável exigir outro prazo.",
        introHeading: "Antes de continuar",
        introBody:
            "Se você recebe mensagens de uma empresa que usa o Parallly e deseja que essa empresa exclua seus dados, contate-a diretamente — o Parallly atua como operador (processor), não como controlador. Se você é titular de uma conta do Parallly, este formulário solicita a exclusão da conta e dos dados associados. Verificaremos sua identidade por e-mail antes do processamento. Você também pode usá-lo para revogar o acesso do Parallly à sua conta da Meta (Facebook/Instagram/WhatsApp).",
        emailLabel: "E-mail",
        emailPlaceholder: "voce@exemplo.com",
        descLabel: "Descrição adicional (opcional)",
        descPlaceholder: "Empresa ou conta, sua função, canais vinculados e qualquer dado que nos ajude a localizá-la.",
        submit: "Solicitar exclusão da conta e dos dados",
        submitting: "Enviando...",
        successHeading: "Solicitação de exclusão recebida",
        successBody: () => "Sua solicitação foi registrada com o código ",
        codeIs: "seu código de acompanhamento",
        statusLink: "Consultar status",
        emailSentNote:
            "Guarde seu código de acompanhamento. Poderemos contatá-lo por e-mail para verificar sua identidade antes de processar a exclusão dentro do prazo legal aplicável.",
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
        title: "Demande de suppression du compte et des données",
        subtitle:
            "Envoyez cette demande pour supprimer définitivement votre compte Parallly et les données personnelles associées. Nous la traiterons sans retard injustifié, généralement sous 30 jours, sauf si la loi applicable impose un autre délai.",
        introHeading: "Avant de continuer",
        introBody:
            "Si vous recevez des messages d'une entreprise utilisant Parallly et souhaitez qu'elle supprime vos données, contactez-la directement — Parallly agit en tant que sous-traitant, pas en tant que responsable du traitement. Si vous êtes titulaire d'un compte Parallly, ce formulaire demande la suppression du compte et des données associées. Nous vérifierons votre identité par e-mail avant le traitement. Vous pouvez aussi l'utiliser pour révoquer l'accès de Parallly à votre compte Meta (Facebook/Instagram/WhatsApp).",
        emailLabel: "Adresse e-mail",
        emailPlaceholder: "vous@exemple.com",
        descLabel: "Description additionnelle (facultatif)",
        descPlaceholder: "Entreprise ou compte, votre rôle, canaux liés et toute information nous aidant à le retrouver.",
        submit: "Demander la suppression du compte et des données",
        submitting: "Envoi...",
        successHeading: "Demande de suppression reçue",
        successBody: () => "Votre demande a été enregistrée avec le code ",
        codeIs: "votre code de suivi",
        statusLink: "Consulter le statut",
        emailSentNote:
            "Conservez votre code de suivi. Nous pourrons vous contacter par e-mail afin de vérifier votre identité avant de traiter la suppression dans le délai légal applicable.",
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
