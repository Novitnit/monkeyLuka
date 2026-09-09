import type { Metadata } from "next";
import { PlaceholderScreen } from "@/components/placeholder-screen";

export const metadata: Metadata = {
  title: "Play · monkeyLuka",
};

export default function PlayPage() {
  return (
    <PlaceholderScreen
      eyebrow="Play"
      title="Game coming soon"
      description="The monkey business hasn't started yet. This screen will host the game."
    />
  );
}
