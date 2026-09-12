import type { ComponentType, SVGProps } from "react";
import { IconBookOpen, IconPlay, IconTrophy } from "@/components/icons";

/**
 * Shared site navigation — the single source of truth for the header/footer
 * link rows AND the home-page menu (order matters). The home menu
 * additionally renders `icon` and styles `primary` as its CTA.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Home-menu icon; header/footer rows don't render it. */
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Marks the primary home-menu CTA (amber gradient button). */
  primary?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/play", label: "Play", icon: IconPlay, primary: true },
  { href: "/leaderboard", label: "Leaderboard", icon: IconTrophy },
  { href: "/how-to-play", label: "How to Play", icon: IconBookOpen },
];
