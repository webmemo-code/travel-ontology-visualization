/**
 * Bloom post-processing composer for Three.js
 *
 * Provides UnrealBloomPass for professional glow effects on tube edges.
 * Configured with mobile-aware defaults to balance quality and performance.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ============================================================================
// Types
// ============================================================================

export interface BloomConfig {
  /** Whether bloom is enabled */
  enabled: boolean;
  /** Bloom intensity (0.5 - 2.0, default 1.2 desktop, 0.6 mobile) */
  strength: number;
  /** Bloom spread radius (0 - 1, default 0.4) */
  radius: number;
  /** Brightness threshold for bloom (0 - 1, default 0.7) */
  threshold: number;
}

export interface BloomComposerResult {
  /** The EffectComposer instance */
  composer: EffectComposer;
  /** The UnrealBloomPass for direct configuration */
  bloomPass: UnrealBloomPass;
  /** Update resolution on window resize */
  updateSize: (width: number, height: number) => void;
  /** Update bloom configuration */
  setConfig: (config: Partial<BloomConfig>) => void;
  /** Get current configuration */
  getConfig: () => BloomConfig;
  /** Dispose all resources */
  dispose: () => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_BLOOM_CONFIG: BloomConfig = {
  enabled: true,
  strength: 1.4,
  radius: 0.6,
  threshold: 0.6
};

export const MOBILE_BLOOM_CONFIG: BloomConfig = {
  enabled: true, // Aggressive bloom for mobile visibility
  strength: 2.0,
  radius: 1.6,     // Wider spread for visibility
  threshold: 0.1   // Lower cutoff - more pixels bloom
};

// ============================================================================
// Detection
// ============================================================================

/**
 * Detect if the current device is mobile
 */
export function isMobileDevice(): boolean {
  return (
    window.innerWidth < 768 ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

// ============================================================================
// Bloom Composer Factory
// ============================================================================

/**
 * Create a bloom composer with EffectComposer and UnrealBloomPass
 *
 * @param renderer - WebGL renderer
 * @param scene - Three.js scene
 * @param camera - Three.js camera
 * @param config - Optional bloom configuration (auto-detects mobile)
 * @returns BloomComposerResult with composer and update methods
 */
export function createBloomComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  config?: Partial<BloomConfig>
): BloomComposerResult {
  // Auto-detect mobile and merge configs
  const isMobile = isMobileDevice();
  const defaultConfig = isMobile ? MOBILE_BLOOM_CONFIG : DEFAULT_BLOOM_CONFIG;
  const mergedConfig: BloomConfig = { ...defaultConfig, ...config };

  // Create EffectComposer
  const composer = new EffectComposer(renderer);

  // Add render pass (renders scene to texture)
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Add bloom pass
  const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const bloomPass = new UnrealBloomPass(
    resolution,
    mergedConfig.strength,
    mergedConfig.radius,
    mergedConfig.threshold
  );
  composer.addPass(bloomPass);

  // Add output pass (final color correction)
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // Track current config
  const currentConfig: BloomConfig = { ...mergedConfig };

  // Update resolution on window resize
  const updateSize = (width: number, height: number): void => {
    composer.setSize(width, height);
    bloomPass.resolution.set(width, height);
  };

  // Update bloom configuration
  const setConfig = (newConfig: Partial<BloomConfig>): void => {
    if (newConfig.enabled !== undefined) {
      currentConfig.enabled = newConfig.enabled;
    }
    if (newConfig.strength !== undefined) {
      bloomPass.strength = newConfig.strength;
      currentConfig.strength = newConfig.strength;
    }
    if (newConfig.radius !== undefined) {
      bloomPass.radius = newConfig.radius;
      currentConfig.radius = newConfig.radius;
    }
    if (newConfig.threshold !== undefined) {
      bloomPass.threshold = newConfig.threshold;
      currentConfig.threshold = newConfig.threshold;
    }
  };

  // Get current configuration
  const getConfig = (): BloomConfig => ({ ...currentConfig });

  // Dispose all resources
  const dispose = (): void => {
    composer.dispose();
  };

  return {
    composer,
    bloomPass,
    updateSize,
    setConfig,
    getConfig,
    dispose
  };
}
