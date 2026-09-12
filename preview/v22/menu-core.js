export const CURRENCIES = ['JPY', 'KRW', 'USD', 'VND', 'THB', 'SGD', 'EUR', 'GBP', 'MYR', 'IDR'];
const ZERO_DECIMALS = new Set(['JPY', 'KRW', 'VND']);
export const SAMPLE_MENU = {
  currency: 'JPY',
  items: [
    { id: 'sample-1', name: '자루 소바', localName: 'ざるそば', price: 850, category: 'main', spicy: false },
    { id: 'sample-2', name: '새우튀김 소바', localName: '海老天そば', price: 1250, category: 'main', spicy: false },
    { id: 'sample-3', name: '매운 카레 우동', localName: '辛口カレーうどん', price: 1100, category: 'main', spicy: true },
    { id: 'sample-4', name: '닭튀김', localName: '唐揚げ', price: 550, category: 'side', spicy: false },
    { id: 'sample-5', name: '풋콩', localName: '枝豆', price: 300, category: 'side', spicy: false },
    { id: 'sample-6', name: '우롱차', localName: 'ウーロン茶', price: 250, category: 'drink', spicy: false },
  ],
  warnings: ['가상의 일본 식당 메뉴입니다. 실제 식당·가격 정보가 아닙니다.'],
};

const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
export function normalizeMenu(value) {
  const currency = CURRENCIES.includes(value?.currency) ? value.currency : null;
  const seen = new Set();
  const items = (Array.isArray(value?.items) ? value.items : []).slice(0, 60).map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    const name = clean(item.name, 100);
    const localName = clean(item.localName, 120);
    if (!name && !localName) return null;
    let id = clean(item.id, 60) || `menu-${index + 1}`;
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    const price = validPrice(item.price, currency || 'USD') ? item.price : null;
    const pages = values => [...new Set((Array.isArray(values) ? values : []).filter(n => Number.isInteger(n) && n >= 1 && n <= 5))].sort((a,b)=>a-b);
    const priceOptions = (Array.isArray(item.priceOptions) ? item.priceOptions : []).slice(0, 10).map(option => ({
      price: validPrice(option?.price, option?.currency || currency || 'USD') ? option.price : null,
      currency: CURRENCIES.includes(option?.currency) ? option.currency : null,
      pages: pages(option?.pages),
    }));
    return { id, name: name || localName, localName, price: item.priceConflict === true ? null : price,
      category: ['main', 'side', 'drink'].includes(item.category) ? item.category : 'unknown',
      spicy: typeof item.spicy === 'boolean' ? item.spicy : null,
      sourcePages: pages(item.sourcePages), priceConflict: item.priceConflict === true, priceOptions };
  }).filter(Boolean);
  return { currency, items, warnings: (Array.isArray(value?.warnings) ? value.warnings : []).map(v => clean(v, 300)).filter(Boolean).slice(0, 15) };
}

const minor = (amount, currency) => Math.round(amount * (ZERO_DECIMALS.has(currency) ? 1 : 100));
const major = (amount, currency) => amount / (ZERO_DECIMALS.has(currency) ? 1 : 100);
export function validPrice(amount, currency) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 100000000) return false;
  const scaled = amount * (ZERO_DECIMALS.has(currency) ? 1 : 100);
  return Math.abs(scaled - Math.round(scaled)) < 0.000001;
}
export function formatMoney(amount, currency = 'JPY') {
  if (!Number.isFinite(amount)) return '가격 확인 필요';
  if (!CURRENCIES.includes(currency)) return `${new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(amount)} (통화 확인 필요)`;
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, maximumFractionDigits: ZERO_DECIMALS.has(currency) ? 0 : 2 }).format(amount);
}

export function calculateOrder(items, quantities, currency, budget = null) {
  let sum = 0; const lines = []; const unknownPrices = [];
  for (const item of items) {
    const quantity = Math.max(0, Math.min(20, Math.floor(Number(quantities[item.id]) || 0)));
    if (!quantity) continue;
    if (item.priceConflict || !validPrice(item.price, currency)) { unknownPrices.push(item.name); continue; }
    const subtotal = minor(item.price, currency) * quantity;
    sum += subtotal;
    lines.push({ ...item, quantity, subtotal: major(subtotal, currency) });
  }
  const total = major(sum, currency);
  return { lines, total, unknownPrices, withinBudget: Number.isFinite(budget) ? sum <= minor(budget, currency) : null,
    remaining: Number.isFinite(budget) ? major(minor(budget, currency) - sum, currency) : null };
}

// One main is treated as one serving for planning only; portion adequacy is never asserted.
export function planOrder({ items, currency, budget, people, avoidSpicy = false }) {
  const warnings = ['주요리 1개를 1인분으로 가정한 조합입니다. 실제 양은 식당에 확인해 주세요.', '세금·봉사료·팁은 합계에 포함되지 않습니다.'];
  if (!CURRENCIES.includes(currency)) return { error: '메뉴판의 통화를 먼저 선택해 주세요.', warnings };
  if (!Number.isInteger(people) || people < 1 || people > 8) return { error: '인원은 1~8명으로 입력해 주세요.', warnings };
  if (!Number.isFinite(budget) || budget <= 0 || budget > 100000000) return { error: '0보다 큰 예산을 입력해 주세요.', warnings };
  if (!validPrice(budget, currency)) return { error: `${currency} 금액의 소수 자릿수를 확인해 주세요.`, warnings };
  const priced = (Array.isArray(items) ? items : []).filter(item => item && !item.priceConflict && clean(item.name, 100) && validPrice(item.price, currency) && (!avoidSpicy || item.spicy === false));
  if (avoidSpicy) warnings.push('매움이 미확인인 메뉴도 제외했습니다. 알레르기·식이 안전을 보장하지 않습니다.');
  const mains = priced.filter(item => item.category === 'main').sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
  if (!mains.length) return { error: avoidSpicy ? '가격·주요리 분류·맵지 않음이 확인된 메뉴가 없습니다. 메뉴 정보를 수정해 주세요.' : '가격과 주요리 분류가 확인된 메뉴가 없습니다. 메뉴 정보를 수정해 주세요.', warnings };
  const limit = minor(budget, currency); const cheapest = minor(mains[0].price, currency);
  if (cheapest * people > limit) return { error: `가장 저렴한 주요리 ${people}개도 예산을 초과합니다. 예산을 높이거나 인원을 수정해 주세요.`, warnings };
  const quantities = Object.create(null); let spent = 0;
  // Prefer different mains while reserving enough for remaining diners.
  for (let i = 0; i < people; i++) {
    const affordable = mains.filter(item => spent + minor(item.price, currency) + cheapest * (people - i - 1) <= limit);
    const choice = affordable.find(item => !quantities[item.id]) || affordable[0];
    quantities[choice.id] = (quantities[choice.id] || 0) + 1;
    spent += minor(choice.price, currency);
  }
  // A single shared side is optional; no unnecessary attempt to spend the entire budget.
  const side = priced.filter(item => item.category === 'side' && minor(item.price, currency) <= limit - spent).sort((a,b) => a.price - b.price)[0];
  if (side) quantities[side.id] = 1;
  const order = calculateOrder(items, quantities, currency, budget);
  return { quantities, ...order, warnings };
}

export function makeOrderCard(order) {
  return order.lines.map(item => `${item.localName || item.name} × ${item.quantity}`).join('\n');
}
