import Image from "next/image";
import Link from "next/link";
import {
  IconBookOpen,
  IconChevronRight,
  IconPlay,
  IconTrophy,
} from "@/components/icons";

const menuItems = [
  {
    href: "/play",
    label: "Play",
    icon: IconPlay,
    primary: true,
  },
  {
    href: "/leaderboard",
    label: "Leaderboard",
    icon: IconTrophy,
    primary: false,
  },
  {
    href: "/how-to-play",
    label: "How to Play",
    icon: IconBookOpen,
    primary: false,
  },
] as const;

export default function Home() {
  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-background">
      {/* Full-bleed wallpaper */}
      <Image
        src="/mainBackground.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="pointer-events-none object-cover opacity-60"
      />

      {/* Scrims for text legibility */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-background/80 via-background/50 to-background"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-r from-background/70 via-transparent to-background/70"
      />

      {/* Ambient glows */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="animate-drift absolute -left-40 top-1/4 h-[26rem] w-[26rem] rounded-full bg-amber-500/10 blur-[110px]" />
        <div className="animate-drift absolute -right-32 bottom-8 h-[22rem] w-[22rem] rounded-full bg-emerald-500/10 blur-[100px] [animation-delay:-8s]" />
      </div>

      {/* Content */}
      {/* The flex column is height-constrained: the logo is a flexible,
          shrinkable child (min-h-0 + object-contain), so on short screens
          flexbox scales it down — preserving its aspect ratio — instead of
          letting anything run past the viewport. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-10 px-6 py-10 sm:gap-12 compact:gap-3 compact:py-2">
        <h1 className="sr-only">monkeyLuka — a monkey-powered multiplayer game</h1>
        <Image
          src="/logo.png"
          alt="monkeyLuka logo"
          width={2816}
          height={1536}
          priority
          sizes="(min-width: 768px) 672px, 90vw"
          className="min-h-0 aspect-[2816/1536] h-auto w-[min(90vw,42rem)] object-contain drop-shadow-[0_28px_60px_rgba(0,0,0,0.65)] compact:max-h-[34dvh]"
        />
        <p className="max-w-md text-center text-pretty text-sm leading-relaxed text-zinc-300 sm:text-base compact:mt-1.5 compact:text-xs">
          A monkey-powered multiplayer game — grab the loot, outsmart the
          crew, and race to the top of the jungle.
        </p>

        <nav
          aria-label="Main menu"
          className="mt-2 flex w-[min(19rem,100%)] flex-col gap-3 sm:w-[21rem] compact:mt-1 compact:gap-2"
        >
          {menuItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{ animationDelay: `${140 + index * 90}ms` }}
                className={
                  item.primary
                    ? "animate-rise group inline-flex items-center justify-center gap-3 rounded-2xl compact:px-6 compact:py-2 compact:text-base bg-linear-to-b from-amber-300 to-amber-500 px-8 py-4 text-xl font-extrabold tracking-wide text-zinc-950 shadow-[0_18px_50px_-14px_rgba(251,191,36,0.55)] ring-1 ring-inset ring-amber-200/50 transition duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                    : "animate-rise group inline-flex items-center justify-between gap-3 rounded-2xl compact:px-5 compact:py-2 compact:text-sm border border-white/10 bg-white/[0.04] px-6 py-3.5 text-base font-semibold text-zinc-100 backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.08] active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                }
              >
                <span className="inline-flex items-center gap-3">
                  <Icon
                    className={
                      item.primary
                        ? "size-5 text-zinc-900 compact:size-4"
                        : "size-5 text-amber-300/90 compact:size-4"
                    }
                  />
                  {item.label}
                </span>
                {item.primary ? null : (
                  <IconChevronRight className="size-4 text-zinc-500 transition group-hover:translate-x-0.5 group-hover:text-amber-300 compact:size-3.5" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <footer className="relative z-10 pb-7 text-center compact:pb-2">
        <p className="px-6 text-[11px] tracking-wide text-zinc-500/80">
          2026 monkeyLuka · A project by Novit
        </p>
      </footer>
    </main>
  );
}
