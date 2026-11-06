---
id: integraciones-desarrolladores
title: "Integrações, API, webhooks e chat web"
routes: ["/admin/settings/integrations", "/admin/settings/integrations/crm", "/admin/settings/integrations/ecommerce", "/admin/settings/integrations/mcp", "/admin/settings/integrations/payments", "/admin/settings/integrations/reviews", "/admin/settings/integrations/slack", "/admin/settings/integrations/vertical", "/admin/settings/integrations/channel-manager", "/admin/settings/integrations/webhooks", "/admin/settings/api-keys", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["integracoes", "api", "chave api", "webhook", "mcp", "crm", "ecommerce", "pagamentos", "avaliacoes", "slack", "chat web", "widget", "desenvolvedores", "credenciais", "toast", "mindbody", "cliniko", "channel manager", "google business"]
---

# Integrações, API, webhooks e chat web

Um administrador gerencia conexões externas em **Configurações → Canais e integrações**. Ali pode conectar CRM, comércio eletrônico, pagamentos, avaliações, Slack, serviços do vertical e servidores MCP, além de configurar o chat web.

Para integrações próprias, use **Chaves de API** e **Webhooks**. Trate chaves e segredos como senhas: copie apenas para o sistema que precisa deles, gire uma credencial exposta e valide a assinatura de cada webhook. Antes de ativar em produção, teste o evento com dados não sensíveis e confirme quais ações ele pode executar.

Em **Integrações → Pagamentos**, o negócio pode conectar sua própria conta Wompi ou provedor de pagamento compatível para cobrar clientes. O dinheiro vai diretamente para essa conta e essas credenciais nunca pagam a assinatura da Parallly. Selecione um único provedor ativo, copie a URL de eventos mostrada na tela e ative **Cobranças de clientes** no agente. O agente usa o valor do pedido salvo na Parallly e só confirma “pago” quando o backend valida o evento e a transação canônica do provedor; um link, redirecionamento ou captura de tela não comprova o pagamento. Novos links dependem da feature atual do plano, mas pagamentos já emitidos continuam sendo conciliados após um downgrade.

A disponibilidade de cada conector depende da configuração da conta. A tela da integração e **Plano e faturamento** são a fonte atual; evite usar limites ou preços copiados em documentos externos.

## Integrações verticais (Toast, Mindbody, Cliniko)

Em **Configurações → Canais e integrações → Integrações verticais** você conecta o sistema que seu setor já usa: **Toast** (restaurantes: cardápio, itens e preços), **Mindbody** (academias: aulas e horários) ou **Cliniko** (saúde: tipos de consulta e disponibilidade, sem acesso ao prontuário). A tela mostra apenas os provedores que se aplicam ao seu tipo de negócio.

São integrações **somente leitura e em beta**: levam dados ao agente, mas não escrevem no sistema de origem nem confirmam disponibilidade ao vivo quando o provedor não a oferece (o Mindbody, por exemplo, não confirma vagas nem reservas). Preencha as credenciais, clique em **Testar** e, se a conexão responder, em **Sincronizar**. Cada cartão mostra o status, quando chegou o último dado e se faltam permissões. O **Mapeamento por recurso** vincula uma unidade, agenda ou recurso da Parallly ao seu identificador externo; um mapeamento nunca habilita escritas sozinho.

## Channel Manager (hotel e aluguel de temporada)

Se o seu negócio é hotel ou aluguel de temporada, essa tela mostra também um acesso ao **Channel Manager**, que conecta o Hostaway. Você pode usar **Testar sem sincronizar** antes de salvar; depois clique em **Sincronizar agora** e vincule cada anúncio externo a exatamente uma acomodação da Parallly. O Hostaway continua sendo a fonte da verdade: o agente ainda não cria reservas lá, e um anúncio sem mapeamento mantém bloqueadas as reservas por conversa e as passa para sua equipe. Sem channel manager, você pode sincronizar Airbnb ou Booking.com por iCal em cada propriedade (veja **Ferramentas e módulos para o seu setor**).

## Avaliações do Google

Em **Configurações → Canais e integrações → Avaliações**, clique em **Conectar Google Business**, autorize o acesso e salve o local. **Sincronizar** traz as avaliações (elas também se atualizam sozinhas a cada poucas horas) e mostra a avaliação média, o total, as que estão sem resposta e as negativas. Em cada avaliação, **Sugerir com IA** propõe uma resposta no idioma da sua conta; revise, edite se precisar e clique em **Publicar resposta** para publicá-la no Google. Se você ativar **Resposta automática com IA**, a Parallly publica sem revisão humana uma resposta a cada nova avaliação sem resposta, inclusive as negativas: ative apenas se aceitar esse risco.

## Servidores MCP externos

Conectar ou descobrir um servidor MCP externo não autoriza suas ferramentas. Um administrador revisa cada ferramenta e declara seu efeito (leitura, escrita, pagamento, notificação ou irreversível) e se exige confirmação do cliente ou aprovação humana. Uma ferramenta não revisada fica bloqueada para o agente.
