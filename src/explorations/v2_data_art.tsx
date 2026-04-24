import { useMemo } from "react";
import type * as MBGL from "mapbox-gl";
import ExplorationShell from "./shared/ExplorationShell";
import { useMapbox } from "./shared/useMapbox";
import { MOCK_HOTELS, TRAIL_GEOJSON } from "./shared/mockData";

declare const mapboxgl: typeof import("mapbox-gl").default;

const BLANK_MIDNIGHT_STYLE: MBGL.StyleSpecification = {
  version: 8,
  name: "midnight-data",
  sources: {},
  layers: [
    {
      id: "bg",
      type: "background",
      paint: { "background-color": "#0B0C10" },
    },
  ],
  glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
};

export default function V2DataArt() {
  const style = useMemo(() => BLANK_MIDNIGHT_STYLE, []);
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

      // Contour polygons, soft halo beneath contour lines.
      map.addLayer({
        id: "contour-haze",
        type: "fill",
        source: "terrain-v2",
        "source-layer": "contour",
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "ele"],
            2000,
            "rgba(102,252,241,0.02)",
            3500,
            "rgba(157,235,225,0.03)",
            5000,
            "rgba(212,175,55,0.04)",
          ],
        },
      });

      // Contour lines, cyan→gold by elevation.
      map.addLayer({
        id: "contour-lines",
        type: "line",
        source: "terrain-v2",
        "source-layer": "contour",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": [
            "interpolate",
            ["linear"],
            ["get", "ele"],
            1500,
            "#2ea7a0",
            2500,
            "#66FCF1",
            3500,
            "#9DEBE1",
            4500,
            "#D4AF37",
            5500,
            "#FFD87A",
          ],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.3,
            14,
            1.3,
          ],
          "line-opacity": 0.9,
        },
      });

      // Index contours (every 500m) — thicker gold
      map.addLayer({
        id: "contour-lines-index",
        type: "line",
        source: "terrain-v2",
        "source-layer": "contour",
        filter: ["==", ["%", ["to-number", ["get", "ele"]], 500], 0],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#D4AF37",
          "line-width": 1.2,
          "line-opacity": 0.85,
        },
      });

      // Trail
      if (!map.getSource("trail")) {
        map.addSource("trail", { type: "geojson", data: TRAIL_GEOJSON });
      }
      map.addLayer({
        id: "trail-line",
        type: "line",
        source: "trail",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#FFF",
          "line-width": 1.8,
          "line-dasharray": [1, 2],
          "line-opacity": 0.95,
        },
      });

      // Hotel markers — glass readouts
      for (const hotel of MOCK_HOTELS) {
        const el = document.createElement("div");
        el.style.cssText = `
          font-family: 'IBM Plex Mono', ui-monospace, monospace;
          color: #E8FAF8;
          background: rgba(255,255,255,0.08);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 2px;
          padding: 8px 10px;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          line-height: 1.4;
          white-space: nowrap;
          box-shadow: 0 0 16px rgba(102,252,241,0.2);
          cursor: pointer;
        `;
        el.innerHTML = `
          <div style="color:#66FCF1;">◉ ${hotel.name}</div>
          <div style="color:#D4AF37; margin-top:3px;">
            ${hotel.currency}${hotel.pricePerNight} // ${hotel.rating}★
          </div>
          <div style="color:rgba(255,255,255,0.4); margin-top:2px;">
            ${hotel.coordinates[1].toFixed(4)}, ${hotel.coordinates[0].toFixed(4)}
          </div>
        `;
        new mapboxgl.Marker({ element: el, anchor: "top", offset: [0, 4] })
          .setLngLat(hotel.coordinates)
          .addTo(map);
      }
    },
  });

  return (
    <ExplorationShell
      index={2}
      title="Contour Data Poster"
      subtitle="Topology Art"
      chipColor="rgba(11,12,16,0.9)"
      chipText="#66FCF1"
      backBg="rgba(11,12,16,0.9)"
    >
      <div className="absolute inset-0" style={{ background: "#0B0C10" }}>
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs tracking-[0.3em] uppercase text-[#66FCF1]/80">
            Tracing contour…
          </div>
        )}

        {/* Left data panel */}
        <div className="absolute top-20 left-6 w-[280px] font-mono text-[10px] tracking-[0.15em] uppercase text-white/70 backdrop-blur-md bg-white/5 border border-white/10 p-4 rounded-sm z-[5]">
          <div className="text-[#66FCF1] text-[9px] mb-2">// SITE_REPORT</div>
          <div className="font-serif text-2xl text-white normal-case tracking-normal leading-tight">
            Yubeng Basin
          </div>
          <div className="text-white/40 mt-1 normal-case">28.4333°N, 98.7667°E</div>

          <div className="h-[1px] bg-white/10 my-3" />

          <Row label="Elev_min" value="3,150 m" />
          <Row label="Elev_max" value="5,876 m" />
          <Row label="Gradient" value="cyan → gold" />
          <Row label="Contour_step" value="20 m" />
          <Row label="Zoom" value="12.50" />
          <Row label="Pitch" value="0°" />
        </div>

        {/* Right legend */}
        <div className="absolute bottom-10 right-6 w-[220px] font-mono text-[9px] tracking-[0.2em] uppercase text-white/60 backdrop-blur-md bg-white/5 border border-white/10 p-4 rounded-sm z-[5]">
          <div className="text-[#66FCF1] mb-3">// ELEVATION_SCALE</div>
          <div className="h-2 rounded-sm" style={{
            background: "linear-gradient(90deg, #2ea7a0 0%, #66FCF1 25%, #9DEBE1 50%, #D4AF37 80%, #FFD87A 100%)",
          }} />
          <div className="flex justify-between mt-2 text-white/70">
            <span>1.5K</span>
            <span>3.5K</span>
            <span>5.5K m</span>
          </div>
          <div className="h-[1px] bg-white/10 my-3" />
          <Row label="Trail" value="SACRED FALLS" />
          <Row label="Length" value="3.6 KM" />
          <Row label="Δ Elev" value="+420 M" />
        </div>
      </div>
    </ExplorationShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 border-b border-white/5 last:border-0">
      <span className="text-white/40">{label}</span>
      <span className="text-white/90">{value}</span>
    </div>
  );
}
