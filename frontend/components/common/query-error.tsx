"use client";

import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/services/http";
import { cn } from "@/lib/utils";

export function QueryError({ error, onRetry, className, title = "Couldn't load data" }: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-xl border border-red-200/70 bg-red-50/60 p-4 text-sm sm:flex-row sm:items-center",
        className,
      )}
    >
      <AlertTriangle className="size-4 shrink-0 text-red-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-red-800">{title}</p>
        <p className="text-red-700/90">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw /> Retry
        </Button>
      )}
    </div>
  );
}
