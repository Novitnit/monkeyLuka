import type { ReactNode } from "react";
import { AmbientBackdrop, BackToMenuLink } from "@/components/chrome";
import { SiteHeader } from "@/components/site-header";

/**
 * Shared shell for menu destinations whose features haven't landed yet
 * (`/play`, `/how-to-play`). Swap a route's page for real content as the
 * feature ships — keep SiteHeader/SiteFooter as the chrome. (`/leaderboard`
 * outgrew this: it renders real runs, see `src/lib/leaderboard.ts`.)
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
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <SiteHeader />

      <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-[clamp(0.5rem,3vh,6rem)] sm:px-6 compact:py-3">
        <AmbientBackdrop />

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
            <BackToMenuLink />
          </div>
        </section>
      </main>
    </div>
  );
}
