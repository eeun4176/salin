/**
 * Settings Section Card
 * The bordered card each Settings section sits in: an icon tile, the
 * section heading (also the section's accessible name), and its content.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function SectionCard({ icon: Icon, title, id, children }: { icon: LucideIcon; title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl p-5 ring-1 ring-salin-border">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-salin-tile text-salin-primary">
          <Icon className="size-5" />
        </span>
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
