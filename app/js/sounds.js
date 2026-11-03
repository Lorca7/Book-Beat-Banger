/* Book Beat Banger — factory sounds, synthesized offline at startup */
(function () {
  'use strict';
  const BBB = window.BBB;

  const SR = 48000;
  const render = async (seconds, build, channels) => {
    const ctx = new OfflineAudioContext(channels || 1, Math.ceil(seconds * SR), SR);
    build(ctx);
    return ctx.startRendering();
  };
  const noiseBuffer = (ctx, seconds, seed) => {
    const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = seed || 1;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
    return b;
  };

  const kick = () => render(0.7, (ctx) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), sh = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 1.8); }
    sh.curve = curve;
    o.frequency.setValueAtTime(180, 0);
    o.frequency.exponentialRampToValueAtTime(52, 0.07);
    o.frequency.exponentialRampToValueAtTime(42, 0.5);
    g.gain.setValueAtTime(1, 0);
    g.gain.setTargetAtTime(0, 0.06, 0.16);
    o.connect(g); g.connect(sh); sh.connect(ctx.destination);
    o.start(0); o.stop(0.7);
    // click transient
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.02, 7);
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3500; hp.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.5, 0); ng.gain.exponentialRampToValueAtTime(0.001, 0.012);
    n.connect(hp); hp.connect(ng); ng.connect(ctx.destination); n.start(0);
  });

  const snare = () => render(0.45, (ctx) => {
    [[185, 0.55, 0.06], [330, 0.3, 0.04]].forEach(([f, a, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f * 1.4, 0); o.frequency.exponentialRampToValueAtTime(f, 0.03);
      g.gain.setValueAtTime(a, 0); g.gain.setTargetAtTime(0, 0.005, d);
      o.connect(g); g.connect(ctx.destination); o.start(0); o.stop(0.45);
    });
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.45, 3);
    const bp = ctx.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 1400;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 5000; pk.gain.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.75, 0); g.gain.setTargetAtTime(0, 0.01, 0.075);
    n.connect(bp); bp.connect(pk); pk.connect(g); g.connect(ctx.destination); n.start(0);
  });

  const hat = () => render(0.16, (ctx) => {
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    const sum = ctx.createGain(); sum.gain.value = 0.18;
    ratios.forEach((r) => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 40 * r * 2.2;
      o.connect(sum); o.start(0); o.stop(0.16);
    });
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.16, 11);
    const ng = ctx.createGain(); ng.gain.value = 0.5; n.connect(ng); ng.connect(sum); n.start(0);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; hp.Q.value = 0.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 10000; bp.gain.value = 5;
    const g = ctx.createGain(); g.gain.setValueAtTime(1, 0); g.gain.setTargetAtTime(0, 0.002, 0.022);
    sum.connect(hp); hp.connect(bp); bp.connect(g); g.connect(ctx.destination);
  });

  // A slowly evolving, vowel-ish harmonic tone at C4 (MIDI 60) — a playground for the grains.
  const granSource = async () => {
    const dur = 4, len = dur * SR, f0 = 261.6256;
    const out = new Float32Array(len);
    const voices = [-7, 0, 6]; // cents of detune for a soft chorus
    const formants = (t) => {
      // sweep through vowel-like formant centers over the length of the sample
      const k = t / dur;
      return [500 + 400 * Math.sin(k * Math.PI * 1.3), 1200 + 900 * Math.sin(k * Math.PI * 2.1 + 1), 2600 + 500 * Math.sin(k * 5)];
    };
    for (let v = 0; v < voices.length; v++) {
      const f = f0 * Math.pow(2, voices[v] / 1200);
      for (let h = 1; h <= 24; h++) {
        const fh = f * h;
        if (fh > 12000) break;
        let ph = Math.random() * Math.PI * 2;
        const w = (2 * Math.PI * fh) / SR;
        for (let i = 0; i < len; i += 64) {
          const t = i / SR, F = formants(t);
          let a = 0;
          for (let q = 0; q < 3; q++) { const d = (fh - F[q]) / (F[q] * 0.25); a += Math.exp(-d * d) * [1, 0.6, 0.3][q]; }
          a = (a + 0.04) / h;
          const vib = 1 + 0.003 * Math.sin(t * 2 * Math.PI * 5.2 + v);
          for (let j = i; j < Math.min(i + 64, len); j++) { out[j] += Math.sin(ph) * a; ph += w * vib; }
        }
      }
    }
    // breath noise
    let s = 99;
    for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; out[i] += ((s / 2147483647) * 2 - 1) * 0.004; }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
    const fade = Math.floor(0.02 * SR);
    for (let i = 0; i < len; i++) {
      let g = 0.9 / peak;
      if (i < fade) g *= i / fade;
      if (i > len - fade) g *= (len - i) / fade;
      out[i] *= g;
    }
    const b = new AudioBuffer({ numberOfChannels: 1, length: len, sampleRate: SR });
    b.copyToChannel(out, 0);
    return b;
  };

  BBB.makeFactorySounds = async () => {
    const [k, s, h, g] = await Promise.all([kick(), snare(), hat(), granSource()]);
    return { kick: k, snare: s, hat: h, gran: g };
  };
})();
