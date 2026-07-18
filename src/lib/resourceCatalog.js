const EXCLUDED_RESOURCE_TYPES = new Set([
  'genesyscloud_bcp_tf_exporter',
  'genesyscloud_tf_export',
]);

function isIncludedResourceType(type) {
  return type && !EXCLUDED_RESOURCE_TYPES.has(type);
}

export function parseResourceCatalog(catalog) {
  const entries = Array.isArray(catalog?.resources) ? catalog.resources : [];

  const resources = entries
    .map(resource => ({
      name: resource.name || resource.type,
      type: resource.type,
      dependencies: Array.isArray(resource.dependencies) ? resource.dependencies : [],
    }))
    .filter(resource => isIncludedResourceType(resource.type))
    .sort((left, right) => left.type.localeCompare(right.type));

  return buildResourceCatalog({
    version: catalog?.version || null,
    resources,
  });
}

export function buildResourceCatalog({ version = null, resources = [] }) {
  const resourceTypes = resources.map(resource => resource.type);
  const resourceTypeSet = new Set(resourceTypes);

  const dependencyMap = new Map(resources.map(resource => [
    resource.type,
    resource.dependencies.filter(dependency => resourceTypeSet.has(dependency)),
  ]));

  return {
    version,
    resources,
    resourceTypes,
    dependencyMap,
  };
}

export function buildFallbackCatalog(resourceTypes) {
  return buildResourceCatalog({
    version: null,
    resources: resourceTypes.filter(isIncludedResourceType).map(type => ({
      name: type,
      type,
      dependencies: [],
    })),
  });
}