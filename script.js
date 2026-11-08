let video, canvas, ctx, detector;
let facingMode = 'environment'; // 'environment' = cámara trasera (por defecto)
let isDetecting = false;

async function setupCamera() {
  video = document.getElementById('video');
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  
  // Detener streams anteriores si existen
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: facingMode,
        width: { ideal: 640 },
        height: { ideal: 480 }
      } 
    });
    video.srcObject = stream;
    
    return new Promise(resolve => {
      video.onloadedmetadata = () => {
        video.width = video.videoWidth;
        video.height = video.videoHeight;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        resolve();
      };
    });
  } catch (error) {
    console.error('Error al acceder a la cámara:', error);
    document.getElementById('feedback').textContent = ' Error de cámara';
    throw error;
  }
}

async function loadModel() {
  // Cerrar detector anterior si existe
  if (detector) {
    await detector.close();
  }
  
  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
  );
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
  
  // Dibujar puntos en las articulaciones
  ctx.fillStyle = '#00ff00';
  keypoints.forEach(kp => {
    if (kp.score > 0.3) {
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, 8, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
  
  // Dibujar líneas conectando articulaciones
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
  if (isDetecting) return; // Evitar múltiples ejecuciones simultáneas
  isDetecting = true;
  
  try {
    while (true) {
      if (!detector || !video.srcObject) {
        break;
      }
      
      const poses = await detector.estimatePoses(video);
      
      if (poses.length > 0) {
        const keypoints = poses[0].keypoints;
        
        drawSkeleton(keypoints);
        
        // Detectar curl de bíceps (codo izquierdo)
        const leftShoulder = keypoints.find(kp => kp.name === 'left_shoulder');
        const leftElbow = keypoints.find(kp => kp.name === 'left_elbow');
        const leftWrist = keypoints.find(kp => kp.name === 'left_wrist');
        
        if (leftShoulder && leftElbow && leftWrist && 
            leftShoulder.score > 0.3 && leftElbow.score > 0.3 && leftWrist.score > 0.3) {
          
          const angle = calculateAngle(leftShoulder, leftElbow, leftWrist);
          
          const feedback = document.getElementById('feedback');
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
        } else {
          const feedback = document.getElementById('feedback');
          if (feedback.textContent === 'Preparando cámara...') {
            feedback.textContent = '📹 Cámara lista - Muévete para detectar';
            feedback.style.color = '#ffd43b';
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 100)); // Pequeña pausa
    }
  } catch (error) {
    console.error('Error en detección:', error);
  } finally {
    isDetecting = false;
  }
}

// Botón para cambiar cámara
document.getElementById('btn-rotate').addEventListener('click', async () => {
  const feedback = document.getElementById('feedback');
  feedback.textContent = ' Cambiando cámara...';
  
  // Cambiar entre frontal y trasera
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  
  try {
    // Detener detección actual
    isDetecting = false;
    
    // Reiniciar cámara
    await setupCamera();
    
    // Recargar modelo
    await loadModel();
    
    feedback.textContent = '✅ Cámara cambiada';
    
    // Reiniciar detección después de un momento
    setTimeout(() => {
      detectPose();
    }, 500);
    
  } catch (error) {
    feedback.textContent = ' Error al cambiar cámara';
    console.error(error);
  }
});

async function init() {
  const feedback = document.getElementById('feedback');
  
  try {
    await setupCamera();
    await loadModel();
    feedback.textContent = '✅ Cámara lista';
    await detectPose();
  } catch (error) {
    feedback.textContent = '❌ Error al iniciar';
    console.error(error);
  }
}

// Iniciar cuando la página cargue
window.addEventListener('load', init);