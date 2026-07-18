import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Slow-falling flower petals (marigold + lotus) and occasional glowing motes.
 * Uses a single instanced mesh for performance.
 */
export function Petals({ count = 90 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  const petals = useMemo(() => {
    return Array.from({ length: count }).map(() => ({
      x: (Math.random() - 0.5) * 22,
      y: Math.random() * 14 + 4,
      z: (Math.random() - 0.5) * 10 - 2,
      vy: 0.15 + Math.random() * 0.25,
      swayAmp: 0.4 + Math.random() * 0.7,
      swaySpeed: 0.3 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.6,
      rot: Math.random() * Math.PI * 2,
      scale: 0.06 + Math.random() * 0.08,
      hue: Math.random() > 0.5 ? "marigold" : "lotus",
    }));
  }, [count]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const t = performance.now() * 0.001;
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i];
      p.y -= p.vy * delta;
      p.rot += p.rotSpeed * delta;
      if (p.y < -3) {
        p.y = 12 + Math.random() * 3;
        p.x = (Math.random() - 0.5) * 22;
      }
      const sway = Math.sin(t * p.swaySpeed + p.phase) * p.swayAmp;
      dummy.position.set(p.x + sway, p.y, p.z);
      dummy.rotation.set(p.rot, p.rot * 0.6, p.rot * 0.3);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      color.set(p.hue === "marigold" ? "#F9A03F" : "#F7B6C2");
      meshRef.current.setColorAt(i, color);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  );
}

export function GlowMotes({ count = 30 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const { positions, sizes } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 1] = Math.random() * 8 + 0.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1;
      sizes[i] = 0.05 + Math.random() * 0.09;
    }
    return { positions, sizes };
  }, [count]);

  useFrame((_, delta) => {
    if (!ref.current) return;
    const arr = ref.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += delta * (0.08 + (i % 5) * 0.02);
      if (arr[i * 3 + 1] > 9) arr[i * 3 + 1] = 0.2;
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.12}
        color="#FFE7A3"
        transparent
        opacity={0.75}
        depthWrite={false}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}
