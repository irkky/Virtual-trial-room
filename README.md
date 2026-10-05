<div align="center">

# THREAD
### Virtual Trial Room

**A little fitting-room magic, powered by your webcam.**

Try on illustrated shirts in real time. Your camera stays in your browser while
MediaPipe tracks your pose and the garment follows your shoulders and torso.

<br>

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-app-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?style=for-the-badge&logo=javascript&logoColor=111111)
![Privacy](https://img.shields.io/badge/camera-processing-local-7C3AED?style=for-the-badge)

<br>

| **Local camera processing** | **Live pose tracking** | **Six size options** | **No checkout** |
|:--:|:--:|:--:|:--:|
| Frames stay in your browser | Shirt follows your movement | Suggested or hand-picked | A learning prototype |

</div>

---

## ✨ What you can do

- **Try on four shirts** with transparent, illustrated garment overlays.
- **Move naturally** and watch the overlay follow your shoulders and torso.
- **Compare sizes** from XS through XXL, with an approximate suggestion based on height and pose.
- **Switch shirts instantly** without restarting the camera or pose model.
- **Inspect tracking** with an optional landmark and skeleton view.

> **Good to know:** this is a 2D visual prototype. Size suggestions are rough estimates, and the shirt art is illustrative—not a product photo or a guarantee of fit.

## 🚀 Get started

### Requirements

- Python 3.10 or newer
- Recent Google Chrome
- A webcam
- Internet access on first launch to load the MediaPipe runtime, pose model, and optional fonts

No Node build, API key, database, or Python computer-vision package is needed.

### Install and run

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload
```

If PowerShell blocks environment activation, call its Python executable directly:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m uvicorn app:app --reload
```

On macOS or Linux, activate with `source venv/bin/activate` and use `python`/`uvicorn` as above. If this workspace already has a `.venv`, start the app with:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app:app --reload
```

Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)**. The health endpoint at **[http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)** returns `{"status":"ok"}`.

## 🪞 Use the fitting room

1. Click **Start camera** and allow access in Chrome.
2. Stand about **1–2 metres** away in good light. Face forward with your head, shoulders, and hips visible; keep one person in frame.
3. Wait for **Body detected**. On first use, the pose engine and model download after camera permission is granted.
4. Enter your height in centimetres (**100–230 cm**). For the better of the two rough estimation methods, include your feet and stand upright.
5. Choose a shirt and size, then click **Try on this shirt**.
6. Move side to side or closer and farther away to see the overlay respond.
7. Choose another product to switch shirts without restarting tracking. **Remove shirt** clears the overlay while keeping the camera on.
8. Click **Stop camera** to release the webcam. The loaded model is reused if you start again.

The six size buttons always let you choose manually. **Use size** applies the latest recommendation only when you ask; your selection never changes silently. **Show tracking** reveals the pose connections and landmarks. Product prices are samples, and there is no checkout.

## 📷 Camera access

Browsers allow webcam access only in a **secure context**: use `localhost`/`127.0.0.1` or HTTPS. Opening `index.html` directly is unsupported. A plain HTTP LAN address usually cannot access the camera; use an HTTPS reverse proxy to open the app from another device.

If the camera does not start, open Chrome’s site controls → **Site settings** → **Camera** → **Allow**, then retry. Select the intended camera in Chrome if you have more than one, check your operating system’s camera privacy settings, and close other apps that may be using it.

## 🧩 How it works

```text
Browser webcam → MediaPipe pose landmarks → fitting geometry → canvas shirt overlay
       │                    │                       │
       └──────────── frames remain on this device ──┘
```

FastAPI serves the web app, static files, and a health endpoint. Pose tracking, sizing estimates, and canvas rendering run in the browser.

### Project map

```text
app.py                         FastAPI home, health, and static routes
requirements.txt               Runtime Python dependencies
requirements-dev.txt           Optional verification dependencies
static/
  index.html                   Responsive interface and dialogs
  style.css                    Layout, styling, and responsive behavior
  app.js                       Camera lifecycle, tracking, catalogue, rendering
  pose.js                      Geometry, pose checks, sizing, smoothing
  shirts/                      Four transparent shirt illustrations
  assets/favicon.svg           Browser tab icon
scripts/generate_shirts.py     Rebuild placeholder shirt art (Pillow)
tests/                         Geometry, backend, and browser checks
```

### Tracking and rendering details

- Uses MediaPipe Tasks Vision **0.10.21** and the **Pose Landmarker Lite** model (float16, version 1).
- The model loads after camera permission. GPU setup falls back to CPU; a single pose is tracked, with segmentation disabled.
- Inference runs on new video frames, capped at 24 calls per second. Measurement and status updates are throttled to four per second. The model and garment images are reused when switching shirts or restarting.
- Landmark positions are calculated in the video’s intrinsic pixel coordinates. Video and canvas share a fitted, un-cropped wrapper and mirror transform.
- Shoulder position and width place and scale the shirt; shoulder angle rotates it; torso length adjusts its height. Smoothing softens movement while pose checks clear the overlay when tracking is lost.
- Shirt PNGs are **600 × 650 px**, with shoulder anchors at `(180, 112)` and `(420, 112)`, and a hem near `y=520`. Keep this layout for replacement artwork or update `shirtTransform()` and the canvas draw offset in `app.js`.

The shirt images are generated placeholder illustrations, not photographs of real products. To regenerate them:

```powershell
pip install Pillow
python scripts/generate_shirts.py
```

MediaPipe API reference: [Pose Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js).

## 📏 About the size suggestions

This is **AI-assisted approximate sizing**, not body measurement. An ordinary webcam cannot infer exact real-world garment dimensions without calibration.

The app uses your entered height with one of two proportion-based methods:

1. **Full-body estimate:** when knees and ankles are visible and posture is upright, it assumes nose-to-ankle height is about 90% of stated height, then derives shoulder, torso, and hip distances from image pixels.
2. **Torso-based fallback:** when feet are not visible, it assumes shoulder-center-to-hip-center length is 30% of stated height. This is a much rougher assumption, not an independent torso measurement.

Perspective, clothing, posture, lighting, foreshortening, and individual proportions all affect the result. Hip width is the distance between hip landmarks, not circumference; chest circumference is not measured. Estimates are not medically or professionally accurate and do not guarantee a fit.

The illustrative shoulder-width thresholds live in `SIZE_CHART` in `static/pose.js`: XS <38 cm, S 38–<41, M 41–<44, L 44–<47, XL 47–<50, XXL ≥50. Use manufacturer sizing data for real products.

## 🔒 Privacy and network use

There is no webcam frame upload, snapshot feature, recording, analytics, or image storage. Camera access starts only after your click. **Stop camera** and leaving the page release active camera tracks. FastAPI serves files and the health response.

First launch needs internet access for ordinary asset downloads from:

| Host | Purpose |
|---|---|
| `cdn.jsdelivr.net` | Pinned MediaPipe JavaScript and WebAssembly |
| `storage.googleapis.com` | Google pose model |
| `fonts.googleapis.com` / `fonts.gstatic.com` | Optional UI fonts; system fonts are used as fallback |

These services receive asset requests; webcam frames are not sent to them. Offline use would require bundling the runtime and model locally and changing their URLs.

## ✅ Verification

Install the optional development tools and run the geometry and backend checks:

```powershell
pip install -r requirements-dev.txt
node tests/pose.test.mjs
python -m unittest discover -s tests -p "test_*.py"
```

For the desktop Chrome integration check, start FastAPI on port 8000 and run:

```powershell
python tests/browser_check.py --real
```

The browser check uses Chrome’s **synthetic webcam**, not your physical camera. Pose fixtures cover movement, near/far scaling, selection, removal, measurements, restart, recovery, and responsive alignment. `--real` also initializes the actual MediaPipe VIDEO model and performs IMAGE inference with Google’s public test photo. Screenshots and the report go to the ignored `test-results/` directory.

Automated checks do not validate your physical webcam. For a hardware check, follow the steps above, move closer and farther away, resize the page, remove the shirt, then deny camera permission and confirm the recovery message. Tracking speed and visual fit depend on your device and camera.

## 🧪 Current limits

This is a flat 2D overlay: arms do not cover the shirt, sleeves do not articulate, and there is no fabric drape, depth, or realistic side/back view. Multi-person scenes are unsupported. Synchronous inference on the browser’s main thread may be slow on older devices; the lite model and frame cap reduce the work but cannot guarantee a frame rate.

`pose.js` keeps fitting geometry separate from camera and interface code. Future renderers could add segmentation and occlusion, a body mesh, 3D garments, or cloth simulation. A worker-based inference pipeline may help if profiling on target devices shows UI blocking.

---

<div align="center">

**Made for learning, experimenting, and seeing the idea come to life.**

</div>
