"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toISODateInput } from "@/lib/format";
import type { AnalyticsFilters as Filters, CollectionOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

function rangeFor(days: number): Pick<Filters, "date_from" | "date_to"> {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { date_from: toISODateInput(from), date_to: toISODateInput(to) };
}

/** Single filter row above the charts: quick ranges, explicit dates, model and collection. */
export function AnalyticsFilters({
  value,
  onChange,
  models,
  collections,
}: {
  value: Filters;
  onChange: (f: Filters) => void;
  models: readonly string[];
  collections: readonly CollectionOut[];
}) {
  const invalidRange = Boolean(value.date_from && value.date_to && value.date_from > value.date_to);
  const active = Boolean(value.date_from || value.date_to || value.model || value.collection_id);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background p-3 lg:flex-row lg:flex-wrap lg:items-end">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Quick date range">
        {RANGES.map((r) => {
          const range = rangeFor(r.days);
          const selected = value.date_from === range.date_from && value.date_to === range.date_to;
          return (
            <Button
              key={r.days}
              size="sm"
              variant={selected ? "secondary" : "ghost"}
              aria-pressed={selected}
              className={cn(selected && "ring-1 ring-violet-200")}
              onClick={() => onChange({ ...value, ...rangeFor(r.days) })}
            >
              {r.label}
            </Button>
          );
        })}
        <Button
          size="sm"
          variant={!value.date_from && !value.date_to ? "secondary" : "ghost"}
          aria-pressed={!value.date_from && !value.date_to}
          onClick={() => onChange({ ...value, date_from: undefined, date_to: undefined })}
        >
          All time
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <div className="grid gap-1">
          <Label htmlFor="af-from" className="text-xs text-muted-foreground">From</Label>
          <Input
            id="af-from"
            type="date"
            className="h-8 w-full sm:w-38"
            value={value.date_from ?? ""}
            max={value.date_to}
            onChange={(e) => onChange({ ...value, date_from: e.target.value || undefined })}
            aria-invalid={invalidRange || undefined}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="af-to" className="text-xs text-muted-foreground">To</Label>
          <Input
            id="af-to"
            type="date"
            className="h-8 w-full sm:w-38"
            value={value.date_to ?? ""}
            min={value.date_from}
            onChange={(e) => onChange({ ...value, date_to: e.target.value || undefined })}
            aria-invalid={invalidRange || undefined}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="af-model" className="text-xs text-muted-foreground">Model</Label>
          <Select value={value.model ?? ALL} onValueChange={(v) => onChange({ ...value, model: v === ALL ? undefined : v })}>
            <SelectTrigger id="af-model" size="sm" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All models</SelectItem>
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="af-collection" className="text-xs text-muted-foreground">Collection</Label>
          <Select
            value={value.collection_id ?? ALL}
            onValueChange={(v) => onChange({ ...value, collection_id: v === ALL ? undefined : v })}
          >
            <SelectTrigger id="af-collection" size="sm" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All collections</SelectItem>
              {collections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {active && (
          <Button size="sm" variant="ghost" className="self-end" onClick={() => onChange({})}>
            <RotateCcw /> Reset
          </Button>
        )}
      </div>
      {invalidRange && <p className="text-xs text-destructive lg:basis-full">“From” must be on or before “To”.</p>}
    </div>
  );
}

export function filtersAreValid(f: Filters): boolean {
  return !(f.date_from && f.date_to && f.date_from > f.date_to);
}
