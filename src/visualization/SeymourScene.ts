import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  HardwareProfile,
  HardwareStage,
  KernelPlan,
  SimulationResult,
  SimulationSettings,
  ViewMode,
} from '../types';

interface LabelAnchor {
  element: HTMLDivElement;
  position: THREE.Vector3;
  view: ViewMode;
}

interface CameraDestination {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const INK = 0x173e34;
const PAPER = 0xf1ead8;
const RED = 0xe94d32;
const MUSTARD = 0xe2a82b;
const GREEN = 0x6f963d;
const DARK_GREEN = 0x153c31;
const COPPER = 0xb86c36;
const SILICON = 0x445b55;

export class SeymourScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Timer();
  private readonly resizeObserver: ResizeObserver;
  private readonly storyPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-5.4, 0.55, 0),
    new THREE.Vector3(-3.8, 0.7, 0.1),
    new THREE.Vector3(-2.0, 0.4, -0.05),
    new THREE.Vector3(-0.3, 0.85, 0.1),
    new THREE.Vector3(1.2, 0.55, -0.05),
    new THREE.Vector3(2.75, 0.92, 0),
  ]);
  private readonly hardwarePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.8, 0.1, -1.25),
    new THREE.Vector3(-0.8, 0.25, -0.8),
    new THREE.Vector3(0.5, 0.45, -0.2),
    new THREE.Vector3(2.0, 0.75, 0),
    new THREE.Vector3(3.25, 1.45, 0),
  ]);
  private readonly hostPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-5.2, 0.35, 0),
    new THREE.Vector3(-4.2, 0.05, 0),
    new THREE.Vector3(-3.1, -0.25, -0.35),
    new THREE.Vector3(-1.8, 0.1, -1.25),
  ]);
  private readonly commandPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-5.05, 0.2, 0.55),
    new THREE.Vector3(-4.0, 0.55, 0.8),
    new THREE.Vector3(-2.7, 0.45, 0.9),
    new THREE.Vector3(-1.05, 0.18, 0.62),
  ]);
  private readonly storyGroup = new THREE.Group();
  private readonly hardwareGroup = new THREE.Group();
  private readonly storyParcels: THREE.Mesh[] = [];
  private readonly hardwareParcels: THREE.Mesh[] = [];
  private readonly hostParcels: THREE.Mesh[] = [];
  private readonly commandParcels: THREE.Mesh[] = [];
  private readonly laneMeshes: THREE.Mesh[] = [];
  private readonly labels: LabelAnchor[] = [];
  private readonly labelLayer: HTMLDivElement;
  private readonly hotspots = new Map<HardwareStage, THREE.Object3D[]>();
  private readonly hbmStacks = new THREE.Group();
  private readonly computeBloom = new THREE.Group();
  private readonly upperJaw = new THREE.Group();
  private readonly lowerJaw = new THREE.Group();
  private destination: CameraDestination | null = null;
  private settings: SimulationSettings;
  private result: SimulationResult;
  private activeStage: HardwareStage = 'hbm';
  private selectedKernelHostBytes = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private paused = false;
  private animationFrame = 0;
  private phaseOffset = 0;

  constructor(
    private readonly container: HTMLElement,
    settings: SimulationSettings,
    result: SimulationResult,
    hardware: HardwareProfile,
  ) {
    this.settings = { ...settings };
    this.result = result;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(PAPER, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.append(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'scene-labels';
    this.labelLayer.setAttribute('aria-hidden', 'true');
    container.append(this.labelLayer);

    this.camera.position.set(0.8, 4.7, 12.8);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 20;
    this.controls.maxPolarAngle = Math.PI * 0.58;
    this.controls.target.set(0, 0.5, 0);

    this.buildScene(hardware);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.update(settings, result, hardware);
    this.focus('overview');
    this.animate();
  }

  update(settings: SimulationSettings, result: SimulationResult, hardware: HardwareProfile): void {
    const viewChanged = settings.view !== this.settings.view;
    this.settings = { ...settings };
    this.result = result;
    this.storyGroup.visible = settings.view === 'story';
    this.hardwareGroup.visible = settings.view === 'hardware';

    this.labels.filter((label) => label.element.dataset.stage === 'hbm').forEach((label) => {
      label.element.innerHTML = `<span>HBM stacks · fast memory</span><strong>${hardware.hbmCapacityGB} GB · ${hardware.hbmBandwidthTBs} TB/s</strong>`;
    });
    this.labels.filter((label) => label.element.dataset.stage === 'compute').forEach((label) => {
      label.element.innerHTML = `<span>${hardware.vendor === 'AMD' ? 'Matrix cores · MFMA' : 'Tensor cores · MMA'}</span><strong>${hardware.fp16DenseTflops.toFixed(0)} TFLOP/s FP16</strong>`;
    });
    this.labels.filter((label) => label.element.dataset.stage === 'compute-array').forEach((label) => {
      label.element.innerHTML = `<span>Repeated worker blocks</span><strong>${hardware.unitCount} ${hardware.unitName}s on the GPU die</strong>`;
    });
    this.labels.filter((label) => label.element.dataset.stage === 'l2').forEach((label) => {
      label.element.innerHTML = `<span>L2${hardware.lastLevelCacheMB !== hardware.l2CacheMB ? ' + Infinity Cache' : ''}</span><strong>${hardware.l2CacheMB} MB L2${hardware.lastLevelCacheMB !== hardware.l2CacheMB ? ` · ${hardware.lastLevelCacheMB} MB last-level` : ''}</strong>`;
    });
    this.labels.filter((label) => label.element.dataset.stage === 'die-boundary').forEach((label) => {
      label.element.innerHTML = `<span>GPU die · central silicon chip</span><strong>${hardware.architecture}</strong>`;
    });
    this.labels.filter((label) => label.element.dataset.stage === 'shared-capacity').forEach((label) => {
      label.element.innerHTML = `<span>Shared / LDS</span><strong>${hardware.sharedMemoryKB} KB per ${hardware.unitName}</strong>`;
    });
    this.labels.filter((label) => label.element.dataset.stage === 'register-capacity').forEach((label) => {
      label.element.innerHTML = `<span>Register file</span><strong>${hardware.registerFileKB} KB per ${hardware.unitName}</strong>`;
    });
    this.labels.filter((label) => label.element.dataset.stage === 'lanes').forEach((label) => {
      label.element.innerHTML = `<span>${hardware.waveName} lanes</span><strong>${hardware.matrixGroupSize} cooperate for ${hardware.vendor === 'AMD' ? 'MFMA' : 'WGMMA'}</strong>`;
    });
    this.laneMeshes.forEach((lane, index) => { lane.visible = index < hardware.matrixGroupSize; });
    this.labels.filter((label) => label.element.dataset.stage === 'host').forEach((label) => {
      const spill = result.hostTrafficBytes > 0;
      label.element.innerHTML = `<span>Host computer</span><strong>${spill ? `${formatCompact(result.hostTrafficBytes)} crosses PCIe at ${hardware.hostLinkGBs} GB/s` : 'CPU sends commands · tensors stay in HBM'}</strong>`;
      label.element.dataset.active = String(spill);
    });

    const memoryBound = result.bottleneck === 'memory' || result.bottleneck === 'host';
    this.setEmissive(this.hbmStacks, memoryBound ? RED : DARK_GREEN, memoryBound ? 0.1 : 0.03);
    this.selectStage(this.activeStage);
    if (viewChanged) this.focus('overview');
  }

  selectStage(stage: HardwareStage): void {
    this.activeStage = stage;
    for (const [key, objects] of this.hotspots) {
      objects.forEach((object) => this.setEmissive(object, key === stage ? MUSTARD : INK, key === stage ? 0.42 : 0));
    }
  }

  setKernelPlan(plan: KernelPlan): void {
    this.selectedKernelHostBytes = plan.hostBytes;
    this.labels.filter((label) => label.element.dataset.stage === 'host').forEach((label) => {
      label.element.innerHTML = `<span>Host computer</span><strong>${plan.hostBytes > 0 ? `${formatCompact(plan.hostBytes)} feeds this kernel over PCIe` : this.result.hostTrafficBytes > 0 ? 'global spill exists · this kernel stays resident' : 'CPU sends commands · tensors stay in HBM'}</strong>`;
      label.element.dataset.active = String(plan.hostBytes > 0);
    });
  }

  focus(stage: 'overview' | 'hbm' | 'pipeline' | 'compute' | 'host'): void {
    const story: Record<typeof stage, CameraDestination> = {
      overview: { position: new THREE.Vector3(0.8, 4.7, 12.8), target: new THREE.Vector3(0, 0.5, 0) },
      hbm: { position: new THREE.Vector3(-4.4, 3.2, 8), target: new THREE.Vector3(-4.1, 0.8, 0) },
      pipeline: { position: new THREE.Vector3(-0.5, 3.2, 8.4), target: new THREE.Vector3(-0.2, 0.55, 0) },
      compute: { position: new THREE.Vector3(3.7, 2.8, 7.5), target: new THREE.Vector3(3.2, 1.15, 0) },
      host: { position: new THREE.Vector3(-4.4, 3.2, 8), target: new THREE.Vector3(-4.1, 0.8, 0) },
    };
    const hardware: Record<typeof stage, CameraDestination> = {
      overview: { position: new THREE.Vector3(0.1, 9.8, 10.8), target: new THREE.Vector3(-0.55, -0.25, 0) },
      hbm: { position: new THREE.Vector3(-1.5, 4.3, 7.2), target: new THREE.Vector3(-0.7, 0, 0) },
      pipeline: { position: new THREE.Vector3(1.3, 5.0, 8.2), target: new THREE.Vector3(0.8, 0.2, 0) },
      compute: { position: new THREE.Vector3(3.6, 3.3, 6.4), target: new THREE.Vector3(3.15, 1.2, 0) },
      host: { position: new THREE.Vector3(-4.8, 3.1, 6.2), target: new THREE.Vector3(-4.8, 0.15, 0) },
    };
    this.destination = (this.settings.view === 'story' ? story : hardware)[stage];
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  async capture(): Promise<void> {
    this.render();
    const link = document.createElement('a');
    link.download = `seymour-${this.settings.view}-${this.settings.phase}-${this.settings.hardwareId}-b${this.settings.batch}.png`;
    link.href = this.renderer.domElement.toDataURL('image/png');
    link.click();
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }

  private buildScene(hardware: HardwareProfile): void {
    this.scene.fog = new THREE.FogExp2(PAPER, 0.021);
    this.scene.add(new THREE.HemisphereLight(0xfff2cf, 0x204b3c, 2.5));
    const key = new THREE.DirectionalLight(0xffe6b3, 3.4);
    key.position.set(-2, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(19, 11),
      new THREE.MeshStandardMaterial({ color: 0xd9cfb9, roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.08;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(19, 38, 0x68816d, 0xaeb6a3);
    grid.position.y = -1.06;
    (grid.material as THREE.Material).opacity = 0.22;
    (grid.material as THREE.Material).transparent = true;
    this.scene.add(grid);

    this.scene.add(this.storyGroup, this.hardwareGroup);
    this.buildStory(hardware);
    this.buildHardware(hardware);
  }

  private buildStory(hardware: HardwareProfile): void {
    this.buildStoryHbm();
    this.buildGate(-1.95, 1.35);
    this.buildGate(-0.25, 1.05);
    this.buildGate(1.15, 0.82);
    this.buildComputeBloom();
    this.storyGroup.add(this.makeTube(this.storyPath, 0.12, INK));
    this.buildParcels(this.storyGroup, this.storyParcels, this.storyPath, 32, 0.34);

    this.addLabel('story', 'hbm', new THREE.Vector3(-4.35, 3.05, 0), 'HBM', `${hardware.hbmCapacityGB} GB · ${hardware.hbmBandwidthTBs} TB/s`);
    this.addLabel('story', 'l2', new THREE.Vector3(-1.95, 2.15, 0), 'L2 / Infinity Cache', `${hardware.lastLevelCacheMB} MB`);
    this.addLabel('story', 'shared', new THREE.Vector3(-0.25, 1.9, 0), 'Shared / LDS', 'tile staging');
    this.addLabel('story', 'registers', new THREE.Vector3(1.15, 1.55, 0), 'Registers', 'operands');
    this.addLabel('story', 'compute', new THREE.Vector3(3.65, 3.0, 0), hardware.vendor === 'AMD' ? 'Matrix cores · MFMA' : 'Tensor cores · MMA', `${hardware.fp16DenseTflops.toFixed(0)} TFLOP/s FP16`);
  }

  private buildStoryHbm(): void {
    this.hbmStacks.position.set(-4.45, 0.75, 0);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 3.65, 1.6),
      new THREE.MeshStandardMaterial({ color: DARK_GREEN, roughness: 0.55, metalness: 0.35 }),
    );
    frame.castShadow = true;
    this.hbmStacks.add(frame);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        const stack = new THREE.Mesh(
          new THREE.BoxGeometry(0.82, 0.52, 1.78),
          new THREE.MeshStandardMaterial({ color: MUSTARD, roughness: 0.48, metalness: 0.25 }),
        );
        stack.position.set((col - 0.5) * 1.02, (row - 1.5) * 0.78, 0.06);
        stack.castShadow = true;
        this.hbmStacks.add(stack);
      }
    }
    this.storyGroup.add(this.hbmStacks);
    this.registerHotspot('hbm', this.hbmStacks);
  }

  private buildGate(x: number, scale: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0.3, 0);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 2.3 * scale, 1.15 * scale),
      new THREE.MeshStandardMaterial({ color: GREEN, roughness: 0.55, metalness: 0.18 }),
    );
    body.position.y = 0.55;
    body.castShadow = true;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55 * scale, 0.11, 12, 48),
      new THREE.MeshStandardMaterial({ color: MUSTARD, roughness: 0.45, metalness: 0.35 }),
    );
    ring.rotation.y = Math.PI / 2;
    ring.position.set(0.15, 0.55, 0);
    group.add(body, ring);
    this.storyGroup.add(group);
    const stage: HardwareStage = x < -1 ? 'l2' : x < 1 ? 'shared' : 'registers';
    this.registerHotspot(stage, group);
  }

  private buildComputeBloom(): void {
    this.computeBloom.position.set(3.6, 0.55, 0);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.26, 3.2, 18),
      new THREE.MeshStandardMaterial({ color: GREEN, roughness: 0.76 }),
    );
    stem.rotation.z = -0.32;
    stem.position.set(-0.42, -0.75, 0);
    stem.castShadow = true;

    const jawMaterial = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.52 });
    const jawGeometry = new THREE.SphereGeometry(1.15, 36, 24, 0, Math.PI, 0, Math.PI / 2);
    const upper = new THREE.Mesh(jawGeometry, jawMaterial);
    upper.scale.set(1.35, 0.7, 0.72);
    upper.castShadow = true;
    this.upperJaw.add(upper);
    this.upperJaw.position.y = 1.25;
    const lower = new THREE.Mesh(jawGeometry, jawMaterial.clone());
    lower.scale.set(1.35, 0.7, 0.72);
    lower.rotation.x = Math.PI;
    lower.castShadow = true;
    this.lowerJaw.add(lower);
    this.lowerJaw.position.y = 1.1;

    const toothMaterial = new THREE.MeshStandardMaterial({ color: 0xffedc2, roughness: 0.8 });
    for (let index = 0; index < 6; index += 1) {
      const upperTooth = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.28, 5), toothMaterial);
      upperTooth.position.set(-0.63 + index * 0.25, -0.18, 0.53);
      upperTooth.rotation.x = Math.PI;
      this.upperJaw.add(upperTooth);
      const lowerTooth = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.23, 5), toothMaterial);
      lowerTooth.position.set(-0.52 + index * 0.22, 0.15, 0.52);
      this.lowerJaw.add(lowerTooth);
    }

    const mouth = new THREE.Mesh(
      new THREE.SphereGeometry(0.84, 28, 18),
      new THREE.MeshStandardMaterial({ color: 0x431d1b, roughness: 0.86 }),
    );
    mouth.scale.set(1.45, 0.48, 0.62);
    mouth.position.set(-0.08, 1.18, 0);
    this.computeBloom.add(stem, mouth, this.upperJaw, this.lowerJaw);

    const leafMaterial = new THREE.MeshStandardMaterial({ color: DARK_GREEN, side: THREE.DoubleSide, roughness: 0.78 });
    [-1, 1].forEach((direction) => {
      const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.75, 24), leafMaterial);
      leaf.scale.set(1.8, 0.55, 1);
      leaf.position.set(-0.5 + direction * 0.65, -0.6, 0);
      leaf.rotation.set(-Math.PI / 2.6, 0, direction * 0.45);
      this.computeBloom.add(leaf);
    });
    this.storyGroup.add(this.computeBloom);
    this.registerHotspot('compute', this.computeBloom);
  }

  private buildHardware(hardware: HardwareProfile): void {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(7.4, 0.24, 5.2),
      new THREE.MeshStandardMaterial({ color: 0x294b3e, roughness: 0.72, metalness: 0.12 }),
    );
    board.position.set(0.45, -0.75, 0);
    board.receiveShadow = true;
    board.castShadow = true;
    this.hardwareGroup.add(board);

    const packageBoundary = this.makeBoundary([7.7, 1.35, 5.5], new THREE.Vector3(0.45, -0.18, 0), MUSTARD);
    this.hardwareGroup.add(packageBoundary);

    const die = new THREE.Mesh(
      new THREE.BoxGeometry(3.25, 0.52, 2.7),
      new THREE.MeshStandardMaterial({ color: SILICON, roughness: 0.4, metalness: 0.48 }),
    );
    die.position.set(0.55, -0.38, 0);
    die.castShadow = true;
    this.hardwareGroup.add(die);
    const dieBoundary = this.makeBoundary([3.5, 0.85, 2.95], new THREE.Vector3(0.55, -0.18, 0), RED);
    this.hardwareGroup.add(dieBoundary);

    const l2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.16, 2.42),
      new THREE.MeshStandardMaterial({ color: MUSTARD, roughness: 0.46, metalness: 0.25 }),
    );
    l2.position.set(-0.82, -0.03, 0);
    this.hardwareGroup.add(l2);
    this.registerHotspot('l2', l2);

    const commandProcessor = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.18, 0.62),
      new THREE.MeshStandardMaterial({ color: RED, roughness: 0.45, metalness: 0.3 }),
    );
    commandProcessor.position.set(-1.02, 0.02, 0.68);
    this.hardwareGroup.add(commandProcessor);
    this.registerHotspot('host', commandProcessor);

    const memoryControllers = new THREE.Group();
    for (const x of [-1.03, 2.13]) {
      for (let index = 0; index < 4; index += 1) {
        const controller = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.18, 0.44),
          new THREE.MeshStandardMaterial({ color: COPPER, roughness: 0.42, metalness: 0.55 }),
        );
        controller.position.set(x, 0.02, -0.84 + index * 0.56);
        memoryControllers.add(controller);
      }
    }
    this.hardwareGroup.add(memoryControllers);
    this.registerHotspot('hbm', memoryControllers);

    const cuArray = new THREE.Group();
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        const cell = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.09, 0.34),
          new THREE.MeshStandardMaterial({ color: col % 2 === 0 ? 0x76934c : 0x638041, roughness: 0.55 }),
        );
        cell.position.set(-0.25 + col * 0.37, -0.05, -0.85 + row * 0.43);
        cuArray.add(cell);
      }
    }
    this.hardwareGroup.add(cuArray);
    this.registerHotspot('compute', cuArray);

    const hbm = new THREE.Group();
    for (const side of [-1, 1]) {
      for (let index = 0; index < 4; index += 1) {
        const stack = new THREE.Mesh(
          new THREE.BoxGeometry(0.72, 0.68, 0.8),
          new THREE.MeshStandardMaterial({ color: 0x313a37, roughness: 0.35, metalness: 0.62 }),
        );
        stack.position.set(0.55 + side * 2.35, -0.25, -1.35 + index * 0.9);
        stack.castShadow = true;
        const band = new THREE.Mesh(
          new THREE.BoxGeometry(0.76, 0.09, 0.84),
          new THREE.MeshStandardMaterial({ color: COPPER, roughness: 0.38, metalness: 0.7 }),
        );
        band.position.copy(stack.position).add(new THREE.Vector3(0, 0.37, 0));
        hbm.add(stack, band);
      }
    }
    this.hardwareGroup.add(hbm);
    this.registerHotspot('hbm', hbm);

    const host = new THREE.Group();
    const hostBoard = new THREE.Mesh(
      new THREE.BoxGeometry(2.05, 0.22, 3.4),
      new THREE.MeshStandardMaterial({ color: 0x34564a, roughness: 0.68, metalness: 0.14 }),
    );
    host.add(hostBoard);
    const cpu = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.34, 0.95),
      new THREE.MeshStandardMaterial({ color: SILICON, roughness: 0.38, metalness: 0.48 }),
    );
    cpu.position.set(0, 0.27, 1.05);
    host.add(cpu);
    for (let index = 0; index < 6; index += 1) {
      const dimm = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.9, 2.65),
        new THREE.MeshStandardMaterial({ color: index % 2 ? 0x53754d : 0x6c8d58, roughness: 0.5 }),
      );
      dimm.position.set(-0.72 + index * 0.29, 0.5, 0);
      host.add(dimm);
    }
    host.position.set(-5.05, -0.42, 0);
    this.hardwareGroup.add(host);
    this.registerHotspot('host', host);

    const pcie = this.makeRouteLine(this.hostPath, COPPER, 0.92);
    this.hardwareGroup.add(pcie);
    this.registerHotspot('host', pcie);
    const commandLink = this.makeRouteLine(this.commandPath, RED, 0.82);
    this.hardwareGroup.add(commandLink);
    this.registerHotspot('host', commandLink);

    const exploded = new THREE.Group();
    const layers: Array<{ stage: HardwareStage; color: number; y: number; size: [number, number, number] }> = [
      { stage: 'shared', color: GREEN, y: 0.35, size: [1.35, 0.14, 1.1] },
      { stage: 'registers', color: MUSTARD, y: 0.85, size: [1.12, 0.14, 0.9] },
      { stage: 'compute', color: RED, y: 1.35, size: [0.9, 0.22, 0.68] },
    ];
    layers.forEach((layer) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...layer.size),
        new THREE.MeshStandardMaterial({ color: layer.color, roughness: 0.42, metalness: 0.3 }),
      );
      mesh.position.y = layer.y;
      mesh.castShadow = true;
      exploded.add(mesh);
      this.registerHotspot(layer.stage, mesh);
    });
    exploded.position.set(3.25, 0.05, 0);
    this.hardwareGroup.add(exploded);

    const lanes = new THREE.Group();
    for (let index = 0; index < 128; index += 1) {
      const lane = new THREE.Mesh(
        new THREE.BoxGeometry(0.065, 0.055, 0.065),
        new THREE.MeshStandardMaterial({ color: index % 32 === 0 ? MUSTARD : RED, roughness: 0.35, metalness: 0.2 }),
      );
      lane.position.set((index % 16 - 7.5) * 0.075, 1.52, (Math.floor(index / 16) - 3.5) * 0.075);
      lanes.add(lane);
      this.laneMeshes.push(lane);
    }
    lanes.position.set(3.25, 0.05, 0);
    this.hardwareGroup.add(lanes);
    this.registerHotspot('compute', lanes);

    this.hardwareGroup.add(this.makeRouteLine(this.hardwarePath, MUSTARD, 0.9));
    this.buildParcels(this.hardwareGroup, this.hardwareParcels, this.hardwarePath, 24, 0.2);
    this.buildParcels(this.hardwareGroup, this.hostParcels, this.hostPath, 14, 0.22, RED);
    this.buildParcels(this.hardwareGroup, this.commandParcels, this.commandPath, 9, 0.1, RED);

    this.addLabel('hardware', 'host', new THREE.Vector3(-5.05, 1.62, 0), 'Host computer', 'CPU + system RAM · outside accelerator');
    this.addLabel('hardware', 'package-boundary', new THREE.Vector3(-2.45, 0.86, 2.42), 'Accelerator package', 'big green board · holds HBM + GPU die');
    this.addLabel('hardware', 'die-boundary', new THREE.Vector3(0.55, 0.92, -1.28), 'GPU die · central silicon chip', hardware.architecture);
    this.addLabel('hardware', 'command-processor', new THREE.Vector3(-1.15, 0.82, 0.72), 'Command processor', 'launch descriptor → workgroup grid');
    this.addLabel('hardware', 'memory-controllers', new THREE.Vector3(2.08, 0.75, 1.1), 'Memory controllers', 'HBM channels enter at the die edge');
    this.addLabel('hardware', 'hbm', new THREE.Vector3(-2.45, 1.0, -1.55), 'HBM stacks · fast memory', `${hardware.hbmCapacityGB} GB · ${hardware.hbmBandwidthTBs} TB/s`);
    this.addLabel('hardware', 'l2', new THREE.Vector3(-0.85, 0.75, 0), 'L2', `${hardware.l2CacheMB} MB`);
    this.addLabel('hardware', 'compute-array', new THREE.Vector3(0.85, 1.2, 0.8), 'Repeated worker blocks', `${hardware.unitCount} ${hardware.unitName}s on the GPU die`);
    this.addLabel('hardware', 'unit-cutaway', new THREE.Vector3(3.45, 2.45, 0.8), 'One SM / CU · enlarged', 'local memory → registers → math units');
    this.addLabel('hardware', 'shared-capacity', new THREE.Vector3(2.65, 0.75, 1.35), 'Shared memory / LDS', `${hardware.sharedMemoryKB} KB per ${hardware.unitName}`);
    this.addLabel('hardware', 'register-capacity', new THREE.Vector3(3.25, 1.9, 0), 'Register file', `${hardware.registerFileKB} KB per ${hardware.unitName}`);
  }

  private buildParcels(
    group: THREE.Group,
    destination: THREE.Mesh[],
    path: THREE.CatmullRomCurve3,
    count: number,
    size: number,
    fixedColor?: number,
  ): void {
    const geometry = new THREE.BoxGeometry(size, size * 0.72, size * 0.76);
    for (let index = 0; index < count; index += 1) {
      const color = fixedColor ?? (index % 4 === 0 ? RED : MUSTARD);
      const parcel = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.1, roughness: 0.4 }),
      );
      parcel.castShadow = true;
      parcel.userData.offset = index / count;
      parcel.userData.path = path;
      destination.push(parcel);
      group.add(parcel);
    }
  }

  private makeTube(path: THREE.CatmullRomCurve3, radius: number, color: number): THREE.Mesh {
    const pipe = new THREE.Mesh(
      new THREE.TubeGeometry(path, 100, radius, 12, false),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 }),
    );
    pipe.castShadow = true;
    return pipe;
  }

  private makeRouteLine(path: THREE.CatmullRomCurve3, color: number, opacity: number): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints(path.getPoints(96));
    const route = new THREE.Line(
      geometry,
      new THREE.LineDashedMaterial({ color, dashSize: 0.18, gapSize: 0.12, opacity, transparent: true }),
    );
    route.computeLineDistances();
    return route;
  }

  private makeBoundary(size: [number, number, number], position: THREE.Vector3, color: number): THREE.Group {
    const geometry = new THREE.BoxGeometry(...size);
    const shell = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide }),
    );
    const edges = new THREE.EdgesGeometry(geometry);
    const outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.78 }),
    );
    const boundary = new THREE.Group();
    boundary.add(shell, outline);
    boundary.position.copy(position);
    return boundary;
  }

  private registerHotspot(stage: HardwareStage, object: THREE.Object3D): void {
    const list = this.hotspots.get(stage) ?? [];
    list.push(object);
    this.hotspots.set(stage, list);
  }

  private setEmissive(object: THREE.Object3D, color: number, intensity: number): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.emissive.setHex(color);
          material.emissiveIntensity = intensity;
        }
      });
    });
  }

  private addLabel(
    view: ViewMode,
    stage: string,
    position: THREE.Vector3,
    eyebrow: string,
    value: string,
  ): void {
    const element = document.createElement('div');
    element.className = 'scene-label';
    element.dataset.stage = stage;
    element.dataset.view = view;
    element.innerHTML = `<span>${eyebrow}</span><strong>${value}</strong>`;
    this.labelLayer.append(element);
    this.labels.push({ element, position, view });
  }

  private resize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    this.clock.update();
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (!this.paused && !this.reducedMotion) this.phaseOffset += delta;
    this.animateParcels(this.storyParcels, this.settings.phase === 'prefill' ? 32 : Math.min(32, 5 + Math.round(Math.log2(this.settings.batch)) * 3), this.settings.phase === 'prefill' ? 0.18 : 0.09 + Math.log2(this.settings.batch) * 0.015);
    this.animateParcels(this.hardwareParcels, this.activeStage === 'host' ? 0 : this.settings.phase === 'prefill' ? 24 : Math.min(24, 4 + Math.round(Math.log2(this.settings.batch)) * 3), this.settings.phase === 'prefill' ? 0.2 : 0.1 + Math.log2(this.settings.batch) * 0.012);
    this.animateParcels(this.hostParcels, this.selectedKernelHostBytes > 0 ? this.hostParcels.length : 0, 0.055);
    this.animateParcels(this.commandParcels, this.commandParcels.length, 0.16);
    this.animateBloom();
    this.animateCamera();
    this.controls.update();
    this.render();
  };

  private animateParcels(parcels: THREE.Mesh[], visibleCount: number, speed: number): void {
    parcels.forEach((parcel, index) => {
      parcel.visible = index < visibleCount;
      if (!parcel.visible) return;
      const progress = (Number(parcel.userData.offset) + this.phaseOffset * speed) % 1;
      const path = parcel.userData.path as THREE.CatmullRomCurve3;
      const point = path.getPointAt(progress);
      const tangent = path.getTangentAt(progress);
      parcel.position.copy(point);
      parcel.rotation.y = Math.atan2(tangent.x, tangent.z);
      parcel.scale.setScalar(0.9 + Math.sin((progress + this.phaseOffset) * Math.PI * 6) * 0.08);
    });
  }

  private animateBloom(): void {
    if (this.settings.view !== 'story') return;
    const waiting = this.result.bottleneck !== 'compute';
    const cadence = this.settings.phase === 'prefill' ? 3.2 : 1.4 + Math.log2(this.settings.batch + 1) * 0.22;
    const bite = (Math.sin(this.phaseOffset * cadence) + 1) / 2;
    const openness = waiting ? 0.35 + bite * 0.26 : 0.12 + bite * 0.13;
    this.upperJaw.rotation.z = -0.12 - openness;
    this.lowerJaw.rotation.z = 0.1 + openness;
  }

  private animateCamera(): void {
    if (!this.destination) return;
    const amount = this.reducedMotion ? 1 : 0.055;
    this.camera.position.lerp(this.destination.position, amount);
    this.controls.target.lerp(this.destination.target, amount);
    if (this.camera.position.distanceTo(this.destination.position) < 0.02 && this.controls.target.distanceTo(this.destination.target) < 0.02) {
      this.destination = null;
    }
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    for (const label of this.labels) {
      const stage = label.element.dataset.stage ?? '';
      const contextualHardwareLabel =
        (stage === 'command-processor' && this.activeStage !== 'host') ||
        (stage === 'memory-controllers' && this.activeStage !== 'hbm') ||
        (stage === 'l2' && this.activeStage !== 'l2') ||
        (stage === 'compute-array' && this.activeStage !== 'compute') ||
        (stage === 'shared-capacity' && this.activeStage !== 'shared') ||
        (stage === 'register-capacity' && this.activeStage !== 'registers') ||
        ((stage === 'lanes' || stage === 'compute') && this.activeStage !== 'compute');
      if (label.view !== this.settings.view || (label.view === 'hardware' && contextualHardwareLabel)) {
        label.element.hidden = true;
        continue;
      }
      const projected = label.position.clone().project(this.camera);
      label.element.hidden = projected.z >= 1;
      label.element.style.transform = `translate(-50%, -50%) translate(${(projected.x * 0.5 + 0.5) * width}px, ${(-projected.y * 0.5 + 0.5) * height}px)`;
    }
  }
}

function formatCompact(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}
