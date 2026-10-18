/**
 * VIBRO NDT Physical Simulator & DSP Processing Engine
 * Simulates Impact-Echo impulse, Hann windowing, pure JS FFT,
 * feature extraction (Centroid, Rolloff, ZCR), and Random Forest verdict.
 */

// Audio context for sound synthesis
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Sound generator mimicking spring center punch impact on steel
function playImpactSound(type) {
  try {
    initAudio();
    if (!audioCtx) return;

    const t = audioCtx.currentTime;
    
    // 1. Transient click
    const oscClick = audioCtx.createOscillator();
    const gainClick = audioCtx.createGain();
    oscClick.type = 'triangle';
    oscClick.frequency.setValueAtTime(type === 'normal' ? 3200 : (type === 'crack' ? 1800 : 2600), t);
    oscClick.frequency.exponentialRampToValueAtTime(120, t + 0.04);
    gainClick.gain.setValueAtTime(0.45, t);
    gainClick.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    oscClick.connect(gainClick);
    gainClick.connect(audioCtx.destination);
    oscClick.start(t);
    oscClick.stop(t + 0.05);

    // 2. Metallic resonant ring
    const oscRing = audioCtx.createOscillator();
    const gainRing = audioCtx.createGain();
    const ringFreq = type === 'normal' ? 2450 : (type === 'crack' ? 1420 : 2100);
    const decayTime = type === 'normal' ? 0.35 : (type === 'crack' ? 0.15 : 0.22);

    oscRing.type = 'sine';
    oscRing.frequency.setValueAtTime(ringFreq, t);
    gainRing.gain.setValueAtTime(0.25, t);
    gainRing.gain.exponentialRampToValueAtTime(0.0001, t + decayTime);
    oscRing.connect(gainRing);
    gainRing.connect(audioCtx.destination);
    oscRing.start(t);
    oscRing.stop(t + decayTime);
  } catch (e) {
    console.warn("Audio synthesis error:", e);
  }
}

// Standard Radix-2 Cooley-Tukey FFT implementation in JS
function fftRadix2(re, im) {
  const n = re.length;
  if (n <= 1) return;

  // Bit reversal
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      let tempRe = re[i]; re[i] = re[j]; re[j] = tempRe;
      let tempIm = im[i]; im[i] = im[j]; im[j] = tempIm;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = -2 * Math.PI / len;
    const wStepRe = Math.cos(angle);
    const wStepIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + halfLen] * wRe - im[i + k + halfLen] * wIm;
        const vIm = re[i + k + halfLen] * wIm + im[i + k + halfLen] * wRe;

        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + halfLen] = uRe - vRe;
        im[i + k + halfLen] = uIm - vIm;

        const nextWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextWRe;
      }
    }
  }
}

// Signal generation parameters
const N = 1024;
const FS = 10000; // 10 kHz sample rate
const DELTA_F = FS / N; // 9.77 Hz per bin

function generateAcousticSample(type, useHann) {
  const raw = new Float32Array(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);

  // Class physical vibration models
  let f1, f2, f3, decay, noiseLevel;
  if (type === 'normal') {
    // Intact beam: high stiffness, high resonant mode, long clean decay
    f1 = 2850 + (Math.random() - 0.5) * 40;
    f2 = 4120 + (Math.random() - 0.5) * 60;
    f3 = 1100 + (Math.random() - 0.5) * 30;
    decay = 42.0;
    noiseLevel = 0.03;
  } else if (type === 'crack') {
    // 1.5mm crack: loss of effective stiffness E*I, resonant shift downwards + damping
    f1 = 1750 + (Math.random() - 0.5) * 50;
    f2 = 2950 + (Math.random() - 0.5) * 70;
    f3 = 850 + (Math.random() - 0.5) * 30;
    decay = 95.0; // Fast damping due to crack friction
    noiseLevel = 0.07;
  } else {
    // 4mm hole: high-frequency wave scattering, split satellite peaks
    f1 = 2320 + (Math.random() - 0.5) * 50;
    f2 = 3450 + (Math.random() - 0.5) * 60;
    f3 = 1450 + (Math.random() - 0.5) * 40;
    decay = 65.0;
    noiseLevel = 0.05;
  }

  // 1. Generate Raw Time Domain waveform with realistic impact envelope
  for (let i = 0; i < N; i++) {
    const t = i / FS;
    // Fast rise time, exponential decay
    const envelope = Math.exp(-decay * t) * (1 - Math.exp(-t * 2500));
    const s1 = 1.00 * Math.sin(2 * Math.PI * f1 * t);
    const s2 = 0.45 * Math.sin(2 * Math.PI * f2 * t + 0.4);
    const s3 = 0.30 * Math.sin(2 * Math.PI * f3 * t + 1.1);
    const noise = (Math.random() - 0.5) * noiseLevel;

    raw[i] = envelope * (s1 + s2 + s3) + noise;
  }

  // 2. DC Offset Removal
  let mean = 0;
  for (let i = 0; i < N; i++) mean += raw[i];
  mean /= N;
  for (let i = 0; i < N; i++) raw[i] -= mean;

  // 3. Apply Window (Hann vs Rectangular)
  for (let i = 0; i < N; i++) {
    let win = 1.0;
    if (useHann) {
      win = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    }
    re[i] = raw[i] * win;
    im[i] = 0;
  }

  // 4. Compute FFT
  fftRadix2(re, im);

  // 5. Magnitude Spectrum (half-spectrum 512 bins up to Nyquist = 5000 Hz)
  const halfN = N / 2;
  const mag = new Float32Array(halfN);
  let totalEnergy = 0;
  let weightedFreqSum = 0;

  for (let k = 0; k < halfN; k++) {
    const val = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    mag[k] = val;
    totalEnergy += val;
    const freq = k * DELTA_F;
    weightedFreqSum += freq * val;
  }

  // 6. Feature Extraction
  // A. Spectral Centroid C = sum(f * mag) / sum(mag)
  const centroid = totalEnergy > 0 ? (weightedFreqSum / totalEnergy) : 0;

  // B. Spectral Rolloff 85%
  let energyAcc = 0;
  let rolloff = 0;
  const threshold = 0.85 * totalEnergy;
  for (let k = 0; k < halfN; k++) {
    energyAcc += mag[k];
    if (energyAcc >= threshold) {
      rolloff = k * DELTA_F;
      break;
    }
  }

  // C. Zero Crossing Rate (ZCR)
  let zeroCrossings = 0;
  for (let i = 1; i < N; i++) {
    if ((raw[i] >= 0 && raw[i - 1] < 0) || (raw[i] < 0 && raw[i - 1] >= 0)) {
      zeroCrossings++;
    }
  }
  const zcr = zeroCrossings / (2 * N);

  // 7. Ensemble Decision Logic (Mimicking embedded Random Forest model)
  let verdict, verdictClass, confidence;
  if (centroid > 2600 && rolloff > 3600) {
    verdict = "НОРМА (БЕЗДЕФЕКТНЫЙ УЗЕЛ)";
    verdictClass = "status-green";
    confidence = (97.4 + Math.random() * 2).toFixed(1);
  } else if (centroid < 2250 || zcr > 0.16) {
    verdict = "ДЕФЕКТ: ТРЕЩИНА 1.5 мм (АНСАМБЛЬ RF)";
    verdictClass = "status-red";
    confidence = (95.1 + Math.random() * 3).toFixed(1);
  } else {
    verdict = "ДЕФЕКТ: СВЕРЛЕНИЕ / ВЫБОРКА Ø4 мм";
    verdictClass = "status-amber";
    confidence = (93.8 + Math.random() * 3).toFixed(1);
  }

  return {
    raw,
    mag,
    centroid: Math.round(centroid),
    rolloff: Math.round(rolloff),
    zcr: zcr.toFixed(4),
    verdict,
    verdictClass,
    confidence
  };
}

// Canvas Visualizers
let timeCanvas, timeCtx;
let freqCanvas, freqCtx;
let currentSampleType = 'normal';
let isHannEnabled = true;

function setupVisualizers() {
  timeCanvas = document.getElementById('timeCanvas');
  timeCtx = timeCanvas.getContext('2d');
  freqCanvas = document.getElementById('freqCanvas');
  freqCtx = freqCanvas.getContext('2d');

  function resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;
    [timeCanvas, freqCanvas].forEach(c => {
      if (!c) return;
      const rect = c.getBoundingClientRect();
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
    });
  }
  window.addEventListener('resize', () => {
    resizeCanvases();
    runDiagnosticCycle();
  });
  resizeCanvases();
}

function drawTimeWaveform(raw) {
  if (!timeCtx) return;
  const w = timeCanvas.width;
  const h = timeCanvas.height;
  const dpr = window.devicePixelRatio || 1;

  timeCtx.clearRect(0, 0, w, h);

  // Grid
  timeCtx.strokeStyle = '#1E293B';
  timeCtx.lineWidth = 1 * dpr;
  timeCtx.beginPath();
  for (let x = 0; x < w; x += 50 * dpr) {
    timeCtx.moveTo(x, 0); timeCtx.lineTo(x, h);
  }
  for (let y = 0; y < h; y += 30 * dpr) {
    timeCtx.moveTo(0, y); timeCtx.lineTo(w, y);
  }
  timeCtx.stroke();

  // Center line
  timeCtx.strokeStyle = '#334155';
  timeCtx.beginPath();
  timeCtx.moveTo(0, h / 2);
  timeCtx.lineTo(w, h / 2);
  timeCtx.stroke();

  // Waveform line
  timeCtx.strokeStyle = '#0EA5E9';
  timeCtx.lineWidth = 1.8 * dpr;
  timeCtx.beginPath();

  const step = w / N;
  const maxAmp = 1.8;
  for (let i = 0; i < N; i++) {
    const x = i * step;
    const y = h / 2 - (raw[i] / maxAmp) * (h / 2 * 0.85);
    if (i === 0) timeCtx.moveTo(x, y);
    else timeCtx.lineTo(x, y);
  }
  timeCtx.stroke();

  // Glow
  timeCtx.strokeStyle = 'rgba(14, 165, 233, 0.3)';
  timeCtx.lineWidth = 4 * dpr;
  timeCtx.stroke();
}

function drawSpectrum(mag, centroid, rolloff) {
  if (!freqCtx) return;
  const w = freqCanvas.width;
  const h = freqCanvas.height;
  const dpr = window.devicePixelRatio || 1;
  const halfN = mag.length;

  freqCtx.clearRect(0, 0, w, h);

  // Grid
  freqCtx.strokeStyle = '#1E293B';
  freqCtx.lineWidth = 1 * dpr;
  freqCtx.beginPath();
  for (let x = 0; x < w; x += 60 * dpr) {
    freqCtx.moveTo(x, 0); freqCtx.lineTo(x, h);
  }
  for (let y = 0; y < h; y += 30 * dpr) {
    freqCtx.moveTo(0, y); freqCtx.lineTo(w, y);
  }
  freqCtx.stroke();

  // Max peak for normalization
  let maxMag = 1;
  for (let i = 0; i < halfN; i++) {
    if (mag[i] > maxMag) maxMag = mag[i];
  }

  // Draw spectrum curve with gradient
  const grad = freqCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
  grad.addColorStop(1, 'rgba(14, 165, 233, 0.02)');

  freqCtx.beginPath();
  freqCtx.moveTo(0, h);
  for (let i = 0; i < halfN; i++) {
    const x = (i / halfN) * w;
    const normY = (mag[i] / maxMag);
    const y = h - normY * (h * 0.88);
    freqCtx.lineTo(x, y);
  }
  freqCtx.lineTo(w, h);
  freqCtx.closePath();
  freqCtx.fillStyle = grad;
  freqCtx.fill();

  // Line outline
  freqCtx.strokeStyle = '#38BDF8';
  freqCtx.lineWidth = 2 * dpr;
  freqCtx.beginPath();
  for (let i = 0; i < halfN; i++) {
    const x = (i / halfN) * w;
    const y = h - (mag[i] / maxMag) * (h * 0.88);
    if (i === 0) freqCtx.moveTo(x, y);
    else freqCtx.lineTo(x, y);
  }
  freqCtx.stroke();

  // Marker: Spectral Centroid (Yellow)
  const centroidX = (centroid / 5000) * w;
  freqCtx.strokeStyle = '#FACC15';
  freqCtx.lineWidth = 2 * dpr;
  freqCtx.setLineDash([4 * dpr, 4 * dpr]);
  freqCtx.beginPath();
  freqCtx.moveTo(centroidX, 0);
  freqCtx.lineTo(centroidX, h);
  freqCtx.stroke();

  // Marker: Spectral Rolloff 85% (Purple/Pink)
  const rolloffX = (rolloff / 5000) * w;
  freqCtx.strokeStyle = '#E879F9';
  freqCtx.beginPath();
  freqCtx.moveTo(rolloffX, 0);
  freqCtx.lineTo(rolloffX, h);
  freqCtx.stroke();
  freqCtx.setLineDash([]); // reset dash

  // Marker text tags
  freqCtx.font = `${10 * dpr}px Segoe UI, sans-serif`;
  freqCtx.fillStyle = '#FACC15';
  freqCtx.fillText(`C: ${centroid} Гц`, centroidX + 6 * dpr, 18 * dpr);
  freqCtx.fillStyle = '#E879F9';
  freqCtx.fillText(`R (85%): ${rolloff} Гц`, rolloffX + 6 * dpr, 36 * dpr);
}

function runDiagnosticCycle() {
  playImpactSound(currentSampleType);

  const res = generateAcousticSample(currentSampleType, isHannEnabled);
  drawTimeWaveform(res.raw);
  drawSpectrum(res.mag, res.centroid, res.rolloff);

  // Update UI values
  document.getElementById('valCentroid').textContent = `${res.centroid} Гц`;
  document.getElementById('valRolloff').textContent = `${res.rolloff} Гц`;
  document.getElementById('valZcr').textContent = res.zcr;
  document.getElementById('valConfidence').textContent = `${res.confidence}%`;

  const verdictEl = document.getElementById('verdictBox');
  const verdictTextEl = document.getElementById('verdictText');
  verdictTextEl.textContent = res.verdict;

  if (res.verdictClass === 'status-green') {
    verdictEl.className = 'p-4 rounded-xl border border-emerald-500/50 bg-emerald-950/30 text-emerald-300 font-semibold flex items-center justify-between shadow-lg shadow-emerald-950/20';
  } else if (res.verdictClass === 'status-red') {
    verdictEl.className = 'p-4 rounded-xl border border-rose-500/50 bg-rose-950/30 text-rose-300 font-semibold flex items-center justify-between shadow-lg shadow-rose-950/20';
  } else {
    verdictEl.className = 'p-4 rounded-xl border border-amber-500/50 bg-amber-950/30 text-amber-300 font-semibold flex items-center justify-between shadow-lg shadow-amber-950/20';
  }
}

// Event Bindings
document.addEventListener('DOMContentLoaded', () => {
  setupVisualizers();

  // Punch Impact button
  const triggerBtn = document.getElementById('btnTriggerPunch');
  if (triggerBtn) {
    triggerBtn.addEventListener('click', () => {
      runDiagnosticCycle();
    });
  }

  // Sample radio buttons
  const radios = document.querySelectorAll('input[name="sampleType"]');
  radios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      currentSampleType = e.target.value;
      runDiagnosticCycle();
    });
  });

  // Hann Window toggle checkbox
  const hannToggle = document.getElementById('chkHannToggle');
  if (hannToggle) {
    hannToggle.addEventListener('change', (e) => {
      isHannEnabled = e.target.checked;
      runDiagnosticCycle();
    });
  }

  // Initial trigger on load
  setTimeout(() => {
    runDiagnosticCycle();
  }, 300);
});
