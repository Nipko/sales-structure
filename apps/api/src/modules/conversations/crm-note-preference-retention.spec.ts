import { explicitlyRequestsCrmNote } from './crm-note-request';
import { ToolRetrievalService } from './tool-retrieval.service';
import { staticToolsForAgentConfig } from './agent-tool-registry';
import { isConfirmableWriteTool } from './tool-policy-registry';

// Boolean family/subpermission fixtures match the two audited configured agents.
// Local code tests only: no real account, persistence, model reply or delivery.
const fixtures = {
  "qa04": {
    "tools": {
      "crm": {
        "enabled": true
      },
      "faqs": {
        "enabled": true
      },
      "restaurants": {
        "enabled": true
      }
    },
    "expectedToolNames": [
      "search_faqs",
      "get_customer_context",
      "ensure_crm_lead",
      "create_crm_opportunity",
      "move_crm_opportunity_stage",
      "create_follow_up_task",
      "record_contact_consent",
      "add_contact_note",
      "tag_contact",
      "record_contact_interest",
      "get_menu",
      "get_promotions",
      "place_order",
      "cancel_order",
      "check_order_status",
      "list_my_orders"
    ],
    "message": "Anota en mi ficha que prefiero retirar mis pedidos de prueba los martes. Solo guarda esa preferencia; no hagas pedidos, reservas ni tareas. Referencia QA-CRM4104-N04."
  },
  "qa09": {
    "tools": {
      "crm": {
        "enabled": true
      },
      "faqs": {
        "enabled": true
      },
      "properties": {
        "enabled": true
      },
      "appointments": {
        "canBook": true,
        "enabled": false,
        "canCancel": true
      }
    },
    "expectedToolNames": [
      "search_faqs",
      "get_customer_context",
      "ensure_crm_lead",
      "create_crm_opportunity",
      "move_crm_opportunity_stage",
      "create_follow_up_task",
      "record_contact_consent",
      "add_contact_note",
      "tag_contact",
      "record_contact_interest",
      "list_properties",
      "check_property_availability",
      "get_property_details",
      "get_check_in_instructions",
      "create_property_booking",
      "cancel_property_booking",
      "list_my_property_bookings",
      "send_property_image"
    ],
    "message": "Anota en mi ficha que prefiero recibir los detalles por escrito, sin llamadas. Solo guarda esa preferencia; no reserves ni crees tareas. Referencia QA-CRM4104-N09."
  }
};
const select = (tools: unknown, message: string) => {
    const candidates = staticToolsForAgentConfig(tools);
    const pinned = new Set(candidates.filter(t => isConfirmableWriteTool(t.name)).map(t => t.name));
    return new ToolRetrievalService().retrieveRelevantTools(`${message} idle`, candidates, 1, pinned).map(t => t.name);
};

describe('ordinary customer preference retention', () => {
    it('NOTEPREF_A_01 keeps Luca Tuesday pickup writer with exact configured candidate set', () => {
        const f = fixtures.qa04;
        expect(staticToolsForAgentConfig(f.tools).map(t => t.name).sort()).toEqual([...f.expectedToolNames].sort());
        expect(explicitlyRequestsCrmNote(f.message)).toBe(true);
        expect(select(f.tools, f.message)).toContain('add_contact_note');
        expect(select({ ...f.tools, crm: { enabled: false } }, f.message)).not.toContain('add_contact_note');
    });
    it('NOTEPREF_A_02 does not promote an explicitly negated own-record preference', () => {
        expect(explicitlyRequestsCrmNote('No anotes en mi ficha mi preferencia por recoger los martes.')).toBe(false);
    });
    it('NOTEPREF_A_03 does not promote quoted own-record instructions', () => {
        expect(explicitlyRequestsCrmNote('"Anota en mi ficha que prefiero los martes" es un ejemplo del manual.')).toBe(false);
    });
    it('NOTEPREF_B_01 keeps Maya written-details/no-calls writer with exact configured candidate set', () => {
        const f = fixtures.qa09;
        expect(staticToolsForAgentConfig(f.tools).map(t => t.name).sort()).toEqual([...f.expectedToolNames].sort());
        expect(explicitlyRequestsCrmNote(f.message)).toBe(true);
        expect(select(f.tools, f.message)).toContain('add_contact_note');
        expect(select({ ...f.tools, crm: { enabled: false } }, f.message)).not.toContain('add_contact_note');
    });
    it('NOTEPREF_B_02 does not promote a how-to question about a profile', () => {
        expect(explicitlyRequestsCrmNote('¿Cómo puedo anotar en mi ficha mi preferencia desde el panel?')).toBe(false);
    });
    it('NOTEPREF_B_03 does not confuse an order annotation or someone else record with my CRM note', () => {
        expect(explicitlyRequestsCrmNote('Anota en el pedido que prefiero recogerlo el martes.')).toBe(false);
        expect(explicitlyRequestsCrmNote('Anota en la ficha de otra persona que prefiere llamadas.')).toBe(false);
    });
});
