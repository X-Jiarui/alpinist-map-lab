import { useMemo } from "react";
import type * as MBGL from "mapbox-gl";
import ExplorationShell from "./shared/ExplorationShell";
import { useMapbox } from "./shared/useMapbox";
import {
  MOCK_HOTELS,
  TRAIL_GEOJSON,
  YUBENG_CENTER,
  buildLngLatGrid,
} from "./shared/mockData";

declare const mapboxgl: typeof import("mapbox-gl").default;

const BLUEPRINT_STYLE: MBGL.StyleSpecification = {
  version: 8,
  name: "blueprint",
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#003366" } },
  ],
  glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
};

export default function V7Blueprint() {
  const style = useMemo(() => BLUEPRINT_STYLE, []);
  const grid = useMemo(
    () => buildLngLatGrid(YUBENG_CENTER[0], YUBENG_CENTER[1], 0.01, 0.12),
    [],
  );

  const { containerRef, ready, error } = useMapbox({
    style,
    pitch: 0,
    bearing: 0,
    zoom: 12.5,
    onStyleLoad: (map) => {
      if (!map.getSource("terrain-v2")) {
        map.addSource("terrain-v2", {
          type: "vector",
          url: "mapbox://mapbox.mapbox-terrain-v2",
        });
      }

      // Background grid lines
      if (!map.getSource("grid")) {
        map.addSource("grid", { type: "geojson", data: grid });
      }
      map.addLayer({
        id: "grid",
        type: "line",
        source: "grid",
        paint: {
          "line-color": "#FFFFFF",
          "line-width": 0.3,
          "line-opacity": 0.18,
        },
      });

      // Contours — crisp white 1px hairlines
      map.addLayer({
        id: "contour",
        type: "line",
        source: "terrain-v2",
        "source-layer": "contour",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#FFFFFF",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.3,
            14,
            0.9,
          ],
          "line-opacity": 0.75,
        },
      });
      // Index contour (every 100m)
      map.addLayer({
        id: "contour-index",
        type: "line",
        source: "terrain-v2",
        "source-layer": "contour",
        filter: ["==", ["%", ["to-number", ["get", "ele"]], 100], 0],
        paint: {
          "line-color": "#FFFFFF",
          "line-width": 1.3,
          "line-opacity": 1,
        },
      });

      // Water as white hairlines
      try {
        map.addLayer({
          id: "waterlines",
          type: "line",
          source: "terrain-v2",
          "source-layer": "water",
          paint: {
            "line-color": "#FFFFFF",
            "line-width": 1.2,
            "line-dasharray": [3, 2],
            "line-opacity": 0.9,
          },
        });
      } catch { /* skip */ }

      // Trail — dashed white
      if (!map.getSource("trail")) {
        map.addSource("trail", { type: "geojson", data: TRAIL_GEOJSON });
      }
      map.addLayer({
        id: "trail",
        type: "line",
        source: "trail",
        paint: {
          "line-color": "#FFFFFF",
          "line-width": 1.6,
          "line-dasharray": [4, 2],
          "line-opacity": 1,
        },
      });

      for (const hotel of MOCK_HOTELS) {
        const el = document.createElement("div");
        el.style.cssText = `
          font-family: 'IBM Plex Mono', monospace;
          color: #FFFFFF;
          background: transparent;
          border: 1px solid #FFFFFF;
          padding: 6px 8px;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          white-space: nowrap;
          cursor: crosshair;
          position: relative;
        `;
        el.innerHTML = `
          <div style="position:absolute; left:-16px; top:50%; width:10px; height:1px; background:#fff;"></div>
          <div style="position:absolute; right:-16px; top:50%; width:10px; height:1px; background:#fff;"></div>
          <div>◎ ${hotel.name}</div>
          <div style="color:rgba(255,255,255,0.7); margin-top:2px;">
            ${hotel.currency}${hotel.pricePerNight} / night
          </div>
          <div style="color:rgba(255,255,255,0.5); margin-top:1px; font-size:9px;">
            ${hotel.coordinates[1].toFixed(4)}° N · ${hotel.coordinates[0].toFixed(4)}° E
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
      index={7}
      title="Deep Ocean Blueprint"
      subtitle="Cyanotype"
      chipColor="rgba(0,51,102,0.9)"
      chipText="#FFFFFF"
      backBg="rgba(0,51,102,0.85)"
    >
      <div
        className="absolute inset-0"
        style={{ background: "#003366", cursor: "crosshair" }}
      >
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs tracking-[0.3em] uppercase text-white/70">
            Drafting blueprint…
          </div>
        )}

        {/* Paper-grain overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-[6]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "8px 8px, 8px 8px",
          }}
        />

        {/* Title block — bottom-right engineering frame */}
        <div className="absolute bottom-8 right-8 z-[5] border border-white text-white font-mono bg-[#003366]/80 backdrop-blur-sm">
          <div className="grid grid-cols-2 text-[10px]">
            <div className="border-r border-b border-white px-3 py-2 uppercase tracking-[0.2em] opacity-70">
              Project
            </div>
            <div className="border-b border-white px-3 py-2 uppercase tracking-[0.2em]">
              Alpinist / Yubeng
            </div>
            <div className="border-r border-b border-white px-3 py-2 uppercase tracking-[0.2em] opacity-70">
              Sheet
            </div>
            <div className="border-b border-white px-3 py-2 uppercase tracking-[0.2em]">
              07 / 10 — Topo Survey
            </div>
            <div className="border-r border-b border-white px-3 py-2 uppercase tracking-[0.2em] opacity-70">
              Scale
            </div>
            <div className="border-b border-white px-3 py-2 uppercase tracking-[0.2em]">
              1 : 15,000
            </div>
            <div className="border-r border-white px-3 py-2 uppercase tracking-[0.2em] opacity-70">
              Date
            </div>
            <div className="px-3 py-2 uppercase tracking-[0.2em]">
              2026 · 04 · 23
            </div>
          </div>
        </div>

        {/* North arrow */}
        <div className="absolute top-20 right-8 z-[5] text-white font-mono text-xs tracking-widest uppercase text-center">
          <div className="text-[26px] leading-none">↑</div>
          <div>N</div>
        </div>

        {/* Left descriptor */}
        <div className="absolute top-20 left-8 max-w-[260px] z-[5] text-white font-mono text-[10px] tracking-[0.2em] uppercase leading-relaxed">
          <div className="text-white/60">// FIG_07</div>
          <div className="text-white/90 text-[13px] tracking-[0.3em] mt-1 mb-3">
            YUBENG VALLEY
          </div>
          <div className="text-white/50 normal-case tracking-wider">
            Contour interval: 20 m · Index line every 100 m. Primary survey
            above 3,150 m ASL.
          </div>
        </div>

        {/* Full-bleed crosshair cursor */}
      </div>
    </ExplorationShell>
  );
}
