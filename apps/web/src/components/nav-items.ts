/**
 * Shared site navigation. Order matters: it drives the header and footer
 * link rows. Keep in sync with the menu on the home page.
 */
export const NAV_ITEMS = [
  { href: "/play", label: "Play" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/how-to-play", label: "How to Play" },
] as const;
