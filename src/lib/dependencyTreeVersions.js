export const MIN_DEPENDENCY_TREE_VERSION = '1.60.0';
export const LATEST_DEPENDENCY_TREE_VERSION = 'latest';
export const DEPENDENCY_TREE_BASE_URL = 'https://cxascode.github.io/dependency-tree-merged-json';
export const DEPENDENCY_TREE_INDEX_URL = `${DEPENDENCY_TREE_BASE_URL}/index.json`;
const DEPENDENCY_TREE_VERSION_CACHE_KEY = 'cxascode-exportbuilder-dependency-tree-version-cache';
const DEPENDENCY_TREE_VERSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function buildDependencyTreeUrl(version = LATEST_DEPENDENCY_TREE_VERSION) {
  if (!version || version === LATEST_DEPENDENCY_TREE_VERSION) {
    return `${DEPENDENCY_TREE_BASE_URL}/latest.json`;
  }

  return `${DEPENDENCY_TREE_BASE_URL}/${version}.json`;
}

function parseVersion(version) {
  if (!version || version === LATEST_DEPENDENCY_TREE_VERSION) return null;

  const parts = version.split('.').map(value => Number.parseInt(value, 10));
  if (parts.length !== 3 || parts.some(value => Number.isNaN(value))) return null;

  const [major, minor, patch] = parts;
  return { major, minor, patch };
}

function compareParsedVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function compareVersionsDescending(left, right) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);

  if (!parsedLeft && !parsedRight) return 0;
  if (!parsedLeft) return 1;
  if (!parsedRight) return -1;

  return compareParsedVersions(parsedRight, parsedLeft);
}

function isAtLeastVersion(version, minVersion) {
  const parsedVersion = parseVersion(version);
  const parsedMinVersion = parseVersion(minVersion);

  if (!parsedVersion || !parsedMinVersion) return false;

  return compareParsedVersions(parsedVersion, parsedMinVersion) >= 0;
}

function extractVersion(value) {
  if (typeof value === 'string') {
    return value.replace(/\.json$/, '').replace(/^v/, '');
  }

  if (!value || typeof value !== 'object') return null;

  return value.version || value.name || value.tag || null;
}

function getIndexEntries(index) {
  if (Array.isArray(index)) return index;
  if (Array.isArray(index?.versions)) return index.versions;
  if (Array.isArray(index?.files)) return index.files;
  if (Array.isArray(index?.items)) return index.items;

  return [];
}

export function normalizeDependencyTreeVersion(version) {
  if (!version || version === LATEST_DEPENDENCY_TREE_VERSION) return LATEST_DEPENDENCY_TREE_VERSION;

  const parsed = parseVersion(String(version));
  if (!parsed) return LATEST_DEPENDENCY_TREE_VERSION;

  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

export function buildDependencyTreeVersionOptions(latestVersion, minVersion = MIN_DEPENDENCY_TREE_VERSION) {
  const latest = parseVersion(latestVersion);
  const min = parseVersion(minVersion);

  if (!latest || !min || latest.major !== min.major || latest.minor < min.minor) {
    return [LATEST_DEPENDENCY_TREE_VERSION, minVersion];
  }

  const versions = [];

  for (let minor = latest.minor; minor >= min.minor; minor -= 1) {
    versions.push(`${latest.major}.${minor}.0`);
  }

  return [LATEST_DEPENDENCY_TREE_VERSION, ...versions];
}

export function buildDependencyTreeVersionOptionsFromIndex(index, minVersion = MIN_DEPENDENCY_TREE_VERSION) {
  const versions = getIndexEntries(index)
    .map(extractVersion)
    .filter(Boolean)
    .map(normalizeDependencyTreeVersion)
    .filter(version => version !== LATEST_DEPENDENCY_TREE_VERSION)
    .filter(version => isAtLeastVersion(version, minVersion))
    .sort(compareVersionsDescending);

  return [LATEST_DEPENDENCY_TREE_VERSION, ...new Set(versions)];
}

export function getCachedDependencyTreeVersionOptions(now = Date.now()) {
  if (typeof window === 'undefined') return null;

  try {
    const cached = JSON.parse(window.localStorage.getItem(DEPENDENCY_TREE_VERSION_CACHE_KEY));
    if (!cached || !Array.isArray(cached.options) || !cached.cachedAt) return null;
    if (now - cached.cachedAt > DEPENDENCY_TREE_VERSION_CACHE_TTL_MS) return null;

    return cached.options;
  } catch {
    return null;
  }
}

export function cacheDependencyTreeVersionOptions(latestVersion, now = Date.now()) {
  const options = Array.isArray(latestVersion)
    ? [...new Set(latestVersion)]
    : buildDependencyTreeVersionOptions(latestVersion);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(DEPENDENCY_TREE_VERSION_CACHE_KEY, JSON.stringify({
        latestVersion,
        options,
        cachedAt: now,
      }));
    } catch {
      // Ignore storage failures. The app can still rebuild options from latest.json.
    }
  }

  return options;
}

export function getDependencyTreeVersionLabel(version) {
  return version === LATEST_DEPENDENCY_TREE_VERSION ? 'Latest' : `v${version}`;
}