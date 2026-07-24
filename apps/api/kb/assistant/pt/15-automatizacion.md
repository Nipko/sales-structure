---
id: automatizacion
title: "Automações e follow-up"
routes: ["/admin/automation", "/admin/automation/drip-sequences", "/admin/automation/templates"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["automacao", "regras", "regra automatica", "follow-up", "acompanhamento", "nurturing", "sequencia", "drip", "fluxo", "construtor visual", "gatilho", "condicoes", "acoes", "modelos de automacao", "lembrete", "carrinho abandonado", "reativacao", "mensagens automaticas", "prospectar", "limite de regras"]
---

# Automações e follow-up

As automações são regras do tipo "se acontecer X, faça Y" que trabalham sozinhas em segundo plano: enviam follow-ups, movem leads de etapa, atribuem agentes ou adicionam tags sem que ninguém precise fazer isso na mão. Você encontra tudo na barra lateral, seção **Crescimento** → **Automação**, com três áreas: **Automação** (regras), **Sequências Drip** (acompanhamento por gotejamento) e **Modelos** (galeria pronta para instalar).

Podem criá-las e editá-las os usuários com papel de administrador ou supervisor.

## Como criar uma regra de automação

1. Vá em **Crescimento** → **Automação** e clique em **"Nova regra"**.
2. **Gatilho** — escolha o evento que dispara a regra:
   - **Lead capturado** — quando um novo lead entra no sistema
   - **Nova mensagem** — quando chega uma mensagem do cliente
   - **Conversa atribuída** — quando uma conversa é atribuída a um agente
   - **SLA vencido** — quando o tempo de resposta é ultrapassado
   - **Inatividade** — quando o cliente para de responder
   - **Mudança de etapa** — quando um lead muda de etapa no funil
3. **Condições** — filtros opcionais por **Canal**, **Etapa**, **Score**, **Tag** ou **Origem**. Todas precisam ser atendidas ao mesmo tempo; se você não adicionar nenhuma, a regra roda sempre que o gatilho acontecer.
4. **Ações** — o que a regra faz (dá para encadear várias com **"Adicionar ação"**):
   - **Enviar modelo do WhatsApp**
   - **Criar tarefa de follow-up**
   - **Mudar etapa do pipeline**
   - **Adicionar tag**
   - **Atribuir a agente**
   - Cada ação pode ter um atraso em segundos, para rodar um tempinho depois do evento.
5. **Resumo** — dê um nome claro (ex.: "Atribuir leads novos automaticamente"), revise os detalhes e clique em **"Salvar Regra"**. Você pode marcar **"Ativar regra imediatamente"** ou deixá-la inativa e ligá-la depois pelo interruptor.

Cada regra mostra seu **"Histórico de execuções"**, assim você confere quando ela disparou e com que resultado. Se um envio falhar, a plataforma tenta de novo automaticamente até 3 vezes.

> A partir do plano Pro também existe a ação **"Requisição HTTP"**, que permite que uma regra converse com outros sistemas do seu negócio (por exemplo, avisar seu sistema de faturamento ou estoque quando um lead avança). Se precisar dela, seu fornecedor ou equipe de TI pode configurá-la com você.

## Como usar o construtor visual de fluxos

Além do assistente passo a passo, você pode montar a mesma regra em um canvas visual:

1. Em **Automação**, use o botão **"Construtor visual"**.
2. Arraste e conecte blocos de **Gatilho**, **Condição** (com ramos **Sim** / **Não**), **Ação** e **Espera** (em minutos, horas ou dias).
3. Salve com **"Salvar"**. Você pode alternar a qualquer momento entre o canvas e **"Editar com assistente"** — é a mesma regra vista de dois jeitos.

O construtor visual é ideal para fluxos com bifurcações ("se respondeu, adiciona tag; se não, espera 2 dias e reenvia").

## Como criar uma sequência de follow-up (drip)

As **Sequências Drip** enviam uma série de mensagens com esperas entre cada passo. São perfeitas para nutrir leads frios, dar boas-vindas a clientes novos ou fazer acompanhamento pós-venda.

1. Vá em **Crescimento** → **Automação** → **Sequências Drip** e clique em **"Nova sequência"**.
2. Dê um nome (ex.: "Boas-vindas leads novos") e escolha o **Evento gatilho**:
   - **Inscrição manual** — você adiciona contatos com **"Inscrever contato"**
   - **Lead capturado**
   - **Tag adicionada**
   - **Mudança de etapa**
3. Clique em **"Adicionar passo"** para cada mensagem. Cada passo define:
   - **Espera** — quanto tempo esperar antes de enviar (**Minutos**, **Horas** ou **Dias**)
   - **Tipo de mensagem** — **Modelo do WhatsApp**, **Mensagem personalizada** ou **Gerada por IA**
   - Dá para personalizar com variáveis como `{{contact.name}}` para cumprimentar pelo nome.
4. Em **"Parar se"**, deixe marcadas as condições de parada (veja abaixo).
5. Ative a sequência com o interruptor **"Ativa"** e clique em **"Salvar sequência"**.

### Quando a sequência para para um contato

- **O contato responde** a qualquer mensagem da série (para que a conversa continue com seu agente de IA ou sua equipe, e não com mensagens enlatadas).
- **O contato converte** (chega a uma etapa final do funil).
- O contato pede para não receber mais mensagens (opt-out).

> Dica: mantenha as sequências curtas (3 a 5 passos). Um lead que não respondeu depois de 5 tentativas raramente converte; melhor focar a energia em outros.

### Prospectar um segmento com uma sequência

Dentro de uma sequência ativa você encontra **"Prospectar do CRM"**: escolha um segmento de leads e clique em **"Inscrever segmento"** para inscrevê-los de uma vez (até 500 por envio). O primeiro passo precisa ser um modelo aprovado do WhatsApp, porque o WhatsApp só permite modelos para iniciar uma conversa fria. A plataforma respeita os opt-outs e não duplica inscrições.

## Como instalar um modelo de automação

Se você prefere não começar do zero, vá em **Crescimento** → **Automação** → **Modelos**:

1. Busque ou filtre por **Categoria** (Nutrição de leads, Lembretes de compromissos, Carrinho abandonado, Sequência de boas-vindas, Reativação, Coleta de feedback, Tratamento VIP, Fora do horário) ou por **Setor** — se seu negócio é de saúde, você verá primeiro os modelos de lembrete de consulta, por exemplo.
2. Clique no card para ver exatamente o que ele faz: gatilho, condições e ações.
3. Clique em **"Instalar"** — uma cópia da regra é criada na sua conta.
4. Use **"Ver regras"** para ir direto editá-la: ajuste textos, tempos e condições ao seu negócio.
5. A regra instalada fica **inativa** por padrão — ative-a depois de revisar.

## Horários: quando as mensagens automáticas são enviadas?

- Os tempos de uma sequência ou de uma ação com espera contam a partir do evento que a disparou (ex.: "2 dias depois de capturar o lead").
- O horário de funcionamento do seu negócio é configurado à parte, em **Configurações** → **Horário de Atendimento**. Lá você define os dias e horários de atendimento e a mensagem de fora do horário.
- Na galeria de modelos, a categoria **Fora do horário** traz regras prontas para responder automaticamente quando escrevem para você fora do seu horário.

## Limites por plano

| Plano | Regras de automação | Sequências drip | Execuções por hora |
|-------|---------------------|-----------------|--------------------|
| Emprendedor | Não incluído | Não incluído | — |
| Starter | 5 | 3 | 50 |
| Pro | Ilimitadas | 10 | 500 |
| Enterprise | Ilimitadas | Ilimitadas | 5.000 |
| Custom | Ilimitadas | Ilimitadas | Sem limite |

A ação **"Requisição HTTP"** está disponível a partir do plano Pro. Se você atingir o limite do seu plano, a tela avisa e você pode fazer upgrade em **Configurações** → **Faturamento**.

## Perguntas frequentes

**Qual a diferença entre uma regra e uma sequência drip?**
Uma regra reage a um evento e executa ações (uma vez). Uma sequência drip é uma série de mensagens ao longo do tempo, com esperas entre cada uma, que acompanha o contato durante dias.

**Criei uma regra e nada acontece, por quê?**
Confira três coisas: se a regra está **Ativa** (interruptor ligado), se as condições não estão restritivas demais (todas precisam ser atendidas ao mesmo tempo) e o **"Histórico de execuções"** para ver se ela disparou e com que resultado.

**Posso pausar uma sequência sem apagá-la?**
Sim. Desligue o interruptor **"Ativa"**: os contatos já inscritos param de receber passos e a sequência fica salva. Você também pode retirar um contato específico com **"Desinscrever"**.

**As mensagens automáticas podem chegar a alguém que pediu para não ser contatado?**
Não. A plataforma respeita os opt-outs: se um contato pediu para não receber mensagens, as regras e sequências não enviam nada para ele.

**Por que meu plano não deixa criar mais regras?**
Cada plano tem um teto (veja a tabela). Você pode excluir regras que não usa mais ou fazer upgrade do plano em **Configurações** → **Faturamento**.

Precisa de mais ajuda? Escreva para a gente em https://parallly-chat.cloud/support
