"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  JungleState,
  MAX_PLAYER_NAME_LENGTH,
  ROOM_NAMES,
} from "@monkeyluka/shared";
import { colyseusClient } from "@/lib/colyseus";
import { createJungleGame, type JungleRoom } from "@/game/jungle-game";
import { SiteHeader } from "@/components/site-header";
import { NameDialog } from "@/components/name-dialog";
import { PlayMenu } from "@/components/play-menu";

type Phase = "idle" | "naming" | "joining" | "playing";

/**
 * The Play screen: a menu with a Play button that first asks for the name to
 * show on the leaderboard, then joins the Colyseus jungle room and boots the
 * Phaser client. Owns the join state machine and the Phaser mount lifecycle;
 * the menu card and the name dialog are presentational children.
 */
export function PlayScreen() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<JungleRoom | null>(null);
  const gameRef = useRef<
    Awaited<ReturnType<typeof createJungleGame>> | null
  >(null);
  const mountRef = useRef<HTMLDivElement | null>(null);

  const dialogOpen = phase === "naming" || phase === "joining";

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
        ROOM_NAMES.jungle,
        { name: trimmed },
        JungleState,
      );
      roomRef.current = room;
      setPhase("playing");
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
