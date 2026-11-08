let video, canvas, ctx, detector;
let currentFacingMode = 'environment'; // Forzar cámara trasera al inicio
let isRunning = false;

async function setupCamera() {
  video = document.getElementById('video');
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  // Detener stream anterior si existe
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: { exact: currentFacingMode },
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
    // Si falla con 'exact', intentar con 'ideal'
    console.log('Reintentando con ideal...');
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
    } catch (error2) {
      console.error('Error cámara:', error2);
      throw error2;
    }
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
  
  // Dibujar puntos
  ctx.fillStyle = '#00ff00';
  keypoints.forEach(kp => {
    if (kp.score > 0.3) {
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, 8, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
  
  // Dibujar líneas
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
  if (isRunning) return;
  isRunning = true;
  
  const feedback = document.getElementById('feedback');
  
  while (isRunning && video.srcObject) {
    try {
      if (detector && video.readyState === 4) {
        const poses = await detector.estimatePoses(video);
        
        if (poses.length > 0) {
          const keypoints = poses[0].keypoints;
          drawSkeleton(keypoints);
          
          // Detectar curl de bíceps
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
    
    // Pequeña pausa para no saturar
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  isRunning = false;
}

// Botón para cambiar cámara
document.getElementById('btn-rotate').addEventListener('click', async () => {
  const feedback = document.getElementById('feedback');
  
  // Detener detección actual
  isRunning = false;
  
  // Cambiar modo de cámara
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  
  feedback.textContent = '🔄 Cambiando...';
  
  try {
    // Solo cambiar el stream de video, NO reiniciar el detector
    await setupCamera();
    
    feedback.textContent = '✅ Cámara cambiada';
    
    // Reiniciar detección
    setTimeout(() => {
      detectPose();
    }, 500);
    
  } catch (error) {
    console.error('Error al cambiar:', error);
    feedback.textContent = '❌ Error al cambiar cámara';
  }
});

// Inicialización
async function init() {
  const feedback = document.getElementById('feedback');
  
  try {
    feedback.textContent = '📹 Preparando cámara trasera...';
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