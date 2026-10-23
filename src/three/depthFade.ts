// Depth cue for the globe: anything behind the photo band sinks toward the
// background, so the near side reads first. One shared range (set by the
// dome's LOD each frame) drives tiles and lines alike.
import type * as THREE from 'three';

export const fadeRange = { uFadeFrom: { value: 1e6 }, uFadeFar: { value: 2e6 } };

/**
 * Dim a material with view depth: at the far end, colour keeps `1 - dim` and
 * alpha `1 - clear`. Works on any built-in or line shader that has
 * `fog_vertex` and `tonemapping_fragment`; chains an existing onBeforeCompile.
 */
export function withDepthFade(material: THREE.Material, dim: number, clear: number) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey();
  const strength = { uFadeDim: { value: dim }, uFadeClear: { value: clear } };
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, fadeRange, strength);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFadeDepth;')
      .replace('#include <fog_vertex>', 'vFadeDepth = -mvPosition.z;\n#include <fog_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFadeFrom;\nuniform float uFadeFar;\nuniform float uFadeDim;\nuniform float uFadeClear;\nvarying float vFadeDepth;')
      .replace(
        '#include <tonemapping_fragment>',
        `float fadeK = smoothstep( uFadeFrom, uFadeFar, vFadeDepth );
        gl_FragColor.rgb *= 1.0 - uFadeDim * fadeK;
        gl_FragColor.a *= 1.0 - uFadeClear * fadeK;
        #include <tonemapping_fragment>`,
      );
  };
  // The wrapper's source is the same for every material; keep programs apart by what it wraps.
  material.customProgramCacheKey = () => `${prevKey}|depthFade`;
  material.needsUpdate = true;
}

/**
 * Hide the far hemisphere of a sphere-hugging line set (centred on its
 * object's origin) while the camera is outside that sphere: seen through a
 * transparent globe, back-side borders read as a mirrored second map on top
 * of the first. From inside, every point faces the camera, so all stay.
 */
export function withHorizonCull(material: THREE.Material, radius: number) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uHorizonR = { value: radius };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uHorizonR;\nvarying float vFacing;')
      .replace(
        '#include <fog_vertex>',
        `vec3 sphereCentre = ( modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
        // Inside the sphere nothing is culled: report every point as facing.
        vFacing = length( sphereCentre ) < uHorizonR ? 1.0 : dot( normalize( mvPosition.xyz - sphereCentre ), normalize( -mvPosition.xyz ) );
        #include <fog_vertex>`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFacing;')
      .replace(
        '#include <tonemapping_fragment>',
        `gl_FragColor.a *= smoothstep( -0.02, 0.06, vFacing );
        if ( gl_FragColor.a < 0.002 ) discard;
        #include <tonemapping_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `${prevKey}|horizon`;
  material.needsUpdate = true;
}
