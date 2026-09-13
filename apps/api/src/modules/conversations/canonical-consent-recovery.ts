import { enrollmentTermsHash } from '../education/enrollment-terms';
import { appointmentServiceTermsHash } from '../appointments/appointment-service-terms';

/** Only audited domain outcomes may resume a consent dialogue instead of escalating a failed writer. */
export function isCanonicalConsentRecovery(toolName:string,result:any):boolean {
    if(result?.persisted!==false || result?.requiresConfirmation!==true)return false;
    if(toolName==='enroll_student' && ['cohort_full_waitlist_requires_consent','enrollment_terms_changed_requires_confirmation'].includes(result.error)){
        return !!enrollmentTermsHash(result.enrollmentTerms);
    }
    return toolName==='create_appointment' && result.error==='appointment_terms_changed'
        && !!appointmentServiceTermsHash(result.service?.appointmentTerms);
}

const RECOVERY:Record<string,string>={
    es:'La operación no se realizó y no hubo cobro. Presenta las condiciones actuales y pide una nueva confirmación. Si se ofrece lista de espera, explica que no asigna un cupo y que sólo se asignará automáticamente bajo las mismas condiciones aceptadas. La aceptación anterior no autoriza este cambio.',
    en:'The operation did not happen and no charge was made. Present the current terms and ask for a new confirmation. If offering a waitlist, explain that it does not assign a seat and automatic assignment requires the same accepted terms. The prior acceptance does not authorize this change.',
    pt:'A operação não foi realizada e não houve cobrança. Apresente as condições atuais e peça nova confirmação. Se oferecer lista de espera, explique que não atribui uma vaga e que a atribuição automática exige as mesmas condições aceitas. A aceitação anterior não autoriza esta alteração.',
    fr:'L’opération n’a pas été effectuée et aucun montant n’a été débité. Présentez les conditions actuelles et demandez une nouvelle confirmation. Si une liste d’attente est proposée, expliquez qu’elle n’attribue aucune place et que l’attribution automatique exige les mêmes conditions acceptées. L’accord précédent n’autorise pas ce changement.',
};
export function canonicalConsentRecoveryDirective(result:any,language:string):string {
    const terms=result.enrollmentTerms || result.service?.appointmentTerms || {};
    const {version,courseId,cohortId,serviceId,...displayTerms}=terms;
    return `${RECOVERY[language.slice(0,2)]||RECOVERY.es}\n${JSON.stringify({waitlistAvailable:result.waitlistAvailable===true,terms:displayTerms})}`;
}
