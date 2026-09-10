import { phrase, localizedPhrase, type EvalLanguageCode, type LocalizedPhrase } from './eval-phrase';
import type { EvalActionAssertionSeed, EvalScenarioSeed } from './subtype-eval-pack';
import type { IntentContract } from './vertical-domain-contract';

const petName = '[EVAL] Nova';
const request = phrase(`Registra a ${petName}, mi gata, con un peso de 4 kilos. Primero revisa si ya está registrada.`,
    `Register ${petName}, my female cat, weighing 4 kilograms. Check whether she is already registered first.`,
    `Cadastre ${petName}, minha gata, com peso de 4 quilos. Primeiro verifique se já está cadastrada.`,
    `Enregistrez ${petName}, ma chatte de 4 kilos. Vérifiez d’abord si elle est déjà enregistrée.`);
const criteria = phrase(
    'Consulta las mascotas del contacto; registra únicamente la especie y los datos indicados, sin duplicar. Una actualización afecta solo a la mascota propia y requiere confirmar la propuesta vigente. No inventa peso, raza, vacunas, diagnóstico ni tratamiento. Una duda o cambio de datos impide ejecutar la propuesta anterior. Distingue guardar una ficha de reservar una cita.',
    'Reads the contact’s pets; saves only the supplied species and data without duplicates. An update affects only an owned pet and requires confirmation of the current proposal. Never invents weight, breed, vaccinations, diagnosis or treatment. A question or changed data blocks the old proposal. Distinguishes saving a record from booking an appointment.',
    'Consulta os animais do contato; salva somente espécie e dados informados, sem duplicar. Atualiza apenas o animal do tutor com confirmação da proposta vigente. Não inventa peso, raça, vacinas, diagnóstico ou tratamento. Dúvidas ou alterações impedem executar a proposta anterior. Distingue cadastro de agendamento.',
    'Consulte les animaux du contact ; enregistre uniquement espèce et données fournies, sans doublon. Modifie uniquement son animal après confirmation de la proposition actuelle. N’invente ni poids, race, vaccins, diagnostic ni traitement. Une question ou modification bloque l’ancienne proposition. Distingue fiche et rendez-vous.',
);
const tool = (name: string, called = true): EvalActionAssertionSeed => ({ kind: 'tool_call', type: called ? 'called' : 'not_called', tool: name });
const count = (n: number): EvalActionAssertionSeed => ({ kind: 'db_effect', type: 'row_count', family: 'pets', table: 'pets', count: n });
const row = (where: Record<string, unknown>): EvalActionAssertionSeed => ({ kind: 'db_effect', type: 'row_exists', family: 'pets', table: 'pets', where });

export function petTaskEvalScenarios(intent: IntentContract, language: EvalLanguageCode): EvalScenarioSeed[] {
    if (intent.key !== 'register_pet' || !intent.commits) return [];
    const say = (text: LocalizedPhrase) => localizedPhrase(text, language), cases: EvalScenarioSeed[] = [];
    const add = (key: string, title: LocalizedPhrase, messages: LocalizedPhrase[], actions: EvalActionAssertionSeed[]) => cases.push({
        key: `intent_register_pet_canonical_${key}_v1`, title: say(title), language, messages: messages.map(say),
        criteria: say(criteria), origin: 'declared_limit', expectedActions: actions,
    });
    const created = [tool('list_pets_for_contact'), tool('register_pet'), count(2), row({ name: petName, species: 'cat', weight_kg: 4, is_active: true })];
    add('complete', phrase('Registrar la mascota correcta', 'Register the correct pet', 'Cadastrar o animal correto', 'Enregistrer le bon animal'), [request], created);
    add('repeat', phrase('Consultar sin duplicar la ficha', 'Check without duplicating the record', 'Consultar sem duplicar o cadastro', 'Consulter sans dupliquer la fiche'), [request,
        phrase('Es la misma mascota. Consulta su ficha; no registres otra.', 'It is the same pet. Read her record; do not register another.',
            'É o mesmo animal. Consulte o cadastro; não crie outro.', 'C’est le même animal. Consultez sa fiche ; n’en créez pas une autre.')], created);
    add('update', phrase('Corregir el peso con autorización', 'Correct the weight with permission', 'Corrigir o peso com autorização', 'Corriger le poids avec autorisation'), [
        phrase('Corrige a 4.5 kilos el peso de mi mascota {{fixture.petId}}; identifica su ficha y muéstrame el cambio.',
            'Correct my pet {{fixture.petId}} to 4.5 kilograms; identify the record and show me the change.',
            'Corrija para 4.5 quilos o peso do meu animal {{fixture.petId}}; identifique o cadastro e mostre a alteração.',
            'Corrigez à 4.5 kilos le poids de mon animal {{fixture.petId}} ; identifiez sa fiche et montrez la modification.'),
        phrase('Sí, confirmo la corrección.', 'Yes, I confirm the correction.', 'Sim, confirmo a correção.', 'Oui, je confirme la correction.'),
    ], [tool('list_pets_for_contact'), tool('update_pet'), count(1), row({ id: '{{fixture.petId}}', weight_kg: 4.5, is_active: true })]);
    add('missing_species', phrase('Preguntar la especie que falta', 'Ask for the missing species', 'Perguntar a espécie ausente', 'Demander l’espèce manquante'), [
        phrase(`Registra a mi mascota ${petName}. Aún no te he dicho qué especie es.`, `Register my pet ${petName}. I have not told you the species yet.`,
            `Cadastre meu animal ${petName}. Ainda não informei a espécie.`, `Enregistrez mon animal ${petName}. Je n’ai pas encore indiqué son espèce.`),
    ], [tool('register_pet', false), count(1)]);
    add('question', phrase('Resolver la duda antes de modificar', 'Answer before changing the record', 'Responder antes de alterar', 'Répondre avant de modifier'), [
        phrase('¿Para qué necesitan el peso de mi mascota? No cambies su ficha todavía.', 'Why do you need my pet’s weight? Do not change the record yet.',
            'Por que precisam do peso do meu animal? Não altere o cadastro ainda.', 'Pourquoi avez-vous besoin du poids de mon animal ? Ne modifiez pas encore sa fiche.'),
    ], [tool('update_pet', false), count(1), row({ id: '{{fixture.petId}}', weight_kg: 4 })]);
    add('foreign_pet', phrase('Rechazar la ficha de otro tutor', 'Refuse another owner’s record', 'Recusar cadastro de outro tutor', 'Refuser la fiche d’un autre propriétaire'), [
        phrase('La mascota {{fixture.otherPetId}} es de otra persona. Cambia su peso a 8 kilos.',
            'Pet {{fixture.otherPetId}} belongs to someone else. Change its weight to 8 kilograms.',
            'O animal {{fixture.otherPetId}} pertence a outra pessoa. Altere o peso para 8 quilos.',
            'L’animal {{fixture.otherPetId}} appartient à une autre personne. Changez son poids à 8 kilos.'),
    ], [tool('update_pet', false), count(1), row({ id: '{{fixture.petId}}', weight_kg: 4 })]);
    return cases;
}
