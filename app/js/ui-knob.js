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
  BBB.MUSES = ['Muse I', 'Muse II', 'Muse III', 'Muse IV'];
  BBB.on('terms', () => BBB.knobs.forEach((list) => list.forEach((k) => k.relabel())));

  // Shared gradients for brass (on leather) and ivory enamel (on paper) dial faces.
  let defsDone = false;
  const ensureDefs = () => {
    if (defsDone) return;
    defsDone = true;
    const host = svg('svg', { width: 0, height: 0, style: 'position:absolute;width:0;height:0', 'aria-hidden': 'true' });
    host.innerHTML = `<defs>
      <radialGradient id="kb-brass-face" cx="38%" cy="30%" r="80%">
        <stop offset="0" stop-color="#fbeec2"/><stop offset=".35" stop-color="#dcb965"/><stop offset=".8" stop-color="#9c7630"/><stop offset="1" stop-color="#6e521f"/></radialGradient>
      <linearGradient id="kb-brass-rim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff1c4"/><stop offset=".5" stop-color="#a98436"/><stop offset="1" stop-color="#4a3512"/></linearGradient>
      <radialGradient id="kb-ivory-face" cx="38%" cy="30%" r="85%">
        <stop offset="0" stop-color="#fffdf6"/><stop offset=".55" stop-color="#f1e6cd"/><stop offset="1" stop-color="#c8b28a"/></radialGradient>
      <linearGradient id="kb-ivory-rim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fffaf0"/><stop offset=".55" stop-color="#b59a6a"/><stop offset="1" stop-color="#6f5634"/></linearGradient>
      <filter id="kb-shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy=".9" stdDeviation=".8" flood-color="#1a0f08" flood-opacity=".55"/></filter>
    </defs>`;
    document.body.appendChild(host);
  };

  class Knob {
    /**
     * model: a BBB.Param, or any object with { norm, defNorm, setNorm(n), format(), label, color }
     */
    constructor(model, opts) {
      opts = opts || {};
      ensureDefs();
      this.p = model;
      this.size = opts.size || 44;
      this.color = opts.color || model.color || '#ddd';
      this.isParam = model instanceof BBB.Param;
      this.fixedLabel = opts.label || null;
      const label = this.fixedLabel || model.displayLabel || model.label;
      const c = this.size / 2;
      this.c = c;
      const el = (this.el = BBB.el('div', { class: 'knob' + (opts.small ? ' small' : '') }));
      this.updateTitle();
      el.style.setProperty('--kc', this.color);
      if (this.isParam) { el.dataset.param = model.id; if (model.mod) el.dataset.mod = '1'; }
      if (!opts.nolabel) { this.labelEl = BBB.el('div', { class: 'k-label', text: label }); el.appendChild(this.labelEl); }
      const s = (this.svg = svg('svg', { width: this.size, height: this.size, viewBox: `0 0 ${this.size} ${this.size}`, class: 'k-svg' }));
      // geometry of an engraved instrument dial
      const R = c - 1.5;
      this.R = R;
      this.rArc = R - 4.6;
      this.rFace = R - 6.8;
      // engraved scale
      let ticks = '';
      for (let i = 0; i <= 20; i++) {
        const n = i / 20, major = i % 5 === 0;
        const [x0, y0] = pt(ang(n), R - (major ? 3.4 : 1.9), c), [x1, y1] = pt(ang(n), R, c);
        ticks += `M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`;
      }
      s.appendChild(svg('path', { d: ticks, class: 'k-ticks' }));
      s.appendChild(svg('path', { d: arc(0, 1, this.rArc, c), class: 'k-track' }));
      this.valArc = svg('path', { class: 'k-val' });
      s.appendChild(this.valArc);
      // bevelled face with a faint guilloché ring
      s.appendChild(svg('circle', { cx: c, cy: c, r: this.rFace, class: 'k-body' }));
      s.appendChild(svg('circle', { cx: c, cy: c, r: this.rFace * 0.66, class: 'k-guilloche' }));
      s.appendChild(svg('circle', { cx: c, cy: c, r: this.rFace * 0.36, class: 'k-guilloche' }));
      this.modArc = svg('path', { class: 'k-mod' });
      this.ptr = svg('path', { class: 'k-ptr' });
      this.jewel = svg('circle', { cx: c, cy: c, r: Math.max(1.6, this.size * 0.05), class: 'k-jewel' });
      this.modDot = svg('circle', { r: 2.1, class: 'k-moddot' });
      s.appendChild(this.modArc); s.appendChild(this.ptr); s.appendChild(this.jewel); s.appendChild(this.modDot);
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

    updateTitle() {
      const m = this.p;
      const help = this.isParam && m.mod
        ? BBB.t('\nDrag ↕ (Shift for fine) · double-click to restore · right-click for more · drop a Muse here to inspire it',
          '\nDrag ↕ (Shift for fine) · double-click to reset · right-click for options · drop an LFO here to modulate it')
        : '\nDrag ↕ · double-click to reset';
      this.el.title = (m.tooltip || m.fullName || m.label) + help;
    }
    /** Re-read the label after the literary/plain mode changes. */
    relabel() {
      if (this.labelEl && !this.fixedLabel) this.labelEl.textContent = this.p.displayLabel || this.p.label;
      this.updateTitle();
      this.last.txt = null;
      this.updateBadges(true);
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
        const items = [{ label: BBB.t('Restore the original', 'Reset to default'), fn: () => p.setNorm(p.defNorm) }];
        if (S.auto.lanes[p.id]) items.push({ label: BBB.t('Erase annotations (automation)', 'Clear automation'), fn: () => BBB.clearLane(p.id) });
        if (p.mod) {
          items.push({ sep: true });
          for (let i = 0; i < 4; i++) {
            const has = S.mods.find((m) => m.lfo === i && m.param === p.id);
            items.push(has
              ? { label: BBB.t(`Dismiss ${BBB.MUSES[i]}`, `Remove LFO ${i + 1}`), color: BBB.LFO_COLORS[i], fn: () => BBB.removeMod(i, p.id) }
              : { label: BBB.t(`Inspire with ${BBB.MUSES[i]}`, `Modulate with LFO ${i + 1}`), color: BBB.LFO_COLORS[i], fn: () => BBB.addMod(i, p.id, 0.25) });
          }
        }
        BBB.contextMenu(e.clientX, e.clientY, items);
      });
    }

    updateBadges(force) {
      if (!this.isParam) return;
      const id = this.p.id, mods = BBB.modsFor(id) || [], lane = S.auto.lanes[id];
      const key = mods.map((m) => m.lfo).join(',') + '|' + (lane ? 1 : 0);
      if (key === this.badgeKey && !force) return;
      this.badgeKey = key;
      this.badges.innerHTML = '';
      mods.forEach((m) => this.badges.appendChild(BBB.el('span', { class: 'k-dot', style: { background: BBB.LFO_COLORS[m.lfo] }, title: BBB.t('Inspired by ' + BBB.MUSES[m.lfo], 'Modulated by LFO ' + (m.lfo + 1)) })));
      if (lane) this.badges.appendChild(BBB.el('span', { class: 'k-auto', text: '✎', title: BBB.t('Annotated (automated) — right-click to erase', 'Automated — right-click to clear') }));
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
      const c = this.c, R = this.R;
      const from = this.bipolar != null ? this.bipolar : 0;
      this.valArc.setAttribute('d', arc(from, base, this.rArc, c));
      // slender needle with a short counterweight tail
      const a = ang(base);
      const [tx, ty] = pt(a + 180, this.rFace * 0.42, c), [nx, ny] = pt(a, this.rArc + 0.6, c);
      this.ptr.setAttribute('d', `M${tx.toFixed(2)} ${ty.toFixed(2)}L${nx.toFixed(2)} ${ny.toFixed(2)}`);
      if (range) {
        this.modArc.setAttribute('d', arc(range[0], range[1], R + 2, c));
        this.modArc.style.stroke = modColor;
        this.modArc.style.display = '';
      } else this.modArc.style.display = 'none';
      if (eff != null) {
        const [dx, dy] = pt(ang(eff), R + 2, c);
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
