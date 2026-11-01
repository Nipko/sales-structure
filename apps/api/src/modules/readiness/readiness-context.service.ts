/**
 * ReadinessContextService (C0 §1.2, rebanada R4): el contrato de conocimiento del turno para la capa 3 del prompt.
 *
 * El contrato sale de la última evaluación del motor (ReadinessService: misma foto, misma caché, misma invalidación),
 * así que el agente y el panel no pueden discrepar sobre qué consta. Este servicio solo lo pinta como
 * `<knowledge_status>` con las opciones del prompt:
 * - sin las prohibiciones comunes (van en la regla fija del contrato L1, que es prefijo cacheable);
 * - sin `writes` mientras la exclusión por WRITE_MODE está en modo sombra (el prompt no puede decir «none» de un
 *   escritor que el contrato de capacidades todavía publica).
 *
 * Nunca lanza: sin contrato, el turno sigue con el prompt de siempre (sin el bloque).
 */
import { Injectable, Logger } from '@nestjs/common';
import { renderKnowledgeStatus, type TurnKnowledgeContract } from '@parallext/business-spec';
import { ReadinessService } from './readiness.service';

export interface TurnKnowledgeStatus {
    /** El bloque `<knowledge_status>` ya escapado, con la sangría de la capa 3. */
    block: string;
    specVersion: string;
    verdict: string;
    resultHash: string;
    /** Requisitos que no constan (para la traza del turno). */
    unknownIds: string[];
}

export function knowledgeStatusFrom(contract: TurnKnowledgeContract, options: { writesEnforced?: boolean } = {}): TurnKnowledgeStatus {
    return {
        block: renderKnowledgeStatus(contract, { indent: '  ', includeCommonNever: false, includeWrites: options.writesEnforced === true }),
        specVersion: contract.specVersion,
        verdict: contract.verdict,
        resultHash: contract.resultHash,
        unknownIds: contract.unknown.map(u => u.id),
    };
}

@Injectable()
export class ReadinessContextService {
    private readonly logger = new Logger(ReadinessContextService.name);

    constructor(private readonly readiness: ReadinessService) {}

    /** D1a: el contrato entero, para sellarlo en la foto de una evaluación. Nunca lanza: sin contrato, null. */
    async contract(tenantId: string): Promise<TurnKnowledgeContract | null> {
        try {
            return (await this.readiness.turnContract(tenantId)) ?? null;
        } catch (err) {
            this.logger.warn(`readiness: contrato del turno no disponible para ${tenantId}: ${(err as Error).message}`);
            return null;
        }
    }

    async forTurn(tenantId: string, options: { writesEnforced?: boolean } = {}): Promise<TurnKnowledgeStatus | null> {
        try {
            const contract = await this.readiness.turnContract(tenantId);
            return contract ? knowledgeStatusFrom(contract, options) : null;
        } catch (err) {
            this.logger.warn(`readiness: <knowledge_status> no disponible para ${tenantId}: ${(err as Error).message}`);
            return null;
        }
    }
}
