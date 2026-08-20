import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Borrar una conversación de la bandeja.
 *
 * Borraba tres tablas y dejaba todo lo demás en pie: la conversación
 * desaparecía de la vista y el sistema seguía comportándose como si existiera.
 * El motor retomaba un flujo a medias, una confirmación pendiente vieja se
 * ejecutaba con el primer "sí", y la memoria del agente seguía hablando de un
 * chat que el dueño ya había borrado. Existe `infra/scripts/reset-chat.sh`
 * justamente porque esto no se podía hacer desde el producto.
 */

const SRC = readFileSync(resolve(__dirname, 'agent-console.service.ts'), 'utf8');
const BODY = SRC.slice(SRC.indexOf('async deleteConversation'), SRC.indexOf('private async clearConversationRuntimeState'));

describe('lo que se borra', () => {
    it('el estado vivo en Redis, que es lo que hacía reaparecer el chat', () => {
        const runtime = SRC.slice(SRC.indexOf('private async clearConversationRuntimeState'));
        for (const key of ['booking:', 'procedure:', 'lock:conv:', 'handoff:', 'llm:affinity:']) {
            expect(runtime).toContain(key);
        }
    });

    it('la memoria del agente sobre ese chat', () => {
        expect(BODY).toContain('DELETE FROM conversation_memory');
    });

    it('las confirmaciones pendientes', () => {
        expect(BODY).toContain('DELETE FROM tool_execution_ledger');
    });
});

describe('lo que NO se borra', () => {
    it('la plata: una confirmación con cobro detrás queda intacta', () => {
        // La base lo protege sola con ON DELETE RESTRICT. Acá se hace explícito
        // en vez de chocar contra el error, que abortaría el borrado entero.
        expect(BODY).toContain('AND id NOT IN (SELECT execution_ledger_id FROM payment_operation_ledger)');
    });

    it('el negocio: reservas, citas, pedidos y oportunidades sobreviven', () => {
        // Borrar una conversación no puede borrar la venta. Su conversation_id
        // queda en NULL por el ON DELETE SET NULL del esquema.
        for (const tabla of ['property_bookings', 'appointments', 'orders', 'opportunities']) {
            expect(BODY).not.toContain(`DELETE FROM ${tabla}`);
        }
    });
});

describe('robustez', () => {
    it('un fallo limpiando no aborta el borrado', () => {
        // El borrado ya ocurrió en la base: abortar dejaría una conversación a
        // medio borrar, que es peor que un residuo en Redis.
        const runtime = SRC.slice(SRC.indexOf('private async clearConversationRuntimeState'));
        expect(runtime).toContain('catch (e: any)');
        expect(BODY).toContain('.catch((e: any) => this.logger.warn');
    });

    it('Redis se limpia DESPUÉS de que la fila se fue', () => {
        // Al revés, un mensaje que entre en el medio recrearía las claves.
        const delRow = BODY.indexOf('DELETE FROM conversations WHERE id');
        const clear = BODY.indexOf('clearConversationRuntimeState');
        expect(delRow).toBeGreaterThan(0);
        expect(clear).toBeGreaterThan(delRow);
    });
});
