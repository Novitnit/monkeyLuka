import Link from "next/link";

/**
 * Lightweight stand-in screen for menu destinations that don't have real
 * content yet (`/play`, `/leaderboard`, `/how-to-play`). Replace each route's
 * page with real content as the feature lands.
 */
export function PlaceholderScreen({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-zinc-950 px-6 py-12 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_35%,rgba(250,204,21,0.07),transparent_70%)]"
      />

      <p className="text-xs font-semibold tracking-[0.25em] text-amber-300/80 uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-3 text-4xl font-bold text-zinc-50">{title}</h1>
      <p className="mt-4 max-w-md leading-relaxed text-zinc-400">{description}</p>

      <Link
        href="/"
        className="mt-10 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-semibold text-zinc-200 backdrop-blur transition hover:border-white/20 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        ← Back to Menu
      </Link>
    </main>
  );
}
