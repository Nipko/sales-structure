import { Instagram, Facebook, Send, type LucideIcon } from "lucide-react";
import type { SecondaryChannel } from "../connect-channels";

/** The mark and colour each channel wears in the wizard, in one place. */
export const CHANNEL_VISUALS: Record<SecondaryChannel, { icon: LucideIcon; color: string }> = {
    instagram: { icon: Instagram, color: "#E4405F" },
    messenger: { icon: Facebook, color: "#0084FF" },
    telegram: { icon: Send, color: "#0088CC" },
};
