// ============================================================
//  Kill the Boss — Game Logic
// ============================================================

// ─── Boss definitions ────────────────────────────────────────

const BOSSES = [
    {
        name: 'Malachar the Destroyer',
        emoji: '😈',
        maxHp: 150,
        phases: [
            {
                threshold: 1.00,  // Phase 1: full HP to 60%
                label: 'Phase I',
                phaseClass: 'boss-phase-1',
                announceAt: null,
                attacks: [
                    { name: 'Slash',        weight: 50, fn: bossSlash },
                    { name: 'Smash',        weight: 30, fn: bossSmash },
                    { name: 'Roar',         weight: 20, fn: bossRoar  },
                ],
            },
            {
                threshold: 0.60,  // Phase 2: 60% to 25%
                label: 'Phase II',
                phaseClass: 'boss-phase-2',
                announceAt: 0.60,
                attacks: [
                    { name: 'Slash',         weight: 30, fn: bossSlash        },
                    { name: 'Smash',         weight: 25, fn: bossSmash        },
                    { name: 'Crushing Blow', weight: 25, fn: bossCrushingBlow },
                    { name: 'Dark Shield',   weight: 20, fn: bossDarkShield   },
                ],
            },
            {
                threshold: 0.25,  // Phase 3: 25% and below
                label: 'Phase III — BERSERK',
                phaseClass: 'boss-phase-3',
                announceAt: 0.25,
                attacks: [
                    { name: 'Devastating Strike', weight: 40, fn: bossDevastating },
                    { name: 'Lifesteal',           weight: 35, fn: bossLifesteal   },
                    { name: 'Smash',               weight: 25, fn: bossSmash       },
                ],
            },
        ],
    },
];

// ─── Game state ──────────────────────────────────────────────

let state = {};
let turns = 0;
let damageDealt = 0;
let damageReceived = 0;

function initState() {
    state = {
        player: {
            hp: 100, maxHp: 100,
            mp: 60,  maxMp: 60,
            guarding: false,
            stunned: false,
        },
        boss: {
            hp: 0, maxHp: 0,
            stunned: false,
            shielded: false,
            buffed: false,
            berserk: false,
            currentPhaseIdx: 0,
        },
        bossData: null,
        playerTurn: true,
        busy: false,
    };
    turns = 0;
    damageDealt = 0;
    damageReceived = 0;
}

// ─── DOM helpers ─────────────────────────────────────────────

function qs(sel) { return document.querySelector(sel); }

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    qs('#' + id).classList.add('active');
}

function log(msg, type = 'system') {
    const el = document.createElement('div');
    el.className = `log-entry log-${type}`;
    el.textContent = msg;
    const container = qs('#log-entries');
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    // Keep log from getting too long
    while (container.children.length > 60) {
        container.removeChild(container.firstChild);
    }
}

function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function weightedPick(arr) {
    const total = arr.reduce((s, a) => s + a.weight, 0);
    let r = Math.random() * total;
    for (const item of arr) {
        r -= item.weight;
        if (r <= 0) return item;
    }
    return arr[arr.length - 1];
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── UI update helpers ───────────────────────────────────────

function updateBossUI() {
    const { boss, bossData } = state;
    const pct = clamp(boss.hp / boss.maxHp, 0, 1);
    const bar = qs('#boss-hp-bar');
    bar.style.width = (pct * 100) + '%';
    bar.className = 'hp-bar boss-bar' + (pct < 0.25 ? ' low' : '');
    qs('#boss-hp-text').textContent = `${Math.max(0, boss.hp)} / ${boss.maxHp}`;

    // Status effects
    const effects = [];
    if (boss.stunned)   effects.push({ label: 'Stunned',  cls: 'status-stun'  });
    if (boss.shielded)  effects.push({ label: 'Shielded', cls: 'status-shield' });
    if (boss.buffed)    effects.push({ label: 'Enraged',  cls: 'status-buff'  });
    if (boss.berserk)   effects.push({ label: 'Berserk',  cls: 'status-berserk' });

    const el = qs('#boss-status-effects');
    el.innerHTML = effects.map(e =>
        `<span class="status-badge ${e.cls}">${e.label}</span>`
    ).join('');
}

function updatePlayerUI() {
    const { player } = state;
    const hpPct = clamp(player.hp / player.maxHp, 0, 1);
    const mpPct = clamp(player.mp / player.maxMp, 0, 1);

    const hpBar = qs('#player-hp-bar');
    hpBar.style.width = (hpPct * 100) + '%';
    hpBar.className = 'hp-bar player-bar'
        + (hpPct < 0.30 ? ' low' : hpPct < 0.55 ? ' medium' : '');
    qs('#player-hp-text').textContent = `${Math.max(0, player.hp)} / ${player.maxHp}`;

    qs('#player-mp-bar').style.width = (mpPct * 100) + '%';
    qs('#player-mp-text').textContent = `${player.mp} / ${player.maxMp}`;

    // Status effects
    const effects = [];
    if (player.stunned)  effects.push({ label: 'Stunned', cls: 'status-stun'  });
    if (player.guarding) effects.push({ label: 'Guarding', cls: 'status-guard' });

    const el = qs('#player-status-effects');
    el.innerHTML = effects.map(e =>
        `<span class="status-badge ${e.cls}">${e.label}</span>`
    ).join('');

    // Button states
    document.querySelectorAll('.action-btn').forEach(btn => {
        const action = btn.dataset.action;
        const cost = ACTION_COSTS[action] || 0;
        btn.disabled = !state.playerTurn || state.busy || player.mp < cost || player.stunned;
        btn.classList.toggle('active-guard', action === 'guard' && player.guarding);
    });

    if (player.stunned) {
        document.querySelectorAll('.action-btn').forEach(btn => btn.disabled = true);
    }
}

function setActionButtonsEnabled(enabled) {
    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.disabled = !enabled;
    });
}

// ─── Boss sprite animation ───────────────────────────────────

function setBossPhaseClass(cls) {
    const sprite = qs('#boss-sprite');
    sprite.className = cls;
}

async function animateBossAttack() {
    const sprite = qs('#boss-sprite');
    sprite.classList.add('boss-attacking');
    await delay(500);
    sprite.classList.remove('boss-attacking');
}

async function animateBossHurt() {
    const sprite = qs('#boss-sprite');
    sprite.classList.add('boss-hurt');

    // Show hit effect
    const hitEl = qs('#hit-effect');
    hitEl.textContent = ['💥', '⚡', '✨', '🔥'][rand(0, 3)];
    hitEl.style.left = rand(30, 70) + '%';
    hitEl.style.top = rand(20, 60) + '%';
    hitEl.classList.remove('hidden');
    hitEl.style.animation = 'none';
    hitEl.offsetHeight; // reflow
    hitEl.style.animation = '';

    await delay(400);
    sprite.classList.remove('boss-hurt');
    hitEl.classList.add('hidden');
}

// ─── Phase transition ────────────────────────────────────────

async function checkPhaseTransition() {
    const { boss, bossData } = state;
    const hpPct = boss.hp / boss.maxHp;
    const phases = bossData.phases;

    let targetIdx = 0;
    for (let i = phases.length - 1; i >= 0; i--) {
        if (hpPct <= phases[i].threshold) {
            targetIdx = i;
            break;
        }
    }

    // Special: phase 1 always starts at idx 0 until threshold is crossed
    // Recalculate: find the highest-indexed phase whose threshold the boss HP is below
    targetIdx = 0;
    for (let i = 1; i < phases.length; i++) {
        if (hpPct < phases[i].threshold) {
            targetIdx = i;
        }
    }

    if (targetIdx > boss.currentPhaseIdx) {
        boss.currentPhaseIdx = targetIdx;
        const phase = phases[targetIdx];

        // Update badge
        const badge = qs('#boss-phase-badge');
        badge.textContent = phase.label;
        badge.className = `boss-phase-badge phase-${targetIdx + 1}`;

        // Update sprite class
        setBossPhaseClass(phase.phaseClass);

        // Update boss face emoji
        const faces = ['😈', '👹', '💀'];
        qs('#boss-sprite .boss-face').textContent = faces[targetIdx] || '💀';

        // Set berserk status on phase 3
        if (targetIdx === 2) {
            boss.berserk = true;
        }

        // Announce
        const announcements = [
            null,
            `${bossData.name} enters Phase II — power surges!`,
            `${bossData.name} goes BERSERK — danger!`,
        ];
        if (announcements[targetIdx]) {
            log('⚠ ' + announcements[targetIdx], 'phase');
            log('The boss is enraged — attacks grow stronger!', 'warn');
        }

        // Flash overlay
        showPhaseOverlay(announcements[targetIdx] || '');
        await delay(500);
    }
}

function showPhaseOverlay(msg) {
    let overlay = qs('#phase-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'phase-overlay';
        const inner = document.createElement('div');
        inner.className = 'phase-message';
        overlay.appendChild(inner);
        document.body.appendChild(overlay);
    }
    overlay.querySelector('.phase-message').textContent = msg;
    overlay.classList.remove('show');
    overlay.offsetHeight;
    overlay.classList.add('show');
    setTimeout(() => overlay.classList.remove('show'), 1800);
}

// ─── Player actions ──────────────────────────────────────────

const ACTION_COSTS = {
    'slash': 0,
    'power-strike': 20,
    'magic-bolt': 15,
    'heal': 25,
    'guard': 0,
};

async function playerAction(action) {
    if (!state.playerTurn || state.busy || qs('#battle-screen').classList.contains('active') === false) return;

    const cost = ACTION_COSTS[action] || 0;
    if (state.player.mp < cost) {
        log('Not enough MP!', 'system');
        return;
    }

    state.busy = true;
    setActionButtonsEnabled(false);
    state.player.mp = clamp(state.player.mp - cost, 0, state.player.maxMp);
    turns++;

    switch (action) {
        case 'slash':        await doSlash();       break;
        case 'power-strike': await doPowerStrike();  break;
        case 'magic-bolt':   await doMagicBolt();    break;
        case 'heal':         await doHeal();         break;
        case 'guard':        await doGuard();        break;
    }

    updatePlayerUI();
    updateBossUI();

    if (checkBossDefeated()) return;

    await checkPhaseTransition();
    await delay(400);

    // Boss turn
    await bossTurn();
}

async function doSlash() {
    const dmg = rand(10, 20);
    log(`You slash the boss for ${dmg} damage.`, 'player');
    await dealDamageToBoss(dmg);
}

async function doPowerStrike() {
    const dmg = rand(25, 40);
    log(`⚡ You unleash a Power Strike for ${dmg} damage!`, 'player');
    await dealDamageToBoss(dmg);
}

async function doMagicBolt() {
    const dmg = rand(20, 30);
    const stunChance = Math.random() < 0.30;
    log(`✨ Your Magic Bolt hits for ${dmg} damage!`, 'player');
    await dealDamageToBoss(dmg);
    if (stunChance && !state.boss.berserk) {
        state.boss.stunned = true;
        log('⚡ The boss is stunned and will skip a turn!', 'stun');
    }
}

async function doHeal() {
    const heal = 30;
    state.player.hp = clamp(state.player.hp + heal, 0, state.player.maxHp);
    log(`💚 You heal for ${heal} HP.`, 'heal');
}

async function doGuard() {
    state.player.guarding = true;
    log('🛡 You take a defensive stance.', 'player');
}

async function dealDamageToBoss(dmg) {
    if (state.boss.shielded) {
        dmg = Math.floor(dmg * 0.5);
        state.boss.shielded = false;
        log('The boss\'s Dark Shield absorbs half the damage!', 'system');
    }
    damageDealt += dmg;
    state.boss.hp -= dmg;
    await animateBossHurt();
    updateBossUI();
}

// ─── Boss attacks ────────────────────────────────────────────

async function bossTurn() {
    if (!qs('#battle-screen').classList.contains('active')) return;

    const { boss, bossData } = state;

    if (boss.stunned) {
        log(`${bossData.name} is stunned and cannot act!`, 'stun');
        boss.stunned = false;
        endTurn();
        return;
    }

    await animateBossAttack();

    const phase = bossData.phases[boss.currentPhaseIdx];
    const chosenAttack = weightedPick(phase.attacks);
    await chosenAttack.fn();

    updatePlayerUI();
    updateBossUI();

    if (state.player.hp <= 0) {
        await gameOver(false);
        return;
    }

    endTurn();
}

function endTurn() {
    const { player } = state;

    // Mana regen
    player.mp = clamp(player.mp + 5, 0, player.maxMp);

    // Clear guard (it only lasts one incoming hit)
    player.guarding = false;

    state.playerTurn = true;
    state.busy = false;
    updatePlayerUI();
}

function applyPlayerDamage(rawDmg) {
    let dmg = rawDmg;
    if (state.player.guarding) {
        const blocked = Math.floor(dmg * 0.60);
        dmg -= blocked;
        log(`Your guard blocks ${blocked} damage!`, 'player');
        state.player.guarding = false;
        // Counter
        const counter = rand(3, 8);
        log(`You counter for ${counter} damage!`, 'player');
        state.boss.hp -= counter;
        damageDealt += counter;
    }
    dmg = Math.max(1, dmg);
    damageReceived += dmg;
    state.player.hp -= dmg;
    return dmg;
}

// Boss attack functions

function bossSlash() {
    const dmg = rand(3, 6);
    const final = applyPlayerDamage(dmg);
    log(`${state.bossData.name} slashes you for ${final} damage.`, 'boss');
}

function bossSmash() {
    const base = rand(5, 9);
    const bonus = state.boss.buffed ? Math.floor(base * 0.3) : 0;
    const dmg = base + bonus;
    state.boss.buffed = false;
    const final = applyPlayerDamage(dmg);
    log(`${state.bossData.name} smashes you for ${final} damage!`, 'boss');
}

function bossRoar() {
    state.boss.buffed = true;
    log(`${state.bossData.name} lets out a ROAR! Next attack +30%!`, 'boss');
}

function bossCrushingBlow() {
    const dmg = rand(7, 12);
    const final = applyPlayerDamage(dmg);
    log(`💀 ${state.bossData.name} delivers a Crushing Blow for ${final} damage!`, 'boss');
}

function bossDarkShield() {
    state.boss.shielded = true;
    log(`🌑 ${state.bossData.name} conjures a Dark Shield — next hit absorbed!`, 'boss');
}

function bossDevastating() {
    const dmg = rand(10, 16);
    const final = applyPlayerDamage(dmg);
    log(`🔥 ${state.bossData.name} unleashes a Devastating Strike for ${final} damage!!`, 'boss');
}

function bossLifesteal() {
    const dmg = rand(6, 10);
    const final = applyPlayerDamage(dmg);
    const heal = Math.floor(final * 0.3);
    state.boss.hp = clamp(state.boss.hp + heal, 0, state.boss.maxHp);
    log(`🩸 ${state.bossData.name} drains ${final} HP and heals for ${heal}!`, 'boss');
    updateBossUI();
}

// ─── Win / Lose ──────────────────────────────────────────────

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
    state.busy = true;
    state.playerTurn = false;
    setActionButtonsEnabled(false);

    await delay(600);

    const endIcon   = qs('#end-icon');
    const endTitle  = qs('#end-title');
    const endMsg    = qs('#end-message');
    const endStats  = qs('#end-stats');

    if (victory) {
        endIcon.textContent = '🏆';
        endTitle.textContent = 'VICTORY!';
        endTitle.className = 'victory';
        endMsg.textContent = 'The darkness is vanquished. The realm is saved!';
    } else {
        endIcon.textContent = '💀';
        endTitle.textContent = 'DEFEATED';
        endTitle.className = 'defeat';
        endMsg.textContent = `${state.bossData.name} stands triumphant. Rise again, hero.`;
    }

    endStats.innerHTML = `
        <div class="stat-item">
            <span class="stat-label">Turns</span>
            <span class="stat-value">${turns}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Damage Dealt</span>
            <span class="stat-value">${damageDealt}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Damage Taken</span>
            <span class="stat-value">${damageReceived}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">HP Remaining</span>
            <span class="stat-value">${Math.max(0, state.player.hp)}</span>
        </div>
    `;

    showScreen('end-screen');
}

// ─── Game start ──────────────────────────────────────────────

function startGame() {
    initState();

    const boss = BOSSES[0];
    state.bossData = boss;
    state.boss.hp = boss.maxHp;
    state.boss.maxHp = boss.maxHp;

    qs('#boss-name-display').textContent = boss.name;
    qs('#boss-phase-badge').textContent = boss.phases[0].label;
    qs('#boss-phase-badge').className = '';
    setBossPhaseClass(boss.phases[0].phaseClass);
    qs('#boss-sprite .boss-face').textContent = boss.emoji;

    // Clear log
    qs('#log-entries').innerHTML = '';

    log(`⚔ The battle begins! Face ${boss.name}!`, 'system');
    log('Choose your action wisely...', 'system');

    updateBossUI();
    updatePlayerUI();

    showScreen('battle-screen');
    state.busy = false;
}

// ─── Event listeners ─────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    qs('#start-btn').addEventListener('click', startGame);
    qs('#restart-btn').addEventListener('click', startGame);

    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!btn.disabled) {
                playerAction(btn.dataset.action);
            }
        });
    });
});
