import type { CSSProperties } from "react";
import { Link } from "react-router";
import { FileDown, ScanLine } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { FileTypeIcon } from "@/components/brand/file-type-icon";
import { SpotlightGrid } from "@/components/brand/spotlight-grid";
import { TypewriterHeadline } from "@/features/home/typewriter-headline";
import type { FileKind } from "@/features/workspace/types";
import { cn } from "@/lib/utils";

/** Badge layout around the headline, mirroring the mockup (left column / right column). */
const BADGES: { kind: FileKind; className: string; tilt: number; delay: number; duration: number }[] = [
  { kind: "csv", className: "left-[11%] top-[12%] xl:left-[13%]", tilt: -6, delay: 0, duration: 6.2 },
  { kind: "png", className: "left-[1%] top-[42%] xl:left-[3%]", tilt: 8, delay: 1.1, duration: 7 },
  { kind: "jpg", className: "left-[11%] top-[70%] xl:left-[13%]", tilt: -4, delay: 0.6, duration: 5.6 },
  { kind: "pdf", className: "right-[11%] top-[10%] xl:right-[13%]", tilt: 7, delay: 0.4, duration: 6.6 },
  { kind: "webp", className: "right-[1%] top-[43%] xl:right-[3%]", tilt: -7, delay: 1.5, duration: 7.4 },
  { kind: "xlsx", className: "right-[11%] top-[70%] xl:right-[13%]", tilt: 5, delay: 0.9, duration: 5.9 },
];

const primaryCta =
  "press inline-flex h-11 items-center gap-2 rounded-xl bg-salin-primary px-5 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgb(1_168_90/0.6)] hover:bg-[#019A53]";
const secondaryCta =
  "press inline-flex h-11 items-center gap-2 rounded-xl bg-white/80 px-5 text-sm font-semibold text-salin-text ring-1 ring-salin-border backdrop-blur hover:bg-white";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-salin-canvas">
      {/* Mint wash from the mockup, fading into the canvas */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(1_168_90/0.16)_0%,rgb(1_168_90/0.07)_42%,transparent_88%)]"
      />
      <SpotlightGrid />

      <div className="relative mx-auto max-w-5xl px-4 pt-5 sm:px-6 md:pt-7">
        <AppHeader />

        <div className="relative">
          {BADGES.map((badge) => (
            <div
              key={badge.kind}
              aria-hidden="true"
              className={cn("pointer-events-none absolute hidden lg:block", badge.className)}
            >
              <div
                className="animate-bob motion-reduce:animate-none"
                style={
                  {
                    "--tilt": `${badge.tilt}deg`,
                    animationDelay: `-${badge.delay}s`,
                    animationDuration: `${badge.duration}s`,
                    transform: `rotate(${badge.tilt}deg)`,
                  } as CSSProperties
                }
              >
                <FileTypeIcon kind={badge.kind} className="size-14 drop-shadow-[0_10px_14px_rgb(1_80_40/0.12)] xl:size-16" />
              </div>
            </div>
          ))}

          <div className="relative flex flex-col items-center pt-10 pb-16 text-center md:pt-14 md:pb-24">
            <TypewriterHeadline className="text-[clamp(2.1rem,7.4vw,3.1rem)] leading-[1.06]" />
            <p className="mt-3 text-[15px] text-salin-muted md:text-base">From documents to data.</p>

            <div className="mt-7 hidden items-center gap-3 md:flex">
              <Link to="/scan" className={primaryCta}>
                <ScanLine className="size-[18px]" />
                Scan Document
              </Link>
              <Link to="/import" className={secondaryCta}>
                <FileDown className="size-[18px]" />
                Import Files
              </Link>
            </div>

            {/* Below desktop there is no room for floating badges, so formats sit in a row. */}
            <div aria-hidden="true" className="mt-6 flex items-center gap-1.5 md:order-last md:mt-7 lg:hidden">
              {(["pdf", "xlsx", "csv", "jpg", "png", "webp"] as const).map((kind) => (
                <FileTypeIcon key={kind} kind={kind} className="size-9" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
