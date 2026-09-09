import Link from "next/link";
import { NAV_ITEMS } from "@/components/nav-items";

/** Footer used on interior pages; doubles as the mobile nav fallback. */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-5 px-4 py-8 sm:px-6 md:flex-row md:justify-between">
        <p className="text-xs text-zinc-500">
          © {new Date().getFullYear()} monkeyLuka · the jungle&apos;s most
          chaotic multiplayer game
        </p>
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
        >
          {NAV_ITEMS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-full px-1.5 py-1 text-sm text-zinc-400 transition hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
            >
              {label}
            </Link>
          ))}
          <Link
            href="/"
            className="rounded-full px-1.5 py-1 text-sm font-medium text-zinc-200 transition hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            Menu
          </Link>
        </nav>
      </div>
    </footer>
  );
}
