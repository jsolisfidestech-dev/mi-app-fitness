let video, canvas, ctx, detector;
let currentFacingMode = 'user';
let isSwitching = false;
let isRunning = false;
let selectedExercise = 'curl';
let targetSets = 3;
let targetReps = 10;
let currentSet = 1;
let currentRep = 0;
let stage = 'down';
let voiceEnabled = true;
let audioContextInitialized = false;

const setupScreen = document.getElementById('setup-screen');
const workoutScreen = document.getElementById('workout-screen');
const overlayCounter = document.getElementById('overlay-counter');
const controlsBottom = document.getElementById('controls-bottom');

const exercisesDB = [
  { id: 'curl', name: 'Curl de Bíceps', icon: '💪', category: 'upper' },
  { id: 'squat', name: 'Sentadilla', icon: '', category: 'lower' },
  { id: 'pushup', name: 'Flexiones', icon: '💪', category: 'upper' },
  { id: 'bench_press', name: 'Press de Banca', icon: '🏋️', category: 'upper' },
  { id: 'incline_press', name: 'Press Inclinado', icon: '📐', category: 'upper' },
  { id: 'lat_pulldown', name: 'Jalón al Pecho', icon: '⬇️', category: 'upper' },
  { id: 'seated_row', name: 'Remo en V', icon: '🚣', category: 'upper' }
];

const numbersInSpanish = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];

// ===== SISTEMA DE VOZ Y VIBRACIÓN (COMPATIBLE CON iOS) =====

function initAudio() {
  if (audioContextInitialized) return;
  
  // Inicializar AudioContext para iOS (requiere interacción del usuario)
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const audioCtx = new AudioContext();
      audioCtx.resume();
      audioContextInitialized = true;
    }
  } catch (e) {
    console.log('AudioContext no soportado');
  }
}

function speak(text) {
  if (!voiceEnabled) return;
  
  // Cancelar voz anterior
  window.speechSynthesis.cancel();
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  utterance.rate = 1.1;
  utterance.volume = 1;
  
  // En iOS, necesitamos asegurar que el speech synthesis esté disponible
  if (window.speechSynthesis) {
    window.speechSynthesis.speak(utterance);
  }
}

function vibrate(pattern) {
  // iOS no soporta navigator.vibrate, usamos AudioContext como fallback
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  } else {
    // Fallback para iOS: crear un beep corto usando AudioContext
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext && audioContextInitialized) {
        const audioCtx = new AudioContext();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.frequency.value = 800; // 800 Hz
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.1);
      }
    } catch (e) {
      console.log('Vibración/beep no disponible');
    }
  }
}

const VIBRATE_REP = [100];
const VIBRATE_ERROR = [200, 100, 200];
const VIBRATE_SET = [300];
const VIBRATE_FINISH = [500, 200, 500, 200, 500];

// ===== ESCALADO INTELIGENTE DE COORDENADAS =====
function scaleKeypoints(keypoints) {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  
  const maxX = Math.max(...keypoints.map(kp => kp.x));
  const maxY = Math.max(...keypoints.map(kp => kp.y));
  
  return keypoints.map(kp => {
    let x, y;
    
    if (maxX <= 1.5 && maxY <= 1.5) {
      x = kp.x * videoWidth;
      y = kp.y * videoHeight;
    } else if (maxX <= 300 && maxY <= 300) {
      const inputSize = 256;
      x = (kp.x / inputSize) * videoWidth;
      y = (kp.y / inputSize) * videoHeight;
    } else {
      x = kp.x;
      y = kp.y;
    }
    
    return { name: kp.name, x: x, y: y, score: kp.score };
  });
}

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

function drawSkeleton(keypoints, badParts = []) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const greenColor = '#00ff88';
  const redColor = '#ff4444';
  
  const allConnections = [
    ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'], ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'], ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'], ['right_knee', 'right_ankle']
  ];
  
  allConnections.forEach(([start, end]) => {
    const kp1 = keypoints.find(kp => kp.name === start);
    const kp2 = keypoints.find(kp => kp.name === end);
    
    if (kp1 && kp2 && kp1.score > 0.3 && kp2.score > 0.3) {
      const isBad = badParts.includes(start) || badParts.includes(end);
      ctx.strokeStyle = isBad ? redColor : greenColor;
      ctx.lineWidth = isBad ? 6 : 3;
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
      const radius = isBad ? 12 : 8;
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
}

function checkArm(keypoints, side) {
  const shoulder = keypoints.find(k => k.name === `${side}_shoulder`);
  const elbow = keypoints.find(k => k.name === `${side}_elbow`);
  const wrist = keypoints.find(k => k.name === `${side}_wrist`);
  const hip = keypoints.find(k => k.name === `${side}_hip`);
  
  if (!shoulder || !elbow || !wrist || !hip) return { bad: false, parts: [], angle: 0 };
  if (shoulder.score < 0.3 || elbow.score < 0.3 || wrist.score < 0.3) return { bad: false, parts: [], angle: 0 };
  
  const angle = calculateAngle(shoulder, elbow, wrist);
  
  const otherShoulder = keypoints.find(k => k.name === (side === 'left' ? 'right_shoulder' : 'left_shoulder'));
  let shoulderWidth = 80;
  if (otherShoulder && otherShoulder.score > 0.3) {
    shoulderWidth = distance(shoulder, otherShoulder);
  }
  
  const threshold = shoulderWidth * 0.25;
  const elbowForward = Math.abs(elbow.x - shoulder.x) > threshold;
  
  if (elbowForward) {
    return { 
      bad: true, 
      parts: [`${side}_shoulder`, `${side}_elbow`, `${side}_wrist`],
      angle: angle
    };
  }
  
  return { bad: false, parts: [], angle: angle };
}

async function detectPose() {
  if (isRunning) return;
  isRunning = true;
  const feedback = document.getElementById('feedback');
  
  while (isRunning) {
    if (isSwitching) { await new Promise(r => setTimeout(r, 100)); continue; }

    try {
      if (detector && video.srcObject && video.readyState === 4) {
        const poses = await detector.estimatePoses(video);
        if (poses.length > 0) {
          const rawKeypoints = poses[0].keypoints;
          const keypoints = scaleKeypoints(rawKeypoints);
          
          let badParts = [];
          let warningMessage = '';
          
          if (selectedExercise === 'curl') {
            const rightCheck = checkArm(keypoints, 'right');
            const leftCheck = checkArm(keypoints, 'left');
            
            if (rightCheck.bad) {
              badParts = badParts.concat(rightCheck.parts);
              warningMessage = '❌ Codo derecho adelantado';
            }
            if (leftCheck.bad) {
              badParts = badParts.concat(leftCheck.parts);
              if (rightCheck.bad) {
                warningMessage = '❌ Ambos codos adelantados';
              } else {
                warningMessage = '❌ Codo izquierdo adelantado';
              }
            }
            
            const avgAngle = (rightCheck.angle + leftCheck.angle) / 2;
            
            if (avgAngle > 160) {
              stage = 'down';
              if (badParts.length === 0) {
                feedback.textContent = 'Brazos estirados. ¡Subí!';
                feedback.style.color = '#ffd43b';
              }
            } else if (avgAngle < 50) {
              if (stage === 'down') {
                currentRep++;
                stage = 'up';
                updateInfoText();
                
                // VIBRACIÓN Y VOZ AL COMPLETAR REP
                vibrate(VIBRATE_REP);
                
                if (currentRep === targetReps) {
                  feedback.textContent = `🎉 ¡Meta cumplida! Llevas ${currentRep}/${targetReps}`;
                  feedback.style.color = '#00ff88';
                  speak('¡Meta cumplida!');
                  showNextSetButton();
                } else if (currentRep > targetReps) {
                  feedback.textContent = `💪 ¡Extra! Llevas ${currentRep} reps`;
                  feedback.style.color = '#00ff88';
                  speak('Extra');
                } else {
                  feedback.textContent = `✅ Rep ${currentRep}/${targetReps}. ¡Seguí!`;
                  feedback.style.color = '#00ff88';
                  const repText = numbersInSpanish[currentRep] || currentRep.toString();
                  speak(repText);
                }
              } else {
                if (badParts.length === 0) feedback.textContent = 'Bien, bajá controlado.';
                feedback.style.color = '#00ff88';
              }
            } else {
              if (badParts.length === 0) {
                feedback.textContent = `Subiendo... ${Math.round(avgAngle)}°`;
                feedback.style.color = '#ffd43b';
              }
            }
          }
          
          else if (selectedExercise === 'squat') {
            const hip = keypoints.find(k => k.name === 'left_hip');
            const knee = keypoints.find(k => k.name === 'left_knee');
            const ankle = keypoints.find(k => k.name === 'left_ankle');
            const shoulder = keypoints.find(k => k.name === 'left_shoulder');
            
            if (hip && knee && ankle && hip.score > 0.3 && knee.score > 0.3 && ankle.score > 0.3) {
              const kneeAngle = calculateAngle(hip, knee, ankle);
              
              if (kneeAngle > 100) {
                badParts = ['left_hip', 'left_knee', 'left_ankle'];
                warningMessage = '❌ Bajá más (llegá a 90°)';
              }
              
              if (shoulder && shoulder.score > 0.3) {
                const shoulderForward = shoulder.x - hip.x;
                if (shoulderForward > 60) {
                  badParts = ['left_shoulder', 'left_hip'];
                  warningMessage = '❌ Mantené la espalda recta';
                }
              }
              
              feedback.textContent = `Rodilla: ${Math.round(kneeAngle)}°`;
              feedback.style.color = badParts.length > 0 ? '#ff4444' : '#ffd43b';
            }
          }
          
          else if (selectedExercise === 'pushup') {
            const rightCheck = checkArm(keypoints, 'right');
            const leftCheck = checkArm(keypoints, 'left');
            
            if (rightCheck.bad) badParts = badParts.concat(rightCheck.parts);
            if (leftCheck.bad) badParts = badParts.concat(leftCheck.parts);
            
            if (badParts.length > 0) {
              warningMessage = '❌ Codos muy abiertos (usá 45°)';
            }
            
            const avgAngle = (rightCheck.angle + leftCheck.angle) / 2;
            feedback.textContent = `Codo: ${Math.round(avgAngle)}°`;
            feedback.style.color = badParts.length > 0 ? '#ff4444' : '#ffd43b';
          }
          
          else if (selectedExercise === 'bench_press' || selectedExercise === 'incline_press') {
            const rightCheck = checkArm(keypoints, 'right');
            const leftCheck = checkArm(keypoints, 'left');
            
            if (rightCheck.bad) badParts = badParts.concat(rightCheck.parts);
            if (leftCheck.bad) badParts = badParts.concat(leftCheck.parts);
            
            if (badParts.length > 0) {
              warningMessage = '❌ Codos muy abiertos (45-75°)';
            }
            
            const avgAngle = (rightCheck.angle + leftCheck.angle) / 2;
            feedback.textContent = `Codo: ${Math.round(avgAngle)}°`;
            feedback.style.color = badParts.length > 0 ? '#ff4444' : '#ffd43b';
          }
          
          else if (selectedExercise === 'lat_pulldown') {
            const rightCheck = checkArm(keypoints, 'right');
            const leftCheck = checkArm(keypoints, 'left');
            const avgAngle = (rightCheck.angle + leftCheck.angle) / 2;
            feedback.textContent = `Codo: ${Math.round(avgAngle)}°`;
            feedback.style.color = '#ffd43b';
          }
          
          else if (selectedExercise === 'seated_row') {
            const rightCheck = checkArm(keypoints, 'right');
            const leftCheck = checkArm(keypoints, 'left');
            const avgAngle = (rightCheck.angle + leftCheck.angle) / 2;
            feedback.textContent = `Codo: ${Math.round(avgAngle)}°`;
            feedback.style.color = '#ffd43b';
          }
          
          if (badParts.length > 0 && warningMessage) {
            feedback.textContent = warningMessage;
            feedback.style.color = '#ff4444';
            vibrate(VIBRATE_ERROR);
            speak('Postura');
          }
          
          drawSkeleton(keypoints, badParts);
        }
      }
    } catch (error) { console.error('Error detección:', error); }
    await new Promise(r => setTimeout(r, 50));
  }
}

function updateInfoText() {
  if (overlayCounter) {
    overlayCounter.textContent = `Serie ${currentSet}/${targetSets} | Rep ${currentRep}`;
  }
}

function showNextSetButton() {
  controlsBottom.style.display = 'flex';
  controlsBottom.innerHTML = '';
  
  let btn;
  if (currentSet < targetSets) {
    btn = document.createElement('button');
    btn.id = 'btn-next-set';
    btn.textContent = `➡️ Pasar a Serie ${currentSet + 1}`;
    btn.onclick = nextSet;
  } else {
    btn = document.createElement('button');
    btn.id = 'btn-next-set';
    btn.textContent = '🏆 Terminar Entrenamiento';
    btn.onclick = finishWorkout;
  }
  controlsBottom.appendChild(btn);
}

function hideControlsBottom() {
  controlsBottom.style.display = 'none';
  controlsBottom.innerHTML = '';
}

function nextSet() {
  currentSet++;
  currentRep = 0;
  stage = 'down';
  updateInfoText();
  hideControlsBottom();
  
  const feedback = document.getElementById('feedback');
  feedback.textContent = `¡Vamos con la Serie ${currentSet}!`;
  feedback.style.color = '#ffd43b';
  
  vibrate(VIBRATE_SET);
  const setText = numbersInSpanish[currentSet] || currentSet.toString();
  speak(`Serie ${setText}`);
}

function finishWorkout() {
  const feedback = document.getElementById('feedback');
  feedback.textContent = `🏆 ¡Completado! Total: ${currentRep} reps en ${currentSet} series.`;
  feedback.style.color = '#00ff88';
  hideControlsBottom();
  
  vibrate(VIBRATE_FINISH);
  speak('¡Entrenamiento completado!');
}

document.getElementById('btn-rotate-overlay').addEventListener('click', async () => {
  if (isSwitching) return;
  isSwitching = true;
  const feedback = document.getElementById('feedback');
  feedback.textContent = '🔄 Cambiando...';
  
  try {
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
    }
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: currentFacingMode, width: { ideal: 640 }, height: { ideal: 480 } } 
    });
    video.srcObject = stream;
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        resolve();
      };
    });
    feedback.textContent = '✅ Cámara cambiada';
  } catch (error) {
    feedback.textContent = '❌ Error al cambiar';
  } finally { isSwitching = false; }
});

document.getElementById('btn-back').addEventListener('click', () => {
  isRunning = false;
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  hideControlsBottom();
  workoutScreen.style.display = 'none';
  setupScreen.style.display = 'block';
  window.speechSynthesis.cancel();
});

const searchInput = document.getElementById('exercise-search');
const searchResults = document.getElementById('search-results');
const exerciseSelect = document.getElementById('exercise-select');
const selectedExerciseDiv = document.getElementById('selected-exercise');
let setsValue = 3;
let repsValue = 10;

searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  if (query.length === 0) {
    searchResults.classList.remove('active');
    return;
  }
  
  const filtered = exercisesDB.filter(ex => ex.name.toLowerCase().includes(query));
  
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
      const id = item.dataset.id;
      const ex = exercisesDB.find(e => e.id === id);
      exerciseSelect.value = id;
      selectedExerciseDiv.textContent = `${ex.name} ${ex.icon}`;
      selectedExerciseDiv.classList.add('active');
      searchInput.value = '';
      searchResults.classList.remove('active');
    });
  });
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});

document.querySelectorAll('.btn-minus[data-target="sets"], .btn-plus[data-target="sets"]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('btn-minus')) {
      if (setsValue > 1) setsValue--;
    } else {
      if (setsValue < 10) setsValue++;
    }
    document.getElementById('sets-display').textContent = setsValue;
  });
});

document.querySelectorAll('.btn-minus[data-target="reps"], .btn-plus[data-target="reps"]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('btn-minus')) {
      if (repsValue > 1) repsValue--;
    } else {
      if (repsValue < 50) repsValue++;
    }
    document.getElementById('reps-display').textContent = repsValue;
  });
});

document.getElementById('btn-start').addEventListener('click', async () => {
  // INICIALIZAR AUDIO CON LA PRIMERA INTERACCIÓN DEL USUARIO
  initAudio();
  
  selectedExercise = exerciseSelect.value;
  targetSets = setsValue;
  targetReps = repsValue;
  currentSet = 1;
  currentRep = 0;
  stage = 'down';

  updateInfoText();

  setupScreen.style.display = 'none';
  workoutScreen.style.display = 'flex';
  hideControlsBottom();

  const feedback = document.getElementById('feedback');
  try {
    feedback.textContent = '📹 Preparando...';
    await setupCamera();
    feedback.textContent = '🤖 Cargando IA...';
    await loadModel();
    feedback.textContent = '✅ Listo';
    detectPose();
  } catch (error) {
    feedback.textContent = '❌ Error';
  }
});

const exerciseInstructions = {
  curl: {
    title: "🏋️ Curl de Bíceps",
    content: `<div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Vertical (parado)</div><div class="instruction-item"><span class="emoji-big"></span><strong>Posición:</strong> De frente al celular, a 1-2 metros</div><div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> De pie, brazos a los costados, torso visible</div><div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo y que no adelantes los codos</div>`
  },
  squat: {
    title: "🦵 Sentadilla",
    content: `<div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Vertical (parado)</div><div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL al celular, a 2-3 metros</div><div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> De pie, cuerpo completo visible (de cabeza a pies)</div><div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo de rodilla (debe bajar a 90°) y espalda recta</div>`
  },
  pushup: {
    title: "💪 Flexiones",
    content: `<div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Horizontal (acostado)</div><div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL al celular, a 1.5-2 metros</div><div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> En el suelo, cuerpo completo visible</div><div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo (45° óptimo) y que bajes el pecho cerca del suelo</div>`
  },
  bench_press: {
    title: "🏋️ Press de Banca",
    content: `<div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Horizontal (acostado)</div><div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL a la banca, a 1.5-2 metros</div><div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> Acostado en la banca, cuerpo completo visible de lado</div><div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo (45-75° seguro) y que la barra baje al pecho</div>`
  },
  incline_press: {
    title: "📐 Press Inclinado",
    content: `<div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Horizontal (acostado)</div><div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL a la banca inclinada, a 1.5-2 metros</div><div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> Acostado en banca a 30°, cuerpo completo visible</div><div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo y que bajes la barra al pecho superior</div>`
  },
  lat_pulldown: {
    title: "⬇️ Jalón al Pecho",
    content: `<div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Vertical (parado)</div><div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL a la máquina, a 2-3 metros</div><div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> Sentado, cuerpo completo visible de lado</div><div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo y que la barra llegue al pecho</div>`
  },
  seated_row: {
    title: "🚣 Remo en V",
    content: `<div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Horizontal (acostado)</div><div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL a la máquina, a 2-3 metros</div><div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> Sentado, cuerpo completo visible de lado</div><div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo y que tires el agarre hacia el abdomen</div>`
  }
};

document.getElementById('btn-help').addEventListener('click', () => {
  const exercise = exerciseSelect.value;
  const instructions = exerciseInstructions[exercise];
  document.getElementById('modal-title').textContent = instructions.title;
  document.getElementById('modal-body').innerHTML = instructions.content;
  document.getElementById('help-modal').style.display = 'flex';
});

document.querySelector('.close-modal').addEventListener('click', () => {
  document.getElementById('help-modal').style.display = 'none';
});

document.getElementById('btn-close-modal').addEventListener('click', () => {
  document.getElementById('help-modal').style.display = 'none';
});

window.addEventListener('click', (event) => {
  const modal = document.getElementById('help-modal');
  if (event.target === modal) {
    modal.style.display = 'none';
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) {
    searchResults.classList.remove('active');
  }
});