import type { Metadata } from "next";
import { PlaceholderScreen } from "@/components/placeholder-screen";
import { IconBookOpen } from "@/components/icons";

export const metadata: Metadata = {
  title: "How to Play",
};

export default function HowToPlayPage() {
  return (
    <PlaceholderScreen
      eyebrow="How to Play"
      title="Instructions are coming"
      description="Controls, bananas and scoring rules will be spelled out here before the game launches. Hang tight, future top monkey."
      icon={<IconBookOpen className="size-7 text-sky-300" />}
    />
  );
}
