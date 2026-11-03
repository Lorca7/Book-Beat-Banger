/* Book Beat Banger — application shell: layout, transport, recording, export, projects, shortcuts */
(async function () {
  'use strict';
  const BBB = window.BBB, U = BBB.util, S = BBB.state;
  const $ = (sel, root) => (root || document).querySelector(sel);

  if (window.bbbNative) document.body.classList.add('native', 'platform-' + window.bbbNative.platform);

  // ---------------- audio + data ----------------
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  BBB.ctx = ctx;
  BBB.ensureAudio = async () => { if (ctx.state !== 'running') { try { await ctx.resume(); } catch (e) { /* ignore */ } } };
  const unlock = () => BBB.ensureAudio();
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  S.tracks.forEach((t) => { t.sample = new BBB.SampleSlot(t.id); });
  const fontsReady = document.fonts ? Promise.all(['600 12px "Cormorant Garamond"', '700 12px "Cormorant Garamond"', 'italic 600 12px "Cormorant Garamond"', 'italic 500 12px "Cormorant Garamond"', '12px "Petit Formal Script"']
    .map((f) => document.fonts.load(f))).catch(() => null) : Promise.resolve();
  const [factory] = await Promise.all([BBB.makeFactorySounds(), fontsReady]);
  S.tracks.forEach((t) => {
    t.sample.factory = factory[t.id];
    t.sample.setRaw(factory[t.id], { name: 'Factory ' + t.name.toLowerCase(), custom: false });
  });
  BBB.loadDefaultPattern();

  const engine = (BBB.engine = new BBB.Engine(ctx));
  engine.applyAll('set', ctx.currentTime);
  BBB.mic = new BBB.MicRecorder(ctx);

  // ---------------- layout ----------------
  const app = $('#app');
  app.innerHTML = '';
  const rows = [];
  const thumbs = [];
  const trackEls = [];
  let granPanel = null;

  // ---- top bar ----
  const playBtn = BBB.el('button', { class: 'tbtn play', title: 'Play / Stop (Space)', html: '<svg viewBox="0 0 20 20"><path d="M5 3 L17 10 L5 17 Z"/></svg>' });
  const stopBtn = BBB.el('button', { class: 'tbtn', title: 'Stop', html: '<svg viewBox="0 0 20 20"><rect x="4" y="4" width="12" height="12" rx="1"/></svg>' });
  const recBtn = BBB.el('button', { class: 'tbtn rec', title: 'Record — captures the master output to a WAV file (starts playback). Press again to stop and save.', html: '<span class="rec-dot"></span><span>Record</span>' });
  const recTime = BBB.el('span', { class: 'mono rec-clock' });
  const autoBtn = BBB.el('button', { class: 'tbtn auto', title: 'Annotate (automation write): while playing, dial movements are written into automation lanes, and pads and keys are written into the pattern (quantized).', html: '<span class="auto-dot"></span><span>Annotate</span>' });
  const autoBars = BBB.el('select', { class: 'mini-sel', title: 'Automation loop length' }, [1, 2, 4, 8].map((b) => BBB.el('option', { value: b, text: b + (b === 1 ? ' bar' : ' bars') })));
  const autoClear = BBB.el('button', { class: 'btn tiny', text: 'Erase', title: 'Erase all annotations (automation)' });
  const bpmIn = BBB.el('input', { class: 'bpm-in mono', type: 'number', min: 40, max: 240, step: 1, value: S.bpm });
  const bpmBox = BBB.el('div', { class: 'bpm', title: 'Tempo — drag ↕ on the label or type' }, [BBB.el('span', { class: 'bpm-lbl', text: 'Tempo' }), bpmIn]);
  const posEl = BBB.el('div', { class: 'pos mono', text: '1.1.1' });
  const swingK = new BBB.Knob(BBB.param('master.swing'), { size: 30, small: true });
  const volK = new BBB.Knob(BBB.param('master.vol'), { size: 30, small: true });
  const meter = BBB.el('canvas', { class: 'meter', width: 192, height: 56 });
  const libBtn = BBB.el('button', { class: 'btn library', text: 'Library ▾', title: 'New, open and save projects · shortcuts' });
  libBtn.addEventListener('click', () => {
    const r = libBtn.getBoundingClientRect();
    BBB.contextMenu(r.left, r.bottom + 4, [
      { label: 'Begin a new volume   ⌘N', fn: () => newProject() },
      { label: 'Open a volume…   ⌘O', fn: () => openProject() },
      { label: 'Save this volume…   ⌘S', fn: () => saveProject() },
      { sep: true },
      { label: 'Publish as WAV…   ⌘E', fn: () => showExport() },
      { label: 'Index of shortcuts', fn: () => showHelp() }
    ]);
  });
  const fileBtns = BBB.el('div', { class: 'file-btns' }, [
    libBtn,
    BBB.el('button', { class: 'btn accent', text: 'Publish', title: 'Publish — render the song to a WAV file (⌘E)', onclick: () => showExport() })
  ]);
  app.appendChild(BBB.el('header', { class: 'topbar leather spine' }, [
    BBB.el('div', { class: 'brand' }, [
      BBB.el('div', { class: 'logo', html: 'Book <i>Beat</i> Banger' }),
      BBB.el('div', { class: 'sub', html: 'a sampling drum machine in four chapters' })
    ]),
    BBB.el('div', { class: 'transport' }, [playBtn, stopBtn, recBtn, recTime]),
    BBB.el('div', { class: 'autobox' }, [autoBtn, autoBars, autoClear]),
    bpmBox, posEl,
    BBB.el('div', { class: 'master-knobs' }, [swingK.el, volK.el]),
    meter,
    BBB.el('div', { class: 'spacer' }),
    fileBtns
  ]));

  // ---- sequencer ----
  const seq = BBB.el('section', { class: 'seq paper' });
  app.appendChild(seq);
  S.tracks.forEach((t, i) => {
    const row = BBB.el('div', { class: 'track ' + t.kind, style: { '--c': t.color } });
    const led = BBB.el('span', { class: 'led' });
    const pad = BBB.el('button', { class: 'pad', title: t.kind === 'drum' ? `Play ${t.title} (key ${i + 1})` : 'Play the granular synth (keys A–K)' }, [
      led, BBB.el('span', { class: 'numeral', text: t.numeral + '.' }), BBB.el('span', { class: 'tname', text: t.title })
    ]);
    pad.addEventListener('pointerdown', (e) => { if (e.button === 0) { BBB.ensureAudio(); liveHit(i, 0.9); } });
    const mBtn = BBB.el('button', { class: 'mini', text: 'M', title: 'Mute' });
    const sBtn = BBB.el('button', { class: 'mini', text: 'S', title: 'Solo' });
    mBtn.addEventListener('click', () => { t.mute = !t.mute; refreshMS(); });
    sBtn.addEventListener('click', () => { t.solo = !t.solo; refreshMS(); });
    const rBtn = BBB.el('button', { class: 'mini recmini', title: 'Record a sample into this track', html: '<span class="rec-dot"></span>' });
    rBtn.addEventListener('click', () => { editor.select(i); editor.toggleRec(); });
    const eBtn = BBB.el('button', { class: 'mini', text: '✎', title: 'Edit this track\'s sample' });
    eBtn.addEventListener('click', () => editor.select(i));
    const thumb = BBB.el('canvas', { class: 'thumb', width: 400, height: 80, title: 'Click to edit · drop an audio file on this row to load it' });
    const thumbWrap = BBB.el('div', { class: 'thumb-wrap' }, [thumb]);
    thumb.addEventListener('click', () => editor.select(i));
    thumbs[i] = thumb;
    const head = BBB.el('div', { class: 'th' }, [pad, BBB.el('div', { class: 'th-btns' }, [mBtn, sBtn, rBtn, eBtn]), thumbWrap]);
    row.appendChild(head);
    row._m = mBtn; row._s = sBtn; row._r = rBtn; row._led = led;
    const body = BBB.el('div', { class: 'tbody' });
    row.appendChild(body);
    rows[i] = t.kind === 'drum' ? new BBB.StepRow(t, body) : new BBB.PianoRoll(t, body);
    if (rows[i].octEl) head.appendChild(rows[i].octEl);
    const tools = BBB.el('div', { class: 'ttools' }, [
      BBB.el('button', { class: 'mini', text: '‹', title: 'Shift pattern left', onclick: () => rotate(i, -1) }),
      BBB.el('button', { class: 'mini', text: '›', title: 'Shift pattern right', onclick: () => rotate(i, 1) }),
      BBB.el('button', { class: 'mini', text: '✕', title: 'Clear pattern', onclick: () => clearTrack(i) })
    ]);
    row.appendChild(tools);
    if (t.kind === 'drum') {
      const kn = BBB.el('div', { class: 'tknobs' });
      ['level', 'pan', 'tune', 'decay', 'start'].forEach((k) => kn.appendChild(new BBB.Knob(BBB.param(t.id + '.' + k), { size: 30 }).el));
      row.appendChild(kn);
    } else {
      granPanel = new BBB.GranPanel(row);
    }
    row.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); row.classList.add('over'); } });
    row.addEventListener('dragleave', () => row.classList.remove('over'));
    row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('over'); if (e.dataTransfer.files[0]) BBB.loadFileIntoTrack(i, e.dataTransfer.files[0]); });
    trackEls[i] = row;
    seq.appendChild(row);
  });

  // ---- bottom: editor, fx, lfos ----
  const bottom = BBB.el('section', { class: 'bottom' });
  app.appendChild(bottom);
  const editor = (BBB.editor = new BBB.SampleEditor(bottom));
  const fx = BBB.el('div', { class: 'panel fx leather binding-navy' });
  fx.appendChild(BBB.el('div', { class: 'panel-head' }, [BBB.el('div', { class: 'panel-title', html: 'Effects' }), BBB.el('div', { class: 'hint', text: 'dry ink ↔ wet ink, chapter by chapter' })]));
  const fxGrid = BBB.el('div', { class: 'fx-grid' });
  fxGrid.appendChild(BBB.el('div', { class: 'fx-colhead' }, [
    BBB.el('span', { text: '' }), BBB.el('span', { text: 'Particulars' }),
    BBB.el('span', { class: 'mixhead' }, S.tracks.map((t) => BBB.el('span', { text: t.short, style: { color: t.color }, title: t.name + ' dry/wet' })))
  ]));
  BBB.FX.forEach((f) => {
    const m = BBB.el('div', { class: 'fxm' });
    const head = BBB.el('div', { class: 'fxm-head', title: f.lit + ' — ' + f.name.toLowerCase() }, [BBB.el('span', { class: 'fxm-name', text: f.lit }), BBB.el('span', { class: 'fxm-tech', text: f.name.toLowerCase() })]);
    if (f.id === 'filter') {
      const types = [['lowpass', 'LP'], ['bandpass', 'BP'], ['highpass', 'HP']];
      const tb = BBB.el('div', { class: 'ftypes' });
      types.forEach(([ty, lbl]) => {
        const b = BBB.el('button', { class: 'shape' + (S.fx.filterType === ty ? ' on' : ''), text: lbl, 'data-type': ty, onclick: () => {
          S.fx.filterType = ty; engine.setFilterType(ty);
          tb.querySelectorAll('.shape').forEach((x) => x.classList.toggle('on', x.dataset.type === ty));
        } });
        tb.appendChild(b);
      });
      head.appendChild(tb);
      fx._ftypes = tb;
    }
    m.appendChild(head);
    const gk = BBB.el('div', { class: 'fxm-knobs' });
    f.params.forEach((id) => gk.appendChild(new BBB.Knob(BBB.param(id), { size: 34, small: true }).el));
    m.appendChild(gk);
    const mk = BBB.el('div', { class: 'fxm-mix' });
    S.tracks.forEach((t) => mk.appendChild(new BBB.Knob(BBB.param(`mix.${f.id}.${t.id}`), { size: 32, small: true, nolabel: true, color: t.color }).el));
    m.appendChild(mk);
    fxGrid.appendChild(m);
  });
  fx.appendChild(fxGrid);
  bottom.appendChild(fx);
  const lfoPanel = new BBB.LfoPanel(bottom);

  // ---------------- behaviours ----------------
  function refreshMS() {
    S.tracks.forEach((t, i) => {
      trackEls[i]._m.classList.toggle('on', t.mute);
      trackEls[i]._s.classList.toggle('on', t.solo);
      trackEls[i].classList.toggle('dim', !BBB.trackAudible(t));
    });
    engine.applyMute(false);
  }
  function rotate(i, d) {
    const t = S.tracks[i];
    if (t.kind === 'drum') {
      const s = t.steps;
      if (d > 0) s.unshift(s.pop()); else s.push(s.shift());
    } else {
      t.notes.forEach((n) => { n.step = U.wrap(n.step + d, 16); n.len = Math.min(n.len, 16 - n.step); });
    }
    rows[i].render ? rows[i].render() : rows[i].draw();
  }
  function clearTrack(i) {
    const t = S.tracks[i];
    if (t.kind === 'drum') t.steps.forEach((s) => { s.on = false; s.vel = 0.85; });
    else t.notes.length = 0;
    rows[i].render ? rows[i].render() : rows[i].draw();
  }
  function renderAllRows() { rows.forEach((r) => (r.render ? r.render() : r.draw())); }

  BBB.loadFileIntoTrack = async (i, file) => {
    try {
      await BBB.ensureAudio();
      const ab = await file.arrayBuffer();
      let buf = await ctx.decodeAudioData(ab);
      const maxLen = 60 * buf.sampleRate;
      if (buf.length > maxLen) {
        const c = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: maxLen, sampleRate: buf.sampleRate });
        for (let ch = 0; ch < buf.numberOfChannels; ch++) c.copyToChannel(buf.getChannelData(ch).subarray(0, maxLen), ch);
        buf = c;
        BBB.toast('Abridged to sixty seconds');
      }
      const t = S.tracks[i];
      t.sample.setRaw(buf, { name: file.name.replace(/\.[^.]+$/, ''), custom: true, autoTrim: t.kind === 'drum' });
      editor.select(i); editor.fitRegion();
      BBB.toast(`Borrowed “${file.name}” for ${t.title}`);
    } catch (e) {
      console.error(e);
      BBB.toast('Could not decode that file (try WAV, MP3, M4A, FLAC or OGG)', 'err');
    }
  };

  // live input: pads & keys (written into the pattern while AUTO is armed and playing)
  const liveNotes = new Map();
  function quantStep() { return U.wrap(Math.round(engine.beatsAt(ctx.currentTime) * 4), 16); }
  function liveHit(i, vel) {
    engine.trigger(i, vel);
    if (S.auto.rec && engine.clock.playing) {
      const s = quantStep(), t = S.tracks[i];
      if (t.kind === 'drum') { t.steps[s].on = true; t.steps[s].vel = vel; rows[i].render(); }
    }
  }
  function liveNoteOn(note) {
    if (liveNotes.has(note)) return;
    const v = engine.noteOn(note);
    const rec = S.auto.rec && engine.clock.playing ? { step: quantStep(), beat: engine.beatsAt(ctx.currentTime) } : null;
    liveNotes.set(note, { v, rec });
    rows[3].keyDown = note; rows[3].draw();
  }
  function liveNoteOff(note) {
    const ln = liveNotes.get(note);
    if (!ln) return;
    liveNotes.delete(note);
    engine.noteOff(ln.v);
    if (ln.rec) {
      const len = U.clamp(Math.round((engine.beatsAt(ctx.currentTime) - ln.rec.beat) * 4), 1, 16 - ln.rec.step);
      const t = S.tracks[3];
      t.notes = t.notes.filter((n) => !(n.step === ln.rec.step && n.note === note));
      t.notes.push({ step: ln.rec.step, note, len, vel: 0.9 });
    }
    rows[3].keyDown = null; rows[3].draw();
  }

  // ---- transport ----
  function play() {
    BBB.ensureAudio();
    if (engine.clock.playing) return;
    engine.start();
    playBtn.classList.add('on');
  }
  function stop() {
    if (!engine.clock.playing) return;
    engine.stop();
    playBtn.classList.remove('on');
    rows.forEach((r) => r.setPlayhead(null));
    if (masterRec.active) finishMasterRec(2.0);
  }
  BBB.togglePlay = () => (engine.clock.playing ? stop() : play());
  playBtn.addEventListener('click', BBB.togglePlay);
  stopBtn.addEventListener('click', () => { stop(); engine.releaseAllNotes(); });

  const setBpm = (v) => {
    v = U.clamp(Math.round(v) || 120, 40, 240);
    S.bpm = v; bpmIn.value = v; engine.setBpm(v);
  };
  bpmIn.addEventListener('change', () => setBpm(+bpmIn.value));
  bpmIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') bpmIn.blur(); });
  document.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' && !e.target.closest('.modal')) e.target.blur(); });
  {
    const lbl = $('.bpm-lbl', bpmBox);
    let sy = 0, sv = 0, drag = false;
    lbl.addEventListener('pointerdown', (e) => { drag = true; sy = e.clientY; sv = S.bpm; lbl.setPointerCapture(e.pointerId); });
    lbl.addEventListener('pointermove', (e) => { if (drag) setBpm(sv + (sy - e.clientY) / (e.shiftKey ? 8 : 2)); });
    lbl.addEventListener('pointerup', () => { drag = false; });
    bpmIn.addEventListener('wheel', (e) => { e.preventDefault(); setBpm(S.bpm - Math.sign(e.deltaY)); }, { passive: false });
  }

  // ---- automation ----
  autoBtn.addEventListener('click', () => { S.auto.rec = !S.auto.rec; autoBtn.classList.toggle('on', S.auto.rec); });
  autoBars.addEventListener('change', () => BBB.setAutoBars(+autoBars.value));
  autoClear.addEventListener('click', () => { BBB.clearAllLanes(); BBB.toast('Annotations erased'); });
  const lastIdx = {};
  BBB.on('touch', (p, down) => { if (!down) delete lastIdx[p.id]; });
  function writeAutomation() {
    if (!S.auto.rec || !engine.clock.playing) return;
    const beats = engine.beatsAt(ctx.currentTime);
    if (beats < 0) return;
    const len = BBB.laneLength();
    const idx = Math.floor(U.wrap(beats * BBB.AUTO_RES, len));
    BBB.params.forEach((p) => {
      if (!p.touching || !p.mod) return;
      const isNew = !S.auto.lanes[p.id];
      const lane = BBB.ensureLane(p.id);
      let from = lastIdx[p.id];
      if (from == null || isNew) from = idx;
      let k = from, guard = 0;
      while (guard++ <= len) { lane[k] = p.norm; if (k === idx) break; k = (k + 1) % len; }
      lastIdx[p.id] = idx;
    });
  }
  BBB.on('auto', () => BBB.knobs.forEach((l) => l.forEach((k) => { k.updateBadges(); k.refresh(engine); })));

  // ---- master output recording ----
  const masterRec = { active: false, chunks: [], frames: 0, cap: null, finishing: false };
  async function startMasterRec() {
    await BBB.ensureAudio();
    masterRec.chunks = []; masterRec.frames = 0; masterRec.finishing = false;
    masterRec.cap = await BBB.createCapture(ctx, engine.out, 2, (chs) => {
      if (!masterRec.active) return;
      masterRec.chunks.push(chs); masterRec.frames += chs[0].length;
    });
    masterRec.active = true;
    recBtn.classList.add('on');
    if (!engine.clock.playing) play();
  }
  function finishMasterRec(tailSec) {
    if (!masterRec.active || masterRec.finishing) return;
    masterRec.finishing = true;
    recBtn.classList.add('finishing');
    setTimeout(() => {
      masterRec.active = false;
      if (masterRec.cap) masterRec.cap.stop();
      recBtn.classList.remove('on', 'finishing');
      const n = masterRec.frames;
      if (!n) return;
      const L = new Float32Array(n), R = new Float32Array(n);
      let o = 0;
      masterRec.chunks.forEach((c) => { L.set(c[0], o); R.set(c[1] || c[0], o); o += c[0].length; });
      masterRec.chunks = [];
      BBB.saveFile(`bbb-recording-${U.stamp()}.wav`, U.encodeWAV([L, R], ctx.sampleRate, 24), 'audio/wav', [{ name: 'WAV Audio', extensions: ['wav'] }]);
    }, (tailSec || 0) * 1000);
  }
  recBtn.addEventListener('click', () => { if (masterRec.active) finishMasterRec(0.3); else startMasterRec(); });

  // ---- param changes ----
  BBB.on('param', (p) => {
    engine.applyNow(p.id);
    (BBB.knobs.get(p.id) || []).forEach((k) => k.refresh(engine));
  });
  BBB.on('editor-select', (i) => trackEls.forEach((r, k) => r.classList.toggle('selected', k === i)));
  trackEls[0].classList.add('selected');
  BBB.on('rec-ui', (st, ti) => trackEls.forEach((r, k) => {
    r._r.classList.toggle('armed', k === ti && st === 'armed');
    r._r.classList.toggle('recording', k === ti && st === 'recording');
  }));

  // ---- thumbnails ----
  function drawThumb(i) {
    const cv = thumbs[i], g = cv.getContext('2d'), s = S.tracks[i].sample;
    g.clearRect(0, 0, cv.width, cv.height);
    if (!s.buffer) return;
    const d = s.buffer.getChannelData(0), W = cv.width, H = cv.height, mid = H / 2, T = BBB.THEME;
    const spp = d.length / W;
    g.fillStyle = T.rule; g.fillRect(0, mid, W, 1);
    g.fillStyle = S.tracks[i].color;
    for (let x = 0; x < W; x++) {
      let pk = 0;
      const a = Math.floor(x * spp), b = Math.floor((x + 1) * spp);
      for (let k = a; k < b; k += Math.max(1, Math.floor((b - a) / 32))) { const v = Math.abs(d[k]); if (v > pk) pk = v; }
      const h = Math.max(1, pk * (H / 2 - 4));
      g.fillRect(x, mid - h, 1, h * 2);
    }
    if (s.custom) {
      g.font = `20px ${T.script}`; g.textAlign = 'right';
      g.fillStyle = T.marker; g.fillText('in your own hand', W - 8, 26); g.textAlign = 'left';
    }
  }
  BBB.on('sample', (slot) => { const i = S.tracks.findIndex((t) => t.sample === slot); if (i >= 0) drawThumb(i); });
  S.tracks.forEach((t, i) => drawThumb(i));

  // ---- hit LEDs ----
  const hits = [];
  BBB.on('hit', (i, t) => hits.push({ i, t }));

  // ---------------- projects ----------------
  function serialize() {
    const params = {};
    BBB.params.forEach((p, id) => { params[id] = p.norm; });
    const lanes = {};
    for (const id in S.auto.lanes) lanes[id] = Array.from(S.auto.lanes[id], (v) => Math.round(v * 10000) / 10000);
    return {
      app: 'book-beat-banger', version: 1, bpm: S.bpm, params,
      tracks: S.tracks.map((t) => ({ id: t.id, steps: t.steps, notes: t.notes, mute: t.mute, solo: t.solo, sample: t.sample.toJSON() })),
      lfos: S.lfos, mods: S.mods, auto: { bars: S.auto.bars, lanes }, fx: S.fx, gran: S.gran
    };
  }
  async function deserialize(j) {
    if (!j || j.app !== 'book-beat-banger') throw new Error('Not a Book Beat Banger project');
    if (engine.clock.playing) stop();
    engine.releaseAllNotes();
    setBpm(j.bpm || 120);
    for (const id in j.params) { const p = BBB.param(id); if (p) p.norm = U.clamp(j.params[id], 0, 1); }
    S.lfos.forEach((L, i) => Object.assign(L, (j.lfos || [])[i] || {}));
    S.mods = (j.mods || []).filter((m) => BBB.param(m.param));
    S.auto.bars = (j.auto && j.auto.bars) || 1;
    autoBars.value = S.auto.bars;
    S.auto.lanes = {};
    if (j.auto && j.auto.lanes) for (const id in j.auto.lanes) if (BBB.param(id)) S.auto.lanes[id] = Float32Array.from(j.auto.lanes[id]);
    S.fx = Object.assign({ filterType: 'lowpass' }, j.fx || {});
    S.gran = Object.assign({ window: 'hann', quant: 'off', freeze: false }, j.gran || {});
    if (granPanel) granPanel.sync();
    engine.setFilterType(S.fx.filterType);
    fx._ftypes.querySelectorAll('.shape').forEach((x) => x.classList.toggle('on', x.dataset.type === S.fx.filterType));
    for (const jt of j.tracks || []) {
      const t = S.tracks.find((x) => x.id === jt.id);
      if (!t) continue;
      if (t.kind === 'drum' && Array.isArray(jt.steps)) t.steps = jt.steps.slice(0, 16).map((s) => ({ on: !!s.on, vel: s.vel || 0.85 }));
      if (t.kind === 'granular' && Array.isArray(jt.notes)) t.notes = jt.notes.map((n) => ({ step: n.step, note: n.note, len: n.len || 1, vel: n.vel || 0.9 }));
      t.mute = !!jt.mute; t.solo = !!jt.solo;
      const sj = jt.sample || {};
      const slot = t.sample;
      if (sj.custom && sj.wav) {
        const bytes = U.b64decode(sj.wav);
        const buf = await ctx.decodeAudioData(bytes.buffer);
        slot.setRaw(buf, { name: sj.name, custom: true });
      } else slot.setRaw(slot.factory, { name: 'Factory ' + t.name.toLowerCase(), custom: false });
      ['start', 'end', 'fadeIn', 'fadeOut', 'gainDb', 'normalize', 'reverse'].forEach((k) => { if (sj[k] != null) slot[k] = sj[k]; });
      slot.process();
    }
    BBB.rebuildModIndex();
    lfoPanel.syncFromState();
    refreshMS();
    renderAllRows();
    engine.applyAll('now', ctx.currentTime);
    engine.setReverbSize(BBB.param('fx.reverb.size').value);
    BBB.knobs.forEach((l) => l.forEach((k) => { k.updateBadges(); k.refresh(engine); }));
    editor.select(editor.ti);
  }
  async function saveProject() {
    const json = JSON.stringify(serialize());
    await BBB.saveFile(`beat-${U.stamp()}.bbb`, new TextEncoder().encode(json), 'application/json', [{ name: 'Book Beat Banger Project', extensions: ['bbb'] }]);
  }
  const projIn = BBB.el('input', { type: 'file', accept: '.bbb,.json,application/json', style: { display: 'none' } });
  document.body.appendChild(projIn);
  projIn.addEventListener('change', async () => {
    const f = projIn.files[0];
    projIn.value = '';
    if (!f) return;
    try { await deserialize(JSON.parse(await f.text())); BBB.toast('Opened ' + f.name); }
    catch (e) { console.error(e); BBB.toast('Could not open project: ' + e.message, 'err'); }
  });
  function openProject() { projIn.click(); }
  async function newProject() {
    if (!window.confirm('Begin a new volume? Unsaved pages will be lost.')) return;
    const blank = serialize();
    BBB.params.forEach((p, id) => { blank.params[id] = p.defNorm; });
    blank.tracks.forEach((t) => {
      if (t.steps) t.steps = t.steps.map(() => ({ on: false, vel: 0.85 }));
      if (t.notes) t.notes = [];
      t.mute = t.solo = false;
      t.sample = { custom: false };
    });
    blank.mods = []; blank.auto = { bars: 1, lanes: {} }; blank.bpm = 120;
    blank.lfos = [0, 1, 2, 3].map((i) => ({ shape: ['sine', 'tri', 'sh', 'drift'][i], sync: true }));
    blank.fx = { filterType: 'lowpass' };
    blank.gran = { window: 'hann', quant: 'off', freeze: false };
    await deserialize(blank);
  }
  BBB.serialize = serialize; BBB.deserialize = deserialize;

  // ---------------- export dialog ----------------
  function modal(title, body, actions) {
    const ov = BBB.el('div', { class: 'modal-ov' });
    const box = BBB.el('div', { class: 'modal' }, [BBB.el('div', { class: 'modal-title', text: title }), body, BBB.el('div', { class: 'modal-actions' }, actions)]);
    ov.appendChild(box);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    return ov;
  }
  function showExport() {
    const sel = (opts, val) => { const s = BBB.el('select', {}, opts.map(([v, l]) => BBB.el('option', { value: v, text: l }))); s.value = val; return s; };
    const bars = sel([[1, '1 bar'], [2, '2 bars'], [4, '4 bars'], [8, '8 bars'], [16, '16 bars'], [32, '32 bars']], String(Math.max(4, S.auto.bars)));
    const sr = sel([[44100, '44.1 kHz'], [48000, '48 kHz']], '48000');
    const bits = sel([[16, '16-bit'], [24, '24-bit'], [32, '32-bit float']], '24');
    const tail = BBB.el('input', { type: 'checkbox', checked: true });
    const status = BBB.el('div', { class: 'status' });
    const body = BBB.el('div', { class: 'form' }, [
      BBB.el('label', {}, ['Length', bars]), BBB.el('label', {}, ['Sample rate', sr]), BBB.el('label', {}, ['Bit depth', bits]),
      BBB.el('label', { class: 'chk' }, [tail, 'Let the echoes finish (reverb & delay tails)']),
      BBB.el('p', { class: 'note', text: 'Renders the pattern with all automation and LFO modulation, faster than real time. To capture a live performance (mutes, dial tweaks, keys), use Record in the top bar instead.' }),
      status
    ]);
    const go = BBB.el('button', { class: 'btn accent', text: 'Typeset & Save' });
    const ov = modal('Publish', body, [BBB.el('button', { class: 'btn', text: 'Not yet', onclick: () => ov.remove() }), go]);
    go.addEventListener('click', async () => {
      go.disabled = true; status.textContent = 'Typesetting…';
      try {
        const t0 = performance.now();
        const buf = await BBB.renderOffline({ bars: +bars.value, tail: tail.checked, sampleRate: +sr.value });
        status.textContent = `Rendered ${buf.duration.toFixed(1)} s in ${((performance.now() - t0) / 1000).toFixed(1)} s — saving…`;
        const res = await BBB.saveFile(`bbb-export-${bars.value}bars-${S.bpm}bpm-${U.stamp()}.wav`, U.bufferToWAV(buf, +bits.value), 'audio/wav', [{ name: 'WAV Audio', extensions: ['wav'] }]);
        if (!res || res.ok !== false) ov.remove(); else { go.disabled = false; status.textContent = ''; }
      } catch (e) {
        console.error(e); status.textContent = 'Export failed: ' + e.message; go.disabled = false;
      }
    });
  }
  BBB.showExport = showExport;

  function showHelp() {
    const rowsH = [
      ['Space', 'Play / stop'], ['1 · 2 · 3', 'Play kick / snare / hi-hat'], ['A W S E D F T G Y H U J K', 'Play the granular synth chromatically'],
      ['Z / X', 'Keyboard octave down / up'], ['R', 'Record a sample into the selected track'], ['P', 'Preview the selected sample'],
      ['Esc', 'Cancel a dictation'], ['⌘S · ⌘O · ⌘E · ⌘N', 'Save · Open · Publish · New volume']
    ];
    const tips = [
      'Dictate: press ● on a chapter, or Dictate on the Manuscript. With “Await a Voice” on, recording begins when you make a sound. It is abridged (auto-trimmed) and ready to play at once.',
      'Manuscript: drag the red ribbons to trim and the wax seals to set fades. Drag across the page to choose a new passage; scroll to zoom.',
      'Steps: drag across them to paint. Option-drag up or down on a step sets its velocity.',
      'Granular piano roll: click to write a note and drag right to lengthen it. Drag a note to move it, or drag its right edge to resize. Click a note to strike it out.',
      'Granular: click the grain-window picture to change its shape. Digression with a Mode gives in-key pitch clouds. Dog-ear holds the Page still. The Manuscript shows every grain as it sounds.',
      'The Muses are LFOs. Drag a Muse onto any dial to inspire it, then drag its note left or right to set the depth. Right-click a dial for more.',
      'Annotate + play: dial movements become automation (loop length is selectable), and pads and keys are written into the pattern.',
      'Record captures a live performance to WAV. Publish renders a chosen number of bars offline.'
    ];

    modal('Index', BBB.el('div', { class: 'help' }, [
      BBB.el('table', {}, rowsH.map(([k, v]) => BBB.el('tr', {}, [BBB.el('td', { class: 'kbd', text: k }), BBB.el('td', { text: v })]))),
      BBB.el('ul', {}, tips.map((t) => BBB.el('li', { text: t })))
    ]), [BBB.el('button', { class: 'btn', text: 'Close the book', onclick: (e) => e.target.closest('.modal-ov').remove() })]);
  }

  // ---------------- keyboard ----------------
  const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12 };
  let kbOct = 60;
  const keyNotes = {};
  const isField = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
  window.addEventListener('keydown', (e) => {
    if (isField(e)) return;
    const k = e.key.toLowerCase();
    if (e.metaKey || e.ctrlKey) {
      if (window.bbbNative) return; // handled by the native menu
      if (k === 's') { e.preventDefault(); saveProject(); } else if (k === 'o') { e.preventDefault(); openProject(); } else if (k === 'e') { e.preventDefault(); showExport(); }
      return;
    }
    if (document.querySelector('.modal-ov')) { if (e.key === 'Escape') document.querySelector('.modal-ov').remove(); return; }
    if (e.code === 'Space') {
      e.preventDefault();
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      if (!e.repeat) BBB.togglePlay();
      return;
    }
    if (e.repeat) return;
    if (k in KEYMAP) { keyNotes[k] = kbOct + KEYMAP[k]; liveNoteOn(keyNotes[k]); return; }
    if (k === '1' || k === '2' || k === '3') { liveHit(+k - 1, e.shiftKey ? 1 : 0.85); return; }
    if (k === 'z') { kbOct = Math.max(24, kbOct - 12); BBB.toast('Keyboard octave C' + (kbOct / 12 - 1)); return; }
    if (k === 'x') { kbOct = Math.min(96, kbOct + 12); BBB.toast('Keyboard octave C' + (kbOct / 12 - 1)); return; }
    if (k === 'r') { editor.toggleRec(); return; }
    if (k === 'p') { editor.togglePreview(); return; }
    if (e.key === 'Escape' && BBB.mic.state !== 'idle') { BBB.mic.cancel(); BBB.toast('Recording cancelled'); }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in keyNotes) { liveNoteOff(keyNotes[k]); delete keyNotes[k]; }
  });
  window.addEventListener('blur', () => { for (const [note] of liveNotes) liveNoteOff(note); });

  if (window.bbbNative && window.bbbNative.onMenu) {
    window.bbbNative.onMenu((cmd) => {
      if (cmd === 'save') saveProject(); else if (cmd === 'open') openProject(); else if (cmd === 'export') showExport();
      else if (cmd === 'new') newProject(); else if (cmd === 'help') showHelp();
    });
  }

  // ---------------- scheduler clock (worker so it keeps time when the window is in the background) ----------------
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['let i=null;onmessage=()=>{if(i)clearInterval(i);i=setInterval(()=>postMessage(0),20)}'], { type: 'application/javascript' })));
    w.onmessage = () => engine.tick();
    w.postMessage('go');
  } catch (e) {
    setInterval(() => engine.tick(), 20);
  }

  // ---------------- animation frame ----------------
  let cur = null;
  const meterBuf = new Float32Array(2048);
  let meterPeak = 0, clipHold = 0;
  const flashing = new Map();
  function frame() {
    const now = ctx.currentTime;
    const q = engine.stepQueue;
    while (q.length && q[0].time <= now) cur = q.shift();
    if (!engine.clock.playing) cur = null;
    rows.forEach((r) => r.setPlayhead(cur ? cur.step : null));
    if (engine.clock.playing && cur) {
      const b = engine.beatsAt(now);
      if (b >= 0) posEl.textContent = `${Math.floor(b / 4) + 1}.${(Math.floor(b) % 4) + 1}.${(Math.floor(b * 4) % 4) + 1}`;
    } else if (!engine.clock.playing) posEl.textContent = '—.—.—';
    writeAutomation();
    // modulated / automated knobs
    BBB.knobs.forEach((list, id) => {
      if (BBB.modsFor(id) || S.auto.lanes[id]) list.forEach((k) => k.refresh(engine));
    });
    // hit LEDs
    for (let k = hits.length - 1; k >= 0; k--) {
      if (hits[k].t <= now) { flashing.set(hits[k].i, now + 0.08); trackEls[hits[k].i]._led.classList.add('on'); hits.splice(k, 1); }
    }
    flashing.forEach((until, i) => { if (now > until) { trackEls[i]._led.classList.remove('on'); flashing.delete(i); } });
    // meter
    engine.analyser.getFloatTimeDomainData(meterBuf);
    let pk = 0;
    for (let k = 0; k < meterBuf.length; k++) { const a = Math.abs(meterBuf[k]); if (a > pk) pk = a; }
    meterPeak = Math.max(pk, meterPeak * 0.9);
    if (pk > 0.98) clipHold = 40;
    const mg = meter.getContext('2d'), MW = meter.width, MH = meter.height;
    mg.clearRect(0, 0, MW, MH);
    const T = BBB.THEME;
    mg.fillStyle = T.paper; mg.fillRect(0, 0, MW, MH);
    // ledger ticks every 6 dB
    mg.fillStyle = T.rule;
    for (let db = -48; db <= 0; db += 6) mg.fillRect(4 + ((db + 48) / 48) * (MW - 30), MH - 12, 2, 8);
    const f = U.clamp((U.gainToDb(meterPeak) + 48) / 48, 0, 1);
    const grd = mg.createLinearGradient(0, 0, MW, 0);
    grd.addColorStop(0, '#2f7d68'); grd.addColorStop(0.72, '#b5862a'); grd.addColorStop(1, '#a8322a');
    mg.fillStyle = grd; mg.fillRect(4, 12, (MW - 30) * f, MH - 28);
    mg.fillStyle = clipHold-- > 0 ? T.marker : T.paperShade; mg.beginPath(); mg.arc(MW - 12, MH / 2, 7, 0, Math.PI * 2); mg.fill();
    recTime.textContent = masterRec.active ? U.fmtClock(masterRec.frames / ctx.sampleRate) : '';
    editor.frame(engine);
    lfoPanel.frame(engine);
    if (granPanel) granPanel.frame(engine);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  refreshMS();
  document.body.classList.add('ready');
  BBB.ready = true;
  BBB.emit('ready');
})().catch((e) => {
  console.error(e);
  const el = document.getElementById('app');
  if (el) el.innerHTML = '<div class="fatal">Failed to start: ' + (e && e.message) + '</div>';
});
