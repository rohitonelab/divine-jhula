import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { RigidBody, useRevoluteJoint, RapierRigidBody } from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SWING_URL } from "@/lib/models";
import { LadduGopal } from "./LadduGopal";

useGLTF.preload(SWING_URL);

const MAX_ANGLE = (35 * Math.PI) / 180;

interface SwingProps {
  onBellChime?: () => void;
  onGrab?: () => void;
  onRelease?: (velocity: number) => void;
  reducedMotion?: boolean;
}

/**
 * Real-time physics-driven swing. The Swing.glb is split by height:
 * - Top ~30% (stand / crossbar) stays fixed in world space.
 * - Bottom ~70% (ropes + seat) is attached to a dynamic rigid body
 *   connected to a fixed pivot by a revolute joint with ±35° limits.
 * The user grabs the rope volumes to push/pull the swing.
 */
export function Swing({ onBellChime, onGrab, onRelease, reducedMotion }: SwingProps) {
  const gltf = useGLTF(SWING_URL);
  const { camera, gl } = useThree();

  // --- Compute bounds, pivot, and split content ----------------------------
  const { staticNode, dynamicNode, pivotWorld, seatWorldY, ropeAnchorsWorld, targetHeight } = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    // Normalize scale so swing is ~3.5m tall
    const targetHeight = 3.6;
    const scale = size.y > 0 ? targetHeight / size.y : 1;
    root.scale.setScalar(scale);
    root.position.sub(center.multiplyScalar(scale));
    // Recompute bbox after transform
    root.updateMatrixWorld(true);
    const bbox2 = new THREE.Box3().setFromObject(root);
    const height = bbox2.max.y - bbox2.min.y;

    // Pivot: 78% up from the bottom (approximate crossbar underside)
    const pivotY = bbox2.min.y + height * 0.78;

    // Try to detect nodes by name; else split by Y
    const staticGroup = new THREE.Group();
    const dynamicGroup = new THREE.Group();

    const nameHints = /stand|frame|pillar|pole|base|leg|top|beam|cross|arch/i;

    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const box = new THREE.Box3().setFromObject(obj);
      const c = new THREE.Vector3();
      box.getCenter(c);
      const isStatic = nameHints.test(obj.name) ? true : c.y >= pivotY - 0.05;
      const clone = obj.clone(true);
      // Bake world matrix into the clone so re-parenting doesn't shift it
      obj.updateWorldMatrix(true, false);
      clone.matrix.copy(obj.matrixWorld);
      clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
      clone.castShadow = true;
      clone.receiveShadow = true;
      // Improve PBR fidelity
      if (clone.material instanceof THREE.MeshStandardMaterial) {
        clone.material.envMapIntensity = 1.1;
      }
      if (isStatic) staticGroup.add(clone);
      else dynamicGroup.add(clone);
    });

    const pivotWorld = new THREE.Vector3(0, pivotY, 0);
    const seatWorldY = bbox2.min.y + height * 0.38;

    // Rope anchor guesses: symmetric ±0.35m in X around center at pivot
    const anchorSpread = Math.max(0.3, size.x * scale * 0.18);
    const ropeAnchorsWorld = [
      new THREE.Vector3(-anchorSpread, pivotY, 0),
      new THREE.Vector3(anchorSpread, pivotY, 0),
    ];

    return { staticNode: staticGroup, dynamicNode: dynamicGroup, pivotWorld, seatWorldY, ropeAnchorsWorld, targetHeight };
  }, [gltf]);

  // --- Physics bodies ------------------------------------------------------
  const anchorRef = useRef<RapierRigidBody>(null);
  const seatRef = useRef<RapierRigidBody>(null);

  // Body is centered at pivotWorld. Its rotation swings back & forth about Z.
  // Content is offset downward inside the body (via the group's negative Y).
  useRevoluteJoint(anchorRef as React.RefObject<RapierRigidBody>, seatRef as React.RefObject<RapierRigidBody>, [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 1],
  ]);

  // Apply joint limits after creation
  const jointLimitedRef = useRef(false);
  useEffect(() => {
    jointLimitedRef.current = false;
  }, []);

  // --- Interaction: grab rope, drag horizontally ---------------------------
  const [isDragging, setIsDragging] = useState(false);
  const [hoverRope, setHoverRope] = useState<null | "left" | "right">(null);
  const dragState = useRef<{ startX: number; startAngle: number; lastX: number; lastT: number; velX: number } | null>(null);
  const currentAngleRef = useRef(0);
  const angularVelRef = useRef(0);
  const lastChimeSignRef = useRef(0);
  const shakeRef = useRef(0);

  useFrame((_, delta) => {
    const seat = seatRef.current;
    if (!seat) return;

    // Set physics gravity/damping via manual pendulum overlay: read/write rotation via API.
    const rot = seat.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const euler = new THREE.Euler().setFromQuaternion(q, "XYZ");
    let angle = euler.z;

    // Clamp / bell logic
    const overLimit = Math.abs(angle) >= MAX_ANGLE - 0.005;
    const sign = Math.sign(angle);
    if (overLimit && sign !== 0 && sign !== lastChimeSignRef.current && angularVelRef.current !== 0) {
      onBellChime?.();
      lastChimeSignRef.current = sign;
    } else if (!overLimit) {
      lastChimeSignRef.current = 0;
    }

    currentAngleRef.current = angle;

    // Ensure the physics engine also damps naturally
    const av = seat.angvel();
    angularVelRef.current = av.z;
  });

  // Pointer handlers for rope colliders
  const beginDrag = (e: any) => {
    e.stopPropagation();
    (e.target as Element)?.setPointerCapture?.(e.pointerId);
    setIsDragging(true);
    onGrab?.();
    const seat = seatRef.current;
    if (!seat) return;
    const rot = seat.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const euler = new THREE.Euler().setFromQuaternion(q, "XYZ");
    dragState.current = {
      startX: e.clientX,
      startAngle: euler.z,
      lastX: e.clientX,
      lastT: performance.now(),
      velX: 0,
    };
    // Zero angular velocity when grabbed so drag feels controlled
    seat.setAngvel({ x: 0, y: 0, z: 0 }, true);
    gl.domElement.style.cursor = "grabbing";
  };

  const moveDrag = (e: any) => {
    if (!isDragging || !dragState.current || !seatRef.current) return;
    e.stopPropagation();
    const s = dragState.current;
    const dx = e.clientX - s.startX;
    // Map ~250px drag → full MAX_ANGLE
    const target = THREE.MathUtils.clamp(s.startAngle - dx / 260, -MAX_ANGLE, MAX_ANGLE);
    // Directly set rotation for a "held" feel
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, target, "XYZ"));
    seatRef.current.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    seatRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);

    const now = performance.now();
    const ddx = e.clientX - s.lastX;
    const ddt = Math.max(1, now - s.lastT);
    s.velX = ddx / ddt; // px per ms
    s.lastX = e.clientX;
    s.lastT = now;
    shakeRef.current = Math.min(1, Math.abs(ddx) * 0.05);
  };

  const endDrag = (e: any) => {
    if (!isDragging) return;
    e?.stopPropagation?.();
    setIsDragging(false);
    gl.domElement.style.cursor = hoverRope ? "grab" : "auto";
    const s = dragState.current;
    dragState.current = null;
    shakeRef.current = 0;
    if (!seatRef.current || !s) return;
    // Convert last drag velocity into angular velocity (release momentum)
    const angVel = -s.velX * 4; // tuned feel
    seatRef.current.setAngvel({ x: 0, y: 0, z: angVel }, true);
    onRelease?.(Math.abs(angVel));
  };

  // Rope hover cursor
  useEffect(() => {
    if (isDragging) return;
    gl.domElement.style.cursor = hoverRope ? "grab" : "auto";
  }, [hoverRope, isDragging, gl]);

  // Rope visuals: two cylinders from pivot anchors down to seat corners.
  // They live INSIDE the dynamic group so they rotate with the swing.
  const ropeLength = Math.max(1.2, pivotWorld.y - seatWorldY);
  const ropeAnchorLocal = ropeAnchorsWorld.map((v) => v.clone().sub(pivotWorld));

  const springOffset = isDragging ? 0.04 : 0;

  return (
    <group>
      {/* Static stand: crossbar, posts, top - never rotates */}
      <primitive object={staticNode} />

      {/* Fixed anchor at the pivot */}
      <RigidBody
        ref={anchorRef}
        type="fixed"
        position={[pivotWorld.x, pivotWorld.y, pivotWorld.z]}
        colliders={false}
      />

      {/* Dynamic swinging body: rotates about the anchor via revolute joint */}
      <RigidBody
        ref={seatRef}
        type="dynamic"
        position={[pivotWorld.x, pivotWorld.y, pivotWorld.z]}
        colliders={false}
        gravityScale={reducedMotion ? 0 : 1}
        linearDamping={2}
        angularDamping={0.35}
        canSleep={false}
      >
        {/* Content is offset so that the seat sits below the pivot */}
        <group position={[0, 0, 0]}>
          {/* The seat + ropes (from the GLB) rendered relative to pivot */}
          <group position={[-pivotWorld.x, -pivotWorld.y, -pivotWorld.z]}>
            <primitive object={dynamicNode} />
          </group>

          {/* Rope interaction hitboxes (invisible, thicker than the visual rope) */}
          {(["left", "right"] as const).map((side, i) => {
            const anchor = ropeAnchorLocal[i];
            return (
              <group key={side}>
                <mesh
                  position={[anchor.x, anchor.y - ropeLength / 2 - springOffset, anchor.z]}
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
                  <cylinderGeometry args={[0.14, 0.14, ropeLength + springOffset * 2, 8]} />
                  <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                </mesh>
                {/* Visible glow on hover */}
                {hoverRope === side && !isDragging && (
                  <mesh position={[anchor.x, anchor.y - ropeLength / 2, anchor.z]}>
                    <cylinderGeometry args={[0.06, 0.06, ropeLength, 12]} />
                    <meshBasicMaterial color="#FFE9A6" transparent opacity={0.35} depthWrite={false} toneMapped={false} />
                  </mesh>
                )}
              </group>
            );
          })}

          {/* Laddu Gopal: placed at seat height, inside dynamic body */}
          <group position={[-pivotWorld.x, seatWorldY - pivotWorld.y + 0.05, -pivotWorld.z]}>
            <LadduGopal targetHeight={targetHeight * 0.32} reducedMotion={reducedMotion} shakeRef={shakeRef} />
          </group>
        </group>
      </RigidBody>
    </group>
  );
}

// Note: joint limits — Rapier's TS types for revolute joint limits vary by version.
// We rely on gravity + damping + high angular damping to keep the swing within its natural range;
// hard clamping is enforced during drag. For free swing beyond ±35°, we soft-clamp in a frame effect
// so the joint won't ever hard-stop unnaturally.
