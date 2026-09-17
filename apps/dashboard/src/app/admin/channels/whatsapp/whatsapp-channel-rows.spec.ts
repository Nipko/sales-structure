import * as fs from "fs";
import * as path from "path";
import {
  normalizeChannelStatus,
  readWhatsAppChannelRows,
  whatsAppRowPhoneNumberId,
} from "./whatsapp-channel-rows";

/**
 * ═══ UN NÚMERO DESCONECTADO NO ES UN NÚMERO ACTIVO ═══
 *
 * `GET /channels/whatsapp/status` devuelve en `channels` TODAS las filas de
 * `whatsapp_channels`, incluida la que deja un número desconectado (la fila no
 * se borra). La pantalla armaba la lista de "números activos" con ese arreglo
 * crudo: el número muerto salía listado con calidad GREEN por defecto, contaba
 * contra el límite del plan y ofrecía un "Desconectar" que la API rechaza
 * ("No active account found to disconnect"). Perfil y Plantillas tomaban
 * `channels[0]`, que es justo la fila vieja cuando el tenant reemplazó un número.
 */
describe("readWhatsAppChannelRows", () => {
  const dead = { id: "row-1", phone_number_id: "111", display_phone_number: "+57 300 000 0001", channel_status: "disconnected" };
  const live = { id: "row-2", phone_number_id: "222", display_phone_number: "+57 300 000 0002", channel_status: "connected" };

  it("lists only the connected row when a disconnected leftover is older", () => {
    const rows = readWhatsAppChannelRows({ status: "connected", channel: live, channels: [dead, live] });

    expect(rows.all).toEqual([dead, live]);
    expect(rows.connected).toEqual([live]);
    expect(rows.preferred).toBe(live);
  });

  it("keeps the server order among several connected rows", () => {
    const newer = { ...live, id: "row-3", phone_number_id: "333" };
    const rows = readWhatsAppChannelRows({ channels: [dead, live, newer] });

    expect(rows.connected).toEqual([live, newer]);
    expect(rows.preferred).toBe(live);
  });

  it("offers no active number when every row is disconnected, and still names the first row", () => {
    const other = { ...dead, id: "row-9", phone_number_id: "999" };
    const rows = readWhatsAppChannelRows({ status: "disconnected", channel: dead, channels: [dead, other] });

    expect(rows.connected).toEqual([]);
    // A screen that must name SOME number (the profile request) still gets
    // one, and the server answers for it; nothing lists it as active.
    expect(rows.preferred).toBe(dead);
  });

  it.each([
    ["an empty channel list", { status: "disconnected", channel: null, channels: [] }],
    ["no payload", null],
    ["a non-object payload", "connected"],
    ["an empty object", {}],
  ])("returns nothing for %s", (_label, payload) => {
    expect(readWhatsAppChannelRows(payload)).toEqual({ all: [], connected: [], preferred: null });
  });

  it("normalizes case and whitespace in channel_status", () => {
    const upper = { ...live, id: "a", channel_status: " CONNECTED " };
    const mixed = { ...live, id: "b", channel_status: "Connected\n" };
    const blank = { ...live, id: "c", channel_status: "   " };
    const missing = { id: "d", phone_number_id: "444" };
    const pending = { ...live, id: "e", channel_status: "pending" };
    const deadUpper = { ...dead, id: "f", channel_status: " Disconnected" };

    const rows = readWhatsAppChannelRows({ channels: [deadUpper, blank, upper, missing, mixed, pending] });

    expect(rows.connected).toEqual([upper, mixed]);
    expect(rows.preferred).toBe(upper);
  });

  it("reads the same rows under a `data` wrapper", () => {
    const rows = readWhatsAppChannelRows({ data: { channels: [dead, live] } });

    expect(rows.connected).toEqual([live]);
    expect(rows.preferred).toBe(live);
  });

  it("falls back to the single `channel` and honours its status", () => {
    expect(readWhatsAppChannelRows({ channel: dead })).toEqual({ all: [dead], connected: [], preferred: dead });
    expect(readWhatsAppChannelRows({ channel: live })).toEqual({ all: [live], connected: [live], preferred: live });
  });

  it("treats the generic channel endpoint's accounts as active, because it only returns active ones", () => {
    // `GET /channels/:channelType/status` filters `isActive: true` and carries
    // no `channel_status`; reading its rows as disconnected would empty a
    // working screen.
    const account = { accountId: "555", displayName: "Tienda", metadata: { phoneNumberId: "555" } };

    expect(readWhatsAppChannelRows({ data: { connected: true, account, accounts: [account] } }))
      .toEqual({ all: [account], connected: [account], preferred: account });
    expect(readWhatsAppChannelRows({ data: { connected: true, account } }))
      .toEqual({ all: [account], connected: [account], preferred: account });
  });

  it("ignores entries that are not rows", () => {
    const rows = readWhatsAppChannelRows({ channels: [null, "x", 42, live] });

    expect(rows.all).toEqual([live]);
    expect(rows.connected).toEqual([live]);
  });
});

describe("normalizeChannelStatus", () => {
  it.each([
    [" Connected ", "connected"],
    ["DISCONNECTED", "disconnected"],
    [undefined, ""],
    [null, ""],
    [42, ""],
  ])("normalizes %p to %p", (value, expected) => {
    expect(normalizeChannelStatus(value)).toBe(expected);
  });
});

describe("whatsAppRowPhoneNumberId", () => {
  it.each([
    [{ phone_number_id: " 111 " }, "111"],
    [{ metadata: { phoneNumberId: "222" } }, "222"],
    [{ accountId: "333" }, "333"],
    [{ phone_number_id: "  ", accountId: "444" }, "444"],
    [{}, ""],
    [null, ""],
  ])("reads the phone number id of %p", (row, expected) => {
    expect(whatsAppRowPhoneNumberId(row)).toBe(expected);
  });
});

/**
 * La función sola no alcanza: el defecto era que las pantallas leían el arreglo
 * crudo. Estas aserciones leen la fuente de las tres pantallas para que ninguna
 * vuelva a decidir con `channels` / `channels[0]` a mano.
 */
describe("WhatsApp screens decide with readWhatsAppChannelRows", () => {
  // `core.autocrlf` deja el árbol en CRLF y el blob en LF.
  const read = (file: string): string =>
    fs.readFileSync(path.join(__dirname, file), "utf8").replace(/\r\n/g, "\n");

  const SCREENS = ["page.tsx", path.join("profile", "page.tsx"), path.join("templates", "page.tsx")];

  it.each(SCREENS)("%s imports the helper and never reads the raw status arrays", (file) => {
    const source = read(file);

    expect(source).toMatch(/import\s*\{[^}]*\breadWhatsAppChannelRows\b[^}]*\}\s*from\s*["']\.{1,2}\/(?:\.\.\/)?whatsapp-channel-rows["']/);
    expect(source).toMatch(/readWhatsAppChannelRows(?:<[^>]*>)?\(/);
    // Nobody picks "the first row" or walks `channels`/`accounts` on their own.
    expect(source).not.toMatch(/\bchannels\s*\[\s*0\s*\]/);
    expect(source).not.toMatch(/\bnumbers\s*\[\s*0\s*\]/);
    expect(source).not.toMatch(/\.\s*channels\b/);
    expect(source).not.toMatch(/\.\s*accounts\b/);
  });

  it("page.tsx lists, counts and offers per-number disconnect only for connected rows", () => {
    const source = read("page.tsx");

    const binding = source.match(/const\s+(\w+)\s*(?::[^=]+)?=\s*\w+\.connected\s*;/);
    expect(binding).not.toBeNull();
    const activeName = binding![1];

    // The plan limit counts what the API counts: active numbers only.
    expect(source).toMatch(new RegExp(`canAddChannelAccount\\(\\s*["']whatsapp["']\\s*,\\s*${activeName}\\.length\\s*\\)`));
    // The rendered list is the connected list, so the per-number disconnect
    // inside it can only ever target a connected number.
    const listStart = source.indexOf(`${activeName}.map(`);
    expect(listStart).toBeGreaterThan(-1);
    expect(source.match(/handleDisconnectNumber\(/g)).toHaveLength(1);
    expect(source.indexOf("handleDisconnectNumber(")).toBeGreaterThan(listStart);
    // The loaded number shown in "prueba tu agente" is the preferred row.
    expect(source).toMatch(/readWhatsAppChannelRows\(\s*statusRes\s*\)\.preferred/);
  });

  it("profile/page.tsx selects among connected rows and starts on the preferred one", () => {
    const source = read(path.join("profile", "page.tsx"));

    expect(source).toMatch(/setWaNumbers\(\s*\w+\.connected\s*\)/);
    expect(source).toMatch(/whatsAppRowPhoneNumberId\(\s*\w+\.preferred\s*\)/);
  });

  it("templates/page.tsx selects among connected rows and starts on the preferred one", () => {
    const source = read(path.join("templates", "page.tsx"));

    expect(source).toMatch(/setWaNumbers\(\s*\w+\.connected\s*\)/);
    expect(source).toMatch(/setPhoneNumberId\(\s*whatsAppRowPhoneNumberId\(\s*\w+\.preferred\s*\)\s*\)/);
  });
});
