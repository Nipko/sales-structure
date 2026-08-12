---
id: agentes-ia
title: "Agentes de IA: criar e configurar"
routes: ["/admin/agent", "/admin/agent/simulation"]
roles: ["tenant_admin"]
keywords: ["agente", "agentes de ia", "bot", "chatbot", "assistente virtual", "criar agente", "modelo", "personalidade", "instruções", "tom", "horário do agente", "atribuir canal", "conexão", "duplicar agente", "agente padrão", "limite de agentes", "canais sem agente", "testar agente", "regras", "temas proibidos"]
---

# Agentes de IA: criar e configurar

Seu agente de IA é o "vendedor virtual" que responde aos seus clientes no WhatsApp, Instagram, Messenger, Telegram e no chat do seu site, 24 horas por dia. Aqui você aprende a criá-lo, dar personalidade a ele, definir o horário e atribuí-lo às suas conexões.

> Esta seção é administrada pelo papel de **administrador**. Supervisores e agentes humanos veem o resultado no inbox, mas não configuram os agentes de IA.

## Capacidade de agentes

**Agente IA** mostra quantos agentes você pode criar e se modelos próprios estão habilitados. Ao atingir a capacidade, aparece **Limite de agentes atingido**; confira o limite atual em **Plano e faturamento**.

## Como criar um agente

1. No menu lateral, entre em **Agente IA**.
2. Clique em **Novo agente**.
3. Escolha um modelo. Você vai ver três grupos:
   - **Recomendados para o seu negócio** — modelos ajustados à sua indústria (por exemplo, recepcionista para clínicas, consultor imobiliário, anotação de pedidos para restaurantes).
   - **Modelos gerais** — **Consultor de Vendas**, **Agente de Suporte**, **Bot de Perguntas Frequentes**, **Agendador de Consultas**, **Qualificador de Leads** e **Agente em Branco** (para configurar tudo do zero).
   - **Meus modelos** — os que você mesmo salvou, quando o recurso estiver habilitado para sua conta.
4. Clique em **Usar este** no modelo escolhido.
5. Escreva o **Nome do agente** se quiser um próprio (por exemplo, Sofia ou Max); se deixar vazio, é usado o nome do modelo.

O agente fica criado e o editor dele abre para você personalizar.

## Como configurar a personalidade e as instruções

Dentro de **Agente IA**, clique em **Editar** no agente. O editor está organizado em cartões:

- **Identidade** — nome, função ou título (por exemplo, "Consultora de vendas") e idioma.
- **Personalidade** — o **Estilo de comunicação** (Amigável, Profissional, Formal, Casual ou Empático), o **Tamanho das respostas** (Conciso, Padrão ou Detalhado) e a saudação inicial.
- **Comportamento** — suas próprias regras em texto livre (por exemplo, "sempre ofereça o combo família antes de fechar"), os temas proibidos que o agente nunca deve tocar e o modo de resposta (sempre IA, sempre humano ou híbrido).
- **Modelo IA** — qual mecanismo o agente usa. O editor mostra os modelos habilitados para a sua conta.
- **Horário** — quando ele está ativo (veja mais abaixo).
- **Capacidades** — o que o agente pode fazer, com interruptores para ativar ou desativar cada uma:
  - Buscar respostas na sua base de conhecimento
  - Verificar disponibilidade e agendar compromissos
  - Mostrar produtos, serviços ou propriedades do seu catálogo
  - Criar pedidos ou reservas
  - Passar a conversa para uma pessoa da sua equipe quando for preciso

Quando terminar, clique em **Salvar alterações** — o botão fica sempre visível na barra inferior, então você não perde as edições ao rolar a página.

## Como definir o horário do agente

1. No editor do agente, abra o cartão **Horário**.
2. Marque os dias e as faixas em que o agente responde (por exemplo, "Diário 9:00–18:00" ou só 5 dias por semana).
3. Salve com **Salvar alterações**.

Fora desse horário o agente não atende automaticamente; combine isso com o modo de resposta se preferir que a sua equipe assuma o controle em certos momentos.

## Como atribuir o agente a cada conexão

A regra é simples: **um agente de IA por conexão**. Uma conexão é cada conta ou número que você conectou — por exemplo, "WhatsApp Vendas" e "WhatsApp Suporte" são duas conexões diferentes, e cada uma pode ter o próprio agente.

1. No editor do agente, vá em **Atribuição de canais**.
2. Marque as conexões que este agente vai atender. Você verá cada conta com seu nome e número, não o canal genérico.
3. Se a conexão já estava atribuída a outro agente, o editor avisa que ela **será reatribuída** do agente anterior.
4. Clique em **Salvar alterações**.

A quantidade e os tipos de conexão disponíveis aparecem em **Canais** e **Plano e faturamento**.

## O que significa o aviso "canais sem agente atribuído"

Se **Agente IA** mostrar **Canais sem agente atribuído**, você tem conexões ativas que nenhum agente atende de forma específica. Enquanto isso, essas mensagens são respondidas pelo seu **agente padrão**, com uma configuração genérica.

Clique em **Atribuir agente agora** para escolher qual agente atende cada conexão e oferecer uma experiência personalizada.

## Duplicar, salvar como modelo e outras ações

Na lista de **Agente IA**, cada agente tem um menu de ações:

- **Duplicar** — cria uma cópia exata, ideal para experimentar sem mexer no agente que já está funcionando.
- **Salvar como modelo** — transforma a configuração em um modelo reutilizável quando o recurso está habilitado (aparece em **Meus modelos**).
- **Definir como padrão** — define qual agente responde nas conexões que não têm um atribuído.
- **Excluir** — apaga o agente (pede confirmação). O agente padrão não pode ser excluído.

## Teste seu agente antes de ativá-lo

Pelo menu **Agente IA → Testar agente** você pode conversar com o seu agente em modo simulação, sem afetar clientes reais. Use sempre que mudar a personalidade ou as regras, antes de ele falar com seus clientes.

## Perguntas frequentes

**Posso ter um agente para vendas e outro para suporte?**
Sim, quando sua conta tiver capacidade. Crie um com o modelo **Consultor de Vendas** e outro com **Agente de Suporte**, e atribua cada um à conexão correspondente.

**O que acontece se eu conectar um canal e não atribuir um agente?**
Responde o seu agente padrão. Você verá o aviso de canais sem atribuição em **Agente IA** para corrigir com um clique.

**O agente pode responder por SMS?**
Não. O SMS no Parallly não é um canal de conversa: é usado apenas para notificações de saída com créditos (1 crédito = 1 segmento). As superfícies de conversa em autosserviço são WhatsApp, Instagram, Messenger, Telegram e chat web. Email mantém um adaptador inbound interno, mas não uma configuração de autosserviço certificada.

**Mudei as instruções e o agente continua igual, o que eu verifico?**
Confirme que você clicou em **Salvar alterações** na barra inferior do editor e que editou o agente atribuído àquela conexão (não outro). Depois verifique em **Testar agente**.

**Como adiciono mais agentes ou mais números?**
A tela mostra a capacidade disponível para agentes e conexões. Confira as opções atuais em **Administração → Plano e faturamento**, ou escreva para a gente em https://parallly-chat.cloud/support se precisar de outra capacidade.
