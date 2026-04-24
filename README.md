# Alpinist Map Lab

Ten avant-garde cartographic explorations of **Yubeng Village** (雨崩村), Yunnan, China. Each iteration is a distinct visual direction for the Alpinist map interface, built with Mapbox GL JS v3 or Three.js.

## Quick Start

```bash
npm install
npm run dev
```

Visit `http://localhost:5174` to open the exploration menu.

## Iterations

| # | Route | Vibe |
|---|-------|------|
| 01 | `/v1` | Plaster Diorama (matte-white architectural clay) |
| 02 | `/v2` | Contour Data Poster (cyan-to-gold topology) |
| 03 | `/v3` | Obsidian & Gold Wireframe (luxury dark mode) |
| 04 | `/v4` | Cyberpunk Synthwave Grid |
| 05 | `/v5` | Tactile Paper Cut-out |
| 06 | `/v6` | Modern Ink Wash (Shanshui 山水) |
| 07 | `/v7` | Deep Ocean Blueprint (cyanotype) |
| 08 | `/v8` | Thermal Vision heatmap |
| 09 | `/v9` | Ethereal Frosted Pastel |
| 10 | `/v10` | Liquid Chrome (pure Three.js) |

## Environment

Copy or set `VITE_MAPBOX_TOKEN` in `.env` before `npm run dev`.

## Architecture

- Vite + React 18 + TypeScript + Tailwind
- Mapbox GL JS v3.9 loaded via CDN in `index.html`
- Three.js via `@react-three/fiber` + `@react-three/drei` for iteration 10
- Shared mock data, map bootstrapper hook, and shell in `src/explorations/shared/`

The surrounding `summit-stays/` production app is **not** touched by this lab.
