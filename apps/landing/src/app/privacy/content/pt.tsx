import Link from "next/link";

export default function PrivacyPt() {
  return (
    <>
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-accent transition-colors mb-12"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Voltar ao início
      </Link>

      {/* Title */}
      <h1 className="text-4xl font-bold tracking-tight mb-4">
        Política de Privacidade
      </h1>
      <p className="text-text-muted text-sm mb-12">
        Última atualização: 29 de abril de 2026
      </p>

      <div className="space-y-12 text-text-secondary leading-relaxed">
        {/* Intro */}
        <p>
          Na <strong className="text-text-primary">Automation AI S.A.S</strong>{" "}
          (NIT: 902032943-1), operadora da plataforma{" "}
          <strong className="text-text-primary">Parallly</strong>{" "}
          (parallly-chat.cloud), comprometemo-nos a proteger a privacidade dos
          nossos usuários. Esta Política de Privacidade descreve como
          coletamos, usamos, compartilhamos e protegemos suas informações
          pessoais quando você utiliza nossos serviços.
        </p>
        <p>
          Esta política está em conformidade com a Lei Geral de Proteção de
          Dados do Brasil (LGPD — Lei nº 13.709/2018), o Regulamento Geral de
          Proteção de Dados da União Europeia (GDPR), a Lei de Privacidade do
          Consumidor da Califórnia (CCPA) e a Lei 1581 de 2012 da Colômbia,
          bem como as normas complementares aplicáveis em cada jurisdição.
        </p>

        {/* 1 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            1. Informações que coletamos
          </h2>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.1 Dados pessoais fornecidos diretamente
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Informações de cadastro: nome completo, e-mail, número de
              telefone, nome da empresa, cargo.
            </li>
            <li>
              Informações de faturamento: dados de cartão de crédito ou método
              de pagamento (processados por provedores de pagamento
              certificados PCI DSS; não armazenamos dados de cartão).
            </li>
            <li>
              Conteúdo de comunicações: mensagens enviadas pela plataforma no
              contexto de suporte técnico.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.2 Dados de uso
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Endereço IP, tipo de navegador, sistema operacional, páginas
              visitadas, data e hora de acesso.
            </li>
            <li>
              Métricas de uso do serviço: número de conversas, mensagens
              processadas, agentes configurados.
            </li>
            <li>Registros de atividade (logs) para segurança e diagnóstico.</li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.3 Dados de clientes finais (end-users)
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Número de telefone do WhatsApp, nome de perfil e conteúdo das
              mensagens enviadas ao negócio do cliente.
            </li>
            <li>
              Esses dados são tratados em nome do cliente (controlador, nos
              termos da LGPD), e a Parallly atua como operadora do tratamento
              conforme os acordos de tratamento de dados aplicáveis.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.4 Cookies e tecnologias similares
          </h3>
          <p>
            Utilizamos cookies essenciais para o funcionamento da plataforma,
            cookies analíticos para melhorar a experiência do usuário e
            cookies de preferências. Consulte a seção 9 desta política para
            mais detalhes.
          </p>
        </section>

        {/* 2 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            2. Como usamos suas informações
          </h2>
          <p className="mb-4">
            Utilizamos as informações coletadas para as seguintes
            finalidades:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Fornecer, manter e melhorar nossos serviços de automação
              conversacional com IA.
            </li>
            <li>
              Processar pagamentos e administrar sua conta e assinatura.
            </li>
            <li>
              Enviar comunicações transacionais (confirmações, notificações
              de serviço, alertas de segurança).
            </li>
            <li>
              Enviar comunicações comerciais sobre atualizações e novas
              funcionalidades (com seu consentimento prévio).
            </li>
            <li>
              Analisar padrões de uso para otimizar o desempenho da plataforma
              e a experiência do usuário.
            </li>
            <li>
              Treinar e melhorar modelos de IA internos (os dados são
              anonimizados e agregados; dados pessoais identificáveis nunca
              são utilizados para treinamento sem consentimento explícito).
              <strong className="text-text-primary">
                {" "}Esta finalidade NÃO se aplica a dados obtidos por meio
                de APIs do Google Workspace (incluindo Google Calendar).
              </strong>{" "}
              Esses dados são regidos exclusivamente pela seção 12 (Limited
              Use) desta política.
            </li>
            <li>
              Cumprir obrigações legais, resolver disputas e fazer cumprir
              nossos contratos.
            </li>
            <li>
              Prevenir fraudes, atividades ilegais e proteger a segurança da
              plataforma.
            </li>
          </ul>
        </section>

        {/* 3 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            3. Base legal para o tratamento
          </h2>
          <p className="mb-4">
            Conforme a LGPD (Art. 7º e 11), o GDPR (Art. 6) e normas
            equivalentes, tratamos dados pessoais com base nas seguintes
            hipóteses legais:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Execução de contrato:
              </strong>{" "}
              o tratamento é necessário para a prestação do serviço contratado
              (criação de conta, processamento de mensagens, faturamento).
            </li>
            <li>
              <strong className="text-text-primary">
                Consentimento:
              </strong>{" "}
              para comunicações comerciais, cookies não essenciais e
              tratamento de dados para finalidades analíticas avançadas.
            </li>
            <li>
              <strong className="text-text-primary">
                Legítimo interesse:
              </strong>{" "}
              para a segurança da plataforma, prevenção de fraudes, melhoria
              do serviço e análise de uso agregado.
            </li>
            <li>
              <strong className="text-text-primary">
                Cumprimento de obrigação legal:
              </strong>{" "}
              para atender exigências fiscais, contábeis e regulatórias
              aplicáveis.
            </li>
          </ul>
          <p className="mt-4">
            Para a LGPD (Brasil), além das bases acima, baseamo-nos no
            legítimo interesse do controlador e na proteção do crédito quando
            cabível.
          </p>
          <p className="mt-2">
            Para a Lei 1581 de 2012 (Colômbia), o tratamento é realizado
            conforme a autorização concedida pelo titular dos dados.
          </p>
        </section>

        {/* 4 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            4. Compartilhamento de dados com terceiros
          </h2>
          <p className="mb-4">
            Não vendemos dados pessoais. Compartilhamos informações apenas nos
            seguintes casos:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Meta / WhatsApp Business API:
              </strong>{" "}
              as mensagens são transmitidas pela API WhatsApp Cloud da Meta.
              A Meta atua como operadora independente conforme suas próprias
              políticas de privacidade.
            </li>
            <li>
              <strong className="text-text-primary">
                Provedores de modelos de IA:
              </strong>{" "}
              OpenAI, Anthropic, Google e outros provedores de modelos de
              linguagem processam o conteúdo das conversas para gerar
              respostas. Os dados são enviados de forma segura via API e
              estão sujeitos aos acordos de tratamento de dados de cada
              provedor.
            </li>
            <li>
              <strong className="text-text-primary">
                Provedores de infraestrutura:
              </strong>{" "}
              serviços de hospedagem, banco de dados e CDN necessários para
              operar a plataforma.
            </li>
            <li>
              <strong className="text-text-primary">
                Processadores de pagamento:
              </strong>{" "}
              para gerenciar transações de forma segura (certificação PCI
              DSS).
            </li>
            <li>
              <strong className="text-text-primary">
                Autoridades competentes:
              </strong>{" "}
              quando exigido por lei, ordem judicial ou processo legal
              válido.
            </li>
          </ul>
          <p className="mt-4">
            Todos os terceiros estão sujeitos a acordos de tratamento de
            dados (DPA) que garantem níveis adequados de proteção.
          </p>
        </section>

        {/* 5 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            5. Transferências internacionais de dados
          </h2>
          <p className="mb-4">
            Como operamos globalmente e usamos provedores de serviços com
            infraestrutura distribuída, seus dados podem ser transferidos e
            tratados em países fora da sua jurisdição, incluindo Estados
            Unidos e União Europeia.
          </p>
          <p className="mb-4">
            Para garantir a proteção adequada dos dados transferidos
            internacionalmente, implementamos as seguintes salvaguardas:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Cláusulas Contratuais Padrão (SCC) aprovadas pela Comissão
              Europeia.
            </li>
            <li>
              Avaliações de impacto da transferência (TIA) quando aplicável.
            </li>
            <li>
              Contratos com provedores que incluem compromissos de proteção
              de dados equivalentes ao GDPR e à LGPD.
            </li>
            <li>
              Para a Colômbia: autorização do titular conforme o artigo 26
              do Decreto 1377 de 2013.
            </li>
            <li>
              Para o Brasil: cumprimento do artigo 33 da LGPD para
              transferências internacionais.
            </li>
          </ul>
        </section>

        {/* 6 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            6. Segurança dos dados
          </h2>
          <p className="mb-4">
            Implementamos medidas técnicas e organizacionais para proteger
            seus dados pessoais:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Criptografia AES-256-GCM:
              </strong>{" "}
              os tokens de acesso e dados sensíveis são criptografados em
              repouso utilizando AES-256-GCM.
            </li>
            <li>
              <strong className="text-text-primary">
                Isolamento multi-tenant:
              </strong>{" "}
              cada cliente opera em um schema de banco de dados isolado
              (schema-per-tenant), garantindo a separação lógica de dados
              entre organizações.
            </li>
            <li>
              <strong className="text-text-primary">
                Criptografia em trânsito:
              </strong>{" "}
              todas as comunicações utilizam TLS 1.2+ (HTTPS).
            </li>
            <li>
              <strong className="text-text-primary">
                Autenticação segura:
              </strong>{" "}
              JWT com expiração configurável e controle de acesso baseado em
              papéis (RBAC).
            </li>
            <li>
              <strong className="text-text-primary">
                Monitoramento contínuo:
              </strong>{" "}
              registro de eventos de segurança, detecção de anomalias e
              resposta a incidentes.
            </li>
            <li>
              <strong className="text-text-primary">
                Cópias de segurança:
              </strong>{" "}
              backups criptografados com retenção configurável.
            </li>
          </ul>
        </section>

        {/* 7 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            7. Retenção de dados
          </h2>
          <p className="mb-4">
            Conservamos os dados pessoais somente pelo tempo necessário para
            cumprir as finalidades descritas nesta política:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Dados de conta:</strong>{" "}
              durante a vigência da relação contratual e até 30 dias após o
              encerramento, salvo obrigação legal de retenção maior.
            </li>
            <li>
              <strong className="text-text-primary">
                Dados de conversas:
              </strong>{" "}
              de acordo com a configuração do cliente, com máximo de 24 meses
              a partir da criação.
            </li>
            <li>
              <strong className="text-text-primary">
                Dados de faturamento:
              </strong>{" "}
              durante o período exigido pela legislação tributária aplicável
              (mínimo de 5 anos na Colômbia).
            </li>
            <li>
              <strong className="text-text-primary">
                Logs de segurança:
              </strong>{" "}
              até 12 meses para fins de segurança e diagnóstico.
            </li>
            <li>
              <strong className="text-text-primary">Dados anonimizados:</strong>{" "}
              dados agregados e anonimizados podem ser retidos
              indefinidamente para fins analíticos.
            </li>
          </ul>
        </section>

        {/* 8 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            8. Seus direitos
          </h2>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.1 Direitos sob o GDPR (União Europeia / EEE)
          </h3>
          <p className="mb-3">
            Se você é residente do Espaço Econômico Europeu, possui os
            seguintes direitos:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Acesso:</strong> solicitar
              uma cópia dos seus dados pessoais.
            </li>
            <li>
              <strong className="text-text-primary">Retificação:</strong>{" "}
              corrigir dados inexatos ou incompletos.
            </li>
            <li>
              <strong className="text-text-primary">Eliminação:</strong>{" "}
              solicitar a exclusão dos seus dados (&quot;direito ao
              esquecimento&quot;).
            </li>
            <li>
              <strong className="text-text-primary">Portabilidade:</strong>{" "}
              receber seus dados em formato estruturado e de leitura
              automática.
            </li>
            <li>
              <strong className="text-text-primary">Oposição:</strong>{" "}
              opor-se ao tratamento baseado em legítimo interesse.
            </li>
            <li>
              <strong className="text-text-primary">
                Limitação do tratamento:
              </strong>{" "}
              restringir o processamento em determinadas circunstâncias.
            </li>
            <li>
              <strong className="text-text-primary">
                Retirar consentimento:
              </strong>{" "}
              a qualquer momento, sem afetar a licitude do tratamento
              anterior.
            </li>
            <li>
              <strong className="text-text-primary">
                Reclamação à autoridade:
              </strong>{" "}
              apresentar queixa à sua autoridade de proteção de dados.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.2 Direitos sob a CCPA (Califórnia, EUA)
          </h3>
          <p className="mb-3">
            Se você é residente da Califórnia, possui os seguintes direitos:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Direito de saber:</strong>{" "}
              solicitar informações sobre as categorias e itens específicos
              de dados pessoais coletados.
            </li>
            <li>
              <strong className="text-text-primary">
                Direito de eliminar:
              </strong>{" "}
              solicitar a exclusão dos seus dados pessoais.
            </li>
            <li>
              <strong className="text-text-primary">
                Direito de opt-out:
              </strong>{" "}
              não vendemos dados pessoais. Caso isso mude, forneceremos um
              mecanismo de opt-out conforme a CCPA.
            </li>
            <li>
              <strong className="text-text-primary">
                Não discriminação:
              </strong>{" "}
              não discriminamos os usuários que exercem seus direitos sob a
              CCPA.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.3 Direitos sob a Lei 1581 de 2012 (Colômbia)
          </h3>
          <p className="mb-3">
            Como titular de dados pessoais na Colômbia, você tem direito a:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Conhecer, atualizar e retificar seus dados pessoais.
            </li>
            <li>
              Solicitar prova da autorização concedida para o tratamento.
            </li>
            <li>
              Ser informado sobre o uso dado aos seus dados.
            </li>
            <li>
              Apresentar reclamações à Superintendência de Indústria e
              Comércio (SIC) por violações da lei.
            </li>
            <li>
              Revogar a autorização e/ou solicitar a exclusão dos seus dados
              quando os princípios, direitos e garantias constitucionais e
              legais não forem respeitados.
            </li>
            <li>
              Acessar gratuitamente seus dados pessoais objeto de tratamento.
            </li>
          </ul>
          <p className="mt-3">
            Para exercer esses direitos, consulte nossa{" "}
            <Link
              href="/data-policy"
              className="text-accent hover:underline"
            >
              Política de Tratamento de Dados Pessoais
            </Link>
            .
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.4 Direitos sob a LGPD (Brasil)
          </h3>
          <p className="mb-3">
            Se você é titular de dados no Brasil, conforme o artigo 18 da
            LGPD, você tem direito a:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Confirmação da existência de tratamento dos seus dados.
            </li>
            <li>Acesso aos seus dados pessoais.</li>
            <li>
              Correção de dados incompletos, inexatos ou desatualizados.
            </li>
            <li>
              Anonimização, bloqueio ou eliminação de dados desnecessários,
              excessivos ou tratados em desconformidade com a LGPD.
            </li>
            <li>
              Portabilidade dos dados a outro fornecedor de serviços.
            </li>
            <li>
              Eliminação dos dados pessoais tratados com base no
              consentimento.
            </li>
            <li>
              Informações sobre as entidades públicas e privadas com as quais
              os dados foram compartilhados.
            </li>
            <li>
              Revogação do consentimento a qualquer momento.
            </li>
          </ul>
          <p className="mt-3">
            Você também pode apresentar reclamação à Autoridade Nacional de
            Proteção de Dados (ANPD).
          </p>
        </section>

        {/* 9 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            9. Cookies e tecnologias similares
          </h2>
          <p className="mb-4">
            Utilizamos as seguintes categorias de cookies:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Cookies essenciais:
              </strong>{" "}
              necessários para o funcionamento do serviço (autenticação,
              segurança, preferências de sessão). Não podem ser desativados.
            </li>
            <li>
              <strong className="text-text-primary">
                Cookies analíticos:
              </strong>{" "}
              ajudam-nos a entender como você interage com a plataforma para
              melhorar a experiência. Podem ser desativados.
            </li>
            <li>
              <strong className="text-text-primary">
                Cookies de preferências:
              </strong>{" "}
              lembram suas configurações (idioma, fuso horário). Podem ser
              desativados.
            </li>
          </ul>
          <p className="mt-4">
            Você pode gerenciar suas preferências de cookies nas
            configurações do navegador. Note que desativar determinados
            cookies pode afetar a funcionalidade do serviço.
          </p>
        </section>

        {/* 10 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            10. Menores de idade
          </h2>
          <p>
            A Parallly não é direcionada a menores de 18 anos. Não coletamos
            intencionalmente dados pessoais de menores. Se tomarmos
            conhecimento de que coletamos dados de um menor sem o
            consentimento verificável dos pais ou responsável legal,
            tomaremos medidas para excluir tais informações dos nossos
            sistemas. Se você acredita que possamos ter coletado informações
            de um menor, entre em contato em{" "}
            <a
              href="mailto:cloud.manager@parallext.com"
              className="text-accent hover:underline"
            >
              cloud.manager@parallext.com
            </a>
            .
          </p>
        </section>

        {/* 11 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            11. Alterações nesta política
          </h2>
          <p>
            Reservamo-nos o direito de atualizar esta Política de Privacidade
            a qualquer momento. Notificaremos as alterações significativas por
            meio de aviso na plataforma ou por e-mail com pelo menos 30 dias
            de antecedência da entrada em vigor. O uso continuado do serviço
            após a data de vigência constitui aceitação da política
            atualizada.
          </p>
        </section>

        {/* 12 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            12. Serviços do Google e cumprimento da Google API Services User
            Data Policy
          </h2>
          <p className="mb-4">
            A Parallly se integra com serviços do Google (Google Sign-In e
            Google Calendar) por meio de OAuth 2.0. Esta seção descreve
            especificamente como tratamos os dados obtidos pelas APIs do
            Google e nosso compromisso com as restrições de uso limitado
            (&quot;Limited Use&quot;).
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.1 Escopos (scopes) do Google que solicitamos
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                openid, email, profile
              </strong>{" "}
              — utilizados apenas quando você faz login com o Google.
              Permitem-nos autenticá-lo, exibir seu nome e foto de perfil
              dentro da aplicação e vincular sua conta Google ao seu usuário
              Parallly.
            </li>
            <li>
              <strong className="text-text-primary">
                https://www.googleapis.com/auth/calendar
              </strong>{" "}
              — solicitado apenas se você conectar o Google Calendar como
              provedor de agendamentos. Usamos exclusivamente para criar,
              atualizar, mover e cancelar eventos de calendário associados aos
              agendamentos que você gerencia dentro da Parallly, e para
              verificar disponibilidade ao agendar.
            </li>
          </ul>
          <p className="mt-3">
            Não solicitamos nem acessamos Gmail, Drive, Contacts ou qualquer
            outro serviço do Google fora dos listados acima.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.2 Como usamos os dados do Google
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Os dados de perfil (nome, e-mail, foto) são usados apenas para
              autenticação, identificação dentro da aplicação e vinculação de
              conta.
            </li>
            <li>
              Os dados do Google Calendar são usados apenas para criar,
              modificar, ler disponibilidade e excluir eventos diretamente
              relacionados aos agendamentos que o usuário gerencia na
              Parallly.
            </li>
            <li>
              Armazenamos o refresh token do Google criptografado com
              AES-256-GCM e o e-mail da conta conectada. Não armazenamos
              cópias dos eventos do calendário fora do contexto operacional
              necessário para exibir o status do agendamento.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.3 Declaração de Limited Use
          </h3>
          <p className="mb-4">
            <em>
              The use of raw or derived user data received from Workspace APIs
              will adhere to the Google User Data Policy, including the
              Limited Use requirements.
            </em>
          </p>
          <p className="mb-4">
            Em consequência, comprometemo-nos que os dados obtidos das APIs
            do Google Workspace:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Não são usados para exibir publicidade
              </strong>{" "}
              — nem na Parallly nem em qualquer sistema externo.
            </li>
            <li>
              <strong className="text-text-primary">
                Não são vendidos, cedidos nem transferidos
              </strong>{" "}
              a terceiros para fins publicitários, de marketing, geração de
              leads ou criação de bases de dados.
            </li>
            <li>
              <strong className="text-text-primary">
                Não são usados para treinar modelos de inteligência artificial
              </strong>{" "}
              — nem próprios nem de terceiros (OpenAI, Anthropic, Google AI,
              DeepSeek, xAI ou qualquer outro). Os dados de calendário e
              perfil do Google nunca são enviados a provedores de modelos
              LLM.
            </li>
            <li>
              <strong className="text-text-primary">
                Não são lidos por pessoas
              </strong>{" "}
              salvo nos casos expressamente permitidos pelo Google: (a) com
              seu consentimento explícito, (b) para fins de segurança
              (investigação de abuso ou violação), (c) para cumprir a lei
              aplicável, ou (d) quando os dados forem agregados e
              anonimizados de forma irreversível e usados apenas para fins
              internos de operação.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.4 Revogação de acesso
          </h3>
          <p>
            Você pode revogar o acesso da Parallly à sua conta Google a
            qualquer momento pelo seu{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              painel de permissões do Google
            </a>
            , ou pela seção configurações &gt; integrações dentro da
            Parallly. Ao revogar o acesso, excluímos o refresh token
            criptografado e desativamos a integração. Para solicitar a
            exclusão completa dos dados associados, escreva para{" "}
            <a
              href="mailto:cloud.manager@parallext.com"
              className="text-accent hover:underline"
            >
              cloud.manager@parallext.com
            </a>
            .
          </p>
        </section>

        {/* 13 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            13. Contato
          </h2>
          <p className="mb-4">
            Para exercer qualquer um dos seus direitos ou para consultas
            relacionadas a esta política, você pode entrar em contato
            conosco por:
          </p>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">Controlador:</strong>{" "}
              Automation AI S.A.S
            </p>
            <p>
              <strong className="text-text-primary">NIT:</strong> 902032943-1
            </p>
            <p>
              <strong className="text-text-primary">
                Encarregado de Proteção de Dados (DPO):
              </strong>{" "}
              Andres Felipe Matallana
            </p>
            <p>
              <strong className="text-text-primary">E-mail de privacidade:</strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">E-mail de suporte:</strong>{" "}
              <a
                href="mailto:support@parallext.com"
                className="text-accent hover:underline"
              >
                support@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Endereço:</strong> Bogotá,
              Colômbia
            </p>
            <p>
              <strong className="text-text-primary">Site:</strong>{" "}
              <a
                href="https://parallext.com"
                className="text-accent hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                parallext.com
              </a>
            </p>
          </div>
          <p className="mt-6 text-text-muted text-sm">
            Se você considera que o tratamento dos seus dados pessoais
            infringe a regulamentação aplicável, tem o direito de apresentar
            reclamação à autoridade de proteção de dados competente da sua
            jurisdição. No Brasil, a autoridade competente é a ANPD
            (Autoridade Nacional de Proteção de Dados). Na Colômbia, a
            autoridade competente é a Superintendência de Indústria e
            Comércio (SIC).
          </p>
        </section>
      </div>
    </>
  );
}
