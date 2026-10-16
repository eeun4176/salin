import { useState, type FormEvent } from "react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initialValue?: string;
  confirmLabel: string;
  onSubmit: (name: string) => void;
}

function NameForm({ initialValue, confirmLabel, onSubmit }: Pick<NameDialogProps, "initialValue" | "confirmLabel" | "onSubmit">) {
  const [value, setValue] = useState(initialValue ?? "");
  const trimmed = value.trim();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4">
      <label htmlFor="item-name" className="sr-only">
        Name
      </label>
      <input
        id="item-name"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        maxLength={120}
        className="h-11 w-full rounded-xl border border-salin-border bg-white px-3 text-[15px] outline-none focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/20"
      />
      <div className="mt-5 flex justify-end gap-2">
        <DialogClose className="press h-10 rounded-xl px-4 text-sm font-medium text-salin-muted hover:bg-salin-tile">Cancel</DialogClose>
        <button
          type="submit"
          disabled={!trimmed}
          className="press h-10 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-[#019A53] disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}

/** Single-field dialog used for "New folder" and "Rename". */
export function NameDialog({ open, onOpenChange, title, description, ...form }: NameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">Enter a name</DialogDescription>}
          {/* Remounts per open so the field always starts from initialValue */}
          <NameForm {...form} />
        </DialogContent>
      )}
    </Dialog>
  );
}
