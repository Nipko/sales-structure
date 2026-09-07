const NOTICE:Record<string,string>={
    es:'Tu conversación quedó en la bandeja de atención. Una persona podrá continuar por este chat.',
    en:'Your conversation is in the support inbox. A person can continue with you in this chat.',
    pt:'Sua conversa está na caixa de atendimento. Uma pessoa poderá continuar por este chat.',
    fr:'Votre conversation est dans la boîte de réception du service client. Une personne pourra continuer dans ce chat.',
};
export function widgetHandoffNotice(locale?:string):string{return NOTICE[String(locale||'es').slice(0,2).toLowerCase()]||NOTICE.es;}
