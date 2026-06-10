import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { RENDER_H, RENDER_W, VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { PostFx } from '@/render/PostFx';
import type { RenderTarget } from '@/render/pixels';

/**
 * Three.js WebGL presentation layer: a full-screen orthographic quad textured
 * with the CPU-composed pixel buffer, post-processed through an ACES tonemap
 * and UnrealBloom. The frame composer writes `pixelData` and calls
 * `markTextureDirty()` before `render(ctx)` runs each frame.
 */
export class Renderer implements RenderTarget {
  /** Float RGBA, VIEW_W x VIEW_H, Y-flipped rows for GL texture orientation. */
  readonly pixelData: Float32Array<ArrayBuffer>;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly texture: THREE.DataTexture;
  private readonly quadMesh: THREE.Mesh;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly postFx: PostFx;

  constructor(holder: HTMLElement) {
    // ===================== Three.js WebGL Setup =====================
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setSize(RENDER_W, RENDER_H);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    holder.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.pixelData = new Float32Array(VIEW_W * VIEW_H * 4);
    this.texture = new THREE.DataTexture(
      this.pixelData,
      VIEW_W,
      VIEW_H,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.texture.needsUpdate = true;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const material = new THREE.MeshBasicMaterial({ map: this.texture });
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.quadMesh = new THREE.Mesh(geometry, material);
    this.quadMesh.scale.set(1 + 4 / VIEW_W, 1 + 4 / VIEW_H, 1); // overscan hides sub-cell camera offsets
    this.scene.add(this.quadMesh);

    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Tighter than the original 1.5/0.4: emissive cells should glow against
    // the rock they light, not swallow it in a screen-space halo.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(RENDER_W, RENDER_H), 1.2, 0.28, 1.0);
    this.composer.addPass(this.bloomPass);

    // Lens layer: chromatic aberration, grain, vignette, low-health pulse.
    this.postFx = new PostFx();
    this.composer.addPass(this.postFx.pass);
  }

  /** Flag the GPU texture for re-upload after the buffer was written. */
  markTextureDirty(): void {
    this.texture.needsUpdate = true;
  }

  /** The WebGL canvas (the input module attaches its mouse listeners here). */
  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  render(ctx: Ctx): void {
    // Sub-cell camera smoothing + screen shake + idle zoom on the render quad
    let ox = -(ctx.camera.x - Math.floor(ctx.camera.x)) * (2 / VIEW_W);
    let oy = (ctx.camera.y - Math.floor(ctx.camera.y)) * (2 / VIEW_H);
    if (ctx.fx.screenShake > 0.0005) {
      ox += (Math.random() - 0.5) * 2 * ctx.fx.screenShake;
      oy += (Math.random() - 0.5) * 2 * ctx.fx.screenShake;
      ctx.fx.screenShake *= 0.88;
    } else {
      ctx.fx.screenShake = 0;
    }
    this.quadMesh.position.x = ox * ctx.camera.zoom;
    this.quadMesh.position.y = oy * ctx.camera.zoom;
    this.quadMesh.scale.set(
      (1 + 4 / VIEW_W) * ctx.camera.zoom,
      (1 + 4 / VIEW_H) * ctx.camera.zoom,
      1,
    );

    // Blast-wave bloom surge decays back to baseline.
    // PostFx reads bloomKick/screenShake BEFORE decay so kicks land this frame.
    this.bloomPass.strength = 1.2 + ctx.fx.bloomKick;
    this.postFx.update(ctx);
    if (ctx.fx.bloomKick > 0.001) ctx.fx.bloomKick *= 0.86;
    else ctx.fx.bloomKick = 0;

    this.composer.render();
  }
}
