import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/** Soft sunrise sky sphere + temple silhouette + drifting fog. */
export function Sky() {
  const fogRef = useRef<THREE.Mesh>(null);

  const skyMaterial = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0.0, "#F9C266");
    gradient.addColorStop(0.35, "#F9A65B");
    gradient.addColorStop(0.65, "#F58A48");
    gradient.addColorStop(1.0, "#E56E33");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 512);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false });
  }, []);

  useFrame(({ clock }) => {
    if (fogRef.current) {
      const t = clock.getElapsedTime();
      fogRef.current.position.x = Math.sin(t * 0.05) * 2;
      (fogRef.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(t * 0.2) * 0.04;
    }
  });

  return (
    <group>
      <mesh scale={[500, 500, 500]} material={skyMaterial}>
        <sphereGeometry args={[1, 32, 32]} />
      </mesh>

      {/* Sun glow */}
      <mesh position={[0, 6, -40]}>
        <circleGeometry args={[4, 48]} />
        <meshBasicMaterial color="#FFE8B0" transparent opacity={0.75} depthWrite={false} fog={false} />
      </mesh>
      <mesh position={[0, 6, -40.1]}>
        <circleGeometry args={[9, 48]} />
        <meshBasicMaterial color="#FFD07A" transparent opacity={0.35} depthWrite={false} fog={false} />
      </mesh>

      {/* Temple silhouette (procedural) */}
      <TempleSilhouette />

      {/* Ground plane w/ warm haze */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.2, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color="#E5A56A" roughness={0.95} metalness={0} />
      </mesh>

      {/* Soft moving fog plane */}
      <mesh ref={fogRef} position={[0, -1.5, -12]}>
        <planeGeometry args={[80, 12]} />
        <meshBasicMaterial color="#FFE7B8" transparent opacity={0.2} depthWrite={false} fog={false} />
      </mesh>
    </group>
  );
}

function TempleSilhouette() {
  const shapes = useMemo(() => {
    const arr: { x: number; h: number; w: number }[] = [];
    for (let i = -3; i <= 3; i++) {
      arr.push({ x: i * 4.2, h: 3.5 + Math.abs(i) * 0.6 + (i === 0 ? 2.5 : 0), w: i === 0 ? 3.2 : 2.2 });
    }
    return arr;
  }, []);
  return (
    <group position={[0, -1, -25]}>
      {shapes.map((s, i) => (
        <group key={i} position={[s.x, 0, 0]}>
          <mesh position={[0, s.h / 2, 0]}>
            <boxGeometry args={[s.w, s.h, 0.5]} />
            <meshBasicMaterial color="#7A3821" transparent opacity={0.55} depthWrite={false} fog={false} />
          </mesh>
          <mesh position={[0, s.h + 0.6, 0]}>
            <coneGeometry args={[s.w * 0.55, 1.4, 8]} />
            <meshBasicMaterial color="#7A3821" transparent opacity={0.55} depthWrite={false} fog={false} />
          </mesh>
          <mesh position={[0, s.h + 1.7, 0]}>
            <sphereGeometry args={[0.18, 12, 12]} />
            <meshBasicMaterial color="#FFD57A" transparent opacity={0.9} depthWrite={false} fog={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
