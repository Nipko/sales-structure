"""Build the Spanish client guide for Meta's October 2026 WhatsApp pricing.

Usage: python docs/communications/meta-whatsapp-2026-10/build_guide.py
Requires reportlab. Output: output/pdf/parallly-guia-pagos-meta-whatsapp.pdf
Content verified against the linked Meta sources on 2026-09-30.
"""

from pathlib import Path
import argparse
import os
import shutil

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = ROOT / "output/pdf/parallly-guia-pagos-meta-whatsapp.pdf"
PUBLIC_OUTPUT = ROOT / "apps/dashboard/public/help/meta-whatsapp-pagos-2026-10.pdf"
WIDTH, HEIGHT = A4
MARGIN = 43
CONTENT_WIDTH = WIDTH - 2 * MARGIN
NAVY = colors.HexColor("#122440")
INK = colors.HexColor("#23354B")
MUTED = colors.HexColor("#5D6D82")
BLUE = colors.HexColor("#2479CD")
BRAND = colors.HexColor("#3897F0")
LIGHT = colors.HexColor("#EEF6FF")
LINE = colors.HexColor("#D8E3EE")
TEAL = colors.HexColor("#117968")
GREEN = colors.HexColor("#EDF8F3")
AMBER = colors.HexColor("#88530D")
PALE_AMBER = colors.HexColor("#FFF5E5")

LINKS = {
    "pricing": "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing",
    "add": "https://www.facebook.com/business/help/488291839463771",
    "assign": "https://www.facebook.com/business/help/3146639885655187",
    "manager": "https://business.facebook.com/wa/manage/home/",
    "billing": "https://business.facebook.com/latest/billing_hub/payment_methods/",
    "parallly": "https://admin.parallly-chat.cloud/admin/channels/whatsapp",
    "support": "https://parallly-chat.cloud/support",
}


def register_fonts():
    """Use locally installed fonts, with a portable ReportLab fallback."""
    font_dir = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    candidates = [
        (font_dir / "segoeui.ttf", font_dir / "segoeuib.ttf"),
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ),
    ]
    for regular, bold in candidates:
        if regular.exists() and bold.exists():
            pdfmetrics.registerFont(TTFont("Guide", str(regular)))
            pdfmetrics.registerFont(TTFont("GuideBold", str(bold)))
            pdfmetrics.registerFontFamily("Guide", normal="Guide", bold="GuideBold")
            return "Guide", "GuideBold"
    return "Helvetica", "Helvetica-Bold"


FONT, BOLD = register_fonts()


def link(label, key):
    return f'<link href="{LINKS[key]}" color="#2479CD"><u>{label}</u></link>'


def paragraph(c, text, x, top, width, size=10.3, leading=14.2, color=INK, bold=False):
    style = ParagraphStyle(
        "GuideParagraph", fontName=BOLD if bold else FONT, fontSize=size,
        leading=leading, textColor=color, alignment=TA_LEFT,
        spaceBefore=0, spaceAfter=0, allowWidows=0, allowOrphans=0,
    )
    p = Paragraph(text, style)
    _, height = p.wrap(width, HEIGHT)
    p.drawOn(c, x, HEIGHT - top - height)
    return top + height


def panel(c, x, top, width, height, fill, radius=10, stroke=None):
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    c.roundRect(x, HEIGHT - top - height, width, height, radius, fill=1,
                stroke=1 if stroke else 0)


def rule(c, top):
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.line(MARGIN, HEIGHT - top, WIDTH - MARGIN, HEIGHT - top)


def page_base(c, page, section):
    c.setFillColor(BRAND)
    c.rect(0, HEIGHT - 6, WIDTH, 6, fill=1, stroke=0)
    paragraph(c, "parallly", MARGIN, 25, 160, size=22, leading=27, color=NAVY, bold=True)
    paragraph(c, "GUÍA PARA CLIENTES", WIDTH - 205, 34, 162,
              size=8.2, leading=10, color=MUTED)
    rule(c, 66)
    rule(c, 788)
    paragraph(c, "Edición: 30 de septiembre de 2026", MARGIN, 800, 240,
              size=8.1, leading=10, color=MUTED)
    paragraph(c, f"{section}   |   {page} / 3", WIDTH - 255, 800, 212,
              size=8.1, leading=10, color=MUTED)


def section_label(c, text, top):
    return paragraph(c, text, MARGIN, top, CONTENT_WIDTH,
                     size=9.2, leading=12, color=BLUE, bold=True)


def step(c, number, title, body, top, width=CONTENT_WIDTH):
    panel(c, MARGIN, top + 1, 27, 27, LIGHT, radius=8)
    paragraph(c, str(number), MARGIN + 8, top + 5, 20,
              size=11.5, leading=15, color=BLUE, bold=True)
    x = MARGIN + 40
    end = paragraph(c, title, x, top, width - 40,
                    size=11, leading=15, color=NAVY, bold=True)
    return paragraph(c, body, x, end + 4, width - 40) + 15


def check(c, text, top):
    c.setStrokeColor(TEAL)
    c.setLineWidth(1)
    c.roundRect(MARGIN + 15, HEIGHT - top - 11, 10, 10, 2, stroke=1, fill=0)
    return paragraph(c, text, MARGIN + 36, top - 1, CONTENT_WIDTH - 51,
                     size=10.2, leading=14) + 11


def faq(c, question, answer, top):
    end = paragraph(c, question, MARGIN, top, CONTENT_WIDTH,
                    size=10.6, leading=14, color=NAVY, bold=True)
    return paragraph(c, answer, MARGIN, end + 3, CONTENT_WIDTH,
                     size=9.8, leading=13.4) + 12


def page_one(c):
    page_base(c, 1, "Qué cambia")
    section_label(c, "WHATSAPP BUSINESS PLATFORM", 86)
    paragraph(c, "Prepara los pagos<br/>de tu WhatsApp", MARGIN, 109,
              CONTENT_WIDTH, size=29, leading=34, color=NAVY, bold=True)
    panel(c, MARGIN, 193, CONTENT_WIDTH, 69, NAVY)
    paragraph(c, "Desde el 1 de octubre de 2026", MARGIN + 17, 207,
              CONTENT_WIDTH - 34, size=14.6, leading=19, color=colors.white, bold=True)
    paragraph(c, "A las 00:00, según la zona horaria de tu cuenta en Meta.",
              MARGIN + 17, 233, CONTENT_WIDTH - 34, size=10.3, leading=14,
              color=colors.HexColor("#DBE9FA"))
    paragraph(c, "Revisa el método de pago de la cuenta que usa tu número antes del cambio.",
              MARGIN, 279, CONTENT_WIDTH, size=11.5, leading=16, bold=True)

    top = 324
    rows = [
        ("1.000 mensajes de servicio entregados gratis al mes por número",
         "Son respuestas sin plantilla. El cupo se comparte entre los envíos del número "
         "y no se acumula para el mes siguiente."),
        ("Después del cupo, el pago es necesario para entregar",
         "Meta cobra los mensajes de servicio que superen ese cupo. Sin un método de pago, "
         "no entrega esos mensajes de pago."),
        ("También cambian las plantillas de utilidad",
         "Desde el 1 de octubre se cobran incluso dentro de la ventana de atención de "
         "24 horas, salvo las excepciones gratuitas que Meta establezca."),
    ]
    for title, body in rows:
        c.setFillColor(BRAND)
        c.circle(MARGIN + 4, HEIGHT - top - 6, 3, stroke=0, fill=1)
        end = paragraph(c, title, MARGIN + 17, top, CONTENT_WIDTH - 17,
                        size=10.8, leading=14.5, color=NAVY, bold=True)
        end = paragraph(c, body, MARGIN + 17, end + 4, CONTENT_WIDTH - 17,
                        size=10.2, leading=14)
        top = end + 16

    paragraph(c, "Los mensajes entrantes siguen siendo gratuitos. El precio de los envíos depende "
              "del país del destinatario, la moneda y el tipo de mensaje. El cupo gratuito no elimina "
              "los pendientes técnicos o las pausas que Parallly muestre para tu número.",
              MARGIN, 531, CONTENT_WIDTH, size=10, leading=14, color=MUTED)

    panel(c, MARGIN, 590, CONTENT_WIDTH, 125, GREEN)
    paragraph(c, "Tu revisión antes de continuar", MARGIN + 15, 604,
              CONTENT_WIDTH - 30, size=11.5, leading=15, color=TEAL, bold=True)
    top = check(c, "Identifica la cuenta de Meta y el número conectados a Parallly.", 632)
    top = check(c, "Confirma que el método de pago esté asignado a esa cuenta.", top)
    check(c, "Haz una prueba real y confirma que el destinatario la reciba.", top)
    paragraph(c, "Consulta el detalle y las excepciones en " + link("Precios oficiales de Meta", "pricing") + ".",
              MARGIN, 738, CONTENT_WIDTH, size=9, leading=13, color=MUTED)
    c.showPage()


def page_two(c):
    page_base(c, 2, "Configurar el pago")
    section_label(c, "PASO A PASO EN META", 86)
    paragraph(c, "Agrega o verifica<br/>tu método de pago", MARGIN, 109,
              CONTENT_WIDTH, size=26, leading=31, color=NAVY, bold=True)
    paragraph(c, "Necesitas permiso para administrar la cuenta de WhatsApp. "
              "Pide ayuda a su administrador si no ves las opciones de pago.",
              MARGIN, 185, CONTENT_WIDTH, size=10.3, leading=14.2, color=MUTED)

    top = 232
    top = step(c, 1, "Abre el Administrador de WhatsApp", "Entra en "
               + link("business.facebook.com/wa/manage/home", "manager")
               + ". Inicia sesión con el perfil que administra tu negocio.", top)
    top = step(c, 2, "Selecciona la cuenta correcta", "Comprueba el negocio y el número. "
               "Abre los tres puntos de la cuenta y entra en <b>Administrar configuración "
               "de la cuenta</b>.", top)
    top = step(c, 3, "Ve a la configuración de pago", "Entra en <b>Configuración</b> y luego "
               "en <b>Configuración de pago</b>. Selecciona <b>Agregar método de pago</b>.", top)
    top = step(c, 4, "Completa y guarda los datos", "Revisa país y moneda. Elige un método "
               "válido de los que ofrezca Meta; si usas tarjeta, guarda sus datos y después "
               "los datos de la empresa que solicite el formulario.", top)
    top = step(c, 5, "Confirma la asignación a esta cuenta", "Verifica que el método aparezca "
               "en la cuenta de WhatsApp que usa tu número. Si eliges una tarjeta ya guardada "
               "en el portafolio, asígnala a esta cuenta y establécela como principal.", top)
    top = step(c, 6, "Vuelve a Parallly y comprueba el resultado", "Como administrador, usa la "
               "comprobación del método de pago en Canales > WhatsApp. Resuelve los pendientes "
               "y prueba una respuesta a un cliente real. Una entrega gratuita, por sí sola, "
               "no acredita que el pago esté listo.", top)

    panel(c, MARGIN, 682, CONTENT_WIDTH, 79, LIGHT)
    paragraph(c, "Acceso alternativo", MARGIN + 14, 694, CONTENT_WIDTH - 28,
              size=10.5, leading=14, color=BLUE, bold=True)
    paragraph(c, "Abre " + link("Facturación y pagos de Meta", "billing") +
              " y elige el portafolio y la cuenta de WhatsApp correctos. Meta puede mostrar "
              "el nombre “cuenta de mensajes”. Los rótulos pueden variar según la cuenta.",
              MARGIN + 14, 715, CONTENT_WIDTH - 28, size=9.8, leading=13.4)
    c.showPage()


def page_three(c):
    page_base(c, 3, "Cuentas nuevas y ayuda")
    section_label(c, "PARA NUEVAS CONEXIONES", 86)
    paragraph(c, "Conecta, configura y verifica", MARGIN, 111,
              CONTENT_WIDTH, size=24, leading=29, color=NAVY, bold=True)
    top = 161
    top = step(c, 1, "Abre WhatsApp en Parallly", "Ve a " + link("Canales > WhatsApp", "parallly") +
               " y elige el flujo que corresponda: número nuevo, coexistencia o migración.", top)
    top = step(c, 2, "Completa la conexión con Meta", "Usa <b>Conectar con Facebook</b>. "
               "En el diálogo de Meta, crea o selecciona la cuenta y el número que vayas a usar.", top)
    top = step(c, 3, "Revisa pagos y pendientes de la conexión", "Sigue la página 2. Parallly "
               "consulta la financiación y muestra pendientes de pago, zona horaria o registro. "
               "Un resultado desconocido no prueba que falte una tarjeta; un método asociado "
               "tampoco garantiza que Meta apruebe un cargo.", top)
    paragraph(c, "Configura, prueba y publica el agente asignado a esta conexión. Después "
              "confirma una respuesta real: conectar WhatsApp no publica por sí solo al agente.",
              MARGIN + 40, top + 1, CONTENT_WIDTH - 40, size=9.8, leading=13.4, color=MUTED)

    rule(c, 391)
    section_label(c, "DUDAS FRECUENTES", 408)
    top = faq(c, "¿Sirve la tarjeta que uso para anuncios o para Parallly?",
              "Comprueba su asignación en Meta. Una tarjeta de anuncios, del portafolio o de "
              "tu suscripción a Parallly no demuestra que esté configurada para esta cuenta de WhatsApp.", 432)
    top = faq(c, "¿Aplica a la IA y a las respuestas de mi equipo?",
              "Las respuestas sin plantilla enviadas por la API desde Parallly, automáticas o humanas, "
              "son mensajes de servicio. El producto Meta Business Agent es independiente de la IA de Parallly.", top)
    top = faq(c, "¿Qué hago si ya pago mediante un proveedor?",
              "Si tu cuenta usa una línea de crédito de un proveedor, confirma con él quién asume "
              "la facturación antes de agregar otro método. Si no usas WhatsApp en Parallly, "
              "conserva esta guía para cuando lo conectes.", top)

    panel(c, MARGIN, 629, CONTENT_WIDTH, 64, PALE_AMBER)
    paragraph(c, "¿Necesitas ayuda?", MARGIN + 14, 640, CONTENT_WIDTH - 28,
              size=10.5, leading=14, color=AMBER, bold=True)
    paragraph(c, "Visita " + link("Soporte Parallly", "support") +
              ' o escribe a <link href="mailto:it.executive@parallext.com" color="#2479CD">'
              "it.executive@parallext.com</link>. Comparte el error y la cuenta afectada; "
              "nunca envíes el número completo de tu tarjeta, CVV ni códigos bancarios.",
              MARGIN + 14, 660, CONTENT_WIDTH - 28, size=9, leading=12.2)

    paragraph(c, "FUENTES OFICIALES", MARGIN, 711, CONTENT_WIDTH,
              size=8.7, leading=11, color=MUTED, bold=True)
    paragraph(c, link("1. Precios y cambios de WhatsApp Business Platform", "pricing") +
              "<br/>" + link("2. Agregar un método de pago a WhatsApp Business", "add") +
              "<br/>" + link("3. Asignar una tarjeta existente a una cuenta de WhatsApp", "assign"),
              MARGIN, 730, CONTENT_WIDTH, size=8.8, leading=13.4)
    c.showPage()


def build(output):
    output.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
    c.setTitle("Parallly | Guía de pagos de Meta para WhatsApp")
    c.setAuthor("Parallly")
    c.setSubject("Cambio del 1 de octubre de 2026 y configuración del método de pago")
    c.setKeywords("Parallly, WhatsApp, Meta, pagos, octubre 2026")
    page_one(c)
    page_two(c)
    page_three(c)
    c.save()
    print(output.resolve())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--copy-public", action="store_true", help="Also update the dashboard's public PDF copy")
    args = parser.parse_args()
    build(args.output)
    if args.copy_public:
        PUBLIC_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        if args.output.resolve() != PUBLIC_OUTPUT.resolve():
            shutil.copyfile(args.output, PUBLIC_OUTPUT)
        print(PUBLIC_OUTPUT.resolve())
