import { useMemo } from "react";
import type * as MBGL from "mapbox-gl";
import ExplorationShell from "./shared/ExplorationShell";
import { useMapbox } from "./shared/useMapbox";
import { MOCK_HOTELS, TRAIL_GEOJSON } from "./shared/mockData";

declare const mapboxgl: typeof import("mapbox-gl").default;

const PAPER_STYLE: MBGL.StyleSpecification = {
  version: 8,
  name: "paper-cutout",
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#E7D3B0" } },
  ],
  glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
};

// Earthy palette — sand → terracotta → sage → forest
const BANDS: Array<{ min: number; max: number; color: string }> = [
  { min: 0, max: 2000, color: "#E7D3B0" },
  { min: 2000, max: 2500, color: "#D9BC8E" },
  { min: 2500, max: 3000, color: "#C9B38C" },
  { min: 3000, max: 3500, color: "#D9A577" },
  { min: 3500, max: 4000, color: "#B98A64" },
  { min: 4000, max: 4500, color: "#9CAF88" },
  { min: 4500, max: 5000, color: "#6E8B6E" },
  { min: 5000, max: 7000, color: "#4A5D4F" },
];

export default function V5PaperCutout() {
  const style = useMemo(() => PAPER_STYLE, []);
  const { containerRef, ready, error } = useMapbox({
    style,
    pitch: 45,
    bearing: 22,
    zoom: 12.5,
    onStyleLoad: (map) => {
      if (!map.getSource("terrain-v2")) {
        map.addSource("terrain-v2", {
          type: "vector",
          url: "mapbox://mapbox.mapbox-terrain-v2",
        });
      }

      // Layer 1: stacked fills if contour polygons exist (mapbox.mapbox-terrain-v2 has `contour` as lines, but `hillshade` not applicable here).
      // Fallback strategy: render discrete colored contour LINE bands so the effect reads as stepped paper.
      BANDS.forEach((band, i) => {
        map.addLayer({
          id: `paper-band-${i}`,
          type: "fill",
          source: "terrain-v2",
          "source-layer": "contour",
          filter: [
            "all",
            [">=", ["to-number", ["get", "ele"]], band.min],
            ["<", ["to-number", ["get", "ele"]], band.max],
          ],
          paint: {
            "fill-color": band.color,
            "fill-opacity": 0.85,
          },
        });
        map.addLayer({
          id: `paper-band-edge-${i}`,
          type: "line",
          source: "terrain-v2",
          "source-layer": "contour",
          filter: [
            "all",
            [">=", ["to-number", ["get", "ele"]], band.min],
            ["<", ["to-number", ["get", "ele"]], band.max],
          ],
          paint: {
            "line-color": band.color,
            "line-width": 4,
            "line-opacity": 0.9,
          },
        });
      });

      // Fine contour hairlines for extra texture
      map.addLayer({
        id: "paper-hairlines",
        type: "line",
        source: "terrain-v2",
        "source-layer": "contour",
        paint: {
          "line-color": "#4A3120",
          "line-width": 0.3,
          "line-opacity": 0.2,
        },
      });

      // Trail — red yarn / twine look
      if (!map.getSource("trail")) {
        map.addSource("trail", { type: "geojson", data: TRAIL_GEOJSON });
      }
      map.addLayer({
        id: "trail-shadow",
        type: "line",
        source: "trail",
        paint: {
          "line-color": "#3a2410",
          "line-width": 5,
          "line-translate": [2, 3],
          "line-blur": 2,
          "line-opacity": 0.3,
        },
      });
      map.addLayer({
        id: "trail-line",
        type: "line",
        source: "trail",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#C43D2A",
          "line-width": 3,
          "line-dasharray": [1, 0.6],
        },
      });

      for (const hotel of MOCK_HOTELS) {
        const el = document.createElement("div");
        el.style.cssText = `
          font-family: 'Playfair Display', Georgia, serif;
          background: #F3E3C1;
          color: #3a2410;
          padding: 10px 12px;
          border: 2px solid #3a2410;
          border-radius: 2px;
          box-shadow:
            3px 3px 0 #B98A64,
            6px 6px 0 rgba(58,36,16,0.25),
            8px 10px 12px rgba(58,36,16,0.35);
          transform: rotate(-2deg);
          cursor: pointer;
          font-size: 12px;
          min-width: 130px;
          transition: transform 180ms;
        `;
        el.innerHTML = `
          <div style="font-weight:700;">${hotel.name}</div>
          <div style="font-family:'IBM Plex Mono',monospace; font-size:10px; color:#C43D2A; margin-top:3px; letter-spacing:0.1em;">
            ${hotel.currency}${hotel.pricePerNight} · ${hotel.rating}★
          </div>
        `;
        el.addEventListener("mouseenter", () => {
          el.style.transform = "rotate(-2deg) translateY(-3px)";
        });
        el.addEventListener("mouseleave", () => {
          el.style.transform = "rotate(-2deg)";
        });
        new mapboxgl.Marker({ element: el, anchor: "bottom", offset: [0, -6] })
          .setLngLat(hotel.coordinates)
          .addTo(map);
      }
    },
  });

  return (
    <ExplorationShell
      index={5}
      title="Paper Cut-out"
      subtitle="Tactile Laser-Cut"
      chipColor="rgba(58,36,16,0.85)"
      chipText="#F3E3C1"
      backText="#F3E3C1"
      backBg="rgba(58,36,16,0.8)"
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 20%, #F3E3C1 0%, #E7D3B0 60%, #B98A64 110%)",
        }}
      >
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center font-serif italic text-[#3a2410]/80">
            Cutting paper…
          </div>
        )}

        {/* Paper texture overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-[6]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, rgba(58,36,16,0.05) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(58,36,16,0.06) 0%, transparent 50%)",
            mixBlendMode: "multiply",
          }}
        />

        <div className="absolute bottom-14 left-10 max-w-sm z-[5]" style={{ transform: "rotate(-1.5deg)" }}>
          <div
            className="bg-[#F3E3C1] border-2 border-[#3a2410] p-5"
            style={{ boxShadow: "4px 4px 0 #B98A64, 8px 8px 0 rgba(58,36,16,0.25)" }}
          >
            <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#C43D2A]">
              No. 05 — Handcrafted Editions
            </div>
            <h2 className="font-serif text-4xl text-[#3a2410] mt-2 leading-none">
              Yubeng, Deqin
            </h2>
            <div className="mt-3 font-mono text-[10px] tracking-[0.25em] uppercase text-[#3a2410]/70 leading-relaxed">
              Eight laser-cut elevation bands.
              <br />
              Mounted on warm pulp stock.
            </div>
          </div>
        </div>
      </div>
    </ExplorationShell>
  );
}
