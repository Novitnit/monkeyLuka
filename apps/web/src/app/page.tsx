import Image from "next/image";
import Link from "next/link";

const menuItems = [
  { href: "/play", label: "Play", primary: true },
  { href: "/leaderboard", label: "Leaderboard", primary: false },
  { href: "/how-to-play", label: "How to Play", primary: false },
] as const;

export default function Home() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-zinc-950 px-6 py-12">
      {/* Full-bleed background image */}
      <Image
        src="/mainBackground.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="pointer-events-none object-cover z-0"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-zinc-950/60"
      />
      {/* Dark overlay for text legibility */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-zinc-950/60"
      />
      {/* Ambient glow behind the title */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_38%,rgba(250,204,21,0.10),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_45%_35%_at_85%_90%,rgba(16,185,129,0.12),transparent_70%)]"
      />

      <div className="relative flex w-full flex-1 flex-col items-center justify-center gap-12 sm:gap-16">
        <h1 className="sr-only">monkeyLuka</h1>

        <div className="flex w-full justify-center">
          <Image
            src="/logo.png"
            alt="monkeyLuka logo"
            width={2816}
            height={1536}
            priority
            sizes="(min-width: 768px) 736px, 90vw"
            className="h-auto w-[min(90vw,46rem)] drop-shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
          />
        </div>

        <nav aria-label="Main menu" className="flex w-[min(19rem,100%)] flex-col items-stretch gap-4">
          {menuItems.map(({ href, label, primary }) => (
            <Link
              key={href}
              href={href}
              className={
                primary
                  ? "inline-flex items-center justify-center rounded-2xl bg-gradient-to-b from-amber-300 to-amber-500 px-8 py-4 text-xl font-bold tracking-wide text-zinc-950 shadow-[0_16px_40px_-12px_rgba(251,191,36,0.55)] transition hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                  : "inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-8 py-3.5 text-lg font-semibold text-zinc-100 backdrop-blur transition hover:border-white/20 hover:bg-white/10 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
              }
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
