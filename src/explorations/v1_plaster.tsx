import { useMemo } from "react";
import type * as MBGL from "mapbox-gl";
import ExplorationShell from "./shared/ExplorationShell";
import { useMapbox } from "./shared/useMapbox";
import {
  MOCK_HOTELS,
  TRAIL_GEOJSON,
  YUBENG_CENTER,
} from "./shared/mockData";

declare const mapboxgl: typeof import("mapbox-gl").default;

function bleachAllFills(map: MBGL.Map) {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const layer of style.layers) {
    try {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", "#F5F3EE");
      }
      if (layer.type === "fill") {
        map.setPaintProperty(layer.id, "fill-color", "#F5F3EE");
        map.setPaintProperty(layer.id, "fill-opacity", 0.9);
      }
      if (layer.type === "line") {
        map.setPaintProperty(layer.id, "line-opacity", 0);
      }
      if (layer.type === "symbol") {
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
    } catch {
      /* skip */
    }
  }
}

export default function V1Plaster() {
  const style = useMemo(() => "mapbox://styles/mapbox/light-v11", []);

  const { containerRef, ready, error } = useMapbox({
    style,
    onStyleLoad: (map) => {
      bleachAllFills(map);

      // Terrain with dramatic exaggeration.
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 2.0 });

      // v3 lighting — sharp directional shadows on matte clay.
      try {
        (map as unknown as { setLights: Function }).setLights?.([
          {
            id: "sun",
            type: "directional",
            properties: {
              direction: [210, 28],
              color: "#ffffff",
              intensity: 0.95,
              "cast-shadows": true,
              "shadow-intensity": 1,
            },
          },
          {
            id: "amb",
            type: "ambient",
            properties: { color: "#ffffff", intensity: 0.35 },
          },
        ]);
      } catch { /* older runtimes */ }

      // Subtle hillshade for plaster micro-shadowing.
      if (!map.getSource("plaster-dem")) {
        map.addSource("plaster-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      if (!map.getLayer("plaster-hillshade")) {
        map.addLayer({
          id: "plaster-hillshade",
          type: "hillshade",
          source: "plaster-dem",
          paint: {
            "hillshade-exaggeration": 0.8,
            "hillshade-shadow-color": "#1a1a1a",
            "hillshade-highlight-color": "#ffffff",
            "hillshade-accent-color": "#c9c3b5",
          },
        });
      }

      // Trail: glowing neon orange line.
      if (!map.getSource("trail")) {
        map.addSource("trail", { type: "geojson", data: TRAIL_GEOJSON });
      }
      map.addLayer({
        id: "trail-glow",
        type: "line",
        source: "trail",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#FF3300",
          "line-width": 10,
          "line-blur": 12,
          "line-opacity": 0.45,
        },
      });
      map.addLayer({
        id: "trail-core",
        type: "line",
        source: "trail",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#FF3300",
          "line-width": 4,
          "line-blur": 2,
        },
      });

      // Brutalist hotel markers (DOM).
      for (const hotel of MOCK_HOTELS) {
        const el = document.createElement("button");
        el.type = "button";
        el.style.cssText = `
          background: #ffffff;
          color: #0A0A0A;
          border: 1.5px solid #0A0A0A;
          padding: 8px 10px;
          font-family: Inter, Helvetica, sans-serif;
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          line-height: 1.15;
          cursor: pointer;
          box-shadow: 4px 4px 0 #0A0A0A;
          transition: transform 120ms, box-shadow 120ms;
          text-align: left;
        `;
        el.innerHTML = `
          <div style="font-weight:700;">${hotel.name}</div>
          <div style="margin-top:3px; color:#FF3300; font-weight:700; letter-spacing:0.05em;">
            ${hotel.currency}${hotel.pricePerNight} · ${hotel.rating}★
          </div>
        `;
        el.addEventListener("mouseenter", () => {
          el.style.transform = "translate(-2px,-2px)";
          el.style.boxShadow = "6px 6px 0 #0A0A0A";
        });
        el.addEventListener("mouseleave", () => {
          el.style.transform = "";
          el.style.boxShadow = "4px 4px 0 #0A0A0A";
        });
        new mapboxgl.Marker({ element: el, anchor: "bottom", offset: [0, -8] })
          .setLngLat(hotel.coordinates)
          .addTo(map);
      }
    },
  });

  return (
    <ExplorationShell
      index={1}
      title="Plaster Diorama"
      subtitle="Minimalist Clay"
      chipColor="rgba(10,10,10,0.9)"
      chipText="#ffffff"
      backBg="rgba(10,10,10,0.85)"
    >
      <div className="absolute inset-0" style={{ background: "#F5F3EE" }}>
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs tracking-[0.3em] uppercase text-black/60">
            Shaping plaster…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-black text-sm">
            {error}
          </div>
        )}

        {/* Left rail: architectural caption */}
        <div className="absolute bottom-10 left-10 max-w-sm z-[5]">
          <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-black/60">
            Fig. 01 — Scale Model
          </div>
          <h2 className="font-serif text-5xl md:text-6xl mt-2 text-black leading-[0.95]">
            Yubeng
            <br />
            Village
          </h2>
          <div className="mt-4 border-t border-black/80 pt-3 font-mono text-[10px] tracking-[0.25em] uppercase text-black/70 leading-relaxed">
            28.4333° N · 98.7667° E
            <br />
            Elev. 3,150 m — 3,900 m
            <br />
            Scale 1 : 10,000
          </div>
        </div>

        {/* Right rail: coordinate readout */}
        <div className="absolute bottom-10 right-10 text-right z-[5]">
          <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-black/60">
            Subject
          </div>
          <div className="font-serif text-xl mt-1 text-black">
            Sacred Waterfall Trail
          </div>
          <div className="mt-2 font-mono text-[10px] tracking-[0.25em] text-[#FF3300]">
            3.6 KM · +420 M
          </div>
        </div>

        {/* Coordinate crosshair anchoring the center */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[4] pointer-events-none">
          <div className="w-[1px] h-16 bg-black/20 mx-auto" />
          <div className="h-[1px] w-16 bg-black/20 -mt-8 -mb-7 -translate-y-1" />
        </div>

        {/* suppress variable reference in case linter complains */}
        <span className="hidden">{YUBENG_CENTER.join(",")}</span>
      </div>
    </ExplorationShell>
  );
}
