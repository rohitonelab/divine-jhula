import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/** Very gentle parallax: camera drifts by 2% of pointer position, damped. */
export function CameraRig() {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 1.4, 6.2));
  const pointer = useRef({ x: 0, y: 0 });

  useFrame(() => {
    const t = target.current;
    t.x = pointer.current.x * 0.15;
    t.y = 1.4 + pointer.current.y * 0.08;
    camera.position.lerp(t, 0.04);
    camera.lookAt(0, 0.4, 0);
  });

  return (
    <mesh
      position={[0, 0, -0.01]}
      visible={false}
      onPointerMove={(e) => {
        pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
      }}
    >
      <planeGeometry args={[0.001, 0.001]} />
    </mesh>
  );
}
