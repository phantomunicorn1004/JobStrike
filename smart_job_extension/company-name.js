/**
 * Company name normalization and duplicate matching (extension copy of lib/company-name.ts).
 */
(function (global) {
  const LEGAL_SUFFIX_RE = /\b(inc|llc|ltd|corp|corporation|co|company)\b/g;
  const MIN_SUBSTRING_LEN = 4;
  const STOP_WORDS = new Set(['the', 'and', 'of', 'at', 'for']);

  function normalizeCompanyName(value) {
    let name = String(value ?? '')
      .toLowerCase()
      .replace(/[.,]/g, ' ')
      .replace(LEGAL_SUFFIX_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (name.startsWith('the ')) {
      name = name.slice(4).trim();
    }

    return name;
  }

  function companiesMatch(a, b) {
    const left = normalizeCompanyName(a);
    const right = normalizeCompanyName(b);
    if (!left || !right) return false;
    if (left === right) return true;
    if (left.length < MIN_SUBSTRING_LEN || right.length < MIN_SUBSTRING_LEN) return false;
    return left.includes(right) || right.includes(left);
  }

  function significantTokens(value) {
    return normalizeCompanyName(value)
      .split(' ')
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  }

  function companyMatchLevel(a, b) {
    if (companiesMatch(a, b)) return 'definite';

    const tokensA = significantTokens(a);
    const tokensB = significantTokens(b);
    if (tokensA.length === 0 || tokensB.length === 0) return 'none';

    const setB = new Set(tokensB);
    const overlap = tokensA.filter((token) => setB.has(token));
    if (overlap.length >= 2) return 'possible';

    const smaller = tokensA.length <= tokensB.length ? tokensA : tokensB;
    const larger = tokensA.length <= tokensB.length ? tokensB : tokensA;
    const largerSet = new Set(larger);
    if (smaller.length >= 2 && smaller.every((token) => largerSet.has(token))) {
      return 'possible';
    }

    return 'none';
  }

  global.SmartJobCompanyName = {
    normalizeCompanyName,
    companiesMatch,
    companyMatchLevel,
  };
})(typeof window !== 'undefined' ? window : self);
