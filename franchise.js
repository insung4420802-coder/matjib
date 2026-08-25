(function (root) {
  "use strict";

  const FRANCHISE_WORDS = /(?:프랜차이즈|가맹점|가맹 매장|전국\s*체인|체인점)/i;
  const CHAIN_WORDS = /(?:직영점|직영 매장|본사\s*직영|지역\s*체인|여러\s*지점|다른\s*지점)/i;
  const BRANCH_TAIL = /(?:\s|[-–—·|])(?:[^\s]{1,24})(?:점|지점|직영점|가맹점|branch|store)$/i;

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^0-9a-z가-힣\u3040-\u30ff\u3400-\u9fff]/g, "");
  }

  function placeName(place) {
    return String(place?.place_name || place?.name || "").trim();
  }

  function placeKey(place, mode) {
    return `${mode || "domestic"}:${String(place?.id || normalize(placeName(place)))}`;
  }

  function aliasesOf(entry) {
    return [entry?.brand, ...(entry?.aliases || [])]
      .map((alias) => ({ raw: String(alias || "").trim(), normalized: normalize(alias) }))
      .filter((alias) => alias.normalized.length >= 2)
      .sort((a, b) => b.normalized.length - a.normalized.length);
  }

  function matchesAlias(name, alias) {
    const normalizedName = normalize(name);
    if (!normalizedName || !alias.normalized) return false;
    if (normalizedName === alias.normalized) return true;
    if (!normalizedName.startsWith(alias.normalized)) return false;

    const remaining = normalizedName.slice(alias.normalized.length);
    if (!remaining) return true;
    // 아주 짧거나 일반적인 단어가 우연히 상호 앞부분과 겹치는 오판을 막는다.
    if (alias.normalized.length < 3) return false;
    // 스타벅스 리저브 로스터리처럼 지점 접미사가 없는 확장 매장명도 잡는다.
    // 두세 글자 일반어는 계속 접미사를 요구해 동명 개인 식당 오판을 줄인다.
    return /(?:점|지점|직영점|가맹점|branch|store)$/.test(remaining) || alias.normalized.length >= 4;
  }

  function findCatalogMatch(name, entries) {
    for (const entry of entries || []) {
      for (const alias of aliasesOf(entry)) {
        if (matchesAlias(name, alias)) return { entry, alias: alias.raw };
      }
    }
    return null;
  }

  function reviewText(place) {
    const reviews = [
      ...(Array.isArray(place?._reviews) ? place._reviews : []),
      ...(Array.isArray(place?.reviews) ? place.reviews : []),
      ...(Array.isArray(place?._imm?.realReviews) ? place._imm.realReviews : []),
    ];
    return reviews
      .map((review) => `${review?.title || ""} ${review?.description || ""} ${review?.text || ""}`)
      .join(" ")
      .slice(0, 20000);
  }

  function baseName(name) {
    const original = String(name || "").trim();
    if (!original) return "";
    const withoutParen = original.replace(/\s*[（(][^()（）]{0,30}(?:점|지점|branch|store)[）)]\s*$/i, "");
    const stripped = withoutParen.replace(BRANCH_TAIL, "").trim();
    return normalize(stripped || withoutParen);
  }

  function buildObservedChainCounts(list) {
    const counts = {};
    for (const place of list || []) {
      const base = baseName(placeName(place));
      if (base.length < 3) continue;
      counts[base] = (counts[base] || 0) + 1;
    }
    return counts;
  }

  function manualClassification(override) {
    const labels = {
      franchise: "프랜차이즈",
      chain: "지역 체인",
      independent: "개인 식당",
      unknown: "확인 필요",
    };
    const kind = labels[override?.kind] ? override.kind : "unknown";
    return {
      kind,
      label: labels[kind],
      reason: "내가 수정한 판정",
      confidence: "user",
      source: "user",
      userOverride: true,
    };
  }

  function classifyPlace(place, options = {}) {
    const mode = options.mode || "domestic";
    const catalog = options.catalog || root.IMM_FRANCHISE_CATALOG || {};
    const overrides = options.overrides || {};
    const override = overrides[placeKey(place, mode)];
    if (override) return manualClassification(override);

    const name = placeName(place);
    const franchiseMatch = findCatalogMatch(name, catalog.franchises);
    if (franchiseMatch) {
      return {
        kind: "franchise",
        label: "프랜차이즈",
        reason: `${franchiseMatch.entry.brand} 브랜드와 일치`,
        confidence: "high",
        source: "catalog",
        matchedBrand: franchiseMatch.entry.brand,
      };
    }

    const chainMatch = findCatalogMatch(name, catalog.localChains);
    if (chainMatch) {
      return {
        kind: "chain",
        label: "지역 체인",
        reason: chainMatch.entry.region || `${chainMatch.entry.brand} 복수 지점 브랜드`,
        confidence: "high",
        source: "catalog",
        matchedBrand: chainMatch.entry.brand,
      };
    }

    const text = reviewText(place);
    if (FRANCHISE_WORDS.test(text)) {
      return {
        kind: "chain",
        label: "체인 추정",
        reason: "후기에 프랜차이즈·가맹점 언급",
        confidence: "medium",
        source: "reviews",
      };
    }
    if (CHAIN_WORDS.test(text)) {
      return {
        kind: "chain",
        label: "지역 체인 추정",
        reason: "후기에 직영점·복수 지점 언급",
        confidence: "medium",
        source: "reviews",
      };
    }

    const observedCounts = options.observedCounts || {};
    const base = baseName(name);
    if (base && observedCounts[base] >= 2) {
      return {
        kind: "chain",
        label: "지역 체인 추정",
        reason: `현재 결과에서 같은 상호 ${observedCounts[base]}곳 확인`,
        confidence: "medium",
        source: "results",
      };
    }

    return {
      kind: "independent",
      label: "로컬 식당 추정",
      reason: "주요 브랜드·체인 단서 없음",
      confidence: "low",
      source: "absence",
    };
  }

  root.IMMFranchise = {
    normalize,
    placeKey,
    baseName,
    buildObservedChainCounts,
    classifyPlace,
  };
})(typeof window !== "undefined" ? window : globalThis);
