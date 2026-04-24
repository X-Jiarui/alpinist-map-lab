import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EXPLORATIONS } from "@/explorations/shared/mockData";

export default function Menu() {
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= "1" && e.key <= "9") {
        navigate(`/v${e.key}`);
      } else if (e.key === "0") {
        navigate(`/v10`);
      } else if (e.key === "u" || e.key === "U") {
        navigate(`/v11`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="min-h-full w-full bg-[#0a0a0a] text-neutral-100">
      <header className="border-b border-white/5 px-8 py-6 flex items-baseline justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] uppercase opacity-50">
            Alpinist / Map Lab
          </div>
          <h1 className="font-serif text-4xl md:text-5xl mt-2 leading-none">
            Yubeng Village — 11 Cartographies
          </h1>
        </div>
        <div className="font-mono text-[10px] tracking-[0.25em] uppercase opacity-40 text-right hidden md:block">
          28.4333° N, 98.7667° E
          <br />
          Deqin, Yunnan
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-[1px] bg-white/5">
        {EXPLORATIONS.map((ex, idx) => (
          <Link
            key={ex.id}
            to={`/${ex.slug}`}
            className="group relative overflow-hidden bg-[#0a0a0a] aspect-[4/5] p-6 flex flex-col justify-between hover:bg-[#121212] transition-colors"
            style={{
              backgroundImage: `linear-gradient(135deg, ${ex.palette[0]} 0%, ${ex.palette[1]} 55%, ${ex.palette[2]} 100%)`,
            }}
          >
            <div
              className="absolute inset-0 transition-opacity duration-500 opacity-80 group-hover:opacity-100 mix-blend-multiply"
              style={{ background: "radial-gradient(circle at 30% 20%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)" }}
            />
            <div className="relative flex items-center justify-between text-white mix-blend-difference">
              <span className="font-mono text-[10px] tracking-[0.35em]">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="font-mono text-[10px] tracking-[0.25em] opacity-60">
                /v{idx + 1}
              </span>
            </div>
            <div className="relative text-white mix-blend-difference">
              <div className="font-mono text-[10px] tracking-[0.25em] uppercase opacity-70">
                {ex.subtitle}
              </div>
              <div className="font-serif text-2xl md:text-[28px] leading-tight mt-1">
                {ex.title}
              </div>
              <div className="mt-4 h-[1px] w-8 bg-white/60 group-hover:w-full transition-all duration-500" />
            </div>
          </Link>
        ))}
      </div>

      <footer className="px-8 py-6 border-t border-white/5 flex justify-between items-center text-[10px] font-mono tracking-[0.25em] uppercase opacity-50">
        <span>Press 1–9 · 0 (v10) · U (v11 unified) · Hover a tile</span>
        <span>Mapbox GL v3 · Three.js r169</span>
      </footer>
    </div>
  );
}
