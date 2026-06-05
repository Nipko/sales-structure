/**
 * Expo config plugin: endurecimiento TLS de Android (GATE 0 — seguridad).
 *
 * QUÉ HACE:
 *  1. Escribe res/xml/network_security_config.xml que PROHÍBE tráfico en claro
 *     (cleartextTrafficPermitted="false") para todo dominio de producción → la app
 *     solo habla HTTPS. Bloquea downgrades/MitM accidentales por http://.
 *  2. Referencia ese archivo desde <application android:networkSecurityConfig=...>.
 *
 * Deja localhost/emulador (10.0.2.2/127.0.0.1) con cleartext permitido SOLO para
 * desarrollo (Metro). Los builds release que enviamos hablan únicamente con la API
 * https de producción, así que no se rompe nada.
 *
 * CERTIFICATE PINNING: se deja como opt-in COMENTADO. Pinear api.parallly-chat.cloud
 * detrás de Cloudflare es riesgoso (Cloudflare rota certificados sin aviso → un pin
 * obsoleto "brickea" la app sin poder arreglarlo en remoto). Para activarlo, calcula
 * los SPKI pins (incluye un backup) y descomenta el bloque <pin-set> de abajo.
 *
 * (Los builds locales de Windows aplican lo mismo a mano en android/, que es
 * gitignored — este plugin hace que EAS/tienda lo reproduzcan.)
 */
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NSC_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por plugins/withAndroidNetworkSecurity.js (GATE 0 — seguridad). -->
<network-security-config>
    <!-- Producción: SOLO HTTPS, confía en el almacén de CAs del sistema. -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>

    <!-- Desarrollo: Metro/emulador por LAN en claro. No afecta release. -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">10.0.2.2</domain>
        <domain includeSubdomains="true">127.0.0.1</domain>
    </domain-config>

    <!--
    PINNING (opt-in, deshabilitado por riesgo de rotación tras Cloudflare):
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">api.parallly-chat.cloud</domain>
        <pin-set expiration="2027-01-01">
            <pin digest="SHA-256">PIN_PRINCIPAL_BASE64=</pin>
            <pin digest="SHA-256">PIN_BACKUP_BASE64=</pin>
        </pin-set>
    </domain-config>
    -->
</network-security-config>
`;

function withConfigFile(config) {
    return withDangerousMod(config, [
        'android',
        async (cfg) => {
            const xmlDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
            fs.mkdirSync(xmlDir, { recursive: true });
            fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), NSC_XML, 'utf8');
            return cfg;
        },
    ]);
}

function withManifestRef(config) {
    return withAndroidManifest(config, (cfg) => {
        const app = cfg.modResults.manifest.application && cfg.modResults.manifest.application[0];
        if (app && app.$) {
            app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
        }
        return cfg;
    });
}

module.exports = function withAndroidNetworkSecurity(config) {
    config = withConfigFile(config);
    config = withManifestRef(config);
    return config;
};
