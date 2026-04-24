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

const SYNTH_STYLE: MBGL.StyleSpecification = {
  version: 8,
  name: "synthwave",
  sources: {},
  layers: [
    {
      id: "bg",
      type: "background",
      paint: { "background-color": "#1a0033" },
    },
  ],
  glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
};

export default function V4Synthwave() {
  const style = useMemo(() => SYNTH_STYLE, []);
  const grid = useMemo(
    () => buildLngLatGrid(YUBENG_CENTER[0], YUBENG_CENTER[1], 0.005, 0.12),
    [],
  );

  const { containerRef, ready, error } = useMapbox({
    style,
    pitch: 70,
    bearing: 28,
    zoom: 12.8,
    onStyleLoad: (map) => {
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.8 });

      if (!map.getSource("terrain-v2")) {
        map.addSource("terrain-v2", {
          type: "vector",
          url: "mapbox://mapbox.mapbox-terrain-v2",
        });
      }

      // Magenta contour wireframe across terrain mesh
      map.addLayer({
        id: "synth-contours",
        type: "line",
        source: "terrain-v2",
        "source-layer": "contour",
        paint: {
          "line-color": "#FF00FF",
          "line-width": 0.6,
          "line-opacity": 0.55,
        },
      });

      // Water in neon cyan
      try {
        map.addLayer({
          id: "synth-water",
          type: "line",
          source: "terrain-v2",
          "source-layer": "water",
          paint: {
            "line-color": "#00FFFF",
            "line-width": 1.2,
            "line-blur": 1.5,
            "line-opacity": 0.9,
          },
        });
      } catch { /* skip */ }

      // Grid GeoJSON
      if (!map.getSource("grid")) {
        map.addSource("grid", { type: "geojson", data: grid });
      }
      map.addLayer({
        id: "grid-glow",
        type: "line",
        source: "grid",
        paint: {
          "line-color": "#FF00FF",
          "line-width": 1.2,
          "line-blur": 4,
          "line-opacity": 0.22,
        },
      });
      map.addLayer({
        id: "grid-lines",
        type: "line",
        source: "grid",
        paint: {
          "line-color": "#FF6EFF",
          "line-width": 0.4,
          "line-opacity": 0.4,
        },
      });

      // Fog horizon
      map.setFog({
        color: "#FF00FF",
        "horizon-blend": 0.1,
        range: [0.5, 10],
        "high-color": "#2a0044",
        "space-color": "#0a0022",
        "star-intensity": 0.6,
      } as never);

      // Trail — hot magenta + cyan glow
      if (!map.getSource("trail")) {
        map.addSource("trail", { type: "geojson", data: TRAIL_GEOJSON });
      }
      map.addLayer({
        id: "trail-outer-glow",
        type: "line",
        source: "trail",
        paint: {
          "line-color": "#00FFFF",
          "line-width": 14,
          "line-blur": 18,
          "line-opacity": 0.4,
        },
      });
      map.addLayer({
        id: "trail-glow",
        type: "line",
        source: "trail",
        paint: {
          "line-color": "#FF00FF",
          "line-width": 8,
          "line-blur": 6,
          "line-opacity": 0.75,
        },
      });
      map.addLayer({
        id: "trail-core",
        type: "line",
        source: "trail",
        paint: {
          "line-color": "#FFFFFF",
          "line-width": 2,
          "line-opacity": 1,
        },
      });

      for (const hotel of MOCK_HOTELS) {
        const el = document.createElement("div");
        el.className = "synth-marker";
        el.style.cssText = `
          font-family: 'IBM Plex Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          font-size: 10px;
          color: #00FFFF;
          background: rgba(26,0,51,0.75);
          border: 1px solid #FF00FF;
          padding: 6px 10px;
          box-shadow: 0 0 0 1px #FF00FF, 0 0 16px rgba(255,0,255,0.7), inset 0 0 12px rgba(0,255,255,0.2);
          white-space: nowrap;
          cursor: pointer;
          clip-path: polygon(6% 0, 100% 0, 100% 70%, 94% 100%, 0 100%, 0 30%);
        `;
        el.innerHTML = `
          <div style="color:#FF00FF;">▲ ${hotel.name}</div>
          <div style="color:#00FFFF; margin-top:2px;">${hotel.currency}${hotel.pricePerNight}/nt</div>
        `;
        el.addEventListener("mouseenter", () => {
          el.style.animation = "glitch-shift 180ms steps(1) infinite";
          el.style.color = "#FF00FF";
        });
        el.addEventListener("mouseleave", () => {
          el.style.animation = "";
          el.style.color = "#00FFFF";
        });
        new mapboxgl.Marker({ element: el, anchor: "bottom", offset: [0, -4] })
          .setLngLat(hotel.coordinates)
          .addTo(map);
      }
    },
  });

  return (
    <ExplorationShell
      index={4}
      title="Synthwave Grid"
      subtitle="1988 Arcade Mode"
      chipColor="rgba(26,0,51,0.85)"
      chipText="#FF00FF"
      backText="#00FFFF"
      backBg="rgba(26,0,51,0.8)"
    >
      <div className="absolute inset-0" style={{ background: "#1a0033" }}>
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs tracking-[0.4em] uppercase text-[#FF00FF]">
            Booting grid…
          </div>
        )}

        {/* CRT scanlines */}
        <div
          className="pointer-events-none absolute inset-0 z-[10]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.25) 0px, rgba(0,0,0,0.25) 1px, transparent 1px, transparent 3px)",
            mixBlendMode: "multiply",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 z-[11]"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 55%, rgba(10,0,30,0.7) 100%)",
          }}
        />

        <div className="absolute top-16 left-8 z-[5] font-mono text-[10px] tracking-[0.25em] uppercase">
          <div className="text-[#00FFFF]">&gt; YUBENG.SYS LOADED</div>
          <div className="text-[#FF00FF] mt-1">&gt; TERRAIN_EXAG: 1.8×</div>
          <div className="text-[#00FFFF] mt-1">&gt; GRID_STEP: 0.005°</div>
        </div>

        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-center z-[5] pointer-events-none">
          <h2
            className="font-serif text-6xl md:text-7xl tracking-tight"
            style={{
              background:
                "linear-gradient(180deg, #FF00FF 0%, #FFFFFF 48%, #00FFFF 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              textShadow: "0 0 24px rgba(255,0,255,0.5)",
              filter: "drop-shadow(0 0 12px rgba(255,0,255,0.5))",
            }}
          >
            YUBENG
          </h2>
          <div className="font-mono text-[11px] tracking-[0.4em] uppercase text-[#00FFFF] mt-2">
            — 1988 EDITION —
          </div>
        </div>
      </div>
    </ExplorationShell>
  );
}
