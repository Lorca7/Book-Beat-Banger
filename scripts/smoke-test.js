// Headless smoke test: loads the app in Chromium, exercises playback, recording (fake mic),
// LFO drag & drop, automation write, offline WAV export and project round-trip.
// Usage: node scripts/smoke-test.js [--shots <dir>]
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const shotsIdx = process.argv.indexOf('--shots');
  const shots = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage({ viewport: { width: 1480, height: 960 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const url = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
  await page.goto(url);
  // Poll with page.evaluate (not waitForFunction, which some Playwright versions run via eval — blocked by the app's CSP).
  const waitFor = async (fn, timeout) => {
    const end = Date.now() + (timeout || 10000);
    for (;;) {
      if (await page.evaluate(fn).catch(() => false)) return;
      if (Date.now() > end) throw new Error('timed out waiting for ' + fn.toString());
      await page.waitForTimeout(100);
    }
  };
  const ok = (cond, msg) => { if (!cond) { throw new Error('FAIL: ' + msg); } console.log('  ✓ ' + msg); };
  await waitFor(() => !!(window.BBB && window.BBB.ready), 20000);

  // ---- playback ----
  await page.mouse.click(5, 300); // user gesture
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  let st = await page.evaluate(() => ({ playing: BBB.engine.clock.playing, step: BBB.engine.nextStep, ctx: BBB.ctx.state }));
  ok(st.playing && st.step > 8, `transport runs (scheduled ${st.step} steps, ctx ${st.ctx})`);
  if (shots) await page.screenshot({ path: path.join(shots, '01-playing.png') });

  // ---- LFO drag & drop onto the snare TUNE knob ----
  const handle = await page.locator('.lfo-handle').nth(1).boundingBox();
  const target = await page.locator('.knob[data-param="snare.tune"] svg').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + 10, { steps: 12 });
  if (shots) await page.screenshot({ path: path.join(shots, '02-lfo-drag.png') });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 4 });
  await page.mouse.up();
  const mods = await page.evaluate(() => BBB.state.mods.map((m) => m.lfo + ':' + m.param));
  ok(mods.includes('1:snare.tune'), 'LFO 2 dropped onto SNARE TUNE → ' + mods.join(', '));
  // modulate an audio-rate param too
  await page.evaluate(() => BBB.addMod(2, 'fx.filter.cut', 0.4));
  await page.waitForTimeout(400);
  const active = await page.evaluate(() => [...BBB.engine.modActive]);
  ok(active.includes('fx.filter.cut'), 'modulation scheduler drives filter cutoff');

  // ---- automation write: touch & move a knob while AUTO is armed ----
  await page.click('.tbtn.auto');
  const kb = await page.locator('.knob[data-param="kick.tune"] svg').boundingBox();
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await page.mouse.down();
  for (let k = 0; k < 20; k++) { await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2 - k * 4); await page.waitForTimeout(40); }
  await page.mouse.up();
  await page.click('.tbtn.auto');
  const lane = await page.evaluate(() => { const l = BBB.state.auto.lanes['kick.tune']; return l ? { len: l.length, min: Math.min(...l), max: Math.max(...l) } : null; });
  ok(lane && lane.max - lane.min > 0.05, `automation lane recorded for kick.tune (${lane && lane.len} pts, range ${lane && lane.min.toFixed(2)}–${lane && lane.max.toFixed(2)})`);

  // ---- piano roll: add a note ----
  const pr = await page.locator('.proll-canvas').boundingBox();
  const before = await page.evaluate(() => BBB.state.tracks[3].notes.length);
  await page.mouse.click(pr.x + 38 + ((pr.width - 38) / 16) * 4.5, pr.y + pr.height * 0.3);
  const after = await page.evaluate(() => BBB.state.tracks[3].notes.length);
  ok(after === before + 1, 'piano roll click adds a note');

  // ---- step painting ----
  const steps = page.locator('.track').nth(1).locator('.step');
  const s3 = await steps.nth(2).boundingBox(), s6 = await steps.nth(6).boundingBox();
  await page.mouse.move(s3.x + 5, s3.y + 5); await page.mouse.down();
  await page.mouse.move(s6.x + 5, s6.y + 5, { steps: 6 }); await page.mouse.up();
  const painted = await page.evaluate(() => BBB.state.tracks[1].steps.slice(2, 7).map((s) => s.on));
  ok(painted.every(Boolean), 'drag-painting snare steps 3–7');

  // ---- mic recording into the hi-hat track (fake device = beep) ----
  await page.keyboard.press('Space'); // stop
  await page.click('.track:nth-child(3) .recmini');
  await waitFor(() => BBB.mic.state !== 'idle', 5000);
  await page.waitForTimeout(1600);
  if (shots) await page.screenshot({ path: path.join(shots, '03-recording.png') });
  const recState = await page.evaluate(() => BBB.mic.state);
  await page.click('.editor .btn.rec');
  await page.waitForTimeout(300);
  const rec = await page.evaluate(() => {
    const s = BBB.state.tracks[2].sample;
    return { custom: s.custom, len: s.buffer && s.buffer.duration, raw: s.raw.duration, name: s.name, start: s.start, end: s.end };
  });
  ok(rec.custom && rec.len > 0.01, `recorded into HI-HAT (state was ${recState}; raw ${rec.raw.toFixed(2)}s → trimmed ${rec.len.toFixed(3)}s)`);
  if (shots) await page.screenshot({ path: path.join(shots, '04-recorded.png') });

  // edit: reverse + gain, check processed buffer changes
  const v0 = await page.evaluate(() => BBB.state.tracks[2].sample.version);
  await page.click('.editor .btn.toggle:has-text("REVERSE")');
  const v1 = await page.evaluate(() => ({ v: BBB.state.tracks[2].sample.version, rev: BBB.state.tracks[2].sample.reverse }));
  ok(v1.v > v0 && v1.rev, 'reverse edit re-processes the sample');
  // drag the start handle of the waveform
  const wave = await page.locator('.wave').boundingBox();
  const sx = await page.evaluate(() => BBB.editor.xOf(BBB.editor.slot.start));
  const startBefore = await page.evaluate(() => BBB.editor.slot.start);
  await page.mouse.move(wave.x + sx, wave.y + wave.height / 2); await page.mouse.down();
  await page.mouse.move(wave.x + sx + 30, wave.y + wave.height / 2, { steps: 5 }); await page.mouse.up();
  const startAfter = await page.evaluate(() => BBB.editor.slot.start);
  ok(startAfter > startBefore, `dragging the start handle trims (${startBefore.toFixed(3)} → ${startAfter.toFixed(3)} s)`);

  // ---- granular editor view ----
  await page.click('.editor .tab:has-text("GRANULAR")');
  await page.keyboard.down('a'); await page.waitForTimeout(400);
  const voices = await page.evaluate(() => BBB.engine.voices.length);
  await page.keyboard.up('a');
  ok(voices > 0, 'computer keyboard plays the granular synth');
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  if (shots) await page.screenshot({ path: path.join(shots, '05-granular.png') });
  await page.keyboard.press('Space');

  // ---- offline export ----
  const rend = await page.evaluate(async () => {
    const buf = await BBB.renderOffline({ bars: 2, tail: true, sampleRate: 44100 });
    const d = buf.getChannelData(0);
    let sum = 0, peak = 0, nan = 0;
    for (let i = 0; i < d.length; i++) { const v = d[i]; if (v !== v) nan++; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    const wav = BBB.util.bufferToWAV(buf, 24);
    // granular energy: render solo gran
    return { dur: buf.duration, rms: Math.sqrt(sum / d.length), peak, nan, wavBytes: wav.length, head: String.fromCharCode(...wav.slice(0, 4)) };
  });
  ok(rend.head === 'RIFF' && rend.rms > 0.01 && rend.nan === 0 && rend.peak <= 1.01, `offline render ${rend.dur.toFixed(2)}s rms=${rend.rms.toFixed(3)} peak=${rend.peak.toFixed(2)} wav=${(rend.wavBytes / 1e6).toFixed(1)}MB`);
  const granOnly = await page.evaluate(async () => {
    const T = BBB.state.tracks; T.forEach((t, i) => (t.solo = i === 3));
    const buf = await BBB.renderOffline({ bars: 1, tail: false, sampleRate: 44100 });
    T.forEach((t) => (t.solo = false));
    const d = buf.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    return Math.sqrt(s / d.length);
  });
  ok(granOnly > 0.005, `granular track renders audio when soloed (rms=${granOnly.toFixed(3)})`);

  // ---- export dialog through the UI ----
  await page.click('.btn.accent:has-text("EXPORT WAV")');
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.click('.modal .btn.accent');
  const file = await dl;
  ok(/\.wav$/.test(file.suggestedFilename()), 'export dialog produced ' + file.suggestedFilename());

  // ---- master REC ----
  await page.click('.tbtn.rec');
  await page.waitForTimeout(1500);
  const dl2 = page.waitForEvent('download', { timeout: 10000 });
  await page.click('.tbtn.rec');
  const f2 = await dl2;
  const p2 = await f2.path();
  const size = require('fs').statSync(p2).size;
  ok(size > 44 + 48000 * 6, `live REC saved ${f2.suggestedFilename()} (${(size / 1e6).toFixed(2)} MB)`);
  await page.keyboard.press('Space');

  // ---- project round trip ----
  const rt = await page.evaluate(async () => {
    const j = JSON.parse(JSON.stringify(BBB.serialize()));
    const before = { mods: BBB.state.mods.length, lanes: Object.keys(BBB.state.auto.lanes).length, hatCustom: BBB.state.tracks[2].sample.custom, notes: BBB.state.tracks[3].notes.length };
    await BBB.deserialize(j);
    const after = { mods: BBB.state.mods.length, lanes: Object.keys(BBB.state.auto.lanes).length, hatCustom: BBB.state.tracks[2].sample.custom, notes: BBB.state.tracks[3].notes.length };
    return { before, after, size: JSON.stringify(j).length };
  });
  ok(JSON.stringify(rt.before) === JSON.stringify(rt.after), `project save/load round-trip ${JSON.stringify(rt.after)} (${(rt.size / 1024).toFixed(0)} KB)`);

  if (shots) await page.screenshot({ path: path.join(shots, '06-final.png') });
  await browser.close();
  if (errors.length) { console.log('\nErrors:\n' + errors.join('\n')); process.exit(1); }
  console.log('\nAll smoke tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
