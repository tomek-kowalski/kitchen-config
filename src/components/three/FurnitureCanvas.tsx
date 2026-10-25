"use client";

import { Grid } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { NeutralToneMapping } from "three";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";
import { CameraRig } from "./CameraRig";
import { FurnitureRenderer } from "./FurnitureRenderer";

const BACKGROUND_COLOR = "#ecebe8";
const CAMERA_FOV = 35;

function clearSelection() {
  useConfiguratorStore.getState().selectCompartment(null);
}

/**
 * The WebGL canvas. It deliberately does not subscribe to the configuration store,
 * so configuration changes re-render only the scene contents, never the canvas.
 */
export function FurnitureCanvas() {
  return (
    <Canvas
      // three r18x removed PCFSoftShadowMap (R3F's default for `shadows`) and warns; request PCF explicitly.
      shadows="percentage"
      frameloop="demand"
      dpr={[1, 2]}
      // ACES (R3F's default) desaturates and greys out light finishes; Neutral keeps catalog colors recognisable.
      gl={{ toneMapping: NeutralToneMapping }}
      camera={{ fov: CAMERA_FOV, near: 0.05, far: 100, position: [2, 1.5, 3] }}
      // R3F only reports a miss for clicks that moved ≤ 2 px, so orbiting never clears the selection.
      onPointerMissed={clearSelection}
      className="touch-none"
    >
      <color attach="background" args={[BACKGROUND_COLOR]} />

      <ambientLight intensity={1.4} />
      <directionalLight
        position={[2.5, 4.5, 3.5]}
        intensity={2.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3.5}
        shadow-camera-bottom={-1}
        shadow-camera-near={0.5}
        shadow-camera-far={15}
      />
      <directionalLight position={[-3, 2, -2]} intensity={0.8} />

      <FurnitureRenderer />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial opacity={0.16} />
      </mesh>
      <Grid
        position={[0, 0.001, 0]}
        infiniteGrid
        cellSize={0.1}
        cellThickness={0.6}
        cellColor="#d2cfc9"
        sectionSize={0.5}
        sectionThickness={1}
        sectionColor="#b9b4ac"
        fadeDistance={14}
        fadeStrength={1.5}
      />

      <CameraRig />
    </Canvas>
  );
}
