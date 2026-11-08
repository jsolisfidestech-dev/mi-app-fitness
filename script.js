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
const workoutInfo = document.getElementById('workout-info');

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

function drawSkeleton(keypoints, isBadPosture) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const color = isBadPosture ? '#ff0000' : '#00ff00';
  
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
          
          if (selectedExercise === 'curl') {
            const rs = keypoints.find(k => k.name === 'right_shoulder');
            const re = keypoints.find(k => k.name === 'right_elbow');
            const rw = keypoints.find(k => k.name === 'right_wrist');
            
            if (rs && re && rw && rs.score > 0.3 && re.score > 0.3 && rw.score > 0.3) {
              const angle = calculateAngle(rs, re, rw);
              
              if (angle > 160) {
                stage = 'down';
                feedback.textContent = 'Brazo estirado. ¡Sube!';
                feedback.style.color = '#ffd43b';
              } else if (angle < 50) {
                if (stage === 'down') {
                  currentRep++;
                  stage = 'up';
                  updateInfoText();
                  
                  if (currentRep === targetReps) {
                    feedback.textContent = `🎉 ¡Meta cumplida! Llevas ${currentRep}/${targetReps}`;
                    feedback.style.color = '#51cf66';
                    showNextSetButton();
                  } else if (currentRep > targetReps) {
                    feedback.textContent = `💪 ¡Extra! Llevas ${currentRep} reps`;
                    feedback.style.color = '#51cf66';
                  } else {
                    feedback.textContent = `✅ Rep ${currentRep}/${targetReps}. ¡Seguí!`;
                    feedback.style.color = '#51cf66';
                  }
                } else {
                  feedback.textContent = 'Bien, bajá controlado.';
                  feedback.style.color = '#51cf66';
                }
              } else {
                feedback.textContent = `Subiendo... ${Math.round(angle)}°`;
                feedback.style.color = '#ffd43b';
              }
            }
          } else {
            let instruction = '';
            if (selectedExercise === 'squat' || selectedExercise === 'pushup') {
              instruction = '📱 Colocate de PERFIL para este ejercicio';
            } else if (selectedExercise === 'bench_press' || selectedExercise === 'incline_press') {
              instruction = '📱 Coloca el celular de PERFIL a la banca';
            } else if (selectedExercise === 'lat_pulldown' || selectedExercise === 'seated_row') {
              instruction = '📱 Coloca el celular de PERFIL a la máquina';
            } else {
              instruction = `Preparando: ${selectedExercise}`;
            }
            feedback.textContent = instruction;
          }
          
          drawSkeleton(keypoints, isBadPosture);
        }
      }
    } catch (error) { console.error('Error detección:', error); }
    await new Promise(r => setTimeout(r, 50));
  }
}

function updateInfoText() {
  workoutInfo.textContent = `Serie ${currentSet}/${targetSets} | Rep ${currentRep}`;
}

function showNextSetButton() {
  const controls = document.querySelector('.controls');
  const oldBtn = document.getElementById('btn-next-set');
  if (oldBtn) return;
  
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
  controls.appendChild(btn);
}

function nextSet() {
  currentSet++;
  currentRep = 0;
  stage = 'down';
  updateInfoText();
  
  const feedback = document.getElementById('feedback');
  feedback.textContent = `¡Vamos con la Serie ${currentSet}!`;
  feedback.style.color = '#ffd43b';
  
  const btn = document.getElementById('btn-next-set');
  if (btn) btn.remove();
}

function finishWorkout() {
  const feedback = document.getElementById('feedback');
  feedback.textContent = `🏆 ¡Completado! Total: ${currentRep} reps en ${currentSet} series.`;
  feedback.style.color = '#51cf66';
  
  const btn = document.getElementById('btn-next-set');
  if (btn) btn.remove();
}

document.getElementById('btn-rotate').addEventListener('click', async () => {
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
  workoutScreen.style.display = 'none';
  setupScreen.style.display = 'block';
  const btn = document.getElementById('btn-next-set');
  if (btn) btn.remove();
});

document.getElementById('btn-start').addEventListener('click', async () => {
  selectedExercise = document.getElementById('exercise-select').value;
  targetSets = parseInt(document.getElementById('sets-input').value);
  targetReps = parseInt(document.getElementById('reps-input').value);
  currentSet = 1;
  currentRep = 0;
  stage = 'down';

  updateInfoText();

  setupScreen.style.display = 'none';
  workoutScreen.style.display = 'block';

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
    content: `
      <div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Vertical (parado)</div>
      <div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De frente al celular, a 1-2 metros</div>
      <div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> De pie, brazos a los costados, torso visible</div>
      <div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo (debe llegar a 90° o menos)</div>
    `
  },
  squat: {
    title: "🦵 Sentadilla",
    content: `
      <div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Vertical (parado)</div>
      <div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL al celular, a 2-3 metros</div>
      <div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> De pie, cuerpo completo visible (de cabeza a pies)</div>
      <div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo de rodilla (debe bajar a 90°) y espalda recta</div>
    `
  },
  pushup: {
    title: "💪 Flexiones",
    content: `
      <div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Horizontal (acostado)</div>
      <div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL al celular, a 1.5-2 metros</div>
      <div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> En el suelo, cuerpo completo visible</div>
      <div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo y que bajes el pecho cerca del suelo</div>
    `
  },
  bench_press: {
    title: "🏋️ Press de Banca",
    content: `
      <div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Horizontal (acostado)</div>
      <div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL a la banca, a 1.5-2 metros</div>
      <div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> Acostado en la banca, cuerpo completo visible de lado</div>
      <div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo (90° al bajar) y que la barra baje al pecho</div>
    `
  },
  incline_press: {
    title: "📐 Press Inclinado",
    content: `
      <div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Horizontal (acostado)</div>
      <div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL a la banca inclinada, a 1.5-2 metros</div>
      <div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> Acostado en banca a 30-45°, cuerpo completo visible</div>
      <div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo y que bajes la barra al pecho superior</div>
    `
  },
  lat_pulldown: {
    title: "⬇️ Jalón al Pecho",
    content: `
      <div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Vertical (parado)</div>
      <div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL a la máquina, a 2-3 metros</div>
      <div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> Sentado, cuerpo completo visible de lado</div>
      <div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo y que la barra llegue al pecho</div>
    `
  },
  seated_row: {
    title: "🚣 Remo en V",
    content: `
      <div class="instruction-item"><span class="emoji-big">📱</span><strong>Orientación:</strong> Horizontal (acostado)</div>
      <div class="instruction-item"><span class="emoji-big">📍</span><strong>Posición:</strong> De PERFIL a la máquina, a 2-3 metros</div>
      <div class="instruction-item"><span class="emoji-big">👤</span><strong>Tu cuerpo:</strong> Sentado, cuerpo completo visible de lado</div>
      <div class="instruction-item"><span class="emoji-big">✅</span><strong>Qué detecta:</strong> Ángulo del codo y que tires el agarre hacia el abdomen</div>
    `
  }
};

document.getElementById('btn-help').addEventListener('click', () => {
  const exercise = document.getElementById('exercise-select').value;
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