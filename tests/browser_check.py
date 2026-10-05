"""Chrome integration checks. Never accesses a physical webcam.

Run the server first, then: python tests/browser_check.py [--real]
--real also downloads the pinned MediaPipe runtime/model and a public test image.
"""
import argparse
import json
from pathlib import Path
import urllib.request

from playwright.sync_api import sync_playwright, expect

URL = 'http://127.0.0.1:8000'
OUTPUT = Path(__file__).resolve().parents[1] / 'test-results'
OUTPUT.mkdir(exist_ok=True)
STUB = """
export class FilesetResolver { static async forVisionTasks() { return {}; } }
export class PoseLandmarker {
 static async createFromOptions() {
  window.__initializations = (window.__initializations || 0) + 1;
  return { close() {}, detectForVideo() {
   if (window.__noPose) return {landmarks:[]};
   const pts = Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:.99,presence:.99}));
   for (const [i,x,y] of [[0,.5,.14],[11,.4,.28],[12,.6,.28],[13,.35,.43],[14,.65,.43],[23,.42,.60],[24,.58,.60],[25,.42,.75],[26,.58,.75],[27,.42,.92],[28,.58,.92]]) {
    pts[i].x=(x-.5)*(window.__scale||1)+.5+(window.__shift||0);
    pts[i].y=(y-.5)*(window.__scale||1)+.5;
   }
   return {landmarks:[pts]};
  }};
 }
}
"""
BBOX = """() => {
 const c=document.querySelector('#overlay'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
 let minX=c.width,minY=c.height,maxX=-1,maxY=-1;
 for(let y=0;y<c.height;y+=2)for(let x=0;x<c.width;x+=2)if(data[(y*c.width+x)*4+3]>100){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
 return {minX,minY,maxX,maxY,width:maxX-minX,center:(maxX+minX)/2,empty:maxX<0};
}"""


def stub_pose(page):
    page.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs',
               lambda route: route.fulfill(body=STUB, content_type='application/javascript', headers={'access-control-allow-origin':'*'}))


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--real', action='store_true')
    args = parser.parse_args()
    report = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True, args=[
            '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
            '--enable-unsafe-swiftshader',
        ])
        context = browser.new_context(viewport={'width':1440,'height':1150})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        stub_pose(page)
        page.goto(URL)
        expect(page.locator('.product-card')).to_have_count(4)
        expect(page.locator('#try-on')).to_be_enabled()
        page.screenshot(path=str(OUTPUT/'desktop.png'),full_page=True)
        page.locator('#open-help').click(); expect(page.locator('#help-dialog')).to_be_visible()
        page.keyboard.press('Escape')
        page.locator('#open-size-guide').click(); expect(page.locator('#size-chart tr')).to_have_count(6)
        page.keyboard.press('Escape')
        page.locator('#start-camera').click()
        expect(page.locator('#body-label')).to_contain_text('Body detected',timeout=15000)
        page.locator('#height').fill('175')
        expect(page.locator('#shoulder-value')).to_contain_text('~')
        page.locator('#use-recommended').click()
        page.locator('#try-on').click()
        expect(page.locator('#try-on')).to_contain_text('Remove shirt')
        page.wait_for_timeout(700)
        original=page.evaluate(BBOX); assert not original['empty']
        page.evaluate('window.__shift=.05')
        page.wait_for_timeout(700)
        moved=page.evaluate(BBOX); assert moved['center']>original['center']+10,(original,moved)
        page.evaluate('window.__shift=0;window.__scale=1.1')
        page.wait_for_timeout(700)
        near=page.evaluate(BBOX); assert near['width']>original['width']*1.05,(original,near)
        page.evaluate('window.__scale=.7')
        page.wait_for_timeout(700)
        far=page.evaluate(BBOX); assert far['width']<original['width']*.8,(original,far)
        for color in ['white','blue','red','black']:
            page.locator(f'[data-product="{color}"]').click()
            expect(page.locator('#selected-description')).to_contain_text(color.capitalize())
            expect(page.locator('#try-on')).to_contain_text('Remove shirt')
            page.wait_for_timeout(100)
            assert not page.evaluate(BBOX)['empty']
        assert page.evaluate('window.__initializations')==1
        for width,height in [(1440,1000),(820,1180),(390,844)]:
            page.set_viewport_size({'width':width,'height':height})
            page.wait_for_timeout(100)
            geometry=page.evaluate('''() => {
                const v=document.querySelector('video').getBoundingClientRect(), c=document.querySelector('canvas').getBoundingClientRect();
                return {v:[v.x,v.y,v.width,v.height],c:[c.x,c.y,c.width,c.height],overflow:document.documentElement.scrollWidth>innerWidth};
            }''')
            assert geometry['v']==geometry['c'],geometry
            assert not geometry['overflow'],geometry
        report.append('Try-on, translation, near/far scaling, four colors, sizing and mirrored responsive alignment passed with deterministic pose fixtures.')
        page.evaluate('window.__noPose=true')
        expect(page.locator('#body-label')).to_contain_text('Finding')
        assert page.evaluate(BBOX)['empty']
        expect(page.locator('#recommended-size')).to_have_text('—')
        page.evaluate('window.__noPose=false')
        expect(page.locator('#body-label')).to_contain_text('Body detected')
        page.locator('#try-on').click()
        assert page.evaluate(BBOX)['empty']
        assert page.evaluate('document.querySelector("video").srcObject.getVideoTracks()[0].readyState')=='live'
        page.locator('#height').fill('0')
        expect(page.locator('#height')).to_have_attribute('aria-invalid','true')
        expect(page.locator('#recommended-size')).to_have_text('—')
        page.evaluate('window.__track=document.querySelector("video").srcObject.getVideoTracks()[0]')
        page.locator('#stop-camera').click()
        assert page.evaluate('window.__track.readyState')=='ended'
        page.screenshot(path=str(OUTPUT/'mobile.png'),full_page=True)
        page.locator('#start-camera').click()
        expect(page.locator('#body-label')).to_contain_text('Body detected')
        assert page.evaluate('window.__initializations')==1
        page.locator('#stop-camera').click()
        report.append('Pose loss clears overlays/estimates; remove keeps camera live; stop releases tracks; restart reuses the model; invalid height is rejected.')
        assert not errors,errors

        for error, message in [('NotAllowedError','denied'),('NotFoundError','No camera'),('NotReadableError','already in use')]:
            failure=context.new_page()
            failure.add_init_script(f"navigator.mediaDevices.getUserMedia=async()=>{{throw new DOMException('test', '{error}')}}")
            failure.goto(URL);failure.locator('#start-camera').click()
            expect(failure.locator('#error-message')).to_contain_text(message)
            expect(failure.locator('#start-camera')).to_be_enabled()
            failure.close()
        failure=context.new_page()
        failure.route('**/shirts/black_tshirt.png',lambda route:route.abort())
        failure.goto(URL)
        expect(failure.locator('#error-message')).to_contain_text('image could not load')
        failure.locator('[data-product="white"]').click()
        expect(failure.locator('#try-on')).to_be_enabled()
        failure.close()
        failure=context.new_page()
        failure.route('https://cdn.jsdelivr.net/**',lambda route:route.abort())
        failure.goto(URL);failure.locator('#start-camera').click()
        expect(failure.locator('#error-message')).to_contain_text('Body tracking could not load',timeout=15000)
        assert failure.evaluate('document.querySelector("video").srcObject') is None
        failure.close()
        report.append('Permission denied, no camera, camera busy, missing shirt image, and model-download failure all show useful recovery messages.')

        if args.real:
            real=context.new_page()
            real.goto(URL)
            real.locator('#start-camera').click()
            expect(real.locator('#body-label')).to_contain_text('Finding your pose',timeout=90000)
            assert real.locator('#error-message').is_hidden()
            real.locator('#stop-camera').click()
            with urllib.request.urlopen('https://storage.googleapis.com/mediapipe-assets/pose.jpg',timeout=30) as response:
                photo=response.read()
            real.route('**/__test_pose.jpg',lambda route:route.fulfill(body=photo,content_type='image/jpeg'))
            result=real.evaluate('''async () => {
              const {FilesetResolver,PoseLandmarker}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs');
              const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
              const model=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'CPU'},runningMode:'IMAGE'});
              const image=new Image();image.src='/__test_pose.jpg';await image.decode();
              const result=model.detect(image);model.close();
              return {poses:result.landmarks.length,points:result.landmarks[0]?.length};
            }''')
            assert result=={'poses':1,'points':33},result
            report.append('REAL MediaPipe 0.10.21/model downloads and VIDEO inference initialized in Chrome; real IMAGE inference detected 33 landmarks on the public MediaPipe pose photograph.')
            real.close()
        browser.close()
    (OUTPUT/'browser-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('\n'.join(report))


if __name__=='__main__':
    run()
