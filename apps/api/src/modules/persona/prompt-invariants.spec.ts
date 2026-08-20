import { PersonaService } from './persona.service';
import { normalizeRequiredFields } from './required-fields.util';
import { CARE_FIRST_INDUSTRIES, resolveAgentSkillset } from '@parallext/shared';

/**
 * Tres defectos del prompt efectivo que la auditoría dejó documentados.
 *
 * 1. Pasar el editor a modo libre borraba los temas prohibidos, los
 *    disparadores de handoff, el horario y el skillset: personalizar apagaba
 *    las protecciones sectoriales sin decirlo.
 * 2. El default de skillset era `both` para todos, así que una recepción
 *    médica, una psicóloga, un estudio jurídico, una veterinaria y una
 *    financiera recibían una orden de venta consultiva que nadie eligió.
 * 3. Trece plantillas declaraban `requiredFields` con una forma que el
 *    renderer no entiende, y encima la sección se suprimía entera con Agenda
 *    activa: ni un solo campo llegaba al prompt.
 */
describe('persona prompt invariants', () => {
    const service = new PersonaService(
        {} as any, {} as any, {} as any, {} as any, {} as any,
    );

    const baseConfig = (overrides: Record<string, any> = {}) => ({
        persona: { name: 'Sofía', role: 'Asistente', personality: {} },
        behavior: {
            rules: ['Sé breve'],
            forbiddenTopics: ['Diagnósticos médicos'],
            handoffTriggers: ['urgencia medica'],
        },
        hours: { schedule: { mon: '09:00-18:00' } },
        industry: 'salud',
        language: 'es',
        ...overrides,
    });

    describe('free-prompt mode', () => {
        const custom = { editorMode: 'prompt', customPrompt: 'Hablá como un pirata.' };

        it('keeps the sector guardrails a custom prompt must not silence', () => {
            const prompt = service.buildSystemPrompt(baseConfig(custom) as any);

            expect(prompt).toContain('Hablá como un pirata.');
            expect(prompt).toContain('<forbidden_topics>');
            expect(prompt).toContain('Diagnósticos médicos');
            expect(prompt).toContain('<handoff_triggers>');
            expect(prompt).toContain('urgencia medica');
            expect(prompt).toContain('<business_hours>');
            expect(prompt).toContain('<skillset>');
        });

        /** Lo que el dueño SÍ puede reemplazar: la voz. */
        it('lets the custom text replace identity, personality and rules', () => {
            const prompt = service.buildSystemPrompt(baseConfig(custom) as any);

            expect(prompt).not.toContain('<identity>');
            expect(prompt).not.toContain('<rules>');
            expect(prompt).not.toContain('Sé breve');
        });

        it('carries the no-pitch invariant into free-prompt mode too', () => {
            const prompt = service.buildSystemPrompt(baseConfig(custom) as any);
            expect(prompt).toContain('<no_pitch>');
        });

        it('falls back to the guided block when the custom text is empty', () => {
            const prompt = service.buildSystemPrompt(
                baseConfig({ editorMode: 'prompt', customPrompt: '   ' }) as any,
            );
            expect(prompt).toContain('<identity>');
        });
    });

    describe('skillset default', () => {
        it.each(CARE_FIRST_INDUSTRIES)('does not order %s to sell by default', (industry) => {
            const prompt = service.buildSystemPrompt(
                baseConfig({ industry, behavior: {} }) as any,
            );
            expect(prompt).toContain('<mode>support</mode>');
            expect(prompt).not.toContain('vendedor consultivo');
            expect(prompt).toContain('<no_pitch>');
        });

        it('still sells by default where selling is the job', () => {
            const prompt = service.buildSystemPrompt(
                baseConfig({ industry: 'retail', behavior: {} }) as any,
            );
            expect(prompt).toContain('<mode>both</mode>');
            expect(prompt).toContain('vendedor consultivo');
            expect(prompt).not.toContain('<no_pitch>');
        });

        /**
         * El default es un default. Si el dueño de una clínica estética eligió
         * vender, vende — pero la regla de no abrir una venta sobre un síntoma
         * no se negocia.
         */
        it('honours an explicit choice and keeps no-pitch anyway', () => {
            const prompt = service.buildSystemPrompt(
                baseConfig({ industry: 'salud', skillset: 'sales', behavior: {} }) as any,
            );
            expect(prompt).toContain('<mode>sales</mode>');
            expect(prompt).toContain('vendedor consultivo');
            expect(prompt).toContain('<no_pitch>');
        });

        it('ignores a value that is not a skillset', () => {
            expect(resolveAgentSkillset('vender_mucho', 'retail')).toBe('both');
            expect(resolveAgentSkillset(null, 'salud')).toBe('support');
            expect(resolveAgentSkillset('support', 'retail')).toBe('support');
        });
    });

    describe('required fields', () => {
        /** La forma que trece plantillas verticales guardan de verdad. */
        const legacy = { name: { required: true }, phone: { required: true }, email: { required: false } };

        it('translates the legacy shape instead of dropping it silently', () => {
            const normalized = normalizeRequiredFields(legacy, { language: 'es' });
            expect(normalized.general.map((f) => f.field)).toEqual(['name', 'phone']);
            expect(normalized.general[0].question).toContain('nombre');
        });

        it('asks in the agent language', () => {
            expect(normalizeRequiredFields(legacy, { language: 'fr' }).general[0].question)
                .toContain('nom');
            expect(normalizeRequiredFields(legacy, { language: 'pt' }).general[0].question)
                .toContain('nome');
        });

        /**
         * La sección entera se suprimía con Agenda activa para no competir con
         * el motor determinista. Suprimir sólo lo que el motor pregunta deja
         * pasar lo que nadie más pide.
         */
        it('drops only what the booking engine already collects', () => {
            const withEmail = { ...legacy, email: { required: true } };
            const normalized = normalizeRequiredFields(withEmail, {
                language: 'es',
                appointmentsEnabled: true,
            });
            expect(normalized.general.map((f) => f.field)).toEqual(['email']);
        });

        it('keeps a correctly shaped contract untouched', () => {
            const contract = {
                cotizacion: [{ field: 'nit', question: '¿Cuál es tu NIT?' }],
            };
            expect(normalizeRequiredFields(contract, { language: 'es' })).toEqual(contract);
        });

        /** Inventarle una pregunta al dueño sería ponerle palabras al agente. */
        it('drops a legacy key it has no authored question for', () => {
            expect(normalizeRequiredFields({ numero_de_poliza: { required: true } }, { language: 'es' }))
                .toEqual({});
        });

        it('treats junk as no requirements rather than throwing', () => {
            expect(normalizeRequiredFields(undefined)).toEqual({});
            expect(normalizeRequiredFields('name,phone')).toEqual({});
            expect(normalizeRequiredFields([{ field: 'name' }])).toEqual({});
        });

        it('reaches the prompt, which no vertical requiredField ever did', () => {
            const prompt = service.buildSystemPrompt(baseConfig({
                behavior: { requiredFields: legacy },
                tools: { appointments: { enabled: false } },
            }) as any);
            expect(prompt).toContain('<required_information>');
            expect(prompt).toContain('name="name"');
        });
    });
});
