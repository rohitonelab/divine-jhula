import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, ContactShadows, PerspectiveCamera } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Physics } from "@react-three/rapier";
import * as THREE from "three";
import { Sky } from "./Sky";
import { GlowMotes, Petals } from "./Particles";
import { Swing } from "./Swing";
import { CameraRig } from "./CameraRig";
import { FlowerBurst, type FlowerBurstHandle } from "./FlowerBurst";
import { useDevotionalAudio } from "@/hooks/useDevotionalAudio";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface Props {
  onStart?: () => void;
  started: boolean;
}

export function JhulanScene({ onStart, started }: Props) {
  const audio = useDevotionalAudio();
  const reducedMotion = useReducedMotion();
  const burstRef = useRef<FlowerBurstHandle>(null);

  useEffect(() => {
    if (started && !audio.enabled) audio.startAmbience();
  }, [started, audio]);

  const handleGrab = useCallback(() => {
    if (!audio.enabled) audio.startAmbience();
  }, [audio]);

  const handleRelease = useCallback(
    (v: number) => {
      audio.setSwingIntensity(Math.min(1, v * 0.4));
      burstRef.current?.burst();
    },
    [audio]
  );

  const handleBell = useCallback(() => audio.bell(), [audio]);

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      style={{ position: "absolute", inset: 0 }}
      onPointerMissed={onStart}
    >
      <PerspectiveCamera makeDefault position={[0, 1.4, 6.2]} fov={38} near={0.1} far={200} />

      <fog attach="fog" args={["#F5B87A", 14, 45]} />

      <Sky />

      {/* Lighting */}
      <ambientLight intensity={0.55} color="#FFE6C0" />
      <hemisphereLight args={["#FFDBA0", "#B76A2C", 0.6]} />
      <directionalLight
        position={[6, 8, 4]}
        intensity={2.2}
        color="#FFD79A"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-bias={-0.0002}
      />
      <spotLight
        position={[0, 6, 2]}
        angle={0.6}
        penumbra={0.8}
        intensity={0.7}
        color="#FFEAB5"
        distance={20}
      />

      <Suspense fallback={null}>
        <Environment preset="sunset" background={false} environmentIntensity={0.55} />
        <Physics gravity={[0, -9.81, 0]} timeStep={1 / 120}>
          <Swing
            onBellChime={handleBell}
            onGrab={handleGrab}
            onRelease={handleRelease}
            reducedMotion={reducedMotion}
          />
        </Physics>
      </Suspense>

      <ContactShadows position={[0, -1.4, 0]} opacity={0.55} scale={12} blur={2.4} far={5} color="#5A2A10" />

      <Petals count={reducedMotion ? 25 : 90} />
      <GlowMotes count={reducedMotion ? 10 : 30} />
      <FlowerBurst ref={burstRef} />

      <CameraRig />

      <EffectComposer multisampling={0}>
        <Bloom intensity={0.55} luminanceThreshold={0.75} luminanceSmoothing={0.25} mipmapBlur />
        <Vignette eskil={false} offset={0.25} darkness={0.55} />
      </EffectComposer>
    </Canvas>
  );
}
