---
id: integraciones-desarrolladores
title: "Integrações, API, webhooks e chat web"
routes: ["/admin/settings/integrations", "/admin/settings/integrations/crm", "/admin/settings/integrations/ecommerce", "/admin/settings/integrations/mcp", "/admin/settings/integrations/payments", "/admin/settings/integrations/reviews", "/admin/settings/integrations/slack", "/admin/settings/integrations/vertical", "/admin/settings/integrations/webhooks", "/admin/settings/api-keys", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["integracoes", "api", "chave api", "webhook", "mcp", "crm", "ecommerce", "pagamentos", "avaliacoes", "slack", "chat web", "widget", "desenvolvedores", "credenciais"]
---

# Integrações, API, webhooks e chat web

Um administrador gerencia conexões externas em **Configurações → Canais e integrações**. Ali pode conectar CRM, comércio eletrônico, pagamentos, avaliações, Slack, serviços do vertical e servidores MCP, além de configurar o chat web.

Para integrações próprias, use **Chaves de API** e **Webhooks**. Trate chaves e segredos como senhas: copie apenas para o sistema que precisa deles, gire uma credencial exposta e valide a assinatura de cada webhook. Antes de ativar em produção, teste o evento com dados não sensíveis e confirme quais ações ele pode executar.

Em **Integrações → Pagamentos**, o negócio pode conectar sua própria conta Wompi ou provedor de pagamento compatível para cobrar clientes. O dinheiro vai diretamente para essa conta e essas credenciais nunca pagam a assinatura da Parallly. Selecione um único provedor ativo, copie a URL de eventos mostrada na tela e ative **Cobranças de clientes** no agente. O agente usa o valor do pedido salvo na Parallly e só confirma “pago” quando o backend valida o evento e a transação canônica do provedor; um link, redirecionamento ou captura de tela não comprova o pagamento. Novos links dependem da feature atual do plano, mas pagamentos já emitidos continuam sendo conciliados após um downgrade.

A disponibilidade de cada conector depende da configuração da conta. A tela da integração e **Plano e faturamento** são a fonte atual; evite usar limites ou preços copiados em documentos externos.
