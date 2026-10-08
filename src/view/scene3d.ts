import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BurdenOptions, HoleResult } from "../geom/burden";
import type { Surface } from "../geom/surface";
import type { Bounds, MeshData } from "../io/mesh";
import type { Vec3 } from "../geom/vec";
import { CLASS_COLORS } from "./format";

const HOLE_COLOR = 0x141414;
const POINT_COLOR = 0xe08a1e;
const RIG_PLAN_COLOR = 0xb0b7c0;
const RIG_QUALITY_COLOR = 0x8a8f99;

/** En rak linje från riggen, E N Z. */
export interface RigLine {
  /** Gällande nummer, för etiketter. */
  id: string;
  /** Ursprungs-id, för markering och borttagning. */
  source: string;
  start: Vec3;
  end: Vec3;
}
const SELECTED_COLOR = 0xf0a500;

/** 3D-vy med ytan, hålen och försättningslinjerna. Allt ritas i lokala koordinater kring ytans origo. */
export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  onSelect: ((id: string) => void) | null = null;
  /** Klick på riggens hål eller en markör utan sondering: ursprungs-id. */
  onSelectPoint: ((source: string) => void) | null = null;

  private container: HTMLElement;
  private origin: Vec3 = [0, 0, 0];
  private surfaceMesh: THREE.Mesh | null = null;
  private holesGroup = new THREE.Group();
  private linesGroup = new THREE.Group();
  private labelsGroup = new THREE.Group();
  /** Startpunkter utan sondering, för kontroll av läget mot ytan. */
  private pointsGroup = new THREE.Group();
  /** Riggens raka linjer: borrplan och kvalitetslogg. */
  private rigGroup = new THREE.Group();
  private framedWithoutSurface = false;
  private pickables: THREE.Object3D[] = [];
  /** Klickbara riggcylindrar och markörer, med ursprungs-id i userData.source. */
  private sourcePickables: THREE.Object3D[] = [];
  private sourceMaterials = new Map<string, { mat: THREE.MeshStandardMaterial; base: number }[]>();
  private selectedSource: string | null = null;
  private holeMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private holeMeshes = new Map<string, THREE.Mesh[]>();
  private selectedId: string | null = null;
  private needsRender = true;
  private raycaster = new THREE.Raycaster();
  private downPos: { x: number; y: number } | null = null;
  /** Anropas när ytans textur har lästs in (eller misslyckats), så att bilder ur modellen kan ritas om. */
  onTextureLoaded: (() => void) | null = null;
  private textureLoading = false;

  /** Falskt medan texturen fortfarande läses in: bilder renderade då blir svarta. */
  get textureReady(): boolean {
    return !this.textureLoading;
  }

  constructor(container: HTMLElement) {
    this.container = container;
    // alpha: ortofotot till översikten renderas med genomskinlig omgivning
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0xe9edf2);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(40, -60, 40);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener("change", () => this.requestRender());

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.1);
    hemi.position.set(0, 0, 1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-60, -80, 120);
    this.scene.add(hemi, sun, this.holesGroup, this.linesGroup, this.labelsGroup, this.pointsGroup, this.rigGroup);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => (this.downPos = { x: e.clientX, y: e.clientY }));
    el.addEventListener("pointerup", (e) => {
      if (!this.downPos) return;
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      this.downPos = null;
      if (moved < 4) this.pick(e);
    });

    const loop = () => {
      requestAnimationFrame(loop);
      if (this.needsRender) {
        this.needsRender = false;
        this.renderer.render(this.scene, this.camera);
      }
    };
    loop();
  }

  requestRender(): void {
    this.needsRender = true;
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  setSurface(surface: Surface, mesh: MeshData, textureUrl: string | null): void {
    if (this.surfaceMesh) {
      this.scene.remove(this.surfaceMesh);
      this.surfaceMesh.geometry.dispose();
      const mat = this.surfaceMesh.material as THREE.Material;
      mat.dispose();
    }
    this.origin = surface.origin;
    this.textureLoading = false;
    let geometry: THREE.BufferGeometry;
    let material: THREE.Material;
    if (textureUrl && mesh.uvs && mesh.uvIndices) {
      geometry = buildTexturedGeometry(mesh, surface.origin);
      this.textureLoading = true;
      const done = () => {
        this.textureLoading = false;
        this.requestRender();
        this.onTextureLoaded?.();
      };
      const tex = new THREE.TextureLoader().load(textureUrl, done, undefined, (err) => {
        console.warn("Texturen kunde inte läsas in", err);
        done();
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    } else {
      geometry = surface.geometry;
      if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
      material = new THREE.MeshStandardMaterial({ color: 0xcfc8bb, flatShading: true, side: THREE.DoubleSide, roughness: 0.95 });
    }
    this.surfaceMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.surfaceMesh);

    this.framedWithoutSurface = false;
    this.frameBounds(surface.bounds);
  }

  /** Kameran så att en låda i E N Z syns snett från sydost. */
  private frameBounds(b: Bounds): void {
    const center = new THREE.Vector3(
      (b.min[0] + b.max[0]) / 2 - this.origin[0],
      (b.min[1] + b.max[1]) / 2 - this.origin[1],
      (b.min[2] + b.max[2]) / 2 - this.origin[2],
    );
    const size = Math.max(10, b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    this.controls.target.copy(center);
    this.camera.position.set(center.x + size * 0.9, center.y - size * 0.9, center.z + size * 0.7);
    this.camera.near = Math.max(0.05, size / 1000);
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  /**
   * Utan yta: origo och kamera efter hålen, så att SWEREF-koordinater inte tappar precision i float32.
   * Kameran flyttas bara första gången eller när origo byter plats, inte vid varje omräkning.
   */
  frameWithoutSurface(points: Vec3[]): void {
    if (this.surfaceMesh || points.length === 0) return;
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i]);
        max[i] = Math.max(max[i], p[i]);
      }
    }
    const origin: Vec3 = [Math.floor((min[0] + max[0]) / 2), Math.floor((min[1] + max[1]) / 2), Math.floor((min[2] + max[2]) / 2)];
    const moved = origin.some((v, i) => Math.abs(v - this.origin[i]) > 50);
    if (this.framedWithoutSurface && !moved) return;
    this.origin = origin;
    this.framedWithoutSurface = true;
    this.frameBounds({ min, max });
  }

  /** Riggens raka linjer: planen tunn och ljusgrå, loggens hål grå cylindrar lika tjocka som de sonderade. Påhugg och etiketter ritas av markörerna och hålen. */
  setRigLines(plan: RigLine[], quality: RigLine[]): void {
    for (const child of [...this.rigGroup.children]) {
      this.rigGroup.remove(child);
      disposeObject(child);
    }
    this.sourcePickables = this.sourcePickables.filter((o) => o.userData.kind !== "rig");
    for (const [source, mats] of this.sourceMaterials) {
      const rest = mats.filter((m) => m.base !== RIG_QUALITY_COLOR);
      if (rest.length) this.sourceMaterials.set(source, rest);
      else this.sourceMaterials.delete(source);
    }
    const o = this.origin;
    const L = (p: Vec3) => new THREE.Vector3(p[0] - o[0], p[1] - o[1], p[2] - o[2]);
    const addLines = (lines: RigLine[], color: number, opacity: number) => {
      if (lines.length === 0) return;
      const pos: number[] = [];
      for (const l of lines) {
        const a = L(l.start);
        const b = L(l.end);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      this.rigGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })));
    };
    addLines(plan, RIG_PLAN_COLOR, 0.85);
    // Loggens hål som cylindrar, lika tjocka som de sonderade men grå, så att de två går att jämföra i samma bild.
    for (const l of quality) {
      const mat = new THREE.MeshStandardMaterial({ color: RIG_QUALITY_COLOR, roughness: 0.6 });
      const cyl = cylinderBetween(L(l.start), L(l.end), 0.09, mat);
      cyl.userData.kind = "rig";
      this.registerSource(l.source, cyl, mat, RIG_QUALITY_COLOR);
      this.rigGroup.add(cyl);
    }
    this.applySelection();
    this.requestRender();
  }

  setResults(results: HoleResult[], _opts: BurdenOptions): void {
    for (const g of [this.holesGroup, this.linesGroup, this.labelsGroup]) {
      for (const child of [...g.children]) {
        g.remove(child);
        disposeObject(child);
      }
    }
    this.pickables = [];
    this.holeMaterials.clear();
    this.holeMeshes.clear();

    const o = this.origin;
    const L = (p: Vec3) => new THREE.Vector3(p[0] - o[0], p[1] - o[1], p[2] - o[2]);
    const linePos: number[] = [];
    const lineCol: number[] = [];
    const color = new THREE.Color();

    for (const r of results) {
      const mat = new THREE.MeshStandardMaterial({ color: HOLE_COLOR, roughness: 0.6 });
      this.holeMaterials.set(r.id, mat);
      const meshes: THREE.Mesh[] = [];
      for (let k = 0; k + 1 < r.path.points.length; k++) {
        const cyl = cylinderBetween(L(r.path.points[k]), L(r.path.points[k + 1]), 0.09, mat);
        cyl.userData.id = r.id;
        meshes.push(cyl);
        this.holesGroup.add(cyl);
        this.pickables.push(cyl);
      }
      const collar = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), mat);
      collar.position.copy(L(r.path.collar));
      collar.userData.id = r.id;
      meshes.push(collar);
      this.holesGroup.add(collar);
      this.pickables.push(collar);
      this.holeMeshes.set(r.id, meshes);

      const label = makeLabel(r.id);
      label.position.copy(L(r.path.collar)).add(new THREE.Vector3(0, 0, 1.1));
      this.labelsGroup.add(label);

      for (const row of r.rows) {
        if (!row.closest || row.burden === null || row.cls === "collar") continue;
        if (!(row.isInterval || row.isBottom)) continue;
        const a = L(row.point);
        const b = L(row.closest);
        color.set(CLASS_COLORS[row.cls]);
        linePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        lineCol.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
    }
    if (linePos.length > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(lineCol, 3));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
      this.linesGroup.add(lines);
    }
    this.applySelection();
    this.requestRender();
  }

  /** Startpunkter som saknar sondering ritas som orange markörer med etikett, så att påhuggens läge mot ytan kan kontrolleras. */
  setPoints(points: { id: string; source: string; e: number; n: number; z: number }[]): void {
    for (const child of [...this.pointsGroup.children]) {
      this.pointsGroup.remove(child);
      disposeObject(child);
    }
    this.sourcePickables = this.sourcePickables.filter((o) => o.userData.kind !== "point");
    for (const [source, mats] of this.sourceMaterials) {
      const rest = mats.filter((m) => m.base !== POINT_COLOR);
      if (rest.length) this.sourceMaterials.set(source, rest);
      else this.sourceMaterials.delete(source);
    }
    const o = this.origin;
    for (const p of points) {
      const mat = new THREE.MeshStandardMaterial({ color: POINT_COLOR, roughness: 0.5 });
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), mat);
      marker.position.set(p.e - o[0], p.n - o[1], p.z - o[2]);
      marker.userData.kind = "point";
      this.registerSource(p.source, marker, mat, POINT_COLOR);
      this.pointsGroup.add(marker);
      const label = makeLabel(p.id);
      label.position.copy(marker.position).add(new THREE.Vector3(0, 0, 1.1));
      this.pointsGroup.add(label);
    }
    this.applySelection();
    this.requestRender();
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.applySelection();
    this.requestRender();
  }

  /** Flyttar kameran så att ett hål hamnar i fokus. */
  focusHole(r: HoleResult): void {
    const o = this.origin;
    const c = new THREE.Vector3(r.path.collar[0] - o[0], r.path.collar[1] - o[1], r.path.collar[2] - o[2]);
    const bottom = r.path.points[r.path.points.length - 1];
    const mid = new THREE.Vector3((r.path.collar[0] + bottom[0]) / 2 - o[0], (r.path.collar[1] + bottom[1]) / 2 - o[1], (r.path.collar[2] + bottom[2]) / 2 - o[2]);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    this.controls.target.copy(mid);
    this.camera.position.copy(mid).addScaledVector(dir, Math.max(25, r.path.length * 2.2));
    void c;
    this.controls.update();
    this.requestRender();
  }

  /** Renderar ytan sedd rakt uppifrån, norr uppåt, och returnerar en data-URL. */
  renderTopDown(bounds: Bounds, widthPx: number): string {
    const o = this.origin;
    const w = bounds.max[0] - bounds.min[0];
    const h = bounds.max[1] - bounds.min[1];
    const px = widthPx;
    const py = Math.max(1, Math.round((widthPx * h) / w));
    const cam = new THREE.OrthographicCamera(bounds.min[0] - o[0], bounds.max[0] - o[0], bounds.max[1] - o[1], bounds.min[1] - o[1], 0.1, 5000);
    const cx = (bounds.min[0] + bounds.max[0]) / 2 - o[0];
    const cy = (bounds.min[1] + bounds.max[1]) / 2 - o[1];
    cam.position.set(cx, cy, bounds.max[2] - o[2] + 1000);
    cam.up.set(0, 1, 0);
    cam.lookAt(cx, cy, 0);
    cam.updateProjectionMatrix();
    return this.renderWithCamera(cam, px, py, true);
  }

  /**
   * Renderar väggen sedd framifrån: kameran står framför slänten och tittar mot hålet
   * längs bäringen. Bilden täcker exakt sidledes latMin..latMax (positivt åt höger) och
   * höjd zMin..zMax, så att den kan läggas rakt in i profilbildens panel.
   */
  renderFront(
    collar: Vec3,
    u: Vec3,
    n: Vec3,
    latMin: number,
    latMax: number,
    zMin: number,
    zMax: number,
    widthPx: number,
    quality = 0.85,
  ): string | null {
    if (!this.surfaceMesh) return null;
    const o = this.origin;
    const latC = (latMin + latMax) / 2;
    const zC = (zMin + zMax) / 2;
    // Sidledes läge lat = -(p - påhugg)·n, så panelens mitt ligger vid -latC längs n.
    const target = new THREE.Vector3(
      collar[0] - o[0] - n[0] * latC,
      collar[1] - o[1] - n[1] * latC,
      zC - o[2],
    );
    const D = 150;
    const halfW = (latMax - latMin) / 2;
    const cam = new THREE.OrthographicCamera(-halfW, halfW, zMax - zC, zMin - zC, 1, D + 400);
    cam.position.set(target.x + u[0] * D, target.y + u[1] * D, target.z);
    cam.up.set(0, 0, 1);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    const px = Math.max(1, Math.round(widthPx));
    const py = Math.max(1, Math.round((widthPx * (zMax - zMin)) / (latMax - latMin)));
    return this.renderWithCamera(cam, px, py, false, quality);
  }

  /** Renderar bara ytan med given kamera. Med transparent blir allt utanför modellen genomskinligt. */
  private renderWithCamera(cam: THREE.Camera, px: number, py: number, transparent = false, quality = 0.85): string {
    const prev = new THREE.Vector2();
    this.renderer.getSize(prev);
    const prevPixelRatio = this.renderer.getPixelRatio();
    const prevBackground = this.scene.background;
    const prevClear = new THREE.Color();
    this.renderer.getClearColor(prevClear);
    const prevAlpha = this.renderer.getClearAlpha();
    const groups = [this.holesGroup, this.linesGroup, this.labelsGroup, this.pointsGroup];
    const vis = groups.map((g) => g.visible);
    groups.forEach((g) => (g.visible = false));
    if (transparent) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(px, py, false);
    this.renderer.render(this.scene, cam);
    // Genomskinlighet kräver ett format med alfakanal. Webbläsare utan WebP-kodning ger PNG.
    const url = transparent
      ? this.renderer.domElement.toDataURL("image/webp", 0.9)
      : this.renderer.domElement.toDataURL("image/jpeg", quality);
    this.scene.background = prevBackground;
    this.renderer.setClearColor(prevClear, prevAlpha);
    groups.forEach((g, i) => (g.visible = vis[i]));
    this.renderer.setPixelRatio(prevPixelRatio);
    this.renderer.setSize(Math.max(1, prev.x), Math.max(1, prev.y), false);
    this.resize();
    this.requestRender();
    return url;
  }

  private applySelection(): void {
    for (const [id, mat] of this.holeMaterials) {
      const sel = id === this.selectedId;
      mat.color.setHex(sel ? SELECTED_COLOR : HOLE_COLOR);
      mat.emissive.setHex(sel ? 0x553300 : 0x000000);
    }
    for (const [source, mats] of this.sourceMaterials) {
      const sel = source === this.selectedSource;
      for (const { mat, base } of mats) {
        mat.color.setHex(sel ? SELECTED_COLOR : base);
        mat.emissive.setHex(sel ? 0x553300 : 0x000000);
      }
    }
  }

  /** Markerar riggens hål eller en markör via ursprungs-id. */
  selectSource(source: string | null): void {
    this.selectedSource = source;
    this.applySelection();
    this.requestRender();
  }

  private registerSource(source: string, obj: THREE.Mesh, mat: THREE.MeshStandardMaterial, base: number): void {
    obj.userData.source = source;
    this.sourcePickables.push(obj);
    const list = this.sourceMaterials.get(source) ?? [];
    list.push({ mat, base });
    this.sourceMaterials.set(source, list);
  }

  private pick(e: PointerEvent): void {
    if (this.pickables.length === 0 && this.sourcePickables.length === 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.pickables, ...this.sourcePickables], false);
    if (hits.length > 0) {
      const id = hits[0].object.userData.id as string | undefined;
      const source = hits[0].object.userData.source as string | undefined;
      if (id && this.onSelect) this.onSelect(id);
      else if (source && this.onSelectPoint) this.onSelectPoint(source);
    }
  }
}

function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geom = new THREE.CylinderGeometry(radius, radius, len, 10, 1, false);
  const mesh = new THREE.Mesh(geom, material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  roundRect(ctx, 4, 4, 120, 56, 12);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.font = "bold 34px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(1.6, 0.8, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const m = child as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat && child !== obj) mat.dispose();
    const sprite = child as THREE.Sprite;
    if (sprite.isSprite) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
  });
}

/** OBJ har separata index för punkter och texturkoordinater, här slås de ihop till en vertex per unik kombination. */
function buildTexturedGeometry(mesh: MeshData, origin: Vec3): THREE.BufferGeometry {
  const { positions, indices } = mesh;
  const uvs = mesh.uvs!;
  const uvIndices = mesh.uvIndices!;
  const uvCount = uvs.length / 2;
  const map = new Map<number, number>();
  const outPos: number[] = [];
  const outUv: number[] = [];
  const outIdx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    const t = uvIndices[i];
    const key = v * (uvCount + 1) + (t + 1);
    let idx = map.get(key);
    if (idx === undefined) {
      idx = outPos.length / 3;
      map.set(key, idx);
      outPos.push(positions[v * 3] - origin[0], positions[v * 3 + 1] - origin[1], positions[v * 3 + 2] - origin[2]);
      outUv.push(t >= 0 ? uvs[t * 2] : 0, t >= 0 ? uvs[t * 2 + 1] : 0);
    }
    outIdx[i] = idx;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(outUv, 2));
  g.setIndex(new THREE.BufferAttribute(outIdx, 1));
  return g;
}
