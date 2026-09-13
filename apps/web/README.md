# @monkeyluka/web

Next.js 16 (App Router) frontend for **monkeyLuka** — the web app workspace in
the Bun monorepo. Run it from the repo root (`bun run dev` starts web +
server together, or `bun run dev:web` for this app only) → http://localhost:3000.

## What ships today

- A full-screen title menu over the jungle wallpaper (`src/app/page.tsx`)
- Placeholder feature pages: `/play`, `/leaderboard`, `/how-to-play`. They
  share `SiteHeader` / `SiteFooter` chrome plus the `PlaceholderScreen` card —
  replace each route with real content as the feature lands.
- A touch-device gate (`src/components/game-gate.tsx`): wrapped around the
  whole app in the root layout, it blocks rendering until coarse-pointer
  devices are in landscape AND full-screen (or PWA standalone). Desktop
  users pass straight through.
- On-screen touch controls during play (`src/components/touch-controls.tsx`):
  a bottom-left move pad + bottom-right jump/interact buttons render over
  the Phaser canvas on coarse-pointer devices and drive the same player
  input as the keyboard (`src/game/touch/touch-input.ts`).

## Layout conventions

- `src/components/icons.tsx` — shared inline SVG icon set (stroke-based)
- `src/components/nav-items.ts` — single source of truth for the nav links
- `src/components/placeholder-screen.tsx` + `src/components/site-header.tsx`
  / `site-footer.tsx` — shared chrome for the placeholder routes
- `src/components/game-gate.tsx` — full-screen/orientation gate for touch
  devices, rendered once from `src/app/layout.tsx`
- `src/hooks/use-fullscreen.ts`, `use-media-query.ts` — SSR-safe
  `useSyncExternalStore` hooks backing the gate
- Dark-only styling lives in `src/app/globals.css` (Tailwind v4 `@theme`)

## Notes

- No dependency on `@monkeyluka/shared` yet; if that changes, add the package
  to `transpilePackages` in `next.config.ts`.
- `tsc --noEmit` needs `.next/types` (generated on first `next dev`/`build`);
  typecheck from the repo root with `bun run typecheck`.
