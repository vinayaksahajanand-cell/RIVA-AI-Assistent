"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * RIVA AI mark: two stacked document pages with a research "spark" — an original design.
 * `tone="light"` draws a white tile with purple pages for use on purple surfaces (sidebars).
 */
export function LogoMark({
  className,
  title = "RIVA AI",
  tone = "default",
}: {
  className?: string;
  title?: string;
  tone?: "default" | "light";
}) {
  const id = useId().replace(/:/g, "");
  const light = tone === "light";
  const ink = light ? "#FFFFFF" : "#6D28D9";
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className={cn("size-8 shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`riva-bg-${id}`} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={light ? "#FFFFFF" : "#A78BFA"} />
          <stop offset="1" stopColor={light ? "#EDE9FE" : "#6D28D9"} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#riva-bg-${id})`} />
      <rect x="7.5" y="8.5" width="11" height="15" rx="2.6" fill={light ? "#A78BFA" : "#fff"} fillOpacity={light ? ".7" : ".5"} />
      <rect x="11" y="11" width="11.5" height="15" rx="2.6" fill={light ? "#6D28D9" : "#fff"} />
      <rect x="13.6" y="15.4" width="6.4" height="1.5" rx=".75" fill={ink} fillOpacity=".75" />
      <rect x="13.6" y="18.6" width="4.6" height="1.5" rx=".75" fill={ink} fillOpacity=".5" />
      <rect x="13.6" y="21.8" width="5.6" height="1.5" rx=".75" fill={ink} fillOpacity=".35" />
      <path d="M23.6 4.6l.95 2.4 2.4.95-2.4.95-.95 2.4-.95-2.4-2.4-.95 2.4-.95z" fill={light ? "#7C3AED" : "#fff"} />
    </svg>
  );
}

export function Logo({
  className,
  compact = false,
  inverted = false,
}: {
  className?: string;
  compact?: boolean;
  /** White wordmark for purple surfaces. */
  inverted?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark tone={inverted ? "light" : "default"} />
      {!compact && (
        <span className={cn("text-[15px] font-semibold tracking-tight", inverted ? "text-white" : "text-foreground")}>
          RIVA <span className={inverted ? "text-violet-200" : "text-primary"}>AI</span>
        </span>
      )}
    </span>
  );
}
