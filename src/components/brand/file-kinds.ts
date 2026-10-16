import type { FileKind } from "@/features/workspace/types";

export const FILE_KIND_META: Record<FileKind, { label: string; color: string; name: string }> = {
  csv: { label: ".CSV", color: "#01A85A", name: "CSV spreadsheet" },
  xlsx: { label: ".XLSX", color: "#14955A", name: "Excel workbook" },
  pdf: { label: ".PDF", color: "#E5484D", name: "PDF document" },
  png: { label: ".PNG", color: "#2F6FE0", name: "PNG image" },
  jpg: { label: ".JPG", color: "#12A150", name: "JPG image" },
  webp: { label: ".WebP", color: "#8E4EC6", name: "WebP image" },
};
