/* ============================================================
   暗影传说 - Shadow Legend
   一个融合 Roguelike 元素的 2D 动作 RPG
   玩法元素: 实时战斗 / 闪避冲刺 / 随机词条装备 /
            程序生成关卡 / 多阶段 Boss / 永久升级 / NPC 任务
   ============================================================ */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// ============================================================
// 工具
// ============================================================
const rand = (a, b) => Math.random() * (b - a) + a;
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const choose = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

let shakeFrames = 0, shakeMag = 0;
function shake(mag, frames = 10) { shakeFrames = frames; shakeMag = mag; }

// ============================================================
// 顿帧 (Hit Stop) —— 命中瞬间的短暂定格
// ============================================================
// —— 为什么需要 ——
// 动作游戏的"打击感"很大一部分来自命中那一瞬间的「时间变慢」：
// 玩家的输入被短暂接管，敌人的动作被冻结，注意力被强制聚焦到受击点。
// 原版完全没有这个机制，命中只是掉血 + 几个粒子，观感很"飘"。
//
// 实现：在主循环里，若 hitStop > 0 则跳过 update 阶段（只渲染），
// 相当于游戏在那一瞬间按了暂停键。
let hitStop = 0;
// 顿帧类型 → 持续帧数。暴击更久，击杀更久，玩家受击最久。
const HITSTOP = {
  hit: 3,        // 普通命中：3 帧（50ms）
  crit: 7,       // 暴击：7 帧（117ms）
  kill: 9,       // 击杀：9 帧（150ms）
  playerHurt: 8  // 玩家受击：8 帧（133ms）
};
function addHitStop(frames) {
  // 取最大值而非累加 —— 连续命中时不该无限叠加成卡顿
  hitStop = Math.max(hitStop, frames);
}

function spawnDamageNum(x, y, text, color = '#fff') {
  const el = document.createElement('div');
  el.className = 'damage-num';
  el.textContent = text;
  el.style.left = (x - camera.x + W/2) + 'px';
  el.style.top = (y - camera.y + H/2) + 'px';
  el.style.color = color;
  el.style.fontSize = '20px';
  document.getElementById('damage-numbers').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// ============================================================
// 音效 (使用 WebAudio)
// ============================================================
let audioCtx = null;
function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {}
}
function playSound(type) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  if (type === 'hit') {
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.start(now); osc.stop(now + 0.1);
  } else if (type === 'kill') {
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.3);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.start(now); osc.stop(now + 0.3);
  } else if (type === 'skill') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.2);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  } else if (type === 'levelup') {
    const freqs = [400, 500, 600, 800];
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.frequency.setValueAtTime(f, now + i*0.08);
      g.gain.setValueAtTime(0.15, now + i*0.08);
      g.gain.exponentialRampToValueAtTime(0.001, now + i*0.08 + 0.15);
      o.start(now + i*0.08); o.stop(now + i*0.08 + 0.15);
    });
    return;
  } else if (type === 'pickup') {
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now); osc.stop(now + 0.15);
  } else if (type === 'hurt') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.2);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  } else if (type === 'dash') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.1);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.start(now); osc.stop(now + 0.1);
  }
}

// ============================================================
// 输入
// ============================================================
const keys = {};
const mouse = { x: W/2, y: H/2, down: false };
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k))
    e.preventDefault();
  // 调试快捷键
  if (k === 'f3') { window.__showHitbox = !window.__showHitbox; e.preventDefault(); }
  if (k === 'f4') { window.__showTileGrid = !window.__showTileGrid; e.preventDefault(); }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
});
canvas.addEventListener('mousedown', () => mouse.down = true);
canvas.addEventListener('mouseup', () => mouse.down = false);

// ============================================================
// 摄像机
// ============================================================
const camera = { x: 0, y: 0 };

// ============================================================
// 世界
// ============================================================
const TILE = 64;
const WORLD_W = 80, WORLD_H = 60;

let worldMap = [];
let decorations = [];
let chests = [];
let enemies = [];
window.enemies = enemies;  // 调试/截图脚本用
let npcs = [];
let particles = [];
let projectiles = [];
let pickups = [];
const ROOMS = [];

function generateWorld() {
  worldMap = Array.from({length: WORLD_H}, () => new Array(WORLD_W).fill(0));
  decorations.length = 0;
  chests.length = 0;
  enemies.length = 0;
  npcs.length = 0;
  particles.length = 0;
  projectiles.length = 0;
  pickups.length = 0;
  ROOMS.length = 0;

  const roomCount = 9;
  const placed = [];
  let attempts = 0;
  while (placed.length < roomCount && attempts < 300) {
    attempts++;
    const rw = randInt(9, 14);
    const rh = randInt(6, 10);
    const rx = randInt(2, WORLD_W - rw - 2);
    const ry = randInt(2, WORLD_H - rh - 2);
    const overlap = placed.some(p =>
      rx < p.x + p.w + 4 && rx + rw + 4 > p.x &&
      ry < p.y + p.h + 4 && ry + rh + 4 > p.y
    );
    if (overlap) continue;
    const role = placed.length === 0 ? 'start' :
                 (placed.length === roomCount - 1 ? 'boss' : 'normal');
    placed.push({ x: rx, y: ry, w: rw, h: rh, type: role });
    for (let y = ry; y < ry + rh; y++)
      for (let x = rx; x < rx + rw; x++)
        if (worldMap[y]) worldMap[y][x] = 1;
  }

  for (let i = 1; i < placed.length; i++) {
    const a = placed[i-1], b = placed[i];
    const ax = Math.floor(a.x + a.w/2), ay = Math.floor(a.y + a.h/2);
    const bx = Math.floor(b.x + b.w/2), by = Math.floor(b.y + b.h/2);
    if (Math.random() < 0.5) { carveH(ax, bx, ay); carveV(ay, by, bx); }
    else { carveV(ay, by, ax); carveH(ax, bx, by); }
  }

  const start = placed[0];
  npcs.push({
    x: (start.x + Math.floor(start.w/2) - 2) * TILE,
    y: (start.y + 2) * TILE,
    name: '村长', color: '#e67e22',
    dialog: [
      '勇者啊，欢迎来到这片被诅咒的土地...',
      '暗影之王占据了北方的城堡，击败他！',
      '村庄有商店可以补给，森林藏着宝箱。',
      '愿光明与你同在！'
    ],
    reward: () => { player.gold += 50; pickups.push(makePickup(player.x, player.y - 40, 'potion')); }
  });
  npcs.push({
    x: (start.x + Math.floor(start.w/2) + 2) * TILE,
    y: (start.y + 2) * TILE,
    name: '商人', color: '#f1c40f', isShop: true,
    // 价格文案必须与 showShop() 里的 SHOP_PRICES 一致
    dialog: ['欢迎光临！输入数字购买：\n[1] 治疗药水 30金\n[2] 魔法药水 40金\n[3] 随机武器 120金\n[4] 随机护甲 100金\n[5] 退出']
  });

  for (let i = 1; i < placed.length - 1; i++) {
    const r = placed[i];
    // 难度分段：越靠近 Boss 的房间，敌人越强
    // tier = 房间序号在「战斗房」中的进度（0 → 1），随进度线性提升属性
    const battleRooms = placed.length - 2;          // 去掉起始房和 Boss 房
    const tier = battleRooms > 0 ? (i - 1) / (battleRooms - 1) : 0;
    // 精英出现率随进度上升：房1 约 0~1 只，房7 约 3~4 只
    // （原先固定 0.3，改成随 tier 上升后又出现「早期房间全是精英、强度反超后期」的倒挂，
    //   现在早期少、后期多，难度才是单调递增的）
    // 数量：固定 4 只/房（随机 3~6 是难度曲线最大的方差源，已去掉）
    // —— 难度分段设计 ——
    // 目标：每间战斗房的「威胁值」随进度单调上升，不能忽高忽低。
    // 之前的两个方差源都去掉了：
    //   ① 敌人数量随机 3~6 只 → 改成固定 4 只（数量是最大的方差来源）
    //   ② 精英逐只随机 → 改成按 tier 递增的「精英数量」（房1: 0~1 只，房7: 3~4 只）
    // 现在威胁值 ≈ (4 - 精英数) × 小怪HP + 精英数 × 精英HP，再乘 tier 缩放，
    // 曲线平滑递增，同时保留了「精英怪出现」的随机感。
    const EC_PER_ROOM = 4;
    // 精英数量按 tier 递增（房1: 0, 房4: 2, 房7: 4）—— 去掉 ±1 随机，
    // 相邻房间的威胁值就只会单调上升，不会忽高忽低。
    const eliteCount = Math.min(EC_PER_ROOM, Math.round(tier * EC_PER_ROOM));
    const eliteSet = new Set();
    while (eliteSet.size < eliteCount) eliteSet.add(randInt(0, EC_PER_ROOM - 1));
    for (let k = 0; k < EC_PER_ROOM; k++) {
      const ex = (r.x + randInt(1, r.w - 2)) * TILE;
      const ey = (r.y + randInt(1, r.h - 2)) * TILE;
      const e = makeEnemy(ex, ey, eliteSet.has(k) ? 'elite' : 'normal');
      // 按分段提升敌人属性（生命 +0~70%、攻击 +0~40%、经验同比例）
      scaleEnemy(e, tier);
      // 难度调整（在 tier 缩放之后、词缀之前）
      applyDifficultyToEnemy(e);
      // 精英怪挂词缀（在缩放之后 —— 词缀的 apply 会改属性，顺序有讲究）
      rollEliteAffix(e, tier);
      enemies.push(e);
    }
    if (Math.random() < 0.6) {
      // 宝箱稀有度分布：40%普通 / 30%优秀 / 20%稀有 / 10%史诗
      const roll = Math.random();
      const rarity = roll < 0.10 ? 'epic' :
                     roll < 0.30 ? 'rare' :
                     roll < 0.60 ? 'uncommon' : 'common';
      chests.push({
        x: (r.x + randInt(1, r.w - 2)) * TILE,
        y: (r.y + randInt(1, r.h - 2)) * TILE,
        opened: false,
        rarity,
        type: 'normal'
      });
    }
    for (let k = 0; k < randInt(3, 6); k++) {
      const dx = (r.x + randInt(1, r.w - 2)) * TILE;
      const dy = (r.y + randInt(1, r.h - 2)) * TILE;
      if (!isBlocked(dx, dy, 32, 32)) {
        decorations.push({ x: dx, y: dy, type: choose(['grass', 'grass', 'rock', 'skull', 'mushroom']) });
      }
    }
  }

  const bossRoom = placed[placed.length - 1];
  enemies.push(makeEnemy(
    (bossRoom.x + bossRoom.w/2) * TILE - 18,
    (bossRoom.y + bossRoom.h/2) * TILE - 24,
    'boss'
  ));
  for (let k = 0; k < 8; k++) {
    decorations.push({
      x: (bossRoom.x + randInt(1, bossRoom.w - 2)) * TILE,
      y: (bossRoom.y + randInt(1, bossRoom.h - 2)) * TILE,
      type: 'pillar'
    });
  }
  // Boss 房专属金色传说宝箱 — 击败 Boss 后才能开启
  chests.push({
    x: (bossRoom.x + bossRoom.w/2 + 3) * TILE,
    y: (bossRoom.y + bossRoom.h - 3) * TILE,
    opened: false,
    rarity: 'legendary',
    type: 'boss',
    requiresBoss: true
  });

  ROOMS.push(...placed);
  // 玩家位置
  player.x = (start.x + Math.floor(start.w/2)) * TILE;
  player.y = (start.y + Math.floor(start.h/2)) * TILE;
}

function carveH(x1, x2, y) {
  // 走廊宽度 3 格 (y-1, y, y+1)
  for (let y0 = y - 1; y0 <= y + 1; y0++)
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
      if (worldMap[y0] && worldMap[y0][x] !== undefined) worldMap[y0][x] = 1;
}
function carveV(y1, y2, x) {
  // 走廊宽度 3 格 (x-1, x, x+1)
  for (let x0 = x - 1; x0 <= x + 1; x0++)
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
      if (worldMap[y] && worldMap[y][x0] !== undefined) worldMap[y][x0] = 1;
}

function isBlocked(x, y, w, h) {
  const corners = [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]];
  for (const [cx, cy] of corners) {
    const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE);
    if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return true;
    if (worldMap[ty][tx] === 0) return true;
  }
  return false;
}

// 双向推开两个实体（沿最小重叠方向，各推一半）
function separate(a, b) {
  const cx = a.x + a.w/2, cy = a.y + a.h/2;
  const ex = b.x + b.w/2, ey = b.y + b.h/2;
  const dx = cx - ex, dy = cy - ey;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > ay) {
    const ox = (a.w + b.w)/2 - ax + 1;
    const sx = dx > 0 ? 1 : -1;
    // 各推一半
    a.x += sx * ox * 0.5;
    b.x -= sx * ox * 0.5;
    // 若一侧撞墙，把对方推开全部
    if (isBlocked(a.x, a.y, a.w, a.h)) {
      a.x -= sx * ox * 0.5;
      if (!isBlocked(b.x - sx * ox, b.y, b.w, b.h)) b.x -= sx * ox;
    } else if (isBlocked(b.x, b.y, b.w, b.h)) {
      b.x += sx * ox * 0.5;
      if (!isBlocked(a.x + sx * ox, a.y, a.w, a.h)) a.x += sx * ox;
    }
  } else {
    const oy = (a.h + b.h)/2 - ay + 1;
    const sy = dy > 0 ? 1 : -1;
    a.y += sy * oy * 0.5;
    b.y -= sy * oy * 0.5;
    if (isBlocked(a.x, a.y, a.w, a.h)) {
      a.y -= sy * oy * 0.5;
      if (!isBlocked(b.x, b.y - sy * oy, b.w, b.h)) b.y -= sy * oy;
    } else if (isBlocked(b.x, b.y, b.w, b.h)) {
      b.y += sy * oy * 0.5;
      if (!isBlocked(a.x, a.y + sy * oy, a.w, a.h)) a.y += sy * oy;
    }
  }
}

// ============================================================
// 实体
// ============================================================
class Entity {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.hp = 100; this.maxHp = 100;
    this.mp = 50; this.maxMp = 50;
    this.atk = 10; this.def = 5;
    this.alive = true;
    this.invuln = 0;
    this.animTime = 0;
    this.hitFlash = 0;      // 受击白闪（敌人被打时用）
    this.hurtFlash = 0;     // 玩家受击红闪（与白闪区分）
  }
  takeDamage(dmg, fromX, fromY) {
    if (this.invuln > 0 || !this.alive) return 0;
    // 防御减免：玩家走 totalDef（含装备护甲/头盔/词条），敌人走自身 def
    const defStat = (this instanceof Player) ? this.totalDef : this.def;
    const actual = Math.max(1, dmg - defStat * 0.3);
    this.hp -= actual;
    this.hitFlash = 8;
    // 无敌帧：玩家更长（20 帧 ≈ 0.33s），避免被小怪围殴到没有还手余地
    const isPlayer = this instanceof Player;
    this.invuln = isPlayer ? 20 : 8;
    if (fromX !== undefined) {
      // 击退：玩家被击退的力度更大（要能"被撞开"），敌人被击退力度略小
      // —— 原来两者都是 80，玩家被小怪顶住时几乎推不动，挨打没有位移感 ——
      const knock = isPlayer ? 190 : 110;
      const dx = this.x + this.w/2 - fromX;
      const dy = this.y + this.h/2 - fromY;
      const d = Math.hypot(dx, dy) || 1;
      this.vx += (dx/d) * knock;
      this.vy += (dy/d) * knock;
    }
    spawnDamageNum(this.x + this.w/2, this.y, Math.floor(actual).toString(), '#ff4444');
    if (isPlayer) {
      // —— 玩家受击反馈 ——
      // 原版：只有音效 + 伤害数字，远程弹命中连震屏都没有，完全没有"被击中"的感知
      playSound('hurt');
      shake(7, 8);                       // 震屏（远近统一，近战原本有 4/6，这里加强）
      addHitStop(HITSTOP.playerHurt);    // 顿帧
      this.hurtFlash = 12;               // 红闪（与 hitFlash 的白闪区分开）
      // 血光粒子
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        particles.push(new Particle(
          this.x + this.w/2, this.y + this.h/2,
          Math.cos(a) * 4, Math.sin(a) * 4,
          '#ff4444', 22, 4));
      }
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.onDeath && this.onDeath();
    }
    return actual;
  }
  update() {
    this.animTime++;
    if (this.invuln > 0) this.invuln--;
    if (this.hitFlash > 0) this.hitFlash--;
    if (this.hurtFlash > 0) this.hurtFlash--;
    // 应用 knockback/dash 速度。撞墙立即清零，避免卡墙
    if (Math.abs(this.vx) > 0.05) {
      const nx = this.x + this.vx;
      if (!isBlocked(nx, this.y, this.w, this.h)) this.x = nx;
      else this.vx = 0;
    }
    if (Math.abs(this.vy) > 0.05) {
      const ny = this.y + this.vy;
      if (!isBlocked(this.x, ny, this.w, this.h)) this.y = ny;
      else this.vy = 0;
    }
    this.vx *= 0.7; this.vy *= 0.7;
    if (Math.abs(this.vx) < 0.05) this.vx = 0;
    if (Math.abs(this.vy) < 0.05) this.vy = 0;
  }

  // 实体间软推开：玩家主动推开敌人，敌人互相也分开
  // 但不让敌人把玩家挤回去 — 玩家始终可以自由移动
  static resolveCollisions() {
    // 玩家已死亡：不再与敌人做碰撞分离（避免尸体被推得乱跑）
    if (!player.alive) {
      // 仅处理敌人之间互相推开
      const aliveEnemies = enemies.filter(e => e.alive);
      for (let i = 0; i < aliveEnemies.length; i++) {
        for (let j = i + 1; j < aliveEnemies.length; j++) {
          const a = aliveEnemies[i], b = aliveEnemies[j];
          if (aabb(a, b)) separate(a, b);
        }
      }
      return;
    }
    // 玩家 vs 敌人：优先推敌人；若敌人一侧撞墙，则反过来推玩家（避免双向卡死）
    for (const e of enemies) {
      if (!e.alive) continue;
      if (!aabb(player, e)) continue;
      const cx = player.x + player.w/2, cy = player.y + player.h/2;
      const ex = e.x + e.w/2, ey = e.y + e.h/2;
      const dx = cx - ex, dy = cy - ey;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      let pushed = false;
      if (ax > ay) {
        const ox = (player.w + e.w)/2 - ax + 2;
        const sx = dx > 0 ? 1 : -1;
        const tryX = e.x + sx * ox;
        if (!isBlocked(tryX, e.y, e.w, e.h)) {
          e.x = tryX;
          pushed = true;
        }
      } else {
        const oy = (player.h + e.h)/2 - ay + 2;
        const sy = dy > 0 ? 1 : -1;
        const tryY = e.y + sy * oy;
        if (!isBlocked(e.x, tryY, e.w, e.h)) {
          e.y = tryY;
          pushed = true;
        }
      }
      // 若敌人推不动（撞墙/角落），把玩家往反方向推一小段，避免两者持续重叠
      if (!pushed) {
        if (ax > ay) {
          const sx = dx > 0 ? 1 : -1;
          const tryPX = player.x - sx * 2;
          if (!isBlocked(tryPX, player.y, player.w, player.h)) {
            player.x = tryPX;
          }
        } else {
          const sy = dy > 0 ? 1 : -1;
          const tryPY = player.y - sy * 2;
          if (!isBlocked(player.x, tryPY, player.w, player.h)) {
            player.y = tryPY;
          }
        }
      }
    }
    // 敌人之间互相推开（双向，各推一半）
    const aliveEnemies = enemies.filter(e => e.alive);
    for (let i = 0; i < aliveEnemies.length; i++) {
      for (let j = i + 1; j < aliveEnemies.length; j++) {
        const a = aliveEnemies[i], b = aliveEnemies[j];
        if (aabb(a, b)) separate(a, b);
      }
    }
  }
  moveWithCollision(dx, dy) {
    // 先尝试完整移动；若任一轴被墙挡，则用"沿墙滑动"策略
    // 让斜方向移动在墙边能继续滑（避免卡墙角）
    if (dx === 0 && dy === 0) return;
    const wantX = this.x + dx;
    const wantY = this.y + dy;
    const canX = !isBlocked(wantX, this.y, this.w, this.h);
    const canY = !isBlocked(this.x, wantY, this.w, this.h);
    if (canX && canY) {
      this.x = wantX;
      this.y = wantY;
      return;
    }
    // 沿墙滑动：分别尝试单个轴，避免撞墙瞬间完全停下
    if (canX) this.x = wantX;
    if (canY) this.y = wantY;
    // 如果两个轴都失败，尝试更小的步长进一步接近（避免卡在窄缝）
    if (!canX && !canY) {
      const sub = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 2));
      const stepX = dx === 0 ? 0 : Math.sign(dx);
      const stepY = dy === 0 ? 0 : Math.sign(dy);
      // 沿对角线一小步一小步逼近（最多 4 步）
      for (let s = 1; s <= 4; s++) {
        const k = s / 4;
        const tnx = this.x + stepX * sub * k;
        const tny = this.y + stepY * sub * k;
        if (!isBlocked(tnx, tny, this.w, this.h)) {
          this.x = tnx;
          this.y = tny;
          return;
        }
        // 单轴尝试
        if (!isBlocked(tnx, this.y, this.w, this.h)) this.x = tnx;
        if (!isBlocked(this.x, tny, this.w, this.h)) this.y = tny;
        if (this.x !== tnx || this.y !== tny) return;
      }
    }
  }
  draw() {
    ctx.save();
    // 应用摄像机偏移：所有实体在屏幕坐标 = 世界坐标 - camera
    ctx.translate(-camera.x, -camera.y);
    const isPlayer = this instanceof Player;
    // —— 受击视觉 ——
    // 敌人受击：白闪（brightness）
    // 玩家受击：红闪（hue 偏移到红色），一眼能分辨"我被打"和"我打中了"
    if (this.hitFlash > 0) ctx.filter = 'brightness(2.5)';
    else if (this.hurtFlash > 0) ctx.filter = 'sepia(1) saturate(8) hue-rotate(-40deg) brightness(1.4)';
    // 冰冻状态：整体偏蓝，一眼能看出自己被减速了
    else if (isPlayer && this.slowTimer > 0) ctx.filter = 'hue-rotate(170deg) saturate(1.6) brightness(1.1)';
    // —— 无敌帧闪烁 ——
    // 玩家有 20 帧无敌帧，原版完全看不出来 → 玩家不知道自己"现在打不到"
    // 用半透明闪烁提示：无敌期间每 3 帧闪一次
    if (isPlayer && this.invuln > 0 && this.animTime % 4 < 2) {
      ctx.globalAlpha = 0.45;
    }
    this.drawSprite();
    ctx.globalAlpha = 1;
    ctx.restore();
    // 血条跟随相机（在屏幕空间绘制）
    // 玩家用 totalMaxHp（含装备加血），否则装备加血后血条比例会画错
    const hpMax = isPlayer ? this.totalMaxHp : this.maxHp;
    if (this.hp < hpMax) {
      const bx = this.x + this.w/2 - this.w/2 - camera.x, by = this.y - 10 - camera.y;
      ctx.fillStyle = '#000'; ctx.fillRect(bx, by, this.w, 4);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(bx, by, this.w * (this.hp / hpMax), 4);
    }
  }
  drawSprite() {}
}

// ============================================================
// 玩家 (Player) - 完整版本
// ============================================================
class Player extends Entity {
  constructor(x, y) {
    super(x, y, 48, 64);
    this.maxHp = 120; this.hp = 120;
    this.maxMp = 60; this.mp = 60;
    this.atk = 12; this.def = 5;
    this.speed = 3.4;
    this.level = 1;
    this.exp = 0; this.expToNext = 60;
    this.gold = 0;
    // 技能数值：CD 与耗蓝都下调（原 CD 太长、耗蓝太高，技能大部分时间在转冷却）
    this.skills = {
      attack: { cd: 0, maxCd: 14, name: '斩击' },
      fireball: { cd: 0, maxCd: 60, name: '火球', cost: 12 },
      ice: { cd: 0, maxCd: 75, name: '冰锥', cost: 15 },
      thunder: { cd: 0, maxCd: 100, name: '闪电', cost: 22 },
      heal: { cd: 0, maxCd: 120, name: '治疗', cost: 20 }
    };
    // 背包容量：16 格（原 8 格太小，装几件就满，满时旧行为会吞装备）
    this.inventory = new Array(16).fill(null);
    this.equipped = { weapon: null, armor: null, head: null, gloves: null, boots: null, amulet: null };
    this.dashCd = 0;
    this.attackAnim = 0;
    this.swordWobble = 0;       // 挥剑后剑尖残留抖动强度 [0, 1]，每帧衰减
    this.swordWobblePhase = 0;  // 抖动相位（高频正弦用）
    this.comboCount = 0;
    this.comboTimer = 0;
    this.totalKills = 0;
    this.totalGold = 0;
    // —— 战斗派生属性（由装备/升级面板提供）——
    // crit: 暴击率 %；lifesteal: 吸血 %；cdr: 冷却缩减 %
    // 这三个原本只在升级面板里存着、战斗从不读取，现已接入下方 total* 计算
    this.crit = 0;
    this.lifesteal = 0;
    this.cdr = 0;
    // 冰冻减速：被冰冻词缀的精英怪命中后短暂减速
    this.slowTimer = 0;
    // —— 二维朝向 ——
    // dirX/dirY: 朝向单位方向的符号(-1/0/1)，组合出 8 个方向
    //   dirY < 0 → 朝上（背面视图，看不到脸）
    //   dirY > 0 → 朝下（正面视图，脸朝镜头）
    //   dirY = 0 → 朝左/朝右（侧身视图）
    // facing 保留：供侧身绘制与旧逻辑使用
    this.dirX = 1;
    this.dirY = 0;
  }

  // ============================================================
  // 战斗属性：基础值 + 装备加成
  // —— 所有战斗读数都必须走这里，否则装备属性就是死的 ——
  // ============================================================
  get bonus() {
    // 缓存 + 自动失效：用「装备槽位引用」做指纹，侦测到任何穿脱/替换就重算。
    // 这样即使某条路径忘了调 invalidateBonus()，属性也不会算错。
    const sig = EQUIP_SLOTS.map(s => this.equipped[s] ? this.equipped[s].name + '#' + (this.equipped[s].affixes||[]).length : '-').join('|');
    if (this._bonusCache === null || this._bonusSig !== sig) {
      this._bonusCache = getEquippedBonus();
      this._bonusSig = sig;
    }
    return this._bonusCache;
  }
  invalidateBonus() { this._bonusCache = null; this._bonusSig = null; }

  // —— 套装百分比 ——
  // 套装百分比统一作用在「基础 + 装备」的**总量**上。
  // 若只作用在装备那部分，玩家基础 120 血不会受益，"生命 +30%" 实际只加几十点，
  // 看起来像没生效 —— 这是设计套装时最容易踩的坑。
  get setPct() { return getActiveSetBonuses(); }

  get totalAtk()    { return Math.round((this.atk + this.bonus.atk) * (1 + (this.setPct.atkPct || 0) / 100)); }
  get totalDef()    { return Math.round((this.def + this.bonus.def) * (1 + (this.setPct.defPct || 0) / 100)); }
  get totalSpeed()  {
    const base = (this.speed + this.bonus.speed) * (1 + (this.setPct.speedPct || 0) / 100);
    return Math.round(base * 10) / 10 * this.slowFactor;
  }
  // 冰冻减速系数：被冰冻时移速降 45%
  get slowFactor() { return this.slowTimer > 0 ? 0.55 : 1; }
  // 生命/魔法上限：基础 + 装备，再乘套装百分比
  get totalMaxHp()  {
    const base = this.maxHp + this.bonus.hp;
    return Math.round(base * (1 + (this.setPct.hpPct || 0) / 100));
  }
  get totalMaxMp()  {
    const base = this.maxMp + this.bonus.mp;
    return Math.round(base * (1 + (this.setPct.mpPct || 0) / 100));
  }
  get totalCrit()   { return (this.crit || 0) + this.bonus.crit; }
  get totalLifesteal() { return (this.lifesteal || 0) + this.bonus.lifesteal; }
  get totalCdr()    { return (this.cdr || 0) + this.bonus.cdr; }

  // 攻击范围：基础 70 + 武器 range
  get attackRange() {
    return 70 + (this.equipped.weapon ? (this.equipped.weapon.range || 0) : 0);
  }

  // 技能实际冷却：受冷却缩减影响（下限 12 帧，避免技能无限连）
  skillCooldown(base) {
    const cdr = clamp(this.totalCdr, 0, 60) / 100;
    return Math.max(12, Math.round(base * (1 - cdr)));
  }

  // 攻击/技能朝向单位向量（已归一化）
  get aimDir() {
    const len = Math.hypot(this.dirX, this.dirY);
    if (len === 0) return { x: this.facing, y: 0 };
    return { x: this.dirX / len, y: this.dirY / len };
  }

  // 当前视图类型：'side' | 'front' | 'back'
  get viewMode() {
    if (this.dirY < 0) return 'back';
    if (this.dirY > 0) return 'front';
    return 'side';
  }

  // 读取移动输入 → 归一化 → 更新朝向 → 实际移动
  // 抽成独立方法，供 update() 与 updateDuringHitStop() 共用
  // （顿帧期间玩家仍要能走位，见 updateDuringHitStop 注释）
  applyMoveInput() {
    let mx = 0, my = 0;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (mx || my) {
      const len = Math.hypot(mx, my);
      mx /= len; my /= len;
      // 二维朝向：
      //   纯水平移动 → 更新左右朝向（dirY 归零，回到侧身）
      //   纯垂直移动 → 更新纵深朝向（dirX 归零，正上/正下）
      //   斜向移动   → 两者都更新（斜前方）
      if (mx !== 0 && my !== 0) {
        this.facing = mx;
        this.dirX = mx;
        this.dirY = my;
      } else if (mx !== 0) {
        this.facing = mx;
        this.dirX = mx;
        this.dirY = 0;
      } else {
        this.dirX = 0;
        this.dirY = my;
      }
      this.moveWithCollision(mx * this.totalSpeed, 0);
      this.moveWithCollision(0, my * this.totalSpeed);
    }
    return { mx, my };
  }

  // 顿帧期间的玩家更新：只走位，不攻击、不推进冷却
  // —— 为什么不让玩家在顿帧里挥剑 ——
  // ① 挥剑会再次 addHitStop，把顿帧不断续期 → 敌人被冻住不放
  // ② 攻击冷却/连击计时在顿帧里推进会错乱（视觉上砍了一下却被"吞掉"）
  // 只保留移动，操作响应不断，手感不粘。
  updateDuringHitStop() {
    if (!this.alive) return;
    super.update();          // 位置/速度衰减照常
    this.applyMoveInput();
    this.animTime++;
    if (this.invuln > 0) this.invuln--;
    if (this.hitFlash > 0) this.hitFlash--;
    if (this.hurtFlash > 0) this.hurtFlash--;
  }

  update() {
    // 死亡后不再响应输入、不再移动/挥剑，仅保留实体基础 tick（v 衰减）
    if (!this.alive) {
      // 清空所有速度（防止死亡时 knockback 残量把尸体推走）
      this.vx = 0;
      this.vy = 0;
      super.update();
      // 让剑抖动和挥剑动画渐渐归零
      if (this.attackAnim > 0) this.attackAnim--;
      if (this.swordWobble > 0) {
        this.swordWobble = Math.max(0, this.swordWobble - 0.028);
        this.swordWobblePhase += 0.55;
      }
      this.animTime++;
      this.invuln = 0;  // 死亡时不再有无敌帧
      return;
    }
    super.update();
    const { mx, my } = this.applyMoveInput();

    if (this.dashCd > 0) this.dashCd--;
    if (keys['shift'] && this.dashCd === 0 && (mx || my)) {
      this.vx = mx * 14;
      this.vy = my * 14;
      this.invuln = 12;
      this.dashCd = 50;
      playSound('dash');
      for (let i = 0; i < 10; i++) {
        particles.push(new Particle(
          this.x + this.w/2, this.y + this.h/2,
          (Math.random()-0.5)*4, (Math.random()-0.5)*4,
          'rgba(180, 220, 255, 0.6)', 20, 4
        ));
      }
    }

    if (this.skills.attack.cd > 0) this.skills.attack.cd--;
    if ((keys['j'] || mouse.down) && this.skills.attack.cd === 0) {
      this.performAttack();
    }

    // 冰冻减速计时
    if (this.slowTimer > 0) this.slowTimer--;

    if (keys['1']) this.useSkill('fireball');
    if (keys['2']) this.useSkill('ice');
    if (keys['3']) this.useSkill('thunder');
    if (keys['4']) this.useSkill('heal');

    for (const k in this.skills) {
      if (k === 'attack') continue;
      if (this.skills[k].cd > 0) this.skills[k].cd--;
    }

    if (this.comboTimer > 0) {
      this.comboTimer--;
      if (this.comboTimer === 0) this.comboCount = 0;
    }

    // MP 恢复：基于有效上限（含装备加成）
    // 回蓝速度 0.5/4帧 ≈ 7.5/s（原 0.5/6帧 = 5/s，技能几乎放不出来）
    if (this.mp < this.totalMaxMp && this.animTime % 4 === 0)
      this.mp = Math.min(this.totalMaxMp, this.mp + 0.5);

    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      if (p.life !== undefined) p.life--;
      if (p.life !== undefined && p.life <= 0) { pickups.splice(i, 1); continue; }
      if (dist(this, p) < 50) {
        playSound('pickup');
        if (p.type === 'gold') {
          this.gold += p.amount;
          spawnDamageNum(p.x, p.y, '+'+p.amount+' G', '#f1c40f');
        } else if (p.type === 'potion') {
          this.hp = Math.min(this.totalMaxHp, this.hp + 50);
          spawnDamageNum(p.x, p.y, '+50 HP', '#2ecc71');
        } else if (p.type === 'mpotion') {
          this.mp = Math.min(this.totalMaxMp, this.mp + 30);
          spawnDamageNum(p.x, p.y, '+30 MP', '#3498db');
        } else if (p.type === 'chest_reward') {
          // 背包满 → 保留掉落物在地面（不再销毁），否则玩家白打
          if (addToInventory(p.item)) {
            spawnDamageNum(p.x, p.y, '获得 '+p.item.name, '#f1c40f');
            pickups.splice(i, 1);
          } else {
            p.life = Math.max(p.life || 0, 900);  // 延长存在时间
          }
          continue;
        }
        pickups.splice(i, 1);
      }
    }

    if (keys['e'] && !this._ePressed) {
      this._ePressed = true;
      this.tryInteract();
    }
    if (!keys['e']) this._ePressed = false;

    if (this.attackAnim > 0) this.attackAnim--;
    // 剑尖残留抖动衰减（衰减慢一些，让残留更明显，约 35 帧 = 580ms 完全消失）
    if (this.swordWobble > 0) {
      this.swordWobble = Math.max(0, this.swordWobble - 0.028);
      this.swordWobblePhase += 0.55;
    }
  }

  performAttack() {
    // 连击加速：连击数越高冷却越短（8 ~ 14 帧），让连续攻击更流畅
    this.skills.attack.cd = Math.max(8, this.skills.attack.maxCd - this.comboCount);
    this.attackAnim = 8;
    // 挥剑时把剑尖残留抖动拉满，让挥完后剑尖有惯性微抖
    this.swordWobble = 1;
    this.swordWobblePhase = 0;
    this.comboCount = Math.min(6, this.comboCount + 1);
    this.comboTimer = 60;
    const range = this.attackRange;
    // —— 二维攻击判定 ——
    // aim: 归一化后的攻击方向（水平/垂直/斜向都支持）
    const aim = this.aimDir;
    const pcx = this.x + this.w/2;
    const pcy = this.y + this.h/2;
    // 攻击框：以角色为中心，沿 aim 方向偏移 range/2
    const ax = pcx + aim.x * range * 0.5;
    const ay = pcy + aim.y * range * 0.5;
    // 判定盒：主轴沿 aim 方向伸展，垂直方向保留厚度
    const along = range;                 // 沿攻击方向的长度
    const across = 100;                  // 垂直攻击方向的厚度
    const atkBox = (Math.abs(aim.x) >= Math.abs(aim.y))
      ? { x: ax - along/2, y: ay - across/2, w: along, h: across }
      : { x: ax - across/2, y: ay - along/2, w: across, h: along };
    let hitAny = false;
    let killedAny = false;
    let critAny = false;      // 本次攻击是否暴击（用于顿帧时长）
    const critRate = clamp(this.totalCrit, 0, 100) / 100;
    const lifestealRate = clamp(this.totalLifesteal, 0, 50) / 100;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (aabb(atkBox, e)) {
        // 攻击力 = 基础 + 全部装备加成 + 连击加成（连击每层 +2，升级面板可再提升）
        let dmg = this.totalAtk + this.comboCount * (2 + (this.comboPower || 0));
        // 暴击：2 倍伤害
        const isCrit = Math.random() < critRate;
        if (isCrit) { dmg *= 2; critAny = true; }
        const wasAlive = e.alive;
        const dealt = e.takeDamage(dmg, pcx, pcy);
        hitAny = true;
        if (wasAlive && !e.alive) killedAny = true;
        // 暴击视觉：金色大字
        if (isCrit) {
          spawnDamageNum(e.x + e.w/2, e.y - 12, Math.floor(dealt) + '!', '#ffbf00');
          shake(5, 7);
        }
        // 吸血：按实际造成伤害回血
        if (lifestealRate > 0 && dealt > 0) {
          const heal = Math.max(1, Math.floor(dealt * lifestealRate));
          this.hp = Math.min(this.totalMaxHp, this.hp + heal);
          spawnDamageNum(this.x + this.w/2, this.y - 20, '+' + heal, '#2ecc71');
        }
        // 命中特效粒子：暴击更多更大
        const pCount = isCrit ? 12 : 6;
        for (let i = 0; i < pCount; i++) {
          particles.push(new Particle(e.x + e.w/2, e.y + e.h/2,
            (Math.random()-0.5)*(isCrit ? 9 : 6), (Math.random()-0.5)*(isCrit ? 9 : 6),
            isCrit ? '#ffd700' : '#fff', isCrit ? 24 : 15, isCrit ? 4 : 3));
        }
        // 暴击时额外一圈冲击波粒子
        if (isCrit) {
          for (let i = 0; i < 8; i++) {
            const a = (Math.PI * 2 / 8) * i;
            particles.push(new Particle(e.x + e.w/2, e.y + e.h/2,
              Math.cos(a) * 7, Math.sin(a) * 7,
              'rgba(255, 215, 0, 0.9)', 18, 3));
          }
        }
      }
    }
    if (hitAny) {
      playSound('hit');
      shake(3, 5);
      // —— 顿帧 ——
      // 击杀 > 暴击 > 普通命中。顿帧让"打中了"这件事被感知到，
      // 而不是只看到数字飘起来。
      if (killedAny) addHitStop(HITSTOP.kill);
      else if (critAny) addHitStop(HITSTOP.crit);
      else addHitStop(HITSTOP.hit);
      for (let i = 0; i < 4; i++) {
        particles.push(new Particle(
          pcx + aim.x * (40 + i*15),
          pcy + aim.y * (40 + i*15),
          aim.x * 4, aim.y * 4,
          'rgba(255, 255, 200, 0.8)', 12, 8
        ));
      }
    }
  }

  useSkill(name) {
    const sk = this.skills[name];
    if (sk.cd > 0 || this.mp < sk.cost) return;
    // 冷却受「冷却缩减」装备词条影响
    sk.cd = this.skillCooldown(sk.maxCd);
    this.mp -= sk.cost;
    playSound('skill');
    const cx = this.x + this.w/2, cy = this.y + this.h/2;
    // 技能伤害统一用 totalAtk（基础 + 装备）
    const atk = this.totalAtk;
    if (name === 'fireball') {
      const aim = this.aimDir;
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          projectiles.push(new Projectile(cx, cy,
            aim.x * 6, aim.y * 6,
            'fire', 25 + atk * 0.5, 8));
        }, i * 100);
      }
    } else if (name === 'ice') {
      const aim = this.aimDir;
      projectiles.push(new Projectile(cx, cy,
        aim.x * 9, aim.y * 9, 'ice', 30 + atk * 0.7, 12, true));
    } else if (name === 'thunder') {
      for (let i = 0; i < 5; i++) {
        let target = null, td = Infinity;
        for (const e of enemies) {
          if (!e.alive) continue;
          const d = dist(this, e);
          if (d < td) { td = d; target = e; }
        }
        const tx = target ? target.x + target.w/2 : cx + (Math.random()-0.5)*600;
        const ty = target ? target.y + target.h/2 : cy + (Math.random()-0.5)*400;
        setTimeout(() => {
          projectiles.push(new Projectile(tx, ty - 200, 0, 8, 'thunder', 50 + atk * 0.8, 10));
        }, i * 150);
      }
    } else if (name === 'heal') {
      // 治疗量基于「有效生命上限」（含装备加成）
      const healAmt = 50 + this.totalMaxHp * 0.3;
      this.hp = Math.min(this.totalMaxHp, this.hp + healAmt);
      spawnDamageNum(this.x + this.w/2, this.y, '+'+Math.floor(healAmt), '#2ecc71');
      for (let i = 0; i < 24; i++) {
        const a = (Math.PI * 2 / 24) * i;
        particles.push(new Particle(
          this.x + this.w/2 + Math.cos(a)*25,
          this.y + this.h/2 + Math.sin(a)*25,
          Math.cos(a)*2, Math.sin(a)*2 - 1,
          'rgba(100, 255, 150, 0.8)', 40, 5));
      }
    }
  }

  tryInteract() {
    for (const n of npcs) {
      if (dist(this, n) < 80) {
        startDialog(n);
        if (n.reward && !n._rewarded) { n._rewarded = true; n.reward(); }
        return;
      }
    }
    for (const c of chests) {
      if (dist(this, c) < 60 && !c.opened) {
        // Boss 房初始宝箱：要先击败 Boss 才能开
        if (c.requiresBoss) {
          const bossAlive = enemies.some(e => e instanceof Boss && e.alive);
          if (bossAlive) {
            spawnDamageNum(c.x, c.y, '先击败 Boss!', '#e74c3c');
            return;
          }
        }
        c.opened = true;
        if (c.type === 'boss_reward' || c.rarity === 'legendary' && c.type === 'boss') {
          // Boss 宝箱：3 件传说装备 + 1 件史诗 + 大量金币
          const items = [
            generateItem('legendary'),
            generateItem('legendary'),
            generateItem('legendary'),
            generateItem('epic')
          ];
          // 把物品弹射到四周
          for (let i = 0; i < items.length; i++) {
            const angle = (Math.PI * 2 / items.length) * i;
            const px = c.x + Math.cos(angle) * 30;
            const py = c.y + Math.sin(angle) * 30;
            pickups.push({ x: px, y: py, type: 'chest_reward', item: items[i], life: 9999 });
          }
          // Boss 宝箱还会爆出大量金币
          for (let i = 0; i < 8; i++) {
            pickups.push(makePickup(
              c.x + rand(-30, 30),
              c.y + rand(-30, 30),
              'gold', randInt(100, 200)));
          }
          spawnDamageNum(c.x, c.y, '传说宝箱开启!', '#f39c12');
          // 金色烟花
          for (let i = 0; i < 50; i++) {
            particles.push(new Particle(c.x, c.y,
              (Math.random()-0.5)*8, (Math.random()-0.5)*8 - 2,
              choose(['#f1c40f', '#f39c12', '#fff', '#e67e22']),
              60, 5));
          }
          shake(8, 20);
          playSound('levelup');
        } else {
          // 普通宝箱：1 件装备
          const item = generateItem(c.rarity);
          pickups.push({ x: c.x, y: c.y, type: 'chest_reward', item, life: 1500 });
          const label = RARITY_NAMES[item.rarity] + '宝箱!';
          spawnDamageNum(c.x, c.y, label, RARITY_COLORS[item.rarity]);
          for (let i = 0; i < 20; i++) {
            particles.push(new Particle(c.x, c.y,
              (Math.random()-0.5)*5, (Math.random()-0.5)*5 - 1,
              choose([RARITY_COLORS[c.rarity], '#f1c40f', '#e67e22', '#fff']),
              40, 4));
          }
          playSound('pickup');
        }
        return;
      }
    }
  }

  gainExp(amt) {
    this.exp += amt;
    // 连续升级时不能直接叠加 showUpgradePanel() —— 后一次会把前一次覆盖掉，
    // 玩家连升 2 级却只拿到 1 次选择（等于白掉一级）。
    // 改为把待选项排进队列，一次只弹一个，选完再弹下一个。
    while (this.exp >= this.expToNext) {
      this.exp -= this.expToNext;
      this.level++;
      // 经验曲线：1.22 倍递增（原来 1.4 倍太陡，打完全图只能到 Lv5~6）
      this.expToNext = Math.floor(this.expToNext * 1.22);
      this.maxHp += 18; this.maxMp += 10; this.atk += 3; this.def += 1;
      // 升级回满，但按「有效上限」（含装备加成）
      this.hp = this.totalMaxHp;
      this.mp = this.totalMaxMp;
      playSound('levelup');
      pendingUpgrades++;
    }
    // 弹出升级面板（若当前没有面板在显示）
    if (pendingUpgrades > 0 && !upgradeActive) showUpgradePanel();
  }

  drawSprite() {
    const cx = this.x + this.w/2;
    const top = this.y;        // sprite 顶部
    const bottom = this.y + this.h; // sprite 底部

    // 脚下光环 (远距离辨识)
    const auraPulse = 0.4 + Math.sin(this.animTime * 0.12) * 0.15;
    const auraGrad = ctx.createRadialGradient(cx, bottom - 4, 4, cx, bottom - 4, 55);
    auraGrad.addColorStop(0, `rgba(251, 191, 36, ${auraPulse})`);
    auraGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(cx, bottom - 4, 55, 0, Math.PI*2);
    ctx.fill();

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(cx, bottom - 2, 22, 6, 0, 0, Math.PI*2);
    ctx.fill();

    // 精英光环（最底层）
    if (this.elite) {
      ctx.strokeStyle = `rgba(255, 200, 50, ${0.5 + Math.sin(this.animTime * 0.1) * 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, bottom - 30, 32 + Math.sin(this.animTime * 0.15) * 3, 0, Math.PI*2);
      ctx.stroke();
    }

    // 攻击中：先画挥剑特效。
    // 设计：剑柄不是固定在肩膀，而是跟着手臂"伸出去"再收回。
    //   - 前半段 (0~0.5)：手臂抬起，剑从下方往上举到肩膀外侧（不再过头顶）
    //   - 后半段 (0.5~1)：手臂劈下，剑尖画大弧扫到身体前下方
    // 这样剑尖能伸到角色前方 70+ 像素，不是绕肩膀原地转圈。
    // 另外挥剑时画一条从肩膀到剑柄的手臂，让剑真正"长在手上"。
    if (this.attackAnim > 0) {
      const progress = 1 - this.attackAnim / 8;   // 0 -> 1
      // —— 攻击方向（单位向量）——
      //   aimX/aimY 决定挥剑是"横斩"还是"直劈/上挑"
      const aim = this.aimDir;
      const horizontal = Math.abs(aim.x) >= Math.abs(aim.y);  // 横向斩 vs 纵向劈
      const f = this.facing > 0 ? 1 : -1;   // 肩部左右位置用（左右朝向）

      // 用两段二次贝塞尔：start -> peak -> end
      function bez2(p, a, b, c) {
        const it = 1 - p;
        return it * it * a + 2 * it * p * b + p * p * c;
      }

      // —— 剑柄（手）轨迹 + 剑角度 ——
      let startX, startY, peakX, peakY, endX, endY;
      let startAng, midAng, endAng;
      // 肩部锚点：挥剑那只手的肩膀（横向=右肩，纵向=右肩略偏内）
      let shX, shY;

      if (horizontal) {
        // ========== 横斩（朝左 / 朝右）============
        // 起点：肩膀内侧；中段：伸到身体外侧偏上；终点：身体最前下方
        startX = cx + f * 14;   startY = bottom - 44;
        peakX  = cx + f * 38;   peakY  = bottom - 64;
        endX   = cx + f * 44;   endY   = bottom - 32;
        // 剑角度：斜后下 → 举到左上 → 劈到前下
        startAng = -Math.PI / 6;
        midAng   = -Math.PI * 0.6;
        endAng   =  Math.PI / 4;
        shX = cx + f * 17;  shY = bottom - 52;
      } else if (aim.y > 0) {
        // ========== 下劈（朝下 / 朝镜头方向）============
        // 剑从头顶后方举起，向前下方劈出去
        startX = cx + f * 10;   startY = bottom - 74;   // 举在头顶
        peakX  = cx + f * 22;   peakY  = bottom - 86;   // 举得更高（后仰蓄力）
        endX   = cx + f * 18;   endY   = bottom - 26;   // 劈到身前下方
        // 剑角度：竖直向上 → 垂直 → 前下方
        startAng = -Math.PI / 2;    // 剑尖朝上（举过头顶）
        midAng   = -Math.PI * 0.5;  // 接近竖直
        endAng   =  Math.PI / 3;    // 劈到前下方
        shX = cx + f * 17;  shY = bottom - 52;
      } else {
        // ========== 上挑（朝上 / 背对方向）============
        // 剑从身前下方挑起，划到头顶上方
        startX = cx + f * 12;   startY = bottom - 22;   // 垂在身前下方
        peakX  = cx + f * 26;   peakY  = bottom - 54;   // 挑到胸前
        endX   = cx + f * 20;   endY   = bottom - 88;   // 挑到头顶上方
        // 剑角度：前下方 → 竖直向上 → 后上方
        startAng =  Math.PI / 3;    // 剑尖朝前下
        midAng   =  Math.PI / 2;    // 竖直
        endAng   =  Math.PI * 0.95; // 挑到后上方
        shX = cx + f * 17;  shY = bottom - 52;
      }

      const handleX = bez2(progress, startX, peakX, endX);
      const handleY = bez2(progress, startY, peakY, endY);

      const swordAng = progress < 0.5
        ? bez2(progress * 2, startAng, startAng + (midAng - startAng) * 0.7, midAng)
        : bez2((progress - 0.5) * 2, midAng, midAng + (endAng - midAng) * 0.5, endAng);

      // —— 画挥剑的手臂（从肩膀到剑柄）——
      // 肘部：在肩膀和剑柄的中间略靠前
      const elbowX = (shX + handleX) / 2 + f * 1;
      const elbowY = (shY + handleY) / 2;
      // 上臂（肩→肘）
      const pEquipped = this.equipped;
      const armorCol = (pEquipped.armor && pEquipped.armor.color) || '#e8eef5';
      ctx.strokeStyle = armorCol;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(shX, shY);
      ctx.lineTo(elbowX, elbowY);
      ctx.stroke();
      // 上臂阴影
      ctx.strokeStyle = '#9ba8b8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(shX, shY);
      ctx.lineTo(elbowX, elbowY);
      ctx.stroke();
      // 肘部铠甲
      ctx.fillStyle = '#9ba8b8';
      ctx.beginPath();
      ctx.arc(elbowX, elbowY, 3, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(elbowX, elbowY - 0.5, 1.5, 0, Math.PI*2);
      ctx.fill();
      // 下臂（肘→手）
      ctx.strokeStyle = armorCol;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(elbowX, elbowY);
      ctx.lineTo(handleX, handleY);
      ctx.stroke();
      ctx.strokeStyle = '#9ba8b8';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(elbowX, elbowY);
      ctx.lineTo(handleX, handleY);
      ctx.stroke();

      // —— 画剑 ——
      ctx.lineWidth = 1.4;  // 还原默认值
      ctx.save();
      ctx.translate(handleX, handleY);
      ctx.rotate(swordAng);

      const scale = 1.4;
      const wColor = this.equipped.weapon ? this.equipped.weapon.color : '#e2e8f0';
      // 剑刃外发光
      ctx.shadowColor = 'rgba(255, 255, 180, 0.9)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = wColor;
      ctx.fillRect(-1.5 * scale, -32 * scale, 3 * scale, 26 * scale);
      ctx.shadowBlur = 0;
      // 剑刃高光
      ctx.fillStyle = '#fff';
      ctx.fillRect(-0.4 * scale, -31 * scale, 0.8 * scale, 24 * scale);
      // 剑尖
      ctx.fillStyle = wColor;
      ctx.beginPath();
      ctx.moveTo(-1.5 * scale, -32 * scale);
      ctx.lineTo(1.5 * scale, -32 * scale);
      ctx.lineTo(0, -36 * scale);
      ctx.closePath();
      ctx.fill();
      // 护手
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-4 * scale, -6 * scale, 8 * scale, 3 * scale);
      ctx.fillStyle = '#b07b0a';
      ctx.fillRect(-4 * scale, -4 * scale, 8 * scale, 1 * scale);
      // 握柄
      ctx.fillStyle = '#7c2d12';
      ctx.fillRect(-1.5 * scale, -3 * scale, 3 * scale, 8 * scale);
      // 柄头
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(0, 6 * scale, 2 * scale, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();

      // —— 挥剑时的手套（盖在剑柄根部）——
      const gloveCol = (pEquipped.gloves && pEquipped.gloves.color) || '#f3f4f6';
      ctx.fillStyle = gloveCol;
      ctx.beginPath();
      ctx.arc(handleX, handleY, 3, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#9ba8b8';
      ctx.beginPath();
      ctx.arc(handleX, handleY, 3, Math.PI, Math.PI*2);
      ctx.fill();

      // 挥剑残影弧（波线）：沿剑柄贝塞尔轨迹画一道光带，方向自适应
      // 朝左朝右都会画，让波线有"扫过空间"的视觉感
      if (progress > 0.05 && progress < 0.98) {
        const arcAlpha = 0.55 + Math.sin(progress * Math.PI) * 0.4;

        // 1) 沿轨迹画一条曲线光带（trail）：沿用剑柄的同一条贝塞尔
        //    画在剑的"身后"（轨迹尾段），模拟挥剑划过的轨迹
        ctx.strokeStyle = `rgba(255, 240, 170, ${arcAlpha})`;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const segs = 18;
        for (let i = 0; i <= segs; i++) {
          // 让进度比当前剑柄稍滞后来产生"尾迹"
          const t = Math.max(0, progress - 0.35) + (i / segs) * 0.4;
          if (t > 1) break;
          const px = bez2(t, startX, peakX, endX);
          const py = bez2(t, startY, peakY, endY);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // 2) 在轨迹中段画一个明显的光弧（圆弧点缀）
        //    横向斩：弧在身体外侧；纵向劈/挑：弧在身体上方/下方
        ctx.strokeStyle = `rgba(255, 220, 120, ${arcAlpha * 0.85})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        const sweepMag = 0.7 + progress * 0.9;   // 弧的扫角幅度
        if (horizontal) {
          if (f > 0) {
            // 朝右：弧从左下扫到右下
            ctx.arc(peakX, peakY, 46 * (0.45 + progress * 0.6), -sweepMag, sweepMag);
          } else {
            // 朝左：弧从右下扫到左下（镜像）
            ctx.arc(peakX, peakY, 46 * (0.45 + progress * 0.6),
                    Math.PI - sweepMag, Math.PI + sweepMag);
          }
        } else {
          // 纵向劈/挑：弧在身体上方（劈）或下方（挑），以水平弧扫过
          const arcR = 40 * (0.5 + progress * 0.6);
          const arcCY = aim.y > 0 ? peakY + 26 : peakY - 26;
          if (aim.y > 0) {
            // 下劈：弧从左上扫到右上
            ctx.arc(cx, arcCY, arcR, Math.PI - sweepMag, Math.PI + sweepMag);
          } else {
            // 上挑：弧从左下扫到右下
            ctx.arc(cx, arcCY, arcR, -sweepMag, sweepMag);
          }
        }
        ctx.stroke();

        // 3) 武器尖端的"亮点"，强调挥剑的"扫"感
        ctx.fillStyle = `rgba(255, 255, 220, ${arcAlpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(handleX, handleY, 4 + Math.sin(progress * Math.PI) * 3, 0, Math.PI*2);
        ctx.fill();
      }
    }

    // 身体（共享勇者立绘）。把 this.facing 传进去，
    // 内部会自动把盾放在反方向手、剑放在 facing 方向手 —— 不再翻转整个角色
    // 否则脸、眼睛、头发都会镜像，看起来不自然。
    drawHeroArt(ctx, this, cx, bottom, 1, this.facing, this.viewMode);

    // 等级光环
    if (this.level >= 2) {
      const auraAlpha = 0.4 + Math.sin(this.animTime * 0.15) * 0.2;
      ctx.strokeStyle = `rgba(96, 165, 250, ${auraAlpha})`; // 蓝色光环，更贴主题
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, bottom - 72, 18 + Math.sin(this.animTime * 0.1) * 2, 0, Math.PI*2);
      ctx.stroke();
    }

    // 连击数
    if (this.comboCount > 1) {
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeText(this.comboCount + ' Combo!', cx, top - 5);
      ctx.fillText(this.comboCount + ' Combo!', cx, top - 5);
    }
  }
}

const player = new Player(0, 0);
window.player = player;  // 调试/截图脚本用,生产无副作用


// ============================================================
// 敌人
// ============================================================
function makeEnemy(x, y, type) {
  if (type === 'normal') {
    const kinds = [
      { name: '骷髅兵', color: '#ecf0f1', eyeColor: '#e74c3c', hp: 35, atk: 8, def: 2, exp: 15, gold: 8 },
      { name: '蝙蝠',   color: '#8e44ad', eyeColor: '#ff0',    hp: 25, atk: 10, def: 1, exp: 12, gold: 5 },
      { name: '史莱姆', color: '#2ecc71', eyeColor: '#fff',    hp: 50, atk: 6, def: 3, exp: 18, gold: 10 },
      { name: '哥布林', color: '#27ae60', eyeColor: '#f00',    hp: 40, atk: 9, def: 2, exp: 20, gold: 12 }
    ];
    const k = choose(kinds);
    return new Enemy(x, y, k);
  }
  if (type === 'elite') {
    return new Enemy(x, y, {
      name: '精英怪', color: '#c0392b', eyeColor: '#ff0',
      hp: 120, atk: 16, def: 6, exp: 60, gold: 40,
      elite: true, w: 40, h: 56
    });
  }
  if (type === 'boss') {
    return new Boss(x, y);
  }
}

// ============================================================
// 装备套装 (Sets)
// ============================================================
// —— 为什么需要 ——
// 6 个槽位各自独立、互不相干，玩家只能"堆数值"。
// 套装给了"搭配"的意义：集齐某个套装会有质变，
// 让"这局我要凑哪套"成为决策点。
//
// —— 实现关键 ——
// 套装效果直接计入 getEquippedBonus() —— 因为上一阶段已经把所有战斗读数
// 都改成走 Player.total* getter 了，所以套装效果天然接入战斗，
// 不需要再单独改任何战斗逻辑。这是"统一属性入口"架构的红利。
//
// 套装由哪些槽位组成：每个套装指定 parts（槽位数组），
// 玩家穿满其中任意 N 件即激活对应档位效果。
const SETS = {
  fire: {
    id: 'fire', name: '炎魔', icon: '🔥', color: '#e74c3c',
    parts: ['weapon', 'armor', 'head', 'gloves', 'boots', 'amulet'],
    bonuses: {
      2: { desc: '攻击力 +12%', apply: (b, pct) => { b.atkPct += 12; } },
      4: { desc: '攻击 +12%，暴击率 +10%', apply: (b) => { b.atkPct += 12; b.crit += 10; } },
      6: { desc: '攻击 +12%，暴击 +10%，吸血 +8%', apply: (b) => { b.atkPct += 12; b.crit += 10; b.lifesteal += 8; } }
    }
  },
  frost: {
    id: 'frost', name: '霜寒', icon: '❄️', color: '#5dade2',
    parts: ['weapon', 'armor', 'head', 'gloves', 'boots', 'amulet'],
    bonuses: {
      2: { desc: '防御力 +15%', apply: (b) => { b.defPct += 15; } },
      4: { desc: '防御 +15%，生命上限 +25%', apply: (b) => { b.defPct += 15; b.hpPct += 25; } },
      6: { desc: '防御 +15%，生命 +25%，冷却缩减 +12%', apply: (b) => { b.defPct += 15; b.hpPct += 25; b.cdr += 12; } }
    }
  },
  shadow: {
    id: 'shadow', name: '暗影', icon: '🌑', color: '#9b59b6',
    parts: ['weapon', 'armor', 'head', 'gloves', 'boots', 'amulet'],
    bonuses: {
      2: { desc: '移动速度 +12%', apply: (b) => { b.speedPct += 12; } },
      4: { desc: '速度 +12%，攻击 +8%', apply: (b) => { b.speedPct += 12; b.atkPct += 8; } },
      6: { desc: '速度 +12%，攻击 +8%，冷却缩减 +10%', apply: (b) => { b.speedPct += 12; b.atkPct += 8; b.cdr += 10; } }
    }
  },
  holy: {
    id: 'holy', name: '圣光', icon: '✨', color: '#f1c40f',
    parts: ['weapon', 'armor', 'head', 'gloves', 'boots', 'amulet'],
    bonuses: {
      2: { desc: '生命上限 +30%', apply: (b) => { b.hpPct += 30; } },
      4: { desc: '生命 +30%，魔法上限 +30%', apply: (b) => { b.hpPct += 30; b.mpPct += 30; } },
      6: { desc: '生命 +30%，魔法 +30%，吸血 +10%', apply: (b) => { b.hpPct += 30; b.mpPct += 30; b.lifesteal += 10; } }
    }
  }
};
const SET_IDS = Object.keys(SETS);
// 各套装的核心部件（武器/护甲）—— 用于提高套装掉落的辨识度
const SET_CORE_PARTS = { fire: 'weapon', frost: 'armor', shadow: 'head', holy: 'amulet' };

// 生成装备时带上套装标记
// —— 概率设计 ——
// 约 45% 的装备是套装装备。太高会让稀有度失去意义（全是套装），
// 太低则玩家永远凑不齐。这里用「部位加权」：
// 套装的核心部位（武器/护甲等）更容易出套装装，让"想要套装"有明确目标。
function maybeAssignSet(item) {
  if (!item) return item;
  // 套装装备概率：核心部位 55%，其他部位 30%
  const coreChance = 0.55, normalChance = 0.30;
  let chance = normalChance;
  for (const sid of SET_IDS) {
    if (SET_CORE_PARTS[sid] === item.kind) { chance = coreChance; break; }
  }
  if (Math.random() >= chance) return item;
  // 随机选一个套装（其 parts 必须包含该部位 —— 现有套装都是全部位，所以都可用）
  const pool = SET_IDS.filter(sid => SETS[sid].parts.includes(item.kind));
  if (!pool.length) return item;
  const sid = pool[Math.floor(Math.random() * pool.length)];
  item.setId = sid;
  return item;
}

// 统计当前已装备的套装件数
function getSetProgress() {
  const counts = {};
  for (const sid of SET_IDS) counts[sid] = 0;
  for (const slot of EQUIP_SLOTS) {
    const it = player.equipped[slot];
    if (it && it.setId && counts[it.setId] !== undefined) counts[it.setId]++;
  }
  return counts;
}

// 已激活的套装效果（返回可直接并入 bonus 的部分）
// —— 关键设计：只取最高档位，不叠加各档 ——
// 套装效果本身是「递进式」的（4 件档的描述已包含 2 件档的内容），
// 若叠加会得到 atkPct=24 / crit=20 这种远超设计的数值。
// 例：炎魔 4 件 = 攻+12% + 暴击+10%（不是攻+24% + 暴击+10%）
function getActiveSetBonuses() {
  const out = { atkPct: 0, defPct: 0, hpPct: 0, mpPct: 0, speedPct: 0, crit: 0, lifesteal: 0, cdr: 0 };
  const counts = getSetProgress();
  for (const sid of SET_IDS) {
    const set = SETS[sid];
    const n = counts[sid];
    // 找到玩家达到的最高档位
    let best = null;
    for (const threshold of [2, 4, 6]) {
      if (n >= threshold && set.bonuses[threshold]) best = set.bonuses[threshold];
    }
    if (best) best.apply(out);
  }
  return out;
}

// ============================================================
// 难度系统
// ============================================================
// —— 为什么需要 ——
// 原版只有一套难度：玩家要么莽到死、要么一路碾压。
// 新手没有"轻松试水"的入口，老手没有"有挑战"的选项。
//
// 难度影响四个维度（刻意不全都调敌人 —— 只调敌人会让简单难度变成"数字游戏"）：
//   ① 敌人属性  hpMul / atkMul
//   ② 经验金币  expMul / goldMul   —— 简单难度给更多资源，加速成长
//   ③ 掉落概率  dropMul             —— 简单难度出货更多
//   ④ 玩家容错  playerHpMul         —— 简单难度玩家血量更多
const DIFFICULTIES = {
  easy: {
    id: 'easy', name: '轻松', icon: '🌿',
    desc: '敌人较弱，资源与掉落更多，适合熟悉玩法',
    hpMul: 0.7, atkMul: 0.6, expMul: 1.3, goldMul: 1.4, dropMul: 1.6, playerHpMul: 1.3,
    color: '#2ecc71'
  },
  normal: {
    id: 'normal', name: '标准', icon: '⚔',
    desc: '原版难度，攻守平衡，推荐首次挑战',
    hpMul: 1.0, atkMul: 1.0, expMul: 1.0, goldMul: 1.0, dropMul: 1.0, playerHpMul: 1.0,
    color: '#f1c40f'
  },
  hard: {
    id: 'hard', name: '严酷', icon: '💀',
    desc: '敌人强韧且伤害高，但奖励更丰厚',
    hpMul: 1.45, atkMul: 1.5, expMul: 1.25, goldMul: 1.3, dropMul: 0.85, playerHpMul: 0.85,
    color: '#e74c3c'
  }
};
const DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];
let currentDifficulty = 'normal';   // 当前难度（global，startGame 时读取）

function getDifficulty() {
  return DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
}

// 难度对敌人的影响（叠加在 scaleEnemy 的 tier 缩放之上）
function applyDifficultyToEnemy(e) {
  const d = getDifficulty();
  if (!e || e instanceof Boss) return e;
  e.maxHp = Math.max(1, Math.round(e.maxHp * d.hpMul));
  e.hp = e.maxHp;
  e.atk = Math.max(1, Math.round(e.atk * d.atkMul));
  e.exp = Math.round(e.exp * d.expMul);
  e.gold = Math.round(e.gold * d.goldMul);
  return e;
}

// 难度对玩家初始属性的影响
function applyDifficultyToPlayer(p) {
  const d = getDifficulty();
  p.maxHp = Math.round(p.maxHp * d.playerHpMul);
  p.hp = p.maxHp;
  p.maxMp = Math.round(p.maxMp * d.playerHpMul);
  p.mp = p.maxMp;
  return p;
}

// 难度对掉落率的影响（乘在保底逻辑的掉率上）
function applyDifficultyToDrop(chance) {
  return Math.min(1, chance * getDifficulty().dropMul);
}

// ============================================================
// 掉落保底系统 (Pity Drop)
// ============================================================
// —— 为什么需要 ——
// 原版普通怪只有 12% 掉装备、精英怪 50% 掉，且稀有度纯随机。
// 玩家的体感是"刷了半小时一件紫装都没出" —— 期望要打约 25 只怪才出 1 件装备，
// 还没保底机制保运。挫败感直接劝退。
//
// —— 设计 ——
// 双层保底：
//   ① 精英保底：连续 8 只怪没掉装备 → 下次必掉（且必为 rare 及以上）
//   ② 稀有度保底：连续 N 次没掉出 rare+ → 概率递增，直到必出
// 两个计数器都存进存档，退出重进不会重置。
const PITY = {
  eliteDropThreshold: 8,     // 连续多少次没掉装备后保底
  eliteDropRarity: 'rare',   // 保底时的最低稀有度
  rareThreshold: 12,         // 连续多少次没出 rare+ 后开始提概率
  rareStep: 0.12,            // 每超一次阈值，概率 +12%
  rareMax: 1.0
};

// 保底状态（存进存档）
let pityState = {
  killsSinceDrop: 0,   // 连续未掉装备的击杀数
  killsSinceRare: 0    // 连续未掉 rare+ 的击杀数
};

function resetPityState() {
  pityState = { killsSinceDrop: 0, killsSinceRare: 0 };
}

// 装备掉落主逻辑（含保底）
function dropEquipment(e) {
  const isElite = e.elite;

  // —— ① 精英保底：连续 8 次没掉 → 必掉 ——
  const pityTriggered = pityState.killsSinceDrop >= PITY.eliteDropThreshold;
  // 基础掉率：普通怪 12%，精英怪 50%（再乘难度系数）
  let dropChance = isElite ? 0.50 : 0.12;
  dropChance = applyDifficultyToDrop(dropChance);
  if (pityTriggered) dropChance = 1;   // 保底必掉（难度不降低保底）

  const dropRoll = Math.random();
  if (dropRoll >= dropChance) {
    // 没掉 → 计数 +1
    pityState.killsSinceDrop++;
    return false;
  }

  // —— 掉了：算稀有度 ——
  pityState.killsSinceDrop = 0;
  let rarity;
  if (isElite) {
    // 精英：rare 60% / epic 30% / legendary 10%
    const r = Math.random();
    rarity = r < 0.6 ? 'rare' : (r < 0.9 ? 'epic' : 'legendary');
  } else {
    // 普通怪：common 70% / uncommon 30%
    const r = Math.random();
    rarity = r < 0.7 ? 'common' : 'uncommon';
  }

  // —— ② 稀有度保底：连续 12 次没出 rare+ → 概率递增 ——
  const isRarePlus = rarity === 'rare' || rarity === 'epic' || rarity === 'legendary';
  if (isRarePlus) {
    pityState.killsSinceRare = 0;
  } else {
    pityState.killsSinceRare++;
    // 超过阈值后，每次掉落都掷一次「提概率」判定
    if (pityState.killsSinceRare > PITY.rareThreshold) {
      const boost = Math.min(PITY.rareMax,
        (pityState.killsSinceRare - PITY.rareThreshold) * PITY.rareStep);
      if (Math.random() < boost) {
        rarity = Math.random() < 0.75 ? 'rare' : (Math.random() < 0.7 ? 'epic' : 'legendary');
        pityState.killsSinceRare = 0;
      }
    }
  }
  // 保底触发时，最低稀有度提到 rare
  if (pityTriggered && !isRarePlus) {
    rarity = PITY.eliteDropRarity;
    pityState.killsSinceRare = 0;
  }

  const item = generateItem(rarity);
  const px = e.x + e.w/2 + (Math.random()-0.5)*30;
  const py = e.y + e.h/2 + (Math.random()-0.5)*30;
  pickups.push({ x: px, y: py, type: 'chest_reward', item, life: 1500 });
  spawnDamageNum(e.x + e.w/2, e.y - 30, '掉落装备!', RARITY_COLORS[item.rarity]);
  if (pityTriggered) {
    spawnDamageNum(e.x + e.w/2, e.y - 50, '保底!', '#f1c40f');
  }
  return true;
}

// 保底状态提示（HUD 上显示"距离保底还有 N 只怪"）
function getPityInfo() {
  const left = Math.max(0, PITY.eliteDropThreshold - pityState.killsSinceDrop);
  return {
    killsSinceDrop: pityState.killsSinceDrop,
    killsSinceRare: pityState.killsSinceRare,
    toElitePity: left,
    rareBoost: pityState.killsSinceRare > PITY.rareThreshold
  };
}

// ============================================================
// 精英词缀系统
// ============================================================
// —— 为什么需要 ——
// 原版的"精英怪"只是数值更大更硬（HP120 vs 小怪 25~50），
// 没有任何独特机制 —— 打起来和一个血厚的普通怪没区别。
// 词缀让精英怪有"性格"，玩家需要针对性应对，战斗才有变化。
//
// 每个词缀包含：
//   name      显示名
//   color     标识色（画在精英光环/名字上，让玩家一眼认出来）
//   apply(e)  施加到敌人身上（改属性、装回调）
//   tick(e)   每帧回调（实现持续机制，如护盾回复）
//   onDeath(e) 死亡回调（如自爆）
const ELITE_AFFIXES = [
  {
    id: 'armored', name: '重甲', color: '#95a5a6',
    desc: '护甲极高，但移动缓慢',
    apply(e) { e.def += 8; e.speed *= 0.6; e.affixId = 'armored'; }
  },
  {
    id: 'swift', name: '迅捷', color: '#f1c40f',
    desc: '移动与攻击都很快，但血量偏低',
    apply(e) { e.speed *= 1.8; e.attackCdScale = 0.5; e.maxHp = Math.round(e.maxHp * 0.7); e.hp = e.maxHp; e.affixId = 'swift'; }
  },
  {
    id: 'vampiric', name: '吸血', color: '#e74c3c',
    desc: '攻击命中玩家时回复自身生命',
    apply(e) { e.affixId = 'vampiric'; e.lifesteal = 0.5; }
  },
  {
    id: 'shielded', name: '护盾', color: '#3498db',
    desc: '每 4 秒回复 15% 生命',
    apply(e) { e.affixId = 'shielded'; e.shieldRegenTimer = 0; }
  },
  {
    id: 'explosive', name: '自爆', color: '#e67e22',
    desc: '死亡时爆炸，造成范围伤害',
    apply(e) { e.affixId = 'explosive'; }
  },
  {
    id: 'summoner', name: '召唤者', color: '#9b59b6',
    desc: '每 6 秒召唤一只小怪',
    apply(e) { e.affixId = 'summoner'; e.summonTimer = 0; }
  },
  {
    id: 'berserker', name: '狂怒', color: '#d35400',
    desc: '生命越低攻击越高',
    apply(e) { e.affixId = 'berserker'; }
  },
  {
    id: 'freezing', name: '冰冻', color: '#5dade2',
    desc: '命中玩家时使其减速',
    apply(e) { e.affixId = 'freezing'; }
  }
];

// 给精英怪随机挂 1 条词缀（后期精英可挂 2 条）
function rollEliteAffix(e, tier) {
  if (!e || !e.elite) return e;
  const count = tier > 0.6 && Math.random() < 0.25 ? 2 : 1;
  const pool = [...ELITE_AFFIXES];
  e.affixes = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const aff = pool.splice(idx, 1)[0];
    e.affixes.push(aff);
    aff.apply(e);
  }
  return e;
}

// 词缀的持续机制（护盾回复/召唤）
function updateEliteAffixes(e) {
  if (!e.alive || !e.affixes || !e.affixes.length) return;
  for (const aff of e.affixes) {
    if (aff.id === 'shielded') {
      e.shieldRegenTimer++;
      if (e.shieldRegenTimer >= 240) {   // 每 4 秒
        e.shieldRegenTimer = 0;
        const heal = Math.round(e.maxHp * 0.15);
        if (e.hp < e.maxHp) {
          e.hp = Math.min(e.maxHp, e.hp + heal);
          spawnDamageNum(e.x + e.w/2, e.y - 20, '+' + heal, '#3498db');
        }
      }
    } else if (aff.id === 'summoner') {
      e.summonTimer++;
      if (e.summonTimer >= 360) {       // 每 6 秒
        e.summonTimer = 0;
        const ox = rand(-40, 40), oy = rand(-40, 40);
        const m = makeEnemy(e.x + e.w/2 + ox, e.y + e.h/2 + oy, 'normal');
        m.hp = Math.round(m.hp * 0.6);
        m.maxHp = m.hp;
        enemies.push(m);
        spawnDamageNum(e.x + e.w/2, e.y - 30, '召唤!', '#9b59b6');
        for (let i = 0; i < 12; i++) {
          particles.push(new Particle(e.x + e.w/2, e.y + e.h/2,
            (Math.random()-0.5)*5, (Math.random()-0.5)*5, '#9b59b6', 25, 3));
        }
      }
    }
  }
}

// 精英怪攻击时的额外效果（吸血/冰冻/狂怒）
function applyEliteOnHit(e, dmg) {
  if (!e.affixes || !e.affixes.length) return dmg;
  let out = dmg;
  for (const aff of e.affixes) {
    if (aff.id === 'berserker') {
      // 血量越低攻击越高（最高 2 倍）
      const missing = 1 - e.hp / e.maxHp;
      out *= (1 + missing);
    }
  }
  return out;
}

// 精英词缀的死亡效果（自爆）
function eliteOnDeath(e) {
  if (!e.affixes) return;
  for (const aff of e.affixes) {
    if (aff.id === 'explosive') {
      // 范围爆炸
      const R = 130;
      if (dist(player, {x: e.x + e.w/2, y: e.y + e.h/2}) < R) {
        player.takeDamage(Math.round(e.atk * 1.2), e.x + e.w/2, e.y + e.h/2);
      }
      shake(10, 14);
      for (let i = 0; i < 34; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rand(2, 9);
        particles.push(new Particle(e.x + e.w/2, e.y + e.h/2,
          Math.cos(a) * sp, Math.sin(a) * sp,
          choose(['#e67e22', '#f39c12', '#fff']), 32, 4));
      }
      spawnDamageNum(e.x + e.w/2, e.y - 20, '爆炸!', '#e67e22');
    }
  }
}

// 按关卡进度缩放敌人属性
// —— 修复：原先整张地图只有一套怪物属性，走到最后也不变强 ——
// tier: 0（第一间战斗房）~ 1（Boss 前一间）
function scaleEnemy(e, tier) {
  if (!e || e instanceof Boss) return e;
  const hpMul  = 1 + tier * 0.7;    // 生命 +0% ~ +70%
  const atkMul = 1 + tier * 0.4;    // 攻击 +0% ~ +40%
  const expMul = 1 + tier * 0.5;    // 经验 +0% ~ +50%（同步成长，避免后期刷不动）
  // 精英的基础值远高于小怪（HP 120 vs 25~50），
  // 早期房间里一只精英就能主导整房威胁值 → 难度曲线前段陡、后段平。
  // 这里让精英在早期相对弱一些、后期回归原始强度。
  const eliteSoftener = e.elite ? (1 - tier * 0.35) : 1;
  e.maxHp = Math.round(e.maxHp * hpMul * eliteSoftener);
  e.hp = e.maxHp;
  e.atk = Math.round(e.atk * atkMul * eliteSoftener);
  e.exp = Math.round(e.exp * expMul);
  e.gold = Math.round(e.gold * (1 + tier * 0.3));
  return e;
}

class Enemy extends Entity {
  constructor(x, y, cfg) {
    super(x, y, cfg.w || 36, cfg.h || 48);
    this.maxHp = cfg.hp; this.hp = cfg.hp;
    this.atk = cfg.atk;
    this.def = cfg.def;
    this.exp = cfg.exp;
    this.gold = cfg.gold;
    this.name = cfg.name;
    this.color = cfg.color;
    this.eyeColor = cfg.eyeColor;
    this.elite = cfg.elite || false;
    // —— 精英词缀 ——
    this.affixes = [];          // 词缀对象数组
    this.affixId = null;        // 主词缀 id（供快速判断）
    this.lifesteal = 0;         // 吸血比例（词缀用）
    this.attackCdScale = 1;     // 攻击冷却倍率（词缀用）
    this.shieldRegenTimer = 0;  // 护盾回复计时
    this.summonTimer = 0;       // 召唤计时
    this.speed = this.elite ? 1.6 : 1.3;
    this.aiState = 'idle';
    this.aiTimer = 0;
    this.attackCd = 0;
    this.wanderDir = { x: 0, y: 0 };
    this.wanderTimer = 0;
    this.kind = choose(['melee', 'ranged']);
    if (this.kind === 'ranged' && !this.elite) this.color = '#9b59b6';
    this.onDeath = () => this.handleDeath();
  }

  handleDeath() {
    player.gainExp(this.exp);
    // 金币只走「掉落物」这一条路 —— 原来这里既直接加钱、又在下面掉一个同额金币，
    // 捡起来就是双倍。已删除直接加钱那行。
    player.totalKills++;
    player.totalGold += this.gold;
    playSound('kill');
    // 金币掉落
    pickups.push(makePickup(this.x + this.w/2, this.y + this.h/2, 'gold', this.gold));
    // 药水掉落
    if (Math.random() < (this.elite ? 1 : 0.35)) {
      pickups.push(makePickup(this.x + this.w/2, this.y + this.h/2 + 30,
        Math.random() < 0.5 ? 'potion' : 'mpotion'));
    }
    // —— 装备掉落（含保底）——
    dropEquipment(this);
    // 死亡粒子
    for (let i = 0; i < 14; i++) {
      particles.push(new Particle(
        this.x + this.w/2, this.y + this.h/2,
        (Math.random()-0.5)*8, (Math.random()-0.5)*8,
        this.color, 30, 4));
    }
    // 精英词缀的死亡效果（自爆）
    eliteOnDeath(this);
  }

  update() {
    super.update();
    if (!player.alive) return;
    if (this.attackCd > 0) this.attackCd--;
    // 精英词缀的持续机制（护盾回复 / 召唤小怪）
    updateEliteAffixes(this);

    const dx = (player.x + player.w/2) - (this.x + this.w/2);
    const dy = (player.y + player.h/2) - (this.y + this.h/2);
    const d = Math.hypot(dx, dy);
    this.facing = dx > 0 ? 1 : -1;

    // 视野
    const sightRange = this.elite ? 500 : 350;
    if (d < sightRange && this.canSeePlayer()) {
      this.aiState = 'chase';
    } else if (this.aiState === 'chase' && d > sightRange * 1.3) {
      this.aiState = 'wander';
    }
    if (d < 600 && this.canSeePlayer()) this.aiState = 'chase';

    if (this.aiState === 'wander') {
      this.wanderTimer--;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = randInt(60, 180);
        const a = Math.random() * Math.PI * 2;
        this.wanderDir = { x: Math.cos(a), y: Math.sin(a) };
      }
      const sp = this.speed * 0.4;
      this.moveWithCollision(this.wanderDir.x * sp, 0);
      this.moveWithCollision(0, this.wanderDir.y * sp);
    } else if (this.aiState === 'chase') {
      const dirX = dx / (d || 1);
      const dirY = dy / (d || 1);
      const sp = this.speed;
      const stopDist = this.kind === 'ranged' ? 240 : (this.elite ? 80 : 70);
      if (d > stopDist) {
        this.moveWithCollision(dirX * sp, 0);
        this.moveWithCollision(0, dirY * sp);
      } else if (this.kind === 'ranged' && d < 140) {
        // 远程后退
        this.moveWithCollision(-dirX * sp * 0.5, 0);
        this.moveWithCollision(0, -dirY * sp * 0.5);
      }
      // 攻击
      if (this.attackCd === 0 && d < (this.kind === 'ranged' ? 320 : 75)) {
        this.performAttack(dirX, dirY);
      }
    }
  }

  canSeePlayer() {
    // 简单视线检测 (采样)
    const steps = 12;
    const sx = this.x + this.w/2, sy = this.y + this.h/2;
    const ex = player.x + player.w/2, ey = player.y + player.h/2;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const cx = sx + (ex - sx) * t;
      const cy = sy + (ey - sy) * t;
      if (isBlocked(cx, cy, 4, 4)) return false;
    }
    return true;
  }

  performAttack(dirX, dirY) {
    // 攻击冷却受词缀影响（迅捷：冷却减半）
    const baseCd = this.kind === 'ranged' ? 90 : (this.elite ? 50 : 70);
    this.attackCd = Math.max(10, Math.round(baseCd * (this.attackCdScale || 1)));
    if (this.kind === 'melee') {
      // 近战
      const range = this.elite ? 70 : 55;
      const atkBox = { x: this.x + this.w/2 + dirX*range*0.5 - range/2,
                       y: this.y + this.h/2 + dirY*range*0.5 - range/2,
                       w: range, h: range };
      if (aabb(atkBox, player)) {
        let dmg = this.atk + (this.elite ? 5 : 0);
        // 狂怒词缀：血量越低攻击越高
        dmg = applyEliteOnHit(this, dmg);
        const dealt = player.takeDamage(dmg, this.x + this.w/2, this.y + this.h/2);
        // 吸血词缀：按实际造成的伤害回血
        if (this.lifesteal > 0 && dealt > 0) {
          const heal = Math.max(1, Math.floor(dealt * this.lifesteal));
          this.hp = Math.min(this.maxHp, this.hp + heal);
          spawnDamageNum(this.x + this.w/2, this.y - 20, '+' + heal, '#e74c3c');
        }
        // 冰冻词缀：命中后玩家短暂减速
        if (this.affixId === 'freezing') {
          player.slowTimer = 90;   // 1.5 秒
          spawnDamageNum(player.x + player.w/2, player.y - 30, '冰冻!', '#5dade2');
        }
        shake(4, 6);
      }
    } else {
      // 远程
      let dmg = this.atk;
      dmg = applyEliteOnHit(this, dmg);
      projectiles.push(new Projectile(
        this.x + this.w/2, this.y + this.h/2,
        dirX * 4.5, dirY * 4.5,
        'enemy', dmg, 6, false, true
      ));
    }
  }

  drawSprite() {
    const cx = this.x + this.w/2, cy = this.y + this.h/2;
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(cx, this.y + this.h - 3, 18, 5, 0, 0, Math.PI*2); ctx.fill();

    // 精英光环（最底层，确保光环在所有身体之下）
    if (this.elite) {
      // 光环颜色跟随词缀（无词缀时用金色）
      const affixColor = (this.affixes && this.affixes[0]) ? this.affixes[0].color : '#f1c40f';
      ctx.strokeStyle = affixColor;
      ctx.globalAlpha = 0.5 + Math.sin(this.animTime * 0.1) * 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 32 + Math.sin(this.animTime * 0.15) * 3, 0, Math.PI*2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // 词缀标识：精英怪头顶显示词缀名（带底色）
      if (this.affixes && this.affixes.length) {
        const labels = this.affixes.map(a => a.name).join('·');
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        const tw = ctx.measureText(labels).width;
        const ly = this.y - 6;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(cx - tw/2 - 4, ly - 9, tw + 8, 13);
        ctx.fillStyle = affixColor;
        ctx.fillText(labels, cx, ly + 1);
      }
    }

    // 按种类绘制独特造型
    if (this.name === '骷髅兵')       drawEnemySkeleton(ctx, cx, cy, this);
    else if (this.name === '蝙蝠')    drawEnemyBat(ctx, cx, cy, this);
    else if (this.name === '史莱姆')  drawEnemySlime(ctx, cx, cy, this);
    else if (this.name === '哥布林')  drawEnemyGoblin(ctx, cx, cy, this);
    else if (this.name === '精英怪')  drawEnemyElite(ctx, cx, cy, this);
    else                              drawEnemyGeneric(ctx, cx, cy, this);
  }
}

// ============================================================
// 怪物造型绘制（独立函数）
// ============================================================

function drawEnemyGeneric(ctx, cx, cy, e) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(e.facing, 1);
  ctx.fillStyle = e.color;
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = e.eyeColor;
  ctx.beginPath(); ctx.arc(7, -4, 4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(8, -4, 2, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

// 骷髅兵：白骨身体 + 大眼洞 + 牙齿 + 关节描线 + 护肩
function drawEnemySkeleton(ctx, cx, cy, e) {
  const bob = Math.sin(e.animTime * 0.08) * 1.5;

  // 护肩（深灰锈铁）
  ctx.fillStyle = '#5d6d7e';
  ctx.fillRect(cx - 18, cy - 12 + bob, 8, 16);
  ctx.fillRect(cx + 10, cy - 12 + bob, 8, 16);
  ctx.fillStyle = '#34495e';
  ctx.fillRect(cx - 19, cy - 14 + bob, 10, 4);
  ctx.fillRect(cx + 9, cy - 14 + bob, 10, 4);

  // 肋骨胸腔（白色椭圆+竖线）
  ctx.fillStyle = '#ecf0f1';
  ctx.beginPath();
  ctx.ellipse(cx, cy + bob, 18, 22, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#bdc3c7';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // 肋骨线
  ctx.strokeStyle = '#7f8c8d';
  ctx.lineWidth = 1.5;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy + i*5 + bob);
    ctx.quadraticCurveTo(cx, cy + i*5 - 3 + bob, cx + 14, cy + i*5 + bob);
    ctx.stroke();
  }
  // 中线
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14 + bob);
  ctx.lineTo(cx, cy + 14 + bob);
  ctx.stroke();

  // 头骨（圆+下颚）
  ctx.fillStyle = '#ecf0f1';
  ctx.beginPath();
  ctx.arc(cx, cy - 16 + bob, 12, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#bdc3c7';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 下颚（窄一点）
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy - 8 + bob);
  ctx.lineTo(cx - 6, cy - 2 + bob);
  ctx.lineTo(cx + 6, cy - 2 + bob);
  ctx.lineTo(cx + 8, cy - 8 + bob);
  ctx.fillStyle = '#ecf0f1';
  ctx.fill();
  ctx.stroke();
  // 牙齿
  ctx.fillStyle = '#fff';
  for (let i = -2; i <= 2; i++) {
    ctx.fillRect(cx + i*3 - 1, cy - 5 + bob, 2, 4);
  }

  // 眼洞（红色发光）
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(cx - 5, cy - 17 + bob, 3, 4, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 5, cy - 17 + bob, 3, 4, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath(); ctx.arc(cx - 5, cy - 17 + bob, 1.8, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 5, cy - 17 + bob, 1.8, 0, Math.PI*2); ctx.fill();

  // 鼻洞
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 12 + bob);
  ctx.lineTo(cx - 2, cy - 9 + bob);
  ctx.lineTo(cx + 2, cy - 9 + bob);
  ctx.closePath();
  ctx.fill();

  // 手臂（小骨头）
  ctx.fillStyle = '#ecf0f1';
  ctx.fillRect(cx - 24, cy - 2 + bob, 4, 14);
  ctx.fillRect(cx + 20, cy - 2 + bob, 4, 14);
  ctx.fillStyle = '#bdc3c7';
  ctx.fillRect(cx - 24, cy + 8 + bob, 4, 2);
  ctx.fillRect(cx + 20, cy + 8 + bob, 4, 2);

  // 武器（锈剑）
  ctx.fillStyle = '#7f8c8d';
  ctx.fillRect(cx + 22, cy - 14 + bob, 3, 18);
  ctx.fillStyle = '#34495e';
  ctx.fillRect(cx + 19, cy + 4 + bob, 9, 3);
  ctx.fillStyle = '#5d4037';
  ctx.fillRect(cx + 22, cy + 7 + bob, 3, 6);
}

// 蝙蝠：翼展+獠牙+尖耳+毛茸身体
function drawEnemyBat(ctx, cx, cy, e) {
  const flap = Math.sin(e.animTime * 0.4) * 0.5;  // 翅膀扇动
  const bob = Math.sin(e.animTime * 0.15) * 2;

  // 左右翅膀
  ctx.save();
  ctx.translate(cx, cy - 4 + bob);

  // 左翅
  ctx.fillStyle = '#6c3483';
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(-26, -10 + flap * 4);
  ctx.lineTo(-30, -2 + flap * 2);
  ctx.lineTo(-22, 4 + flap);
  ctx.lineTo(-28, 10 + flap * 2);
  ctx.lineTo(-14, 8);
  ctx.closePath();
  ctx.fill();
  // 翅膜线
  ctx.strokeStyle = '#4a235a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-8, 0); ctx.lineTo(-26, -10 + flap * 4);
  ctx.moveTo(-8, 0); ctx.lineTo(-30, -2 + flap * 2);
  ctx.moveTo(-8, 0); ctx.lineTo(-22, 4 + flap);
  ctx.stroke();

  // 右翅
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(26, -10 + flap * 4);
  ctx.lineTo(30, -2 + flap * 2);
  ctx.lineTo(22, 4 + flap);
  ctx.lineTo(28, 10 + flap * 2);
  ctx.lineTo(14, 8);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, 0); ctx.lineTo(26, -10 + flap * 4);
  ctx.moveTo(8, 0); ctx.lineTo(30, -2 + flap * 2);
  ctx.moveTo(8, 0); ctx.lineTo(22, 4 + flap);
  ctx.stroke();
  ctx.restore();

  // 毛茸身体
  ctx.fillStyle = '#8e44ad';
  ctx.beginPath();
  ctx.ellipse(cx, cy + bob, 12, 14, 0, 0, Math.PI*2);
  ctx.fill();
  // 头（更圆）
  ctx.fillStyle = '#9b59b6';
  ctx.beginPath();
  ctx.arc(cx, cy - 8 + bob, 10, 0, Math.PI*2);
  ctx.fill();
  // 头毛边
  ctx.strokeStyle = '#6c3483';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 尖耳
  ctx.fillStyle = '#6c3483';
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy - 12 + bob);
  ctx.lineTo(cx - 13, cy - 22 + bob);
  ctx.lineTo(cx - 5, cy - 14 + bob);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 9, cy - 12 + bob);
  ctx.lineTo(cx + 13, cy - 22 + bob);
  ctx.lineTo(cx + 5, cy - 14 + bob);
  ctx.closePath();
  ctx.fill();
  // 内耳粉
  ctx.fillStyle = '#e91e63';
  ctx.beginPath();
  ctx.arc(cx - 10, cy - 16 + bob, 1.5, 0, Math.PI*2);
  ctx.arc(cx + 10, cy - 16 + bob, 1.5, 0, Math.PI*2);
  ctx.fill();

  // 大黄眼
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(cx - 4, cy - 8 + bob, 2.5, 3, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 4, cy - 8 + bob, 2.5, 3, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#ffeb3b';
  ctx.beginPath(); ctx.arc(cx - 4, cy - 8 + bob, 1.5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 4, cy - 8 + bob, 1.5, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx - 3.5, cy - 8.5 + bob, 0.6, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 4.5, cy - 8.5 + bob, 0.6, 0, Math.PI*2); ctx.fill();

  // 獠牙
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - 3, cy - 3 + bob);
  ctx.lineTo(cx - 2, cy + 2 + bob);
  ctx.lineTo(cx - 1, cy - 3 + bob);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 1, cy - 3 + bob);
  ctx.lineTo(cx + 2, cy + 2 + bob);
  ctx.lineTo(cx + 3, cy - 3 + bob);
  ctx.closePath();
  ctx.fill();

  // 小爪（吊挂）
  ctx.fillStyle = '#6c3483';
  ctx.fillRect(cx - 6, cy + 10 + bob, 2, 4);
  ctx.fillRect(cx + 4, cy + 10 + bob, 2, 4);
}

// 史莱姆：半透明果冻 + 摇晃 + 小眼睛 + 嘴 + 高光
function drawEnemySlime(ctx, cx, cy, e) {
  const wobble = Math.sin(e.animTime * 0.1) * 2;
  const squish = 1 + Math.sin(e.animTime * 0.15) * 0.05;

  // 主体（半透明果冻）
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1.05, 0.85 * squish);
  // 半透明填充
  ctx.fillStyle = 'rgba(46, 204, 113, 0.85)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 22, 0, 0, Math.PI*2);
  ctx.fill();
  // 描边
  ctx.strokeStyle = '#1e8449';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 顶部高光
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.ellipse(cx - 6, cy - 14 + wobble, 6, 3, -0.4, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(cx - 8, cy - 10 + wobble, 2, 0, Math.PI*2);
  ctx.fill();

  // 内核（深色）
  ctx.fillStyle = 'rgba(30, 132, 73, 0.5)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 4, 10, 6, 0, 0, Math.PI*2);
  ctx.fill();

  // 大眼（白眼+黑瞳）
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(cx - 6, cy - 2, 4, 5, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 6, cy - 2, 4, 5, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(cx - 5, cy - 1, 2.2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 7, cy - 1, 2.2, 0, Math.PI*2); ctx.fill();
  // 高光
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx - 4, cy - 2, 0.8, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 8, cy - 2, 0.8, 0, Math.PI*2); ctx.fill();

  // 嘴（笑）
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy + 8, 5, 0.2, Math.PI - 0.2);
  ctx.stroke();

  // 黏液滴（悬挂在底部）
  ctx.fillStyle = 'rgba(46, 204, 113, 0.7)';
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy + 16);
  ctx.quadraticCurveTo(cx - 10, cy + 22, cx - 6, cy + 20);
  ctx.quadraticCurveTo(cx - 4, cy + 18, cx - 8, cy + 16);
  ctx.fill();
}

// 哥布林：绿色小身板 + 尖耳 + 长鼻子 + 尖牙 + 持匕首
function drawEnemyGoblin(ctx, cx, cy, e) {
  const bob = Math.sin(e.animTime * 0.1) * 1.5;

  // 大尖耳
  ctx.fillStyle = '#1e8449';
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy - 16 + bob);
  ctx.lineTo(cx - 22, cy - 22 + bob);
  ctx.lineTo(cx - 12, cy - 10 + bob);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 12, cy - 16 + bob);
  ctx.lineTo(cx + 22, cy - 22 + bob);
  ctx.lineTo(cx + 12, cy - 10 + bob);
  ctx.closePath();
  ctx.fill();

  // 身体（皮衣）
  ctx.fillStyle = '#7d3c0f';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 10 + bob, 14, 16, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#5d2c08';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 腰带
  ctx.fillStyle = '#4a2c0a';
  ctx.fillRect(cx - 12, cy + 8 + bob, 24, 3);
  ctx.fillStyle = '#f1c40f';
  ctx.fillRect(cx - 2, cy + 8 + bob, 4, 3);

  // 头
  ctx.fillStyle = '#27ae60';
  ctx.beginPath();
  ctx.arc(cx, cy - 6 + bob, 11, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#1e8449';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 长尖鼻
  ctx.fillStyle = '#27ae60';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 4 + bob);
  ctx.lineTo(cx + 5, cy + 3 + bob);
  ctx.lineTo(cx - 5, cy + 3 + bob);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 鼻尖红
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.arc(cx, cy + 2 + bob, 2, 0, Math.PI*2);
  ctx.fill();

  // 凶恶红眼
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(cx - 5, cy - 8 + bob, 2.5, 3, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 5, cy - 8 + bob, 2.5, 3, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#f00';
  ctx.beginPath(); ctx.arc(cx - 5, cy - 8 + bob, 1.5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 5, cy - 8 + bob, 1.5, 0, Math.PI*2); ctx.fill();
  // 红眉（怒）
  ctx.strokeStyle = '#7f0000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy - 11 + bob);
  ctx.lineTo(cx - 3, cy - 10 + bob);
  ctx.moveTo(cx + 3, cy - 10 + bob);
  ctx.lineTo(cx + 7, cy - 11 + bob);
  ctx.stroke();

  // 尖牙嘴
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx, cy + 4 + bob, 3, 0, Math.PI);
  ctx.fill();
  // 上尖牙
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - 2, cy + 2 + bob);
  ctx.lineTo(cx - 1, cy + 5 + bob);
  ctx.lineTo(cx - 0.5, cy + 2 + bob);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 2, cy + 2 + bob);
  ctx.lineTo(cx + 1, cy + 5 + bob);
  ctx.lineTo(cx + 0.5, cy + 2 + bob);
  ctx.closePath();
  ctx.fill();

  // 左手
  ctx.fillStyle = '#27ae60';
  ctx.fillRect(cx - 18, cy + 6 + bob, 4, 8);

  // 右手持匕首
  ctx.fillStyle = '#27ae60';
  ctx.fillRect(cx + 14, cy + 6 + bob, 4, 8);
  // 匕首
  ctx.save();
  ctx.translate(cx + 22, cy + 4 + bob);
  ctx.rotate(-0.4);
  ctx.fillStyle = '#bdc3c7';
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(2, 2);
  ctx.lineTo(-2, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5d4037';
  ctx.fillRect(-1.5, 2, 3, 5);
  ctx.restore();

  // 脚（小绿腿）
  ctx.fillStyle = '#1e8449';
  ctx.fillRect(cx - 8, cy + 24 + bob, 5, 4);
  ctx.fillRect(cx + 3, cy + 24 + bob, 5, 4);
}

// 精英怪：比普通怪大一圈 + 红色光环 + 头冠 + 大刀
function drawEnemyElite(ctx, cx, cy, e) {
  const bob = Math.sin(e.animTime * 0.08) * 2;

  // 大体型 — 暗红重甲
  ctx.fillStyle = '#7b241c';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 4 + bob, 22, 24, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 护甲纹路
  ctx.strokeStyle = '#f39c12';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14 + bob);
  ctx.lineTo(cx, cy + 18 + bob);
  ctx.moveTo(cx - 14, cy + 4 + bob);
  ctx.lineTo(cx + 14, cy + 4 + bob);
  ctx.stroke();

  // 头
  ctx.fillStyle = '#922b21';
  ctx.beginPath();
  ctx.arc(cx, cy - 14 + bob, 13, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 头冠（铁刺）
  ctx.fillStyle = '#34495e';
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i*5 - 2, cy - 24 + bob);
    ctx.lineTo(cx + i*5, cy - 30 + bob);
    ctx.lineTo(cx + i*5 + 2, cy - 24 + bob);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#f1c40f';
  ctx.beginPath();
  ctx.arc(cx, cy - 30 + bob, 2.5, 0, Math.PI*2);
  ctx.fill();

  // 血红双眼
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(cx - 5, cy - 14 + bob, 3, 3.5, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 5, cy - 14 + bob, 3, 3.5, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath(); ctx.arc(cx - 5, cy - 14 + bob, 2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 5, cy - 14 + bob, 2, 0, Math.PI*2); ctx.fill();

  // 獠牙
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - 3, cy - 8 + bob);
  ctx.lineTo(cx - 2, cy - 4 + bob);
  ctx.lineTo(cx - 1, cy - 8 + bob);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 1, cy - 8 + bob);
  ctx.lineTo(cx + 2, cy - 4 + bob);
  ctx.lineTo(cx + 3, cy - 8 + bob);
  ctx.closePath();
  ctx.fill();

  // 大刀
  ctx.save();
  ctx.translate(cx + 24, cy + 4 + bob);
  ctx.rotate(-0.3);
  // 刀刃
  ctx.fillStyle = '#ecf0f1';
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(3, -22);
  ctx.lineTo(2, 8);
  ctx.lineTo(-2, 8);
  ctx.closePath();
  ctx.fill();
  // 刀光
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(-1, -20, 1, 26);
  // 护手
  ctx.fillStyle = '#f1c40f';
  ctx.fillRect(-5, 8, 10, 3);
  // 柄
  ctx.fillStyle = '#5d4037';
  ctx.fillRect(-1.5, 11, 3, 10);
  ctx.restore();
}

// ============================================================
// Boss - 多阶段
// ============================================================
class Boss extends Enemy {
  constructor(x, y) {
    super(x, y, {
      name: '暗影之王', color: '#1a1a2e', eyeColor: '#e74c3c',
      hp: 600, atk: 22, def: 10, exp: 200, gold: 200,
      elite: true, w: 60, h: 80
    });
    this.phase = 1;
    this.skillCd = 0;
    this.summonCd = 0;
    this.dashCd = 0;
  }

  handleDeath() {
    player.gainExp(this.exp);
    player.gold += this.gold;
    // 胜利
    setTimeout(() => gameWin(), 2000);
    // 大爆金币
    for (let i = 0; i < 12; i++) {
      pickups.push(makePickup(this.x + rand(-50, 50), this.y + rand(-50, 50), 'gold', randInt(80, 150)));
    }
    // 药水补给
    for (let i = 0; i < 3; i++) {
      pickups.push(makePickup(this.x + rand(-40, 40), this.y + rand(-40, 40),
        Math.random() < 0.5 ? 'potion' : 'mpotion'));
    }
    // 在 Boss 位置生成金色传说宝箱（开启后可获得 2-3 件传说装备 + 1 件史诗）
    window._bossChest = {
      x: this.x + this.w/2 - TILE/2,
      y: this.y + this.h/2 - TILE/2,
      opened: false,
      rarity: 'legendary',
      type: 'boss_reward'
    };
    spawnDamageNum(this.x + this.w/2, this.y - 40, '传说宝箱出现!', '#f39c12');
    for (let i = 0; i < 60; i++) {
      particles.push(new Particle(
        this.x + this.w/2, this.y + this.h/2,
        (Math.random()-0.5)*12, (Math.random()-0.5)*12,
        choose(['#f1c40f', '#e74c3c', '#9b59b6', '#fff', '#f39c12']),
        60, 5));
    }
    shake(20, 40);
  }

  update() {
    if (!player.alive) return;
    // 阶段判定
    const ratio = this.hp / this.maxHp;
    if (ratio < 0.6 && this.phase === 1) {
      this.phase = 2;
      this.atk += 6;
      spawnDamageNum(this.x + this.w/2, this.y, '第二阶段!', '#e74c3c');
      for (let i = 0; i < 30; i++) {
        particles.push(new Particle(this.x + this.w/2, this.y + this.h/2,
          (Math.random()-0.5)*8, (Math.random()-0.5)*8,
          '#e74c3c', 40, 5));
      }
    }
    if (ratio < 0.3 && this.phase === 2) {
      this.phase = 3;
      this.atk += 8;
      this.speed += 0.5;
      spawnDamageNum(this.x + this.w/2, this.y, '狂暴!', '#f00');
      shake(10, 20);
    }

    super.update();
    if (!this.alive) return;

    // Boss 技能
    if (this.skillCd > 0) this.skillCd--;
    if (this.dashCd > 0) this.dashCd--;
    if (this.summonCd > 0) this.summonCd--;

    if (this.skillCd === 0 && this.phase >= 2) {
      // 弹幕技能
      const dx = (player.x + player.w/2) - (this.x + this.w/2);
      const dy = (player.y + player.h/2) - (this.y + this.h/2);
      const d = Math.hypot(dx, dy) || 1;
      const baseA = Math.atan2(dy, dx);
      const count = this.phase === 3 ? 12 : 8;
      for (let i = 0; i < count; i++) {
        const a = baseA + (i - count/2) * 0.15;
        projectiles.push(new Projectile(
          this.x + this.w/2, this.y + this.h/2,
          Math.cos(a) * 4, Math.sin(a) * 4,
          'enemy', 12, 6, false, true
        ));
      }
      this.skillCd = 200;
    }

    if (this.summonCd === 0 && this.phase >= 3) {
      // 召唤小怪
      const r = ROOMS[ROOMS.length - 1];
      for (let i = 0; i < 2; i++) {
        enemies.push(makeEnemy(
          (r.x + randInt(2, r.w - 2)) * TILE,
          (r.y + randInt(2, r.h - 2)) * TILE,
          'normal'
        ));
      }
      spawnDamageNum(this.x + this.w/2, this.y, '召唤!', '#9b59b6');
      this.summonCd = 400;
    }
  }

  drawSprite() {
    const cx = this.x + this.w/2, cy = this.y + this.h/2;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(cx, this.y + this.h - 3, 32, 8, 0, 0, Math.PI*2); ctx.fill();

    // 暗影光环
    const pulse = 0.6 + Math.sin(this.animTime * 0.08) * 0.4;
    const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 60);
    grad.addColorStop(0, `rgba(231, 76, 60, ${pulse * 0.5})`);
    grad.addColorStop(1, 'rgba(231, 76, 60, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI*2); ctx.fill();

    // 身体 - 大型
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.phase === 3 ? '#e74c3c' : '#6c3483';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 王冠
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy - 30);
    ctx.lineTo(cx - 20, cy - 50);
    ctx.lineTo(cx - 10, cy - 35);
    ctx.lineTo(cx, cy - 55);
    ctx.lineTo(cx + 10, cy - 35);
    ctx.lineTo(cx + 20, cy - 50);
    ctx.lineTo(cx + 30, cy - 30);
    ctx.closePath();
    ctx.fill();

    // 眼睛
    ctx.fillStyle = this.eyeColor;
    ctx.shadowColor = this.eyeColor;
    ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(cx - 14, cy - 5, 6, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 14, cy - 5, 6, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(cx - 14, cy - 5, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 14, cy - 5, 3, 0, Math.PI*2); ctx.fill();

    // 嘴
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy + 15, 15, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // 阶段2+ 特效
    if (this.phase >= 2) {
      for (let i = 0; i < 3; i++) {
        const a = this.animTime * 0.05 + i * Math.PI * 2 / 3;
        ctx.fillStyle = 'rgba(231, 76, 60, 0.6)';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 50, cy + Math.sin(a) * 50, 6, 0, Math.PI*2);
        ctx.fill();
      }
    }
    if (this.phase >= 3) {
      // 狂暴火焰
      for (let i = 0; i < 5; i++) {
        const a = (Math.PI * 2 / 5) * i + this.animTime * 0.1;
        const r = 45 + Math.sin(this.animTime * 0.2) * 5;
        ctx.fillStyle = `rgba(255, ${100 + Math.random()*100}, 0, 0.7)`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4 + Math.random()*3, 0, Math.PI*2);
        ctx.fill();
      }
    }

    // 名字 + 阶段
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.name + ' [阶段'+this.phase+']', cx, cy - 55);
  }
}


// ============================================================
// 投射物 / 粒子 / 物品
// ============================================================
class Projectile {
  constructor(x, y, vx, vy, type, damage, radius, piercing = false, isEnemy = false) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.type = type; this.damage = damage; this.r = radius;
    this.alive = true; this.life = 200;
    this.piercing = piercing; this.isEnemy = isEnemy;
    this.animTime = 0;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
    this.animTime++;
    if (this.life <= 0) this.alive = false;
    if (isBlocked(this.x, this.y, 4, 4)) {
      this.alive = false;
      this.onHit && this.onHit();
      for (let i = 0; i < 6; i++) {
        particles.push(new Particle(this.x, this.y,
          (Math.random()-0.5)*3, (Math.random()-0.5)*3,
          this.type === 'fire' ? '#e67e22' :
          this.type === 'ice' ? '#5dade2' :
          this.type === 'thunder' ? '#f1c40f' : '#aaa',
          15, 3));
      }
      return;
    }
    if (this.isEnemy) {
      if (aabb({x:this.x-this.r, y:this.y-this.r, w:this.r*2, h:this.r*2}, player)) {
        player.takeDamage(this.damage, this.x - this.vx, this.y - this.vy);
        this.alive = false;
      }
    } else {
      for (const e of enemies) {
        if (!e.alive) continue;
        if (aabb({x:this.x-this.r, y:this.y-this.r, w:this.r*2, h:this.r*2}, e)) {
          const wasAlive = e.alive;
          e.takeDamage(this.damage, this.x - this.vx, this.y - this.vy);
          if (!this.piercing) this.alive = false;
          // 技能命中也要有顿帧（比普攻略短，技能本身已有画面表现）
          addHitStop(wasAlive && !e.alive ? HITSTOP.kill : 2);
          for (let i = 0; i < 4; i++) {
            particles.push(new Particle(this.x, this.y,
              (Math.random()-0.5)*4, (Math.random()-0.5)*4,
              this.type === 'fire' ? '#e74c3c' :
              this.type === 'ice' ? '#85c1e9' :
              this.type === 'thunder' ? '#fff700' : '#fff',
              12, 3));
          }
          break;
        }
      }
    }
  }
  draw() {
    const sx = this.x - camera.x, sy = this.y - camera.y;
    if (this.type === 'fire') {
      ctx.shadowColor = '#e74c3c'; ctx.shadowBlur = 20;
      ctx.fillStyle = '#e67e22';
      ctx.beginPath(); ctx.arc(sx, sy, this.r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#f39c12';
      ctx.beginPath(); ctx.arc(sx, sy, this.r * 0.6, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(sx, sy, this.r * 0.3, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (this.type === 'ice') {
      ctx.shadowColor = '#3498db'; ctx.shadowBlur = 15;
      ctx.fillStyle = '#5dade2';
      ctx.beginPath(); ctx.arc(sx, sy, this.r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(sx-2, sy-2, this.r*0.4, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (this.type === 'thunder') {
      // 闪电从天而降
      ctx.strokeStyle = '#fff700';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#f1c40f'; ctx.shadowBlur = 20;
      ctx.beginPath();
      let lx = sx, ly = sy;
      ctx.moveTo(lx, ly);
      for (let i = 0; i < 6; i++) {
        lx += (Math.random()-0.5)*20;
        ly += 30;
        ctx.lineTo(lx, ly);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(sx, sy + 200, 25, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath(); ctx.arc(sx, sy + 200, 15, 0, Math.PI*2); ctx.fill();
    } else if (this.isEnemy) {
      // 敌方弹
      ctx.shadowColor = '#e74c3c'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.arc(sx, sy, this.r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath(); ctx.arc(sx, sy, this.r*0.6, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(sx, sy, this.r, 0, Math.PI*2); ctx.fill();
    }
  }
}

class Particle {
  constructor(x, y, vx, vy, color, life, size) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.color = color; this.life = life; this.maxLife = life;
    this.size = size;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.1;
    this.life--;
  }
  draw() {
    const sx = this.x - camera.x, sy = this.y - camera.y;
    const a = this.life / this.maxLife;
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(sx, sy, this.size * a, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function makePickup(x, y, type, amount) {
  return { x, y, type, amount: amount || 0, w: 16, h: 16, life: type === 'chest_reward' ? 1200 : 600 };
}

function drawPickup(p) {
  const sx = p.x - camera.x, sy = p.y - camera.y;
  // 浮动效果
  const off = Math.sin(Date.now() / 200 + p.x) * 3;
  if (p.type === 'gold') {
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath(); ctx.arc(sx, sy + off, 8, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#e67e22';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('G', sx, sy + off + 4);
  } else if (p.type === 'potion') {
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(sx - 4, sy + off - 4, 8, 12);
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx - 3, sy + off - 7, 6, 4);
  } else if (p.type === 'mpotion') {
    ctx.fillStyle = '#3498db';
    ctx.fillRect(sx - 4, sy + off - 4, 8, 12);
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx - 3, sy + off - 7, 6, 4);
  } else if (p.type === 'chest_reward') {
    // 物品
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(sx, sy + off, 14, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = RARITY_COLORS[p.item.rarity];
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    const ic = p.item.kind === 'weapon' ? '⚔' : '🛡';
    ctx.fillText(ic, sx, sy + off + 6);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('E', sx + 10, sy + off + 14);
  }
}

// ============================================================
// 装备 / 物品系统 (随机词条)
// ============================================================
const RARITY_COLORS = {
  common: '#bdc3c7',
  uncommon: '#2ecc71',
  rare: '#3498db',
  epic: '#9b59b6',
  legendary: '#f39c12'
};
const RARITY_NAMES = {
  common: '普通', uncommon: '优秀', rare: '稀有', epic: '史诗', legendary: '传说'
};
const RARITY_MULT = {
  common: 1, uncommon: 1.4, rare: 1.9, epic: 2.6, legendary: 4
};

const WEAPON_PREFIXES = ['锋利的', '锐利的', '古老的', '暗影的', '神圣的', '烈火的', '寒冰的', '迅捷的'];
const ARMOR_PREFIXES = ['坚固的', '轻盈的', '秘银的', '暗影的', '神圣的', '龙鳞的', '光辉的', '守护的'];
const WEAPON_TYPES = [
  { name: '长剑', color: '#bdc3c7', atk: 6, range: 0 },
  { name: '巨剑', color: '#7f8c8d', atk: 12, range: -10 },
  { name: '细剑', color: '#ecf0f1', atk: 4, range: 15 },
  { name: '战斧', color: '#95a5a6', atk: 10, range: -5 },
  { name: '魔杖', color: '#9b59b6', atk: 8, range: 5 },
  { name: '匕首', color: '#34495e', atk: 3, range: -20 }
];
const ARMOR_TYPES = [
  { name: '布甲', color: '#7f8c8d', def: 3 },
  { name: '皮甲', color: '#8b4513', def: 6 },
  { name: '锁甲', color: '#5d6d7e', def: 10 },
  { name: '板甲', color: '#34495e', def: 15 },
  { name: '法袍', color: '#6c3483', def: 8 }
];

// 词条数值定义
// —— 旧设计的坑 ——
// 词条原本写成 { stat:'atk', mul:0.3 } 这样的"倍率"，但 getEquippedBonus() 是
// 直接把它加到属性上的，于是 0.3 被当成 "+0.3 攻击" —— 面板却显示 "+30.3"，
// 数量级错了一个量级，词条实际等于装饰。
// 现在词条统一改成「绝对值」：mul 字段保留以兼容旧存档，但真正的数值由
// rollAffix() 按稀有度掷出，落在 value 字段上，单位与属性一致。
// 例：atk 词条 value=4 表示 "+4 攻击"，maxHp 词条 value=25 表示 "+25 生命上限"。
const AFFIX_LABEL_NAMES = {
  atk: '攻击力', def: '防御力', maxHp: '生命上限',
  maxMp: '魔法上限', speed: '移动速度', crit: '暴击率',
  lifesteal: '吸血', cdr: '冷却缩减'
};

// 各槽位可出的词条池。weight 是抽中权重，range 是掷点区间。
const AFFIX_POOL = {
  weapon: [
    { stat: 'atk', weight: 10, min: 2, max: 6 },
    { stat: 'crit', weight: 4, min: 3, max: 8 },
    { stat: 'lifesteal', weight: 3, min: 2, max: 5 }
  ],
  armor: [
    { stat: 'def', weight: 10, min: 3, max: 8 },
    { stat: 'maxHp', weight: 8, min: 15, max: 40 },
    { stat: 'cdr', weight: 2, min: 2, max: 6 }
  ],
  head: [
    { stat: 'def', weight: 8, min: 2, max: 5 },
    { stat: 'maxHp', weight: 7, min: 10, max: 30 },
    { stat: 'maxMp', weight: 4, min: 8, max: 25 }
  ],
  gloves: [
    { stat: 'atk', weight: 7, min: 1, max: 4 },
    { stat: 'crit', weight: 4, min: 2, max: 6 },
    { stat: 'cdr', weight: 3, min: 2, max: 5 }
  ],
  boots: [
    { stat: 'speed', weight: 10, min: 2, max: 6 },
    { stat: 'def', weight: 6, min: 2, max: 5 },
    { stat: 'maxHp', weight: 5, min: 8, max: 25 }
  ],
  amulet: [
    { stat: 'atk', weight: 7, min: 2, max: 6 },
    { stat: 'def', weight: 6, min: 2, max: 6 },
    { stat: 'maxHp', weight: 6, min: 12, max: 35 },
    { stat: 'maxMp', weight: 5, min: 10, max: 28 },
    { stat: 'crit', weight: 3, min: 2, max: 6 }
  ]
};

// 装备类型定义（按槽位分类）
const EQUIP_SLOTS = ['weapon', 'armor', 'head', 'gloves', 'boots', 'amulet'];
const SLOT_ICONS = {
  weapon: '⚔', armor: '🛡', head: '⛑',
  gloves: '🧤', boots: '🥾', amulet: '📿'
};
const SLOT_NAMES = {
  weapon: '武器', armor: '护甲', head: '头部',
  gloves: '手套', boots: '靴子', amulet: '项链'
};

// 各槽位装备模板
const EQUIP_TEMPLATES = {
  weapon: [
    { name: '长剑', color: '#bdc3c7', atk: 6, range: 0 },
    { name: '巨剑', color: '#7f8c8d', atk: 12, range: -10 },
    { name: '细剑', color: '#ecf0f1', atk: 4, range: 15 },
    { name: '战斧', color: '#95a5a6', atk: 10, range: -5 },
    { name: '魔杖', color: '#9b59b6', atk: 8, range: 5 },
    { name: '匕首', color: '#34495e', atk: 3, range: -20 }
  ],
  armor: [
    { name: '布甲', color: '#7f8c8d', atk: 0, def: 3 },
    { name: '皮甲', color: '#8b4513', atk: 0, def: 6 },
    { name: '锁甲', color: '#5d6d7e', atk: 0, def: 10 },
    { name: '板甲', color: '#34495e', atk: 0, def: 15 },
    { name: '法袍', color: '#6c3483', atk: 1, def: 8 }
  ],
  head: [
    { name: '皮帽', color: '#8b4513', atk: 0, def: 2 },
    { name: '战盔', color: '#5d6d7e', atk: 0, def: 5 },
    { name: '法师帽', color: '#6c3483', atk: 2, def: 2 },
    { name: '皇冠', color: '#f1c40f', atk: 1, def: 3 }
  ],
  gloves: [
    { name: '护腕', color: '#7f8c8d', atk: 1, def: 1 },
    { name: '铁手套', color: '#5d6d7e', atk: 2, def: 2 },
    { name: '龙鳞手套', color: '#16a085', atk: 3, def: 2 }
  ],
  boots: [
    { name: '皮靴', color: '#8b4513', atk: 0, def: 1, speed: 0.2 },
    { name: '铁靴', color: '#5d6d7e', atk: 0, def: 3 },
    { name: '迅捷之靴', color: '#3498db', atk: 0, def: 1, speed: 0.5 }
  ],
  amulet: [
    { name: '生命护符', color: '#e74c3c', atk: 0, def: 0, hp: 15 },
    { name: '魔力项链', color: '#3498db', atk: 0, def: 0, mp: 10 },
    { name: '力量护符', color: '#e67e22', atk: 3, def: 0 }
  ]
};

// 词条池（按槽位可用的）—— 见 AFFIX_POOL 定义
function getAffixesForSlot(slot) {
  return AFFIX_POOL[slot] || AFFIX_POOL.armor;
}

// 按稀有度掷出一条词条的具体数值
// 稀有度越高，同一条词条掷出的数值越大（普通=下限附近，传说=接近上限）
function rollAffixValue(def, rarity) {
  const rarityRoll = { common: 0.35, uncommon: 0.55, rare: 0.75, epic: 0.9, legendary: 1.0 };
  const roll = Math.random() * (rarityRoll[rarity] || 0.5);
  const raw = def.min + (def.max - def.min) * roll;
  // 暴击/吸血/冷却是百分比 → 取整并限制上限
  if (def.stat === 'crit' || def.stat === 'lifesteal' || def.stat === 'cdr')
    return Math.min(def.max, Math.round(raw));
  // 速度是小数 → 保留 1 位
  if (def.stat === 'speed') return Math.round(raw * 10) / 10;
  return Math.round(raw);
}

// 生成一条词条对象（带显示用的 label）
function makeAffix(def, rarity) {
  const value = rollAffixValue(def, rarity);
  const name = AFFIX_LABEL_NAMES[def.stat] || def.stat;
  const isPct = def.stat === 'crit' || def.stat === 'lifesteal' || def.stat === 'cdr';
  return {
    stat: def.stat,
    value: value,
    label: `${name} +${value}${isPct ? '%' : ''}`
  };
}

// 由词条对象算出显示文案（兼容旧存档：只有 mul、没有 value/label）
function affixLabel(a) {
  if (a.label) return a.label;
  const name = AFFIX_LABEL_NAMES[a.stat] || a.stat;
  const v = (a.value !== undefined && a.value !== null) ? a.value : Math.round((a.mul || 0) * 10);
  const isPct = a.stat === 'crit' || a.stat === 'lifesteal' || a.stat === 'cdr';
  return `${name} +${v}${isPct ? '%' : ''}`;
}

function generateItem(rarity) {
  // 随机选一个槽位 — 武器/护甲 概率稍高
  const roll = Math.random();
  let slot;
  if (roll < 0.30) slot = 'weapon';
  else if (roll < 0.55) slot = 'armor';
  else if (roll < 0.65) slot = 'head';
  else if (roll < 0.75) slot = 'gloves';
  else if (roll < 0.85) slot = 'boots';
  else slot = 'amulet';

  const templates = EQUIP_TEMPLATES[slot];
  const t = choose(templates);
  const prefix = choose(WEAPON_PREFIXES);
  const item = {
    kind: slot,
    name: prefix + t.name,
    color: t.color,
    rarity: upgradeRarity(rarity),
    atk: t.atk || 0,
    def: t.def || 0,
    range: t.range || 0
  };
  if (t.speed) item.speed = t.speed;
  if (t.hp) item.hp = t.hp;
  if (t.mp) item.mp = t.mp;

  // 附加词条
  const numAffix = item.rarity === 'legendary' ? 3 :
                   item.rarity === 'epic' ? 2 :
                   item.rarity === 'rare' ? 2 :
                   item.rarity === 'uncommon' ? 1 : 0;
  item.affixes = [];
  const used = new Set();
  const affixPool = getAffixesForSlot(slot);
  for (let i = 0; i < numAffix; i++) {
    // 按权重抽词条类型，同一属性不重复
    const avail = affixPool.filter(a => !used.has(a.stat));
    if (!avail.length) break;
    const totalWeight = avail.reduce((s, a) => s + a.weight, 0);
    let r = Math.random() * totalWeight;
    let picked = avail[avail.length - 1];
    for (const a of avail) {
      r -= a.weight;
      if (r <= 0) { picked = a; break; }
    }
    used.add(picked.stat);
    item.affixes.push(makeAffix(picked, item.rarity));
  }
  // 应用稀有度倍率
  const mult = RARITY_MULT[item.rarity];
  item.atk = Math.floor(item.atk * mult);
  item.def = Math.floor(item.def * mult);
  if (item.hp) item.hp = Math.floor(item.hp * mult);
  if (item.mp) item.mp = Math.floor(item.mp * mult);
  // 套装标记（约 30~55% 的装备是套装装备，核心部位概率更高）
  maybeAssignSet(item);
  // 套装装备的名字带上套装名（让玩家一眼认出这是哪套的）
  if (item.setId && SETS[item.setId]) {
    const s = SETS[item.setId];
    item.name = `${s.icon}${s.name}·${item.name}`;
  }
  return item;
}

function upgradeRarity(r) {
  if (r === 'epic' && Math.random() < 0.1) return 'legendary';
  return r;
}

// 汇总所有已装备装备的属性加成
// —— 这里是「装备到底有没有用」的唯一真相来源 ——
// 战斗里的每个数值都必须经过本函数读取，装备才会真正影响玩法。
function getEquippedBonus() {
  let atk = 0, def = 0, speed = 0, range = 0, hp = 0, mp = 0, crit = 0, lifesteal = 0, cdr = 0;
  for (const slot of EQUIP_SLOTS) {
    const it = player.equipped[slot];
    if (!it) continue;
    atk += it.atk || 0;
    def += it.def || 0;
    if (it.speed) speed += it.speed;
    if (it.range) range += it.range;
    if (it.hp) hp += it.hp;
    if (it.mp) mp += it.mp;
    if (it.affixes) {
      for (const a of it.affixes) {
        // 兼容旧存档：老词条只有 mul（小数倍率），没有 value
        // 老词条按合理量级折算，避免 +0.3 攻击这种废值
        const v = (a.value !== undefined && a.value !== null) ? a.value : (a.mul || 0) * 10;
        switch (a.stat) {
          case 'atk':    atk += v; break;
          case 'def':    def += v; break;
          case 'speed':  speed += v; break;
          case 'maxHp':  hp += v; break;
          case 'maxMp':  mp += v; break;
          case 'crit':   crit += v; break;
          case 'lifesteal': lifesteal += v; break;
          case 'cdr':    cdr += v; break;
        }
      }
    }
  }
  // —— 套装百分比 ——
  // 注意：生命/魔法/攻击/防御/速度的套装百分比**不在这里**应用。
  // 套装百分比必须作用在「基础 + 装备」的总量上，
  // 若只作用在装备那部分，玩家基础 120 血不会受益，
  // "生命 +30%" 实际只加了几十点 —— 看起来像没生效。
  // 因此百分比统一在 Player.total* 访问器里对总量计算。
  // 这里只并入「没有基础值」的扁平成长属性。
  const sb = getActiveSetBonuses();
  crit += sb.crit;
  lifesteal += sb.lifesteal;
  cdr += sb.cdr;
  return { atk, def, speed, range, hp, mp, crit, lifesteal, cdr };
}

function addToInventory(item) {
  const idx = player.inventory.findIndex(s => s === null);
  if (idx >= 0) { player.inventory[idx] = item; return true; }
  // 背包满了：不再把装备直接丢掉（旧行为是「凭空消失」，玩家白打一场）
  // 改为自动装备（若该槽位有更好的）或明确提示并保留掉落物
  const slot = item.kind;
  const cur = player.equipped[slot];
  if (!cur || itemPower(item) > itemPower(cur)) {
    // 换下旧的放进背包（若有空位），装上新的
    if (cur) {
      const free = player.inventory.findIndex(s => s === null);
      if (free >= 0) player.inventory[free] = cur;
      else player.equipped[slot] = cur;   // 背包也没位 → 保持旧装备，丢弃新装备
    }
    player.equipped[slot] = item;
    player.invalidateBonus();
    spawnDamageNum(player.x, player.y, '自动装备 ' + item.name, RARITY_COLORS[item.rarity]);
    return true;
  }
  // 现有更好 → 掉落物保留在地面（不销毁），玩家可以稍后再捡
  spawnDamageNum(player.x, player.y, '背包已满!', '#e74c3c');
  return false;
}

// 装备「战力」估值：用于比较两件装备谁更好
function itemPower(item) {
  if (!item) return 0;
  const rarityOrder = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };
  let p = (rarityOrder[item.rarity] || 1) * 100;
  p += (item.atk || 0) * 4 + (item.def || 0) * 4 + (item.hp || 0) * 0.5 +
       (item.mp || 0) * 0.5 + (item.speed || 0) * 20 + (item.range || 0);
  for (const a of (item.affixes || [])) {
    const v = (a.value !== undefined && a.value !== null) ? a.value : (a.mul || 0) * 10;
    p += v * 3;
  }
  return p;
}

function equipItem(slot) {
  const item = player.inventory[slot];
  if (!item) return;
  // 卸下当前
  const cur = player.equipped[item.kind];
  if (cur) player.inventory[slot] = cur;
  else player.inventory[slot] = null;
  player.equipped[item.kind] = item;
  // 装备变了 → 加成缓存失效
  player.invalidateBonus();
  spawnDamageNum(player.x, player.y, '装备: ' + item.name, RARITY_COLORS[item.rarity]);
}

function renderInventoryPanel() {
  const panel = document.getElementById('inv-grid');
  panel.innerHTML = '';
  for (let i = 0; i < player.inventory.length; i++) {
    const item = player.inventory[i];
    const div = document.createElement('div');
    div.className = 'inv-slot';
    if (item) {
      div.style.borderColor = RARITY_COLORS[item.rarity];
      div.textContent = item.kind === 'weapon' ? '⚔' :
                        item.kind === 'armor'  ? '🛡' :
                        item.kind === 'head'   ? '👑' :
                        item.kind === 'gloves' ? '🧤' :
                        item.kind === 'boots'  ? '🥾' :
                        item.kind === 'amulet' ? '📿' : '❓';
      div.title = item.name;
      div.onclick = () => {
        equipItem(i);
        renderInventoryPanel();
        // 同步刷新角色面板（如果开着）
        const cp = document.getElementById('character-panel');
        if (cp.classList.contains('active')) renderCharacterPanel();
      };
      div.dataset.item = JSON.stringify(item);
    } else {
      div.textContent = '';
    }
    panel.appendChild(div);
  }
}

// ============================================================
// 角色装备面板
// ============================================================
function drawHeroPortrait() {
  const canvas = document.getElementById('char-portrait-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  c.clearRect(0, 0, W, H);

  // 背景渐变
  const bg = c.createRadialGradient(W/2, H*0.6, 20, W/2, H*0.6, W*0.6);
  bg.addColorStop(0, 'rgba(241,196,15,0.25)');
  bg.addColorStop(0.5, 'rgba(108,52,131,0.2)');
  bg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  // 立绘绘制：缩放 3.2x，居中。
  // 共享立绘高度约 86px，86*3.2 ≈ 275，脚底放在 y=255，
  // 头顶落在 y=-20 左右，刚好放在画布内。
  c.save();
  c.translate(W/2, 255);
  c.scale(3.2, 3.2);
  drawHeroSpriteDirect(c, player);
  c.restore();
}

// 共享的英雄立绘绘制函数。
// 同一个绘制代码同时供 Player.drawSprite（游戏世界，scale=1）和
// 角色面板 drawHeroPortrait（大立绘，scale=4）使用。
// 约定：(ctx, p, cx, baseY, scale)
//   - ctx:    canvas 2D context
//   - p:      Player 实例（用来读取 equipped 等状态）
//   - cx:     角色中心 x（世界坐标系用玩家中心；面板用 0）
//   - baseY:  脚底 y（玩家就是 this.y + this.h）
//   - scale:  整体缩放系数；面板 4、世界 1
//   - facing: 1 朝右，-1 朝左（镜像武器/盾）
//   - viewMode: 'side' 侧身 | 'front' 正面(朝下) | 'back' 背面(朝上)
// 所有坐标都是「以脚底为基准、向上为负」的局部坐标，scale 由调用方
// 提前 ctx.save/scale/restore 包好。本函数不缩放，只画。
function drawHeroArt(ctx, p, cx, baseY, scale, facing, viewMode) {
  facing = facing || 1;
  viewMode = viewMode || 'side';

  // ===== 调色板（蓝白金经典勇者） =====
  const COL = {
    skin:     '#fcd9b6',
    skinDark: '#e8b894',
    hair:     '#5b8fb9',
    hairDk:   '#3a6b94',
    armor:    '#e8eef5',
    armorDk:  '#9ba8b8',
    armorHi:  '#ffffff',
    trim:     '#fbbf24',
    trimDk:   '#b07b0a',
    cape:     '#2563eb',
    capeDk:   '#1e3a8a',
    capeLt:   '#60a5fa',
    boot:     '#5d4037',
    bootHi:   '#8b6f47',
    bootDk:   '#3e2723',
    bootTip:  '#fbbf24',
    glove:    '#f3f4f6',
    pants:    '#3a5a8c',
    pantsDk:  '#1e3a8a',
    sword:    '#e2e8f0',
    swordHi:  '#ffffff',
    swordGrip:'#7c2d12',
    shield:   '#dc2626',
    shieldDk: '#991b1b',
    shieldHi: '#fbbf24',
    eye:      '#1e3a8a',
    mouth:    '#7c2d12',
    brow:     '#3a6b94',
  };

  // 装备颜色覆盖
  const armorCol = (p.equipped.armor && p.equipped.armor.color) || COL.armor;
  const bootCol  = (p.equipped.boots  && p.equipped.boots.color)  || COL.boot;
  const gloveCol = (p.equipped.gloves && p.equipped.gloves.color) || COL.glove;
  const headItem = p.equipped.head;
  const amulet   = p.equipped.amulet;
  const weapon   = p.equipped.weapon;

  // 比例参考（baseY=脚底，往上是负数）
  const legTop    = baseY - 28;
  const waistY    = baseY - 28;
  const shoulderY = baseY - 56;
  const neckY     = baseY - 60;
  const headCY    = baseY - 73;

  // 待机呼吸 + 步行步伐
  const t = p.animTime || 0;
  const breath  = Math.sin(t * 0.06) * 0.6;
  const step    = Math.sin(t * 0.18);
  const stepFast= Math.sin(t * 0.36);
  const capeWave= Math.sin(t * 0.10) * 1.5;

  // 1. 披风（背部，不遮腿）
  //    背面视图时披风要盖住身体，所以在函数末尾补画一次（见 backCape 段）
  if (viewMode !== 'back') {
  ctx.fillStyle = COL.capeDk;
  ctx.beginPath();
  ctx.moveTo(cx - 13, shoulderY + 2 + breath);
  ctx.lineTo(cx + 13, shoulderY + 2 + breath);
  ctx.lineTo(cx + 16 + capeWave, waistY + 6);
  ctx.lineTo(cx - 16 - capeWave, waistY + 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COL.cape;
  ctx.beginPath();
  ctx.moveTo(cx - 11, shoulderY + 4 + breath);
  ctx.lineTo(cx + 11, shoulderY + 4 + breath);
  ctx.lineTo(cx + 14 + capeWave * 0.8, waistY + 5);
  ctx.lineTo(cx - 14 - capeWave * 0.8, waistY + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COL.capeLt;
  ctx.beginPath();
  ctx.moveTo(cx - 3, shoulderY + 6 + breath);
  ctx.lineTo(cx + 3, shoulderY + 6 + breath);
  ctx.lineTo(cx + 5, waistY + 4);
  ctx.lineTo(cx - 5, waistY + 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COL.trim;
  ctx.beginPath();
  ctx.arc(cx, shoulderY + 4, 2, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.trimDk;
  ctx.beginPath();
  ctx.arc(cx, shoulderY + 4, 0.9, 0, Math.PI*2);
  ctx.fill();
  } // end 披风（背面时跳过，最后补画）

  // 2. 双腿（步伐错开）
  const liftL = step > 0 ? step * 2 : 0;
  // 左腿
  ctx.fillStyle = COL.pants;
  ctx.fillRect(cx - 11, legTop + liftL, 9, 22 - liftL);
  ctx.fillStyle = COL.pantsDk;
  ctx.fillRect(cx - 4, legTop + liftL, 2, 22 - liftL);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(cx - 11, legTop + liftL, 2, 22 - liftL);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(cx - 11, legTop + 6 + liftL, 9, 1.5);
  ctx.fillStyle = bootCol;
  ctx.fillRect(cx - 12, baseY - 14 + liftL, 11, 14 - liftL);
  ctx.fillStyle = COL.bootHi;
  ctx.fillRect(cx - 12, baseY - 14 + liftL, 11, 1.5);
  ctx.fillStyle = COL.bootDk;
  ctx.fillRect(cx - 12, baseY - 6 + liftL, 11, 6);
  ctx.fillStyle = bootCol;
  ctx.beginPath();
  ctx.moveTo(cx - 12, baseY - 8 + liftL);
  ctx.lineTo(cx - 14, baseY - 2 + liftL);
  ctx.lineTo(cx - 1,  baseY - 2 + liftL);
  ctx.lineTo(cx - 1,  baseY - 8 + liftL);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COL.bootTip;
  ctx.beginPath();
  ctx.arc(cx - 10, baseY - 4 + liftL, 0.9, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.trim;
  ctx.fillRect(cx - 12, baseY - 14 + liftL, 11, 1.5);

  const liftR = step < 0 ? -step * 2 : 0;
  // 右腿
  ctx.fillStyle = COL.pants;
  ctx.fillRect(cx + 2, legTop + liftR, 9, 22 - liftR);
  ctx.fillStyle = COL.pantsDk;
  ctx.fillRect(cx + 9, legTop + liftR, 2, 22 - liftR);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(cx + 2, legTop + liftR, 2, 22 - liftR);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(cx + 2, legTop + 6 + liftR, 9, 1.5);
  ctx.fillStyle = bootCol;
  ctx.fillRect(cx + 1, baseY - 14 + liftR, 11, 14 - liftR);
  ctx.fillStyle = COL.bootHi;
  ctx.fillRect(cx + 1, baseY - 14 + liftR, 11, 1.5);
  ctx.fillStyle = COL.bootDk;
  ctx.fillRect(cx + 1, baseY - 6 + liftR, 11, 6);
  ctx.fillStyle = bootCol;
  ctx.beginPath();
  ctx.moveTo(cx + 1,  baseY - 8 + liftR);
  ctx.lineTo(cx + 14, baseY - 2 + liftR);
  ctx.lineTo(cx + 12, baseY - 2 + liftR);
  ctx.lineTo(cx + 12, baseY - 8 + liftR);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COL.bootTip;
  ctx.beginPath();
  ctx.arc(cx + 11, baseY - 4 + liftR, 0.9, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.trim;
  ctx.fillRect(cx + 1, baseY - 14 + liftR, 11, 1.5);

  // 3. 躯干
  ctx.fillStyle = armorCol;
  ctx.beginPath();
  ctx.moveTo(cx - 15, shoulderY + breath);
  ctx.lineTo(cx + 15, shoulderY + breath);
  ctx.lineTo(cx + 13, waistY);
  ctx.lineTo(cx - 13, waistY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COL.armorDk;
  ctx.beginPath();
  ctx.moveTo(cx + 4, shoulderY + breath);
  ctx.lineTo(cx + 15, shoulderY + breath);
  ctx.lineTo(cx + 13, waistY);
  ctx.lineTo(cx + 6, waistY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COL.armorHi;
  ctx.beginPath();
  ctx.moveTo(cx - 15, shoulderY + breath);
  ctx.lineTo(cx - 6, shoulderY + breath);
  ctx.lineTo(cx - 10, waistY);
  ctx.lineTo(cx - 13, waistY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COL.trim;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 7, shoulderY + 2);
  ctx.lineTo(cx, waistY - 6);
  ctx.lineTo(cx + 7, shoulderY + 2);
  ctx.stroke();
  ctx.fillStyle = COL.trim;
  ctx.beginPath();
  ctx.arc(cx, waistY - 12, 3, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.shield;
  ctx.beginPath();
  ctx.arc(cx, waistY - 12, 1.8, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.armorHi;
  ctx.beginPath();
  ctx.arc(cx - 0.5, waistY - 12.5, 0.6, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.trimDk;
  ctx.fillRect(cx - 13, waistY - 1, 26, 3);
  ctx.fillStyle = COL.trim;
  ctx.fillRect(cx - 13, waistY - 1, 26, 1);
  ctx.fillStyle = COL.trim;
  ctx.fillRect(cx - 2, waistY - 2, 4, 5);
  ctx.fillStyle = COL.trimDk;
  ctx.fillRect(cx - 1, waistY - 1, 2, 3);

  // 4. 肩甲
  ctx.fillStyle = COL.armorDk;
  ctx.beginPath();
  ctx.ellipse(cx - 16, shoulderY + 4, 6.5, 5, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = armorCol;
  ctx.beginPath();
  ctx.ellipse(cx - 17, shoulderY + 3, 5, 4, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.trim;
  ctx.beginPath();
  ctx.ellipse(cx - 17, shoulderY + 3, 2.5, 1.5, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.armorDk;
  ctx.beginPath();
  ctx.ellipse(cx + 16, shoulderY + 4, 6.5, 5, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = armorCol;
  ctx.beginPath();
  ctx.ellipse(cx + 17, shoulderY + 3, 5, 4, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.trim;
  ctx.beginPath();
  ctx.ellipse(cx + 17, shoulderY + 3, 2.5, 1.5, 0, 0, Math.PI*2);
  ctx.fill();

  // 5. 颈部
  ctx.fillStyle = COL.skin;
  ctx.fillRect(cx - 3.5, neckY, 7, 5);
  ctx.fillStyle = COL.skinDark;
  ctx.fillRect(cx - 3.5, neckY + 3, 7, 2);

  // 6. 头部
  if (viewMode === 'back') {
    // —— 背面视图：整颗头都是头发，看不到脸 ——
    // 后脑勺（深色底）
    ctx.fillStyle = COL.hairDk;
    ctx.beginPath();
    ctx.ellipse(cx, headCY, 13, 15, 0, 0, Math.PI*2);
    ctx.fill();
    // 头发主体
    ctx.fillStyle = COL.hair;
    ctx.beginPath();
    ctx.ellipse(cx, headCY - 1, 12, 13, 0, 0, Math.PI*2);
    ctx.fill();
    // 后脑高光
    ctx.fillStyle = COL.capeLt;
    ctx.beginPath();
    ctx.ellipse(cx - 4, headCY - 5, 4, 5, -0.3, 0, Math.PI*2);
    ctx.fill();
    // 发旋
    ctx.strokeStyle = COL.hairDk;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx + 1, headCY - 6, 3, 0, Math.PI*2);
    ctx.stroke();
    // 后脑发梢（延伸到肩甲）
    ctx.fillStyle = COL.hair;
    ctx.beginPath();
    ctx.moveTo(cx - 10, headCY - 4);
    ctx.quadraticCurveTo(cx - 15, headCY + 6, cx - 12, shoulderY + 6);
    ctx.lineTo(cx - 8, shoulderY + 4);
    ctx.lineTo(cx - 7, headCY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COL.hairDk;
    ctx.beginPath();
    ctx.moveTo(cx - 12, headCY - 2);
    ctx.quadraticCurveTo(cx - 14, headCY + 6, cx - 11, shoulderY + 4);
    ctx.lineTo(cx - 9, shoulderY + 2);
    ctx.lineTo(cx - 9, headCY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COL.hair;
    ctx.beginPath();
    ctx.moveTo(cx + 10, headCY - 4);
    ctx.quadraticCurveTo(cx + 15, headCY + 6, cx + 12, shoulderY + 6);
    ctx.lineTo(cx + 8, shoulderY + 4);
    ctx.lineTo(cx + 7, headCY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COL.hairDk;
    ctx.beginPath();
    ctx.moveTo(cx + 12, headCY - 2);
    ctx.quadraticCurveTo(cx + 14, headCY + 6, cx + 11, shoulderY + 4);
    ctx.lineTo(cx + 9, shoulderY + 2);
    ctx.lineTo(cx + 9, headCY + 3);
    ctx.closePath();
    ctx.fill();
    // 头顶发丝
    ctx.fillStyle = COL.hair;
    ctx.beginPath();
    ctx.moveTo(cx - 10, headCY - 8);
    ctx.quadraticCurveTo(cx - 4, headCY - 3, cx, headCY - 7);
    ctx.quadraticCurveTo(cx + 4, headCY - 3, cx + 10, headCY - 8);
    ctx.lineTo(cx + 8, headCY - 14);
    ctx.quadraticCurveTo(cx, headCY - 18, cx - 8, headCY - 14);
    ctx.closePath();
    ctx.fill();
  } else {
    // —— 侧身 / 正面视图：正常画脸 ——
    ctx.fillStyle = COL.hairDk;
    ctx.beginPath();
    ctx.ellipse(cx, headCY, 13, 15, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = COL.skin;
    ctx.beginPath();
    ctx.ellipse(cx, headCY, 10, 12, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = COL.skinDark;
    ctx.beginPath();
    ctx.ellipse(cx + 4, headCY + 3, 4, 5, 0, 0, Math.PI*2);
    ctx.fill();
  }

  // 长发 / 脸（背面视图跳过：背面已在头部段画过后脑，这里不画侧发与五官）
  if (viewMode !== 'back') {
    // 长发
    ctx.fillStyle = COL.hair;
    ctx.beginPath();
    ctx.moveTo(cx - 10, headCY - 8);
    ctx.quadraticCurveTo(cx - 16, headCY + 4, cx - 13, shoulderY + 6);
    ctx.lineTo(cx - 9, shoulderY + 4);
    ctx.lineTo(cx - 7, headCY + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COL.hairDk;
    ctx.beginPath();
    ctx.moveTo(cx - 12, headCY - 6);
    ctx.quadraticCurveTo(cx - 15, headCY + 4, cx - 12, shoulderY + 4);
    ctx.lineTo(cx - 10, headCY + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COL.hair;
    ctx.beginPath();
    ctx.moveTo(cx + 10, headCY - 8);
    ctx.quadraticCurveTo(cx + 16, headCY + 4, cx + 13, shoulderY + 6);
    ctx.lineTo(cx + 9, shoulderY + 4);
    ctx.lineTo(cx + 7, headCY + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COL.hairDk;
    ctx.beginPath();
    ctx.moveTo(cx + 12, headCY - 6);
    ctx.quadraticCurveTo(cx + 15, headCY + 4, cx + 12, shoulderY + 4);
    ctx.lineTo(cx + 10, headCY + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COL.hair;
    ctx.beginPath();
    ctx.moveTo(cx - 10, headCY - 8);
    ctx.quadraticCurveTo(cx - 4, headCY - 2, cx, headCY - 6);
    ctx.quadraticCurveTo(cx + 4, headCY - 2, cx + 10, headCY - 8);
    ctx.lineTo(cx + 8, headCY - 14);
    ctx.quadraticCurveTo(cx, headCY - 18, cx - 8, headCY - 14);
    ctx.closePath();
    ctx.fill();

    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx - 3.5, headCY, 2, 1.6, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = COL.eye;
    ctx.beginPath();
    ctx.arc(cx - 3.5, headCY, 1.1, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx - 3.5, headCY, 0.5, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - 3.9, headCY - 0.4, 0.3, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx + 3.5, headCY, 2, 1.6, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = COL.eye;
    ctx.beginPath();
    ctx.arc(cx + 3.5, headCY, 1.1, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx + 3.5, headCY, 0.5, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + 3.1, headCY - 0.4, 0.3, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = COL.brow;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(cx - 6, headCY - 3);
    ctx.quadraticCurveTo(cx - 3.5, headCY - 4, cx - 1, headCY - 3);
    ctx.moveTo(cx + 1, headCY - 3);
    ctx.quadraticCurveTo(cx + 3.5, headCY - 4, cx + 6, headCY - 3);
    ctx.stroke();
    ctx.strokeStyle = COL.mouth;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(cx, headCY + 5, 1.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = COL.skinDark;
    ctx.beginPath();
    ctx.arc(cx, headCY + 3, 0.6, 0, Math.PI*2);
    ctx.fill();

  } // end 长发/脸
  // 7. 头饰
  if (headItem) {
    ctx.fillStyle = headItem.color;
    ctx.beginPath();
    ctx.arc(cx, headCY - 4, 12, Math.PI, 0);
    ctx.lineTo(cx + 12, headCY - 4);
    ctx.lineTo(cx + 12, headCY + 4);
    ctx.lineTo(cx - 12, headCY + 4);
    ctx.lineTo(cx - 12, headCY - 4);
    ctx.fill();
  } else {
    ctx.fillStyle = COL.trim;
    ctx.beginPath();
    ctx.moveTo(cx - 10, headCY - 10);
    ctx.lineTo(cx - 10, headCY - 16);
    ctx.lineTo(cx - 5, headCY - 12);
    ctx.lineTo(cx, headCY - 20);
    ctx.lineTo(cx + 5, headCY - 12);
    ctx.lineTo(cx + 10, headCY - 16);
    ctx.lineTo(cx + 10, headCY - 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COL.trimDk;
    ctx.beginPath();
    ctx.moveTo(cx - 10, headCY - 12);
    ctx.lineTo(cx + 10, headCY - 12);
    ctx.lineTo(cx + 10, headCY - 10);
    ctx.lineTo(cx - 10, headCY - 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COL.shield;
    ctx.beginPath();
    ctx.arc(cx, headCY - 17, 1.5, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = COL.armorHi;
    ctx.beginPath();
    ctx.arc(cx - 0.4, headCY - 17.4, 0.5, 0, Math.PI*2);
    ctx.fill();
  }

  // 8. 项链
  if (amulet) {
    ctx.strokeStyle = COL.trim;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(cx - 5, neckY + 4);
    ctx.quadraticCurveTo(cx, neckY + 8, cx + 5, neckY + 4);
    ctx.stroke();
    ctx.fillStyle = amulet.color;
    ctx.beginPath();
    ctx.arc(cx, neckY + 10, 2.2, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - 0.6, neckY + 9.4, 0.7, 0, Math.PI*2);
    ctx.fill();
  }

  // 9. 手臂
  // 如果挥剑中（attackAnim > 0），整个右臂 + 剑由 Player.drawSprite
  // 里的挥剑代码接管（剑柄和手臂一起甩出去）。这里只画左臂（持盾）。
  const attacking = p.attackAnim > 0;
  const armSwing = stepFast * 2;
  // 左臂（保持不变）
  const lShoulderX = cx + facing * (-17);
  const lShoulderY = shoulderY + 4;
  const lElbowX    = lShoulderX + facing * 2;
  const lElbowY    = shoulderY + 16 + armSwing * facing;
  ctx.strokeStyle = armorCol;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(lShoulderX, lShoulderY);
  ctx.lineTo(lElbowX, lElbowY);
  ctx.stroke();
  ctx.strokeStyle = COL.armorDk;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(lShoulderX, lShoulderY);
  ctx.lineTo(lElbowX, lElbowY);
  ctx.stroke();
  ctx.fillStyle = COL.armorDk;
  ctx.beginPath();
  ctx.arc(lElbowX, lElbowY, 3, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.trim;
  ctx.beginPath();
  ctx.arc(lElbowX, lElbowY - 0.5, 1.5, 0, Math.PI*2);
  ctx.fill();
  const lHandX = lElbowX + facing * 1;
  const lHandY = lElbowY + 8;
  ctx.strokeStyle = armorCol;
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(lElbowX, lElbowY);
  ctx.lineTo(lHandX, lHandY);
  ctx.stroke();
  ctx.strokeStyle = COL.armorDk;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(lElbowX, lElbowY);
  ctx.lineTo(lHandX, lHandY);
  ctx.stroke();
  ctx.lineWidth = 1.4;

  // 右臂：挥剑中由外层接管（避免手臂和挥出去的剑脱节）
  // 无论挥剑与否，都计算 rHandX/rHandY（剑段需要）
  const rShoulderX = cx + facing * 17;
  const rShoulderY = shoulderY + 4;
  const rElbowX    = rShoulderX + facing * 2;
  const rElbowY    = shoulderY + 16 - armSwing * facing;
  const rHandX     = rElbowX + facing * 1;
  const rHandY     = rElbowY + 8;
  if (!attacking) {
    ctx.strokeStyle = armorCol;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rShoulderX, rShoulderY);
    ctx.lineTo(rElbowX, rElbowY);
    ctx.stroke();
    ctx.strokeStyle = COL.armorDk;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(rShoulderX, rShoulderY);
    ctx.lineTo(rElbowX, rElbowY);
    ctx.stroke();
    // 肘部铠甲
    ctx.fillStyle = COL.armorDk;
    ctx.beginPath();
    ctx.arc(rElbowX, rElbowY, 3, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = COL.trim;
    ctx.beginPath();
    ctx.arc(rElbowX, rElbowY - 0.5, 1.5, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = armorCol;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(rElbowX, rElbowY);
    ctx.lineTo(rHandX, rHandY);
    ctx.stroke();
    ctx.strokeStyle = COL.armorDk;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(rElbowX, rElbowY);
    ctx.lineTo(rHandX, rHandY);
    ctx.stroke();
    ctx.lineWidth = 1.4;
  }

  // 10. 盾
  //     正面视图(朝下)：盾牌举在身体正前方（挡住一部分躯干），像在防御姿态
  //     侧身/背面：盾牌挂在持盾手（身体侧边）
  const shieldOffsetX = viewMode === 'front' ? (cx - 9) : (lHandX + facing * 4);
  const shieldOffsetY = viewMode === 'front' ? (waistY - 6) : (lHandY - 2);
  ctx.save();
  ctx.translate(shieldOffsetX, shieldOffsetY);
  ctx.fillStyle = COL.shieldDk;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(8, -4);
  ctx.lineTo(8, 6);
  ctx.lineTo(0, 12);
  ctx.lineTo(-8, 6);
  ctx.lineTo(-8, -4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COL.shield;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(7, -4);
  ctx.lineTo(7, 5);
  ctx.lineTo(0, 11);
  ctx.lineTo(-7, 5);
  ctx.lineTo(-7, -4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COL.shieldHi;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(7, -4);
  ctx.lineTo(7, 5);
  ctx.lineTo(0, 11);
  ctx.lineTo(-7, 5);
  ctx.lineTo(-7, -4);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = COL.shieldHi;
  ctx.fillRect(-1, -7, 2, 14);
  ctx.fillRect(-5, -1, 10, 2);
  ctx.fillStyle = COL.trim;
  ctx.beginPath();
  ctx.arc(0, 0, 1.6, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.armorHi;
  ctx.beginPath();
  ctx.arc(-0.4, -0.4, 0.5, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // 11. 剑
  // 挥剑中整把剑由 Player.drawSprite 接管，这里只画站立状态下的剑
  //（带挥剑后残留抖动 swordWobble）。
  // 剑柄位置基于一个虚拟的右手位置（如果挥剑中也走到这里，
  // rHandX/rHandY 可能未定义，需要兜底计算）。
  let swordRot = viewMode === 'front' ? 0 : (-Math.PI / 6 * facing);
  let swordTipDx = 0;
  let swordTipDy = 0;
  if (p.swordWobble > 0) {
    const w = p.swordWobble;
    const lowF  = Math.sin(p.swordWobblePhase * 0.45) * (Math.PI / 36) * w;
    const highF = Math.sin(p.swordWobblePhase * 2.2) * (Math.PI / 72) * w;
    swordRot += (lowF + highF) * (viewMode === 'front' ? 1 : facing);
    swordTipDx = Math.sin(p.swordWobblePhase * 1.3) * 1.2 * w * facing;
    swordTipDy = Math.cos(p.swordWobblePhase * 1.7) * 0.8 * w;
  }
  // 剑柄位置：站立时握在右手（rHandX/Y 由前面右臂段定义）
  //   正面视图：剑竖直举在身体右侧（防御/待机姿态）
  //   侧身视图：剑斜握在身后
  const swordX = viewMode === 'front' ? (rHandX + 3 + swordTipDx) : (rHandX + facing * 2 + swordTipDx);
  const swordY = viewMode === 'front' ? (rHandY - 6 + swordTipDy) : (rHandY - 4 + swordTipDy);
  ctx.save();
  ctx.translate(swordX, swordY);
  ctx.rotate(swordRot);
  const wCol = weapon ? weapon.color : COL.sword;
  ctx.fillStyle = wCol;
  ctx.fillRect(-1.5, -32, 3, 26);
  ctx.fillStyle = COL.swordHi;
  ctx.fillRect(-0.4, -31, 0.8, 24);
  ctx.fillStyle = wCol;
  ctx.beginPath();
  ctx.moveTo(-1.5, -32);
  ctx.lineTo(1.5, -32);
  ctx.lineTo(0, -36);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COL.trim;
  ctx.fillRect(-4, -6, 8, 3);
  ctx.fillStyle = COL.trimDk;
  ctx.fillRect(-4, -4, 8, 1);
  ctx.fillStyle = COL.swordGrip;
  ctx.fillRect(-1.5, -3, 3, 8);
  ctx.fillStyle = COL.trim;
  ctx.beginPath();
  ctx.arc(0, 6, 2, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.trimDk;
  ctx.beginPath();
  ctx.arc(0, 7, 1.2, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // 12. 手套
  ctx.fillStyle = gloveCol;
  ctx.beginPath();
  ctx.arc(shieldOffsetX, shieldOffsetY, 3, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = COL.armorDk;
  ctx.beginPath();
  ctx.arc(shieldOffsetX, shieldOffsetY, 3, Math.PI, Math.PI*2);
  ctx.fill();
  // 右手套：挥剑中由外层接管（手套画在挥剑的剑柄位置）
  if (!attacking) {
    ctx.fillStyle = gloveCol;
    ctx.beginPath();
    ctx.arc(swordX, swordY, 3, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = COL.armorDk;
    ctx.beginPath();
    ctx.arc(swordX, swordY, 3, Math.PI, Math.PI*2);
    ctx.fill();
  }

  // 13. 背面视图专属层
  //     背对镜头时：披风盖住整个上半身、盾牌被身体挡住只露一点边、
  //     肩甲在背上、后脑勺已经在头部段画好。
  if (viewMode === 'back') {
    // —— 披风（盖住躯干，画在最上层）——
    ctx.fillStyle = COL.capeDk;
    ctx.beginPath();
    ctx.moveTo(cx - 15, shoulderY + 1 + breath);
    ctx.quadraticCurveTo(cx, shoulderY - 2 + breath, cx + 15, shoulderY + 1 + breath);
    ctx.quadraticCurveTo(cx + 19 + capeWave, waistY + 2, cx + 17 + capeWave, waistY + 10);
    ctx.lineTo(cx - 17 - capeWave, waistY + 10);
    ctx.quadraticCurveTo(cx - 19 - capeWave, waistY + 2, cx - 15, shoulderY + 1 + breath);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COL.cape;
    ctx.beginPath();
    ctx.moveTo(cx - 13, shoulderY + 3 + breath);
    ctx.quadraticCurveTo(cx, shoulderY + 0 + breath, cx + 13, shoulderY + 3 + breath);
    ctx.quadraticCurveTo(cx + 16 + capeWave * 0.8, waistY + 1, cx + 14 + capeWave * 0.8, waistY + 8);
    ctx.lineTo(cx - 14 - capeWave * 0.8, waistY + 8);
    ctx.quadraticCurveTo(cx - 16 - capeWave * 0.8, waistY + 1, cx - 13, shoulderY + 3 + breath);
    ctx.closePath();
    ctx.fill();
    // 披风中缝高光
    ctx.fillStyle = COL.capeLt;
    ctx.beginPath();
    ctx.moveTo(cx - 3, shoulderY + 5 + breath);
    ctx.quadraticCurveTo(cx, shoulderY + 3 + breath, cx + 3, shoulderY + 5 + breath);
    ctx.lineTo(cx + 5, waistY + 6);
    ctx.lineTo(cx - 5, waistY + 6);
    ctx.closePath();
    ctx.fill();
    // 披风底部金边
    ctx.fillStyle = COL.trim;
    ctx.fillRect(cx - 16 - capeWave * 0.8, waistY + 7, 32 + capeWave * 1.6, 1.6);
    ctx.fillStyle = COL.trimDk;
    ctx.fillRect(cx - 16 - capeWave * 0.8, waistY + 8.6, 32 + capeWave * 1.6, 1);
    // 披风扣（脖子正后方）
    ctx.fillStyle = COL.trim;
    ctx.beginPath();
    ctx.arc(cx, shoulderY + 4, 2.2, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = COL.trimDk;
    ctx.beginPath();
    ctx.arc(cx, shoulderY + 4, 1, 0, Math.PI*2);
    ctx.fill();
    // 披风褶皱
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(cx - 6, shoulderY + 8);
    ctx.quadraticCurveTo(cx - 8, waistY - 2, cx - 7, waistY + 6);
    ctx.moveTo(cx + 6, shoulderY + 8);
    ctx.quadraticCurveTo(cx + 8, waistY - 2, cx + 7, waistY + 6);
    ctx.stroke();
  }
}
// 角色面板的大立绘（4x 缩放）。
// 调用者 (drawHeroPortrait) 已经把坐标系平移到 canvas 中心并 scale(4)。
// 我们传入 cx=0, baseY=0（脚底）让 drawHeroArt 在缩放后的本地坐标里画。
function drawHeroSpriteDirect(ctx, p) {
  drawHeroArt(ctx, p, 0, 0, 1, 1);
}

// 角色面板当前选中的装备槽
// —— 修复：此前该变量从未声明（let/var 都没有），toggleCharacterPanel() 一进去就抛
//    ReferenceError: _selectedCharSlot is not defined，导致 C 键打开面板后整个面板半残
//    （属性栏显示 NaN、装备详情区空白）。这里显式声明。
let _selectedCharSlot = null;

function renderCharacterPanel() {
  const panel = document.getElementById('character-panel');
  if (!panel) return;

  // 1. 顶部信息
  document.getElementById('char-name').textContent = '英雄';
  document.getElementById('char-meta').textContent = ` Lv.${player.level} · ${player.exp}/${player.expToNext} EXP`;

  // 2. 绘制立绘
  drawHeroPortrait();

  // 3. 装备槽
  const bonus = getEquippedBonus();
  for (const slot of EQUIP_SLOTS) {
    const el = document.querySelector(`.equip-slot[data-slot="${slot}"]`);
    if (!el) continue;
    const item = player.equipped[slot];
    el.innerHTML = '';
    if (item) {
      el.classList.remove('empty');
      el.style.borderColor = RARITY_COLORS[item.rarity];
      el.style.background = `linear-gradient(135deg, ${item.color}33, ${item.color}11)`;
      const inner = document.createElement('div');
      inner.innerHTML = `<div class="icon" style="color:${item.color}">${SLOT_ICONS[slot]}</div><div class="label">${item.name}</div>`;
      el.appendChild(inner);
      el.onclick = () => selectCharSlot(slot);
    } else {
      el.classList.add('empty');
      el.style.borderColor = '';
      el.style.background = '';
      const inner = document.createElement('div');
      inner.innerHTML = `<div class="icon">${SLOT_ICONS[slot]}</div><div class="label">${SLOT_NAMES[slot]}</div>`;
      el.appendChild(inner);
      el.onclick = null;
    }
  }

  // 4. 属性栏
  // —— 用 total* 访问器：含装备加成，且不再引用不存在的 player.hpMax/mpMax ——
  const setStat = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
  setStat('char-stat-level', `Lv.${player.level}`);
  setStat('char-stat-hp', `${Math.floor(player.hp)}/${player.totalMaxHp}`);
  setStat('char-stat-mp', `${Math.floor(player.mp)}/${player.totalMaxMp}`);
  setStat('char-stat-atk', `${player.totalAtk}${bonus.atk ? ' <span class="bonus">+' + bonus.atk + '</span>' : ''}`);
  setStat('char-stat-def', `${player.totalDef}${bonus.def ? ' <span class="bonus">+' + bonus.def + '</span>' : ''}`);
  setStat('char-stat-speed', `${player.totalSpeed.toFixed(1)}${bonus.speed ? ' <span class="bonus">+' + bonus.speed.toFixed(1) + '</span>' : ''}`);
  // 套装百分比贡献（单独标出，让玩家看清"套装加了多少"）
  const sp = player.setPct;
  const setPctNote = (pct, label) => pct
    ? ` <span class="bonus" style="color:#9b59b6;">(套装 ${label} +${pct}%)</span>` : '';
  if (sp.atkPct)   setStat('char-stat-atk', `${player.totalAtk}${bonus.atk ? ' <span class="bonus">+' + bonus.atk + '</span>' : ''}${setPctNote(sp.atkPct, '攻')}`);
  if (sp.defPct)   setStat('char-stat-def', `${player.totalDef}${bonus.def ? ' <span class="bonus">+' + bonus.def + '</span>' : ''}${setPctNote(sp.defPct, '防')}`);
  if (sp.hpPct)    setStat('char-stat-hp', `${Math.floor(player.hp)}/${player.totalMaxHp}${setPctNote(sp.hpPct, '生命')}`);
  if (sp.mpPct)    setStat('char-stat-mp', `${Math.floor(player.mp)}/${player.totalMaxMp}${setPctNote(sp.mpPct, '魔法')}`);
  setStat('char-stat-kills', `${player.totalKills}`);
  setStat('char-stat-gold', `${player.gold}`);
  // 衍生属性（暴击/吸血/冷却缩减）—— 旧面板没有这两行，这里直接补进 DOM
  const extra = document.getElementById('char-stat-extra');
  if (extra) {
    const crit = player.totalCrit, ls = player.totalLifesteal, cdr = player.totalCdr;
    extra.innerHTML =
      `<div class="stat-row"><span class="label">暴击率</span><span class="val">${crit}%</span></div>` +
      `<div class="stat-row"><span class="label">吸血</span><span class="val">${ls}%</span></div>` +
      `<div class="stat-row"><span class="label">冷却缩减</span><span class="val">${cdr}%</span></div>`;
  }

  // 套装进度 —— 玩家需要看到"我还差几件能激活"，否则套装系统等于不存在
  const setBox = document.getElementById('char-sets');
  if (setBox) {
    const counts = getSetProgress();
    const rows = [];
    for (const sid of SET_IDS) {
      const set = SETS[sid];
      const n = counts[sid];
      if (n === 0) continue;   // 没穿就不显示，避免面板太挤
      // 找出下一个未激活的档位
      let nextDesc = '已集齐', nextN = 0, maxed = true;
      for (const th of [2, 4, 6]) {
        if (n < th) { nextDesc = set.bonuses[th].desc; nextN = th; maxed = false; break; }
      }
      const active = [];
      for (const th of [2, 4, 6]) {
        if (n >= th) active.push(`${th}件:${set.bonuses[th].desc}`);
      }
      rows.push(
        `<div class="set-row">` +
          `<div class="set-head"><span style="color:${set.color};font-weight:bold;">${set.icon} ${set.name}</span>` +
          `<span style="color:#888;font-size:11px;">${n}/6 件</span></div>` +
          active.map(a => `<div class="set-active">✓ ${a}</div>`).join('') +
          (maxed ? '' : `<div class="set-next">还差 ${nextN - n} 件 → ${nextDesc}</div>`) +
        `</div>`
      );
    }
    setBox.innerHTML = rows.length
      ? `<div style="color:#f1c40f;font-size:12px;margin-bottom:4px;">🎽 套装</div>` + rows.join('')
      : `<div style="color:#666;font-size:12px;">🎽 套装（未装备套装部件）</div>`;
  }

  // 5. 默认选中第一个装备槽
  if (!_selectedCharSlot || !player.equipped[_selectedCharSlot]) {
    const first = EQUIP_SLOTS.find(s => player.equipped[s]);
    _selectedCharSlot = first || null;
  }
  selectCharSlot(_selectedCharSlot);
}

function selectCharSlot(slot) {
  _selectedCharSlot = slot;
  const sel = document.getElementById('char-selected');
  if (!sel) return;
  // 高亮
  document.querySelectorAll('.equip-slot').forEach(el => el.classList.remove('selected'));
  if (slot) {
    const el = document.querySelector(`.equip-slot[data-slot="${slot}"]`);
    if (el) el.classList.add('selected');
    const item = player.equipped[slot];
    if (item) {
      // 词条显示：旧存档的词条没有 label 字段，这里实时算一个，别显示 undefined
      const affixesHtml = (item.affixes || []).map(a => {
        const label = a.label || affixLabel(a);
        return `<div class="item-affix">· ${label}</div>`;
      }).join('');
      // 套装归属提示（这件装备属于哪套 + 当前已穿几件）
      let setHtml = '';
      if (item.setId && SETS[item.setId]) {
        const s = SETS[item.setId];
        const n = getSetProgress()[item.setId] || 0;
        setHtml = `<div style="color:${s.color};font-size:12px;margin-top:4px;">
          🎽 ${s.icon} ${s.name}套装 · 已穿 ${n}/6 件</div>`;
      }
      sel.innerHTML = `
        <div class="item-name" style="color:${RARITY_COLORS[item.rarity]}">${item.name}</div>
        <div class="item-rarity" style="color:${RARITY_COLORS[item.rarity]}">${RARITY_NAMES[item.rarity]} · ${SLOT_NAMES[item.kind]}</div>
        <div class="item-stats">
          ${item.atk ? `攻击 +${item.atk}<br>` : ''}
          ${item.def ? `防御 +${item.def}<br>` : ''}
          ${item.speed ? `速度 +${item.speed}<br>` : ''}
          ${item.range ? `范围 +${item.range}<br>` : ''}
          ${item.hp ? `生命 +${item.hp}<br>` : ''}
          ${item.mp ? `魔法 +${item.mp}<br>` : ''}
        </div>
        ${setHtml}
        <div class="item-affixes">${affixesHtml || '<i>无词条</i>'}</div>
        <div class="item-actions">
          <button class="btn-act btn-unequip">卸下</button>
        </div>
      `;
      sel.querySelector('.btn-unequip').onclick = () => {
        // 卸下：找背包空位
        const idx = player.inventory.findIndex(s => s === null);
        if (idx < 0) {
          spawnDamageNum(player.x, player.y, '背包满了!', '#e74c3c');
          return;
        }
        player.inventory[idx] = item;
        player.equipped[slot] = null;
        // 卸下装备 → 加成缓存失效（否则属性仍按卸下前计算）
        player.invalidateBonus();
        playSound && playSound('pickup');
        renderCharacterPanel();
        renderInventoryPanel();
      };
    } else {
      sel.innerHTML = `<i>该槽位为空</i>`;
    }
  } else {
    sel.innerHTML = `<i>选择一个装备查看详情</i>`;
  }
}

function toggleCharacterPanel(force) {
  const p = document.getElementById('character-panel');
  if (!p) return false;
  const active = force !== undefined ? force : !p.classList.contains('active');
  if (active) {
    p.classList.add('active');
    renderCharacterPanel();
  } else {
    p.classList.remove('active');
  }
  return active;
}


// ============================================================
// 对话系统
// ============================================================
let currentDialog = null;
let dialogPage = 0;

function startDialog(npc) {
  currentDialog = npc;
  dialogPage = 0;
  showDialog();
}

function showDialog() {
  const box = document.getElementById('dialog-box');
  if (!currentDialog) { box.classList.remove('active'); return; }
  box.classList.add('active');
  document.getElementById('dialog-name').textContent = currentDialog.name;
  document.getElementById('dialog-name').style.color = currentDialog.color;
  document.getElementById('dialog-text').textContent = currentDialog.dialog[dialogPage] || '...';
}

function advanceDialog() {
  if (!currentDialog) return;
  dialogPage++;
  if (dialogPage >= currentDialog.dialog.length) {
    if (currentDialog.isShop) {
      showShop();
    }
    currentDialog = null;
    document.getElementById('dialog-box').classList.remove('active');
    return;
  }
  showDialog();
}

// 商店价格表（NPC 对话里的广告文案与此处保持一致，别再各写一份）
const SHOP_PRICES = { potion: 30, mpotion: 40, weapon: 120, armor: 100 };

function showShop() {
  // 简单商店
  // —— 价格与 NPC 对话文案对齐（原来广告写 30G，代码却扣 50G）——
  const choice = prompt(
    currentDialog.name + ' 的商店:\n' +
    `[1] 治疗药水 (${SHOP_PRICES.potion}G) 回50HP\n` +
    `[2] 魔法药水 (${SHOP_PRICES.mpotion}G) 回30MP\n` +
    `[3] 随机武器 (${SHOP_PRICES.weapon}G)\n` +
    `[4] 随机护甲 (${SHOP_PRICES.armor}G)\n` +
    `[5] 退出\n输入数字购买:`
  );
  if (choice === '1' && player.gold >= SHOP_PRICES.potion) {
    player.gold -= SHOP_PRICES.potion;
    pickups.push(makePickup(player.x, player.y - 30, 'potion'));
    spawnDamageNum(player.x, player.y, '购买成功!', '#2ecc71');
  } else if (choice === '2' && player.gold >= SHOP_PRICES.mpotion) {
    player.gold -= SHOP_PRICES.mpotion;
    pickups.push(makePickup(player.x, player.y - 30, 'mpotion'));
    spawnDamageNum(player.x, player.y, '购买成功!', '#2ecc71');
  } else if (choice === '3' && player.gold >= SHOP_PRICES.weapon) {
    player.gold -= SHOP_PRICES.weapon;
    const item = generateItem(Math.random() < 0.5 ? 'uncommon' : 'rare');
    item.kind = 'weapon';
    addToInventory(item);
    spawnDamageNum(player.x, player.y, '购得 ' + item.name, RARITY_COLORS[item.rarity]);
  } else if (choice === '4' && player.gold >= SHOP_PRICES.armor) {
    player.gold -= SHOP_PRICES.armor;
    const item = generateItem(Math.random() < 0.5 ? 'uncommon' : 'rare');
    item.kind = 'armor';
    addToInventory(item);
    spawnDamageNum(player.x, player.y, '购得 ' + item.name, RARITY_COLORS[item.rarity]);
  }
}

// 检查是否通过 ?autostart 自动开始
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('autostart') === '1') {
  setTimeout(() => document.getElementById('btn-start').click(), 200);
  // 自动向某个方向移动以查看世界
  setTimeout(() => {
    const evt = (type, key) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
    evt('keydown', 'd');
    setTimeout(() => evt('keyup', 'd'), 1500);
  }, 500);
}

// ?charpanel=1 测试角色面板：自动开始并打开角色面板
if (urlParams.get('charpanel') === '1') {
  setTimeout(() => {
    if (document.getElementById('btn-start')) document.getElementById('btn-start').click();
    setTimeout(() => {
      // 注入一些测试装备
      player.level = 5;
      player.exp = 30;
      // 注意：这里要设 maxHp/maxMp（不是不存在的 hpMax/mpMax）
      player.maxHp = 200; player.hp = 200;
      player.maxMp = 120; player.mp = 120;
      player.atk = 25;
      player.def = 12;
      player.speed = 3.6;
      player.totalKills = 47;
      player.totalGold = 800;
      player.gold = 320;
      // 给玩家装备各槽一件测试装
      player.equipped = {
        weapon: generateItem('legendary'),
        armor:  generateItem('epic'),
        head:   generateItem('rare'),
        gloves: generateItem('uncommon'),
        boots:  generateItem('rare'),
        amulet: generateItem('epic')
      };
      // 打开角色面板
      toggleCharacterPanel(true);
      // 把 canvas 内容 dump 到一个可见 div 里（这样截图能看到）
      setTimeout(() => {
        const pcan = document.getElementById('char-portrait-canvas');
        if (pcan) {
          // 检查 canvas 是否真的被绘制
          const ctx2 = pcan.getContext('2d');
          const data = ctx2.getImageData(0, 0, pcan.width, pcan.height).data;
          let nonZero = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] || data[i+1] || data[i+2]) nonZero++;
          }
          console.log('PORTRAIT nonZero pixels:', nonZero);
          console.log('PORTRAIT player.w=', player.w, 'player.h=', player.h, 'equipped.weapon=', player.equipped.weapon && player.equipped.weapon.name);
          // 如果画布是空的，把它用 dataURL 显示在屏幕上
          if (nonZero < 100) {
            const w = pcan.width, h = pcan.height;
            const tmp = document.createElement('canvas');
            tmp.width = w; tmp.height = h;
            tmp.getContext('2d').fillStyle = 'red';
            tmp.getContext('2d').fillRect(0, 0, w, h);
            tmp.getContext('2d').fillStyle = 'white';
            tmp.getContext('2d').font = '20px sans-serif';
            tmp.getContext('2d').fillText('EMPTY: w=' + w + ' h=' + h, 30, 140);
            const img = document.createElement('img');
            img.src = tmp.toDataURL();
            img.style.cssText = 'position:fixed;top:0;left:0;z-index:9999';
            document.body.appendChild(img);
          }
        }
      }, 200);
    }, 600);
  }, 200);
}

// ?testsave=1 测试存档：先预设一个有内容的存档再启动
if (urlParams.get('testsave') === '1') {
  setTimeout(() => {
    // 写入一个伪造的存档
    const fakeSave = {
      v: 1,
      ts: Date.now(),
      player: {
        x: 400, y: 400,
        hp: 75, maxHp: 150,
        mp: 30, maxMp: 80,
        level: 7, exp: 50, expToNext: 200,
        gold: 500,
        atk: 24, def: 12, speed: 4,
        facing: 1,
        skillPts: 3,
        skills: {
          fireball: { cd: 0, maxCd: 200 },
          ice:      { cd: 0, maxCd: 300 },
          thunder:  { cd: 0, maxCd: 400 },
          heal:     { cd: 0, maxCd: 500 }
        },
        inventory: [
          // rarity 必须是字符串（'common'/'rare'/'legendary'…），
          // 原来写数字 3/5 会让 RARITY_COLORS[3] 取不到 → 颜色变 undefined
          { kind: 'weapon', name: '测试剑', color: '#ff6b35', rarity: 'rare', atk: 25, def: 0, range: 60,
            affixes: [{ stat: 'atk', value: 5, label: '攻击力 +5' }] },
          null, null, null, null, null, null, null
        ],
        equipped: {
          weapon: { kind: 'weapon', name: '传奇之剑', color: '#f1c40f', rarity: 'legendary', atk: 50, def: 0, range: 80,
            affixes: [{ stat: 'atk', value: 8, label: '攻击力 +8' }] },
          armor: null
        },
        totalKills: 42,
        totalGold: 500
      },
      progress: { bossKilled: false, chestsOpened: 2, seed: 0 }
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(fakeSave));
    refreshStartScreen();
    // 自动点击继续游戏
    setTimeout(() => {
      const btn = document.getElementById('btn-continue');
      if (btn && btn.style.display !== 'none') btn.click();
    }, 100);
  }, 300);
}

// ?showcase=1 展示怪物造型：把所有怪物传到玩家面前
if (urlParams.get('showcase') === '1') {
  setTimeout(() => {
    document.getElementById('btn-start').click();
    setTimeout(() => {
      // 关闭自动攻击/玩家不动
      window.setInterval = window.setInterval;
      // 在玩家周围生成所有怪物种类 — 位置偏移相对于玩家中心
      const offsets = [
        { name: '骷髅兵', x: -180, y: 0 },
        { name: '蝙蝠',   x: -90,  y: -120 },
        { name: '史莱姆', x: 90,   y: -120 },
        { name: '哥布林', x: 180,  y: 0 },
        { name: '精英怪', x: 0,    y: 140 }
      ];
      const cx = player.x + player.w/2;
      const cy = player.y + player.h/2;
      for (const o of offsets) {
        const e = new Enemy(cx + o.x - 18, cy + o.y - 24, {
          name: o.name, color: '#000', eyeColor: '#fff',
          hp: 100, atk: 5, def: 0, exp: 1, gold: 0
        });
        e.alive = true;
        enemies.push(e);
      }
      // 屏蔽所有伤害让怪物不死
      const _origTake = Entity.prototype.takeDamage;
      Entity.prototype.takeDamage = function() { this.hp = this.maxHp; };
      // 防止玩家移出位置 — 锁定玩家位置
      const lockX = player.x, lockY = player.y;
      const lockInterval = setInterval(() => {
        player.x = lockX;
        player.y = lockY;
        player.vx = 0;
        player.vy = 0;
        camera.x = lockX + player.w/2 - 640;
        camera.y = lockY + player.h/2 - 360;
      }, 50);
    }, 400);
  }, 200);
}

// ?bossroom=1 跳到 Boss 房击败 Boss — 测试 Boss 宝箱
if (urlParams.get('bossroom') === '1') {
  setTimeout(() => {
    document.getElementById('btn-start').click();
    setTimeout(() => {
      // 找到 Boss 房
      const bossRoom = ROOMS[ROOMS.length - 1];
      // 瞬移到 Boss 房中间偏右
      player.x = (bossRoom.x + bossRoom.w/2 + 4) * TILE;
      player.y = (bossRoom.y + bossRoom.h/2) * TILE;
      // 找到 Boss 并直接调用 handleDeath 跳过 setTimeout gameWin
      const boss = enemies.find(e => e instanceof Boss);
      if (boss) {
        boss.handleDeath();
      }
      // 重置胜利定时器（防止游戏结束覆盖截图）
      // 屏蔽任何 setTimeout 弹胜利/死亡画面
      const _origST = window.setTimeout;
      window.setTimeout = function(fn, t) {
        if (t === 2000 || t === 800) return 0; // 屏蔽 gameWin/gameOver
        return _origST(fn, t);
      };
    }, 300);
  }, 200);
}

// ?chest=1 跳到第一个宝箱旁边（测试宝箱提示）
if (urlParams.get('chest') === '1') {
  setTimeout(() => {
    document.getElementById('btn-start').click();
    setTimeout(() => {
      // 找到第一个未开启的宝箱
      const c = chests.find(c => !c.opened);
      if (c) {
        // 把房间清空周围的怪物便于测试
        const nearEnemies = enemies.filter(e => dist(e, c) < 200);
        nearEnemies.forEach(e => { e.alive = false; });
        // 玩家瞬移到宝箱正下方（这样能在画面中央看到）
        player.x = c.x - player.w/2;
        player.y = c.y + TILE * 1.5;
        // 镜头强制对准玩家
        setTimeout(() => {
          camera.x = player.x + player.w/2 - W/2;
          camera.y = player.y + player.h/2 - H/2;
        }, 100);
      }
    }, 500);
  }, 300);
}

// ============================================================
// 升级选择
// ============================================================
const UPGRADE_POOL = [
  { name: '生命强化', desc: '最大生命值 +40', apply: () => { player.maxHp += 40; player.hp = Math.min(player.totalMaxHp, player.hp + 40); } },
  { name: '魔法强化', desc: '最大魔法值 +25', apply: () => { player.maxMp += 25; player.mp = Math.min(player.totalMaxMp, player.mp + 25); } },
  { name: '攻击强化', desc: '攻击力 +6', apply: () => { player.atk += 6; } },
  { name: '防御强化', desc: '防御力 +4', apply: () => { player.def += 4; } },
  { name: '生命恢复', desc: '立即恢复 50% 生命', apply: () => { player.hp = Math.min(player.totalMaxHp, player.hp + Math.floor(player.totalMaxHp * 0.5)); } },
  { name: '迅捷步伐', desc: '移动速度 +0.5', apply: () => { player.speed += 0.5; } },
  // ↓ 下面两个原本是空壳：crit / lifesteal 存了值但战斗从不读取，现已接入战斗
  { name: '致命一击', desc: '暴击率 +10%', apply: () => { player.crit = (player.crit || 0) + 10; } },
  { name: '吸血之力', desc: '攻击恢复 5% 伤害的生命', apply: () => { player.lifesteal = (player.lifesteal || 0) + 5; } },
  // 新增：冷却缩减（配合装备词条，让技能流有成长空间）
  { name: '迅捷施法', desc: '技能冷却缩减 +8%', apply: () => { player.cdr = (player.cdr || 0) + 8; } },
  // 新增：连击上限提升（普攻手感）
  { name: '锐意连斩', desc: '连击伤害加成 +1/层', apply: () => { player.comboPower = (player.comboPower || 0) + 1; } }
];

let upgradeActive = false;
// 待处理的升级选择数（连升多级时排队，一个一个弹）
let pendingUpgrades = 0;
function showUpgradePanel() {
  if (pendingUpgrades <= 0) pendingUpgrades = 1;
  upgradeActive = true;
  const choices = [];
  const pool = [...UPGRADE_POOL];
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    choices.push(pool.splice(idx, 1)[0]);
  }
  const panel = document.getElementById('upgrade-panel');
  const cont = document.getElementById('upgrade-choices');
  cont.innerHTML = '';
  for (const c of choices) {
    const btn = document.createElement('button');
    btn.className = 'upgrade-choice';
    btn.innerHTML = `<div class="upgrade-name">${c.name}</div><div class="upgrade-desc">${c.desc}</div>`;
    btn.onclick = () => {
      c.apply();
      panel.classList.remove('active');
      upgradeActive = false;
      pendingUpgrades = Math.max(0, pendingUpgrades - 1);
      spawnDamageNum(player.x, player.y, c.name + '!', '#f1c40f');
      // 还有待选项目 → 继续弹下一个（不会漏掉连升多级的选择）
      if (pendingUpgrades > 0) showUpgradePanel();
    };
    cont.appendChild(btn);
  }
  panel.classList.add('active');
}

// ============================================================
// UI 更新
// ============================================================
function updateHUD() {
  // 用 total* 访问器：血条/蓝条必须反映装备加成，否则面板与实际不符
  document.getElementById('hp-bar').style.width = (player.hp / player.totalMaxHp * 100) + '%';
  document.getElementById('hp-text').textContent = Math.floor(player.hp) + '/' + player.totalMaxHp;
  document.getElementById('mp-bar').style.width = (player.mp / player.totalMaxMp * 100) + '%';
  document.getElementById('mp-text').textContent = Math.floor(player.mp) + '/' + player.totalMaxMp;
  document.getElementById('exp-bar').style.width = (player.exp / player.expToNext * 100) + '%';
  document.getElementById('exp-text').textContent = player.exp + '/' + player.expToNext;
  document.getElementById('player-level').textContent = player.level;
  document.getElementById('gold').textContent = player.gold;
  // 攻击/防御显示总属性（基础 + 装备），装备有加成时用浅色标出装备部分
  const bonus = player.bonus;
  const atkEl = document.getElementById('atk');
  const defEl = document.getElementById('def');
  atkEl.textContent = player.totalAtk;
  defEl.textContent = player.totalDef;
  atkEl.innerHTML = player.totalAtk + (bonus.atk ? `<span style="color:#2ecc71;font-size:11px;"> (+${bonus.atk})</span>` : '');
  defEl.innerHTML = player.totalDef + (bonus.def ? `<span style="color:#2ecc71;font-size:11px;"> (+${bonus.def})</span>` : '');

  // 任务文本
  const aliveEnemies = enemies.filter(e => e.alive).length;
  const bossAlive = enemies.some(e => e.alive && e instanceof Boss);
  if (bossAlive) {
    document.getElementById('quest-text').textContent = '击败暗影之王!';
  } else if (aliveEnemies > 0) {
    document.getElementById('quest-text').textContent = `清剿怪物 (剩余 ${aliveEnemies})`;
  } else {
    document.getElementById('quest-text').textContent = '前往北方挑战 Boss!';
  }

  // 掉落保底提示 —— 让玩家知道"再打 N 只必出货"，把随机变成可预期的节奏
  const pityEl = document.getElementById('pity-text');
  if (pityEl) {
    const pi = getPityInfo();
    if (pi.toElitePity <= 3) {
      pityEl.style.display = 'block';
      pityEl.style.color = '#f1c40f';
      pityEl.textContent = `🎁 下一只怪必掉装备! (${pi.toElitePity} 只后)`;
    } else if (pi.rareBoost) {
      pityEl.style.display = 'block';
      pityEl.style.color = '#e67e22';
      pityEl.textContent = `🎁 稀有装备概率提升中 (${pi.killsSinceRare} 次未出)`;
    } else {
      pityEl.style.display = 'none';
    }
  }

  // 当前难度显示（让玩家随时知道自己在什么难度下）
  const diffEl = document.getElementById('difficulty-badge');
  if (diffEl) {
    const d = getDifficulty();
    diffEl.textContent = `${d.icon} ${d.name}`;
    diffEl.style.color = d.color;
  }

  // 技能冷却
  const cds = [
    ['cd-1', 'fireball'], ['cd-2', 'ice'],
    ['cd-3', 'thunder'], ['cd-4', 'heal']
  ];
  for (const [id, sk] of cds) {
    const el = document.getElementById(id);
    const cd = player.skills[sk].cd;
    // 用实际冷却（含冷却缩减）做进度条分母，否则条会显示不满
    const max = player.skillCooldown(player.skills[sk].maxCd);
    if (cd > 0) {
      el.style.display = 'block';
      el.style.height = (cd / max * 100) + '%';
      el.textContent = Math.ceil(cd / 60);
    } else {
      el.style.display = 'none';
    }
  }
}

function drawMinimap() {
  const mc = document.getElementById('minimap');
  const mctx = mc.getContext('2d');
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, 160, 160);
  const scale = 2;
  mctx.fillStyle = '#2c3e50';
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      if (worldMap[y] && worldMap[y][x] === 1) {
        mctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
  // 玩家位置
  mctx.fillStyle = '#f1c40f';
  mctx.fillRect(player.x / TILE * scale - 2, player.y / TILE * scale - 2, 4, 4);
  // Boss 位置
  for (const e of enemies) {
    if (e instanceof Boss && e.alive) {
      mctx.fillStyle = '#e74c3c';
      mctx.fillRect(e.x / TILE * scale - 3, e.y / TILE * scale - 3, 6, 6);
    }
  }
}

// ============================================================
// 主循环
// ============================================================
function updateCamera() {
  camera.x = player.x + player.w/2 - W/2;
  camera.y = player.y + player.h/2 - H/2;
  // 摄像机抖动
  if (shakeFrames > 0) {
    camera.x += (Math.random() - 0.5) * shakeMag;
    camera.y += (Math.random() - 0.5) * shakeMag;
    shakeFrames--;
  }
}

function drawWorld() {
  // 背景 (地板/墙)
  const startTX = Math.max(0, Math.floor(camera.x / TILE) - 1);
  const endTX = Math.min(WORLD_W, Math.ceil((camera.x + W) / TILE) + 1);
  const startTY = Math.max(0, Math.floor(camera.y / TILE) - 1);
  const endTY = Math.min(WORLD_H, Math.ceil((camera.y + H) / TILE) + 1);
  for (let y = startTY; y < endTY; y++) {
    for (let x = startTX; x < endTX; x++) {
      const sx = x * TILE - camera.x;
      const sy = y * TILE - camera.y;
      if (worldMap[y][x] === 1) {
        // 地板
        const checker = (x + y) % 2 === 0;
        ctx.fillStyle = checker ? '#3d3d5c' : '#353550';
        ctx.fillRect(sx, sy, TILE, TILE);
        // 砖块纹理
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, TILE, TILE);
      } else {
        // 墙外 (虚空)
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(sx, sy, TILE, TILE);
      }
    }
  }
}

function drawDecorations() {
  for (const d of decorations) {
    const sx = d.x - camera.x, sy = d.y - camera.y;
    if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) continue;
    if (d.type === 'grass') {
      ctx.fillStyle = '#27ae60';
      for (let i = 0; i < 3; i++) {
        const ox = (i-1)*8, oy = (i%2)*4;
        ctx.fillRect(sx + 12+ox, sy + 20+oy, 3, 8);
        ctx.fillRect(sx + 16+ox, sy + 16+oy, 3, 12);
        ctx.fillRect(sx + 20+ox, sy + 22+oy, 3, 6);
      }
    } else if (d.type === 'rock') {
      ctx.fillStyle = '#7f8c8d';
      ctx.beginPath();
      ctx.moveTo(sx + 8, sy + 28); ctx.lineTo(sx + 16, sy + 8);
      ctx.lineTo(sx + 24, sy + 28); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#95a5a6';
      ctx.fillRect(sx + 14, sy + 14, 6, 8);
    } else if (d.type === 'skull') {
      ctx.fillStyle = '#ecf0f1';
      ctx.beginPath(); ctx.arc(sx + 16, sy + 18, 10, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.fillRect(sx + 11, sy + 16, 4, 4);
      ctx.fillRect(sx + 17, sy + 16, 4, 4);
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(sx + 14, sy + 23, 4, 3);
    } else if (d.type === 'mushroom') {
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.arc(sx + 16, sy + 14, 12, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(sx + 12, sy + 12, 2, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 18, sy + 10, 2, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ecf0f1';
      ctx.fillRect(sx + 14, sy + 14, 4, 14);
    } else if (d.type === 'pillar') {
      ctx.fillStyle = '#34495e';
      ctx.fillRect(sx + 10, sy, 12, 32);
      ctx.fillStyle = '#5d6d7e';
      ctx.fillRect(sx + 8, sy, 16, 6);
      ctx.fillRect(sx + 8, sy + 26, 16, 6);
    }
  }
}

function drawChests() {
  for (const c of chests) {
    const sx = c.x - camera.x, sy = c.y - camera.y;
    if (sx < -50 || sx > W + 50) continue;
    if (c.opened) {
      // 已开启的宝箱 — 破旧外观
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(sx + 8, sy + 18, 24, 14);
      ctx.fillStyle = '#3e2723';
      ctx.fillRect(sx + 6, sy + 14, 28, 4);
      ctx.fillStyle = '#4e342e';
      ctx.fillRect(sx + 12, sy + 16, 4, 8);
      ctx.fillRect(sx + 24, sy + 16, 4, 8);
    } else {
      // 根据稀有度选颜色
      const col = RARITY_COLORS[c.rarity] || '#f1c40f';
      const isBoss = c.type === 'boss' || c.type === 'boss_reward';
      const pulse = 0.5 + Math.sin(Date.now() / 250) * 0.4;

      // 发光晕
      ctx.shadowColor = col;
      ctx.shadowBlur = (isBoss ? 30 : 18) * (0.6 + pulse * 0.4);

      // 底部阴影
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(sx + 20, sy + 36, 18, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // 宝箱主体 — 根据稀有度不同形状/装饰
      if (isBoss) {
        // Boss 宝箱 — 金色镶钻宝箱
        ctx.fillStyle = '#4a2c0a';
        ctx.fillRect(sx + 2, sy + 12, 36, 22);
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(sx + 2, sy + 10, 36, 6);
        // 金边
        ctx.strokeStyle = '#fff8dc';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 2, sy + 10, 36, 24);
        // 中央宝石
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath();
        ctx.moveTo(sx + 20, sy + 20);
        ctx.lineTo(sx + 26, sy + 24);
        ctx.lineTo(sx + 20, sy + 30);
        ctx.lineTo(sx + 14, sy + 24);
        ctx.closePath();
        ctx.fill();
        // 宝石高光
        ctx.fillStyle = '#fca5a5';
        ctx.beginPath();
        ctx.arc(sx + 17, sy + 22, 1.5, 0, Math.PI*2);
        ctx.fill();
        // 锁
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx + 18, sy + 16, 4, 4);
      } else if (c.rarity === 'epic') {
        // 史诗宝箱 — 紫色镶边
        ctx.fillStyle = '#2c1810';
        ctx.fillRect(sx + 4, sy + 14, 32, 20);
        ctx.fillStyle = '#9b59b6';
        ctx.fillRect(sx + 4, sy + 10, 32, 8);
        ctx.strokeStyle = '#d6b8e8';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 4, sy + 10, 32, 24);
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx + 17, sy + 18, 6, 8);
        // 装饰星
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 4; i++) {
          const a = (Math.PI*2/4)*i + Date.now()/800;
          const px = sx + 20 + Math.cos(a)*14;
          const py = sy + 22 + Math.sin(a)*8;
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI*2);
          ctx.fill();
        }
      } else if (c.rarity === 'rare') {
        // 稀有宝箱 — 蓝色
        ctx.fillStyle = '#1a3a52';
        ctx.fillRect(sx + 4, sy + 14, 32, 20);
        ctx.fillStyle = '#3498db';
        ctx.fillRect(sx + 4, sy + 10, 32, 8);
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx + 17, sy + 18, 6, 8);
      } else if (c.rarity === 'uncommon') {
        // 优秀宝箱 — 绿色
        ctx.fillStyle = '#1a3a25';
        ctx.fillRect(sx + 4, sy + 14, 32, 20);
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(sx + 4, sy + 10, 32, 8);
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx + 17, sy + 18, 6, 8);
      } else {
        // 普通宝箱 — 灰木色
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(sx + 4, sy + 14, 32, 20);
        ctx.fillStyle = '#8d6e63';
        ctx.fillRect(sx + 4, sy + 10, 32, 8);
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(sx + 17, sy + 18, 6, 8);
      }
      ctx.shadowBlur = 0;

      // 玩家在附近时显示"按 E 开启"提示
      const near = dist(player, c) < 80;
      const bossAlive = c.requiresBoss && enemies.some(e => e instanceof Boss && e.alive);
      if (near) {
        const tipText = bossAlive ? '先击败 Boss!' : '按 [E] 开启';
        const tipCol = bossAlive ? '#e74c3c' : '#f1c40f';
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(sx - 5, sy - 18, 50, 16);
        ctx.fillStyle = tipCol;
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(tipText, sx + 20, sy - 6);
      }

      // 宝箱上方稀有度文字（永远显示）
      ctx.fillStyle = col;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(RARITY_NAMES[c.rarity] + '宝箱', sx + 20, sy + 2);
    }
  }
}

function drawNPCs() {
  for (const n of npcs) {
    const sx = n.x - camera.x, sy = n.y - camera.y;
    if (sx < -50 || sx > W + 50) continue;
    // NPC 标识
    ctx.fillStyle = n.color;
    ctx.shadowColor = n.color; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(sx + 18, sy + 18, 18, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(n.isShop ? '💰' : '👴', sx + 18, sy + 22);
    // 名字
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(n.name, sx + 18, sy - 5);
    // 交互提示
    const bob = Math.sin(Date.now() / 200) * 2;
    ctx.fillStyle = '#f1c40f';
    ctx.fillText('[E]', sx + 18, sy - 18 + bob);
  }
}

function drawPickups() {
  for (const p of pickups) {
    const sx = p.x - camera.x, sy = p.y - camera.y;
    if (sx < -50 || sx > W + 50) continue;
    drawPickup(p);
  }
}

function drawEntities() {
  // 按 Y 排序，但保证玩家绘制在怪物上方（如果玩家 y 在怪物 y 区间内）
  const others = enemies.filter(e => e.alive);
  const sorted = others.sort((a, b) => a.y - b.y);
  let playerDrawn = false;
  for (const e of sorted) {
    if (!playerDrawn && e.y >= player.y + player.h * 0.5) {
      player.draw();
      playerDrawn = true;
    }
    e.draw();
  }
  if (!playerDrawn) player.draw();

  // 调试覆盖层：显示 hitbox (F3 开关)
  if (window.__showHitbox) {
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0ff';
    ctx.strokeRect(player.x, player.y, player.w, player.h);
    ctx.strokeStyle = '#f0f';
    for (const e of enemies) {
      if (!e.alive) continue;
      ctx.strokeRect(e.x, e.y, e.w, e.h);
    }
    // 玩家脚下画十字标
    ctx.strokeStyle = '#ff0';
    ctx.beginPath();
    ctx.moveTo(player.x + player.w/2 - 8, player.y + player.h/2);
    ctx.lineTo(player.x + player.w/2 + 8, player.y + player.h/2);
    ctx.moveTo(player.x + player.w/2, player.y + player.h/2 - 8);
    ctx.lineTo(player.x + player.w/2, player.y + player.h/2 + 8);
    ctx.stroke();
    ctx.restore();

    // 屏幕顶部信息
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(4, 4, 360, 56);
    ctx.fillStyle = '#0ff';
    ctx.font = '14px monospace';
    ctx.fillText(`player xy=(${player.x.toFixed(1)}, ${player.y.toFixed(1)}) v=(${player.vx.toFixed(2)}, ${player.vy.toFixed(2)})`, 8, 22);
    ctx.fillText(`facing=${player.facing}  attackAnim=${player.attackAnim}  invuln=${player.invuln}`, 8, 40);
    ctx.fillStyle = '#ff0';
    ctx.fillText('F3: hitbox  F4: tile grid', 8, 56);
    ctx.restore();
  }

  // 调试覆盖层：tile 网格 (F4)
  if (window.__showTileGrid) {
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    ctx.lineWidth = 1;
    for (let y = 0; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        const sx = x * TILE, sy = y * TILE;
        if (worldMap[y] && worldMap[y][x] === 1) {
          ctx.strokeStyle = 'rgba(0, 255, 0, 0.18)';
        } else {
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.35)';
        }
        ctx.strokeRect(sx, sy, TILE, TILE);
      }
    }
    ctx.restore();
  }
}

function drawProjectiles() {
  for (const p of projectiles) p.draw();
}

function drawParticles() {
  for (const p of particles) p.draw();
}

// ============================================================
// 屏幕边缘红晕（受击反馈 / 低血量警示）
// ============================================================
// —— 为什么需要 ——
// 玩家被击中时，光靠角色本身的红闪不够醒目（角色在画面中央时尤其容易忽略）。
// 屏幕四周泛红是动作游戏的经典"你被打了"信号，能在余光里就察觉到。
// 另外低血量时常驻淡红晕，给玩家一个"快死了"的持续压力提示。
function drawDamageVignette() {
  const hpRatio = player.hp / Math.max(1, player.totalMaxHp);
  // 受击闪红：取 hurtFlash 的强度
  const hurtAlpha = player.hurtFlash > 0 ? player.hurtFlash / 12 * 0.55 : 0;
  // 低血量常驻：血量低于 30% 时逐渐增强
  const lowHpAlpha = hpRatio < 0.3 ? (0.3 - hpRatio) / 0.3 * 0.35 : 0;
  // 心跳脉动：低血量时红晕按心跳节奏起伏（比恒定红晕更有"生命垂危"的压迫感）
  // 周期约 0.9 秒：快速收缩-舒张
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 145);
  const heartbeat = hpRatio < 0.3 ? lowHpAlpha * (0.55 + pulse * 0.85) : 0;
  const alpha = Math.min(0.62, hurtAlpha + heartbeat);
  if (alpha <= 0.01) return;

  ctx.save();
  // 径向渐变：中心透明 → 边缘红
  const g = ctx.createRadialGradient(W/2, H/2, H * 0.28, W/2, H/2, H * 0.78);
  g.addColorStop(0, 'rgba(200, 0, 0, 0)');
  g.addColorStop(1, `rgba(190, 20, 20, ${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

let gameState = 'menu'; // menu, play, dead, win
let gameOverTriggered = false;  // 防止重复 setTimeout gameOver

// ============================================================
// 存档系统
// ============================================================
const SAVE_KEY = 'shadow_legend_save_v1';
const SAVE_VERSION = 2;

// 序列化一件装备（含完整词条：value + label，mul 保留以兼容旧存档）
function serializeItem(it) {
  if (!it) return null;
  return {
    kind: it.kind, name: it.name, color: it.color, rarity: it.rarity,
    atk: it.atk, def: it.def, range: it.range,
    speed: it.speed, hp: it.hp, mp: it.mp,
    setId: it.setId,       // 套装标记
    affixes: (it.affixes || []).map(a => ({
      stat: a.stat,
      value: a.value,
      mul: a.mul,
      label: a.label
    }))
  };
}

// 反序列化一件装备（补齐缺失字段，兼容旧存档）
function deserializeItem(it) {
  if (!it) return null;
  const o = {
    kind: it.kind, name: it.name, color: it.color, rarity: it.rarity,
    atk: it.atk || 0, def: it.def || 0, range: it.range || 0,
    speed: it.speed, hp: it.hp, mp: it.mp,
    setId: it.setId,       // 套装标记（旧存档没有 → undefined）
    affixes: []
  };
  for (const a of (it.affixes || [])) {
    o.affixes.push({
      stat: a.stat,
      value: a.value,
      mul: a.mul,
      label: a.label || affixLabel(a)   // 旧存档没 label → 实时算
    });
  }
  return o;
}

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); }
  catch(e) { return false; }
}

function saveGame() {
  if (!player || gameState !== 'play') return null;
  try {
    const data = {
      v: SAVE_VERSION,
      ts: Date.now(),
      player: {
        x: player.x, y: player.y,
        hp: player.hp, maxHp: player.maxHp,
        mp: player.mp, maxMp: player.maxMp,
        level: player.level, exp: player.exp, expToNext: player.expToNext,
        gold: player.gold,
        atk: player.atk, def: player.def, speed: player.speed,
        // 衍生战斗属性（暴击/吸血/冷却缩减/连击强化）
        crit: player.crit, lifesteal: player.lifesteal,
        cdr: player.cdr, comboPower: player.comboPower,
        facing: player.facing,
        dirX: player.dirX, dirY: player.dirY,
        skillPts: player.skillPts,
        skills: {
          fireball: { cd: player.skills.fireball.cd, maxCd: player.skills.fireball.maxCd },
          ice:      { cd: player.skills.ice.cd,      maxCd: player.skills.ice.maxCd },
          thunder:  { cd: player.skills.thunder.cd,  maxCd: player.skills.thunder.maxCd },
          heal:     { cd: player.skills.heal.cd,     maxCd: player.skills.heal.maxCd }
        },
        inventory: player.inventory.map(serializeItem),
        // 旧存档只存 weapon/armor 两个槽位；现在存全部 6 个槽位
        equipped: Object.fromEntries(
          EQUIP_SLOTS.map(s => [s, serializeItem(player.equipped[s])])
        ),
        totalKills: player.totalKills,
        totalGold: player.totalGold
      },
      progress: {
        bossKilled: window._bossKilled || false,
        chestsOpened: window._chestsOpened || 0,
        seed: window._worldSeed || 0
      },
      // 掉落保底状态（存进档，退出重进不重置）
      pity: {
        killsSinceDrop: pityState.killsSinceDrop,
        killsSinceRare: pityState.killsSinceRare
      },
      // 当前难度
      difficulty: currentDifficulty
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return data;
  } catch(e) {
    console.error('保存失败:', e);
    return null;
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) {
    console.error('读取存档失败:', e);
    return null;
  }
}

function deleteSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch(e) {}
}

function applySave(data) {
  if (!data || !data.player) return false;
  // 恢复难度 —— 必须在 generateWorld() 之前，
  // 否则敌人会按「上一个难度」生成（切档后难度对不上）。
  currentDifficulty = DIFFICULTIES[data.difficulty] ? data.difficulty : 'normal';
  // 重生世界（保留相同种子）
  window._worldSeed = data.progress && data.progress.seed || 0;
  generateWorld();
  // 重置玩家
  Object.assign(player, new Player(0, 0));
  // 应用属性
  const p = data.player;
  player.x = p.x; player.y = p.y;
  player.hp = p.hp; player.maxHp = p.maxHp;
  player.mp = p.mp; player.maxMp = p.maxMp;
  player.level = p.level; player.exp = p.exp; player.expToNext = p.expToNext;
  player.gold = p.gold;
  player.atk = p.atk; player.def = p.def; player.speed = p.speed;
  player.facing = p.facing || 1;
  // 二维朝向（旧存档没有这两个字段，缺省为朝右）
  player.dirX = (p.dirX === undefined || p.dirX === null) ? player.facing : p.dirX;
  player.dirY = (p.dirY === undefined || p.dirY === null) ? 0 : p.dirY;
  player.skillPts = p.skillPts || 0;
  // 衍生战斗属性（旧存档没有 → 缺省 0）
  player.crit = p.crit || 0;
  player.lifesteal = p.lifesteal || 0;
  player.cdr = p.cdr || 0;
  player.comboPower = p.comboPower || 0;
  if (p.skills) {
    for (const k of ['fireball', 'ice', 'thunder', 'heal']) {
      if (p.skills[k]) {
        player.skills[k].cd = p.skills[k].cd || 0;
        // maxCd 存的是旧版数值（更长）；技能基础 CD 已在 v2 调低，
        // 这里保留存档值以免旧档读回来技能反而更慢
        player.skills[k].maxCd = p.skills[k].maxCd;
      }
    }
  }
  if (p.inventory) {
    for (let i = 0; i < player.inventory.length && i < p.inventory.length; i++) {
      player.inventory[i] = deserializeItem(p.inventory[i]);
    }
  }
  if (p.equipped) {
    // 全部 6 个槽位（旧存档只有 weapon/armor，其余为 null）
    for (const slot of EQUIP_SLOTS) {
      player.equipped[slot] = deserializeItem(p.equipped[slot]);
    }
  }
  // 装备已应用 → 加成缓存失效
  player.invalidateBonus();
  // 旧存档的 hp/mp 可能是按旧上限存的，夹一次避免超上限
  player.hp = clamp(player.hp, 0, player.totalMaxHp);
  player.mp = clamp(player.mp, 0, player.totalMaxMp);
  player.totalKills = p.totalKills || 0;
  player.totalGold = p.totalGold || 0;
  // 进度标记
  window._bossKilled = data.progress && data.progress.bossKilled || false;
  window._chestsOpened = data.progress && data.progress.chestsOpened || 0;
  // 掉落保底状态（旧存档没有 → 重置）
  if (data.pity) {
    pityState.killsSinceDrop = data.pity.killsSinceDrop || 0;
    pityState.killsSinceRare = data.pity.killsSinceRare || 0;
  } else {
    resetPityState();
  }
  player._init = true;
  return true;
}

function togglePause() {
  if (gameState === 'play') {
    gameState = 'pause';
    document.getElementById('pause-panel').classList.add('active');
  } else if (gameState === 'pause') {
    gameState = 'play';
    document.getElementById('pause-panel').classList.remove('active');
  }
}

function startGame() {
  initAudio();
  generateWorld();
  // 重置玩家
  Object.assign(player, new Player(0, 0));
  player.x = (ROOMS[0].x + ROOMS[0].w/2) * TILE;
  player.y = (ROOMS[0].y + ROOMS[0].h/2) * TILE;
  player._init = true;
  // 确保玩家基础属性
  player.maxHp = 120; player.hp = 120;
  player.maxMp = 60; player.mp = 60;
  player.atk = 12; player.def = 5;
  // 难度调整玩家血蓝（简单难度血更多，严酷更少）
  applyDifficultyToPlayer(player);
  // 重置进度标记
  window._bossKilled = false;
  window._chestsOpened = 0;
  // 新游戏重置掉落保底
  resetPityState();
  gameOverTriggered = false;
  gameState = 'play';
  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('death-screen').style.display = 'none';
  document.getElementById('victory-screen').style.display = 'none';
  // 删除旧存档（开始新游戏）
  deleteSave();
}

function continueGame() {
  initAudio();
  if (!hasSave()) {
    alert('暂无存档，请点击"开始冒险"开启新游戏！');
    return;
  }
  const data = loadGame();
  if (!data) { startGame(); return; }
  if (!applySave(data)) { startGame(); return; }
  gameOverTriggered = false;
  gameState = 'play';
  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('death-screen').style.display = 'none';
  document.getElementById('victory-screen').style.display = 'none';
  spawnDamageNum(player.x, player.y, '继续游戏!', '#f1c40f');
}

function gameOver() {
  // 立刻锁定游戏状态（防止主循环继续跑 update）
  gameState = 'dead';
  window.__gameState = gameState;  // 调试
  // 清空所有按键，防止死亡后按键还在被处理
  for (const k in keys) keys[k] = false;
  // 死亡时清除存档（避免读档死循环）
  deleteSave();
  const dl = document.getElementById('death-level');
  const dg = document.getElementById('death-gold');
  if (dl) dl.textContent = player.level;
  if (dg) dg.textContent = player.gold;
  const ds = document.getElementById('death-screen');
  if (ds) ds.style.display = 'flex';
}

function gameWin() {
  gameState = 'win';
  // 通关后清除存档
  deleteSave();
  document.getElementById('victory-screen').style.display = 'flex';
}

// ============================================================
// 输入处理
// ============================================================
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === ' ') {
    if (currentDialog) advanceDialog();
  }
  if (k === 'i') {
    if (gameState !== 'play') return;
    const panel = document.getElementById('inventory-panel');
    panel.classList.toggle('active');
    if (panel.classList.contains('active')) renderInventoryPanel();
  }
  if (k === 'c') {
    if (gameState !== 'play') return;
    toggleCharacterPanel();
  }
  if (k === 'p' || k === 'escape') {
    if (gameState === 'play' || gameState === 'pause') {
      togglePause();
    }
  }
  if (k === 'm' && gameState === 'play') {
    const data = saveGame();
    if (data) {
      spawnDamageNum(player.x, player.y, '已保存!', '#f1c40f');
    }
  }
});

document.getElementById('btn-start').onclick = startGame;
document.getElementById('btn-retry').onclick = startGame;
document.getElementById('btn-restart').onclick = startGame;

// 继续游戏按钮（如果有存档）
const btnContinue = document.getElementById('btn-continue');
const saveInfo = document.getElementById('save-info');
function refreshStartScreen() {
  // 继续游戏按钮始终可见（没存档时点击会提示）
  if (btnContinue) {
    btnContinue.style.display = '';
    if (hasSave()) {
      btnContinue.style.opacity = '1';
      btnContinue.style.cursor = 'pointer';
      const data = loadGame();
      if (data && saveInfo) {
        const d = new Date(data.ts);
        const t = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        saveInfo.textContent = `存档: Lv${data.player.level} | ${data.player.gold}金 | ${t}`;
        saveInfo.style.display = '';
      }
    } else {
      btnContinue.style.opacity = '0.5';
      btnContinue.style.cursor = 'not-allowed';
      if (saveInfo) saveInfo.textContent = '（暂无存档）';
    }
  }
}
refreshStartScreen();
if (btnContinue) btnContinue.onclick = continueGame;

// ============================================================
// 难度选择 UI
// ============================================================
function buildDifficultyPanel() {
  const cont = document.getElementById('difficulty-choices');
  const desc = document.getElementById('difficulty-desc');
  if (!cont) return;
  cont.innerHTML = '';
  for (const id of DIFFICULTY_ORDER) {
    const d = DIFFICULTIES[id];
    const btn = document.createElement('button');
    btn.className = 'diff-btn';
    btn.dataset.diff = id;
    btn.textContent = `${d.icon} ${d.name}`;
    btn.onclick = () => {
      currentDifficulty = id;
      refreshDifficultyPanel();
      if (desc) desc.textContent = `已选择：${d.icon} ${d.name} — ${d.desc}`;
    };
    cont.appendChild(btn);
  }
  refreshDifficultyPanel();
}

function refreshDifficultyPanel() {
  const cont = document.getElementById('difficulty-choices');
  const desc = document.getElementById('difficulty-desc');
  if (!cont) return;
  cont.querySelectorAll('.diff-btn').forEach(el => {
    const on = el.dataset.diff === currentDifficulty;
    el.classList.toggle('selected', on);
    const d = DIFFICULTIES[el.dataset.diff];
    if (on) el.style.borderColor = d.color;
    else el.style.borderColor = '';
  });
  if (desc && !desc.textContent.startsWith('已选择')) {
    desc.textContent = getDifficulty().desc;
  }
}
buildDifficultyPanel();

// 删除存档按钮
const btnDelSave = document.getElementById('btn-delete-save');
if (btnDelSave) btnDelSave.onclick = () => {
  if (confirm('确定要删除存档吗？此操作不可撤销。')) {
    deleteSave();
    refreshStartScreen();
  }
};

// 暂停面板按钮
const btnResume = document.getElementById('btn-resume');
const btnPauseSave = document.getElementById('btn-pause-save');
const btnPauseExit = document.getElementById('btn-pause-exit');
if (btnResume) btnResume.onclick = () => {
  document.getElementById('pause-panel').classList.remove('active');
  gameState = 'play';
  gameOverTriggered = false;
};
if (btnPauseSave) btnPauseSave.onclick = () => {
  const data = saveGame();
  if (data) {
    spawnDamageNum(player.x, player.y, '已保存!', '#f1c40f');
    btnPauseSave.textContent = '✓ 已保存';
    setTimeout(() => { btnPauseSave.textContent = '💾 保存游戏'; }, 1200);
  }
};
if (btnPauseExit) btnPauseExit.onclick = () => {
  document.getElementById('pause-panel').classList.remove('active');
  saveGame();
  gameState = 'menu';
  document.getElementById('start-screen').style.display = '';
  refreshStartScreen();
};

// 角色面板关闭按钮
const btnCharClose = document.getElementById('char-close');
if (btnCharClose) btnCharClose.onclick = () => {
  document.getElementById('character-panel').classList.remove('active');
};

// 自动保存计时
let autoSaveTimer = 0;
const AUTOSAVE_FRAMES = 600; // 10 秒 @ 60fps

// ============================================================
// 主循环
// ============================================================
let lastTime = 0;
function loop(t) {
  const dt = t - lastTime;
  lastTime = t;

  if (gameState === 'play') {
    // 顿帧：命中瞬间冻结世界更新（只渲染），制造打击的"咬合感"
    // 注意：只冻结 update，不冻结渲染 —— 否则画面会黑掉
    //
    // —— 设计取舍 ——
    // 完全冻结（玩家也不能动）打击感最强，但 9 帧的击杀顿帧会明显打断走位，
    // 玩起来"粘手"。折中方案：顿帧期间**玩家仍可移动**（保持操作响应），
    // 只冻结敌人、弹道、粒子 —— 观感上世界"顿住"，但玩家不被夺走控制权。
    if (hitStop > 0) {
      hitStop--;
      if (!upgradeActive) {
        // 玩家照常响应输入（移动），但**不推进攻击/技能冷却**，
        // 否则顿帧里连击计时会错乱、且玩家的新攻击会不断重置顿帧。
        player.updateDuringHitStop();
      }
      // 相机仍要跟随玩家，否则画面会卡在原地
      updateCamera();
    } else if (!upgradeActive) {
      // Boss 死亡后把 _bossChest 注入到 chests 列表（只一次）
      if (window._bossChest && !window._bossChest._added) {
        window._bossChest._added = true;
        chests.push(window._bossChest);
        window._bossChest = null;
      }
      player.update();
      for (const e of enemies) if (e.alive) e.update();
      // 实体互相推开（放在所有 update 之后，处理残留重叠）
      Entity.resolveCollisions();
      for (let i = projectiles.length - 1; i >= 0; i--) {
        projectiles[i].update();
        if (!projectiles[i].alive) projectiles.splice(i, 1);
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        if (particles[i].life <= 0) particles.splice(i, 1);
      }
      updateCamera();

      if (player.hp <= 0 && !gameOverTriggered) {
        gameOverTriggered = true;
        player.alive = false;
        setTimeout(gameOver, 800);
      }

      // 自动存档（每 10 秒）
      autoSaveTimer++;
      if (autoSaveTimer >= AUTOSAVE_FRAMES) {
        autoSaveTimer = 0;
        saveGame();
      }
    }

    // 渲染
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);
    drawWorld();
    drawDecorations();
    drawChests();
    drawPickups();
    drawNPCs();
    drawEntities();
    drawProjectiles();
    drawParticles();

    updateHUD();
    drawMinimap();
    drawDamageVignette();
  } else if (gameState === 'menu' || gameState === 'dead' || gameState === 'win') {
    // 背景动画
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);
    // 星空
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 80; i++) {
      const x = (i * 137 + t * 0.02) % W;
      const y = (i * 89) % H;
      ctx.globalAlpha = 0.3 + Math.sin(t * 0.001 + i) * 0.3;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

