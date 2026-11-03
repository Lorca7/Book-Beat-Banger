/* Book Beat Banger — granular synth control panel */
(function () {
  'use strict';
  const BBB = window.BBB, U = BBB.util, S = BBB.state;

  class GranPanel {
    constructor(host) {
      const el = (this.el = BBB.el('div', { class: 'gpanel' }));
      const knob = (k) => new BBB.Knob(BBB.param('gran.' + k), { size: 30, small: true }).el;
      const section = (title, cls, kids) => BBB.el('div', { class: 'gsec ' + cls }, [BBB.el('div', { class: 'gsec-title', text: title }), BBB.el('div', { class: 'gsec-body' }, kids)]);

      // --- cloud ---
      this.freezeBtn = BBB.el('button', { class: 'btn toggle tiny freeze', text: 'FREEZE', title: 'Freeze: stop scanning through the sample. Grains keep coming from the current position.' });
      this.freezeBtn.addEventListener('click', () => { S.gran.freeze = !S.gran.freeze; this.sync(); });
      const cloud = section('Cloud', 'g-cloud', [knob('pos'), knob('scan'), knob('spray'), knob('dens'), knob('jitter'), BBB.el('div', { class: 'gsel' }, [this.freezeBtn])]);

      // --- grain window ---
      this.winCanvas = BBB.el('canvas', { class: 'win-view', width: 120, height: 56, title: 'Grain window (click to change)' });
      this.winBtn = BBB.el('button', { class: 'shape on sel-btn', title: 'Grain window shape' });
      const pickWin = () => {
        const r = this.winBtn.getBoundingClientRect();
        BBB.contextMenu(r.left, r.bottom + 2, BBB.GRAIN_WINDOWS.map(([id, label]) => ({ label: label + (S.gran.window === id ? '  ✓' : ''), fn: () => { S.gran.window = id; this.sync(); } })));
      };
      this.winBtn.addEventListener('click', pickWin);
      this.winCanvas.addEventListener('click', () => {
        const k = BBB.GRAIN_WINDOWS.findIndex((w) => w[0] === S.gran.window);
        S.gran.window = BBB.GRAIN_WINDOWS[(k + 1) % BBB.GRAIN_WINDOWS.length][0];
        this.sync();
      });
      const grain = section('Grain', 'g-grain', [BBB.el('div', { class: 'gsel win' }, [this.winCanvas, this.winBtn]), knob('size'), knob('sizernd'), knob('skew'), knob('reverse')]);

      // --- pitch ---
      this.quantBtn = BBB.el('button', { class: 'shape on sel-btn', title: 'Quantize the random pitch scatter to a scale' });
      this.quantBtn.addEventListener('click', () => {
        const r = this.quantBtn.getBoundingClientRect();
        BBB.contextMenu(r.left, r.bottom + 2, BBB.PITCH_QUANT.map(([id, label]) => ({ label: label + (S.gran.quant === id ? '  ✓' : ''), fn: () => { S.gran.quant = id; this.sync(); } })));
      });
      const pitch = section('Pitch', 'g-pitch', [knob('pitch'), knob('fine'), knob('detune'), BBB.el('div', { class: 'gsel' }, [BBB.el('span', { class: 'gsel-lbl', text: 'SCALE' }), this.quantBtn])]);

      // --- envelope / filter / output ---
      this.envCanvas = BBB.el('canvas', { class: 'env-view', width: 120, height: 56, title: 'Voice amplitude envelope (ADSR)' });
      const env = section('Envelope', 'g-env', [knob('attack'), knob('decay'), knob('sustain'), knob('release'), BBB.el('div', { class: 'gsel' }, [this.envCanvas])]);
      const filt = section('Filter', 'g-filt', [knob('cutoff'), knob('res'), knob('fenv')]);
      this.countEl = BBB.el('div', { class: 'gcount', title: 'Grains sounding right now' }, [BBB.el('b', { text: '0' }), BBB.el('span', { text: 'grains' })]);
      const out = section('Output', 'g-out', [knob('level'), knob('pan'), knob('spread'), knob('amprnd'), this.countEl]);

      el.appendChild(cloud); el.appendChild(grain);
      el.appendChild(pitch); el.appendChild(filt);
      el.appendChild(env); el.appendChild(out);
      host.appendChild(el);
      BBB.on('param', (p) => { if (p.id === 'gran.skew') this.drawWindow(); if (/gran\.(attack|decay|sustain|release)/.test(p.id)) this.drawEnv(); });
      this.sync();
    }

    sync() {
      const G = S.gran;
      this.freezeBtn.classList.toggle('on', G.freeze);
      this.winBtn.textContent = (BBB.GRAIN_WINDOWS.find((w) => w[0] === G.window) || ['', 'HANN'])[1] + ' ▾';
      this.quantBtn.textContent = (BBB.PITCH_QUANT.find((q) => q[0] === G.quant) || ['', 'FREE'])[1] + ' ▾';
      this.drawWindow();
      this.drawEnv();
    }

    drawWindow() {
      const cv = this.winCanvas, g = cv.getContext('2d'), W = cv.width, H = cv.height, T = BBB.THEME;
      const w = BBB.grainWindow(S.gran.window, BBB.param('gran.skew').value);
      g.clearRect(0, 0, W, H);
      g.fillStyle = T.paper; g.fillRect(0, 0, W, H);
      g.strokeStyle = T.rule; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, H - 6.5); g.lineTo(W, H - 6.5); g.stroke();
      g.beginPath();
      for (let i = 0; i < w.length; i++) { const x = 4 + (i / (w.length - 1)) * (W - 8), y = H - 6 - w[i] * (H - 14); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.fillStyle = T.gran + '33'; g.lineTo(W - 4, H - 6); g.lineTo(4, H - 6); g.closePath(); g.fill();
      g.strokeStyle = T.gran; g.lineWidth = 2.5; g.beginPath();
      for (let i = 0; i < w.length; i++) { const x = 4 + (i / (w.length - 1)) * (W - 8), y = H - 6 - w[i] * (H - 14); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }

    drawEnv() {
      const cv = this.envCanvas, g = cv.getContext('2d'), W = cv.width, H = cv.height, T = BBB.THEME;
      const a = BBB.param('gran.attack').value, d = BBB.param('gran.decay').value, su = BBB.param('gran.sustain').value, r = BBB.param('gran.release').value;
      // log-ish time axis so short and long settings both read well
      const tx = (sec) => Math.log1p(sec * 4) / Math.log1p(8 * 4);
      const hold = 0.22;
      const xa = tx(a) * (1 - hold) * 0.5, xd = xa + tx(d) * (1 - hold) * 0.3, xs = xd + hold, xr = Math.min(1, xs + tx(r) * (1 - hold) * 0.5);
      const X = (f) => 4 + f * (W - 8), Y = (v) => H - 6 - v * (H - 14);
      g.clearRect(0, 0, W, H);
      g.fillStyle = T.paper; g.fillRect(0, 0, W, H);
      g.strokeStyle = T.rule; g.lineWidth = 1; g.beginPath(); g.moveTo(0, H - 6.5); g.lineTo(W, H - 6.5); g.stroke();
      g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(xa), Y(1)); g.lineTo(X(xd), Y(su)); g.lineTo(X(xs), Y(su)); g.lineTo(X(xr), Y(0));
      g.strokeStyle = T.gran; g.lineWidth = 2.5; g.lineJoin = 'round'; g.stroke();
      g.fillStyle = T.ink;
      [[xa, 1], [xd, su], [xs, su]].forEach(([x, y]) => { g.beginPath(); g.arc(X(x), Y(y), 3, 0, Math.PI * 2); g.fill(); });
    }

    frame(eng) {
      const now = eng.ctx.currentTime, log = eng.grainLog || [];
      let n = 0;
      for (let i = log.length - 1; i >= 0 && n < 999; i--) { const gr = log[i]; if (gr.t <= now && gr.end >= now) n++; }
      const txt = String(n);
      if (this.countEl.firstChild.textContent !== txt) this.countEl.firstChild.textContent = txt;
    }
  }
  BBB.GranPanel = GranPanel;
})();
