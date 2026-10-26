/**
 * Programs Page (/programs)
 * City Vet programs for the paravet's barangay, in four tabs: Requests
 * (the shared owner list sent to City Vet), Stubs (print the blank stubs
 * City Vet sent and encode each owner once a stub is handed over),
 * Attendance (program day: scan stubs and record walk-ins, offline; who is
 * present or absent) and Calendar (the programs by month). Refresh loads
 * the newest records. The tab is kept in the URL
 * (?tab=stubs) so a notification link can open it directly.
 */

import { useSearchParams } from "react-router";

import { RefreshButton } from "@/components/common/refresh-button";
import { PageFrame } from "@/components/layout/page-frame";
import { AttendanceTab } from "@/features/programs/attendance-tab";
import { CalendarTab } from "@/features/programs/calendar-tab";
import { RequestsTab } from "@/features/programs/requests-page";
import { StubsTab } from "@/features/programs/stubs-tab";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

const TABS = [
  { id: "requests", label: "Requests" },
  { id: "stubs", label: "Stubs" },
  { id: "attendance", label: "Attendance" },
  { id: "calendar", label: "Calendar" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function ProgramsPage() {
  const session = useAuthStore((state) => state.session);
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.id === params.get("tab"))?.id ?? "requests";

  return (
    <PageFrame title="Programs" description={`${session?.barangay ?? "Your barangay"} · shared with the paravets assigned there.`} aside={<RefreshButton />}>
      <div role="tablist" aria-label="Programs" className="seg-track no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-xl bg-salin-tile p-1" data-lenis-prevent-horizontal="">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setParams(t.id === "requests" ? {} : { tab: t.id }, { replace: true })}
            className={cn("h-9 flex-1 shrink-0 rounded-lg px-2 text-sm font-medium whitespace-nowrap transition-colors", tab === t.id ? "bg-salin-surface text-salin-text shadow-sm" : "text-salin-muted hover:text-salin-text")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="motion-safe:animate-page-in">
        {tab === "requests" ? <RequestsTab /> : tab === "stubs" ? <StubsTab /> : tab === "attendance" ? <AttendanceTab /> : <CalendarTab />}
      </div>
    </PageFrame>
  );
}
