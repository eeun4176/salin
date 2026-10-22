/**
 * Census Sheet (printable)
 * One CVO-CENSUS working sheet drawn from the shared layout of its version
 * at true size (216 × 330 mm, long bond): corner markers, the code strip with
 * its readable twin, the office's header and logos, the printed census
 * information, handwriting fields (open lines; letter boxes for the contact
 * number), tick boxes and number bubbles. Registered In shows the years
 * before the census date. Black and white only, so it photocopies.
 */

import { BARANGAYS } from "@/core/census/barangays";
import { continuationCaptions, layoutFor, optionText, PAGE, type Caption } from "@/core/census/census-layout";
import { encodeSheetCode, type SheetCode } from "@/core/census/code-strip";

import citySeal from "@/assets/census/city-seal.png";
import cvoLogo from "@/assets/census/cvo-logo.jpg";

const INK = "#111";
const BOX_LINE = "#555";
const LETTER_LINE = "#8a8f8c";

function Text({ caption, year }: { caption: Caption; year: number }) {
  return (
    <text x={caption.x} y={caption.y} fontSize={caption.size} fontWeight={caption.bold ? 700 : 500} textAnchor={caption.anchor ?? "start"} fill={INK}>
      {optionText(caption.text, year)}
    </text>
  );
}

const pad = (n: number) => String(n).padStart(4, "0");

function sheetLabel(code: SheetCode) {
  const [y, m, d] = code.censusDate.split("-");
  return `CVO-CENSUS v${code.version} · ${BARANGAYS[code.barangay]?.name.toUpperCase()} · ${m}/${d}/${y} · SHEET ${pad(code.sheetNumber)}${code.continuation ? " · CONTINUATION" : ""}`;
}

export function CensusSheet({ code, className }: { code: SheetCode; className?: string }) {
  const layout = layoutFor(code.version);
  const bits = encodeSheetCode(code);
  const barangay = BARANGAYS[code.barangay];
  const [y, m, d] = code.censusDate.split("-");
  const ownerWords = code.continuation ? continuationCaptions(layout) : layout.ownerCaptions;
  const fields = [...(code.continuation ? [] : layout.owner), ...layout.pets.flatMap((p) => p.writeIns)];
  const letterBoxes = fields.filter((f) => !f.open).flatMap((f) => f.rows.flat());
  const openLines = fields.filter((f) => f.open).flatMap((f) => f.rows.flat());

  return (
    <svg
      viewBox={`0 0 ${PAGE.width} ${PAGE.height}`}
      width={`${PAGE.width}mm`}
      height={`${PAGE.height}mm`}
      className={className}
      fontFamily="Inter, system-ui, sans-serif"
      role="img"
      aria-label={`Census sheet ${sheetLabel(code)}`}
    >
      <rect width={PAGE.width} height={PAGE.height} fill="#fff" />
      {layout.markers.map((r, i) => (
        <rect key={i} {...r} fill="#000" />
      ))}
      <rect {...layout.hollowMarker} fill="#fff" />

      <image href={citySeal} x={24} y={8} width={16} height={16} />
      <image href={cvoLogo} x={176} y={8} width={16} height={16} />
      <text x={PAGE.width / 2} y={12.5} fontSize={3.2} textAnchor="middle" fill={INK}>
        City of San Jose del Monte
      </text>
      <text x={PAGE.width / 2} y={18} fontSize={4.2} fontWeight={700} textAnchor="middle" fill={INK}>
        CITY VETERINARY OFFICE
      </text>
      <text x={PAGE.width / 2} y={23.5} fontSize={4.6} fontWeight={800} textAnchor="middle" fill={INK}>
        DOG &amp; CAT WORKING SHEET FORM
      </text>

      {layout.code.map((r, i) => (bits[i] ? <rect key={i} {...r} fill="#000" /> : <rect key={i} {...r} fill="none" stroke="#bbb" strokeWidth={0.15} />))}
      <text x={PAGE.width / 2} y={34} fontSize={2.2} textAnchor="middle" fill={INK} letterSpacing={0.2}>
        {sheetLabel(code)}
      </text>

      {layout.frames.map((r, i) => (
        <rect key={i} {...r} rx={1.5} fill="none" stroke="#333" strokeWidth={0.3} />
      ))}
      <text x={15} y={40.6} fontSize={3} fontWeight={700} fill={INK}>
        A. CENSUS INFORMATION
      </text>
      <text x={15} y={45} fontSize={3.2} fill={INK}>
        BARANGAY: <tspan fontWeight={800}>{barangay?.name.toUpperCase()}</tspan> (DISTRICT {barangay?.district})
      </text>
      <text x={124} y={45} fontSize={3.2} fill={INK}>
        DATE OF CENSUS: <tspan fontWeight={800}>{`${m}/${d}/${y}`}</tspan>
      </text>
      <text x={201} y={45} fontSize={3.2} textAnchor="end" fill={INK}>
        SHEET NO. <tspan fontWeight={800}>{pad(code.sheetNumber)}</tspan>
      </text>

      {[...layout.captions, ...ownerWords].map((c, i) => (
        <Text key={i} caption={c} year={Number(y)} />
      ))}
      {layout.pets.map((pet) => (
        <text key={pet.slot} x={pet.titleAt.x} y={pet.titleAt.y} fontSize={3} fontWeight={700} fill={INK}>
          C. PET RECORD {pet.slot + 1 + (code.continuation ? 3 : 0)}
        </text>
      ))}

      {letterBoxes.map((r, i) => (
        <rect key={i} {...r} fill="none" stroke={LETTER_LINE} strokeWidth={0.25} />
      ))}
      {openLines.map((r, i) => (
        <rect key={`line-${i}`} {...r} rx={1} fill="none" stroke={LETTER_LINE} strokeWidth={0.25} />
      ))}
      {layout.pets.flatMap((pet) => [pet.notApplicable, ...pet.choices.flatMap((g) => g.options.map((o) => o.box))]).map((r, i) => (
        <rect key={i} {...r} rx={0.4} fill="none" stroke={BOX_LINE} strokeWidth={0.3} />
      ))}
      {[...layout.pets.flatMap((p) => p.numbers), ...(code.continuation ? [layout.continuedFrom] : [])]
        .flatMap((g) => g.places.flatMap((pl) => pl.bubbles))
        .map((r, i) => (
          <circle key={i} cx={r.x + r.width / 2} cy={r.y + r.height / 2} r={r.width / 2} fill="none" stroke={BOX_LINE} strokeWidth={0.3} />
        ))}

      <text x={22} y={320.5} fontSize={2.6} fill={INK}>
        Prepared by: ________________________________ (Paravet)
      </text>
      <text x={194} y={320.5} fontSize={2.2} textAnchor="end" fill={INK}>
        Do not write outside the boxes · Don't fold over the black corner squares
      </text>
    </svg>
  );
}
