import { MAX_MENU_PHOTOS, MAX_TOTAL_PHOTO_BYTES } from './menu-pages.js';

export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
export const PHOTO_TARGET_BYTES = Math.floor(MAX_TOTAL_PHOTO_BYTES / MAX_MENU_PHOTOS);
export const MAX_PHOTO_REQUEST_BYTES = 4200000;
const formats = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export function validateOriginalPhoto(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_ORIGINAL_BYTES) {
    throw new Error('원본 사진은 장당 20MB까지 선택할 수 있어요. 너무 큰 사진은 일반 사진으로 다시 촬영해 주세요.');
  }
  const extensionOK = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
  if (!formats.has(file.type) && !((!file.type || file.type === 'application/octet-stream') && extensionOK)) {
    throw new Error('JPEG·PNG·WebP 또는 지원되는 HEIC 사진을 선택해 주세요.');
  }
}

export function fitPhotoSize(width, height, maxSide = 1568) {
  if (![width,height].every(n => Number.isFinite(n) && n > 0) || width * height > 64000000) {
    throw new Error('사진 해상도가 너무 크거나 올바르지 않습니다. 일반 촬영 모드로 다시 찍어 주세요.');
  }
  const scale = Math.min(1, maxSide / Math.max(width,height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function photoHeaderSize(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const tag=(offset)=>String.fromCharCode(...bytes.subarray(offset,offset+4));
  if(bytes.length>=24 && tag(1)==='PNG\r' && tag(12)==='IHDR') return {width:view.getUint32(16),height:view.getUint32(20)};
  if(bytes.length>=30 && tag(0)==='RIFF' && tag(8)==='WEBP') {
    if(tag(12)==='VP8X') return {width:1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),height:1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)};
    if(tag(12)==='VP8 ' && bytes[23]===0x9d && bytes[24]===1 && bytes[25]===0x2a) return {width:view.getUint16(26,true)&0x3fff,height:view.getUint16(28,true)&0x3fff};
  }
  if(bytes.length>=25 && tag(0)==='RIFF' && tag(8)==='WEBP' && tag(12)==='VP8L' && bytes[20]===0x2f) return {width:1+bytes[21]+((bytes[22]&63)<<8),height:1+(bytes[22]>>6)+(bytes[23]<<2)+((bytes[24]&15)<<10)};
  if(bytes[0]===0xff && bytes[1]===0xd8) {
    let offset=2;
    while(offset+3<bytes.length) {
      if(bytes[offset++]!==0xff) break;
      while(bytes[offset]===0xff)offset++;
      const marker=bytes[offset++];
      if(marker===0xd9 || marker===0xda)break;
      if(marker===0x01 || (marker>=0xd0 && marker<=0xd8))continue;
      if(offset+2>bytes.length)break;
      const length=view.getUint16(offset);if(length<2 || offset+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length>=8) return {width:view.getUint16(offset+5),height:view.getUint16(offset+3)};
      offset+=length;
    }
  }
  return null;
}

async function preflightPhoto(file) {
  if(typeof file.slice!=='function')return; // Test doubles provide their own decoder.
  const bytes=new Uint8Array(await file.slice(0,512*1024).arrayBuffer());
  const size=photoHeaderSize(bytes);
  if(size) {fitPhotoSize(size.width,size.height);return;}
  if(!/hei[cf]/i.test(`${file.type} ${file.name}`)) throw new Error('사진 해상도 정보를 확인하지 못했습니다. 일반 사진이나 화면 캡처로 다시 선택해 주세요.');
  // HEIC dimensions are codec/container dependent; native decode remains best-effort.
}

async function decodePhoto(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {imageOrientation:'from-image'});
      return { source:bitmap, width:bitmap.width, height:bitmap.height, close:()=>bitmap.close() };
    } catch { /* Safari may decode HEIC through Image even when ImageBitmap fails. */ }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url; await image.decode();
    return { source:image, width:image.naturalWidth, height:image.naturalHeight, close:()=>{image.src='';URL.revokeObjectURL(url);} };
  } catch {
    URL.revokeObjectURL(url);
    if (/hei[cf]/i.test(`${file.type} ${file.name}`)) throw new Error('이 브라우저에서는 HEIC 사진을 읽지 못해요. JPEG 사진이나 메뉴판 화면 캡처를 선택해 주세요.');
    throw new Error('사진을 읽지 못했습니다. 손상되지 않은 사진을 다시 선택해 주세요.');
  }
}

async function encodePhoto(decoded, width, height, quality) {
  const canvas = document.createElement('canvas');
  canvas.width=width; canvas.height=height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('사진을 최적화할 수 없습니다. 다른 브라우저에서 시도해 주세요.');
    context.fillStyle='#fff'; context.fillRect(0,0,width,height);
    context.drawImage(decoded.source,0,0,width,height);
    return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
  } finally { canvas.width=1; canvas.height=1; }
}

export async function optimizeMenuPhoto(file, {decode=decodePhoto, encode=encodePhoto} = {}) {
  validateOriginalPhoto(file);
  await preflightPhoto(file);
  const decoded = await decode(file);
  try {
    for (const side of [1568,1400,1200]) {
      const {width,height}=fitPhotoSize(decoded.width,decoded.height,side);
      for (const quality of [0.9,0.84,0.78]) {
        const blob=await encode(decoded,width,height,quality);
        if (!blob || blob.type !== 'image/jpeg' || !blob.size) throw new Error('사진 변환을 완료하지 못했습니다. JPEG 사진으로 다시 시도해 주세요.');
        if (blob.size <= PHOTO_TARGET_BYTES) {
          return {blob,width,height,originalBytes:file.size,quality,
            warning:Math.min(width,height)<500 ? '사진의 짧은 변이 작아요. 메뉴 글씨가 선명한지 확인해 주세요.' : quality<0.84 || side<1568 ? '용량을 맞추기 위해 사진을 조금 더 줄였어요. 글씨가 작으면 메뉴를 구역별로 나눠 찍어 주세요.' : ''};
        }
      }
    }
    throw new Error('글씨 화질을 유지하면서 사진을 줄이기 어렵습니다. 메뉴판을 구역별로 나눠 가까이 촬영해 주세요. 기존 사진은 유지됩니다.');
  } finally { decoded.close?.(); }
}

export function validatePhotoRequest(images) {
  const body={images};
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_PHOTO_REQUEST_BYTES) {
    throw new Error('전송할 사진 용량이 너무 큽니다. 사진을 다시 선택해 자동 최적화해 주세요.');
  }
  return body;
}
