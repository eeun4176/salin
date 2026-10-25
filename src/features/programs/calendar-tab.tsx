/**
 * Calendar (the Calendar tab of /programs)
 * The barangay's City Vet programs on a month calendar, in the same style as
 * e-Vet Admin's: a rounded grid with day numbers in circles (today filled
 * green) and program chips, plus today's and this month's programs beside
 * it. Uses the programs this phone has saved, so it works offline. A
 * program opens its Attendance tab.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { secondaryButton } from "@/components/common/step-footer";
import { monthGrid, monthKey } from "@/core/programs/calendar";
import { programTime, todayManila, type StubProgram } from "@/core/programs/stubs";
import { services } from "@/features/programs/program-format";
import { useStubs } from "@/features/programs/use-stubs";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const iconButton = "press grid size-9 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile hover:text-salin-text";
const label = "px-1 pb-2.5 text-[11px] font-semibold tracking-[0.06em] text-salin-muted uppercase";
const programLink = (program: StubProgram) => `/programs?tab=attendance&program=${program.id}`;
const shortDate = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T00:00:00`).toLocaleDateString("en-PH", options);

export function CalendarTab() {
  const stubs = useStubs();
  const today = todayManila();
  const [view, setView] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }));
  const programs = useMemo(() => [...(stubs.data?.programs ?? [])].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? "")), [stubs.data]);
  const byDate = useMemo(() => {
    const map = new Map<string, StubProgram[]>();
    for (const program of programs) map.set(program.date, [...(map.get(program.date) ?? []), program]);
    return map;
  }, [programs]);

  if (stubs.status === "loading") return <LoadingSkeleton label="Loading programs" />;

  const key = monthKey(view.year, view.month);
  const grid = monthGrid(view.year, view.month);
  const thisMonth = programs.filter((program) => program.date.startsWith(key));
  const todays = byDate.get(today) ?? [];
  const title = new Date(view.year, view.month, 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  const move = (step: number) => setView(({ year, month }) => ({ year: year + Math.floor((month + step) / 12), month: (((month + step) % 12) + 12) % 12 }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-[22px] leading-tight font-bold tracking-[-0.03em] text-salin-text sm:min-w-[12rem]">{title}</h2>
        <div className="flex gap-0.5">
          <button type="button" aria-label="Previous month" onClick={() => move(-1)} className={iconButton}>
            <ChevronLeft className="size-[18px]" />
          </button>
          <button type="button" aria-label="Next month" onClick={() => move(1)} className={iconButton}>
            <ChevronRight className="size-[18px]" />
          </button>
        </div>
        <button type="button" onClick={() => setView({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })} className={cn(secondaryButton, "h-9")}>
          Today
        </button>
      </div>
      {stubs.status === "unavailable" && !programs.length && <p className="text-sm text-salin-muted">Connect to the internet once to load your programs.</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <div aria-hidden="true" className="grid grid-cols-7 pb-2 text-[11px] font-semibold tracking-[0.06em] text-salin-muted uppercase">
            {WEEKDAYS.map((day) => (
              <span key={day} className="text-center sm:pl-2.5 sm:text-left">
                {day}
              </span>
            ))}
          </div>
          <div role="grid" aria-label={`Programs in ${title}`} className="grid grid-cols-7 overflow-hidden rounded-2xl bg-salin-surface shadow-sm ring-1 ring-salin-border ring-inset">
            {grid.map((date, index) => {
              const inMonth = date.startsWith(key);
              const events = byDate.get(date) ?? [];
              return (
                <div
                  key={date}
                  role="gridcell"
                  aria-label={`${shortDate(date, { weekday: "long", month: "long", day: "numeric" })}${events.length ? `, ${events.length} program${events.length === 1 ? "" : "s"}` : ""}`}
                  className={cn(
                    "flex min-h-[4.5rem] min-w-0 flex-col items-center gap-1 border-salin-border px-0.5 pt-1.5 pb-1 sm:min-h-24 sm:items-stretch sm:px-1.5",
                    index % 7 !== 6 && "border-r",
                    index < grid.length - 7 && "border-b",
                    !inMonth && "bg-salin-canvas/70",
                  )}
                >
                  <span className={cn("grid h-[26px] min-w-[26px] place-items-center self-center rounded-full px-1 text-[13px] font-semibold tabular-nums sm:self-start", date === today ? "bg-salin-primary text-white" : inMonth ? "text-salin-text" : "text-salin-subtle")}>
                    {Number(date.slice(8))}
                  </span>
                  <div className="flex w-full min-w-0 flex-col gap-[3px]">
                    {events.slice(0, 2).map((program) => (
                      <Link
                        key={program.id}
                        to={programLink(program)}
                        title={`${program.title} · ${program.location}`}
                        className={cn(
                          "block h-[5px] truncate rounded-[3px] text-[0px] sm:h-[22px] sm:rounded-[7px] sm:px-1.5 sm:text-xs sm:leading-[22px] sm:font-semibold",
                          date < today ? "bg-salin-tile text-salin-muted ring-1 ring-salin-border ring-inset" : "bg-salin-primary text-white",
                        )}
                      >
                        {program.title}
                      </Link>
                    ))}
                    {events.length > 2 && <span className="hidden pl-1.5 text-[11.5px] font-semibold text-salin-muted sm:block">+{events.length - 2} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-salin-subtle">Green: coming up · grey: already held.</p>
        </div>

        <aside aria-label="Programs this month" className="min-w-0">
          <p className={label}>Today, {shortDate(today, { weekday: "short", month: "short", day: "numeric" })}</p>
          <ul className="mb-5 space-y-2">
            {todays.map((program) => (
              <AgendaRow key={program.id} program={program} />
            ))}
            {!todays.length && <li className="rounded-xl bg-salin-tile px-3 py-2.5 text-sm text-salin-muted">No program today.</li>}
          </ul>
          <p className={label}>This month · {thisMonth.length}</p>
          <ul className="space-y-2">
            {thisMonth.map((program) => (
              <AgendaRow key={program.id} program={program} showDate />
            ))}
          </ul>
          {!thisMonth.length && <p className="px-1 text-sm text-salin-muted">No programs this month.</p>}
        </aside>
      </div>
    </div>
  );
}

/** An agenda row: a green bar, the title, and the date, time and services. */
function AgendaRow({ program, showDate = false }: { program: StubProgram; showDate?: boolean }) {
  const when = [showDate ? shortDate(program.date, { month: "short", day: "numeric" }) : "", programTime(program)].filter(Boolean).join(" · ");
  return (
    <li>
      <Link to={programLink(program)} className="flex gap-2.5 rounded-xl bg-salin-tile px-2.5 py-2 text-[13px] leading-snug hover:bg-salin-tile-hover">
        <i aria-hidden="true" className="w-[3px] shrink-0 rounded-full bg-salin-primary" />
        <span className="min-w-0">
          <b className="block truncate font-semibold text-salin-text">{program.title}</b>
          <small className="block truncate text-xs text-salin-muted">{[when, services(program.processes)].filter(Boolean).join(" · ")}</small>
        </span>
      </Link>
    </li>
  );
}
