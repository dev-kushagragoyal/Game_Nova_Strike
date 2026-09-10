/**
 * NOVA STRIKE — Engine & Logic Architecture
 * Built with Vanilla HTML5 Canvas & Web Audio API
 */

(function () {
    'use strict';

    // --- GAME ENGINE STATES ---
    const STATES = { START: 0, PLAYING: 1, PAUSED: 2, GAMEOVER: 3 };
    let currentState = STATES.START;

    // --- DOM CANVAS SETUP ---
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    // Reference resolution for layout calculations
    const INTERNAL_WIDTH = 1280;
    const INTERNAL_HEIGHT = 720;
    canvas.width = INTERNAL_WIDTH;
    canvas.height = INTERNAL_HEIGHT;

    // --- AUDIO SYNTHESIZER (WEB AUDIO API) ---
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
            } catch (e) { /* Audio safety fallback */ }
        }

        playLaser() {
            if (!this.ctx || this.muted) return;
            try {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(880, this.ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.12);
                gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
                gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.12);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start();
                osc.stop(this.ctx.currentTime + 0.12);
            } catch (e) {}
        }

        playExplosion(isLarge = false) {
            if (!this.ctx || this.muted) return;
            try {
                const dur = isLarge ? 0.6 : 0.3;
                const bufferSize = this.ctx.sampleRate * dur;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
                const noise = this.ctx.createBufferSource();
                noise.buffer = buffer;

                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(isLarge ? 400 : 800, this.ctx.currentTime);
                filter.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + dur);

                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(isLarge ? 0.3 : 0.15, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + dur);

                noise.connect(filter);
                filter.connect(gain);
                gain.connect(this.ctx.destination);
                noise.start();
            } catch (e) {}
        }

        playPowerup() {
            this.playTone(440, 'sine', 0.1, 0.15);
            setTimeout(() => this.playTone(880, 'sine', 0.2, 0.15), 80);
        }

        playBossWarning() {
            this.playTone(150, 'sawtooth', 0.4, 0.25);
            setTimeout(() => this.playTone(130, 'sawtooth', 0.5, 0.25), 400);
        }
    }

    const audio = new SoundEngine();

    // --- GAME ENGINE VARIABLES ---
    let lastTime = performance.now();
    let score = 0;
    let highScore = parseInt(localStorage.getItem('novastrike_highscore') || '0', 10);
    let level = 1;
    let combo = 0;
    let comboTimer = 0;
    const COMBO_TIMEOUT = 3.5; // seconds
    let maxCombo = 0;
    let screenShakeTime = 0;
    let screenShakeIntensity = 0;

    // Spawning control
    let enemySpawnTimer = 0;
    let powerupSpawnTimer = 0;
    let activeBoss = null;

    // Input States
    const keys = { left: false, right: false, up: false, down: false, fire: false };

    // --- STARFIELD & BACKGROUND SYSTEM ---
    class Starfield {
        constructor() {
            this.stars = [];
            this.shootingStars = [];
            this.init();
        }

        init() {
            this.stars = [];
            for (let i = 0; i < 150; i++) {
                this.stars.push({
                    x: Math.random() * INTERNAL_WIDTH,
                    y: Math.random() * INTERNAL_HEIGHT,
                    size: Math.random() * 2 + 0.5,
                    speed: Math.random() * 40 + 10,
                    alpha: Math.random() * 0.8 + 0.2,
                    twinkleSpeed: Math.random() * 2 + 0.5
                });
            }
        }

        update(dt) {
            this.stars.forEach(star => {
                star.y += star.speed * dt;
                star.alpha += Math.sin(performance.now() * 0.003 * star.twinkleSpeed) * 0.01;
                if (star.y > INTERNAL_HEIGHT) {
                    star.y = 0;
                    star.x = Math.random() * INTERNAL_WIDTH;
                }
            });

            // Random Shooting Star
            if (Math.random() < 0.005 && this.shootingStars.length < 2) {
                this.shootingStars.push({
                    x: Math.random() * INTERNAL_WIDTH,
                    y: Math.random() * (INTERNAL_HEIGHT / 2),
                    dx: (Math.random() - 0.5) * 400,
                    dy: Math.random() * 300 + 300,
                    length: Math.random() * 80 + 40,
                    life: 0.6
                });
            }

            for (let i = this.shootingStars.length - 1; i >= 0; i--) {
                const s = this.shootingStars[i];
                s.x += s.dx * dt;
                s.y += s.dy * dt;
                s.life -= dt;
                if (s.life <= 0) this.shootingStars.splice(i, 1);
            }
        }

        draw(ctx) {
            // Deep cosmic background gradient
            const bgGradient = ctx.createLinearGradient(0, 0, 0, INTERNAL_HEIGHT);
            bgGradient.addColorStop(0, '#03050d');
            bgGradient.addColorStop(0.5, '#070a17');
            bgGradient.addColorStop(1, '#020308');
            ctx.fillStyle = bgGradient;
            ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

            // Subtle Nebula Orbs
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const g1 = ctx.createRadialGradient(200, 200, 10, 200, 200, 300);
            g1.addColorStop(0, 'rgba(157, 0, 255, 0.08)');
            g1.addColorStop(1, 'transparent');
            ctx.fillStyle = g1;
            ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
            ctx.restore();

            // Stars Rendering
            this.stars.forEach(star => {
                ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0.1, Math.min(1, star.alpha))})`;
                ctx.beginPath();
                ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
                ctx.fill();
            });

            // Shooting Stars
            this.shootingStars.forEach(s => {
                ctx.strokeStyle = 'rgba(0, 243, 255, ' + (s.life / 0.6) + ')';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(s.x - s.dx * 0.1, s.y - s.dy * 0.1);
                ctx.stroke();
            });
        }
    }

    // --- PARTICLE EFFECT SYSTEM ---
    class Particle {
        constructor(x, y, vx, vy, color, size, life, shape = 'circle') {
            this.x = x;
            this.y = y;
            this.vx = vx;
            this.vy = vy;
            this.color = color;
            this.size = size;
            this.maxLife = life;
            this.life = life;
            this.shape = shape;
        }

        update(dt) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.vx *= 0.98; // Drag
            this.vy *= 0.98;
            this.life -= dt;
        }

        draw(ctx) {
            const alpha = Math.max(0, this.life / this.maxLife);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = this.color;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 8;
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

    function spawnExplosion(x, y, color, count = 25, isLarge = false) {
        audio.playExplosion(isLarge);
        triggerScreenShake(isLarge ? 0.4 : 0.2, isLarge ? 12 : 5);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * (isLarge ? 350 : 200) + 30;
            particles.push(new Particle(
                x, y,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                color,
                Math.random() * (isLarge ? 5 : 3) + 1,
                Math.random() * 0.5 + 0.3
            ));
        }
        // Add expansion ring particle
        particles.push(new Particle(x, y, 0, 0, color, isLarge ? 40 : 20, 0.4, 'ring'));
    }

    // --- FLOATING TEXT INDICATORS ---
    class FloatingText {
        constructor(x, y, text, color = '#00f3ff') {
            this.x = x;
            this.y = y;
            this.text = text;
            this.color = color;
            this.life = 0.8;
            this.maxLife = 0.8;
        }

        update(dt) {
            this.y -= 40 * dt;
            this.life -= dt;
        }

        draw(ctx) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
            ctx.font = '900 14px monospace';
            ctx.fillStyle = this.color;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 6;
            ctx.textAlign = 'center';
            ctx.fillText(this.text, this.x, this.y);
            ctx.restore();
        }
    }

    let floatingTexts = [];

    // --- PLAYER SHIP CLASS ---
    class Player {
        constructor() {
            this.width = 50;
            this.height = 50;
            this.x = INTERNAL_WIDTH / 2;
            this.y = INTERNAL_HEIGHT - 90;
            this.speed = 480;
            this.hp = 100;
            this.maxHp = 100;
            this.fireCooldown = 0;
            this.hitFlash = 0;

            // Powerup Active Timers
            this.rapidFireTimer = 0;
            this.shieldTimer = 0;
            this.doubleScoreTimer = 0;
        }

        reset() {
            this.x = INTERNAL_WIDTH / 2;
            this.y = INTERNAL_HEIGHT - 90;
            this.hp = 100;
            this.rapidFireTimer = 0;
            this.shieldTimer = 0;
            this.doubleScoreTimer = 0;
            this.fireCooldown = 0;
        }

        update(dt) {
            // Movement Controls
            if (keys.left) this.x -= this.speed * dt;
            if (keys.right) this.x += this.speed * dt;
            if (keys.up) this.y -= this.speed * 0.7 * dt;
            if (keys.down) this.y += this.speed * 0.7 * dt;

            // Boundaries
            this.x = Math.max(this.width / 2, Math.min(INTERNAL_WIDTH - this.width / 2, this.x));
            this.y = Math.max(INTERNAL_HEIGHT / 2, Math.min(INTERNAL_HEIGHT - 60, this.y));

            // Timers
            if (this.fireCooldown > 0) this.fireCooldown -= dt;
            if (this.hitFlash > 0) this.hitFlash -= dt;
            if (this.rapidFireTimer > 0) this.rapidFireTimer -= dt;
            if (this.shieldTimer > 0) this.shieldTimer -= dt;
            if (this.doubleScoreTimer > 0) this.doubleScoreTimer -= dt;

            // Firing Logic
            const rate = this.rapidFireTimer > 0 ? 0.08 : 0.16;
            if (keys.fire && this.fireCooldown <= 0) {
                this.shoot();
                this.fireCooldown = rate;
            }

            // Engine Flame Particles
            if (Math.random() < 0.6) {
                particles.push(new Particle(
                    this.x + (Math.random() * 12 - 6),
                    this.y + 22,
                    (Math.random() - 0.5) * 30,
                    Math.random() * 100 + 150,
                    this.rapidFireTimer > 0 ? '#ff6600' : '#00f3ff',
                    Math.random() * 3 + 1,
                    0.25
                ));
            }
        }

        shoot() {
            audio.playLaser();
            if (this.rapidFireTimer > 0) {
                // Dual Plasma Cannon
                playerBullets.push(new Bullet(this.x - 14, this.y - 15, 0, -900, '#ff6600'));
                playerBullets.push(new Bullet(this.x + 14, this.y - 15, 0, -900, '#ff6600'));
            } else {
                // Single Heavy Cannon
                playerBullets.push(new Bullet(this.x, this.y - 20, 0, -850, '#00f3ff'));
            }
        }

        takeDamage(amount) {
            if (this.shieldTimer > 0) {
                // Shield absorbs damage
                particles.push(new Particle(this.x, this.y, 0, 0, '#00f3ff', 35, 0.2, 'ring'));
                return;
            }
            this.hp = Math.max(0, this.hp - amount);
            this.hitFlash = 0.15;
            triggerScreenShake(0.25, 8);
            audio.playTone(100, 'sawtooth', 0.2, 0.3);

            // Screen flash element
            const flashEl = document.getElementById('damage-flash');
            flashEl.classList.add('active');
            setTimeout(() => flashEl.classList.remove('active'), 150);

            if (this.hp <= 0) {
                spawnExplosion(this.x, this.y, '#ff0078', 50, true);
                setGameState(STATES.GAMEOVER);
            }
        }

        draw(ctx) {
            ctx.save();
            ctx.translate(this.x, this.y);

            // Flash red on hit
            if (this.hitFlash > 0) {
                ctx.fillStyle = '#ff2a2a';
                ctx.shadowColor = '#ff2a2a';
                ctx.shadowBlur = 15;
            }

            // Shield Bubble Effect
            if (this.shieldTimer > 0) {
                ctx.save();
                ctx.strokeStyle = '#00f3ff';
                ctx.lineWidth = 3;
                ctx.shadowColor = '#00f3ff';
                ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.arc(0, 0, 32 + Math.sin(performance.now() * 0.01) * 2, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }

            // High-Tech Ship Geometry
            ctx.shadowColor = '#00f3ff';
            ctx.shadowBlur = 10;
            ctx.fillStyle = this.hitFlash > 0 ? '#ff2a2a' : '#0c1224';
            ctx.strokeStyle = '#00f3ff';
            ctx.lineWidth = 2;

            // Main Hull
            ctx.beginPath();
            ctx.moveTo(0, -26);
            ctx.lineTo(16, 16);
            ctx.lineTo(8, 22);
            ctx.lineTo(-8, 22);
            ctx.lineTo(-16, 16);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Wings
            ctx.beginPath();
            ctx.moveTo(16, 8);
            ctx.lineTo(28, 18);
            ctx.lineTo(16, 18);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(-16, 8);
            ctx.lineTo(-28, 18);
            ctx.lineTo(-16, 18);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Glowing Cockpit
            ctx.fillStyle = '#ff0078';
            ctx.beginPath();
            ctx.ellipse(0, -4, 4, 10, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }
    }

    const player = new Player();

    // --- BULLET CLASS ---
    class Bullet {
        constructor(x, y, vx, vy, color, isEnemy = false) {
            this.x = x;
            this.y = y;
            this.vx = vx;
            this.vy = vy;
            this.color = color;
            this.isEnemy = isEnemy;
            this.radius = isEnemy ? 4 : 3;
            this.markedForDeletion = false;
        }

        update(dt) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            if (this.y < -20 || this.y > INTERNAL_HEIGHT + 20 || this.x < -20 || this.x > INTERNAL_WIDTH + 20) {
                this.markedForDeletion = true;
            }
        }

        draw(ctx) {
            ctx.save();
            ctx.fillStyle = this.color;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    let playerBullets = [];
    let enemyBullets = [];

    // --- ENEMY CLASSES ---
    class Enemy {
        constructor(type) {
            this.type = type; // 'DRONE', 'STRIKER', 'CRUISER', 'TANK'
            this.x = Math.random() * (INTERNAL_WIDTH - 100) + 50;
            this.y = -40;
            this.markedForDeletion = false;
            this.timeAlive = 0;

            // Configure Enemy Archetypes
            if (type === 'DRONE') {
                this.width = 30; this.height = 30;
                this.speed = 180; this.hp = 1; this.maxHp = 1;
                this.scoreVal = 10; this.color = '#00f3ff';
            } else if (type === 'STRIKER') {
                this.width = 36; this.height = 36;
                this.speed = 260; this.hp = 2; this.maxHp = 2;
                this.scoreVal = 25; this.color = '#ff0078';
            } else if (type === 'CRUISER') {
                this.width = 50; this.height = 50;
                this.speed = 110; this.hp = 6; this.maxHp = 6;
                this.scoreVal = 60; this.color = '#9d00ff';
                this.shootTimer = 1.5;
            } else if (type === 'TANK') {
                this.width = 64; this.height = 64;
                this.speed = 75; this.hp = 15; this.maxHp = 15;
                this.scoreVal = 150; this.color = '#ff6600';
            }
        }

        update(dt) {
            this.timeAlive += dt;

            // Movement logic based on archetype
            if (this.type === 'DRONE') {
                this.y += this.speed * dt;
                this.x += Math.sin(this.timeAlive * 4) * 60 * dt;
            } else if (this.type === 'STRIKER') {
                this.y += this.speed * dt;
            } else if (this.type === 'CRUISER') {
                this.y += this.speed * dt;
                this.shootTimer -= dt;
                if (this.shootTimer <= 0) {
                    enemyBullets.push(new Bullet(this.x, this.y + 20, 0, 320, '#ff0078', true));
                    this.shootTimer = 2.0;
                }
            } else if (this.type === 'TANK') {
                this.y += this.speed * dt;
            }

            if (this.y > INTERNAL_HEIGHT + 50) this.markedForDeletion = true;
        }

        takeDamage(amount) {
            this.hp -= amount;
            if (this.hp <= 0) {
                this.markedForDeletion = true;
                spawnExplosion(this.x, this.y, this.color, 20);
                addScore(this.scoreVal, this.x, this.y);
            } else {
                audio.playTone(300, 'square', 0.05, 0.05);
            }
        }

        draw(ctx) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 10;
            ctx.strokeStyle = this.color;
            ctx.fillStyle = '#0a0a14';
            ctx.lineWidth = 2;

            if (this.type === 'DRONE') {
                ctx.beginPath();
                ctx.moveTo(0, 15);
                ctx.lineTo(-15, -15);
                ctx.lineTo(15, -15);
                ctx.closePath();
                ctx.fill(); ctx.stroke();
            } else if (this.type === 'STRIKER') {
                ctx.beginPath();
                ctx.moveTo(0, 18);
                ctx.lineTo(-18, -10);
                ctx.lineTo(0, -2);
                ctx.lineTo(18, -10);
                ctx.closePath();
                ctx.fill(); ctx.stroke();
            } else if (this.type === 'CRUISER') {
                ctx.beginPath();
                ctx.rect(-22, -22, 44, 44);
                ctx.fill(); ctx.stroke();
                ctx.fillStyle = this.color;
                ctx.fillRect(-8, -8, 16, 16);
            } else if (this.type === 'TANK') {
                ctx.beginPath();
                ctx.arc(0, 0, 26, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();
                // Armor plates
                ctx.strokeRect(-18, -18, 36, 36);
            }

            ctx.restore();
        }
    }

    let enemies = [];

    // --- BOSS CLASS ---
    class Boss {
        constructor() {
            this.x = INTERNAL_WIDTH / 2;
            this.y = -100;
            this.targetY = 120;
            this.width = 160;
            this.height = 100;
            this.hp = 180 + level * 40;
            this.maxHp = this.hp;
            this.color = '#ff2a2a';
            this.phase = 'ENTRY'; // ENTRY, FIGHT
            this.shootTimer = 0;
            this.moveTimer = 0;
            this.markedForDeletion = false;
            this.name = 'VOID REAPER';
        }

        update(dt) {
            if (this.phase === 'ENTRY') {
                this.y += 80 * dt;
                if (this.y >= this.targetY) {
                    this.y = this.targetY;
                    this.phase = 'FIGHT';
                }
                return;
            }

            this.moveTimer += dt;
            this.shootTimer += dt;

            // Horizontal Oscillating Movement
            this.x = (INTERNAL_WIDTH / 2) + Math.sin(this.moveTimer * 0.8) * 350;

            // Attack Patterns
            if (this.shootTimer >= 1.2) {
                this.shootTimer = 0;
                // Spiral / Fan Attack
                for (let i = -2; i <= 2; i++) {
                    enemyBullets.push(new Bullet(this.x, this.y + 40, i * 60, 280, '#ff2a2a', true));
                }
            }

            // Update Boss HP HUD
            const hpPercent = Math.max(0, (this.hp / this.maxHp) * 100);
            document.getElementById('boss-hp-fill').style.width = hpPercent + '%';
        }

        takeDamage(amount) {
            this.hp -= amount;
            audio.playTone(180, 'square', 0.04, 0.08);
            if (this.hp <= 0) {
                this.markedForDeletion = true;
                spawnExplosion(this.x, this.y, '#ff0078', 80, true);
                addScore(2000, this.x, this.y);
                activeBoss = null;
                document.getElementById('boss-hud').classList.add('hidden');
                triggerAnnouncement('BOSS DEFEATED', 'SECTOR CLEARED');
            }
        }

        draw(ctx) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 20;
            ctx.fillStyle = '#08050c';
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 3;

            // Boss Outer Frame
            ctx.beginPath();
            ctx.moveTo(0, 50);
            ctx.lineTo(-70, 0);
            ctx.lineTo(-50, -40);
            ctx.lineTo(50, -40);
            ctx.lineTo(70, 0);
            ctx.closePath();
            ctx.fill(); ctx.stroke();

            // Core Energy Center
            ctx.fillStyle = '#ff6600';
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }
    }

    // --- POWER-UP CLASS ---
    class Powerup {
        constructor(x, y, type) {
            this.x = x;
            this.y = y;
            this.type = type; // 'RAPID_FIRE', 'SHIELD', 'DOUBLE_SCORE'
            this.radius = 16;
            this.markedForDeletion = false;
            this.color = type === 'RAPID_FIRE' ? '#ff6600' : (type === 'SHIELD' ? '#00f3ff' : '#ffd700');
            this.label = type === 'RAPID_FIRE' ? 'RF' : (type === 'SHIELD' ? 'SH' : '2X');
        }

        update(dt) {
            this.y += 100 * dt;
            if (this.y > INTERNAL_HEIGHT + 30) this.markedForDeletion = true;
        }

        draw(ctx) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 12;
            ctx.fillStyle = 'rgba(10, 16, 32, 0.8)';
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();

            ctx.fillStyle = this.color;
            ctx.font = '900 11px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.label, 0, 1);
            ctx.restore();
        }
    }

    let powerups = [];

    // --- SCORE & COMBO SYSTEM ---
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

    function checkLevelProgression() {
        const requiredScore = level * 1200;
        if (score >= requiredScore && !activeBoss) {
            level++;
            if (level % 5 === 0) {
                // Boss Level
                activeBoss = new Boss();
                document.getElementById('boss-hud').classList.remove('hidden');
                document.getElementById('boss-name').textContent = activeBoss.name;
                audio.playBossWarning();
                triggerAnnouncement('WARNING', 'BOSS ENCOUNTER');
            } else {
                triggerAnnouncement(`SECTOR 0${level}`, 'ENEMIES ENRAGED');
                audio.playTone(600, 'sine', 0.2, 0.15);
            }
        }
    }

    function triggerAnnouncement(title, sub) {
        const banner = document.getElementById('announcement-banner');
        document.getElementById('announcement-title').textContent = title;
        document.getElementById('announcement-sub').textContent = sub;
        banner.classList.remove('hidden');
        setTimeout(() => banner.classList.add('hidden'), 2000);
    }

    function triggerScreenShake(duration, intensity) {
        screenShakeTime = duration;
        screenShakeIntensity = intensity;
    }

    // --- SPAWNING LOGIC ---
    function updateSpawning(dt) {
        if (activeBoss) return; // Halt standard enemy spawns during Boss fight

        enemySpawnTimer += dt;
        const spawnInterval = Math.max(0.6, 2.2 - (level * 0.2));

        if (enemySpawnTimer >= spawnInterval) {
            enemySpawnTimer = 0;

            // Controlled spawn count to avoid chaotic clutter
            const roll = Math.random();
            if (roll < 0.5) {
                enemies.push(new Enemy('DRONE'));
            } else if (roll < 0.75) {
                enemies.push(new Enemy('STRIKER'));
            } else if (roll < 0.9) {
                enemies.push(new Enemy('CRUISER'));
            } else if (level >= 3) {
                enemies.push(new Enemy('TANK'));
            }
        }

        // Power-up Spawning Logic
        powerupSpawnTimer += dt;
        if (powerupSpawnTimer >= 14.0) {
            powerupSpawnTimer = 0;
            const types = ['RAPID_FIRE', 'SHIELD', 'DOUBLE_SCORE'];
            const chosen = types[Math.floor(Math.random() * types.length)];
            const spawnX = Math.random() * (INTERNAL_WIDTH - 100) + 50;
            powerups.push(new Powerup(spawnX, -20, chosen));
        }
    }

    // --- COLLISION DETECTION SYSTEM ---
    function checkCollisions() {
        // Player Bullets vs Enemies
        for (let b = playerBullets.length - 1; b >= 0; b--) {
            const bullet = playerBullets[b];

            // Against Boss
            if (activeBoss && activeBoss.phase === 'FIGHT') {
                if (Math.abs(bullet.x - activeBoss.x) < activeBoss.width / 2 &&
                    Math.abs(bullet.y - activeBoss.y) < activeBoss.height / 2) {
                    activeBoss.takeDamage(1);
                    bullet.markedForDeletion = true;
                    continue;
                }
            }

            // Against Regular Enemies
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

        // Enemy Bullets vs Player
        for (let b = enemyBullets.length - 1; b >= 0; b--) {
            const bullet = enemyBullets[b];
            const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y);
            if (dist < player.width / 3 + bullet.radius) {
                player.takeDamage(12);
                bullet.markedForDeletion = true;
            }
        }

        // Enemies vs Player Collision
        for (let e = enemies.length - 1; e >= 0; e--) {
            const enemy = enemies[e];
            const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
            if (dist < (enemy.width / 2 + player.width / 3)) {
                player.takeDamage(25);
                enemy.takeDamage(99); // Destroy enemy on impact
            }
        }

        // Powerups vs Player
        for (let p = powerups.length - 1; p >= 0; p--) {
            const pow = powerups[p];
            const dist = Math.hypot(pow.x - player.x, pow.y - player.y);
            if (dist < pow.radius + player.width / 2) {
                audio.playPowerup();
                if (pow.type === 'RAPID_FIRE') player.rapidFireTimer = 8.0;
                if (pow.type === 'SHIELD') player.shieldTimer = 10.0;
                if (pow.type === 'DOUBLE_SCORE') player.doubleScoreTimer = 10.0;
                pow.markedForDeletion = true;
                floatingTexts.push(new FloatingText(pow.x, pow.y, 'POWER UP!', '#ffd700'));
            }
        }
    }

    // --- HUD & UI RENDER UPDATES ---
    function updateHUD() {
        document.getElementById('score-val').textContent = score.toString().padStart(6, '0');
        document.getElementById('high-score-val').textContent = highScore.toString();
        document.getElementById('sector-label').textContent = `SECTOR ${level.toString().padStart(2, '0')}`;

        // Health Bar
        const healthFill = document.getElementById('health-bar-fill');
        const hpPercent = Math.max(0, player.hp);
        healthFill.style.width = hpPercent + '%';
        if (hpPercent < 30) healthFill.style.backgroundColor = '#ff2a2a';
        else if (hpPercent < 60) healthFill.style.backgroundColor = '#ff6600';
        else healthFill.style.backgroundColor = '#00ff88';

        // Combo Display
        const comboDisplay = document.getElementById('combo-display');
        if (combo > 1) {
            comboDisplay.classList.remove('hidden');
            document.getElementById('combo-count').textContent = `${combo}x`;
        } else {
            comboDisplay.classList.add('hidden');
        }

        // Buff Badges
        const buffsContainer = document.getElementById('buffs-container');
        buffsContainer.innerHTML = '';
        if (player.rapidFireTimer > 0) buffsContainer.innerHTML += `<span class="buff-badge buff-rf">RF</span>`;
        if (player.shieldTimer > 0) buffsContainer.innerHTML += `<span class="buff-badge buff-sh">SHIELD</span>`;
        if (player.doubleScoreTimer > 0) buffsContainer.innerHTML += `<span class="buff-badge buff-2x">2X</span>`;
    }

    // --- MAIN GAME LOOP ---
    const starfield = new Starfield();

    function gameLoop(time) {
        const dt = Math.min((time - lastTime) / 1000, 0.1); // Cap delta time for stability
        lastTime = time;

        if (currentState === STATES.PLAYING) {
            // Combo decay logic
            if (comboTimer > 0) {
                comboTimer -= dt;
                if (comboTimer <= 0) combo = 0;
            }

            // Updates
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

            // Array Cleanups
            playerBullets = playerBullets.filter(b => !b.markedForDeletion);
            enemyBullets = enemyBullets.filter(b => !b.markedForDeletion);
            enemies = enemies.filter(e => !e.markedForDeletion);
            powerups = powerups.filter(p => !p.markedForDeletion);
            particles = particles.filter(p => p.life > 0);
            floatingTexts = floatingTexts.filter(ft => ft.life > 0);

            updateHUD();
        } else if (currentState === STATES.START || currentState === STATES.GAMEOVER) {
            starfield.update(dt); // Keep background animated on screens
        }

        // --- RENDER STEP ---
        ctx.save();

        // Screen Shake Apply
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

    // --- GAME STATE MANAGER ---
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

    // --- INPUT CONTROLLERS & EVENT HANDLERS ---
    window.addEventListener('keydown', e => {
        audio.init();
        if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = true;
        if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = true;
        if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.up = true;
        if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.down = true;
        if (e.code === 'Space') keys.fire = true;

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

    // Touch Support Configuration
    const bindTouch = (id, keyName) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('touchstart', e => { e.preventDefault(); audio.init(); keys[keyName] = true; });
        el.addEventListener('touchend', e => { e.preventDefault(); keys[keyName] = false; });
    };

    bindTouch('touch-left', 'left');
    bindTouch('touch-right', 'right');
    bindTouch('touch-fire', 'fire');

    // UI Buttons Initialization
    document.getElementById('btn-start').addEventListener('click', () => { audio.init(); resetGame(); });
    document.getElementById('btn-resume').addEventListener('click', () => setGameState(STATES.PLAYING));
    document.getElementById('btn-restart-pause').addEventListener('click', () => resetGame());
    document.getElementById('btn-restart').addEventListener('click', () => resetGame());

    // START INITIALIZATION
    setGameState(STATES.START);
    requestAnimationFrame(gameLoop);
})();
