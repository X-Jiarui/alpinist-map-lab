import { useEffect, useMemo, useRef } from "react";
import type * as MBGL from "mapbox-gl";
import { motion } from "framer-motion";
import ExplorationShell from "./shared/ExplorationShell";
import { useMapbox } from "./shared/useMapbox";
import { MOCK_HOTELS, TRAIL_GEOJSON } from "./shared/mockData";

declare const mapboxgl: typeof import("mapbox-gl").default;

export default function V9Ethereal() {
  const style = useMemo(() => "mapbox://styles/mapbox/light-v11", []);
  const mapInstanceRef = useRef<MBGL.Map | null>(null);

  const { containerRef, ready, error } = useMapbox({
    style,
    pitch: 55,
    bearing: 20,
    zoom: 12.8,
    onStyleLoad: (map) => {
      mapInstanceRef.current = map;

      const pastelMap: Record<string, string> = {
        water: "#C5B8F2",
        land: "#DCF0E1",
        landuse: "#FDE4F1",
        landcover: "#E4F7EA",
        hillshade: "#F7D9EA",
      };

      const s = map.getStyle();
      if (s?.layers) {
        for (const layer of s.layers) {
          try {
            if (layer.type === "background") {
              map.setPaintProperty(layer.id, "background-color", "#FBEEFF");
            }
            if (layer.type === "fill") {
              const key = Object.keys(pastelMap).find((k) => layer.id.includes(k));
              if (key) map.setPaintProperty(layer.id, "fill-color", pastelMap[key]);
              else map.setPaintProperty(layer.id, "fill-color", "#F5E5FF");
              map.setPaintProperty(layer.id, "fill-opacity", 0.85);
            }
            if (layer.type === "line") {
              map.setPaintProperty(layer.id, "line-color", "#C7A9E8");
              map.setPaintProperty(layer.id, "line-opacity", 0.25);
            }
            if (layer.type === "symbol") {
              map.setLayoutProperty(layer.id, "visibility", "none");
            }
          } catch { /* skip */ }
        }
      }

      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.3 });

      try {
        (map as unknown as { setLights: Function }).setLights?.([
          {
            id: "amb",
            type: "ambient",
            properties: { color: "#ffffff", intensity: 0.85 },
          },
          {
            id: "dir",
            type: "directional",
            properties: {
              direction: [200, 50],
              color: "#ffe7fb",
              intensity: 0.25,
              "cast-shadows": false,
            },
          },
        ]);
      } catch { /* skip */ }

      map.setFog({
        color: "#FBEEFF",
        "horizon-blend": 0.4,
        range: [0.5, 6],
        "high-color": "#E0D4FF",
        "space-color": "#FBEEFF",
        "star-intensity": 0,
      } as never);

      if (!map.getSource("trail")) {
        map.addSource("trail", { type: "geojson", data: TRAIL_GEOJSON });
      }
      map.addLayer({
        id: "trail-glow",
        type: "line",
        source: "trail",
        paint: {
          "line-color": "#FFFFFF",
          "line-width": 8,
          "line-blur": 14,
          "line-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "trail-core",
        type: "line",
        source: "trail",
        paint: {
          "line-color": "#FFFFFF",
          "line-width": 1.4,
          "line-opacity": 0.95,
        },
      });

      for (const hotel of MOCK_HOTELS) {
        const el = document.createElement("div");
        el.style.cssText = `
          font-family: Inter, sans-serif;
          color: #ffffff;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-align: center;
          text-shadow: 0 0 12px rgba(255,255,255,0.9), 0 0 2px rgba(120,90,180,0.6);
          cursor: pointer;
          white-space: nowrap;
        `;
        el.innerHTML = `
          <div style="opacity:0.9;">✦ ${hotel.name}</div>
          <div style="font-size:10px; opacity:0.75; margin-top:2px; letter-spacing:0.15em;">
            ${hotel.currency}${hotel.pricePerNight}
          </div>
        `;
        new mapboxgl.Marker({ element: el, anchor: "bottom", offset: [0, -4] })
          .setLngLat(hotel.coordinates)
          .addTo(map);
      }
    },
  });

  // Gentle auto-rotation — map becomes ambient.
  useEffect(() => {
    if (!ready) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    const interval = window.setInterval(() => {
      if (!map.isStyleLoaded()) return;
      try {
        map.easeTo({
          bearing: (map.getBearing() + 0.18) % 360,
          duration: 900,
          easing: (t) => t,
        });
      } catch { /* skip */ }
    }, 900);
    return () => window.clearInterval(interval);
  }, [ready]);

  return (
    <ExplorationShell
      index={9}
      title="Ethereal Pastel"
      subtitle="Dreamy Frosted"
      chipColor="rgba(255,255,255,0.4)"
      chipText="#6A4C93"
      backText="#6A4C93"
      backBg="rgba(255,255,255,0.4)"
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 30% 20%, #FBEEFF 0%, #E0D4FF 45%, #D0F0E8 100%)",
        }}
      >
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center font-serif italic text-[#6A4C93]/80">
            Dreaming…
          </div>
        )}

        {/* Massive frosted glass panel — 40% width right rail */}
        <motion.aside
          initial={{ x: 60, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="absolute top-0 right-0 h-full z-[5] flex flex-col justify-center px-12"
          style={{
            width: "40%",
            background:
              "linear-gradient(155deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.15) 100%)",
            backdropFilter: "blur(24px) saturate(160%)",
            WebkitBackdropFilter: "blur(24px) saturate(160%)",
            borderLeft: "1px solid rgba(255,255,255,0.4)",
            boxShadow: "-40px 0 80px -20px rgba(106,76,147,0.1)",
          }}
        >
          <div className="font-mono text-[10px] tracking-[0.4em] uppercase text-[#6A4C93]/70">
            Chapter 09 · A Softer Map
          </div>
          <h2 className="font-serif text-5xl md:text-6xl text-[#3D2B5F] mt-4 leading-[0.95]">
            Drift
            <br />
            into
            <br />
            Yubeng.
          </h2>
          <p className="mt-6 text-[#3D2B5F]/80 leading-relaxed text-sm max-w-md">
            The map is no longer a tool. It's weather — soft, moving, quiet. Let your
            route breathe between the peaks of Kawagarbo. Two curated stays, one
            unhurried trail.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-4 max-w-md">
            {MOCK_HOTELS.map((h) => (
              <motion.div
                key={h.id}
                whileHover={{ y: -3 }}
                className="rounded-2xl p-4 cursor-pointer"
                style={{
                  background: "rgba(255,255,255,0.4)",
                  backdropFilter: "blur(18px)",
                  WebkitBackdropFilter: "blur(18px)",
                  border: "1px solid rgba(255,255,255,0.5)",
                }}
              >
                <div className="font-serif text-lg text-[#3D2B5F] leading-tight">
                  {h.name}
                </div>
                <div className="text-[10px] uppercase tracking-widest text-[#6A4C93]/70 mt-2">
                  {h.currency}{h.pricePerNight} · {h.rating}★
                </div>
              </motion.div>
            ))}
          </div>

          <button
            className="mt-10 self-start rounded-full px-7 py-3 text-sm tracking-[0.2em] uppercase"
            style={{
              background: "rgba(255,255,255,0.45)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              border: "1px solid rgba(255,255,255,0.55)",
              color: "#3D2B5F",
            }}
          >
            Begin the drift →
          </button>
        </motion.aside>
      </div>
    </ExplorationShell>
  );
}
