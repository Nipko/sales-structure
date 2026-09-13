/** Engine directives, localized with the same four languages as booking. */
const MESSAGES = {
    es: {
        cancelled: 'Detuve este procedimiento. No cancelé operaciones que ya se hubieran completado.',
        paused: 'Dejé el procedimiento en pausa. Podemos retomarlo cuando me digas que continuemos.',
        invalid: 'Ese dato no tiene el formato esperado. Todavía no lo he guardado.',
        question: 'Responde la pregunta del cliente solo con información verificada disponible. El dato solicitado sigue pendiente: no lo guardes ni afirmes que el procedimiento terminó. Si no conoces el motivo de solicitarlo, dilo sin inventarlo.',
        handoff: 'El cliente solicita ayuda de una persona. El procedimiento no se completó.',
        missionLimit: 'Ya hay varias tareas en pausa. Pregunta cuál desea retomar o cerrar antes de comenzar otra; conserva los datos de las tareas pendientes.',
        missionSelection: 'La solicitud coincide con varias tareas. Pregunta cuál desea retomar primero; conserva los datos pendientes sin ejecutar acciones.',
    },
    en: {
        cancelled: 'I stopped this procedure. Previously completed operations have not been cancelled.',
        paused: 'I paused the procedure. We can resume when you tell me to continue.',
        invalid: 'That value is not in the expected format. I have not saved it yet.',
        question: 'Answer the customer’s question using only available verified information. The requested field remains pending: do not save it or claim the procedure is complete. If the reason for requesting it is unknown, say so without inventing it.',
        handoff: 'The customer is requesting help from a person. The procedure is not complete.',
        missionLimit: 'Several tasks are already paused. Ask which one to resume or close before starting another; preserve the pending tasks and their data.',
        missionSelection: 'The request matches several tasks. Ask which one to resume first; preserve pending data without executing actions.',
    },
    pt: {
        cancelled: 'Interrompi este procedimento. As operações já concluídas não foram canceladas.',
        paused: 'Pausei o procedimento. Podemos retomar quando você me pedir para continuar.',
        invalid: 'Esse dado não está no formato esperado. Ainda não o salvei.',
        question: 'Responda à pergunta do cliente apenas com informações verificadas disponíveis. O dado solicitado continua pendente: não o salve nem afirme que o procedimento terminou. Se não souber o motivo da solicitação, diga isso sem inventá-lo.',
        handoff: 'O cliente solicita ajuda de uma pessoa. O procedimento não foi concluído.',
        missionLimit: 'Já há várias tarefas em pausa. Pergunte qual deseja retomar ou encerrar antes de iniciar outra; preserve os dados das tarefas pendentes.',
        missionSelection: 'A solicitação corresponde a várias tarefas. Pergunte qual deseja retomar primeiro; preserve os dados pendentes sem executar ações.',
    },
    fr: {
        cancelled: 'J’ai arrêté cette procédure. Les opérations déjà effectuées n’ont pas été annulées.',
        paused: 'J’ai mis la procédure en pause. Nous pourrons la reprendre quand vous me demanderez de continuer.',
        invalid: 'Cette donnée n’a pas le format attendu. Je ne l’ai pas encore enregistrée.',
        question: 'Répondez à la question du client uniquement avec les informations vérifiées disponibles. La donnée demandée reste en attente : ne l’enregistrez pas et ne prétendez pas que la procédure est terminée. Si la raison de la demande est inconnue, dites-le sans l’inventer.',
        handoff: 'Le client demande l’aide d’une personne. La procédure n’est pas terminée.',
        missionLimit: 'Plusieurs tâches sont déjà en pause. Demandez laquelle reprendre ou terminer avant d’en commencer une autre ; conservez les données des tâches en attente.',
        missionSelection: 'La demande correspond à plusieurs tâches. Demandez laquelle reprendre en premier ; conservez les données en attente sans effectuer d’actions.',
    },
} as const;

export function procedureDialogueMessages(language = 'es'): typeof MESSAGES[keyof typeof MESSAGES] {
    return MESSAGES[language.split(/[-_]/)[0] as keyof typeof MESSAGES] ?? MESSAGES.es;
}
