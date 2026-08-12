---
id: citas-calendarios
title: "Agendamentos e calendários"
routes: ["/admin/appointments", "/admin/settings/public-booking"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["agendamentos", "agenda", "calendário", "agendar", "reservas", "reservar", "serviços", "disponibilidade", "horários", "google calendar", "outlook", "lembretes", "confirmação de presença", "reagendar", "cancelar agendamento", "datas bloqueadas", "link de reunião", "meet", "teams", "reserva pública", "página de reservas", "agendamento recorrente"]
---

# Agendamentos e calendários

O Parallly inclui uma agenda completa: você define seus serviços e horários uma única vez e, a partir daí, seu agente de IA marca agendamentos sozinho dentro da conversa, sua equipe os vê num calendário compartilhado e tudo pode ser sincronizado com o Google Calendar ou o Outlook.

Tudo fica na barra lateral, em **Agendamentos**. Ao entrar, você verá a página **Agendamentos** com cinco abas: **Calendário** (visão por semana ou por dia), **Agenda** (lista de agendamentos), **Serviços**, **Configurações** e **Analytics**. As configurações são para administradores e supervisores; os agentes podem ver o calendário, criar agendamentos e atendê-los.

## Como criar seus serviços

Os serviços são aquilo que seus clientes podem reservar (uma consulta, um corte, uma assessoria…).

1. Vá em **Agendamentos** → aba **Serviços**.
2. Clique em **Novo serviço**.
3. Preencha o **Nome do serviço**, a **Duração** em minutos e, se quiser, o **Preço**.
4. Em **Tempo entre agendamentos (min)** você pode deixar um intervalo entre um agendamento e o seguinte (por exemplo, 10 minutos para preparar o espaço).
5. Escolha a **Modalidade**: **Presencial**, **Online** ou **Híbrido**.
   - Se for presencial, informe o **Endereço**.
   - Se for online ou híbrido, você pode deixar vazio o **Link da reunião**: um link de Meet ou Teams é gerado automaticamente para cada agendamento.
6. Salve com **Criar serviço**. Você pode ativar ou desativar serviços quando quiser.

A tela mostra a capacidade atual de serviços; confira os detalhes vigentes em **Plano e faturamento**.

## Como definir sua disponibilidade

1. Vá em **Agendamentos** → aba **Configurações** → seção **Horário de atendimento**.
2. Escolha **Disponível 24/7** ou **Horário personalizado** e marque, dia a dia, os horários em que você atende.
3. Salve as alterações. Importante: se você não salvar seus horários, o agente de IA não terá disponibilidade real para oferecer nas conversas.

### Datas bloqueadas (férias, feriados)

Na mesma aba **Configurações**, seção **Datas bloqueadas**:

1. Clique em **Bloquear data**.
2. Escolha o dia e escreva o motivo (por exemplo, "Feriado").

O agente de IA nunca vai oferecer horários num dia bloqueado, e eles também não ficarão disponíveis na página pública de reservas.

## Como conectar o Google Calendar ou o Outlook

Conectar seu calendário evita conflitos de horário: os agendamentos do Parallly aparecem no seu calendário pessoal e, assim, toda a sua equipe vê a agenda em dia.

1. Vá em **Agendamentos** → aba **Configurações** → seção **Calendários conectados**.
2. Clique em **Conectar Google Calendar** ou **Conectar Outlook**.
3. Autorize o acesso com sua conta Google ou Microsoft.
4. Pronto: os novos agendamentos também são criados automaticamente no seu calendário externo.

A tela mostra quantos calendários você pode conectar e quanto espaço resta. Confira os detalhes vigentes em **Plano e faturamento**.

### Com vários calendários, para qual vai cada agendamento?

Para cada calendário conectado você atribui uma etiqueta: **Geral**, **Membro da equipe** ou **Serviço**. Quando um agendamento é criado, ele é enviado seguindo esta ordem:

1. O calendário atribuído ao **serviço** do agendamento.
2. Se não houver, o calendário do **membro da equipe** designado.
3. Se também não houver, o calendário **geral** do negócio.

### Desconectar um calendário que tem agendamentos futuros

A reatribuição ou o cancelamento guiado durante a desconexão **não está certificado de ponta a ponta nesta versão**: a operação pode não ser aplicada mesmo que o painel pareça concluir. Antes de desconectar, reatribua ou cancele manualmente cada agendamento futuro, recarregue a agenda e confirme que nenhum continua vinculado ao calendário. Não considere apenas a mensagem de sucesso como confirmação.

## Links de reunião automáticos

Para serviços com modalidade **Online** ou **Híbrido**, cada agendamento gera automaticamente seu link de videochamada (Meet com o Google Calendar, Teams com o Outlook). O cliente o recebe na confirmação, sem que você precise criar a reunião manualmente. Se preferir usar um link próprio fixo, cole-o no campo **Link da reunião** do serviço.

## Lembretes e confirmação de presença

Em **Agendamentos** → **Configurações** → seção **Lembretes e acompanhamento** você pode ativar:

- **Lembrete 24 horas antes** — enviado um dia antes do agendamento.
- **Lembrete 2 horas antes** — um último aviso no mesmo dia.
- **Confirmação de presença** — depois do agendamento, o cliente é perguntado se compareceu.
- **Concluir automaticamente** — os agendamentos são marcados como concluídos 2 horas após o horário de término, sem trabalho manual.

Os lembretes por WhatsApp podem usar modelos aprovados pela Meta para tentar o envio fora da janela de 24 horas. A entrega não é garantida: depende do status do modelo e da conta, da Meta e do destinatário.

## A IA agenda sozinha na conversa

Quando um cliente pede um agendamento pelo WhatsApp, Instagram ou qualquer canal conectado, o agente de IA o guia passo a passo: primeiro o serviço, depois uma data com disponibilidade real, depois o horário e, por fim, uma confirmação. Nesse último passo o sistema verifica o horário de novo, então duas pessoas não podem ficar com a mesma vaga.

Ao confirmar, tudo acontece sozinho: o agendamento entra no seu **Calendário**, é sincronizado com seu Google Calendar ou Outlook, o cliente recebe um e-mail de confirmação, o membro da equipe designado é avisado e, se o serviço for online, o link de reunião é incluído.

No WhatsApp você também pode ativar o **WhatsApp Flows (Beta)** na aba **Configurações**: em vez de ir pergunta por pergunta, o cliente agenda num único passo com um formulário interativo. Se algo falhar, o agente volta automaticamente ao fluxo por texto.

## Página pública de reservas

Além do chat, você pode ter uma página web onde seus clientes agendam sozinhos:

1. Vá em **Configurações** (barra lateral) → **Reserva pública**.
2. Ative o interruptor **Ativar reserva pública**.
3. Copie seu link com o botão **Copiar** (tem o formato `parallly-chat.cloud/book/seu-negocio`) ou clique em **Mostrar código QR** para imprimi-lo ou compartilhá-lo.
4. Em **Personalização** você pode definir a **Mensagem de boas-vindas** e a **Cor da marca** da página.

Compartilhe o link na bio do Instagram, no perfil do WhatsApp Business, na assinatura de e-mail ou no seu site. Os agendamentos que entram por ali aparecem no seu calendário com origem "Reserva pública", junto aos criados pelo Agente IA ou pela sua equipe a partir do painel.

## Perguntas frequentes

**O que acontece se duas pessoas quiserem o mesmo horário?**
O sistema verifica a disponibilidade no momento exato da confirmação e rejeita a segunda tentativa, oferecendo outro horário. Não há reservas duplicadas.

**Posso reagendar ou cancelar um agendamento?**
Sim. Na aba **Calendário** você pode reagendar arrastando o agendamento para outro horário, ou abri-lo para editá-lo ou cancelá-lo indicando o motivo.

**Posso criar agendamentos que se repetem?**
Sim. Ao criar um agendamento a partir do painel, marque **Repetir este agendamento** e escolha a frequência (todo dia, toda semana, a cada 2 semanas ou todo mês) e quantas vezes. A série completa é criada de uma só vez.

**Preciso conectar um calendário para usar a agenda?**
Não, a agenda funciona sozinha dentro do Parallly. Conectar o Google Calendar ou o Outlook é opcional, mas muito recomendável se a sua equipe também agenda coisas fora da plataforma.

**Quem pode alterar as configurações da agenda?**
Os administradores e supervisores. Os agentes podem ver o calendário, criar agendamentos e atender os clientes, mas não modificar serviços, horários nem calendários conectados.

Precisa de mais ajuda? Escreva para nós em https://parallly-chat.cloud/support
