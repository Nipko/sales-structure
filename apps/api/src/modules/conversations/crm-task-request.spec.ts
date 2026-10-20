import { explicitlyRequestsCrmTask } from './crm-task-request';
describe('explicit CRM task command boundary', () => {
    it.each([
        'Registre una tarea de seguimiento para mi ficha.',
        'Necesito que me contacten más adelante. Registre una única tarea con este título: "Revisar solicitud".',
        '¿Puedes crear una tarea de seguimiento?',
        'Por favor, agrega una tarea de seguimiento.',
        'Please create a follow-up task for my request.',
        'I need a callback. Could you add a task for the team?',
        'Por favor registre uma tarefa de acompanhamento.',
        'Pouvez-vous créer une tâche de suivi ?',
    ])('keeps the requested capture capability: %s', text => {
        expect(explicitlyRequestsCrmTask(text)).toBe(true);
    });
    it.each([
        'No registre una tarea de seguimiento.',
        'No crees ninguna tarea.',
        '¿Cómo puedo crear una tarea en el panel?',
        'El manual dice "Registre una tarea".',
        '«Create a task» is a quote from a document.',
        'Do not create a task.',
        'Could you not create a task?',
        'Não registre uma tarefa.',
        'Ne créez pas une tâche.',
        'No cree tareas. Registre solo una nota interna.',
        'Guarda una nota con este texto: "Registre una tarea".',
        'sí',
    ])('does not promote data, instructions about the UI or refusals: %s', text => {
        expect(explicitlyRequestsCrmTask(text)).toBe(false);
    });
});
