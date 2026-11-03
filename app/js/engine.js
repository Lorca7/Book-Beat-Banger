/* Book Beat Banger — audio engine (works with a live AudioContext or an OfflineAudioContext) */
(function () {
  'use strict';
  const BBB = window.BBB, U = BBB.util, S = BBB.state;

  const LOOKAHEAD = 0.12;   // seconds scheduled ahead
  const MOD_DT = 0.01;      // modulation resolution (100 Hz)
  const MAX_GRAINS_PER_SEC = 1600;

  const DRIVE_CURVE = (() => {
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 3) / Math.tanh(3); }
    return c;
  })();

  // ---------- grain windows ----------
  const WIN_N = 64;
  const winCache = new Map();
  BBB.grainWindow = (shape, skew) => {
    skew = Math.round(U.clamp(skew || 0, -1, 1) * 40) / 40;
    const key = shape + ':' + skew;
    let c = winCache.get(key);
    if (c) return c;
    c = new Float32Array(WIN_N);
    const p = Math.pow(2, skew * 1.6); // warp: skew > 0 pushes the peak later
    for (let i = 0; i < WIN_N; i++) {
      const x = i / (WIN_N - 1), t = Math.pow(x, p);
      let y;
      switch (shape) {
        case 'gauss': y = Math.exp(-0.5 * Math.pow((t - 0.5) / 0.16, 2)); break;
        case 'tri': y = 1 - Math.abs(2 * t - 1); break;
        case 'tukey': y = t < 0.2 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.2) : t > 0.8 ? 0.5 - 0.5 * Math.cos((Math.PI * (1 - t)) / 0.2) : 1; break;
        case 'perc': y = (t < 0.03 ? t / 0.03 : Math.exp(-(t - 0.03) * 6)); break;
        case 'swell': y = (t > 0.97 ? (1 - t) / 0.03 : Math.exp(-(0.97 - t) * 6)); break;
        case 'rect': y = t < 0.02 ? t / 0.02 : t > 0.98 ? (1 - t) / 0.02 : 1; break;
        default: y = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
      }
      c[i] = y;
    }
    c[0] = 0; c[WIN_N - 1] = 0;
    winCache.set(key, c);
    return c;
  };
  const SCALES = { penta: [0, 2, 4, 7, 9], minor: [0, 2, 3, 5, 7, 8, 10], fifth: [0, 7] };
  BBB.quantizePitch = (semis, mode) => {
    if (!mode || mode === 'off') return semis;
    if (mode === 'semi') return Math.round(semis);
    if (mode === 'oct') return Math.round(semis / 12) * 12;
    const sc = SCALES[mode];
    let best = 0, bd = Infinity;
    for (let o = -3; o <= 3; o++) for (const d of sc) { const c = o * 12 + d, dd = Math.abs(c - semis); if (dd < bd) { bd = dd; best = c; } }
    return best;
  };

  const makeIR = (ctx, seconds) => {
    const sr = ctx.sampleRate, len = Math.max(1, Math.floor(seconds * sr));
    const b = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let s = 12345 + c * 777, lp = 0;
      for (let i = 0; i < len; i++) {
        s = (s * 16807) % 2147483647;
        const t = i / sr;
        const n = (s / 2147483647) * 2 - 1;
        lp += (n - lp) * (0.9 - 0.6 * (t / seconds)); // gets darker over time
        const env = Math.exp((-6.9 * t) / seconds) * (t < 0.005 ? t / 0.005 : 1);
        d[i] = lp * env;
      }
    }
    return b;
  };

  class Engine {
    constructor(ctx, opts) {
      opts = opts || {};
      this.ctx = ctx;
      this.live = !opts.offline;
      this.clock = { playing: false, bpm: S.bpm, anchorTime: 0, anchorBeat: 0 };
      this.voices = [];          // granular voices
      this.lastDrum = [];        // per drum track: last voice (for choke)
      this.binders = {};
      this.modActive = new Set();
      this.modUntil = {};
      this.stepQueue = [];
      this.nextStep = 0;
      this.grainBudget = { t: 0, n: 0 };
      this.build();
    }

    // ---------- clock ----------
    stepDur() { return 60 / this.clock.bpm / 4; }
    beatsAt(t) { const c = this.clock; return c.playing ? c.anchorBeat + ((t - c.anchorTime) * c.bpm) / 60 : (t * c.bpm) / 60; }
    secsAt(t) { const c = this.clock; return c.playing ? t - c.anchorTime + (c.anchorBeat * 60) / c.bpm : t; }
    timeAtBeat(b) { const c = this.clock; return c.anchorTime + ((b - c.anchorBeat) * 60) / c.bpm; }
    clk(t) { return { playing: this.clock.playing, beats: this.beatsAt(t), secs: this.secsAt(t) }; }
    val(id, t) { return BBB.valueAt(id, this.clk(t), this.live); }

    // ---------- graph ----------
    build() {
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -2; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
      this.out = ctx.createGain();
      this.master.connect(this.limiter); this.limiter.connect(this.out); this.out.connect(ctx.destination);
      if (this.live) {
        this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048;
        this.out.connect(this.analyser);
      }
      this.irSize = BBB.param('fx.reverb.size').value;
      this.ir = makeIR(ctx, this.irSize);

      this.tracks = S.tracks.map((tr, i) => {
        const input = ctx.createGain();
        const T = { input, stages: {} };
        let node = input;
        const stage = (name, wetBuilder) => {
          const out = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
          wet.gain.value = 0;
          node.connect(dry); dry.connect(out);
          const w = wetBuilder(node);
          w.out.connect(wet); wet.connect(out);
          T.stages[name] = Object.assign(w, { dry, wet, out });
          node = out;
        };
        stage('drive', (inp) => {
          const pre = ctx.createGain(), sh = ctx.createWaveShaper(), lp = ctx.createBiquadFilter(), post = ctx.createGain();
          sh.curve = DRIVE_CURVE; sh.oversample = '4x'; lp.type = 'lowpass';
          inp.connect(pre); pre.connect(sh); sh.connect(lp); lp.connect(post);
          return { pre, lp, post, out: post };
        });
        stage('filter', (inp) => {
          const f = ctx.createBiquadFilter(); f.type = S.fx.filterType;
          inp.connect(f);
          return { f, out: f };
        });
        stage('delay', (inp) => {
          const d = ctx.createDelay(4), lp = ctx.createBiquadFilter(), fb = ctx.createGain();
          lp.type = 'lowpass';
          inp.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
          return { d, lp, fb, out: lp };
        });
        stage('reverb', (inp) => {
          const cv = ctx.createConvolver(), lp = ctx.createBiquadFilter();
          cv.buffer = this.ir; lp.type = 'lowpass';
          inp.connect(cv); cv.connect(lp);
          return { cv, lp, out: lp };
        });
        T.pan = ctx.createStereoPanner();
        T.level = ctx.createGain();
        T.mute = ctx.createGain();
        node.connect(T.pan); T.pan.connect(T.level); T.level.connect(T.mute); T.mute.connect(this.master);
        T.mute.gain.value = BBB.trackAudible(tr) ? 1 : 0;
        return T;
      });

      // ---- parameter binders: id -> (value, time, mode) ----
      const B = this.binders;
      const each = (fn) => (v, t, m) => this.tracks.forEach((T) => fn(T, v, t, m));
      const set = (ap, v, t, mode) => this.setAP(ap, v, t, mode);
      S.tracks.forEach((tr, i) => {
        B[tr.id + '.level'] = (v, t, m) => set(this.tracks[i].level.gain, v * v, t, m);
        B[tr.id + '.pan'] = (v, t, m) => set(this.tracks[i].pan.pan, v, t, m);
      });
      B['master.vol'] = (v, t, m) => set(this.master.gain, v * v, t, m);
      B['fx.drive.amt'] = each((T, v, t, m) => {
        set(T.stages.drive.pre.gain, U.dbToGain(v * 36), t, m);
        set(T.stages.drive.post.gain, U.dbToGain(-v * 14), t, m);
      });
      B['fx.drive.tone'] = each((T, v, t, m) => set(T.stages.drive.lp.frequency, v, t, m));
      B['fx.filter.cut'] = each((T, v, t, m) => set(T.stages.filter.f.frequency, v, t, m));
      B['fx.filter.res'] = each((T, v, t, m) => set(T.stages.filter.f.Q, v, t, m));
      B['fx.delay.time'] = each((T, v, t, m) => set(T.stages.delay.d.delayTime, Math.min(3.95, v * this.stepDur()), t, m === 'now' ? 'smooth' : m));
      B['fx.delay.fb'] = each((T, v, t, m) => set(T.stages.delay.fb.gain, v, t, m));
      B['fx.delay.tone'] = each((T, v, t, m) => set(T.stages.delay.lp.frequency, v, t, m));
      B['fx.reverb.damp'] = each((T, v, t, m) => set(T.stages.reverb.lp.frequency, v, t, m));
      BBB.FX.forEach((fx) => S.tracks.forEach((tr, i) => {
        B[`mix.${fx.id}.${tr.id}`] = (v, t, m) => {
          const st = this.tracks[i].stages[fx.id];
          set(st.dry.gain, Math.min(1, 2 * (1 - v)), t, m);
          set(st.wet.gain, Math.min(1, 2 * v), t, m);
        };
      }));
    }

    setAP(ap, v, t, mode) {
      if (!isFinite(v)) return;
      if (mode === 'ramp') { ap.linearRampToValueAtTime(v, t); return; }
      if (mode === 'set') {
        if (ap.cancelAndHoldAtTime) ap.cancelAndHoldAtTime(t); else ap.cancelScheduledValues(t);
        ap.setValueAtTime(v, t);
        return;
      }
      const now = this.ctx.currentTime;
      if (ap.cancelAndHoldAtTime) ap.cancelAndHoldAtTime(now); else ap.cancelScheduledValues(now);
      ap.setTargetAtTime(v, now, mode === 'smooth' ? 0.06 : 0.012);
    }

    setFilterType(type) { this.tracks.forEach((T) => { T.stages.filter.f.type = type; }); }

    setReverbSize(sec) {
      if (Math.abs(sec - this.irSize) < 0.001) return;
      this.irSize = sec;
      this.ir = makeIR(this.ctx, sec);
      this.tracks.forEach((T) => { T.stages.reverb.cv.buffer = this.ir; });
    }

    applyMute(immediate) {
      S.tracks.forEach((tr, i) => {
        const g = BBB.trackAudible(tr) ? 1 : 0;
        if (immediate) this.tracks[i].mute.gain.setValueAtTime(g, this.ctx.currentTime);
        else this.setAP(this.tracks[i].mute.gain, g, 0, 'now');
      });
    }

    /** Apply a parameter immediately (used for user edits of non-modulated params). */
    applyNow(id) {
      if (id === 'fx.reverb.size') {
        clearTimeout(this._irTimer);
        this._irTimer = setTimeout(() => this.setReverbSize(BBB.param(id).value), 120);
        return;
      }
      const b = this.binders[id];
      if (!b) return;
      if (this.modActive.has(id)) return; // the modulation scheduler owns it
      b(this.val(id, this.ctx.currentTime), this.ctx.currentTime, 'now');
    }

    applyAll(mode, t) {
      for (const id in this.binders) this.binders[id](this.val(id, t), t, mode);
      if (mode === 'set') this.applyMute(true);
    }

    // ---------- transport ----------
    start() {
      const c = this.clock;
      c.bpm = S.bpm;
      c.anchorTime = this.ctx.currentTime + 0.05;
      c.anchorBeat = 0;
      c.playing = true;
      this.nextStep = 0;
      this.stepQueue = [];
      this.resetMods();
    }
    stop() {
      const now = this.ctx.currentTime;
      this.clock.playing = false;
      this.stepQueue = [];
      this.voices.forEach((v) => { if (v.seq && v.tOff > now) v.tOff = now; });
      this.resetMods();
    }
    setBpm(bpm) {
      const c = this.clock, now = this.ctx.currentTime;
      if (c.playing) { c.anchorBeat = this.beatsAt(now); c.anchorTime = now; }
      c.bpm = bpm;
      this.applyNow('fx.delay.time');
    }
    resetMods() {
      const now = this.ctx.currentTime;
      this.modActive.forEach((id) => this.binders[id](this.val(id, now), now, 'set'));
      this.modActive.clear();
      this.modUntil = {};
    }

    // ---------- realtime tick ----------
    tick() {
      const now = this.ctx.currentTime, horizon = now + LOOKAHEAD;
      if (this.clock.playing) this.scheduleSteps(horizon, Infinity);
      this.scheduleGrains(horizon);
      this.scheduleMods(now, horizon);
    }

    isModulated(id) {
      return !!(BBB.modsFor(id) || (this.clock.playing && S.auto.lanes[id]));
    }

    scheduleMods(now, horizon) {
      for (const id of this.modActive) {
        if (!this.isModulated(id)) {
          this.modActive.delete(id);
          delete this.modUntil[id];
          this.binders[id](this.val(id, now), now, 'now');
        }
      }
      for (const id in this.binders) {
        if (!this.isModulated(id)) continue;
        const b = this.binders[id];
        let t = this.modUntil[id];
        if (!this.modActive.has(id) || t === undefined || t < now) {
          this.modActive.add(id);
          t = now + 0.005;
          b(this.val(id, t), t, 'set');
        }
        for (t += MOD_DT; t <= horizon + 1e-9; t += MOD_DT) b(this.val(id, t), t, 'ramp');
        this.modUntil[id] = t - MOD_DT;
      }
    }

    scheduleModsOffline(from, to) {
      for (const id in this.binders) {
        const has = BBB.modsFor(id) || S.auto.lanes[id];
        if (!has) continue;
        const b = this.binders[id];
        b(this.val(id, from), from, 'set');
        for (let t = from + MOD_DT; t <= to; t += MOD_DT) b(this.val(id, t), t, 'ramp');
      }
    }

    scheduleSteps(horizon, endBeat) {
      const sd = this.stepDur();
      for (;;) {
        const n = this.nextStep, beat = n / 4;
        if (beat >= endBeat) break;
        let t = this.timeAtBeat(beat);
        if (n % 2 === 1) t += this.val('master.swing', t) * sd;
        if (t >= horizon) break;
        this.triggerStep(n % 16, t, n);
        if (this.live) this.stepQueue.push({ step: n % 16, time: t, n });
        this.nextStep++;
      }
    }

    triggerStep(s, t) {
      const sd = this.stepDur();
      S.tracks.forEach((tr, i) => {
        if (tr.kind === 'drum') {
          const st = tr.steps[s];
          if (st.on) this.playDrum(i, st.vel, t);
        } else {
          tr.notes.forEach((nt) => {
            if (nt.step === s) this.noteVoice(nt.note, t, t + nt.len * sd, nt.vel || 0.9, true);
          });
        }
      });
    }

    // ---------- drums ----------
    playDrum(i, vel, t) {
      const ctx = this.ctx, tr = S.tracks[i];
      const buf = tr.sample && tr.sample.buffer;
      if (!buf) return;
      t = Math.max(t, ctx.currentTime);
      const tune = this.val(tr.id + '.tune', t);
      const decayP = BBB.param(tr.id + '.decay');
      const decay = this.val(tr.id + '.decay', t);
      const start = this.val(tr.id + '.start', t);
      const rate = Math.pow(2, tune / 12);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.playbackRate.value = rate;
      const g = ctx.createGain();
      src.connect(g); g.connect(this.tracks[i].input);
      const offset = start * buf.duration;
      const playLen = (buf.duration - offset) / rate;
      const amp = Math.pow(vel, 1.5);
      // choke previous hit on this track
      const prev = this.lastDrum[i];
      if (prev && prev.end > t) {
        try {
          if (prev.g.gain.cancelAndHoldAtTime) prev.g.gain.cancelAndHoldAtTime(t); else prev.g.gain.cancelScheduledValues(t);
          prev.g.gain.setTargetAtTime(0, t, 0.004);
          prev.src.stop(t + 0.04);
        } catch (e) { /* already stopped */ }
      }
      g.gain.setValueAtTime(amp, t);
      let end = t + playLen;
      if (decay < decayP.max * 0.985) {
        const hold = t + decay * 0.35;
        g.gain.setValueAtTime(amp, hold);
        g.gain.setTargetAtTime(0, hold, decay * 0.22);
        end = Math.min(end, t + decay * 1.6);
      }
      src.start(t, offset);
      src.stop(end + 0.01);
      this.lastDrum[i] = { src, g, end };
      if (this.live) BBB.emit('hit', i, t);
    }

    /** Immediate audition of a drum pad. */
    trigger(i, vel) {
      if (S.tracks[i].kind === 'drum') this.playDrum(i, vel == null ? 0.9 : vel, this.ctx.currentTime + 0.005);
      else { this.noteVoice(60, this.ctx.currentTime + 0.005, this.ctx.currentTime + 0.4, 0.9, false); }
    }

    // ---------- granular ----------
    noteVoice(note, tOn, tOff, vel, seq) {
      const v = { note, tOn, tOff, vel, seq, next: tOn, id: Math.random(), lastEnd: tOn };
      this.voices.push(v);
      if (this.live) BBB.emit('hit', 3, tOn);
      return v;
    }
    noteOn(note) { return this.noteVoice(note, this.ctx.currentTime + 0.01, Infinity, 0.9, false); }
    noteOff(v) { if (v) v.tOff = Math.max(v.tOn, this.ctx.currentTime); }

    /** ADSR level of a voice at time t. */
    voiceEnv(v, t) {
      const a = this.val('gran.attack', t), d = this.val('gran.decay', t), su = this.val('gran.sustain', t);
      const lvl = (el) => (el < a ? el / a : el < a + d ? 1 - (1 - su) * ((el - a) / d) : su);
      if (t <= v.tOff) return lvl(t - v.tOn);
      const r = this.val('gran.release', t);
      return lvl(v.tOff - v.tOn) * Math.max(0, 1 - (t - v.tOff) / r);
    }

    scheduleGrains(horizon) {
      const tr = S.tracks[3];
      const buf = tr.sample && tr.sample.buffer;
      if (!this.voices.length) return;
      for (let k = this.voices.length - 1; k >= 0; k--) {
        const v = this.voices[k];
        let guard = 0;
        while (v.next < horizon && guard++ < 600) {
          const t = v.next;
          const rel = this.val('gran.release', Math.min(t, v.tOff));
          if (t > v.tOff + rel) { v.dead = true; break; }
          if (buf) this.emitGrain(v, t, buf);
          const dens = this.val('gran.dens', t), jit = this.val('gran.jitter', t);
          v.next = t + (1 / dens) * Math.max(0.05, 1 + (Math.random() * 2 - 1) * jit);
        }
        if (v.dead) {
          this.voices.splice(k, 1);
          if (v.filter && this.live) {
            const f = v.filter, wait = Math.max(0, v.lastEnd - this.ctx.currentTime) + 0.5;
            setTimeout(() => { try { f.disconnect(); } catch (e) { /* ignore */ } }, wait * 1000);
          }
        }
      }
    }

    reversedBuffer(buf) {
      if (this._revSrc === buf) return this._rev;
      const r = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate });
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = new Float32Array(buf.getChannelData(c)); d.reverse(); r.copyToChannel(d, c); }
      this._revSrc = buf; this._rev = r;
      return r;
    }

    voiceFilter(v, t) {
      if (!v.filter) {
        v.filter = this.ctx.createBiquadFilter();
        v.filter.type = 'lowpass';
        v.filter.connect(this.tracks[3].input);
      }
      const nyq = this.ctx.sampleRate / 2 - 200;
      const env = this.voiceEnv(v, t);
      const cut = U.clamp(this.val('gran.cutoff', t) * Math.pow(2, this.val('gran.fenv', t) * 6 * env), 30, nyq);
      const q = this.val('gran.res', t);
      if (!v.fInit) { v.filter.frequency.setValueAtTime(cut, t); v.filter.Q.setValueAtTime(q, t); v.fInit = true; }
      else { v.filter.frequency.linearRampToValueAtTime(cut, t); v.filter.Q.linearRampToValueAtTime(q, t); }
      return v.filter;
    }

    emitGrain(v, t, buf) {
      const ctx = this.ctx;
      if (this.live) {
        // CPU guard: cap grain count per second of audio time
        const sec = Math.floor(t);
        if (this.grainBudget.t !== sec) { this.grainBudget.t = sec; this.grainBudget.n = 0; }
        if (++this.grainBudget.n > MAX_GRAINS_PER_SEC) return;
      }
      const G = S.gran;
      const dur = buf.duration;
      const pos = this.val('gran.pos', t), scan = G.freeze ? 0 : this.val('gran.scan', t);
      let size = this.val('gran.size', t);
      const sizeRnd = this.val('gran.sizernd', t);
      if (sizeRnd > 0) size = U.clamp(size * Math.pow(2, (Math.random() * 2 - 1) * sizeRnd * 2), 0.003, 2);
      const dens = this.val('gran.dens', t), spray = this.val('gran.spray', t), spread = this.val('gran.spread', t);
      const pitch = this.val('gran.pitch', t) + this.val('gran.fine', t) / 100;
      const scatter = BBB.quantizePitch((Math.random() * 2 - 1) * this.val('gran.detune', t), G.quant);
      const env = this.voiceEnv(v, t);
      let amp = v.vel * env * (0.7 / Math.sqrt(Math.max(1, dens * size)));
      const ampRnd = this.val('gran.amprnd', t);
      if (ampRnd > 0) amp *= 1 - ampRnd * Math.random();
      const filter = this.voiceFilter(v, t);
      if (amp < 0.0004) return;
      const rate = Math.pow(2, (v.note - 60 + pitch + scatter) / 12);
      const elapsed = t - v.tOn;
      let off = U.wrap(pos * dur + scan * elapsed + spray * (Math.random() * 2 - 1) * dur * 0.5, dur);
      const need = size * rate;
      if (off + need > dur) off = Math.max(0, dur - need);
      const rev = Math.random() < this.val('gran.reverse', t);
      const src = ctx.createBufferSource();
      src.buffer = rev ? this.reversedBuffer(buf) : buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = 0;
      const win = BBB.grainWindow(G.window, this.val('gran.skew', t));
      const curve = new Float32Array(win.length);
      for (let i = 0; i < curve.length; i++) curve[i] = win[i] * amp;
      g.gain.setValueCurveAtTime(curve, t, size);
      src.connect(g);
      const pan = spread > 0.01 ? (Math.random() * 2 - 1) * spread : 0;
      if (pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        g.connect(p); p.connect(filter);
      } else g.connect(filter);
      // a reversed grain reads the mirrored region of the reversed buffer
      src.start(t, rev ? Math.max(0, dur - off - need) : off);
      src.stop(t + size + 0.01);
      v.lastEnd = Math.max(v.lastEnd, t + size);
      if (this.live) {
        const log = this.grainLog || (this.grainLog = []);
        log.push({ t, end: t + size, off: off / dur, len: need / dur, rev, amp, pan, semis: v.note - 60 + pitch + scatter });
        if (log.length > 600) log.splice(0, log.length - 600);
      }
    }

    releaseAllNotes() {
      const now = this.ctx.currentTime;
      this.voices.forEach((v) => { if (v.tOff > now) v.tOff = now; });
    }

    // ---------- preview ----------
    preview(buf, offsetSec) {
      this.stopPreview();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain(); g.gain.value = 0.9;
      src.connect(g); g.connect(this.master);
      const t = this.ctx.currentTime + 0.01;
      src.start(t, offsetSec || 0);
      this.previewing = { src, t, offset: offsetSec || 0, buf };
      src.onended = () => { if (this.previewing && this.previewing.src === src) this.previewing = null; };
      return this.previewing;
    }
    stopPreview() {
      if (this.previewing) { try { this.previewing.src.stop(); } catch (e) { /* ignore */ } this.previewing = null; }
    }
  }
  BBB.Engine = Engine;

  /** Render N bars of the current project to an AudioBuffer (faster than real time). */
  BBB.renderOffline = async ({ bars, tail, sampleRate }) => {
    sampleRate = sampleRate || 48000;
    const stepDur = 60 / S.bpm / 4;
    const dur = bars * 16 * stepDur;
    const tailSec = tail ? Math.min(12, 1 + BBB.param('fx.reverb.size').value * 1.1 + 2 * BBB.param('fx.delay.fb').value * 3) : 0;
    const total = dur + tailSec;
    const octx = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);
    const eng = new Engine(octx, { offline: true });
    const c = eng.clock;
    c.bpm = S.bpm; c.playing = true; c.anchorTime = 0; c.anchorBeat = 0;
    eng.applyAll('set', 0);
    eng.scheduleSteps(total + 1, bars * 4);
    eng.scheduleGrains(total);
    eng.scheduleModsOffline(0, total);
    return octx.startRendering();
  };
})();
