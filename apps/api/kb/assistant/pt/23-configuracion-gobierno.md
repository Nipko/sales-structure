---
id: configuracion-gobierno
title: "Configurações da empresa, políticas e governança"
routes: ["/admin/settings/business-info", "/admin/settings/localization", "/admin/settings/fiscal", "/admin/settings/business-hours", "/admin/settings/policies", "/admin/settings/alerts", "/admin/compliance", "/admin/settings/media", "/admin/settings/prechat", "/admin/settings/email-templates", "/admin/settings/macros", "/admin/settings/recall", "/admin/settings/public-booking"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["configuracoes", "empresa", "informacoes do negocio", "idioma", "fuso horario", "fiscal", "horarios", "politicas", "alertas", "conformidade", "midia", "prechat", "emails", "macros", "memoria", "reservas", "recall", "reengajamento"]
---

# Configurações da empresa, políticas e governança

**Configurações** reúne dados que afetam várias áreas. Administradores controlam identidade, localização, dados fiscais, políticas e recursos sensíveis. Supervisores podem operar telas habilitadas para seu perfil, como alertas ou mídia, mas não devem assumir permissões de administrador.

- **Conta e empresa**: perfil, informações do negócio, idioma, fuso horário, dados fiscais e horários.
- **CRM e conversas**: atributos, pipeline, formulários pré-chat, macros, memória e modelos de email.
- **Governança e alertas**: políticas que o agente pode consultar, conformidade, notificações e regras de alerta.
- **Experiência pública**: biblioteca de mídia e página pública de reservas.

A tela é a autoridade: se uma ação não aparece, seu perfil ou a configuração da conta podem não habilitá-la. Antes de salvar, verifique quais canais, agentes ou automações consomem o dado. Alterar fuso horário, horários, políticas ou identidade pode mudar respostas e programações; registre o motivo e teste o agente antes de publicar mudanças delicadas.

## Reengajamento automático (recall)

Só um administrador configura, em **Configurações → Recall automático** (a tela se chama **Reengajamento automático**), e ele aparece se o seu plano inclui o recurso. Serve para voltar a escrever para quem não retornou: limpezas dentárias semestrais, consultas veterinárias de controle ou renovações.

- **Dias sem atividade para reengajar**: quanto tempo depois da última consulta concluída (por exemplo 180 para uma limpeza semestral).
- **Dias de espera entre reengajamentos**: tempo mínimo antes de escrever de novo para a mesma pessoa.
- **Canal de envio** e **Mensagem**: o canal precisa estar conectado e ativo; a mensagem aceita as variáveis `{name}` e `{months}`.

A verificação roda todos os dias às 9h (horário do servidor) e só escreve para contatos com telefone, sem descadastro registrado, cuja última consulta **marcada como concluída** passou do limite; por isso convém concluir os agendamentos em **Agendamentos**. **Enviar agora (teste)** executa a mesma verificação na hora e envia mensagens reais aos contatos que se qualificam. Se você tem vários números do mesmo canal e a Parallly não consegue saber de qual enviar, ela não envia: deixa uma tarefa para você escolher o número.
