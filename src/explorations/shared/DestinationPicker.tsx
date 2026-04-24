// Shared brutalist destination picker. The *closed* state is pixel-identical
// to the box shown in image_4.png: a thin-bordered, uppercase, monospaced chip
// with "DESTINATION" as a kicker label. The open state reveals a grouped list
// of every destination discovered in `/destinations/index.json`.
//
// Used by both V10 (single-destination deep dive) and V11 (unified macro map).

import { useEffect, useRef, useState } from "react";
import type { DestinationIndexEntry } from "./destinationManifest";

interface DestinationPickerProps {
  index: DestinationIndexEntry[];
  currentSlug: string | null;
  onPick: (slug: string, entry: DestinationIndexEntry) => void;
  label?: string;
  placeholder?: string;
  // Bottom-left, bottom-right, top-left, top-right anchor
  anchor?: "bottom-left" | "bottom-right" | "top-left" | "top-right" | "inline";
  className?: string;
}

const ANCHOR_CLS: Record<string, string> = {
  "bottom-left": "absolute bottom-24 left-8",
  "bottom-right": "absolute bottom-24 right-8",
  "top-left": "absolute top-28 left-8",
  "top-right": "absolute top-28 right-8",
  inline: "relative",
};

export default function DestinationPicker({
  index,
  currentSlug,
  onPick,
  label = "Destination",
  placeholder = "Select destination",
  anchor = "bottom-left",
  className = "",
}: DestinationPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const current = index.find((d) => d.slug === currentSlug) ?? null;
  const label_text = current ? `${current.name} — ${current.country}` : placeholder;

  const grouped = index.reduce<Record<string, DestinationIndexEntry[]>>(
    (acc, d) => {
      const key = d.category ?? "other";
      (acc[key] ||= []).push(d);
      return acc;
    },
    {},
  );
  const categories = Object.keys(grouped).sort();

  // Anchor-aware open direction: bottom-* anchors open upward so the panel
  // isn't clipped by the exploration shell's `overflow-hidden` root.
  const openUpward = anchor.startsWith("bottom");

  return (
    <div
      ref={rootRef}
      className={`${ANCHOR_CLS[anchor]} z-[6] pointer-events-auto w-[320px] max-w-[min(320px,calc(100vw-4rem))] ${className}`}
    >
      {/* Upward-opening panel sits above the label block so we render it first */}
      {open && openUpward && index.length > 0 && (
        <div
          role="listbox"
          className="mb-2 bg-black/85 backdrop-blur-md border border-white/20 max-h-[360px] overflow-y-auto font-mono text-[11px] tracking-[0.15em] uppercase shadow-[0_-20px_60px_rgba(0,0,0,0.6)]"
        >
          {categories.map((cat) => (
            <div key={cat}>
              <div className="px-4 pt-3 pb-2 text-[9px] tracking-[0.35em] text-white/35 border-b border-white/10">
                {cat}
              </div>
              {grouped[cat].map((d) => {
                const isActive = d.slug === currentSlug;
                return (
                  <button
                    key={d.slug}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      onPick(d.slug, d);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 border-b border-white/5 transition-colors ${isActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
                  >
                    <span className="truncate">
                      <span
                        className={`inline-block w-1.5 h-1.5 mr-2 align-middle ${isActive ? "bg-white" : "bg-white/25"}`}
                      />
                      {d.name}
                    </span>
                    <span className="text-white/40 text-[10px] shrink-0">
                      {d.country}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="font-mono text-[9px] tracking-[0.4em] uppercase text-white/40 mb-2">
        {label}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="group w-full bg-black/70 backdrop-blur-sm border border-white/30 hover:border-white text-white font-mono text-xs tracking-[0.15em] uppercase px-4 py-3 flex items-center justify-between transition-colors"
      >
        <span className={`truncate ${current ? "text-white" : "text-white/50"}`}>
          {label_text}
        </span>
        <span
          className={`ml-3 inline-block w-2 h-2 border-r border-b border-white/60 transition-transform ${open ? "rotate-[225deg]" : "rotate-45"}`}
        />
      </button>

      {open && !openUpward && index.length > 0 && (
        <div
          role="listbox"
          className="mt-2 bg-black/85 backdrop-blur-md border border-white/20 max-h-[320px] overflow-y-auto font-mono text-[11px] tracking-[0.15em] uppercase shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
        >
          {categories.map((cat) => (
            <div key={cat}>
              <div className="px-4 pt-3 pb-2 text-[9px] tracking-[0.35em] text-white/35 border-b border-white/10">
                {cat}
              </div>
              {grouped[cat].map((d) => {
                const isActive = d.slug === currentSlug;
                return (
                  <button
                    key={d.slug}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      onPick(d.slug, d);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 border-b border-white/5 transition-colors ${isActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
                  >
                    <span className="truncate">
                      <span
                        className={`inline-block w-1.5 h-1.5 mr-2 align-middle ${isActive ? "bg-white" : "bg-white/25"}`}
                      />
                      {d.name}
                    </span>
                    <span className="text-white/40 text-[10px] shrink-0">
                      {d.country}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {open && index.length === 0 && (
        <div className="mt-2 bg-black/80 border border-white/20 px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-white/50">
          No destinations generated yet.
        </div>
      )}
    </div>
  );
}
