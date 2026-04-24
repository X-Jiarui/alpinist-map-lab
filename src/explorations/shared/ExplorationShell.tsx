import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface ExplorationShellProps {
  index: number;
  title: string;
  subtitle?: string;
  chipColor?: string;
  chipText?: string;
  backText?: string;
  backBg?: string;
  children: ReactNode;
}

export default function ExplorationShell({
  index,
  title,
  subtitle,
  chipColor = "rgba(0,0,0,0.85)",
  chipText = "#ffffff",
  backText = "#ffffff",
  backBg = "rgba(0,0,0,0.6)",
  children,
}: ExplorationShellProps) {
  return (
    <div className="fixed inset-0 overflow-hidden">
      {children}
      <Link
        to="/"
        className="fixed top-4 left-4 z-[1000] px-3 py-1.5 text-[11px] tracking-[0.2em] uppercase font-medium backdrop-blur-md rounded-sm hover:opacity-80 transition-opacity"
        style={{ color: backText, background: backBg, letterSpacing: "0.18em" }}
      >
        ← Back
      </Link>
      <div
        className="fixed top-4 right-4 z-[1000] px-3 py-1.5 rounded-sm text-[10px] font-mono tracking-widest backdrop-blur-md"
        style={{ background: chipColor, color: chipText }}
      >
        <span className="opacity-60">{String(index).padStart(2, "0")}/10</span>
        <span className="mx-2 opacity-30">│</span>
        <span className="uppercase">{title}</span>
        {subtitle && <span className="opacity-50 ml-2 normal-case">{subtitle}</span>}
      </div>
    </div>
  );
}
