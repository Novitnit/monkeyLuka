"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  JungleState,
  MAX_PLAYER_NAME_LENGTH,
  ROOM_NAMES,
} from "@monkeyluka/shared";
import { CloseCode } from "@colyseus/sdk";
import { colyseusClient } from "@/lib/colyseus";
import {
  clearJungleSession,
  loadJungleSession,
  saveJungleSession,
} from "@/lib/jungle-session";
import { createJungleGame, type JungleRoom } from "@/game/jungle-game";
import { SiteHeader } from "@/components/site-header";
import { NameDialog } from "@/components/name-dialog";
import { PlayMenu } from "@/components/play-menu";

type Phase = "idle" | "naming" | "joining" | "resuming" | "playing";

/**
 * The Play screen: a menu with a Play button that first asks for the name to
 * show on the leaderboard, then joins the Colyseus jungle room and boots the
 * Phaser client. Owns the join state machine and the Phaser mount lifecycle;
 * the menu card and the name dialog are presentational children.
 *
 * Reconnection: when a session is live (stored in sessionStorage), a page
 * reload silently resumes it via `client.reconnect` into the seat the server
 * holds after a drop; mid-session network blips are reconnected by the
 * Colyseus SDK's built-in retry loop. Only when the seat is truly gone
 * (expired / room disposed) does the screen fall back to the menu.
 */
export function PlayScreen() {
  // Start straight in "resuming" when a live session survives the reload, so
  // the menu never flashes before the reconnect settles.
  //
  // SSR caveat: the initializer also runs server-side, where sessionStorage
  // doesn't exist, so SSR always computes "idle". The client's real value
  // (e.g. "resuming") must not be *rendered* until `booted` flips below —
  // otherwise the server-rendered menu and the client's Reconnecting screen
  // disagree during hydration and React aborts the tree.
  const [phase, setPhase] = useState<Phase>(() =>
    loadJungleSession() ? "resuming" : "idle",
  );
  // False until the client has hydrated: SSR can't know about the stored
  // session, so until then we render a neutral loader instead of branching
  // on a client-only value.
  const [booted, setBooted] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<JungleRoom | null>(null);
  const gameRef = useRef<
    Awaited<ReturnType<typeof createJungleGame>> | null
  >(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  // StrictMode double-invokes effects in dev; run the resume once per mount.
  const resumeStartedRef = useRef(false);
  // Liveness flag for the in-flight resume below: re-armed by every effect
  // run (including StrictMode's dev-only remount), so a reconnect that
  // resolves across the synthetic unmount is still adopted instead of being
  // immediately left. A real unmount (navigate away) leaves it false, which
  // drops the room instead of adopting a seat on a page nobody is looking at.
  const mountedRef = useRef(true);

  const dialogOpen = phase === "naming" || phase === "joining";

  // Flip the boot gate after hydration so the real phase may render (its
  // initializer read sessionStorage client-side only). Idempotent under
  // StrictMode's double effect run in dev.
  useEffect(() => {
    setBooted(true);
  }, []);

  // Boot Phaser once a room has been joined and its mount div exists.
  useEffect(() => {
    if (phase !== "playing" || !mountRef.current || !roomRef.current) return;
    let disposed = false;
    void createJungleGame(mountRef.current, roomRef.current).then((game) => {
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

  // Tear down everything when the screen unmounts (e.g. navigating away):
  // deliberate leave — no seat is held and the saved session is discarded.
  useEffect(
    () => () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      try {
        roomRef.current?.leave().catch(() => {});
      } catch {
        // The socket may already be gone (leave() on a closed ws throws).
      }
      roomRef.current = null;
      clearJungleSession();
    },
    [],
  );

  // Auto-resume a session that was live before this mount (i.e. a page
  // reload): re-enter the same room through the stored reconnection token.
  // The server holds the seat after a drop, so the player's name and last
  // position survive. Falls back to the menu (session cleared) when the
  // token expired — room disposed or server restarted.
  useEffect(() => {
    // Re-arm on every effect run: StrictMode's dev-only mount → unmount →
    // mount sequence clears this in the synthetic cleanup, so the remount's
    // run must bring it back or the still-in-flight reconnect below would be
    // dropped via `room.leave()` right after the server accepts it.
    mountedRef.current = true;

    const session = loadJungleSession();
    if (!session || resumeStartedRef.current) return;
    resumeStartedRef.current = true;

    void colyseusClient
      .reconnect(session.reconnectionToken, JungleState)
      .then((room) => {
        if (!mountedRef.current) {
          // Real unmount (navigate away) while the reconnect was in flight —
          // don't adopt a seat on a page nobody is looking at.
          room.leave().catch(() => {});
          return;
        }
        adoptRoom(room, session.name);
      })
      .catch((err: unknown) => {
        console.warn("Could not resume the jungle session:", err);
        if (!mountedRef.current) return;
        // Room/seat gone: start fresh, but keep the name so re-joining is
        // one click.
        clearJungleSession();
        setName(session.name);
        setPhase("idle");
      });

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const openDialog = useCallback(() => {
    setError(null);
    setPhase("naming");
  }, []);

  const closeDialog = useCallback(() => {
    if (phase === "joining") return;
    setError(null);
    setPhase("idle");
  }, [phase]);

  /**
   * A room is ready (fresh join or resumed). Make it the live room, persist
   * the session for future reloads, and watch for a terminal leave — a
   * deliberate exit routes through `exitToMenu`/unmount (which clear the
   * session first), so anything that fires here while `roomRef` still points
   * at this room means the connection is gone for good.
   *
   * Plain function (not memoized): it mutates `roomRef` and attaches a room
   * listener, which the react-hooks compiler can't preserve in a useCallback.
   */
  function adoptRoom(room: JungleRoom, displayName: string) {
    roomRef.current = room;
    saveJungleSession({
      reconnectionToken: room.reconnectionToken,
      name: displayName,
    });
    room.onLeave((code) => {
      if (roomRef.current !== room) return; // deliberate exit already handled
      roomRef.current = null;
      clearJungleSession();
      setPhase("idle");
      if (code !== CloseCode.CONSENTED) {
        setError(
          "Connection lost. The jungle dropped you — join again to keep playing.",
        );
      }
    });
    setPhase("playing");
  }

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
        ROOM_NAMES.jungle,
        { name: trimmed },
        JungleState,
      );
      adoptRoom(room, trimmed);
    } catch (err) {
      console.error("Failed to join the jungle:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not join the jungle. Is the game server running?",
      );
      setPhase("naming");
    }
  }, [name]);

  const exitToMenu = useCallback(() => {
    setPhase("idle");
    try {
      roomRef.current?.leave().catch(() => {});
    } catch {
      // leave() on a closed socket throws; the server frees the seat on its
      // own grace timer in that case.
    }
    roomRef.current = null;
    clearJungleSession();
  }, []);

  // SSR and the first client render both produce this same frame (the boot
  // gate is false on both), so hydration can't mismatch even when a live
  // session exists. After mount the effect flips `booted` and the real
  // phase — menu, reconnect, or game — takes over.
  if (!booted || phase === "resuming") {
    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-zinc-950">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/90 px-5 py-3 text-sm font-semibold text-zinc-200">
          <span className="inline-block size-4 animate-spin rounded-full border-2 border-amber-300/30 border-t-amber-300" />
          {booted ? "Reconnecting…" : "Loading…"}
        </div>
      </div>
    );
  }

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
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <SiteHeader />

      <PlayMenu onPlay={openDialog} />

      <NameDialog
        open={dialogOpen}
        busy={phase === "joining"}
        name={name}
        error={error}
        onNameChange={setName}
        onConfirm={confirmPlay}
        onClose={closeDialog}
      />
    </div>
  );
}
