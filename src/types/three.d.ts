/**
 * src/types/three.d.ts —— three r185 最小声明桥接（eng-ts · W2 TS 迁移）
 *
 * 背景：vendor/three-r185 为无类型 JS（excluded from tsconfig），本项目按
 * 「增量渐进」策略为实际用到的 API 提供宽松类型（`any`），不追求完整类型面。
 * 后续波次（Phase A-D）如需更精确的 three 类型，可在此文件内逐步细化，
 * 或升级到 @types/three（注意与 r185 版本对齐）。
 *
 * 覆盖范围（由 grep THREE.<ident> 统计，2026-08-20）：
 *   Vector3 / Group / Mesh / Object3D / MeshBasicMaterial / MeshStandardMaterial /
 *   Color / Vector2 / BoxGeometry / PlaneGeometry / TorusGeometry / SphereGeometry /
 *   CylinderGeometry / RingGeometry / Spherical / MathUtils / PointLight /
 *   PerspectiveCamera / Quaternion / Matrix4 / DirectionalLight / CircleGeometry /
 *   BufferAttribute / BufferGeometry / Points / PointsMaterial / Raycaster / Plane /
 *   Sphere / Scene / Camera / Euler / LatheGeometry / ConeGeometry / CatmullRomCurve3 /
 *   CanvasTexture / FogExp2 / HemisphereLight / AmbientLight / WebGLRenderer / LOD
 *   常量：DoubleSide / FrontSide / AdditiveBlending / NormalBlending / SRGBColorSpace /
 *         NeutralToneMapping / PCFShadowMap / RepeatWrapping / ClampToEdgeWrapping
 */

declare module 'three' {
  export const Scene: any;
  export const Group: any;
  export const Mesh: any;
  export const Object3D: any;
  export const Camera: any;
  export const PerspectiveCamera: any;
  export const WebGLRenderer: any;
  export const Raycaster: any;
  export const Plane: any;
  export const Sphere: any;
  export const LOD: any;

  export const Vector2: any;
  export const Vector3: any;
  export const Quaternion: any;
  export const Euler: any;
  export const Matrix4: any;
  export const Spherical: any;
  export const Color: any;
  export const MathUtils: any;
  export const CatmullRomCurve3: any;

  export const BoxGeometry: any;
  export const PlaneGeometry: any;
  export const SphereGeometry: any;
  export const CylinderGeometry: any;
  export const ConeGeometry: any;
  export const TorusGeometry: any;
  export const RingGeometry: any;
  export const CircleGeometry: any;
  export const LatheGeometry: any;
  export const BufferGeometry: any;
  export const BufferAttribute: any;
  export const CanvasTexture: any;

  export const MeshBasicMaterial: any;
  export const MeshStandardMaterial: any;
  export const PointsMaterial: any;

  export const DirectionalLight: any;
  export const PointLight: any;
  export const AmbientLight: any;
  export const HemisphereLight: any;
  export const FogExp2: any;

  export const Points: any;

  export const DoubleSide: any;
  export const FrontSide: any;
  export const AdditiveBlending: any;
  export const NormalBlending: any;
  export const SRGBColorSpace: any;
  export const NeutralToneMapping: any;
  export const PCFShadowMap: any;
  export const RepeatWrapping: any;
  export const ClampToEdgeWrapping: any;
}

declare module 'three/webgpu' {
  /** r185 WebGPURenderer（L5 双后端；scene.ts 动态 import 使用） */
  export const WebGPURenderer: any;
}

declare module 'three/addons/utils/BufferGeometryUtils.js' {
  /** mergeGeometries：boardMesh / pieceFactory 几何合并 */
  export const mergeGeometries: any;
}

declare module 'three/addons/controls/OrbitControls.js' {
  /** OrbitControls：scene.ts 轨道控制 */
  export const OrbitControls: any;
}
