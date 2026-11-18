"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RenameDialog({
  open,
  onOpenChange,
  initialTitle,
  onSubmit,
  title = "Rename conversation",
  maxLength = 300,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  onSubmit: (title: string) => Promise<void>;
  title?: string;
  maxLength?: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remount the form per open so it starts from the current title. */}
        {open && (
          <RenameForm
            initialTitle={initialTitle}
            title={title}
            maxLength={maxLength}
            onCancel={() => onOpenChange(false)}
            onSubmit={async (t) => {
              await onSubmit(t);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  initialTitle,
  title,
  maxLength,
  onCancel,
  onSubmit,
}: {
  initialTitle: string;
  title: string;
  maxLength: number;
  onCancel: () => void;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();

  async function handle(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } catch {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handle} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Choose a short, descriptive name.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="rename-title">Title</Label>
        <Input
          id="rename-title"
          autoFocus
          value={value}
          maxLength={maxLength}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed || busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
