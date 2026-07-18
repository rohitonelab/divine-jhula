import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export interface FlowerBurstHandle {
  burst: () => void;
}

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  scale: number;
  rot: number;
  rotSpeed: number;
  color: THREE.Color;
}

/**
 * Tiny procedural flower-burst emitted when the swing is released.
 */
export const FlowerBurst = forwardRef<FlowerBurstHandle>((_, ref) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const MAX = 40;
  const particles = useRef<Particle[]>(
    Array.from({ length: MAX }).map(() => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      scale: 0,
      rot: 0,
      rotSpeed: 0,
      color: new THREE.Color("#F9A03F"),
    }))
  );

  useImperativeHandle(ref, () => ({
    burst: () => {
      let emitted = 0;
      for (const p of particles.current) {
        if (p.life > 0) continue;
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.6 + Math.random() * 1.2;
        p.pos.set(0, -0.4, 0);
        p.vel.set(Math.cos(angle) * speed, 0.5 + Math.random() * 1.4, Math.sin(angle) * speed * 0.6);
        p.life = 1.2 + Math.random() * 0.6;
        p.maxLife = p.life;
        p.scale = 0.08 + Math.random() * 0.06;
        p.rot = Math.random() * Math.PI;
        p.rotSpeed = (Math.random() - 0.5) * 4;
        p.color.set(Math.random() > 0.5 ? "#F9A03F" : "#F7B6C2");
        emitted++;
        if (emitted >= 18) break;
      }
    },
  }));

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    for (let i = 0; i < particles.current.length; i++) {
      const p = particles.current[i];
      if (p.life > 0) {
        p.vel.y -= 2.4 * delta; // gravity
        p.pos.addScaledVector(p.vel, delta);
        p.rot += p.rotSpeed * delta;
        p.life -= delta;
        const a = Math.max(0, p.life / p.maxLife);
        dummy.position.copy(p.pos);
        dummy.rotation.set(p.rot * 0.5, p.rot, p.rot * 0.3);
        dummy.scale.setScalar(p.scale * a);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        meshRef.current.setColorAt(i, p.color);
      } else {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial transparent opacity={0.95} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  );
});
FlowerBurst.displayName = "FlowerBurst";
