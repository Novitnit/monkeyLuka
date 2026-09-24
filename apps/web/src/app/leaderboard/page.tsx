import type { Metadata } from "next";
import {
  formatLeaderboardTime,
  leaderboardTimeIso,
  readLeaderboard,
} from "@/lib/leaderboard";
import { AmbientBackdrop, BackToMenuLink } from "@/components/chrome";
import { SiteHeader } from "@/components/site-header";
import { IconTrophy } from "@/components/icons";

export const metadata: Metadata = {
  title: "Leaderboard",
};

// The runs live in the server's SQLite file — read them at request time,
// never at build (no prerender, no cached snapshot).
export const dynamic = "force-dynamic";

/** Podium-ish accent for the top three rows (1 = best). */
const RANK_BADGE: Record<number, string> = {
  1: "border-amber-300/40 bg-amber-300/10 text-amber-300",
  2: "border-zinc-300/30 bg-white/5 text-zinc-200",
  3: "border-orange-500/40 bg-orange-500/10 text-orange-300",
};

export default async function LeaderboardPage() {
  const runs = readLeaderboard();

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <SiteHeader />

      <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-[clamp(0.5rem,3vh,6rem)] sm:px-6 compact:py-3">
        <AmbientBackdrop />

        <section className="animate-rise relative w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.03] px-6 py-10 text-center shadow-[0_30px_90px_-24px_rgba(0,0,0,0.7)] backdrop-blur-md sm:px-12 compact:rounded-2xl compact:px-5 compact:py-4">
          {/* Amber hairline across the top edge */}
          <div
            aria-hidden
            className="absolute inset-x-10 top-0 h-px bg-linear-to-r from-transparent via-amber-300/50 to-transparent"
          />

          <div className="animate-bob relative mx-auto grid size-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] shadow-[0_12px_30px_-12px_rgba(251,191,36,0.45)] compact:size-11">
            <IconTrophy className="size-7 text-emerald-300" />
          </div>

          <p className="mt-8 text-[0.7rem] font-semibold tracking-[0.35em] text-amber-300/90 uppercase compact:mt-1.5">
            Leaderboard
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance text-zinc-50 sm:text-4xl compact:mt-1 compact:text-lg">
            Fastest monkeys, best times first
          </h1>

          {runs.length === 0 ? (
            <p className="mx-auto mt-4 max-w-md leading-relaxed text-pretty text-zinc-400 compact:mt-1.5 compact:text-xs">
              No scores yet. Once games are live, the top monkeys get crowned
              here. For now the jungle is still deciding who&apos;s boss.
            </p>
          ) : (
            <ul
              className="mx-auto mt-6 max-h-[42dvh] space-y-1.5 overflow-y-auto pr-1 text-left compact:mt-3 compact:max-h-[46dvh] sm:mt-8"
              aria-label="Completed runs, fastest first"
            >
              {runs.map((run, index) => {
                const rank = index + 1;
                const badge = RANK_BADGE[rank] ?? "border-white/5 bg-white/[0.03] text-zinc-500";
                return (
                  <li
                    key={`${run.name}-${run.roomId}-${run.finishedAt}`}
                    className={
                      "flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 sm:gap-4 sm:px-4 compact:rounded-lg compact:px-2.5 compact:py-1.5 " +
                      (rank === 1 ? "border-amber-300/20 bg-amber-300/[0.04]" : "")
                    }
                  >
                    <span
                      className={
                        "grid size-7 shrink-0 place-items-center rounded-full border text-sm font-bold tabular-nums compact:size-6 compact:text-xs " +
                        badge
                      }
                      aria-hidden
                    >
                      {rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100 sm:text-base compact:text-xs">
                      {run.name}
                    </span>
                    <time
                      dateTime={leaderboardTimeIso(run.timeMs)}
                      className="shrink-0 font-mono text-sm font-semibold tabular-nums text-zinc-200 sm:text-base compact:text-xs"
                    >
                      {formatLeaderboardTime(run.timeMs)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-5 text-[0.7rem] tracking-wider text-zinc-600 compact:mt-2 compact:text-[0.65rem]">
            Shortest to longest · one entry per finished run
          </p>

          <div className="mt-8 compact:mt-3">
            <BackToMenuLink />
          </div>
        </section>
      </main>
    </div>
  );
}