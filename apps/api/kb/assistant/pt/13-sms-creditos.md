---
id: sms-creditos
title: "Créditos SMS e notificações por SMS"
routes: ["/admin/settings/billing", "/admin/broadcast"]
roles: ["tenant_admin"]
keywords: ["sms", "creditos", "creditos sms", "pacote sms", "comprar creditos", "saldo sms", "recarga", "mensagens de texto", "notificacoes sms", "segmento", "mercadopago", "pagamento unico", "campanhas sms", "lembretes sms", "saldo esgotado", "avisos por texto", "sms desabilitado", "texto para clientes"]
---

# Créditos SMS e notificações por SMS

Com o Parallly você pode enviar **notificações por SMS** para os seus clientes: lembretes, avisos e promoções que chegam como mensagem de texto no celular deles. O SMS funciona com um sistema de **créditos pré-pagos** que você compra em pacotes.

Importante: o SMS **não é um canal de conversa**. É um envio de **uma única via**: o seu cliente recebe a mensagem, mas não consegue respondê-la por SMS. As conversas com o seu agente de IA acontecem pelo WhatsApp, Instagram, Messenger, Telegram, E-mail ou pelo chat na web.

## O que é um crédito

- **1 crédito = 1 segmento de SMS** (aproximadamente **160 caracteres** de texto simples).
- Se a sua mensagem usar **acentos, cedilha (ç) ou emojis**, cada segmento cai para cerca de **70 caracteres**, porque o texto viaja em um formato diferente.
- Uma mensagem maior que um segmento é dividida em vários e **consome um crédito por cada segmento**. Por exemplo, um lembrete de uns 120 caracteres com acentos usa 2 segmentos, ou seja, 2 créditos.

Dica: escreva mensagens curtas e diretas. Se der para evitar acentos e emojis, cada crédito rende mais.

## Como comprar um pacote de créditos

Os pacotes são pagos com **MercadoPago** como **pagamento único**: não é uma assinatura e não gera cobranças recorrentes.

1. No menu lateral, dentro de **Gestão**, entre em **Faturamento**.
2. Desça até a seção **Créditos SMS**. Ali você verá os pacotes disponíveis com a quantidade de mensagens e o preço (alguns aparecem marcados como **Mais popular**).
3. Escolha o pacote que você precisa e clique em **Comprar**.
4. O pagamento do MercadoPago será aberto. Conclua o pagamento como em qualquer compra online.
5. Ao voltar ao Parallly você verá o aviso "Processando a sua compra…": os créditos são **creditados automaticamente em alguns segundos** depois que o pagamento é confirmado.

Somente o **administrador** da conta pode comprar créditos, porque a compra é feita a partir da página de Faturamento.

## Como ver o seu saldo e o seu consumo

Na mesma seção **Créditos SMS** de **Faturamento** você encontra:

- O seu **saldo atual** ("créditos disponíveis"), sempre visível na parte superior da seção.
- Os **SMS consumidos neste mês**.
- Avisos automáticos: quando o seu saldo **fica abaixo de 50 créditos** aparece um alerta sugerindo recarregar, e quando chega a **0** você verá um aviso em destaque para comprar um pacote.

Cada envio fica registrado internamente com a sua data e a quantidade de créditos, assim o saldo sempre reflete exatamente o que foi comprado menos o que foi consumido.

## Como enviar notificações SMS para os seus clientes

Os SMS saem a partir de **Campanhas** (menu lateral, seção **Crescimento**):

1. Entre em **Campanhas** e crie uma nova campanha.
2. Ao escolher os canais de envio, selecione **SMS** (se a opção estiver disponível na sua conta).
3. Escreva o texto da mensagem. O editor mostra o contador de caracteres para você saber quantos segmentos ela vai usar.
4. Escolha o público e envie ou agende a campanha.

Além das campanhas, também **consomem créditos** os envios automáticos que você tiver configurados por SMS, como **lembretes de compromisso** e **sequências de acompanhamento**.

O que **não** consome créditos: os SMS que a plataforma envia para você por segurança (por exemplo, códigos de verificação). Os seus créditos são apenas para as mensagens que o seu negócio envia para os **seus clientes**.

## Por que ele pode aparecer desabilitado

Há três situações diferentes:

- **Você não vê a seção "Créditos SMS" em Faturamento, ou o SMS não aparece como canal em Campanhas**: o serviço de SMS é habilitado no nível da plataforma e pode estar desativado temporariamente (por exemplo, enquanto a cobertura no seu país está sendo ajustada). Enquanto estiver desativado não é possível comprar créditos nem enviar SMS. O seu **saldo é mantido intacto** e volta a ficar disponível quando o serviço é reativado.
- **Você ficou sem saldo**: os envios por SMS simplesmente **não saem** e **nada é cobrado de você**. Compre um pacote e os próximos envios sairão normalmente (as mensagens que não saíram por falta de saldo não são reenviadas sozinhas).
- **Você não é administrador**: a compra de pacotes fica em Faturamento, que só o administrador da conta enxerga. Peça ao seu administrador para fazer a recarga.

## Perguntas frequentes

**Os créditos vencem?**
Não têm data de validade: o seu saldo é mantido até você consumi-lo, mesmo que o serviço de SMS seja pausado temporariamente.

**A compra de créditos é uma assinatura?**
Não. É um **pagamento único** pelo MercadoPago. Você compra quando quiser e recarrega só quando precisar.

**Os meus clientes podem responder o SMS?**
Não. O SMS é de uma única via. Se você quiser conversar com os seus clientes, use os canais de conversa (WhatsApp, Instagram, Messenger, Telegram, E-mail ou o chat na web).

**Por que uma única mensagem descontou vários créditos?**
Porque ela ultrapassou um segmento. O texto simples rende ~160 caracteres por segmento; com acentos ou emojis, ~70. Uma mensagem longa é dividida em vários segmentos e cada um custa 1 crédito.

**Paguei e não vejo os créditos?**
O crédito é automático e costuma levar alguns segundos após a confirmação do pagamento. Atualize a página de **Faturamento**; se depois de alguns minutos o saldo não aparecer, escreva para o nosso suporte: https://parallly-chat.cloud/support

**De qual número os SMS saem?**
Eles são enviados pelo Parallly com um número emissor da plataforma; você não precisa contratar nem conectar nenhum provedor de SMS próprio.
