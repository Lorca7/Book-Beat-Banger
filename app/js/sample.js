/* Book Beat Banger — sample slots (non-destructive edits), audio capture, mic recorder */
(function () {
  'use strict';
  const BBB = window.BBB, U = BBB.util;

  // ---------------- Sample slot ----------------
  class SampleSlot {
    constructor(trackId) {
      this.trackId = trackId;
      this.raw = null;       // original AudioBuffer
      this.buffer = null;    // processed buffer used for playback
      this.factory = null;   // factory AudioBuffer for "reset"
      this.name = '';
      this.custom = false;
      this.start = 0; this.end = 0;      // seconds within raw
      this.fadeIn = 0; this.fadeOut = 0; // seconds
      this.gainDb = 0;
      this.normalize = true;
      this.reverse = false;
      this.peaks = null;     // min/max pyramid for drawing
      this.version = 0;
    }
    get duration() { return this.raw ? this.raw.duration : 0; }
    setRaw(buf, opts) {
      opts = opts || {};
      this.raw = buf;
      this.name = opts.name || 'sample';
      this.custom = !!opts.custom;
      this.start = 0; this.end = buf.duration;
      this.fadeIn = 0; this.fadeOut = Math.min(0.004, buf.duration / 4);
      this.gainDb = 0; this.reverse = false;
      this.normalize = opts.normalize != null ? opts.normalize : true;
      this.buildPeaks();
      if (opts.autoTrim) this.autoTrim(); else this.process();
    }
    buildPeaks() {
      // 256-sample bins (min,max) over channel-mixed data for fast zoomed-out drawing
      const d = this.mono();
      const bin = 256, n = Math.ceil(d.length / bin);
      const mn = new Float32Array(n), mx = new Float32Array(n);
      for (let b = 0; b < n; b++) {
        let lo = 1, hi = -1;
        const e = Math.min(d.length, (b + 1) * bin);
        for (let i = b * bin; i < e; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        mn[b] = lo; mx[b] = hi;
      }
      this.peaks = { bin, mn, mx };
    }
    mono() {
      if (!this.raw) return new Float32Array(0);
      if (this._mono && this._monoSrc === this.raw) return this._mono;
      const r = this.raw, n = r.numberOfChannels;
      let d;
      if (n === 1) d = r.getChannelData(0);
      else {
        d = new Float32Array(r.length);
        for (let c = 0; c < n; c++) { const s = r.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] += s[i] / n; }
      }
      this._mono = d; this._monoSrc = r;
      return d;
    }
    autoTrim() {
      const d = this.mono(), sr = this.raw.sampleRate;
      let peak = 0;
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
      if (peak < 1e-5) { this.process(); return; }
      const on = peak * 0.08, off = peak * 0.006;
      let s = 0, e = d.length - 1;
      while (s < d.length && Math.abs(d[s]) < on) s++;
      // back up to a quiet point just before the onset
      let s2 = s;
      const backMax = Math.floor(0.012 * sr);
      while (s2 > 0 && s - s2 < backMax && Math.abs(d[s2]) > off * 0.5) s2--;
      s = Math.max(0, s2 - Math.floor(0.001 * sr));
      // find tail end using a short RMS window
      const win = Math.floor(0.01 * sr);
      let acc = 0;
      for (let i = d.length - 1, k = 0; i > s; i--, k++) {
        acc += d[i] * d[i];
        if (k >= win) { acc -= d[i + win] * d[i + win]; if (Math.sqrt(Math.max(0, acc) / win) > off) { e = i + win; break; } }
      }
      e = Math.min(d.length, e + Math.floor(0.03 * sr));
      if (e - s < sr * 0.01) { s = 0; e = d.length; }
      this.start = s / sr; this.end = e / sr;
      this.fadeIn = s > 0 ? 0.0015 : 0;
      this.fadeOut = Math.min(0.04, (this.end - this.start) * 0.15);
      this.process();
    }
    process() {
      if (!this.raw) return;
      const r = this.raw, sr = r.sampleRate, nCh = r.numberOfChannels;
      this.start = U.clamp(this.start, 0, r.duration);
      this.end = U.clamp(this.end, this.start + 1 / sr, r.duration);
      const s0 = Math.floor(this.start * sr), s1 = Math.max(s0 + 1, Math.floor(this.end * sr));
      const len = s1 - s0;
      const out = new AudioBuffer({ numberOfChannels: nCh, length: len, sampleRate: sr });
      const fi = Math.min(len, Math.floor(this.fadeIn * sr)), fo = Math.min(len, Math.floor(this.fadeOut * sr));
      let peak = 0;
      const chans = [];
      for (let c = 0; c < nCh; c++) {
        const src = r.getChannelData(c).subarray(s0, s1);
        const d = new Float32Array(src);
        for (let i = 0; i < fi; i++) d[i] *= Math.sin((i / fi) * Math.PI / 2) ** 2;
        for (let i = 0; i < fo; i++) d[len - 1 - i] *= Math.sin((i / fo) * Math.PI / 2) ** 2;
        for (let i = 0; i < len; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
        chans.push(d);
      }
      let g = U.dbToGain(this.gainDb);
      if (this.normalize && peak > 1e-6) g *= 0.89 / peak;
      this.peakAfter = peak * g;
      for (let c = 0; c < nCh; c++) {
        const d = chans[c];
        if (g !== 1) for (let i = 0; i < len; i++) d[i] *= g;
        if (this.reverse) d.reverse();
        out.copyToChannel(d, c);
      }
      this.buffer = out;
      this.version++;
      BBB.emit('sample', this);
    }
    resetEdits() {
      if (!this.raw) return;
      this.start = 0; this.end = this.raw.duration; this.fadeIn = 0; this.fadeOut = Math.min(0.004, this.raw.duration / 4);
      this.gainDb = 0; this.reverse = false; this.normalize = true;
      this.process();
    }
    toJSON() {
      return {
        name: this.name, custom: this.custom, start: this.start, end: this.end, fadeIn: this.fadeIn, fadeOut: this.fadeOut,
        gainDb: this.gainDb, normalize: this.normalize, reverse: this.reverse,
        wav: this.custom && this.raw ? U.b64encode(U.bufferToWAV(this.raw, 16)) : null
      };
    }
  }
  BBB.SampleSlot = SampleSlot;

  // ---------------- Capture node (AudioWorklet with ScriptProcessor fallback) ----------------
  const WORKLET_SRC = `
  class BBBCapture extends AudioWorkletProcessor {
    constructor() { super(); this.size = 2048; this.bufs = null; this.n = 0; this.on = true;
      this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; }; }
    process(inputs) {
      if (!this.on) return false;
      const inp = inputs[0];
      if (inp && inp.length) {
        const ch = inp.length, len = inp[0].length;
        if (!this.bufs || this.bufs.length !== ch) { this.bufs = []; for (let c = 0; c < ch; c++) this.bufs.push(new Float32Array(this.size)); this.n = 0; }
        for (let c = 0; c < ch; c++) this.bufs[c].set(inp[c], this.n);
        this.n += len;
        if (this.n >= this.size) { this.port.postMessage(this.bufs, this.bufs.map((b) => b.buffer)); this.bufs = null; this.n = 0; }
      }
      return true;
    }
  }
  registerProcessor('bbb-capture', BBBCapture);`;
  const workletReady = new WeakMap();
  const loadWorklet = (ctx) => {
    if (!ctx.audioWorklet) return Promise.resolve(false);
    if (!workletReady.has(ctx)) {
      // data: URLs load from file:// pages (the packaged app); blob: works when served over http(s).
      const dataUrl = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(WORKLET_SRC);
      const blobUrl = () => URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      workletReady.set(ctx, ctx.audioWorklet.addModule(dataUrl)
        .catch(() => ctx.audioWorklet.addModule(blobUrl()))
        .then(() => true)
        .catch((e) => { console.info('AudioWorklet unavailable, using ScriptProcessor capture', e && e.message); return false; }));
    }
    return workletReady.get(ctx);
  };

  /** Capture audio from `source` node. onChunk(Float32Array[]) is called on the main thread. */
  BBB.createCapture = async (ctx, source, channels, onChunk) => {
    const silent = ctx.createGain(); silent.gain.value = 0; silent.connect(ctx.destination);
    if (await loadWorklet(ctx)) {
      const node = new AudioWorkletNode(ctx, 'bbb-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: channels, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
      node.port.onmessage = (e) => onChunk(e.data);
      source.connect(node); node.connect(silent);
      return { stop() { try { node.port.postMessage('stop'); source.disconnect(node); node.disconnect(); silent.disconnect(); } catch (e) { /* ignore */ } } };
    }
    const sp = ctx.createScriptProcessor(2048, channels, 1);
    sp.onaudioprocess = (e) => {
      const out = [];
      for (let c = 0; c < channels; c++) out.push(new Float32Array(e.inputBuffer.getChannelData(Math.min(c, e.inputBuffer.numberOfChannels - 1))));
      onChunk(out);
    };
    source.connect(sp); sp.connect(silent);
    return { stop() { try { source.disconnect(sp); sp.disconnect(); silent.disconnect(); } catch (e) { /* ignore */ } } };
  };

  // ---------------- Microphone recorder ----------------
  class MicRecorder {
    constructor(ctx) {
      this.ctx = ctx;
      this.state = 'idle'; // idle | armed | recording
      this.maxSeconds = 30;
      this.threshold = true;
      this.thresholdDb = -30;
      this.deviceId = '';
      this.level = 0;
      this.chunks = [];
      this.preroll = [];
    }
    async open() {
      if (window.bbbNative && window.bbbNative.requestMicAccess) {
        const ok = await window.bbbNative.requestMicAccess();
        if (!ok) throw new Error('Microphone access denied. Enable it in System Settings → Privacy & Security → Microphone.');
      }
      const constraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
      if (this.deviceId) constraints.audio.deviceId = { exact: this.deviceId };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.cap = await BBB.createCapture(this.ctx, this.src, 1, (chs) => this.onChunk(chs[0]));
    }
    async arm(trackId) {
      if (this.state !== 'idle') return;
      this.trackId = trackId;
      this.chunks = []; this.preroll = []; this.total = 0;
      await this.open();
      this.state = this.threshold ? 'armed' : 'recording';
      this.startedAt = performance.now();
      BBB.emit('rec-state', this);
    }
    onChunk(d) {
      let pk = 0;
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
      this.level = Math.max(pk, this.level * 0.85);
      if (this.state === 'armed') {
        this.preroll.push(d);
        if (this.preroll.length > 3) this.preroll.shift();
        if (pk >= U.dbToGain(this.thresholdDb)) {
          this.chunks = this.preroll.slice(); this.total = this.chunks.reduce((a, c) => a + c.length, 0);
          this.preroll = [];
          this.state = 'recording';
          this.startedAt = performance.now();
          BBB.emit('rec-state', this);
        }
      } else if (this.state === 'recording') {
        this.chunks.push(d); this.total += d.length;
        if (this.total >= this.maxSeconds * this.ctx.sampleRate) this.stop();
      }
    }
    get seconds() { return (this.total || 0) / this.ctx.sampleRate; }
    close() {
      if (this.cap) this.cap.stop();
      if (this.src) try { this.src.disconnect(); } catch (e) { /* ignore */ }
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.cap = this.src = this.stream = null;
    }
    /** Stop and return an AudioBuffer (or null if nothing was captured). */
    stop() {
      if (this.state === 'idle') return null;
      const wasRecording = this.state === 'recording';
      this.state = 'idle';
      this.close();
      let buf = null;
      if (wasRecording && this.total > 0) {
        const all = new Float32Array(this.total);
        let o = 0;
        this.chunks.forEach((c) => { all.set(c, o); o += c.length; });
        buf = new AudioBuffer({ numberOfChannels: 1, length: all.length, sampleRate: this.ctx.sampleRate });
        buf.copyToChannel(all, 0);
      }
      this.chunks = [];
      BBB.emit('rec-state', this);
      BBB.emit('rec-done', { trackId: this.trackId, buffer: buf });
      return buf;
    }
    cancel() {
      this.state = 'idle'; this.close(); this.chunks = [];
      BBB.emit('rec-state', this);
    }
    liveData() {
      // concatenated mono data so far (for the live waveform view)
      return this.chunks;
    }
  }
  BBB.MicRecorder = MicRecorder;
})();
