import type { Metadata } from "next";
import { PlaceholderScreen } from "@/components/placeholder-screen";
import { IconPlay } from "@/components/icons";

export const metadata: Metadata = {
  title: "Play",
};

export default function PlayPage() {
  return (
    <PlaceholderScreen
      eyebrow="Play"
      title="The arena is being prepped"
      description="Matchmaking and real-time monkey action land here. When the room is ready, this is where you jump in."
      icon={<IconPlay className="size-7 text-amber-300" />}
    />
  );
}