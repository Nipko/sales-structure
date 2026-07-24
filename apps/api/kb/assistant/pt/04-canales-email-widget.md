---
id: canales-email-widget
title: "Canal de Email e widget de chat para seu site"
routes: ["/admin/channels", "/admin/channels/email", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["email", "e-mail", "canal de email", "conectar email", "smtp", "sendgrid", "gmail", "outlook", "widget", "chat web", "chat no meu site", "chat na minha pagina", "balao de chat", "codigo de incorporacao", "instalar widget", "gatilhos", "gatilhos proativos", "mensagem de boas-vindas", "formulario pre-chat"]
---

Além do WhatsApp e das redes sociais, seu negócio pode atender clientes por **Email** (os e-mails chegam na sua caixa de entrada como qualquer conversa) e por um **widget de chat web** que você instala no seu próprio site para que os visitantes conversem com seu assistente de IA sem sair da página. Aqui a gente explica como configurar os dois.

> Somente o papel de **administrador** pode conectar o canal de Email e configurar o widget de chat web.

## Disponibilidade por plano

| Plano | Canal de Email | Widget de chat web | Gatilhos proativos do widget |
|------|----------------|--------------------|--------------------------------|
| Emprendedor | Não incluído | Não incluído | — |
| Starter | Sim | Sim | Até 3 |
| Pro | Sim | Sim | Até 10 |
| Enterprise | Sim | Sim | Ilimitados |
| Custom | Sim | Sim | Ilimitados |

Se o seu plano não inclui algum dos dois, você pode fazer upgrade em **Configurações** → **Faturamento**.

---

## Como conectar o canal de Email

1. Na barra lateral, entre em **Canais** e clique no card de **Email**.
2. Em **Configuração do remetente**, preencha:
   - **E-mail de envio**: o endereço de onde seus e-mails vão sair (ex.: `ventas@tuempresa.com`).
   - **Nome do remetente**: o nome que seus clientes vão ver (ex.: "Equipe de Vendas — MinhaEmpresa").
   - **Responder para**: endereço opcional para onde chegam as respostas, se quiser que seja diferente do de envio.
3. Escolha o **Provedor** de envio:
   - **SMTP**: funciona com qualquer serviço de e-mail (Gmail, Outlook, sua hospedagem). Preencha **Host**, **Porta**, **Usuário**, **Senha** e **Criptografia**. Recomendado: TLS na porta 587.
   - **SendGrid**: se o seu negócio lida com alto volume de e-mails, cole sua **API Key do SendGrid**.
4. Ative o botão **Canal ativo**.
5. Clique em **Salvar configuração**. A Parallly envia um e-mail de teste para confirmar que ficou tudo certo.

Pronto: os e-mails que chegarem nesse endereço vão aparecer como conversas na sua caixa de entrada, junto com WhatsApp, Instagram e os demais canais.

> **Se você usa Gmail ou Outlook com verificação em duas etapas**: não use sua senha normal. Crie uma "Senha de app" de 16 caracteres nas configurações de segurança da sua conta de e-mail e use-a no campo **Senha**.

### Recebimento de e-mails com o SendGrid

Se você escolheu o SendGrid, a página mostra um endereço de recebimento com o botão **Copiar URL do Webhook**. Copie e cole na sua conta do SendGrid (em Settings → Inbound Parse) para que os e-mails recebidos cheguem à sua caixa de entrada da Parallly. É um passo feito uma única vez.

### Como o e-mail funciona na sua caixa de entrada

- Cada e-mail recebido cria uma conversa nova, ou entra em uma existente se o contato já estiver cadastrado.
- Seu assistente de IA pode responder e-mails do mesmo jeito que responde mensagens de WhatsApp ou Instagram.
- As respostas saem como um e-mail normal a partir do endereço que você configurou.
- Você vê assunto, corpo e anexos de cada e-mail dentro da conversa.

### Atribuir um assistente de IA ao Email

Lembre a regra geral: **um assistente de IA por conexão**. No editor do seu assistente (seção **Agente IA**), vincule a conexão de Email para que ele responda os e-mails recebidos. Se preferir que só o seu time humano responda os e-mails, é só não atribuir assistente.

---

## Como instalar o widget de chat no seu site

1. Na barra lateral, entre em **Configurações** → seção **Integrações** → **Chat web**.
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

## Como criar gatilhos proativos (para o chat puxar conversa primeiro)

Os gatilhos fazem o widget se ativar sozinho conforme o comportamento do visitante, sem esperar que ele clique. Bem usados, aumentam muito as conversas iniciadas.

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
7. Clique em **Salvar**. O gatilho fica **Ativo** na hora.

**Exemplos que funcionam bem:**

- Página de preços + 15 segundos → balão: "Ficou com dúvida sobre nossos planos? Te ajudo a escolher".
- Intenção de saída no checkout → abrir widget: "Espera! Posso te ajudar a finalizar sua compra?".
- 3ª visita → banner: "Bem-vindo de volta — agende uma demo gratuita".

> **Dica**: um ou dois gatilhos bem posicionados convertem mais do que bombardear o visitante em cada página. Se aparecer o aviso "Você atingiu o limite de gatilhos do seu plano", desative algum ou faça upgrade do plano.

---

## Perguntas frequentes

**O canal de Email substitui meu e-mail normal?**
Não. Sua caixa de correio continua funcionando igual; a Parallly se conecta ao seu serviço de e-mail para enviar respostas e trazer os e-mails recebidos para a sua caixa de conversas. Nada é apagado da sua conta de e-mail.

**Salvei a configuração de Email mas não chegam e-mails na caixa de entrada.**
Verifique se o botão **Canal ativo** está ligado e se o e-mail de teste chegou. Se usa Gmail/Outlook com verificação em duas etapas, confira se está usando uma senha de app. Se usa SendGrid, confirme que colou a URL de recebimento na sua conta do SendGrid.

**Posso ter o widget em vários sites?**
Você pode criar mais de um widget em **Criar widget**, e cada um tem seu próprio código de incorporação e sua própria personalização.

**Como tiro o chat do meu site?**
No card do widget, clique em **Excluir** e confirme: os visitantes não vão mais conseguir conversar, mesmo que o código continue na sua página. Se preferir manter o widget e sua configuração, peça a quem cuida do seu site para retirar o código da página.

**O que acontece com os chats do widget quando meu negócio está fechado?**
Seu assistente de IA responde 24/7. Se o visitante pedir para falar com uma pessoa fora do horário, valem seus **Horários de atendimento** e a mensagem fora do horário que você configurou.

**Preciso saber programar para instalar o widget?**
Não. É só copiar o código com **Copiar código** e colar no seu site (ou enviar para quem cuida dele). É um passo feito uma única vez.

Ainda com dúvidas? Escreva pra gente em https://parallly-chat.cloud/support
