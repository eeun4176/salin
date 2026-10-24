/**
 * Program Wording
 * How program details read on the Programs pages and printed stubs: services
 * by the names paravets and owners use, and the program's date and hours.
 */

import { PROCESS_LABEL, type Process } from "@/core/programs/program-requests";
import { programTime, type StubProgram } from "@/core/programs/stubs";

export const services = (processes: Process[]) => processes.map((process) => PROCESS_LABEL[process]).join(", ");

const programDate = (date: string) => new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });

/** "Nov 5, 2026 · 8:00 AM–12:00 PM" */
export const programWhen = (program: Pick<StubProgram, "date" | "startTime" | "endTime">) => [programDate(program.date), programTime(program)].filter(Boolean).join(" · ");
