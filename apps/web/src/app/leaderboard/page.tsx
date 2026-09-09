import type { Metadata } from "next";
import { PlaceholderScreen } from "@/components/placeholder-screen";
import { IconTrophy } from "@/components/icons";

export const metadata: Metadata = {
  title: "Leaderboard",
};

export default function LeaderboardPage() {
  return (
    <PlaceholderScreen
      eyebrow="Leaderboard"
      title="No scores yet"
      description="Once games are live, the top monkeys get crowned here. For now the jungle is still deciding who’s boss."
      icon={<IconTrophy className="size-7 text-emerald-300" />}
    />
  );
}
