/* Book Beat Banger — LFO panel with drag & drop modulation routing */
(function () {
  'use strict';
  const BBB = window.BBB, U = BBB.util, S = BBB.state;

  class LfoPanel {
    constructor(host) {
      this.el = BBB.el('div', { class: 'panel lfos leather binding-green' });
      this.el.appendChild(BBB.el('div', { class: 'panel-head' }, [
        BBB.el('div', { class: 'panel-title', html: 'The Muses' }),
        BBB.el('div', { class: 'hint', text: 'LFOs · drag a muse onto any dial' })
      ]));
      const grid = BBB.el('div', { class: 'lfo-grid' });
      this.cards = [0, 1, 2, 3].map((i) => this.makeCard(i, grid));
      this.el.appendChild(grid);
      host.appendChild(this.el);
      BBB.on('mods', () => this.renderTargets());
      this.renderTargets();
    }

    makeCard(i, grid) {
      const L = S.lfos[i], color = BBB.LFO_COLORS[i];
      const card = BBB.el('div', { class: 'lfo', style: { '--lc': color } });
      const handle = BBB.el('div', { class: 'lfo-handle', title: 'Drag this muse onto any dial to inspire (modulate) it', text: '✒' });
      const scope = BBB.el('canvas', { class: 'lfo-scope', width: 240, height: 80, title: 'Click to change the waveform' });
      const shapeBtn = BBB.el('button', { class: 'shape on lfo-shape', title: 'Waveform' });
      const pickShape = (x, y) => BBB.contextMenu(x, y, BBB.LFO_SHAPES.map(([id, label]) => ({
        label: label + (L.shape === id ? '  ✓' : ''), color, fn: () => { L.shape = id; showShape(); BBB.emit('lfo'); }
      })));
      const showShape = () => { shapeBtn.textContent = (BBB.LFO_SHAPES.find((x) => x[0] === L.shape) || ['', '?'])[1] ; };
      shapeBtn.addEventListener('click', (e) => { const r = shapeBtn.getBoundingClientRect(); pickShape(r.left, r.bottom + 2); });
      scope.addEventListener('click', () => {
        const k = BBB.LFO_SHAPES.findIndex((x) => x[0] === L.shape);
        L.shape = BBB.LFO_SHAPES[(k + 1) % BBB.LFO_SHAPES.length][0]; showShape(); BBB.emit('lfo');
      });
      showShape();
      const knobHost = BBB.el('div', { class: 'lfo-knobs' });
      const divK = new BBB.Knob(BBB.param(`lfo${i}.div`), { size: 32, small: true, color });
      const hzK = new BBB.Knob(BBB.param(`lfo${i}.hz`), { size: 32, small: true, color });
      const phK = new BBB.Knob(BBB.param(`lfo${i}.phase`), { size: 32, small: true, color });
      const sync = BBB.el('button', { class: 'shape lfo-sync' + (L.sync ? ' on' : ''), text: 'Sync', title: 'Sync the rate to the tempo' });
      const showRate = () => { divK.el.style.display = L.sync ? '' : 'none'; hzK.el.style.display = L.sync ? 'none' : ''; sync.classList.toggle('on', L.sync); showShape(); };
      sync.addEventListener('click', () => { L.sync = !L.sync; showRate(); BBB.emit('lfo'); });
      showRate();
      knobHost.appendChild(divK.el); knobHost.appendChild(hzK.el); knobHost.appendChild(phK.el);
      const targets = BBB.el('div', { class: 'targets' });
      card.appendChild(BBB.el('div', { class: 'lfo-id' }, [
        BBB.el('div', { class: 'lfo-idtop' }, [BBB.el('div', { class: 'lfo-name', text: BBB.MUSES[i], title: 'LFO ' + (i + 1) }), handle]),
        BBB.el('div', { class: 'lfo-idbot' }, [sync, shapeBtn])
      ]));
      card.appendChild(scope);
      card.appendChild(knobHost);
      card.appendChild(targets);
      grid.appendChild(card);
      this.bindDrag(i, handle, color);
      return { card, scope, targets, showRate };
    }

    syncFromState() {
      this.cards.forEach((c, i) => {
        c.showRate();
      });
      this.renderTargets();
    }

    bindDrag(i, handle, color) {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const ghost = BBB.el('div', { class: 'lfo-ghost', style: { background: color }, text: ['I', 'II', 'III', 'IV'][i] });
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        line.setAttribute('class', 'lfo-cable');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('stroke', color);
        line.appendChild(path);
        document.body.appendChild(line); document.body.appendChild(ghost);
        document.body.classList.add('lfo-dragging');
        document.body.style.setProperty('--drag-color', color);
        const hr = handle.getBoundingClientRect();
        const ox = hr.left + hr.width / 2, oy = hr.top + hr.height / 2;
        let hover = null;
        const move = (ev) => {
          ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
          const mx = (ox + ev.clientX) / 2, my = Math.max(oy, ev.clientY) + 60;
          path.setAttribute('d', `M${ox} ${oy} Q${mx} ${my} ${ev.clientX} ${ev.clientY}`);
          ghost.style.display = 'none';
          const t = document.elementFromPoint(ev.clientX, ev.clientY);
          ghost.style.display = '';
          const k = t && t.closest ? t.closest('.knob[data-mod="1"]') : null;
          if (k !== hover) { if (hover) hover.classList.remove('drop-hover'); hover = k; if (hover) hover.classList.add('drop-hover'); }
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          ghost.remove(); line.remove();
          document.body.classList.remove('lfo-dragging');
          if (hover) {
            hover.classList.remove('drop-hover');
            const id = hover.dataset.param;
            const ok = BBB.addMod(i, id, 0.25);
            const p = BBB.param(id);
            BBB.toast(ok ? `${BBB.MUSES[i]} now inspires ${p.fullName}` : `${BBB.MUSES[i]} already inspires ${p.fullName}`);
            hover.classList.add('drop-flash');
            const h = hover;
            setTimeout(() => h.classList.remove('drop-flash'), 500);
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        move(e);
      });
    }

    renderTargets() {
      this.cards.forEach((c, i) => {
        const host = c.targets;
        host.innerHTML = '';
        const mods = S.mods.filter((m) => m.lfo === i);
        if (!mods.length) { host.appendChild(BBB.el('div', { class: 'empty', text: 'awaiting a subject' })); return; }
        mods.forEach((m) => {
          const p = BBB.param(m.param);
          const bar = BBB.el('div', { class: 'chip-bar' });
          const val = BBB.el('span', { class: 'chip-val mono' });
          const show = () => {
            val.textContent = (m.depth > 0 ? '+' : '') + Math.round(m.depth * 100);
            const w = Math.abs(m.depth) * 50;
            bar.style.left = (m.depth >= 0 ? 50 : 50 - w) + '%'; bar.style.width = w + '%';
          };
          show();
          const chip = BBB.el('div', { class: 'chip', title: p.fullName + '\nDrag ↔ to set the depth · double-click for 25% · × dismisses' }, [
            bar, BBB.el('span', { class: 'chip-name', text: p.fullName, style: { color: p.trackColor || (BBB.TRACKS.some((t) => t.id === p.group) ? p.color : BBB.THEME.ink) } }), val,
            BBB.el('button', { class: 'x', text: '×', title: 'Remove', onclick: (e) => { e.stopPropagation(); BBB.removeMod(i, m.param); } })
          ]);
          let sx = 0, sd = 0, drag = false;
          chip.addEventListener('pointerdown', (e) => {
            if (e.target.classList.contains('x') || e.button !== 0) return;
            drag = true; sx = e.clientX; sd = m.depth; chip.setPointerCapture(e.pointerId); chip.classList.add('active');
          });
          chip.addEventListener('pointermove', (e) => {
            if (!drag) return;
            m.depth = U.clamp(Math.round((sd + (e.clientX - sx) / (e.shiftKey ? 600 : 150)) * 100) / 100, -1, 1);
            show();
          });
          const end = () => { drag = false; chip.classList.remove('active'); };
          chip.addEventListener('pointerup', end); chip.addEventListener('pointercancel', end);
          chip.addEventListener('dblclick', () => { m.depth = 0.25; show(); });
          chip.addEventListener('mouseenter', () => (BBB.knobs.get(m.param) || []).forEach((k) => { k.el.style.setProperty('--drag-color', BBB.LFO_COLORS[i]); k.el.classList.add('drop-hover'); }));
          chip.addEventListener('mouseleave', () => (BBB.knobs.get(m.param) || []).forEach((k) => k.el.classList.remove('drop-hover')));
          host.appendChild(chip);
        });
      });
      BBB.knobs.forEach((list) => list.forEach((k) => k.updateBadges()));
    }

    frame(eng) {
      const now = eng.ctx.currentTime;
      const beats = eng.beatsAt(now), secs = eng.secsAt(now);
      this.cards.forEach((c, i) => {
        const cv = c.scope, g = cv.getContext('2d'), T = BBB.THEME;
        const W = cv.width, H = cv.height, color = BBB.LFO_COLORS[i];
        g.clearRect(0, 0, W, H);
        g.fillStyle = T.paper; g.fillRect(0, 0, W, H);
        g.fillStyle = T.rule; g.fillRect(0, H / 2, W, 1.5);
        const L = S.lfos[i];
        const per = L.sync ? BBB.LFO_DIVS[Math.round(BBB.param(`lfo${i}.div`).value)][1] : 1 / BBB.param(`lfo${i}.hz`).value;
        const span = Math.min(per * 2, L.sync ? 64 : 8);
        g.strokeStyle = color; g.lineWidth = 4; g.lineJoin = 'round'; g.beginPath();
        for (let x = 0; x <= W; x += 2) {
          const back = (1 - x / W) * span;
          const v = L.sync ? BBB.lfoValue(i, beats - back, secs) : BBB.lfoValue(i, beats, secs - back);
          const y = H / 2 - v * (H / 2 - 8);
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        const v = BBB.lfoValue(i, beats, secs);
        g.fillStyle = T.ink;
        g.beginPath(); g.arc(W - 7, H / 2 - v * (H / 2 - 8), 6, 0, Math.PI * 2); g.fill();
      });
    }
  }
  BBB.LfoPanel = LfoPanel;
})();
