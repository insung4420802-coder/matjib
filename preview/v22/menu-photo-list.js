import { MAX_MENU_PHOTOS, MAX_TOTAL_PHOTO_BYTES } from './menu-pages.js';
import { validateOriginalPhoto } from './menu-photo-optimize.js';

export function validatePhotoSelection(current, files) {
  if (!Array.isArray(current) || !Array.isArray(files)) throw new Error('사진 목록을 확인해 주세요.');
  if (!files.length) return;
  if (current.length + files.length > MAX_MENU_PHOTOS) throw new Error(`사진은 최대 ${MAX_MENU_PHOTOS}장까지 선택할 수 있어요. 기존 사진을 삭제한 뒤 추가해 주세요.`);
  for (const file of files) validateOriginalPhoto(file);
}

export function appendUniquePhotos(current, incoming) {
  const photos = [...current]; let duplicateCount = 0;
  for (const photo of incoming) {
    if (photos.some(existing => existing.image === photo.image)) { duplicateCount++; continue; }
    photos.push(photo);
  }
  if (photos.reduce((sum,photo)=>sum+photo.bytes,0)>MAX_TOTAL_PHOTO_BYTES) throw new Error('최적화한 사진 전체 용량이 너무 큽니다. 사진을 다시 선택해 주세요.');
  return {photos, duplicateCount};
}
