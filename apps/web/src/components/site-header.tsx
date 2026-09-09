import Link from "next/link";
import { NAV_ITEMS } from "@/components/nav-items";

/** Small amber "M" tile that doubles as the favicon monogram. */
function BrandMark() {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-[0.65rem] bg-linear-to-br from-amber-300 to-amber-600 shadow-[0_4px_14px_-4px_rgba(251,191,36,0.6)] transition-transform duration-200 group-hover:scale-105"
    >
      <svg viewBox="0 0 24 24" className="size-[18px]">
        <path
          d="M6 17V7l6 7 6-7v10"
          fill="none"
          stroke="#0a0e17"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * Sticky top bar for interior pages: wordmark home-link on the left, primary
 * nav on the right. The nav is desktop-only — on small screens the footer
 * row (visible at every size) is the way around.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="group inline-flex items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          <BrandMark />
          <span className="text-[17px] font-bold tracking-tight text-zinc-100 transition-colors group-hover:text-white">
            monkey<span className="text-amber-400">Luka</span>
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
          {NAV_ITEMS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-full px-3.5 py-2 text-sm font-medium text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
