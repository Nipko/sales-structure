import type { Icon } from "../components/ui/Icon";

export interface NavItem {
  labelKey: string;
  href: string;
}

export interface MegaMenuItem {
  labelKey: string;
  items: { labelKey: string; descKey: string; href: string; icon: keyof typeof Icon }[];
}

export const NAV_LINKS: NavItem[] = [
  { labelKey: "navSolutions", href: "/soluciones" },
  { labelKey: "navProduct", href: "/producto" },
  { labelKey: "navPricing", href: "/precios" },
];

export const SOLUTIONS_MENU: MegaMenuItem = {
  labelKey: "navSolutions",
  items: [
    { labelKey: "menuHealth", descKey: "menuHealthDesc", href: "/soluciones/salud", icon: "shield" },
    { labelKey: "menuRestaurants", descKey: "menuRestaurantsDesc", href: "/soluciones/restaurantes", icon: "layers" },
    { labelKey: "menuRealEstate", descKey: "menuRealEstateDesc", href: "/soluciones/inmobiliaria", icon: "layers" },
    { labelKey: "menuBeauty", descKey: "menuBeautyDesc", href: "/soluciones/belleza", icon: "sparkles" },
    { labelKey: "menuGym", descKey: "menuGymDesc", href: "/soluciones/gimnasios", icon: "trendingUp" },
    { labelKey: "menuTourism", descKey: "menuTourismDesc", href: "/soluciones/turismo", icon: "calendar" },
    { labelKey: "menuEducation", descKey: "menuEducationDesc", href: "/soluciones/educacion", icon: "book" },
    { labelKey: "menuInsurance", descKey: "menuInsuranceDesc", href: "/soluciones/seguros", icon: "shield" },
  ],
};

export const PRODUCT_MENU: MegaMenuItem = {
  labelKey: "navProduct",
  items: [
    { labelKey: "menuAssist", descKey: "menuAssistDesc", href: "/producto/parallly-assist", icon: "sparkles" },
    { labelKey: "menuAgent", descKey: "menuAgentDesc", href: "/producto/agente-ia", icon: "bot" },
    { labelKey: "menuKnowledge", descKey: "menuKnowledgeDesc", href: "/producto/conocimiento", icon: "book" },
    { labelKey: "menuChannels", descKey: "menuChannelsDesc", href: "/producto/canales", icon: "inbox" },
    { labelKey: "menuBooking", descKey: "menuBookingDesc", href: "/producto/reservas", icon: "calendar" },
    { labelKey: "menuCrm", descKey: "menuCrmDesc", href: "/producto/crm", icon: "users" },
    { labelKey: "menuQuality", descKey: "menuQualityDesc", href: "/producto/calidad", icon: "shield" },
    { labelKey: "menuAndroid", descKey: "menuAndroidDesc", href: "/producto/app-android", icon: "inbox" },
    // Both of these answer a question a buyer asks before the trial, not after:
    // who charges me, and how do you compare with what Meta already gives me.
    // Leaving them for the footer would mean the answer arrives too late.
    { labelKey: "menuCosts", descKey: "menuCostsDesc", href: "/costos-whatsapp", icon: "layers" },
    { labelKey: "menuCompare", descKey: "menuCompareDesc", href: "/comparar/meta-business-agent", icon: "chart" },
  ],
};

export const FOOTER_SECTIONS = [
  {
    titleKey: "footerProduct",
    links: [
      { labelKey: "footerSolutions", href: "/soluciones" },
      { labelKey: "footerFeatures", href: "/producto" },
      { labelKey: "menuAssist", href: "/producto/parallly-assist" },
      { labelKey: "menuChannels", href: "/producto/canales" },
      { labelKey: "menuCrm", href: "/producto/crm" },
      { labelKey: "menuKnowledge", href: "/producto/conocimiento" },
      { labelKey: "menuQuality", href: "/producto/calidad" },
      { labelKey: "footerPricing", href: "/precios" },
      { labelKey: "footerCosts", href: "/costos-whatsapp" },
      { labelKey: "footerCompare", href: "/comparar/meta-business-agent" },
    ],
  },
  {
    titleKey: "footerCompany",
    links: [
      { labelKey: "menuBusinessMissing", href: "/soluciones#adaptabilidad" },
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
