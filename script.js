let video, canvas, ctx, detector;
let currentFacingMode = 'user'; // Inicia con FRONTAL
let isSwitching = false; // Control para evitar errores al cambiar

async function setupCamera() {
  video = document.getElementById('video');
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: currentFacingMode,
        width: { ideal: 640 },
        height: { ideal: 480 }
      } 
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
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'],
    ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'],
    ['right_knee', 'right_ankle']
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
  
  while (true) {
    // Si estamos cambiando de cámara, esperamos
    if (isSwitching) {
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }

    try {
      if (detector && video.srcObject && video.readyState === 4) {
        const poses = await detector.estimatePoses(video);
        
        if (poses.length > 0) {
          const keypoints = poses[0].keypoints;
          drawSkeleton(keypoints);
          
          const leftShoulder = keypoints.find(kp => kp.name === 'left_shoulder');
          const leftElbow = keypoints.find(kp => kp.name === 'left_elbow');
          const leftWrist = keypoints.find(kp => kp.name === 'left_wrist');
          
          if (leftShoulder && leftElbow && leftWrist && 
              leftShoulder.score > 0.3 && leftElbow.score > 0.3 && leftWrist.score > 0.3) {
            
            const angle = calculateAngle(leftShoulder, leftElbow, leftWrist);
            
            if (angle < 60) {
              feedback.textContent = '✅ ¡Bien! Sube el peso';
              feedback.style.color = '#51cf66';
            } else if (angle > 160) {
              feedback.textContent = '⬇️ Baja más el peso';
              feedback.style.color = '#ff6b6b';
            } else {
              feedback.textContent = `Ángulo codo: ${Math.round(angle)}°`;
              feedback.style.color = '#ffd43b';
            }
          }
        }
      }
    } catch (error) {
      console.error('Error detección:', error);
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

// Botón para cambiar cámara (SIN recargar la página)
document.getElementById('btn-rotate').addEventListener('click', async () => {
  if (isSwitching) return; // Evita doble clic
  
  isSwitching = true;
  const feedback = document.getElementById('feedback');
  feedback.textContent = '🔄 Cambiando cámara...';
  
  try {
    // 1. Detener la cámara actual
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }
    
    // 2. Cambiar el modo
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    
    // 3. Iniciar la nueva cámara
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: currentFacingMode,
        width: { ideal: 640 },
        height: { ideal: 480 }
      } 
    });
    
    video.srcObject = stream;
    
    // 4. Esperar a que el video esté listo
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        resolve();
      };
    });
    
    feedback.textContent = '✅ Cámara cambiada';
    
  } catch (error) {
    console.error('Error al cambiar:', error);
    feedback.textContent = '❌ Error al cambiar';
  } finally {
    isSwitching = false;
  }
});

// Inicialización
async function init() {
  const feedback = document.getElementById('feedback');
  
  try {
    feedback.textContent = '📹 Preparando cámara frontal...';
    await setupCamera();
    feedback.textContent = '🤖 Cargando IA...';
    await loadModel();
    feedback.textContent = '✅ Listo para entrenar';
    detectPose();
  } catch (error) {
    console.error('Error inicial:', error);
    feedback.textContent = '❌ Error al iniciar';
  }
}

window.addEventListener('load', init);