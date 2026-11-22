/**
 * 场景材质仓库
 * ------------------------------------------------------------------
 * 贴图来自 ambientCG 的 CC0 素材（混凝土 / 沥青 / 金属 / 木纹 / 瓷砖 / 石材），
 * 已裁到 512px 并转成 JPG，全站合计约 460KB。
 *
 * 关键设计：贴图**不克隆**。按「材质 + 密度档」缓存同一个实例，
 * 图片解码完成后由 three 自己标记上传——这样不会出现“克隆时图片还没到、
 * 克隆体永远没有图”的问题，也就不需要等贴图才挂画布。
 */
import * as THREE from 'three';
import { useEffect, useReducer } from 'react';

import { withBase } from '../utils/basePath';

const BASE = withBase('/tex/');

type Channel = 'color' | 'normalgl' | 'roughness';

/** 密度档：数值越大格子越小。1≈10m 一格，10≈1m 一格。 */
const DENSITY_BUCKETS = [1, 2, 4, 6, 10] as const;
export type Density = (typeof DENSITY_BUCKETS)[number];

const surfaces = {
  concrete: { asset: 'concrete034', repeat: 6, roughness: 0.93, metalness: 0.02 },
  asphalt: { asset: 'asphalt012', repeat: 8, roughness: 0.96, metalness: 0 },
  paving: { asset: 'pavingstones070', repeat: 6, roughness: 0.88, metalness: 0 },
  tiles: { asset: 'tiles074', repeat: 5, roughness: 0.55, metalness: 0.04 },
  grass: { asset: 'grass004', repeat: 5, roughness: 0.95, metalness: 0 },
  steel: { asset: 'metal046a', repeat: 2, roughness: 0.42, metalness: 0.72 },
  brushed: { asset: 'metal032', repeat: 3, roughness: 0.34, metalness: 0.85 },
  wood: { asset: 'wood066', repeat: 3, roughness: 0.6, metalness: 0.02 },
} satisfies Record<string, { asset: string; repeat: number; roughness: number; metalness: number }>;

export type SurfaceName = keyof typeof surfaces;

export interface Surface {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  color: string;
  roughness: number;
  metalness: number;
}

const cache = new Map<string, THREE.Texture | null>();
const loader = typeof window === 'undefined' ? null : new THREE.TextureLoader();

/* --------------------------- 加载进度订阅 --------------------------- */

let revision = 0;
const listeners = new Set<() => void>();
function bump() {
  revision += 1;
  for (const listener of listeners) listener();
}
export function useTextureRevision() {
  const [, force] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, [force]);
  return revision;
}

function channel(asset: string, kind: Channel, repeat: number): THREE.Texture | null {
  const key = `${asset}_${kind}_${repeat}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (!loader) { cache.set(key, null); return null; }
  const texture = loader.load(`${BASE}${asset}_${kind}.jpg`, bump);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  cache.set(key, texture);
  return texture;
}

/** 这几种材质的法线贴图是平的，直接省掉一次采样。 */
const FLAT_NORMAL = new Set(['metal046a', 'metal032', 'wood066', 'tiles074']);

/**
 * 取一份材质通道。
 * @param density 地坪密度档，见 DENSITY_BUCKETS
 */
export function surface(name: SurfaceName, density: number = 4): Surface {
  const config = surfaces[name];
  const bucket = DENSITY_BUCKETS.reduce((best, value) => (Math.abs(value - density) < Math.abs(best - density) ? value : best), DENSITY_BUCKETS[0]);
  const repeat = config.repeat * bucket;
  return {
    map: channel(config.asset, 'color', repeat),
    normalMap: FLAT_NORMAL.has(config.asset) ? null : channel(config.asset, 'normalgl', repeat),
    roughnessMap: channel(config.asset, 'roughness', repeat),
    color: '#ffffff',
    roughness: config.roughness,
    metalness: config.metalness,
  };
}
