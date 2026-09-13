---
id: agentes-ia
title: "Agentes de IA: criar e configurar"
routes: ["/admin/agent", "/admin/agent/simulation"]
roles: ["tenant_admin"]
keywords: ["agente", "agentes de ia", "bot", "chatbot", "assistente virtual", "criar agente", "modelo", "personalidade", "instruções", "tom", "horário do agente", "atribuir canal", "conexão", "duplicar agente", "agente padrão", "limite de agentes", "canais sem agente", "testar agente", "regras", "temas proibidos", "campos obrigatorios", "quando passar para um humano", "mensagem de apoio", "ativo inativo", "avancado", "assist", "instruções principais", "vendas e suporte", "rascunho do agente"]
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

## O que o editor exige para salvar

Um agente só atende bem com o mínimo definido. Ao salvar, o editor confere e aponta o campo que falta:

- **Nome do agente** — como ele se apresenta aos seus clientes.
- **Função** — o que ele faz (por exemplo, "Consultora de vendas" ou "Recepcionista").
- **Mensagem para quando não souber responder** — a frase exata que o agente diz quando a pergunta foge do que ele sabe. É melhor prometer buscar uma pessoa do que improvisar.
- **Pelo menos uma regra** de comportamento.
- **Pelo menos um motivo** em **Quando passar para um humano**.

Se você esvaziar um desses campos para reescrevê-lo, salve só quando estiver completo: um agente sem mensagem de apoio ou sem motivos de transferência aparece como bloqueio crítico na **Saúde dos agentes**.

**Se o seu agente estiver no modo prompt personalizado**, esta lista muda. Quando a sua conta tem esse recurso habilitado e o agente o usa, um único texto escrito por você substitui a personalidade guiada: a **Saúde dos agentes** marca identidade, tom, saudação, mensagem de apoio e regras como **Não se aplica** e passa a exigir que esse prompt não esteja vazio. O que **continua obrigatório** é pelo menos um motivo em **Quando passar para um humano**: sem isso a conversa nunca chega a uma pessoa, escreva o que escrever no prompt. Se você vir “Não se aplica” onde este guia diz “obrigatório”, é por isso, não por um erro.

## Como configurar a personalidade e as instruções

Dentro de **Agente IA**, clique em **Editar** no agente. O editor está organizado em abas e cartões:

- **Identidade** — nome, função ou título (por exemplo, "Consultora de vendas") e idioma.
- **Personalidade** — estilo de comunicação, uso de emojis e humor, **Tamanho das respostas** (Conciso, Padrão ou Detalhado) e saudação inicial.
- **Mensagem para quando não souber responder** — o texto de apoio, obrigatório.
- **Instruções** — uma orientação principal, regras concretas, temas proibidos e os dados que deve pedir em cada contexto. A orientação principal faz parte do prompt efetivo no modo guiado.
- **Quando passar para um humano** — a lista de motivos que fazem o agente parar de responder e avisar sua equipe: o cliente pede, reclama, pergunta por desconto, ou o agente erra várias vezes seguidas. Sem pelo menos um motivo, a conversa nunca chega a uma pessoa.
- **Vendas e suporte** — escolha se o agente vende, atende ou faz as duas coisas; em vendas também é possível ajustar a intensidade das recomendações e o desconto máximo permitido.
- **Horário** — quando ele está ativo (veja mais abaixo).
- **Capacidades** — o que o agente pode fazer, com interruptores para ativar ou desativar cada uma:
  - Buscar respostas na sua base de conhecimento
  - Verificar disponibilidade e agendar compromissos
  - Mostrar produtos, serviços ou propriedades do seu catálogo
  - Criar pedidos ou reservas
  - Passar a conversa para uma pessoa da sua equipe quando for preciso

As capacidades especializadas dependem do **tipo de negócio** do tenant. O editor só oferece as famílias que pertencem a esse perfil e explica quando faltam dados, plano ou provedor para ativá-las.

**Avançado** não é um cartão: são duas seções recolhidas, em duas abas diferentes, e por isso você não as encontra juntas:

- **Avançado: ajustar a busca** — dentro de **Capacidades**, abaixo do interruptor da busca no seu conhecimento (só aparece com esse interruptor ligado). É ali que ficam quantos trechos usar e o quão parecido o conteúdo precisa ser.
- **Avançado** — dentro de **Instruções**, com os dados que o agente deve pedir em cada contexto.

As duas vêm com valores razoáveis; mude só se souber o que está ajustando.

## Configurar com o Parallly Assist

Você pode pedir ao Assist que revise o agente e prepare mudanças de identidade, idioma, instruções, regras, dados obrigatórios, comportamento fora do horário, vendas/suporte, recomendações, tamanho da resposta, conhecimento e permissões. O Assist mostra uma proposta para revisão; ao aceitar, salva um **rascunho**, sem publicar nem ativar o agente. No modo prompt personalizado, o Assist não oferece mudanças de personalidade, orientação principal, regras ou campos obrigatórios porque o prompt os substitui. Nunca envie credenciais ou conexões pelo chat.

Quando terminar, clique em **Salvar alterações** — o botão fica sempre visível na barra inferior, então você não perde as edições ao rolar a página.

## Ativo ou inativo

No cabeçalho do editor há um interruptor **Ativo / Inativo**. Um agente **inativo** não responde em nenhuma das suas conexões, mesmo com o canal conectado e o horário dizendo que sim. Você pode desativá-lo imediatamente após confirmar. Reativar exige revisar e publicar uma versão; o interruptor aponta para essa revisão e não o liga sozinho. A **Saúde dos agentes** marca como bloqueio crítico qualquer agente inativo, com ou sem conexões atribuídas.

## Como definir o horário do agente

1. Configure os dias, faixas e fuso de toda a conta em **Configurações → Horário comercial**.
2. No editor do agente, abra **Horário** para revisar esse calendário e decidir se a IA continua respondendo fora dele.
3. Se desativar a IA fora do horário, escreva a mensagem específica desse agente e salve o rascunho.

O horário comercial pertence ao tenant e é compartilhado entre seus agentes; cada agente decide apenas o próprio comportamento fora dele.

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
