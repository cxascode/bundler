import { getFirstLevelDependencies } from './resourceModel.js';

export function extractResourceType(filterEntry) {
  return String(filterEntry || '').split('::')[0].trim();
}

export function parseIncludeFilterResourcesText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const arrayMatch = raw.match(/include_filter_resources\s*=\s*\[([\s\S]*?)\]/i);
  const content = arrayMatch ? arrayMatch[1] : raw;
  const entries = [];

  for (const match of content.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    entries.push(match[1].replace(/\\"/g, '"'));
  }

  if (entries.length === 0) {
    content.split('\n').forEach(line => {
      const trimmed = line.trim().replace(/^,+|,+$/g, '').replace(/^["']|["']$/g, '');
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        entries.push(trimmed);
      }
    });
  }

  return [...new Set(entries.filter(Boolean))];
}

export function parsePastedResourceTypes(text) {
  return [...new Set(
    parseIncludeFilterResourcesText(text)
      .map(extractResourceType)
      .filter(Boolean),
  )].sort();
}

export function buildPasteModeModel({
  filterEntries,
  dependencyMap,
}) {
  const resourceTypes = [...new Set(
    filterEntries.map(extractResourceType).filter(Boolean),
  )].sort();
  const firstLevelDependencies = getFirstLevelDependencies({
    selectedResources: resourceTypes,
    dependencyMap,
  });

  return {
    primaryResourceTypes: resourceTypes,
    firstLevelDependencies,
    includeFilterResources: resourceTypes,
    replaceWithDatasource: [...new Set(
      firstLevelDependencies.map(resource => `${resource}::.*`),
    )].sort(),
  };
}
