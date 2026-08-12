---
id: broadcast
title: "Campanhas e disparo (broadcast)"
routes: ["/admin/broadcast", "/admin/channels/whatsapp/templates", "/admin/contacts/segments"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["campanha", "campanhas", "broadcast", "disparo", "disparo em massa", "envio em massa", "mensagens em massa", "whatsapp em massa", "modelo", "modelos de whatsapp", "template", "segmento", "destinatários", "público", "audiência", "agendar envio", "promoções", "marketing", "entregue", "lido", "teste a/b", "número remetente"]
---

# Campanhas e disparo (broadcast)

A seção **IA e crescimento → Campanhas** reúne rascunhos, públicos, estados e métricas de envios em massa. Administradores e supervisores podem acessá-la quando o recurso está habilitado para a conta.

## Disponibilidade nesta versão

O fluxo de lançamento pelo editor **não está certificado de ponta a ponta para produção**:

- No WhatsApp, o editor atual não vincula com segurança o texto digitado ao nome e aos componentes exatos de um modelo aprovado pela Meta. Um envio pode falhar mesmo quando o texto parece correto.
- Uma campanha agendada não tem uma ação operacional de cancelamento antes de o processo automático iniciá-la.
- O Email de campanhas não certifica Email como canal de conversa nem oferece uma conexão de Email por autosserviço.

Por enquanto, use a tela para preparar rascunhos, revisar segmentos e consultar resultados já registrados. **Não use Enviar agora nem agende uma campanha de produção** até que o painel ofereça um seletor verificado de modelo/remetente e uma ação de cancelamento. Antes de qualquer envio real, coordene um teste controlado com o suporte.

## Preparar um rascunho seguro

1. Vá a **IA e crescimento → Campanhas** e crie uma campanha.
2. Dê a ela um nome interno.
3. Escolha **Todos os contatos** ou um **Segmento** criado em **CRM → Segmentos**.
4. Confira a quantidade de destinatários e as recusas de comunicação.
5. Salve o rascunho sem data de envio.

Não coloque dados sensíveis no nome interno. A disponibilidade, os canais e a capacidade vigentes aparecem na tela e em **Administração → Plano e faturamento**.

## Modelos de WhatsApp

Caminho: **Canais → WhatsApp → Ver todos os modelos**.

- Um modelo tem nome técnico, idioma, categoria e componentes que devem coincidir exatamente com o aprovado pela Meta.
- **Sincronizar da Meta** atualiza os estados exibidos na Parallly.
- Ao conectar o WhatsApp, a Parallly pode enviar **4 modelos-semente**: lembrete de agendamento, confirmação de presença, confirmação de pedido e pagamento recebido.
- A Meta decide se aprova ou rejeita cada modelo e quanto tempo a análise leva; a Parallly apenas exibe o estado recebido.

Ter um modelo aprovado não corrige, por si só, a limitação do editor de campanhas descrita acima.

## Estados e métricas

A lista pode mostrar rascunhos e campanhas já processadas, com destinatários, entregas, leituras, respostas ou falhas. Esses dados dependem dos eventos informados por cada provedor; a entrega ou leitura nem sempre está disponível.

Os controles de variantes A/B existem no editor, mas o envio usa o mesmo fluxo de lançamento não verificado. Use-os apenas como configuração de rascunho até que o fluxo seja certificado.

## Perguntas frequentes

**Posso cancelar uma campanha agendada?**
Não existe uma ação operacional de cancelamento na versão atual. Por isso, não agende campanhas de produção por este editor.

**Posso digitar diretamente o texto do modelo de WhatsApp e enviá-lo?**
Não com segurança nesta versão. O WhatsApp exige o identificador e os componentes exatos de um modelo aprovado; o editor ainda não faz essa vinculação de ponta a ponta.

**Quanto tempo a Meta leva para aprovar um modelo?**
Não há prazo garantido. Consulte o estado sincronizado em **Canais → WhatsApp**.

**O Email de campanhas habilita um canal de Email?**
Não. O Email conversacional por autosserviço não está certificado atualmente.

**Precisa de mais ajuda?** Escreva para nós em https://parallly-chat.cloud/support
