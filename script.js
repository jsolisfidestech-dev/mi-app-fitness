let video, canvas, ctx, detector;
let currentFacingMode = 'user'; 
let isSwitching = false;

// Variables del entrenamiento
let selectedExercise = 'curl';
let targetSets = 3;
let targetReps = 10;
let currentSet = 1;
let currentRep = 0;

// Referencias al DOM (Pantallas)
const setupScreen = document.getElementById('setup-screen');
const workoutScreen = document.getElementById('workout-screen');
const workoutInfo = document.getElementById('workout-info');

// --- FUNCIONES DE CÁMARA E IA ---

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

function drawSkeleton(keypoints) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  ctx.fillStyle = '#00ff00';
  keypoints.forEach(kp => {
    if (kp.score > 0.3) {
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, 8, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
  
  ctx.strokeStyle = '#00ff00';
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
  const feedback = document.getElementById('feedback');
  
  while (video.srcObject) {
    if (isSwitching) { await new Promise(r => setTimeout(r, 100)); continue; }

    try {
      if (detector && video.srcObject && video.readyState === 4) {
        const poses = await detector.estimatePoses(video);
        if (poses.length > 0) {
          const keypoints = poses[0].keypoints;
          drawSkeleton(keypoints);
          
          // Lógica básica de ejemplo (la mejoraremos en la Fase 2)
          if (selectedExercise === 'curl') {
            const ls = keypoints.find(k => k.name === 'left_shoulder');
            const le = keypoints.find(k => k.name === 'left_elbow');
            const lw = keypoints.find(k => k.name === 'left_wrist');
            
            if (ls && le && lw && ls.score > 0.3 && le.score > 0.3 && lw.score > 0.3) {
              const angle = calculateAngle(ls, le, lw);
              if (angle < 60) feedback.textContent = '✅ ¡Bien! Sube';
              else if (angle > 160) feedback.textContent = '⬇️ Baja más';
              else feedback.textContent = `Ángulo: ${Math.round(angle)}°`;
            }
          } else {
            feedback.textContent = `Haciendo: ${selectedExercise}`;
          }
        }
      }
    } catch (error) { console.error('Error detección:', error); }
    await new Promise(r => setTimeout(r, 50));
  }
}

// Botón Cambiar Cámara
document.getElementById('btn-rotate').addEventListener('click', async () => {
  if (isSwitching) return;
  isSwitching = true;
  const feedback = document.getElementById('feedback');
  feedback.textContent = '🔄 Cambiando...';
  
  try {
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
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

// Botón Salir (Volver al menú)
document.getElementById('btn-back').addEventListener('click', () => {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  workoutScreen.style.display = 'none';
  setupScreen.style.display = 'block';
});

// Botón INICIAR ENTRENAMIENTO
document.getElementById('btn-start').addEventListener('click', async () => {
  // 1. Guardar datos del formulario
  selectedExercise = document.getElementById('exercise-select').value;
  targetSets = parseInt(document.getElementById('sets-input').value);
  targetReps = parseInt(document.getElementById('reps-input').value);
  currentSet = 1;
  currentRep = 0;

  // 2. Actualizar texto de info
  workoutInfo.textContent = `Serie ${currentSet}/${targetSets} | Rep ${currentRep}/${targetReps}`;

  // 3. Cambiar pantallas
  setupScreen.style.display = 'none';
  workoutScreen.style.display = 'block';

  // 4. Iniciar cámara e IA
  const feedback = document.getElementById('feedback');
  try {
    feedback.textContent = '📹 Preparando cámara...';
    await setupCamera();
    feedback.textContent = '🤖 Cargando IA...';
    await loadModel();
    feedback.textContent = '✅ Listo para entrenar';
    detectPose();
  } catch (error) {
    feedback.textContent = '❌ Error al iniciar';
  }
});