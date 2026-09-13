/* 小恐龙跑酷 — 纯 Canvas 实现，无外部资源依赖 */
(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');

  const W = 800, H = 200;          // 逻辑分辨率
  const GROUND_Y = 168;            // 地面线 y
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  // ---- 主题（白天 / 夜晚切换）----
  const THEMES = {
    day:   { sky: '#fbfbf7', ink: '#3d405b', ground: '#3d405b', cloud: '#c9c5b8' },
    night: { sky: '#3d405b', ink: '#f2f2ea', ground: '#f2f2ea', cloud: '#6b6e8c' }
  };
  let night = false;

  // ---- 游戏状态 ----
  const STATE = { READY: 0, RUN: 1, OVER: 2, PAUSE: 3 };
  let state = STATE.READY;

  let score = 0;
  let high = Number(localStorage.getItem('dinoHighScore') || 0);
  let speed = 6;
  let distance = 0;
  let lastTime = 0;
  let nightAt = 0;

  // ---- 小恐龙 ----
  const dino = {
    x: 60, y: GROUND_Y - 44, w: 44, h: 44,
    vy: 0, onGround: true, ducking: false, frame: 0, frameT: 0
  };

  // ---- 障碍物 ----
  let obstacles = [];
  let spawnTimer = 0;
  let clouds = [];
  let stars = [];

  function makeClouds() {
    clouds = [];
    for (let i = 0; i < 4; i++) {
      clouds.push({ x: Math.random() * W, y: 20 + Math.random() * 60, s: 0.4 + Math.random() * 0.5 });
    }
  }
  function makeStars() {
    stars = [];
    for (let i = 0; i < 18; i++) {
      stars.push({ x: Math.random() * W, y: 15 + Math.random() * 90, r: Math.random() * 1.4 + 0.4 });
    }
  }
  makeClouds(); makeStars();

  // ---- 简易音效（WebAudio，无需文件）----
  let actx = null;
  function beep(freq, dur, type) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.06, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* 忽略音频错误 */ }
  }

  // ---- 输入 ----
  function jump() {
    if (state === STATE.READY) { start(); }
    if (state === STATE.OVER) { reset(); start(); }
    if (state === STATE.RUN && dino.onGround) {
      dino.vy = -11.2;
      dino.onGround = false;
      dino.ducking = false;
      beep(520, 0.12, 'square');
    }
  }
  function setDuck(on) {
    if (state === STATE.RUN) dino.ducking = on && dino.onGround;
  }
  function togglePause() {
    if (state === STATE.RUN) { state = STATE.PAUSE; showOverlay('已暂停', '按 P 继续'); }
    else if (state === STATE.PAUSE) { state = STATE.RUN; hideOverlay(); lastTime = performance.now(); }
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); jump(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); setDuck(true); }
    else if (e.code === 'KeyP') { togglePause(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') setDuck(false);
  });
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); jump(); });
  canvas.addEventListener('pointerup', () => setDuck(false));
  canvas.addEventListener('pointerleave', () => setDuck(false));
  // 触屏按住下半区下蹲
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    if (e.clientY - r.top > r.height * 0.6) setDuck(true);
  });
  overlay.addEventListener('pointerdown', (e) => { e.preventDefault(); jump(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === STATE.RUN) togglePause();
  });

  // ---- 障碍物生成 ----
  function spawn() {
    const roll = Math.random();
    const hard = score > 400;
    if (hard && roll < 0.28) {
      // 翼龙：高（需下蹲）/ 低（需跳跃）
      const low = Math.random() < 0.5;
      const y = low ? GROUND_Y - 34 : GROUND_Y - 78;
      obstacles.push({ type: 'bird', x: W + 20, y, w: 46, h: 30, wing: 0, wingT: 0 });
    } else {
      const big = Math.random() < 0.35;
      const cluster = !big && Math.random() < 0.3 ? (1 + (Math.random() < 0.5 ? 1 : 0)) : 1;
      const cw = big ? 24 : 16;
      const ch = big ? 50 : 36;
      for (let i = 0; i < cluster; i++) {
        obstacles.push({
          type: 'cactus', x: W + 20 + i * (cw + 6),
          y: GROUND_Y - ch, w: cw, h: ch
        });
      }
    }
  }

  // ---- 碰撞 ----
  function hit(a, b, pad) {
    const p = pad || 0;
    return a.x + p < b.x + b.w - p &&
           a.x + a.w - p > b.x + p &&
           a.y + p < b.y + b.h - p &&
           a.y + a.h - p > b.y + p;
  }

  function dinoBox() {
    if (dino.ducking) return { x: dino.x, y: GROUND_Y - 28, w: 54, h: 28 };
    return { x: dino.x + 4, y: dino.y, w: dino.w - 6, h: dino.h };
  }

  // ---- 更新 ----
  function update(dt) {
    distance += speed;
    score = Math.floor(distance / 10);
    speed = Math.min(13, 6 + score / 220);   // 随分数加速

    // 昼夜切换
    if (score >= nightAt + 700) {
      night = !night;
      nightAt = score;
      document.querySelector('.stage').style.background = night ? '#3d405b' : '#fbfbf7';
    }

    // 恐龙物理
    dino.vy += 0.6;
    dino.y += dino.vy;
    if (dino.y >= GROUND_Y - dino.h) { dino.y = GROUND_Y - dino.h; dino.vy = 0; dino.onGround = true; }
    // 跑步腿部动画
    dino.frameT += dt;
    if (dino.frameT > 90) { dino.frame ^= 1; dino.frameT = 0; }

    // 云
    clouds.forEach(c => { c.x -= c.s * speed * 0.25; if (c.x < -40) { c.x = W + 20; c.y = 20 + Math.random() * 60; } });

    // 障碍物
    spawnTimer -= dt;
    const gap = Math.max(620, 1400 - score * 1.2);
    if (spawnTimer <= 0) { spawn(); spawnTimer = gap + Math.random() * 400; }
    for (const o of obstacles) {
      o.x -= speed;
      if (o.type === 'bird') { o.wingT += dt; if (o.wingT > 120) { o.wing ^= 1; o.wingT = 0; } }
    }
    obstacles = obstacles.filter(o => o.x + o.w > -10);

    // 碰撞检测
    const box = dinoBox();
    for (const o of obstacles) {
      if (hit(box, o, 4)) { gameOver(); break; }
    }
  }

  function gameOver() {
    state = STATE.OVER;
    if (score > high) { high = score; localStorage.setItem('dinoHighScore', high); }
    beep(160, 0.4, 'sawtooth');
    showOverlay('游戏结束', `得分 ${score} · 最高 ${high}　按 空格 重来`);
  }

  // ---- 绘制 ----
  function drawGround(theme) {
    ctx.strokeStyle = theme.ground;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 1);
    ctx.lineTo(W, GROUND_Y + 1);
    ctx.stroke();
    // 滚动沙点
    ctx.fillStyle = theme.ground;
    const off = (distance * 0.5) % 40;
    for (let x = -off; x < W; x += 40) {
      ctx.fillRect(x, GROUND_Y + 8, 14, 2);
    }
  }

  function drawCloud(c, theme) {
    ctx.fillStyle = theme.cloud;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
    ctx.arc(c.x + 12, c.y + 2, 13, 0, Math.PI * 2);
    ctx.arc(c.x + 26, c.y, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDino(theme) {
    ctx.fillStyle = theme.ink;
    const x = dino.x, y = dino.y;
    if (dino.ducking) {
      // 下蹲形态
      ctx.fillRect(x, y + 18, 56, 18);     // 身体
      ctx.fillRect(x + 44, y + 4, 26, 22); // 头
      ctx.fillRect(x + 66, y + 10, 8, 8);  // 嘴
      ctx.fillStyle = theme.sky;
      ctx.fillRect(x + 60, y + 8, 5, 5);   // 眼
      ctx.fillStyle = theme.ink;
      const ly = (dino.frame ? y + 36 : y + 34);
      ctx.fillRect(x + 8, ly, 10, 6);
      ctx.fillRect(x + 30, ly, 10, 6);
    } else {
      ctx.fillRect(x, y + 18, 22, 26);       // 身体
      ctx.fillRect(x + 18, y - 2, 26, 24);   // 头
      ctx.fillRect(x + 40, y + 4, 10, 14);   // 吻
      ctx.fillRect(x - 8, y + 26, 12, 6);    // 尾巴
      // 腿（两帧动画）
      if (!dino.onGround) {
        ctx.fillRect(x + 4, y + 44, 10, 8);
        ctx.fillRect(x + 22, y + 44, 10, 8);
      } else if (dino.frame === 0) {
        ctx.fillRect(x + 4, y + 44, 10, 8);
        ctx.fillRect(x + 26, y + 40, 10, 8);
      } else {
        ctx.fillRect(x + 6, y + 40, 10, 8);
        ctx.fillRect(x + 24, y + 44, 10, 8);
      }
      ctx.fillStyle = theme.sky;
      ctx.fillRect(x + 38, y + 8, 5, 5);     // 眼
    }
  }

  function drawCactus(o, theme) {
    ctx.fillStyle = theme.ink;
    const x = o.x, y = o.y, w = o.w, h = o.h;
    ctx.fillRect(x + w / 2 - 4, y, 8, h);          // 主干
    ctx.fillRect(x, y + h * 0.4, 6, h * 0.3);      // 左臂
    ctx.fillRect(x, y + h * 0.4, 4, -h * 0.18 + 8);
    ctx.fillRect(x + w - 6, y + h * 0.55, 6, h * 0.25);
    ctx.fillRect(x + w - 6, y + h * 0.55, 4, -h * 0.18 + 6);
  }

  function drawBird(o, theme) {
    ctx.fillStyle = theme.ink;
    const x = o.x, y = o.y;
    ctx.fillRect(x + 8, y + 12, 28, 8);          // 身体
    ctx.fillRect(x + 30, y + 6, 14, 8);          // 头
    ctx.fillRect(x + 40, y + 9, 8, 5);           // 嘴
    ctx.fillStyle = theme.sky;
    ctx.fillRect(x + 36, y + 8, 4, 4);           // 眼
    ctx.fillStyle = theme.ink;
    // 翅膀（两帧）
    if (o.wing === 0) {
      ctx.fillRect(x + 12, y, 18, 8);
      ctx.fillRect(x + 14, y + 20, 18, 8);
    } else {
      ctx.fillRect(x + 12, y + 6, 18, 8);
    }
  }

  function drawScore(theme) {
    ctx.fillStyle = theme.ink;
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.textAlign = 'right';
    const s = String(score).padStart(5, '0');
    const h = String(high).padStart(5, '0');
    ctx.fillText('HI ' + h, W - 16, 26);
    ctx.fillText(s, W - 16, 48);
    ctx.textAlign = 'left';
  }

  function render() {
    const theme = night ? THEMES.night : THEMES.day;
    ctx.fillStyle = theme.sky;
    ctx.fillRect(0, 0, W, H);

    if (night) { stars.forEach(st => { ctx.fillStyle = '#f2f2ea'; ctx.fillRect(st.x, st.y, st.r, st.r); }); }
    else clouds.forEach(c => drawCloud(c, theme));

    drawGround(theme);
    obstacles.forEach(o => o.type === 'cactus' ? drawCactus(o, theme) : drawBird(o, theme));
    drawDino(theme);
    drawScore(theme);
  }

  // ---- 主循环 ----
  function loop(t) {
    const dt = Math.min(40, t - lastTime);
    lastTime = t;
    if (state === STATE.RUN) update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---- 覆盖层 ----
  function showOverlay(big, sub) {
    overlay.querySelector('.big').textContent = big;
    overlay.querySelector('.sub').textContent = sub;
    overlay.classList.remove('hidden');
  }
  function hideOverlay() { overlay.classList.add('hidden'); }

  function start() { state = STATE.RUN; hideOverlay(); lastTime = performance.now(); }
  function reset() {
    score = 0; speed = 6; distance = 0; night = false; nightAt = 0;
    obstacles = []; spawnTimer = 400;
    dino.y = GROUND_Y - dino.h; dino.vy = 0; dino.onGround = true; dino.ducking = false;
    document.querySelector('.stage').style.background = '#fbfbf7';
  }

  requestAnimationFrame(loop);
})();
