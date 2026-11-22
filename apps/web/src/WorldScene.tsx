import { Canvas, useThree } from '@react-three/fiber';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { DeviceDefinition, DeviceState, Link, PublicLevel } from '../../../packages/shared/src/index';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SceneKit, sceneMoods, type SceneName } from './scene/kits';
import { useTextureRevision } from './scene/textures';

type SceneDevice = { definition: DeviceDefinition; state?: DeviceState; position: [number, number, number] };
type ViewController = { reset: () => void };
type Palette = { sky: string; ground: string; light: string; accent: string; surface: string };

const kindLabels: Record<DeviceDefinition['kind'], string> = {
  sensor: '感知', actuator: '执行', radio: '无线', controller: '控制', gateway: '网关',
  cloud: '云端', power: '供电', rfid: '识别', terminal: '终端', router: '路由',
};
const linkColors: Record<Link['kind'], string> = { wire: '#0f9b7d', wireless: '#2563eb', bus: '#d97706', network: '#4f46e5' };

/** 浅色主题下每个场景的强调色，3D 与 2D 回退共用一套。 */
const scenePalettes: Record<SceneName, Palette> = {
  city: { sky: '#eaf2fb', ground: '#f3f7fa', light: '#fff6e6', accent: '#0f9b7d', surface: '#ffffff' },
  lab: { sky: '#f2f7fb', ground: '#f7fbfe', light: '#ffffff', accent: '#2563eb', surface: '#ffffff' },
  greenhouse: { sky: '#eef8f2', ground: '#f2f8f3', light: '#fdf7df', accent: '#16a34a', surface: '#ffffff' },
  home: { sky: '#fbf6f0', ground: '#fbf7f1', light: '#fff1dc', accent: '#0f9b7d', surface: '#ffffff' },
  factory: { sky: '#eef1f5', ground: '#f1f4f7', light: '#fff8ea', accent: '#ea580c', surface: '#ffffff' },
  datacenter: { sky: '#eef3fa', ground: '#f5f9fd', light: '#f4f8ff', accent: '#2563eb', surface: '#ffffff' },
  traffic: { sky: '#e9f0f7', ground: '#eef2f6', light: '#fff6e8', accent: '#f59e0b', surface: '#ffffff' },
  power: { sky: '#edf3f7', ground: '#f0f4f7', light: '#fff7e8', accent: '#0f9b7d', surface: '#ffffff' },
  network: { sky: '#eef3fb', ground: '#f6fafe', light: '#f6f9ff', accent: '#2563eb', surface: '#ffffff' },
  crisis: { sky: '#f7eeee', ground: '#f1f2f4', light: '#ffeede', accent: '#dc2626', surface: '#ffffff' },
};
const paletteOf = (scene: string): Palette => scenePalettes[(scene as SceneName)] ?? scenePalettes.city;

function deviceStatus(item: SceneDevice) {
  const installed = item.state?.installed ?? item.definition.installed;
  const enabled = item.state?.enabled ?? item.definition.enabled;
  const faults = item.state?.faults ?? item.definition.faults;
  if (!installed) return '未安装';
  if (faults.length || item.state?.status === 'fault') return '故障';
  if (!enabled || item.state?.status === 'offline') return '离线';
  return '在线';
}
const statusHex = (item: SceneDevice) => {
  const status = deviceStatus(item);
  return status === '故障' ? '#dc2626' : status === '在线' ? '#16a34a' : '#94a3b8';
};

/* --------------------------- 设备标签 --------------------------- */

function SceneLabel({ text, color }: { text: string; color: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 148;
    const context = canvas.getContext('2d');
    if (context) {
      const radius = 20;
      context.fillStyle = 'rgba(255,255,255,.97)';
      context.beginPath(); context.roundRect(4, 4, 632, 140, radius); context.fill();
      context.strokeStyle = 'rgba(17,64,56,.16)'; context.lineWidth = 3; context.stroke();
      context.fillStyle = color;
      context.beginPath(); context.roundRect(4, 4, 12, 140, [radius, 0, 0, radius]); context.fill();
      context.fillStyle = '#122a26'; context.textAlign = 'left'; context.textBaseline = 'middle';
      let size = 44;
      context.font = '600 ' + size + 'px "Noto Sans SC",sans-serif';
      while (context.measureText(text).width > 580 && size > 22) {
        size -= 2;
        context.font = '600 ' + size + 'px "Noto Sans SC",sans-serif';
      }
      context.fillText(text, 36, 76, 576);
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.minFilter = THREE.LinearFilter;
    map.anisotropy = 4;
    return map;
  }, [text, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  // 用 sprite：永远正对相机，旋转视角时标签不会斜着飘
  return <sprite position={[0, 1.0, 0]} scale={[1.5, 0.35, 1]}>
    <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
  </sprite>;
}

/* --------------------------- 设备外形 --------------------------- */

function shell(color: string, metalness = 0.15, roughness = 0.55) {
  return <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />;
}

function DeviceShape({ kind, color, online }: { kind: DeviceDefinition['kind']; color: string; online: boolean }) {
  const led = <meshBasicMaterial color={online ? '#22c55e' : '#cbd5e1'} />;
  switch (kind) {
    case 'sensor':
      return <group>
        <mesh position={[0, 0.16, 0]} castShadow receiveShadow><boxGeometry args={[0.26, 0.32, 0.26]} />{shell('#f1f5f9', 0.2, 0.6)}</mesh>
        <mesh position={[0, 0.44, 0]} castShadow><cylinderGeometry args={[0.11, 0.13, 0.22, 16]} />{shell(color, 0.35, 0.4)}</mesh>
        <mesh position={[0, 0.57, 0]}><sphereGeometry args={[0.075, 16, 12]} />{shell('#ffffff', 0.1, 0.25)}</mesh>
        <mesh position={[0, 0.64, 0]}><sphereGeometry args={[0.026, 10, 8]} />{led}</mesh>
        <mesh position={[0.13, 0.2, 0.02]} rotation={[0, 0, -0.3]}><boxGeometry args={[0.03, 0.2, 0.03]} />{shell('#94a3b8', 0.6, 0.4)}</mesh>
      </group>;
    case 'actuator':
      return <group>
        <mesh position={[0, 0.14, 0]} castShadow receiveShadow><cylinderGeometry args={[0.22, 0.26, 0.28, 16]} />{shell('#e2e8f0', 0.4, 0.45)}</mesh>
        <mesh position={[0, 0.36, 0]} castShadow><cylinderGeometry args={[0.14, 0.2, 0.2, 16]} />{shell(color, 0.45, 0.35)}</mesh>
        <mesh position={[0.02, 0.56, 0]} rotation={[0, 0, -0.42]} castShadow><boxGeometry args={[0.09, 0.34, 0.1]} />{shell('#cbd5e1', 0.7, 0.3)}</mesh>
        <mesh position={[0, 0.7, 0]}><sphereGeometry args={[0.03, 10, 8]} />{led}</mesh>
      </group>;
    case 'radio':
      return <group>
        <mesh position={[0, 0.13, 0]} castShadow receiveShadow><cylinderGeometry args={[0.17, 0.17, 0.1, 20]} />{shell('#f8fafc', 0.2, 0.5)}</mesh>
        <mesh position={[0, 0.36, 0]} castShadow><cylinderGeometry args={[0.045, 0.045, 0.46, 10]} />{shell('#94a3b8', 0.7, 0.3)}</mesh>
        <mesh position={[0, 0.61, 0]}><sphereGeometry args={[0.05, 12, 10]} />{led}</mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.42, 0]}><torusGeometry args={[0.28, 0.012, 6, 40]} /><meshBasicMaterial color={color} transparent opacity={online ? 0.5 : 0.16} /></mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.42, 0]}><torusGeometry args={[0.4, 0.008, 6, 40]} /><meshBasicMaterial color={color} transparent opacity={online ? 0.26 : 0.09} /></mesh>
      </group>;
    case 'controller':
      return <group>
        <mesh position={[0, 0.2, 0]} castShadow receiveShadow><boxGeometry args={[0.6, 0.4, 0.44]} />{shell('#eef2f7', 0.3, 0.55)}</mesh>
        <mesh position={[0, 0.2, 0.225]}><boxGeometry args={[0.5, 0.3, 0.01]} />{shell('#dbe4ec', 0.3, 0.6)}</mesh>
        {[-0.14, 0, 0.14].map((x, index) => <mesh key={x} position={[x, 0.14, 0.235]}><sphereGeometry args={[0.024, 10, 8]} />{index === 0 ? led : <meshBasicMaterial color="#cbd5e1" />}</mesh>)}
        <mesh position={[0, 0.43, 0]}><boxGeometry args={[0.62, 0.03, 0.46]} />{shell(color, 0.4, 0.4)}</mesh>
      </group>;
    case 'gateway':
      return <group>
        <mesh position={[0, 0.1, 0]} castShadow receiveShadow><boxGeometry args={[0.5, 0.06, 0.5]} />{shell('#e2e8f0', 0.5, 0.4)}</mesh>
        <mesh position={[0, 0.28, 0]} castShadow><cylinderGeometry args={[0.16, 0.2, 0.3, 8]} />{shell(color, 0.55, 0.35)}</mesh>
        <mesh position={[0, 0.47, 0]} castShadow><octahedronGeometry args={[0.16, 0]} />{shell('#f1f5f9', 0.3, 0.35)}</mesh>
        <mesh position={[0, 0.62, 0]}><sphereGeometry args={[0.032, 12, 10]} />{led}</mesh>
      </group>;
    case 'cloud':
      return <group>
        {([[-0.15, 0.34, 0.17], [0.06, 0.42, 0.22], [0.23, 0.32, 0.15]] as [number, number, number][]).map(([x, y, r]) => <mesh key={x} position={[x, y, 0]} castShadow><sphereGeometry args={[r, 16, 12]} />{shell('#f8fbff', 0.1, 0.5)}</mesh>)}
        <mesh position={[0, 0.16, 0]}><boxGeometry args={[0.52, 0.04, 0.3]} />{shell(color, 0.3, 0.4)}</mesh>
        <mesh position={[0, 0.5, 0.18]}><sphereGeometry args={[0.026, 10, 8]} />{led}</mesh>
      </group>;
    case 'power':
      return <group>
        <mesh position={[0, 0.2, 0]} castShadow receiveShadow><boxGeometry args={[0.48, 0.4, 0.34]} />{shell('#eef2f7', 0.25, 0.5)}</mesh>
        {[-0.12, 0, 0.12].map((x) => <mesh key={x} position={[x, 0.2, 0.176]}><boxGeometry args={[0.07, 0.26, 0.01]} />{shell('#cbd5e1', 0.4, 0.4)}</mesh>)}
        <mesh position={[0, 0.42, 0]}><boxGeometry args={[0.3, 0.02, 0.2]} />{led}</mesh>
        <mesh position={[0, 0.46, 0]}><boxGeometry args={[0.08, 0.08, 0.08]} />{shell(color, 0.6, 0.3)}</mesh>
      </group>;
    case 'rfid':
      return <group>
        <mesh position={[0, 0.26, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><torusGeometry args={[0.24, 0.045, 10, 26]} />{shell(color, 0.5, 0.35)}</mesh>
        <mesh position={[0, 0.26, 0]}><boxGeometry args={[0.3, 0.3, 0.06]} />{shell('#f8fafc', 0.2, 0.55)}</mesh>
        <mesh position={[0.1, 0.36, 0.04]}><sphereGeometry args={[0.024, 10, 8]} />{led}</mesh>
        <mesh position={[0, 0.06, 0]}><cylinderGeometry args={[0.16, 0.18, 0.05, 20]} />{shell('#e2e8f0', 0.3, 0.5)}</mesh>
      </group>;
    case 'terminal':
      return <group>
        <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[0.56, 0.36, 0.07]} />{shell('#e6ecf3', 0.35, 0.45)}</mesh>
        <mesh position={[0, 0.3, 0.04]}><planeGeometry args={[0.46, 0.27]} /><meshBasicMaterial color={online ? '#0f2b26' : '#20303a'} /></mesh>
        <mesh position={[0, 0.3, 0.041]}><planeGeometry args={[0.4, 0.2]} /><meshBasicMaterial color={online ? color : '#334155'} transparent opacity={0.32} /></mesh>
        <mesh position={[0, 0.09, 0]}><boxGeometry args={[0.1, 0.16, 0.1]} />{shell('#cbd5e1', 0.5, 0.4)}</mesh>
        <mesh position={[0, 0.01, 0]}><boxGeometry args={[0.3, 0.02, 0.2]} />{shell('#e2e8f0', 0.4, 0.5)}</mesh>
      </group>;
    case 'router':
      return <group>
        <mesh position={[0, 0.09, 0]} castShadow receiveShadow><boxGeometry args={[0.5, 0.16, 0.36]} />{shell('#eef2f7', 0.3, 0.5)}</mesh>
        <mesh position={[0, 0.18, 0]}><boxGeometry args={[0.5, 0.02, 0.36]} />{shell(color, 0.4, 0.4)}</mesh>
        {[-0.16, 0.16].map((x) => <mesh key={x} position={[x, 0.4, 0]} rotation={[0, 0, -0.16]} castShadow><cylinderGeometry args={[0.014, 0.014, 0.42, 6]} />{shell('#94a3b8', 0.6, 0.35)}</mesh>)}
        {[-0.14, -0.02, 0.1].map((x) => <mesh key={'l' + x} position={[x, 0.1, 0.185]}><sphereGeometry args={[0.016, 8, 6]} />{led}</mesh>)}
      </group>;
  }
}

function DeviceNode({ item, selected, accent, onSelect }: { item: SceneDevice; selected: boolean; accent: string; onSelect: () => void }) {
  const status = deviceStatus(item);
  const tint = status === '故障' ? '#dc2626' : selected ? '#f59e0b' : accent;
  const parameter = Object.entries(item.state?.parameters ?? {}).slice(0, 1).map(([key, value]) => key + ':' + String(value)).join('');
  const reading = Number.isFinite(item.state?.reading) ? String(item.state?.reading) : '';
  const issue = (item.state?.faults ?? item.definition.faults)[0];
  const label = item.definition.label + ' · ' + status + (reading ? ' · ' + reading : '') + (parameter ? ' · ' + parameter : '') + (issue ? ' · ' + issue : '');
  return <group position={item.position} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    <DeviceShape kind={item.definition.kind} color={tint} online={status === '在线'} />
    <SceneLabel text={label} color={tint} />
    {selected && <>
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.44, 0.48, 40]} /><meshBasicMaterial color="#f59e0b" transparent opacity={0.9} /></mesh>
      <mesh position={[0, 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.44, 40]} /><meshBasicMaterial color="#f59e0b" transparent opacity={0.12} /></mesh>
    </>}
    <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.3, 24]} /><meshBasicMaterial color="#123a33" transparent opacity={0.1} /></mesh>
  </group>;
}

function LinkLine({ link, from, to }: { link: Link; from: SceneDevice; to: SceneDevice }) {
  const a = new THREE.Vector3(from.position[0], from.position[1] + 0.2, from.position[2]);
  const b = new THREE.Vector3(to.position[0], to.position[1] + 0.2, to.position[2]);
  const direction = b.clone().sub(a);
  if (direction.lengthSq() < 0.0001) return null;
  const center = a.clone().add(b).multiplyScalar(0.5);
  const radius = 0.014 + link.quality * 0.014;
  const healthy = (from.state?.installed ?? from.definition.installed) && (to.state?.installed ?? to.definition.installed);
  return <mesh position={center} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())}>
    <cylinderGeometry args={[radius, radius, direction.length(), 8]} />
    <meshStandardMaterial color={healthy ? linkColors[link.kind] : '#94a3b8'} transparent opacity={healthy ? 0.6 + link.quality * 0.35 : 0.24} roughness={0.35} metalness={0.15} />
  </mesh>;
}

function AssetRefresher() {
  const revision = useTextureRevision();
  const { invalidate } = useThree();
  useEffect(() => { if (revision) invalidate(); }, [revision, invalidate]);
  return null;
}

function Lighting({ mood }: { mood: (typeof sceneMoods)[SceneName] }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const environment = generator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.22;
    return () => { scene.environment = null; environment.dispose(); generator.dispose(); };
  }, [gl, scene]);
  return <>
    <hemisphereLight args={[mood.sky, '#aeb9be', 0.42]} />
    <ambientLight intensity={0.08} color={mood.fill} />
    <directionalLight
      position={[-14, 22, 12]}
      intensity={2.35}
      color={mood.sun}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-64}
      shadow-camera-right={64}
      shadow-camera-top={64}
      shadow-camera-bottom={-64}
      shadow-camera-near={1}
      shadow-camera-far={160}
      shadow-bias={-0.0006}
      shadow-normalBias={0.03}
    />
    <directionalLight position={[12, 8, -9]} intensity={0.28} color={mood.fill} />
  </>;
}

/**
 * 轨道相机：自己算球坐标，位置永远从 target 反推，朝向永远 lookAt(target)。
 * 不用 OrbitControls 是因为它内部的 quaternion 补偿会和 lookAt 叠加出滚转，导致地平线歪斜。
 */
function SceneControls({ devices, dimension, resetToken, expose }: { devices: SceneDevice[]; dimension: PublicLevel['dimension']; resetToken: number; expose: (controller: ViewController) => void }) {
  const { camera, gl, invalidate } = useThree();
  const state = useRef({ radius: 18, theta: 0.3, phi: 1.06, target: new THREE.Vector3(0, 0.45, 0), min: 4, max: 62 });

  const apply = useCallback(() => {
    const { radius, theta, phi, target } = state.current;
    const sinPhi = Math.sin(phi);
    camera.up.set(0, 1, 0);
    camera.position.set(
      target.x + radius * sinPhi * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * sinPhi * Math.cos(theta),
    );
    camera.lookAt(target);
    camera.updateMatrixWorld();
    invalidate();
  }, [camera, invalidate]);

  const fit = useCallback(() => {
    if (!devices.length) return;
    const xs = devices.map((item) => item.position[0]), zs = devices.map((item) => item.position[2]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ, 6);
    state.current.target.set(cx, 0.7, cz);
    state.current.radius = span * (dimension === '3d' ? 1.6 : 1.75) + 7;
    state.current.theta = 0.2;
    state.current.phi = dimension === '3d' ? 1.2 : 1.06;
    apply();
  }, [apply, devices, dimension]);

  useEffect(() => { expose({ reset: fit }); fit(); }, [expose, fit]);
  useEffect(() => { if (resetToken) fit(); }, [resetToken, fit]);

  useEffect(() => {
    const element = gl.domElement;
    let dragging: { x: number; y: number; button: number } | null = null;
    const onDown = (event: PointerEvent) => {
      dragging = { x: event.clientX, y: event.clientY, button: event.button };
      element.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - dragging.x;
      const dy = event.clientY - dragging.y;
      dragging.x = event.clientX; dragging.y = event.clientY;
      if (dragging.button === 0 && dimension === '3d') {
        state.current.theta -= dx * 0.006;
        state.current.phi = Math.min(Math.PI * 0.485, Math.max(0.16, state.current.phi - dy * 0.005));
      } else {
        const lift = state.current.radius * 0.0013;
        state.current.target.x -= dx * lift * Math.cos(state.current.theta);
        state.current.target.z += dx * lift * Math.sin(state.current.theta);
        state.current.target.z -= dy * lift * Math.cos(state.current.theta);
      }
      apply();
    };
    const onUp = (event: PointerEvent) => { dragging = null; if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId); };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      state.current.radius = Math.min(state.current.max, Math.max(state.current.min, state.current.radius * (event.deltaY > 0 ? 1.08 : 0.93)));
      apply();
    };
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('wheel', onWheel);
    };
  }, [apply, dimension, gl]);

  return null;
}

function SceneWorld({ items, links, level, palette, selected, lowFx, resetToken, expose, onSelect }: {
  items: SceneDevice[]; links: Link[]; level: PublicLevel; palette: Palette; selected: string; lowFx: boolean; resetToken: number;
  expose: (controller: ViewController) => void; onSelect: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(items.map((item) => [item.definition.id, item])), [items]);
  const mood = sceneMoods[(level.scene as SceneName)] ?? sceneMoods.city;
  return <>
    <color attach="background" args={[mood.sky]} />
    <fog attach="fog" args={[mood.sky, mood.fog[0], mood.fog[1]]} />
    <Lighting mood={mood} />
    <SceneKit scene={(level.scene as SceneName)} paletteAccent={palette.accent} />
    {links.map((link, i) => { const from = byId.get(link.from), to = byId.get(link.to); return from && to ? <LinkLine key={link.from + link.to + i} link={link} from={from} to={to} /> : null; })}
    {items.map((item) => <DeviceNode key={item.definition.id} item={item} selected={selected === item.definition.id} accent={palette.accent} onSelect={() => onSelect(item.definition.id)} />)}
    <SceneControls devices={items} dimension={level.dimension} resetToken={resetToken} expose={expose} />
  </>;
}

/* --------------------------- 2D 回退视图 --------------------------- */

function SceneMap({ items, links, level, palette, selected, onSelect, webglFallback = false }: {
  items: SceneDevice[]; links: Link[]; level: PublicLevel; palette: Palette; selected: string; onSelect: (id: string) => void; webglFallback?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const cols = items.length <= 3 ? Math.max(1, items.length) : Math.ceil(Math.sqrt(items.length * 1.45));
  const rows = Math.max(1, Math.ceil(items.length / cols));
  const boardWidth = Math.max(viewport.width, cols * 160, 520);
  const boardHeight = Math.max(viewport.height, rows * 98, 380);
  const layout = useMemo(() => {
    const xs = items.map((item) => item.position[0]), zs = items.map((item) => item.position[2]);
    const minX = Math.min(0, ...xs), maxX = Math.max(0, ...xs), minZ = Math.min(0, ...zs), maxZ = Math.max(0, ...zs);
    const spanX = Math.max(1, maxX - minX), spanZ = Math.max(1, maxZ - minZ);
    const slots = Array.from({ length: items.length }, (_, i) => ({ col: i % cols, row: Math.floor(i / cols), used: false }));
    const ordered = [...items].sort((a, b) => a.position[2] - b.position[2] || a.position[0] - b.position[0]);
    const placed = new Map<string, { x: number; y: number }>();
    for (const item of ordered) {
      const wantedCol = Math.max(0, Math.min(cols - 1, Math.round(((item.position[0] - minX) / spanX) * (cols - 1))));
      const wantedRow = Math.max(0, Math.min(rows - 1, Math.round(((item.position[2] - minZ) / spanZ) * (rows - 1))));
      const available = slots.filter((slot) => !slot.used).sort((a, b) => (Math.abs(a.col - wantedCol) + Math.abs(a.row - wantedRow)) - (Math.abs(b.col - wantedCol) + Math.abs(b.row - wantedRow)))[0];
      if (!available) continue;
      available.used = true;
      placed.set(item.definition.id, { x: ((available.col + 0.5) / cols) * 100, y: ((available.row + 0.5) / rows) * 100 });
    }
    return placed;
  }, [cols, items, rows]);
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => { const rect = entries[0]?.contentRect; if (rect) setViewport({ width: rect.width, height: rect.height }); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const resetView = useCallback(() => {
    if (!viewport.width || !viewport.height) return;
    const scale = Math.min(1, viewport.width / boardWidth, viewport.height / boardHeight);
    setTransform({ scale, x: (viewport.width - boardWidth * scale) / 2, y: (viewport.height - boardHeight * scale) / 2 });
  }, [boardHeight, boardWidth, viewport.height, viewport.width]);
  useEffect(() => { resetView(); }, [resetView]);
  const zoom = (factor: number) => setTransform((current) => {
    const scale = Math.max(0.45, Math.min(2.5, current.scale * factor));
    const cx = viewport.width / 2, cy = viewport.height / 2, ratio = scale / current.scale;
    return { scale, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
  });
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: transform.x, startY: transform.y };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current && current.id === event.pointerId) setTransform((value) => ({ ...value, x: current.startX + event.clientX - current.x, y: current.startY + event.clientY - current.y }));
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (drag.current?.id === event.pointerId) drag.current = null; };
  const css = { '--scene-sky': palette.sky, '--scene-ground': palette.ground, '--scene-accent': palette.accent, '--scene-surface': palette.surface } as CSSProperties;
  return <div className={'world-canvas world-2d scene-' + level.scene + (webglFallback ? ' webgl-fallback' : '')} style={css} ref={viewportRef} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={(event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.08 : 0.92); }}>
    <div className="scene-map-board" style={{ width: boardWidth, height: boardHeight, transform: 'translate(' + transform.x + 'px,' + transform.y + 'px) scale(' + transform.scale + ')' }}>
      <div className="scene-map-horizon" /><div className="scene-map-grid" /><div className="scene-map-backdrop" aria-hidden="true" />
      <svg className="scene-map-links" viewBox={'0 0 ' + boardWidth + ' ' + boardHeight} preserveAspectRatio="none" aria-hidden="true">
        {links.map((link, i) => {
          const a = layout.get(link.from), b = layout.get(link.to);
          if (!a || !b) return null;
          const from = items.find((item) => item.definition.id === link.from), to = items.find((item) => item.definition.id === link.to);
          const active = (from?.state?.installed ?? from?.definition.installed) && (to?.state?.installed ?? to?.definition.installed);
          return <line key={link.from + link.to + i} x1={a.x * boardWidth / 100} y1={a.y * boardHeight / 100} x2={b.x * boardWidth / 100} y2={b.y * boardHeight / 100} className={'scene-map-link kind-' + link.kind + (active ? '' : ' inactive')} style={{ '--link-color': linkColors[link.kind], '--link-opacity': 0.35 + link.quality * 0.6 } as CSSProperties} />;
        })}
      </svg>
      {items.map((item) => {
        const point = layout.get(item.definition.id);
        if (!point) return null;
        const status = deviceStatus(item), reading = Number.isFinite(item.state?.reading) ? item.state?.reading : null;
        const parameter = Object.entries(item.state?.parameters ?? {}).slice(0, 1).map(([key, value]) => key + ' ' + String(value)).join(' · ');
        const statusClass = status === '在线' ? 'online' : status === '故障' ? 'fault' : 'offline';
        return <button key={item.definition.id} className={'scene-map-device kind-' + item.definition.kind + ' status-' + statusClass + (selected === item.definition.id ? ' selected' : '')} style={{ left: point.x + '%', top: point.y + '%', '--device-accent': statusHex(item) } as CSSProperties} onClick={(event) => { event.stopPropagation(); onSelect(item.definition.id); }} aria-label={item.definition.label + '，' + status + (item.state?.faults.length ? '，' + item.state.faults.join('、') : '')} title={item.definition.label + ' · ' + item.definition.model + (parameter ? ' · ' + parameter : '')}>
          <span className="scene-map-icon" aria-hidden="true"><i>{item.definition.kind.slice(0, 1).toUpperCase()}</i><em /></span>
          <span className="scene-map-copy"><b>{item.definition.label}</b><small>{kindLabels[item.definition.kind]} · {status}</small>{reading !== null && <small className="scene-map-reading">读数 {reading}{parameter ? ' · ' + parameter : ''}</small>}{Boolean(item.state?.faults.length) && <small className="scene-map-fault">{item.state?.faults[0]}</small>}</span>
        </button>;
      })}
    </div>
    <div className="scene-map-toolbar" aria-label="地图视角控制">
      <button type="button" onClick={() => zoom(1.15)} aria-label="放大场景" title="放大"><ZoomIn size={14} /></button>
      <button type="button" onClick={() => zoom(0.87)} aria-label="缩小场景" title="缩小"><ZoomOut size={14} /></button>
      <button type="button" onClick={resetView} aria-label="恢复场景视角" title="恢复视角"><RotateCcw size={14} /></button>
    </div>
    <div className="scene-meta"><span className="scene-pip" />{level.scene.toUpperCase()} / {webglFallback ? '2D FALLBACK' : '2D FIELD VIEW'}<span className="scene-hint">拖动平移 · 滚轮缩放</span></div>
  </div>;
}

/* --------------------------- 入口 --------------------------- */

export default function WorldScene({ level, state, links, onSelect, selected, lowFx = false }: {
  level: PublicLevel; state: Record<string, DeviceState>; links?: Link[]; onSelect: (id: string) => void; selected: string; lowFx?: boolean;
}) {
  const palette = paletteOf(level.scene);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden);
  const [webglFailed, setWebglFailed] = useState(false);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const controller = useRef<ViewController | null>(null);
  const items = useMemo(() => level.devices.map((definition) => {
    const live = state[definition.id];
    return { definition, state: live, position: live?.position ?? definition.position };
  }), [level.devices, state]);
  const activeLinks = links ?? level.links;
  const isMap = level.dimension === '2d' || webglFailed;
  const expose = useCallback((value: ViewController) => { controller.current = value; }, []);
  const reset3d = () => { controller.current?.reset(); };
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!canvasElement) return;
    const lost = (event: Event) => { event.preventDefault(); setWebglFailed(true); setCanvasElement(null); };
    const restored = () => setWebglFailed(false);
    canvasElement.addEventListener('webglcontextlost', lost, false);
    canvasElement.addEventListener('webglcontextrestored', restored, false);
    return () => { canvasElement.removeEventListener('webglcontextlost', lost, false); canvasElement.removeEventListener('webglcontextrestored', restored, false); };
  }, [canvasElement]);
  if (isMap) return <SceneMap items={items} links={activeLinks} level={level} palette={palette} selected={selected} onSelect={onSelect} webglFallback={webglFailed} />;
  return <div className="world-canvas world-3d">
    <Canvas shadows={!lowFx && !reducedMotion} dpr={lowFx ? [1, 1] : [1, 1.5]} frameloop={hidden ? 'never' : 'demand'} camera={{ position: [0, 9, 13], fov: 46 }} fallback={<SceneMap items={items} links={activeLinks} level={level} palette={palette} selected={selected} onSelect={onSelect} webglFallback />} onCreated={({ gl }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 1.0;
      gl.outputColorSpace = THREE.SRGBColorSpace;
      setCanvasElement(gl.domElement);
    }}>
      <AssetRefresher />
      <SceneWorld items={items} links={activeLinks} level={level} palette={palette} selected={selected} lowFx={lowFx} resetToken={resetToken} expose={expose} onSelect={onSelect} />
    </Canvas>
    <div className="scene-meta"><span className="scene-pip" />{level.scene.toUpperCase()} / SECTOR {String(level.chapter).padStart(2, '0')} · {level.dimension.toUpperCase()}<span className="scene-hint">拖动旋转 · 右键平移 · 滚轮缩放</span></div>
    <div className="scene-map-toolbar scene-3d-toolbar" aria-label="场景视角控制"><button type="button" onClick={reset3d} aria-label="恢复场景视角" title="恢复视角"><RotateCcw size={14} /></button></div>
  </div>;
}
