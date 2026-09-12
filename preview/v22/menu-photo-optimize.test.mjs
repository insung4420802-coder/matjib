import test from 'node:test';
import assert from 'node:assert/strict';
import {fitPhotoSize,photoHeaderSize,optimizeMenuPhoto,validatePhotoRequest,PHOTO_TARGET_BYTES,MAX_PHOTO_REQUEST_BYTES} from './menu-photo-optimize.js';

const file={size:12*1024*1024,type:'image/jpeg',name:'IMG.jpg'};
test('JPEG PNG and WebP dimensions are checked before allocating a decoded bitmap',async()=>{
  const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10]);png.set([73,72,68,82],12);const view=new DataView(png.buffer);view.setUint32(16,12000);view.setUint32(20,12000);
  assert.deepEqual(photoHeaderSize(png),{width:12000,height:12000});
  const jpeg=new Uint8Array([255,216,255,224,0,2,255,192,0,8,8,0,100,0,200,1]);
  assert.deepEqual(photoHeaderSize(jpeg),{width:200,height:100});
  const webp=new Uint8Array(30);webp.set(new TextEncoder().encode('RIFF'));webp.set(new TextEncoder().encode('WEBPVP8X'),8);webp[24]=199;webp[27]=99;
  assert.deepEqual(photoHeaderSize(webp),{width:200,height:100});
  let decoded=false;
  await assert.rejects(()=>optimizeMenuPhoto(new Blob([png],{type:'image/png'}),{decode:async()=>{decoded=true;}}),/해상도/);
  assert.equal(decoded,false);
});
test('phone photos preserve portrait and landscape ratios without upscaling',()=>{
  assert.deepEqual(fitPhotoSize(6000,8000),{width:1176,height:1568});
  assert.deepEqual(fitPhotoSize(8000,6000),{width:1568,height:1176});
  assert.deepEqual(fitPhotoSize(400,300),{width:400,height:300});
  for(const size of [[0,1],[NaN,2],[9000,9000]])assert.throws(()=>fitPhotoSize(...size));
});
test('large originals are optimized with high quality first and original released',async()=>{
  let closed=0;let encodes=0;
  const result=await optimizeMenuPhoto(file,{decode:async()=>({width:6000,height:8000,close:()=>closed++}),encode:async(_,w,h,q)=>{
    encodes++;assert.equal(w,1176);assert.equal(h,1568);assert.equal(q,0.9);return new Blob([new Uint8Array(500000)],{type:'image/jpeg'});
  }});
  assert.equal(result.originalBytes,file.size);assert.equal(result.blob.size,500000);assert.equal(closed,1);assert.equal(encodes,1);
});
test('bounded quality attempts always use the original source',async()=>{
  const decoded={width:4000,height:3000,close:()=>{}};const attempts=[];
  const result=await optimizeMenuPhoto(file,{decode:async()=>decoded,encode:async(source,w,h,q)=>{
    assert.equal(source,decoded);attempts.push([w,h,q]);return new Blob([new Uint8Array(attempts.length<4?PHOTO_TARGET_BYTES+1:PHOTO_TARGET_BYTES)],{type:'image/jpeg'});
  }});
  assert.equal(attempts.length,4);assert.equal(result.width,1400);assert.ok(result.warning);
});
test('uncompressible photo stops at the quality floor and releases decoded memory',async()=>{
  let attempts=0;let closed=false;
  await assert.rejects(()=>optimizeMenuPhoto(file,{decode:async()=>({width:4000,height:3000,close:()=>{closed=true;}}),encode:async(_,w,h,q)=>{
    attempts++;assert.ok(w>=1200);assert.ok(q>=0.78);return new Blob([new Uint8Array(PHOTO_TARGET_BYTES+1)],{type:'image/jpeg'});
  }}),/구역별/);
  assert.equal(attempts,9);assert.equal(closed,true);
});
test('failed, empty or unsupported output cannot reach the upload',async()=>{
  for(const output of [null,new Blob([],{type:'image/jpeg'}),new Blob(['png'],{type:'image/png'})]) {
    let closed=false;
    await assert.rejects(()=>optimizeMenuPhoto(file,{decode:async()=>({width:1000,height:1000,close:()=>{closed=true;}}),encode:async()=>output}),/변환/);
    assert.equal(closed,true);
  }
});
test('five optimized images fit the deployment JSON limit',()=>{
  const image='data:image/jpeg;base64,'+'A'.repeat(Math.ceil(PHOTO_TARGET_BYTES/3)*4);
  const body=validatePhotoRequest(Array(5).fill(image));
  assert.ok(new TextEncoder().encode(JSON.stringify(body)).length<MAX_PHOTO_REQUEST_BYTES);
  assert.throws(()=>validatePhotoRequest(['A'.repeat(MAX_PHOTO_REQUEST_BYTES)]),/전송/);
});
