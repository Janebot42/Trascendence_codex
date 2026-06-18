declare module 'three' {
  export class Color { constructor(value: number); }
  export class Vector3 { x: number; y: number; z: number; set(x: number, y: number, z: number): this; }
  export class Euler { x: number; y: number; z: number; }
  export class Object3D { position: Vector3; rotation: Euler; }
  export class Scene { background: Color | null; add(...objects: Object3D[]): this; }
  export class PerspectiveCamera extends Object3D {
    constructor(fov: number, aspect: number, near: number, far: number);
    aspect: number;
    lookAt(x: number, y: number, z: number): void;
    updateProjectionMatrix(): void;
  }
  export class WebGLRenderer {
    constructor(parameters?: { antialias?: boolean });
    domElement: HTMLCanvasElement;
    setPixelRatio(value: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: Scene, camera: PerspectiveCamera): void;
  }
  export class BoxGeometry { constructor(width?: number, height?: number, depth?: number); }
  export class SphereGeometry { constructor(radius?: number, widthSegments?: number, heightSegments?: number); }
  export class MeshStandardMaterial {
    constructor(parameters?: { color?: number; roughness?: number });
    emissive: Color;
    emissiveIntensity: number;
  }
  export class MeshBasicMaterial { constructor(parameters?: { color?: number }); }
  export class Mesh<TMaterial = MeshStandardMaterial | MeshBasicMaterial> extends Object3D {
    constructor(geometry: BoxGeometry | SphereGeometry, material: TMaterial);
    material: TMaterial;
  }
  export class AmbientLight extends Object3D { constructor(color?: number, intensity?: number); }
  export class DirectionalLight extends Object3D { constructor(color?: number, intensity?: number); }
}
