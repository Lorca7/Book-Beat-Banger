/* Book Beat Banger — core utilities, event bus, WAV encoding, file helpers */
(function () {
  'use strict';
  const BBB = (window.BBB = window.BBB || {});
  const U = (BBB.util = {});

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dbToGain = (db) => Math.pow(10, db / 20);
  U.gainToDb = (g) => (g <= 0.000001 ? -120 : 20 * Math.log10(g));
  U.wrap = (v, len) => ((v % len) + len) % len;

  // Deterministic integer hash -> [0,1). Used for S&H LFOs so offline renders match playback.
  U.hash = (n, seed) => {
    let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((seed | 0) + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  U.noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  U.isBlackKey = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

  U.fmtDb = (g) => { const d = U.gainToDb(g); return d <= -60 ? '-∞' : (d > 0 ? '+' : '') + d.toFixed(1) + 'dB'; };
  U.fmtHz = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + 'k' : Math.round(v) + 'Hz');
  U.fmtSec = (v) => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's');
  U.fmtPct = (v) => Math.round(v * 100) + '%';
  U.fmtClock = (sec) => {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60), cs = Math.floor((sec * 10) % 10);
    return m + ':' + String(s).padStart(2, '0') + '.' + cs;
  };
  U.stamp = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  };

  // ---------- Event bus ----------
  const listeners = {};
  BBB.on = (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); return () => BBB.off(evt, fn); };
  BBB.off = (evt, fn) => { const l = listeners[evt]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } };
  BBB.emit = (evt, ...args) => { const l = listeners[evt]; if (l) l.slice().forEach((fn) => fn(...args)); };

  // ---------- DOM helper ----------
  BBB.el = (tag, attrs, children) => {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const sk in v) { if (sk.startsWith('--')) e.style.setProperty(sk, v[sk]); else e.style[sk] = v[sk]; }
        }
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  };

  // ---------- WAV encode ----------
  // channels: Float32Array[]; bitDepth: 16 | 24 | 32 (float)
  U.encodeWAV = (channels, sampleRate, bitDepth) => {
    bitDepth = bitDepth || 24;
    const nCh = channels.length, len = channels[0].length;
    const isFloat = bitDepth === 32, bps = bitDepth / 8;
    const dataSize = len * nCh * bps;
    const buf = new ArrayBuffer(44 + dataSize);
    const dv = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, isFloat ? 3 : 1, true);
    dv.setUint16(22, nCh, true); dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * nCh * bps, true); dv.setUint16(32, nCh * bps, true);
    dv.setUint16(34, bitDepth, true); str(36, 'data'); dv.setUint32(40, dataSize, true);
    let o = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < nCh; c++) {
        let s = channels[c][i];
        if (s !== s) s = 0; // NaN guard
        if (isFloat) { dv.setFloat32(o, s, true); o += 4; continue; }
        s = s < -1 ? -1 : s > 1 ? 1 : s;
        if (bitDepth === 16) { dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
        else {
          const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
          dv.setUint8(o, v & 0xff); dv.setUint8(o + 1, (v >> 8) & 0xff); dv.setUint8(o + 2, (v >> 16) & 0xff); o += 3;
        }
      }
    }
    return new Uint8Array(buf);
  };

  U.bufferToWAV = (audioBuffer, bitDepth) => {
    const chs = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) chs.push(audioBuffer.getChannelData(c));
    return U.encodeWAV(chs, audioBuffer.sampleRate, bitDepth);
  };

  U.b64encode = (bytes) => {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  };
  U.b64decode = (b64) => {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };

  // ---------- Save file (native dialog in the Mac app, download in a browser) ----------
  BBB.saveFile = async (name, bytes, mime, filters) => {
    if (window.bbbNative && window.bbbNative.saveFile) {
      const res = await window.bbbNative.saveFile(name, bytes, filters);
      if (res && res.ok) BBB.toast('Saved ' + res.path.split('/').pop());
      return res;
    }
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = BBB.el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    BBB.toast('Downloaded ' + name);
    return { ok: true };
  };

  BBB.toast = (msg, kind) => {
    let host = document.getElementById('toasts');
    if (!host) { host = BBB.el('div', { id: 'toasts' }); document.body.appendChild(host); }
    const t = BBB.el('div', { class: 'toast ' + (kind || ''), text: msg });
    host.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  };
})();
