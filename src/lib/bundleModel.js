import { getExportResources, getFirstLevelDependencies, getBundleResources } from './resourceModel.js';
import { buildPasteModeModel, parseIncludeFilterResourcesText } from './includeFilterParser.js';

const FLOW_RESOURCE_TYPE = 'genesyscloud_flow';

function getLegacyArchitectFlowExporter(selectedResources, firstLevelDependencies) {
  if (selectedResources.includes(FLOW_RESOURCE_TYPE)) return false;
  if (firstLevelDependencies.includes(FLOW_RESOURCE_TYPE)) return true;
  return false;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function getReplaceWithDatasource(resources) {
  return uniqueSorted(resources).map(resource => `${resource}::.*`);
}

function buildCatalogBundleModel(bundle, dependencyMap) {
  const selectedResources = getBundleResources(bundle).sort();
  const firstLevelDependencies = getFirstLevelDependencies({
    selectedResources,
    dependencyMap,
  });
  const includeFilterResources = getExportResources({
    selectedResources,
    dependencyMap,
  });

  return {
    name: bundle.name,
    mode: 'catalog',
    tfExportResourceName: bundle.tfExportResourceName || 'tf_export',
    selectedResources,
    primaryResourceTypes: selectedResources,
    firstLevelDependencies,
    includeFilterResources,
    replaceWithDatasource: getReplaceWithDatasource(firstLevelDependencies),
    useLegacyArchitectFlowExporter: getLegacyArchitectFlowExporter(selectedResources, firstLevelDependencies),
  };
}

function buildPasteBundleModel(bundle, dependencyMap) {
  const filterEntries = parseIncludeFilterResourcesText(bundle.pastedIncludeFilterResources);
  const pasteModel = buildPasteModeModel({
    filterEntries,
    dependencyMap,
  });

  return {
    name: bundle.name,
    mode: 'paste',
    tfExportResourceName: bundle.tfExportResourceName || 'tf_export',
    selectedResources: pasteModel.primaryResourceTypes,
    primaryResourceTypes: pasteModel.primaryResourceTypes,
    firstLevelDependencies: pasteModel.firstLevelDependencies,
    includeFilterResources: pasteModel.includeFilterResources,
    replaceWithDatasource: pasteModel.replaceWithDatasource,
    useLegacyArchitectFlowExporter: getLegacyArchitectFlowExporter(
      pasteModel.primaryResourceTypes,
      pasteModel.firstLevelDependencies,
    ),
  };
}

export function buildBundleModel({
  dependencyMap = new Map(),
  bundles,
  stats,
  validation,
}) {
  const bundleModels = bundles.map(bundle => {
    if (bundle.mode === 'paste') {
      return buildPasteBundleModel(bundle, dependencyMap);
    }

    return buildCatalogBundleModel(bundle, dependencyMap);
  });

  return {
    summary: {
      knownResourceTypes: stats.knownResourceCount,
      selectedResources: stats.selectedResourceCount,
      availableResources: stats.availableResourceCount,
      bundleCount: bundles.length,
    },
    bundles: bundleModels,
    rawValidation: {
      ...validation,
      startup: bundles.length === 0,
    },
  };
}
