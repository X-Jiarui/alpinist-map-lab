import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Environment, Html, Line, OrbitControls } from "@react-three/drei";
import {
  Bloom,
  EffectComposer,
  Noise,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";

import ExplorationShell from "./shared/ExplorationShell";
import DestinationPicker from "./shared/DestinationPicker";
import {
  DestinationManifest,
  useDestinationManifest,
  useDestinationIndex,
} from "./shared/destinationManifest";

// Liquid Chrome — data-driven. The stitched Terrain-RGB heightmap and all
// trail / hotel geometry come from
// `/destinations/<slug>/manifest.json` produced by
// `pipeline/alpinist_pipeline.py`. Every destination shares the same shader
// (GPU decode, radial alpha fade, normal recomputation), so scaling from 1
// to 1000 destinations is purely a matter of running the pipeline.

const DEFAULT_SLUG = "yubeng-village";

const DISPLACEMENT = 3.2;
const PLANE_SIZE = 10;
const PLANE_SEGMENTS = 512;
// Valley-floor → peak-envelope. Chosen so ~6700 m peaks map to a
// normalised ~1.0 for Himalaya-grade destinations; lower-altitude
// destinations just use less of the range.
const BASE_HEIGHT = 1000;
const HEIGHT_RANGE = 6000;

// ---------- procedural roughness (unchanged aesthetic) ----------

function hash2(xi: number, yi: number) {
  const s = Math.sin(xi * 12.9898 + yi * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t: number) {
  return t * t * (3 - 2 * t);
}
function valueNoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const u = smooth(xf);
  const v = smooth(yf);
  return (
    a * (1 - u) * (1 - v) +
    b * u * (1 - v) +
    c * (1 - u) * v +
    d * u * v
  );
}
function buildRoughnessTexture(size: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const n1 = valueNoise(u * 20, v * 20);
      const n2 = valueNoise(u * 56 + 13, v * 56 + 7);
      const mixed = n1 * 0.65 + n2 * 0.35;
      const rough = 0.6 + mixed * 0.4;
      const g = Math.floor(rough * 255);
      const i = (y * size + x) * 4;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------- CPU-side decode for pin / trail placement ----------

type HeightSampler = (u: number, v: number) => number;

function useTerrainSampler(
  tex: THREE.Texture,
  texSize: { width: number; height: number },
): React.MutableRefObject<HeightSampler> {
  const ref = useRef<HeightSampler>(() => 0);
  useEffect(() => {
    const img = tex.image as
      | HTMLImageElement
      | HTMLCanvasElement
      | ImageBitmap
      | undefined;
    if (!img) return;
    const width = texSize.width;
    const height = texSize.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    try {
      ctx.drawImage(img as CanvasImageSource, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      ref.current = (u, v) => {
        const cu = Math.max(0, Math.min(1, u));
        const cv = Math.max(0, Math.min(1, v));
        const px = Math.min(width - 1, Math.floor(cu * width));
        // flipY: sampler v=0 is south (bottom); canvas y=0 is top (north).
        const py = Math.min(height - 1, Math.floor((1 - cv) * height));
        const i = (py * width + px) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const meters = -10000 + (r * 65536 + g * 256 + b) * 0.1;
        return Math.max(0, (meters - BASE_HEIGHT) / HEIGHT_RANGE);
      };
    } catch {
      // CORS-tainted canvas; tethers will pin at y=0.
    }
  }, [tex, texSize.width, texSize.height]);
  return ref;
}

// ---------- shader patches ----------

const VERT_HEADER = /* glsl */ `
varying float vMask;
uniform sampler2D uHeightMap;
uniform float uDisplacement;
uniform float uPlaneSize;
uniform float uBaseHeight;
uniform float uHeightRange;

float _decodeMeters(vec2 uvIn) {
  vec3 c = texture2D(uHeightMap, uvIn).rgb;
  return -10000.0 + (c.r * 65536.0 + c.g * 256.0 + c.b) * 255.0 * 0.1;
}
float sampleHeight(vec2 uvIn) {
  float m = _decodeMeters(uvIn);
  return max(0.0, (m - uBaseHeight) / uHeightRange);
}
`;
const FRAG_HEADER = /* glsl */ `
varying float vMask;
`;

const BEGIN_REPLACE = /* glsl */ `
float _hC = sampleHeight(uv);
vec2 _d = uv - 0.5;
float _r = length(_d) * 2.0;
float _mask = 1.0 - smoothstep(0.55, 0.95, _r);
vMask = _mask;
vec3 transformed = vec3(position);
transformed += normal * _hC * uDisplacement * _mask;
`;

function beginNormalReplace(texWidth: number) {
  return /* glsl */ `
float _s = 1.0 / ${texWidth.toFixed(1)};
vec2 _dN = uv - 0.5;
float _rN = length(_dN) * 2.0;
float _maskN = 1.0 - smoothstep(0.55, 0.95, _rN);
float _hL = sampleHeight(uv - vec2(_s, 0.0));
float _hR = sampleHeight(uv + vec2(_s, 0.0));
float _hD = sampleHeight(uv - vec2(0.0, _s));
float _hU = sampleHeight(uv + vec2(0.0, _s));
float _du = (_hR - _hL) / (2.0 * _s);
float _dv = (_hU - _hD) / (2.0 * _s);
float _slope = uDisplacement / uPlaneSize * _maskN;
vec3 objectNormal = normalize(vec3(-_du * _slope, -_dv * _slope, 1.0));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
`;
}

// ---------- chrome terrain ----------

function ChromeTerrain({
  heightTex,
  roughnessTex,
  texWidth,
}: {
  heightTex: THREE.Texture;
  roughnessTex: THREE.Texture;
  texWidth: number;
}) {
  useMemo(() => {
    heightTex.colorSpace = THREE.NoColorSpace;
    heightTex.wrapS = THREE.ClampToEdgeWrapping;
    heightTex.wrapT = THREE.ClampToEdgeWrapping;
    heightTex.minFilter = THREE.LinearFilter;
    heightTex.magFilter = THREE.LinearFilter;
    heightTex.generateMipmaps = false;
    heightTex.anisotropy = 1;
    heightTex.needsUpdate = true;
    return null;
  }, [heightTex]);

  const material = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#8d959c"),
      metalness: 1.0,
      roughness: 0.15,
      roughnessMap: roughnessTex,
      clearcoat: 1.0,
      clearcoatRoughness: 0.15,
      envMapIntensity: 0.55,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uHeightMap = { value: heightTex };
      shader.uniforms.uDisplacement = { value: DISPLACEMENT };
      shader.uniforms.uPlaneSize = { value: PLANE_SIZE };
      shader.uniforms.uBaseHeight = { value: BASE_HEIGHT };
      shader.uniforms.uHeightRange = { value: HEIGHT_RANGE };

      shader.vertexShader = VERT_HEADER + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        beginNormalReplace(texWidth),
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        BEGIN_REPLACE,
      );
      shader.fragmentShader = FRAG_HEADER + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `gl_FragColor.a *= (vMask * vMask);\n#include <dithering_fragment>`,
      );
      mat.userData.shader = shader;
    };
    return mat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texWidth]);

  useEffect(() => {
    const shader = (material.userData as {
      shader?: { uniforms: Record<string, { value: unknown }> };
    }).shader;
    if (shader?.uniforms?.uHeightMap) {
      shader.uniforms.uHeightMap.value = heightTex;
    }
  }, [heightTex, material]);

  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <planeGeometry
        args={[PLANE_SIZE, PLANE_SIZE, PLANE_SEGMENTS, PLANE_SEGMENTS]}
      />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

// ---------- bbox → plane projection ----------

function makeProjector(manifest: DestinationManifest) {
  const { west, south, east, north } = manifest.dem.image.bounds;
  const lngSpan = east - west;
  const latSpan = north - south;
  return (lng: number, lat: number) => {
    const u = (lng - west) / lngSpan;
    const v = (lat - south) / latSpan;
    const x = (u - 0.5) * PLANE_SIZE;
    const z = (0.5 - v) * PLANE_SIZE;
    return { u, v, x, z };
  };
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function radialMask(u: number, v: number) {
  const r = Math.hypot(u - 0.5, v - 0.5) * 2;
  return 1 - smoothstep(0.55, 0.95, r);
}

// ---------- trail (continuous line draped on mesh) ----------

function TrailLine({
  coordinates,
  project,
  samplerRef,
}: {
  coordinates: [number, number][];
  project: ReturnType<typeof makeProjector>;
  samplerRef: React.MutableRefObject<HeightSampler>;
}) {
  const [points, setPoints] = useState<[number, number, number][]>([]);
  useEffect(() => {
    const pts = coordinates
      .map(([lng, lat]) => {
        const { u, v, x, z } = project(lng, lat);
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;
        const h = samplerRef.current(u, v) * DISPLACEMENT * radialMask(u, v);
        // Lift slightly above the surface so the line never z-fights.
        return [x, h + 0.015, z] as [number, number, number];
      })
      .filter((p): p is [number, number, number] => p !== null);
    setPoints(pts);
  }, [coordinates, project, samplerRef]);

  if (points.length < 2) return null;
  return (
    <Line
      points={points}
      color="#ffffff"
      opacity={0.55}
      transparent
      lineWidth={1.2}
      toneMapped={false}
    />
  );
}

// ---------- tethered pin ----------

function TetheredPin({
  lng,
  lat,
  name,
  sub,
  project,
  samplerRef,
}: {
  lng: number;
  lat: number;
  name: string;
  sub?: string;
  project: ReturnType<typeof makeProjector>;
  samplerRef: React.MutableRefObject<HeightSampler>;
}) {
  const { u, v, x, z } = useMemo(() => project(lng, lat), [lng, lat, project]);
  const [y, setY] = useState(0);
  useEffect(() => {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      setY(0);
      return;
    }
    setY(samplerRef.current(u, v) * DISPLACEMENT * radialMask(u, v));
  }, [u, v, samplerRef]);

  const TETHER_LENGTH = 1.5;
  const surface: [number, number, number] = [x, y, z];
  const anchor: [number, number, number] = [x, y + TETHER_LENGTH, z];

  return (
    <group>
      <mesh position={surface}>
        <sphereGeometry args={[0.035, 20, 20]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      <Line
        points={[surface, anchor]}
        color="#ffffff"
        opacity={0.3}
        transparent
        lineWidth={1}
        toneMapped={false}
      />
      <Html
        position={anchor}
        center
        distanceFactor={6}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div className="text-white mix-blend-difference font-mono text-[10px] tracking-[0.25em] uppercase whitespace-nowrap leading-tight">
          <div className="font-semibold">{name}</div>
          {sub && (
            <>
              <div className="h-px bg-white/70 my-1" />
              <div className="opacity-80">{sub}</div>
            </>
          )}
        </div>
      </Html>
    </group>
  );
}

// ---------- cinematic camera ----------

const CAM_START = new THREE.Vector3(14, 14, 14);
const CAM_END = new THREE.Vector3(6, 3.5, 6);
const CAM_LOOK_START = new THREE.Vector3(0, 0, 0);
const CAM_LOOK_END = new THREE.Vector3(0, 0.6, 0);
const INTRO_DURATION = 3.5;

function IntroCamera({ onDone }: { onDone: () => void }) {
  const { camera } = useThree();
  const tRef = useRef(0);
  const doneRef = useRef(false);
  const lookAt = useRef(CAM_LOOK_START.clone());
  useEffect(() => {
    camera.position.copy(CAM_START);
    camera.lookAt(CAM_LOOK_START);
  }, [camera]);
  useFrame((_, delta) => {
    if (doneRef.current) return;
    tRef.current = Math.min(1, tRef.current + delta / INTRO_DURATION);
    const t = tRef.current;
    const eased = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(CAM_START, CAM_END, eased);
    lookAt.current.lerpVectors(CAM_LOOK_START, CAM_LOOK_END, eased);
    camera.lookAt(lookAt.current);
    if (t >= 1) {
      doneRef.current = true;
      onDone();
    }
  });
  return null;
}

// ---------- per-destination scene ----------

function TerrainScene({
  manifest,
  terrainUrl,
  roughnessTex,
}: {
  manifest: DestinationManifest;
  terrainUrl: string;
  roughnessTex: THREE.Texture;
}) {
  const heightTex = useLoader(THREE.TextureLoader, terrainUrl);
  const texSize = useMemo(
    () => ({
      width: manifest.dem.image.width,
      height: manifest.dem.image.height,
    }),
    [manifest.dem.image.width, manifest.dem.image.height],
  );
  const samplerRef = useTerrainSampler(heightTex, texSize);
  const project = useMemo(() => makeProjector(manifest), [manifest]);

  return (
    <>
      <ChromeTerrain
        heightTex={heightTex}
        roughnessTex={roughnessTex}
        texWidth={texSize.width}
      />
      {manifest.trails.map((t, i) => (
        <TrailLine
          key={i}
          coordinates={t.coordinates}
          project={project}
          samplerRef={samplerRef}
        />
      ))}
      {manifest.hotels.slice(0, 12).map((h, i) => (
        <TetheredPin
          key={`${h.lng},${h.lat},${i}`}
          lng={h.lng}
          lat={h.lat}
          name={h.name}
          sub={h.stars ? `${h.stars}★` : undefined}
          project={project}
          samplerRef={samplerRef}
        />
      ))}
    </>
  );
}

// ---------- error card ----------

function ErrorCard({
  slug,
  message,
  hasIndex,
}: {
  slug: string;
  message: string;
  hasIndex: boolean;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-8">
      <div className="max-w-xl border border-white/20 bg-black/70 backdrop-blur-sm p-8 font-mono text-sm text-white/80">
        <div className="text-[10px] tracking-[0.4em] uppercase text-white/40 mb-3">
          Liquid Chrome · missing asset
        </div>
        <div className="text-xl font-semibold text-white mb-4 leading-tight">
          No manifest for <span className="text-white/70">{slug}</span>
        </div>
        <div className="text-white/70 mb-4">{message}</div>
        <div className="text-white/50 text-xs leading-relaxed">
          Run the spatial pipeline to generate this destination:
          <pre className="mt-3 p-3 bg-white/5 border border-white/10 text-[11px] overflow-x-auto">{`cd pipeline
export MAPBOX_TOKEN=pk.…
python alpinist_pipeline.py --only ${slug}`}</pre>
          {!hasIndex && (
            <div className="mt-3 text-white/40">
              Hint: <code className="text-white/70">/destinations/index.json</code>{" "}
              is also missing — likely the first run.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- root ----------

export default function V10LiquidChrome() {
  const params = useParams<{ slug?: string }>();
  const [slug, setSlug] = useState(params.slug ?? DEFAULT_SLUG);
  useEffect(() => {
    if (params.slug && params.slug !== slug) setSlug(params.slug);
  }, [params.slug, slug]);

  const manifestState = useDestinationManifest(slug);
  const index = useDestinationIndex();

  const roughnessTex = useMemo(() => buildRoughnessTexture(256), []);
  useEffect(() => () => roughnessTex.dispose(), [roughnessTex]);

  const [introDone, setIntroDone] = useState(false);
  useEffect(() => {
    setIntroDone(false);
  }, [slug]);

  const name =
    manifestState.status === "ready" ? manifestState.manifest.name : slug;

  return (
    <ExplorationShell
      index={10}
      title="Liquid Chrome"
      subtitle={name}
      chipColor="#000000"
      chipText="#ffffff"
      backBg="rgba(10,10,10,0.85)"
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 20%, #141619 0%, #0a0a0a 55%, #000 100%)",
        }}
      >
        <Canvas
          camera={{ position: [14, 14, 14], fov: 40, near: 0.1, far: 100 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 0.85;
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
        >
          <color attach="background" args={["#050505"]} />
          <fog attach="fog" args={["#050505", 12, 32]} />
          <ambientLight intensity={0.04} />
          <directionalLight
            position={[4, 8, 4]}
            intensity={0.15}
            color="#ffffff"
          />
          <Suspense fallback={null}>
            <Environment
              preset="night"
              background={false}
              environmentIntensity={0.35}
            />
            {manifestState.status === "ready" && (
              <TerrainScene
                manifest={manifestState.manifest}
                terrainUrl={manifestState.terrainUrl}
                roughnessTex={roughnessTex}
              />
            )}
          </Suspense>

          <IntroCamera onDone={() => setIntroDone(true)} />
          {introDone && (
            <OrbitControls
              enablePan={false}
              enableZoom={false}
              enableRotate
              autoRotate
              autoRotateSpeed={0.5}
              maxPolarAngle={Math.PI / 2.2}
              minPolarAngle={0.25}
              target={[0, 0.6, 0]}
              makeDefault
            />
          )}

          <EffectComposer multisampling={0}>
            <Bloom
              luminanceThreshold={0.85}
              luminanceSmoothing={0.2}
              mipmapBlur
              intensity={0.5}
            />
            <Noise
              premultiply
              blendFunction={BlendFunction.ADD}
              opacity={0.06}
            />
            <Vignette darkness={0.7} eskil={false} offset={0.15} />
          </EffectComposer>
        </Canvas>

        <div className="absolute top-16 left-8 z-[5] pointer-events-none">
          <div className="font-mono text-[10px] tracking-[0.4em] uppercase text-white/50">
            10 / 10 — Pure WebGL
          </div>
          <h2 className="font-serif text-5xl md:text-6xl text-white mt-3 leading-[0.85] tracking-tight uppercase">
            {manifestState.status === "ready"
              ? manifestState.manifest.name
              : "Liquid"}
            <br />
            <span className="text-white/70">
              {manifestState.status === "ready"
                ? manifestState.manifest.country
                : "Chrome."}
            </span>
          </h2>
          <div className="mt-6 max-w-sm text-white/60 text-sm leading-relaxed">
            {manifestState.status === "ready"
              ? `${manifestState.manifest.trails.length} trails · ${manifestState.manifest.hotels.length} stays · real Mapbox Terrain-RGB, decoded on the GPU into liquid mercury.`
              : "Loading Mapbox Terrain-RGB heightmap and Overpass trail geometry…"}
          </div>
        </div>

        {manifestState.status === "error" && (
          <ErrorCard
            slug={slug}
            message={manifestState.error}
            hasIndex={index.length > 0}
          />
        )}

        {manifestState.status === "ready" && (
          <div className="absolute bottom-10 left-8 z-[5] font-mono text-[10px] tracking-[0.3em] uppercase text-white/40">
            terrain-rgb · z{manifestState.manifest.dem.zoom} ·{" "}
            {manifestState.manifest.dem.tiles.length} tiles · gpu decode
          </div>
        )}
        <div className="absolute bottom-10 right-8 z-[5] font-mono text-[10px] tracking-[0.3em] uppercase text-white/40 text-right">
          metalness 1.00 · roughness 0.15
          <br />
          aces · env night 0.35 · bloom 0.85
        </div>

        <DestinationPicker
          index={index}
          currentSlug={slug}
          onPick={(s) => {
            window.history.pushState({}, "", `/v10/${s}`);
            setSlug(s);
          }}
          anchor="bottom-left"
        />
      </div>
    </ExplorationShell>
  );
}
