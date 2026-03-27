// ============================================================
//  Kill the Boss — Office Warfare
// ============================================================

const BOSS = {
    name: 'Chad from Management',
    emoji: '👔',
    maxHp: 120,
    phases: [
        {
            threshold: 1.00,
            label: 'Passive Aggressive',
            phaseClass: 'boss-phase-1',
            attacks: [
                { weight: 40, fn: attackEmail },
                { weight: 30, fn: attackMeeting },
                { weight: 30, fn: attackCredit },
            ],
        },
        {
            threshold: 0.60,
            label: 'Micromanager Mode',
            phaseClass: 'boss-phase-2',
            emoji: '🤵',
            attacks: [
                { weight: 30, fn: attackEmail },
                { weight: 25, fn: attackPIP },
                { weight: 25, fn: attackSlack },
                { weight: 20, fn: attackShield },
            ],
        },
        {
            threshold: 0.25,
            label: '🔥 FULL MELTDOWN',
            phaseClass: 'boss-phase-3',
            emoji: '🤬',
            attacks: [
                { weight: 40, fn: attackFriday },
                { weight: 35, fn: attackFire },
                { weight: 25, fn: attackPIP },
            ],
        },
    ],
};

// ── Weapons ──────────────────────────────────────────────────

const WEAPONS = {
    stapler: {
        name: '📎 Stapler',
        cost: 0,
        action: 'stapler',
        use: async () => {
            const dmg = rand(8, 16);
            log(`You hurl the stapler right at Chad's forehead! (${dmg} dmg)`, 'weapon');
            await dealDamageToBoss(dmg);
        },
    },
    keyboard: {
        name: '⌨️ Keyboard',
        cost: 20,
        action: 'keyboard',
        use: async () => {
            const dmg = rand(22, 34);
            log(`You SMASH Chad in the face with the keyboard!! (${dmg} dmg)`, 'weapon');
            await dealDamageToBoss(dmg);
        },
    },
    coffee: {
        name: '☕ Hot Coffee',
        cost: 15,
        use: async () => {
            const dmg = rand(18, 26);
            log(`You dump scalding coffee on Chad! He screams! (${dmg} dmg)`, 'weapon');
            await dealDamageToBoss(dmg);
            if (Math.random() < 0.40 && !state.boss.berserk) {
                state.boss.stunned = true;
                log('Chad is too busy crying to attack next turn!', 'stun');
            }
        },
    },
    chair: {
        name: '🪑 Office Chair',
        cost: 25,
        use: async () => {
            const dmg = rand(30, 45);
            log(`You swing the entire office chair at Chad! WHAM! (${dmg} dmg)`, 'weapon');
            await dealDamageToBoss(dmg, true); // crit visual
        },
    },
    papers: {
        name: '📋 TPS Reports',
        cost: 0,
        use: async () => {
            state.player.guarding = true;
            const rest = 15;
            state.player.hp = clamp(state.player.hp + rest, 0, state.player.maxHp);
            log(`You hide behind a stack of TPS reports and catch your breath. (+${rest} sanity)`, 'heal');
        },
    },
};

const KEY_MAP = { '1': 'stapler', '2': 'keyboard', '3': 'coffee', '4': 'chair', '5': 'papers' };
const ACTION_ORDER = ['stapler', 'keyboard', 'coffee', 'chair', 'papers'];

// ── State ─────────────────────────────────────────────────────

let state = {};
let turns = 0, damageDealt = 0, damageReceived = 0;

function initState() {
    state = {
        player: { hp: 100, maxHp: 100, mp: 60, maxMp: 60, guarding: false, stunned: false },
        boss:   { hp: 0, maxHp: 0, stunned: false, shielded: false, buffed: false, berserk: false, currentPhaseIdx: 0 },
        playerTurn: true,
        busy: false,
    };
    turns = 0; damageDealt = 0; damageReceived = 0;
}

// ── DOM helpers ───────────────────────────────────────────────

const qs = sel => document.querySelector(sel);

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    qs('#' + id).classList.add('active');
}

function log(msg, type = 'system') {
    const el = document.createElement('div');
    el.className = `log-entry log-${type}`;
    el.textContent = msg;
    const c = qs('#log-entries');
    c.appendChild(el);
    c.scrollTop = c.scrollHeight;
    while (c.children.length > 80) c.removeChild(c.firstChild);
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function weightedPick(arr) {
    let r = Math.random() * arr.reduce((s, a) => s + a.weight, 0);
    for (const item of arr) { r -= item.weight; if (r <= 0) return item; }
    return arr[arr.length - 1];
}

// ── UI Updates ────────────────────────────────────────────────

function updateBossUI() {
    const { boss } = state;
    const pct = clamp(boss.hp / boss.maxHp, 0, 1);
    const bar = qs('#boss-hp-bar');
    bar.style.width = (pct * 100) + '%';
    bar.className = 'hp-bar boss-bar' + (pct < 0.25 ? ' low' : '');
    qs('#boss-hp-text').textContent = `${Math.max(0, boss.hp)} / ${boss.maxHp}`;

    const fx = [];
    if (boss.stunned)  fx.push({ label: 'Crying',    cls: 'status-stun' });
    if (boss.shielded) fx.push({ label: 'HR Shield',  cls: 'status-shield' });
    if (boss.buffed)   fx.push({ label: 'Enraged',    cls: 'status-buff' });
    if (boss.berserk)  fx.push({ label: 'MELTDOWN',   cls: 'status-berserk' });
    qs('#boss-status-effects').innerHTML = fx.map(e =>
        `<span class="status-badge ${e.cls}">${e.label}</span>`).join('');
}

function updatePlayerUI() {
    const { player } = state;
    const hpPct = clamp(player.hp / player.maxHp, 0, 1);
    const mpPct = clamp(player.mp / player.maxMp, 0, 1);

    const hpBar = qs('#player-hp-bar');
    hpBar.style.width = (hpPct * 100) + '%';
    hpBar.className = 'hp-bar player-bar' + (hpPct < 0.3 ? ' low' : hpPct < 0.55 ? ' medium' : '');
    qs('#player-hp-text').textContent = `${Math.max(0, player.hp)} / ${player.maxHp}`;
    qs('#player-mp-bar').style.width = (mpPct * 100) + '%';
    qs('#player-mp-text').textContent = `${player.mp} / ${player.maxMp}`;

    const fx = [];
    if (player.stunned)  fx.push({ label: 'Stunned',  cls: 'status-stun' });
    if (player.guarding) fx.push({ label: 'Blocking',  cls: 'status-guard' });
    qs('#player-status-effects').innerHTML = fx.map(e =>
        `<span class="status-badge ${e.cls}">${e.label}</span>`).join('');

    document.querySelectorAll('.action-btn').forEach(btn => {
        const wk = WEAPONS[btn.dataset.action];
        btn.disabled = !state.playerTurn || state.busy || (wk && player.mp < wk.cost) || player.stunned;
        btn.classList.toggle('active-guard', btn.dataset.action === 'papers' && player.guarding);
    });
}

function setButtonsEnabled(on) {
    document.querySelectorAll('.action-btn').forEach(b => b.disabled = !on);
}

// ── Hit animations ────────────────────────────────────────────

async function animateBossHurt(dmg, isCrit = false) {
    const sprite = qs('#boss-sprite');

    // Screen shake
    const game = qs('#game');
    game.classList.remove('shaking');
    game.offsetHeight;
    game.classList.add('shaking');
    setTimeout(() => game.classList.remove('shaking'), 450);

    // Hurt animation
    sprite.classList.add('boss-hurt');

    // Hit splat emoji
    const splats = ['💥', '👊', '🤛', '💢', '⚡', '🔥', '💫'];
    const hitEl = qs('#hit-effect');
    hitEl.textContent = splats[rand(0, splats.length - 1)];
    hitEl.style.left = rand(20, 65) + '%';
    hitEl.style.top  = rand(15, 55) + '%';
    hitEl.classList.remove('hidden');
    hitEl.style.animation = 'none'; hitEl.offsetHeight; hitEl.style.animation = '';

    // Floating damage number
    const dmgEl = qs('#damage-number');
    dmgEl.textContent = isCrit ? `${dmg}!!` : `-${dmg}`;
    dmgEl.className = 'damage-number' + (isCrit ? ' crit' : '');
    dmgEl.style.left = rand(30, 60) + '%';
    dmgEl.style.top  = rand(25, 50) + '%';
    dmgEl.style.animation = 'none'; dmgEl.offsetHeight; dmgEl.style.animation = '';

    await delay(550);
    sprite.classList.remove('boss-hurt');
    hitEl.classList.add('hidden');
    dmgEl.className = 'damage-number hidden';
}

async function animateBossAttack() {
    const sprite = qs('#boss-sprite');
    sprite.classList.add('boss-attacking');
    await delay(500);
    sprite.classList.remove('boss-attacking');
}

// ── Phase transitions ─────────────────────────────────────────

async function checkPhase() {
    const pct = state.boss.hp / state.boss.maxHp;
    let idx = 0;
    for (let i = 1; i < BOSS.phases.length; i++) {
        if (pct < BOSS.phases[i].threshold) idx = i;
    }
    if (idx <= state.boss.currentPhaseIdx) return;

    state.boss.currentPhaseIdx = idx;
    const phase = BOSS.phases[idx];

    qs('#boss-phase-badge').textContent = phase.label;
    qs('#boss-phase-badge').className = `boss-phase-badge phase-${idx + 1}`;
    qs('#boss-sprite').className = phase.phaseClass;
    if (phase.emoji) qs('#boss-sprite .boss-face').textContent = phase.emoji;
    if (idx === 2) state.boss.berserk = true;

    const msgs = [null, 'Chad is getting desperate — MICROMANAGER MODE!', 'Chad is having a FULL MELTDOWN!'];
    if (msgs[idx]) {
        log('⚠ ' + msgs[idx], 'phase');
        showPhaseOverlay(msgs[idx]);
    }
    await delay(500);
}

function showPhaseOverlay(msg) {
    let o = qs('#phase-overlay');
    if (!o) {
        o = document.createElement('div');
        o.id = 'phase-overlay';
        o.innerHTML = '<div class="phase-message"></div>';
        document.body.appendChild(o);
    }
    o.querySelector('.phase-message').textContent = msg;
    o.classList.remove('show'); o.offsetHeight; o.classList.add('show');
    setTimeout(() => o.classList.remove('show'), 1800);
}

// ── Player turn ───────────────────────────────────────────────

async function playerAction(actionKey) {
    if (!state.playerTurn || state.busy) return;
    if (!qs('#battle-screen').classList.contains('active')) return;

    const weapon = WEAPONS[actionKey];
    if (!weapon) return;
    if (state.player.mp < weapon.cost) { log('Not enough energy!', 'system'); return; }
    if (state.player.stunned) { log("You're too stressed to act!", 'system'); return; }

    state.busy = true;
    setButtonsEnabled(false);

    // Flash pressed button
    const btn = document.querySelector(`[data-action="${actionKey}"]`);
    if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 150); }

    state.player.mp = clamp(state.player.mp - weapon.cost, 0, state.player.maxMp);
    turns++;

    await weapon.use();
    updatePlayerUI();
    updateBossUI();

    if (checkBossDefeated()) return;
    await checkPhase();
    await delay(350);
    await bossTurn();
}

async function dealDamageToBoss(dmg, isCrit = false) {
    if (state.boss.shielded) {
        dmg = Math.floor(dmg * 0.5);
        state.boss.shielded = false;
        log("HR's shield absorbs half the damage!", 'system');
    }
    damageDealt += dmg;
    state.boss.hp -= dmg;
    await animateBossHurt(dmg, isCrit);
    updateBossUI();
}

// ── Boss attacks ──────────────────────────────────────────────

async function bossTurn() {
    if (!qs('#battle-screen').classList.contains('active')) return;

    if (state.boss.stunned) {
        log("Chad is still crying — skips his turn!", 'stun');
        state.boss.stunned = false;
        endTurn(); return;
    }

    await animateBossAttack();

    const phase = BOSS.phases[state.boss.currentPhaseIdx];
    await weightedPick(phase.attacks).fn();

    updatePlayerUI();
    updateBossUI();
    if (state.player.hp <= 0) { await gameOver(false); return; }
    endTurn();
}

function applyPlayerDamage(raw) {
    let dmg = raw;
    if (state.player.guarding) {
        const blocked = Math.floor(dmg * 0.60);
        dmg -= blocked;
        log(`The TPS Reports block ${blocked} damage!`, 'player');
        state.player.guarding = false;
    }
    dmg = Math.max(1, dmg);
    damageReceived += dmg;
    state.player.hp -= dmg;
    return dmg;
}

function endTurn() {
    state.player.mp = clamp(state.player.mp + 5, 0, state.player.maxMp);
    state.player.guarding = false;
    state.playerTurn = true;
    state.busy = false;
    updatePlayerUI();
}

// Boss attack functions
function attackEmail() {
    const dmg = rand(4, 9);
    const msgs = [
        `Chad sends a passive aggressive "per my last email" for ${dmg} stress!`,
        `Chad replies-all to a 50-person thread. ${dmg} sanity lost!`,
        `Chad emails your boss about "attitude issues." ${dmg} stress!`,
    ];
    log(msgs[rand(0, msgs.length-1)], 'boss');
    applyPlayerDamage(dmg);
}

function attackMeeting() {
    const dmg = rand(5, 10);
    state.player.mp = clamp(state.player.mp - 8, 0, state.player.maxMp);
    const msgs = [
        `Chad schedules a 2-hour sync that could've been an email. (-8⚡, ${dmg} stress)`,
        `Chad calls an emergency stand-up meeting at 4:58pm. (-8⚡, ${dmg} stress)`,
    ];
    log(msgs[rand(0, msgs.length-1)], 'boss');
    applyPlayerDamage(dmg);
}

function attackCredit() {
    const dmg = rand(6, 12);
    const msgs = [
        `Chad takes credit for YOUR project in front of everyone! ${dmg} sanity lost!`,
        `Chad presents your work as his own idea. You're furious. ${dmg} stress!`,
    ];
    log(msgs[rand(0, msgs.length-1)], 'boss');
    applyPlayerDamage(dmg);
}

function attackPIP() {
    const dmg = rand(10, 18);
    log(`Chad puts you on a Performance Improvement Plan!! ${dmg} stress!`, 'boss');
    applyPlayerDamage(dmg);
}

function attackSlack() {
    const dmg = rand(6, 11);
    state.boss.buffed = true;
    log(`Chad sends 12 Slack messages asking "did you see my last message??" ${dmg} stress! (He's getting hyped up)`, 'boss');
    applyPlayerDamage(dmg);
}

function attackShield() {
    state.boss.shielded = true;
    log(`Chad runs to HR to cover himself. Next hit will be reduced!`, 'boss');
}

function attackFriday() {
    const base = rand(14, 22);
    const bonus = state.boss.buffed ? Math.floor(base * 0.4) : 0;
    const dmg = base + bonus;
    state.boss.buffed = false;
    log(`Chad dumps a MASSIVE project on you at 5pm Friday!! ${dmg} stress!!`, 'boss');
    applyPlayerDamage(dmg);
}

function attackFire() {
    const dmg = rand(12, 20);
    log(`Chad screams "YOU'RE FIRED!" (he can't actually fire you but still) ${dmg} stress!!`, 'boss');
    applyPlayerDamage(dmg);
    if (Math.random() < 0.3) {
        state.player.stunned = true;
        log('The humiliation leaves you speechless — skip next turn!', 'stun');
    }
}

// ── Win / Lose ────────────────────────────────────────────────

function checkBossDefeated() {
    if (state.boss.hp <= 0) {
        state.boss.hp = 0;
        updateBossUI();
        gameOver(true);
        return true;
    }
    return false;
}

async function gameOver(victory) {
    state.busy = true; state.playerTurn = false;
    setButtonsEnabled(false);
    await delay(600);

    qs('#end-icon').textContent    = victory ? '🏆' : '😵';
    qs('#end-title').textContent   = victory ? 'YOU WIN!' : 'BURNED OUT';
    qs('#end-title').className     = victory ? 'victory' : 'defeat';
    qs('#end-message').textContent = victory
        ? 'Chad is on the floor. You got the corner office. LEGEND.'
        : 'Chad wins this round... but you\'ll be back Monday.';

    qs('#end-stats').innerHTML = `
        <div class="stat-item"><span class="stat-label">Turns</span><span class="stat-value">${turns}</span></div>
        <div class="stat-item"><span class="stat-label">Dealt</span><span class="stat-value">${damageDealt}</span></div>
        <div class="stat-item"><span class="stat-label">Taken</span><span class="stat-value">${damageReceived}</span></div>
        <div class="stat-item"><span class="stat-label">Sanity Left</span><span class="stat-value">${Math.max(0, state.player.hp)}</span></div>
    `;
    showScreen('end-screen');
}

// ── Start ─────────────────────────────────────────────────────

function startGame() {
    initState();
    state.boss.hp = BOSS.maxHp;
    state.boss.maxHp = BOSS.maxHp;

    qs('#boss-name-display').textContent = BOSS.name;
    qs('#boss-phase-badge').textContent  = BOSS.phases[0].label;
    qs('#boss-phase-badge').className    = '';
    qs('#boss-sprite').className         = BOSS.phases[0].phaseClass;
    qs('#boss-sprite .boss-face').textContent = BOSS.emoji;
    qs('#log-entries').innerHTML = '';

    log(`💼 Chad walks in. Time to settle this once and for all.`, 'system');
    log(`Press 1–5 or tap a weapon to attack!`, 'system');

    updateBossUI();
    updatePlayerUI();
    showScreen('battle-screen');
    state.busy = false;
}

// ── Events ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    qs('#start-btn').addEventListener('click', startGame);
    qs('#restart-btn').addEventListener('click', startGame);

    // Click buttons
    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!btn.disabled) playerAction(btn.dataset.action);
        });
    });

    // Keyboard: press 1–5
    document.addEventListener('keydown', e => {
        if (e.repeat) return;
        const action = KEY_MAP[e.key];
        if (!action) return;

        // Start game on key press from title screen
        if (qs('#title-screen').classList.contains('active')) {
            startGame(); return;
        }
        if (qs('#battle-screen').classList.contains('active')) {
            playerAction(action);
        }
    });
});
