import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

type Tone = "muted" | "strong";
type Segment = { text: string; tone: Tone };

const LINES: Segment[][] = [
  [
    { text: "Turn ", tone: "muted" },
    { text: "Documents", tone: "strong" },
    { text: " into", tone: "muted" },
  ],
  [
    { text: "Structured ", tone: "muted" },
    { text: "Data", tone: "strong" },
  ],
];

const FULL_TEXT = LINES.map((line) => line.map((s) => s.text).join("")).join(" ");
const TOTAL = LINES.flat().reduce((sum, s) => sum + s.text.length, 0);

const toneClass: Record<Tone, string> = {
  muted: "text-[#7E8682]",
  strong: "text-salin-text",
};

function Caret({ blink }: { blink: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative -mr-[0.12em] ml-[0.06em] inline-block h-[0.95em] w-[3px] translate-y-[0.14em] rounded-full bg-salin-primary",
        blink && "animate-caret",
      )}
    />
  );
}

/**
 * Two-line hero tagline typed out character by character. Untyped characters
 * are rendered invisibly so the centered layout never shifts while typing.
 */
export function TypewriterHeadline({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [typed, setTyped] = useState(0);
  const count = reduced ? TOTAL : typed;

  useEffect(() => {
    if (reduced) return;
    let i = 0;
    let timer = 0;
    const step = () => {
      i += 1;
      setTyped(i);
      if (i >= TOTAL) return;
      const next = FULL_TEXT[i - 1] === " " ? 140 : 52 + Math.random() * 46;
      timer = window.setTimeout(step, next);
    };
    timer = window.setTimeout(step, 450);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  const nodes: ReactNode[] = [];
  let consumed = 0;
  let caretPlaced = false;
  const done = count >= TOTAL;

  LINES.forEach((line, li) => {
    if (li > 0) nodes.push(<br key={`br-${li}`} />);
    line.forEach((seg, si) => {
      const shown = Math.min(Math.max(count - consumed, 0), seg.text.length);
      consumed += seg.text.length;
      const head = seg.text.slice(0, shown);
      const tail = seg.text.slice(shown);
      if (head) nodes.push(<span key={`h-${li}-${si}`} className={toneClass[seg.tone]}>{head}</span>);
      if (tail && !caretPlaced) {
        nodes.push(<Caret key="caret" blink={false} />);
        caretPlaced = true;
      }
      if (tail) nodes.push(<span key={`t-${li}-${si}`} className="invisible">{tail}</span>);
    });
  });
  if (!caretPlaced) nodes.push(<Caret key="caret" blink={done && !reduced} />);

  return (
    <h1 className={cn("font-bold tracking-[-0.035em] text-balance", className)}>
      <span className="sr-only">{FULL_TEXT}</span>
      <span aria-hidden="true">{nodes}</span>
    </h1>
  );
}
