let video, canvas, ctx, detector;
let currentFacingMode = 'user';
let isSwitching = false;
let isRunning = false;

// ===== ESTADO MEJORADO DEL ENTRENAMIENTO =====
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
  
  // NUEVO: Tempo Training
  tempoTracker: {
    phaseStartTime: 0,
    currentPhase: 'idle', // 'eccentric', 'pause', 'concentric', 'idle'
    eccentricDuration: 0,
    pauseDuration: 0,
    concentricDuration: 0,
    targetEccentric: 3000, // 3 segundos
    targetPause: 1000,     // 1 segundo
    targetConcentric: 2000 // 2 segundos
  },
  
  // NUEVO: Time Under Tension
  tut: 0,
  lastFrameTime: 0,
  
  // NUEVO: Velocidad de ejecución
  velocityTracker: {
    positions: [],
    maxVelocity: 0,
    currentVelocity: 0,
    fatigueDetected: false
  },
  
  // NUEVO: Simetría bilateral
  symmetryTracker: {
    leftReps: 0,
    rightReps: 0,
    leftROM: [],
    rightROM: []
  },
  
  // NUEVO: Rango de movimiento
  romTracker: {
    minAngle: 999,
    maxAngle: 0,
    fullROMAchieved: false
  }
};

// Base de datos de ejercicios (sin cambios)
const exercisesDB = [
  { id: 'curl', name: 'Curl de Bíceps', icon: '💪', category: 'upper' },
  { id: 'squat', name: 'Sentadilla', icon: '🦵', category: 'lower' },
  { id: 'pushup', name: 'Flexiones', icon: '💪', category: 'upper' },
  { id: 'bench_press', name: 'Press de Banca', icon: '🏋️', category: 'upper' },
  { id: 'incline_press', name: 'Press Inclinado', icon: '📐', category: 'upper' },
  { id: 'lat_pulldown', name: 'Jalón al Pecho', icon: '⬇️', category: 'upper' },
  { id: 'seated_row', name: 'Remo en V', icon: '🚣', category: 'upper' }
];

// Referencias DOM (sin cambios)
const setupScreen = document.getElementById('setup-screen');
const workoutScreen = document.getElementById('workout-screen');
const overlaySetText = document.getElementById('overlay-set-text');
const overlayRepText = document.getElementById('overlay-rep-text');
const controlsBottom = document.getElementById('controls-bottom');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');
const alertBorder = document.getElementById('posture-alert-border');

// ===== SISTEMA DE AUDIO Y VIBRACIÓN (sin cambios) =====
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

// ===== CÁMARA Y MODELO IA (sin cambios) =====
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

// ===== MATEMÁTICA Y SUAVIZADO (sin cambios) =====
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

// ===== EVALUADORES BIOMECÁNICOS MEJORADOS =====

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

// NUEVO: Función para registrar rep con validación de ROM completo
function registerRepCompleted(feedbackEl, fullROM = true) {
  if (!fullROM) {
    feedbackEl.textContent = '⚠️ Rep incompleta: rango insuficiente';
    feedbackEl.style.color = '#ffd43b';
    return;
  }
  
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

// ===== CURL DE BÍCEPS MEJORADO =====
function evaluateCurl(keypoints, feedback) {
  let badParts = [];
  let warning = '';
  
  // 1. Detectar balanceo del torso (momentum)
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
  
  // 2. Verificar codo pegado al torso y ángulo
  const side = getBestSide(keypoints, ['shoulder', 'elbow', 'wrist']);
  const s = keypoints.find(k => k.name === side + '_shoulder');
  const e = keypoints.find(k => k.name === side + '_elbow');
  const w = keypoints.find(k => k.name === side + '_wrist');
  const otherS = keypoints.find(k => k.name === (side === 'left' ? 'right_shoulder' : 'left_shoulder'));
  
  if (s && e && w && s.score > 0.3 && e.score > 0.3 && w.score > 0.3) {
    // Verificar que el codo no se adelante
    const shoulderWidth = (otherS && otherS.score > 0.3) ? distance(s, otherS) : 80;
    if (Math.abs(e.x - s.x) > shoulderWidth * 0.28) {
      badParts.push(side + '_shoulder', side + '_elbow', side + '_wrist');
      warning = warning || '❌ No adelantes los codos';
    }
    
    // Calcular ángulo del codo
    const angle = calculateAngle(s, e, w);
    
    // Tracking de ROM
    if (angle < workoutState.romTracker.minAngle) {
      workoutState.romTracker.minAngle = angle;
    }
    if (angle > workoutState.romTracker.maxAngle) {
      workoutState.romTracker.maxAngle = angle;
    }
    
    // Lógica de fases
    if (angle > 155) {
      workoutState.stage = 'down';
      workoutState.romTracker.fullROMAchieved = true;
      if (!warning) {
        feedback.textContent = 'Brazos extendidos. ¡Subí!';
        feedback.style.color = '#ffd43b';
      }
    } else if (angle < 45 && workoutState.stage === 'down') { // Ajustado de 55° a 45°
      workoutState.stage = 'up';
      registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved);
      // Reset ROM tracker para próxima rep
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
function evaluateSquat(keypoints, feedback) {
  let badParts = [];
  let warning = '';
  
  const side = getBestSide(keypoints, ['shoulder', 'hip', 'knee', 'ankle']);
  const shoulder = keypoints.find(k => k.name === side + '_shoulder');
  const hip = keypoints.find(k => k.name === side + '_hip');
  const knee = keypoints.find(k => k.name === side + '_knee');
  const ankle = keypoints.find(k => k.name === side + '_ankle');
  
  // Detectar valgo de rodilla (comparando ambas rodillas)
  const leftKnee = keypoints.find(k => k.name === 'left_knee');
  const rightKnee = keypoints.find(k => k.name === 'right_knee');
  const leftAnkle = keypoints.find(k => k.name === 'left_ankle');
  const rightAnkle = keypoints.find(k => k.name === 'right_ankle');
  
  if (leftKnee && rightKnee && leftAnkle && rightAnkle &&
      leftKnee.score > 0.3 && rightKnee.score > 0.3 &&
      leftAnkle.score > 0.3 && rightAnkle.score > 0.3) {
    
    const kneeDistance = Math.abs(leftKnee.x - rightKnee.x);
    const ankleDistance = Math.abs(leftAnkle.x - rightAnkle.x);
    const valgusRatio = kneeDistance / ankleDistance;
    
    const kneeAngle = calculateAngle(hip, knee, ankle);
    
    // Si las rodillas están más juntas que los tobillos en profundidad = valgo
    if (kneeAngle < 110 && valgusRatio < 0.7) {
      badParts.push('left_knee', 'right_knee');
      warning = '❌ Rodillas hacia adentro (valgo): empujalas afuera';
    }
  }
  
  if (hip && knee && ankle && hip.score > 0.3 && knee.score > 0.3 && ankle.score > 0.3) {
    const kneeAngle = calculateAngle(hip, knee, ankle);
    
    // Verificar inclinación de torso
    if (shoulder && shoulder.score > 0.3) {
      const torsoAngle = calculateAngle(shoulder, hip, { x: hip.x, y: hip.y - 100 });
      if (torsoAngle > 48) {
        badParts.push(side + '_shoulder', side + '_hip');
        warning = warning || '❌ Mantené el pecho erguido';
      }
    }
    
    // Detectar butt wink (cadera más baja que rodillas)
    if (hip.y > knee.y && kneeAngle < 95) {
      badParts.push(side + '_hip');
      warning = warning || '⚠️ Redondeo lumbar: no bajes más';
    }
    
    // Tracking de ROM
    if (kneeAngle < workoutState.romTracker.minAngle) {
      workoutState.romTracker.minAngle = kneeAngle;
    }
    if (kneeAngle > workoutState.romTracker.maxAngle) {
      workoutState.romTracker.maxAngle = kneeAngle;
    }
    
    // Lógica de fases
    if (kneeAngle > 155) {
      if (workoutState.stage === 'down') {
        workoutState.stage = 'up';
        registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved);
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
function evaluatePushup(keypoints, feedback) {
  let badParts = [];
  let warning = '';
  
  const side = getBestSide(keypoints, ['shoulder', 'hip', 'ankle']);
  const shoulder = keypoints.find(k => k.name === side + '_shoulder');
  const hip = keypoints.find(k => k.name === side + '_hip');
  const ankle = keypoints.find(k => k.name === side + '_ankle');
  const elbow = keypoints.find(k => k.name === side + '_elbow');
  const wrist = keypoints.find(k => k.name === side + '_wrist');
  
  // Verificar alineación hombro-cadera-tobillo
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
  
  // Verificar ángulo de codos
  if (shoulder && elbow && wrist &&
      shoulder.score > 0.3 && elbow.score > 0.3 && wrist.score > 0.3) {
    
    const elbowAngle = calculateAngle(shoulder, elbow, wrist);
    
    // Control de apertura excesiva de codos
    if (Math.abs(elbow.y - shoulder.y) < 15 && elbowAngle < 120) {
      badParts.push(side + '_shoulder', side + '_elbow', side + '_wrist');
      warning = warning || '❌ Codos muy abiertos (usá 45°)';
    }
    
    // Tracking de ROM
    if (elbowAngle < workoutState.romTracker.minAngle) {
      workoutState.romTracker.minAngle = elbowAngle;
    }
    if (elbowAngle > workoutState.romTracker.maxAngle) {
      workoutState.romTracker.maxAngle = elbowAngle;
    }
    
    // Lógica de fases
    if (elbowAngle > 155) {
      if (workoutState.stage === 'down') {
        workoutState.stage = 'up';
        registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved);
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

// ===== PRESS DE BANCA (NUEVO - SEPARADO DE FLEXIONES) =====
function evaluateBenchPress(keypoints, feedback) {
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
    
    // Detectar ángulo peligroso del codo (>85° respecto al torso)
    // En press de banca, el codo debe estar a 45-75° respecto al torso
    if (hip && hip.score > 0.3) {
      const armTorsoAngle = calculateAngle(hip, shoulder, elbow);
      
      if (armTorsoAngle > 85) {
        badParts.push(side + '_shoulder', side + '_elbow');
        warning = '❌ Codos a 90°: bajalos a 45° (protege tus hombros)';
      }
    }
    
    // Tracking de ROM
    if (elbowAngle < workoutState.romTracker.minAngle) {
      workoutState.romTracker.minAngle = elbowAngle;
    }
    if (elbowAngle > workoutState.romTracker.maxAngle) {
      workoutState.romTracker.maxAngle = elbowAngle;
    }
    
    // Lógica de fases
    if (elbowAngle > 155) {
      if (workoutState.stage === 'down') {
        workoutState.stage = 'up';
        registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved);
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
function evaluateLatPulldown(keypoints, feedback) {
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
    
    // Detectar si la barra pasa detrás de la cabeza
    if (nose && nose.score > 0.3 && hip && hip.score > 0.3) {
      const torsoLeanBack = calculateAngle(nose, shoulder, hip);
      
      if (wrist.y < nose.y && torsoLeanBack > 20) {
        badParts.push(side + '_wrist');
        warning = '❌ No lo lleves detrás del cuello: lesiona el hombro';
      }
      
      // Detectar hiperextensión lumbar
      if (torsoLeanBack > 25) {
        badParts.push(side + '_shoulder', side + '_hip');
        warning = warning || '❌ Menos peso: no te arquees hacia atrás';
      }
    }
    
    // Tracking de ROM
    if (elbowAngle < workoutState.romTracker.minAngle) {
      workoutState.romTracker.minAngle = elbowAngle;
    }
    if (elbowAngle > workoutState.romTracker.maxAngle) {
      workoutState.romTracker.maxAngle = elbowAngle;
    }
    
    // Lógica de fases
    if (elbowAngle > 150) {
      workoutState.stage = 'extended';
      workoutState.romTracker.fullROMAchieved = true;
      if (!warning) {
        feedback.textContent = 'Brazos estirados. ¡Tirá!';
        feedback.style.color = '#ffd43b';
      }
    } else if (elbowAngle < 75 && workoutState.stage === 'extended') {
      workoutState.stage = 'contracted';
      registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved);
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
function evaluateSeatedRow(keypoints, feedback) {
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
    
    // Detectar uso excesivo del torso
    if (torsoLeanBack > 20 && elbowAngle < 120) {
      badParts.push(side + '_shoulder', side + '_hip');
      warning = '❌ No uses el torso: tirá con la espalda';
    }
    
    // Tracking de ROM
    if (elbowAngle < workoutState.romTracker.minAngle) {
      workoutState.romTracker.minAngle = elbowAngle;
    }
    if (elbowAngle > workoutState.romTracker.maxAngle) {
      workoutState.romTracker.maxAngle = elbowAngle;
    }
    
    // Lógica de fases
    if (elbowAngle > 150) {
      workoutState.stage = 'extended';
      workoutState.romTracker.fullROMAchieved = true;
      if (!warning) {
        feedback.textContent = 'Brazos estirados. ¡Tirá!';
        feedback.style.color = '#ffd43b';
      }
    } else if (elbowAngle < 75 && workoutState.stage === 'extended') {
      workoutState.stage = 'contracted';
      registerRepCompleted(feedback, workoutState.romTracker.fullROMAchieved);
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

// ===== BUCLE PRINCIPAL ACTUALIZADO =====
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
              result = evaluatePushup(keypoints, feedback);
              break;
            case 'bench_press':
            case 'incline_press':
              result = evaluateBenchPress(keypoints, feedback);
              break;
            case 'lat_pulldown':
              result = evaluateLatPulldown(keypoints, feedback);
              break;
            case 'seated_row':
              result = evaluateSeatedRow(keypoints, feedback);
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

// El resto del código (UI, controles, etc.) permanece igual...