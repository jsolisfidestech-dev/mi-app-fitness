// ===== SISTEMA DE INSTRUCCIONES =====

const exerciseInstructions = {
  curl: {
    title: "🏋️ Curl de Bíceps",
    content: `
      <div class="instruction-item">
        <span class="emoji-big">📱</span>
        <strong>Orientación:</strong> Vertical (parado)
      </div>
      <div class="instruction-item">
        <span class="emoji-big">📍</span>
        <strong>Posición:</strong> De frente al celular, a 1-2 metros de distancia
      </div>
      <div class="instruction-item">
        <span class="emoji-big">👤</span>
        <strong>Tu cuerpo:</strong> De pie, brazos a los costados, torso visible completo
      </div>
      <div class="instruction-item">
        <span class="emoji-big">✅</span>
        <strong>Qué detecta:</strong> Ángulo del codo (debe llegar a 90° o menos al subir)
      </div>
    `
  },
  squat: {
    title: "🦵 Sentadilla",
    content: `
      <div class="instruction-item">
        <span class="emoji-big">📱</span>
        <strong>Orientación:</strong> Vertical (parado)
      </div>
      <div class="instruction-item">
        <span class="emoji-big">📍</span>
        <strong>Posición:</strong> De PERFIL al celular, a 2-3 metros de distancia
      </div>
      <div class="instruction-item">
        <span class="emoji-big">👤</span>
        <strong>Tu cuerpo:</strong> De pie, cuerpo completo visible (de cabeza a pies)
      </div>
      <div class="instruction-item">
        <span class="emoji-big">✅</span>
        <strong>Qué detecta:</strong> Ángulo de rodilla (debe bajar a 90°) y espalda recta
      </div>
    `
  },
  pushup: {
    title: "💪 Flexiones",
    content: `
      <div class="instruction-item">
        <span class="emoji-big">📱</span>
        <strong>Orientación:</strong> Horizontal (acostado)
      </div>
      <div class="instruction-item">
        <span class="emoji-big">📍</span>
        <strong>Posición:</strong> De PERFIL al celular, a 1.5-2 metros de distancia
      </div>
      <div class="instruction-item">
        <span class="emoji-big">👤</span>
        <strong>Tu cuerpo:</strong> En el suelo, cuerpo completo visible
      </div>
      <div class="instruction-item">
        <span class="emoji-big">✅</span>
        <strong>Qué detecta:</strong> Ángulo del codo y que bajes el pecho cerca del suelo
      </div>
    `
  },
  bench_press: {
    title: "🏋️ Press de Banca",
    content: `
      <div class="instruction-item">
        <span class="emoji-big">📱</span>
        <strong>Orientación:</strong> Horizontal (acostado)
      </div>
      <div class="instruction-item">
        <span class="emoji-big">📍</span>
        <strong>Posición:</strong> De PERFIL a la banca, a 1.5-2 metros de distancia
      </div>
      <div class="instruction-item">
        <span class="emoji-big">👤</span>
        <strong>Tu cuerpo:</strong> Acostado en la banca, cuerpo completo visible de lado
      </div>
      <div class="instruction-item">
        <span class="emoji-big">✅</span>
        <strong>Qué detecta:</strong> Ángulo del codo (90° al bajar) y que la barra baje al pecho
      </div>
    `
  },
  incline_press: {
    title: "📐 Press Inclinado",
    content: `
      <div class="instruction-item">
        <span class="emoji-big">📱</span>
        <strong>Orientación:</strong> Horizontal (acostado)
      </div>
      <div class="instruction-item">
        <span class="emoji-big">📍</span>
        <strong>Posición:</strong> De PERFIL a la banca inclinada, a 1.5-2 metros
      </div>
      <div class="instruction-item">
        <span class="emoji-big">👤</span>
        <strong>Tu cuerpo:</strong> Acostado en banca a 30-45°, cuerpo completo visible
      </div>
      <div class="instruction-item">
        <span class="emoji-big">✅</span>
        <strong>Qué detecta:</strong> Ángulo del codo y que bajes la barra al pecho superior
      </div>
    `
  },
  lat_pulldown: {
    title: "⬇️ Jalón al Pecho",
    content: `
      <div class="instruction-item">
        <span class="emoji-big">📱</span>
        <strong>Orientación:</strong> Vertical (parado)
      </div>
      <div class="instruction-item">
        <span class="emoji-big">📍</span>
        <strong>Posición:</strong> De PERFIL a la máquina, a 2-3 metros de distancia
      </div>
      <div class="instruction-item">
        <span class="emoji-big">👤</span>
        <strong>Tu cuerpo:</strong> Sentado, cuerpo completo visible de lado
      </div>
      <div class="instruction-item">
        <span class="emoji-big">✅</span>
        <strong>Qué detecta:</strong> Ángulo del codo y que la barra llegue al pecho
      </div>
    `
  },
  seated_row: {
    title: "🚣 Remo en V",
    content: `
      <div class="instruction-item">
        <span class="emoji-big">📱</span>
        <strong>Orientación:</strong> Horizontal (acostado)
      </div>
      <div class="instruction-item">
        <span class="emoji-big">📍</span>
        <strong>Posición:</strong> De PERFIL a la máquina, a 2-3 metros de distancia
      </div>
      <div class="instruction-item">
        <span class="emoji-big">👤</span>
        <strong>Tu cuerpo:</strong> Sentado, cuerpo completo visible de lado
      </div>
      <div class="instruction-item">
        <span class="emoji-big">✅</span>
        <strong>Qué detecta:</strong> Ángulo del codo y que tires el agarre hacia el abdomen
      </div>
    `
  }
};

// Mostrar modal de ayuda
document.getElementById('btn-help').addEventListener('click', () => {
  const exercise = document.getElementById('exercise-select').value;
  const instructions = exerciseInstructions[exercise];
  
  document.getElementById('modal-title').textContent = instructions.title;
  document.getElementById('modal-body').innerHTML = instructions.content;
  document.getElementById('help-modal').style.display = 'flex';
});

// Cerrar modal
document.querySelector('.close-modal').addEventListener('click', () => {
  document.getElementById('help-modal').style.display = 'none';
});

document.getElementById('btn-close-modal').addEventListener('click', () => {
  document.getElementById('help-modal').style.display = 'none';
});

// Cerrar modal al hacer clic fuera
window.addEventListener('click', (event) => {
  const modal = document.getElementById('help-modal');
  if (event.target === modal) {
    modal.style.display = 'none';
  }
});