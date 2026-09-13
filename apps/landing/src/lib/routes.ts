export const routes = {
  home: "/",
  solutions: "/soluciones",
  solutionDetail: (slug: string) => `/soluciones/${slug}`,
  product: "/producto",
  productAgent: "/producto/agente-ia",
  productChannels: "/producto/canales",
  productBooking: "/producto/reservas",
  productCrm: "/producto/crm",
  productAndroid: "/producto/app-android",
  pricing: "/precios",
  // The canonical answer to "who charges me what". Linked from every surface
  // that shows a price or a CTA, so the three payments cannot be discovered on
  // somebody else's invoice.
  whatsappCosts: "/costos-whatsapp",
  compareMetaBusinessAgent: "/comparar/meta-business-agent",
  support: "/support",
  privacy: "/privacy",
  terms: "/terms",
  dataPolicy: "/data-policy",
  dataDeletion: "/data-deletion",
} as const;
