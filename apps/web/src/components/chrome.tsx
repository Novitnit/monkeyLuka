import Link from "next/link";

/**
 * Softly blurred amber/emerald glows drawn behind screen content. Shared by
 * the Play screen and the placeholder screens so the backdrop stays
 * visually identical everywhere it appears.
 */
export function AmbientBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="animate-drift absolute left-1/2 top-6 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-amber-400/[0.07] blur-[120px]" />
      <div className="animate-drift absolute -right-24 -bottom-28 h-80 w-80 rounded-full bg-emerald-400/[0.08] blur-[110px] [animation-delay:-9s]" />
    </div>
  );
}

/**
 * Pill link back to the main menu, shown under the primary content on the
 * Play screen and the placeholder screens.
 */
export function BackToMenuLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-zinc-200 backdrop-blur transition hover:border-amber-300/30 hover:bg-white/10 hover:text-white active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 compact:px-4 compact:py-1.5 compact:text-xs"
    >
      ← Back to the menu
    </Link>
  );
}
