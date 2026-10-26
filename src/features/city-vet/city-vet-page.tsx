/**
 * City Vet Page (/city-vet)
 * The paravet's other e-Kapon tools, in four tabs: Inbox (City Vet's
 * notices; stub and request notices open the Programs page), Records (ask
 * for City Vet records in plain words, saved as a dataset for AI Studio, or
 * turn the program records already on this phone into one), Data quality
 * (what City Vet flagged on the barangay's records) and Report (an issue
 * for City Vet). Everything but saved program records needs signal; the
 * inbox keeps its last copy for offline.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Bot, CircleAlert, CloudOff, Inbox, Search, Send } from "lucide-react";

import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { ChoiceMenu } from "@/components/common/choice-menu";
import { RefreshButton } from "@/components/common/refresh-button";
import { primaryButton, secondaryButton } from "@/components/common/step-footer";
import { PageFrame } from "@/components/layout/page-frame";
import { AdminApiError } from "@/core/admin/admin-api";
import {
  deviceProgramRecords,
  loadInbox,
  loadIssues,
  loadQuality,
  markNoticeRead,
  noticeLink,
  programRecordsContent,
  QUALITY_ISSUES,
  reportIssue,
  searchCityVet,
  searchContent,
  searchTerm,
  type FoundRecord,
  type IssueReport,
  type Notice,
  type QualityIssue,
  type QualityReport,
} from "@/core/admin/city-vet";
import { db } from "@/core/storage/database";
import { sanitizeName } from "@/core/storage/names";
import { createDataset } from "@/core/storage/repositories/dataset.repository";
import { field } from "@/features/programs/requests-page";
import { formatDate } from "@/features/workspace/query";
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useSyncStore } from "@/stores/sync-store";
import { toast } from "@/stores/toast-store";
import type { DatasetContent } from "@/types/processing";

const TABS = [
  { id: "inbox", label: "Inbox" },
  { id: "records", label: "Records" },
  { id: "quality", label: "Data quality" },
  { id: "report", label: "Report" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const failed = (failure: unknown, fallback: string) => (failure instanceof AdminApiError ? failure.message : fallback);

export function CityVetPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.id === params.get("tab"))?.id ?? "inbox";
  return (
    <PageFrame title="City Vet" description="Notices, records and reports from the City Veterinary Office." aside={<RefreshButton />}>
      <div role="tablist" aria-label="City Vet" className="seg-track no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-xl bg-salin-tile p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === "inbox" ? {} : { tab: t.id }, { replace: true })}
            className={cn("h-9 flex-1 shrink-0 rounded-lg px-2 text-sm font-medium whitespace-nowrap", tab === t.id ? "bg-salin-surface text-salin-text shadow-sm" : "text-salin-muted hover:text-salin-text")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div key={tab} role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label} className="motion-safe:animate-page-in">
        {tab === "inbox" ? <InboxTab /> : tab === "records" ? <RecordsTab /> : tab === "quality" ? <QualityTab /> : <ReportTab />}
      </div>
    </PageFrame>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <LoadingSkeleton label={label} />
  );
}

function NeedsSignal({ text }: { text: string }) {
  return (
    <p className="flex items-center justify-center gap-2 py-12 text-center text-sm text-salin-muted">
      <CloudOff aria-hidden="true" className="size-4 shrink-0" /> {text}
    </p>
  );
}

function InboxTab() {
  const session = useAuthStore((state) => state.session);
  const navigate = useNavigate();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [fromDevice, setFromDevice] = useState(false);
  const cacheKey = `inbox:${session?.key}`;
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);

  useEffect(() => {
    if (!session) return;
    let live = true;
    const load = async () => {
      try {
        const { data } = await loadInbox(session.token);
        await db.settings.put({ key: cacheKey, value: data });
        return { data, fromDevice: false };
      } catch {
        return { data: ((await db.settings.get(cacheKey))?.value as Notice[] | undefined) ?? [], fromDevice: true };
      }
    };
    void load().then((next) => {
      if (!live) return;
      setNotices(next.data);
      setFromDevice(next.fromDevice);
    });
    return () => {
      live = false;
    };
  }, [session, cacheKey, lastSyncedAt]);

  function open(notice: Notice) {
    if (session && !notice.read_at) {
      setNotices((all) => all?.map((n) => (n.id === notice.id ? { ...n, read_at: new Date().toISOString() } : n)) ?? null);
      void markNoticeRead(session.token, notice.id).catch(() => {});
    }
    const to = noticeLink(notice.link);
    if (to) navigate(to);
  }

  if (!notices) return <Loading label="Loading notices…" />;
  return (
    <>
      {fromDevice && <p className="mb-3 text-xs text-salin-muted">Offline · showing the notices saved on this phone.</p>}
      {!notices.length ? (
        <div className="py-12 text-center">
          <Inbox aria-hidden="true" className="mx-auto size-6 text-salin-muted" />
          <p className="mt-3 text-sm text-salin-muted">No notices from City Vet yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notices.map((notice) => (
            <li key={notice.id}>
              <button type="button" onClick={() => open(notice)} className="w-full rounded-2xl p-3.5 text-left ring-1 ring-salin-border hover:bg-salin-tile">
                <span className="flex items-center gap-2">
                  {!notice.read_at && <span className="rounded-full bg-salin-primary-soft px-2 py-0.5 text-[11px] font-semibold text-salin-primary-ink">New</span>}
                  <span className="min-w-0 truncate text-sm font-semibold text-salin-text">{notice.title}</span>
                </span>
                <span className="mt-1 block text-sm text-salin-text">{notice.body}</span>
                <span className="mt-1 block text-xs text-salin-muted">{formatDate(Date.parse(notice.created_at))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const today = () => new Date().toLocaleDateString("en-CA");

/** Saves the table as a workspace dataset and offers AI Studio to ask about it. */
function useSaveDataset() {
  const navigate = useNavigate();
  return async (name: string, content: DatasetContent) => {
    if (!content.rows.length) return toast("Nothing to save yet.");
    await createDataset({ name: sanitizeName(name), sourceFileIds: [], content });
    toast(`Saved “${name}”. Ask about it in AI Studio.`);
    navigate("/ai-studio");
  };
}

function RecordsTab() {
  const session = useAuthStore((state) => state.session);
  const online = useOnline();
  const save = useSaveDataset();
  const [request, setRequest] = useState("");
  const [results, setResults] = useState<{ term: string; records: FoundRecord[]; more: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!session || busy) return;
    const term = searchTerm(request);
    if (term.length < 2) return setError("Type a name, pet or stub code to look for.");
    setBusy(true);
    setError(null);
    try {
      const reply = await searchCityVet(session.token, term);
      setResults({ term, records: reply.data, more: reply.hasMore });
    } catch (failure) {
      setError(failed(failure, "City Vet's records couldn't be searched."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="ask-heading" className="space-y-3">
        <h2 id="ask-heading" className="text-sm font-semibold text-salin-text">
          Ask City Vet records
        </h2>
        <p className="text-sm text-salin-muted">Ask in plain words, e.g. “Give me the records of Juan Cruz”. Only records of your barangay are searched.</p>
        <form onSubmit={search} className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">What to look for</span>
            <input value={request} onChange={(event) => setRequest(event.target.value)} placeholder="Name, pet or stub code" className={cn(field, "h-10 text-sm")} />
          </label>
          <button type="submit" disabled={!online || busy || !request.trim()} className={cn(primaryButton, "h-10")}>
            <Search aria-hidden="true" className="size-4" /> Search
          </button>
        </form>
        {!online && <p className="text-xs text-salin-muted">Searching City Vet needs signal. Records saved on this phone are below.</p>}
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
        {results && (
          <div className="space-y-2">
            <p className="text-xs text-salin-muted">
              {results.records.length} found for “{results.term}”{results.more ? " (showing the first ones; be more specific to narrow it)" : ""}
            </p>
            <ul className="space-y-2">
              {results.records.map((r) => (
                <li key={r.key} className="rounded-2xl p-3 ring-1 ring-salin-border">
                  <p className="text-sm font-semibold text-salin-text">{r.label}</p>
                  <p className="text-xs text-salin-muted">{[r.kind, r.detail, r.status, r.source].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
            {results.records.length > 0 && (
              <button type="button" onClick={() => void save(`City Vet records ${results.term} ${today()}`, searchContent(results.records))} className={secondaryButton}>
                <Bot aria-hidden="true" className="size-4" /> Save as dataset and ask AI
              </button>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="device-heading" className="space-y-2 rounded-2xl bg-salin-tile p-4">
        <h2 id="device-heading" className="text-sm font-semibold text-salin-text">
          Program records on this phone
        </h2>
        <p className="text-sm text-salin-muted">Your barangay's request, stubs and attendance, as last loaded. Save them as a dataset to ask AI Studio about them, even offline.</p>
        <button type="button" onClick={() => session && void deviceProgramRecords(session.key).then((records) => save(`Program records ${today()}`, programRecordsContent(records)))} className={secondaryButton}>
          <Bot aria-hidden="true" className="size-4" /> Save as dataset and ask AI
        </button>
      </section>
    </div>
  );
}

function QualityTab() {
  const session = useAuthStore((state) => state.session);
  const online = useOnline();
  const [issue, setIssue] = useState<QualityIssue>("missing-contact");
  const [report, setReport] = useState<{ issue: QualityIssue; data: QualityReport | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!session || !online) return;
    let live = true;
    void loadQuality(session.token, issue).then(
      (data) => live && setReport({ issue, data, error: null }),
      (failure: unknown) => live && setReport({ issue, data: null, error: failed(failure, "City Vet's data-quality flags couldn't be loaded.") }),
    );
    return () => {
      live = false;
    };
  }, [session, online, issue]);

  if (!online) return <NeedsSignal text="Connect to see what City Vet flagged on your barangay's records." />;
  if (!report || report.issue !== issue) return <Loading label="Loading data-quality flags…" />;
  if (report.error || !report.data) return <p className="py-12 text-center text-sm text-salin-muted">{report.error}</p>;
  const { counts, rows, total } = report.data;
  return (
    <div className="space-y-4">
      <ChoiceMenu variant="field" label="Flag" heading="Flag" value={issue} onChange={setIssue} options={QUALITY_ISSUES.map((q) => ({ value: q.id, label: `${q.label} (${counts[q.count]})` }))} />
      <p className="text-xs text-salin-muted">{counts.checkedRecords.toLocaleString()} City Vet records checked. Fix these in the field, then tell City Vet through Report.</p>
      {!rows.length ? (
        <p className="rounded-2xl bg-salin-tile px-4 py-6 text-center text-sm text-salin-muted">Nothing flagged here.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={`${row.id}-${row.recordId}`} className="rounded-2xl p-3 ring-1 ring-salin-border">
              <p className="text-sm font-semibold text-salin-text">
                {row.label || row.recordId}
                {row.otherLabel ? ` · ${row.otherLabel}` : ""}
              </p>
              <p className="text-xs text-salin-muted">{[row.dataset === "pets" ? "Pet" : "Owner", row.recordId, row.barangay, row.status].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      )}
      {total > rows.length && <p className="text-xs text-salin-muted">Showing {rows.length} of {total}.</p>}
    </div>
  );
}

const SEVERITY = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
] as const;

function ReportTab() {
  const session = useAuthStore((state) => state.session);
  const online = useOnline();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"low" | "normal" | "high">("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<IssueReport[] | null>(null);
  const [sent, setSent] = useState(0);

  useEffect(() => {
    if (!session || !online) return;
    let live = true;
    void loadIssues(session.token).then(
      (data) => live && setReports(data),
      () => live && setReports([]),
    );
    return () => {
      live = false;
    };
  }, [session, online, sent]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session || busy) return;
    const problem = title.trim().length < 3 ? "Give the issue a short title (3 characters or more)." : description.trim().length < 10 ? "Describe the issue in at least 10 characters." : null;
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await reportIssue(session.token, { title: title.trim(), description: description.trim(), severity });
      setTitle("");
      setDescription("");
      setSent((n) => n + 1);
      toast("Sent to City Vet.");
    } catch (failure) {
      setError(failed(failure, "The report couldn't be sent."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} noValidate className="space-y-4">
        <label className="block text-sm font-medium text-salin-text">
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className={cn(field, "mt-1.5")} />
        </label>
        <label className="block text-sm font-medium text-salin-text">
          What happened
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={4} className={cn(field, "mt-1.5 h-auto py-2.5")} />
        </label>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium text-salin-text">How urgent</span>
          <ChoiceMenu variant="field" label="How urgent" heading="How urgent" value={severity} onChange={setSeverity} options={[...SEVERITY]} />
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
        {!online && <p className="text-xs text-salin-muted">Sending a report needs signal.</p>}
        <button type="submit" disabled={!online || busy} className={cn(primaryButton, "w-full sm:w-auto")}>
          <Send aria-hidden="true" className="size-4" /> Send to City Vet
        </button>
      </form>

      {online && reports && reports.length > 0 && (
        <section aria-labelledby="reports-heading" className="space-y-2">
          <h2 id="reports-heading" className="text-sm font-semibold text-salin-text">
            Your reports
          </h2>
          <ul className="space-y-2">
            {reports.map((r) => (
              <li key={r.id} className="rounded-2xl p-3 ring-1 ring-salin-border">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-salin-text">
                  {r.severity === "high" && <CircleAlert aria-label="High" className="size-4 text-salin-muted" />}
                  {r.title}
                </p>
                <p className="text-xs text-salin-muted">
                  {r.status.replace("_", " ")} · {formatDate(Date.parse(r.createdAt))}
                  {r.resolution ? ` · ${r.resolution}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
