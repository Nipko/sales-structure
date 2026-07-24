---
id: base-conocimiento
title: "Base de conhecimento do agente"
routes: ["/admin/knowledge", "/admin/knowledge/faqs"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["base de conhecimento", "conhecimento", "knowledge base", "enviar documentos", "pdf", "faq", "perguntas frequentes", "importar url", "página web", "rastreamento", "artigos", "categorias", "editar documento", "versões", "qualidade", "sugestões", "lacunas", "portal público", "ajuda para clientes", "o agente não sabe responder"]
---

# Base de conhecimento do agente

A base de conhecimento é a "memória" do seu agente de IA: os documentos, perguntas frequentes e páginas que você envia aqui são a informação com que ele responde aos seus clientes. Quanto mais completa e atualizada estiver, mais precisas são as respostas.

Você a encontra no menu lateral, seção **Crescimento → Automação → Base de Conhecimento**. Lá dentro você verá as abas **Biblioteca**, **FAQs**, **Buscar no contexto**, **Qualidade**, **Análises** e **Lacunas**.

> Esta seção é administrada pelos papéis **administrador** e **supervisor**.

## O que o seu plano inclui

| Plano | Artigos / documentos | Importação de páginas web | Tamanho máx. por documento | Análises de conhecimento |
|------|:---:|:---:|:---:|:---:|
| Emprendedor | 5 | Não incluída | 25.000 caracteres | Não |
| Starter | 20 | 50 páginas | 100.000 caracteres | Sim |
| Pro | Ilimitados | 500 páginas | 250.000 caracteres | Sim |
| Enterprise | Ilimitados | Ilimitadas | 500.000 caracteres | Sim |
| Custom | Ilimitados | Ilimitadas | Sem limite | Sim |

Se você atingir o limite, verá o aviso **Limite de documentos atingido** com a opção de fazer upgrade do seu plano.

## Como enviar documentos (PDF, Word e mais)

1. Na aba **Biblioteca**, clique em **Importação em massa**.
2. Clique em **Selecionar arquivos**. Formatos suportados: **PDF, DOCX, TXT, MD, CSV** (máximo 20 arquivos por lote).
3. Se quiser, escreva uma **categoria** para todos os arquivos (por exemplo, "Preços" ou "Políticas").
4. Clique em **Enviar tudo**.

Ao terminar, você verá um resumo de quantos foram importados com sucesso. Cada documento é processado e fica **Pronto** para o agente usá-lo em suas respostas.

## Como criar um artigo escrevendo o texto

1. Na **Biblioteca**, clique em **Criar**.
2. Na janela **Novo recurso**, escreva o **Título do recurso** e cole ou redija o **Conteúdo de texto** (políticas, promoções, manual interno, o que você precisar).
3. Salve e pronto: o agente já pode usá-lo.

## Como importar uma página web (com atualização automática)

Disponível a partir do plano **Starter**:

1. Na **Biblioteca**, clique em **Importar URL**.
2. Escreva a **URL da página** (por exemplo, a página de perguntas frequentes do seu site). O **Título** é opcional: é detectado automaticamente.
3. Clique em importar. A Parallly lê a página e a converte em um artigo da sua base de conhecimento.

As páginas importadas se mantêm atualizadas sozinhas: **uma vez por semana a plataforma as revisa automaticamente** e, se o conteúdo mudou, atualiza o artigo. Você também pode forçar isso quando quiser com o botão **Atualizar conteúdo** do documento — se não houve mudanças, você verá "Nenhuma alteração detectada".

## Como criar perguntas frequentes (FAQs)

As FAQs são pares de pergunta e resposta que o agente usa para dar respostas exatas, palavra por palavra se necessário.

1. Acesse a aba **FAQs**.
2. Clique em **Nova FAQ**.
3. Preencha **Pergunta** e **Resposta** (obrigatórias). Você pode adicionar **Categoria**, **Tags** e a **Ordem** em que é exibida.
4. Deixe ativada a opção **Publicada (visível ao agente)** para que o agente a use.
5. Clique em **Salvar**.

> Dica: use FAQs para o que deve ser respondido sempre igual (preços, horários, políticas de devolução) e documentos para informações mais extensas.

## Organizar com categorias e idiomas

- Ao criar ou editar qualquer documento, você pode atribuir uma **categoria**. Na **Biblioteca** elas aparecem como filtros de um clique para encontrar tudo mais rápido.
- O idioma de cada documento é **detectado automaticamente**. Se você tem conteúdo em vários idiomas, aparece um filtro por idioma; o agente prioriza o conteúdo do idioma em que o cliente escreve.

## Editar um artigo e recuperar versões anteriores

- Para editar: na **Biblioteca**, clique no botão de **editar** (lápis) do documento e mude nome, conteúdo ou categoria. Salve com **Salvar alterações**.
- Cada edição cria uma nova versão. Com o botão de **Histórico de versões** (ícone de relógio) você pode ver as versões anteriores e clicar em **Restaurar** para voltar a uma delas.

## Qualidade e sugestões da IA

- Na aba **Qualidade**, cada documento recebe uma pontuação de 0 a 100 conforme o seu conteúdo, se tem categoria, quanto é consultado e o quão relevante é nas respostas. Comece melhorando os que estiverem em vermelho.
- Na aba **Análises**, a seção **Sugestões de artigos (IA)** analisa as perguntas que os seus clientes fizeram e o agente não conseguiu responder, e propõe artigos novos com seu esboço. Clique em **Gerar sugestões** e depois em **Criar** sobre aquele que você quiser redigir.

## Análises: o que é consultado e o que falta

A partir do plano **Starter**, a aba **Análises** mostra a você:

- **Consultas únicas**, **taxa de acerto** e volume diário de buscas do agente na sua base de conhecimento.
- **Documentos mais consultados** — o seu conteúdo estrela.
- **Perguntas sem resposta** — o que os clientes perguntaram e o agente não encontrou. A partir daí você pode **criar um artigo** com um clique ou marcá-las com **Resolver**.

## Lacunas: encontre os buracos do seu conteúdo

A aba **Lacunas** organiza o que precisa da sua atenção:

- **Consultas sem resposta** — crie um artigo ou FAQ que as cubra.
- **Docs baixa satisfação** — artigos que receberam reações negativas da sua equipe no inbox; revise-os e melhore-os.
- **Docs desatualizados** — conteúdo que faz muito tempo sem mudanças (preços e políticas costumam vencer).

Além disso, a seção **Saúde do KB — Contradições** detecta informação que se contradiz entre os seus documentos (dois preços diferentes para a mesma coisa, políticas em conflito). Clique em **Escanear agora** e resolva o que for encontrado.

> Dica: revise Lacunas uma vez por semana. Cada lacuna fechada é um cliente melhor atendido.

## Portal público: uma central de ajuda para os seus clientes

Você pode publicar parte da sua base de conhecimento como uma central de ajuda on-line, sem senha, para que os seus clientes consultem sozinhos:

1. Na **Biblioteca**, clique no botão **Público/Privado** (ícone de globo com cadeado) do documento que você quiser publicar. Os publicados mostram a etiqueta **Público**.
2. Compartilhe o link do seu portal: `https://admin.parallly-chat.cloud/kb/seu-identificador` (o identificador do seu negócio na Parallly). Ideal para vinculá-lo a partir do seu site ou nas suas redes.

Só são exibidos os documentos que você marcou como públicos; todo o resto continua sendo privado.

## Como o agente usa a sua base de conhecimento

Quando um cliente pergunta algo, o agente busca nos seus documentos e FAQs os trechos mais relevantes e constrói a resposta com essa informação — não inventa dados que você não deu a ele. Para que funcione:

- Em **Agente IA**, abra o seu agente e, nas suas ferramentas, verifique se o cartão **Base de conhecimento** está ativado. Ali mesmo você pode ajustar quantos trechos ele usa por resposta e o quão exigente é com a relevância.
- Teste o que o agente encontraria com a aba **Buscar no contexto**: escreva uma pergunta como um cliente faria e você verá os trechos que a IA usaria, com sua porcentagem de relevância. Se não aparecer nada útil, ali está o seu próximo artigo.

## Perguntas frequentes

**O agente responde "não tenho essa informação", o que eu faço?**
É sinal de que falta conteúdo. Escreva a mesma pergunta em **Buscar no contexto**: se não houver resultados, crie um artigo ou FAQ que a cubra. Revise também **Análises → Perguntas sem resposta**, onde essa consulta ficou registrada.

**Posso importar o meu site completo?**
Você pode importar página por página com **Importar URL**, até o limite do seu plano (50 páginas no Starter, 500 no Pro, sem limite no Enterprise e Custom). Comece pelas páginas com mais valor: perguntas frequentes, preços, políticas.

**As mudanças no meu site se refletem sozinhas?**
Sim. As páginas importadas são revisadas automaticamente toda semana e são atualizadas se mudaram. Se você precisar da mudança agora, use **Atualizar conteúdo** no documento.

**Os meus clientes podem ver os meus documentos internos?**
Não. Tudo é privado, exceto o que você marcar como **Público** para o portal de ajuda. O agente usa sim todo o conteúdo (público e privado) para responder, mas nunca mostra os documentos em si.

**Editei um documento e ficou pior, posso voltar atrás?**
Sim. Abra o **Histórico de versões** do documento e clique em **Restaurar** sobre a versão anterior.

**Por que não vejo a aba Análises com dados?**
As análises de conhecimento requerem plano **Starter ou superior**, e começam a ser preenchidas com as conversas reais dos seus clientes. Se você acabou de começar, dê alguns dias.

Precisa de mais ajuda? Escreva para nós em https://parallly-chat.cloud/support
