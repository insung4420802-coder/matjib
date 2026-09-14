import { JAPANESE_MENU_GLOSSARY_A } from './menu-japanese-glossary-a.js';
import { JAPANESE_MENU_GLOSSARY_B } from './menu-japanese-glossary-b.js';

// Definitions of common dishes, not evidence about an individual restaurant.
// Never fuzzy-match OCR mistakes, strip a size/set suffix, or inspect the AI's translated name.
export const MENU_REFERENCE_ENTRIES = [...JAPANESE_MENU_GLOSSARY_A, ...JAPANESE_MENU_GLOSSARY_B];
const key = value => typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/gu, '').trim() : '';
const definitions = new Map();
for (const entry of MENU_REFERENCE_ENTRIES) {
  for (const original of entry.originals) {
    const normalized = key(original);
    if (!normalized || definitions.has(normalized)) throw new Error('Duplicate or empty menu reference');
    definitions.set(normalized, entry);
  }
}

export function findMenuReference(originalName) {
  return definitions.get(key(originalName)) || null;
}

export function applyMenuReferences(result) {
  let matched = 0;
  const items = result.items.map(item => {
    const reference = findMenuReference(item.localName);
    if (!reference) return item;
    matched++;
    // Keep all OCR values and flags, including unknown category after a failed AI interpretation.
    return { ...item, name: reference.name, description: reference.description, descriptionSource: 'general' };
  });
  if (!matched) return result;
  return { ...result, items, warnings: [...result.warnings,
    '일부 일본 요리는 확인된 요리 용어의 일반 설명을 사용합니다. 해당 식당의 실제 재료·조리법·알레르기 안전을 보장하지 않습니다.'] };
}
