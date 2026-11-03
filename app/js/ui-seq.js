/* Book Beat Banger — step sequencer rows + chromatic piano roll */
(function () {
  'use strict';
  const BBB = window.BBB, U = BBB.util, S = BBB.state;

  // ---------------- Drum step row ----------------
  class StepRow {
    constructor(track, host) {
      this.track = track;
      this.el = BBB.el('div', { class: 'steps', title: 'Click / drag to paint steps · Option-drag ↕ on a step to set velocity' });
      this.cells = track.steps.map((st, i) => {
        const fill = BBB.el('div', { class: 'vel' });
        const c = BBB.el('div', { class: 'step' + (i % 4 === 0 ? ' beat' : ''), 'data-i': i }, [fill]);
        c._fill = fill;
        this.el.appendChild(c);
        return c;
      });
      host.appendChild(this.el);
      this.bind();
      this.render();
    }
    bind() {
      let mode = null, velStep = -1, startY = 0, startVel = 0, last = -1;
      const idxAt = (x, y) => {
        const t = document.elementFromPoint(x, y);
        const c = t && t.closest && t.closest('.step');
        return c && c.parentNode === this.el ? +c.dataset.i : -1;
      };
      this.el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const i = idxAt(e.clientX, e.clientY);
        if (i < 0) return;
        e.preventDefault();
        this.el.setPointerCapture(e.pointerId);
        const st = this.track.steps[i];
        if (e.altKey) {
          if (!st.on) st.on = true;
          velStep = i; startY = e.clientY; startVel = st.vel; mode = 'vel';
        } else {
          mode = st.on ? 'off' : 'on';
          st.on = mode === 'on';
          if (st.on && e.shiftKey) st.vel = 1;
          last = i;
          if (st.on && !BBB.engine.clock.playing) BBB.engine.trigger(S.tracks.indexOf(this.track), st.vel);
        }
        this.render(); BBB.emit('pattern');
      });
      this.el.addEventListener('pointermove', (e) => {
        if (!mode) return;
        if (mode === 'vel') {
          const st = this.track.steps[velStep];
          st.vel = U.clamp(startVel + (startY - e.clientY) / 120, 0.05, 1);
          this.render(); return;
        }
        const i = idxAt(e.clientX, e.clientY);
        if (i < 0 || i === last) return;
        last = i;
        this.track.steps[i].on = mode === 'on';
        this.render(); BBB.emit('pattern');
      });
      const end = () => { if (mode === 'vel') BBB.emit('pattern'); mode = null; };
      this.el.addEventListener('pointerup', end);
      this.el.addEventListener('pointercancel', end);
    }
    render() {
      this.track.steps.forEach((st, i) => {
        const c = this.cells[i];
        c.classList.toggle('on', st.on);
        c._fill.style.height = st.on ? Math.round(st.vel * 100) + '%' : '0';
      });
    }
    setPlayhead(i) {
      if (this.ph === i) return;
      if (this.ph != null && this.cells[this.ph]) this.cells[this.ph].classList.remove('ph');
      this.ph = i;
      if (i != null && this.cells[i]) this.cells[i].classList.add('ph');
    }
  }
  BBB.StepRow = StepRow;

  // ---------------- Piano roll ----------------
  class PianoRoll {
    constructor(track, host) {
      this.track = track;
      this.rows = 24;
      this.base = 48; // lowest visible note (C3)
      this.keyW = 38;
      this.wrap = BBB.el('div', { class: 'proll' });
      this.canvas = BBB.el('canvas', { class: 'proll-canvas', title: 'Click to add a note, drag right to lengthen · Drag a note to move · Drag its right edge to resize · Click a note to delete · Click the keys to audition' });
      const up = BBB.el('button', { class: 'mini', text: '▲', title: 'Scroll up an octave (or use the mouse wheel)', onclick: () => this.shift(12) });
      const dn = BBB.el('button', { class: 'mini', text: '▼', title: 'Scroll down an octave', onclick: () => this.shift(-12) });
      this.rangeLbl = BBB.el('span', { class: 'oct-lbl mono' });
      this.octEl = BBB.el('div', { class: 'oct-btns' }, [BBB.el('span', { class: 'oct-title', text: 'VIEW' }), dn, up, this.rangeLbl]);
      this.wrap.appendChild(this.canvas);
      host.appendChild(this.wrap);
      this.ph = null;
      this.bind();
      new ResizeObserver(() => this.resize()).observe(this.wrap);
    }
    shift(d) { this.base = U.clamp(this.base + d, 12, 96); this.draw(); }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height;
      this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
      this.dpr = dpr;
      this.draw();
    }
    get colW() { return (this.w - this.keyW) / 16; }
    get rowH() { return this.h / this.rows; }
    noteAtY(y) { return this.base + this.rows - 1 - Math.floor(y / this.rowH); }
    stepAtX(x) { return Math.floor((x - this.keyW) / this.colW); }
    yOf(note) { return (this.base + this.rows - 1 - note) * this.rowH; }
    xOf(step) { return this.keyW + step * this.colW; }
    hit(x, y) {
      const notes = this.track.notes;
      for (let k = notes.length - 1; k >= 0; k--) {
        const n = notes[k];
        const x0 = this.xOf(n.step), x1 = this.xOf(n.step + n.len), y0 = this.yOf(n.note);
        if (x >= x0 && x <= x1 && y >= y0 && y < y0 + this.rowH) return { n, edge: x > x1 - Math.min(10, this.colW * 0.35) };
      }
      return null;
    }
    bind() {
      const cv = this.canvas;
      let drag = null;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      cv.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        const [x, y] = pos(e);
        const note = this.noteAtY(y);
        if (x < this.keyW) {
          drag = { type: 'key', voice: BBB.engine.noteOn(note) };
          this.keyDown = note; this.draw();
          return;
        }
        const step = U.clamp(this.stepAtX(x), 0, 15);
        const h = this.hit(x, y);
        if (h) {
          drag = h.edge ? { type: 'resize', n: h.n, moved: false } : { type: 'move', n: h.n, dStep: step - h.n.step, moved: false, x0: x, y0: y };
        } else {
          const n = { step, note, len: 1, vel: 0.9 };
          this.track.notes.push(n);
          drag = { type: 'create', n, step };
          this.audition(note);
          BBB.emit('pattern');
        }
        this.draw();
      });
      cv.addEventListener('pointermove', (e) => {
        const [x, y] = pos(e);
        if (!drag) {
          const h = x >= this.keyW ? this.hit(x, y) : null;
          cv.style.cursor = x < this.keyW ? 'pointer' : h ? (h.edge ? 'ew-resize' : 'grab') : 'crosshair';
          return;
        }
        const step = U.clamp(this.stepAtX(x), 0, 15);
        const n = drag.n;
        if (drag.type === 'create' || drag.type === 'resize') {
          const len = U.clamp(step - n.step + 1, 1, 16 - n.step);
          if (len !== n.len) { n.len = len; drag.moved = true; this.draw(); BBB.emit('pattern'); }
        } else if (drag.type === 'move') {
          if (Math.abs(x - drag.x0) + Math.abs(y - drag.y0) < 4 && !drag.moved) return;
          const ns = U.clamp(step - drag.dStep, 0, 16 - n.len);
          const nn = U.clamp(this.noteAtY(y), 0, 127);
          if (ns !== n.step || nn !== n.note) {
            if (nn !== n.note) this.audition(nn);
            n.step = ns; n.note = nn; drag.moved = true; this.draw(); BBB.emit('pattern');
          } else drag.moved = true;
        }
      });
      const end = () => {
        if (!drag) return;
        if (drag.type === 'key') { BBB.engine.noteOff(drag.voice); this.keyDown = null; }
        else if (drag.type === 'move' && !drag.moved) {
          this.track.notes.splice(this.track.notes.indexOf(drag.n), 1);
          BBB.emit('pattern');
        } else if (drag.type !== 'key') {
          // remove exact duplicates created by moving
          const n = drag.n;
          this.track.notes = this.track.notes.filter((o) => o === n || !(o.step === n.step && o.note === n.note));
        }
        drag = null; this.draw();
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.wheelAcc = (this.wheelAcc || 0) + e.deltaY;
        if (Math.abs(this.wheelAcc) > 30) { this.shift(this.wheelAcc > 0 ? -1 : 1); this.wheelAcc = 0; }
      }, { passive: false });
    }
    audition(note) {
      if (BBB.engine.clock.playing) return;
      const now = BBB.engine.ctx.currentTime;
      BBB.engine.noteVoice(note, now + 0.005, now + 0.25, 0.85, false);
    }
    setPlayhead(i) { if (this.ph !== i) { this.ph = i; this.draw(); } }
    draw() {
      const cv = this.canvas, g = cv.getContext('2d');
      if (!this.w) return;
      const dpr = this.dpr, W = this.w, H = this.h, rh = this.rowH, cw = this.colW, kw = this.keyW;
      const color = this.track.color;
      if (this.rangeLbl) this.rangeLbl.textContent = U.noteName(this.base) + '–' + U.noteName(this.base + this.rows - 1);
      const T = BBB.THEME;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // manuscript rows
      for (let r = 0; r < this.rows; r++) {
        const note = this.base + this.rows - 1 - r, y = r * rh;
        const black = U.isBlackKey(note);
        g.fillStyle = black ? T.paperDeep : T.paper;
        g.fillRect(kw, y, W - kw, rh);
        g.fillStyle = T.rule;
        g.fillRect(kw, Math.round(y + rh) - 0.5, W - kw, note % 12 === 0 ? 1.5 : 0.5);
        if (note % 12 === 0) { g.fillStyle = T.ruleStrong; g.fillRect(kw, Math.round(y + rh) - 1, W - kw, 1); }
      }
      // keyboard: ivory & ebony
      g.fillStyle = T.ivory; g.fillRect(0, 0, kw - 3, H);
      for (let r = 0; r < this.rows; r++) {
        const note = this.base + this.rows - 1 - r, y = r * rh;
        const black = U.isBlackKey(note);
        if (this.keyDown === note) { g.fillStyle = color; g.fillRect(0, y + 0.5, kw - 3, rh - 1); }
        else if (black) { g.fillStyle = T.ebony; g.fillRect(0, y + 1, (kw - 3) * 0.62, rh - 2); }
        g.fillStyle = T.rule;
        if (!black && !U.isBlackKey(note + 1)) g.fillRect(0, y, kw - 3, 1);
        if (note % 12 === 0) {
          g.fillStyle = this.keyDown === note ? T.ivory : T.ink;
          g.font = `italic ${Math.min(11, rh)}px ${T.serif}`;
          g.textBaseline = 'middle'; g.textAlign = 'right';
          g.fillText(U.noteName(note), kw - 6, y + rh / 2 + 0.5);
          g.textAlign = 'left';
        }
      }
      g.fillStyle = T.ink; g.fillRect(kw - 3, 0, 1.5, H);
      // bar lines
      for (let s = 0; s <= 16; s++) {
        g.fillStyle = s % 4 === 0 ? T.ruleStrong : T.rule;
        g.fillRect(Math.round(kw + s * cw), 0, s % 4 === 0 ? 1.25 : 0.75, H);
      }
      if (this.ph != null) {
        g.fillStyle = 'rgba(201,164,86,0.22)';
        g.fillRect(kw + this.ph * cw, 0, cw, H);
      }
      // notes as ink strokes
      const hidden = { up: new Set(), down: new Set() };
      this.track.notes.forEach((n) => {
        if (n.note < this.base) { for (let s = n.step; s < n.step + n.len; s++) hidden.down.add(s); return; }
        if (n.note >= this.base + this.rows) { for (let s = n.step; s < n.step + n.len; s++) hidden.up.add(s); return; }
        const x = this.xOf(n.step) + 1.5, y = this.yOf(n.note) + 1, w = n.len * cw - 3, h = rh - 2;
        const playing = this.ph != null && this.ph >= n.step && this.ph < n.step + n.len;
        g.fillStyle = color;
        g.globalAlpha = playing ? 1 : 0.88;
        roundRect(g, x, y, w, h, Math.min(h / 2, 5));
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = T.ink; g.lineWidth = playing ? 1.4 : 0.8; g.stroke();
        g.fillStyle = 'rgba(251,245,230,0.7)';
        g.fillRect(x + w - 5, y + 2, 1.5, h - 4);
        if (w > 26 && h >= 9) {
          g.fillStyle = T.ivory;
          g.font = `italic 600 ${Math.min(11, h)}px ${T.serif}`;
          g.textBaseline = 'middle';
          g.fillText(U.noteName(n.note), x + 5, y + h / 2 + 0.5);
        }
      });
      g.fillStyle = color;
      hidden.up.forEach((s) => { tri(g, kw + s * cw + cw / 2, 2, 4, 1); });
      hidden.down.forEach((s) => { tri(g, kw + s * cw + cw / 2, H - 2, 4, -1); });
    }
  }
  const roundRect = (g, x, y, w, h, r) => {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  const tri = (g, x, y, s, dir) => { g.beginPath(); g.moveTo(x - s, y + dir * s); g.lineTo(x + s, y + dir * s); g.lineTo(x, y); g.closePath(); g.fill(); };
  BBB.PianoRoll = PianoRoll;
})();
