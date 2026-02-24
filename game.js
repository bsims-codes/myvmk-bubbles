/**
 * Bubble Shooter - VMK-friendly Puzzle Bobble Prototype
 * Hex grid (odd-r offset) implementation with plain JavaScript + HTML5 Canvas
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const BUBBLE_RADIUS = 16;
const ROW_HEIGHT = BUBBLE_RADIUS * Math.sqrt(3); // ~27.7px
const GRID_COLS = 24;
const GRID_ROWS = 16; // 14 visible + 2 buffer rows
const VISIBLE_ROWS = 14;
const SHOOTER_X = 400;
const SHOOTER_Y = 560;
const PROJECTILE_SPEED = 900; // pixels per second
const MIN_AIM_ANGLE = 10 * (Math.PI / 180);  // 10 degrees in radians
const MAX_AIM_ANGLE = 170 * (Math.PI / 180); // 170 degrees in radians
const LOSE_LINE_Y = 540;
const LOSE_ROW = 13;
const SHOTS_BEFORE_NEW_ROW = 5;
const CLUSTER_MIN_SIZE = 3;

// Color palette for bubbles
const BUBBLE_COLORS = [
    '#e74c3c', // Red
    '#3498db', // Blue
    '#2ecc71', // Green
    '#f1c40f', // Yellow
    '#9b59b6', // Purple
    '#e67e22'  // Orange
];

const NUM_COLORS = BUBBLE_COLORS.length;
const INITIAL_ROWS = 5; // Number of rows to fill at start

// Background images (rotated each game)
// Each entry: { src: filename, tile: whether to tile/repeat }
const BACKGROUND_IMAGES = [
    { src: 'cards.jpg', tile: false },
    { src: 'fireworks.jpg', tile: false },
    { src: 'hats.png', tile: true },
    { src: 'items.jpg', tile: false }
];
const BACKGROUND_OPACITY = 0.25; // Transparency for background images (Level 1)
const CURSE_BACKGROUND_OPACITY = 0.6; // Higher opacity for Level 2 curse background

// Level system
let currentLevel = 1;

// Custom bubble images for Level 2
const CURSE_IMAGES = [];
let curseImagesLoaded = false;

// Custom background for Level 2
let curseBackgroundImage = null;
let curseBackgroundLoaded = false;

// Spinner image for Level 2 (behind shooter)
let curseSpinnerImage = null;
let curseSpinnerLoaded = false;
const SPINNER_SIZE = 100; // Size of the spinner image

// Preload curse images and background
function preloadCurseImages() {
    let loadedCount = 0;
    for (let i = 1; i <= NUM_COLORS; i++) {
        const img = new Image();
        img.src = `curse${i}.png`;
        img.onload = () => {
            loadedCount++;
            if (loadedCount === NUM_COLORS) {
                curseImagesLoaded = true;
            }
        };
        img.onerror = () => {
            console.warn(`Failed to load curse${i}.png`);
        };
        CURSE_IMAGES.push(img);
    }

    // Preload curse background
    curseBackgroundImage = new Image();
    curseBackgroundImage.src = 'curse-background.png';
    curseBackgroundImage.onload = () => {
        curseBackgroundLoaded = true;
    };
    curseBackgroundImage.onerror = () => {
        console.warn('Failed to load curse-background.png');
    };

    // Preload spinner image
    curseSpinnerImage = new Image();
    curseSpinnerImage.src = 'curse6-spinner.png';
    curseSpinnerImage.onload = () => {
        curseSpinnerLoaded = true;
    };
    curseSpinnerImage.onerror = () => {
        console.warn('Failed to load curse6-spinner.png');
    };
}

// ============================================================================
// SEEDED RANDOM NUMBER GENERATOR (LCG)
// ============================================================================

class SeededRNG {
    constructor(seed) {
        this.seed = seed;
        this.state = seed;
    }

    // Linear Congruential Generator
    next() {
        // Parameters from Numerical Recipes
        this.state = (this.state * 1664525 + 1013904223) >>> 0;
        return this.state / 0xFFFFFFFF;
    }

    nextInt(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    reset() {
        this.state = this.seed;
    }

    setSeed(seed) {
        this.seed = seed;
        this.state = seed;
    }
}

// ============================================================================
// GAME STATE
// ============================================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let rng = new SeededRNG(Date.now());

let gameState = {
    grid: [],                    // 2D array [row][col] of color IDs or null
    projectile: null,            // {x, y, vx, vy, color, active}
    currentBubble: 0,            // Color ID of current bubble to shoot
    nextBubble: 0,               // Color ID of next bubble
    score: 0,
    shots: 0,
    shotsWithoutPop: 0,
    gameOver: false,
    gameWon: false,
    scoreSubmitted: false,
    debugMode: false,
    mouseX: SHOOTER_X,
    mouseY: SHOOTER_Y - 100,
    aimAngle: Math.PI / 2,       // Straight up
    snapTarget: null,            // Debug: {row, col} of where bubble will snap
    lastTime: 0
};

// Background image management
let backgroundImage = null;
let currentBackgroundName = ''; // Track current background for debugging
let currentBackgroundTile = false; // Whether to tile the current background
// Load and increment background index from localStorage (persists across refreshes)
let backgroundIndex = parseInt(localStorage.getItem('vmkBubbleBackgroundIndex') || '0');

// ============================================================================
// HEX GRID HELPERS
// ============================================================================

/**
 * Convert grid coordinates to world (canvas) pixel position
 * Uses odd-r offset: odd rows are shifted right by radius
 */
function gridToWorld(row, col) {
    const x = col * BUBBLE_RADIUS * 2 + BUBBLE_RADIUS + (row % 2 === 1 ? BUBBLE_RADIUS : 0);
    const y = row * ROW_HEIGHT + BUBBLE_RADIUS;
    return { x, y };
}

/**
 * Convert world (canvas) position to nearest grid cell
 */
function worldToGrid(x, y) {
    // Approximate row
    let row = Math.round((y - BUBBLE_RADIUS) / ROW_HEIGHT);
    row = Math.max(0, Math.min(row, GRID_ROWS - 1));

    // Adjust x for odd row offset
    const offsetX = row % 2 === 1 ? BUBBLE_RADIUS : 0;
    let col = Math.round((x - BUBBLE_RADIUS - offsetX) / (BUBBLE_RADIUS * 2));
    col = Math.max(0, Math.min(col, GRID_COLS - 1));

    return { row, col };
}

/**
 * Get the 6 neighbors for a hex cell in odd-r offset coordinates
 */
function getNeighbors(row, col) {
    const neighbors = [];

    // Neighbor offsets differ based on whether row is even or odd
    const isOddRow = row % 2 === 1;

    // Direction offsets for odd-r hex grid
    // [row offset, col offset for even rows, col offset for odd rows]
    const directions = [
        [-1, -1, 0],   // Top-left
        [-1, 0, 1],    // Top-right
        [0, -1, -1],   // Left
        [0, 1, 1],     // Right
        [1, -1, 0],    // Bottom-left
        [1, 0, 1]      // Bottom-right
    ];

    for (const [dRow, evenColOffset, oddColOffset] of directions) {
        const newRow = row + dRow;
        const newCol = col + (isOddRow ? oddColOffset : evenColOffset);

        // Check bounds
        if (newRow >= 0 && newRow < GRID_ROWS && newCol >= 0 && newCol < GRID_COLS) {
            neighbors.push({ row: newRow, col: newCol });
        }
    }

    return neighbors;
}

/**
 * Check if a grid cell is occupied
 */
function isOccupied(row, col) {
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
        return false;
    }
    return gameState.grid[row][col] !== null;
}

/**
 * Check if a grid cell is valid and empty
 */
function isValidEmpty(row, col) {
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
        return false;
    }
    return gameState.grid[row][col] === null;
}

// ============================================================================
// CLUSTER DETECTION (BFS)
// ============================================================================

/**
 * Find all connected bubbles of the same color starting from (row, col)
 */
function findCluster(row, col, color) {
    if (!isOccupied(row, col) || gameState.grid[row][col] !== color) {
        return [];
    }

    const cluster = [];
    const visited = new Set();
    const queue = [{ row, col }];

    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.row},${current.col}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (gameState.grid[current.row][current.col] !== color) continue;

        cluster.push(current);

        // Add unvisited neighbors with same color
        const neighbors = getNeighbors(current.row, current.col);
        for (const neighbor of neighbors) {
            const nKey = `${neighbor.row},${neighbor.col}`;
            if (!visited.has(nKey) && isOccupied(neighbor.row, neighbor.col)) {
                if (gameState.grid[neighbor.row][neighbor.col] === color) {
                    queue.push(neighbor);
                }
            }
        }
    }

    return cluster;
}

/**
 * Find all bubbles connected to the ceiling (row 0)
 */
function findConnectedToCeiling() {
    const connected = new Set();
    const queue = [];

    // Start from all occupied cells in row 0
    for (let col = 0; col < GRID_COLS; col++) {
        if (isOccupied(0, col)) {
            queue.push({ row: 0, col });
            connected.add(`0,${col}`);
        }
    }

    // BFS to find all connected bubbles
    while (queue.length > 0) {
        const current = queue.shift();
        const neighbors = getNeighbors(current.row, current.col);

        for (const neighbor of neighbors) {
            const key = `${neighbor.row},${neighbor.col}`;
            if (!connected.has(key) && isOccupied(neighbor.row, neighbor.col)) {
                connected.add(key);
                queue.push(neighbor);
            }
        }
    }

    return connected;
}

/**
 * Remove floating bubbles and return count removed
 */
function removeFloatingBubbles() {
    const connectedToCeiling = findConnectedToCeiling();
    let removedCount = 0;

    for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            if (isOccupied(row, col)) {
                const key = `${row},${col}`;
                if (!connectedToCeiling.has(key)) {
                    gameState.grid[row][col] = null;
                    removedCount++;
                }
            }
        }
    }

    return removedCount;
}

// ============================================================================
// COLLISION & SNAPPING
// ============================================================================

/**
 * Check if projectile collides with any bubble
 * Returns the collided bubble's grid position or null
 */
function checkBubbleCollision(px, py) {
    const collisionDist = BUBBLE_RADIUS * 2;

    for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            if (isOccupied(row, col)) {
                const pos = gridToWorld(row, col);
                const dx = px - pos.x;
                const dy = py - pos.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < collisionDist) {
                    return { row, col };
                }
            }
        }
    }

    return null;
}

/**
 * Find the best empty cell to snap the projectile to
 */
function snapProjectile(px, py, hitRow, hitCol) {
    // Get all empty neighbors of the hit bubble
    const neighbors = getNeighbors(hitRow, hitCol);
    const emptyNeighbors = neighbors.filter(n => isValidEmpty(n.row, n.col));

    if (emptyNeighbors.length === 0) {
        // Fallback: find nearest empty cell
        const nearest = worldToGrid(px, py);
        if (isValidEmpty(nearest.row, nearest.col)) {
            return nearest;
        }
        return null;
    }

    // Find the closest empty neighbor to the projectile position
    let bestCell = null;
    let bestDist = Infinity;

    for (const cell of emptyNeighbors) {
        const pos = gridToWorld(cell.row, cell.col);
        const dx = px - pos.x;
        const dy = py - pos.y;
        const dist = dx * dx + dy * dy;

        if (dist < bestDist) {
            bestDist = dist;
            bestCell = cell;
        }
    }

    return bestCell;
}

/**
 * Calculate snap target for debug display
 */
function calculateSnapTarget(px, py) {
    // Check for collision
    const hitCell = checkBubbleCollision(px, py);

    if (hitCell) {
        return snapProjectile(px, py, hitCell.row, hitCell.col);
    }

    // Check ceiling
    if (py <= BUBBLE_RADIUS) {
        return worldToGrid(px, BUBBLE_RADIUS);
    }

    return null;
}

// ============================================================================
// GAME LOGIC
// ============================================================================

/**
 * Initialize or reset the game
 */
function initGame() {
    // Reset RNG with new seed for new game
    rng = new SeededRNG(Date.now());

    // Load background based on current level
    if (currentLevel === 2 && curseBackgroundLoaded) {
        // Level 2: Use curse background
        backgroundImage = curseBackgroundImage;
        currentBackgroundName = 'curse-background.png';
        currentBackgroundTile = false;
    } else {
        // Level 1: Rotate through normal backgrounds
        const bgConfig = BACKGROUND_IMAGES[backgroundIndex];
        backgroundImage = new Image();
        currentBackgroundName = bgConfig.src;
        currentBackgroundTile = bgConfig.tile;
        backgroundImage.src = bgConfig.src;
        backgroundIndex = (backgroundIndex + 1) % BACKGROUND_IMAGES.length;
        localStorage.setItem('vmkBubbleBackgroundIndex', backgroundIndex.toString());
    }

    // Initialize empty grid
    gameState.grid = [];
    for (let row = 0; row < GRID_ROWS; row++) {
        gameState.grid[row] = [];
        for (let col = 0; col < GRID_COLS; col++) {
            gameState.grid[row][col] = null;
        }
    }

    // Fill initial rows with bubbles
    for (let row = 0; row < INITIAL_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            gameState.grid[row][col] = rng.nextInt(0, NUM_COLORS - 1);
        }
    }

    // Reset game state
    gameState.projectile = null;
    gameState.currentBubble = rng.nextInt(0, NUM_COLORS - 1);
    gameState.nextBubble = rng.nextInt(0, NUM_COLORS - 1);
    gameState.score = 0;
    gameState.shots = 0;
    gameState.shotsWithoutPop = 0;
    gameState.gameOver = false;
    gameState.gameWon = false;
    gameState.scoreSubmitted = false;
    gameState.snapTarget = null;
}

/**
 * Fire a new bubble
 */
function fireBubble() {
    if (gameState.projectile !== null || gameState.gameOver || gameState.gameWon) {
        return;
    }

    const angle = gameState.aimAngle;
    const speed = PROJECTILE_SPEED;

    gameState.projectile = {
        x: SHOOTER_X,
        y: SHOOTER_Y,
        vx: Math.cos(angle) * speed,
        vy: -Math.sin(angle) * speed, // Negative because canvas y is down
        color: gameState.currentBubble,
        active: true,
        bounceCount: 0
    };

    // Cycle to next bubble
    gameState.currentBubble = gameState.nextBubble;
    gameState.nextBubble = rng.nextInt(0, NUM_COLORS - 1);
    gameState.shots++;
}

/**
 * Place a bubble on the grid and process matches
 */
function placeBubble(row, col, color) {
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
        return;
    }

    gameState.grid[row][col] = color;

    // Find cluster of same color
    const cluster = findCluster(row, col, color);

    let popped = false;

    if (cluster.length >= CLUSTER_MIN_SIZE) {
        // Remove cluster
        for (const cell of cluster) {
            gameState.grid[cell.row][cell.col] = null;
        }

        // Calculate bounce bonus (25% extra per bounce)
        const bounces = gameState.projectile ? gameState.projectile.bounceCount : 0;
        const bounceMultiplier = 1 + (bounces * 0.25);
        const clusterPoints = Math.floor(cluster.length * 10 * bounceMultiplier);
        gameState.score += clusterPoints;
        popped = true;

        // Remove floating bubbles (also gets bounce bonus)
        const floatingCount = removeFloatingBubbles();
        if (floatingCount > 0) {
            const floatingPoints = Math.floor(floatingCount * 20 * bounceMultiplier);
            gameState.score += floatingPoints;
        }
    }

    // Track shots without popping
    if (popped) {
        gameState.shotsWithoutPop = 0;
    } else {
        gameState.shotsWithoutPop++;

        // Add new row if threshold reached
        if (gameState.shotsWithoutPop >= SHOTS_BEFORE_NEW_ROW) {
            addNewRow();
            gameState.shotsWithoutPop = 0;
        }
    }

    // Check game over
    checkGameOver();
}

/**
 * Add a new row at the top and shift everything down
 */
function addNewRow() {
    // Shift all rows down
    for (let row = GRID_ROWS - 1; row > 0; row--) {
        for (let col = 0; col < GRID_COLS; col++) {
            gameState.grid[row][col] = gameState.grid[row - 1][col];
        }
    }

    // Generate new row at top
    for (let col = 0; col < GRID_COLS; col++) {
        gameState.grid[0][col] = rng.nextInt(0, NUM_COLORS - 1);
    }
}

/**
 * Check if game is won (all bubbles cleared)
 */
function checkWin() {
    for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            if (isOccupied(row, col)) {
                return; // Still bubbles remaining
            }
        }
    }
    gameState.gameWon = true;
}

/**
 * Check if game is over
 */
function checkGameOver() {
    // First check for win
    checkWin();
    if (gameState.gameWon) return;

    // Check if any bubble is at or below the lose line
    for (let col = 0; col < GRID_COLS; col++) {
        if (isOccupied(LOSE_ROW, col)) {
            gameState.gameOver = true;
            return;
        }
    }

    // Also check by y position
    for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            if (isOccupied(row, col)) {
                const pos = gridToWorld(row, col);
                if (pos.y >= LOSE_LINE_Y) {
                    gameState.gameOver = true;
                    return;
                }
            }
        }
    }
}

/**
 * Update projectile physics
 */
function updateProjectile(dt) {
    const proj = gameState.projectile;
    if (!proj || !proj.active) return;

    // Update position
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;

    // Wall bouncing
    if (proj.x <= BUBBLE_RADIUS) {
        proj.x = BUBBLE_RADIUS;
        proj.vx = -proj.vx;
        proj.bounceCount++;
    } else if (proj.x >= CANVAS_WIDTH - BUBBLE_RADIUS) {
        proj.x = CANVAS_WIDTH - BUBBLE_RADIUS;
        proj.vx = -proj.vx;
        proj.bounceCount++;
    }

    // Check collision with bubbles
    const hitCell = checkBubbleCollision(proj.x, proj.y);

    if (hitCell) {
        // Snap to grid
        const snapCell = snapProjectile(proj.x, proj.y, hitCell.row, hitCell.col);
        if (snapCell) {
            placeBubble(snapCell.row, snapCell.col, proj.color);
        }
        gameState.projectile = null;
        return;
    }

    // Check ceiling collision
    if (proj.y <= BUBBLE_RADIUS) {
        proj.y = BUBBLE_RADIUS;
        const gridPos = worldToGrid(proj.x, proj.y);
        if (isValidEmpty(gridPos.row, gridPos.col)) {
            placeBubble(gridPos.row, gridPos.col, proj.color);
        }
        gameState.projectile = null;
        return;
    }
}

// ============================================================================
// RENDERING
// ============================================================================

/**
 * Draw a bubble at the specified position
 */
function drawBubble(x, y, colorId, highlight = false) {
    // Level 2: Draw custom curse images
    if (currentLevel === 2 && curseImagesLoaded && CURSE_IMAGES[colorId]) {
        const img = CURSE_IMAGES[colorId];
        if (img.complete && img.naturalWidth > 0) {
            // Draw the image centered at x, y
            const size = BUBBLE_RADIUS * 2;
            ctx.drawImage(img, x - BUBBLE_RADIUS, y - BUBBLE_RADIUS, size, size);

            // Add highlight border if needed
            if (highlight) {
                ctx.beginPath();
                ctx.arc(x, y, BUBBLE_RADIUS, 0, Math.PI * 2);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            return;
        }
    }

    // Level 1 (default): Draw colored circles
    const color = BUBBLE_COLORS[colorId];

    // Main bubble
    ctx.beginPath();
    ctx.arc(x, y, BUBBLE_RADIUS - 1, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Highlight/shine effect
    ctx.beginPath();
    ctx.arc(x - 4, y - 4, BUBBLE_RADIUS / 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.arc(x, y, BUBBLE_RADIUS - 1, 0, Math.PI * 2);
    ctx.strokeStyle = highlight ? '#fff' : 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = highlight ? 2 : 1;
    ctx.stroke();
}

/**
 * Draw the bubble grid
 */
function drawGrid() {
    for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            const colorId = gameState.grid[row][col];
            if (colorId !== null) {
                const pos = gridToWorld(row, col);
                drawBubble(pos.x, pos.y, colorId);
            }
        }
    }
}

/**
 * Draw the shooter
 */
function drawShooter() {
    // Draw shooter base (hidden in Level 2 to show spinner)
    if (currentLevel === 1) {
        ctx.beginPath();
        ctx.arc(SHOOTER_X, SHOOTER_Y, 25, 0, Math.PI * 2);
        ctx.fillStyle = '#34495e';
        ctx.fill();
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // Draw current bubble in shooter
    drawBubble(SHOOTER_X, SHOOTER_Y, gameState.currentBubble);

    // Draw aim line
    const aimLength = 60;
    const endX = SHOOTER_X + Math.cos(gameState.aimAngle) * aimLength;
    const endY = SHOOTER_Y - Math.sin(gameState.aimAngle) * aimLength;

    ctx.beginPath();
    ctx.moveTo(SHOOTER_X, SHOOTER_Y);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw aim arrow
    const arrowSize = 8;
    const angle = gameState.aimAngle;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
        endX - arrowSize * Math.cos(angle - 0.3),
        endY + arrowSize * Math.sin(angle - 0.3)
    );
    ctx.moveTo(endX, endY);
    ctx.lineTo(
        endX - arrowSize * Math.cos(angle + 0.3),
        endY + arrowSize * Math.sin(angle + 0.3)
    );
    ctx.stroke();
}

/**
 * Draw the projectile if active
 */
function drawProjectile() {
    const proj = gameState.projectile;
    if (!proj || !proj.active) return;

    drawBubble(proj.x, proj.y, proj.color, true);
}

/**
 * Draw the UI (score, shots, next bubble)
 */
function drawUI() {
    ctx.fillStyle = '#ecf0f1';
    ctx.font = '18px Arial';

    // Score
    ctx.textAlign = 'left';
    ctx.fillText(`Score: ${gameState.score}`, 20, 580);

    // Shots
    ctx.fillText(`Shots: ${gameState.shots}`, 150, 580);

    // Shots until new row
    const shotsLeft = SHOTS_BEFORE_NEW_ROW - gameState.shotsWithoutPop;
    ctx.fillText(`Row in: ${shotsLeft}`, 280, 580);

    // Show bounce bonus while projectile is active
    if (gameState.projectile && gameState.projectile.bounceCount > 0) {
        const bounces = gameState.projectile.bounceCount;
        const bonusPercent = bounces * 25;
        ctx.fillStyle = '#f1c40f';
        ctx.fillText(`+${bonusPercent}% BOUNCE!`, 420, 580);
        ctx.fillStyle = '#ecf0f1';
    }

    // Next bubble
    ctx.textAlign = 'right';
    ctx.fillText('Next:', 750, 580);
    drawBubble(770, 575, gameState.nextBubble);

    // Danger zone indicator at row 13
    const dangerLineY = LOSE_ROW * ROW_HEIGHT + BUBBLE_RADIUS;

    // Draw subtle danger zone gradient below the line
    const gradient = ctx.createLinearGradient(0, dangerLineY, 0, dangerLineY + 60);
    gradient.addColorStop(0, 'rgba(231, 76, 60, 0.2)');
    gradient.addColorStop(1, 'rgba(231, 76, 60, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, dangerLineY, CANVAS_WIDTH, 60);

    // Draw dashed danger line
    ctx.beginPath();
    ctx.setLineDash([8, 6]);
    ctx.moveTo(0, dangerLineY);
    ctx.lineTo(CANVAS_WIDTH, dangerLineY);
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // "DANGER" label
    ctx.fillStyle = 'rgba(231, 76, 60, 0.5)';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('DANGER ZONE', 10, dangerLineY + 15);
}

/**
 * Draw game over screen
 */
function drawGameOver() {
    // Semi-transparent overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Game over text
    ctx.fillStyle = '#e74c3c';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);

    // Final score
    ctx.fillStyle = '#ecf0f1';
    ctx.font = '24px Arial';
    ctx.fillText(`Final Score: ${gameState.score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 20);

    // Restart instruction
    ctx.font = '18px Arial';
    ctx.fillText('Press R to restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 60);
}

/**
 * Draw win screen
 */
function drawWin() {
    // Semi-transparent overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Win text
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('YOU WIN!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);

    // Final score
    ctx.fillStyle = '#ecf0f1';
    ctx.font = '24px Arial';
    ctx.fillText(`Final Score: ${gameState.score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 20);

    // Shots taken
    ctx.font = '18px Arial';
    ctx.fillText(`Completed in ${gameState.shots} shots`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 50);

    // Restart instruction
    ctx.fillText('Press R to play again', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 85);
}

/**
 * Draw debug overlay
 */
function drawDebug() {
    if (!gameState.debugMode) return;

    // Draw grid cell centers and indices
    ctx.font = '8px Arial';
    ctx.textAlign = 'center';

    for (let row = 0; row < VISIBLE_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            const pos = gridToWorld(row, col);

            // Cell center dot
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = isOccupied(row, col) ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 255, 0, 0.3)';
            ctx.fill();

            // Row,col indices
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fillText(`${row},${col}`, pos.x, pos.y + 20);

            // Collision radius circle for occupied cells
            if (isOccupied(row, col)) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, BUBBLE_RADIUS, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }

    // Draw snap target if projectile is active
    if (gameState.projectile && gameState.projectile.active) {
        const proj = gameState.projectile;
        const target = calculateSnapTarget(proj.x, proj.y);

        if (target) {
            const pos = gridToWorld(target.row, target.col);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, BUBBLE_RADIUS + 3, 0, Math.PI * 2);
            ctx.strokeStyle = '#f1c40f';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }

    // Debug info text
    ctx.fillStyle = '#f1c40f';
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Debug Mode (D to toggle)`, 20, 20);
    ctx.fillText(`Aim: ${(gameState.aimAngle * 180 / Math.PI).toFixed(1)}°`, 20, 35);
    ctx.fillText(`Level: ${currentLevel} | Background: ${currentBackgroundName}`, 20, 50);

    if (gameState.projectile) {
        ctx.fillText(`Proj: (${gameState.projectile.x.toFixed(0)}, ${gameState.projectile.y.toFixed(0)})`, 20, 65);
    }
}

/**
 * Main render function
 */
function render() {
    // Clear canvas
    ctx.fillStyle = '#16213e';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw background image with transparency
    if (backgroundImage && backgroundImage.complete && backgroundImage.naturalWidth > 0) {
        ctx.globalAlpha = (currentLevel === 2) ? CURSE_BACKGROUND_OPACITY : BACKGROUND_OPACITY;

        if (currentBackgroundTile) {
            // Tile/repeat the image across the canvas
            const pattern = ctx.createPattern(backgroundImage, 'repeat');
            ctx.fillStyle = pattern;
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        } else {
            // Scale image to cover canvas while maintaining aspect ratio
            const scale = Math.max(CANVAS_WIDTH / backgroundImage.width, CANVAS_HEIGHT / backgroundImage.height);
            const w = backgroundImage.width * scale;
            const h = backgroundImage.height * scale;
            const x = (CANVAS_WIDTH - w) / 2;
            const y = (CANVAS_HEIGHT - h) / 2;
            ctx.drawImage(backgroundImage, x, y, w, h);
        }

        ctx.globalAlpha = 1.0;
    }

    // Draw spinner behind shooter (Level 2 only)
    if (currentLevel === 2 && curseSpinnerLoaded && curseSpinnerImage.complete) {
        const spinnerX = SHOOTER_X - SPINNER_SIZE / 2;
        const spinnerY = SHOOTER_Y - SPINNER_SIZE / 2;
        ctx.drawImage(curseSpinnerImage, spinnerX, spinnerY, SPINNER_SIZE, SPINNER_SIZE);
    }

    // Draw game elements
    drawGrid();
    drawShooter();
    drawProjectile();
    drawUI();
    drawDebug();

    // Draw end screens on top if applicable
    if (gameState.gameWon) {
        drawWin();
    } else if (gameState.gameOver) {
        drawGameOver();
    }
}

// ============================================================================
// INPUT HANDLING
// ============================================================================

function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    gameState.mouseX = e.clientX - rect.left;
    gameState.mouseY = e.clientY - rect.top;

    // Calculate aim angle
    const dx = gameState.mouseX - SHOOTER_X;
    const dy = SHOOTER_Y - gameState.mouseY; // Inverted for screen coords

    let angle = Math.atan2(dy, dx);

    // Clamp angle to prevent shooting downward
    angle = Math.max(MIN_AIM_ANGLE, Math.min(MAX_AIM_ANGLE, angle));

    gameState.aimAngle = angle;
}

function handleClick(e) {
    if (!gameState.gameOver && !gameState.gameWon) {
        fireBubble();
    }
}

function handleKeyDown(e) {
    switch (e.key.toLowerCase()) {
        case 'r':
            initGame();
            break;
        case 'd':
            gameState.debugMode = !gameState.debugMode;
            break;
    }
}

/**
 * Set the current level and update UI
 */
function setLevel(level) {
    currentLevel = level;

    // Update button states
    const level1Btn = document.getElementById('level1Btn');
    const level2Btn = document.getElementById('level2Btn');

    if (level === 1) {
        level1Btn.classList.add('active');
        level2Btn.classList.remove('active');
    } else {
        level1Btn.classList.remove('active');
        level2Btn.classList.add('active');
    }

    // Restart the game with new level
    initGame();
}

// ============================================================================
// GAME LOOP
// ============================================================================

function gameLoop(timestamp) {
    // Calculate delta time in seconds
    const dt = gameState.lastTime ? (timestamp - gameState.lastTime) / 1000 : 0;
    gameState.lastTime = timestamp;

    // Cap delta time to prevent huge jumps
    const cappedDt = Math.min(dt, 0.1);

    // Update
    if (!gameState.gameOver && !gameState.gameWon) {
        updateProjectile(cappedDt);
    }

    // Check if we need to show name entry modal
    if ((gameState.gameOver || gameState.gameWon) && !gameState.scoreSubmitted) {
        gameState.scoreSubmitted = true; // Prevent multiple popups
        setTimeout(() => showNameEntry(gameState.gameWon), 500); // Slight delay for effect
    }

    // Render
    render();

    // Continue loop
    requestAnimationFrame(gameLoop);
}

// ============================================================================
// LEADERBOARD
// ============================================================================

const LEADERBOARD_KEY = 'vmkBubbleLeaderboard';
const MAX_LEADERBOARD_ENTRIES = 10;

function loadLeaderboard() {
    const data = localStorage.getItem(LEADERBOARD_KEY);
    return data ? JSON.parse(data) : [];
}

function saveLeaderboard(leaderboard) {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard));
}

function addToLeaderboard(name, score) {
    const leaderboard = loadLeaderboard();
    leaderboard.push({ name, score, date: Date.now() });
    // Sort by score descending
    leaderboard.sort((a, b) => b.score - a.score);
    // Keep only top entries
    const trimmed = leaderboard.slice(0, MAX_LEADERBOARD_ENTRIES);
    saveLeaderboard(trimmed);
    return trimmed;
}

function openLeaderboard() {
    const leaderboard = loadLeaderboard();
    const list = document.getElementById('leaderboardList');

    if (leaderboard.length === 0) {
        list.innerHTML = '<li class="no-scores">No scores yet. Be the first!</li>';
    } else {
        list.innerHTML = leaderboard.map((entry, index) => `
            <li>
                <span class="rank">#${index + 1}</span>
                <span class="name">${escapeHtml(entry.name)}</span>
                <span class="score">${entry.score}</span>
            </li>
        `).join('');
    }

    document.getElementById('leaderboardModal').classList.add('active');
}

function closeLeaderboard() {
    document.getElementById('leaderboardModal').classList.remove('active');
}

function showNameEntry(isWin) {
    document.getElementById('gameEndTitle').textContent = isWin ? 'You Win!' : 'Game Over!';
    document.getElementById('finalScoreDisplay').textContent = gameState.score;
    document.getElementById('playerNameInput').value = '';
    document.getElementById('nameEntryModal').classList.add('active');
    document.getElementById('playerNameInput').focus();
}

function closeNameEntry() {
    document.getElementById('nameEntryModal').classList.remove('active');
}

function submitScore() {
    const nameInput = document.getElementById('playerNameInput');
    const name = nameInput.value.trim() || 'Anonymous';
    addToLeaderboard(name, gameState.score);
    closeNameEntry();
    gameState.scoreSubmitted = true;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
    // Preload curse images for Level 2
    preloadCurseImages();

    // Set up event listeners
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);

    // Level toggle buttons
    document.getElementById('level1Btn').addEventListener('click', () => setLevel(1));
    document.getElementById('level2Btn').addEventListener('click', () => setLevel(2));

    // Leaderboard button
    document.getElementById('leaderboardBtn').addEventListener('click', openLeaderboard);

    // Name entry modal buttons
    document.getElementById('submitScoreBtn').addEventListener('click', submitScore);
    document.getElementById('skipScoreBtn').addEventListener('click', () => {
        closeNameEntry();
        gameState.scoreSubmitted = true;
    });

    // Allow Enter key to submit score
    document.getElementById('playerNameInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            submitScore();
        }
    });

    // Close modals when clicking overlay
    document.getElementById('leaderboardModal').addEventListener('click', (e) => {
        if (e.target.id === 'leaderboardModal') {
            closeLeaderboard();
        }
    });

    // Initialize game state
    initGame();

    // Start game loop
    requestAnimationFrame(gameLoop);
}

// Start the game when page loads
init();
