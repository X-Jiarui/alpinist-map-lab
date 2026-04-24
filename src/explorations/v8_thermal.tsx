import { useMemo } from "react";
import type * as MBGL from "mapbox-gl";
import ExplorationShell from "./shared/ExplorationShell";
import { useMapbox } from "./shared/useMapbox";
import { MOCK_HOTELS, TRAIL_GEOJSON } from "./shared/mockData";

declare const mapboxgl: typeof import("mapbox-gl").default;

const THERMAL_STYLE: MBGL.StyleSpecification = {
  version: 8,
  name: "thermal",
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0a0016" } },
  ],
  glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
};

export default function V8Thermal() {
  const style = useMemo(() => THERMAL_STYLE, []);
  const { containerRef, ready, error } = useMapbox({
    style,
    pitch: 65,
    bearing: 28,
    onStyleLoad: (map) => {
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 2.0 });

      if (!map.getSource("terrain-v2")) {
        map.addSource("terrain-v2", {
          type: "vector",
          url: "mapbox://mapbox.mapbox-terrain-v2",
        });
      }

      // Thick thermal contour fills (elevation bands as stacked colors)
      const bands = [
        { min: 0, max: 2000, color: "rgba(45,0,102,0.75)" },
        { min: 2000, max: 2750, color: "rgba(92,0,160,0.75)" },
        { min: 2750, max: 3300, color: "rgba(199,0,57,0.75)" },
        { min: 3300, max: 3900, color: "rgba(255,60,0,0.8)" },
        { min: 3900, max: 4600, color: "rgba(255,140,0,0.85)" },
        { min: 4600, max: 5300, color: "rgba(255,220,0,0.9)" },
        { min: 5300, max: 7000, color: "rgba(255,255,240,0.95)" },
      ];
      bands.forEach((b, i) => {
        map.addLayer({
          id: `therm-fill-${i}`,
          type: "fill",
          source: "terrain-v2",
          "source-layer": "contour",
          filter: [
            "all",
            [">=", ["to-number", ["get", "ele"]], b.min],
            ["<", ["to-number", ["get", "ele"]], b.max],
          ],
          paint: {
            "fill-color": b.color,
            "fill-opacity": 0.75,
          },
        });
      });

      // Glowing contour lines
      map.addLayer({
        id: "therm-lines",
        type: "line",
        source: "terrain-v2",
        "source-layer": "contour",
        paint: {
          "line-color": [
            "interpolate",
            ["linear"],
            ["get", "ele"],
            1500,
            "#2d0066",
            2500,
            "#C70039",
            3500,
            "#FF8C00",
            4500,
            "#FFFF00",
            5500,
            "#FFFFFF",
          ],
          "line-width": 0.8,
          "line-opacity": 0.9,
          "line-blur": 0.5,
        },
      });

      if (!map.getSource("trail")) {
        map.addSource("trail", { type: "geojson", data: TRAIL_GEOJSON });
      }
      map.addLayer({
        id: "trail-line",
        type: "line",
        source: "trail",
        paint: {
          "line-color": "#000000",
          "line-width": 2,
          "line-dasharray": [2, 1.5],
          "line-opacity": 1,
        },
      });

      for (const hotel of MOCK_HOTELS) {
        const el = document.createElement("div");
        el.style.cssText = `
          font-family: 'IBM Plex Mono', monospace;
          color: #FFFFFF;
          background: #000000;
          padding: 6px 8px;
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          white-space: nowrap;
          border: 1px solid #FFFFFF;
          cursor: crosshair;
        `;
        el.innerHTML = `
          <div>⊕ ${hotel.name}</div>
          <div style="color:#FFFF00; margin-top:2px;">
            TGT LOCK · ${hotel.currency}${hotel.pricePerNight}
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
      index={8}
      title="Thermal Vision"
      subtitle="Predator Drone"
      chipColor="#000000"
      chipText="#FFFFFF"
      backBg="#000000"
    >
      <div className="absolute inset-0 bg-black">
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs tracking-[0.4em] uppercase text-[#FFFF00]">
            Thermal calibration…
          </div>
        )}

        {/* Corner HUD brackets */}
        <Bracket pos="tl" />
        <Bracket pos="tr" />
        <Bracket pos="bl" />
        <Bracket pos="br" />

        {/* Top-left HUD */}
        <div className="absolute top-16 left-8 z-[5] bg-black text-white font-mono p-3 border border-white/60 text-[10px] tracking-[0.2em] uppercase">
          <div className="text-[#FFFF00]">▸ THERMAL ACTIVE</div>
          <div className="mt-1">SRC: DEM_V1</div>
          <div className="mt-1">RNG: 1.5K – 5.8K M</div>
          <div className="mt-1">LAT: 28.4333° N</div>
          <div className="mt-1">LNG: 98.7667° E</div>
        </div>

        {/* Right scale bar */}
        <div className="absolute top-1/2 right-8 -translate-y-1/2 z-[5] text-white font-mono text-[9px] tracking-[0.25em] uppercase flex items-center gap-3">
          <div
            className="w-3 h-56"
            style={{
              background:
                "linear-gradient(to bottom, #FFFFFF 0%, #FFFF00 15%, #FF8C00 35%, #C70039 60%, #5C00A0 85%, #2d0066 100%)",
            }}
          />
          <div className="flex flex-col justify-between h-56">
            <span>5.8K</span>
            <span className="opacity-60">4.5K</span>
            <span className="opacity-60">3.3K</span>
            <span className="opacity-60">2.5K</span>
            <span>1.5K m</span>
          </div>
        </div>

        {/* Bottom ticker */}
        <div className="absolute bottom-8 left-8 right-8 z-[5] bg-black border border-white/70 text-white font-mono text-[10px] tracking-[0.25em] uppercase flex justify-between px-4 py-2">
          <span>▸ YUBENG_BASIN</span>
          <span>ALT 3,150m – 5,876m</span>
          <span>TARGETS: 2</span>
          <span className="text-[#FFFF00]">◉ REC</span>
        </div>
      </div>
    </ExplorationShell>
  );
}

function Bracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const base = "absolute z-[4] w-8 h-8 pointer-events-none";
  const positions: Record<string, string> = {
    tl: "top-14 left-4 border-t-2 border-l-2",
    tr: "top-14 right-4 border-t-2 border-r-2",
    bl: "bottom-20 left-4 border-b-2 border-l-2",
    br: "bottom-20 right-4 border-b-2 border-r-2",
  };
  return <div className={`${base} ${positions[pos]} border-white/80`} />;
}
