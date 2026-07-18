import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { SWING_URL } from "@/lib/models";
import { LadduGopal } from "./LadduGopal";

useGLTF.preload(SWING_URL);

const MAX_ANGLE = (45 * Math.PI) / 180;
const GRAVITY = 9.81;
const DAMPING = 0.55; // angular damping per second

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

/**
 * Classify a single mesh as part of the static stand or the moving swing assembly.
 *
 * Strategy (in order):
 *  1. Name-based hints — works when the GLB author used descriptive names.
 *  2. Span detection — a mesh that extends from near the ground all the way up
 *     to (or past) the crossbar pivot is a structural post → STATIC.
 *  3. Above-pivot check — anything whose centre is at or above the pivot is
 *     crossbar / top-frame → STATIC.
 *  4. Thin & tall → rope / chain → DYNAMIC.
 *  5. Wide & flat, low in the model → seat / plank → DYNAMIC.
 *  6. Conservative default → STATIC (keeps the stand fixed even when uncertain).
 */
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

  // Geometry fallback
  const box = new THREE.Box3().setFromObject(mesh);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const boxSize = new THREE.Vector3();
  box.getSize(boxSize);

  const modelSize = new THREE.Vector3();
  modelBbox.getSize(modelSize);
  const H = modelSize.y; // total model height

  // ── Span check ────────────────────────────────────────────────────────────
  // Stand posts run from near the ground all the way up toward the crossbar.
  // A mesh whose top reaches the pivot region AND whose bottom is within the
  // lower third of the model is almost certainly a structural post → STATIC.
  const topNearPivot = box.max.y >= roughPivotY - H * 0.18;
  const rootedLow = box.min.y <= modelBbox.min.y + H * 0.35;
  if (topNearPivot && rootedLow) return "static";

  // ── Above-pivot check ─────────────────────────────────────────────────────
  if (center.y >= roughPivotY - H * 0.04) return "static";

  // ── Below-pivot geometry checks ───────────────────────────────────────────
  // Rope / chain: thin in XZ, tall in Y
  const maxXZ = Math.max(boxSize.x, boxSize.z);
  const isThinAndTall = maxXZ < H * 0.08 && boxSize.y > H * 0.08;
  if (isThinAndTall) return "dynamic";

  // Seat / plank: wide & flat, well below the pivot
  const isFlat = boxSize.y < boxSize.x * 0.5 && boxSize.y < H * 0.12;
  if (isFlat && center.y < roughPivotY - H * 0.18) return "dynamic";

  // Default → STATIC (conservative; prevents the stand from moving)
  return "static";
}

/**
 * Compute the world-space bounding box of meshes collected in a plain
 * THREE.Group whose children already have their world matrices baked into
 * their local position/quaternion/scale (via matrixWorld decompose).
 */
function groupBbox(group: THREE.Group): THREE.Box3 {
  const out = new THREE.Box3();
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh) || !child.geometry) continue;
    child.geometry.computeBoundingBox();
    if (!child.geometry.boundingBox) continue;
    const b = child.geometry.boundingBox.clone().applyMatrix4(child.matrix);
    out.union(b);
  }
  return out;
}

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
    const centre0 = new THREE.Vector3();
    bbox0.getCenter(centre0);
    root.scale.setScalar(scale);
    root.position.sub(centre0.multiplyScalar(scale));
    root.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(root);
    const modelSize = new THREE.Vector3();
    bbox.getSize(modelSize);
    const H = modelSize.y; // should be ≈ 3.6

    // ── 2. Rough pivot estimate for first-pass classification ────────────────
    // The crossbar sits in the top ~20-25 % of the model.
    const roughPivotY = bbox.max.y - H * 0.22;

    // ── 3. Collect all meshes with their baked world transforms ─────────────
    const staticGroup = new THREE.Group();
    const dynamicGroup = new THREE.Group();

    const debugInfo: { name: string; kind: string; cy: string }[] = [];

    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.updateWorldMatrix(true, false);

      const kind = classifyMesh(obj, bbox, roughPivotY);

      // Bake world transform so re-parenting doesn't shift the geometry.
      const clone = obj.clone(false);
      clone.matrix.copy(obj.matrixWorld);
      clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
      clone.matrixAutoUpdate = true; // let Three.js keep it updated
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
        `[Swing] static=${staticGroup.children.length}  dynamic=${dynamicGroup.children.length}  roughPivotY=${roughPivotY.toFixed(2)}`,
      );
    }

    // ── 4. Compute the real pivot from the top of the dynamic assembly ───────
    // The chains' topmost point is where they attach to the crossbar.
    const dynBbox = groupBbox(dynamicGroup);
    let realPivotY: number;
    if (!dynBbox.isEmpty()) {
      realPivotY = dynBbox.max.y;
    } else {
      // Fallback if nothing was classified as dynamic (e.g. all meshes unnamed)
      realPivotY = roughPivotY;
      // In this case, treat everything as potentially dynamic by re-running
      // with the default-to-dynamic flag — better to have the swing move than
      // nothing moves at all.  Re-classify: move all non-span, non-above meshes.
      staticGroup.children.slice().forEach((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const b = new THREE.Box3().setFromObject(child);
        const c = new THREE.Vector3();
        b.getCenter(c);
        const s = new THREE.Vector3();
        b.getSize(s);
        const maxXZ = Math.max(s.x, s.z);
        const isThinEnough = maxXZ < H * 0.09;
        const isBelowPivot = c.y < roughPivotY - H * 0.04;
        if (isThinEnough && isBelowPivot) {
          staticGroup.remove(child);
          dynamicGroup.add(child);
        }
      });
    }

    // Anchor spread: symmetric about X=0, ~18 % of model width
    const anchorSpread = Math.max(0.3, modelSize.x * 0.18);

    // Seat is roughly at the bottom 15 % of the chain span
    const dynBbox2 = groupBbox(dynamicGroup);
    const seatWorldY = dynBbox2.isEmpty()
      ? bbox.min.y + H * 0.38
      : dynBbox2.min.y + (dynBbox2.max.y - dynBbox2.min.y) * 0.15;

    const chainLength = Math.max(1.0, realPivotY - seatWorldY);

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

  // ── Pendulum state ────────────────────────────────────────────────────────
  const angleRef = useRef(0);
  const angVelRef = useRef(0);
  const movingGroupRef = useRef<THREE.Group>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [hoverRope, setHoverRope] = useState<null | "left" | "right">(null);
  const dragState = useRef<DragState | null>(null);
  const lastChimeSignRef = useRef(0);
  const shakeRef = useRef(0);

  // ── Physics tick (semi-implicit Euler damped pendulum) ────────────────────
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30);
    if (isDragging) return;

    // θ'' = −(g/L)·sin θ − b·θ'
    const angAcc =
      -(GRAVITY / Math.max(0.5, chainLength)) * Math.sin(angleRef.current) -
      DAMPING * angVelRef.current;
    angVelRef.current += angAcc * dt;
    angleRef.current += angVelRef.current * dt;

    // Hard-limit + elastic bounce at extremes
    if (angleRef.current > MAX_ANGLE) {
      angleRef.current = MAX_ANGLE;
      if (angVelRef.current > 0) angVelRef.current *= -0.35;
    } else if (angleRef.current < -MAX_ANGLE) {
      angleRef.current = -MAX_ANGLE;
      if (angVelRef.current < 0) angVelRef.current *= -0.35;
    }

    // Bell chime at the apex
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

    // Apply forward/backward rotation ONLY (Z axis). Stand is never touched.
    if (movingGroupRef.current) {
      movingGroupRef.current.rotation.z = angleRef.current;
    }

    shakeRef.current = Math.max(0, shakeRef.current - dt * 4);
  });

  // ── Pointer interaction ───────────────────────────────────────────────────
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
    // ~260 px drag ≈ full MAX_ANGLE; negative because dragging right swings forward.
    const target = THREE.MathUtils.clamp(s.startAngle - dx / 260, -MAX_ANGLE, MAX_ANGLE);
    angleRef.current = target;
    angVelRef.current = 0;
    if (movingGroupRef.current) movingGroupRef.current.rotation.z = target;

    const now = performance.now();
    const ddx = e.clientX - s.lastX;
    const ddt = Math.max(1, now - s.lastT);
    s.velX = ddx / ddt; // px/ms
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
    // Release momentum: convert last pointer velocity → angular velocity
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
       * ── STATIC STAND ───────────────────────────────────────────────────
       * Posts, crossbar, base, arch — this group NEVER receives any rotation.
       * It is a sibling of the moving group, NOT a parent of it.
       */}
      <primitive object={staticNode} />

      {/*
       * ── MOVING SWING ASSEMBLY ──────────────────────────────────────────
       * The group's local origin sits at the chain attachment point on the
       * crossbar (the pivot).  Rotating around Z here is exactly a pendulum
       * swinging forward and backward about that point.
       *
       * Contents are shifted back down by pivotY so that the GLB geometry
       * (whose positions are in world-space) stays visually in place before
       * any rotation is applied.  After rotation every child (chains, seat,
       * Laddu Gopal) swings together as one rigid body.
       */}
      <group ref={movingGroupRef} position={[0, pivotY, 0]}>
        {/* Restore world-space positions of the dynamic meshes */}
        <group position={[0, -pivotY, 0]}>
          <primitive object={dynamicNode} />
        </group>

        {/*
         * Invisible interaction hitboxes for left & right chains.
         * They live inside the moving group so they automatically follow the
         * swing's current angle and stay aligned with the visible ropes.
         */}
        {(["left", "right"] as const).map((side, i) => {
          const anchor = chainAnchorsLocal[i];
          return (
            <group key={side}>
              {/* Hitbox cylinder centred on the chain */}
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

              {/* Subtle gold glow while hovering */}
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

        {/*
         * Laddu Gopal — parented to the moving group so he sits on the seat
         * and follows every swing automatically.
         * Position: seat surface height expressed in the pivot group's local space.
         */}
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
