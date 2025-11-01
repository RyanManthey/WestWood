var character = document.getElementById("character");
// Support multiple skeletons
var skeletons = [];
var skeletonIdCounter = 0;
var currentWaveSize = 1; // start with 1 skeleton, increment each wave
var game = document.getElementById("game");

// Skeleton state/config
var skeletonAttackRange = 25; // reduced by another 15px
var playerAttackRange = 50; // reduced by 10px
// Skeleton movement speed tuning (lowered)
var SKELETON_BASE_SPEED = 80; // was effectively ~100
var SKELETON_SPEED_PER_SCORE = 1.0; // slower ramp (was 2)
var SKELETON_SPEED_CAP = 160; // was 250 cap
// Skeleton dodge/jump behavior
var SKELETON_DODGE_CHANCE = 0.35; // chance per second to attempt dodge when near player (increased)
var SKELETON_DODGE_COOLDOWN = 2.0; // seconds between dodge attempts per skeleton
var SKELETON_DODGE_DISTANCE = 60; // px to move backward when dodging
var SKELETON_JUMP_DURATION = 600; // ms for jump animation
var SKELETON_JUMP_HEIGHT = 80; // px vertical jump apex when dodging (higher = more airtime)
// Leap (jump-over) behavior for every 3rd skeleton
var SKELETON_LEAP_TRIGGER_DISTANCE = 110; // px: how close before attempting to leap over player (reduced)
var SKELETON_LEAP_DURATION = 700; // ms
var SKELETON_LEAP_HEIGHT = 120; // px apex when leaping over player

// HUD / overlay
var scoreEl = document.getElementById("score");
var livesEl = document.getElementById("lives");
var overlay = document.getElementById("overlay");
var restartBtn = document.getElementById("restart");
var resumeBtn = document.getElementById('resume-btn');

// Game state
var score = 0;
var highScore = parseInt(localStorage.getItem('highScore')) || 0;
// Player and enemy combat stats
var playerHP = 10;
var playerAttackPower = 1;
var skeletonAttackPower = 1;
var gameRunning = true; // start immediately
var gamePaused = false;
var intervalId = null;
var lastJumpTime = 0; // simple debounce
// Optional: restart parallax backgrounds when resuming from pause (default: false)
var RESTART_BG_ON_RESUME = false; // using JS-driven parallax; no need to restart CSS animations

// Collision checking interval (10ms for responsive collision detection)
const COLLISION_CHECK_INTERVAL = 10;

// Power-up frequency (fixed, no difficulty)
var powerUpFrequency = 0.35; // probability to spawn a power-up

// Track invincibility after getting hit
var isInvincible = false;
var invincibilityDuration = 1500; // 1.5 seconds of invincibility after getting hit

// Power-up state
var powerUps = {
    life: { duration: 0, active: false, timer: null },
    shield: { duration: 5000, active: false, timer: null }
};
// We'll resolve these after DOMContentLoaded to ensure elements exist
var powerUpElements = {
    life: null,
    shield: null
};
// Shield runtime state
var shieldCount = 0;
var SHIELD_DURATION = 5000;
var shieldIconsContainer = null;

// Game controls
var startBtn = document.getElementById('start-btn');
var pauseBtn = document.getElementById('pause-btn');

// Handle mouse clicks inside the game
if (game) {
    game.addEventListener("mousedown", function(e) {
        if (!gameRunning || gamePaused) return;
        
        // Left mouse button = attack
        if (e.button === 0) {
            e.preventDefault();
            attack();
        }
        // Right mouse button = roll
        if (e.button === 2) {
            e.preventDefault();
            roll();
        }
    });
    
    // Prevent context menu on right-click
    game.addEventListener("contextmenu", function(e) {
        e.preventDefault();
    });
}

// runtime controls (wired to UI)

// movement / input state
var movementSpeed = 400; // px per second, increased to fix sluggish movement
// Per-direction movement speeds (keep equal by default)
var movementSpeedLeft = movementSpeed;
var movementSpeedRight = movementSpeed;
var keysPressed = { left: false, right: false };
var lastFrame = null;
var allowUpscale = true; // always allow upscaling
var facingLeft = false; // track which direction the player is facing
var isRolling = false; // track if currently rolling
var isAttacking = false; // track if currently attacking
var playerAttackDidHit = false; // ensure one hit per attack animation
// Rolling movement config
var ROLL_DURATION_MS = 500;
var ROLL_SPEED = 400; // px per second during roll (reduced distance)
var rollDirection = 0; // -1 left, +1 right
// Debug hitbox overlay
var DEBUG_SHOW_HITBOXES = false;
var playerBoxEl = null;
var playerRangeEl = null;
var attackHitSet = new Set(); // track which skeletons were hit during current attack

// Character dimensions (keep in sync with CSS)
var CHARACTER_WIDTH = 180;
var CHARACTER_HEIGHT = 120;
// Visual sprite width/height above. For combat, we use tighter hitboxes:
// Precision hitboxes (centered)
// Player sprite is 180x120 → center a 30x30 box: offsets 75, 45
var PLAYER_HB = { width: 30, height: 30, offsetX: 75, offsetY: 45 };
var SKELETON_WIDTH = 150; // visual width for layout
// Skeleton sprite is ~150x150 → center a 25x25 box and lower it by 25px: offsets 62.5, 87.5
var SKELETON_HB = { width: 25, height: 25, offsetX: 62.5, offsetY: 87.5 };
// Movement step in pixels when pressing A/D
var MOVE_STEP = 20;

// Game dimensions (must match CSS)
var GAME_WIDTH = 800;
var GAME_HEIGHT = 300;
var gameWrap = document.getElementById('game-wrap');

// Parallax elements and state (JS-driven to allow player-reactive motion)
var bgBack = null, bgFar = null;
var bgTileWBack = 180, bgTileWFar = 180; // defaults fallback
var bgXBack = 0, bgXFar = 0; // scrolling accumulators (px)
// Base auto-scroll speeds (px/s) derived from previous CSS durations (move 180px per cycle)
var BG_SPEED_BACK = 180/40;   // 4.5 px/s
var BG_SPEED_FAR = 180/25;    // 7.2 px/s
// Parallax reaction factors to character horizontal position (smaller = farther)
var PARALLAX_FACTOR_BACK = 0.03;
var PARALLAX_FACTOR_FAR = 0.06;

// Rare front (foreground) chunk system - removed
var frontChunks = []; // { el, x, w }
var frontSpawnTimer = null;

function initParallaxLayers() {
    bgBack = document.querySelector('.bg-layer.back');
    bgFar = document.querySelector('.bg-layer.far');
    var readTile = function(el){
        if (!el) return 180;
        var v = getComputedStyle(el).getPropertyValue('--tile-w');
        var n = parseFloat(v);
        return isNaN(n) ? 180 : n;
    };
    bgTileWBack = readTile(bgBack);
    bgTileWFar = readTile(bgFar);
    // Disable CSS animations so JS can control background-position
    if (bgBack) bgBack.style.animation = 'none';
    if (bgFar) bgFar.style.animation = 'none';
}

function fitGame() {
    if (!game) return;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    // Use most of the viewport but leave some padding for HUD/overlay
    var maxW = vw * 0.95;
    var maxH = vh * 0.85;
    var scale = Math.min(maxW / GAME_WIDTH, maxH / GAME_HEIGHT);
    // optionally prevent upscaling when allowUpscale is false
    if (!allowUpscale) scale = Math.min(scale, 1);
    game.style.transform = 'scale(' + scale + ')';
    game.style.transformOrigin = 'center center';
    // wrapper uses CSS height: 100vh for vertical centering
}

// Run once now and whenever the window resizes
fitGame();
window.addEventListener('resize', fitGame);

// Unified input handling: jump on Space/ArrowUp, smooth movement for A/D or ArrowLeft/ArrowRight
function moveCharacterStep(delta) {
    // small immediate step (kept for compatibility)
    if (!character) return;
    var curLeft = parseInt(window.getComputedStyle(character).getPropertyValue('left')) || 0;
    var newLeft = curLeft + delta;
    var minLeft = 0;
    var maxLeft = GAME_WIDTH - CHARACTER_WIDTH;
    if (newLeft < minLeft) newLeft = minLeft;
    if (newLeft > maxLeft) newLeft = maxLeft;
    character.style.left = newLeft + 'px';
}

function moveCharacterBy(px) {
    if (!character) return;
    var curLeft = parseInt(window.getComputedStyle(character).getPropertyValue('left')) || 0;
    var newLeft = curLeft + px;
    var minLeft = 0;
    // Allow character to reach the right edge
    var maxLeft = GAME_WIDTH - CHARACTER_WIDTH;
    if (newLeft < minLeft) newLeft = minLeft;
    if (newLeft > maxLeft) newLeft = maxLeft;
    character.style.left = newLeft + 'px';
}

// key state
document.addEventListener('keydown', function (e) {
    // Always allow toggling pause with P (even when paused)
    if (e.code === 'KeyP') {
        e.preventDefault();
        togglePause();
        return;
    }

    // Toggle debug hitboxes with H (even when paused)
    if (e.code === 'KeyH') {
        e.preventDefault();
        setDebugHitboxesEnabled(!DEBUG_SHOW_HITBOXES);
        return;
    }

    // Ignore other keys when game not running or while paused
    if (!gameRunning || gamePaused) return;

    if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        jump();
        return;
    }
    if (e.code === 'KeyF') {
        e.preventDefault();
        roll();
        return;
    }
    if (e.code === 'KeyE') {
        e.preventDefault();
        attack();
        return;
    }
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        keysPressed.left = true;
        facingLeft = true;
        character.classList.add('facing-left');
    }
    if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        keysPressed.right = true;
        facingLeft = false;
        character.classList.remove('facing-left');
    }
});

document.addEventListener('keyup', function (e) {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') keysPressed.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') keysPressed.right = false;
});

// animation loop for smooth movement
function gameLoop(ts) {
    if (!lastFrame) lastFrame = ts;
    var dt = (ts - lastFrame) / 1000; // seconds
    lastFrame = ts;
    if (gameRunning && !gamePaused) {
        // Enforce symmetric speeds so left and right feel identical
        if (movementSpeedLeft !== movementSpeed) movementSpeedLeft = movementSpeed;
        if (movementSpeedRight !== movementSpeed) movementSpeedRight = movementSpeed;
        // Track intended movement (even if character hits boundary)
    var movePx = 0;
    if (keysPressed.left) movePx -= movementSpeedLeft * dt;
    if (keysPressed.right) movePx += movementSpeedRight * dt;
        
    var maxLeft = GAME_WIDTH - CHARACTER_WIDTH; // allow reaching right edge
        var charLeft = 0;
        if (character) {
            var cs = window.getComputedStyle(character);
            charLeft = parseInt(cs.left) || 0;
        }
        var boundaryExtraMiddle = 0;
        
        // Update character animation state based on movement
        if (character) {
            var isJumping = character.classList.contains('animate');
            
            if (!isJumping && !isRolling && !isAttacking) {
                if (keysPressed.left || keysPressed.right) {
                    character.classList.add('running');
                } else {
                    character.classList.remove('running');
                }
            }
        }
        
        // Rolling movement takes priority over normal input
        if (isRolling) {
            var rScroll = ROLL_SPEED * dt;
            if (rollDirection > 0 && charLeft >= maxLeft - 1) {
                // at boundary: scroll parallax instead of moving character
                bgXBack += rScroll * PARALLAX_FACTOR_BACK;
                bgXFar += rScroll * PARALLAX_FACTOR_FAR;
            } else {
                moveCharacterBy(rollDirection * rScroll);
                // parallax follows roll direction
                if (rollDirection > 0) {
                    bgXBack += rScroll * PARALLAX_FACTOR_BACK;
                    bgXFar += rScroll * PARALLAX_FACTOR_FAR;
                } else if (rollDirection < 0) {
                    bgXBack -= rScroll * PARALLAX_FACTOR_BACK;
                    bgXFar -= rScroll * PARALLAX_FACTOR_FAR;
                }
            }
        }
        // If pressing right while at the boundary, scroll background instead of moving character
        else if (keysPressed.right && charLeft >= maxLeft - 1) {
            // Don't move character, scroll background at the character's movement speed
            var scrollAmount = movementSpeedRight * dt;
            // Apply scroll proportionally to each layer to maintain parallax depth
            bgXBack += scrollAmount * PARALLAX_FACTOR_BACK;
            bgXFar += scrollAmount * PARALLAX_FACTOR_FAR;
        } else {
            // Normal movement - move character
            if (movePx !== 0) moveCharacterBy(movePx);
            
            // Move parallax forward when moving right, backward when moving left
            if (keysPressed.right) {
                var scrollAmount = movementSpeedRight * dt;
                bgXBack += scrollAmount * PARALLAX_FACTOR_BACK;
                bgXFar += scrollAmount * PARALLAX_FACTOR_FAR;
            } else if (keysPressed.left) {
                var scrollAmount = movementSpeedLeft * dt;
                bgXBack -= scrollAmount * PARALLAX_FACTOR_BACK;
                bgXFar -= scrollAmount * PARALLAX_FACTOR_FAR;
            }
        }

        // JS-driven parallax: no base auto-scroll, only move when player moves
        // (base auto-scroll disabled - backgrounds only react to player movement)

        // Wrap accumulated values to prevent precision issues
        if (bgXBack > bgTileWBack * 2) bgXBack = bgXBack % bgTileWBack;
        if (bgXFar > bgTileWFar * 2) bgXFar = bgXFar % bgTileWFar;

        // Compute final background positions and apply modulo by tile width
        if (bgBack) {
            var x = -(bgXBack % bgTileWBack);
            bgBack.style.backgroundPosition = x + 'px 0px';
        }
        if (bgFar) {
            var x2 = -(bgXFar % bgTileWFar);
            bgFar.style.backgroundPosition = x2 + 'px 0px';
        }
        
    // Update skeleton AI
    updateSkeletons(dt);

    // Update debug hitboxes
    if (DEBUG_SHOW_HITBOXES) updateDebugHitboxes();
    }
    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

// Track whether the player was hit during the current cycle
var hitThisCycle = false;

function jump() {
    if (!gameRunning || gamePaused) return;
    
    var now = Date.now();
    if (now - lastJumpTime < 200) return;
    lastJumpTime = now;

    if (!character.classList.contains("animate")) {
        character.classList.remove('running');
        character.classList.add("animate");
        character.classList.add("jumping");
        setTimeout(() => {
            character.classList.remove("animate");
            character.classList.remove("jumping");
        }, 500);
    }
}

function roll() {
    if (isRolling || !gameRunning || gamePaused) return;
    if (!character) return;
    
    // Prevent roll during jump or attack
    var isJumping = character.classList.contains('animate');
    if (isJumping || isAttacking) return;
    
    isRolling = true;
    rollDirection = facingLeft ? -1 : 1;
    character.classList.remove('running');
    character.classList.add('rolling');
    
    // Roll animation duration (adjust based on GIF length)
    setTimeout(function() {
        isRolling = false;
        character.classList.remove('rolling');
        rollDirection = 0;
    }, ROLL_DURATION_MS); // sync with configured roll duration
}

// Hitbox helpers
function getPlayerHitbox() {
    const cStyle = window.getComputedStyle(character);
    const cLeft = parseInt(cStyle.left) || 0;
    const cTop = parseInt(cStyle.top) || 0;
    const left = cLeft + PLAYER_HB.offsetX;
    const top = cTop + PLAYER_HB.offsetY;
    const right = left + PLAYER_HB.width;
    const bottom = top + PLAYER_HB.height;
    const centerX = left + PLAYER_HB.width / 2;
    const centerY = top + PLAYER_HB.height / 2;
    return { left, top, right, bottom, centerX, centerY };
}

function getSkeletonHitbox(s) {
    const sLeft = parseInt(s.el.style.left) || 0;
    const sTop = parseInt(s.el.style.top) || 0;
    const left = sLeft + SKELETON_HB.offsetX;
    const top = sTop + SKELETON_HB.offsetY;
    const right = left + SKELETON_HB.width;
    const bottom = top + SKELETON_HB.height;
    const centerX = left + SKELETON_HB.width / 2;
    const centerY = top + SKELETON_HB.height / 2;
    return { left, top, right, bottom, centerX, centerY };
}

// Debug hitboxes utilities
function setDebugHitboxesEnabled(enabled) {
    DEBUG_SHOW_HITBOXES = enabled;
    if (!enabled) {
        if (playerBoxEl) playerBoxEl.style.display = 'none';
        if (playerRangeEl) playerRangeEl.style.display = 'none';
        skeletons.forEach(s => { if (s.boxEl) s.boxEl.style.display = 'none'; });
        skeletons.forEach(s => { if (s.rangeEl) s.rangeEl.style.display = 'none'; });
    }
}
function ensurePlayerHitbox() {
    if (!DEBUG_SHOW_HITBOXES) return;
    if (!playerBoxEl) {
        playerBoxEl = document.createElement('div');
        playerBoxEl.className = 'hitbox-debug player-hitbox-debug';
        game.appendChild(playerBoxEl);
    }
}

function ensurePlayerRange() {
    if (!DEBUG_SHOW_HITBOXES) return;
    if (!playerRangeEl) {
        playerRangeEl = document.createElement('div');
        playerRangeEl.className = 'range-debug player-range-debug';
        game.appendChild(playerRangeEl);
    }
}

function ensureSkeletonHitbox(s) {
    if (!DEBUG_SHOW_HITBOXES) return;
    if (!s.boxEl) {
        s.boxEl = document.createElement('div');
        s.boxEl.className = 'hitbox-debug skeleton-hitbox-debug';
        game.appendChild(s.boxEl);
    }
}

function ensureSkeletonRange(s) {
    if (!DEBUG_SHOW_HITBOXES) return;
    if (!s.rangeEl) {
        s.rangeEl = document.createElement('div');
        s.rangeEl.className = 'range-debug skeleton-range-debug';
        game.appendChild(s.rangeEl);
    }
}

function updateDebugHitboxes() {
    if (!DEBUG_SHOW_HITBOXES || !game || !character) return;
    // Player
    ensurePlayerHitbox();
    ensurePlayerRange();
    var phb = getPlayerHitbox();
    if (playerBoxEl) {
        playerBoxEl.style.left = phb.left + 'px';
        playerBoxEl.style.top = phb.top + 'px';
        playerBoxEl.style.width = PLAYER_HB.width + 'px';
        playerBoxEl.style.height = PLAYER_HB.height + 'px';
        playerBoxEl.style.display = 'block';
    }
    if (playerRangeEl) {
        playerRangeEl.style.left = (phb.centerX - playerAttackRange) + 'px';
        playerRangeEl.style.top = (phb.centerY - 1) + 'px';
        playerRangeEl.style.width = (playerAttackRange * 2) + 'px';
        playerRangeEl.style.height = '2px';
        playerRangeEl.style.display = 'block';
    }
    // Skeletons
    skeletons.forEach(s => {
        if (!s.el || s.dead) {
            if (s.boxEl) s.boxEl.style.display = 'none';
            if (s.rangeEl) s.rangeEl.style.display = 'none';
            return;
        }
        ensureSkeletonHitbox(s);
        ensureSkeletonRange(s);
        var shb = getSkeletonHitbox(s);
        if (s.boxEl) {
            s.boxEl.style.left = shb.left + 'px';
            s.boxEl.style.top = shb.top + 'px';
            s.boxEl.style.width = SKELETON_HB.width + 'px';
            s.boxEl.style.height = SKELETON_HB.height + 'px';
            s.boxEl.style.display = 'block';
        }
        if (s.rangeEl) {
            s.rangeEl.style.left = (shb.centerX - skeletonAttackRange) + 'px';
            s.rangeEl.style.top = (shb.centerY - 1) + 'px';
            s.rangeEl.style.width = (skeletonAttackRange * 2) + 'px';
            s.rangeEl.style.height = '2px';
            s.rangeEl.style.display = 'block';
        }
    });
}

function attack() {
    if (isAttacking || !gameRunning || gamePaused) return;
    if (!character) return;
    
    // Prevent attack during jump or roll
    var isJumping = character.classList.contains('animate');
    if (isJumping || isRolling) return;
    
    isAttacking = true;
    playerAttackDidHit = false; // reset per-attack hit gate
    attackHitSet.clear(); // clear skeleton hits for this new attack
    character.classList.remove('running');
    character.classList.add('attacking');
    
    // Attack animation duration (adjust based on GIF length)
    setTimeout(function() {
        isAttacking = false;
        character.classList.remove('attacking');
    }, 400); // ~400ms for attack animation
}

function updateHUD() {
    // Update score display
    if (scoreEl) {
        scoreEl.textContent = "Score: " + score;
    }
    
    // Update HP display with visual feedback
    if (livesEl) {
        livesEl.textContent = "HP: " + playerHP;
        
        // Visual style based on remaining HP
        if (playerHP <= 3) {
            livesEl.style.color = '#ff0000'; // bright red
            livesEl.style.fontWeight = 'bold';
        } else if (playerHP <= 5) {
            livesEl.style.color = '#ff6600'; // orange
            livesEl.style.fontWeight = 'bold';
        } else {
            livesEl.style.color = ''; // default color
            livesEl.style.fontWeight = 'normal';
        }
        
        // Add animation for life change
        livesEl.style.animation = 'none';
        livesEl.offsetHeight; // Trigger reflow
        livesEl.style.animation = 'life-change 0.3s ease-in-out';
    }
    
    // Update high score
    var highScoreEl = document.getElementById('high-score');
    if (highScoreEl) {
        highScoreEl.textContent = "High Score: " + highScore;
    }
}

// (Older loseLife removed — consolidated implementation exists later in the file)

// (Removed older simple gameOver - consolidated implementation appears later)

function restartGame() {
    // Reset game state
    score = 0;
    playerHP = 10;
    isInvincible = false;
    gameRunning = true;
    gamePaused = false;
    hitThisCycle = false;
    lastJumpTime = 0;
    shieldCount = 0;
    updateShieldDisplay();
    facingLeft = false;
    isRolling = false;
    isAttacking = false;
    playerAttackDidHit = false;
    currentWaveSize = 1; // reset wave size to 1 skeleton
    
    // Reset character state
    if (character) {
        character.style.opacity = '1';
        character.style.left = '20px';
        character.classList.remove('animate', 'running', 'jumping', 'hit', 'death', 'rolling', 'attacking', 'facing-left');
        character.style.animationPlayState = 'running';
    }
    
    // Hide both overlays
    const pauseOverlay = document.getElementById('pause-overlay');
    const gameOverOverlay = document.getElementById('game-over-overlay');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
    if (gameOverOverlay) gameOverOverlay.classList.add('hidden');
    
    // Reset power-ups
    Object.values(powerUpElements).forEach(element => {
        if (element) {
            element.classList.add('hidden');
            element.style.animationPlayState = 'running';
        }
    });
    Object.values(powerUps).forEach(powerUp => {
        if (powerUp.timer) clearTimeout(powerUp.timer);
        powerUp.active = false;
    });
    
    // Reset skeletons and spawn one
    resetAllSkeletons();
    spawnSkeleton(1);
    
    // Reset button states
    if (pauseBtn) {
        pauseBtn.disabled = false;
        pauseBtn.textContent = 'Pause';
        pauseBtn.style.background = '#4CAF50';
    }
    
    // Remove pause state
    document.body.classList.remove('game-paused');
    document.body.classList.remove('game-over');
    
    // Update HUD
    updateHUD();
    
    // Start collision detection
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(checkDead, COLLISION_CHECK_INTERVAL);
    
    // Play start sound if available
    playSound('start');
}

// wire up restart button
if (restartBtn) {
    restartBtn.addEventListener('click', restartGame);
}

// Power-up functions
function spawnPowerUp() {
    if (!gameRunning || gamePaused) return;
    
    // Randomly decide whether to spawn a power-up
    if (Math.random() > powerUpFrequency) return;
    
    // Decide which power-up to spawn: life (more common) or shield
    var type = (Math.random() < 0.6) ? 'life' : 'shield';
    var powerUp = powerUpElements[type];
    
    if (powerUp && powerUp.classList.contains('hidden')) {
        // Position power-up randomly along the game width
        var randomX = Math.random() * (GAME_WIDTH - 24); // 24px is power-up width
        var randomY = Math.random() * (GAME_HEIGHT - 100) + 50; // Keep in middle-ish area
        
        powerUp.style.left = randomX + 'px';
        powerUp.style.top = randomY + 'px';
        // Add spawn animation class, then reveal
        powerUp.classList.remove('hidden');
        // Trigger pop spawn animation
        powerUp.classList.add('spawn');
        powerUp.addEventListener('animationend', function onAnim() {
            powerUp.classList.remove('spawn');
            powerUp.removeEventListener('animationend', onAnim);
        });
        
        // Remove power-up after 5 seconds if not collected
        setTimeout(() => {
            if (!powerUp.classList.contains('hidden')) {
                powerUp.classList.add('hidden');
            }
        }, 5000);
    }
}

function collectPowerUp(type) {
    var powerUp = powerUpElements[type];
    if (!powerUp) return;

    powerUp.classList.add('hidden');
    playSound('powerup');

    if (type === 'life') {
        // Life increases HP by 1
        playerHP = playerHP + 1;
        updateHUD();
    } else if (type === 'shield') {
        // Add a shield
        shieldCount++;
        updateShieldDisplay();
        
        // Ensure shield visual is active
        if (character && !character.classList.contains('shielded')) {
            character.classList.add('shielded');
        }
    }
}

// Skeleton management helpers (multi-enemy)
function createSkeletonElement() {
    var el = document.createElement('div');
    el.className = 'skeleton enemy';
    el.style.left = (GAME_WIDTH + 100) + 'px';
    return el;
}

function spawnSkeleton(count) {
    if (!game) return;
    // Three height planes: 155px, 160px, 165px (removed highest and lowest)
    const heightPlanes = [155, 160, 165];
    const behindPlanes = [155, 160]; // render behind player when on these planes
    for (let i = 0; i < (count || 1); i++) {
        var el = createSkeletonElement();
        var id = ++skeletonIdCounter;
        // Spread spawns more to prevent grouping (larger random range)
        var offset = 150 + Math.random() * 400;
        el.style.left = (GAME_WIDTH + offset) + 'px';
        // Randomly pick one of three height planes
        var heightPlane = heightPlanes[Math.floor(Math.random() * heightPlanes.length)];
        el.style.top = heightPlane + 'px';
        // If on a top plane, render behind the player
        if (behindPlanes.includes(heightPlane)) {
            el.style.zIndex = '1';
        } else {
            el.style.zIndex = '2';
        }
        game.appendChild(el);
        skeletons.push({
            id: id,
            el: el,
            hp: 3,
            speed: Math.min(SKELETON_SPEED_CAP, SKELETON_BASE_SPEED + (score * SKELETON_SPEED_PER_SCORE)),
            cooldown: 0,
            attacking: false,
            attackActive: false,
            _attackTimerStart: null,
            _attackTimerEnd: null,
            lowHpDodged: false,
            // mark every 3rd skeleton to be a leaper (jump over the player)
            shouldLeapOver: ((id % 3) === 0),
            leapedThisRun: false,
            isLeaping: false,
            dead: false,
            plane: heightPlane,
            dodgeCooldown: 0,
            isDodging: false
        });
    }
}

function resetAllSkeletons() {
    skeletons.forEach(s => {
    if (s._attackTimerStart) { clearTimeout(s._attackTimerStart); s._attackTimerStart = null; }
    if (s._attackTimerEnd) { clearTimeout(s._attackTimerEnd); s._attackTimerEnd = null; }
    // clear leap/dodge flags
    if (s.isLeaping) s.isLeaping = false;
    if (s.isDodging) s.isDodging = false;
    if (s.leapedThisRun) s.leapedThisRun = false;
    if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
    if (s.boxEl && s.boxEl.parentNode) s.boxEl.parentNode.removeChild(s.boxEl);
    if (s.rangeEl && s.rangeEl.parentNode) s.rangeEl.parentNode.removeChild(s.rangeEl);
        if (s.rangeEl && s.rangeEl.parentNode) s.rangeEl.parentNode.removeChild(s.rangeEl);
    });
    skeletons = [];
}

function updateSkeletons(dt) {
    if (!character || !gameRunning || gamePaused) return;
    const phb = getPlayerHitbox();
    skeletons.slice().forEach(s => {
        if (!s.el || s.dead) return;
        // Ensure existing skeletons adopt the new slower speed immediately
        s.speed = Math.min(SKELETON_SPEED_CAP, SKELETON_BASE_SPEED + (score * SKELETON_SPEED_PER_SCORE));
        const sLeft = parseFloat(s.el.style.left) || GAME_WIDTH;
        if (s.cooldown > 0) s.cooldown -= dt;

        const shb = getSkeletonHitbox(s);
        const dx = shb.centerX - phb.centerX;
        const absDistance = Math.abs(dx);

        // If this skeleton is designated to leap and hasn't leaped during this pass, attempt leap when close enough
        if (s.shouldLeapOver && !s.leapedThisRun && !s.isLeaping && !s.isDodging && absDistance <= SKELETON_LEAP_TRIGGER_DISTANCE) {
            performSkeletonLeap(s);
            // skip other movement/attack logic during leap initiation
            return;
        }

        // Follow player based on center distance; keep chasing until within attack range
        if (!s.isDodging && absDistance > skeletonAttackRange) {
            const move = s.speed * dt;
            if (dx > 0) {
                // Player is to the left - move left
                s.el.classList.add('facing-left');
                s.el.classList.add('moving');
                s.el.style.left = (sLeft - move) + 'px';
            } else {
                // Player to the right - move right
                s.el.classList.remove('facing-left');
                s.el.classList.add('moving');
                s.el.style.left = (sLeft + move) + 'px';
            }
        } else {
            s.el.classList.remove('moving');
        }

        // Attack if within range (regardless of direction)
        if (absDistance <= skeletonAttackRange && s.cooldown <= 0) {
            s.attacking = true;
            s.el.classList.add('attacking');
            s.cooldown = 0.5; // faster attack cooldown (was 1.0)
            // Define a tighter active hit window inside the attack animation
            // Attack animation total ~600ms; make attackActive true briefly around the strike frame
            const ATTACK_ANIM_MS = 600;
            const ATTACK_ACTIVE_DELAY = 180; // ms after animation start when strike lands
            const ATTACK_ACTIVE_DURATION = 180; // ms window where damage can occur

            // Clear any previous timers
            if (s._attackTimerStart) clearTimeout(s._attackTimerStart);
            if (s._attackTimerEnd) clearTimeout(s._attackTimerEnd);

            s.attackActive = false;
            // Start the attack and schedule the active window
            s._attackTimerStart = setTimeout(() => {
                s.attackActive = true;
            }, ATTACK_ACTIVE_DELAY);
            s._attackTimerEnd = setTimeout(() => {
                s.attackActive = false;
            }, ATTACK_ACTIVE_DELAY + ATTACK_ACTIVE_DURATION);

            // End the attacking visual state after the full animation
            setTimeout(() => {
                if (!s.dead) s.el.classList.remove('attacking');
                s.attacking = false;
                // ensure active window cleared
                s.attackActive = false;
                if (s._attackTimerStart) { clearTimeout(s._attackTimerStart); s._attackTimerStart = null; }
                if (s._attackTimerEnd) { clearTimeout(s._attackTimerEnd); s._attackTimerEnd = null; }
            }, ATTACK_ANIM_MS);
        }

        // Dodge/jump back behavior: attempt occasionally when inside the attack range and not currently dodging
        if (!s.isDodging) {
            if (s.dodgeCooldown > 0) s.dodgeCooldown -= dt;
            // Only attempt dodge when within attack range, skeleton not attacking, and cooldown expired
            if (absDistance <= skeletonAttackRange && !s.attacking && s.dodgeCooldown <= 0) {
                if (Math.random() < SKELETON_DODGE_CHANCE * dt) {
                    s.isDodging = true;
                    s.dodgeCooldown = SKELETON_DODGE_COOLDOWN;
                    s.el.classList.add('jumping');
                    // Cancel any active attack window if dodging
                    s.attackActive = false;
                    if (s._attackTimerStart) { clearTimeout(s._attackTimerStart); s._attackTimerStart = null; }
                    if (s._attackTimerEnd) { clearTimeout(s._attackTimerEnd); s._attackTimerEnd = null; }
                    // Move away from player smoothly over SKELETON_JUMP_DURATION with vertical arc
                    var dodgeDir = (dx > 0) ? 1 : -1; // if player is left (dx>0) dodge right (positive)
                    var startLeft = parseFloat(s.el.style.left) || GAME_WIDTH;
                    var startTop = parseFloat(s.el.style.top) || 0;
                    var rawTarget = startLeft + (dodgeDir * SKELETON_DODGE_DISTANCE);
                    var targetLeft = Math.max(0, Math.min(GAME_WIDTH - SKELETON_WIDTH, rawTarget));
                    var animStart = performance.now();
                    var prevAttacking = s.attacking;
                    s.attacking = false;
                    function dodgeAnim(now) {
                        if (!s.el || s.dead || gamePaused) {
                            // cancel and restore
                            if (s && s.el) s.el.classList.remove('jumping');
                            s.isDodging = false;
                            s.attacking = prevAttacking;
                            if (s && s.el) s.el.style.top = startTop + 'px';
                            return;
                        }
                        var t = Math.min(1, (now - animStart) / SKELETON_JUMP_DURATION);
                        // horizontal interpolation
                        var curLeft = startLeft + (targetLeft - startLeft) * t;
                        // vertical parabolic arc: 4*h*t*(1-t)
                        var arc = 4 * SKELETON_JUMP_HEIGHT * t * (1 - t);
                        var curTop = startTop - arc;
                        s.el.style.left = curLeft + 'px';
                        s.el.style.top = curTop + 'px';
                        if (t < 1) {
                            requestAnimationFrame(dodgeAnim);
                        } else {
                            // restore exact plane top (use stored plane if available)
                            if (s.plane) s.el.style.top = s.plane + 'px';
                            else s.el.style.top = startTop + 'px';
                            s.el.classList.remove('jumping');
                            s.isDodging = false;
                            s.attacking = prevAttacking;
                            // ensure attackActive is not lingering after dodge
                            s.attackActive = false;
                            if (s._attackTimerStart) { clearTimeout(s._attackTimerStart); s._attackTimerStart = null; }
                            if (s._attackTimerEnd) { clearTimeout(s._attackTimerEnd); s._attackTimerEnd = null; }
                        }
                    }
                    requestAnimationFrame(dodgeAnim);
                }
            }
        }

        if (sLeft < -200) {
            score++;
            if (score > highScore) {
                highScore = score;
                localStorage.setItem('highScore', highScore);
            }
            updateHUD();
            spawnPowerUp();
            s.el.style.left = (GAME_WIDTH + 100 + Math.random()*200) + 'px';
            s.hp = 3;
            s.cooldown = 0;
            s.attacking = false;
            // reset leap marker so skeletons can leap again when respawned
            s.leapedThisRun = false;
            s.isLeaping = false;
            // Re-evaluate speed on wrap
            s.speed = Math.min(SKELETON_SPEED_CAP, SKELETON_BASE_SPEED + (score * SKELETON_SPEED_PER_SCORE));
            s.el.classList.remove('moving','attacking','hurt','death');
        }
    });
}

// Reusable helper to make a skeleton perform its dodge/jump-back animation.
// This centralizes the logic so it can be triggered from multiple places (random dodge, low-HP forced dodge).
function performSkeletonDodge(s) {
    if (!s || s.dead || s.isDodging) return;
    // Clear any pending attack active windows - dodge interrupts attack
    s.attackActive = false;
    if (s._attackTimerStart) { clearTimeout(s._attackTimerStart); s._attackTimerStart = null; }
    if (s._attackTimerEnd) { clearTimeout(s._attackTimerEnd); s._attackTimerEnd = null; }

    s.isDodging = true;
    s.dodgeCooldown = SKELETON_DODGE_COOLDOWN;
    if (s.el) s.el.classList.add('jumping');

    var dxToPlayer = 0;
    try {
        var phb = getPlayerHitbox();
        var shb = getSkeletonHitbox(s);
        dxToPlayer = shb.centerX - phb.centerX;
    } catch (e) {
        dxToPlayer = 1; // default
    }
    var dodgeDir = (dxToPlayer > 0) ? 1 : -1; // move away from player
    var startLeft = parseFloat(s.el.style.left) || GAME_WIDTH;
    var startTop = parseFloat(s.el.style.top) || (s.plane || 160);
    var rawTarget = startLeft + (dodgeDir * SKELETON_DODGE_DISTANCE);
    var targetLeft = Math.max(0, Math.min(GAME_WIDTH - SKELETON_WIDTH, rawTarget));
    var animStart = performance.now();
    var prevAttacking = s.attacking;
    s.attacking = false;

    function dodgeAnim(now) {
        if (!s.el || s.dead || gamePaused) {
            if (s && s.el) s.el.classList.remove('jumping');
            s.isDodging = false;
            s.attacking = prevAttacking;
            if (s && s.el) s.el.style.top = (s.plane || startTop) + 'px';
            return;
        }
        var t = Math.min(1, (now - animStart) / SKELETON_JUMP_DURATION);
        var curLeft = startLeft + (targetLeft - startLeft) * t;
        var arc = 4 * SKELETON_JUMP_HEIGHT * t * (1 - t);
        var curTop = startTop - arc;
        s.el.style.left = curLeft + 'px';
        s.el.style.top = curTop + 'px';
        if (t < 1) {
            requestAnimationFrame(dodgeAnim);
        } else {
            if (s.plane) s.el.style.top = s.plane + 'px'; else s.el.style.top = startTop + 'px';
            s.el.classList.remove('jumping');
            s.isDodging = false;
            s.attacking = prevAttacking;
            // ensure attackActive cleared after dodge
            s.attackActive = false;
            if (s._attackTimerStart) { clearTimeout(s._attackTimerStart); s._attackTimerStart = null; }
            if (s._attackTimerEnd) { clearTimeout(s._attackTimerEnd); s._attackTimerEnd = null; }
        }
    }
    requestAnimationFrame(dodgeAnim);
}

// Make a skeleton leap over the player and land on the other side, then immediately attempt to attack.
function performSkeletonLeap(s) {
    if (!s || s.dead || s.isLeaping || s.isDodging) return;
    s.isLeaping = true;
    s.leapedThisRun = true;
    // Interrupt other active states
    s.attackActive = false;
    if (s._attackTimerStart) { clearTimeout(s._attackTimerStart); s._attackTimerStart = null; }
    if (s._attackTimerEnd) { clearTimeout(s._attackTimerEnd); s._attackTimerEnd = null; }
    s.attacking = false;
    if (s.el) s.el.classList.add('jumping');

    // Determine direction: move across player's center
    var phb, shb;
    try { phb = getPlayerHitbox(); shb = getSkeletonHitbox(s); } catch (e) { return; }
    var startLeft = parseFloat(s.el.style.left) || GAME_WIDTH;
    var startTop = parseFloat(s.el.style.top) || (s.plane || 160);
    // If skeleton is left of player, land to the right of player; else land to the left
    var landingOffset = 30; // px beyond player's hitbox center
    var targetLeft;
    if (shb.centerX < phb.centerX) {
        // land to right side
        targetLeft = phb.centerX + landingOffset;
    } else {
        // land to left side (subtract skeleton width)
        targetLeft = phb.centerX - SKELETON_WIDTH - landingOffset;
    }
    // Clamp inside game bounds
    targetLeft = Math.max(0, Math.min(GAME_WIDTH - SKELETON_WIDTH, targetLeft));

    var animStart = performance.now();
    var duration = SKELETON_LEAP_DURATION;
    var height = SKELETON_LEAP_HEIGHT;

    function leapAnim(now) {
        if (!s.el || s.dead || gamePaused) {
            if (s && s.el) s.el.classList.remove('jumping');
            s.isLeaping = false;
            if (s && s.el) s.el.style.top = (s.plane || startTop) + 'px';
            return;
        }
        var t = Math.min(1, (now - animStart) / duration);
        var curLeft = startLeft + (targetLeft - startLeft) * t;
        var arc = 4 * height * t * (1 - t);
        var curTop = startTop - arc;
        s.el.style.left = curLeft + 'px';
        s.el.style.top = curTop + 'px';
        if (t < 1) {
            requestAnimationFrame(leapAnim);
        } else {
            // Land: align to plane, remove jumping class
            if (s.plane) s.el.style.top = s.plane + 'px'; else s.el.style.top = startTop + 'px';
            if (s.el) s.el.classList.remove('jumping');
            s.isLeaping = false;
            // After landing, face towards player and attempt an immediate attack
            if (s.el && phb) {
                if ((s.el && parseFloat(s.el.style.left) || 0) < phb.centerX) s.el.classList.remove('facing-left'); else s.el.classList.add('facing-left');
            }
            // Small delay then set attacking so attack logic can schedule attackActive window
            setTimeout(() => {
                if (!s.dead) {
                    s.attacking = true;
                    s.el.classList.add('attacking');
                    // schedule attackActive window similar to updateSkeletons attack behavior
                    const ATTACK_ANIM_MS = 600;
                    const ATTACK_ACTIVE_DELAY = 180;
                    const ATTACK_ACTIVE_DURATION = 180;
                    if (s._attackTimerStart) clearTimeout(s._attackTimerStart);
                    if (s._attackTimerEnd) clearTimeout(s._attackTimerEnd);
                    s.attackActive = false;
                    s._attackTimerStart = setTimeout(() => { s.attackActive = true; }, ATTACK_ACTIVE_DELAY);
                    s._attackTimerEnd = setTimeout(() => { s.attackActive = false; }, ATTACK_ACTIVE_DELAY + ATTACK_ACTIVE_DURATION);
                    setTimeout(() => { if (!s.dead) { s.attacking = false; s.el.classList.remove('attacking'); s.attackActive = false; } if (s._attackTimerStart) { clearTimeout(s._attackTimerStart); s._attackTimerStart = null; } if (s._attackTimerEnd) { clearTimeout(s._attackTimerEnd); s._attackTimerEnd = null; } }, ATTACK_ANIM_MS);
                }
            }, 80);
        }
    }
    requestAnimationFrame(leapAnim);
}

// Start game immediately when page loads
// Add high score reset functionality
function resetHighScore() {
    highScore = 0;
    localStorage.setItem('highScore', '0');
    updateHUD();
}

function updateShieldDisplay() {
    const shieldCountEl = document.getElementById('shield-count');
    const shieldIconsEl = document.querySelector('.shield-icons');
    
    if (shieldCountEl) {
        shieldCountEl.textContent = `Shields: ${shieldCount}`;
    }
    
    if (shieldIconsEl) {
        shieldIconsEl.innerHTML = '';
        for (let i = 0; i < shieldCount; i++) {
            const icon = document.createElement('div');
            icon.className = 'shield-icon';
            shieldIconsEl.appendChild(icon);
        }
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Reset game state
    gameRunning = true;
    gamePaused = false;
    score = 0;
    playerHP = 10;
    isInvincible = false;
    shieldCount = 0;
    
    // Initialize shield display
    updateShieldDisplay();
    
    // Environment systems removed
    
    // Wire up high score reset button
    const resetHighScoreBtn = document.getElementById('reset-high-score');
    if (resetHighScoreBtn) {
        resetHighScoreBtn.addEventListener('click', resetHighScore);
    }
    
    // Enable pause button
    if (pauseBtn) {
        pauseBtn.disabled = false;
        pauseBtn.textContent = 'Pause';
    }
    
    // Reset UI
    document.body.classList.remove('game-paused');
    document.body.classList.remove('game-over');
    updateHUD();
    
    // Reset character
    if (character) {
        character.style.left = '20px';
        character.style.opacity = '1';
        character.classList.remove('animate', 'running', 'jumping', 'hit', 'death', 'rolling', 'attacking', 'facing-left');
    }
    facingLeft = false;
    isRolling = false;
    isAttacking = false;
    
    // Start block animation
    
    // Initialize skeletons from existing .skeleton element or spawn one
    const existingSkeletonEls = Array.from(document.querySelectorAll('.skeleton'));
    if (existingSkeletonEls.length > 0) {
        existingSkeletonEls.forEach(el => {
            const id = ++skeletonIdCounter;
            // Ensure it starts off-screen to the right
            el.style.left = (GAME_WIDTH + 100 + Math.random()*200) + 'px';
            skeletons.push({ id, el, hp: 3, speed: Math.min(250, 100 + (score * 2)), cooldown: 0, attacking: false, attackActive: false, _attackTimerStart: null, _attackTimerEnd: null, lowHpDodged: false, shouldLeapOver: ((id % 3) === 0), leapedThisRun: false, isLeaping: false, dead: false });
        });
    } else {
        spawnSkeleton(1);
    }
    
    // Start collision detection
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(checkDead, COLLISION_CHECK_INTERVAL);
    
    // Start checking immediately
    checkDead();
    
    // Wire up pause button
    if (pauseBtn) {
        pauseBtn.addEventListener('click', togglePause);
    }
    // Wire up resume button in pause overlay
    if (resumeBtn) {
        resumeBtn.addEventListener('click', function(){
            // If paused, this will resume; if not paused, it will toggle, but overlay is hidden anyway
            togglePause();
        });
    }

    // Resolve power-up DOM elements after DOM is ready
    powerUpElements.life = document.querySelector('.power-up.life');
    powerUpElements.shield = document.querySelector('.power-up.shield');

    // Initialize parallax control (disable CSS animation and read tile widths)
    initParallaxLayers();

    // Ensure debug overlays start hidden
    if (typeof setDebugHitboxesEnabled === 'function') {
        setDebugHitboxesEnabled(false);
    }
});

// Initialize collision detection
function checkDead() {
    if (!gameRunning || gamePaused) return;
    // Compute player hitbox
    const phb = getPlayerHitbox();
    const isJumping = character.classList.contains('animate');

    // Loop over all skeletons for collisions
    skeletons.forEach(s => {
        if (!s.el || s.dead) return;
        const shb = getSkeletonHitbox(s);
        const distance = Math.abs(shb.centerX - phb.centerX);

        // Skeleton hits player (only during skeleton's active strike window)
        if (distance <= skeletonAttackRange && s.attackActive && !isInvincible && !hitThisCycle && !isRolling && !isJumping) {
            hitThisCycle = true;
            if (shieldCount > 0) {
                shieldCount--;
                updateShieldDisplay();
                if (shieldCount === 0) character.classList.remove('shielded');
                isInvincible = true;
                setTimeout(() => { isInvincible = false; hitThisCycle = false; }, 1000);
                playSound('shield');
            } else {
                loseLife();
            }
        }

        // Player hits skeleton (must be close AND attacking)
        if (isAttacking && distance <= playerAttackRange) {
            if (!attackHitSet.has(s.id)) {
                attackHitSet.add(s.id);
                s.hp = Math.max(0, s.hp - playerAttackPower);
                if (s.hp > 0) {
                    s.el.classList.add('hurt');
                    setTimeout(() => s.el && s.el.classList.remove('hurt'), 250);
                    // If skeleton dropped to 1 HP, perform one automatic dodge if not already done
                    if (s.hp === 1 && !s.lowHpDodged) {
                        s.lowHpDodged = true;
                        performSkeletonDodge(s);
                    }
                } else {
                    killSkeletonMulti(s);
                }
            }
        }
    });

    // Check for power-up collection (null-safe)
    if (powerUpElements) {
        Object.entries(powerUpElements).forEach(([type, element]) => {
            if (!element) return;
            if (element.classList.contains('hidden')) return;

            const puStyle = window.getComputedStyle(element);
            const powerUpLeft = parseInt(puStyle.left) || 0;
            const powerUpTop = parseInt(puStyle.top) || 0;
            const powerUpW = 24;

            const overlap =
                powerUpLeft < (phb.left + PLAYER_HB.width) &&
                (powerUpLeft + powerUpW) > phb.left &&
                powerUpTop < (phb.top + PLAYER_HB.height) &&
                (powerUpTop + powerUpW) > phb.top;

            if (overlap) {
                // Immediately hide visual and collect
                element.classList.add('hidden');
                collectPowerUp(type);
            }
        });
    }
}

// Life loss handling
function loseLife() {
    if (!gameRunning || isInvincible || gamePaused) return;
    
    // Apply damage to player HP (account for skeleton attack power)
    playerHP = Math.max(0, playerHP - skeletonAttackPower);
    
    // Show hit animation
    if (character) {
        character.classList.add('hit');
        character.style.opacity = '0.5';
        setTimeout(() => {
            character.classList.remove('hit');
        }, 300);
    }
    
    // Update HUD
    updateHUD();
    
    // Check for game over
    if (playerHP <= 0) {
        gameOver();
        return;
    }
    
    // Give temporary invincibility
    isInvincible = true;
    
    // Resume character appearance after invincibility duration
    setTimeout(() => {
        if (character) character.style.opacity = '1';
        isInvincible = false;
        hitThisCycle = false;
    }, invincibilityDuration);
}

function actuallyStartGame() {
    playSound('start');
    gameRunning = true;
    gamePaused = false;
    document.body.classList.remove('game-paused');
    document.body.classList.remove('game-over');
    score = 0;
    playerHP = 10;
    updateHUD();
    // reset character position
    if (character) character.style.left = '20px';
    // Reset skeletons and spawn one
    resetAllSkeletons();
    spawnSkeleton(1);
    // start collision checking
    intervalId = setInterval(checkDead, 10);
}

// Handle skeleton death, scoring, and respawn
function killSkeletonMulti(s) {
    if (!s || s.dead) return;
    s.dead = true;
    s.attacking = false;
    // clear any pending attack timers
    if (s._attackTimerStart) { clearTimeout(s._attackTimerStart); s._attackTimerStart = null; }
    if (s._attackTimerEnd) { clearTimeout(s._attackTimerEnd); s._attackTimerEnd = null; }
    // clear leap/dodge state
    s.isLeaping = false;
    s.isDodging = false;
    s.leapedThisRun = s.leapedThisRun || false;
    s.el.classList.remove('moving', 'attacking', 'hurt');
    s.el.classList.add('death');
    // Score and power-up
    score++;
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('highScore', highScore);
    }
    updateHUD();
    spawnPowerUp();
    // After short delay, remove dead skeleton
    setTimeout(() => {
        if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
        if (s.boxEl && s.boxEl.parentNode) s.boxEl.parentNode.removeChild(s.boxEl);
        // Remove from array
        skeletons = skeletons.filter(x => x.id !== s.id);
        // Check if all skeletons are dead - if so, spawn new wave with +1 skeleton
        const aliveSkeletons = skeletons.filter(sk => !sk.dead);
        if (aliveSkeletons.length === 0) {
            currentWaveSize++;
            spawnSkeleton(currentWaveSize);
        }
    }, 1500);
}

// Restart parallax background animations (used optionally on resume)
function resetBackgroundScroll() {
    var layers = document.querySelectorAll('.bg-layer');
    layers.forEach(function(el) {
        el.style.animation = 'none';
        // Force reflow to flush the change so animation can restart
        void el.offsetWidth;
        el.style.animation = '';
    });
}

// Wire up game controls (wired in DOMContentLoaded to avoid duplicates)

// Update gameOver to reset button states
// Helper function to play sounds
function playSound(type) {
    var sound = document.getElementById('sound-' + type);
    if (sound) {
        sound.currentTime = 0;
        sound.play().catch(() => {}); // ignore autoplay restrictions
    }
}

function togglePause() {
    if (!gameRunning) return;

    gamePaused = !gamePaused;
    
    // Update all game animations
    function setAnimationState(element, state) {
        if (element && element.style) {
            console.log('Setting animation state:', state, 'for element:', element);
            element.style.animationPlayState = state;
        }
    }
    
    const animationState = gamePaused ? 'paused' : 'running';
    console.log('Animation state:', animationState);
    
    // Pause/resume character animation if jumping
    if (character) {
        setAnimationState(character, animationState);
    }
    
    // Pause/resume power-up animations
    if (powerUpElements) {
        Object.values(powerUpElements).forEach(element => {
            if (element && !element.classList.contains('hidden')) {
                setAnimationState(element, animationState);
            }
        });
    }
    
    // Toggle pause overlay
    const pauseOverlay = document.getElementById('pause-overlay');
    if (pauseOverlay) {
        if (gamePaused) {
            pauseOverlay.classList.remove('hidden');
            document.body.classList.add('game-paused');
        } else {
            pauseOverlay.classList.add('hidden');
            document.body.classList.remove('game-paused');
        }
    }
    
    // Update pause button
    if (pauseBtn) {
        pauseBtn.textContent = gamePaused ? 'Resume' : 'Pause';
        pauseBtn.style.background = gamePaused ? '#ff9800' : '#4CAF50';
    }
}

function gameOver() {
    // Finalize game state
    gameRunning = false;
    gamePaused = false;

    // Show death animation
    if (character) {
        character.classList.add('death');
        character.classList.remove('running', 'jumping', 'hit', 'rolling', 'attacking');
    }

    // Play game over sound if available
    playSound('gameover');

    // Pause character animation
    if (character) character.style.animationPlayState = 'paused';

    // Pause power-ups
    if (powerUpElements) {
        Object.values(powerUpElements).forEach(element => {
            if (element && !element.classList.contains('hidden')) {
                element.style.animationPlayState = 'paused';
            }
        });
    }

    // Stop collision checks
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }

    // Update final score display
    const finalScoreEl = document.getElementById('final-score');
    if (finalScoreEl) {
        const highScoreText = score === highScore ? ' (New High Score!)' : '';
        finalScoreEl.textContent = 'Final Score: ' + score + highScoreText;
    }

    // Reset button states
    if (startBtn) startBtn.disabled = false;
    if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.textContent = 'Pause';
        pauseBtn.style.background = '#4CAF50';
    }

    // Clear paused visuals and mark game over (stops background layers)
    document.body.classList.remove('game-paused');
    document.body.classList.add('game-over');

    // Hide pause overlay if visible
    const pauseOverlay = document.getElementById('pause-overlay');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');

    // Show game over overlay
    const gameOverOverlay = document.getElementById('game-over-overlay');
    if (gameOverOverlay) gameOverOverlay.classList.remove('hidden');
}

