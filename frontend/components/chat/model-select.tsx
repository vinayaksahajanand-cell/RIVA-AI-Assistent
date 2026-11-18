"use client";

import { Cpu } from "lucide-react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

const DEFAULT = "__workspace_default__";

/** Model override for the next question; "Workspace default" sends `model: null`. */
export function ModelSelect({
  value,
  onChange,
  models,
  defaultModel,
  disabled,
}: {
  value: string | null;
  onChange: (model: string | null) => void;
  models: readonly string[];
  defaultModel: string | null;
  disabled?: boolean;
}) {
  const options = value && !models.includes(value) ? [...models, value] : models;
  return (
    <Select value={value ?? DEFAULT} onValueChange={(v) => onChange(v === DEFAULT ? null : v)} disabled={disabled}>
      <SelectTrigger
        size="sm"
        aria-label="Model"
        className="h-8 max-w-[190px] gap-1.5 border-0 bg-transparent px-2 text-[12.5px] text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
      >
        <Cpu className="size-3.5" aria-hidden />
        <SelectValue placeholder="Model" />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          <SelectLabel>Model</SelectLabel>
          <SelectItem value={DEFAULT}>
            Workspace default{defaultModel ? ` (${defaultModel})` : ""}
          </SelectItem>
          {options.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
