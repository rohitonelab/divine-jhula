import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { SWING_URL } from "@/lib/models";
import { LadduGopal } from "./LadduGopal";

useGLTF.preload(SWING_URL);

const MAX_ANGLE = (45 * Math.PI) / 180;
const GRAVITY = 9.81;
const DAMPING = 0.55;

interface SwingProps {
  onBellChime?: () => void;
  onGrab?: () => void;
  onRelease?: (velocity: number) => void;
  reducedMotion?: boolean;
}

type DragState = {
  startX: number;
  startAngle: number;
  lastX: number;
  lastT: number;
  velX: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Geometry-level triangle split
// Used when the whole GLB is a single merged mesh (dynamic count = 0 after
// name-based pass).  We walk every triangle and classify it by the world-space
// position of its centroid plus its XZ and Y extents.
//
// Rules (centroid in world-space):
//   1. Above-pivot zone          → STATIC  (crossbar / arch)
//   2. Very-low zone (base/feet) → STATIC
//   3. Thin in XZ + in chain zone→ DYNAMIC (chain / rope)
//   4. Flat + mid-height + wide  → DYNAMIC (seat / plank)
//   5. Default                   → STATIC  (post segment, base, etc.)
// ─────────────────────────────────────────────────────────────────────────────

function buildSubGeometry(
  posAttr: THREE.BufferAttribute,
  normAttr: THREE.BufferAttribute | null,
  uvAttr: THREE.BufferAttribute | null,
  worldMatrix: THREE.Matrix4,
  tris: Array<[number, number, number]>,
): THREE.BufferGeometry {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
  const oldToNew = new Map<number, number>();
  const newPos: number[] = [];
  const newNorm: number[] = [];
  const newUv: number[] = [];
  const newIdx: number[] = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (const [ai, bi, ci] of tris) {
    for (const vi of [ai, bi, ci]) {
      if (!oldToNew.has(vi)) {
        const next = newPos.length / 3;
        oldToNew.set(vi, next);

        v.fromBufferAttribute(posAttr, vi).applyMatrix4(worldMatrix);
        newPos.push(v.x, v.y, v.z);

        if (normAttr) {
          n.fromBufferAttribute(normAttr, vi).applyMatrix3(normalMatrix).normalize();
          newNorm.push(n.x, n.y, n.z);
        }

        if (uvAttr) {
          newUv.push(uvAttr.getX(vi), uvAttr.getY(vi));
        }
      }
      newIdx.push(oldToNew.get(vi)!);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(newPos, 3));
  if (normAttr && newNorm.length) geom.setAttribute("normal", new THREE.Float32BufferAttribute(newNorm, 3));
  if (uvAttr && newUv.length) geom.setAttribute("uv", new THREE.Float32BufferAttribute(newUv, 2));
  if (newIdx.length) geom.setIndex(newIdx);
  geom.computeBoundingBox();
  return geom;
}

function splitMeshByRole(
  mesh: THREE.Mesh,
  modelBbox: THREE.Box3,
  roughPivotY: number,
): { staticMesh: THREE.Mesh; dynamicMesh: THREE.Mesh } {
  const geom = mesh.geometry as THREE.BufferGeometry;
  const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
  const wm = mesh.matrix; // already = matrixWorld (baked during first pass)

  const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
  const normAttr = (geom.getAttribute("normal") as THREE.BufferAttribute) ?? null;
  const uvAttr = (geom.getAttribute("uv") as THREE.BufferAttribute) ?? null;
  const idxAttr = geom.getIndex();

  const modelSize = new THREE.Vector3();
  modelBbox.getSize(modelSize);
  const H = modelSize.y;

  const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
  const getVert = (i: number) => (idxAttr ? idxAttr.getX(i) : i);

  const staticTris: Array<[number, number, number]> = [];
  const dynamicTris: Array<[number, number, number]> = [];

  const tmp = new THREE.Vector3();
  const wp = (vi: number) => {
    tmp.fromBufferAttribute(posAttr, vi).applyMatrix4(wm);
    return { x: tmp.x, y: tmp.y, z: tmp.z };
  };

  for (let t = 0; t < triCount; t++) {
    const ai = getVert(t * 3);
    const bi = getVert(t * 3 + 1);
    const ci = getVert(t * 3 + 2);
    const a = wp(ai), b = wp(bi), c = wp(ci);

    const centY = (a.y + b.y + c.y) / 3;
    const yExt = Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y);
    const xExt = Math.max(a.x, b.x, c.x) - Math.min(a.x, b.x, c.x);
    const zExt = Math.max(a.z, b.z, c.z) - Math.min(a.z, b.z, c.z);
    const maxXZ = Math.max(xExt, zExt);

    // 1. Above-pivot zone → STATIC (crossbar / arch / top frame)
    if (centY >= roughPivotY - H * 0.05) {
      staticTris.push([ai, bi, ci]);
      continue;
    }

    // 2. Base / feet zone (very low) → STATIC
    if (centY < modelBbox.min.y + H * 0.12) {
      staticTris.push([ai, bi, ci]);
      continue;
    }

    // 3. Thin in XZ, between base and pivot → DYNAMIC (chain / rope)
    //    Chains are typically ≤ 8 % of total model height in XZ diameter.
    if (maxXZ < H * 0.08 && centY < roughPivotY) {
      dynamicTris.push([ai, bi, ci]);
      continue;
    }

    // 4. Flat (small Y extent) + mid-height + has X width → DYNAMIC (seat / plank)
    if (
      yExt < H * 0.08 &&
      xExt > H * 0.05 &&
      centY < roughPivotY - H * 0.15 &&
      centY > modelBbox.min.y + H * 0.15
    ) {
      dynamicTris.push([ai, bi, ci]);
      continue;
    }

    // Default → STATIC
    staticTris.push([ai, bi, ci]);
  }

  if (import.meta.env.DEV) {
    console.log(
      `[Swing] triangle split — static:${staticTris.length}  dynamic:${dynamicTris.length}  total:${triCount}`,
    );
  }

  const matClone = mat.clone() as THREE.MeshStandardMaterial;
  if (matClone instanceof THREE.MeshStandardMaterial) matClone.envMapIntensity = 1.1;

  const makeMesh = (tris: Array<[number, number, number]>) => {
    const g = buildSubGeometry(posAttr, normAttr, uvAttr, wm, tris);
    const m = new THREE.Mesh(g, matClone);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  return { staticMesh: makeMesh(staticTris), dynamicMesh: makeMesh(dynamicTris) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mesh-level classifier (works when the GLB has separately named meshes)
// ─────────────────────────────────────────────────────────────────────────────

function classifyMesh(
  mesh: THREE.Mesh,
  modelBbox: THREE.Box3,
  roughPivotY: number,
): "static" | "dynamic" {
  const staticHints =
    /stand|frame|pillar|pole|post|base|leg|top|beam|cross|bar|arch|support|mount|column|vertical|side|struct|foundation|floor|wall|gate|door|jali|mandap/i;
  const dynamicHints =
    /chain|rope|seat|plank|board|swing|hang|sling|cradle|string|cord|bench|pad|cushion|jhula|jhoola|dola|palna/i;

  if (staticHints.test(mesh.name)) return "static";
  if (dynamicHints.test(mesh.name)) return "dynamic";

  const box = new THREE.Box3().setFromObject(mesh);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const boxSize = new THREE.Vector3();
  box.getSize(boxSize);

  const modelSize = new THREE.Vector3();
  modelBbox.getSize(modelSize);
  const H = modelSize.y;

  const topNearPivot = box.max.y >= roughPivotY - H * 0.18;
  const rootedLow = box.min.y <= modelBbox.min.y + H * 0.35;
  if (topNearPivot && rootedLow) return "static";
  if (center.y >= roughPivotY - H * 0.04) return "static";

  const maxXZ = Math.max(boxSize.x, boxSize.z);
  if (maxXZ < H * 0.08 && boxSize.y > H * 0.08) return "dynamic";

  const isFlat = boxSize.y < boxSize.x * 0.5 && boxSize.y < H * 0.12;
  if (isFlat && center.y < roughPivotY - H * 0.18) return "dynamic";

  return "static";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: tight bbox from a Group whose children have baked world positions
// ─────────────────────────────────────────────────────────────────────────────

function groupBbox(group: THREE.Group): THREE.Box3 {
  const out = new THREE.Box3();
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh) || !child.geometry) continue;
    child.geometry.computeBoundingBox();
    if (!child.geometry.boundingBox) continue;
    // child.matrix = world matrix (baked), so apply it to the local bbox
    out.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrix));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function Swing({ onBellChime, onGrab, onRelease, reducedMotion }: SwingProps) {
  const gltf = useGLTF(SWING_URL);
  const { gl } = useThree();

  const {
    staticNode,
    dynamicNode,
    pivotY,
    seatWorldY,
    chainAnchorsLocal,
    chainLength,
    targetHeight,
  } = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);

    // ── 1. Normalise to ~3.6 m tall ─────────────────────────────────────────
    const targetHeight = 3.6;
    const bbox0 = new THREE.Box3().setFromObject(root);
    const size0 = new THREE.Vector3();
    bbox0.getSize(size0);
    const scale = size0.y > 0 ? targetHeight / size0.y : 1;
    root.scale.setScalar(scale);
    root.position.sub(bbox0.getCenter(new THREE.Vector3()).multiplyScalar(scale));
    root.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(root);
    const modelSize = new THREE.Vector3();
    bbox.getSize(modelSize);
    const H = modelSize.y;

    // Rough pivot: top of model minus ~22 % (where crossbar sits)
    const roughPivotY = bbox.max.y - H * 0.22;

    // ── 2. First pass: classify by mesh name / whole-mesh geometry ───────────
    const staticGroup = new THREE.Group();
    const dynamicGroup = new THREE.Group();

    const debugInfo: { name: string; kind: string; cy: string }[] = [];

    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.updateWorldMatrix(true, false);

      const kind = classifyMesh(obj, bbox, roughPivotY);

      const clone = obj.clone(false);
      clone.matrix.copy(obj.matrixWorld);
      clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
      clone.castShadow = true;
      clone.receiveShadow = true;
      if (clone.material instanceof THREE.MeshStandardMaterial) {
        clone.material = clone.material.clone();
        clone.material.envMapIntensity = 1.1;
      }

      if (kind === "static") staticGroup.add(clone);
      else dynamicGroup.add(clone);

      if (import.meta.env.DEV) {
        const b = new THREE.Box3().setFromObject(obj);
        const c = new THREE.Vector3();
        b.getCenter(c);
        debugInfo.push({ name: obj.name || "(unnamed)", kind, cy: c.y.toFixed(2) });
      }
    });

    if (import.meta.env.DEV) {
      console.table(debugInfo);
      console.log(
        `[Swing] mesh-pass → static=${staticGroup.children.length}  dynamic=${dynamicGroup.children.length}  roughPivotY=${roughPivotY.toFixed(2)}`,
      );
    }

    // ── 3. Fallback: single merged mesh → split at triangle level ────────────
    if (dynamicGroup.children.length === 0 && staticGroup.children.length > 0) {
      if (import.meta.env.DEV) {
        console.log("[Swing] No dynamic meshes found — falling back to triangle-level split.");
      }

      // Process each mesh in the static group (usually just one for merged GLBs)
      const meshes = staticGroup.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
      for (const m of meshes) {
        staticGroup.remove(m);
        const { staticMesh, dynamicMesh } = splitMeshByRole(m, bbox, roughPivotY);
        staticGroup.add(staticMesh);
        if (dynamicMesh.geometry.getAttribute("position")?.count > 0) {
          dynamicGroup.add(dynamicMesh);
        }
      }

      if (import.meta.env.DEV) {
        console.log(
          `[Swing] triangle-pass → static=${staticGroup.children.length}  dynamic=${dynamicGroup.children.length}`,
        );
      }
    }

    // ── 4. Determine actual pivot from top of the dynamic geometry ───────────
    const dynBbox = groupBbox(dynamicGroup);
    const realPivotY = dynBbox.isEmpty() ? roughPivotY : dynBbox.max.y;

    // Seat: 15 % up from the bottom of the dynamic range
    const dynRange = dynBbox.isEmpty() ? null : dynBbox.max.y - dynBbox.min.y;
    const seatWorldY = dynBbox.isEmpty()
      ? bbox.min.y + H * 0.38
      : dynBbox.min.y + (dynRange! * 0.15);

    const chainLength = Math.max(1.0, realPivotY - seatWorldY);
    const anchorSpread = Math.max(0.3, modelSize.x * 0.18);
    const chainAnchorsLocal = [
      new THREE.Vector3(-anchorSpread, 0, 0),
      new THREE.Vector3(anchorSpread, 0, 0),
    ];

    if (import.meta.env.DEV) {
      console.log(
        `[Swing] pivotY=${realPivotY.toFixed(2)}  seatY=${seatWorldY.toFixed(2)}  chainLen=${chainLength.toFixed(2)}`,
      );
    }

    return {
      staticNode: staticGroup,
      dynamicNode: dynamicGroup,
      pivotY: realPivotY,
      seatWorldY,
      chainAnchorsLocal,
      chainLength,
      targetHeight,
    };
  }, [gltf]);

  // ── Pendulum state ──────────────────────────────────────────────────────────
  const angleRef = useRef(0);
  const angVelRef = useRef(0);
  const movingGroupRef = useRef<THREE.Group>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [hoverRope, setHoverRope] = useState<null | "left" | "right">(null);
  const dragState = useRef<DragState | null>(null);
  const lastChimeSignRef = useRef(0);
  const shakeRef = useRef(0);

  // ── Physics tick (semi-implicit Euler damped pendulum) ─────────────────────
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30);
    if (isDragging) return;

    const angAcc =
      -(GRAVITY / Math.max(0.5, chainLength)) * Math.sin(angleRef.current) -
      DAMPING * angVelRef.current;
    angVelRef.current += angAcc * dt;
    angleRef.current += angVelRef.current * dt;

    if (angleRef.current > MAX_ANGLE) {
      angleRef.current = MAX_ANGLE;
      if (angVelRef.current > 0) angVelRef.current *= -0.35;
    } else if (angleRef.current < -MAX_ANGLE) {
      angleRef.current = -MAX_ANGLE;
      if (angVelRef.current < 0) angVelRef.current *= -0.35;
    }

    const sign = Math.sign(angleRef.current);
    if (
      Math.abs(angleRef.current) >= MAX_ANGLE - 0.005 &&
      sign !== 0 &&
      sign !== lastChimeSignRef.current &&
      Math.abs(angVelRef.current) > 0.2
    ) {
      onBellChime?.();
      lastChimeSignRef.current = sign;
    } else if (Math.abs(angleRef.current) < MAX_ANGLE - 0.05) {
      lastChimeSignRef.current = 0;
    }

    if (movingGroupRef.current) {
      movingGroupRef.current.rotation.z = angleRef.current;
    }

    shakeRef.current = Math.max(0, shakeRef.current - dt * 4);
  });

  // ── Pointer interaction ────────────────────────────────────────────────────
  const beginDrag = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as Element)?.setPointerCapture?.(e.pointerId);
    setIsDragging(true);
    onGrab?.();
    dragState.current = {
      startX: e.clientX,
      startAngle: angleRef.current,
      lastX: e.clientX,
      lastT: performance.now(),
      velX: 0,
    };
    gl.domElement.style.cursor = "grabbing";
  };

  const moveDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging || !dragState.current) return;
    e.stopPropagation();
    const s = dragState.current;
    const dx = e.clientX - s.startX;
    const target = THREE.MathUtils.clamp(s.startAngle - dx / 260, -MAX_ANGLE, MAX_ANGLE);
    angleRef.current = target;
    angVelRef.current = 0;
    if (movingGroupRef.current) movingGroupRef.current.rotation.z = target;

    const now = performance.now();
    const ddx = e.clientX - s.lastX;
    const ddt = Math.max(1, now - s.lastT);
    s.velX = ddx / ddt;
    s.lastX = e.clientX;
    s.lastT = now;
    shakeRef.current = Math.min(1, Math.abs(ddx) * 0.05);
  };

  const endDrag = (e?: ThreeEvent<PointerEvent>) => {
    if (!isDragging) return;
    e?.stopPropagation?.();
    setIsDragging(false);
    gl.domElement.style.cursor = hoverRope ? "grab" : "auto";
    const s = dragState.current;
    dragState.current = null;
    shakeRef.current = 0;
    if (!s) return;
    const angVel = -s.velX * 4;
    angVelRef.current = THREE.MathUtils.clamp(angVel, -8, 8);
    onRelease?.(Math.abs(angVelRef.current));
  };

  useEffect(() => {
    if (isDragging) return;
    gl.domElement.style.cursor = hoverRope ? "grab" : "auto";
  }, [hoverRope, isDragging, gl]);

  const ropeHitLength = chainLength + 0.2;

  return (
    <group>
      {/*
       * ── STATIC STAND ─────────────────────────────────────────────────────
       * Posts, crossbar, base — NEVER receives any rotation.
       */}
      <primitive object={staticNode} />

      {/*
       * ── MOVING SWING ASSEMBLY ────────────────────────────────────────────
       * Origin at the chain attachment point on the crossbar (the pivot).
       * Rotating this group around Z swings the chains + seat forward/backward.
       * The inner offset group restores the world-space positions of the geometry
       * before any rotation is applied.
       */}
      <group ref={movingGroupRef} position={[0, pivotY, 0]}>
        <group position={[0, -pivotY, 0]}>
          <primitive object={dynamicNode} />
        </group>

        {/* Invisible hitbox cylinders on the chains for drag interaction */}
        {(["left", "right"] as const).map((side, i) => {
          const anchor = chainAnchorsLocal[i];
          return (
            <group key={side}>
              <mesh
                position={[anchor.x, -chainLength / 2, anchor.z]}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoverRope(side);
                }}
                onPointerOut={(e) => {
                  e.stopPropagation();
                  setHoverRope((h) => (h === side ? null : h));
                }}
                onPointerDown={beginDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <cylinderGeometry args={[0.14, 0.14, ropeHitLength, 8]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>

              {hoverRope === side && !isDragging && (
                <mesh position={[anchor.x, -chainLength / 2, anchor.z]}>
                  <cylinderGeometry args={[0.06, 0.06, chainLength, 12]} />
                  <meshBasicMaterial
                    color="#FFE9A6"
                    transparent
                    opacity={0.35}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
              )}
            </group>
          );
        })}

        {/* Laddu Gopal — parented to the moving group, follows the seat */}
        <group position={[0, seatWorldY - pivotY + 0.05, 0]}>
          <LadduGopal
            targetHeight={targetHeight * 0.32}
            reducedMotion={reducedMotion}
            shakeRef={shakeRef}
          />
        </group>
      </group>
    </group>
  );
}
