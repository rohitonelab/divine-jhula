/**
 * Swing.tsx — Temple Jhulan (temple swing) scene component
 *
 * ARCHITECTURE
 * ════════════
 * Two separate GLB assets:
 *   • stand.glb                  — wooden/metal stand frame. NEVER moves.
 *   • laddugopalsittingonseat.glb — Laddu Gopal + seat + both chains.
 *                                   Treated as ONE rigid body.
 *
 * SWING MOTION
 * ════════════
 * Only the assembly (Gopal + seat + chains) rotates.
 * The pivot is the top of the assembly bounding box — the point where the
 * chains attach to the stand's crossbar.
 *
 * We rotate ONLY around the FORWARD/BACKWARD axis (local X or Z depending
 * on how the GLB is oriented — see swingAxis auto-detection below).
 * Y-rotation is always zero. The stand never receives any transform.
 *
 * PHYSICS
 * ═══════
 * Damped pendulum — semi-implicit Euler integration:
 *   θ'' = −(g / L) · sin(θ) − b · θ'
 *
 * INTERACTION
 * ═══════════
 * Drag (mouse or touch) on the invisible hit-box over the assembly pulls
 * the swing. Vertical screen drag (up/down) maps to the pendulum angle.
 * On release, accumulated screen velocity becomes angular velocity so the
 * swing continues with realistic momentum.
 */

import { useEffect, useRef, useState, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { STAND_URL, SWING_ASSEMBLY_URL } from "@/lib/models";

// Pre-fetch both GLBs so they are ready before the Suspense boundary resolves
useGLTF.preload(STAND_URL);
useGLTF.preload(SWING_ASSEMBLY_URL);

// ── Physics constants ────────────────────────────────────────────────────────
const MAX_ANGLE   = (38 * Math.PI) / 180; // ±38° max swing arc
const GRAVITY     = 9.81;                  // m/s²
const DAMPING     = 0.42;                  // light damping → long, realistic swing
const INITIAL_ANG = 0.18;                  // small push so it starts moving on load

// ── Drag state ───────────────────────────────────────────────────────────────
type DragState = {
  startY    : number;   // screen Y at drag-start
  startAngle: number;   // pendulum angle at drag-start
  lastY     : number;
  lastT     : number;
  velY      : number;   // current screen-space velocity (px/ms)
};

// ── Props ────────────────────────────────────────────────────────────────────
interface SwingProps {
  onBellChime?: () => void;
  onGrab?     : () => void;
  onRelease?  : (velocity: number) => void;
  reducedMotion?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: clone a GLTF scene with shadows enabled on every mesh
// ────────────────────────────────────────────────────────────────────────────
function cloneWithShadows(scene: THREE.Group): THREE.Group {
  const clone = scene.clone(true);
  clone.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.castShadow    = true;
    obj.receiveShadow = true;
    if (obj.material instanceof THREE.MeshStandardMaterial) {
      obj.material             = obj.material.clone();
      obj.material.envMapIntensity = 1.1;
    }
  });
  return clone;
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────
export function Swing({ onBellChime, onGrab, onRelease, reducedMotion }: SwingProps) {
  const standGltf    = useGLTF(STAND_URL);
  const assemblyGltf = useGLTF(SWING_ASSEMBLY_URL);
  const { gl }       = useThree();

  // ── One-time geometry preparation ─────────────────────────────────────────
  const { standScene, assemblyScene, pivotY, chainLength, swingAxis } =
    useMemo(() => {
      const standScene    = cloneWithShadows(standGltf.scene);
      const assemblyScene = cloneWithShadows(assemblyGltf.scene);

      // Bounding box of the moving assembly in its default (world-upright) pose
      const bbox    = new THREE.Box3().setFromObject(assemblyScene);
      const size    = new THREE.Vector3();
      bbox.getSize(size);

      // Pivot = very top of the assembly (chain attachment point on crossbar)
      const pivotY = bbox.max.y;

      // Approximate chain length = ~85 % of the assembly's total height
      const chainLength = Math.max(0.5, size.y * 0.85);

      /**
       * AUTO-DETECT SWING AXIS
       * ──────────────────────
       * A real temple Jhula is wider left-to-right than it is front-to-back.
       * The forward/backward swing rotates about the left-to-right axis.
       *
       *   assembly wider in X  →  left/right is X  →  rotate around X axis
       *                            (swing moves in the Z / depth direction)
       *
       *   assembly wider in Z  →  left/right is Z  →  rotate around Z axis
       *                            (swing moves in the X direction)
       *
       * This handles GLBs that were exported rotated 90° around Y.
       */
      const swingAxis: "x" | "z" = size.x >= size.z ? "x" : "z";

      if (import.meta.env.DEV) {
        console.log(
          "[Swing] bbox size:", size,
          "| pivotY:", pivotY.toFixed(2),
          "| chainLen:", chainLength.toFixed(2),
          "| swingAxis:", swingAxis,
        );
      }

      return { standScene, assemblyScene, pivotY, chainLength, swingAxis };
    }, [standGltf, assemblyGltf]);

  // ── Pendulum state (refs → no re-render on each frame) ────────────────────
  const angleRef        = useRef(INITIAL_ANG); // current pendulum angle (rad)
  const angVelRef       = useRef(0);            // angular velocity (rad/s)
  const movingGroupRef  = useRef<THREE.Group>(null);
  const lastChimeSign   = useRef(0);

  const [isDragging, setIsDragging] = useState(false);
  const dragState       = useRef<DragState | null>(null);

  // ── Physics frame loop ─────────────────────────────────────────────────────
  useFrame((_, delta) => {
    if (reducedMotion) return;

    const dt = Math.min(delta, 1 / 30); // cap at 30 fps equivalent to avoid tunnelling

    // Integrate physics only when not dragging
    if (!isDragging) {
      // Damped pendulum equation
      const angAcc =
        -(GRAVITY / Math.max(0.5, chainLength)) * Math.sin(angleRef.current) -
        DAMPING * angVelRef.current;

      angVelRef.current += angAcc * dt;
      angleRef.current  += angVelRef.current * dt;

      // Soft clamp at max angle (elastic bounce)
      if (angleRef.current > MAX_ANGLE) {
        angleRef.current  =  MAX_ANGLE;
        if (angVelRef.current > 0) angVelRef.current *= -0.35;
      } else if (angleRef.current < -MAX_ANGLE) {
        angleRef.current  = -MAX_ANGLE;
        if (angVelRef.current < 0) angVelRef.current *= -0.35;
      }

      // Bell chime at the extreme of each swing arc
      const sign = Math.sign(angleRef.current);
      if (
        Math.abs(angleRef.current) >= MAX_ANGLE - 0.006 &&
        sign !== 0 &&
        sign !== lastChimeSign.current &&
        Math.abs(angVelRef.current) > 0.15
      ) {
        onBellChime?.();
        lastChimeSign.current = sign;
      } else if (Math.abs(angleRef.current) < MAX_ANGLE - 0.06) {
        lastChimeSign.current = 0;
      }
    }

    // Apply rotation to the moving group.
    // ONLY the swingAxis gets the angle — the other two axes are locked at 0.
    if (movingGroupRef.current) {
      const r = movingGroupRef.current.rotation;
      if (swingAxis === "x") {
        r.x = angleRef.current;
        r.y = 0;
        r.z = 0;
      } else {
        r.x = 0;
        r.y = 0;
        r.z = angleRef.current;
      }
    }
  });

  // ── Pointer / touch drag ───────────────────────────────────────────────────
  const beginDrag = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as Element)?.setPointerCapture?.(e.pointerId);
    setIsDragging(true);
    onGrab?.();
    dragState.current = {
      startY    : e.clientY,
      startAngle: angleRef.current,
      lastY     : e.clientY,
      lastT     : performance.now(),
      velY      : 0,
    };
    gl.domElement.style.cursor = "grabbing";
  };

  const moveDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging || !dragState.current) return;
    e.stopPropagation();
    const s  = dragState.current;

    // Drag DOWN on screen → swing forward (positive angle)
    // Drag UP  on screen → swing backward (negative angle)
    const dy  = e.clientY - s.startY;
    const target = THREE.MathUtils.clamp(
      s.startAngle + dy / 280,
      -MAX_ANGLE,
      MAX_ANGLE,
    );
    angleRef.current    = target;
    angVelRef.current   = 0;

    // Immediate visual feedback
    if (movingGroupRef.current) {
      const r = movingGroupRef.current.rotation;
      if (swingAxis === "x") { r.x = target; r.y = 0; r.z = 0; }
      else                   { r.x = 0;      r.y = 0; r.z = target; }
    }

    // Track velocity for release momentum
    const now  = performance.now();
    const ddy  = e.clientY - s.lastY;
    const ddt  = Math.max(1, now - s.lastT);
    s.velY  = ddy / ddt;
    s.lastY = e.clientY;
    s.lastT = now;
  };

  const endDrag = (e?: ThreeEvent<PointerEvent>) => {
    if (!isDragging) return;
    e?.stopPropagation?.();
    setIsDragging(false);
    gl.domElement.style.cursor = "auto";

    const s = dragState.current;
    dragState.current = null;
    if (!s) return;

    // Convert screen velocity (px/ms) → angular velocity (rad/s)
    // Positive screen-down velocity → positive angular velocity (forward arc)
    const angVel = s.velY * 3.5;
    angVelRef.current = THREE.MathUtils.clamp(angVel, -6, 6);
    onRelease?.(Math.abs(angVelRef.current));
  };

  // Reset cursor if pointer leaves the canvas while not dragging
  useEffect(() => {
    if (!isDragging) gl.domElement.style.cursor = "auto";
  }, [isDragging, gl]);

  // ── Hitbox dimensions ─────────────────────────────────────────────────────
  // A generous invisible box covering the full assembly so the user can grab
  // anywhere on the swing — seat, chains, or Gopal.
  const hitW = swingAxis === "x" ? 1.4 : 0.8;
  const hitD = swingAxis === "x" ? 0.8 : 1.4;

  return (
    <group>
      {/*
       * ── STATIC STAND ─────────────────────────────────────────────────────
       * Rendered at origin, never receives any rotation or physics transform.
       */}
      <primitive object={standScene} />

      {/*
       * ── MOVING SWING ASSEMBLY ────────────────────────────────────────────
       *
       * Pivot group: positioned at pivotY (chain attachment point).
       *   Rotation applied here swings the whole assembly about that point.
       *
       * Inner offset group: translates geometry back down by pivotY so that
       *   the assembly appears at its original world-space position before
       *   any rotation is applied.
       *
       * This means: rotation.x = θ  swings the chains + seat + Gopal
       * forward/backward like a real pendulum from the crossbar above.
       *
       * The stand is a sibling group — it is NEVER inside this hierarchy
       * and therefore never affected by the rotation.
       */}
      <group ref={movingGroupRef} position={[0, pivotY, 0]}>
        <group position={[0, -pivotY, 0]}>
          <primitive object={assemblyScene} />
        </group>

        {/*
         * Invisible drag hitbox — a box that covers the full assembly.
         * Pointer events on this mesh drive the pendulum interaction.
         * It rotates with the assembly so the grab area always follows the swing.
         */}
        <mesh
          position={[0, -chainLength / 2, 0]}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <boxGeometry args={[hitW, chainLength + 0.5, hitD]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}
