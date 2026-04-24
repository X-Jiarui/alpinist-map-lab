import { useMemo } from "react";
import type * as MBGL from "mapbox-gl";
import ExplorationShell from "./shared/ExplorationShell";
import { useMapbox } from "./shared/useMapbox";
import { MOCK_HOTELS, TRAIL_GEOJSON } from "./shared/mockData";

declare const mapboxgl: typeof import("mapbox-gl").default;

const RICE_PAPER_STYLE: MBGL.StyleSpecification = {
  version: 8,
  name: "shanshui",
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#F9F6F0" } },
  ],
  glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
};

export default function V6Shanshui() {
  const style = useMemo(() => RICE_PAPER_STYLE, []);
  const { containerRef, ready, error } = useMapbox({
    style,
    pitch: 60,
    bearing: 25,
    onStyleLoad: (map) => {
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.6 });

      if (!map.getSource("ink-dem")) {
        map.addSource("ink-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.addLayer({
        id: "ink-hillshade",
        type: "hillshade",
        source: "ink-dem",
        paint: {
          "hillshade-exaggeration": 1,
          "hillshade-shadow-color": "#1a1a1a",
          "hillshade-highlight-color": "#F9F6F0",
          "hillshade-accent-color": "#8a8a8a",
        },
      });

      // Ink-bleed fog at the base of mountains
      map.setFog({
        color: "#F9F6F0",
        "horizon-blend": 0.65,
        range: [0.3, 4],
        "high-color": "#e6dfd0",
        "space-color": "#F9F6F0",
        "star-intensity": 0,
      } as never);

      // Trail: thin ink stroke
      if (!map.getSource("trail")) {
        map.addSource("trail", { type: "geojson", data: TRAIL_GEOJSON });
      }
      map.addLayer({
        id: "trail-bleed",
        type: "line",
        source: "trail",
        paint: {
          "line-color": "#1a1a1a",
          "line-width": 4,
          "line-blur": 3,
          "line-opacity": 0.25,
        },
      });
      map.addLayer({
        id: "trail-ink",
        type: "line",
        source: "trail",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#1a1a1a",
          "line-width": 1.4,
          "line-opacity": 0.9,
        },
      });

      for (const hotel of MOCK_HOTELS) {
        const el = document.createElement("div");
        el.style.cssText = `
          font-family: 'Noto Serif SC', 'Playfair Display', serif;
          color: #1a1a1a;
          background: rgba(249,246,240,0.95);
          padding: 10px 12px;
          border: 1px solid rgba(26,26,26,0.35);
          border-radius: 2px;
          font-size: 12px;
          line-height: 1.4;
          cursor: pointer;
          box-shadow: 0 4px 24px rgba(26,26,26,0.1);
        `;
        el.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:10px;height:10px;background:#8B0000;display:inline-block;border-radius:1px;"></span>
            <span style="font-weight:600;">${hotel.nameZh ?? hotel.name}</span>
          </div>
          <div style="font-family:'IBM Plex Mono',monospace; font-size:10px; color:rgba(26,26,26,0.6); margin-top:4px; letter-spacing:0.1em;">
            ${hotel.name} · ${hotel.currency}${hotel.pricePerNight}
          </div>
        `;
        new mapboxgl.Marker({ element: el, anchor: "bottom", offset: [0, -4] })
          .setLngLat(hotel.coordinates)
          .addTo(map);
      }
    },
  });

  return (
    <ExplorationShell
      index={6}
      title="Ink Wash 山水"
      subtitle="Modern Shanshui"
      chipColor="rgba(249,246,240,0.95)"
      chipText="#1a1a1a"
      backText="#1a1a1a"
      backBg="rgba(249,246,240,0.85)"
    >
      <div
        className="absolute inset-0"
        style={{
          background: "#F9F6F0",
          backgroundImage:
            "radial-gradient(circle at 15% 20%, rgba(30,30,30,0.04) 0%, transparent 50%), radial-gradient(circle at 85% 75%, rgba(30,30,30,0.05) 0%, transparent 40%)",
        }}
      >
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center font-serif text-[#1a1a1a]/70">
            墨 · 研ing…
          </div>
        )}

        {/* Vertical title — traditional Chinese orientation */}
        <div
          className="absolute top-20 right-14 z-[5] pointer-events-none select-none"
          style={{
            writingMode: "vertical-rl" as const,
            textOrientation: "mixed" as const,
          }}
        >
          <div
            className="text-[72px] leading-[0.95] text-[#1a1a1a]"
            style={{
              fontFamily: "'Noto Serif SC', serif",
              fontWeight: 900,
              letterSpacing: "0.08em",
            }}
          >
            雨崩村
          </div>
          <div
            className="mt-6 text-[11px] tracking-[0.4em] text-[#1a1a1a]/70 font-mono"
          >
            YUBENG · YUNNAN · 2026
          </div>
        </div>

        {/* Crimson seal */}
        <div className="absolute bottom-16 right-14 z-[5]">
          <div
            className="w-16 h-16 flex items-center justify-center text-center text-[#F9F6F0] text-xs leading-tight"
            style={{
              background: "#8B0000",
              fontFamily: "'Noto Serif SC', serif",
              fontWeight: 900,
              boxShadow: "0 0 0 2px #8B0000 inset, 0 0 0 3px #F9F6F0 inset, 0 0 0 4px #8B0000 inset",
              transform: "rotate(-4deg)",
            }}
          >
            阿尔卑<br />尼斯特
          </div>
        </div>

        {/* CTA button styled as seal */}
        <div className="absolute bottom-16 left-16 z-[5]">
          <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#1a1a1a]/60">
            — Chapter 01
          </div>
          <h2 className="font-serif text-5xl text-[#1a1a1a] mt-2 leading-none" style={{ fontFamily: "'Noto Serif SC', serif", fontWeight: 400 }}>
            朝山
          </h2>
          <div className="mt-3 font-mono text-[10px] tracking-[0.2em] uppercase text-[#1a1a1a]/70 max-w-[200px] leading-relaxed">
            "Pilgrimage to the mountain — trace the ink, find the way."
          </div>
          <button
            className="mt-5 px-6 py-3 bg-[#8B0000] text-[#F9F6F0] font-serif text-sm tracking-[0.3em] uppercase hover:bg-[#6a0000] transition-colors"
            style={{ letterSpacing: "0.3em" }}
          >
            Begin
          </button>
        </div>
      </div>
    </ExplorationShell>
  );
}
