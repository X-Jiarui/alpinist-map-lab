import { useMemo } from "react";
import type * as MBGL from "mapbox-gl";
import ExplorationShell from "./shared/ExplorationShell";
import { useMapbox } from "./shared/useMapbox";
import { MOCK_HOTELS, TRAIL_GEOJSON } from "./shared/mockData";

declare const mapboxgl: typeof import("mapbox-gl").default;

const OBSIDIAN_STYLE: MBGL.StyleSpecification = {
  version: 8,
  name: "obsidian-gold",
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#000000" } },
  ],
  glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
};

export default function V3Obsidian() {
  const style = useMemo(() => OBSIDIAN_STYLE, []);
  const { containerRef, ready, error } = useMapbox({
    style,
    pitch: 62,
    bearing: 32,
    onStyleLoad: (map) => {
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

      if (!map.getSource("terrain-v2")) {
        map.addSource("terrain-v2", {
          type: "vector",
          url: "mapbox://mapbox.mapbox-terrain-v2",
        });
      }

      // Contour lines in gold — luxury hairlines
      map.addLayer({
        id: "contour-lines",
        type: "line",
        source: "terrain-v2",
        "source-layer": "contour",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#FFD700",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.2,
            14,
            0.7,
          ],
          "line-opacity": 0.5,
        },
      });
      // Index contours, brighter
      map.addLayer({
        id: "contour-lines-index",
        type: "line",
        source: "terrain-v2",
        "source-layer": "contour",
        filter: ["==", ["%", ["to-number", ["get", "ele"]], 200], 0],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#FFE57A",
          "line-width": 0.9,
          "line-opacity": 0.85,
        },
      });

      // Streams
      try {
        map.addLayer({
          id: "streams",
          type: "line",
          source: "terrain-v2",
          "source-layer": "water",
          paint: {
            "line-color": "#FFD700",
            "line-width": 0.8,
            "line-opacity": 0.6,
          },
        });
      } catch { /* source-layer may not exist */ }

      // Fog fade to black.
      map.setFog({
        color: "#050300",
        "horizon-blend": 0.5,
        range: [0.5, 8],
        "high-color": "#1a1000",
        "space-color": "#000000",
        "star-intensity": 0.15,
      });

      if (!map.getSource("trail")) {
        map.addSource("trail", { type: "geojson", data: TRAIL_GEOJSON });
      }
      map.addLayer({
        id: "trail-glow",
        type: "line",
        source: "trail",
        paint: {
          "line-color": "#FFD700",
          "line-width": 6,
          "line-blur": 8,
          "line-opacity": 0.5,
        },
      });
      map.addLayer({
        id: "trail-line",
        type: "line",
        source: "trail",
        paint: {
          "line-color": "#FFE57A",
          "line-width": 1.4,
          "line-opacity": 1,
        },
      });

      for (const hotel of MOCK_HOTELS) {
        const el = document.createElement("div");
        el.style.cssText = `
          font-family: 'Playfair Display', Georgia, serif;
          color: #FFE57A;
          background: rgba(0,0,0,0.7);
          border: 1px solid rgba(255,215,0,0.45);
          padding: 10px 14px;
          font-size: 12px;
          letter-spacing: 0.04em;
          min-width: 140px;
          box-shadow: 0 0 24px rgba(255,215,0,0.15);
          backdrop-filter: blur(6px);
        `;
        el.innerHTML = `
          <div style="font-style:italic; font-weight:500; font-size:13px;">${hotel.name}</div>
          <div style="height:1px;background:rgba(255,215,0,0.3);margin:6px 0;"></div>
          <div style="font-family: 'IBM Plex Mono', monospace; font-size:10px; letter-spacing:0.18em; text-transform:uppercase;">
            ${hotel.currency}${hotel.pricePerNight} · ${hotel.rating}★
          </div>
        `;
        new mapboxgl.Marker({ element: el, anchor: "bottom", offset: [0, -6] })
          .setLngLat(hotel.coordinates)
          .addTo(map);
      }
    },
  });

  return (
    <ExplorationShell
      index={3}
      title="Obsidian & Gold"
      subtitle="Luxury Wireframe"
      chipColor="rgba(0,0,0,0.85)"
      chipText="#FFD700"
      backText="#FFD700"
      backBg="rgba(0,0,0,0.7)"
    >
      <div className="absolute inset-0 bg-black">
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center font-serif italic text-[#FFD700]/80">
            Gilding the mountain…
          </div>
        )}

        {/* Gold hairline frame */}
        <div className="pointer-events-none absolute inset-6 border border-[#FFD700]/30 z-[6]" />
        <div className="pointer-events-none absolute inset-8 border border-[#FFD700]/10 z-[6]" />

        {/* Centerpiece title */}
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 text-center z-[5] pointer-events-none">
          <div className="font-mono text-[9px] tracking-[0.5em] uppercase text-[#FFD700]/70">
            — Yunnan · Deqin —
          </div>
          <h2 className="font-serif italic text-6xl text-[#FFE57A] mt-3 leading-none" style={{ textShadow: "0 0 24px rgba(255,215,0,0.35)" }}>
            Yubeng
          </h2>
          <div className="mt-3 font-mono text-[10px] tracking-[0.35em] uppercase text-[#FFD700]/60">
            Est. Sacred · Alpine Reserve
          </div>
          <div className="mt-4 w-24 h-[1px] mx-auto bg-[#FFD700]/50" />
        </div>

        {/* Top-left crest */}
        <div className="absolute top-16 left-8 max-w-[260px] z-[5] border border-[#FFD700]/30 p-4 bg-black/50 backdrop-blur-sm">
          <div className="font-mono text-[9px] tracking-[0.35em] uppercase text-[#FFD700]/70">
            Chapter I
          </div>
          <div className="font-serif italic text-lg text-[#FFE57A] mt-2">
            The Alpinist Collection
          </div>
          <div className="mt-2 text-[10px] text-[#FFD700]/50 font-mono tracking-widest">
            Est. 2026 · Curated Stays
          </div>
        </div>
      </div>
    </ExplorationShell>
  );
}
