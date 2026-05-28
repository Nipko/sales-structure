export type ChannelKey = "whatsapp" | "instagram" | "messenger" | "telegram" | "email";

export interface ChannelSkin {
  name: string;
  headerBg: string;
  bodyBg: string;
  accent: string;
  outgoingBg: string;
  outgoingText: string;
  incomingBg: string;
  incomingText: string;
  statusText: string;
  logoSrc: string;
}

export const CHANNELS: Record<ChannelKey, ChannelSkin> = {
  whatsapp: {
    name: "WhatsApp",
    headerBg: "linear-gradient(135deg, #075E54, #128C7E)",
    bodyBg: "#0b141a",
    accent: "#25D366",
    outgoingBg: "#005c4b",
    outgoingText: "#e9edef",
    incomingBg: "#1f2c33",
    incomingText: "#e9edef",
    statusText: "en línea",
    logoSrc: "/logos/whatsapp.svg",
  },
  instagram: {
    name: "Instagram",
    headerBg: "linear-gradient(135deg, #833AB4, #E1306C, #F77737)",
    bodyBg: "#121212",
    accent: "#E1306C",
    outgoingBg: "#3797f0",
    outgoingText: "#ffffff",
    incomingBg: "#262626",
    incomingText: "#f5f5f5",
    statusText: "Active now",
    logoSrc: "/logos/instagram.svg",
  },
  messenger: {
    name: "Messenger",
    headerBg: "linear-gradient(135deg, #006AFF, #00C6FF)",
    bodyBg: "#0a0a0a",
    accent: "#006AFF",
    outgoingBg: "#0084ff",
    outgoingText: "#ffffff",
    incomingBg: "#303030",
    incomingText: "#e4e6eb",
    statusText: "Active",
    logoSrc: "/logos/messenger.svg",
  },
  telegram: {
    name: "Telegram",
    headerBg: "linear-gradient(135deg, #0088CC, #229ED9)",
    bodyBg: "#0e1621",
    accent: "#3390ec",
    outgoingBg: "#2b5278",
    outgoingText: "#f5f5f5",
    incomingBg: "#182533",
    incomingText: "#f5f5f5",
    statusText: "en línea",
    logoSrc: "",
  },
  email: {
    name: "Email",
    headerBg: "linear-gradient(135deg, #1e293b, #0f172a)",
    bodyBg: "#0f172a",
    accent: "#f43f5e",
    outgoingBg: "#3b82f6",
    outgoingText: "#ffffff",
    incomingBg: "#1e293b",
    incomingText: "#f8fafc",
    statusText: "Conexión segura",
    logoSrc: "",
  },
};
