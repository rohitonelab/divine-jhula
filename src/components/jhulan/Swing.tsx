/**
 * Swing.tsx — Temple Jhulan scene component
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
 * Pivot = top of assembly bounding box (chain attachment point on crossbar).
 * Rotation is ONLY on the forward/backward axis (auto-detected from GLB size).
 * Y-rotation is always zero. Stand never receives any transform.
 *
 * PHYSICS
 * ═══════
 * Damped pendulum — semi-implicit Euler:  θ'' = −(g/L)·sin(θ) − b·θ'
 *
 * INTERACTION
 * ═══════════
 * 1. Invisible hit-box over the full assembly (seat / chains / Gopal).
 * 2. Visible pull-rope hanging from the front of the seat — dragging it
 *    DOWN pulls the swing toward the viewer; releasing imparts momentum.
 *    The rope stretches visually while being pulled and springs back.
 */

import { useEffect, useRef, useState, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { STAND_URL, SWING_ASSEMBLY_URL } from "@/lib/models";

useGLTF.preload(STAND_URL);
useGLTF.preload(SWING_ASSEMBLY_URL);

// ── Physics constants ────────────────────────────────────────────────────────
const MAX_ANGLE   = (38 * Math.PI) / 180;
const GRAVITY     = 9.81;
const DAMPING     = 0.42;
const INITIAL_ANG = 0.18;   // small push on load

// ── Pull-rope geometry ───────────────────────────────────────────────────────
const ROPE_LEN        = 0.65;   // visual length of the hanging rope (world units)
const ROPE_RADIUS_TOP = 0.018;
const ROPE_RADIUS_BOT = 0.024;
const KNOT_RADIUS     = 0.052;

// ── Colours ──────────────────────────────────────────────────────────────────
const ROPE_COLOR_IDLE  = "#C8953A";   // warm jute gold
const ROPE_COLOR_HOVER = "#FFD060";   // bright gold on hover
const KNOT_COLOR_IDLE  = "#A07030";
const KNOT_COLOR_HOVER = "#FFB830";

// ── Types ────────────────────────────────────────────────────────────────────
type DragState = {
  startY    : number;
  startAngle: number;
  lastY     : number;
  lastT     : number;
  velY      : number;
};

interface SwingProps {
  onBellChime?: () => void;
  onGrab?     : () => void;
  onRelease?  : (velocity: number) => void;
  reducedMotion?: boolean;
}

// ── Helper ───────────────────────────────────────────────────────────────────
function cloneWithShadows(scene: THREE.Group): THREE.Group {
  const clone = scene.clone(true);
  clone.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.castShadow    = true;
    obj.receiveShadow = true;
    if (obj.material instanceof THREE.MeshStandardMaterial) {
      obj.material                 = obj.material.clone();
      obj.material.envMapIntensity = 1.1;
    }
  });
  return clone;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────
export function Swing({ onBellChime, onGrab, onRelease, reducedMotion }: SwingProps) {
  const standGltf    = useGLTF(STAND_URL);
  const assemblyGltf = useGLTF(SWING_ASSEMBLY_URL);
  const { gl }       = useThree();

  // ── Geometry prep (once) ──────────────────────────────────────────────────
  const { standScene, assemblyScene, pivotY, chainLength, swingAxis, ropeAttach } =
    useMemo(() => {
      const standScene    = cloneWithShadows(standGltf.scene);
      const assemblyScene = cloneWithShadows(assemblyGltf.scene);

      const bbox = new THREE.Box3().setFromObject(assemblyScene);
      const size = new THREE.Vector3();
      bbox.getSize(size);

      const pivotY      = bbox.max.y;
      const chainLength = Math.max(0.5, size.y * 0.85);
      const swingAxis: "x" | "z" = size.x >= size.z ? "x" : "z";

      /**
       * ropeAttach — position of the rope top in movingGroupRef local space.
       *
       * movingGroupRef sits at world (0, pivotY, 0).
       * The inner offset group is at (0, -pivotY, 0) inside it, so the
       * assembly geometry world-positions map 1-to-1 to local coords like:
       *   local_y = world_y − pivotY
       *
       * We attach the rope to the front-bottom of the assembly:
       *   y  ≈ seat level  = bbox.min.y − pivotY  (bottom of assembly in local)
       *   z  ≈ front face  = bbox.max.z            (toward the camera)
       *   (if swingAxis=z, the "front" face is max.x instead)
       */
      const seatLocalY = bbox.min.y - pivotY + size.y * 0.12; // slightly above floor of assembly
      const frontLocalZ = swingAxis === "x" ? bbox.max.z : bbox.max.x;

      const ropeAttach = new THREE.Vector3(0, seatLocalY, frontLocalZ);

      if (import.meta.env.DEV) {
        console.log(
          "[Swing] bbox size:", size,
          "| pivotY:", pivotY.toFixed(2),
          "| chainLen:", chainLength.toFixed(2),
          "| swingAxis:", swingAxis,
          "| ropeAttach:", ropeAttach,
        );
      }

      return { standScene, assemblyScene, pivotY, chainLength, swingAxis, ropeAttach };
    }, [standGltf, assemblyGltf]);

  // ── Pendulum state ────────────────────────────────────────────────────────
  const angleRef       = useRef(INITIAL_ANG);
  const angVelRef      = useRef(0);
  const movingGroupRef = useRef<THREE.Group>(null);
  const lastChimeSign  = useRef(0);

  // ── Drag state ────────────────────────────────────────────────────────────
  const [isDragging,  setIsDragging]  = useState(false);
  const [ropeHover,   setRopeHover]   = useState(false);
  const dragState = useRef<DragState | null>(null);

  // ── Rope visual refs ──────────────────────────────────────────────────────
  const ropeMeshRef = useRef<THREE.Mesh>(null);
  const knotMeshRef = useRef<THREE.Mesh>(null);
  const ropeMatRef  = useRef<THREE.MeshStandardMaterial>(null);
  const knotMatRef  = useRef<THREE.MeshStandardMaterial>(null);
  // How far the knot currently hangs below the attachment point (animated)
  const ropeLenRef  = useRef(ROPE_LEN);

  // ── Physics + rope animation frame loop ──────────────────────────────────
  useFrame((_, delta) => {
    if (reducedMotion) return;
    const dt = Math.min(delta, 1 / 30);

    // ── Pendulum integration ──────────────────────────────────────────────
    if (!isDragging) {
      const angAcc =
        -(GRAVITY / Math.max(0.5, chainLength)) * Math.sin(angleRef.current) -
        DAMPING * angVelRef.current;
      angVelRef.current += angAcc * dt;
      angleRef.current  += angVelRef.current * dt;

      if (angleRef.current > MAX_ANGLE) {
        angleRef.current = MAX_ANGLE;
        if (angVelRef.current > 0) angVelRef.current *= -0.35;
      } else if (angleRef.current < -MAX_ANGLE) {
        angleRef.current = -MAX_ANGLE;
        if (angVelRef.current < 0) angVelRef.current *= -0.35;
      }

      const sign = Math.sign(angleRef.current);
      if (
        Math.abs(angleRef.current) >= MAX_ANGLE - 0.006 &&
        sign !== 0 && sign !== lastChimeSign.current &&
        Math.abs(angVelRef.current) > 0.15
      ) {
        onBellChime?.();
        lastChimeSign.current = sign;
      } else if (Math.abs(angleRef.current) < MAX_ANGLE - 0.06) {
        lastChimeSign.current = 0;
      }
    }

    // Apply rotation (only swing axis, others locked to 0)
    if (movingGroupRef.current) {
      const r = movingGroupRef.current.rotation;
      if (swingAxis === "x") { r.x = angleRef.current; r.y = 0; r.z = 0; }
      else                   { r.x = 0; r.y = 0; r.z = angleRef.current; }
    }

    // ── Rope tension animation ────────────────────────────────────────────
    // When pulled: rope stretches 15% longer; on release: springs back.
    const targetLen = isDragging ? ROPE_LEN * 1.15 : ROPE_LEN;
    const lerpSpeed = isDragging ? 0.18 : 0.10;
    ropeLenRef.current = THREE.MathUtils.lerp(ropeLenRef.current, targetLen, lerpSpeed);

    if (ropeMeshRef.current) {
      // Scale the cylinder along Y to simulate stretch
      ropeMeshRef.current.scale.y = ropeLenRef.current / ROPE_LEN;
      // Reposition so the top stays fixed at ropeAttach.y
      ropeMeshRef.current.position.y = -ropeLenRef.current / 2;
    }
    if (knotMeshRef.current) {
      knotMeshRef.current.position.y = -ropeLenRef.current - KNOT_RADIUS * 0.5;
    }

    // Colour transition on hover / drag
    const targetRopeColor = ropeHover || isDragging ? ROPE_COLOR_HOVER : ROPE_COLOR_IDLE;
    const targetKnotColor = ropeHover || isDragging ? KNOT_COLOR_HOVER : KNOT_COLOR_IDLE;
    if (ropeMatRef.current) ropeMatRef.current.color.set(targetRopeColor);
    if (knotMatRef.current) knotMatRef.current.color.set(targetKnotColor);
  });

  // ── Drag handlers ─────────────────────────────────────────────────────────
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
    const s = dragState.current;

    // Drag DOWN → swing toward viewer (positive angle)
    const dy     = e.clientY - s.startY;
    const target = THREE.MathUtils.clamp(s.startAngle + dy / 280, -MAX_ANGLE, MAX_ANGLE);
    angleRef.current  = target;
    angVelRef.current = 0;

    if (movingGroupRef.current) {
      const r = movingGroupRef.current.rotation;
      if (swingAxis === "x") { r.x = target; r.y = 0; r.z = 0; }
      else                   { r.x = 0; r.y = 0; r.z = target; }
    }

    const now = performance.now();
    s.velY = (e.clientY - s.lastY) / Math.max(1, now - s.lastT);
    s.lastY = e.clientY;
    s.lastT = now;
  };

  const endDrag = (e?: ThreeEvent<PointerEvent>) => {
    if (!isDragging) return;
    e?.stopPropagation?.();
    setIsDragging(false);
    gl.domElement.style.cursor = ropeHover ? "grab" : "auto";

    const s = dragState.current;
    dragState.current = null;
    if (!s) return;
    angVelRef.current = THREE.MathUtils.clamp(s.velY * 3.5, -6, 6);
    onRelease?.(Math.abs(angVelRef.current));
  };

  useEffect(() => {
    if (!isDragging) gl.domElement.style.cursor = ropeHover ? "grab" : "auto";
  }, [isDragging, ropeHover, gl]);

  // ── Hitbox size ───────────────────────────────────────────────────────────
  const hitW = swingAxis === "x" ? 1.4 : 0.8;
  const hitD = swingAxis === "x" ? 0.8 : 1.4;

  return (
    <group>
      {/* ── STATIC STAND — never moves ──────────────────────────────────── */}
      <primitive object={standScene} />

      {/*
       * ── MOVING SWING ASSEMBLY ─────────────────────────────────────────
       * Pivot group at (0, pivotY, 0) — rotation here swings everything
       * below it like a pendulum from the crossbar.
       * Inner offset group restores world-space positions before rotation.
       */}
      <group ref={movingGroupRef} position={[0, pivotY, 0]}>
        {/* Assembly GLB (Gopal + seat + chains) */}
        <group position={[0, -pivotY, 0]}>
          <primitive object={assemblyScene} />
        </group>

        {/* ── PULL ROPE ───────────────────────────────────────────────────
          * Hangs from the front of the seat in movingGroupRef local space.
          * ropeAttach.y is already expressed in this space (world_y − pivotY).
          * Dragging the rope down pulls the swing toward the viewer.
          */}
        <group position={[ropeAttach.x, ropeAttach.y, ropeAttach.z]}>

          {/* Visible rope — tapered cylinder with jute texture colours */}
          <mesh ref={ropeMeshRef} position={[0, -ROPE_LEN / 2, 0]} castShadow>
            <cylinderGeometry args={[ROPE_RADIUS_TOP, ROPE_RADIUS_BOT, ROPE_LEN, 10, 1]} />
            <meshStandardMaterial
              ref={ropeMatRef}
              color={ROPE_COLOR_IDLE}
              roughness={0.92}
              metalness={0.0}
            />
          </mesh>

          {/* Knot / pull-handle sphere at the bottom */}
          <mesh ref={knotMeshRef} position={[0, -ROPE_LEN - KNOT_RADIUS * 0.5, 0]} castShadow>
            <sphereGeometry args={[KNOT_RADIUS, 14, 12]} />
            <meshStandardMaterial
              ref={knotMatRef}
              color={KNOT_COLOR_IDLE}
              roughness={0.88}
              metalness={0.05}
            />
          </mesh>

          {/*
           * Invisible hit cylinder — large enough to be easy to grab on
           * both desktop (mouse) and mobile (touch). Covers rope + knot.
           * Pointer events drive the pendulum interaction.
           */}
          <mesh
            position={[0, -(ROPE_LEN + KNOT_RADIUS) / 2, 0]}
            onPointerOver={(e) => {
              e.stopPropagation();
              setRopeHover(true);
              gl.domElement.style.cursor = "grab";
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              setRopeHover(false);
              if (!isDragging) gl.domElement.style.cursor = "auto";
            }}
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <cylinderGeometry args={[0.10, 0.10, ROPE_LEN + KNOT_RADIUS * 2 + 0.1, 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>

        {/* Invisible hit-box over the full assembly (seat / chains / Gopal) */}
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
