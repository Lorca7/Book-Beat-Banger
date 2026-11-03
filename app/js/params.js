/* Book Beat Banger — state, parameters, LFOs, modulation matrix, automation lanes */
(function () {
  'use strict';
  const BBB = window.BBB, U = BBB.util;

  // ---------------- Parameters ----------------
  class Param {
    constructor(o) {
      Object.assign(this, { curve: 'lin', mod: true, steps: 0, unit: '', group: '' }, o);
      this.norm = this.toNorm(o.def);
      this.defNorm = this.norm;
      this.touching = false;
    }
    toNorm(v) {
      if (this.curve === 'pow') return U.clamp(Math.sqrt((v - this.min) / (this.max - this.min)), 0, 1);
      if (this.curve === 'exp') return U.clamp(Math.log(v / this.min) / Math.log(this.max / this.min), 0, 1);
      return U.clamp((v - this.min) / (this.max - this.min), 0, 1);
    }
    fromNorm(n) {
      n = U.clamp(n, 0, 1);
      if (this.steps > 1) n = Math.round(n * (this.steps - 1)) / (this.steps - 1);
      if (this.curve === 'pow') return this.min + n * n * (this.max - this.min);
      return this.curve === 'exp' ? this.min * Math.pow(this.max / this.min, n) : this.min + n * (this.max - this.min);
    }
    get value() { return this.fromNorm(this.norm); }
    set value(v) { this.setNorm(this.toNorm(v)); }
    setNorm(n) {
      n = U.clamp(n, 0, 1);
      if (n === this.norm) return;
      this.norm = n;
      BBB.emit('param', this);
    }
    reset() { this.setNorm(this.defNorm); }
    format(v) { return this.fmt ? this.fmt(v === undefined ? this.value : v) : (v === undefined ? this.value : v).toFixed(2); }
    get fullName() { return (this.groupLit || this.groupLabel ? (this.groupLit || this.groupLabel) + ' · ' : '') + (this.lit || this.label); }
    get displayLabel() { return this.lit || this.label; }
    get tooltip() {
      const tech = this.tech || (this.groupLabel ? this.groupLabel.charAt(0) + this.groupLabel.slice(1).toLowerCase() + ' ' : '') + this.label.toLowerCase();
      return (this.lit || this.label) + ' — ' + tech + (this.desc ? '. ' + this.desc : '');
    }
  }
  BBB.Param = Param;

  const P = (BBB.params = new Map());
  const def = (o) => { const p = new Param(o); P.set(p.id, p); return p; };
  BBB.param = (id) => P.get(id);

  // ---------------- Tracks ----------------
  const TRACKS = [
    { id: 'kick', name: 'KICK', title: 'Kick', numeral: 'I', short: 'K', kind: 'drum', color: '#b8432c' },
    { id: 'snare', name: 'SNARE', title: 'Snare', numeral: 'II', short: 'S', kind: 'drum', color: '#b5862a' },
    { id: 'hat', name: 'HI-HAT', title: 'Hi-Hat', numeral: 'III', short: 'H', kind: 'drum', color: '#2f7d68' },
    { id: 'gran', name: 'GRANULAR', title: 'Granular', numeral: 'IV', short: 'G', kind: 'granular', color: '#7a4f9e' }
  ];
  BBB.TRACKS = TRACKS;
  const LFO_COLORS = ['#4b69b8', '#b8395a', '#7d9a2f', '#9a6434'];
  BBB.LFO_COLORS = LFO_COLORS;

  const pan = (v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100));
  const semis = (v) => (v >= 0 ? '+' : '') + v.toFixed(Math.abs(v) < 10 ? 1 : 0) + 'st';
  const level = (v) => U.fmtDb(v * v);

  TRACKS.forEach((t) => {
    const g = { group: t.id, groupLabel: t.name, color: t.color };
    def({ ...g, id: t.id + '.level', label: 'LEVEL', min: 0, max: 1.2, def: t.kind === 'granular' ? 0.8 : 0.9, fmt: level, audio: true });
    def({ ...g, id: t.id + '.pan', label: 'PAN', min: -1, max: 1, def: 0, fmt: pan, audio: true });
    if (t.kind === 'drum') {
      def({ ...g, id: t.id + '.tune', label: 'TUNE', min: -24, max: 24, def: 0, fmt: semis });
      def({ ...g, id: t.id + '.decay', label: 'DECAY', min: 0.02, max: 4, def: 4, curve: 'exp', fmt: (v) => (v >= 3.95 ? 'FULL' : U.fmtSec(v)) });
      def({ ...g, id: t.id + '.start', label: 'START', min: 0, max: 0.95, def: 0, fmt: U.fmtPct });
    }
  });
  {
    const g = { group: 'gran', groupLabel: 'GRAN', color: TRACKS[3].color };
    const cents = (v) => (v >= 0 ? '+' : '') + Math.round(v) + 'ct';
    const bip = (v) => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
    // cloud
    def({ ...g, id: 'gran.pos', label: 'POSITION', min: 0, max: 1, def: 0.25, fmt: U.fmtPct });
    def({ ...g, id: 'gran.scan', label: 'SCAN', min: -2, max: 2, def: 0.1, fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + 'x' });
    def({ ...g, id: 'gran.spray', label: 'SPRAY', min: 0, max: 1, def: 0.08, curve: 'pow', fmt: U.fmtPct });
    def({ ...g, id: 'gran.dens', label: 'DENSITY', min: 1, max: 120, def: 24, curve: 'exp', fmt: (v) => v.toFixed(v < 10 ? 1 : 0) + '/s' });
    def({ ...g, id: 'gran.jitter', label: 'JITTER', min: 0, max: 1, def: 0.15, fmt: U.fmtPct });
    // grain
    def({ ...g, id: 'gran.size', label: 'SIZE', min: 0.005, max: 1, def: 0.09, curve: 'exp', fmt: U.fmtSec });
    def({ ...g, id: 'gran.sizernd', label: 'SIZE ±', min: 0, max: 1, def: 0, fmt: U.fmtPct });
    def({ ...g, id: 'gran.skew', label: 'SKEW', min: -1, max: 1, def: 0, fmt: bip });
    def({ ...g, id: 'gran.reverse', label: 'REVERSE', min: 0, max: 1, def: 0, fmt: U.fmtPct });
    // pitch
    def({ ...g, id: 'gran.pitch', label: 'PITCH', min: -24, max: 24, def: 0, fmt: semis });
    def({ ...g, id: 'gran.fine', label: 'FINE', min: -100, max: 100, def: 0, fmt: cents });
    def({ ...g, id: 'gran.detune', label: 'SCATTER', min: 0, max: 24, def: 0.06, curve: 'pow', fmt: (v) => (v < 1 ? Math.round(v * 100) + 'ct' : '±' + v.toFixed(1) + 'st') });
    // voice envelope
    def({ ...g, id: 'gran.attack', label: 'ATTACK', min: 0.002, max: 4, def: 0.04, curve: 'exp', fmt: U.fmtSec });
    def({ ...g, id: 'gran.decay', label: 'DECAY', min: 0.01, max: 4, def: 0.4, curve: 'exp', fmt: U.fmtSec });
    def({ ...g, id: 'gran.sustain', label: 'SUSTAIN', min: 0, max: 1, def: 0.8, fmt: U.fmtPct });
    def({ ...g, id: 'gran.release', label: 'RELEASE', min: 0.01, max: 8, def: 0.5, curve: 'exp', fmt: U.fmtSec });
    // voice filter
    def({ ...g, id: 'gran.cutoff', label: 'CUTOFF', min: 40, max: 20000, def: 20000, curve: 'exp', fmt: U.fmtHz });
    def({ ...g, id: 'gran.res', label: 'RESO', min: 0.3, max: 18, def: 0.7, curve: 'exp', fmt: (v) => v.toFixed(1) });
    def({ ...g, id: 'gran.fenv', label: 'ENV AMT', min: -1, max: 1, def: 0, fmt: (v) => (v >= 0 ? '+' : '') + (v * 6).toFixed(1) + 'oct' });
    // output
    def({ ...g, id: 'gran.spread', label: 'SPREAD', min: 0, max: 1, def: 0.5, fmt: U.fmtPct });
    def({ ...g, id: 'gran.amprnd', label: 'AMP ±', min: 0, max: 1, def: 0, fmt: U.fmtPct });
  }

  // ---------------- Effects ----------------
  BBB.FX = [
    { id: 'drive', name: 'DRIVE', params: ['fx.drive.amt', 'fx.drive.tone'] },
    { id: 'filter', name: 'FILTER', params: ['fx.filter.cut', 'fx.filter.res'] },
    { id: 'delay', name: 'DELAY', params: ['fx.delay.time', 'fx.delay.fb', 'fx.delay.tone'] },
    { id: 'reverb', name: 'REVERB', params: ['fx.reverb.size', 'fx.reverb.damp'] }
  ];
  {
    const g = (fx) => ({ group: 'fx', groupLabel: fx, color: '#e6c77d', audio: true });
    def({ ...g('DRIVE'), id: 'fx.drive.amt', label: 'AMOUNT', min: 0, max: 1, def: 0.45, fmt: U.fmtPct });
    def({ ...g('DRIVE'), id: 'fx.drive.tone', label: 'TONE', min: 400, max: 18000, def: 7000, curve: 'exp', fmt: U.fmtHz });
    def({ ...g('FILTER'), id: 'fx.filter.cut', label: 'CUTOFF', min: 30, max: 18000, def: 1200, curve: 'exp', fmt: U.fmtHz });
    def({ ...g('FILTER'), id: 'fx.filter.res', label: 'RESO', min: 0.4, max: 18, def: 3, curve: 'exp', fmt: (v) => v.toFixed(1) });
    def({ ...g('DELAY'), id: 'fx.delay.time', label: 'TIME', min: 0.25, max: 8, def: 3, fmt: (v) => {
      const r = Math.round(v);
      return Math.abs(v - r) < 0.05 ? r + '/16' : v.toFixed(2) + '/16';
    } });
    def({ ...g('DELAY'), id: 'fx.delay.fb', label: 'FEEDBACK', min: 0, max: 0.95, def: 0.45, fmt: U.fmtPct });
    def({ ...g('DELAY'), id: 'fx.delay.tone', label: 'TONE', min: 400, max: 18000, def: 4500, curve: 'exp', fmt: U.fmtHz });
    def({ ...g('REVERB'), id: 'fx.reverb.size', label: 'SIZE', min: 0.3, max: 8, def: 2.4, curve: 'exp', fmt: U.fmtSec, mod: false, audio: false });
    def({ ...g('REVERB'), id: 'fx.reverb.damp', label: 'DAMP', min: 600, max: 18000, def: 6000, curve: 'exp', fmt: U.fmtHz });
    BBB.FX.forEach((fx) => TRACKS.forEach((t) => {
      def({ id: `mix.${fx.id}.${t.id}`, label: t.short, group: 'mix', groupLabel: fx.name + ' MIX', color: t.color, min: 0, max: 1, def: 0, fmt: U.fmtPct, audio: true, trackColor: t.color });
    }));
  }

  // ---------------- Master ----------------
  def({ id: 'master.vol', group: 'master', groupLabel: 'MASTER', label: 'VOLUME', min: 0, max: 1.2, def: 0.85, fmt: level, audio: true, color: '#e6c77d' });
  def({ id: 'master.swing', group: 'master', groupLabel: 'MASTER', label: 'SWING', min: 0, max: 0.7, def: 0, fmt: U.fmtPct, color: '#e6c77d' });

  // ---------------- LFOs ----------------
  BBB.LFO_DIVS = [
    ['8 BAR', 32], ['4 BAR', 16], ['2 BAR', 8], ['1 BAR', 4], ['1/2', 2], ['1/2T', 4 / 3], ['1/4', 1], ['1/4T', 2 / 3],
    ['1/8', 0.5], ['1/8T', 1 / 3], ['1/16', 0.25], ['1/16T', 1 / 6], ['1/32', 0.125]
  ];
  BBB.LFO_SHAPES = [
    ['sine', 'Sine'], ['tri', 'Triangle'], ['saw', 'Saw'], ['square', 'Square'], ['sh', 'Chance'], ['drift', 'Reverie']
  ];
  for (let i = 0; i < 4; i++) {
    const g = { group: 'lfo' + i, groupLabel: 'LFO ' + (i + 1), color: LFO_COLORS[i], mod: false };
    def({ ...g, id: `lfo${i}.div`, label: 'RATE', min: 0, max: BBB.LFO_DIVS.length - 1, steps: BBB.LFO_DIVS.length, def: [3, 6, 8, 1][i], fmt: (v) => BBB.LFO_DIVS[Math.round(v)][0] });
    def({ ...g, id: `lfo${i}.hz`, label: 'RATE', min: 0.02, max: 20, def: 0.5, curve: 'exp', fmt: (v) => (v < 1 ? v.toFixed(2) : v.toFixed(1)) + 'Hz' });
    def({ ...g, id: `lfo${i}.phase`, label: 'PHASE', min: 0, max: 1, def: 0, fmt: (v) => Math.round(v * 360) + '°' });
  }

  // ---------------- Global state ----------------
  const S = (BBB.state = {
    bpm: 120,
    tracks: TRACKS.map((t) => ({
      ...t,
      steps: t.kind === 'drum' ? Array.from({ length: 16 }, () => ({ on: false, vel: 0.85 })) : null,
      notes: t.kind === 'granular' ? [] : null,
      mute: false, solo: false,
      sample: null // SampleSlot, assigned in app.js
    })),
    lfos: [0, 1, 2, 3].map((i) => ({ shape: ['sine', 'tri', 'sh', 'drift'][i], sync: true })),
    mods: [], // {lfo, param, depth}
    auto: { rec: false, bars: 1, lanes: {} }, // lanes: id -> Float32Array (normalized)
    fx: { filterType: 'lowpass' },
    gran: { window: 'hann', quant: 'off', freeze: false }
  });
  BBB.GRAIN_WINDOWS = [['hann', 'Hann'], ['gauss', 'Gauss'], ['tri', 'Triangle'], ['tukey', 'Plateau'], ['perc', 'Pluck'], ['swell', 'Swell'], ['rect', 'Gate']];
  BBB.PITCH_QUANT = [['off', 'Free verse'], ['semi', 'Semitones'], ['fifth', 'Fifths'], ['oct', 'Octaves'], ['penta', 'Pentatonic'], ['minor', 'Minor']];
  BBB.AUTO_RES = 16; // automation points per beat (64 per bar)

  // Default pattern
  BBB.loadDefaultPattern = () => {
    const [k, s, h, g] = S.tracks;
    k.steps.forEach((st, i) => { st.on = i % 4 === 0 || i === 14; st.vel = i === 14 ? 0.6 : 0.95; });
    s.steps.forEach((st, i) => { st.on = i === 4 || i === 12 || i === 15; st.vel = i === 15 ? 0.45 : 0.9; });
    h.steps.forEach((st, i) => { st.on = i % 2 === 0 || i === 7 || i === 11; st.vel = i % 4 === 2 ? 0.95 : 0.55; });
    g.notes = [
      { step: 0, note: 60, len: 6 }, { step: 0, note: 63, len: 6 }, { step: 0, note: 67, len: 6 },
      { step: 8, note: 58, len: 6 }, { step: 8, note: 62, len: 6 }, { step: 8, note: 65, len: 6 },
      { step: 14, note: 70, len: 2 }
    ];
    BBB.param('mix.reverb.gran').setNorm(0.45);
    BBB.param('mix.delay.gran').setNorm(0.25);
    BBB.param('mix.reverb.snare').setNorm(0.2);
    BBB.param('mix.delay.hat').setNorm(0.15);
    S.mods = [{ lfo: 0, param: 'gran.pos', depth: 0.18 }];
    BBB.rebuildModIndex();
  };

  // ---------------- The literary vocabulary ----------------
  // Display names (set in script) with plain descriptions for tooltips.
  const LIT = {
    level: ['Volume', 'How loud the track plays'], pan: ['Margin', 'Stereo position, from left margin to right'],
    tune: ['Intone', 'Tuning in semitones'], decay: ['Coda', 'How quickly each hit fades; FULL lets it ring'],
    start: ['Preface', 'Skip into the sample before playing'],
    'gran.pos': ['Page', 'Position: where in the sample grains are read'], 'gran.scan': ['Pace', 'Scan: how fast the reading position travels while a note plays'],
    'gran.spray': ['Skim', 'Spray: random scatter around the page'], 'gran.dens': ['Verbose', 'Density: grains per second'],
    'gran.jitter': ['Stammer', 'Randomness of grain timing, from metronomic to cloud-like'],
    'gran.size': ['Syllable', 'Length of each grain'], 'gran.sizernd': ['Ragged', 'Random variation of grain length'],
    'gran.skew': ['Slant', 'Leans the grain window earlier or later'], 'gran.reverse': ['Verso', 'Chance that a grain reads backwards'],
    'gran.pitch': ['Register', 'Transpose in semitones'], 'gran.fine': ['Nuance', 'Fine tuning in cents'],
    'gran.detune': ['Aside', 'Digression: random pitch scatter per grain'],
    'gran.attack': ['Rising', 'Attack time of each note'], 'gran.decay': ['Falling', 'Decay time down to the sustain level'],
    'gran.sustain': ['Plot', 'Sustain level while the note is held'], 'gran.release': ['Epilogue', 'Release time after the note ends'],
    'gran.cutoff': ['Clarity', 'Low-pass filter cutoff'], 'gran.res': ['Stress', 'Filter resonance'],
    'gran.fenv': ['Drama', 'How far the envelope opens or closes the filter'],
    'gran.spread': ['Breadth', 'Random stereo placement of grains'], 'gran.amprnd': ['Temper', 'Random loudness per grain'],
    'fx.drive.amt': ['Fervour', 'Drive amount'], 'fx.drive.tone': ['Tone', 'Brightness after the drive'],
    'fx.filter.cut': ['Censor', 'Filter cutoff frequency'], 'fx.filter.res': ['Stress', 'Filter resonance'],
    'fx.delay.time': ['Interval', 'Delay time in sixteenth notes'], 'fx.delay.fb': ['Ibid.', 'Feedback: how often the echo repeats itself'],
    'fx.delay.tone': ['Patina', 'Darkening of each repeat'],
    'fx.reverb.size': ['Hall', 'Size of the room'], 'fx.reverb.damp': ['Velvet', 'Damping: how much the room absorbs'],
    'master.vol': ['Volume', 'Master output level'], 'master.swing': ['Lilt', 'Swing: delays every second sixteenth'],
    div: ['Tempo', 'LFO speed, synced to the beat'], hz: ['Tempo', 'LFO speed in Hz'], phase: ['Phase', 'Starting point of the LFO cycle']
  };
  const GROUP_LIT = { fx: null, master: 'Master', gran: 'Granular' };
  const FX_LIT = { drive: 'Purple Prose', filter: 'Redaction', delay: 'Footnotes', reverb: 'Reading Room' };
  BBB.FX.forEach((f) => { f.lit = FX_LIT[f.id]; });
  BBB.FX_LIT = FX_LIT;
  P.forEach((p, id) => {
    const key = LIT[id] ? id : id.split('.').pop();
    const e = LIT[key];
    if (e) { p.lit = e[0]; p.desc = e[1]; }
    const t = TRACKS.find((x) => x.id === p.group);
    if (t) p.groupLit = t.title;
    else if (p.group === 'fx') p.groupLit = FX_LIT[id.split('.')[1]];
    else if (p.group === 'mix') { p.groupLit = FX_LIT[id.split('.')[1]]; const tr = TRACKS.find((x) => x.id === id.split('.')[2]); p.lit = tr.title; p.tech = id.split('.')[1] + ' dry/wet for ' + tr.title.toLowerCase(); p.desc = 'Dry ink to wet ink: how much of this chapter goes through the effect'; }
    else if (p.group.startsWith('lfo')) p.groupLit = 'Muse ' + ['I', 'II', 'III', 'IV'][+p.group.slice(3)];
    else if (GROUP_LIT[p.group]) p.groupLit = GROUP_LIT[p.group];
  });

  BBB.anySolo = () => S.tracks.some((t) => t.solo);
  BBB.trackAudible = (t) => !t.mute && (!BBB.anySolo() || t.solo);

  // ---------------- Modulation ----------------
  let modIndex = {};
  BBB.rebuildModIndex = () => {
    modIndex = {};
    S.mods.forEach((m) => { (modIndex[m.param] = modIndex[m.param] || []).push(m); });
    BBB.emit('mods');
  };
  BBB.modsFor = (id) => modIndex[id] || null;
  BBB.addMod = (lfo, param, depth) => {
    const p = BBB.param(param);
    if (!p || !p.mod) return false;
    const ex = S.mods.find((m) => m.lfo === lfo && m.param === param);
    if (ex) { BBB.emit('mods'); return false; }
    S.mods.push({ lfo, param, depth: depth == null ? 0.25 : depth });
    BBB.rebuildModIndex();
    return true;
  };
  BBB.removeMod = (lfo, param) => {
    S.mods = S.mods.filter((m) => !(m.lfo === lfo && m.param === param));
    BBB.rebuildModIndex();
  };

  // LFO value in [-1, 1]. clock provides beats/seconds for time t.
  BBB.lfoValue = (i, beats, secs) => {
    const L = S.lfos[i];
    const ph0 = BBB.param(`lfo${i}.phase`).norm;
    let phase;
    if (L.sync) phase = beats / BBB.LFO_DIVS[Math.round(BBB.param(`lfo${i}.div`).value)][1] + ph0;
    else phase = secs * BBB.param(`lfo${i}.hz`).value + ph0;
    const cyc = Math.floor(phase), f = phase - cyc;
    switch (L.shape) {
      case 'sine': return Math.sin(f * Math.PI * 2);
      case 'tri': return f < 0.25 ? f * 4 : f < 0.75 ? 2 - f * 4 : f * 4 - 4;
      case 'saw': return f * 2 - 1;
      case 'square': return f < 0.5 ? 1 : -1;
      case 'sh': return U.hash(cyc, i * 7919 + 13) * 2 - 1;
      case 'drift': {
        const a = U.hash(cyc, i * 104729 + 5) * 2 - 1, b = U.hash(cyc + 1, i * 104729 + 5) * 2 - 1;
        const s = (1 - Math.cos(f * Math.PI)) / 2;
        return a + (b - a) * s;
      }
    }
    return 0;
  };

  // ---------------- Automation ----------------
  BBB.laneLength = () => S.auto.bars * 4 * BBB.AUTO_RES;
  BBB.laneValue = (lane, beats) => {
    const len = lane.length;
    const x = U.wrap(beats * BBB.AUTO_RES, len);
    const i0 = Math.floor(x), fr = x - i0;
    return lane[i0] + (lane[(i0 + 1) % len] - lane[i0]) * fr;
  };
  BBB.ensureLane = (id) => {
    let lane = S.auto.lanes[id];
    if (!lane) { lane = S.auto.lanes[id] = new Float32Array(BBB.laneLength()).fill(BBB.param(id).norm); BBB.emit('auto'); }
    return lane;
  };
  BBB.clearLane = (id) => { delete S.auto.lanes[id]; BBB.emit('auto'); };
  BBB.clearAllLanes = () => { S.auto.lanes = {}; BBB.emit('auto'); };
  BBB.setAutoBars = (bars) => {
    const newLen = bars * 4 * BBB.AUTO_RES;
    for (const id in S.auto.lanes) {
      const old = S.auto.lanes[id], nl = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) nl[i] = old[i % old.length];
      S.auto.lanes[id] = nl;
    }
    S.auto.bars = bars;
    BBB.emit('auto');
  };

  /**
   * Effective (modulated + automated) value of a parameter at a point in time.
   * clk: { playing, beats, secs } — beats/secs at the time of evaluation.
   */
  BBB.valueAt = (id, clk, live) => {
    const p = P.get(id);
    let n = p.norm;
    if (clk.playing) {
      const lane = S.auto.lanes[id];
      if (lane && !(live && p.touching)) n = BBB.laneValue(lane, clk.beats);
    }
    const mods = modIndex[id];
    if (mods) for (let k = 0; k < mods.length; k++) n += BBB.lfoValue(mods[k].lfo, clk.beats, clk.secs) * mods[k].depth;
    return p.fromNorm(n);
  };
})();
