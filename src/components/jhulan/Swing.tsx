import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { SWING_URL } from "@/lib/models";
import { LadduGopal } from "./LadduGopal";

useGLTF.preload(SWING_URL);

const MAX_ANGLE = (45 * Math.PI) / 180;
const PENDULUM_LENGTH = 1.7; // m, chain length used in pendulum math
const GRAVITY = 9.81;
const DAMPING = 0.55; // angular damping coefficient (per second)

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
 * Custom pendulum swing. The GLB is split into two groups:
 *   - Stand (static): posts, crossbar, base — never moves.
 *   - Swing assembly (dynamic): two chains + seat — rotates about the
 *     midpoint of the two top chain anchors on the crossbar.
 *
 * The pendulum is simulated analytically (angle + angular velocity) and the
 * moving group is rotated about Z only (forward/backward), never sideways.
 * Laddu Gopal is parented to the moving group so he follows the seat.
 */
export function Swing({ onBellChime, onGrab, onRelease, reducedMotion }: SwingProps) {
  const gltf = useGLTF(SWING_URL);
  const { camera, gl } = useThree();

  const {
    staticNode,
    dynamicNode,
    pivotWorld,
    seatWorldY,
    chainAnchorsLocal,
    chainLength,
    targetHeight,
  } = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    // Normalize so the whole swing is ~3.6m tall.
    const targetHeight = 3.6;
    const scale = size.y > 0 ? targetHeight / size.y : 1;
    root.scale.setScalar(scale);
    root.position.sub(center.multiplyScalar(scale));
    root.updateMatrixWorld(true);

    const bbox2 = new THREE.Box3().setFromObject(root);
    const height = bbox2.max.y - bbox2.min.y;

    // Pivot: where chains attach to the crossbar. The stand occupies the top
    // ~22% of the model (crossbar + posts); chains hang below it.
    const pivotY = bbox2.max.y - height * 0.22;

    const staticGroup = new THREE.Group();
    const dynamicGroup = new THREE.Group();

    // Name hints for the static (stand) parts. Anything matching stays fixed.
    const staticHints = /stand|frame|pillar|pole|post|base|leg|top|beam|cross|bar|arch|support|mount/i;
    // Name hints for the moving (swing) parts.
    const dynamicHints = /chain|rope|seat|plank|board|swing|hang|sling|cradle/i;

    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const box = new THREE.Box3().setFromObject(obj);
      const c = new THREE.Vector3();
      box.getCenter(c);

      let isStatic: boolean;
      if (staticHints.test(obj.name)) isStatic = true;
      else if (dynamicHints.test(obj.name)) isStatic = false;
      else isStatic = c.y >= pivotY - 0.05; // fallback: split by height

      // Bake world transform into the clone so re-parenting doesn't shift it.
      obj.updateWorldMatrix(true, false);
      const clone = obj.clone(true);
      clone.matrix.copy(obj.matrixWorld);
      clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
      clone.castShadow = true;
      clone.receiveShadow = true;
      if (clone.material instanceof THREE.MeshStandardMaterial) {
        clone.material.envMapIntensity = 1.1;
      }

      if (isStatic) staticGroup.add(clone);
      else dynamicGroup.add(clone);
    });

    // Pivot = midpoint of the two top chain anchors (symmetric about X=0).
    const anchorSpread = Math.max(0.3, size.x * scale * 0.18);
    const pivotWorld = new THREE.Vector3(0, pivotY, 0);
    const seatWorldY = bbox2.min.y + height * 0.38;
    const chainAnchorsLocal = [
      new THREE.Vector3(-anchorSpread, 0, 0),
      new THREE.Vector3(anchorSpread, 0, 0),
    ];
    const chainLength = Math.max(1.2, pivotY - seatWorldY);

    return {
      staticNode: staticGroup,
      dynamicNode: dynamicGroup,
      pivotWorld,
      seatWorldY,
      chainAnchorsLocal,
      chainLength,
      targetHeight,
    };
  }, [gltf]);

  // --- Pendulum state ------------------------------------------------------
  // The moving group's origin is placed at the pivot; its content is offset
  // so the GLB geometry stays in world space. We rotate the group about Z.
  const angleRef = useRef(0);
  const angVelRef = useRef(0);
  const movingGroupRef = useRef<THREE.Group>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [hoverRope, setHoverRope] = useState<null | "left" | "right">(null);
  const dragState = useRef<DragState | null>(null);
  const lastChimeSignRef = useRef(0);
  const shakeRef = useRef(0);

  // Physics step: simple damped pendulum (semi-implicit Euler).
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30); // clamp for stability
    if (isDragging) return; // drag controls angle directly

    // θ'' = -(g/L) sin θ - b θ'
    const angAcc = -(GRAVITY / PENDULUM_LENGTH) * Math.sin(angleRef.current) - DAMPING * angVelRef.current;
    angVelRef.current += angAcc * dt;
    angleRef.current += angVelRef.current * dt;

    // Hard clamp to keep it within a sane range; absorb velocity at the limit.
    if (angleRef.current > MAX_ANGLE) {
      angleRef.current = MAX_ANGLE;
      if (angVelRef.current > 0) angVelRef.current *= -0.35;
    } else if (angleRef.current < -MAX_ANGLE) {
      angleRef.current = -MAX_ANGLE;
      if (angVelRef.current < 0) angVelRef.current *= -0.35;
    }

    // Bell chime when crossing a limit with momentum.
    const sign = Math.sign(angleRef.current);
    if (Math.abs(angleRef.current) >= MAX_ANGLE - 0.005 && sign !== 0 && sign !== lastChimeSignRef.current && Math.abs(angVelRef.current) > 0.2) {
      onBellChime?.();
      lastChimeSignRef.current = sign;
    } else if (Math.abs(angleRef.current) < MAX_ANGLE - 0.05) {
      lastChimeSignRef.current = 0;
    }

    // Apply rotation to the moving group (Z axis only — forward/backward).
    if (movingGroupRef.current) {
      movingGroupRef.current.rotation.z = angleRef.current;
    }

    // Decay shake.
    shakeRef.current = Math.max(0, shakeRef.current - dt * 4);
  });

  // --- Pointer interaction -------------------------------------------------
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
    // Map ~260px drag to full MAX_ANGLE. Dragging right pushes the swing
    // forward (negative angle by convention); invert if it feels reversed.
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
    // Convert last drag velocity into angular velocity (release momentum).
    // Negative because dragging right (positive velX) should swing forward.
    const angVel = -s.velX * 4;
    angVelRef.current = THREE.MathUtils.clamp(angVel, -8, 8);
    onRelease?.(Math.abs(angVelRef.current));
  };

  useEffect(() => {
    if (isDragging) return;
    gl.domElement.style.cursor = hoverRope ? "grab" : "auto";
  }, [hoverRope, isDragging, gl]);

  // Rope interaction hitboxes live inside the moving group so they rotate
  // with the swing and stay aligned with the visible chains.
  const ropeHitLength = chainLength + 0.2;

  return (
    <group>
      {/* Static stand: posts, crossbar, base — never rotates. */}
      <primitive object={staticNode} />

      {/* Moving swing assembly: chains + seat, pivots about the crossbar. */}
      <group ref={movingGroupRef} position={[pivotWorld.x, pivotWorld.y, pivotWorld.z]}>
        {/* Offset content back so GLB geometry stays in world space. */}
        <group position={[-pivotWorld.x, -pivotWorld.y, -pivotWorld.z]}>
          <primitive object={dynamicNode} />
        </group>

        {/* Rope interaction hitboxes (invisible, thicker than the visual rope). */}
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
              {/* Visible glow on hover. */}
              {hoverRope === side && !isDragging && (
                <mesh position={[anchor.x, -chainLength / 2, anchor.z]}>
                  <cylinderGeometry args={[0.06, 0.06, chainLength, 12]} />
                  <meshBasicMaterial color="#FFE9A6" transparent opacity={0.35} depthWrite={false} toneMapped={false} />
                </mesh>
              )}
            </group>
          );
        })}

        {/* Laddu Gopal: parented to the moving group so he follows the seat. */}
        <group position={[-pivotWorld.x, seatWorldY - pivotWorld.y + 0.05, -pivotWorld.z]}>
          <LadduGopal targetHeight={targetHeight * 0.32} reducedMotion={reducedMotion} shakeRef={shakeRef} />
        </group>
      </group>
    </group>
  );
}
