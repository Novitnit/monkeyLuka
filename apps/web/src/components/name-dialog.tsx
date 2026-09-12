"use client";

import { useEffect, useRef } from "react";
import { MAX_PLAYER_NAME_LENGTH } from "@monkeyluka/shared";
import { IconPlay } from "@/components/icons";

/**
 * Dialog that asks for the leaderboard name before joining the jungle.
 * Owns the input autofocus and the Escape-to-close behaviour; the join
 * itself is orchestrated by the Play screen (`busy` disables the form and
 * shows the spinner while a join is in flight).
 */
export function NameDialog({
  open,
  busy,
  name,
  error,
  onNameChange,
  onConfirm,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  name: string;
  error: string | null;
  onNameChange(name: string): void;
  onConfirm(): void;
  onClose(): void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the name field whenever the dialog opens in editable state.
  useEffect(() => {
    if (open && !busy) {
      inputRef.current?.focus();
    }
  }, [open, busy]);

  // Escape closes the dialog (not while a join is in flight).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 px-6 backdrop-blur-sm compact:px-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-name-title"
        className="animate-rise relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/95 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] compact:max-w-xs"
      >
        <div
          aria-hidden
          className="absolute inset-x-10 top-0 h-px bg-linear-to-r from-transparent via-amber-300/50 to-transparent"
        />
        <div className="px-7 pt-7 pb-6 compact:px-5 compact:pt-5 compact:pb-4">
          <h2
            id="play-name-title"
            className="text-xl font-bold tracking-tight text-zinc-50 compact:text-lg"
          >
            Enter your name
          </h2>
          <p className="mt-1.5 text-sm text-zinc-400 compact:text-xs">
            This is the name players see on the leaderboard.
          </p>

          <form
            className="mt-5"
            onSubmit={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            <label htmlFor="player-name" className="sr-only">
              Player name
            </label>
            <input
              ref={inputRef}
              id="player-name"
              type="text"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={MAX_PLAYER_NAME_LENGTH}
              placeholder="e.g. BananaBandit"
              autoComplete="nickname"
              disabled={busy}
              className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/30 focus:outline-none disabled:opacity-60 compact:px-3.5 compact:py-2.5 compact:text-sm"
            />
            <p className="mt-1.5 text-right text-[11px] text-zinc-600">
              {name.length}/{MAX_PLAYER_NAME_LENGTH}
            </p>

            {error ? (
              <p
                role="alert"
                className="mt-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-300 compact:text-xs"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-3 compact:mt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/5 hover:text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 compact:px-3 compact:py-2 compact:text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-linear-to-b from-amber-300 to-amber-500 px-5 py-2.5 text-sm font-extrabold text-zinc-950 shadow-[0_10px_30px_-10px_rgba(251,191,36,0.6)] ring-1 ring-inset ring-amber-200/50 transition duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 compact:px-4 compact:py-2 compact:text-xs"
              >
                {busy ? (
                  <>
                    <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-zinc-900/30 border-t-zinc-900" />
                    Joining…
                  </>
                ) : (
                  <>
                    <IconPlay className="size-4 text-zinc-900" />
                    Play
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
