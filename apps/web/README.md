# @monkeyluka/web

Next.js 16 (App Router) frontend for **monkeyLuka** — the web app workspace in
the Bun monorepo. Run it from the repo root (`bun run dev` starts web +
server together, or `bun run dev:web` for this app only) → http://localhost:3000.

## What ships today

- A full-screen title menu over the jungle wallpaper (`src/app/page.tsx`)
- Placeholder feature pages: `/play`, `/leaderboard`, `/how-to-play`. They
  share `SiteHeader` / `SiteFooter` chrome plus the `PlaceholderScreen` card —
  replace each route with real content as the feature lands.

## Layout conventions

- `src/components/icons.tsx` — shared inline SVG icon set (stroke-based)
- `src/components/nav-items.ts` — single source of truth for the nav links
- Dark-only styling lives in `src/app/globals.css` (Tailwind v4 `@theme`)

## Notes

- No dependency on `@monkeyluka/shared` yet; if that changes, add the package
  to `transpilePackages` in `next.config.ts`.
- `tsc --noEmit` needs `.next/types` (generated on first `next dev`/`build`);
  typecheck from the repo root with `bun run typecheck`.
