/* Book Beat Banger — knob widget + context menu */
(function () {
  'use strict';
  const BBB = window.BBB, U = BBB.util, S = BBB.state;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  const A0 = -135, A1 = 135;
  const ang = (n) => A0 + (A1 - A0) * n;
  const pt = (a, r, c) => { const rad = (a * Math.PI) / 180; return [c + r * Math.sin(rad), c - r * Math.cos(rad)]; };
  const arc = (n0, n1, r, c) => {
    if (n1 < n0) [n0, n1] = [n1, n0];
    if (n1 - n0 < 0.001) n1 = n0 + 0.001;
    const a0 = ang(n0), a1 = ang(n1);
    const [x0, y0] = pt(a0, r, c), [x1, y1] = pt(a1, r, c);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  BBB.knobs = new Map(); // param id -> Knob[]

  class Knob {
    /**
     * model: a BBB.Param, or any object with { norm, defNorm, setNorm(n), format(), label, color }
     */
    constructor(model, opts) {
      opts = opts || {};
      this.p = model;
      this.size = opts.size || 44;
      this.color = opts.color || model.color || '#ddd';
      this.isParam = model instanceof BBB.Param;
      const label = opts.label || model.label;
      const c = this.size / 2;
      this.c = c;
      const el = (this.el = BBB.el('div', { class: 'knob' + (opts.small ? ' small' : ''), title: (model.fullName || label) + (this.isParam && model.mod ? '\nDrag ↕ · Shift = fine · Double-click = reset · Right-click = menu · Drop an LFO here to modulate' : '\nDrag ↕ · Double-click = reset') }));
      el.style.setProperty('--kc', this.color);
      if (this.isParam) { el.dataset.param = model.id; if (model.mod) el.dataset.mod = '1'; }
      if (!opts.nolabel) el.appendChild(BBB.el('div', { class: 'k-label', text: label }));
      const s = (this.svg = svg('svg', { width: this.size, height: this.size, viewBox: `0 0 ${this.size} ${this.size}`, class: 'k-svg' }));
      const r = c - 5;
      this.r = r;
      s.appendChild(svg('circle', { cx: c, cy: c, r: r - 4, class: 'k-body' }));
      s.appendChild(svg('path', { d: arc(0, 1, r, c), class: 'k-track' }));
      this.valArc = svg('path', { class: 'k-val' });
      this.modArc = svg('path', { class: 'k-mod' });
      this.ptr = svg('line', { class: 'k-ptr' });
      this.modDot = svg('circle', { r: 2.2, class: 'k-moddot' });
      s.appendChild(this.valArc); s.appendChild(this.modArc); s.appendChild(this.ptr); s.appendChild(this.modDot);
      el.appendChild(s);
      this.valueEl = BBB.el('div', { class: 'k-value' });
      el.appendChild(this.valueEl);
      this.badges = BBB.el('div', { class: 'k-badges' });
      el.appendChild(this.badges);
      this.bipolar = this.isParam && model.min < 0 && model.max > 0 ? model.toNorm(0) : null;
      this.last = {};
      this.bind();
      if (this.isParam) {
        const list = BBB.knobs.get(model.id) || [];
        list.push(this); BBB.knobs.set(model.id, list);
      }
      this.draw(model.norm, null);
      this.updateBadges();
    }

    bind() {
      const el = this.el, p = this.p;
      let startY = 0, startN = 0, dragging = false;
      this.svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this.svg.setPointerCapture(e.pointerId);
        dragging = true; startY = e.clientY; startN = p.norm;
        p.touching = true;
        el.classList.add('active');
        BBB.emit('touch', p, true);
      });
      this.svg.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const sens = e.shiftKey ? 900 : 180;
        const dy = startY - e.clientY;
        p.setNorm(U.clamp(startN + dy / sens, 0, 1));
        if (e.shiftKey) { startY = e.clientY; startN = p.norm; }
      });
      const end = (e) => {
        if (!dragging) return;
        dragging = false; p.touching = false;
        el.classList.remove('active');
        try { this.svg.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        BBB.emit('touch', p, false);
      };
      this.svg.addEventListener('pointerup', end);
      this.svg.addEventListener('pointercancel', end);
      this.svg.addEventListener('dblclick', () => p.setNorm(p.defNorm));
      this.svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const d = -(e.deltaY || -e.deltaX) * (e.shiftKey ? 0.0003 : 0.0015);
        p.setNorm(U.clamp(p.norm + d, 0, 1));
      }, { passive: false });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!this.isParam) { p.setNorm(p.defNorm); return; }
        const items = [{ label: 'Reset to default', fn: () => p.setNorm(p.defNorm) }];
        if (S.auto.lanes[p.id]) items.push({ label: 'Clear automation', fn: () => BBB.clearLane(p.id) });
        if (p.mod) {
          items.push({ sep: true });
          for (let i = 0; i < 4; i++) {
            const has = S.mods.find((m) => m.lfo === i && m.param === p.id);
            items.push(has
              ? { label: `Remove LFO ${i + 1}`, color: BBB.LFO_COLORS[i], fn: () => BBB.removeMod(i, p.id) }
              : { label: `Modulate with LFO ${i + 1}`, color: BBB.LFO_COLORS[i], fn: () => BBB.addMod(i, p.id, 0.25) });
          }
        }
        BBB.contextMenu(e.clientX, e.clientY, items);
      });
    }

    updateBadges() {
      if (!this.isParam) return;
      const id = this.p.id, mods = BBB.modsFor(id) || [], lane = S.auto.lanes[id];
      const key = mods.map((m) => m.lfo).join(',') + '|' + (lane ? 1 : 0);
      if (key === this.badgeKey) return;
      this.badgeKey = key;
      this.badges.innerHTML = '';
      mods.forEach((m) => this.badges.appendChild(BBB.el('span', { class: 'k-dot', style: { background: BBB.LFO_COLORS[m.lfo] }, title: 'LFO ' + (m.lfo + 1) })));
      if (lane) this.badges.appendChild(BBB.el('span', { class: 'k-auto', text: 'A', title: 'Automated — right-click to clear' }));
      this.el.classList.toggle('modded', mods.length > 0);
      this.el.classList.toggle('automated', !!lane);
    }

    /** base: pointer position (normalized). eff: modulated position or null. range: [lo, hi] of modulation or null */
    draw(base, eff, range, modColor) {
      const L = this.last;
      const b = Math.round(base * 1000), e = eff == null ? -1 : Math.round(eff * 1000);
      const rk = range ? Math.round(range[0] * 500) + ':' + Math.round(range[1] * 500) : '';
      if (L.b === b && L.e === e && L.rk === rk && L.mc === modColor) return;
      L.b = b; L.e = e; L.rk = rk; L.mc = modColor;
      const c = this.c, r = this.r;
      const from = this.bipolar != null ? this.bipolar : 0;
      this.valArc.setAttribute('d', arc(from, base, r, c));
      const a = ang(base);
      const [x0, y0] = pt(a, r * 0.18, c), [x1, y1] = pt(a, r - 6, c);
      this.ptr.setAttribute('x1', x0); this.ptr.setAttribute('y1', y0); this.ptr.setAttribute('x2', x1); this.ptr.setAttribute('y2', y1);
      if (range) {
        this.modArc.setAttribute('d', arc(range[0], range[1], r + 3.2, c));
        this.modArc.style.stroke = modColor;
        this.modArc.style.display = '';
      } else this.modArc.style.display = 'none';
      if (eff != null) {
        const [dx, dy] = pt(ang(eff), r + 3.2, c);
        this.modDot.setAttribute('cx', dx); this.modDot.setAttribute('cy', dy);
        this.modDot.style.fill = modColor || '#fff';
        this.modDot.style.display = '';
      } else this.modDot.style.display = 'none';
      const shown = eff != null ? eff : base;
      const txt = this.isParam ? this.p.format(this.p.fromNorm(shown)) : this.p.format();
      if (txt !== L.txt) { this.valueEl.textContent = txt; L.txt = txt; }
    }

    /** Refresh from param state; eng gives the live clock for modulation display. */
    refresh(eng) {
      const p = this.p;
      if (!this.isParam || !eng) { this.draw(p.norm, null); return; }
      const mods = BBB.modsFor(p.id), lane = S.auto.lanes[p.id];
      const now = eng.ctx.currentTime;
      let base = p.norm;
      const playing = eng.clock.playing;
      if (lane && playing && !p.touching) base = BBB.laneValue(lane, eng.beatsAt(now));
      if (!mods) { this.draw(base, null); return; }
      let eff = base, span = 0;
      const beats = eng.beatsAt(now), secs = eng.secsAt(now);
      mods.forEach((m) => { eff += BBB.lfoValue(m.lfo, beats, secs) * m.depth; span += Math.abs(m.depth); });
      this.draw(base, U.clamp(eff, 0, 1), [U.clamp(base - span, 0, 1), U.clamp(base + span, 0, 1)], BBB.LFO_COLORS[mods[0].lfo]);
    }
  }
  BBB.Knob = Knob;

  // ---------------- Context menu ----------------
  let menuEl = null;
  const closeMenu = () => { if (menuEl) { menuEl.remove(); menuEl = null; } };
  BBB.contextMenu = (x, y, items) => {
    closeMenu();
    menuEl = BBB.el('div', { class: 'ctxmenu' });
    items.forEach((it) => {
      if (it.sep) { menuEl.appendChild(BBB.el('div', { class: 'sep' })); return; }
      const row = BBB.el('div', { class: 'item' + (it.disabled ? ' disabled' : ''), onclick: () => { closeMenu(); if (!it.disabled) it.fn(); } }, [
        it.color ? BBB.el('span', { class: 'dot', style: { background: it.color } }) : null,
        it.label
      ]);
      menuEl.appendChild(row);
    });
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
    menuEl.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
  };
  window.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('blur', closeMenu);
})();
