// ONE-STROKE HEIST — daily vault puzzle, fully client-side, seeded by UTC date.

(function () {
  'use strict';

  // ---------- seeded RNG (mulberry32) ----------
  function seedFromDate(d) {
    // YYYYMMDD integer, deterministic across timezones via UTC.
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return y * 10000 + m * 100 + day;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- layout generation ----------
  function generateLayout(seed) {
    const rand = mulberry32(seed);
    // gem count: 6..10
    const gemCount = 6 + Math.floor(rand() * 5);
    // trap count: 3..6
    const trapCount = 3 + Math.floor(rand() * 4);

    const gems = [];
    const traps = [];

    // place within normalized [0.08, 0.92] x [0.14, 0.86] (leave HUD room)
    const minDistG = 0.16;
    const minDistT = 0.12;

    function tryPlace(list, otherLists, minDist, padY) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const x = 0.1 + rand() * 0.8;
        const y = padY + rand() * (0.86 - padY);
        let ok = true;
        for (const p of list) {
          const dx = p.x - x, dy = p.y - y;
          if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
        }
        if (ok) {
          for (const other of otherLists) {
            for (const p of other) {
              const dx = p.x - x, dy = p.y - y;
              if (dx * dx + dy * dy < (minDist * 0.9) * (minDist * 0.9)) { ok = false; break; }
            }
            if (!ok) break;
          }
        }
        if (ok) return { x, y };
      }
      return null;
    }

    for (let i = 0; i < gemCount; i++) {
      const p = tryPlace(gems, [traps], minDistG, 0.2);
      if (p) gems.push({ x: p.x, y: p.y, collected: false, pulse: rand() });
    }
    for (let i = 0; i < trapCount; i++) {
      const p = tryPlace(traps, [gems], minDistT, 0.22);
      if (p) traps.push({ x: p.x, y: p.y, pulse: rand() });
    }

    return { gems, traps, seed };
  }

  // ---------- state ----------
  const canvas = document.getElementById('vault');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  const today = new Date();
  const todaySeed = seedFromDate(today);
  let layout = generateLayout(todaySeed);

  // Day label like "April 18"
  const DAY_LABEL = today.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', timeZone: 'UTC'
  });

  const state = {
    mode: 'pre', // 'pre' | 'play' | 'end'
    points: [],  // {x,y} in CSS pixels
    lengthPx: 0,
    endReason: null,
    startedAt: 0,
  };

  // ---------- sizing ----------
  function resize() {
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  window.addEventListener('resize', () => {
    resize();
    draw();
  });

  // ---------- helpers ----------
  function norm(pt) {
    // layout coords (0..1) → pixels
    return { x: pt.x * W, y: pt.y * H };
  }

  // shortest dist from point p to line segment a-b
  function distPointSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) {
      const ex = px - ax, ey = py - ay;
      return Math.sqrt(ex * ex + ey * ey);
    }
    let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    const ex = px - qx, ey = py - qy;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Proper segment-segment intersection (strict, excluding shared endpoints)
  function segmentsIntersect(p1, p2, p3, p4) {
    function cross(ox, oy, ax, ay, bx, by) {
      return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
    }
    const d1 = cross(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y);
    const d2 = cross(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);
    const d3 = cross(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    const d4 = cross(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
      return true;
    }
    return false;
  }

  // ---------- input ----------
  let pointerDown = false;
  let pointerId = null;

  function getPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    return { x, y };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'play') return;
    if (pointerDown) return;
    pointerDown = true;
    pointerId = e.pointerId;
    canvas.setPointerCapture?.(e.pointerId);

    const p = getPoint(e);
    state.points = [p];
    state.lengthPx = 0;
    state.startedAt = performance.now();
    updateHUD();
  });

  function handleMove(e) {
    if (!pointerDown || state.mode !== 'play') return;
    if (pointerId !== null && e.pointerId !== pointerId) return;
    e.preventDefault();

    const p = getPoint(e);
    const pts = state.points;
    if (pts.length === 0) { pts.push(p); return; }
    const last = pts[pts.length - 1];
    const dx = p.x - last.x, dy = p.y - last.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1.5) return; // throttle

    const newSeg = { a: last, b: p };

    // self-intersection: check against all non-adjacent previous segments
    // segments are pts[i]-pts[i+1]; new one is pts[len-1]-p
    const n = pts.length;
    for (let i = 0; i < n - 2; i++) {
      if (segmentsIntersect(pts[i], pts[i + 1], last, p)) {
        state.lengthPx += dist;
        pts.push(p);
        endRun('LINE CROSSED');
        return;
      }
    }

    // trap hit: any segment from prev->p passes within trap radius
    const trapR = Math.min(W, H) * 0.026;
    for (const t of layout.traps) {
      const tp = norm(t);
      if (distPointSeg(tp.x, tp.y, last.x, last.y, p.x, p.y) < trapR) {
        state.lengthPx += dist;
        pts.push(p);
        endRun('TRAP TRIGGERED');
        return;
      }
    }

    // gem pickups: any uncollected gem whose dist to segment is within radius
    const gemR = Math.min(W, H) * 0.04;
    for (const g of layout.gems) {
      if (g.collected) continue;
      const gp = norm(g);
      if (distPointSeg(gp.x, gp.y, last.x, last.y, p.x, p.y) < gemR) {
        g.collected = true;
      }
    }

    pts.push(p);
    state.lengthPx += dist;

    updateHUD();
  }

  canvas.addEventListener('pointermove', handleMove);

  function handleUp(e) {
    if (!pointerDown) return;
    if (pointerId !== null && e.pointerId !== pointerId) return;
    pointerDown = false;
    pointerId = null;
    if (state.mode === 'play') {
      endRun('LIFTED');
    }
  }

  canvas.addEventListener('pointerup', handleUp);
  canvas.addEventListener('pointercancel', handleUp);
  canvas.addEventListener('pointerleave', handleUp);

  // prevent scrolling on mobile from rubber-banding
  document.addEventListener('touchmove', (e) => {
    if (state.mode === 'play') e.preventDefault();
  }, { passive: false });

  // ---------- flow ----------
  function beginRun() {
    // reset collected flags (in case replay)
    for (const g of layout.gems) g.collected = false;
    state.points = [];
    state.lengthPx = 0;
    state.endReason = null;
    state.mode = 'play';
    document.getElementById('pre-overlay').classList.add('hidden');
    document.getElementById('end-overlay').classList.add('hidden');
    document.getElementById('share').style.display = 'none';
    document.getElementById('statusText').textContent = 'DRAWING';
    updateHUD();
  }

  function endRun(reason) {
    if (state.mode !== 'play') return;
    state.mode = 'end';
    state.endReason = reason;
    pointerDown = false;
    pointerId = null;
    document.getElementById('statusText').textContent = 'JOB OVER';
    // short delay so the player sees the final frame
    setTimeout(showResult, 380);
  }

  // Convert canvas pixels to a playful "inches" (fixed scale for shareability)
  function pxToInches(px) {
    return px / 60; // 60 px = 1 "inch" — pure flavor unit, deterministic
  }

  function buildEmojiGrid(collected, total) {
    let s = '';
    for (let i = 0; i < total; i++) s += (i < collected) ? '🟩' : '⬛';
    return s;
  }

  function buildShareText(collected, total, strokeLen) {
    const grid = buildEmojiGrid(collected, total);
    const inches = pxToInches(strokeLen).toFixed(1);
    return `One-Stroke Heist · ${DAY_LABEL} vault\n${collected}/${total} gems · stroke ${inches}in\n${grid}\n${location.origin}${location.pathname}`;
  }

  function showResult() {
    const collected = layout.gems.filter(g => g.collected).length;
    const total = layout.gems.length;
    const inches = pxToInches(state.lengthPx);

    // Efficiency: gems per 10in, capped for display sanity
    const eff = inches > 0 ? (collected / inches * 10).toFixed(2) : '0.00';

    let title = 'HEIST COMPLETE';
    if (state.endReason === 'TRAP TRIGGERED') title = 'ALARM TRIPPED';
    else if (state.endReason === 'LINE CROSSED') title = 'LINE CROSSED';
    else if (state.endReason === 'LIFTED' && collected === total) title = 'CLEAN EXIT';
    else if (state.endReason === 'LIFTED') title = 'LIFTED EARLY';

    document.getElementById('endTitle').textContent = title;
    document.getElementById('bigScore').textContent = `${collected} / ${total}`;
    document.getElementById('emojiGrid').textContent = buildEmojiGrid(collected, total);
    document.getElementById('endStroke').textContent = inches.toFixed(1) + ' in';
    document.getElementById('endEff').textContent = eff + ' g/10in';
    document.getElementById('endReason').textContent = state.endReason || '—';

    document.getElementById('end-overlay').classList.remove('hidden');
    document.getElementById('share').style.display = 'block';
    document.getElementById('statusText').textContent = 'REVIEW';

    // Stash share text for copy button
    currentShareText = buildShareText(collected, total, state.lengthPx);
  }

  let currentShareText = '';

  function copyShare() {
    const toast = document.getElementById('copiedToast');
    navigator.clipboard?.writeText(currentShareText).then(() => {
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 1400);
    }).catch(() => {
      // Fallback: select and prompt
      window.prompt('Copy this:', currentShareText);
    });
  }

  // ---------- drawing ----------
  function drawFloor() {
    // dark marble wash
    ctx.fillStyle = '#0a0c11';
    ctx.fillRect(0, 0, W, H);

    // blueprint grid
    ctx.save();
    ctx.strokeStyle = 'rgba(201, 162, 61, 0.06)';
    ctx.lineWidth = 1;
    const step = 36;
    ctx.beginPath();
    for (let x = 0; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // heavier every 4th line
    ctx.strokeStyle = 'rgba(201, 162, 61, 0.11)';
    ctx.beginPath();
    for (let x = 0; x <= W; x += step * 4) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += step * 4) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // vignette
    const grd = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  }

  function drawDiamond(cx, cy, r, fill, stroke, glow) {
    ctx.save();
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 16;
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.7, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r * 0.7, cy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // inner facet
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.35, cy);
    ctx.lineTo(cx, cy + r * 0.55);
    ctx.lineTo(cx - r * 0.35, cy);
    ctx.closePath();
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawGems(t) {
    const gemR = Math.min(W, H) * 0.032;
    for (const g of layout.gems) {
      const gp = norm(g);
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.0025 + g.pulse * Math.PI * 2);
      if (g.collected) {
        // faded ring where it used to be
        ctx.save();
        ctx.strokeStyle = 'rgba(201, 162, 61, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(gp.x, gp.y, gemR * 0.9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else {
        drawDiamond(
          gp.x, gp.y, gemR,
          `rgba(255, 214, 102, ${0.85 + 0.15 * pulse})`,
          'rgba(255, 238, 170, 0.95)',
          `rgba(255, 200, 80, ${0.35 + 0.25 * pulse})`
        );
      }
    }
  }

  function drawTraps(t) {
    const trapR = Math.min(W, H) * 0.02;
    for (const tr of layout.traps) {
      const tp = norm(tr);
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.004 + tr.pulse * Math.PI * 2);

      ctx.save();
      ctx.shadowColor = 'rgba(255, 60, 70, 0.6)';
      ctx.shadowBlur = 14 + pulse * 6;
      ctx.fillStyle = `rgba(255, 40, 55, ${0.75 + 0.25 * pulse})`;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, trapR * (0.9 + pulse * 0.15), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // crosshair
      ctx.strokeStyle = 'rgba(255, 220, 220, 0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tp.x - trapR * 1.4, tp.y); ctx.lineTo(tp.x + trapR * 1.4, tp.y);
      ctx.moveTo(tp.x, tp.y - trapR * 1.4); ctx.lineTo(tp.x, tp.y + trapR * 1.4);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawStroke() {
    const pts = state.points;
    if (pts.length < 2) {
      if (pts.length === 1) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 238, 170, 0.9)';
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      return;
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 238, 170, 0.92)';
    ctx.shadowColor = 'rgba(255, 214, 102, 0.55)';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();

    // head dot
    const h = pts[pts.length - 1];
    ctx.save();
    ctx.fillStyle = '#fff3c4';
    ctx.shadowColor = 'rgba(255, 214, 102, 0.8)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCornerMarks() {
    ctx.save();
    ctx.strokeStyle = 'rgba(233, 229, 215, 0.28)';
    ctx.lineWidth = 1;
    const s = 18, pad = 10;
    const corners = [
      [pad, pad, 1, 1],
      [W - pad, pad, -1, 1],
      [pad, H - pad, 1, -1],
      [W - pad, H - pad, -1, -1],
    ];
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x, y + dy * s);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * s, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(t) {
    if (!t) t = performance.now();
    drawFloor();
    drawCornerMarks();
    drawTraps(t);
    drawGems(t);
    drawStroke();
  }

  function loop(t) {
    draw(t);
    requestAnimationFrame(loop);
  }

  // ---------- HUD ----------
  function updateHUD() {
    const collected = layout.gems.filter(g => g.collected).length;
    document.getElementById('gemCount').textContent = `${collected} / ${layout.gems.length}`;
    document.getElementById('strokeLen').textContent = pxToInches(state.lengthPx).toFixed(1) + ' in';
  }

  // ---------- init ----------
  function init() {
    resize();
    document.getElementById('vaultDate').textContent = DAY_LABEL.toUpperCase();
    document.getElementById('gemCount').textContent = `0 / ${layout.gems.length}`;
    document.getElementById('startBtn').addEventListener('click', beginRun);
    document.getElementById('retryBtn').addEventListener('click', () => {
      // Replay today's layout (same seed)
      layout = generateLayout(todaySeed);
      beginRun();
    });
    document.getElementById('copyBtn').addEventListener('click', copyShare);

    requestAnimationFrame(loop);
  }

  init();

  // ---------- share() — required by the skill ----------
  window.share = function () {
    const text = currentShareText || `One-Stroke Heist · ${DAY_LABEL} vault\n${location.origin}${location.pathname}`;
    if (navigator.share) {
      navigator.share({ title: document.title, text, url: location.href }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => alert('Share text copied!'));
    }
  };
})();
