---
id: canales-email-widget
title: "Chat web e estado da integração de Email"
routes: ["/admin/channels", "/admin/channels/email", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["email", "e-mail", "estado do canal de email", "widget", "chat web", "chat no meu site", "chat na minha pagina", "balao de chat", "codigo de incorporacao", "instalar widget", "gatilhos", "gatilhos proativos", "mensagem de boas-vindas", "formulario pre-chat"]
---

# Chat web e estado da integração de Email

O **widget de chat web** é uma superfície conversacional operacional que você instala no seu site para que os visitantes conversem com seu assistente de IA sem sair da página.

> Somente o papel de **administrador** pode configurar o widget de chat web.

## Disponibilidade

A tela informa se o chat web e os gatilhos proativos estão habilitados e quanto espaço resta. Confira os detalhes atuais em **Plano e faturamento**.

### Estado do Email

Email existe como adaptador técnico e entrada interna para integrações gerenciadas, mas **ainda não é um canal conversacional certificado nem configurável por autosserviço**. A página **Canais → Email** não tem atualmente o contrato de API necessário para salvar configurações por tenant. Não insira credenciais nem suponha que essa tela torne o canal operacional.

Se sua organização precisa integrar e-mail, peça uma avaliação técnica ao suporte. Até que o fluxo seja implementado e certificado de ponta a ponta, a Parallly Assist não deve prometer conexão, envio, recebimento na caixa de conversas nem respostas automáticas por Email.

---

## Como instalar o widget de chat no seu site

1. Entre em **Configurações → Canais e integrações → Chat web**.
2. Clique em **Criar widget**. Seu widget é criado com a configuração inicial.
3. No card do widget você verá o **Código de incorporação**. Clique no botão **Copiar código**.
4. Cole esse código no seu site, de preferência logo antes do fechamento da página (se outra pessoa cuida do seu site, envie o código exatamente como está: ela vai saber onde colocar). Funciona em qualquer site: WordPress, Shopify, Wix, páginas feitas sob medida, etc.
5. Salve as alterações no seu site e recarregue a página: o balão de chat vai aparecer no canto que você escolheu.

Os visitantes que escreverem pelo widget aparecem como conversas na sua caixa de entrada, e seu assistente de IA os atende automaticamente.

### Como personalizar o widget

Na mesma página, clique no ícone de **Configurar** (engrenagem) do seu widget e ajuste:

| Opção | O que controla |
|--------|--------------|
| **Nome do widget** | Nome interno para identificá-lo (seus visitantes não veem) |
| **Nome do assistente** | O nome que o visitante vê na janela de chat |
| **Cor primária** | A cor do balão e do cabeçalho do chat, para combinar com a sua marca |
| **Posição** | **Inferior direito** ou **Inferior esquerdo** da tela |
| **Mensagem de boas-vindas** | A primeira mensagem que o visitante vê ao abrir o chat |
| **Formulário pré-chat** | Se estiver ativo, o visitante deixa seus dados (nome, contato) antes de conversar |

Ao terminar, clique em **Salvar**. As mudanças valem no seu site sem mexer no código de novo.

> Os campos pedidos no formulário pré-chat são definidos em **Configurações** → **Formulário pré-chat**. Pedir o telefone ou e-mail permite reconhecer o visitante se depois ele escrever pelo WhatsApp ou outro canal.

---

## Como salvar definições de gatilhos (ainda sem execução pública)

A tela permite salvar definições de gatilhos com base no comportamento do visitante. **Na versão atual, o script público do widget ainda não avalia nem executa essas definições**, portanto não conte com aberturas, balões ou banners proativos em produção. O chat aberto pelo visitante continua funcionando.

1. Entre em **Configurações** → **Chat web** e clique no botão **Gatilhos proativos**.
2. Clique em **Novo gatilho** e dê um **Nome** (ex.: "Oferta de ajuda na página de preços").
3. Em **Condições**, clique em **Adicionar condição** e escolha quando ele dispara:

| Condição | Dispara quando… |
|-----------|--------------------|
| **Tempo na página** | O visitante está há X segundos na página |
| **Scroll (%)** | Rolou mais de certa porcentagem da página |
| **Intenção de saída** | Move o cursor para fechar a aba |
| **URL da página** | Está em uma página específica (ex.: `/precios`) |
| **Número de visitas** | Já entrou N ou mais vezes no seu site |

4. Se adicionar várias condições, escolha o **Operador**: **Todas devem valer (AND)** ou **Pelo menos uma (OR)**.
5. Escolha o **Tipo de ação**: **Abrir widget** (o chat abre sozinho), **Mostrar balão** (aparece uma mensagenzinha ao lado do ícone) ou **Mostrar banner** (faixa com mensagem e botão).
6. Escreva a **Mensagem** que o visitante vai ver e, se quiser, ajuste a **Frequência (min)** (0 = aparece uma única vez por visita).
7. Clique em **Salvar**. A definição fica armazenada, mas ainda não é executada no site público.

**Exemplos de configurações que o editor permite preparar (ainda não executadas):**

- Página de preços + 15 segundos → balão: "Ficou com dúvida sobre nossos planos? Te ajudo a escolher".
- Intenção de saída no checkout → abrir widget: "Espera! Posso te ajudar a finalizar sua compra?".
- 3ª visita → banner: "Bem-vindo de volta — agende uma demo gratuita".

> Não publique uma estratégia que dependa desses gatilhos até que o carregador público os marque como disponíveis. A tela pode mostrar a capacidade do plano enquanto o executor do navegador ainda está pendente.

---

## Perguntas frequentes

**Posso ter o widget em vários sites?**
Você pode criar mais de um widget em **Criar widget**, e cada um tem seu próprio código de incorporação e sua própria personalização.

**Como tiro o chat do meu site?**
No card do widget, clique em **Excluir** e confirme: os visitantes não vão mais conseguir conversar, mesmo que o código continue na sua página. Se preferir manter o widget e sua configuração, peça a quem cuida do seu site para retirar o código da página.

**O que acontece com os chats do widget quando meu negócio está fechado?**
Seu assistente de IA responde 24/7. Se o visitante pedir para falar com uma pessoa fora do horário, valem seus **Horários de atendimento** e a mensagem fora do horário que você configurou.

**Preciso saber programar para instalar o widget?**
Não. É só copiar o código com **Copiar código** e colar no seu site (ou enviar para quem cuida dele). É um passo feito uma única vez.

Ainda com dúvidas? Escreva pra gente em https://parallly-chat.cloud/support
