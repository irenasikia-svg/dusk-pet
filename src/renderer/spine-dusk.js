// 用 Spine 3.8 运行时播放夕（0011制造/VI·染尘烟）的官方基建 Q 版模型
// 动作：Relax 待机 · Interact 互动 · Move 走动 · Sit 坐 · Sleep 睡 · Special 特殊
class DuskSpine {
  constructor(canvas, base) {
    this.canvas = canvas;
    this.base = base;
    this.current = null;
    this.flip = false;
    this.ready = false;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
    this.gl = gl;
    this.ctx = new spine.webgl.ManagedWebGLRenderingContext(gl);
    this.shader = spine.webgl.Shader.newTwoColoredTextured(this.ctx);
    this.batcher = new spine.webgl.PolygonBatcher(this.ctx);
    this.renderer = new spine.webgl.SkeletonRenderer(this.ctx);
    this.renderer.premultipliedAlpha = false;
    this.mvp = new spine.webgl.Matrix4();
    this.assets = new spine.webgl.AssetManager(this.ctx, base);
    this.assets.loadBinary('dusk.skel');
    this.assets.loadTextureAtlas('dusk.atlas');
  }

  load() {
    return new Promise((resolve, reject) => {
      const wait = () => {
        if (this.assets.hasErrors()) return reject(new Error(JSON.stringify(this.assets.getErrors())));
        if (!this.assets.isLoadingComplete()) return requestAnimationFrame(wait);
        this.setup();
        resolve(this);
      };
      wait();
    });
  }

  setup() {
    const atlas = this.assets.get('dusk.atlas');
    const bin = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas));
    this.data = bin.readSkeletonData(this.assets.get('dusk.skel'));
    this.skeleton = new spine.Skeleton(this.data);
    this.stateData = new spine.AnimationStateData(this.data);
    this.stateData.defaultMix = 0.25;
    this.state = new spine.AnimationState(this.stateData);
    this.animations = this.data.animations.map((a) => a.name);
    this.bounds = this.measure();
    // 每个动作各自的最低点：坐姿腿会垂到脚底线以下，取景要跟着往下挪
    this.floors = {};
    for (const name of this.animations) this.floors[name] = this.measure([name]).minY;
    this.viewBottom = this.bounds.minY;
    this.ready = true;
    this.last = performance.now();
    this.play('Relax');
    const loop = (t) => {
      this.frame(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // 只统计可见部件的外接框（基建模型里有很多透明占位的特效部件）
  visibleBounds(r) {
    const v = this._verts || (this._verts = []);
    for (const slot of this.skeleton.drawOrder) {
      const at = slot.getAttachment();
      if (!at || !slot.bone.active || slot.color.a < 0.05) continue;
      let n = 0;
      if (at instanceof spine.RegionAttachment) { n = 8; at.computeWorldVertices(slot.bone, v, 0, 2); }
      else if (at instanceof spine.MeshAttachment) { n = at.worldVerticesLength; at.computeWorldVertices(slot, 0, n, v, 0, 2); }
      for (let i = 0; i < n; i += 2) {
        if (v[i] < r.minX) r.minX = v[i];
        if (v[i] > r.maxX) r.maxX = v[i];
        if (v[i + 1] < r.minY) r.minY = v[i + 1];
        if (v[i + 1] > r.maxY) r.maxY = v[i + 1];
      }
    }
  }

  // 主要动作的外接框取并集作为固定取景，切换动作时画面不跳
  measure(names = ['Relax', 'Interact', 'Move', 'Sleep']) {
    const r = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const anim of this.data.animations) {
      if (!names.includes(anim.name)) continue;
      for (let i = 0; i <= 24; i++) {
        this.skeleton.setToSetupPose();
        anim.apply(this.skeleton, 0, (anim.duration * i) / 24, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
        this.skeleton.updateWorldTransform();
        this.visibleBounds(r);
      }
    }
    this.skeleton.setToSetupPose();
    return r;
  }

  has(name) {
    return this.animations && this.animations.includes(name);
  }

  // 播放动作；then 为播完一次后接着循环的动作
  play(name, { loop = true, then = null } = {}) {
    if (!this.ready || !this.has(name)) return;
    if (this.current === name && loop && !then) return;
    this.current = name;
    this.state.setAnimation(0, name, loop && !then);
    if (then && this.has(then)) {
      this.state.addAnimation(0, then, true, 0);
      this.current = then;
    }
  }

  frame(now) {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const { canvas, gl } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

    this.state.update(dt);
    this.state.apply(this.skeleton);
    this.skeleton.scaleX = this.flip ? -1 : 1;
    this.skeleton.updateWorldTransform();

    // 让模型完整放进画布，底部对齐
    const b = this.bounds;
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    const pad = 1.04;
    const scale = Math.max(bw / w, bh / h) * pad;
    const vw = w * scale;
    const vh = h * scale;
    // 转身时取景也镜像，人物不会跳位
    const cx = ((b.minX + b.maxX) / 2) * (this.flip ? -1 : 1);
    const floor = Math.min(b.minY, this.floors[this.state.getCurrent(0)?.animation.name] ?? b.minY);
    this.viewBottom += (floor - this.viewBottom) * Math.min(1, dt * 4);
    this.mvp.ortho2d(cx - vw / 2, this.viewBottom - vh * 0.015, vw, vh);
    this.originX = (0 - (cx - vw / 2)) / vw; // 脚底中心在画布里的横向位置（0~1），给气泡定位用

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.shader.bind();
    this.shader.setUniformi(spine.webgl.Shader.SAMPLER, 0);
    this.shader.setUniform4x4f(spine.webgl.Shader.MVP_MATRIX, this.mvp.values);
    this.batcher.begin(this.shader);
    this.renderer.draw(this.batcher, this.skeleton);
    this.batcher.end();
    this.shader.unbind();
  }
}
window.DuskSpine = DuskSpine;
