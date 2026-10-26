// 用 Spine 3.8 运行时播放明日方舟官方基建 Q 版模型（assets/models/<角色>/model.*）
// 常见动作：Relax 待机 · Interact 互动 · Move 走动 · Sit 坐 · Sleep 睡 · Special 特殊（各角色不一定都有）
class SpineChar {
  constructor(canvas, base) {
    this.canvas = canvas;
    this.base = base;
    this.current = null;
    this.flip = false;
    this.ready = false;
    // 视网膜屏上小人边缘本来就够细，关掉多重采样抗锯齿省 GPU
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
    this.gl = gl;
    this.ctx = new spine.webgl.ManagedWebGLRenderingContext(gl);
    this.shader = spine.webgl.Shader.newTwoColoredTextured(this.ctx);
    this.batcher = new spine.webgl.PolygonBatcher(this.ctx);
    this.renderer = new spine.webgl.SkeletonRenderer(this.ctx);
    this.renderer.premultipliedAlpha = false;
    this.mvp = new spine.webgl.Matrix4();
    this.assets = new spine.webgl.AssetManager(this.ctx, base);
    this.assets.loadBinary('model.skel');
    this.assets.loadTextureAtlas('model.atlas');
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
    const atlas = this.assets.get('model.atlas');
    const bin = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas));
    this.data = bin.readSkeletonData(this.assets.get('model.skel'));
    this.skeleton = new spine.Skeleton(this.data);
    this.stateData = new spine.AnimationStateData(this.data);
    this.stateData.defaultMix = 0.25;
    this.state = new spine.AnimationState(this.stateData);
    this.animations = this.data.animations.map((a) => a.name);
    this.computeFrame();
    this.viewBottom = this.bounds.minY;
    this.ready = true;
    this.last = performance.now();
    this.play('Relax');
    // 限帧并且不用 requestAnimationFrame：一直申请 rAF 会让 Chromium 按屏幕刷新率（最高 120Hz）不停出帧，
    // 哪怕这一帧什么也不画；改用定时器，只在真正要画的时候才出帧。
    this.loop = () => {
      const now = performance.now();
      this.frame(now);
      if (this.onFrame) this.onFrame(now);
      this.timer = setTimeout(this.loop, 1000 / (this.fps || SpineChar.FPS));
    };
    this.loop();
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

  // 固定取景：覆盖常用动作（含坐、躺）的外接框，切换动作时画面不跳。
  // 坐姿的腿会垂到脚底线以下，播放时取景整体下移（floors），所以高度按「各动作自己的高度」取最大。
  computeFrame() {
    this.animBounds = {};
    this.floors = {};
    for (const name of this.animations) {
      const b = this.measure([name]);
      this.animBounds[name] = b;
      this.floors[name] = b.minY;
    }
    const framed = ['Relax', 'Interact', 'Move', 'Sit'].filter((n) => this.has(n)); // 不再用 Sleep（躺下很宽）
    const standing = framed.filter((n) => n !== 'Sit');
    const base = Math.min(...standing.map((n) => this.animBounds[n].minY));
    const minX = Math.min(...framed.map((n) => this.animBounds[n].minX));
    const maxX = Math.max(...framed.map((n) => this.animBounds[n].maxX));
    const height = Math.max(...framed.map((n) => this.animBounds[n].maxY - Math.min(base, this.floors[n])));
    this.bounds = { minX, maxX, minY: base, maxY: base + height };
    this.aspect = (maxX - minX) / height;
    this.frameSize = { w: maxX - minX, h: height }; // 模型单位；所有基建小人画的比例一致
    // 特殊动作带大范围特效的角色就不随机播放了，免得被裁掉
    const sp = this.animBounds.Special;
    this.specialFits = !!sp && sp.minX >= minX - 0.1 * (maxX - minX) && sp.maxX <= maxX + 0.1 * (maxX - minX)
      && sp.maxY - Math.min(base, sp.minY) <= height * 1.08;
  }

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

  // 你离开时停住画面（保留最后一帧），回来再接着动
  setPaused(paused) {
    if (paused) { clearTimeout(this.timer); this.timer = null; return; }
    if (this.timer || !this.loop) return;
    this.last = performance.now();
    this.loop();
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
    // 转身不翻骨架（skeleton.scaleX = -1），改在投影里整体镜像：有些模型的骨骼不继承镜像
    // （NoRotationOrReflection / NoScaleOrReflection，例如司霆惊蛰的脸），翻骨架时那部分会朝错方向
    this.skeleton.updateWorldTransform();

    // 让模型完整放进画布，底部对齐
    const b = this.bounds;
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    const pad = 1.04;
    const scale = Math.max(bw / w, bh / h) * pad;
    const vw = w * scale;
    const vh = h * scale;
    const cx = (b.minX + b.maxX) / 2;
    const floor = Math.min(b.minY, this.floors[this.state.getCurrent(0)?.animation.name] ?? b.minY);
    this.viewBottom += (floor - this.viewBottom) * Math.min(1, dt * 4);
    const left = cx - vw / 2;
    const right = cx + vw / 2;
    const bottom = this.viewBottom - vh * 0.015;
    // 镜像时把左右边界对调；取景跟着一起镜像，人物不会跳位
    if (this.flip) this.mvp.ortho(right, left, bottom, bottom + vh, 0, 1);
    else this.mvp.ortho(left, right, bottom, bottom + vh, 0, 1);
    // 脚底中心在画布里的横向位置（0~1），给气泡定位用
    this.originX = this.flip ? right / vw : -left / vw;

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
// 30 帧：比 20 帧顺滑，仍比跟着屏幕刷新率（最高 120Hz）省很多
SpineChar.FPS = 30;
window.SpineChar = SpineChar;
