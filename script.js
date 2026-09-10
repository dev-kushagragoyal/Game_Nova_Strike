(function () {
    'use strict';

    const STATES = { START: 0, PLAYING: 1, PAUSED: 2, GAMEOVER: 3 };
    let currentState = STATES.START;

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    const INTERNAL_WIDTH = 1280;
    const INTERNAL_HEIGHT = 720;
    canvas.width = INTERNAL_WIDTH;
    canvas.height = INTERNAL_HEIGHT;

    class SoundEngine {
        constructor() {
            this.ctx = null;
            this.muted = false;
        }

        init() {
            if (!this.ctx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                this.ctx = new AudioCtx();
            }
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
        }

        playTone(freq, type, duration, startVol = 0.1, endVol = 0) {
            if (!this.ctx || this.muted) return;
            try {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = type;
                osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
                gain.gain.setValueAtTime(startVol, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(Math.max(endVol, 0.0001), this.ctx.currentTime + duration);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start();
                osc.stop(this.ctx.currentTime + duration);
            } catch (e) {}
        }

        playBowRelease() {
            if (!this.ctx || this.muted) return;
            try {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(140, this.ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + 0.08);
                gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
                gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start();
                osc.stop(this.ctx.currentTime + 0.08);
            } catch (e) {}
        }

        playExplosion(isLarge = false) {
            if (!this.ctx || this.muted) return;
            try {
                const dur = isLarge ? 0.5 : 0.25;
                const bufferSize = this.ctx.sampleRate * dur;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                const noise = this.ctx.createBufferSource();
                noise.buffer = buffer;

                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(isLarge ? 300 : 600, this.ctx.currentTime);
                filter.frequency.linearRampToValueAtTime(40, this.ctx.currentTime + dur);

                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(isLarge ? 0.25 : 0.12, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + dur);

                noise.connect(filter);
                filter.connect(gain);
                gain.connect(this.ctx.destination);
                noise.start();
            } catch (e) {}
        }

        playPowerup() {
            this.playTone(350, 'sine', 0.1, 0.12);
            setTimeout(() => this.playTone(700, 'sine', 0.15, 0.12), 60);
        }

        playEMP() {
            this.playTone(800, 'sawtooth', 0.4, 0.2, 0.01);
        }
    }

    const audio = new SoundEngine();

    let lastTime = performance.now();
    let score = 0;
    let highScore = parseInt(localStorage.getItem('novastrike_highscore') || '0', 10);
    let level = 1;
    let combo = 0;
    let comboTimer = 0;
    const COMBO_TIMEOUT = 3.5;
    let maxCombo = 0;
    let screenShakeTime = 0;
    let screenShakeIntensity = 0;

    let enemySpawnTimer = 0;
    let powerupSpawnTimer = 0;
    let empCharge = 0; // EMP Gauge
    let activeBoss = null;

    const keys = { left: false, right: false, up: false, down: false, fire: false };

    class Starfield {
        constructor() {
            this.stars = [];
            this.init();
        }

        init() {
            this.stars = [];
            for (let i = 0; i < 120; i++) {
                this.stars.push({
                    x: Math.random() * INTERNAL_WIDTH,
                    y: Math.random() * INTERNAL_HEIGHT,
                    size: Math.random() * 2 + 0.5,
                    speed: Math.random() * 30 + 10,
                    alpha: Math.random() * 0.8 + 0.2
                });
            }
        }

        update(dt) {
            this.stars.forEach(star => {
                star.y += star.speed * dt;
                if (star.y > INTERNAL_HEIGHT) {
                    star.y = 0;
                    star.x = Math.random() * INTERNAL_WIDTH;
                }
            });
        }

        draw(ctx) {
            const bgGradient = ctx.createLinearGradient(0, 0, 0, INTERNAL_HEIGHT);
            bgGradient.addColorStop(0, '#03050d');
            bgGradient.addColorStop(1, '#020308');
            ctx.fillStyle = bgGradient;
            ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

            this.stars.forEach(star => {
                ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
                ctx.beginPath();
                ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
                ctx.fill();
            });
        }
    }

    class Particle {
        constructor(x, y, vx, vy, color, size, life, shape = 'circle') {
            this.x = x; this.y = y; this.vx = vx; this.vy = vy;
            this.color = color; this.size = size; this.maxLife = life; this.life = life;
            this.shape = shape;
        }

        update(dt) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.life -= dt;
        }

        draw(ctx) {
            const alpha = Math.max(0, this.life / this.maxLife);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            if (this.shape === 'ring') {
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 2;
                ctx.arc(this.x, this.y, this.size * (1 + (1 - alpha) * 2), 0, Math.PI * 2);
                ctx.stroke();
            } else {
                ctx.arc(this.x, this.y, Math.max(0.1, this.size * alpha), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    let particles = [];

    function spawnExplosion(x, y, color, count = 18, isLarge = false) {
        audio.playExplosion(isLarge);
        triggerScreenShake(isLarge ? 0.35 : 0.15, isLarge ? 10 : 4);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * (isLarge ? 280 : 160) + 20;
            particles.push(new Particle(
                x, y,
                Math.cos(angle) * speed, Math.sin(angle) * speed,
                color, Math.random() * (isLarge ? 4 : 2.5) + 1, Math.random() * 0.4 + 0.2
            ));
        }
        particles.push(new Particle(x, y, 0, 0, color, isLarge ? 35 : 18, 0.3, 'ring'));
    }

    class FloatingText {
        constructor(x, y, text, color = '#00f3ff') {
            this.x = x; this.y = y; this.text = text; this.color = color;
            this.life = 0.8; this.maxLife = 0.8;
        }

        update(dt) {
            this.y -= 35 * dt;
            this.life -= dt;
        }

        draw(ctx) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
            ctx.font = '900 13px monospace';
            ctx.fillStyle = this.color;
            ctx.textAlign = 'center';
            ctx.fillText(this.text, this.x, this.y);
            ctx.restore();
        }
    }

    let floatingTexts = [];

    class Player {
        constructor() {
            this.width = 48;
            this.height = 48;
            this.x = INTERNAL_WIDTH / 2;
            this.y = INTERNAL_HEIGHT - 90;
            this.speed = 520;
            this.hp = 100;
            this.maxHp = 100;
            this.fireCooldown = 0;
            this.hitFlash = 0;

            this.rapidFireTimer = 0;
            this.shieldTimer = 0;
            this.doubleScoreTimer = 0;
            this.multiArrowTimer = 0;
            this.bowDrawAnim = 0;
        }

        reset() {
            this.x = INTERNAL_WIDTH / 2;
            this.y = INTERNAL_HEIGHT - 90;
            this.hp = 100;
            this.rapidFireTimer = 0;
            this.shieldTimer = 0;
            this.doubleScoreTimer = 0;
            this.multiArrowTimer = 0;
            this.fireCooldown = 0;
            this.bowDrawAnim = 0;
        }

        update(dt) {
            if (keys.left) this.x -= this.speed * dt;
            if (keys.right) this.x += this.speed * dt;
            if (keys.up) this.y -= this.speed * 0.7 * dt;
            if (keys.down) this.y += this.speed * 0.7 * dt;

            this.x = Math.max(this.width / 2, Math.min(INTERNAL_WIDTH - this.width / 2, this.x));
            this.y = Math.max(INTERNAL_HEIGHT / 2, Math.min(INTERNAL_HEIGHT - 50, this.y));

            if (this.fireCooldown > 0) this.fireCooldown -= dt;
            if (this.hitFlash > 0) this.hitFlash -= dt;
            if (this.rapidFireTimer > 0) this.rapidFireTimer -= dt;
            if (this.shieldTimer > 0) this.shieldTimer -= dt;
            if (this.doubleScoreTimer > 0) this.doubleScoreTimer -= dt;
            if (this.multiArrowTimer > 0) this.multiArrowTimer -= dt;

            // Bow Draw Animation
            if (keys.fire) {
                this.bowDrawAnim = Math.min(1, this.bowDrawAnim + dt * 8);
            } else {
                this.bowDrawAnim = Math.max(0, this.bowDrawAnim - dt * 10);
            }

            const rate = this.rapidFireTimer > 0 ? 0.12 : 0.22;
            if (keys.fire && this.fireCooldown <= 0) {
                this.shoot();
                this.fireCooldown = rate;
            }

            // Engine Trail
            if (Math.random() < 0.5) {
                particles.push(new Particle(
                    this.x, this.y + 20,
                    (Math.random() - 0.5) * 20, Math.random() * 80 + 100,
                    '#00f3ff', Math.random() * 2 + 1, 0.2
                ));
            }
        }

        shoot() {
            audio.playBowRelease();
            
            if (this.multiArrowTimer > 0) {
                // Triple Arrow Volley
                playerBullets.push(new Arrow(this.x, this.y - 15, -120, -850));
                playerBullets.push(new Arrow(this.x, this.y - 20, 0, -900));
                playerBullets.push(new Arrow(this.x, this.y - 15, 120, -850));
            } else {
                // Single Kinetic Arrow
                playerBullets.push(new Arrow(this.x, this.y - 20, 0, -900));
            }
        }

        takeDamage(amount) {
            if (this.shieldTimer > 0) {
                particles.push(new Particle(this.x, this.y, 0, 0, '#00f3ff', 30, 0.2, 'ring'));
                return;
            }
            this.hp = Math.max(0, this.hp - amount);
            this.hitFlash = 0.15;
            triggerScreenShake(0.2, 6);
            audio.playTone(100, 'sawtooth', 0.2, 0.3);

            const flashEl = document.getElementById('damage-flash');
            flashEl.classList.add('active');
            setTimeout(() => flashEl.classList.remove('active'), 120);

            if (this.hp <= 0) {
                spawnExplosion(this.x, this.y, '#ff0078', 40, true);
                setGameState(STATES.GAMEOVER);
            }
        }

        draw(ctx) {
            ctx.save();
            ctx.translate(this.x, this.y);

            if (this.shieldTimer > 0) {
                ctx.strokeStyle = '#00f3ff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, 30, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Draw Cyber Bow Shape
            ctx.strokeStyle = this.hitFlash > 0 ? '#ff2a2a' : '#00f3ff';
            ctx.lineWidth = 3;

            // Bow Limbs
            const pullBack = this.bowDrawAnim * 8;
            ctx.beginPath();
            ctx.moveTo(-28, 8);
            ctx.quadraticCurveTo(0, -18, 28, 8);
            ctx.stroke();

            // Bow String
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-28, 8);
            ctx.lineTo(0, 10 + pullBack);
            ctx.lineTo(28, 8);
            ctx.stroke();

            // Arrow Nocked Visual
            if (this.bowDrawAnim > 0.1) {
                ctx.strokeStyle = '#ff0078';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(0, 10 + pullBack);
                ctx.lineTo(0, -16);
                ctx.stroke();
            }

            ctx.restore();
        }
    }

    const player = new Player();

    class Arrow {
        constructor(x, y, vx, vy) {
            this.x = x; this.y = y; this.vx = vx; this.vy = vy;
            this.radius = 3;
            this.markedForDeletion = false;
        }

        update(dt) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;

            // Arrow Particles
            if (Math.random() < 0.6) {
                particles.push(new Particle(this.x, this.y + 8, 0, 40, '#ff0078', 1.5, 0.15));
            }

            if (this.y < -20 || this.y > INTERNAL_HEIGHT + 20 || this.x < -20 || this.x > INTERNAL_WIDTH + 20) {
                this.markedForDeletion = true;
            }
        }

        draw(ctx) {
            ctx.save();
            ctx.strokeStyle = '#ff0078';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y + 12);
            ctx.lineTo(this.x, this.y - 10);
            ctx.stroke();

            // Arrow Head
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(this.x, this.y - 10, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    class EnemyBullet {
        constructor(x, y, vx, vy) {
            this.x = x; this.y = y; this.vx = vx; this.vy = vy;
            this.radius = 4;
            this.markedForDeletion = false;
        }

        update(dt) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            if (this.y > INTERNAL_HEIGHT + 20) this.markedForDeletion = true;
        }

        draw(ctx) {
            ctx.save();
            ctx.fillStyle = '#ff2a2a';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    let playerBullets = [];
    let enemyBullets = [];

    class Enemy {
        constructor(type) {
            this.type = type;
            this.x = Math.random() * (INTERNAL_WIDTH - 120) + 60;
            this.y = -35;
            this.markedForDeletion = false;
            this.timeAlive = 0;

            if (type === 'DRONE') {
                this.width = 28; this.height = 28;
                this.speed = 110; this.hp = 1; this.scoreVal = 10; this.color = '#00f3ff';
            } else if (type === 'STRIKER') {
                this.width = 32; this.height = 32;
                this.speed = 150; this.hp = 2; this.scoreVal = 25; this.color = '#ff0078';
            } else if (type === 'CRUISER') {
                this.width = 44; this.height = 44;
                this.speed = 80; this.hp = 5; this.scoreVal = 60; this.color = '#9d00ff';
                this.shootTimer = 2.0;
            }
        }

        update(dt) {
            this.timeAlive += dt;
            this.y += this.speed * dt;

            if (this.type === 'DRONE') {
                this.x += Math.sin(this.timeAlive * 3) * 40 * dt;
            } else if (this.type === 'CRUISER') {
                this.shootTimer -= dt;
                if (this.shootTimer <= 0) {
                    enemyBullets.push(new EnemyBullet(this.x, this.y + 20, 0, 220));
                    this.shootTimer = 2.5;
                }
            }

            // CRITICAL FIX: Hull damage when enemy passes ship uncaught
            if (this.y > INTERNAL_HEIGHT + 30) {
                this.markedForDeletion = true;
                player.takeDamage(8); // Hull damaged for missing enemy
                floatingTexts.push(new FloatingText(this.x, INTERNAL_HEIGHT - 40, 'MISSED!', '#ff2a2a'));
            }
        }

        takeDamage(amount) {
            this.hp -= amount;
            if (this.hp <= 0) {
                this.markedForDeletion = true;
                spawnExplosion(this.x, this.y, this.color, 16);
                addScore(this.scoreVal, this.x, this.y);
                empCharge = Math.min(100, empCharge + 8);
            } else {
                audio.playTone(260, 'square', 0.04, 0.05);
            }
        }

        draw(ctx) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.strokeStyle = this.color;
            ctx.fillStyle = '#0a0a14';
            ctx.lineWidth = 2;

            if (this.type === 'DRONE') {
                ctx.beginPath();
                ctx.moveTo(0, 12); ctx.lineTo(-12, -12); ctx.lineTo(12, -12);
                ctx.closePath(); ctx.fill(); ctx.stroke();
            } else if (this.type === 'STRIKER') {
                ctx.beginPath();
                ctx.moveTo(0, 16); ctx.lineTo(-14, -8); ctx.lineTo(14, -8);
                ctx.closePath(); ctx.fill(); ctx.stroke();
            } else if (this.type === 'CRUISER') {
                ctx.strokeRect(-18, -18, 36, 36);
                ctx.fillRect(-18, -18, 36, 36);
            }

            ctx.restore();
        }
    }

    let enemies = [];

    class Boss {
        constructor() {
            this.x = INTERNAL_WIDTH / 2;
            this.y = -80;
            this.targetY = 110;
            this.width = 140;
            this.height = 90;
            this.hp = 120 + level * 30;
            this.maxHp = this.hp;
            this.color = '#ff2a2a';
            this.phase = 'ENTRY';
            this.shootTimer = 0;
            this.moveTimer = 0;
            this.markedForDeletion = false;
            this.name = 'VOID REAPER';
        }

        update(dt) {
            if (this.phase === 'ENTRY') {
                this.y += 60 * dt;
                if (this.y >= this.targetY) {
                    this.y = this.targetY;
                    this.phase = 'FIGHT';
                }
                return;
            }

            this.moveTimer += dt;
            this.shootTimer += dt;
            this.x = (INTERNAL_WIDTH / 2) + Math.sin(this.moveTimer * 0.7) * 300;

            if (this.shootTimer >= 1.5) {
                this.shootTimer = 0;
                for (let i = -1; i <= 1; i++) {
                    enemyBullets.push(new EnemyBullet(this.x, this.y + 35, i * 50, 220));
                }
            }

            const hpPercent = Math.max(0, (this.hp / this.maxHp) * 100);
            document.getElementById('boss-hp-fill').style.width = hpPercent + '%';
        }

        takeDamage(amount) {
            this.hp -= amount;
            audio.playTone(160, 'square', 0.04, 0.06);
            if (this.hp <= 0) {
                this.markedForDeletion = true;
                spawnExplosion(this.x, this.y, '#ff0078', 60, true);
                addScore(1500, this.x, this.y);
                activeBoss = null;
                document.getElementById('boss-hud').classList.add('hidden');
            }
        }

        draw(ctx) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.fillStyle = '#08050c';
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 3;

            ctx.beginPath();
            ctx.moveTo(0, 40); ctx.lineTo(-60, -10); ctx.lineTo(-40, -35);
            ctx.lineTo(40, -35); ctx.lineTo(60, -10);
            ctx.closePath(); ctx.fill(); ctx.stroke();

            ctx.restore();
        }
    }

    class Powerup {
        constructor(x, y, type) {
            this.x = x; this.y = y; this.type = type;
            this.radius = 15;
            this.markedForDeletion = false;

            if (type === 'RAPID_FIRE') { this.color = '#ff6600'; this.label = 'RF'; }
            else if (type === 'SHIELD') { this.color = '#00f3ff'; this.label = 'SH'; }
            else if (type === 'DOUBLE_SCORE') { this.color = '#ffd700'; this.label = '2X'; }
            else if (type === 'HEALTH') { this.color = '#00ff88'; this.label = 'HP'; }
            else if (type === 'MULTI_ARROW') { this.color = '#9d00ff'; this.label = '3X'; }
        }

        update(dt) {
            this.y += 90 * dt;
            if (this.y > INTERNAL_HEIGHT + 30) this.markedForDeletion = true;
        }

        draw(ctx) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.fillStyle = 'rgba(10, 16, 32, 0.9)';
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();

            ctx.fillStyle = this.color;
            ctx.font = '900 10px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.label, 0, 1);
            ctx.restore();
        }
    }

    let powerups = [];

    function addScore(points, x, y) {
        combo++;
        comboTimer = COMBO_TIMEOUT;
        if (combo > maxCombo) maxCombo = combo;

        const multiplier = Math.min(4, Math.floor(combo / 5) + 1) * (player.doubleScoreTimer > 0 ? 2 : 1);
        const totalPoints = points * multiplier;
        score += totalPoints;

        floatingTexts.push(new FloatingText(x, y, `+${totalPoints}`));

        if (score > highScore) {
            highScore = score;
            localStorage.setItem('novastrike_highscore', highScore.toString());
        }

        updateHUD();
        checkLevelProgression();
    }

    function triggerEMP() {
        if (empCharge >= 100) {
            empCharge = 0;
            audio.playEMP();
            triggerScreenShake(0.3, 8);

            enemies.forEach(e => e.takeDamage(99));
            enemyBullets = [];
            floatingTexts.push(new FloatingText(INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2, 'EMP BLAST!', '#9d00ff'));
        }
    }

    function checkLevelProgression() {
        const requiredScore = level * 1000;
        if (score >= requiredScore && !activeBoss) {
            level++;
            if (level % 5 === 0) {
                activeBoss = new Boss();
                document.getElementById('boss-hud').classList.remove('hidden');
                document.getElementById('boss-name').textContent = activeBoss.name;
            }
        }
    }

    function triggerScreenShake(duration, intensity) {
        screenShakeTime = duration;
        screenShakeIntensity = intensity;
    }

    function updateSpawning(dt) {
        if (activeBoss) return;

        enemySpawnTimer += dt;
        const spawnInterval = Math.max(1.0, 2.8 - (level * 0.15));

        if (enemySpawnTimer >= spawnInterval) {
            enemySpawnTimer = 0;
            const roll = Math.random();
            if (roll < 0.6) enemies.push(new Enemy('DRONE'));
            else if (roll < 0.85) enemies.push(new Enemy('STRIKER'));
            else enemies.push(new Enemy('CRUISER'));
        }

        powerupSpawnTimer += dt;
        if (powerupSpawnTimer >= 12.0) {
            powerupSpawnTimer = 0;
            const types = ['RAPID_FIRE', 'SHIELD', 'DOUBLE_SCORE', 'HEALTH', 'MULTI_ARROW'];
            const chosen = types[Math.floor(Math.random() * types.length)];
            const spawnX = Math.random() * (INTERNAL_WIDTH - 100) + 50;
            powerups.push(new Powerup(spawnX, -20, chosen));
        }
    }

    function checkCollisions() {
        for (let b = playerBullets.length - 1; b >= 0; b--) {
            const bullet = playerBullets[b];

            if (activeBoss && activeBoss.phase === 'FIGHT') {
                if (Math.abs(bullet.x - activeBoss.x) < activeBoss.width / 2 &&
                    Math.abs(bullet.y - activeBoss.y) < activeBoss.height / 2) {
                    activeBoss.takeDamage(1);
                    bullet.markedForDeletion = true;
                    continue;
                }
            }

            for (let e = enemies.length - 1; e >= 0; e--) {
                const enemy = enemies[e];
                const dist = Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y);
                if (dist < enemy.width / 2 + bullet.radius) {
                    enemy.takeDamage(1);
                    bullet.markedForDeletion = true;
                    break;
                }
            }
        }

        for (let b = enemyBullets.length - 1; b >= 0; b--) {
            const bullet = enemyBullets[b];
            const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y);
            if (dist < player.width / 3 + bullet.radius) {
                player.takeDamage(10);
                bullet.markedForDeletion = true;
            }
        }

        for (let e = enemies.length - 1; e >= 0; e--) {
            const enemy = enemies[e];
            const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
            if (dist < (enemy.width / 2 + player.width / 3)) {
                player.takeDamage(20);
                enemy.takeDamage(99);
            }
        }

        for (let p = powerups.length - 1; p >= 0; p--) {
            const pow = powerups[p];
            const dist = Math.hypot(pow.x - player.x, pow.y - player.y);
            if (dist < pow.radius + player.width / 2) {
                audio.playPowerup();
                if (pow.type === 'RAPID_FIRE') player.rapidFireTimer = 8.0;
                if (pow.type === 'SHIELD') player.shieldTimer = 10.0;
                if (pow.type === 'DOUBLE_SCORE') player.doubleScoreTimer = 10.0;
                if (pow.type === 'HEALTH') player.hp = Math.min(player.maxHp, player.hp + 25);
                if (pow.type === 'MULTI_ARROW') player.multiArrowTimer = 8.0;
                pow.markedForDeletion = true;
                floatingTexts.push(new FloatingText(pow.x, pow.y, 'POWER UP!', '#ffd700'));
            }
        }
    }

    function updateHUD() {
        document.getElementById('score-val').textContent = score.toString().padStart(6, '0');
        document.getElementById('high-score-val').textContent = highScore.toString();
        document.getElementById('sector-label').textContent = `SECTOR ${level.toString().padStart(2, '0')}`;

        const healthFill = document.getElementById('health-bar-fill');
        const hpPercent = Math.max(0, player.hp);
        healthFill.style.width = hpPercent + '%';
        if (hpPercent < 30) healthFill.style.backgroundColor = '#ff2a2a';
        else if (hpPercent < 60) healthFill.style.backgroundColor = '#ff6600';
        else healthFill.style.backgroundColor = '#00ff88';

        document.getElementById('emp-bar-fill').style.width = empCharge + '%';

        const comboDisplay = document.getElementById('combo-display');
        if (combo > 1) {
            comboDisplay.classList.remove('hidden');
            document.getElementById('combo-count').textContent = `${combo}x`;
        } else {
            comboDisplay.classList.add('hidden');
        }

        const buffsContainer = document.getElementById('buffs-container');
        buffsContainer.innerHTML = '';
        if (player.rapidFireTimer > 0) buffsContainer.innerHTML += `<span class="buff-badge buff-rf">RF</span>`;
        if (player.shieldTimer > 0) buffsContainer.innerHTML += `<span class="buff-badge buff-sh">SHIELD</span>`;
        if (player.doubleScoreTimer > 0) buffsContainer.innerHTML += `<span class="buff-badge buff-2x">2X</span>`;
        if (player.multiArrowTimer > 0) buffsContainer.innerHTML += `<span class="buff-badge buff-multi">3X</span>`;
    }

    const starfield = new Starfield();

    function gameLoop(time) {
        const dt = Math.min((time - lastTime) / 1000, 0.1);
        lastTime = time;

        if (currentState === STATES.PLAYING) {
            if (comboTimer > 0) {
                comboTimer -= dt;
                if (comboTimer <= 0) combo = 0;
            }

            starfield.update(dt);
            player.update(dt);
            updateSpawning(dt);

            if (activeBoss) activeBoss.update(dt);

            playerBullets.forEach(b => b.update(dt));
            enemyBullets.forEach(b => b.update(dt));
            enemies.forEach(e => e.update(dt));
            powerups.forEach(p => p.update(dt));
            particles.forEach(p => p.update(dt));
            floatingTexts.forEach(ft => ft.update(dt));

            checkCollisions();

            playerBullets = playerBullets.filter(b => !b.markedForDeletion);
            enemyBullets = enemyBullets.filter(b => !b.markedForDeletion);
            enemies = enemies.filter(e => !e.markedForDeletion);
            powerups = powerups.filter(p => !p.markedForDeletion);
            particles = particles.filter(p => p.life > 0);
            floatingTexts = floatingTexts.filter(ft => ft.life > 0);

            updateHUD();
        } else if (currentState === STATES.START || currentState === STATES.GAMEOVER) {
            starfield.update(dt);
        }

        ctx.save();

        if (screenShakeTime > 0) {
            screenShakeTime -= dt;
            const offsetX = (Math.random() - 0.5) * screenShakeIntensity;
            const offsetY = (Math.random() - 0.5) * screenShakeIntensity;
            ctx.translate(offsetX, offsetY);
        }

        ctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
        starfield.draw(ctx);

        if (currentState === STATES.PLAYING || currentState === STATES.PAUSED) {
            particles.forEach(p => p.draw(ctx));
            powerups.forEach(p => p.draw(ctx));
            playerBullets.forEach(b => b.draw(ctx));
            enemyBullets.forEach(b => b.draw(ctx));
            enemies.forEach(e => e.draw(ctx));
            if (activeBoss) activeBoss.draw(ctx);
            player.draw(ctx);
            floatingTexts.forEach(ft => ft.draw(ctx));
        }

        ctx.restore();

        requestAnimationFrame(gameLoop);
    }

    function setGameState(newState) {
        currentState = newState;
        const hud = document.getElementById('hud');
        const startScreen = document.getElementById('start-screen');
        const pauseScreen = document.getElementById('pause-screen');
        const gameoverScreen = document.getElementById('gameover-screen');

        hud.classList.add('hidden');
        startScreen.classList.remove('active');
        pauseScreen.classList.add('hidden');
        gameoverScreen.classList.add('hidden');

        if (newState === STATES.START) {
            startScreen.classList.add('active');
            document.getElementById('start-high-score').textContent = highScore.toString().padStart(6, '0');
        } else if (newState === STATES.PLAYING) {
            hud.classList.remove('hidden');
        } else if (newState === STATES.PAUSED) {
            hud.classList.remove('hidden');
            pauseScreen.classList.remove('hidden');
        } else if (newState === STATES.GAMEOVER) {
            gameoverScreen.classList.remove('hidden');
            document.getElementById('final-score').textContent = score;
            document.getElementById('final-level').textContent = level;
            document.getElementById('final-combo').textContent = `x${maxCombo}`;

            const recordBadge = document.getElementById('new-record-tag');
            if (score >= highScore && score > 0) {
                recordBadge.classList.remove('hidden');
            } else {
                recordBadge.classList.add('hidden');
            }
        }
    }

    function resetGame() {
        score = 0;
        level = 1;
        combo = 0;
        maxCombo = 0;
        empCharge = 0;
        activeBoss = null;
        playerBullets = [];
        enemyBullets = [];
        enemies = [];
        powerups = [];
        particles = [];
        floatingTexts = [];
        player.reset();
        document.getElementById('boss-hud').classList.add('hidden');
        setGameState(STATES.PLAYING);
    }

    window.addEventListener('keydown', e => {
        audio.init();
        if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = true;
        if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = true;
        if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.up = true;
        if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.down = true;
        if (e.code === 'Space') keys.fire = true;
        if (e.code === 'KeyE') triggerEMP();

        if (e.code === 'KeyP') {
            if (currentState === STATES.PLAYING) setGameState(STATES.PAUSED);
            else if (currentState === STATES.PAUSED) setGameState(STATES.PLAYING);
        }
    });

    window.addEventListener('keyup', e => {
        if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = false;
        if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = false;
        if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.up = false;
        if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.down = false;
        if (e.code === 'Space') keys.fire = false;
    });

    const bindTouch = (id, keyName) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('touchstart', e => { e.preventDefault(); audio.init(); keys[keyName] = true; });
        el.addEventListener('touchend', e => { e.preventDefault(); keys[keyName] = false; });
    };

    bindTouch('touch-left', 'left');
    bindTouch('touch-right', 'right');
    bindTouch('touch-fire', 'fire');

    document.getElementById('btn-start').addEventListener('click', () => { audio.init(); resetGame(); });
    document.getElementById('btn-resume').addEventListener('click', () => setGameState(STATES.PLAYING));
    document.getElementById('btn-restart-pause').addEventListener('click', () => resetGame());
    document.getElementById('btn-restart').addEventListener('click', () => resetGame());

    setGameState(STATES.START);
    requestAnimationFrame(gameLoop);
})();
