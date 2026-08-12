---
id: sms-creditos
title: "Créditos SMS e notificações por SMS"
routes: ["/admin/settings/billing", "/admin/broadcast"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["sms", "creditos", "creditos sms", "pacote sms", "comprar creditos", "saldo sms", "recarga", "mensagens de texto", "notificacoes sms", "segmento", "campanhas sms", "lembretes sms", "saldo esgotado", "sms desabilitado", "texto para clientes"]
---

# Créditos SMS e notificações por SMS

SMS é um recurso de **notificações de saída**, não um canal de conversa com o agente de IA. Disponibilidade, cobertura, identidade do remetente e forma de provisionar créditos dependem da integração habilitada para a conta e o país.

## Segmentos e consumo

Um crédito representa um segmento de SMS. Texto simples geralmente comporta mais caracteres do que uma mensagem com certos símbolos ou emojis, e uma mensagem longa pode ser dividida em vários segmentos. O contador do editor é a referência antes do envio: revise a estimativa, pois a codificação do texto pode alterar o total.

## Saldo ou compra de créditos

O administrador pode abrir **Administração → Plano e faturamento**. Se a seção **Créditos SMS** aparecer, ela mostra saldo, consumo e opções ativas. Quando existir uma ação de compra ou recarga, a página informa pacotes, preço, moeda, provedor, condições e confirmação; use somente esse fluxo seguro.

Se a seção ou o botão não aparecer, a compra não está habilitada para essa conta. Não presuma provedor, tipo de pagamento, crédito imediato ou regra de validade: a página e a confirmação da operação são a fonte atual.

## Preparar um rascunho de campanha SMS

Um administrador ou supervisor pode usar **IA e crescimento → Campanhas** quando SMS aparecer como opção:

1. Crie a campanha e selecione **SMS**.
2. Escreva o texto e revise a quantidade estimada de segmentos.
3. Escolha um público autorizado e confirme o respeito aos opt-outs.
4. Revise o resumo e salve o rascunho. Não envie nem agende para produção pelo editor atual: ele compartilha o fluxo de campanhas ainda não certificado e uma campanha agendada não tem ação de cancelamento. Consulte **Campanhas e disparo**.

Lembretes e automações também podem consumir créditos quando a ação SMS está habilitada. Códigos de segurança enviados pela Parallly a usuários não fazem parte das campanhas da empresa.

## Se SMS aparecer desabilitado

- Se SMS não aparecer em **Campanhas**, o serviço não está disponível para essa conta, país ou configuração.
- Se o saldo for insuficiente, o envio fica bloqueado; confira a página antes de tentar novamente.
- O supervisor pode preparar ou operar campanhas permitidas, mas somente o administrador acessa faturamento ou uma compra habilitada.
- Se uma operação confirmada não aparecer, atualize a página e fale com o suporte informando data e estado, sem compartilhar dados sensíveis de pagamento.

O número ou identificador do remetente depende da integração e pode variar por país. Não prometa respostas recebidas por SMS a menos que a própria tela indique mensagens bidirecionais habilitadas.
