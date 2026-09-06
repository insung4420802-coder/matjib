// Browser/server shared restaurant identity matching. No network or storage access.
export function normIdentity(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}

const GENERIC_NAME_TOKENS = new Set([
  "본점", "직영점", "분점", "매장", "식당", "음식점", "맛집", "명품", "원조", "본가", "진짜",
  "국수", "냉면", "평양냉면", "짬뽕", "짜장", "김밥", "갈비", "카페", "커피", "피자", "치킨",
  "restaurant", "restaurants", "cafe", "coffee", "ramen", "sushi", "noodles", "the",
]);
function identityTokens(value) {
  return String(value || "").split(/[\s·|()[\]{}_,/\\-]+/).map(normIdentity).filter(Boolean);
}
function branchToken(value) {
  const token = normIdentity(value);
  if (/^(?:본점|분점)$/.test(token)) return token;
  if (/(?:반점|음식점|정육점|상점|서점)$/.test(token)) return "";
  return token.match(/^([가-힣0-9]{2,20}점)(?:에서|에서는|은|는|을|를|에|의)?$/)?.[1] || "";
}
function sameBranch(a, b) {
  return a === b || (a.length >= 3 && b.length >= 3 && (a.endsWith(b) || b.endsWith(a)));
}
function branchWithoutBrand(value, brandAliases) {
  const branch = branchToken(value);
  if (!branch) return "";
  for (const brand of brandAliases) {
    if (branch.startsWith(brand)) {
      const shortened = branchToken(branch.slice(brand.length));
      if (shortened) return shortened;
    }
  }
  return branch;
}
function describedVisitBranches(description, brandAliases) {
  const text = String(description || "").replace(/<[^>]+>/g, " ");
  const branches = [];
  for (const sentence of text.split(/[.!?。\n]+/)) {
    // A previous visit or a comparison does not identify the place being reviewed now.
    if (/비교|보다|달리|예전|지난번|전에|말고|대신/.test(sentence)) continue;
    for (const match of sentence.matchAll(/([가-힣0-9]{2,24}점)\s*에서/g)) {
      const following = sentence.slice(match.index + match[0].length, match.index + match[0].length + 45);
      if (!/(?:먹었|먹고|주문했|식사했|다녀왔|방문했)/.test(following)) continue;
      const branch = branchWithoutBrand(match[1], brandAliases);
      if (branch) branches.push(branch);
    }
  }
  return branches;
}

export function reviewMatchesPlace(review, placeName) {
  if (!placeName) return true;
  const fullName = normIdentity(placeName);
  const title = normIdentity(review?.title);
  const description = normIdentity(review?.description);
  if (!fullName || GENERIC_NAME_TOKENS.has(fullName)) return false;

  const nameTokens = identityTokens(placeName);
  // First token may be a brand such as 홍콩반점; only later tokens are branch candidates.
  const branches = nameTokens.slice(1).map(branchToken).filter(Boolean);
  const brands = nameTokens.filter((token, index) =>
    !GENERIC_NAME_TOKENS.has(token) && !(index > 0 && branchToken(token)));
  const firstBrand = brands[0] || "";
  const brandAliases = [...new Set([firstBrand,
    firstBrand.replace(/^(명품|원조|본가|진짜)/, "")])].filter(Boolean);

  // Allow shortened branch names (현대백화점판교점 → 판교점), reject explicit other branches.
  const titleBranches = identityTokens(review?.title).map((token) => branchWithoutBrand(token, brandAliases)).filter((token) =>
    token && !brands.includes(token));
  if (branches.length && titleBranches.length &&
      !titleBranches.some((actual) => branches.some((expected) => sameBranch(actual, expected)))) return false;
  // If the title only names the brand, an explicit visit at another branch in the snippet
  // is stronger than that brand-only match. Mere branch mentions/comparisons are not enough.
  if (branches.length && !titleBranches.length) {
    const visited = describedVisitBranches(review?.description, brandAliases);
    if (visited.length && !visited.some((actual) => branches.some((expected) => sameBranch(actual, expected)))) return false;
  }

  if (fullName.length >= 3 && title.includes(fullName)) return true;
  const multiwordForeign = brands.length > 1 && !/[가-힣]/.test(firstBrand);
  if (multiwordForeign
    ? brands.every((brand) => title.includes(brand))
    : brandAliases.some((brand) => brand.length >= 3 && title.includes(brand))) return true;
  // A short name inside an unrelated word is not identity evidence.
  if (brandAliases.some((brand) => brand.length >= 2 && identityTokens(review?.title).includes(brand)) &&
      description.includes(fullName)) return true;
  return fullName.length >= 3 && description.includes(fullName);
}
