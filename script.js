let video, canvas, ctx, detector;
let currentFacingMode = 'user';
let isSwitching = false;
let isRunning = false;

// Estado del entrenamiento
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
  smoothedKeypoints: null
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

// Referencias DOM
const setupScreen = document.getElementById('setup-screen');
const workoutScreen = document.getElementById('workout-screen');
const overlaySetText = document.getElementById('overlay-set-text');
const overlayRepText = document.getElementById('overlay-rep-text');
const controlsBottom = document.getElementById('controls-bottom');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');
const alertBorder = document.getElementById('posture-alert-border');

// ===== SISTEMA DE AUDIO Y VIBRACIÓN (FEEDBACK MULTISENSORIAL) =====
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
  playTone(880, 'sine', 0.18); // Pitido agudo de éxito
  if (document.getElementById('toggle-vibrate').checked && navigator.vibrate) {
    navigator.vibrate(80);
  }
}

function triggerErrorFeedback() {
  const now = Date.now();
  if (now - workoutState.lastWarningSoundTime > 1800) {
    playTone(220, 'sawtooth', 0.25); // Tono grave de advertencia
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

// ===== MATEMÁTICA Y SUAVIZADO DE PUNTOS (EMA FILTER) =====
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

  // Factor de suavizado (0.55 = balance ideal entre fluidez y respuesta rápida)
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

// ===== EVALUADORES BIOMECÁNICOS POR EJERCICIO =====
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

function registerRepCompleted(feedbackEl) {
  workoutState.currentRep++;
  triggerSuccessFeedback();
  updateHUD();

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

function evaluateCurl(keypoints, feedback) {
  let badParts = [];
  let warning = '';

  ['left', 'right'].forEach(side => {
    const s = keypoints.find(k => k.name === side + '_shoulder');
    const e = keypoints.find(k => k.name === side + '_elbow');
    const w = keypoints.find(k => k.name === side + '_wrist');
    const otherS = keypoints.find(k => k.name === (side === 'left' ? 'right_shoulder' : 'left_shoulder'));

    if (s && e && w && s.score > 0.3 && e.score > 0.3 && w.score > 0.3) {
      const shoulderWidth = (otherS && otherS.score > 0.3) ? distance(s, otherS) : 80;
      if (Math.abs(e.x - s.x) > shoulderWidth * 0.28) {
        badParts.push(side + '_shoulder', side + '_elbow', side + '_wrist');
        warning = '❌ No adelantes los codos';
      }
    }
  });

  const side = getBestSide(keypoints, ['shoulder', 'elbow', 'wrist']);
  const s = keypoints.find(k => k.name === side + '_shoulder');
  const e = keypoints.find(k => k.name === side + '_elbow');
  const w = keypoints.find(k => k.name === side + '_wrist');

  if (s && e && w && s.score > 0.3 && e.score > 0.3 && w.score > 0.3) {
    const angle = calculateAngle(s, e, w);
    if (angle > 155) {
      workoutState.stage = 'down';
      if (!warning) {
        feedback.textContent = 'Brazos extendidos. ¡Subí!';
        feedback.style.color = '#ffd43b';
      }
    } else if (angle < 55 && workoutState.stage === 'down') {
      workoutState.stage = 'up';
      registerRepCompleted(feedback);
    } else if (!warning && workoutState.stage === 'down') {
      feedback.textContent = `Subiendo... ${Math.round(angle)}°`;
      feedback.style.color = '#ffd43b';
    }
  }
  return { badParts, warning };
}

function evaluateSquat(keypoints, feedback) {
  let badParts = [];
  let warning = '';
  const side = getBestSide(keypoints, ['shoulder', 'hip', 'knee', 'ankle']);

  const shoulder = keypoints.find(k => k.name === side + '_shoulder');
  const hip = keypoints.find(k => k.name === side + '_hip');
  const knee = keypoints.find(k => k.name === side + '_knee');
  const ankle = keypoints.find(k => k.name === side + '_ankle');

  if (hip && knee && ankle && hip.score > 0.3 && knee.score > 0.3 && ankle.score > 0.3) {
    const kneeAngle = calculateAngle(hip, knee, ankle);

    // Verificar inclinación excesiva de torso
    if (shoulder && shoulder.score > 0.3) {
      const torsoAngle = calculateAngle(shoulder, hip, { x: hip.x, y: hip.y - 100 });
      if (torsoAngle > 48) {
        badParts.push(side + '_shoulder', side + '_hip');
        warning = '❌ Mantené el pecho erguido';
      }
    }

    if (kneeAngle > 155) {
      if (workoutState.stage === 'down') {
        workoutState.stage = 'up';
        registerRepCompleted(feedback);
      } else if (!warning) {
        feedback.textContent = 'De pie. ¡Bajá a 90°!';
        feedback.style.color = '#ffd43b';
      }
    } else if (kneeAngle < 100) {
      workoutState.stage = 'down';
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

function evaluatePushupOrPress(keypoints, feedback, isPushup) {
  let badParts = [];
  let warning = '';
  const side = getBestSide(keypoints, ['shoulder', 'elbow', 'wrist']);

  const s = keypoints.find(k => k.name === side + '_shoulder');
  const e = keypoints.find(k => k.name === side + '_elbow');
  const w = keypoints.find(k => k.name === side + '_wrist');

  if (s && e && w && s.score > 0.3 && e.score > 0.3 && w.score > 0.3) {
    const elbowAngle = calculateAngle(s, e, w);

    // Control de apertura excesiva de codos
    if (Math.abs(e.y - s.y) < 15 && elbowAngle < 120) {
      badParts.push(side + '_shoulder', side + '_elbow', side + '_wrist');
      warning = '❌ Codos muy abiertos (usá 45°)';
    }

    if (elbowAngle > 155) {
      if (workoutState.stage === 'down') {
        workoutState.stage = 'up';
        registerRepCompleted(feedback);
      } else if (!warning) {
        feedback.textContent = isPushup ? 'Brazos firmes. ¡Bajá el pecho!' : 'Brazos extendidos. ¡Bajá!';
        feedback.style.color = '#ffd43b';
      }
    } else if (elbowAngle < 85) {
      workoutState.stage = 'down';
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

function evaluatePullExercise(keypoints, feedback) {
  let badParts = [];
  let warning = '';
  const side = getBestSide(keypoints, ['shoulder', 'elbow', 'wrist']);

  const s = keypoints.find(k => k.name === side + '_shoulder');
  const e = keypoints.find(k => k.name === side + '_elbow');
  const w = keypoints.find(k => k.name === side + '_wrist');

  if (s && e && w && s.score > 0.3 && e.score > 0.3 && w.score > 0.3) {
    const elbowAngle = calculateAngle(s, e, w);

    if (elbowAngle > 150) {
      workoutState.stage = 'extended';
      feedback.textContent = 'Brazos estirados. ¡Tirá!';
      feedback.style.color = '#ffd43b';
    } else if (elbowAngle < 75 && workoutState.stage === 'extended') {
      workoutState.stage = 'contracted';
      registerRepCompleted(feedback);
    } else {
      feedback.textContent = `Recorrido codo: ${Math.round(elbowAngle)}°`;
      feedback.style.color = '#ffd43b';
    }
  }
  return { badParts, warning };
}

// ===== BUCLE PRINCIPAL DE DETECCIÓN =====
async function detectPose() {
  if (isRunning) return;
  isRunning = true;
  const feedback = document.getElementById('feedback');

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
          let result = { badParts: [], warning: '' };

          switch (workoutState.exercise) {
            case 'curl':
              result = evaluateCurl(keypoints, feedback);
              break;
            case 'squat':
              result = evaluateSquat(keypoints, feedback);
              break;
            case 'pushup':
              result = evaluatePushupOrPress(keypoints, feedback, true);
              break;
            case 'bench_press':
            case 'incline_press':
              result = evaluatePushupOrPress(keypoints, feedback, false);
              break;
            case 'lat_pulldown':
            case 'seated_row':
              result = evaluatePullExercise(keypoints, feedback);
              break;
          }

          workoutState.totalFrames++;
          if (result.badParts.length > 0 && result.warning) {
            feedback.textContent = result.warning;
            feedback.style.color = '#ff4444';
            alertBorder.classList.add('danger');
            triggerErrorFeedback();
          } else {
            workoutState.goodFrames++;
            alertBorder.classList.remove('danger');
          }

          drawSkeleton(keypoints, result.badParts);
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
  document.getElementById('stat-reps').textContent = (workoutState.targetSets - 1) * workoutState.targetReps + workoutState.currentRep;
  document.getElementById('stat-time').textContent = `${mins}:${secs}`;
  document.getElementById('stat-accuracy').textContent = `${accuracy}%`;

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

  searchResults.innerHTML = filtered.map(ex => `
    <div class="search-result-item" data-id="${ex.id}">
      <div class="thumb">${ex.icon}</div>
      <div class="name">${ex.name}</div>
    </div>
  `).join('');
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
    feedback.textContent = 'Ubicate frente a la cámara';
    await runCountdown();
    workoutState.startTime = Date.now();
    feedback.textContent = '✅ ¡A entrenar!';
    detectPose();
  } catch (error) {
    feedback.textContent = '❌ Error al acceder a cámara';
  }
});

// Cambiar cámara y Volver
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

// Guía de instrucciones
const exerciseInstructions = {
  curl: {
    title: '💪 Curl de Bíceps',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De frente al celular, a 1.5 - 2 metros.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Extensión y flexión completa del codo, y que no adelantes los brazos al subir.</div>'
  },
  squat: {
    title: '🦵 Sentadilla',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL al celular, a 2 - 3 metros, cuerpo completo visible.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Que rompas los 90° de rodilla y mantengas la espalda erguida.</div>'
  },
  pushup: {
    title: '💪 Flexiones',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL en el suelo, a 1.5 - 2 metros.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Profundidad del pecho y que los codos no se abran excesivamente.</div>'
  },
  bench_press: {
    title: '🏋️ Press de Banca',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL a la banca, a 1.5 - 2 metros.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Ángulo seguro de codos y recorrido completo.</div>'
  },
  incline_press: {
    title: '📐 Press Inclinado',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL a la banca inclinada.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Control del ángulo de codos al bajar.</div>'
  },
  lat_pulldown: {
    title: '⬇️ Jalón al Pecho',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL a la polea, sentado y visible.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Extensión superior completa y tracción hasta el pecho.</div>'
  },
  seated_row: {
    title: '🚣 Remo en V',
    content: '<div class="instruction-item"><strong>📱 Ubicación:</strong> De PERFIL a la máquina de remo.</div><div class="instruction-item"><strong>✅ Qué revisa la IA:</strong> Estiramiento de brazos y contracción final.</div>'
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
