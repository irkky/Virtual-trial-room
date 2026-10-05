import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePose, shirtTransform, smoothTransform, recommendSize, containRect } from '../static/pose.js';

function landmarks() {
  const points = Array.from({length:33}, () => ({x:.5,y:.5,z:0,visibility:.99,presence:.99}));
  for (const [index,x,y] of [[0,.5,.14],[11,.4,.28],[12,.6,.28],[23,.42,.60],[24,.58,.60],[25,.42,.75],[26,.58,.75],[27,.42,.92],[28,.58,.92]]) {
    points[index] = {...points[index],x,y};
  }
  return points;
}
test('real pixel geometry maintains correct proportions in non-square video', () => {
  const pose = analyzePose(landmarks(),1280,720,168);
  assert.equal(pose.valid,true);
  assert.equal(pose.shoulderWidth,256);
  assert.ok(Math.abs(pose.torsoHeight-230.4)<.001);
  assert.equal(pose.measurements.method,'Full-body proportion estimate');
  assert.ok(pose.measurements.shoulder>0);
});
test('moving/scaling a pose moves/scales the garment while preserving estimates', () => {
  const original = landmarks();
  const near = original.map(p=>({...p,x:(p.x-.5)*1.1+.54,y:(p.y-.5)*1.1+.5}));
  const far = original.map(p=>({...p,x:(p.x-.5)*.7+.5,y:(p.y-.5)*.7+.5}));
  const p = analyzePose(original,1280,720,168);
  const n = analyzePose(near,1280,720,168);
  const f = analyzePose(far,1280,720,168);
  assert.ok(n.valid && f.valid);
  const base = shirtTransform(p,'M');
  assert.ok(shirtTransform(n,'M').x>base.x);
  assert.ok(Math.abs(shirtTransform(n,'M').width/base.width-1.1)<.001);
  assert.ok(Math.abs(shirtTransform(f,'M').width/base.width-.7)<.001);
  assert.ok(Math.abs(n.measurements.shoulder-p.measurements.shoulder)<.001);
});
test('missing or low-confidence torso never yields a garment transform', () => {
  assert.equal(analyzePose([],1280,720,168).valid,false);
  const points=landmarks(); points[23].visibility=.2;
  assert.equal(analyzePose(points,1280,720,168).valid,false);
  points[23].visibility=.99; points[12].x=1.1;
  assert.equal(analyzePose(points,1280,720,168).valid,false);
});
test('distance and side-facing guards provide specific feedback', () => {
  const small=landmarks().map(p=>({...p,x:(p.x-.5)*.2+.5,y:(p.y-.5)*.2+.5}));
  assert.match(analyzePose(small,1280,720,168).message,/far away/);
  const side=landmarks();side[11].z=.4;
  assert.match(analyzePose(side,1280,720,168).message,/Face the camera/);
});
test('partial legs use explicit torso proxy, invalid height suppresses measurements', () => {
  const points=landmarks();points[27].visibility=.1;
  assert.equal(analyzePose(points,1280,720,168).measurements.method,'Torso-based proportion estimate');
  assert.equal(analyzePose(points,1280,720,0).measurements,null);
  assert.equal(analyzePose(points,1280,720,NaN).measurements,null);
});
test('smoothing, size bounds and manual fit scaling are predictable', () => {
  assert.deepEqual(smoothTransform({x:100,width:200},{x:200,width:300}),{x:130,width:230});
  assert.equal(recommendSize(37.9),'XS'); assert.equal(recommendSize(38),'S');
  assert.equal(recommendSize(43),'M'); assert.equal(recommendSize(50),'XXL');
  const pose=analyzePose(landmarks(),1280,720,168);
  assert.ok(shirtTransform(pose,'XL').width>shirtTransform(pose,'S').width);
});
test('contain layout fits desktop/tablet/portrait without cropping or distortion', () => {
  for (const [w,h] of [[700,500],[320,420],[1200,600]]) {
    const rect=containRect(w,h,1280,720);
    assert.ok(rect.width<=w+.001 && rect.height<=h+.001);
    assert.ok(Math.abs(rect.width/rect.height-1280/720)<.001);
  }
});
