// Pure fitting geometry, kept separate from camera/UI so it can be tested.
export const SIZE_CHART = [
  { size: 'XS', max: 38, scale: 0.92 },
  { size: 'S', max: 41, scale: 0.96 },
  { size: 'M', max: 44, scale: 1 },
  { size: 'L', max: 47, scale: 1.04 },
  { size: 'XL', max: 50, scale: 1.08 },
  { size: 'XXL', max: Infinity, scale: 1.12 },
];
export const TRACKING = { confidence: 0.6, smoothing: 0.3, fps: 24 };
export const CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28]];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export function visible(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && (point.visibility ?? 0) >= TRACKING.confidence
    && (point.presence ?? 1) >= TRACKING.confidence
    && point.x > 0.015 && point.x < 0.985 && point.y > 0.015 && point.y < 0.985;
}

export function analyzePose(landmarks, width, height, userHeight) {
  if (!landmarks?.length) return { valid: false, message: 'No person detected. Step into the frame.' };
  if (![11,12,23,24].every(i => visible(landmarks[i]))) {
    return { valid: false, message: 'Keep both shoulders and hips in view. Step back if needed.' };
  }
  // Convert normalized coordinates to VIDEO PIXELS before computing distances.
  // Otherwise a 16:9 frame would distort vertical vs horizontal measurements.
  const points = landmarks.map(p => ({ ...p, x: p.x * width, y: p.y * height }));
  const [left, right, leftHip, rightHip] = [11,12,23,24].map(i => points[i]);
  const shoulderCenter = midpoint(left, right);
  const hipCenter = midpoint(leftHip, rightHip);
  const shoulderWidth = distance(left, right);
  const torsoHeight = distance(shoulderCenter, hipCenter);
  if (shoulderWidth < width * 0.065 || torsoHeight < height * 0.09) {
    return { valid: false, message: 'You’re a little too far away. Move closer.' };
  }
  if (shoulderWidth > width * 0.72 || torsoHeight > height * 0.8) {
    return { valid: false, message: 'You’re a little too close. Take a step back.' };
  }
  const depthDifference = Math.abs((landmarks[11].z ?? 0) - (landmarks[12].z ?? 0));
  if (!visible(landmarks[0]) || depthDifference > shoulderWidth / width * 0.9
      || hipCenter.y < shoulderCenter.y + torsoHeight * 0.65) {
    return { valid: false, message: 'Face the camera and keep your head and torso upright.' };
  }
  // Left/right refer to the person. Sort in image space for a stable tilt angle.
  const a = left.x < right.x ? left : right;
  const b = left.x < right.x ? right : left;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  let measurements = null;
  if (Number.isFinite(userHeight) && userHeight >= 100 && userHeight <= 230) {
    let pixelsPerCm = torsoHeight / (userHeight * 0.30);
    let method = 'Torso-based proportion estimate';
    // Nose-to-ankle span is approximately 90% of standing height. Only use
    // full-body scaling when BOTH legs are confidently visible and straight.
    if ([25,26,27,28].every(i => visible(landmarks[i]))) {
      const ankles = midpoint(points[27], points[28]);
      const knees = midpoint(points[25], points[26]);
      const legLength = distance(hipCenter, ankles);
      const legPath = distance(hipCenter, knees) + distance(knees, ankles);
      const span = ankles.y - points[0].y;
      if (span > height * 0.4 && legLength / legPath > 0.96
          && ankles.y > hipCenter.y + torsoHeight * 0.9
          && Math.abs(ankles.x - shoulderCenter.x) < shoulderWidth * 0.5) {
        pixelsPerCm = span / (userHeight * 0.90);
        method = 'Full-body proportion estimate';
      }
    }
    measurements = {
      shoulder: shoulderWidth / pixelsPerCm,
      torso: torsoHeight / pixelsPerCm,
      hip: distance(leftHip, rightHip) / pixelsPerCm,
      method,
    };
  }
  return { valid: true, message: 'Body detected · You’re ready to try on', points,
    shoulderCenter, shoulderWidth, torsoHeight, angle, measurements };
}

export function recommendSize(shoulder) {
  return SIZE_CHART.find(entry => shoulder < entry.max)?.size ?? 'XXL';
}

export function shirtTransform(pose, size, recommended = 'M') {
  const scale = SIZE_CHART.find(s => s.size === size).scale
    / SIZE_CHART.find(s => s.size === recommended).scale;
  // PNG seam anchors: shoulders at (180,112) and (420,112) in 600x650.
  // 240px shoulder span, ~408px shoulder-to-hem. Limit vertical stretch so
  // the garment follows the torso while retaining plausible proportions.
  const width = pose.shoulderWidth * (600 / 240) * scale;
  const naturalHeight = width * 650 / 600;
  const desiredHeight = pose.torsoHeight * 1.16 * (650 / 408) * scale;
  const height = Math.max(naturalHeight * 0.78, Math.min(naturalHeight * 1.22, desiredHeight));
  return { x: pose.shoulderCenter.x, y: pose.shoulderCenter.y + pose.torsoHeight * 0.015,
    width, height, angle: pose.angle };
}

export function smoothTransform(previous, current, alpha = TRACKING.smoothing) {
  if (!previous) return { ...current };
  return Object.fromEntries(Object.keys(current).map(key => [key, previous[key] * (1-alpha) + current[key] * alpha]));
}

export function containRect(containerWidth, containerHeight, videoWidth, videoHeight) {
  const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight);
  return { width: videoWidth * scale, height: videoHeight * scale };
}
