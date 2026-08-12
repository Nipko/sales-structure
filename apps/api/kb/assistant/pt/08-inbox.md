---
id: inbox
title: "Caixa de entrada e atendimento humano"
routes: ["/admin/inbox", "/admin/settings/macros", "/admin/settings/integrations/sms-notifications"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["inbox", "caixa de entrada", "handoff", "assumir conversa", "atender cliente", "agente humano", "devolver ao bot", "notas internas", "macros", "respostas rapidas", "adiar", "snooze", "atribuir conversa", "resolver conversa", "copiloto", "resumo IA", "reescrever mensagem", "sugestao IA", "notificacoes", "sino", "escalonamento"]
---

# Caixa de entrada e atendimento humano

A **Caixa de conversas** é onde sua equipe vê todos os chats em tempo real e onde uma pessoa pode assumir o controle quando a IA precisa de ajuda. Ela fica em **Essenciais → Conversas**.

A tela tem três áreas: à esquerda a lista de conversas (com filtros como **Todos**, **Meus**, **Sem atribuir**, **Handoff** e **Resolvidas**, além de filtros por canal), no centro a thread de mensagens e à direita o painel do contato com suas informações, notas e agendamentos. Aqui chegam as conversas das suas superfícies operacionais: WhatsApp, Instagram, Messenger, Telegram e o chat do seu site.

## Como assumir uma conversa (handoff)

Quando um cliente pede para falar com uma pessoa, ou a IA percebe que não consegue resolver o caso, a conversa fica "aguardando agente" e a IA é pausada.

1. Abra a conversa pelo Inbox (as que aguardam atendimento ficam destacadas na lista).
2. Você verá um aviso laranja: **Atenção humana necessária** — "O assistente de IA foi pausado. O cliente está aguardando uma resposta humana."
3. Clique em **Atender conversa**. A conversa fica atribuída a você e já pode escrever diretamente ao cliente.

Você também pode usar **Atribuir a mim** em uma conversa que esteja sem responsável. Se ela já estiver atribuída a outra pessoa, somente um administrador ou supervisor pode reatribuí-la. Quando a conversa fica com você, a IA não responde: o cliente fala somente com você.

## O resumo da IA ao assumir uma conversa

Para que você não precise ler todo o histórico, ao abrir uma conversa escalada verá uma caixa com o **Resumo da conversa (IA)**: o que o cliente pediu, o que foi conversado e por que foi escalada.

Além disso, a qualquer momento você pode clicar em **Resumir** (acima do campo de escrita) e o copiloto mostra um resumo na hora, com a **Intenção do cliente** e os temas **Pendentes** a resolver.

## Como devolver a conversa à IA

Quando você já resolveu o caso:

1. Clique em **Resolver** no cabeçalho da conversa.
2. Seu atendimento termina, a conversa é liberada e o assistente de IA volta a cuidar das próximas mensagens desse cliente.

As conversas sem atividade por 72 horas são marcadas como resolvidas automaticamente para manter sua caixa organizada. Você pode vê-las com o filtro **Resolvidas**; ali o histórico é somente leitura e, se precisar retomá-la, use **Reabrir conversa**.

## Copiloto do agente: sugestões e reescrita

O copiloto ajuda você a responder melhor e mais rápido:

- **Sugestão IA**: nas conversas que você está atendendo, o copiloto propõe uma resposta pronta para usar. Clique em **Usar sugestão** para levá-la ao campo de escrita (você pode editá-la antes de enviar) ou **Regenerar** para pedir outra.
- **Rascunho de IA**: às vezes a IA deixa um rascunho preparado para sua aprovação. Revise-o e escolha **Usar rascunho** ou **Descartar**. Nada é enviado sem a sua confirmação.
- **Reescrever**: escreva sua resposta do jeito que sair e deixe o copiloto poli-la. Ao lado do campo de escrita, clique em **Reescrever** e escolha o tom: **Profissional**, **Amigável**, **Empático**, **Mais curto**, **Ampliar** ou **Corrigir gramática**.

## Respostas rápidas e macros

- **Respostas rápidas**: no campo de mensagem, digite **/** e aparecerá a lista de respostas predefinidas da sua equipe. Continue digitando para filtrar e selecione uma; os dados do cliente (como o nome) são preenchidos sozinhos.
- **Macros**: são sequências de ações que se executam com um clique (por exemplo: etiquetar, atribuir, deixar uma nota e enviar uma resposta, tudo junto). Na conversa, abra o menu de ações (⋯) e escolha **Macros**.

Para criar macros, um administrador ou supervisor vai em **Configurações → Macros** e clica em **Nova macro**. Cada macro combina ações como **Atribuir a agente**, **Adicionar etiqueta**, **Alterar status**, **Adicionar nota** ou **Enviar resposta predefinida**, e pode ter visibilidade **Pessoal** (só sua) ou de **Equipe**.

## Notas internas

As notas internas são comentários entre colegas que o cliente nunca vê.

1. Na conversa, abra o menu de ações (⋯) e escolha **Notas internas**.
2. Escreva no campo **Adicionar nota interna...** e salve.
3. A nota fica visível para toda a equipe naquela conversa e também no histórico do contato.

Use-as para deixar contexto antes de passar o caso a outra pessoa ("cliente VIP, já foi oferecido o desconto de 10%").

## Adiar uma conversa (snooze)

Se um caso não pode avançar agora ("me ligue na segunda"), não o deixe ocupando sua caixa:

1. Abra o menu de ações (⋯) e escolha **Adiar**.
2. Escolha quando ela deve voltar: **1 hora**, **3 horas**, **Amanhã 9h** ou **Próxima segunda**.
3. A conversa some da visão ativa e reaparece automaticamente na data escolhida.

## Atribuição entre agentes

- Cada conversa pode ter um responsável. Use o filtro **Meus** para ver só o que é seu e **Sem atribuir** para encontrar conversas órfãs.
- Qualquer membro autorizado da equipe pode assumir uma conversa **sem atribuição** com **Atribuir a mim**; se ela já estava com outra pessoa, somente um administrador ou supervisor pode reatribuí-la.
- Se você configurar **habilidades (skills)** nos perfis da sua equipe (menu **Usuários**), o Parallly encaminha automaticamente cada escalonamento para a pessoa certa — por exemplo, casos em inglês para o agente que fala inglês.
- As macros também podem atribuir a um agente específico como parte de suas ações.
- Se uma conversa escalada fica mais de 5 minutos sem resposta, os supervisores recebem um alerta para que ninguém fique esperando.

A quantidade de pessoas que podem usar a Parallly depende da capacidade da sua conta; confira o uso e o limite atuais em **Plano e faturamento**.

## Notificações

O **sino** na barra superior concentra os avisos e os agrupa por categoria: **Mensagens**, **Transferências** (escalonamentos para humano), **Privacidade**, **Agendamentos**, **Automação**, **Pedidos** e **Sistema**. Os escalonamentos diretos (o cliente pediu um humano) ficam destacados em vermelho; os escalonamentos por baixa confiança da IA, em amarelo; e os alertas de supervisor chegam com som.

Se os avisos por SMS estiverem habilitados para sua conta, ative-os em **Configurações → Canais e integrações → Avisos por SMS**.

## Trabalho em equipe sem atropelos

Se duas pessoas abrem a mesma conversa ao mesmo tempo, ambas veem uma etiqueta colorida com o nome da outra abaixo do cabeçalho. Assim você evita responder ao mesmo cliente em duplicidade. Funciona sozinho, sem configurar nada: a etiqueta some quando a outra pessoa fecha a conversa.

## Perguntas frequentes

**A IA continua respondendo enquanto eu atendo?**
Não. A partir do momento em que você assume a conversa, a IA fica pausada e o cliente fala somente com você. Ela volta a ficar ativa quando você clica em **Resolver**.

**O cliente vê as notas internas ou os resumos da IA?**
Não. As notas, os resumos e as sugestões do copiloto são só para a sua equipe. Ao cliente chega apenas o que você envia pelo campo de mensagem.

**O que acontece se ninguém assumir uma conversa escalada?**
Ela continua aparecendo no filtro de pendentes e, se passarem mais de 5 minutos sem resposta, os supervisores recebem um alerta com som para intervir.

**Posso fazer com que certos casos cheguem sempre à mesma pessoa?**
Sim. Configure habilidades nos perfis da equipe (menu **Usuários**) para o encaminhamento automático, ou crie uma macro com a ação **Atribuir a agente**.

**Uma conversa adiada se perde se o cliente escrever antes?**
Não se perde: a conversa reaparece automaticamente na data que você escolheu e o histórico completo é preservado.

Precisa de mais ajuda? Fale com a gente em https://parallly-chat.cloud/support
