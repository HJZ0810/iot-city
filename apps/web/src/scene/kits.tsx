/**
 * 场景布景（手工搭建）
 * ------------------------------------------------------------------
 * 每个 scene 一套独立的实体组合：地面材质、墙体、特征道具、灯光基调。
 * 不用随机生成——每一件东西的位置、尺寸、材质都是写死的，
 * 目的是让学生一进现场就能认出“这是车间 / 机房 / 大棚 / 路口”。
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { surface, useTextureRevision, type SurfaceName } from './textures';

export type SceneName = 'city' | 'lab' | 'greenhouse' | 'home' | 'factory' | 'datacenter' | 'traffic' | 'power' | 'network' | 'crisis';

/** 每个场景的基调：天空、雾、太阳色、地面主材、墙色。 */
export const sceneMoods: Record<SceneName, { sky: string; fog: [number, number]; sun: string; fill: string; accent: string; ground: SurfaceName }> = {
  city: { sky: '#eaf2fb', fog: [106, 210], sun: '#fff6e6', fill: '#dfeaf7', accent: '#0f9b7d', ground: 'paving' },
  lab: { sky: '#f2f7fb', fog: [100, 190], sun: '#ffffff', fill: '#e6eef7', accent: '#2563eb', ground: 'tiles' },
  greenhouse: { sky: '#eef8f2', fog: [104, 200], sun: '#fdf7df', fill: '#e2f2e8', accent: '#16a34a', ground: 'paving' },
  home: { sky: '#fbf6f0', fog: [96, 180], sun: '#fff1dc', fill: '#f3e9dd', accent: '#0f9b7d', ground: 'wood' },
  factory: { sky: '#eef1f5', fog: [104, 205], sun: '#fff8ea', fill: '#e3e8ef', accent: '#ea580c', ground: 'concrete' },
  datacenter: { sky: '#eef3fa', fog: [100, 195], sun: '#f4f8ff', fill: '#dfe8f4', accent: '#2563eb', ground: 'tiles' },
  traffic: { sky: '#e9f0f7', fog: [108, 215], sun: '#fff6e8', fill: '#e2eaf3', accent: '#f59e0b', ground: 'asphalt' },
  power: { sky: '#edf3f7', fog: [106, 208], sun: '#fff7e8', fill: '#e0e8ef', accent: '#0f9b7d', ground: 'concrete' },
  network: { sky: '#eef3fb', fog: [102, 198], sun: '#f6f9ff', fill: '#e0e9f5', accent: '#2563eb', ground: 'tiles' },
  crisis: { sky: '#f7eeee', fog: [100, 190], sun: '#ffeede', fill: '#f0e2e0', accent: '#dc2626', ground: 'concrete' },
};

/** 材质通道：贴图按 repeat×scale 平铺，避免被拉长。 */
export function useSurface(name: SurfaceName, density = 4) {
  const revision = useTextureRevision();
  // 密度档变化或贴图到位才重建，避免每帧生成新对象
  return useMemo(() => surface(name, density), [name, density, revision]);
}

type Vec3 = [number, number, number];

/** 地面：一块真实材质的地坪，带轻微接缝感（第二层细网格线不是主视觉）。 */
export function Ground({ name, size = 170, y = 0, tint = '#ffffff', scale = 1 }: { name: SurfaceName; size?: number; y?: number; tint?: string; scale?: number }) {
  // 地坪按米数折算平铺次数：1 格≈1.4m，远处不会糊成一片
  const tex = useSurface(name, Math.min(10, Math.max(1, 4 * scale)));
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
    <planeGeometry args={[size, size]} />
    <meshStandardMaterial {...tex} color={tint} roughness={0.94} metalness={0.02} />
  </mesh>;
}

/** 沥青路面：带贴图的铺装，比纯色块耐看得多 */
export function RoadSurface({ width, depth, position, tint = '#dfe7ee' }: { width: number; depth: number; position: Vec3; tint?: string }) {
  const tex = useSurface('concrete', 6);
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={position} receiveShadow>
    <planeGeometry args={[width, depth]} />
    <meshStandardMaterial {...tex} color={tint} roughness={0.95} metalness={0.02} />
  </mesh>;
}

/** 作业区台面：设备站在一块浅色混凝土平台上，构图才有主次。 */
export function Pad({ size = [15, 11], y = 0.03, tint = '#e9edf1' }: { size?: [number, number]; y?: number; tint?: string }) {
  const tex = useSurface('concrete', 2.2);
  const [w, d] = size;
  return <group>
    <mesh position={[0, y, 0]} receiveShadow><boxGeometry args={[w, 0.06, d]} /><meshStandardMaterial {...tex} color={tint} roughness={0.9} metalness={0.03} /></mesh>
    <mesh position={[0, y - 0.02, 0]}><boxGeometry args={[w + 0.22, 0.05, d + 0.22]} /><meshStandardMaterial color="#c9d3dc" roughness={0.85} /></mesh>
  </group>;
}

/** 通用实体块：墙、台面、机箱都用它，保证材质一致。 */
export function Slab({ size, position, surfaceName = 'concrete', tint = '#ffffff', roughness = 0.9, metalness = 0.05, scale = 1, rotation }: {
  size: Vec3; position: Vec3; surfaceName?: SurfaceName; tint?: string; roughness?: number; metalness?: number; scale?: number; rotation?: Vec3;
}) {
  const tex = useSurface(surfaceName, scale);
  return <mesh position={position} rotation={rotation} castShadow receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial {...tex} color={tint} roughness={roughness} metalness={metalness} />
  </mesh>;
}

/** 后墙 + 侧墙：室内场景的“房间感”，墙脚有一道深色踢脚线。 */
function Room({ width = 26, depth = 18, height = 4.4, wall = 'tiles', tint = '#f7fbfd', side = true }: {
  width?: number; depth?: number; height?: number; wall?: SurfaceName; tint?: string; side?: boolean;
}) {
  const tex = useSurface(wall, 0.35);
  const wallMat = <meshStandardMaterial {...tex} color={tint} roughness={0.82} metalness={0.03} />;
  return <group>
    <mesh position={[0, height / 2, -depth / 2]} receiveShadow><planeGeometry args={[width, height]} />{wallMat}</mesh>
    <mesh position={[0, height - 0.06, -depth / 2 + 0.02]}><boxGeometry args={[width, 0.12, 0.06]} /><meshStandardMaterial color="#cfdae3" roughness={0.7} /></mesh>
    <mesh position={[0, 0.09, -depth / 2 + 0.01]}><boxGeometry args={[width, 0.18, 0.05]} /><meshStandardMaterial color="#b9c7d2" roughness={0.75} /></mesh>
    {side && <mesh position={[-width / 2, height / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow><planeGeometry args={[depth, height]} />{wallMat}</mesh>}
  </group>;
}

/** 机柜：深灰柜体 + 面板缝隙 + 顶部指示灯，是机房与网络场景的主角。 */
function Rack({ position, rotation = 0, tint = '#e9eef5', height = 2.1, led = '#2f6fed' }: { position: Vec3; rotation?: number; tint?: string; height?: number; led?: string }) {
  return <group position={position} rotation={[0, rotation, 0]}>
    <mesh position={[0, height / 2, 0]} castShadow receiveShadow><boxGeometry args={[0.86, height, 0.8]} /><meshStandardMaterial color={tint} roughness={0.42} metalness={0.62} /></mesh>
    {Array.from({ length: 7 }, (_, i) => <mesh key={i} position={[0, 0.28 + i * 0.26, 0.41]}><boxGeometry args={[0.74, 0.19, 0.02]} /><meshStandardMaterial color="#c9d4e0" roughness={0.55} metalness={0.4} /></mesh>)}
    {Array.from({ length: 7 }, (_, i) => <mesh key={'l' + i} position={[0.28, 0.34 + i * 0.26, 0.425]}><boxGeometry args={[0.05, 0.02, 0.01]} /><meshBasicMaterial color={i % 3 === 0 ? '#22c55e' : led} /></mesh>)}
    <mesh position={[0, height + 0.03, 0]}><boxGeometry args={[0.9, 0.06, 0.84]} /><meshStandardMaterial color="#dbe3ec" roughness={0.5} metalness={0.5} /></mesh>
  </group>;
}

/** 工作台：木台面 + 金属腿，实验室与家庭都用。 */
function Bench({ position, rotation = 0, width = 2.4, tint = '#ffffff' }: { position: Vec3; rotation?: number; width?: number; tint?: string }) {
  const wood = useSurface('wood', 0.5);
  return <group position={position} rotation={[0, rotation, 0]}>
    <mesh position={[0, 0.74, 0]} castShadow receiveShadow><boxGeometry args={[width, 0.07, 0.78]} /><meshStandardMaterial {...wood} color={tint} roughness={0.55} metalness={0.02} /></mesh>
    {[-width / 2 + 0.12, width / 2 - 0.12].flatMap((x) => [-0.3, 0.3].map((z) => <mesh key={x + ':' + z} position={[x, 0.36, z]}><boxGeometry args={[0.06, 0.72, 0.06]} /><meshStandardMaterial color="#9aa8b4" roughness={0.35} metalness={0.8} /></mesh>))}
    <mesh position={[0, 0.2, 0]}><boxGeometry args={[width - 0.3, 0.04, 0.6]} /><meshStandardMaterial color="#c6d1dc" roughness={0.6} metalness={0.3} /></mesh>
  </group>;
}

/** 绿植：陶盆 + 三层球叶，用来柔化工业场景。 */
function Plant({ position, scale = 1, hue = '#3f9a5f' }: { position: Vec3; scale?: number; hue?: string }) {
  return <group position={position} scale={scale}>
    <mesh position={[0, 0.16, 0]} castShadow><cylinderGeometry args={[0.17, 0.13, 0.32, 12]} /><meshStandardMaterial color="#d8c9b8" roughness={0.85} /></mesh>
    <mesh position={[0, 0.44, 0]} castShadow><sphereGeometry args={[0.24, 12, 10]} /><meshStandardMaterial color={hue} roughness={0.8} /></mesh>
    <mesh position={[0.12, 0.62, 0.04]} castShadow><sphereGeometry args={[0.16, 10, 8]} /><meshStandardMaterial color={hue} roughness={0.8} /></mesh>
    <mesh position={[-0.11, 0.58, -0.05]} castShadow><sphereGeometry args={[0.14, 10, 8]} /><meshStandardMaterial color="#4aa96c" roughness={0.8} /></mesh>
  </group>;
}

/** 护栏：厂区安全栏杆，黄色立柱 + 两道横杆。 */
function Guardrail({ position, rotation = 0, length = 6 }: { position: Vec3; rotation?: number; length?: number }) {
  const posts = Math.max(2, Math.round(length / 1.5));
  return <group position={position} rotation={[0, rotation, 0]}>
    {Array.from({ length: posts }, (_, i) => <mesh key={i} position={[-length / 2 + (i * length) / (posts - 1), 0.5, 0]} castShadow><cylinderGeometry args={[0.045, 0.045, 1, 8]} /><meshStandardMaterial color="#e8b53a" roughness={0.5} metalness={0.3} /></mesh>)}
    {[0.98, 0.55].map((y) => <mesh key={y} position={[0, y, 0]}><boxGeometry args={[length, 0.05, 0.05]} /><meshStandardMaterial color="#f2c94c" roughness={0.45} metalness={0.35} /></mesh>)}
  </group>;
}

/** 管道：沿墙走的工艺管线，带法兰。 */
function Pipe({ from, to, radius = 0.075, color = '#9fb0bd' }: { from: Vec3; to: Vec3; radius?: number; color?: string }) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    return {
      position: a.clone().add(b).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()),
      length: direction.length(),
    };
  }, [from, to]);
  return <mesh position={position} quaternion={quaternion} castShadow>
    <cylinderGeometry args={[radius, radius, length, 12]} />
    <meshStandardMaterial color={color} roughness={0.32} metalness={0.78} />
  </mesh>;
}

/** 设备机箱：车间里的机床主体，带控制面板与散热格栅。 */
function Machine({ position, rotation = 0, size = [1.7, 1.25, 1.3], tint = '#dfe6ee', accent = '#0f9b7d' }: {
  position: Vec3; rotation?: number; size?: Vec3; tint?: string; accent?: string;
}) {
  return <group position={position} rotation={[0, rotation, 0]}>
    <mesh position={[0, size[1] / 2, 0]} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={tint} roughness={0.55} metalness={0.42} /></mesh>
    <mesh position={[0, size[1] * 0.62, size[2] / 2 + 0.01]}><boxGeometry args={[size[0] * 0.42, size[1] * 0.26, 0.04]} /><meshStandardMaterial color="#25333d" roughness={0.4} metalness={0.3} /></mesh>
    <mesh position={[size[0] * 0.12, size[1] * 0.62, size[2] / 2 + 0.03]}><boxGeometry args={[0.08, 0.08, 0.02]} /><meshBasicMaterial color={accent} /></mesh>
    {Array.from({ length: 4 }, (_, i) => <mesh key={i} position={[0, size[1] * 0.2 + i * 0.08, size[2] / 2 + 0.01]}><boxGeometry args={[size[0] * 0.6, 0.03, 0.02]} /><meshStandardMaterial color="#9fadba" roughness={0.5} /></mesh>)}
    <mesh position={[0, size[1] + 0.06, 0]}><boxGeometry args={[size[0] * 0.7, 0.06, size[2] * 0.7]} /><meshStandardMaterial color="#aab8c4" roughness={0.4} metalness={0.6} /></mesh>
  </group>;
}

/** 托盘与货箱：仓储感，堆在角落不抢主体。 */
function Pallets({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  const wood = useSurface('wood', 0.8);
  return <group position={position} rotation={[0, rotation, 0]}>
    {[0, 1].map((layer) => <group key={layer} position={[0, layer * 0.42, 0]}>
      <mesh position={[0, 0.08, 0]} castShadow receiveShadow><boxGeometry args={[1.15, 0.12, 0.95]} /><meshStandardMaterial {...wood} color="#d9c4a6" roughness={0.85} /></mesh>
      <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[0.92, 0.34, 0.76]} /><meshStandardMaterial color={layer ? '#d8e3ec' : '#e8eef4'} roughness={0.7} metalness={0.15} /></mesh>
    </group>)}
  </group>;
}

/** 路灯：城市/路口用，灯头略微发光，但不刺眼。 */
function StreetLight({ position, rotation = 0, color = '#f8d9a0' }: { position: Vec3; rotation?: number; color?: string }) {
  return <group position={position} rotation={[0, rotation, 0]}>
    <mesh position={[0, 1.8, 0]} castShadow><cylinderGeometry args={[0.06, 0.09, 3.6, 10]} /><meshStandardMaterial color="#b7c3ce" roughness={0.4} metalness={0.7} /></mesh>
    <mesh position={[0.42, 3.6, 0]} rotation={[0, 0, 0.28]}><boxGeometry args={[0.95, 0.08, 0.1]} /><meshStandardMaterial color="#b7c3ce" roughness={0.4} metalness={0.7} /></mesh>
    <mesh position={[0.86, 3.5, 0]}><boxGeometry args={[0.3, 0.06, 0.18]} /><meshBasicMaterial color={color} /></mesh>
    <pointLight position={[0.86, 3.4, 0]} intensity={0.55} distance={7} color={color} />
  </group>;
}

/** 玻璃幕墙：背景建筑，半透明淡蓝，给城市一点纵深。 */
function GlassTower({ position, size = [2.2, 6, 2.2], rotation = 0 }: { position: Vec3; size?: Vec3; rotation?: number }) {
  return <group position={position} rotation={[0, rotation, 0]}>
    <mesh position={[0, size[1] / 2, 0]}>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#dbeaf6" roughness={0.14} metalness={0.22} transparent opacity={0.72} />
    </mesh>
    <mesh position={[0, size[1] / 2, 0]}>
      <boxGeometry args={[size[0] * 1.001, size[1], size[2] * 1.001]} />
      <meshBasicMaterial color="#9fc4e0" wireframe transparent opacity={0.18} />
    </mesh>
  </group>;
}

/** 种植槽：大棚里的成排作物。 */
function PlantingBed({ position, rotation = 0, length = 3.4 }: { position: Vec3; rotation?: number; length?: number }) {
  const plants = Math.round(length / 0.55);
  return <group position={position} rotation={[0, rotation, 0]}>
    <mesh position={[0, 0.16, 0]} castShadow receiveShadow><boxGeometry args={[length, 0.32, 1.05]} /><meshStandardMaterial color="#cbb79b" roughness={0.9} /></mesh>
    <mesh position={[0, 0.33, 0]} receiveShadow><boxGeometry args={[length - 0.1, 0.04, 0.95]} /><meshStandardMaterial color="#5d4b3a" roughness={1} /></mesh>
    {Array.from({ length: plants }, (_, i) => {
      const x = -length / 2 + 0.4 + i * 0.55;
      return <group key={i} position={[x, 0.34, 0]}>
        <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[0.02, 0.03, 0.24, 6]} /><meshStandardMaterial color="#5f8f45" roughness={0.9} /></mesh>
        <mesh position={[0, 0.3, 0]} castShadow><sphereGeometry args={[0.17, 10, 8]} /><meshStandardMaterial color={i % 2 ? '#63a862' : '#7ab86f'} roughness={0.85} /></mesh>
      </group>;
    })}
  </group>;
}

/** 变压器：电力场景的方形柜体，带散热片与警示条。 */
function Transformer({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  return <group position={position} rotation={[0, rotation, 0]}>
    <mesh position={[0, 0.9, 0]} castShadow receiveShadow><boxGeometry args={[1.5, 1.8, 1.1]} /><meshStandardMaterial color="#cfd9e2" roughness={0.6} metalness={0.35} /></mesh>
    {Array.from({ length: 7 }, (_, i) => <mesh key={i} position={[-0.6 + i * 0.2, 0.9, 0.57]}><boxGeometry args={[0.06, 1.5, 0.05]} /><meshStandardMaterial color="#9daebb" roughness={0.5} metalness={0.5} /></mesh>)}
    <mesh position={[0, 1.86, 0]}><boxGeometry args={[1.56, 0.1, 1.16]} /><meshStandardMaterial color="#a9b8c4" roughness={0.5} metalness={0.5} /></mesh>
    <mesh position={[0, 0.34, 0.58]}><boxGeometry args={[1.2, 0.16, 0.02]} /><meshStandardMaterial color="#f0b429" roughness={0.6} /></mesh>
  </group>;
}

/* ============================== 十个场景 ============================== */

export function SceneKit({ scene, paletteAccent }: { scene: SceneName; paletteAccent?: string }) {
  const accent = paletteAccent ?? sceneMoods[scene].accent;
  switch (scene) {
    case 'city':
      return <group>
        <Ground name="paving" size={400} scale={1.4} tint="#e7edf2" />
        
        <RoadSurface width={46} depth={6} position={[0, 0.012, 6.2]} tint="#e2e9f0" />
        {Array.from({ length: 13 }, (_, i) => <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-17 + i * 2.8, 0.02, 6.2]}><planeGeometry args={[1.5, 0.16]} /><meshBasicMaterial color="#ffffff" /></mesh>)}
        {[-11, -5.5, 0.5, 6, 11.5].map((x, i) => <GlassTower key={x} position={[x, 0, -15 - (i % 2) * 1.6]} size={[2.4 + (i % 3) * 0.5, 4.2 + (i % 4) * 0.9, 2.4]} rotation={(i % 2 ? 1 : -1) * 0.06} />)}
        {[-8.4, 8.4].map((x) => <StreetLight key={x} position={[x, 0, 5]} rotation={x > 0 ? Math.PI : 0} />)}
        {[-6.2, 6.2].map((x) => <group key={'p' + x}><mesh position={[x, 0.28, 8.6]} castShadow receiveShadow><boxGeometry args={[2.6, 0.56, 0.9]} /><meshStandardMaterial color="#e7ecef" roughness={0.9} /></mesh><Plant position={[x - 0.7, 0.56, 8.6]} scale={0.9} /><Plant position={[x + 0.7, 0.56, 8.6]} scale={0.8} hue="#4c9d63" /></group>)}
        <Plant position={[-9.6, 0, 9.6]} scale={1.2} />
        <Plant position={[9.6, 0, 9.6]} scale={1.1} hue="#3f8f57" />
      </group>;

    case 'lab':
      return <group>
        <Ground name="tiles" size={400} scale={1.2} tint="#eef4f8" />
        <Pad size={[12, 9]} tint="#f2f6fa" />
        <Room width={28} depth={16} height={4.2} wall="tiles" tint="#fbfdff" />
        <Bench position={[-3.6, 0, -1.2]} width={3.2} />
        <Bench position={[3.4, 0, -1.2]} width={3.2} />
        <Bench position={[0, 0, -5.4]} width={4.6} rotation={0} />
        <Slab size={[4.6, 1.9, 0.36]} position={[0, 0.95, -7.4]} surfaceName="steel" tint="#eef4f9" roughness={0.5} metalness={0.4} />
        {[-0.9, -0.3, 0.3, 0.9].map((y, i) => <mesh key={y} position={[0, 0.5 + i * 0.42, -7.2]}><boxGeometry args={[3.6, 0.04, 0.3]} /><meshStandardMaterial color="#cbd8e3" roughness={0.55} /></mesh>)}
        <Slab size={[0.9, 0.9, 0.5]} position={[-3.6, 1.2, -1.2]} surfaceName="steel" tint="#ffffff" roughness={0.35} metalness={0.5} />
        <Slab size={[0.55, 0.35, 0.4]} position={[3.2, 1.0, -1.2]} surfaceName="brushed" tint="#dfe7ef" />
        <Plant position={[6.4, 0, -5.2]} scale={1.1} />
        <Plant position={[-6.6, 0, -5.4]} scale={0.95} hue="#4aa96c" />
      </group>;

    case 'greenhouse':
      return <group>
        <Ground name="paving" size={400} scale={1.2} tint="#e9f0ea" />
        <Pad size={[12, 9]} tint="#e7efe6" />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -2]}><planeGeometry args={[30, 12]} /><meshStandardMaterial color="#e8f2e6" roughness={0.98} /></mesh>
        <PlantingBed position={[-4.4, 0, -2.2]} length={4.2} />
        <PlantingBed position={[1.2, 0, -2.2]} length={4.2} rotation={0.02} />
        <PlantingBed position={[-1.6, 0, 3.2]} length={4.6} rotation={-0.01} />
        <mesh position={[0, 2.4, -9.4]}><planeGeometry args={[30, 4.8]} /><meshPhysicalMaterial color="#dff0ea" roughness={0.08} metalness={0} transparent opacity={0.42} /></mesh>
        {Array.from({ length: 9 }, (_, i) => <mesh key={i} position={[-14 + i * 3.5, 2.4, -9.3]}><boxGeometry args={[0.06, 4.8, 0.06]} /><meshStandardMaterial color="#b9cbc4" roughness={0.5} metalness={0.4} /></mesh>)}
        <mesh position={[0, 4.8, -9.4]}><boxGeometry args={[30, 0.1, 0.1]} /><meshStandardMaterial color="#b9cbc4" roughness={0.5} metalness={0.4} /></mesh>
        <Pipe from={[-6.4, 2.8, -8.6]} to={[6.4, 2.8, -8.6]} radius={0.07} color="#cfe0dc" />
        {[-4.6, 4.6].map((x) => <Plant key={x} position={[x, 0, -6.6]} scale={1.25} hue="#3f8f57" />)}
        <Slab size={[1.1, 0.7, 0.7]} position={[-7.6, 0.35, 0.4]} surfaceName="wood" tint="#e6d3b6" />
        <Slab size={[0.9, 0.5, 0.6]} position={[7.8, 0.25, 0.6]} surfaceName="wood" tint="#dcc7a8" />
      </group>;

    case 'home':
      return <group>
        <Ground name="wood" size={400} scale={0.9} tint="#f2eade" />
        <Pad size={[11, 8]} tint="#f0e8dc" />
        <Room width={20} depth={14} height={3.4} wall="tiles" tint="#fdf9f4" />
        <mesh position={[-5.6, 0.42, -3.4]} castShadow receiveShadow><boxGeometry args={[3.2, 0.8, 1.5]} /><meshStandardMaterial color="#dfe6ea" roughness={0.9} /></mesh>
        <mesh position={[-5.6, 0.86, -3.4]} castShadow><boxGeometry args={[3.2, 0.5, 1.5]} /><meshStandardMaterial color="#eef3f5" roughness={0.92} /></mesh>
        {[-6.6, -5.6, -4.6].map((x) => <mesh key={x} position={[x, 1.18, -3.9]} rotation={[0.3, 0, 0]} castShadow><boxGeometry args={[0.8, 0.5, 0.16]} /><meshStandardMaterial color="#f4f7f8" roughness={0.9} /></mesh>)}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.4, 0.012, 1.4]} receiveShadow><planeGeometry args={[5.2, 3.4]} /><meshStandardMaterial color="#e7eef2" roughness={1} /></mesh>
        <Bench position={[4.4, 0, -3.6]} width={2.8} />
        <mesh position={[7.2, 1.6, -6.9]}><planeGeometry args={[4.2, 2.2]} /><meshPhysicalMaterial color="#eaf4fb" roughness={0.06} metalness={0} transparent opacity={0.5} /></mesh>
        <Plant position={[6.8, 0, -1.4]} scale={1.35} />
        <Plant position={[-7.4, 0, 1.2]} scale={1} hue="#4aa96c" />
        <mesh position={[0, 2.9, -6.8]}><boxGeometry args={[1.4, 0.08, 0.08]} /><meshBasicMaterial color="#fff6e6" /></mesh>
        <pointLight position={[0, 2.8, -6.4]} intensity={0.5} distance={9} color="#ffeccd" />
      </group>;

    case 'factory':
      return <group>
        <Ground name="concrete" size={400} scale={1.6} tint="#e6eaee" />
        <Pad size={[14, 10]} tint="#e6ebf0" />
        <mesh position={[0, 3.2, -12]} receiveShadow><planeGeometry args={[34, 6.4]} /><meshStandardMaterial color="#e7ecf1" roughness={0.88} /></mesh>
        <mesh position={[0, 0.9, -11.9]}><boxGeometry args={[34, 1.8]} /><meshStandardMaterial color="#d3dbe3" roughness={0.85} /></mesh>
        {Array.from({ length: 9 }, (_, i) => <mesh key={i} position={[-16 + i * 4, 4.6, -11.9]}><boxGeometry args={[0.16, 2.6, 0.2]} /><meshStandardMaterial color="#b9c5d0" roughness={0.5} metalness={0.55} /></mesh>)}
        <Machine position={[-6.2, 0, -3.2]} rotation={0.12} tint="#e4ebf2" accent={accent} />
        <Machine position={[0.2, 0, -4.6]} rotation={-0.06} size={[2.1, 1.45, 1.5]} tint="#dde6ef" accent={accent} />
        <Machine position={[6.6, 0, -3.4]} rotation={-0.14} size={[1.6, 1.15, 1.3]} tint="#e8eef4" accent={accent} />
        <Guardrail position={[0, 0, 1.6]} length={13} />
        <Pipe from={[-13, 3.1, -8]} to={[13, 3.1, -8]} radius={0.09} color="#b9c6d1" />
        <Pipe from={[-13, 2.6, -8.2]} to={[13, 2.6, -8.2]} radius={0.06} color="#cfd9e2" />
        <Pallets position={[-10.4, 0, 3.4]} rotation={0.32} />
        <Pallets position={[11.2, 0, 2.6]} rotation={-0.24} />
        <Plant position={[9.4, 0, 6.2]} scale={1.1} />
      </group>;

    case 'datacenter':
      return <group>
        <Ground name="tiles" size={400} scale={1.3} tint="#eaf0f6" />
        <Pad size={[14, 10]} tint="#eef3f8" />
        <Room width={30} depth={18} height={3.6} wall="brushed" tint="#f2f7fc" side={false} />
        {[-9.6, -7.6, -5.6, 5.6, 7.6, 9.6].map((x, i) => <Rack key={x} position={[x, 0, -5.4]} rotation={0} tint={i % 2 ? '#e6edf5' : '#eef3f9'} led={accent} />)}
        {[-9.6, -7.6, -5.6, 5.6, 7.6, 9.6].map((x, i) => <Rack key={'b' + x} position={[x, 0, -7.2]} rotation={0} height={2.05} tint={i % 2 ? '#eef3f9' : '#e6edf5'} led="#2f6fed" />)}
        <Slab size={[12, 0.12, 0.5]} position={[0, 3.1, -6.3]} surfaceName="brushed" tint="#e9eff6" roughness={0.4} metalness={0.7} />
        {[-4.4, 0, 4.4].map((x) => <Pipe key={x} from={[x, 2.98, -6.3]} to={[x, 2.98, 0.4]} radius={0.07} color="#c8d6e4" />)}
        <Bench position={[0, 0, 3.4]} width={3.6} />
        <mesh position={[0, 1.42, 2.2]} rotation={[-0.32, 0, 0]}><planeGeometry args={[1.5, 0.9]} /><meshStandardMaterial color="#1f2c38" roughness={0.35} metalness={0.2} /></mesh>
        <Plant position={[-11.8, 0, 2.2]} scale={1.1} />
      </group>;

    case 'traffic':
      return <group>
        <Ground name="asphalt" size={400} scale={1.8} tint="#e3e8ed" />
        
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 1.2]} receiveShadow><planeGeometry args={[46, 7.6]} /><meshStandardMaterial color="#dfe5ea" roughness={0.96} /></mesh>
        {Array.from({ length: 12 }, (_, i) => <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-20 + i * 3.6, 0.014, 1.2]}><planeGeometry args={[1.9, 0.16]} /><meshBasicMaterial color="#ffffff" /></mesh>)}
        {Array.from({ length: 12 }, (_, i) => <mesh key={'s' + i} rotation={[-Math.PI / 2, 0, 0]} position={[-20 + i * 3.6, 0.014, 4.7]}><planeGeometry args={[1.9, 0.12]} /><meshBasicMaterial color="#eef2f5" /></mesh>)}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, -2.6]} receiveShadow><planeGeometry args={[46, 2.2]} /><meshStandardMaterial color="#e6ebef" roughness={0.9} /></mesh>
        {[-10, -3.4, 3.4, 10].map((x) => <StreetLight key={x} position={[x, 0, -1.9]} rotation={0} color="#f7d9a8" />)}
        {[-6.6, 6.6].map((x) => <group key={x} position={[x, 0, 5.4]}>
          <mesh position={[0, 1.7, 0]} castShadow><cylinderGeometry args={[0.07, 0.1, 3.4, 10]} /><meshStandardMaterial color="#b3bfca" roughness={0.45} metalness={0.6} /></mesh>
          <mesh position={[0, 3.1, 0]} castShadow><boxGeometry args={[0.26, 0.78, 0.24]} /><meshStandardMaterial color="#2f3a44" roughness={0.6} /></mesh>
          <mesh position={[0, 3.36, 0.14]}><sphereGeometry args={[0.075, 10, 8]} /><meshBasicMaterial color="#f87171" /></mesh>
          <mesh position={[0, 3.12, 0.14]}><sphereGeometry args={[0.075, 10, 8]} /><meshBasicMaterial color="#fbbf24" /></mesh>
          <mesh position={[0, 2.88, 0.14]}><sphereGeometry args={[0.075, 10, 8]} /><meshBasicMaterial color="#34d399" /></mesh>
        </group>)}
        <Pallets position={[-13.4, 0, 7.2]} rotation={0.4} />
        <Plant position={[12.6, 0, 7.4]} scale={1.15} />
      </group>;

    case 'power':
      return <group>
        <Ground name="concrete" size={400} scale={1.5} tint="#e6eaee" />
        
        <Slab size={[18, 0.14, 12]} position={[0, 0.07, -1]} tint="#e6ebf0" roughness={0.95} scale={1.2} />
        <Transformer position={[-4.4, 0.14, -4.2]} rotation={0.06} />
        <Transformer position={[1.4, 0.14, -4.6]} rotation={-0.04} />
        <Transformer position={[7.2, 0.14, -4.2]} rotation={0.02} />
        <Guardrail position={[0, 0.14, 2.6]} length={16} />
        {[-9, 9].map((x) => <group key={x} position={[x, 0, -9]}>
          <mesh position={[0, 3.2, 0]} castShadow><cylinderGeometry args={[0.08, 0.16, 6.4, 8]} /><meshStandardMaterial color="#b7c4ce" roughness={0.5} metalness={0.6} /></mesh>
          <mesh position={[0, 5.2, 0]}><boxGeometry args={[2.6, 0.09, 0.09]} /><meshStandardMaterial color="#c2ced8" roughness={0.5} metalness={0.55} /></mesh>
          <mesh position={[0, 4.7, 0]}><boxGeometry args={[1.8, 0.07, 0.07]} /><meshStandardMaterial color="#c2ced8" roughness={0.5} metalness={0.55} /></mesh>
        </group>)}
        <Pipe from={[-8, 0.34, 1.2]} to={[8, 0.34, 1.2]} radius={0.11} color="#a9bac7" />
        <Pallets position={[-8.6, 0, 5.6]} rotation={-0.3} />
      </group>;

    case 'network':
      return <group>
        <Ground name="tiles" size={400} scale={1.25} tint="#ebf1f7" />
        <Pad size={[13, 9]} tint="#eef3f8" />
        <Room width={28} depth={16} height={3.4} wall="tiles" tint="#fbfdff" side={false} />
        {[-8.8, -6.8, 6.8, 8.8].map((x) => <Rack key={x} position={[x, 0, -4.8]} tint="#eef3f9" led="#2f6fed" />)}
        <Slab size={[10, 0.14, 0.46]} position={[0, 2.9, -5.6]} surfaceName="brushed" tint="#eaf0f7" roughness={0.4} metalness={0.7} />
        {[-3.6, 0, 3.6].map((x) => <Pipe key={x} from={[x, 2.78, -5.6]} to={[x, 2.78, 1.2]} radius={0.06} color="#cbd8e6" />)}
        <Bench position={[0, 0, 2.8]} width={4} />
        <mesh position={[0, 1.48, 1.7]} rotation={[-0.3, 0, 0]}><planeGeometry args={[1.8, 1]} /><meshStandardMaterial color="#22303c" roughness={0.3} metalness={0.2} /></mesh>
        <mesh position={[-1.5, 0.86, 2.8]}><boxGeometry args={[0.5, 0.18, 0.34]} /><meshStandardMaterial color="#dbe4ec" roughness={0.6} metalness={0.3} /></mesh>
        <Plant position={[-10.8, 0, 3.2]} scale={1.05} />
        <Plant position={[10.8, 0, 3.2]} scale={1.15} hue="#4aa96c" />
      </group>;

    case 'crisis':
    default:
      return <group>
        <Ground name="concrete" size={400} scale={1.6} tint="#e6e7ea" />
        <Pad size={[12, 9]} tint="#e8e8ea" />
        <mesh position={[0, 3, -12]} receiveShadow><planeGeometry args={[32, 6]} /><meshStandardMaterial color="#e9e5e4" roughness={0.92} /></mesh>
        {Array.from({ length: 5 }, (_, i) => <Slab key={i} position={[-10 + i * 5.2, 0.6 + (i % 2) * 0.3, -11.4]} size={[3.4, 1.2 + (i % 3) * 0.4, 0.4]} rotation={[0, 0, (i % 2 ? 1 : -1) * 0.06]} surfaceName="concrete" tint="#dfdcda" />)}
        <Machine position={[-5.4, 0, -3.6]} rotation={0.18} tint="#e6e2e0" accent="#dc2626" />
        <Machine position={[4.6, 0, -4.4]} rotation={-0.12} size={[1.9, 1.3, 1.4]} tint="#e2dedb" accent="#dc2626" />
        {([[-1.2, 0.16, 2.6, 1.4, 0.32, 0.9], [2.2, 0.12, 3.4, 0.9, 0.24, 0.7], [-4.4, 0.14, 4.2, 1.1, 0.28, 0.8]] as [number, number, number, number, number, number][]).map((v, i) => <Slab key={i} position={[v[0], v[1], v[2]]} size={[v[3], v[4], v[5]]} rotation={[0, i * 0.7, 0.04]} surfaceName="concrete" tint="#d6d2cf" />)}
        <Guardrail position={[0, 0, 6.6]} length={14} />
        <mesh position={[0, 3.4, 0]}><boxGeometry args={[0.4, 0.1, 0.4]} /><meshStandardMaterial color="#3a3f45" roughness={0.7} /></mesh>
        <pointLight position={[0, 3.2, 0]} intensity={0.9} distance={12} color="#ff9a8a" />
        <Pallets position={[10.4, 0, 1.8]} rotation={-0.4} />
      </group>;
  }
}
