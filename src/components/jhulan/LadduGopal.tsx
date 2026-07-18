import { MutableRefObject, useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LADDU_URL } from "@/lib/models";

useGLTF.preload(LADDU_URL);

interface Props {
  targetHeight: number;
  reducedMotion?: boolean;
  shakeRef?: MutableRefObject<number>;
}

export function LadduGopal({ targetHeight, reducedMotion, shakeRef }: Props) {
  const gltf = useGLTF(LADDU_URL);
  const groupRef = useRef<THREE.Group>(null);
  const breatheRef = useRef<THREE.Group>(null);
  const eyeMeshes = useRef<THREE.Mesh[]>([]);

  const scene = useMemo(() => {
    const s = gltf.scene.clone(true);
    const bbox = new THREE.Box3().setFromObject(s);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const scale = size.y > 0 ? targetHeight / size.y : 1;
    s.scale.setScalar(scale);
    // Recenter so feet sit at y=0
    const bbox2 = new THREE.Box3().setFromObject(s);
    const c = new THREE.Vector3();
    bbox2.getCenter(c);
    s.position.set(-c.x, -bbox2.min.y, -c.z);

    // Collect potential eye meshes and enable shadows
    s.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material instanceof THREE.MeshStandardMaterial) {
          obj.material.envMapIntensity = 1.15;
        }
        if (/eye|pupil|iris/i.test(obj.name)) eyeMeshes.current.push(obj);
      }
    });
    return s;
  }, [gltf, targetHeight]);

  // Idle breathing + blink
  const blinkTimer = useRef(0);
  const nextBlink = useRef(3 + Math.random() * 3);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    const t = performance.now() * 0.001;
    if (breatheRef.current) {
      const base = 1;
      const breathe = 1 + Math.sin(t * 1.6) * 0.012;
      breatheRef.current.scale.set(base * breathe, base * breathe, base * breathe);
    }
    if (groupRef.current && shakeRef?.current) {
      const s = shakeRef.current;
      groupRef.current.position.x = Math.sin(t * 30) * 0.008 * s;
      groupRef.current.position.z = Math.cos(t * 28) * 0.006 * s;
    } else if (groupRef.current) {
      groupRef.current.position.x = 0;
      groupRef.current.position.z = 0;
    }

    // Blink: scale eye Y briefly
    blinkTimer.current += delta;
    if (blinkTimer.current > nextBlink.current) {
      const elapsed = blinkTimer.current - nextBlink.current;
      const blinkDur = 0.16;
      const p = elapsed / blinkDur;
      const yScale = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
      eyeMeshes.current.forEach((m) => (m.scale.y = Math.max(0.05, yScale)));
      if (elapsed > blinkDur) {
        eyeMeshes.current.forEach((m) => (m.scale.y = 1));
        blinkTimer.current = 0;
        nextBlink.current = 3 + Math.random() * 3;
      }
    }
  });

  useEffect(() => () => eyeMeshes.current.forEach((m) => (m.scale.y = 1)), []);

  return (
    <group ref={groupRef}>
      <group ref={breatheRef}>
        <primitive object={scene} />
      </group>
    </group>
  );
}
