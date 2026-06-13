// ── Mode Switcher (Number / Image) ──
  function switchMode(mode) {
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    if (mode === 'image') {
      openImagePuzzle();
    } else {
      closeImagePuzzle();
    }
  }

  // ── Hint / Auto-Solve state (declared early to avoid TDZ errors) ──
  let hintTimeout = null;
  let solveInterval = null;
  let solveMoves = [];
  let ipHintTimeout = null;
  let ipSolveInterval = null;

  // ── Hint limits (5 per game) ──
  const MAX_HINTS = 5;
  let hintsUsed = 0;
  let ipHintsUsed = 0;

  // ── Auto-solve flag (suppress best score save) ──
  let isSolving = false;
  let isIPSolving = false;

  // Thin stubs — delegate to real implementations defined later in the file
  function cancelAutoSolve(f)   { if (solveInterval)   { clearInterval(solveInterval);   solveInterval = null; } const sb = document.getElementById('solve-btn');    const hb = document.getElementById('hint-btn');    if (sb) sb.disabled = false; if (hb) hb.disabled = false; }
  function cancelIPAutoSolve(f) { if (ipSolveInterval) { clearInterval(ipSolveInterval); ipSolveInterval = null; } const sb = document.getElementById('ip-solve-btn'); const hb = document.getElementById('ip-hint-btn'); if (sb) sb.disabled = false; if (hb) hb.disabled = false; }

  // ── Audio Engine ──
  let audioCtx = null;
  let soundOn = true;

  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, type, duration, vol = 0.18) {
    if (!soundOn) return;
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch(e) {}
  }

  function playSlide()   { playTone(300, 'sine', 0.08, 0.12); }
  function playCorrect() { playTone(520, 'sine', 0.12, 0.15); }
  function playWin() {
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => playTone(f, 'sine', 0.25, 0.2), i * 100);
    });
  }

  function toggleSound() {
    soundOn = !soundOn;
    document.getElementById('sound-toggle').classList.toggle('on', soundOn);
  }

  // ── Theme ──
  function setTheme(name, btn) {
    document.body.className = name === 'dark' ? '' : `theme-${name}`;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    localStorage.setItem('sf_theme', name);
  }

  function loadTheme() {
    const saved = localStorage.getItem('sf_theme') || 'dark';
    const btn = document.querySelector(`.theme-btn[data-theme="${saved}"]`);
    if (btn) setTheme(saved, btn);
  }

  // ── High Score (localStorage) ──
  // Structure: { "3": { seconds, moves }, "4": {...}, ... }
  let best = {};

  function loadBest() {
    try {
      const raw = localStorage.getItem('sf_best');
      if (raw) best = JSON.parse(raw);
    } catch(e) { best = {}; }
  }

  function saveBest() {
    try { localStorage.setItem('sf_best', JSON.stringify(best)); } catch(e) {}
  }

  function updateBestDisplay() {
    const key = `${size}`;
    const b = best[key];
    document.getElementById('best').textContent = b ? formatTime(b.seconds) : '—';
    const badge = document.getElementById('best-badge');
    badge.classList.toggle('show', !!b);
  }

  // ── Game State ──
  let size = 3;
  let tiles = [];
  let emptyIdx = size * size - 1;
  let moves = 0;
  let seconds = 0;
  let timerInterval = null;
  let running = false;

  function setDifficulty(s) {
    size = s;
    newGame(true);
  }

  function getFontSize() {
    const map = { 3:'28px', 4:'22px', 5:'16px', 6:'13px', 7:'11px', 8:'10px', 9:'9px' };
    return map[size] || '9px';
  }

  // Generic 15-puzzle solvability check.
  // arr: flat array of tile values (a permutation), n: grid size (n x n),
  // blankVal: the value used to represent the empty/blank tile.
  function isSolvableArr(arr, n, blankVal) {
    let inv = 0;
    const flat = arr.filter(x => x !== blankVal);
    for (let i = 0; i < flat.length; i++)
      for (let j = i + 1; j < flat.length; j++)
        if (flat[i] > flat[j]) inv++;
    if (n % 2 === 1) return inv % 2 === 0;
    const blankRow = Math.floor(arr.indexOf(blankVal) / n);
    const rowFromBottom = n - blankRow;
    return (rowFromBottom % 2 === 0) ? (inv % 2 === 1) : (inv % 2 === 0);
  }

  function isSolvable(arr) {
    return isSolvableArr(arr, size, 0);
  }

  function newGame(btnClick=false) {
    cancelAutoSolve();
    stopTimer();
    if (challengeMode && btnClick){ stopChallengeCountdown();}
    if(btnClick){onModeChange("normal");}
    moves = 0; seconds = 0; running = false; hintsUsed = 0; isSolving = false;
    updateMoves(); updateTimer(); updateBestDisplay(); updateHintBtn();

    const total = size * size;
    tiles = Array.from({length: total}, (_, i) => (i + 1) % total);

    do {
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      }
    } while (!isSolvable(tiles) || isSolved());

    emptyIdx = tiles.indexOf(0);
    renderBoard();
  }

  function shuffleBoard() { newGame(); }

  function renderBoard(animatedIdx = -1, animDir = '') {
    const board = document.getElementById('board');
    board.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    board.innerHTML = '';

    // Calculate tile size for animation distance
    const tileSize = board.clientWidth / size;
    board.style.setProperty('--slide-dist', `${tileSize + 6}px`);

    tiles.forEach((val, idx) => {
      const tile = document.createElement('div');
      tile.className = 'tile' + (val === 0 ? ' empty' : '');

      if (val !== 0) {
        if (idx === val - 1) tile.classList.add('correct');

        // Apply slide animation to the tile that just moved (now at emptyIdx)
        if (animDir && idx === animatedIdx) {
          tile.classList.add(animDir);
        }

        const num = document.createElement('span');
        num.className = 'tile-num';
        num.textContent = val;
        num.style.fontSize = getFontSize();

        const dot = document.createElement('div');
        dot.className = 'tile-dot';

        tile.appendChild(num);
        tile.appendChild(dot);
        tile.addEventListener('click', () => clickTile(idx));

        let tx = 0, ty = 0;
        tile.addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, {passive:true});
        tile.addEventListener('touchend', e => {
          const dx = e.changedTouches[0].clientX - tx;
          const dy = e.changedTouches[0].clientY - ty;
          if (Math.abs(dx) < 5 && Math.abs(dy) < 5) clickTile(idx);
        }, {passive:true});
      }

      board.appendChild(tile);
    });
  }

  function clickTile(idx) {
    if (!canMove(idx)) return;

    if (!running && !isSolving) { running = true; startTimer(); }

    // Determine animation direction for the moving tile
    const tileRow = Math.floor(idx / size), tileCol = idx % size;
    const eRow    = Math.floor(emptyIdx / size), eCol = emptyIdx % size;
    let animDir = '';
    if (tileRow < eRow) animDir = 'anim-down';
    else if (tileRow > eRow) animDir = 'anim-up';
    else if (tileCol < eCol) animDir = 'anim-right';
    else animDir = 'anim-left';

    [tiles[idx], tiles[emptyIdx]] = [tiles[emptyIdx], tiles[idx]];
    emptyIdx = idx;
    moves++;
    updateMoves();

    const isNowCorrect = tiles[idx] === idx + 1;
    if (isNowCorrect) playCorrect(); else playSlide();

    renderBoard(emptyIdx, animDir);

    if (isSolved()) {
      stopTimer();
      running = false;
      if (challengeMode) {
        stopChallengeCountdown();
        playWin();
        setTimeout(showChallengeWin, 300);
      } else {
        checkAndSaveBest();
        playWin();
        setTimeout(showWin, 300);
      }
    }
  }

  function checkAndSaveBest() {
    if (isSolving) return false; // don't count auto-solve as a best score
    const key = `${size}`;
    const prev = best[key];
    const isNew = !prev || seconds < prev.seconds || (seconds === prev.seconds && moves < prev.moves);
    if (isNew) {
      best[key] = { seconds, moves };
      saveBest();
      updateBestDisplay();
    }
    return isNew;
  }

  function canMove(idx) {
    const row = Math.floor(idx / size), col = idx % size;
    const eRow = Math.floor(emptyIdx / size), eCol = emptyIdx % size;
    return (row === eRow && Math.abs(col - eCol) === 1) ||
           (col === eCol && Math.abs(row - eRow) === 1);
  }

  function isSolved() {
    for (let i = 0; i < tiles.length - 1; i++)
      if (tiles[i] !== i + 1) return false;
    return tiles[tiles.length - 1] === 0;
  }

  function startTimer() {
    timerInterval = setInterval(() => { seconds++; updateTimer(); }, 1000);
  }

  function stopTimer()   { clearInterval(timerInterval); timerInterval = null; }
  function updateTimer() { document.getElementById('timer').textContent = formatTime(seconds); }
  function updateMoves() { document.getElementById('moves').textContent = moves; }

  function updateHintBtn() {
    const btn = document.getElementById('hint-btn');
    if (!btn) return;
    const left = MAX_HINTS - hintsUsed;
    btn.textContent = left > 0 ? `💡 Hint (${left})` : '💡 No Hints';
    btn.disabled = left <= 0;
  }

  function updateIPHintBtn() {
    const btn = document.getElementById('ip-hint-btn');
    if (!btn) return;
    const left = MAX_HINTS - ipHintsUsed;
    btn.textContent = left > 0 ? `💡 Hint (${left})` : '💡 No Hints';
    btn.disabled = left <= 0;
  }

  function formatTime(s) {
    return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
  }

  // ── Win Screen ──
  function showWin() {
    document.getElementById('win-moves').textContent = moves;
    document.getElementById('win-time').textContent = formatTime(seconds);

    // Hide challenge badge in normal mode
    const badge = document.getElementById('challenge-win-badge');
    if (badge) badge.style.display = 'none';
    document.getElementById('win-share-btn').style.display = '';

    const key = `${size}`;
    const b = best[key];
    const isNewBest = b && b.seconds === seconds && b.moves === moves;

    document.getElementById('win-sub').textContent = isNewBest
      ? `🏆 New best time for ${size}×${size}!`
      : `${size}×${size} puzzle complete`;

    // Show previous best if not new record
    const hsEl = document.getElementById('win-hs');
    if (!isNewBest && b) {
      hsEl.innerHTML = `Previous best: <strong>${formatTime(b.seconds)}</strong> in <strong>${b.moves}</strong> moves`;
      hsEl.classList.add('show');
    } else {
      hsEl.classList.remove('show');
    }

    document.getElementById('win-overlay').classList.add('show');
  }

  function closeWin() {
    document.getElementById('win-overlay').classList.remove('show');
    if (challengeMode) {
      // Reset to normal mode, 3x3
      stopChallengeCountdown();
      challengeMode = false;
      document.getElementById('mode-select').value = 'normal';
      document.getElementById('mode-select').classList.remove('challenge-active');
      document.getElementById('challenge-bar-wrap').classList.remove('show');
      document.querySelector('.stat-box:last-child').style.opacity = '';
      document.querySelector('.stat-box:last-child').style.pointerEvents = '';
      size = 3;
      document.getElementById('diff-select').value = 3;
    }
    newGame();
  }

  function showChallengeWin() {
    const timeUsed = challengeLimitSeconds - challengeSecondsLeft;
    const minsLimit = Math.floor(challengeLimitSeconds / 60);
    document.getElementById('win-moves').textContent = moves;
    document.getElementById('win-time').textContent = formatTime(timeUsed);
    document.getElementById('win-sub').textContent = `✅ Challenge complete — within ${minsLimit} min${minsLimit !== 1 ? 's' : ''}!`;
    // Hide HS row in challenge mode
    document.getElementById('win-hs').classList.remove('show');
    // Show challenge badge
    const badge = document.getElementById('challenge-win-badge');
    if (badge) badge.style.display = 'inline-flex';
    document.getElementById('win-overlay').classList.add('show');
  }

  // ── High Score Panel ──
  function showHSPanel() {
    const sizes = [3,4,5,6,7,8,9];
    const tbody = document.getElementById('hs-tbody');
    tbody.innerHTML = '';

    sizes.forEach(s => {
      const b = best[`${s}`];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${s}×${s}</td>
        <td class="${b ? 'hs-time' : 'hs-empty'}">${b ? formatTime(b.seconds) : '—'}</td>
        <td class="${b ? '' : 'hs-empty'}">${b ? b.moves : '—'}</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('hs-overlay').classList.add('show');
  }

  function closeHSPanel() {
    document.getElementById('hs-overlay').classList.remove('show');
  }

  function clearScores() {
    if (!confirm('Reset all high scores?')) return;
    best = {};
    saveBest();
    updateBestDisplay();
    showHSPanel(); // refresh the table
    showToast('All scores cleared!');
  }

  // ── Share ──
  function shareResult() {
    const time = formatTime(seconds);
    const text = `🧩 I solved the ${size}×${size} Slide & Fun puzzle in ${time} with ${moves} moves!\nCan you beat me? 👉 https://slide-and-fun.netlify.app/`;
    if (navigator.share) {
      navigator.share({ title: 'Slide & Fun', text, url: 'https://slide-and-fun.netlify.app/' })
        .catch(() => copyToClipboard(text));
    } else {
      copyToClipboard(text);
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'))
      .catch(() => showToast('Share: ' + window.location.href));
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }

  // ── Keyboard ──
  document.addEventListener('keydown', e => {
    const eRow = Math.floor(emptyIdx / size), eCol = emptyIdx % size;
    let target = -1;
    if (e.key === 'ArrowUp'    && eRow < size-1) target = emptyIdx + size;
    if (e.key === 'ArrowDown'  && eRow > 0)      target = emptyIdx - size;
    if (e.key === 'ArrowLeft'  && eCol < size-1) target = emptyIdx + 1;
    if (e.key === 'ArrowRight' && eCol > 0)      target = emptyIdx - 1;
    if (target !== -1) { e.preventDefault(); clickTile(target); }
  });

  // ── Challenge Mode ──
  let challengeMode = false;
  let challengeLimitSeconds = 0;
  let challengeSecondsLeft = 0;
  let challengeInterval = null;

  function onModeChange(val) {
    if (val === 'challenge') {
      // Show the time-limit modal
      document.getElementById('time-limit-input').value = 5;
      document.getElementById('time-modal-overlay').classList.add('show');
    } else {
      exitChallenge();
    }
  }

  function cancelChallengeMode() {
    document.getElementById('time-modal-overlay').classList.remove('show');
    document.getElementById('mode-select').value = 'normal';
    // Don't enter challenge mode
  }

  function startChallenge() {
    const val = parseInt(document.getElementById('time-limit-input').value, 10);
    if (!val || val < 1) { document.getElementById('time-limit-input').focus(); return; }
    challengeLimitSeconds = val * 60;
    challengeSecondsLeft = challengeLimitSeconds;
    challengeMode = true;
    document.getElementById('time-modal-overlay').classList.remove('show');
    document.getElementById('mode-select').classList.add('challenge-active');
    // Hide best stat in challenge mode
    document.querySelector('.stat-box:last-child').style.opacity = '0.3';
    document.querySelector('.stat-box:last-child').style.pointerEvents = 'none';
    // Show the countdown bar
    document.getElementById('challenge-bar-wrap').classList.add('show');
    updateChallengeBar();
    newGame();
    // Start countdown immediately (not waiting for first tile move)
    startChallengeCountdown();
  }

  function startChallengeCountdown() {
    stopChallengeCountdown();
    challengeInterval = setInterval(() => {
      challengeSecondsLeft--;
      updateChallengeBar();
      if (challengeSecondsLeft <= 0) {
        stopChallengeCountdown();
        timesUp();
      }
    }, 1000);
  }

  function stopChallengeCountdown() {
    if (challengeInterval) { clearInterval(challengeInterval); challengeInterval = null; }
  }

  function updateChallengeBar() {
    const pct = Math.max(0, challengeSecondsLeft / challengeLimitSeconds) * 100;
    document.getElementById('challenge-bar-fill').style.width = pct + '%';
    const mins = Math.floor(challengeSecondsLeft / 60);
    const secs = (challengeSecondsLeft % 60).toString().padStart(2, '0');
    const el = document.getElementById('challenge-countdown');
    el.textContent = `${mins}:${secs}`;
    // Urgent styling when ≤ 20% remaining
    el.classList.toggle('urgent', pct <= 20);
    const fill = document.getElementById('challenge-bar-fill');
    if (pct <= 20) {
      fill.style.background = 'linear-gradient(90deg, #f7736a, #f73a3a)';
    } else if (pct <= 50) {
      fill.style.background = 'linear-gradient(90deg, #f7c56a, #f7a36a)';
    } else {
      fill.style.background = 'linear-gradient(90deg, #f7a36a, #f7736a)';
    }
  }

  function timesUp() {
    stopTimer();
    running = false;
    stopChallengeCountdown();
    playTimesUpSound();
    const mins = Math.floor(challengeLimitSeconds / 60);
    document.getElementById('timesup-limit-display').textContent =
      mins === 1 ? '1 minute' : `${mins} minutes`;
    document.getElementById('timesup-overlay').classList.add('show');
  }

  function retryChallenge() {
    document.getElementById('timesup-overlay').classList.remove('show');
    challengeSecondsLeft = challengeLimitSeconds;
    updateChallengeBar();
    newGame();
    startChallengeCountdown();
  }

  function exitChallenge() {
    document.getElementById('timesup-overlay').classList.remove('show');
    document.getElementById('win-overlay').classList.remove('show');
    stopChallengeCountdown();
    challengeMode = false;
    document.getElementById('mode-select').value = 'normal';
    document.getElementById('mode-select').classList.remove('challenge-active');
    document.getElementById('challenge-bar-wrap').classList.remove('show');
    // Restore best stat
    document.querySelector('.stat-box:last-child').style.opacity = '';
    document.querySelector('.stat-box:last-child').style.pointerEvents = '';
    newGame();
  }

  function playTimesUpSound() {
    [400, 320, 240].forEach((f, i) => {
      setTimeout(() => playTone(f, 'sawtooth', 0.3, 0.18), i * 180);
    });
  }

  // ── Init ──
  loadBest();
  loadTheme();
  document.getElementById('diff-select').value = size;
  newGame();

  // ════════════════════════════════════════════════
  // ── IMAGE PUZZLE ENGINE ──
  // ════════════════════════════════════════════════

  let ipSize = 3;
  let ipTiles = [];
  let ipEmptyIdx = 0;
  let ipMoves = 0;
  let ipSeconds = 0;
  let ipTimerInterval = null;
  let ipRunning = false;
  let ipImageSrc = null;   // current image data URL
  let ipImageEl = null;    // Image element

  // ════════════════════════════════════════════════
  // ── PUZZLE ASSETS CONFIG ──
  // To add new images: drop image files into assets/puzzles/
  // then add entries to PUZZLE_ASSETS below.
  // Each entry: { name: 'Label', src: 'assets/puzzles/filename.jpg' }
  // Built-in canvas-drawn images use draw: drawFnName instead of src.
  // ════════════════════════════════════════════════
  const PUZZLE_ASSETS = [
    { name: 'Sunset',  src: 'assets/sunset.jpg'  },
    { name: 'Ocean',   src: 'assets/ocean.jpg'   },
    { name: 'Forest',  src: 'assets/forest.jpg'  },
    { name: 'Space',   src: 'assets/space.jpg'   },
    { name: 'Mountains', src: 'assets/mountains.jpg' }
    // Example of file-based assets (uncomment and add files to assets/puzzles/):
    // { name: 'Mountains', src: 'assets/puzzles/mountains.jpg' },
    // { name: 'City',      src: 'assets/puzzles/city.jpg'      },
    // { name: 'Abstract',  src: 'assets/puzzles/abstract.png'  },
  ];

  // ── Sample image generator (canvas-drawn) ──
  // Keep backward-compatible reference
  const ipSamples = PUZZLE_ASSETS;
  let ipSelectedSampleIdx = 0;


  function renderSampleThumbs() {
    const grid = document.getElementById('ip-samples-grid');
    grid.innerHTML = '';
    PUZZLE_ASSETS.forEach((asset, idx) => {
      const div = document.createElement('div');
      div.className = 'ip-sample' + (idx === ipSelectedSampleIdx ? ' active' : '');
      div.dataset.idx = idx;
      div.onclick = () => selectSample(idx, div);

      if (asset.src) {
        // File-based asset
        const img = document.createElement('img');
        img.width = 60; img.height = 60;
        img.style.borderRadius = '6px';
        img.style.display = 'block';
        img.style.objectFit = 'cover';
        img.src = asset.src;
        img.alt = asset.name;
        div.appendChild(img);
      } else {
        // Canvas-drawn asset
        const canvas = document.createElement('canvas');
        canvas.id = `sample-thumb-${idx}`;
        canvas.width = 60; canvas.height = 60;
        div.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        asset.draw(ctx, 60, 60);
      }

      const label = document.createElement('span');
      label.textContent = asset.name;
      div.appendChild(label);
      grid.appendChild(div);
    });
  }

  function selectSample(idx, el) {
    ipSelectedSampleIdx = idx;
    document.querySelectorAll('.ip-sample').forEach(e => e.classList.remove('active'));
    el.classList.add('active');

    const asset = PUZZLE_ASSETS[idx];
    if (asset.src) {
      // File-based: load image directly
      ipImageSrc = asset.src;
      loadIPImage(ipImageSrc, () => ipNewGame(false));
    } else {
      // Canvas-drawn
      const canvas = document.createElement('canvas');
      canvas.width = 600; canvas.height = 600;
      asset.draw(canvas.getContext('2d'), 600, 600);
      ipImageSrc = canvas.toDataURL();
      loadIPImage(ipImageSrc, () => ipNewGame(false));
    }
  }

  function selectImageSource(src, btn) {
    document.querySelectorAll('.ip-src-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (src === 'default') {
      document.getElementById('ip-samples-grid').style.display = 'flex';
    } else {
      document.getElementById('ip-samples-grid').style.display = 'none';
    }
  }

  function handleImageUpload(input) {
    const file = input.files[0];
    if (!file) return;
    document.querySelectorAll('.ip-src-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('ip-src-upload').classList.add('active');
    document.getElementById('ip-samples-grid').style.display = 'none';
    const reader = new FileReader();
    reader.onload = e => {
      ipImageSrc = e.target.result;
      loadIPImage(ipImageSrc, () => ipNewGame(false));
    };
    reader.readAsDataURL(file);
  }

  function loadIPImage(src, cb) {
    const img = new Image();
    img.onload = () => { ipImageEl = img; if (cb) cb(); };
    img.src = src;
    // also draw preview canvas
    img.onload = () => {
      ipImageEl = img;
      const c = document.getElementById('ip-preview-canvas');
      c.width = c.offsetWidth || 400; c.height = c.offsetHeight || 400;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      if (cb) cb();
    };
  }

  function openImagePuzzle() {
    document.getElementById('number-puzzle-view').classList.add('hidden');
    document.getElementById('image-puzzle-view').classList.remove('hidden');
    renderSampleThumbs();
    // Load default sample if no image loaded yet
    if (!ipImageSrc) {
      const asset = PUZZLE_ASSETS[0];
      if (asset.src) {
        ipImageSrc = asset.src;
        loadIPImage(ipImageSrc, () => ipNewGame(false));
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = 600; canvas.height = 600;
        asset.draw(canvas.getContext('2d'), 600, 600);
        ipImageSrc = canvas.toDataURL();
        loadIPImage(ipImageSrc, () => ipNewGame(false));
      }
    } else {
      ipNewGame(false);
    }
  }

  function closeImagePuzzle() {
    document.getElementById('image-puzzle-view').classList.add('hidden');
    document.getElementById('number-puzzle-view').classList.remove('hidden');
    stopIPTimer();
    // Reset header nav
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === 'number');
    });
  }

  // ── IP Game Logic ──
  function setIPDifficulty(s) {
    ipSize = s;
    document.getElementById('ip-grid-label').textContent = `${s}×${s}`;
    ipNewGame(false);
  }

  function ipNewGame(doShuffle = true) {
    cancelIPAutoSolve();
    stopIPTimer();
    ipMoves = 0; ipSeconds = 0; ipRunning = false; ipHintsUsed = 0; isIPSolving = false;
    document.getElementById('ip-moves').textContent = '0';
    document.getElementById('ip-timer').textContent = '0:00';
    updateIPHintBtn();

    const n = ipSize * ipSize;
    ipTiles = Array.from({length: n}, (_, i) => i);
    ipEmptyIdx = n - 1;

    if (doShuffle) ipShuffleTiles();
    renderIPBoard();
  }

  function ipShuffle() {
    ipShuffleTiles();
    renderIPBoard();
    stopIPTimer();
    ipMoves = 0; ipSeconds = 0; ipRunning = false; ipHintsUsed = 0; isIPSolving = false;
    document.getElementById('ip-moves').textContent = '0';
    document.getElementById('ip-timer').textContent = '0:00';
    updateIPHintBtn();
  }

  function ipIsSolved() {
    for (let i = 0; i < ipTiles.length; i++)
      if (ipTiles[i] !== i) return false;
    return true;
  }

  function ipShuffleTiles() {
    const n = ipSize * ipSize;
    const blankVal = n - 1;

    do {
      // Do many random valid moves from solved state
      ipTiles = Array.from({length: n}, (_, i) => i);
      let eIdx = n - 1;
      for (let i = 0; i < n * 30; i++) {
        const neighbors = getIPNeighbors(eIdx);
        const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
        [ipTiles[eIdx], ipTiles[pick]] = [ipTiles[pick], ipTiles[eIdx]];
        eIdx = pick;
      }
      ipEmptyIdx = eIdx;
      // Verify the resulting layout is actually solvable and not already solved
    } while (!isSolvableArr(ipTiles, ipSize, blankVal) || ipIsSolved());
  }

  function getIPNeighbors(idx) {
    const row = Math.floor(idx / ipSize), col = idx % ipSize;
    const n = [];
    if (row > 0) n.push(idx - ipSize);
    if (row < ipSize - 1) n.push(idx + ipSize);
    if (col > 0) n.push(idx - 1);
    if (col < ipSize - 1) n.push(idx + 1);
    return n;
  }

  function renderIPBoard() {
    const board = document.getElementById('ip-board');
    board.style.gridTemplateColumns = `repeat(${ipSize}, 1fr)`;
    board.innerHTML = '';

    const tileSize = 100 / ipSize;

    // Build a set of correct positions for fast lookup
    const correctSet = new Set();
    ipTiles.forEach((val, pos) => { if (val === pos) correctSet.add(pos); });

    function isCorrect(pos) { return correctSet.has(pos); }

    ipTiles.forEach((val, pos) => {
      const div = document.createElement('div');
      div.className = 'ip-tile';
      if (val === ipSize * ipSize - 1) {
        div.classList.add('empty');
      } else {
        const row = Math.floor(val / ipSize);
        const col = val % ipSize;
        if (ipImageEl) {
          const c = document.createElement('canvas');
          const tpx = 120;
          c.width = tpx; c.height = tpx;
          const ctx = c.getContext('2d');
          const imgW = ipImageEl.naturalWidth || 600;
          const imgH = ipImageEl.naturalHeight || 600;
          const sw = imgW / ipSize, sh = imgH / ipSize;
          ctx.drawImage(ipImageEl, col * sw, row * sh, sw, sh, 0, 0, tpx, tpx);
          div.style.backgroundImage = `url(${c?.toDataURL()})`;
          div.style.backgroundSize = 'cover';
        } else {
          div.style.background = `hsl(${(val / (ipSize * ipSize)) * 300}, 60%, 40%)`;
        }

        // Correct position: merge edges with adjacent correct tiles
        if (val === pos) {
          div.classList.add('correct');

          const posRow = Math.floor(pos / ipSize), posCol = pos % ipSize;
          const topPos    = pos - ipSize;
          const bottomPos = pos + ipSize;
          const leftPos   = pos - 1;
          const rightPos  = pos + 1;

          const mergeTop    = posRow > 0           && isCorrect(topPos)    && ipTiles[topPos]    === topPos;
          const mergeBottom = posRow < ipSize - 1  && isCorrect(bottomPos) && ipTiles[bottomPos] === bottomPos;
          const mergeLeft   = posCol > 0           && isCorrect(leftPos)   && ipTiles[leftPos]   === leftPos;
          const mergeRight  = posCol < ipSize - 1  && isCorrect(rightPos)  && ipTiles[rightPos]  === rightPos;

          if (mergeTop)    div.classList.add('merge-top');
          if (mergeBottom) div.classList.add('merge-bottom');
          if (mergeLeft)   div.classList.add('merge-left');
          if (mergeRight)  div.classList.add('merge-right');
        }

        div.onclick = () => ipClickTile(pos);
      }
      board.appendChild(div);
    });
  }

  function ipClickTile(pos) {
    const row = Math.floor(pos / ipSize), col = pos % ipSize;
    const eRow = Math.floor(ipEmptyIdx / ipSize), eCol = ipEmptyIdx % ipSize;
    const isAdj = (Math.abs(row - eRow) + Math.abs(col - eCol)) === 1;
    if (!isAdj) return;

    // Start timer on first move
    if (!ipRunning) { ipRunning = true; startIPTimer(); }

    // Animate
    const tiles = document.getElementById('ip-board').children;
    const dr = row - eRow, dc = col - eCol;
    let animClass = '';
    if (dr === 1) animClass = 'anim-up';
    else if (dr === -1) animClass = 'anim-down';
    else if (dc === 1) animClass = 'anim-left';
    else animClass = 'anim-right';

    tiles[pos].classList.add(animClass);
    setTimeout(() => tiles[pos].classList.remove(animClass), 200);

    [ipTiles[pos], ipTiles[ipEmptyIdx]] = [ipTiles[ipEmptyIdx], ipTiles[pos]];
    ipEmptyIdx = pos;
    ipMoves++;
    document.getElementById('ip-moves').textContent = ipMoves;
    playSlide();

    renderIPBoard();

    if (ipCheckWin()) {
      stopIPTimer();
      ipRunning = false;
      setTimeout(showIPWin, 300);
    }
  }

  function ipCheckWin() {
    for (let i = 0; i < ipTiles.length; i++) {
      if (ipTiles[i] !== i) return false;
    }
    return true;
  }

  function startIPTimer() {
    ipTimerInterval = setInterval(() => {
      ipSeconds++;
      document.getElementById('ip-timer').textContent = formatTime(ipSeconds);
    }, 1000);
  }

  function stopIPTimer() {
    if (ipTimerInterval) { clearInterval(ipTimerInterval); ipTimerInterval = null; }
  }

  function showIPWin() {
    playWin();
    document.getElementById('ip-win-moves').textContent = ipMoves;
    document.getElementById('ip-win-time').textContent = formatTime(ipSeconds);
    document.getElementById('ip-win-overlay').classList.add('show');
  }

  function closeIPWin() {
    document.getElementById('ip-win-overlay').classList.remove('show');
    ipNewGame(true);
  }

  function showIPPreview() {
    const overlay = document.getElementById('ip-preview-overlay');
    const canvas = document.getElementById('ip-preview-canvas');
    if (ipImageEl) {
      const w = document.getElementById('ip-board-wrap').offsetWidth;
      canvas.width = w; canvas.height = w;
      canvas.getContext('2d').drawImage(ipImageEl, 0, 0, w, w);
    }
    overlay.classList.add('show');
  }

  function hideIPPreview() {
    document.getElementById('ip-preview-overlay').classList.remove('show');
  }

  // Keyboard support for image puzzle
  document.addEventListener('keydown', e => {
    if (document.getElementById('image-puzzle-view').classList.contains('hidden')) return;
    const eRow = Math.floor(ipEmptyIdx / ipSize), eCol = ipEmptyIdx % ipSize;
    let target = -1;
    if (e.key === 'ArrowUp'    && eRow < ipSize-1) target = ipEmptyIdx + ipSize;
    if (e.key === 'ArrowDown'  && eRow > 0)        target = ipEmptyIdx - ipSize;
    if (e.key === 'ArrowLeft'  && eCol < ipSize-1) target = ipEmptyIdx + 1;
    if (e.key === 'ArrowRight' && eCol > 0)        target = ipEmptyIdx - 1;
    if (target !== -1) { e.preventDefault(); ipClickTile(target); }
  });

  // ════════════════════════════════════════════════
  // ── HINT & AUTO-SOLVE — NUMBER PUZZLE ──
  // ════════════════════════════════════════════════

  // Manhattan distance heuristic
  function manhattan(arr, n) {
    let h = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v === 0) continue;
      const goal = v - 1; // goal index for tile v
      h += Math.abs(Math.floor(i / n) - Math.floor(goal / n)) +
           Math.abs((i % n) - (goal % n));
    }
    return h;
  }

  // IDA* solver — returns array of emptyIdx positions representing each swap step
  // Returns null if puzzle is already solved or can't solve quickly
  function idaStar(startTiles, n) {
    const goalStr = Array.from({length: n*n}, (_, i) => (i + 1) % (n * n)).join(',');
    const startStr = startTiles.join(',');
    if (startStr === goalStr) return [];

    // Cap: only use IDA* for small grids; larger grids use greedy
    if (n > 4) return null;

    const startEmpty = startTiles.indexOf(0);
    let bound = manhattan(startTiles, n);
    const path = [{ tiles: startTiles.slice(), empty: startEmpty }];

    function search(g, bound) {
      const node = path[path.length - 1];
      const f = g + manhattan(node.tiles, n);
      if (f > bound) return f;
      if (manhattan(node.tiles, n) === 0) return -1; // found

      let minT = Infinity;
      const row = Math.floor(node.empty / n), col = node.empty % n;
      const neighbors = [];
      if (row > 0) neighbors.push(node.empty - n);
      if (row < n - 1) neighbors.push(node.empty + n);
      if (col > 0) neighbors.push(node.empty - 1);
      if (col < n - 1) neighbors.push(node.empty + 1);

      for (const nb of neighbors) {
        // Avoid going back
        if (path.length > 1 && path[path.length - 2].empty === nb) continue;

        const newTiles = node.tiles.slice();
        [newTiles[node.empty], newTiles[nb]] = [newTiles[nb], newTiles[node.empty]];
        path.push({ tiles: newTiles, empty: nb });
        const t = search(g + 1, bound);
        if (t === -1) return -1;
        if (t < minT) minT = t;
        path.pop();

        // Safety: don't spend too long
        if (path.length > 200) return Infinity;
      }
      return minT;
    }

    for (let iter = 0; iter < 80; iter++) {
      const t = search(0, bound);
      if (t === -1) return path.map(s => s.empty);
      if (t === Infinity) return null;
      bound = t;
    }
    return null;
  }

  // Greedy BFS (beam search) for larger grids — returns partial or full move sequence
  function greedySolve(startTiles, n) {
    const goalStr = Array.from({length: n*n}, (_, i) => (i + 1) % (n * n)).join(',');
    let cur = startTiles.slice();
    let empty = cur.indexOf(0);
    const moves = [empty];
    const visited = new Set([cur.join(',')]);

    for (let step = 0; step < n * n * 60; step++) {
      if (cur.join(',') === goalStr) break;
      const row = Math.floor(empty / n), col = empty % n;
      const neighbors = [];
      if (row > 0) neighbors.push(empty - n);
      if (row < n - 1) neighbors.push(empty + n);
      if (col > 0) neighbors.push(empty - 1);
      if (col < n - 1) neighbors.push(empty + 1);

      // Pick neighbor that gives best heuristic
      let best = null, bestH = Infinity;
      for (const nb of neighbors) {
        const next = cur.slice();
        [next[empty], next[nb]] = [next[nb], next[empty]];
        const key = next.join(',');
        if (visited.has(key)) continue;
        const h = manhattan(next, n);
        if (h < bestH) { bestH = h; best = { nb, next, key }; }
      }
      if (!best) break;
      visited.add(best.key);
      cur = best.next;
      empty = best.nb;
      moves.push(empty);
    }
    return moves;
  }

  function showHint() {
    if (isSolved()) return;
    if (hintsUsed >= MAX_HINTS) return;
    _cancelAutoSolve();

    hintsUsed++;
    updateHintBtn();

    // Get best next move using IDA* (small) or greedy (large)
    let movePath = idaStar(tiles.slice(), size);
    if (!movePath) movePath = greedySolve(tiles.slice(), size);
    if (!movePath || movePath.length < 2) return;

    // movePath[0] is current emptyIdx; movePath[1] is next emptyIdx after the swap
    // The tile that moves is currently at movePath[1]
    const tileToMove = movePath[1];

    // Highlight that tile
    const boardEl = document.getElementById('board');
    const tileDivs = boardEl.children;
    if (tileDivs[tileToMove]) {
      tileDivs[tileToMove].classList.add('hint-highlight');
      clearTimeout(hintTimeout);
      hintTimeout = setTimeout(() => {
        tileDivs[tileToMove] && tileDivs[tileToMove].classList.remove('hint-highlight');
      }, 1800);
    }
    playTone(440, 'sine', 0.15, 0.12);
  }

  function autoSolve() {
    if (isSolved()) return;
    _cancelAutoSolve();

    // Disable buttons during solve
    document.getElementById('solve-btn').disabled = true;
    document.getElementById('hint-btn').disabled = true;

    let movePath = idaStar(tiles.slice(), size);
    if (!movePath) movePath = greedySolve(tiles.slice(), size);
    if (!movePath || movePath.length < 2) {
      document.getElementById('solve-btn').disabled = false;
      document.getElementById('hint-btn').disabled = false;
      return;
    }
    // movePath is sequence of emptyIdx positions; each step swaps current empty with next
    solveMoves = movePath.slice(1); // next empty positions
    let step = 0;
    isSolving = true; // mark as auto-solve so best score is not saved

    // Pause the timer during auto-solve and restore it after
    stopTimer();

    solveInterval = setInterval(() => {
      if (step >= solveMoves.length || isSolved()) {
        _cancelAutoSolve(true);
        isSolving = false;
        return;
      }
      const nextEmpty = solveMoves[step++];
      // nextEmpty is where empty will go; the tile currently there moves to current empty
      clickTile(nextEmpty);
    }, 1000); // 1 second gap between each move
  }

  function _cancelAutoSolve(f) { cancelAutoSolve(f); }

  // ════════════════════════════════════════════════
  // ── HINT & AUTO-SOLVE — IMAGE PUZZLE ──
  // ════════════════════════════════════════════════

  function ipManhattan(arr, n) {
    const blankVal = n * n - 1;
    let h = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v === blankVal) continue;
      h += Math.abs(Math.floor(i / n) - Math.floor(v / n)) +
           Math.abs((i % n) - (v % n));
    }
    return h;
  }

  function ipGreedySolve(startTiles, n) {
    const blankVal = n * n - 1;
    let cur = startTiles.slice();
    let empty = cur.indexOf(blankVal);
    const moves = [empty];
    const visited = new Set([cur.join(',')]);

    for (let step = 0; step < n * n * 60; step++) {
      // Check solved
      let solved = true;
      for (let i = 0; i < cur.length; i++) { if (cur[i] !== i) { solved = false; break; } }
      if (solved) break;

      const row = Math.floor(empty / n), col = empty % n;
      const neighbors = [];
      if (row > 0) neighbors.push(empty - n);
      if (row < n - 1) neighbors.push(empty + n);
      if (col > 0) neighbors.push(empty - 1);
      if (col < n - 1) neighbors.push(empty + 1);

      let best = null, bestH = Infinity;
      for (const nb of neighbors) {
        const next = cur.slice();
        [next[empty], next[nb]] = [next[nb], next[empty]];
        const key = next.join(',');
        if (visited.has(key)) continue;
        const h = ipManhattan(next, n);
        if (h < bestH) { bestH = h; best = { nb, next, key }; }
      }
      if (!best) break;
      visited.add(best.key);
      cur = best.next;
      empty = best.nb;
      moves.push(empty);
    }
    return moves;
  }

  function ipShowHint() {
    if (ipCheckWin()) return;
    if (ipHintsUsed >= MAX_HINTS) return;
    _cancelIPAutoSolve();

    ipHintsUsed++;
    updateIPHintBtn();

    const movePath = ipGreedySolve(ipTiles.slice(), ipSize);
    if (!movePath || movePath.length < 2) return;

    const tileToMove = movePath[1];
    const boardEl = document.getElementById('ip-board');
    const tileDivs = boardEl.children;
    if (tileDivs[tileToMove]) {
      tileDivs[tileToMove].classList.add('hint-highlight');
      clearTimeout(ipHintTimeout);
      ipHintTimeout = setTimeout(() => {
        tileDivs[tileToMove] && tileDivs[tileToMove].classList.remove('hint-highlight');
      }, 1800);
    }
    playTone(440, 'sine', 0.15, 0.12);
  }

  function ipAutoSolve() {
    if (ipCheckWin()) return;
    _cancelIPAutoSolve();

    document.getElementById('ip-solve-btn').disabled = true;
    document.getElementById('ip-hint-btn').disabled = true;

    const movePath = ipGreedySolve(ipTiles.slice(), ipSize);
    if (!movePath || movePath.length < 2) {
      _cancelIPAutoSolve();
      return;
    }

    const steps = movePath.slice(1);
    let step = 0;
    isIPSolving = true;

    // Pause timer during auto-solve
    stopIPTimer();

    ipSolveInterval = setInterval(() => {
      if (step >= steps.length || ipCheckWin()) {
        _cancelIPAutoSolve(true);
        isIPSolving = false;
        return;
      }
      ipClickTile(steps[step++]);
    }, 1000); // 1 second gap between each move
  }

  function _cancelIPAutoSolve(f) { cancelIPAutoSolve(f); }

  // Footer year
  document.querySelectorAll('.footer-year').forEach(el => {
    el.textContent = new Date().getFullYear();
  });