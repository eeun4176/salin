/**
 * Minimal PDF Builder
 * Writes a small, valid text-based PDF (Helvetica text, one line per string,
 * one page per array) so unit and Playwright tests can exercise real PDF
 * text extraction without binary fixture files. Plain ASCII only.
 */

const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);

export function minimalPdf(pages: string[][]): string {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;

  const catalog = add(""); // filled in once the page tree id is known
  const pageTree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = pages.map((lines) => {
    const text = lines.map((line, i) => `${i === 0 ? "72 720 Td" : "0 -18 Td"} (${escape(line)}) Tj`).join(" ");
    const stream = `BT /F1 12 Tf ${text} ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}
