#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const data = {
    es: {
        identity: {
            loading: "Cargando sugerencias...",
            pendingTitle: "Sugerencias pendientes",
            suggestionCount: "{count, plural, one {# sugerencia} other {# sugerencias}}",
            contactA: "Contacto A",
            contactB: "Contacto B",
            stats: { pending: "Pendientes", approved: "Aprobadas", rejected: "Rechazadas" },
            empty: {
                title: "Sin sugerencias pendientes",
                description: "Cuando el sistema detecte contactos duplicados entre canales, aparecerán aquí.",
            },
            matchType: { phone: "Teléfono", email: "Email" },
            toast: {
                merged: "Contactos fusionados correctamente.",
                rejected: "Sugerencia rechazada.",
            },
        },
        users: {
            subtitleStats: "{total} usuarios · {active} activos · {agents} agentes",
            stats: { total: "Total", admins: "Administradores", agents: "Agentes", active: "Activos" },
            filter: { allRoles: "Todos los roles" },
            headers: {
                user: "Usuario", email: "Email", role: "Rol",
                tenant: "Empresa", status: "Estado", registered: "Registrado",
            },
            modal: {
                title: "Nuevo usuario",
                firstName: "Nombre", firstNamePlaceholder: "Juan",
                lastName: "Apellido", lastNamePlaceholder: "Pérez",
                email: "Email", emailPlaceholder: "juan@empresa.com",
                password: "Contraseña", passwordPlaceholder: "Mínimo 6 caracteres",
                role: "Rol",
                tenantIdLabel: "ID de empresa (opcional)",
                tenantIdPlaceholder: "UUID de la empresa",
            },
            toast: { created: "Usuario creado correctamente" },
        },
        knowledge: {
            hash: "Hash",
            approve: "Aprobar",
            chunk: "Fragmento",
            searchPlaceholder: "Busca en la base de conocimiento como lo haría la IA...",
            searchButton: "Buscar",
            empty: {
                library: "Sin recursos en la base de conocimiento.",
                search: "Sin resultados.",
            },
            status: { draft: "Borrador", approved: "Aprobado", archived: "Archivado" },
            modal: {
                title: "Nuevo recurso",
                titleLabel: "Título del recurso",
                titlePlaceholder: "FAQ del curso...",
                contentLabel: "Contenido de texto",
                contentPlaceholder: "Pega el contenido del documento...",
            },
        },
    },
    en: {
        identity: {
            loading: "Loading identity suggestions...",
            pendingTitle: "Pending suggestions",
            suggestionCount: "{count, plural, one {# suggestion} other {# suggestions}}",
            contactA: "Contact A",
            contactB: "Contact B",
            stats: { pending: "Pending", approved: "Approved", rejected: "Rejected" },
            empty: {
                title: "No pending suggestions",
                description: "When the system detects duplicate contacts across channels, they will appear here.",
            },
            matchType: { phone: "Phone", email: "Email" },
            toast: {
                merged: "Contacts merged successfully.",
                rejected: "Suggestion rejected.",
            },
        },
        users: {
            subtitleStats: "{total} users · {active} active · {agents} agents",
            stats: { total: "Total", admins: "Admins", agents: "Agents", active: "Active" },
            filter: { allRoles: "All roles" },
            headers: {
                user: "User", email: "Email", role: "Role",
                tenant: "Tenant", status: "Status", registered: "Registered",
            },
            modal: {
                title: "New user",
                firstName: "First name", firstNamePlaceholder: "John",
                lastName: "Last name", lastNamePlaceholder: "Doe",
                email: "Email", emailPlaceholder: "john@company.com",
                password: "Password", passwordPlaceholder: "Minimum 6 characters",
                role: "Role",
                tenantIdLabel: "Tenant ID (optional)",
                tenantIdPlaceholder: "Tenant UUID",
            },
            toast: { created: "User created successfully" },
        },
        knowledge: {
            hash: "Hash",
            approve: "Approve",
            chunk: "Chunk",
            searchPlaceholder: "Search knowledge as the AI would...",
            searchButton: "Search",
            empty: {
                library: "No resources in the knowledge base.",
                search: "No matches found.",
            },
            status: { draft: "Draft", approved: "Approved", archived: "Archived" },
            modal: {
                title: "New knowledge resource",
                titleLabel: "Resource title",
                titlePlaceholder: "Course FAQ...",
                contentLabel: "Text content",
                contentPlaceholder: "Paste document content...",
            },
        },
    },
    pt: {
        identity: {
            loading: "Carregando sugestões...",
            pendingTitle: "Sugestões pendentes",
            suggestionCount: "{count, plural, one {# sugestão} other {# sugestões}}",
            contactA: "Contato A",
            contactB: "Contato B",
            stats: { pending: "Pendentes", approved: "Aprovadas", rejected: "Rejeitadas" },
            empty: {
                title: "Sem sugestões pendentes",
                description: "Quando o sistema detectar contatos duplicados entre canais, aparecerão aqui.",
            },
            matchType: { phone: "Telefone", email: "Email" },
            toast: {
                merged: "Contatos mesclados com sucesso.",
                rejected: "Sugestão rejeitada.",
            },
        },
        users: {
            subtitleStats: "{total} usuários · {active} ativos · {agents} agentes",
            stats: { total: "Total", admins: "Administradores", agents: "Agentes", active: "Ativos" },
            filter: { allRoles: "Todos os papéis" },
            headers: {
                user: "Usuário", email: "Email", role: "Papel",
                tenant: "Empresa", status: "Status", registered: "Registrado",
            },
            modal: {
                title: "Novo usuário",
                firstName: "Nome", firstNamePlaceholder: "João",
                lastName: "Sobrenome", lastNamePlaceholder: "Silva",
                email: "Email", emailPlaceholder: "joao@empresa.com",
                password: "Senha", passwordPlaceholder: "Mínimo 6 caracteres",
                role: "Papel",
                tenantIdLabel: "ID da empresa (opcional)",
                tenantIdPlaceholder: "UUID da empresa",
            },
            toast: { created: "Usuário criado com sucesso" },
        },
        knowledge: {
            hash: "Hash",
            approve: "Aprovar",
            chunk: "Fragmento",
            searchPlaceholder: "Busque no conhecimento como a IA faria...",
            searchButton: "Buscar",
            empty: {
                library: "Sem recursos na base de conhecimento.",
                search: "Sem resultados.",
            },
            status: { draft: "Rascunho", approved: "Aprovado", archived: "Arquivado" },
            modal: {
                title: "Novo recurso",
                titleLabel: "Título do recurso",
                titlePlaceholder: "FAQ do curso...",
                contentLabel: "Conteúdo de texto",
                contentPlaceholder: "Cole o conteúdo do documento...",
            },
        },
    },
    fr: {
        identity: {
            loading: "Chargement des suggestions...",
            pendingTitle: "Suggestions en attente",
            suggestionCount: "{count, plural, one {# suggestion} other {# suggestions}}",
            contactA: "Contact A",
            contactB: "Contact B",
            stats: { pending: "En attente", approved: "Approuvées", rejected: "Rejetées" },
            empty: {
                title: "Aucune suggestion en attente",
                description: "Lorsque le système détecte des contacts en double entre canaux, ils apparaîtront ici.",
            },
            matchType: { phone: "Téléphone", email: "Email" },
            toast: {
                merged: "Contacts fusionnés avec succès.",
                rejected: "Suggestion rejetée.",
            },
        },
        users: {
            subtitleStats: "{total} utilisateurs · {active} actifs · {agents} agents",
            stats: { total: "Total", admins: "Administrateurs", agents: "Agents", active: "Actifs" },
            filter: { allRoles: "Tous les rôles" },
            headers: {
                user: "Utilisateur", email: "Email", role: "Rôle",
                tenant: "Entreprise", status: "Statut", registered: "Inscrit",
            },
            modal: {
                title: "Nouvel utilisateur",
                firstName: "Prénom", firstNamePlaceholder: "Jean",
                lastName: "Nom", lastNamePlaceholder: "Dupont",
                email: "Email", emailPlaceholder: "jean@entreprise.com",
                password: "Mot de passe", passwordPlaceholder: "Minimum 6 caractères",
                role: "Rôle",
                tenantIdLabel: "ID entreprise (optionnel)",
                tenantIdPlaceholder: "UUID de l'entreprise",
            },
            toast: { created: "Utilisateur créé avec succès" },
        },
        knowledge: {
            hash: "Hash",
            approve: "Approuver",
            chunk: "Fragment",
            searchPlaceholder: "Recherchez dans la connaissance comme l'IA le ferait...",
            searchButton: "Rechercher",
            empty: {
                library: "Aucune ressource dans la base de connaissances.",
                search: "Aucun résultat.",
            },
            status: { draft: "Brouillon", approved: "Approuvé", archived: "Archivé" },
            modal: {
                title: "Nouvelle ressource",
                titleLabel: "Titre de la ressource",
                titlePlaceholder: "FAQ du cours...",
                contentLabel: "Contenu texte",
                contentPlaceholder: "Collez le contenu du document...",
            },
        },
    },
};

function deepMerge(a, b) {
    for (const k of Object.keys(b)) {
        if (typeof b[k] === "object" && b[k] !== null && !Array.isArray(b[k]) && typeof a[k] === "object" && a[k] !== null) {
            deepMerge(a[k], b[k]);
        } else {
            a[k] = b[k];
        }
    }
    return a;
}

for (const [lang, payload] of Object.entries(data)) {
    const file = path.join(__dirname, "..", "apps", "dashboard", "messages", `${lang}.json`);
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [ns, keys] of Object.entries(payload)) {
        j[ns] = j[ns] || {};
        deepMerge(j[ns], keys);
    }
    fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n", "utf8");
    console.log(`${lang}.json — merged identity/users/knowledge keys`);
}
