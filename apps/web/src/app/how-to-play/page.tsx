import type { Metadata } from "next";
import { PlaceholderScreen } from "@/components/placeholder-screen";

export const metadata: Metadata = {
  title: "How to Play · monkeyLuka",
};

export default function HowToPlayPage() {
  return (
    <PlaceholderScreen
      eyebrow="How to Play"
      title="Instructions coming soon"
      description="Rules and controls will live here before the game launches."
    />
  );
}
