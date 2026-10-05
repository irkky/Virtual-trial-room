import { SIZE_CHART, TRACKING, CONNECTIONS, visible, analyzePose, recommendSize, shirtTransform, smoothTransform, containRect } from './pose.js';

const $ = id => document.getElementById(id);
const video = $('video');
const canvas = $('overlay');
const context = canvas.getContext('2d');
const products = [
  { id: 'black', name: 'Black T-Shirt', color: '#343637', price: 799, tag: 'BESTSELLER' },
  { id: 'white', name: 'White T-Shirt', color: '#f6f4ed', price: 799 },
  { id: 'blue', name: 'Blue T-Shirt', color: '#66899b', price: 849 },
  { id: 'red', name: 'Red T-Shirt', color: '#ae5b4f', price: 849 },
];
const images = new Map();
let selected = products[0], selectedSize = 'M', wearing = false;
let stream = null, detector = null, detectorPromise = null;
let running = false, starting = false, session = 0, animation = 0;
let previousVideoTime = -1, lastInference = 0, lastUI = 0, lastValidTime = 0;
let transform = null, currentPose = null, estimate = null, recommended = null;
let disposed = false;

function setText(element, text) { if (element.textContent !== text) element.textContent = text; }
function showError(message) { $('error-message').textContent = message; $('error-message').hidden = !message; }
function icon(name) { return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function formatPrice(price) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(price); }

for (const product of products) {
  const button = document.createElement('button');
  button.className = 'product-card';
  button.dataset.product = product.id;
  button.setAttribute('aria-label', `Select ${product.name}, ${formatPrice(product.price)}, sizes XS to XXL`);
  button.innerHTML = `<div class="product-image"><img src="/static/shirts/${product.id}_tshirt.png" alt="${product.name}" width="600" height="650">${product.tag ? `<span class="product-tag">${product.tag}</span>` : ''}<span class="selected-check">${icon('check')}</span></div><div class="product-info"><div class="product-title-row"><strong>${product.name}</strong><span class="color-swatch" style="background:${product.color}"></span></div><div class="product-meta"><span>${formatPrice(product.price)}</span><span>XS – XXL</span></div></div>`;
  // One image per product, reused in the catalogue AND on the canvas.
  const image = button.querySelector('img');
  images.set(product.id, image);
  image.addEventListener('error', () => {
    button.disabled = true;
    if (selected.id === product.id) { wearing = false; showError(`The ${product.name} image could not load. Select another shirt or reload the page.`); }
    updateSelection();
  });
  image.addEventListener('load', updateSelection);
  button.addEventListener('click', () => { selected = product; showError(''); updateSelection(); });
  $('products').append(button);
}
for (const entry of SIZE_CHART) {
  const button = document.createElement('button');
  button.textContent = entry.size;
  button.dataset.size = entry.size;
  button.addEventListener('click', () => { selectedSize = entry.size; updateSelection(); });
  $('size-options').append(button);
}
$('size-chart').innerHTML = SIZE_CHART.map((entry, i) => `<tr><td>${entry.size}</td><td>${i === 0 ? `Under ${entry.max}` : Number.isFinite(entry.max) ? `${SIZE_CHART[i-1].max} to under ${entry.max}` : `${SIZE_CHART[i-1].max} and above`}</td></tr>`).join('');

function updateSelection() {
  document.querySelectorAll('[data-product]').forEach(button => {
    const active = button.dataset.product === selected.id;
    button.classList.toggle('selected', active); button.setAttribute('aria-pressed', active);
  });
  document.querySelectorAll('[data-size]').forEach(button => {
    const active = button.dataset.size === selectedSize;
    button.classList.toggle('selected', active); button.setAttribute('aria-pressed', active);
  });
  setText($('selected-description'), `${selected.name} · ${selectedSize}`);
  setText($('selected-price'), formatPrice(selected.price));
  setText($('try-on').querySelector('span'), wearing ? 'Remove shirt' : 'Try on this shirt');
  $('try-on').setAttribute('aria-pressed', String(wearing));
  const image = images.get(selected.id);
  $('try-on').disabled = !image?.complete || !image?.naturalWidth;
  setText($('try-hint'), wearing ? `${selected.name} is on. Choose another color to switch.` : running ? 'Choose a size, then make it yours.' : 'Start your camera to see it on you.');
}

function fitVideo() {
  if (!video.videoWidth) return;
  const stage = $('camera-stage');
  const rect = containRect(stage.clientWidth, stage.clientHeight, video.videoWidth, video.videoHeight);
  $('video-frame').style.width = `${rect.width}px`;
  $('video-frame').style.height = `${rect.height}px`;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  }
}
new ResizeObserver(fitVideo).observe($('camera-stage'));
video.addEventListener('resize', fitVideo);

async function getDetector() {
  if (detector) return detector;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      // Pin JS and WASM to the SAME published version. Loading is deferred
      // until Start camera; there is no frame-upload API in this application.
      const { FilesetResolver, PoseLandmarker } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs');
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
      const options = { baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6, outputSegmentationMasks: false };
      try { detector = await PoseLandmarker.createFromOptions(vision, options); }
      catch { options.baseOptions.delegate = 'CPU'; detector = await PoseLandmarker.createFromOptions(vision, options); }
      if (disposed) { detector.close(); detector = null; throw new Error('Page closed'); }
      return detector;
    })().catch(error => { detectorPromise = null; throw error; });
  }
  return detectorPromise;
}

function timeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]).finally(() => clearTimeout(timer));
}

const cameraErrors = {
  NotAllowedError: 'Camera access was denied. Allow camera permission in your browser’s site settings, then try again.',
  NotFoundError: 'No camera found. Connect a webcam, then try again.',
  NotReadableError: 'Your camera is unavailable or already in use. Close other camera apps and try again.',
  AbortError: 'The camera could not start. Reconnect it and try again.',
  OverconstrainedError: 'This camera does not support the requested settings. Try another webcam.',
  SecurityError: 'Your browser blocked the camera. Open this app on localhost or HTTPS and allow camera access.',
};

async function startCamera() {
  if (starting || running) return;
  showError('');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showError('Camera access is not available here. Use a current Chrome browser at http://localhost:8000 or an HTTPS address.'); return;
  }
  const token = ++session;
  starting = true;
  $('start-camera').disabled = true;
  setText($('start-camera').querySelector('span'), 'Allow camera access…');
  $('stop-camera').hidden = false;
  let phase = 'camera';
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    // Stop any late permission result after cancellation; never leak a stream.
    if (token !== session) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      if (token === session) { stopCamera(); showError('The camera disconnected. Reconnect it and click Start camera.'); }
    });
    video.srcObject = stream;
    await timeout(video.play(), 15000, 'Camera playback timed out. Please try again.');
    if (token !== session) return;
    fitVideo();
    $('video-frame').hidden = false; $('camera-welcome').hidden = true;
    $('camera-stage').classList.add('live'); $('mirror-chip').hidden = false;
    $('pose-message').hidden = false;
    setText($('pose-message'), 'Loading body tracking… The first download can take a moment.');
    setText($('camera-label'), 'Camera connected'); $('camera-dot').classList.add('active');
    setText($('body-label'), 'Loading body tracking');
    setText($('stage-caption'), 'LIVE CAMERA'); $('stage-number').hidden = true;
    phase = 'pose';
    await timeout(getDetector(), 60000, 'Body tracking took too long to load. Check your internet connection and try again.');
    if (token !== session) return;
    running = true; starting = false;
    previousVideoTime = -1; lastInference = 0; lastUI = 0;
    updateSelection();
    animation = requestAnimationFrame(frame);
  } catch (error) {
    if (token !== session) return;
    stopCamera();
    showError(phase === 'pose' ? 'Body tracking could not load. Check your connection and allow cdn.jsdelivr.net and storage.googleapis.com, then retry.' : cameraErrors[error.name] ?? error.message ?? 'Unable to start the camera. Please try again.');
    console.warn(`Fitting room ${phase} initialization failed:`, error);
  } finally {
    if (token === session) { starting = false; $('start-camera').disabled = false; setText($('start-camera').querySelector('span'), 'Start camera'); }
  }
}

function stopCamera() {
  ++session; running = false; starting = false; wearing = false;
  cancelAnimationFrame(animation);
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  video.pause(); video.srcObject = null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  currentPose = null; transform = null; estimate = null; recommended = null; lastValidTime = 0;
  $('video-frame').hidden = true; $('camera-welcome').hidden = false;
  $('camera-stage').classList.remove('live'); $('mirror-chip').hidden = true;
  $('pose-message').hidden = true; $('pose-message').classList.remove('detected');
  $('stop-camera').hidden = true; $('stage-number').hidden = false;
  $('start-camera').disabled = false; setText($('start-camera').querySelector('span'), 'Start camera');
  setText($('camera-label'), 'Camera off'); $('camera-dot').classList.remove('active');
  $('body-dot').classList.remove('active'); setText($('body-label'), 'Waiting for camera');
  setText($('stage-caption'), 'A new way to find your fit');
  updateMeasurements(); updateSelection();
}

function updateMeasurements() {
  const height = Number($('height').value);
  const validHeight = Number.isFinite(height) && height >= 100 && height <= 230;
  $('height').setAttribute('aria-invalid', String(!validHeight));
  setText($('height-hint'), validHeight ? 'Enter your height to personalize sizing.' : 'Enter a height between 100 and 230 cm.');
  $('shoulder-value').innerHTML = estimate ? `~${Math.round(estimate.shoulder)} <small>cm</small>` : '— <small>cm</small>';
  $('torso-value').innerHTML = estimate ? `~${Math.round(estimate.torso)} / ~${Math.round(estimate.hip)} <small>cm</small>` : '— / — <small>cm</small>';
  setText($('measurement-method'), estimate?.method ?? 'Waiting for a reliable pose');
  setText($('recommended-size'), recommended ?? '—');
  $('use-recommended').disabled = !recommended;
}

function drawGuides(points) {
  context.save(); context.lineWidth = Math.max(2, canvas.width / 500); context.strokeStyle = '#a4e8c3'; context.fillStyle = '#e5fff0';
  for (const [a,b] of CONNECTIONS) {
    if (!visible({ ...points[a], x: points[a].x/canvas.width, y: points[a].y/canvas.height }) || !visible({ ...points[b], x: points[b].x/canvas.width, y: points[b].y/canvas.height })) continue;
    context.beginPath(); context.moveTo(points[a].x, points[a].y); context.lineTo(points[b].x, points[b].y); context.stroke();
  }
  for (const i of [0,11,12,13,14,23,24]) {
    if (points[i].visibility < TRACKING.confidence) continue;
    context.beginPath(); context.arc(points[i].x, points[i].y, canvas.width/230, 0, Math.PI*2); context.fill();
  }
  context.restore();
}

function frame(now) {
  if (!running) return;
  // Run only once per NEW video frame, capped to 24 inferences/sec. The lite
  // model reduces blocking; render/DOM work is kept out of the inference path.
  if (video.readyState >= 2 && video.currentTime !== previousVideoTime && now-lastInference >= 1000/TRACKING.fps) {
    previousVideoTime = video.currentTime; lastInference = now;
    try {
      const result = detector.detectForVideo(video, now);
      currentPose = analyzePose(result.landmarks[0], canvas.width, canvas.height, Number($('height').value));
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (currentPose.valid) {
        lastValidTime = now;
        const measurement = currentPose.measurements;
        if (measurement) {
          const alpha = estimate?.method === measurement.method ? 0.12 : 1;
          estimate = { ...measurement, ...Object.fromEntries(['shoulder','torso','hip'].map(key => [key, (estimate?.[key] ?? measurement[key])*(1-alpha)+measurement[key]*alpha])) };
          recommended = recommendSize(estimate.shoulder);
        } else { estimate = null; recommended = null; }
        transform = smoothTransform(transform, shirtTransform(currentPose, selectedSize, recommended ?? 'M'));
        const image = images.get(selected.id);
        if (wearing && image.complete && image.naturalWidth) {
          context.save(); context.translate(transform.x, transform.y); context.rotate(transform.angle);
          // Neck opening/shoulder seam, rather than the PNG's top edge, anchors
          // the garment. Both layers are mirrored together by CSS exactly once.
          context.drawImage(image, -transform.width/2, -transform.height*(112/650), transform.width, transform.height);
          context.restore();
        }
        if ($('show-guides').checked) drawGuides(currentPose.points);
      } else {
        transform = null; estimate = null; recommended = null;
      }
      if (now-lastUI > 250) {
        setText($('pose-message'), currentPose.message);
        $('pose-message').classList.toggle('detected', currentPose.valid);
        $('body-dot').classList.toggle('active', currentPose.valid);
        setText($('body-label'), currentPose.valid ? 'Body detected · Tracking active' : 'Finding your pose');
        updateMeasurements(); lastUI = now;
      }
    } catch (error) {
      stopCamera(); detector?.close(); detector = null; detectorPromise = null;
      showError('Body tracking stopped unexpectedly. Click Start camera to reload the tracker.'); console.warn(error); return;
    }
  }
  // A stalled camera must not leave a frozen shirt or old measurements visible.
  if (lastValidTime && now-lastValidTime > 1500) {
    context.clearRect(0,0,canvas.width,canvas.height); transform = null;
    if (currentPose?.valid) {
      currentPose = null; estimate = null; recommended = null; updateMeasurements();
      setText($('pose-message'), 'Waiting for camera frames… Check your webcam.');
      $('pose-message').classList.remove('detected'); $('body-dot').classList.remove('active');
      setText($('body-label'), 'Camera frames paused');
    }
  }
  animation = requestAnimationFrame(frame);
}

$('start-camera').addEventListener('click', startCamera);
$('stop-camera').addEventListener('click', stopCamera);
$('try-on').addEventListener('click', () => {
  if (wearing) { wearing = false; context.clearRect(0,0,canvas.width,canvas.height); updateSelection(); return; }
  if (!running) { setText($('try-hint'), 'Start your camera first using the button in the fitting room.'); $('start-camera').focus(); return; }
  if (!currentPose?.valid) { setText($('try-hint'), 'Keep both shoulders and hips visible before trying on.'); return; }
  wearing = true; showError(''); updateSelection();
});
$('height').addEventListener('input', () => { estimate = null; recommended = null; updateMeasurements(); });
$('use-recommended').addEventListener('click', () => { if (recommended) { selectedSize = recommended; updateSelection(); } });
for (const [button, dialog] of [['open-help','help-dialog'],['open-size-guide','size-dialog']]) {
  $(button).addEventListener('click', () => $(dialog).showModal());
  $(dialog).querySelector('[data-close]').addEventListener('click', () => $(dialog).close());
  $(dialog).addEventListener('click', event => { if (event.target === $(dialog)) {
    const rect = $(dialog).getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $(dialog).close();
  } });
}
window.addEventListener('pagehide', () => { stopCamera(); disposed = true; detector?.close(); detector = null; detectorPromise = null; });
window.addEventListener('pageshow', () => { disposed = false; });
updateSelection();
