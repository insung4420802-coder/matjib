// Shared limits apply only to the isolated local preview.
export const MAX_MENU_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_PHOTO_BYTES = 3 * 1024 * 1024;
export const MAX_MENU_ITEMS = 60;
export const MAX_MENU_DESCRIPTION_CHARS = 80;
const MAX_ITEMS_PER_PAGE = 20;
const CURRENCIES = new Set(['JPY', 'KRW', 'USD', 'VND', 'THB', 'SGD', 'EUR', 'GBP', 'MYR', 'IDR']);
const ZERO_DECIMALS = new Set(['JPY', 'KRW', 'VND']);
const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const fail = message => { throw Object.assign(new Error(message), { status: 502 }); };
const validPrice = (value, currency) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000000) return false;
  const scaled = value * (ZERO_DECIMALS.has(currency) ? 1 : 100);
  return Math.abs(scaled - Math.round(scaled)) < 0.000001;
};

export function normalizedMenuName(value) {
  return clean(value, 160).normalize('NFC').toLowerCase().replace(/\s+/gu, '');
}

// A missing/bad description never discards an otherwise readable menu item.
// Unknown attribution cannot be promoted into a claim about the photographed restaurant.
export function normalizeMenuDescription(description, descriptionSource) {
  const unknown = { description: '', descriptionSource: 'unknown' };
  if (typeof description !== 'string' || !['menu','general'].includes(descriptionSource)) return unknown;
  const text = description.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/gu, ' ').trim();
  if (!text || Array.from(text).length > MAX_MENU_DESCRIPTION_CHARS) return unknown;
  return { description: text, descriptionSource };
}

/** Merge page-scoped transcriptions. Source pages are generated here, never trusted from model item metadata. */
export function mergeMenuPages(pages, { expectedPageCount = Array.isArray(pages) ? pages.length : 0 } = {}) {
  if (!Number.isInteger(expectedPageCount) || expectedPageCount < 1 || expectedPageCount > MAX_MENU_PHOTOS) fail('사진 수를 확인할 수 없습니다.');
  if (!Array.isArray(pages) || pages.length > expectedPageCount) fail('메뉴 분석의 페이지 정보를 확인하지 못했습니다. 다시 시도해 주세요.');
  const seenPages = new Set();
  const warnings = [];
  const normalizedPages = pages.map(page => {
    if (!page || typeof page !== 'object' || !Number.isInteger(page.page) || page.page < 1 || page.page > expectedPageCount || seenPages.has(page.page)) fail('메뉴 분석의 페이지 번호가 잘못되었습니다. 사진을 다시 분석해 주세요.');
    seenPages.add(page.page);
    if (!Array.isArray(page.items)) fail(`${page.page}번 사진의 메뉴 목록을 확인하지 못했습니다.`);
    const currency = CURRENCIES.has(page.currency) ? page.currency : null;
    if (page.items.length > MAX_ITEMS_PER_PAGE) warnings.push(`${page.page}번 사진은 앞쪽 ${MAX_ITEMS_PER_PAGE}개 메뉴까지만 반영했습니다. 남은 메뉴는 직접 추가해 주세요.`);
    const items = page.items.slice(0, MAX_ITEMS_PER_PAGE).map(item => {
      if (!item || typeof item !== 'object') return null;
      const name = clean(item.name, 100); const localName = clean(item.localName, 120);
      if (!name && !localName) return null;
      return {
        name: name || localName, localName,
        price: validPrice(item.price, currency) ? item.price : null,
        category: ['main', 'side', 'drink'].includes(item.category) ? item.category : 'unknown',
        spicy: typeof item.spicy === 'boolean' ? item.spicy : null,
        ...normalizeMenuDescription(item.description, item.descriptionSource),
        currency, page: page.page,
      };
    }).filter(Boolean);
    for (const warning of Array.isArray(page.warnings) ? page.warnings.slice(0, 2) : []) {
      const text = clean(warning, 240); if (text) warnings.push(`${page.page}번 사진: ${text}`);
    }
    if (!items.length) warnings.push(`${page.page}번 사진에서 읽을 수 있는 메뉴를 찾지 못했습니다. 직접 입력하거나 사진을 바꿔 주세요.`);
    return { page: page.page, currency, items };
  }).sort((a, b) => a.page - b.page);

  const missing = Array.from({length:expectedPageCount},(_,i)=>i+1).filter(page=>!seenPages.has(page));
  if (missing.length) warnings.unshift(`${missing.join(', ')}번 사진의 분석 결과가 누락되었습니다. 다른 사진의 메뉴만 반영했으니 빠진 사진을 다시 확인해 주세요.`);
  const currencies = new Set(normalizedPages.filter(page=>page.items.length).map(page=>page.currency));
  const currency = currencies.size === 1 && !currencies.has(null) ? [...currencies][0] : null;
  const currencyUncertain = currencies.size > 0 && currency === null;
  if (currencyUncertain) warnings.unshift(currencies.has(null)
    ? '일부 사진의 통화가 미확인입니다. 자동 환산하지 않았으며 모든 가격을 확인 필요로 표시했습니다. 통화와 가격을 직접 확인해 주세요.'
    : '사진에 서로 다른 통화가 섞여 있습니다. 자동 환산하지 않았으며 모든 가격을 확인 필요로 표시했습니다. 하나의 통화 기준으로 직접 확인해 주세요.');

  // Round-robin keeps all submitted pages represented if the merged result exceeds the final item cap.
  const groups = new Map();
  for (let index = 0; index < MAX_ITEMS_PER_PAGE; index++) {
    for (const page of normalizedPages) {
      const item = page.items[index]; if (!item) continue;
      const key = normalizedMenuName(item.localName || item.name);
      let group = groups.get(key);
      if (!group) {
        group = { name: item.name, localName: item.localName, sourcePages: new Set(), categories: new Set(), spice: new Set(), options: new Map(), descriptions: new Map() };
        groups.set(key, group);
      }
      group.sourcePages.add(item.page); group.categories.add(item.category); group.spice.add(item.spicy);
      const description = { description: item.description, descriptionSource: item.descriptionSource };
      group.descriptions.set(JSON.stringify([item.description, item.descriptionSource]), description);
      const optionKey = JSON.stringify([item.currency, item.price]);
      let option = group.options.get(optionKey);
      if (!option) { option = { price: item.price, currency: item.currency, pages: new Set() }; group.options.set(optionKey, option); }
      option.pages.add(item.page);
    }
  }
  const result = [...groups.values()].map((group,index) => {
    const priceOptions = [...group.options.values()].map(option=>({price:option.price,currency:option.currency,pages:[...option.pages].sort((a,b)=>a-b)}));
    const priceConflict = priceOptions.length > 1 || currencyUncertain;
    const description = group.descriptions.size === 1 ? [...group.descriptions.values()][0] : normalizeMenuDescription(null, null);
    return {
      id: `menu-${index+1}`, name: group.name, localName: group.localName,
      price: !priceConflict && priceOptions[0]?.currency === currency ? priceOptions[0]?.price ?? null : null,
      category: group.categories.size === 1 ? [...group.categories][0] : 'unknown',
      spicy: group.spice.size === 1 ? [...group.spice][0] : null,
      ...description,
      sourcePages: [...group.sourcePages].sort((a,b)=>a-b), priceConflict, priceOptions,
    };
  });
  if (result.some(item=>item.priceConflict) && !currencyUncertain) warnings.unshift('같은 이름의 메뉴에서 가격이 다르거나 일부 가격을 읽지 못했습니다. 해당 메뉴는 가격을 비워 두었으니 사진별 가격을 확인해 직접 선택·입력해 주세요.');
  if (result.length > MAX_MENU_ITEMS) warnings.unshift(`메뉴는 최대 ${MAX_MENU_ITEMS}개까지 표시합니다. 모든 사진에서 골고루 반영했으며 남은 메뉴는 직접 추가하거나 나눠 분석해 주세요.`);
  return { currency, items: result.slice(0, MAX_MENU_ITEMS), warnings: [...new Set(warnings)].slice(0, 15), pageCount: expectedPageCount, analyzedPages: [...seenPages].sort((a,b)=>a-b) };
}
