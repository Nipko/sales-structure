export interface NavItem {
  labelKey: string;
  href: string;
}

export interface MegaMenuItem {
  labelKey: string;
  items: { labelKey: string; descKey: string; href: string; emoji?: string }[];
}

export const NAV_LINKS: NavItem[] = [
  { labelKey: "navSolutions", href: "/soluciones" },
  { labelKey: "navProduct", href: "/producto" },
  { labelKey: "navPricing", href: "/precios" },
];

export const SOLUTIONS_MENU: MegaMenuItem = {
  labelKey: "navSolutions",
  items: [
    { labelKey: "menuHealth", descKey: "menuHealthDesc", href: "/soluciones/salud", emoji: "🩺" },
    { labelKey: "menuRestaurants", descKey: "menuRestaurantsDesc", href: "/soluciones/restaurantes", emoji: "🍽️" },
    { labelKey: "menuRealEstate", descKey: "menuRealEstateDesc", href: "/soluciones/inmobiliaria", emoji: "🏠" },
    { labelKey: "menuBeauty", descKey: "menuBeautyDesc", href: "/soluciones/belleza", emoji: "💇‍♀️" },
    { labelKey: "menuGym", descKey: "menuGymDesc", href: "/soluciones/gimnasios", emoji: "💪" },
    { labelKey: "menuTourism", descKey: "menuTourismDesc", href: "/soluciones/turismo", emoji: "✈️" },
    { labelKey: "menuEducation", descKey: "menuEducationDesc", href: "/soluciones/educacion", emoji: "📚" },
    { labelKey: "menuInsurance", descKey: "menuInsuranceDesc", href: "/soluciones/seguros", emoji: "🛡️" },
  ],
};

export const PRODUCT_MENU: MegaMenuItem = {
  labelKey: "navProduct",
  items: [
    { labelKey: "menuAgent", descKey: "menuAgentDesc", href: "/producto/agente-ia", emoji: "🤖" },
    { labelKey: "menuChannels", descKey: "menuChannelsDesc", href: "/producto/canales", emoji: "💬" },
    { labelKey: "menuBooking", descKey: "menuBookingDesc", href: "/producto/reservas", emoji: "📅" },
    { labelKey: "menuCrm", descKey: "menuCrmDesc", href: "/producto/crm", emoji: "📊" },
    { labelKey: "menuAndroid", descKey: "menuAndroidDesc", href: "/producto/app-android", emoji: "📱" },
  ],
};

export const FOOTER_SECTIONS = [
  {
    titleKey: "footerProduct",
    links: [
      { labelKey: "footerSolutions", href: "/soluciones" },
      { labelKey: "footerFeatures", href: "/#herramientas" },
      { labelKey: "footerPricing", href: "/precios" },
      { labelKey: "footerDemo", href: "/#flujo" },
    ],
  },
  {
    titleKey: "footerCompany",
    links: [
      { labelKey: "footerSupport", href: "/support" },
      { labelKey: "footerContact", href: "mailto:it.executive@parallext.com" },
    ],
  },
  {
    titleKey: "footerLegal",
    links: [
      { labelKey: "footerPrivacy", href: "/privacy" },
      { labelKey: "footerTerms", href: "/terms" },
      { labelKey: "footerDataPolicy", href: "/data-policy" },
      { labelKey: "footerDataDeletion", href: "/data-deletion" },
    ],
  },
];
