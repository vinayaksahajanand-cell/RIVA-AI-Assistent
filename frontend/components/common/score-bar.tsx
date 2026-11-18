import { scoreTone, type ScoreTone } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<ScoreTone, string> = {
  good: "bg-emerald-500/85",
  fair: "bg-amber-400",
  poor: "bg-red-400",
  none: "bg-transparent",
};

/** Thin horizontal bar for a 0..100 score. Renders an empty track when the score is unknown. */
export function ScoreBar({
  value,
  higherIsBetter = true,
  className,
  label,
}: {
  value: number | null;
  higherIsBetter?: boolean;
  className?: string;
  label?: string;
}) {
  const tone = scoreTone(value, higherIsBetter);
  const width = value === null ? 0 : Math.max(2, Math.min(100, value));
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border/60", className)}
      role={value === null ? undefined : "meter"}
      aria-valuemin={value === null ? undefined : 0}
      aria-valuemax={value === null ? undefined : 100}
      aria-valuenow={value === null ? undefined : value}
      aria-label={label}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500", TONE_CLASS[tone])} style={{ width: `${width}%` }} />
    </div>
  );
}
