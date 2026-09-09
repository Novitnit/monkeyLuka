import type { ReactNode } from "react";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/**
 * Shared shell for menu destinations whose features haven't landed yet
 * (`/play`, `/leaderboard`, `/how-to-play`). Swap a route's page for real
 * content as the feature ships — keep SiteHeader/SiteFooter as the chrome.
 */
export function PlaceholderScreen({
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-16 sm:px-6 sm:py-24 compact:py-3">
        {/* Ambient backdrop */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="animate-drift absolute left-1/2 top-6 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-amber-400/[0.07] blur-[120px]" />
          <div className="animate-drift absolute -right-24 -bottom-28 h-80 w-80 rounded-full bg-emerald-400/[0.08] blur-[110px] [animation-delay:-9s]" />
        </div>

        <section className="animate-rise relative w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.03] px-6 py-14 text-center shadow-[0_30px_90px_-24px_rgba(0,0,0,0.7)] backdrop-blur-md sm:px-14 sm:py-16 compact:rounded-2xl compact:px-5 compact:py-4">
          {/* Amber hairline across the top edge */}
          <div
            aria-hidden
            className="absolute inset-x-10 top-0 h-px bg-linear-to-r from-transparent via-amber-300/50 to-transparent"
          />

          {icon ? (
            <div className="animate-bob relative mx-auto grid size-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] shadow-[0_12px_30px_-12px_rgba(251,191,36,0.45)] compact:size-11">
              {icon}
            </div>
          ) : null}

          <p className="mt-8 text-[0.7rem] font-semibold tracking-[0.35em] text-amber-300/90 uppercase compact:mt-1.5">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance text-zinc-50 sm:text-4xl compact:mt-1 compact:text-lg">
            {title}
          </h1>
          <p className="mx-auto mt-4 max-w-md leading-relaxed text-pretty text-zinc-400 compact:mt-1.5 compact:text-xs">
            {description}
          </p>

          <div className="mt-10 compact:mt-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-zinc-200 backdrop-blur transition hover:border-amber-300/30 hover:bg-white/10 hover:text-white active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 compact:px-4 compact:py-1.5 compact:text-xs"
            >
              ← Back to the menu
            </Link>
          </div>
        </section>
      </main>

      {/* <SiteFooter /> */}
    </div>
  );
}
