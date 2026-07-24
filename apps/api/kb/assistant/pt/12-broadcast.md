---
id: broadcast
title: "Campanhas e disparo (broadcast)"
routes: ["/admin/broadcast", "/admin/channels/whatsapp/templates", "/admin/contacts/segments"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["campanha", "campanhas", "broadcast", "disparo", "disparo em massa", "envio em massa", "mensagens em massa", "whatsapp em massa", "modelo", "modelos de whatsapp", "template", "segmento", "destinatários", "público", "audiência", "agendar envio", "promoções", "marketing", "entregue", "lido", "teste a/b", "número remetente"]
---

# Campanhas e disparo (broadcast)

Uma **campanha** (ou broadcast) é uma mensagem que você envia de uma só vez para muitos dos seus contatos: uma promoção, um anúncio, um lembrete geral. É enviada por **WhatsApp** e/ou **E-mail**, para todos os seus contatos ou para um segmento específico.

Você encontra as campanhas na barra lateral, na seção **Crescimento → Campanhas**. Podem criá-las os usuários com perfil de **administrador** ou **supervisor** (os agentes não).

## Antes de começar

- **O WhatsApp usa modelos aprovados pela Meta.** Para escrever a um cliente que não fala com você nas últimas 24 horas, o WhatsApp exige que a mensagem seja um modelo revisado e aprovado pela Meta. Confira seus modelos em **Canais → WhatsApp** (você verá o resumo dos modelos e o botão **Ver todos os modelos**).
- **Prepare seu público.** Você pode enviar para **Todos os contatos** ou para um **Segmento** (grupo salvo de contatos com filtros, por exemplo "clientes VIP"). Os segmentos são criados em **CRM → Segmentos**.
- **Verifique seu plano.** O plano Emprendedor não inclui campanhas e o Starter permite até 3 por mês (veja a tabela de limites mais abaixo).

## Como criar e enviar uma campanha

1. Acesse **Crescimento → Campanhas** e clique em **Nova campanha**.
2. Escreva o **Nome da campanha** (por exemplo, "Promo Verão 2026"). É apenas para uso interno.
3. Em **Canais de envio**, escolha **WhatsApp**, **E-mail** ou ambos.
4. Redija o conteúdo de cada canal:
   - **Modelo WhatsApp**: escreva o texto da mensagem. Use `{{name}}` para inserir o nome de cada contato automaticamente. Lembre-se de que deve corresponder a um modelo aprovado pela Meta se você for contatar clientes fora da janela de 24 horas.
   - **Conteúdo do e-mail**: assunto e corpo do e-mail.
5. Se você tiver **mais de um número de WhatsApp conectado**, aparece o seletor **Enviar a partir do número**: escolha de qual número sai a campanha, ou deixe **Número principal (padrão)**.
6. Em **Público**, escolha **Todos os contatos** ou **Segmento** (e selecione qual; você verá quantos contatos ele inclui).
7. Em **Data de envio (opcional)**:
   - Se você escolher data e hora, o botão dirá **Agendar** e a campanha sairá sozinha nesse momento.
   - Se você deixar em branco, o botão dirá **Salvar rascunho** e a campanha fica salva sem ser enviada.
8. Para enviar um rascunho de imediato, abra-o na lista e use **Enviar agora**.

> Dica: os disparos em massa saem em um ritmo controlado para proteger seu número de WhatsApp. Se a campanha for grande, é normal que leve vários minutos para ser concluída.

## Status de uma campanha

Cada campanha mostra seu status na lista: **Rascunho** (salva, sem agendamento), **Agendada**, **Enviando**, **Enviada**, **Concluída** ou **Falhou**.

## Métricas: como ler os resultados

Na parte superior de **Campanhas** você vê os totais: **Campanhas**, **Enviadas**, **Agendadas** e **Respostas**. Além disso, cada campanha mostra seu funil:

- **Destinatários** — para quantos contatos foi direcionada.
- **Entregue** — quantas mensagens chegaram ao telefone ou à caixa de entrada do cliente.
- **Lido** — quantos a abriram (o WhatsApp reporta leituras quando o cliente as tem ativadas).
- **Responderam** — quantos responderam à mensagem.

Se você também quiser saber quantas **vendas** cada campanha gerou, confira **Receita por campanhas** na seção de atribuição de Análises.

## Testes A/B (planos Pro e superiores)

Com o botão **Testar duas variantes (A/B)** ao criar a campanha, você pode enviar duas versões da mensagem e descobrir qual funciona melhor:

1. Ative **Testar duas variantes (A/B)** e redija a **Variante A** e a **Variante B**.
2. Ajuste a **Divisão do envio** (qual porcentagem do público recebe cada variante).
3. Opcional: ative a **Seleção automática** para que o sistema detecte a variante vencedora e a use automaticamente com o restante do público.
4. Após o envio, a campanha mostra resultados por variante (enviados, entregues, taxa de leitura) e você pode usar **Selecionar vencedora**.

> Conselho: mude um único elemento entre as variantes (o texto, a oferta ou a chamada para ação). Assim você saberá exatamente o que fez a diferença.

## Modelos de WhatsApp: criar e aprovar

Caminho: **Canais → WhatsApp → Ver todos os modelos**.

- **Criar modelo**: dê um nome (letras minúsculas e underscores, ex. `lembrete_pagamento`), escolha idioma e categoria, escreva cabeçalho, corpo (com variáveis como `{{1}}`), rodapé e até 3 botões. Ao terminar, **Enviar à Meta**.
- A Meta normalmente revisa entre alguns minutos e 72 horas. Os status são **Aprovados**, **Pendentes** e **Rejeitados** (com o motivo da rejeição visível).
- **Sincronizar da Meta** traz os modelos que você já tenha aprovados na sua conta.
- Ao conectar o WhatsApp, a Parallly envia automaticamente 3 **modelos-semente** de utilidade (lembrete de agendamento, confirmação de pedido e pagamento recebido) que a Meta costuma aprovar em minutos.
- Se você tiver vários números, ao criar o modelo escolhe o **Número / conta** ao qual ele pertence.

## Limites por plano

| Plano | Campanhas por mês | Testes A/B | Segmentos | Contatos |
|------|-----------------|-------------|-----------|-----------|
| Emprendedor | Não incluído | — | — | 100 |
| Starter | 3 | Não | 3 | 500 |
| Pro | Ilimitadas | Sim | 15 | 5.000 |
| Enterprise | Ilimitadas | Sim | Ilimitados | 50.000 |
| Custom | Ilimitadas | Sim | Ilimitados | Ilimitados |

Outros limites relacionados: o canal **E-mail** está disponível a partir do plano Starter, e a quantidade de **números de WhatsApp** que você pode conectar depende do plano (Pro: 2, Enterprise: 3, Custom: sem limite). Você pode subir de plano em **Configurações → Faturamento**.

## E o SMS?

O SMS na Parallly **não é um canal de conversa**: é uma notificação de via única que funciona com **créditos** (1 crédito = 1 segmento de SMS) e sai pela infraestrutura da plataforma, sem que você precise contratar nada à parte. A compra de pacotes e o seu saldo são gerenciados em **Configurações → Faturamento**. Se a opção de SMS não aparecer ao criar sua campanha, é porque ela ainda não está habilitada para a sua conta.

## Perguntas frequentes

**Por que não vejo a seção Campanhas?**
Seu perfil deve ser administrador ou supervisor, e seu plano deve incluir campanhas (o plano Emprendedor não as inclui).

**Posso cancelar uma campanha agendada?**
Enquanto estiver no status **Agendada**, você pode gerenciá-la a partir da lista antes da hora de envio. Uma vez no status **Enviando**, as mensagens já estão saindo.

**Por que minha campanha de WhatsApp não chega a alguns contatos?**
As causas mais comuns: o modelo não está **Aprovado** pela Meta, o contato cancelou a inscrição (não recebe mais disparos) ou o número não existe mais. Verifique o status do modelo em **Canais → WhatsApp**.

**Posso personalizar a mensagem com o nome de cada cliente?**
Sim: escreva `{{name}}` no texto e cada contato receberá o seu próprio nome.

**Quanto tempo a Meta leva para aprovar um modelo?**
Normalmente entre alguns minutos e 72 horas. Você verá o status (Pendente/Aprovado/Rejeitado) na lista de modelos.

**A IA responde à campanha?**
Se um cliente responder à sua campanha de WhatsApp, a resposta entra como uma conversa normal e é atendida pelo agente de IA daquela conexão.

Precisa de mais ajuda? Escreva para nós em https://parallly-chat.cloud/support
