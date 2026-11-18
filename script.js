let video, canvas, ctx, detector;
let currentFacingMode = 'user';
let isSwitching = false;
let isRunning = false;

// ===== ESTADO DEL ENTRENAMIENTO (con métricas avanzadas) =====
const workoutState = {
  exercise: 'curl',
  targetSets: 3,
  targetReps: 10,
  currentSet: 1,
  currentRep: 0,
  stage: 'start',
  startTime: 0,
  totalFrames: 0,
  goodFrames: 0,
  lastWarningSoundTime: 0,
  smoothedKeypoints: null,

  // Tempo Training
  tempoTracker: {
    phaseStartTime: 0,
    currentPhase: 'idle',
    eccentricDuration: 0,
    pauseDuration: 0,
    concentricDuration: 0,
    lastPhaseChange: 0
  },

  // Time Under Tension
  tut: 0,
  lastFrameTime: 0,
  isUnderTension: false,

  // Velocidad y fatiga
  velocityTracker: {
    positions: [],
    currentVelocity: 0,
    peakVelocity: 0,
    velocityLossPercent: 0,
    fatigueDetected: false
  },

  // Simetría bilateral
  symmetryTracker: {
    leftAngles: [],
    rightAngles: [],
    leftROM: 0,
    rightROM: 0,
    imbalancePercent: 0
  },

  // Rango de movimiento
  romTracker: {
    minAngle: 999,
    maxAngle: 0,
    fullROMAchieved: false,
    repROMs: []
  }
};

// Base de datos de ejercicios
const exercisesDB = [
  { id: 'curl', name: 'Curl de Bíceps', icon: '💪', category: 'upper' },
  { id: 'squat', name: 'Sentadilla', icon: '🦵', category: 'lower' },
  { id: 'pushup', name: 'Flexiones', icon: '💪', category: 'upper' },
  { id: 'bench_press', name: 'Press de Banca', icon: '🏋️', category: 'upper' },
  { id: 'incline_press', name: 'Press Inclinado', icon: '📐', category: 'upper' },
  { id: 'lat_pulldown', name: 'Jalón al Pecho', icon: '⬇️', category: 'upper' },
  { id: 'seated_row', name: 'Remo en V', icon: '🚣', category: 'upper' }
];

// 🆕 Mapeo: dónde va el panel según ejercicio (para no tapar zonas críticas)
const exercisePanelPosition = {
  curl: 'bottom',
  squat: 'top',        // piernas abajo → panel arriba
  pushup: 'top',
  bench_press: 'top',
  incline_press: 'top',
  lat_pulldown: 'bottom',
  seated_row: 'bottom'
};

// 🆕 Mapeo: qué métrica mostrar como "principal" según ejercicio
const exercisePrimaryMetric = {
  curl: { label: 'Tempo', id: 'metric-tempo' },
  squat: { label: 'ROM', id: 'metric-rom' },
  pushup: { label: 'Alineación', id: 'metric-alignment' },
  bench_press: { label: 'Ángulo', id: 'metric-angle' },
  incline_press: { label: 'Ángulo', id: 'metric-angle' },
  lat_pulldown: { label: 'Tempo', id: 'metric-tempo' },
  seated_row: { label: 'Tempo', id: 'metric-tempo' }
};

// Referencias DOM
const setupScreen = document.getElementById('setup-screen');
const workoutScreen = document.getElementById('workout-screen');
const overlaySetText = document.getElementById('overlay-set-text');
const overlayRepText = document.getElementById('overlay-rep-text');
const controlsBottom = document.getElementById('controls-bottom');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');
const alertBorder = document.getElementById('posture-alert-border');

// ===== SISTEMA DE AUDIO Y VIBRACIÓN =====
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, type, duration) {
  if (!document.getElementById('toggle-sound').checked) return;
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

function triggerSuccessFeedback() {
  playTone(880, 'sine', 0.18);
  if (document.getElementById('toggle-vibrate').checked && navigator.vibrate) {
    navigator.vibrate(80);
  }
}

function triggerErrorFeedback() {
  const now = Date.now();
  if (now - workoutState.lastWarningSoundTime > 1800) {
    playTone(220, 'sawtooth', 0.25);
    if (document.getElementById('toggle-vibrate').checked && navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
    workoutState.lastWarningSoundTime = now;
  }
}

// ===== CÁMARA Y MODELO IA =====
async function setupCamera() {
  video = document.getElementById('video');
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode, width: { ideal: 640 }, height: { ideal: 480 } }
    });
    video.srcObject = stream;
    return new Promise((resolve) => {
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        resolve();
      };
    });
  } catch (error) {
    console.error('Error cámara:', error);
    throw error;
  }
}

async function loadModel() {
  if (!detector) {
    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
  }
}

function runCountdown() {
  return new Promise((resolve) => {
    let count = 3;
    countdownOverlay.style.display = 'flex';
    function showNumber() {
      if (count > 0) {
        playTone(440, 'sine', 0.12);
        countdownNumber.textContent = count;
        countdownNumber.className = 'countdown-number show';
        setTimeout(() => countdownNumber.classList.add('fade'), 700);
        setTimeout(() => { count--; showNumber(); }, 1000);
      } else {
        playTone(880, 'sine', 0.3);
        countdownNumber.textContent = '¡YA!';
        countdownNumber.className = 'countdown-number show go';
        setTimeout(() => countdownNumber.classList.add('fade'), 600);
        setTimeout(() => {
          countdownOverlay.style.display = 'none';
          resolve();
        }, 900);
      }
    }
    showNumber();
  });
}

// ===== MATEMÁTICA Y SUAVIZADO =====
function calculateAngle(a, b, c) {
  if (!a || !b || !c) return 0;
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs(radians * 180 / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

function distance(a, b) {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

function smoothKeypoints(rawKeypoints) {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const maxX = Math.max(...rawKeypoints.map(kp => kp.x));
  const maxY = Math.max(...rawKeypoints.map(kp => kp.y));
  const scaled = rawKeypoints.map(kp => {
    let x = kp.x, y = kp.y;
    if (maxX <= 1.5 && maxY <= 1.5) {
      x = kp.x * videoWidth;
      y = kp.y * videoHeight;
    } else if (maxX <= 300 && maxY <= 300) {
      x = (kp.x / 256) * videoWidth;
      y = (kp.y / 256) * videoHeight;
    }
    return { name: kp.name, x, y, score: kp.score };
  });

  if (!workoutState.smoothedKeypoints) {
    workoutState.smoothedKeypoints = scaled;
    return scaled;
  }

  const alpha = 0.55;
  workoutState.smoothedKeypoints = scaled.map((kp, idx) => {
    const prev = workoutState.smoothedKeypoints[idx];
    return {
      name: kp.name,
      x: alpha * kp.x + (1 - alpha) * prev.x,
      y: alpha * kp.y + (1 - alpha) * prev.y,
      score: kp.score
    };
  });
  return workoutState.smoothedKeypoints;
}

function drawSkeleton(keypoints, badParts) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const greenColor = '#00ff88';
  const redColor = '#ff4444';
  const connections = [
    ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'], ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'], ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'], ['right_knee', 'right_ankle']
  ];

  connections.forEach(([start, end]) => {
    const kp1 = keypoints.find(kp => kp.name === start);
    const kp2 = keypoints.find(kp => kp.name === end);
    if (kp1 && kp2 && kp1.score > 0.3 && kp2.score > 0.3) {
      const isBad = badParts.includes(start) || badParts.includes(end);
      ctx.strokeStyle = isBad ? redColor : greenColor;
      ctx.lineWidth = isBad ? 6 : 3.5;
      ctx.beginPath();
      ctx.moveTo(kp1.x, kp1.y);
      ctx.lineTo(kp2.x, kp2.y);
      ctx.stroke();
    }
  });

  keypoints.forEach(kp => {
    if (kp.score > 0.3) {
      const isBad = badParts.includes(kp.name);
      ctx.fillStyle = isBad ? redColor : greenColor;
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, isBad ? 10 : 6, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
}

// ===== EVALUADORES BIOMECÁNICOS =====
function getBestSide(keypoints, joints) {
  const leftScore = joints.reduce((acc, j) => {
    const kp = keypoints.find(k => k.name === 'left_' + j);
    return acc + (kp ? kp.score : 0);
  }, 0);
  const rightScore = joints.reduce((acc, j) => {
    const kp = keypoints.find(k => k.name === 'right_' + j);
    return acc + (kp ? kp.score : 0);
  }, 0);
  return leftScore >= rightScore ? 'left' : 'right';
}

// 🆕 Registrar rep con validación de ROM
function registerRepCompleted(feedbackEl, fullROM = true, currentROM = 0) {
  if (!fullROM) {
    feedbackEl.textContent = `⚠️ Rep incompleta (${Math.round(currentROM)}°). Rango insuficiente`;
    feedbackEl.style.color = '#ffd43b';
    return;
  }

  workoutState.currentRep++;
  workoutState.romTracker.repROMs.push(currentROM);
  triggerSuccessFeedback();
  updateHUD();
  updateMetricsPanel();

  if (workoutState.currentRep === workoutState.targetReps) {
    feedbackEl.textContent = `🎉 ¡Serie ${workoutState.currentSet} completada!`;
    feedbackEl.style.color = '#00ff88';
    showNextSetButton();
  } else if (workoutState.currentRep > workoutState.targetReps) {
    feedbackEl.textContent = `🔥 ¡Extra! Llevas ${workoutState.currentRep} reps`;
    feedbackEl.style.color = '#00ff88';
  } else {
    feedbackEl.textContent = `✅ ¡Bien! Rep ${workoutState.currentRep}/${workoutState.targetReps}`;
    feedbackEl.style.color = '#00ff88';
  }
}

// 🆕 Actualizar tempo
function updateTempo(angle, isDescending, now) {
  const tt = workoutState.tempoTracker;

  if (isDescending && tt.currentPhase !== 'eccentric') {
    if (tt.currentPhase === 'concentric' || tt.currentPhase === 'idle') {
      tt.eccentricDuration = 0;
    }
    tt.currentPhase = 'eccentric';
    tt.lastPhaseChange = now;
  } else if (!isDescending && tt.currentPhase === 'eccentric') {
    tt.currentPhase = 'pause';
    tt.lastPhaseChange = now;
  } else if (!isDescending && tt.currentPhase === 'pause' && (now - tt.lastPhaseChange) > 150) {
    tt.currentPhase = 'concentric';
    tt.lastPhaseChange = now;
  }

  const phaseDuration = now - tt.lastPhaseChange;
  if (tt.currentPhase === 'eccentric') tt.eccentricDuration = phaseDuration;
  else if (tt.currentPhase === 'concentric') tt.concentricDuration = phaseDuration;
}

// 🆕 Actualizar velocidad y detectar fatiga
function updateVelocity(keyPosition, now) {
  const vt = workoutState.velocityTracker;
  vt.positions.push({ x: keyPosition.x, y: keyPosition.y, t: now });

  if (vt.positions.length > 10) vt.positions.shift();

  if (vt.positions.length >= 2) {
    const last = vt.positions[vt.positions.length - 1];
    const prev = vt.positions[vt.positions.length - 2];
    const dt = (last.t - prev.t) || 1;
    const dist = Math.sqrt(Math.pow(last.x - prev.x, 2) + Math.pow(last.y - prev.y, 2));
    vt.currentVelocity = dist / dt;

    if (vt.currentVelocity > vt.peakVelocity) {
      vt.peakVelocity = vt.currentVelocity;
    }

    if (vt.peakVelocity > 0) {
      vt.velocityLossPercent = Math.round(((vt.peakVelocity - vt.currentVelocity) / vt.peakVelocity) * 100);
      vt.fatigueDetected = vt.velocityLossPercent > 40 && workoutState.currentRep >= 3;
    }
  }
}

// 🆕 Actualizar simetría bilateral
function updateSymmetry(leftAngle, rightAngle) {
  const st = workoutState.symmetryTracker;
  if (leftAngle > 0) st.leftAngles.push(leftAngle);
  if (rightAngle > 0) st.rightAngles.push(rightAngle);

  if (st.leftAngles.length > 0) {
    st.leftROM = Math.max(...st.leftAngles) - Math.min(...st.leftAngles);
  }
  if (st.rightAngles.length > 0) {
    st.rightROM = Math.max(...st.rightAngles) - Math.min(...st.rightAngles);
  }

  if (st.leftROM > 0 && st.rightROM > 0) {
    const maxROM = Math.max(st.leftROM, st.rightROM);
    const diff = Math.abs(st.leftROM - st.rightROM);
    st.imbalancePercent = Math.round((diff / maxROM) * 100);
  }
}

// 🆕 Actualizar panel de métricas
function updateMetricsPanel() {
  const tt = workoutState.tempoTracker;
  const vt = workoutState.velocityTracker;
  const st = workoutState.symmetryTracker;

  const tempoEl = document.getElementById('metric-tempo');
  if (tempoEl) {
    const ecc = (tt.eccentricDuration / 1000).toFixed(1);
    const con = (tt.concentricDuration / 1000).toFixed(1);
    tempoEl.textContent = `${ecc}s ↓ / ${con}s ↑`;
  }

  const tutEl = document.getElementById('metric-tut');
  if (tutEl) tutEl.textContent = `${(workoutState.tut / 1000).toFixed(1)}s`;

  const fatigueEl = document.getElementById('metric-fatigue');
  if (fatigueEl) {
    fatigueEl.textContent = `${vt.velocityLossPercent}%`;
    fatigueEl.style.color = vt.fatigueDetected ? '#ff4444' : '#00ff88';
  }

  const symEl = document.getElementById('metric-symmetry');
  if (symEl) {
    symEl.textContent = st.imbalancePercent > 0 ? `${st.imbalancePercent}%` : '—';
    symEl.style.color = st.imbalancePercent > 15 ? '#ffd43b' : '#00ff88';
  }

  updatePrimaryMetric();
}

// 🆕 Actualizar métrica principal
function updatePrimaryMetric() {
  const primary = exercisePrimaryMetric[workoutState.exercise];
  if (!primary) return;

  const valueEl = document.getElementById('primary-metric-value');
  if (!valueEl) return;

  switch (primary.id) {
    case 'metric-tempo': {
      const tt = workoutState.tempoTracker;
      const ecc = (tt.eccentricDuration / 1000).toFixed(1);
      const con = (tt.concentricDuration / 1000).toFixed(1);
      valueEl.textContent = `${ecc}↓/${con}↑`;
      break;
    }
    case 'metric-rom': {
      const rom = workoutState.romTracker.maxAngle - workoutState.romTracker.minAngle;
      valueEl.textContent = rom > 0 ? `${Math.round(rom)}°` : '—';
      break;
    }
    case 'metric-angle':
    case 'metric-alignment':
      valueEl.textContent = '—';
      break;
  }
}

// 🆕 Actualizar indicador de estado (semáforo)
function updateStatusIndicator(status, text) {
  const indicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  if (!indicator || !statusText) return;

  indicator.classList.remove('warning', 'error');
  if (status === 'error') {
    indicator.classList.add('error');
    statusText.textContent = text || 'ERROR';
  } else if (status === 'warning') {
    indicator.classList.add('warning');
    statusText.textContent = text || 'ATENCIÓN';
  } else {
    statusText.textContent = text || 'OK';
  }
}

// 🆕 Configurar panel según ejercicio
function configureMetricsPanel() {
  const panel = document.getElementById('metrics-panel');
  if (!panel) return;

  const position = exercisePanelPosition[workoutState.exercise] || 'bottom';
  panel.setAttribute('data-position', position);

  const primary = exercisePrimaryMetric[workoutState.exercise] || { label: 'Tempo', id: 'metric-tempo' };
  const primaryLabel = document.getElementById('primary-metric-label');
  if (primaryLabel) primaryLabel.textContent = primary.label;

  panel.classList.add('collapsed');
  resetMetricsAutoHide();
}

// 🆕 Toggle expandir/colapsar
function toggleMetricsPanel() {
  const panel = document.getElementById('metrics-panel');
  if (!panel) return;
  panel.classList.toggle('collapsed');
  resetMetricsAutoHide();
}

// 🆕 Mostrar panel
function showMetricsPanel() {
  const panel = document.getElementById('metrics-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  resetMetricsAutoHide();
}

// 🆕 Auto-hide después de 6s
let metricsAutoHideTimer = null;
function resetMetricsAutoHide() {
  if (metricsAutoHideTimer) clearTimeout(metricsAutoHideTimer);
  metricsAutoHideTimer = setTimeout(() => {
    const panel = document.getElementById('metrics-panel');
    if (panel && panel.classList.contains('collapsed')) {
      panel.classList.add('hidden');
    }
  }, 6000);
}

// ===== CURL DE BÍCEPS MEJORADO =====
function evaluateCurl(keypoints, feedback, now) {
  let badParts = [];
  let warning = '';

  // Detectar balanceo del torso
  const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
  const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');
  const leftHip = keypoints.find(k => k.name === 'left_hip');
  const rightHip = keypoints.find(k => k.name === 'right_hip');

  if (leftShoulder && rightShoulder && leftHip && rightHip &&
      leftShoulder.score > 0.3 && rightShoulder.score > 0.3 &&
      leftHip.score > 0.3 && rightHip.score > 0.3) {

    const shoulderCenter = {
      x: (leftShoulder.x + rightShoulder.x) / 2,
      y: (leftShoulder.y + rightShoulder.y) / 2
    };
    const hipCenter = {
      x: (leftHip.x + rightHip.x) / 2,
      y: (leftHip.y + rightHip.y) / 2
    };

    const torsoSway = Math.abs(shoulderCenter.x - hipCenter.x);
    const shoulderWidth = distance(leftShoulder, rightShoulder);

    if (torsoSway > shoulderWidth * 0.15) {
      badParts.push('left_shoulder', 'right_shoulder', 'left_hip', 'right_hip');
      warning = '❌ No balancees el torso, aislá el bíceps';
    }
  }

  const side = getBestSide(keypoints, ['shoulder', 'elbow', 'wrist']);
  const s = keypoints.find(k => k.name === side + '_shoulder');
  const e = keypoints.find(k => k.name === side + '_elbow');
  const w = keypoints.find(k => k.name === side + '_wrist');
  const otherS = keypoints.find(k => k.name === (side === 'left' ? 'right_shoulder' : 'left_shoulder'));

  if (s && e && w && s.score > 0.3 && e.score > 0.3 && w.score > 0.3) {
    const shoulderWidth = (otherS && otherS.score > 0.3) ? distance(s, otherS) : 80;
    if (Math.abs(e.x - s.x) > shoulderWidth * 0.28) {
      badParts.push(side + '_shoulder', side + '_elbow', side + '_wrist');
      warning = warning || '❌ No adelantes los codos';
    }

    const angle = calculateAngle(s, e, w);

    if (angle < workoutState.romTracker.minAngle) workoutState.romTracker.minAngle = angle;
    if (angle > workoutState.romTracker.maxAngle) workoutState.romTracker.maxAngle = angle;

    const isDescending = angle > 100;
    updateTempo(angle, isDescending, now);
    updateVelocity(w, now);

    // Simetría
    const leftAngle = keypoints.find(k => k.name === 'left_elbow') ?
      calculateAngle(
        keypoints.find(k => k.name === 'left_shoulder'),
        keypoints.find(k => k.name === 'left_elbow'),
        keypoints.find(k => k.name === 'left_wrist')
      ) : 0;
    const rightAngle = keypoints.find(k => k.name === 'right_elbow') ?
      calculateAngle(
        keypoints.find(k => k.name === 'right_shoulder'),
        keypoints.find(k => k.name === 'right_elbow'),
        keypoints.find(k => k.name === 'right_wrist')
      ) : 0;
    updateSymmetry(leftAngle, rightAngle);

    if (angle > 155) {
      workoutState.stage = 'down';
      workoutState.romTracker.fullROMAchieved = true;
      if (!warning) {
        feedback.textContent = 'Brazos extendidos. ¡Subí!';
        feedback.style.color = '#ffd43b';
      }
    } else if (angle < 45 && workoutState.stage === 'down') {
      workoutState.stage = 'up';
      const currentROM = workoutState.romTracker.maxAngle - workoutState.romTracker.minAngle;
      registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved, currentROM);
      workoutState.romTracker.minAngle = 999;
      workoutState.romTracker.maxAngle = 0;
      workoutState.romTracker.fullROMAchieved = false;
    } else if (!warning && workoutState.stage === 'down') {
      feedback.textContent = `Subiendo... ${Math.round(angle)}°`;
      feedback.style.color = '#ffd43b';
    }
  }

  return { badParts, warning };
}

// ===== SENTADILLA MEJORADA =====
function evaluateSquat(keypoints, feedback, now) {
  let badParts = [];
  let warning = '';

  const side = getBestSide(keypoints, ['shoulder', 'hip', 'knee', 'ankle']);
  const shoulder = keypoints.find(k => k.name === side + '_shoulder');
  const hip = keypoints.find(k => k.name === side + '_hip');
  const knee = keypoints.find(k => k.name === side + '_knee');
  const ankle = keypoints.find(k => k.name === side + '_ankle');

  // Valgo de rodilla
  const leftKnee = keypoints.find(k => k.name === 'left_knee');
  const rightKnee = keypoints.find(k => k.name === 'right_knee');
  const leftAnkle = keypoints.find(k => k.name === 'left_ankle');
  const rightAnkle = keypoints.find(k => k.name === 'right_ankle');

  if (leftKnee && rightKnee && leftAnkle && rightAnkle &&
      leftKnee.score > 0.3 && rightKnee.score > 0.3 &&
      leftAnkle.score > 0.3 && rightAnkle.score > 0.3) {

    const kneeDistance = Math.abs(leftKnee.x - rightKnee.x);
    const ankleDistance = Math.abs(leftAnkle.x - rightAnkle.x);
    const valgusRatio = ankleDistance > 0 ? kneeDistance / ankleDistance : 1;

    const kneeAngle = calculateAngle(hip, knee, ankle);

    if (kneeAngle < 110 && valgusRatio < 0.7) {
      badParts.push('left_knee', 'right_knee');
      warning = '❌ Rodillas hacia adentro (valgo): empujalas afuera';
    }
  }

  if (hip && knee && ankle && hip.score > 0.3 && knee.score > 0.3 && ankle.score > 0.3) {
    const kneeAngle = calculateAngle(hip, knee, ankle);

    if (shoulder && shoulder.score > 0.3) {
      const torsoAngle = calculateAngle(shoulder, hip, { x: hip.x, y: hip.y - 100 });
      if (torsoAngle > 48) {
        badParts.push(side + '_shoulder', side + '_hip');
        warning = warning || '❌ Mantené el pecho erguido';
      }
    }

    // Butt wink
    if (hip.y > knee.y && kneeAngle < 95) {
      badParts.push(side + '_hip');
      warning = warning || '⚠️ Redondeo lumbar: no bajes más';
    }

    if (kneeAngle < workoutState.romTracker.minAngle) workoutState.romTracker.minAngle = kneeAngle;
    if (kneeAngle > workoutState.romTracker.maxAngle) workoutState.romTracker.maxAngle = kneeAngle;

    const isDescending = kneeAngle < 140;
    updateTempo(kneeAngle, isDescending, now);
    updateVelocity(hip, now);

    // Simetría
    const leftKneeAngle = (leftKnee && keypoints.find(k => k.name === 'left_hip') && leftAnkle) ?
      calculateAngle(keypoints.find(k => k.name === 'left_hip'), leftKnee, leftAnkle) : 0;
    const rightKneeAngle = (rightKnee && keypoints.find(k => k.name === 'right_hip') && rightAnkle) ?
      calculateAngle(keypoints.find(k => k.name === 'right_hip'), rightKnee, rightAnkle) : 0;
    updateSymmetry(leftKneeAngle, rightKneeAngle);

    if (kneeAngle > 155) {
      if (workoutState.stage === 'down') {
        workoutState.stage = 'up';
        const currentROM = workoutState.romTracker.maxAngle - workoutState.romTracker.minAngle;
        registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved, currentROM);
        workoutState.romTracker.minAngle = 999;
        workoutState.romTracker.maxAngle = 0;
        workoutState.romTracker.fullROMAchieved = false;
      } else if (!warning) {
        feedback.textContent = 'De pie. ¡Bajá a 90°!';
        feedback.style.color = '#ffd43b';
      }
    } else if (kneeAngle < 100) {
      workoutState.stage = 'down';
      workoutState.romTracker.fullROMAchieved = true;
      if (!warning) {
        feedback.textContent = '✅ ¡Buena profundidad! Subí';
        feedback.style.color = '#00ff88';
      }
    } else if (!warning) {
      feedback.textContent = `Bajando... Rodilla: ${Math.round(kneeAngle)}°`;
      feedback.style.color = '#ffd43b';
    }
  }

  return { badParts, warning };
}

// ===== FLEXIONES MEJORADAS =====
function evaluatePushup(keypoints, feedback, now) {
  let badParts = [];
  let warning = '';

  const side = getBestSide(keypoints, ['shoulder', 'hip', 'ankle']);
  const shoulder = keypoints.find(k => k.name === side + '_shoulder');
  const hip = keypoints.find(k => k.name === side + '_hip');
  const ankle = keypoints.find(k => k.name === side + '_ankle');
  const elbow = keypoints.find(k => k.name === side + '_elbow');
  const wrist = keypoints.find(k => k.name === side + '_wrist');

  // Alineación hombro-cadera-tobillo
  if (shoulder && hip && ankle &&
      shoulder.score > 0.3 && hip.score > 0.3 && ankle.score > 0.3) {

    const bodyAlignment = calculateAngle(shoulder, hip, ankle);

    if (bodyAlignment > 195) {
      badParts.push(side + '_hip');
      warning = '❌ Cadera muy alta: mantené línea recta';
    } else if (bodyAlignment < 165) {
      badParts.push(side + '_hip');
      warning = warning || '❌ Cadera caída: activá el core';
    }
  }

  if (shoulder && elbow && wrist &&
      shoulder.score > 0.3 && elbow.score > 0.3 && wrist.score > 0.3) {

    const elbowAngle = calculateAngle(shoulder, elbow, wrist);

    if (Math.abs(elbow.y - shoulder.y) < 15 && elbowAngle < 120) {
      badParts.push(side + '_shoulder', side + '_elbow', side + '_wrist');
      warning = warning || '❌ Codos muy abiertos (usá 45°)';
    }

    if (elbowAngle < workoutState.romTracker.minAngle) workoutState.romTracker.minAngle = elbowAngle;
    if (elbowAngle > workoutState.romTracker.maxAngle) workoutState.romTracker.maxAngle = elbowAngle;

    const isDescending = elbowAngle > 110;
    updateTempo(elbowAngle, isDescending, now);
    updateVelocity(shoulder, now);

    if (elbowAngle > 155) {
      if (workoutState.stage === 'down') {
        workoutState.stage = 'up';
        const currentROM = workoutState.romTracker.maxAngle - workoutState.romTracker.minAngle;
        registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved, currentROM);
        workoutState.romTracker.minAngle = 999;
        workoutState.romTracker.maxAngle = 0;
        workoutState.romTracker.fullROMAchieved = false;
      } else if (!warning) {
        feedback.textContent = 'Brazos firmes. ¡Bajá el pecho!';
        feedback.style.color = '#ffd43b';
      }
    } else if (elbowAngle < 85) {
      workoutState.stage = 'down';
      workoutState.romTracker.fullROMAchieved = true;
      if (!warning) {
        feedback.textContent = '✅ ¡Buen rango! Empujá';
        feedback.style.color = '#00ff88';
      }
    } else if (!warning) {
      feedback.textContent = `Ángulo codo: ${Math.round(elbowAngle)}°`;
      feedback.style.color = '#ffd43b';
    }
  }

  return { badParts, warning };
}

// ===== PRESS DE BANCA (SEPARADO) =====
function evaluateBenchPress(keypoints, feedback, now) {
  let badParts = [];
  let warning = '';

  const side = getBestSide(keypoints, ['shoulder', 'elbow', 'wrist']);
  const shoulder = keypoints.find(k => k.name === side + '_shoulder');
  const elbow = keypoints.find(k => k.name === side + '_elbow');
  const wrist = keypoints.find(k => k.name === side + '_wrist');
  const hip = keypoints.find(k => k.name === side + '_hip');

  if (shoulder && elbow && wrist &&
      shoulder.score > 0.3 && elbow.score > 0.3 && wrist.score > 0.3) {

    const elbowAngle = calculateAngle(shoulder, elbow, wrist);

    if (hip && hip.score > 0.3) {
      const armTorsoAngle = calculateAngle(hip, shoulder, elbow);
      if (armTorsoAngle > 85) {
        badParts.push(side + '_shoulder', side + '_elbow');
        warning = '❌ Codos a 90°: bajalos a 45° (protege tus hombros)';
      }
    }

    if (elbowAngle < workoutState.romTracker.minAngle) workoutState.romTracker.minAngle = elbowAngle;
    if (elbowAngle > workoutState.romTracker.maxAngle) workoutState.romTracker.maxAngle = elbowAngle;

    const isDescending = elbowAngle > 110;
    updateTempo(elbowAngle, isDescending, now);
    updateVelocity(wrist, now);

    if (elbowAngle > 155) {
      if (workoutState.stage === 'down') {
        workoutState.stage = 'up';
        const currentROM = workoutState.romTracker.maxAngle - workoutState.romTracker.minAngle;
        registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved, currentROM);
        workoutState.romTracker.minAngle = 999;
        workoutState.romTracker.maxAngle = 0;
        workoutState.romTracker.fullROMAchieved = false;
      } else if (!warning) {
        feedback.textContent = 'Brazos extendidos. ¡Bajá!';
        feedback.style.color = '#ffd43b';
      }
    } else if (elbowAngle < 75) {
      workoutState.stage = 'down';
      workoutState.romTracker.fullROMAchieved = true;
      if (!warning) {
        feedback.textContent = '✅ ¡Buen rango! Empujá';
        feedback.style.color = '#00ff88';
      }
    } else if (!warning) {
      feedback.textContent = `Ángulo codo: ${Math.round(elbowAngle)}°`;
      feedback.style.color = '#ffd43b';
    }
  }

  return { badParts, warning };
}

// ===== JALÓN AL PECHO MEJORADO =====
function evaluateLatPulldown(keypoints, feedback, now) {
  let badParts = [];
  let warning = '';

  const side = getBestSide(keypoints, ['shoulder', 'elbow', 'wrist']);
  const shoulder = keypoints.find(k => k.name === side + '_shoulder');
  const elbow = keypoints.find(k => k.name === side + '_elbow');
  const wrist = keypoints.find(k => k.name === side + '_wrist');
  const hip = keypoints.find(k => k.name === side + '_hip');
  const nose = keypoints.find(k => k.name === 'nose');

  if (shoulder && elbow && wrist &&
      shoulder.score > 0.3 && elbow.score > 0.3 && wrist.score > 0.3) {

    const elbowAngle = calculateAngle(shoulder, elbow, wrist);

    if (nose && nose.score > 0.3 && hip && hip.score > 0.3) {
      const torsoLeanBack = calculateAngle(nose, shoulder, hip);

      if (wrist.y < nose.y && torsoLeanBack > 20) {
        badParts.push(side + '_wrist');
        warning = '❌ No lo lleves detrás del cuello: lesiona el hombro';
      }

      if (torsoLeanBack > 25) {
        badParts.push(side + '_shoulder', side + '_hip');
        warning = warning || '❌ Menos peso: no te arquees hacia atrás';
      }
    }

    if (elbowAngle < workoutState.romTracker.minAngle) workoutState.romTracker.minAngle = elbowAngle;
    if (elbowAngle > workoutState.romTracker.maxAngle) workoutState.romTracker.maxAngle = elbowAngle;

    const isDescending = elbowAngle > 110;
    updateTempo(elbowAngle, isDescending, now);
    updateVelocity(wrist, now);

    if (elbowAngle > 150) {
      workoutState.stage = 'extended';
      workoutState.romTracker.fullROMAchieved = true;
      if (!warning) {
        feedback.textContent = 'Brazos estirados. ¡Tirá!';
        feedback.style.color = '#ffd43b';
      }
    } else if (elbowAngle < 75 && workoutState.stage === 'extended') {
      workoutState.stage = 'contracted';
      const currentROM = workoutState.romTracker.maxAngle - workoutState.romTracker.minAngle;
      registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved, currentROM);
      workoutState.romTracker.minAngle = 999;
      workoutState.romTracker.maxAngle = 0;
      workoutState.romTracker.fullROMAchieved = false;
    } else if (!warning) {
      feedback.textContent = `Recorrido codo: ${Math.round(elbowAngle)}°`;
      feedback.style.color = '#ffd43b';
    }
  }

  return { badParts, warning };
}

// ===== REMO EN V MEJORADO =====
function evaluateSeatedRow(keypoints, feedback, now) {
  let badParts = [];
  let warning = '';

  const side = getBestSide(keypoints, ['shoulder', 'elbow', 'wrist']);
  const shoulder = keypoints.find(k => k.name === side + '_shoulder');
  const elbow = keypoints.find(k => k.name === side + '_elbow');
  const wrist = keypoints.find(k => k.name === side + '_wrist');
  const hip = keypoints.find(k => k.name === side + '_hip');

  if (shoulder && elbow && wrist && hip &&
      shoulder.score > 0.3 && elbow.score > 0.3 && wrist.score > 0.3 && hip.score > 0.3) {

    const elbowAngle = calculateAngle(shoulder, elbow, wrist);
    const torsoLeanBack = calculateAngle(hip, shoulder, { x: shoulder.x, y: shoulder.y - 100 });

    if (torsoLeanBack > 20 && elbowAngle < 120) {
      badParts.push(side + '_shoulder', side + '_hip');
      warning = '❌ No uses el torso: tirá con la espalda';
    }

    if (elbowAngle < workoutState.romTracker.minAngle) workoutState.romTracker.minAngle = elbowAngle;
    if (elbowAngle > workoutState.romTracker.maxAngle) workoutState.romTracker.maxAngle = elbowAngle;

    const isDescending = elbowAngle > 110;
    updateTempo(elbowAngle, isDescending, now);
    updateVelocity(wrist, now);

    if (elbowAngle > 150) {
      workoutState.stage = 'extended';
      workoutState.romTracker.fullROMAchieved = true;
      if (!warning) {
        feedback.textContent = 'Brazos estirados. ¡Tirá!';
        feedback.style.color = '#ffd43b';
      }
    } else if (elbowAngle < 75 && workoutState.stage === 'extended') {
      workoutState.stage = 'contracted';
      const currentROM = workoutState.romTracker.maxAngle - workoutState.romTracker.minAngle;
      registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved, currentROM);
      workoutState.romTracker.minAngle = 999;
      workoutState.romTracker.maxAngle = 0;
      workoutState.romTracker.fullROMAchieved = false;
    } else if (!warning) {
      feedback.textContent = `Recorrido codo: ${Math.round(elbowAngle)}°`;
      feedback.style.color = '#ffd43b';
    }
  }

  return { badParts, warning };
}

// ===== BUCLE PRINCIPAL =====
async function detectPose() {
  if (isRunning) return;
  isRunning = true;
  const feedback = document.getElementById('feedback');
  workoutState.lastFrameTime = Date.now();

  while (isRunning) {
    if (isSwitching) {
      await new Promise(r => setTimeout(r, 100));
      continue;
    }

    try {
      if (detector && video.srcObject && video.readyState === 4) {
        const poses = await detector.estimatePoses(video);
        if (poses.length > 0) {
          const keypoints = smoothKeypoints(poses[0].keypoints);
          const now = Date.now();
          let result = { badParts: [], warning: '' };

          switch (workoutState.exercise) {
            case 'curl':
              result = evaluateCurl(keypoints, feedback, now);
              break;
            case 'squat':
              result = evaluateSquat(keypoints, feedback, now);
              break;
            case 'pushup':
              result = evaluatePushup(keypoints, feedback, now);
              break;
            case 'bench_press':
            case 'incline_press':
              result = evaluateBenchPress(keypoints, feedback, now);
              break;
            case 'lat_pulldown':
              result = evaluateLatPulldown(keypoints, feedback, now);
              break;
            case 'seated_row':
              result = evaluateSeatedRow(keypoints, feedback, now);
              break;
          }

          // Actualizar TUT
          const deltaTime = now - workoutState.lastFrameTime;
          workoutState.lastFrameTime = now;
          if (workoutState.stage !== 'start' && result.badParts.length === 0) {
            workoutState.tut += deltaTime;
            workoutState.isUnderTension = true;
          } else {
            workoutState.isUnderTension = false;
          }

          workoutState.totalFrames++;

          if (result.badParts.length > 0 && result.warning) {
            feedback.textContent = result.warning;
            feedback.style.color = '#ff4444';
            alertBorder.classList.add('danger');
            triggerErrorFeedback();
            updateStatusIndicator('error', 'MAL');
          } else {
            workoutState.goodFrames++;
            alertBorder.classList.remove('danger');
            updateStatusIndicator('ok', 'OK');
          }

          drawSkeleton(keypoints, result.badParts);

          if (workoutState.velocityTracker.fatigueDetected) {
            const fatigueEl = document.getElementById('metric-fatigue');
            if (fatigueEl) fatigueEl.textContent = '⚠️ FATIGA';
          }
        }
      }
    } catch (error) {
      console.error('Error detección:', error);
    }

    await new Promise(r => setTimeout(r, 40));
  }
}

// ===== UI Y CONTROLES =====
function updateHUD() {
  overlaySetText.textContent = `Serie ${workoutState.currentSet}/${workoutState.targetSets}`;
  overlayRepText.textContent = `${workoutState.currentRep} / ${workoutState.targetReps}`;
}

function showNextSetButton() {
  controlsBottom.style.display = 'flex';
  controlsBottom.innerHTML = '';
  const btn = document.createElement('button');
  if (workoutState.currentSet < workoutState.targetSets) {
    btn.textContent = `➡️ Pasar a Serie ${workoutState.currentSet + 1}`;
    btn.onclick = () => {
      workoutState.currentSet++;
      workoutState.currentRep = 0;
      workoutState.stage = 'start';
      workoutState.romTracker = { minAngle: 999, maxAngle: 0, fullROMAchieved: false, repROMs: workoutState.romTracker.repROMs };
      workoutState.tempoTracker = { phaseStartTime: 0, currentPhase: 'idle', eccentricDuration: 0, pauseDuration: 0, concentricDuration: 0, lastPhaseChange: 0 };
      updateHUD();
      controlsBottom.style.display = 'none';
      const feedback = document.getElementById('feedback');
      feedback.textContent = `¡Vamos con la Serie ${workoutState.currentSet}!`;
      feedback.style.color = '#ffd43b';
    };
  } else {
    btn.textContent = '🏆 Ver Resumen Final';
    btn.onclick = finishWorkout;
  }
  controlsBottom.appendChild(btn);
}

function finishWorkout() {
  isRunning = false;
  alertBorder.classList.remove('danger');
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
  }
  const elapsedSec = Math.max(1, Math.floor((Date.now() - workoutState.startTime) / 1000));
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');
  const accuracy = workoutState.totalFrames > 0
    ? Math.round((workoutState.goodFrames / workoutState.totalFrames) * 100)
    : 100;
  const exObj = exercisesDB.find(e => e.id === workoutState.exercise);

  document.getElementById('summary-exercise-name').textContent = exObj ? exObj.name : '';
  document.getElementById('stat-reps').textContent = (workoutState.currentSet - 1) * workoutState.targetReps + workoutState.currentRep;
  document.getElementById('stat-time').textContent = `${mins}:${secs}`;
  document.getElementById('stat-accuracy').textContent = `${accuracy}%`;

  const avgROM = workoutState.romTracker.repROMs.length > 0
    ? Math.round(workoutState.romTracker.repROMs.reduce((a, b) => a + b, 0) / workoutState.romTracker.repROMs.length)
    : 0;
  const avgTempoEcc = (workoutState.tempoTracker.eccentricDuration / 1000).toFixed(1);
  const avgTempoCon = (workoutState.tempoTracker.concentricDuration / 1000).toFixed(1);
  const tutSec = (workoutState.tut / 1000).toFixed(1);

  const statROM = document.getElementById('stat-rom');
  const statTempo = document.getElementById('stat-tempo');
  const statTUT = document.getElementById('stat-tut');
  const statSymmetry = document.getElementById('stat-symmetry');

  if (statROM) statROM.textContent = `${avgROM}°`;
  if (statTempo) statTempo.textContent = `${avgTempoEcc}-${avgTempoCon}`;
  if (statTUT) statTUT.textContent = `${tutSec}s`;
  if (statSymmetry) statSymmetry.textContent = `${workoutState.symmetryTracker.imbalancePercent}%`;

  workoutScreen.style.display = 'none';
  document.getElementById('summary-modal').style.display = 'flex';
}

// Buscador y Categorías
const searchInput = document.getElementById('exercise-search');
const searchResults = document.getElementById('search-results');
const selectedExerciseDiv = document.getElementById('selected-exercise');
let activeCategory = 'all';

function renderExerciseList(query = '') {
  const filtered = exercisesDB.filter(ex => {
    const matchCat = activeCategory === 'all' || ex.category === activeCategory;
    const matchText = ex.name.toLowerCase().includes(query.toLowerCase().trim());
    return matchCat && matchText;
  });
  if (filtered.length === 0) {
    searchResults.classList.remove('active');
    return;
  }
  searchResults.innerHTML = filtered.map(ex => `<div class="search-result-item" data-id="${ex.id}"> <div class="thumb">${ex.icon}</div> <div class="name">${ex.name}</div> </div>`).join('');
  searchResults.classList.add('active');
  searchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const ex = exercisesDB.find(e => e.id === item.dataset.id);
      workoutState.exercise = ex.id;
      selectedExerciseDiv.textContent = `${ex.name} ${ex.icon}`;
      searchInput.value = '';
      searchResults.classList.remove('active');
    });
  });
}

searchInput.addEventListener('focus', () => renderExerciseList(searchInput.value));
searchInput.addEventListener('input', (e) => renderExerciseList(e.target.value));

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeCategory = tab.dataset.category;
    renderExerciseList(searchInput.value);
  });
});

// Contadores +/-
document.querySelectorAll('.btn-minus, .btn-plus').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const isPlus = btn.classList.contains('btn-plus');
    if (target === 'sets') {
      workoutState.targetSets = Math.min(10, Math.max(1, workoutState.targetSets + (isPlus ? 1 : -1)));
      document.getElementById('sets-display').textContent = workoutState.targetSets;
    } else {
      workoutState.targetReps = Math.min(50, Math.max(1, workoutState.targetReps + (isPlus ? 1 : -1)));
      document.getElementById('reps-display').textContent = workoutState.targetReps;
    }
  });
});

// Botón Iniciar
document.getElementById('btn-start').addEventListener('click', async () => {
  workoutState.currentSet = 1;
  workoutState.currentRep = 0;
  workoutState.stage = 'start';
  workoutState.totalFrames = 0;
  workoutState.goodFrames = 0;
  workoutState.smoothedKeypoints = null;
  workoutState.tut = 0;
  workoutState.romTracker = { minAngle: 999, maxAngle: 0, fullROMAchieved: false, repROMs: [] };
  workoutState.tempoTracker = { phaseStartTime: 0, currentPhase: 'idle', eccentricDuration: 0, pauseDuration: 0, concentricDuration: 0, lastPhaseChange: 0 };
  workoutState.velocityTracker = { positions: [], currentVelocity: 0, peakVelocity: 0, velocityLossPercent: 0, fatigueDetected: false };
  workoutState.symmetryTracker = { leftAngles: [], rightAngles: [], leftROM: 0, rightROM: 0, imbalancePercent: 0 };

  updateHUD();
  setupScreen.style.display = 'none';
  workoutScreen.style.display = 'flex';
  controlsBottom.style.display = 'none';
  const feedback = document.getElementById('feedback');
  try {
    feedback.textContent = '📹 Preparando cámara...';
    await setupCamera();
    feedback.textContent = '🤖 Cargando IA...';
    await loadModel();
    configureMetricsPanel();
    feedback.textContent = 'Ubicate frente a la cámara';
    await runCountdown();
    workoutState.startTime = Date.now();
    feedback.textContent = '✅ ¡A entrenar!';
    detectPose();
  } catch (error) {
    feedback.textContent = '❌ Error al acceder a cámara';
  }
});

// Cambiar cámara
document.getElementById('btn-rotate-overlay').addEventListener('click', async () => {
  if (isSwitching) return;
  isSwitching = true;
  try {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    workoutState.smoothedKeypoints = null;
    await setupCamera();
  } finally {
    isSwitching = false;
  }
});

document.getElementById('btn-back').addEventListener('click', () => {
  isRunning = false;
  alertBorder.classList.remove('danger');
  if (video && video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  workoutScreen.style.display = 'none';
  setupScreen.style.display = 'flex';
});

document.getElementById('btn-finish-home').addEventListener('click', () => {
  document.getElementById('summary-modal').style.display = 'none';
  setupScreen.style.display = 'flex';
});

// 🆕 Event listeners del panel de métricas
document.getElementById('metrics-toggle')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMetricsPanel();
});

document.getElementById('video-wrapper')?.addEventListener('click', (e) => {
  if (!e.target.closest('.metrics-panel') &&
      !e.target.closest('.overlay-btn') &&
      !e.target.closest('.controls')) {
    showMetricsPanel();
  }
});

// Guía de instrucciones
const exerciseInstructions = {
  curl: {
    title: '💪 Curl de Bíceps',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De frente al celular, a 1.5-2 metros.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Balanceo del torso, codos pegados al cuerpo, flexión completa (45°), ROM completo.</div>'
  },
  squat: {
    title: '🦵 Sentadilla',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL al celular, a 2-3 metros, cuerpo completo visible.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Valgo de rodilla, butt wink, torso erguido, profundidad 90°, simetría bilateral.</div>'
  },
  pushup: {
    title: '💪 Flexiones',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL en el suelo, a 1.5-2 metros.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Alineación hombro-cadera-tobillo, cadera caída o muy alta, apertura de codos.</div>'
  },
  bench_press: {
    title: '🏋️ Press de Banca',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL a la banca, a 1.5-2 metros.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Ángulo seguro de codos (45-75°), recorrido completo, tempo controlado.</div>'
  },
  incline_press: {
    title: '📐 Press Inclinado',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL a la banca inclinada.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Control del ángulo de codos al bajar.</div>'
  },
  lat_pulldown: {
    title: '⬇️ Jalón al Pecho',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL a la polea, sentado y visible.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> No llevar detrás del cuello, hiperextensión lumbar, extensión completa.</div>'
  },
  seated_row: {
    title: '🚣 Remo en V',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL a la máquina de remo.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Uso excesivo del torso, estiramiento y contracción completos.</div>'
  }
};

document.getElementById('btn-help').addEventListener('click', () => {
  const info = exerciseInstructions[workoutState.exercise];
  document.getElementById('modal-title').textContent = info.title;
  document.getElementById('modal-body').innerHTML = info.content;
  document.getElementById('help-modal').style.display = 'flex';
});

document.querySelector('.close-modal').addEventListener('click', () => {
  document.getElementById('help-modal').style.display = 'none';
});

document.getElementById('btn-close-modal').addEventListener('click', () => {
  document.getElementById('help-modal').style.display = 'none';
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) searchResults.classList.remove('active');
});
