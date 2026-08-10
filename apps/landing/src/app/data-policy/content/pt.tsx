import Link from "next/link";

export default function DataPolicyPt() {
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
        Política de Tratamento de Dados Pessoais
      </h1>
      <p className="text-text-muted text-sm mb-4">
        Última atualização: 9 de agosto de 2026
      </p>
      <p className="text-text-muted text-sm mb-12">
        Em conformidade com a Ley Estatutaria 1581 de 2012 (Lei Estatutária
        colombiana de Proteção de Dados), o Decreto Reglamentario 1377 de 2013
        (Decreto regulamentar colombiano) e demais normas concordantes da
        República da Colômbia.
      </p>

      <div className="space-y-12 text-text-secondary leading-relaxed">
        {/* 1 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            1. Responsável pelo tratamento
          </h2>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">Razão social:</strong>{" "}
              Automation AI S.A.S
            </p>
            <p>
              <strong className="text-text-primary">NIT:</strong> 902032943-1
            </p>
            <p>
              <strong className="text-text-primary">Domicílio:</strong> Bogotá,
              D.C., Colômbia
            </p>
            <p>
              <strong className="text-text-primary">E-mail:</strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
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
            <p>
              <strong className="text-text-primary">Produto:</strong> Parallly
              (parallly-chat.cloud)
            </p>
          </div>
          <p className="mt-4">
            A Automation AI S.A.S (doravante, &quot;a Empresa&quot;), na sua
            qualidade de responsável pelo tratamento de dados pessoais, cumpre a
            Ley 1581 de 2012 (Lei colombiana de Proteção de Dados), o Decreto
            1377 de 2013 e demais normas que as complementem, modifiquem ou
            adicionem, mediante a presente Política de Tratamento de Dados
            Pessoais.
          </p>
        </section>

        {/* 2 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            2. Tratamento e finalidades
          </h2>
          <p className="mb-4">
            A Empresa realizará o tratamento de dados pessoais para as
            seguintes finalidades:
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            2.1 Finalidades relacionadas com clientes e usuários
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Gerenciar a relação contratual para a prestação dos serviços da
              plataforma Parallly.
            </li>
            <li>
              Criar e administrar as contas de usuário e organizações
              clientes na plataforma.
            </li>
            <li>
              Processar pagamentos, emitir faturas e administrar o
              faturamento.
            </li>
            <li>
              Prestar suporte técnico e atendimento ao cliente.
            </li>
            <li>
              Enviar comunicações transacionais relacionadas com o serviço
              (confirmações, notificações, alertas de segurança).
            </li>
            <li>
              Enviar comunicações comerciais sobre atualizações, novas
              funcionalidades e promoções, mediante autorização prévia do
              titular.
            </li>
            <li>
              Realizar análises estatísticas e de uso para melhorar a
              plataforma.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            2.2 Finalidades relacionadas com clientes finais (end-users)
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Processar e armazenar mensagens do WhatsApp em nome do cliente
              (responsável) conforme o acordo de processamento de dados.
            </li>
            <li>
              Gerar respostas automatizadas mediante inteligência artificial.
            </li>
            <li>
              Facilitar o escalonamento de conversas para agentes humanos
              quando necessário.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            2.3 Finalidades relacionadas com fornecedores e parceiros
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Gerenciar a relação comercial e contratual com fornecedores.
            </li>
            <li>
              Realizar pagamentos e gestões contábeis e tributárias.
            </li>
          </ul>
        </section>

        {/* 3 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            3. Direitos dos titulares
          </h2>
          <p className="mb-4">
            De acordo com o artigo 8 da Ley 1581 de 2012, os titulares de
            dados pessoais têm os seguintes direitos:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Acesso:</strong> conhecer
              os dados pessoais objeto de tratamento por parte da Empresa.
              Este direito poderá ser exercido gratuitamente pelo menos uma
              vez por mês calendário.
            </li>
            <li>
              <strong className="text-text-primary">Atualização:</strong>{" "}
              solicitar a atualização dos dados pessoais quando estes sejam
              parciais, inexatos, incompletos, fracionados ou induzam a erro.
            </li>
            <li>
              <strong className="text-text-primary">Retificação:</strong>{" "}
              solicitar a correção de dados pessoais que sejam errôneos.
            </li>
            <li>
              <strong className="text-text-primary">Supressão:</strong>{" "}
              solicitar a eliminação dos dados pessoais quando: (a) não sejam
              necessários para as finalidades autorizadas, (b) tenha sido
              revogada a autorização, ou (c) tenha sido superado o período de
              tratamento. Este direito não procede quando exista um dever
              legal ou contratual de permanecer na base de dados.
            </li>
            <li>
              <strong className="text-text-primary">
                Revogação da autorização:
              </strong>{" "}
              revogar a autorização concedida para o tratamento de dados
              pessoais, total ou parcialmente.
            </li>
            <li>
              <strong className="text-text-primary">
                Prova da autorização:
              </strong>{" "}
              solicitar prova da autorização concedida, salvo quando a lei
              não exija autorização.
            </li>
            <li>
              <strong className="text-text-primary">Informação:</strong> ser
              informado sobre o uso que foi dado aos seus dados pessoais.
            </li>
            <li>
              <strong className="text-text-primary">
                Reclamação perante a SIC:
              </strong>{" "}
              apresentar reclamações perante a Superintendencia de Industria y
              Comercio por infrações à Ley 1581 de 2012 e suas normas
              complementares.
            </li>
          </ul>
        </section>

        {/* 4 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            4. Autorização do titular
          </h2>
          <p className="mb-4">
            A Empresa obterá a autorização prévia e informada do titular para
            o tratamento de seus dados pessoais, a qual poderá ser concedida
            mediante:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Documento físico ou eletrônico assinado.</li>
            <li>
              Aceitação de termos e condições no momento do registro na
              plataforma (checkbox ou mecanismo equivalente).
            </li>
            <li>
              Conduta inequívoca do titular que permita concluir que outorgou
              autorização (por exemplo, enviar dados voluntariamente através
              de formulários).
            </li>
            <li>
              Qualquer outro mecanismo que garanta a consulta posterior da
              autorização.
            </li>
          </ul>
          <p className="mt-4">
            A autorização não será necessária quando se trate de: (a) dados
            requeridos por uma entidade pública no exercício de suas funções,
            (b) dados de natureza pública, (c) casos de urgência médica ou
            sanitária, ou (d) tratamento autorizado por lei.
          </p>
        </section>

        {/* 5 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            5. Pessoas autorizadas para o tratamento
          </h2>
          <p className="mb-4">
            Os dados pessoais poderão ser tratados por:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Automation AI S.A.S:
              </strong>{" "}
              como responsável pelo tratamento.
            </li>
            <li>
              <strong className="text-text-primary">
                Funcionários e contratados:
              </strong>{" "}
              da área técnica e de suporte, que requeiram acesso para o
              cumprimento de suas funções, sujeitos a acordos de
              confidencialidade.
            </li>
            <li>
              <strong className="text-text-primary">
                Operadores do tratamento:
              </strong>{" "}
              terceiros prestadores de serviços que atuem por conta e sob as
              instruções da Empresa, conforme contratos de transmissão de
              dados que garantam a proteção adequada. Estes incluem:
              fornecedores de hospedagem e infraestrutura, fornecedores de
              modelos de IA (OpenAI, Anthropic, Google), Meta/WhatsApp
              Business API, processadores de pagamento, Sentry para diagnóstico
              de crashes e desempenho, e Expo junto com o Google Firebase Cloud
              Messaging (FCM) para notificações push móveis.
            </li>
          </ul>
        </section>

        {/* 6 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            6. Procedimento para exercer direitos
          </h2>
          <p className="mb-4">
            Os titulares poderão exercer seus direitos mediante solicitação
            dirigida à Empresa através dos seguintes canais:
          </p>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3 mb-6">
            <p>
              <strong className="text-text-primary">E-mail:</strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Assunto do e-mail:</strong>{" "}
              &quot;Exercício de direitos — Dados Pessoais&quot;
            </p>
          </div>

          <p className="mb-4">
            A solicitação deverá conter no mínimo:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Nome completo e documento de identificação do titular.
            </li>
            <li>
              Descrição clara e precisa dos fatos e do direito que deseja
              exercer.
            </li>
            <li>
              Endereço físico e/ou eletrônico para receber a resposta.
            </li>
            <li>
              Documentos que sustentem a solicitação, se aplicável.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            Tempos de resposta
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Consultas:</strong> a
              Empresa responderá em um prazo máximo de dez (10) dias úteis
              contados a partir da data de recebimento da solicitação.
            </li>
            <li>
              <strong className="text-text-primary">Reclamações:</strong> a
              Empresa responderá em um prazo máximo de quinze (15) dias úteis
              contados a partir da data de recebimento da reclamação.
            </li>
            <li>
              Caso não seja possível atender à consulta ou reclamação dentro
              dos prazos indicados, será informado ao titular os motivos do
              atraso e a data em que será atendida, a qual não poderá superar
              cinco (5) dias úteis adicionais para consultas e oito (8) dias
              úteis adicionais para reclamações.
            </li>
          </ul>
        </section>

        {/* 7 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            7. Área responsável pelo atendimento de petições, consultas e
            reclamações
          </h2>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">
                Encarregado de Proteção de Dados (DPO):
              </strong>{" "}
              Andres Felipe Matallana
            </p>
            <p>
              <strong className="text-text-primary">E-mail:</strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Endereço:</strong> Bogotá,
              D.C., Colômbia
            </p>
          </div>
          <p className="mt-4">
            O Encarregado de Proteção de Dados é o responsável por dar
            andamento às solicitações dos titulares para fazer efetivos seus
            direitos, bem como zelar pelo cumprimento da presente política e
            da normativa vigente em matéria de proteção de dados pessoais.
          </p>
        </section>

        {/* 8 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            8. Vigência das bases de dados
          </h2>
          <p className="mb-4">
            As bases de dados administradas pela Empresa terão vigência
            enquanto se mantenha a finalidade do tratamento e exista a
            necessidade de conservar os dados. Especificamente:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Base de dados de clientes:
              </strong>{" "}
              durante a vigência da relação contratual. No cancelamento
              ordinário, o acesso pode continuar até o fim do período contratado.
              Quando o offboarding é executado, o acesso e os canais são
              desativados; a partir daí, os dados operacionais podem ser
              conservados por até noventa (90) dias para exportação, suporte ou
              reativação antes da purga.
            </li>
            <li>
              <strong className="text-text-primary">
                Base de dados de faturamento:
              </strong>{" "}
              durante o período exigido pela legislação tributária colombiana
              (mínimo cinco anos conforme o Estatuto Tributario / Estatuto
              Tributário colombiano).
            </li>
            <li>
              <strong className="text-text-primary">
                Base de dados de conversas:
              </strong>{" "}
              de acordo com a configuração do cliente, com um máximo de vinte
              e quatro (24) meses desde a sua criação.
            </li>
            <li>
              <strong className="text-text-primary">
                Registros de segurança:
              </strong>{" "}
              até doze (12) meses para fins de segurança da informação e
              diagnóstico.
            </li>
          </ul>
          <p className="mt-4">
            Uma solicitação verificada de exclusão da conta e dos dados é
            distinta do cancelamento ordinário. Após verificar a identidade e o
            escopo, a Empresa inicia uma purga segura sem demora indevida, sem
            prometer que ela seja automática ou instantânea. Registros sujeitos
            a retenção fiscal, legal, de segurança ou de prevenção a fraudes são
            isolados pelo prazo aplicável. Cópias residuais em backups
            criptografados ficam indisponíveis para uso ordinário e expiram
            conforme o ciclo normal de retenção dos backups.
          </p>
        </section>

        {/* 9 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            9. Transferência e transmissão de dados
          </h2>
          <p className="mb-4">
            A Empresa poderá realizar transferências e transmissões de dados
            pessoais a terceiros, tanto a nível nacional como internacional,
            conforme previsto nos artigos 25 e 26 do Decreto 1377 de 2013:
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            9.1 Transmissão (Operadores do tratamento)
          </h3>
          <p className="mb-3">
            Realiza-se a transmissão de dados aos seguintes operadores:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Fornecedores de infraestrutura:
              </strong>{" "}
              para a hospedagem e operação da plataforma.
            </li>
            <li>
              <strong className="text-text-primary">
                Meta Platforms (WhatsApp Business API):
              </strong>{" "}
              para a transmissão de mensagens do WhatsApp.
            </li>
            <li>
              <strong className="text-text-primary">
                Fornecedores de modelos de IA:
              </strong>{" "}
              OpenAI, Anthropic e Google para o processamento de respostas
              automáticas.
            </li>
            <li>
              <strong className="text-text-primary">Sentry:</strong>{" "}
              para receber eventos técnicos minimizados e diagnosticar crashes,
              erros e desempenho. Os eventos são conservados apenas durante o
              período configurado no projeto Sentry do Parallly e enquanto
              forem necessários para diagnóstico.
            </li>
            <li>
              <strong className="text-text-primary">
                Expo e Google Firebase Cloud Messaging (FCM):
              </strong>{" "}
              para entregar notificações móveis por meio de tokens push,
              identificadores de instalação/app e o payload do alerta. A Expo
              mantém o conteúdo somente durante a entrega e elimina os recibos
              após 24 horas; o FCM pode manter mensagens não entregues por até
              quatro semanas e, quando a exclusão de um identificador de
              instalação é solicitada, o Google informa que o remove dos
              sistemas ativos e backups em até 180 dias. Os tokens armazenados
              pelo Parallly são excluídos quando ficam inválidos ou durante a
              purga verificada.
            </li>
            <li>
              <strong className="text-text-primary">
                Processadores de pagamento:
              </strong>{" "}
              para a gestão de transações financeiras.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            9.2 Transferência internacional
          </h3>
          <p>
            Dado que alguns operadores do tratamento têm sede no exterior
            (Estados Unidos, União Europeia), a Empresa garante que tais
            transferências são realizadas conforme as disposições legais
            aplicáveis, verificando que os países de destino contem com níveis
            adequados de proteção de dados ou, em sua falta, subscrevendo
            cláusulas contratuais que garantam a proteção dos dados pessoais
            transferidos, conforme o artigo 26 da Ley 1581 de 2012.
          </p>
        </section>

        {/* 10 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            10. Medidas de segurança
          </h2>
          <p className="mb-4">
            A Empresa adotou as seguintes medidas técnicas, administrativas e
            humanas para proteger os dados pessoais contra acesso não
            autorizado, uso indevido, alteração, perda ou destruição:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Criptografia AES-256-GCM:
              </strong>{" "}
              para tokens de acesso e dados sensíveis armazenados em repouso.
            </li>
            <li>
              <strong className="text-text-primary">
                Criptografia em trânsito:
              </strong>{" "}
              todas as comunicações são realizadas mediante TLS 1.2+ (HTTPS).
            </li>
            <li>
              <strong className="text-text-primary">
                Isolamento por empresa:
              </strong>{" "}
              cada organização cliente opera em um esquema de banco de dados
              PostgreSQL isolado (um esquema por empresa), garantindo que os dados
              de cada cliente estejam logicamente separados.
            </li>
            <li>
              <strong className="text-text-primary">
                Controle de acesso baseado em funções (RBAC):
              </strong>{" "}
              com quatro níveis de acesso (super_admin, tenant_admin,
              tenant_supervisor, tenant_agent).
            </li>
            <li>
              <strong className="text-text-primary">
                Autenticação JWT:
              </strong>{" "}
              com tokens de expiração configurável.
            </li>
            <li>
              <strong className="text-text-primary">
                Idempotência de webhooks:
              </strong>{" "}
              mecanismos de deduplicação para evitar processamento duplicado
              de dados.
            </li>
            <li>
              <strong className="text-text-primary">
                Cópias de segurança:
              </strong>{" "}
              backups criptografados com retenção e restauração periódica
              verificada.
            </li>
            <li>
              <strong className="text-text-primary">
                Monitoramento e auditoria:
              </strong>{" "}
              registro de eventos de segurança e acesso para detecção de
              anomalias.
            </li>
            <li>
              <strong className="text-text-primary">
                Acordos de confidencialidade:
              </strong>{" "}
              todos os funcionários e contratados com acesso a dados pessoais
              estão sujeitos a cláusulas de confidencialidade.
            </li>
          </ul>
        </section>

        {/* 11 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            11. Cookies
          </h2>
          <p className="mb-4">
            A plataforma Parallly utiliza cookies e tecnologias similares para
            melhorar a experiência do usuário. As categorias de cookies
            utilizadas são:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Cookies estritamente necessários:
              </strong>{" "}
              requeridos para o funcionamento do serviço (autenticação, sessão,
              segurança).
            </li>
            <li>
              <strong className="text-text-primary">
                Cookies analíticos:
              </strong>{" "}
              para análise de uso e melhoria da plataforma.
            </li>
            <li>
              <strong className="text-text-primary">
                Cookies de preferências:
              </strong>{" "}
              para lembrar configurações do usuário.
            </li>
          </ul>
          <p className="mt-4">
            O usuário pode configurar seu navegador para rejeitar cookies não
            essenciais. A desativação de cookies essenciais pode afetar o
            funcionamento da plataforma. Para mais informações, consulte nossa{" "}
            <Link href="/privacy" className="text-accent hover:underline">
              Política de Privacidade
            </Link>
            .
          </p>
        </section>

        {/* 12 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            12. Modificações a esta política
          </h2>
          <p>
            A Empresa reserva-se o direito de modificar a presente Política de
            Tratamento de Dados Pessoais a qualquer momento. As modificações
            serão publicadas no site da plataforma e notificadas aos titulares
            através dos canais de comunicação disponíveis. As alterações
            entrarão em vigor a partir da data de sua publicação, salvo quando
            indicada uma data posterior. O uso continuado da plataforma após a
            publicação das modificações constituirá a aceitação da política
            atualizada.
          </p>
        </section>

        {/* 13 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            13. Dados de contato da Superintendencia de Industria y Comercio
            (SIC)
          </h2>
          <p className="mb-4">
            Se o titular considerar que seus direitos foram violados ou que a
            Empresa descumpriu a normativa de proteção de dados, poderá
            apresentar uma reclamação perante a Superintendencia de Industria y
            Comercio (autoridade colombiana de proteção de dados):
          </p>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">Entidade:</strong>{" "}
              Superintendencia de Industria y Comercio (SIC)
            </p>
            <p>
              <strong className="text-text-primary">Endereço:</strong> Carrera
              13 No. 27-00, Andares 1 a 7, Bogotá, D.C., Colômbia
            </p>
            <p>
              <strong className="text-text-primary">
                Linha telefônica:
              </strong>{" "}
              (601) 587 0000
            </p>
            <p>
              <strong className="text-text-primary">
                Linha gratuita nacional:
              </strong>{" "}
              01 8000 910 165
            </p>
            <p>
              <strong className="text-text-primary">Site:</strong>{" "}
              <a
                href="https://www.sic.gov.co"
                className="text-accent hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                www.sic.gov.co
              </a>
            </p>
            <p>
              <strong className="text-text-primary">E-mail:</strong>{" "}
              <a
                href="mailto:contactenos@sic.gov.co"
                className="text-accent hover:underline"
              >
                contactenos@sic.gov.co
              </a>
            </p>
          </div>
          <p className="mt-4 text-text-muted text-sm">
            Antes de recorrer à SIC, o titular deverá ter apresentado sua
            solicitação diretamente perante a Empresa e ter esgotado o trâmite
            de consulta ou reclamação, conforme estabelecido nos artigos 14 e
            15 da Ley 1581 de 2012.
          </p>
        </section>
      </div>
    </>
  );
}
