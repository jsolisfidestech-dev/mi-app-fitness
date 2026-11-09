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

const setupScreen = document.getElementById('setup-screen');
const workoutScreen = document.getElementById('workout-screen');
const overlayCounter = document.getElementById('overlay-counter');
const controlsBottom = document.getElementById('controls-bottom');

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

// ===== FUNCIONES DE CÁMARA E IA =====

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

// Dibuja el esqueleto: verde si está bien, rojo si hay mala postura
function drawSkeleton(keypoints, isBadPosture) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const color = isBadPosture ? '#ff4444' : '#00ff88';
  
  ctx.fillStyle = color;
  keypoints.forEach(kp => {
    if (kp.score > 0.3) {
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, 8, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
  
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
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
      ctx.beginPath();
      ctx.moveTo(kp1.x, kp1.y);
      ctx.lineTo(kp2.x, kp2.y);
      ctx.stroke();
    }
  });
}

// ===== DETECCIÓN DE POSTURA CON LÓGICA CIENTÍFICA =====

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
          const keypoints = poses[0].keypoints;
          let isBadPosture = false;
          let warningMessage = '';
          
          // ===== CURL DE BÍCEPS =====
          if (selectedExercise === 'curl') {
            const rs = keypoints.find(k => k.name === 'right_shoulder');
            const re = keypoints.find(k => k.name === 'right_elbow');
            const rw = keypoints.find(k => k.name === 'right_wrist');
            
            if (rs && re && rw && rs.score > 0.3 && re.score > 0.3 && rw.score > 0.3) {
              const angle = calculateAngle(rs, re, rw);
              
              // Detectar si el codo se mueve hacia adelante (error común según ciencia)
              const shoulderX = rs.x;
              const elbowX = re.x;
              const elbowForward = Math.abs(elbowX - shoulderX) > 50;
              
              if (elbowForward) {
                isBadPosture = true;
                warningMessage = '❌ No muevas el codo hacia adelante';
              }
              
              if (angle > 160) {
                stage = 'down';
                if (!isBadPosture) {
                  feedback.textContent = 'Brazo estirado. ¡Sube!';
                  feedback.style.color = '#ffd43b';
                }
              } else if (angle < 50) {
                if (stage === 'down') {
                  currentRep++;
                  stage = 'up';
                  updateInfoText();
                  
                  if (currentRep === targetReps) {
                    feedback.textContent = `🎉 ¡Meta cumplida! Llevas ${currentRep}/${targetReps}`;
                    feedback.style.color = '#00ff88';
                    showNextSetButton();
                  } else if (currentRep > targetReps) {
                    feedback.textContent = `💪 ¡Extra! Llevas ${currentRep} reps`;
                    feedback.style.color = '#00ff88';
                  } else {
                    feedback.textContent = `✅ Rep ${currentRep}/${targetReps}. ¡Seguí!`;
                    feedback.style.color = '#00ff88';
                  }
                } else {
                  if (!isBadPosture) feedback.textContent = 'Bien, bajá controlado.';
                  feedback.style.color = '#00ff88';
                }
              } else {
                if (!isBadPosture) {
                  feedback.textContent = `Subiendo... ${Math.round(angle)}°`;
                  feedback.style.color = '#ffd43b';
                }
              }
            }
          }
          
          // ===== SENTADILLA =====
          else if (selectedExercise === 'squat') {
            const hip = keypoints.find(k => k.name === 'left_hip');
            const knee = keypoints.find(k => k.name === 'left_knee');
            const ankle = keypoints.find(k => k.name === 'left_ankle');
            const shoulder = keypoints.find(k => k.name === 'left_shoulder');
            
            if (hip && knee && ankle && hip.score > 0.3 && knee.score > 0.3 && ankle.score > 0.3) {
              const kneeAngle = calculateAngle(hip, knee, ankle);
              
              // Según ciencia: 90° es óptimo. Más de 100° = profundidad insuficiente
              if (kneeAngle > 100) {
                isBadPosture = true;
                warningMessage = '❌ Bajá más (llegá a 90°)';
              }
              
              // Detectar espalda encorvada (hombro mucho más adelante que cadera)
              if (shoulder && shoulder.score > 0.3) {
                const shoulderForward = shoulder.x - hip.x;
                if (shoulderForward > 60) {
                  isBadPosture = true;
                  warningMessage = '❌ Mantené la espalda recta';
                }
              }
              
              feedback.textContent = `Rodilla: ${Math.round(kneeAngle)}°`;
              feedback.style.color = isBadPosture ? '#ff4444' : '#ffd43b';
            }
          }
          
          // ===== FLEXIONES =====
          else if (selectedExercise === 'pushup') {
            const shoulder = keypoints.find(k => k.name === 'right_shoulder');
            const elbow = keypoints.find(k => k.name === 'right_elbow');
            const wrist = keypoints.find(k => k.name === 'right_wrist');
            
            if (shoulder && elbow && wrist && shoulder.score > 0.3 && elbow.score > 0.3 && wrist.score > 0.3) {
              const elbowAngle = calculateAngle(shoulder, elbow, wrist);
              
              // Según ciencia: 45° es el ángulo óptimo. Más de 70° = peligroso para hombros
              const shoulderX = shoulder.x;
              const elbowX = elbow.x;
              const elbowFlared = Math.abs(elbowX - shoulderX) > 80;
              
              if (elbowFlared) {
                isBadPosture = true;
                warningMessage = '❌ Codos muy abiertos (usá 45°)';
              }
              
              feedback.textContent = `Codo: ${Math.round(elbowAngle)}°`;
              feedback.style.color = isBadPosture ? '#ff4444' : '#ffd43b';
            }
          }
          
          // ===== PRESS DE BANCA / INCLINADO =====
          else if (selectedExercise === 'bench_press' || selectedExercise === 'incline_press') {
            const shoulder = keypoints.find(k => k.name === 'right_shoulder');
            const elbow = keypoints.find(k => k.name === 'right_elbow');
            const wrist = keypoints.find(k => k.name === 'right_wrist');
            
            if (shoulder && elbow && wrist && shoulder.score > 0.3 && elbow.score > 0.3 && wrist.score > 0.3) {
              const elbowAngle = calculateAngle(shoulder, elbow, wrist);
              
              // Según ciencia: 45-75° es seguro. Más de 80° = riesgo de lesión
              if (elbowAngle > 80 && elbowAngle < 160) {
                isBadPosture = true;
                warningMessage = '❌ Codos muy abiertos (45-75°)';
              }
              
              feedback.textContent = `Codo: ${Math.round(elbowAngle)}°`;
              feedback.style.color = isBadPosture ? '#ff4444' : '#ffd43b';
            }
          }
          
          // ===== JALÓN AL PECHO =====
          else if (selectedExercise === 'lat_pulldown') {
            const shoulder = keypoints.find(k => k.name === 'right_shoulder');
            const elbow = keypoints.find(k => k.name === 'right_elbow');
            const wrist = keypoints.find(k => k.name === 'right_wrist');
            
            if (shoulder && elbow && wrist && shoulder.score > 0.3 && elbow.score > 0.3 && wrist.score > 0.3) {
              const elbowAngle = calculateAngle(shoulder, elbow, wrist);
              
              feedback.textContent = `Codo: ${Math.round(elbowAngle)}°`;
              feedback.style.color = '#ffd43b';
            }
          }
          
          // ===== REMO EN V =====
          else if (selectedExercise === 'seated_row') {
            const shoulder = keypoints.find(k => k.name === 'right_shoulder');
            const elbow = keypoints.find(k => k.name === 'right_elbow');
            const wrist = keypoints.find(k => k.name === 'right_wrist');
            
            if (shoulder && elbow && wrist && shoulder.score > 0.3 && elbow.score > 0.3 && wrist.score > 0.3) {
              const elbowAngle = calculateAngle(shoulder, elbow, wrist);
              
              feedback.textContent = `Codo: ${Math.round(elbowAngle)}°`;
              feedback.style.color = '#ffd43b';
            }
          }
          
          // Mostrar mensaje de advertencia si hay mala postura
          if (isBadPosture && warningMessage) {
            feedback.textContent = warningMessage;
            feedback.style.color = '#ff4444';
          }
          
          drawSkeleton(keypoints, isBadPosture);
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
}

function finishWorkout() {
  const feedback = document.getElementById('feedback');
  feedback.textContent = `🏆 ¡Completado! Total: ${currentRep} reps en ${currentSet} series.`;
  feedback.style.color = '#00ff88';
  hideControlsBottom();
}

// ===== CONTROLES DE CÁMARA Y NAVEGACIÓN =====

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
});

// ===== BUSCADOR Y CONTADORES =====

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

// ===== SISTEMA DE INSTRUCCIONES =====

const exerciseInstructions = {
  curl: {
    title: "🏋️ Curl de Bíceps",
    content: `<div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Vertical (parado)</div><div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De frente al celular, a 1-2 metros</div><div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> De pie, brazos a los costados, torso visible</div><div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo (debe llegar a 90° o menos)</div>`
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