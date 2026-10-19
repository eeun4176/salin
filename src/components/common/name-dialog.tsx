/**
 * Name Dialog
 * Single text-field dialog used for "New folder" and "Rename". Validates as
 * you type, shows errors from storage (e.g. a duplicate name) under the field,
 * and for files pre-selects the name without its extension.
 */

import { useState, type FormEvent } from "react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/core/storage/errors";
import { MAX_NAME_LENGTH } from "@/core/storage/names";
import { cn } from "@/lib/utils";

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initialValue?: string;
  confirmLabel: string;
  /** Returns an error message for an invalid name, or `null`. */
  validate?: (name: string) => string | null;
  /** Select only the part before the extension when the field gets focus (file renames). */
  selectBaseName?: boolean;
  /** May throw; the error message is shown in the dialog and it stays open. */
  onSubmit: (name: string) => void | Promise<void>;
}

type FormProps = Pick<NameDialogProps, "initialValue" | "confirmLabel" | "validate" | "selectBaseName" | "onSubmit">;

function NameForm({ initialValue, confirmLabel, validate, selectBaseName, onSubmit }: FormProps) {
  const [value, setValue] = useState(initialValue ?? "");
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();
  const validationError = trimmed && validate ? validate(trimmed) : null;
  // Don't flag the untouched default (e.g. "Untitled folder" that already exists) until the user types.
  const error = submitError ?? (touched ? validationError : null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!trimmed || validationError || busy) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setSubmitError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4" noValidate>
      <label htmlFor="item-name" className="sr-only">
        Name
      </label>
      <input
        id="item-name"
        autoFocus
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setTouched(true);
          setSubmitError(null);
        }}
        onFocus={(e) => {
          const el = e.currentTarget;
          const dot = selectBaseName ? el.value.lastIndexOf(".") : -1;
          if (dot > 0) el.setSelectionRange(0, dot);
          else el.select();
        }}
        maxLength={MAX_NAME_LENGTH}
        aria-invalid={!!error}
        aria-describedby={error ? "item-name-error" : undefined}
        className={cn(
          "h-11 w-full rounded-xl border bg-salin-surface px-3 text-[15px] outline-none focus:ring-3",
          error ? "border-destructive focus:ring-destructive/15" : "border-salin-border focus:border-salin-primary focus:ring-salin-primary/20",
        )}
      />
      {error && (
        <p id="item-name-error" role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <DialogClose className="press h-10 rounded-xl px-4 text-sm font-medium text-salin-muted hover:bg-salin-tile">Cancel</DialogClose>
        <button
          type="submit"
          disabled={!trimmed || busy}
          className="press h-10 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong disabled:opacity-50"
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
