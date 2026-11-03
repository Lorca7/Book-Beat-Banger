/* Book Beat Banger — sample recorder & waveform editor */
(function () {
  'use strict';
  const BBB = window.BBB, U = BBB.util, S = BBB.state;

  class SampleEditor {
    constructor(host) {
      this.ti = 0;
      this.vs = 0; this.ve = 1; // view window (seconds)
      const el = (this.el = BBB.el('div', { class: 'panel editor leather binding-oxblood' }));
      // header
      this.tabs = S.tracks.map((t, i) => BBB.el('button', { class: 'tab', style: { '--c': t.color }, text: t.title, title: 'Chapter ' + t.numeral + ' — ' + t.title, onclick: () => this.select(i) }));
      this.info = BBB.el('div', { class: 'ed-info' });
      this.fileIn = BBB.el('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.m4a,.aif,.aiff,.flac,.ogg', style: { display: 'none' } });
      this.fileIn.addEventListener('change', () => { if (this.fileIn.files[0]) BBB.loadFileIntoTrack(this.ti, this.fileIn.files[0]); this.fileIn.value = ''; });
      el.appendChild(BBB.el('div', { class: 'panel-head' }, [
        BBB.el('div', { class: 'panel-title', html: '<span class="orn">❧</span> Sample' }), BBB.el('div', { class: 'tabs' }, this.tabs),
        BBB.el('div', { class: 'head-btns' }, [
          BBB.el('button', { class: 'btn tiny', text: 'LOAD…', title: 'Load an audio file into this track (or drop one on the waveform)', onclick: () => this.fileIn.click() }),
          BBB.el('button', { class: 'btn tiny', text: 'FACTORY', title: 'Restore the factory sound', onclick: () => this.restoreFactory() }),
          BBB.el('button', { class: 'btn tiny', text: 'SAVE WAV', title: 'Export this edited sample as a WAV file', onclick: () => this.exportSample() }),
          this.fileIn
        ])
      ]));
      // canvas
      this.canvas = BBB.el('canvas', { class: 'wave' });
      this.drop = BBB.el('div', { class: 'wave-wrap page' }, [this.canvas, this.info, BBB.el('div', { class: 'wave-hint', text: 'Drop an audio file here' })]);
      el.appendChild(this.drop);
      // record row
      this.recBtn = BBB.el('button', { class: 'btn rec', title: 'Record into this track (R)', onclick: () => this.toggleRec() }, [BBB.el('span', { class: 'rec-dot' }), BBB.el('span', { class: 'lbl', text: 'REC' })]);
      this.thrBtn = BBB.el('button', { class: 'btn toggle on', text: 'AUTO-START', title: 'Wait for sound above the threshold before recording starts', onclick: () => { BBB.mic.threshold = !BBB.mic.threshold; this.thrBtn.classList.toggle('on', BBB.mic.threshold); } });
      this.thr = BBB.el('input', { type: 'range', min: -60, max: -6, step: 1, value: -30, class: 'thr', title: 'Auto-start threshold' });
      this.thrLbl = BBB.el('span', { class: 'mono small', text: '-30dB' });
      this.thr.addEventListener('input', () => { BBB.mic.thresholdDb = +this.thr.value; this.thrLbl.textContent = this.thr.value + 'dB'; });
      this.meter = BBB.el('div', { class: 'in-meter', title: 'Input level' }, [BBB.el('div', { class: 'in-fill' }), BBB.el('div', { class: 'in-thr' })]);
      this.devSel = BBB.el('select', { class: 'dev', title: 'Input device' }, [BBB.el('option', { value: '', text: 'Default input' })]);
      this.devSel.addEventListener('change', () => { BBB.mic.deviceId = this.devSel.value; });
      this.devSel.addEventListener('focus', () => this.listDevices());
      this.recTime = BBB.el('span', { class: 'mono small rec-time' });
      el.appendChild(BBB.el('div', { class: 'ed-row' }, [this.recBtn, this.recTime, this.thrBtn, this.thr, this.thrLbl, this.meter, this.devSel]));
      // edit row
      this.playBtn = BBB.el('button', { class: 'btn', text: '▶ PLAY', title: 'Preview the edited sample (P)', onclick: () => this.togglePreview() });
      this.trimBtn = BBB.el('button', { class: 'btn', text: 'AUTO TRIM', title: 'Detect onset and tail automatically', onclick: () => { this.slot.autoTrim(); this.fitRegion(); } });
      this.normBtn = BBB.el('button', { class: 'btn toggle', text: 'NORMALIZE', onclick: () => { this.slot.normalize = !this.slot.normalize; this.slot.process(); } });
      this.revBtn = BBB.el('button', { class: 'btn toggle', text: 'REVERSE', onclick: () => { this.slot.reverse = !this.slot.reverse; this.slot.process(); } });
      const self = this;
      this.gainModel = {
        label: 'GAIN', color: '#e6c77d', defNorm: 0.5,
        get norm() { return self.slot ? (self.slot.gainDb + 24) / 48 : 0.5; },
        setNorm(n) { if (!self.slot) return; self.slot.gainDb = Math.round((n * 48 - 24) * 2) / 2; self.slot.process(); },
        format() { return (self.slot && self.slot.gainDb > 0 ? '+' : '') + (self.slot ? self.slot.gainDb.toFixed(1) : '0') + 'dB'; }
      };
      this.gainKnob = new BBB.Knob(this.gainModel, { size: 34, small: true });
      el.appendChild(BBB.el('div', { class: 'ed-row' }, [
        this.playBtn, this.trimBtn, this.normBtn, this.revBtn,
        BBB.el('button', { class: 'btn', text: 'FIT', title: 'Zoom to the trimmed region (double-click the waveform for the whole file)', onclick: () => this.fitRegion() }),
        BBB.el('div', { class: 'grow' }), this.gainKnob.el
      ]));
      host.appendChild(el);
      this.bindCanvas();
      this.bindDrop();
      new ResizeObserver(() => this.resize()).observe(this.drop);
      BBB.on('sample', (slot) => { if (slot === this.slot) { this.updateInfo(); this.dirty = true; } });
      BBB.on('rec-state', () => this.updateRecUI());
      BBB.on('rec-done', (r) => this.onRecDone(r));
      this.select(0);
    }

    get slot() { return S.tracks[this.ti].sample; }
    get track() { return S.tracks[this.ti]; }

    select(i) {
      if (BBB.mic.state !== 'idle' && i !== this.ti) BBB.mic.cancel();
      this.ti = i;
      this.tabs.forEach((t, k) => t.classList.toggle('on', k === i));
      this.el.style.setProperty('--c', this.track.color);
      this.fitRegion(true);
      this.updateInfo();
      BBB.emit('editor-select', i);
    }

    updateInfo() {
      const s = this.slot;
      if (!s || !s.raw) { this.info.textContent = ''; return; }
      const len = s.end - s.start;
      this.info.textContent = `${s.name} · ${len < 1 ? Math.round(len * 1000) + ' ms' : len.toFixed(2) + ' s'} · peak ${U.gainToDb(s.peakAfter || 0).toFixed(1)} dB`;
      this.normBtn.classList.toggle('on', s.normalize);
      this.revBtn.classList.toggle('on', s.reverse);
      this.gainKnob.draw(this.gainModel.norm, null);
    }

    fitRegion(whole) {
      const s = this.slot;
      if (!s || !s.raw) return;
      if (whole && s.start <= 0.0001 && s.end >= s.duration - 0.0001) { this.vs = 0; this.ve = s.duration; }
      else {
        const len = s.end - s.start, pad = Math.max(0.005, len * 0.08);
        this.vs = Math.max(0, s.start - pad); this.ve = Math.min(s.duration, s.end + pad);
      }
      this.dirty = true;
    }

    async listDevices() {
      try {
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
        const cur = this.devSel.value;
        this.devSel.innerHTML = '';
        this.devSel.appendChild(BBB.el('option', { value: '', text: 'Default input' }));
        devs.forEach((d, k) => { if (d.deviceId && d.deviceId !== 'default') this.devSel.appendChild(BBB.el('option', { value: d.deviceId, text: d.label || 'Input ' + (k + 1) })); });
        this.devSel.value = cur;
      } catch (e) { /* ignore */ }
    }

    async toggleRec() {
      const mic = BBB.mic;
      if (mic.state === 'idle') {
        try {
          await BBB.ensureAudio();
          this.engineStopPreview();
          await mic.arm(this.track.id);
          this.listDevices();
        } catch (e) {
          console.error(e);
          BBB.toast(e.message || 'Could not open the microphone', 'err');
        }
      } else mic.stop();
    }
    engineStopPreview() { BBB.engine.stopPreview(); this.playBtn.textContent = '▶ PLAY'; }

    onRecDone({ trackId, buffer }) {
      if (!buffer) { BBB.toast('Nothing recorded'); return; }
      const ti = S.tracks.findIndex((t) => t.id === trackId);
      const slot = S.tracks[ti].sample;
      slot.setRaw(buffer, { name: 'Rec ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), custom: true, autoTrim: true });
      if (ti !== this.ti) this.select(ti); else this.fitRegion();
      this.updateInfo();
      // "ready to use": audition the result immediately
      setTimeout(() => this.preview(), 60);
      BBB.toast(`Recorded into ${S.tracks[ti].name} — trimmed & ready`);
    }

    updateRecUI() {
      const st = BBB.mic.state;
      this.recBtn.classList.toggle('armed', st === 'armed');
      this.recBtn.classList.toggle('recording', st === 'recording');
      this.recBtn.querySelector('.lbl').textContent = st === 'idle' ? 'REC' : st === 'armed' ? 'WAITING…' : 'STOP';
      this.el.classList.toggle('is-recording', st !== 'idle');
      BBB.emit('rec-ui', st, this.ti);
    }

    restoreFactory() {
      const s = this.slot;
      if (!s.factory) return;
      s.setRaw(s.factory, { name: 'Factory ' + this.track.name.toLowerCase(), custom: false });
      this.fitRegion(true); this.updateInfo();
    }

    exportSample() {
      const s = this.slot;
      if (!s.buffer) return;
      BBB.saveFile(`${this.track.name.toLowerCase()}-sample-${U.stamp()}.wav`, U.bufferToWAV(s.buffer, 24), 'audio/wav', [{ name: 'WAV Audio', extensions: ['wav'] }]);
    }

    togglePreview() {
      if (BBB.engine.previewing) { this.engineStopPreview(); return; }
      this.preview();
    }
    preview(fromRawSec) {
      const s = this.slot;
      if (!s.buffer) return;
      let off = 0;
      if (fromRawSec != null) off = s.reverse ? s.end - fromRawSec : fromRawSec - s.start;
      off = U.clamp(off, 0, s.buffer.duration - 0.001);
      BBB.engine.preview(s.buffer, off);
      this.playBtn.textContent = '■ STOP';
    }

    // ---------------- canvas ----------------
    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height; this.dpr = dpr;
      this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
      this.dirty = true;
    }
    xOf(t) { return ((t - this.vs) / (this.ve - this.vs)) * this.w; }
    tOf(x) { return this.vs + (x / this.w) * (this.ve - this.vs); }

    hitTest(x, y) {
      const s = this.slot;
      if (!s.raw) return null;
      const xs = this.xOf(s.start), xe = this.xOf(s.end);
      const xfi = this.xOf(s.start + s.fadeIn), xfo = this.xOf(s.end - s.fadeOut);
      if (y < 22) {
        if (Math.abs(x - xfi) < 8 && x > xs - 2) return 'fadeIn';
        if (Math.abs(x - xfo) < 8 && x < xe + 2) return 'fadeOut';
      }
      if (Math.abs(x - xs) < 7) return 'start';
      if (Math.abs(x - xe) < 7) return 'end';
      return null;
    }

    bindCanvas() {
      const cv = this.canvas;
      let drag = null;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      cv.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || BBB.mic.state !== 'idle') return;
        const s = this.slot;
        if (!s.raw) return;
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        const [x, y] = pos(e);
        const h = this.hitTest(x, y);
        drag = h ? { type: h } : { type: 'select', x0: x, t0: U.clamp(this.tOf(x), 0, s.duration), moved: false };
      });
      cv.addEventListener('pointermove', (e) => {
        const [x, y] = pos(e);
        const s = this.slot;
        if (!drag) {
          const h = s.raw && BBB.mic.state === 'idle' ? this.hitTest(x, y) : null;
          cv.style.cursor = h === 'start' || h === 'end' ? 'ew-resize' : h ? 'col-resize' : 'text';
          return;
        }
        const t = U.clamp(this.tOf(x), 0, s.duration);
        const minLen = 0.005;
        if (drag.type === 'start') s.start = U.clamp(t, 0, s.end - minLen);
        else if (drag.type === 'end') s.end = U.clamp(t, s.start + minLen, s.duration);
        else if (drag.type === 'fadeIn') s.fadeIn = U.clamp(t - s.start, 0, s.end - s.start - s.fadeOut);
        else if (drag.type === 'fadeOut') s.fadeOut = U.clamp(s.end - t, 0, s.end - s.start - s.fadeIn);
        else if (drag.type === 'select') {
          if (!drag.moved && Math.abs(x - drag.x0) < 4) return;
          drag.moved = true;
          s.start = Math.min(drag.t0, t); s.end = Math.max(drag.t0, t, s.start + minLen);
          s.fadeIn = Math.min(s.fadeIn, (s.end - s.start) / 2); s.fadeOut = Math.min(s.fadeOut, (s.end - s.start) / 2);
        }
        if (drag.type === 'start' || drag.type === 'end' || drag.type === 'select') {
          s.fadeIn = Math.min(s.fadeIn, s.end - s.start); s.fadeOut = Math.min(s.fadeOut, s.end - s.start - s.fadeIn);
        }
        s.process();
      });
      const end = (e) => {
        if (!drag) return;
        const s = this.slot;
        if (drag.type === 'select' && !drag.moved) {
          const t = drag.t0;
          if (t >= s.start && t <= s.end) this.preview(t); else this.preview();
        } else if (drag.type === 'start' || drag.type === 'select') this.preview();
        drag = null;
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('dblclick', () => { const s = this.slot; if (s.raw) { this.vs = 0; this.ve = s.duration; this.dirty = true; } });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const s = this.slot;
        if (!s.raw) return;
        const [x] = pos(e);
        const span = this.ve - this.vs;
        const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
        if (horizontal) {
          const d = ((e.shiftKey ? e.deltaY : e.deltaX) / this.w) * span;
          const ns = U.clamp(this.vs + d, 0, Math.max(0, s.duration - span));
          this.vs = ns; this.ve = ns + span;
        } else {
          const tc = this.tOf(x);
          const f = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
          const nspan = U.clamp(span * f, 0.002, s.duration);
          let ns = tc - (x / this.w) * nspan;
          ns = U.clamp(ns, 0, s.duration - nspan);
          this.vs = ns; this.ve = ns + nspan;
        }
        this.dirty = true;
      }, { passive: false });
    }

    bindDrop() {
      const d = this.drop;
      d.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); d.classList.add('over'); } });
      d.addEventListener('dragleave', () => d.classList.remove('over'));
      d.addEventListener('drop', (e) => {
        e.preventDefault(); d.classList.remove('over');
        const f = e.dataTransfer.files[0];
        if (f) BBB.loadFileIntoTrack(this.ti, f);
      });
    }

    /** Called every animation frame. */
    frame(eng) {
      const mic = BBB.mic;
      // meter
      const lvl = mic.state !== 'idle' ? mic.level : 0;
      if (mic.state !== 'idle') mic.level *= 0.92;
      this.meter.firstChild.style.width = Math.round(U.clamp((U.gainToDb(lvl) + 60) / 60, 0, 1) * 100) + '%';
      this.meter.lastChild.style.left = Math.round(((mic.thresholdDb + 60) / 60) * 100) + '%';
      this.meter.lastChild.style.display = mic.threshold ? '' : 'none';
      this.recTime.textContent = mic.state === 'recording' ? U.fmtClock(mic.seconds) : '';
      if (eng.previewing === null && this.playBtn.textContent !== '▶ PLAY') this.playBtn.textContent = '▶ PLAY';
      if (!eng.previewing && this.playBtn.textContent !== '▶ PLAY') this.playBtn.textContent = '▶ PLAY';
      const animate = mic.state !== 'idle' || eng.previewing || (this.track.kind === 'granular' && eng.voices.length) || this.track.kind === 'granular';
      if (!this.dirty && !animate) return;
      this.dirty = false;
      this.draw(eng);
    }

    draw(eng) {
      const g = this.canvas.getContext('2d');
      const W = this.w, H = this.h, T = BBB.THEME;
      if (!W) return;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // parchment page with faint ruled lines
      g.fillStyle = T.paper; g.fillRect(0, 0, W, H);
      g.fillStyle = T.rule;
      for (let y = 26; y < H - 14; y += 14) g.fillRect(0, y, W, 0.6);
      const color = this.track.color;
      const top = 20, bot = H - 16, mid = (top + bot) / 2, amp = (bot - top) / 2 - 2;
      g.fillStyle = T.ruleStrong; g.fillRect(0, mid, W, 0.8);
      const mic = BBB.mic;
      if (mic.state !== 'idle') { this.drawLive(g, W, top, bot, mid, amp, color); return; }
      const s = this.slot;
      if (!s || !s.raw) return;
      // waveform in ink
      const sr = s.raw.sampleRate, data = s.mono();
      const spp = ((this.ve - this.vs) * sr) / W; // samples per pixel
      const useP = spp > s.peaks.bin * 2;
      g.fillStyle = color;
      g.globalAlpha = this.track.kind === 'granular' ? 0.42 : 1;
      for (let x = 0; x < W; x++) {
        const a = Math.floor((this.vs * sr) + x * spp), b = Math.floor((this.vs * sr) + (x + 1) * spp);
        let lo = 0, hi = 0;
        if (useP) {
          const pa = Math.floor(a / s.peaks.bin), pb = Math.max(pa + 1, Math.floor(b / s.peaks.bin));
          lo = 1; hi = -1;
          for (let k = pa; k < pb && k < s.peaks.mn.length; k++) { if (s.peaks.mn[k] < lo) lo = s.peaks.mn[k]; if (s.peaks.mx[k] > hi) hi = s.peaks.mx[k]; }
          if (lo > hi) { lo = hi = 0; }
        } else if (spp >= 1) {
          lo = 1; hi = -1;
          for (let k = a; k < Math.max(a + 1, b) && k < data.length; k++) { const v = data[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
          if (lo > hi) { lo = hi = 0; }
        } else {
          const v = data[Math.floor(this.vs * sr + x * spp)] || 0; lo = Math.min(0, v); hi = Math.max(0, v);
        }
        const y0 = mid - hi * amp, y1 = mid - lo * amp;
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
      }
      g.globalAlpha = 1;
      // outside region: aged, shaded paper
      const xs = this.xOf(s.start), xe = this.xOf(s.end);
      g.fillStyle = 'rgba(120,92,52,0.42)';
      if (xs > 0) g.fillRect(0, 0, xs, H);
      if (xe < W) g.fillRect(xe, 0, W - xe, H);
      // region ribbon
      g.fillStyle = color; g.globalAlpha = 0.18; g.fillRect(xs, 0, xe - xs, 14); g.globalAlpha = 1;
      // fades envelope
      const xfi = this.xOf(s.start + s.fadeIn), xfo = this.xOf(s.end - s.fadeOut);
      g.fillStyle = 'rgba(120,92,52,0.25)';
      g.beginPath(); g.moveTo(xs, top); g.lineTo(xfi, top); g.lineTo(xs, bot); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(xe, top); g.lineTo(xfo, top); g.lineTo(xe, bot); g.closePath(); g.fill();
      g.strokeStyle = T.ink; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(xs, bot); g.lineTo(xfi, top); g.lineTo(xfo, top); g.lineTo(xe, bot); g.stroke();
      // trim handles: ink rules with bookmark flags
      g.fillStyle = T.ink;
      g.fillRect(Math.round(xs) - 1, 0, 2, H); g.fillRect(Math.round(xe) - 1, 0, 2, H);
      const flag = (x, dir) => { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + dir * 11, 0); g.lineTo(x + dir * 11, 13); g.lineTo(x + dir * 5.5, 9); g.lineTo(x, 13); g.closePath(); g.fill(); };
      g.fillStyle = T.marker; flag(xs, 1); flag(xe, -1);
      // fade handles: wax-seal dots
      [xfi, xfo].forEach((x) => {
        g.fillStyle = T.oxblood; g.beginPath(); g.arc(x, top, 5, 0, Math.PI * 2); g.fill();
        g.fillStyle = T.gold; g.beginPath(); g.arc(x, top, 2, 0, Math.PI * 2); g.fill();
      });
      if (s.reverse) { g.fillStyle = T.marker; g.font = `italic 600 12px ${T.serif}`; g.fillText('← reversed', Math.max(4, xs + 15), 12); }
      // granular overlay: position, spray window and the live grain cloud
      if (this.track.kind === 'granular') {
        const now = eng.ctx.currentTime;
        const pos = eng.val('gran.pos', now), spray = eng.val('gran.spray', now);
        const len = s.end - s.start;
        const toRaw = (f) => (s.reverse ? s.end - f * len : s.start + f * len);
        const xp = this.xOf(toRaw(pos));
        const sw = (spray * 0.5 * len / (this.ve - this.vs)) * W;
        g.fillStyle = 'rgba(201,164,86,0.22)';
        g.fillRect(xp - sw, top, sw * 2, bot - top);
        g.fillStyle = T.goldDeep; g.fillRect(xp - 0.75, top - 6, 1.5, bot - top + 6);
        g.beginPath(); g.moveTo(xp - 5, top - 8); g.lineTo(xp + 5, top - 8); g.lineTo(xp, top - 2); g.closePath(); g.fill();
        const log = eng.grainLog || [];
        for (let i = log.length - 1; i >= 0; i--) {
          const gr = log[i];
          if (gr.end < now - 0.25) break;
          if (gr.t > now) continue;
          const life = gr.end >= now ? 1 : 1 - (now - gr.end) / 0.25;
          const x0 = this.xOf(toRaw(gr.off)), x1 = this.xOf(toRaw(Math.min(1, gr.off + gr.len)));
          const y = U.clamp(mid - gr.semis * (amp / 26) - gr.pan * 6, top + 4, bot - 4);
          const w = Math.max(3, Math.abs(x1 - x0));
          g.globalAlpha = Math.min(0.95, 0.35 + gr.amp * 1.6) * life;
          g.fillStyle = gr.rev ? T.marker : T.ink;
          g.beginPath(); g.ellipse(Math.min(x0, x1) + w / 2, y, w / 2, 3.4, 0, 0, Math.PI * 2); g.fill();
          g.globalAlpha *= 0.9; g.fillStyle = T.gold;
          g.beginPath(); g.arc(Math.min(x0, x1) + 2, y, 1.6, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
      }
      // preview playhead
      const pv = eng.previewing;
      if (pv && pv.buf === s.buffer) {
        const el = eng.ctx.currentTime - pv.t + pv.offset;
        if (el >= 0 && el <= s.buffer.duration) {
          const t = s.reverse ? s.end - el : s.start + el;
          g.fillStyle = T.marker; g.fillRect(this.xOf(t), 0, 1.5, H);
        }
      }
      // ruler in typewriter numerals
      g.fillStyle = T.inkSoft; g.font = `10px ${T.type}`;
      const span = this.ve - this.vs;
      const stepT = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].find((v) => (v / span) * W > 70) || 10;
      for (let t = Math.ceil(this.vs / stepT) * stepT; t < this.ve; t += stepT) {
        const x = this.xOf(t);
        g.fillRect(x, H - 5, 1, 5);
        g.fillText(t < 1 ? Math.round(t * 1000) + 'ms' : t.toFixed(stepT < 1 ? 1 : 0) + 's', x + 3, H - 3);
      }
    }

    drawLive(g, W, top, bot, mid, amp, color) {
      const mic = BBB.mic, T = BBB.THEME;
      const chunks = mic.state === 'armed' ? mic.preroll : mic.chunks;
      const sr = BBB.engine.ctx.sampleRate;
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const span = Math.max(3 * sr, total);
      const spp = span / W;
      g.fillStyle = mic.state === 'recording' ? T.marker : T.inkSoft;
      let x = 0, acc = 0, lo = 0, hi = 0;
      chunks.forEach((c) => {
        for (let i = 0; i < c.length; i++) {
          const v = c[i]; if (v < lo) lo = v; if (v > hi) hi = v;
          if (++acc >= spp) {
            g.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
            x++; acc = 0; lo = 0; hi = 0;
          }
        }
      });
      g.fillStyle = mic.state === 'recording' ? T.marker : T.ink; g.font = `italic 600 13px ${T.serif}`;
      g.fillText(mic.state === 'armed' ? 'Listening… make a sound to begin recording' : '● Recording into ' + this.track.title + ' — press Stop when done', 8, 14);
      if (mic.threshold) {
        const ty = U.dbToGain(mic.thresholdDb) * amp;
        g.strokeStyle = 'rgba(168,50,42,0.45)'; g.setLineDash([4, 4]);
        g.beginPath(); g.moveTo(0, mid - ty); g.lineTo(W, mid - ty); g.moveTo(0, mid + ty); g.lineTo(W, mid + ty); g.stroke();
        g.setLineDash([]);
      }
    }
  }
  BBB.SampleEditor = SampleEditor;
})();
