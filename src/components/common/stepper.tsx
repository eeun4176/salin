/**
 * Stepper
 * The progress indicator for guided flows (Extract from Excel, Read text):
 * numbered circles joined by lines, each with a label and a short
 * description, centred under the page title. The current step is filled
 * green with a soft halo; finished steps keep their number in green; steps
 * ahead stay grey. Descriptions hide on narrow phones to keep labels legible.
 */

import { cn } from "@/lib/utils";

export interface StepInfo {
  label: string;
  description: string;
}

/** `current` is 1-based. */
export function Stepper({ steps, current, className }: { steps: readonly StepInfo[]; current: number; className?: string }) {
  return (
    <ol aria-label="Steps" className={cn("mx-auto grid w-full max-w-3xl", className)} style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((step, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={step.label} aria-current={state === "current" ? "step" : undefined} className="relative flex flex-col items-center px-1 text-center">
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-[17px] right-[calc(-50%+24px)] left-[calc(50%+24px)] h-px sm:top-[19px] sm:right-[calc(-50%+28px)] sm:left-[calc(50%+28px)]",
                  n < current ? "bg-salin-primary" : "bg-salin-border-strong",
                )}
              />
            )}
            <span
              className={cn(
                "relative grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors sm:size-10",
                state === "current" && "bg-salin-primary text-white shadow-[0_0_0_5px_rgb(1_168_90/0.16)]",
                state === "done" && "bg-salin-surface text-salin-primary ring-[1.5px] ring-salin-primary",
                state === "todo" && "bg-salin-surface text-salin-muted ring-1 ring-salin-border-strong",
              )}
            >
              {n}
              <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (current step)" : ""}</span>
            </span>
            <span className={cn("mt-2 text-[13px] leading-tight sm:text-sm", state === "current" ? "font-semibold text-salin-text" : "font-medium text-salin-muted")}>{step.label}</span>
            <span className="mt-0.5 hidden text-xs leading-snug text-salin-subtle sm:block">{step.description}</span>
          </li>
        );
      })}
    </ol>
  );
}
