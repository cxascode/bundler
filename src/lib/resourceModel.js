export function cleanName(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getAssignedResources(bundles) {
  return new Map(bundles.flatMap(bundle => getBundleResources(bundle).map(resource => [resource, bundle.name])));
}

export function getFirstLevelDependencies({ selectedResources, dependencyMap }) {
  const selectedSet = new Set(selectedResources);
  const dependencies = new Set();

  selectedResources.forEach(resource => {
    (dependencyMap.get(resource) || []).forEach(dependency => {
      if (!selectedSet.has(dependency)) {
        dependencies.add(dependency);
      }
    });
  });

  return [...dependencies].sort();
}

export function getExportResources({ selectedResources, dependencyMap }) {
  return [...new Set([
    ...selectedResources,
    ...getFirstLevelDependencies({ selectedResources, dependencyMap }),
  ])].sort();
}

export function getBundleResources(bundle) {
  if (!bundle) return [];
  return Array.isArray(bundle.selectedResources) ? bundle.selectedResources : [];
}

export function getAvailableBundleResources({ resources, assigned, query }) {
  return resources
    .filter(resource => !assigned.has(resource))
    .filter(resource => resource.includes(query));
}

export function getBundleStats({ resources, bundles, assigned }) {
  return {
    knownResourceCount: resources.length,
    selectedResourceCount: bundles.reduce((total, bundle) => total + getBundleResources(bundle).length, 0),
    availableResourceCount: resources.filter(resource => !assigned.has(resource)).length,
  };
}

export function validateBundles({ bundles }) {
  const assignmentCounts = new Map();

  bundles.forEach(bundle => {
    getBundleResources(bundle).forEach(resource => {
      assignmentCounts.set(resource, (assignmentCounts.get(resource) || 0) + 1);
    });
  });

  const duplicates = [...assignmentCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([resource]) => resource);

  return {
    duplicates,
    ok: duplicates.length === 0,
  };
}
