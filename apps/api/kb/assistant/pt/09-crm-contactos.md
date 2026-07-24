---
id: crm-contactos
title: "Contatos e CRM"
routes: ["/admin/contacts", "/admin/contacts/segments", "/admin/identity", "/admin/settings/custom-attributes"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["contatos", "crm", "leads", "clientes", "score", "pontuação", "etapas", "segmentos", "filtros", "importar", "exportar", "csv", "excel", "duplicados", "mesclar", "fundir", "arquivar", "ações em massa", "atributos personalizados", "campos personalizados", "vip"]
---

# Contatos e CRM

O CRM da Parallly é onde ficam todos os seus contatos: cada pessoa que te escreve por WhatsApp, Instagram, Messenger, Telegram, Email ou pelo chat do seu site é registrada aqui automaticamente, com o histórico completo. Você também pode adicionar contatos manualmente ou importá-los a partir de uma planilha Excel.

Você encontra tudo isso na barra lateral: abra **CRM** e entre na primeira opção, **CRM**. Você chegará à página **Contatos**, com uma tabela que mostra nome, canal, conversas, valor, última interação, score, etapa e tags. Na parte de cima há chips rápidos para filtrar por grupo: **Todos**, **Novos**, **Leads**, **Qualificados**, **Clientes** e **Perdidos**, além de um campo de busca.

Todos os perfis podem ver, criar e editar contatos. Arquivar e as ações em massa ficam reservadas para administradores e supervisores.

## Como criar um contato manualmente

1. Em **Contatos**, clique em **Adicionar contato**.
2. Preencha o formulário **Novo contato**: **Nome**, **Sobrenome**, **Telefone** (obrigatório), **Email** e **Etapa** inicial.
3. Clique em **Criar contato**.

> O telefone é limpo e normalizado automaticamente para o formato internacional (funciona com números da Colômbia, Argentina, México, Brasil, Chile, Peru, Equador e EUA/Canadá). Você pode digitar `3001234567` ou `+573001234567`: os dois ficam salvos corretamente.

## O detalhe do contato (ficha 360°)

Clique em qualquer contato para abrir a ficha completa:

- **Editar**: com o botão **Editar** você altera nome, email, telefone, etapa, a marca **VIP** e as **Tags** direto na ficha. Salve com **Salvar**.
- **Detalhamento do score**: clique no score para ver os 5 fatores que o compõem — **Recência**, **Engajamento**, **Intenção**, **Etapa** e **Perfil**.
- **AI Insights**: análise automática do comportamento do contato (probabilidade de fechamento, próxima melhor ação, sinais detectados).
- **Campos personalizados**: os atributos extras que você tiver definido para o seu negócio (veja mais abaixo).
- **Oportunidades**: os negócios em aberto deste contato no funil.
- Abas **Histórico** (linha do tempo de atividade), **Notas** (anotações internas da equipe) e **Tarefas** (acompanhamentos, ligações, reuniões).

### O que é o score?

É uma pontuação que ordena seus contatos de acordo com o quanto eles estão "quentes": quão recente foi a última interação, quanto conversam, quais palavras de compra usam, em que etapa estão e quão completo é o perfil. Administradores e supervisores podem ajustar o peso de cada fator em **Configurações → Lead scoring**, incluindo o decaimento (o score cai sozinho quando o contato passa muitos dias sem atividade).

### Etapas

Cada contato tem uma etapa de venda (novo, contatado, qualificado, ganho, perdido…). As etapas são as mesmas do seu funil e são personalizadas em **Configurações → Etapas do pipeline**. Você pode alterá-la pela ficha do contato ou deixar que o agente de IA avance sozinho (veja o artigo do Funil de vendas).

## Como usar os filtros avançados

1. Em **Contatos**, abra **Filtros avançados**.
2. Combine critérios: **Faixa de score** (mínimo e máximo), **Faixa de datas**, **Filtrar por tags**.
3. Clique em **Aplicar filtros**. Com **Limpar filtros** você volta para a lista completa.

## Como importar contatos a partir de Excel ou CSV

1. Em **Contatos**, clique em **Importar**.
2. Na janela **Importar contatos**, arraste seu arquivo Excel (.xlsx, .xls) ou CSV, clique para procurá-lo no seu computador, ou copie e cole as células diretamente.
3. Se preferir, use **Baixar modelo CSV** para partir de um modelo com as colunas corretas e uma aba de instruções.
4. Clique em **Importar**. Ao final você verá o resumo: **Importados**, **Ignorados** e **Erros** (com o detalhe de cada linha com problema).

Detalhes úteis do formato:

- A única coluna obrigatória é o **telefone** (é o identificador único do contato).
- As colunas aceitam sinônimos em português, espanhol e inglês (ex. "telefone", "celular", "phone") e o separador pode ser vírgula ou ponto e vírgula.
- Colunas opcionais: nome, sobrenome, email, etapa, empresa, origem, é_vip, canal preferido e atributos de campanhas (UTM).
- Se você incluir a coluna de etapa, os valores válidos são: `nuevo`, `contactado`, `respondio`, `calificado`, `tibio`, `caliente`, `listo_cierre`, `ganado`, `perdido`, `no_interesado`.

## Como exportar seus contatos

Em **Contatos**, clique em **Exportar**. Um arquivo Excel com todos os seus contatos é baixado, pronto para abrir ou compartilhar.

## Ações em massa

Para administradores e supervisores:

1. Marque as caixas de seleção dos contatos que quiser (você verá quantos já estão **selecionados**).
2. Na barra que aparece embaixo, escolha a ação: **Alterar etapa**, **Adicionar tag** ou **Arquivar**.
3. Complete o dado (a nova etapa ou o nome da tag) e clique em **Aplicar**.

## Como arquivar um contato

Arquivar tira o contato das suas listas e do funil (por exemplo, contatos de teste ou que pediram para não serem contatados).

1. Abra a ficha do contato e clique em **Arquivar**.
2. Confirme na janela **Arquivar contato**.

Você também pode arquivar vários de uma vez com as ações em massa. Encare isso como uma ação definitiva: revise bem antes de confirmar.

## Segmentos salvos

Um segmento é um grupo de contatos definido por filtros que se atualiza sozinho: "leads quentes", "clientes VIP do Instagram", etc. Servem, por exemplo, para escolher o público de uma campanha.

1. Em **Contatos**, clique em **Segmentos** (ou entre na página Segmentos do CRM).
2. Clique em **Novo segmento**.
3. Dê um **Nome** (ex. "Leads quentes") e uma **Descrição** opcional.
4. Com **Adicionar filtro** combine critérios: **Estágio**, **Pontuação**, **Telefone**, **Email**, **Fonte**, **VIP** ou **Data de criação**, com operadores como "igual a", "maior que" ou "contém".
5. Use **Pré-visualizar** para ver quantos contatos correspondem e clique em **Criar segmento**.

## Atributos personalizados

Se você precisa guardar dados próprios do seu negócio (aniversário, tamanho, número de apólice…), crie campos sob medida. Disponível para administradores e supervisores:

1. Vá em **Configurações** e, na seção **Operação**, entre em **Atributos personalizados**.
2. Clique em **Novo atributo**.
3. Escolha o **Tipo de entidade** (Contato, Lead, Empresa ou Conversa), escreva o **Rótulo** (ex. "Aniversário") e o **Tipo de dado**: Texto, Número, Data, Booleano, Lista (com opções separadas por vírgulas) ou URL. Você pode marcá-lo como **Campo obrigatório**.
4. Salve. O campo aparecerá na seção **Campos personalizados** da ficha de cada contato.

## Contatos duplicados: fusão automática e manual

Se a mesma pessoa te escreve por dois canais com o mesmo telefone ou email, a Parallly une os perfis automaticamente. Para os casos que o sistema não consegue resolver sozinho, administradores e supervisores têm a página **Identidade** (digite `/admin/identity` no final do endereço do seu painel):

- **Sugestões automáticas**: pares de contatos muito parecidos detectados pelo sistema, com seu nível de **Confiança**. Revise cada par e escolha **Aprovar** (eles são mesclados) ou **Rejeitar**.
- **Mesclar manualmente**: busque e selecione o primeiro e o segundo contato e clique em **Mesclar contatos**. Eles ficam unidos em um único perfil com todo o histórico.

## Limites por plano

| Plano | Contatos | Segmentos salvos | Atributos personalizados |
|-------|----------|------------------|--------------------------|
| Emprendedor | 100 | Não incluído | Não incluído |
| Starter | 500 | 3 | 5 |
| Pro | 5.000 | 15 | 20 |
| Enterprise | 50.000 | Sem limite | Sem limite |
| Custom | Sem limite | Sem limite | Sem limite |

Ao se aproximar do limite de contatos do seu plano, você verá um aviso para ampliá-lo em **Configurações → Faturamento**.

## Perguntas frequentes

**Os contatos são criados sozinhos?**
Sim. Cada pessoa que te escreve por qualquer canal conectado fica registrada automaticamente com a conversa. Criar manualmente ou importar serve apenas para contatos que ainda não te escreveram.

**Por que um contato tem score baixo se me comprou há meses?**
O score premia a atividade recente: se você configurou o decaimento, ele cai com os dias sem interação. Você pode ajustar os pesos em **Configurações → Lead scoring**.

**O que acontece se eu importar um telefone que já existe?**
O telefone é o identificador único: a linha é marcada como ignorada ou atualiza o contato existente, sem criar duplicados. O resumo da importação mostra o detalhe.

**Posso desfazer uma fusão de contatos?**
Não pelo painel. Antes de aprovar uma sugestão ou mesclar manualmente, revise bem os dois perfis. Se você mesclou por engano, escreva para o nosso suporte.

**Quem pode arquivar ou fazer alterações em massa?**
Apenas administradores e supervisores. Os agentes podem ver, criar e editar os contatos.

**Precisa de mais ajuda?** Escreva para nós em https://parallly-chat.cloud/support
