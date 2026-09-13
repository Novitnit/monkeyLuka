"use client";

import { AmbientBackdrop, BackToMenuLink } from "@/components/chrome";
import { IconPlay } from "@/components/icons";

/**
 * The pre-game menu card: jungle eyebrow + pitch, the Play CTA that opens
 * the name dialog, and a way back to the main menu. Pure presentation — the
 * Play screen decides what happens on Play.
 */
export function PlayMenu({ onPlay }: { onPlay(): void }) {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center px-6 py-[clamp(0.5rem,3vh,4rem)] sm:px-8 compact:py-6 short:py-2">
      <AmbientBackdrop />

      {/* Scale wrapper (not on the animated card itself: `animate-rise`
          fills its keyframe transform, which would swallow the scale).
          `micro` = ultra-short fold-cover screens where even the compact
          header would push the card off-screen — the card visually shrinks
          so it still fits, centered, with nothing cropped. */}
      <div className="micro:w-full micro:scale-[0.78]">
        <section className="animate-rise relative w-full max-w-md rounded-[1.75rem] border border-white/10 bg-white/[0.03] px-8 py-12 text-center shadow-[0_30px_90px_-24px_rgba(0,0,0,0.7)] backdrop-blur-md compact:rounded-2xl compact:px-5 compact:py-6 short:py-4 short:pt-3">
        <div
          aria-hidden
          className="absolute inset-x-10 top-0 h-px bg-linear-to-r from-transparent via-amber-300/50 to-transparent"
        />

        <div className="animate-bob mx-auto grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] shadow-[0_12px_30px_-12px_rgba(251,191,36,0.45)] compact:size-11 short:size-10">
          <IconPlay className="size-6 text-amber-300 compact:size-5 short:size-4" />
        </div>

        <p className="mt-6 text-[0.7rem] font-semibold tracking-[0.35em] text-amber-300/90 uppercase compact:mt-2 short:mt-1">
          Jungle
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 compact:text-xl short:mt-1 short:text-lg">
          Ready to play?
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-zinc-400 compact:text-xs short:mt-1.5 short:leading-snug">
          Jump into the jungle and grab the loot. First, tell us the name you
          want on the leaderboard.
        </p>

        <button
          type="button"
          onClick={onPlay}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-linear-to-b from-amber-300 to-amber-500 px-8 py-4 text-lg font-extrabold tracking-wide text-zinc-950 shadow-[0_18px_50px_-14px_rgba(251,191,36,0.55)] ring-1 ring-inset ring-amber-200/50 transition duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 compact:px-6 compact:py-2.5 compact:text-base short:mt-3 short:py-2 short:text-sm"
        >
          <IconPlay className="size-5 text-zinc-900 compact:size-4" />
          Play
        </button>

        <div className="mt-6 compact:mt-3 short:mt-2">
          <BackToMenuLink />
        </div>
        </section>
      </div>
    </main>
  );
}
