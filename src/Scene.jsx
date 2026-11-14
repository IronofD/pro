import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, Text, Billboard, Environment, Lightformer } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

/* ------------------------------------------------------------------ */
/*  Theme                                                              */
/* ------------------------------------------------------------------ */
const THEME = {
  Moon: {
    zenith: "#000105", horizon: "#070d19",
    fog: "#070d19", fogNear: 28, fogFar: 72,
    sun: "#fff3df", sunInt: 3.6, sunDir: [30, 15, 14],
    hemiSky: "#6f86b8", hemiGround: "#1d2028", hemiInt: 0.16,
    groundA: "#555960", groundB: "#8a8e97", crater: 0.62,
    mountain: 1, rocks: "#8a8e97", dust: false, dustColor: "#cfd3dc",
    envTint: "#9db8ff"
  },
  Mars: {
    zenith: "#6b4a4a", horizon: "#d39a74",
    fog: "#c98d68", fogNear: 20, fogFar: 62,
    sun: "#ffd9b5", sunInt: 2.8, sunDir: [26, 13, -12],
    hemiSky: "#e9b08c", hemiGround: "#5a2b1c", hemiInt: 0.3,
    groundA: "#8f4330", groundB: "#c97a4f", crater: 0.3,
    mountain: 1.15, rocks: "#7b3a28", dust: true, dustColor: "#e0a47c",
    envTint: "#ffb88a"
  }
};

const ACCENT = {
  "Crew Habitat": "#8bd6ff",
  Greenhouse: "#5df0a8",
  "Research Lab": "#ffcc5a",
  "Radiation Shelter": "#a9a6ff",
  "Solar Power Station": "#59b4ff",
  "Communication Tower": "#e8eef6"
};

/* ------------------------------------------------------------------ */
/*  Procedural helpers                                                 */
/* ------------------------------------------------------------------ */
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) {
  let amp = 0.5, f = 1, sum = 0;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, y * f); f *= 2.03; amp *= 0.5; }
  return sum;
}
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function makeCraters(count, minD, maxD, minR, maxR, seed) {
  const r = rng(seed), out = [];
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = minD + r() * (maxD - minD), rad = minR + r() * (maxR - minR);
    out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: rad, depth: rad * (0.16 + r() * 0.1) });
  }
  return out;
}

function makeTerrain(planet) {
  const T = THEME[planet];
  const moon = planet === "Moon";
  const craters = [
    ...makeCraters(22, 15, 46, 2.5, 8, 7),
    ...makeCraters(16, 9.5, 20, 0.8, 2.0, 21)
  ];
  const heightAt = (x, z) => {
    const d = Math.hypot(x, z);
    const flat = smooth(7.5, 17, d);
    let h = (fbm(x * 0.07, z * 0.07) - 0.5) * (moon ? 5 : 6.5);
    h += (fbm(x * 0.28 + 11, z * 0.28) - 0.5) * 0.9;
    if (!moon) {
      const dune = Math.sin(x * 0.32 + fbm(x * 0.1, z * 0.1) * 6) * 0.45 + Math.sin(z * 0.21 + x * 0.1) * 0.25;
      h += dune * 0.8;
    }
    let c = 0;
    for (const cr of craters) {
      const t = Math.hypot(x - cr.x, z - cr.z) / cr.r;
      if (t < 1.6) {
        if (t < 1) c -= cr.depth * (1 - t * t);
        c += cr.depth * 0.45 * Math.exp(-Math.pow((t - 1.05) * 3.2, 2));
      }
    }
    h = (h + c * T.crater * 2.2) * flat;
    h += smooth(22, 50, d) * (5 + 16 * fbm(x * 0.045 + 7, z * 0.045)) * T.mountain;
    return -0.1 + h;
  };

  const SIZE = 130, SEG = 330;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Color(T.groundA), b = new THREE.Color(T.groundB), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = fbm(x * 0.12 + 3, z * 0.12 + 9, 3);
    tmp.copy(a).lerp(b, THREE.MathUtils.clamp(n * 1.3 + h * 0.03, 0, 1));
    const shade = 0.82 + fbm(x * 1.4, z * 1.4, 2) * 0.35;
    tmp.multiplyScalar(shade);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return { geo, heightAt };
}

let _bump;
function bumpTexture() {
  if (_bump) return _bump;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const v = (fbm(x * 0.09, y * 0.09, 4) * 0.6 + Math.random() * 0.4) * 255;
    const i = (y * 256 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(48, 48);
  _bump = t;
  return t;
}

function solarTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, "#14508a"); grad.addColorStop(1, "#0a2c57");
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(170,215,255,.55)"; g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  g.strokeStyle = "rgba(170,215,255,.2)"; g.lineWidth = 1;
  for (let i = 16; i < 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function earthTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#0d3a78"); grad.addColorStop(0.5, "#1560b0"); grad.addColorStop(1, "#0d3a78");
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
  const r = rng(99);
  for (let i = 0; i < 46; i++) {
    g.fillStyle = r() > 0.35 ? "#3f8f55" : "#a58b55";
    g.beginPath(); g.ellipse(r() * 512, 40 + r() * 176, 14 + r() * 36, 8 + r() * 22, r() * 3, 0, 6.3); g.fill();
  }
  g.fillStyle = "#eef5ff";
  g.fillRect(0, 0, 512, 14); g.fillRect(0, 242, 512, 14);
  g.filter = "blur(8px)";
  for (let i = 0; i < 38; i++) { g.globalAlpha = 0.45; g.beginPath(); g.ellipse(r() * 512, r() * 256, 20 + r() * 50, 4 + r() * 10, r() * 3, 0, 6.3); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const FONT = `${import.meta.env.BASE_URL}fonts/label.ttf`;

const lerpAngle = (a, b, t) => {
  const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * t;
};

/* ------------------------------------------------------------------ */
/*  Environment: sky, terrain, rocks, dust, celestial bodies           */
/* ------------------------------------------------------------------ */
function SkyDome({ theme }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(theme.zenith) }, bottom: { value: new THREE.Color(theme.horizon) } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y,0.,1.); gl_FragColor = vec4(mix(bottom, top, pow(h,.55)),1.); }"
  }), [theme]);
  return <mesh renderOrder={-10} material={mat}><sphereGeometry args={[240, 32, 16]} /></mesh>;
}

function Terrain({ planet, theme, terrain }) {
  const bump = useMemo(() => bumpTexture(), []);
  return (
    <mesh geometry={terrain.geo} receiveShadow>
      <meshStandardMaterial vertexColors roughness={1} metalness={0} bumpMap={bump} bumpScale={planet === "Moon" ? 1.1 : 0.9} />
    </mesh>
  );
}

function Rocks({ theme, terrain }) {
  const ref = useRef();
  const COUNT = 260;
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.78 + hash(p.getX(i) * 9, p.getZ(i) * 9 + p.getY(i) * 5) * 0.45;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  useLayoutEffect(() => {
    const r = rng(5), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const a = r() * Math.PI * 2, d = 5.8 + Math.pow(r(), 0.7) * 36;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const sc = (0.08 + Math.pow(r(), 3) * 0.9) * (d > 20 ? 1.6 : 1);
      p.set(x, terrain.heightAt(x, z) + sc * 0.15, z);
      e.set(r() * 3, r() * 6, r() * 3); q.setFromEuler(e);
      s.set(sc, sc * (0.7 + r() * 0.5), sc * (0.8 + r() * 0.5));
      m.compose(p, q, s);
      ref.current.setMatrixAt(i, m);
      ref.current.setColorAt(i, col.set(theme.rocks).multiplyScalar(0.7 + r() * 0.5));
    }
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.instanceColor.needsUpdate = true;
  }, [terrain, theme]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, COUNT]} castShadow receiveShadow>
      <meshStandardMaterial roughness={0.95} flatShading />
    </instancedMesh>
  );
}

function Dust({ theme, k }) {
  const COUNT = 900;
  const ref = useRef();
  const tex = useMemo(() => softDot(), []);
  const pos = useMemo(() => {
    const r = rng(33), a = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) { a[i * 3] = (r() - 0.5) * 46; a[i * 3 + 1] = r() * 9; a[i * 3 + 2] = (r() - 0.5) * 46; }
    return a;
  }, []);
  useFrame((_, dt) => {
    const p = ref.current.geometry.attributes.position;
    const speed = 0.35 + k.current.storm * 5;
    for (let i = 0; i < COUNT; i++) {
      let x = p.getX(i) + dt * speed * (0.6 + (i % 7) * 0.12);
      if (x > 23) x = -23;
      p.setX(i, x);
    }
    p.needsUpdate = true;
    ref.current.material.opacity = 0.14 + k.current.storm * 0.6;
    ref.current.material.size = 0.22 + k.current.storm * 0.55;
  });
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry>
      <pointsMaterial map={tex} color={theme.dustColor} transparent depthWrite={false} sizeAttenuation opacity={0.15} size={0.25} />
    </points>
  );
}

function Earth() {
  const ref = useRef();
  const tex = useMemo(() => earthTexture(), []);
  const atmo = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    vertexShader: "varying vec3 n; varying vec3 v; void main(){ n = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); v = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }",
    fragmentShader: "varying vec3 n; varying vec3 v; void main(){ float f = pow(.72 - dot(n, v), 2.4); gl_FragColor = vec4(.35,.65,1.,1.)*f*1.6; }"
  }), []);
  useFrame((_, dt) => { ref.current.rotation.y += dt * 0.03; });
  return (
    <group position={[-60, 30, -85]}>
      <mesh ref={ref}>
        <sphereGeometry args={[7, 64, 48]} />
        <meshStandardMaterial map={tex} roughness={0.7} emissive="#0a1d3a" emissiveIntensity={0.6} fog={false} />
      </mesh>
      <mesh material={atmo}><sphereGeometry args={[7.6, 48, 32]} /></mesh>
    </group>
  );
}

function SunDisc({ theme, flare }) {
  const dir = useMemo(() => new THREE.Vector3(...theme.sunDir).normalize().multiplyScalar(200), [theme]);
  const ref = useRef();
  const tex = useMemo(() => softDot(), []);
  useFrame(() => { const s = 1 + flare.current * 0.9; ref.current.scale.setScalar(s); });
  return (
    <group position={dir}>
      <mesh><sphereGeometry args={[theme === THEME.Moon ? 4.2 : 3.1, 24, 16]} /><meshBasicMaterial color="#fff" toneMapped={false} fog={false} /></mesh>
      <sprite ref={ref} scale={[60, 60, 1]}>
        <spriteMaterial map={tex} color={theme.sun} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} toneMapped={false} />
      </sprite>
    </group>
  );
}

function Phobos() {
  const ref = useRef();
  useFrame(({ clock }) => { ref.current.rotation.y = clock.elapsedTime * 0.05; });
  return (
    <mesh ref={ref} position={[45, 38, -70]} scale={[3.2, 2.6, 2.6]}>
      <icosahedronGeometry args={[1, 2]} />
      <meshStandardMaterial color="#8a7a70" roughness={1} fog={false} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared building parts                                              */
/* ------------------------------------------------------------------ */
function Shadowed({ children, ...rest }) {
  const ref = useRef();
  useLayoutEffect(() => {
    ref.current.traverse((o) => {
      if (o.isMesh) { o.receiveShadow = true; o.castShadow = !(o.material && o.material.transparent); }
    });
  });
  return <group ref={ref} {...rest}>{children}</group>;
}

const HULL = { color: "#e7ecf2", metalness: 0.35, roughness: 0.38 };
const DARK = { color: "#38424f", metalness: 0.6, roughness: 0.5 };
const GLOW = { emissive: "#ffd98a", emissiveIntensity: 2.4, toneMapped: false, color: "#ffe9b8" };

function Glass({ color = "#a9e3ff", opacity = 0.32 }) {
  return <meshPhysicalMaterial color={color} transparent opacity={opacity} roughness={0.05} metalness={0.1} clearcoat={1} clearcoatRoughness={0.05} envMapIntensity={2.2} depthWrite={false} />;
}

function Platform({ radius = 1.1, accent, active, hovered }) {
  const ring = useRef();
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const m = ring.current.material;
    m.emissiveIntensity = active ? 3 + Math.sin(t * 4) * 1 : hovered ? 2 : 0.7;
    const s = 1 + (active ? Math.sin(t * 4) * 0.025 : 0);
    ring.current.scale.set(s, s, 1);
  });
  const lights = useMemo(() => Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2), []);
  return (
    <group>
      <mesh position={[0, 0.03, 0]}><cylinderGeometry args={[radius * 1.1, radius * 1.16, 0.07, 48]} /><meshStandardMaterial color="#232a34" roughness={0.9} /></mesh>
      <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[radius, radius * 1.05, 0.12, 48]} /><meshStandardMaterial color="#4b5563" metalness={0.5} roughness={0.55} /></mesh>
      <mesh position={[0, 0.165, 0]}><cylinderGeometry args={[radius * 0.86, radius * 0.86, 0.03, 48]} /><meshStandardMaterial color="#1b222c" roughness={0.85} /></mesh>
      <mesh ref={ring} position={[0, 0.185, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius * 0.93, 0.022, 8, 72]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.7} toneMapped={false} />
      </mesh>
      {lights.map((a, i) => (
        <mesh key={i} position={[Math.cos(a) * radius * 1.01, 0.17, Math.sin(a) * radius * 1.01]}>
          <boxGeometry args={[0.06, 0.04, 0.06]} />
          <meshStandardMaterial color="#ffe3a3" emissive="#ffc95e" emissiveIntensity={2.5} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function Blink({ position, color = "#ff4d4d", rate = 3, size = 0.055 }) {
  const ref = useRef();
  useFrame(({ clock }) => { ref.current.material.emissiveIntensity = Math.sin(clock.elapsedTime * rate) > 0.3 ? 5 : 0.15; });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[size, 12, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={4} toneMapped={false} />
    </mesh>
  );
}

function Dish({ position, scale = 1, speed = 0.4, tilt = -0.9 }) {
  const ref = useRef();
  useFrame((_, dt) => { ref.current.rotation.y += dt * speed; });
  return (
    <group position={position} scale={scale}>
      <group ref={ref}>
        <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[0.04, 0.05, 0.25, 10]} /><meshStandardMaterial {...DARK} /></mesh>
        <group position={[0, 0.3, 0]} rotation={[tilt, 0, 0]}>
          <mesh><sphereGeometry args={[0.38, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.42]} /><meshStandardMaterial color="#f1f4f8" metalness={0.3} roughness={0.35} side={THREE.DoubleSide} /></mesh>
          <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.012, 0.012, 0.3, 6]} /><meshStandardMaterial color="#9aa6b4" metalness={0.8} /></mesh>
          <mesh position={[0, 0.36, 0]}><sphereGeometry args={[0.035, 10, 8]} /><meshStandardMaterial color="#ffb347" emissive="#ff9f1a" emissiveIntensity={1.5} toneMapped={false} /></mesh>
        </group>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Building models                                                    */
/* ------------------------------------------------------------------ */
function HabitatModel() {
  return (
    <Shadowed>
      <mesh position={[0, 0.74, 0]} rotation={[0, 0, Math.PI / 2]}><capsuleGeometry args={[0.58, 0.72, 16, 40]} /><meshStandardMaterial {...HULL} /></mesh>
      {[-0.55, -0.18, 0.18, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.74, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[0.585, 0.028, 10, 40]} /><meshStandardMaterial color="#5b6879" metalness={0.7} roughness={0.35} /></mesh>
      ))}
      {[-0.4, 0, 0.4].map((x) => (
        <mesh key={x} position={[x, 0.92, 0.5]} rotation={[0.55, 0, 0]}><boxGeometry args={[0.22, 0.12, 0.03]} /><meshStandardMaterial {...GLOW} /></mesh>
      ))}
      <mesh position={[0, 1.28, 0]}><sphereGeometry args={[0.34, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><Glass /></mesh>
      <mesh position={[0, 1.27, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.34, 0.025, 8, 32]} /><meshStandardMaterial color="#cfd8e3" metalness={0.7} roughness={0.3} /></mesh>
      <group position={[0, 0.58, -0.68]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh><cylinderGeometry args={[0.2, 0.2, 0.34, 20]} /><meshStandardMaterial {...DARK} /></mesh>
        <mesh position={[0, 0.18, 0]}><cylinderGeometry args={[0.15, 0.15, 0.03, 20]} /><meshStandardMaterial color="#8bd6ff" emissive="#3aa8e8" emissiveIntensity={1.3} toneMapped={false} /></mesh>
      </group>
      {[-0.5, 0.5].map((x) => (
        <mesh key={x} position={[x, 0.42, -0.6]} rotation={[0, 0, Math.PI / 2]}><capsuleGeometry args={[0.1, 0.22, 6, 14]} /><meshStandardMaterial color="#c9d2dc" metalness={0.6} roughness={0.35} /></mesh>
      ))}
      <mesh position={[0.45, 1.5, -0.1]}><cylinderGeometry args={[0.018, 0.018, 0.5, 8]} /><meshStandardMaterial color="#c7d0da" metalness={0.8} /></mesh>
      <Blink position={[0.45, 1.78, -0.1]} />
    </Shadowed>
  );
}

function GreenhouseModel() {
  const rows = [-0.4, 0, 0.4];
  return (
    <Shadowed>
      <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.92, 0.98, 0.26, 40]} /><meshStandardMaterial color="#394656" metalness={0.55} roughness={0.5} /></mesh>
      <mesh position={[0, 0.43, 0]}><sphereGeometry args={[0.9, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} /><Glass color="#9bf0c8" opacity={0.24} /></mesh>
      <mesh position={[0, 0.43, 0]}><icosahedronGeometry args={[0.905, 1]} /><meshStandardMaterial color="#b8c4d2" metalness={0.8} roughness={0.3} wireframe /></mesh>
      {rows.map((z) => (
        <group key={z} position={[0, 0.46, z]}>
          <mesh position={[0, 0.02, 0]}><boxGeometry args={[1.0, 0.1, 0.22]} /><meshStandardMaterial color="#3a2a22" roughness={1} /></mesh>
          {[-0.35, -0.12, 0.12, 0.35].map((x, i) => (
            <group key={x} position={[x, 0.1, 0]} scale={0.8 + ((i + (z > 0 ? 1 : 0)) % 3) * 0.15}>
              <mesh position={[0, 0.07, 0]}><sphereGeometry args={[0.09, 12, 10]} /><meshStandardMaterial color="#47c97b" emissive="#1c7a42" emissiveIntensity={0.6} roughness={0.6} /></mesh>
              <mesh position={[0.05, 0.14, 0.02]} rotation={[0, 0, -0.5]}><sphereGeometry args={[0.06, 10, 8]} /><meshStandardMaterial color="#7be39b" emissive="#25a05a" emissiveIntensity={0.6} /></mesh>
            </group>
          ))}
        </group>
      ))}
      <mesh position={[0, 0.95, 0]}><boxGeometry args={[0.9, 0.03, 0.12]} /><meshStandardMaterial color="#ff7bd5" emissive="#ff3fc0" emissiveIntensity={2.4} toneMapped={false} /></mesh>
      <pointLight position={[0, 0.8, 0]} color="#ff7bd5" intensity={1.8} distance={3.2} />
      <mesh position={[0, 0.38, 0.93]}><boxGeometry args={[0.36, 0.34, 0.1]} /><meshStandardMaterial {...DARK} /></mesh>
    </Shadowed>
  );
}

function ResearchLabModel() {
  const vane = useRef();
  useFrame((_, dt) => { vane.current.rotation.y += dt * 4; });
  return (
    <Shadowed>
      <mesh position={[-0.2, 0.68, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.52, 0.52, 1.25, 40]} /><meshStandardMaterial color="#ece6d6" metalness={0.3} roughness={0.4} /></mesh>
      <mesh position={[0.72, 0.58, 0]}><boxGeometry args={[0.7, 0.8, 0.95]} /><meshStandardMaterial color="#c99a35" metalness={0.65} roughness={0.35} /></mesh>
      {[-0.55, -0.2, 0.15].map((x) => (
        <mesh key={x} position={[x, 0.78, 0.5]} rotation={[0.35, 0, 0]}><boxGeometry args={[0.2, 0.14, 0.03]} /><meshStandardMaterial {...GLOW} /></mesh>
      ))}
      <mesh position={[0.72, 0.62, 0.49]}><boxGeometry args={[0.4, 0.28, 0.03]} /><meshStandardMaterial color="#7fe3ff" emissive="#2ab3e6" emissiveIntensity={1.6} toneMapped={false} /></mesh>
      <mesh position={[-0.2, 1.25, 0]}><sphereGeometry args={[0.24, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2]} /><Glass color="#ffe7a6" opacity={0.45} /></mesh>
      <mesh position={[-0.2, 1.38, 0]} rotation={[0.6, 0.4, 0]}><cylinderGeometry args={[0.05, 0.07, 0.32, 12]} /><meshStandardMaterial {...DARK} /></mesh>
      <Dish position={[0.72, 0.98, 0]} scale={0.8} speed={0.5} />
      <mesh position={[-0.7, 1.0, -0.3]}><cylinderGeometry args={[0.015, 0.015, 0.9, 8]} /><meshStandardMaterial color="#c7d0da" metalness={0.85} /></mesh>
      <group ref={vane} position={[-0.7, 1.46, -0.3]}>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation={[0, (i * Math.PI * 2) / 3, 0]}>
            <mesh position={[0.1, 0, 0]}><boxGeometry args={[0.2, 0.012, 0.012]} /></mesh>
            <mesh position={[0.2, 0, 0]}><sphereGeometry args={[0.035, 8, 6]} /><meshStandardMaterial color="#ffcc5a" /></mesh>
          </group>
        ))}
      </group>
      <Blink position={[0.72, 1.01, -0.4]} color="#59ff9d" rate={2} size={0.04} />
    </Shadowed>
  );
}

function ShelterModel() {
  return (
    <Shadowed>
      <mesh position={[0, 0.17, 0]} scale={[1, 0.62, 0.9]}><sphereGeometry args={[0.98, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#6f6a68" roughness={1} /></mesh>
      <mesh position={[0, 0.17, 0]} scale={[1.02, 0.64, 0.92]}><sphereGeometry args={[0.98, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#8d8a9b" roughness={1} wireframe /></mesh>
      <mesh position={[0, 0.4, 0.8]}><boxGeometry args={[0.56, 0.5, 0.3]} /><meshStandardMaterial color="#2a303b" metalness={0.5} roughness={0.55} /></mesh>
      <mesh position={[0, 0.38, 0.96]}><boxGeometry args={[0.4, 0.38, 0.03]} /><meshStandardMaterial color="#1b2028" metalness={0.6} roughness={0.4} /></mesh>
      {[-0.22, 0.22].map((x) => <mesh key={x} position={[x, 0.65, 0.95]}><boxGeometry args={[0.04, 0.05, 0.04]} /><meshStandardMaterial color="#ffc92b" emissive="#ffb300" emissiveIntensity={1.5} toneMapped={false} /></mesh>)}
      <mesh position={[0, 0.78, 0.7]} rotation={[-0.35, 0, 0]}><circleGeometry args={[0.16, 24]} /><meshStandardMaterial color="#ffd23a" emissive="#ffb300" emissiveIntensity={0.7} toneMapped={false} /></mesh>
      <mesh position={[0, 0.78, 0.705]} rotation={[-0.35, 0, 0]}><ringGeometry args={[0.04, 0.1, 3]} /><meshStandardMaterial color="#111" /></mesh>
      <Blink position={[0, 0.74, 0]} color="#ffa72b" rate={5} size={0.07} />
      {[[-0.6, 0.2, -0.5], [0.55, 0.18, -0.6], [0.8, 0.15, 0.2]].map((p, i) => (
        <mesh key={i} position={p} rotation={[i, i * 2, 0]}><dodecahedronGeometry args={[0.12 + i * 0.03, 0]} /><meshStandardMaterial color="#5a5656" roughness={1} flatShading /></mesh>
      ))}
    </Shadowed>
  );
}

function CommunicationModel() {
  return (
    <Shadowed>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return (
          <group key={i} rotation={[0, a, 0]}>
            <mesh position={[0.22, 1.05, 0]} rotation={[0, 0, -0.1]}><cylinderGeometry args={[0.018, 0.03, 2.0, 8]} /><meshStandardMaterial color="#aab6c3" metalness={0.85} roughness={0.3} /></mesh>
          </group>
        );
      })}
      {[0.4, 0.9, 1.4, 1.85].map((y, i) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, Math.PI / 6]}><torusGeometry args={[0.21 - i * 0.025, 0.012, 6, 3]} /><meshStandardMaterial color="#8794a3" metalness={0.8} /></mesh>
      ))}
      <Dish position={[0, 2.0, 0]} scale={1.1} speed={0.35} tilt={-1.0} />
      <Blink position={[0, 2.62, 0]} color="#59ff9d" rate={2.5} size={0.045} />
      <mesh position={[0.5, 0.32, 0.2]}><boxGeometry args={[0.36, 0.3, 0.3]} /><meshStandardMaterial {...DARK} /></mesh>
      {[0, 1, 2].map((i) => <mesh key={i} position={[0.5, 0.26 + i * 0.07, 0.355]}><boxGeometry args={[0.2, 0.025, 0.01]} /><meshStandardMaterial color="#6df0b0" emissive="#27d48a" emissiveIntensity={2} toneMapped={false} /></mesh>)}
    </Shadowed>
  );
}

function SolarModel() {
  const tex = useMemo(() => solarTexture(), []);
  return (
    <Shadowed>
      <group rotation={[0, 0.2, 0]}>
        {[-1.05, 0, 1.05].map((x) => (
          <group key={x} position={[x, 0.75, 0]} rotation={[-0.38, 0, 0]}>
            <mesh><boxGeometry args={[0.96, 0.05, 1.3]} /><meshStandardMaterial color="#c5cdd8" metalness={0.8} roughness={0.35} /></mesh>
            <mesh position={[0, 0.03, 0]}><boxGeometry args={[0.88, 0.012, 1.22]} /><meshPhysicalMaterial map={tex} metalness={0.7} roughness={0.22} clearcoat={0.9} clearcoatRoughness={0.1} envMapIntensity={1.6} /></mesh>
          </group>
        ))}
        {[-1.05, 0, 1.05].map((x) => (
          <mesh key={x} position={[x, 0.4, -0.12]}><cylinderGeometry args={[0.035, 0.05, 0.62, 10]} /><meshStandardMaterial color="#aab6c3" metalness={0.8} roughness={0.35} /></mesh>
        ))}
        <mesh position={[0, 0.3, 0.7]}><boxGeometry args={[0.42, 0.34, 0.26]} /><meshStandardMaterial {...DARK} /></mesh>
        <mesh position={[0.12, 0.38, 0.832]}><boxGeometry args={[0.06, 0.06, 0.01]} /><meshStandardMaterial color="#6df0b0" emissive="#27d48a" emissiveIntensity={2.4} toneMapped={false} /></mesh>
      </group>
    </Shadowed>
  );
}

const MODELS = {
  "Crew Habitat": HabitatModel,
  Greenhouse: GreenhouseModel,
  "Research Lab": ResearchLabModel,
  "Radiation Shelter": ShelterModel,
  "Communication Tower": CommunicationModel,
  "Solar Power Station": SolarModel
};

function Clickable({ name, position, onSelect, selected, radius = 1.08, labelY = 2.0, label }) {
  const [hovered, setHovered] = useState(false);
  const Model = MODELS[name];
  const accent = ACCENT[name];
  useFrame(({ clock }) => {
    // gentle breathing handled by platform ring; nothing here
  });
  return (
    <group
      position={position}
      onClick={(e) => { e.stopPropagation(); onSelect(name); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = "auto"; }}
    >
      <Platform radius={radius} accent={accent} active={selected} hovered={hovered} />
      <Model />
      <Billboard position={[0, labelY, 0]}>
        <Text
          font={FONT}
          fontSize={0.18}
          color={selected || hovered ? "#ffffff" : "#d6e4f7"}
          outlineWidth={0.018}
          outlineColor="#020812"
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.04}
          material-toneMapped={false}
          raycast={() => null}
        >
          {label || name}
        </Text>
      </Billboard>
      {selected && <pointLight position={[0, 1.2, 0]} intensity={2.4} distance={4} color={accent} />}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Crew & rover                                                       */
/* ------------------------------------------------------------------ */
function Astronaut({ position, mode = "idle", path, color = "#f4f6f8", accent = "#ff7a45", scale = 1.15, phase = 0 }) {
  const root = useRef(), armL = useRef(), armR = useRef(), legL = useRef(), legR = useRef(), body = useRef();
  const dir = useMemo(() => {
    if (!path) return null;
    const a = new THREE.Vector3(...path[0]), b = new THREE.Vector3(...path[1]);
    return { a, b, len: a.distanceTo(b), ang: Math.atan2(b.x - a.x, b.z - a.z) };
  }, [path]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    if (mode === "walk" && dir) {
      const p = ((t * 0.42) / dir.len) % 2;
      const u = p < 1 ? p : 2 - p;
      root.current.position.lerpVectors(dir.a, dir.b, u);
      root.current.rotation.y = lerpAngle(root.current.rotation.y, p < 1 ? dir.ang : dir.ang + Math.PI, 0.08);
      const s = Math.sin(t * 5.5) * 0.55;
      legL.current.rotation.x = s; legR.current.rotation.x = -s;
      armL.current.rotation.x = -s * 0.8; armR.current.rotation.x = s * 0.8;
      body.current.position.y = Math.abs(Math.sin(t * 5.5)) * 0.025;
    } else if (mode === "wave") {
      armR.current.rotation.z = -2.5 + Math.sin(t * 4) * 0.35;
      armR.current.rotation.x = 0;
      armL.current.rotation.x = Math.sin(t * 1.2) * 0.05;
      body.current.position.y = Math.sin(t * 1.6) * 0.008;
      root.current.rotation.y = 2.3 + Math.sin(t * 0.5) * 0.15;
    } else {
      body.current.position.y = Math.sin(t * 1.6) * 0.008;
    }
  });

  const suit = <meshStandardMaterial color={color} roughness={0.62} />;
  return (
    <Shadowed>
      <group ref={root} position={position} scale={scale}>
        <group ref={body}>
          <mesh position={[0, 0.66, 0]}><capsuleGeometry args={[0.17, 0.26, 8, 16]} />{suit}</mesh>
          <mesh position={[0, 0.7, 0.165]}><boxGeometry args={[0.16, 0.12, 0.03]} /><meshStandardMaterial color="#27313f" emissive={accent} emissiveIntensity={0.7} toneMapped={false} /></mesh>
          <mesh position={[0, 0.66, -0.2]}><boxGeometry args={[0.28, 0.38, 0.14]} /><meshStandardMaterial color="#cfd6df" roughness={0.6} metalness={0.2} /></mesh>
          <mesh position={[0, 0.5, 0]}><torusGeometry args={[0.16, 0.025, 8, 20]} /><meshStandardMaterial color="#9aa6b4" metalness={0.6} roughness={0.4} /></mesh>
          <mesh position={[0, 1.04, 0]}><sphereGeometry args={[0.215, 28, 20]} /><meshStandardMaterial color="#f5f7fa" roughness={0.3} metalness={0.1} /></mesh>
          <mesh position={[0, 1.03, 0.07]} scale={[1, 0.82, 0.8]}><sphereGeometry args={[0.172, 28, 18]} /><meshPhysicalMaterial color="#0a1624" metalness={1} roughness={0.04} clearcoat={1} envMapIntensity={2.8} /></mesh>
          <mesh position={[0.2, 1.04, 0]}><boxGeometry args={[0.03, 0.06, 0.08]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.6} toneMapped={false} /></mesh>
          <group ref={armL} position={[-0.23, 0.82, 0]}>
            <mesh position={[0, -0.14, 0]}><capsuleGeometry args={[0.06, 0.2, 6, 10]} />{suit}</mesh>
            <mesh position={[0, -0.29, 0]}><sphereGeometry args={[0.065, 10, 8]} /><meshStandardMaterial color="#aeb7c2" /></mesh>
          </group>
          <group ref={armR} position={[0.23, 0.82, 0]}>
            <mesh position={[0, -0.14, 0]}><capsuleGeometry args={[0.06, 0.2, 6, 10]} />{suit}</mesh>
            <mesh position={[0, -0.29, 0]}><sphereGeometry args={[0.065, 10, 8]} /><meshStandardMaterial color="#aeb7c2" /></mesh>
          </group>
          <group ref={legL} position={[-0.09, 0.44, 0]}>
            <mesh position={[0, -0.2, 0]}><capsuleGeometry args={[0.075, 0.24, 6, 10]} />{suit}</mesh>
            <mesh position={[0, -0.4, 0.04]}><boxGeometry args={[0.13, 0.08, 0.2]} /><meshStandardMaterial color="#59606b" roughness={0.8} /></mesh>
          </group>
          <group ref={legR} position={[0.09, 0.44, 0]}>
            <mesh position={[0, -0.2, 0]}><capsuleGeometry args={[0.075, 0.24, 6, 10]} />{suit}</mesh>
            <mesh position={[0, -0.4, 0.04]}><boxGeometry args={[0.13, 0.08, 0.2]} /><meshStandardMaterial color="#59606b" roughness={0.8} /></mesh>
          </group>
        </group>
      </group>
    </Shadowed>
  );
}

function Rover() {
  const root = useRef();
  const wheels = useRef([]);
  const R = 6.9;
  useFrame(({ clock }) => {
    const a = clock.elapsedTime * 0.1;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    const dx = -Math.sin(a), dz = Math.cos(a);
    root.current.position.set(x, -0.1, z);
    root.current.rotation.y = Math.atan2(-dz, dx);
    wheels.current.forEach((w) => { if (w) w.rotation.z -= 0.035; });
  });
  const wp = [[-0.5, 0.2, 0.42], [0, 0.2, 0.46], [0.5, 0.2, 0.42], [-0.5, 0.2, -0.42], [0, 0.2, -0.46], [0.5, 0.2, -0.42]];
  return (
    <Shadowed>
      <group ref={root} scale={1.25}>
        <mesh position={[0, 0.5, 0]}><boxGeometry args={[1.15, 0.28, 0.7]} /><meshStandardMaterial color="#dfe5ec" metalness={0.35} roughness={0.42} /></mesh>
        <mesh position={[0.05, 0.72, 0]}><boxGeometry args={[0.55, 0.16, 0.5]} /><meshStandardMaterial color="#f2f5f8" roughness={0.4} /></mesh>
        <mesh position={[-0.2, 0.67, 0]} rotation={[0, 0, 0.16]}><boxGeometry args={[0.52, 0.03, 0.62]} /><meshStandardMaterial color="#1d5f99" metalness={0.7} roughness={0.28} /></mesh>
        {wp.map((p, i) => (
          <group key={i} position={p}>
            <group ref={(el) => (wheels.current[i] = el)}>
              <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.2, 0.2, 0.14, 20]} /><meshStandardMaterial color="#222831" roughness={0.95} /></mesh>
              <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.1, 0.1, 0.16, 12]} /><meshStandardMaterial color="#9aa5b2" metalness={0.8} roughness={0.3} /></mesh>
              {[0, 1, 2, 3].map((k) => <mesh key={k} rotation={[0, 0, (k * Math.PI) / 4]}><boxGeometry args={[0.42, 0.03, 0.15]} /><meshStandardMaterial color="#14181e" roughness={1} /></mesh>)}
            </group>
          </group>
        ))}
        <mesh position={[0.45, 0.98, 0.15]}><cylinderGeometry args={[0.02, 0.02, 0.6, 8]} /><meshStandardMaterial color="#b4bfcb" metalness={0.8} /></mesh>
        <mesh position={[0.45, 1.3, 0.15]}><boxGeometry args={[0.24, 0.14, 0.18]} /><meshStandardMaterial color="#44505f" metalness={0.5} roughness={0.5} /></mesh>
        <mesh position={[0.58, 1.3, 0.15]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.04, 0.04, 0.02, 10]} /><meshStandardMaterial color="#09131f" metalness={1} roughness={0.05} /></mesh>
        <mesh position={[0.62, 0.52, -0.1]}><boxGeometry args={[0.08, 0.08, 0.12]} /><meshStandardMaterial color="#ffeeb8" emissive="#fff0b3" emissiveIntensity={3} toneMapped={false} /></mesh>
        <mesh position={[0.62, 0.52, 0.1]}><boxGeometry args={[0.08, 0.08, 0.12]} /><meshStandardMaterial color="#ffeeb8" emissive="#fff0b3" emissiveIntensity={3} toneMapped={false} /></mesh>
      </group>
    </Shadowed>
  );
}

/* ------------------------------------------------------------------ */
/*  Base layout props: paths, lamps                                    */
/* ------------------------------------------------------------------ */
const POS = {
  "Crew Habitat": [-2.4, 0, -0.3],
  Greenhouse: [2.1, 0, -1.1],
  "Research Lab": [0.2, 0, 2.2],
  "Radiation Shelter": [-3.5, 0, 2.5],
  "Solar Power Station": [3.8, 0, 2.8],
  "Communication Tower": [4.1, 0, -3.0]
};

function Paths() {
  const segs = useMemo(() => Object.values(POS).map(([x, , z]) => {
    const len = Math.hypot(x, z) - 1.0;
    const ang = Math.atan2(x, z);
    return { len, ang, mx: (x / Math.hypot(x, z)) * (len / 2 + 0.2), mz: (z / Math.hypot(x, z)) * (len / 2 + 0.2) };
  }), []);
  return (
    <group>
      <mesh position={[0, -0.085, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.55, 40]} /><meshStandardMaterial color="#2a303a" roughness={1} /></mesh>
      <mesh position={[0, -0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.38, 0.42, 40]} /><meshStandardMaterial color="#8bd6ff" emissive="#4fb8f0" emissiveIntensity={1.6} toneMapped={false} /></mesh>
      {segs.map((s, i) => (
        <mesh key={i} position={[s.mx, -0.088, s.mz]} rotation={[-Math.PI / 2, 0, -s.ang]}>
          <planeGeometry args={[0.34, s.len]} />
          <meshStandardMaterial color="#262c35" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function Lamps() {
  return (
    <group>
      {[[-1.4, 1.5], [1.4, 1.4], [1.1, -2.1], [-1.2, -2.0]].map(([x, z], i) => (
        <group key={i} position={[x, -0.1, z]}>
          <mesh position={[0, 0.4, 0]} castShadow><cylinderGeometry args={[0.02, 0.03, 0.8, 8]} /><meshStandardMaterial color="#aab4c0" metalness={0.8} roughness={0.35} /></mesh>
          <mesh position={[0, 0.82, 0]}><sphereGeometry args={[0.06, 12, 10]} /><meshStandardMaterial color="#fff1c9" emissive="#ffd88a" emissiveIntensity={4} toneMapped={false} /></mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Scene root                                                         */
/* ------------------------------------------------------------------ */
export function OutpostScene({ planet, selected, onSelect, weather = "clear" }) {
  const theme = THEME[planet];
  const terrain = useMemo(() => makeTerrain(planet), [planet]);
  const { scene } = useThree();
  const sunRef = useRef();
  const bloomRef = useRef();
  const k = useRef({ storm: 0, flare: 0 });
  const [auto, setAuto] = useState(true);

  const baseFog = useMemo(() => new THREE.Color(theme.fog), [theme]);
  const stormFog = useMemo(() => new THREE.Color("#a3563a"), []);
  const sunBase = useMemo(() => new THREE.Color(theme.sun), [theme]);
  const flareCol = useMemo(() => new THREE.Color("#ff9a6b"), []);

  useLayoutEffect(() => {
    scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
    return () => { scene.fog = null; };
  }, [scene, theme]);

  useFrame((_, dt) => {
    const kk = k.current;
    kk.storm = THREE.MathUtils.damp(kk.storm, weather === "storm" ? 1 : 0, 1.6, dt);
    kk.flare = THREE.MathUtils.damp(kk.flare, weather === "flare" ? 1 : 0, 2.0, dt);
    if (scene.fog) {
      scene.fog.near = theme.fogNear * (1 - kk.storm * 0.75);
      scene.fog.far = theme.fogFar * (1 - kk.storm * 0.5);
      scene.fog.color.copy(baseFog).lerp(stormFog, kk.storm);
    }
    if (sunRef.current) {
      sunRef.current.intensity = theme.sunInt * (1 - kk.storm * 0.55) * (1 + kk.flare * 0.5);
      sunRef.current.color.copy(sunBase).lerp(flareCol, kk.flare);
    }
    if (bloomRef.current) bloomRef.current.intensity = 0.55 + kk.flare * 0.7;
  });

  const sunPos = theme.sunDir;
  return (
    <>
      <SkyDome theme={theme} />
      {planet === "Moon" && <Stars radius={180} depth={40} count={4500} factor={4} saturation={0} fade speed={0.4} />}
      {planet === "Moon" && <Earth />}
      {planet === "Mars" && <Phobos />}
      <SunDisc theme={theme} flare={{ get current() { return k.current.flare; } }} />

      <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiInt]} />
      <directionalLight
        ref={sunRef}
        position={sunPos}
        color={theme.sun}
        intensity={theme.sunInt}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-11} shadow-camera-right={11}
        shadow-camera-top={11} shadow-camera-bottom={-11}
        shadow-camera-near={1} shadow-camera-far={70}
        shadow-bias={-0.0004} shadow-normalBias={0.04}
      />
      <Environment resolution={256} environmentIntensity={0.3}>
        <Lightformer form="rect" intensity={3} position={[6, 6, 4]} scale={[10, 5, 1]} color={theme.sun} />
        <Lightformer form="rect" intensity={1.2} position={[-6, 4, -5]} scale={[10, 4, 1]} color={theme.envTint} />
        <Lightformer form="ring" intensity={1.5} position={[0, 8, 0]} scale={8} rotation-x={Math.PI / 2} color="#ffffff" />
      </Environment>

      <Terrain planet={planet} theme={theme} terrain={terrain} />
      <Rocks theme={theme} terrain={terrain} />
      <Paths />
      <Lamps />
      {theme.dust && <Dust theme={theme} k={k} />}

      {Object.keys(POS).map((name) => (
        <Clickable
          key={name}
          name={name}
          position={POS[name]}
          onSelect={onSelect}
          selected={selected === name}
          radius={name === "Communication Tower" ? 0.85 : name === "Solar Power Station" ? 1.35 : 1.08}
          labelY={name === "Communication Tower" ? 2.95 : name === "Solar Power Station" ? 1.6 : 2.0}
          label={name === "Solar Power Station" ? "Solar Array" : name}
        />
      ))}

      <Rover />
      <Astronaut mode="walk" path={[[-1.2, -0.1, 0.3], [1.2, -0.1, 0.5]]} accent="#ff7a45" />
      <Astronaut mode="wave" position={[-0.6, -0.1, 3.4]} color="#dbe7ff" accent="#59b4ff" phase={1.5} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.06}
        minDistance={6}
        maxDistance={20}
        maxPolarAngle={Math.PI / 2.08}
        target={[0, 0.6, 0]}
        autoRotate={auto}
        autoRotateSpeed={0.35}
        onStart={() => setAuto(false)}
      />

      <EffectComposer multisampling={4}>
        <Bloom ref={bloomRef} intensity={0.55} luminanceThreshold={0.9} luminanceSmoothing={0.25} mipmapBlur />
        <Vignette eskil={false} offset={0.25} darkness={0.7} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}
