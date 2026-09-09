"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArenaState,
  MAX_PLAYER_NAME_LENGTH,
  ROOM_NAMES,
} from "@monkeyluka/shared";
import { colyseusClient } from "@/lib/colyseus";
import { createArenaGame, type ArenaRoom } from "@/game/arena-game";
import { IconPlay } from "@/components/icons";

type Phase = "idle" | "naming" | "joining" | "playing";

/**
 * The Play screen: a menu with a Play button that first asks for the name to
 * show on the leaderboard, then joins the Colyseus arena room and boots the
 * Phaser client. Foundation only — matchmaking + a rendered placeholder scene.
 */
export function PlayScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<ArenaRoom | null>(null);
  const gameRef = useRef<
    Awaited<ReturnType<typeof createArenaGame>> | null
  >(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const dialogOpen = phase === "naming" || phase === "joining";

  // Boot Phaser once a room has been joined and its mount div exists.
  useEffect(() => {
    if (phase !== "playing" || !mountRef.current || !roomRef.current) return;
    let disposed = false;
    void createArenaGame(mountRef.current, roomRef.current).then((game) => {
      if (disposed) {
        game.destroy(true);
        return;
      }
      gameRef.current = game;
    });
    return () => {
      disposed = true;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [phase]);

  // Tear down everything when the screen unmounts (e.g. navigating away).
  useEffect(
    () => () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      roomRef.current?.leave().catch(() => {});
      roomRef.current = null;
    },
    [],
  );

  // Focus the name field whenever the dialog opens.
  useEffect(() => {
    if (dialogOpen && phase === "naming") {
      inputRef.current?.focus();
    }
  }, [dialogOpen, phase]);

  // Escape closes the dialog (not while a join is in flight).
  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "joining") {
        setPhase("idle");
        setError(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen, phase]);

  const openDialog = useCallback(() => {
    setError(null);
    setPhase("naming");
  }, []);

  const closeDialog = useCallback(() => {
    if (phase === "joining") return;
    setError(null);
    setPhase("idle");
  }, [phase]);

  const confirmPlay = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name to show on the leaderboard.");
      return;
    }
    if (trimmed.length > MAX_PLAYER_NAME_LENGTH) {
      setError(`Keep it under ${MAX_PLAYER_NAME_LENGTH} characters.`);
      return;
    }

    setError(null);
    setPhase("joining");
    try {
      const room = await colyseusClient.joinOrCreate(
        ROOM_NAMES.arena,
        { name: trimmed },
        ArenaState,
      );
      roomRef.current = room;
      setPhase("playing");
    } catch (err) {
      console.error("Failed to join the arena:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not join the arena. Is the game server running?",
      );
      setPhase("naming");
    }
  }, [name]);

  const exitToMenu = useCallback(() => {
    setPhase("idle");
    roomRef.current?.leave().catch(() => {});
    roomRef.current = null;
  }, []);

  if (phase === "playing") {
    return (
      <div className="relative h-dvh w-full overflow-hidden bg-zinc-950">
        <div ref={mountRef} className="h-full w-full" />
        <button
          type="button"
          onClick={exitToMenu}
          className="absolute top-4 left-4 z-10 inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/70 px-4 py-2 text-sm font-semibold text-zinc-200 backdrop-blur transition hover:border-amber-300/40 hover:text-white active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          ← Exit
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16 sm:px-8 compact:py-6">
      {/* Ambient backdrop, mirroring the menu */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="animate-drift absolute left-1/2 top-6 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-amber-400/[0.07] blur-[120px]" />
        <div className="animate-drift absolute -right-24 -bottom-28 h-80 w-80 rounded-full bg-emerald-400/[0.08] blur-[110px] [animation-delay:-9s]" />
      </div>

      <section className="animate-rise relative w-full max-w-md rounded-[1.75rem] border border-white/10 bg-white/[0.03] px-8 py-12 text-center shadow-[0_30px_90px_-24px_rgba(0,0,0,0.7)] backdrop-blur-md compact:rounded-2xl compact:px-5 compact:py-6">
        <div
          aria-hidden
          className="absolute inset-x-10 top-0 h-px bg-linear-to-r from-transparent via-amber-300/50 to-transparent"
        />

        <div className="animate-bob mx-auto grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] shadow-[0_12px_30px_-12px_rgba(251,191,36,0.45)] compact:size-11">
          <IconPlay className="size-6 text-amber-300 compact:size-5" />
        </div>

        <p className="mt-6 text-[0.7rem] font-semibold tracking-[0.35em] text-amber-300/90 uppercase compact:mt-2">
          Arena
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 compact:text-xl">
          Ready to play?
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-zinc-400 compact:text-xs">
          Jump into the arena and grab the loot. First, tell us the name you
          want on the leaderboard.
        </p>

        <button
          type="button"
          onClick={openDialog}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-linear-to-b from-amber-300 to-amber-500 px-8 py-4 text-lg font-extrabold tracking-wide text-zinc-950 shadow-[0_18px_50px_-14px_rgba(251,191,36,0.55)] ring-1 ring-inset ring-amber-200/50 transition duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 compact:px-6 compact:py-2.5 compact:text-base"
        >
          <IconPlay className="size-5 text-zinc-900 compact:size-4" />
          Play
        </button>
      </section>

      {/* Name dialog */}
      {dialogOpen ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && phase === "naming") {
              closeDialog();
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
                  void confirmPlay();
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
                  onChange={(event) => setName(event.target.value)}
                  maxLength={MAX_PLAYER_NAME_LENGTH}
                  placeholder="e.g. BananaBandit"
                  autoComplete="nickname"
                  disabled={phase === "joining"}
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
                    onClick={closeDialog}
                    disabled={phase === "joining"}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/5 hover:text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 compact:px-3 compact:py-2 compact:text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={phase === "joining"}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-linear-to-b from-amber-300 to-amber-500 px-5 py-2.5 text-sm font-extrabold text-zinc-950 shadow-[0_10px_30px_-10px_rgba(251,191,36,0.6)] ring-1 ring-inset ring-amber-200/50 transition duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 compact:px-4 compact:py-2 compact:text-xs"
                  >
                    {phase === "joining" ? (
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
      ) : null}
    </div>
  );
}
