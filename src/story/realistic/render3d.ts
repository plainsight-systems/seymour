import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CutawayOptions, CutawayView } from '../cutaway/render';
import type { Plate } from '../cutaway/plates';
import type { SceneBox } from '../cutaway/scene';
import { SURFACES, surfaceFor, tintFor } from './surfaces';

// Realistic view of a plate: the same boxes, positions, and part ids as the
// isometric drawing, rendered with physically based materials. Plate x runs
// along world X, plate y along world Z, and plate z is world up (Y).

const SELECTED_EMISSIVE = new THREE.Color('#ff4a2a');

function materialFor(box: SceneBox): THREE.MeshPhysicalMaterial {
  const kind = surfaceFor(box);
  const spec = SURFACES[kind];
  const color = new THREE.Color(spec.color);
  if (kind === 'logic' || kind === 'sram') color.offsetHSL(tintFor(box) / 360, 0, 0);
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: spec.metalness,
    roughness: spec.roughness,
    clearcoat: spec.clearcoat,
    clearcoatRoughness: 0.2,
    transparent: spec.opacity < 1,
    opacity: spec.opacity,
    depthWrite: spec.opacity >= 1,
  });
}

function geometryFor(box: SceneBox): THREE.BufferGeometry {
  const smallest = Math.min(box.w, box.d, box.h);
  // Slightly rounded edges read as manufactured parts; tiny parts stay square.
  return smallest > 0.6
    ? new RoundedBoxGeometry(box.w, box.h, box.d, 2, Math.min(0.12, smallest * 0.2))
    : new THREE.BoxGeometry(box.w, box.h, box.d);
}

export function mountRealistic(host: HTMLElement, initial: Plate, ariaLabel: string, options: CutawayOptions = {}): CutawayView {
  let plate = initial;
  let picked: string | null = null;
  host.classList.add('rl-root');
  host.innerHTML = '';

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', `${ariaLabel} (realistic view)`);
  host.appendChild(renderer.domElement);
  const tooltip = document.createElement('div');
  tooltip.className = 'rl-tooltip';
  tooltip.hidden = true;
  host.appendChild(tooltip);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight('#fff4e6', 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 4;
  scene.add(key, new THREE.HemisphereLight('#eef2ff', '#3a3226', 0.5));

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minPolarAngle = Math.PI * 0.08;

  let group = new THREE.Group();
  scene.add(group);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const meshesByPart = new Map<string, THREE.Mesh[]>();
  const titleByPart = new Map<string, string>();

  function build(): void {
    scene.remove(group);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    group = new THREE.Group();
    meshesByPart.clear();
    titleByPart.clear();
    for (const label of plate.scene.labels) titleByPart.set(label.part, label.title);
    const labeled = new Set(titleByPart.keys());
    for (const box of plate.scene.boxes) {
      const mesh = new THREE.Mesh(geometryFor(box), materialFor(box));
      mesh.position.set(box.x + box.w / 2, box.z + box.h / 2, box.y + box.d / 2);
      mesh.castShadow = !box.ghost;
      mesh.receiveShadow = true;
      if (box.part && labeled.has(box.part)) {
        mesh.userData.part = box.part;
        const list = meshesByPart.get(box.part) ?? [];
        list.push(mesh);
        meshesByPart.set(box.part, list);
      }
      group.add(mesh);
    }
    // Center the plate and frame the camera on it.
    const bounds = new THREE.Box3().setFromObject(group);
    const center = bounds.getCenter(new THREE.Vector3());
    group.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
    scene.add(group);
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.62;
    ground.scale.set(radius * 6, radius * 6, 1);
    ground.position.y = -0.01;
    key.position.set(radius * 0.9, radius * 1.8, radius * 0.6);
    const shadowCamera = key.shadow.camera as THREE.OrthographicCamera;
    shadowCamera.left = shadowCamera.bottom = -radius * 1.4;
    shadowCamera.right = shadowCamera.top = radius * 1.4;
    shadowCamera.far = radius * 6;
    shadowCamera.updateProjectionMatrix();
    camera.position.set(radius * 1.8, radius * 1.6, radius * 1.8);
    controls.target.set(0, size.y * 0.3, 0);
    controls.minDistance = radius * 0.6;
    controls.maxDistance = radius * 5;
    controls.update();
    applySelection();
  }

  function applySelection(): void {
    for (const [part, meshes] of meshesByPart) {
      for (const mesh of meshes) {
        const material = mesh.material as THREE.MeshPhysicalMaterial;
        material.emissive.copy(part === picked ? SELECTED_EMISSIVE : new THREE.Color(0x000000));
        material.emissiveIntensity = part === picked ? 0.55 : 0;
      }
    }
  }

  function resize(): void {
    const width = host.clientWidth;
    if (width === 0) return;
    const height = Math.max(340, Math.min(640, Math.round(width * 0.62)));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  // Picking: a click (not a drag) on a labeled part selects it.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function partAt(event: PointerEvent): string | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    for (const hit of raycaster.intersectObjects(group.children, false)) {
      const part = hit.object.userData.part as string | undefined;
      const material = (hit.object as THREE.Mesh).material as THREE.Material;
      if (part) return part;
      if (material.opacity >= 1) return null;
    }
    return null;
  }
  let downAt: [number, number] | null = null;
  renderer.domElement.addEventListener('pointerdown', (event) => { downAt = [event.clientX, event.clientY]; });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 5) return;
    const part = partAt(event);
    picked = part && picked !== part ? part : null;
    applySelection();
    options.onSelect?.(picked);
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    const part = partAt(event);
    renderer.domElement.style.cursor = part ? 'pointer' : 'grab';
    tooltip.hidden = !part;
    if (part) {
      const rect = host.getBoundingClientRect();
      tooltip.textContent = titleByPart.get(part) ?? part;
      tooltip.style.left = `${event.clientX - rect.left + 14}px`;
      tooltip.style.top = `${event.clientY - rect.top + 14}px`;
    }
  });
  renderer.domElement.addEventListener('pointerleave', () => { tooltip.hidden = true; });

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  // Render only while displayed (hidden tabs have no layout box). Checked
  // every frame rather than via observers, which are unreliable for content
  // that starts out hidden.
  renderer.setAnimationLoop(() => {
    if (host.clientWidth === 0 || host.getClientRects().length === 0) return;
    if (renderer.domElement.width !== Math.round(host.clientWidth * renderer.getPixelRatio())) resize();
    controls.update();
    renderer.render(scene, camera);
  });

  resize();
  build();

  return {
    update(next: Plate): void {
      plate = next;
      if (picked && !plate.scene.labels.some((label) => label.part === picked)) {
        picked = null;
        options.onSelect?.(null);
      }
      build();
    },
    select(part: string | null): void {
      picked = part && meshesByPart.has(part) ? part : null;
      applySelection();
      options.onSelect?.(picked);
    },
    refresh(): void {
      resize();
      renderer.render(scene, camera);
    },
    destroy(): void {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      controls.dispose();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      scene.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
      host.classList.remove('rl-root');
      host.innerHTML = '';
    },
  };
}
