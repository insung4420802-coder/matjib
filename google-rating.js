(function (root) {
  "use strict";

  function values(place) {
    const imm = place?._imm || {};
    const rating = Number(imm.googleRating ?? place?.rating ?? 0) || 0;
    const count = Math.max(0, Number(imm.googleRatingCount ?? place?.ratingCount ?? 0) || 0);
    return { rating, count };
  }

  function tier(place) {
    const { rating, count } = values(place);
    if (rating <= 0) {
      return { key: "none", label: "평점 정보 없음", evidence: "Google 자료 없음", level: 0 };
    }
    if (rating >= 4.5 && count >= 30) {
      return { key: "top", label: "최상위 기준 충족", evidence: "후기 신뢰도 높음", level: 4 };
    }
    if (rating >= 4.5) {
      return { key: "excellent", label: "평점 매우 높음", evidence: count < 10 ? "후기 표본 적음" : "후기 근거 확인", level: 3 };
    }
    if (rating >= 4) {
      return { key: "high", label: "높은 평가", evidence: count >= 30 ? "후기 근거 충분" : "후기 수 함께 확인", level: 2 };
    }
    if (rating >= 3.5) {
      return { key: "good", label: "좋은 평가", evidence: count >= 30 ? "후기 근거 충분" : "후기 수 함께 확인", level: 1 };
    }
    return { key: "check", label: "평점 확인 필요", evidence: count >= 30 ? "후기 의견이 갈려요" : "후기 표본 적음", level: 0 };
  }

  function matchesFilter(place, filter) {
    const { rating, count } = values(place);
    if (filter === "3.5") return rating >= 3.5;
    if (filter === "4.0") return rating >= 4;
    if (filter === "top") return rating >= 4.5 && count >= 30;
    return true;
  }

  function compare(a, b) {
    const av = values(a);
    const bv = values(b);
    return bv.rating - av.rating || bv.count - av.count;
  }

  root.IMMGoogleRating = { values, tier, matchesFilter, compare };
})(typeof window !== "undefined" ? window : globalThis);
