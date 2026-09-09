import type { Metadata } from "next";
import { PlaceholderScreen } from "@/components/placeholder-screen";

export const metadata: Metadata = {
  title: "Leaderboard · monkeyLuka",
};

export default function LeaderboardPage() {
  return (
    <PlaceholderScreen
      eyebrow="Leaderboard"
      title="No scores yet"
      description="Top players will show up here once games are being played."
    />
  );
}
