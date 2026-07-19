import { useEffect, useMemo, useRef, useState } from 'react';
import resources from './data/resources.json';
import { buildFallbackCatalog, parseResourceCatalog } from './lib/resourceCatalog.js';
import { buildBundleModel } from './lib/bundleModel.js';
import {
  getAssignedResources,
  getAvailableBundleResources,
  getBundleResources,
  getBundleStats,
  sanitizeBundleName,
  CORE_BUNDLE_NAME,
  validateBundles,
} from './lib/resourceModel.js';
import { buildWorkspace, downloadJsonFile, parseWorkspace } from './lib/workspace.js';
import { parsePastedResourceTypes } from './lib/includeFilterParser.js';
import {
  buildDependencyTreeUrl,
  buildDependencyTreeVersionOptionsFromIndex,
  cacheDependencyTreeVersionOptions,
  DEPENDENCY_TREE_INDEX_URL,
  getCachedDependencyTreeVersionOptions,
  getDependencyTreeVersionLabel,
  LATEST_DEPENDENCY_TREE_VERSION,
} from './lib/dependencyTreeVersions.js';

const BUNDLED_RESOURCE_CATALOG = buildFallbackCatalog(resources);

const TF_EXPORT_MODE_EXPORT = 'export';
const TF_EXPORT_MODE_EXPORT_STATE = 'exportstate';

function formatTerraformResourceList(values) {
  return values.map(value => `    "${value}"`).join(',\n');
}

function getLegacyArchitectFlowExporterLine(bundle) {
  if (bundle?.useLegacyArchitectFlowExporter === true) {
    return '  use_legacy_architect_flow_exporter = true\n';
  }

  return '  use_legacy_architect_flow_exporter = false\n';
}

function buildTfExportTemplate(bundle, mode = TF_EXPORT_MODE_EXPORT) {
  const includeFilterResources = bundle?.includeFilterResources || [];
  const replaceWithDatasource = bundle?.replaceWithDatasource || [];
  const tfExportResourceName = bundle?.tfExportResourceName || 'tf_export';
  const isExportState = mode === TF_EXPORT_MODE_EXPORT_STATE;

  const includeFilterBlock = includeFilterResources.length === 0
    ? '  include_filter_resources           = []\n'
    : `  include_filter_resources           = [
${formatTerraformResourceList(includeFilterResources)}
  ]
`;

  const replaceWithDatasourceBlock = isExportState || replaceWithDatasource.length === 0
    ? '  replace_with_datasource            = []\n'
    : `  replace_with_datasource            = [
${formatTerraformResourceList(replaceWithDatasource)}
  ]
`;

  const legacyArchitectFlowExporterLine = isExportState
    ? '  use_legacy_architect_flow_exporter = true\n'
    : getLegacyArchitectFlowExporterLine(bundle);

  return `resource "genesyscloud_tf_export" "${tfExportResourceName}" {
  directory                          = "./genesyscloud"
  enable_dependency_resolution       = ${isExportState ? 'false' : 'true'}
  export_format                      = "hcl"
  exclude_attributes                 = []
  include_state_file                 = ${isExportState ? 'true' : 'false'}
${includeFilterBlock}  log_permission_errors              = true
${replaceWithDatasourceBlock}  split_files_by_resource            = false
${legacyArchitectFlowExporterLine}}`;
}

function buildDefaultBundle() {
  return {
    id: crypto.randomUUID(),
    name: CORE_BUNDLE_NAME,
    mode: 'catalog',
    selectedResources: [],
    pastedIncludeFilterResources: '',
  };
}

export default function App() {
  const initialState = useMemo(() => {
    const bundle = buildDefaultBundle();
    return { bundles: [bundle], selectedBundleId: bundle.id };
  }, []);
  const [resourceCatalog, setResourceCatalog] = useState(BUNDLED_RESOURCE_CATALOG);
  const [selectedCatalogVersion, setSelectedCatalogVersion] = useState(LATEST_DEPENDENCY_TREE_VERSION);
  const [catalogVersionOptions, setCatalogVersionOptions] = useState(() => getCachedDependencyTreeVersionOptions() || [LATEST_DEPENDENCY_TREE_VERSION]);
  const [bundles, setBundles] = useState(initialState.bundles);
  const [selectedBundleId, setSelectedBundleId] = useState(initialState.selectedBundleId);
  const [newBundleName, setNewBundleName] = useState('');
  const [isAddingBundle, setIsAddingBundle] = useState(false);
  const [resourceDialogType, setResourceDialogType] = useState(null);
  const [query, setQuery] = useState('');
  const [selectedQuery, setSelectedQuery] = useState('');
  const [copyState, setCopyState] = useState('idle');
  const [tfExportMode, setTfExportMode] = useState(TF_EXPORT_MODE_EXPORT);
  const importRef = useRef(null);
  const versionDropdownRef = useRef(null);
  const selectedCatalogVersionRef = useRef(selectedCatalogVersion);
  const allResources = resourceCatalog.resourceTypes;

  useEffect(() => {
    selectedCatalogVersionRef.current = selectedCatalogVersion;
  }, [selectedCatalogVersion]);

  useEffect(() => {
    const el = versionDropdownRef.current;
    if (!el) return;

    const handler = (event) => {
      const next = event?.target?.value ?? event?.detail?.value ?? '';
      const normalizedNext = next || LATEST_DEPENDENCY_TREE_VERSION;

      if (normalizedNext === selectedCatalogVersionRef.current) return;
      setSelectedCatalogVersion(normalizedNext);
    };

    el.addEventListener('guxchange', handler);
    el.addEventListener('change', handler);

    return () => {
      el.removeEventListener('guxchange', handler);
      el.removeEventListener('change', handler);
    };
  }, []);

  useEffect(() => {
    const el = versionDropdownRef.current;
    if (!el) return;

    if (el.value !== selectedCatalogVersion) {
      el.value = selectedCatalogVersion;
    }

    el.setAttribute('value', selectedCatalogVersion);
  }, [selectedCatalogVersion, catalogVersionOptions]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalogVersions() {
      const cachedOptions = getCachedDependencyTreeVersionOptions();
      if (cachedOptions) return;

      try {
        const response = await fetch(DEPENDENCY_TREE_INDEX_URL, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Dependency catalog index request failed: ${response.status}`);
        }

        const options = buildDependencyTreeVersionOptionsFromIndex(await response.json());
        setCatalogVersionOptions(cacheDependencyTreeVersionOptions(options));
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }

    loadCatalogVersions();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadResourceCatalog() {
      try {
        const response = await fetch(buildDependencyTreeUrl(selectedCatalogVersion), {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Resource catalog request failed: ${response.status}`);
        }

        const catalog = parseResourceCatalog(await response.json());

        if (catalog.resourceTypes.length === 0) {
          throw new Error('Resource catalog did not contain any resource types.');
        }

        const knownResourceSet = new Set(catalog.resourceTypes);

        setResourceCatalog(catalog);
        setBundles(current => current.map(bundle => ({
          ...bundle,
          selectedResources: getBundleResources(bundle).filter(resource => knownResourceSet.has(resource)),
        })));
      } catch (error) {
        if (error.name === 'AbortError') return;
        setResourceCatalog(BUNDLED_RESOURCE_CATALOG);
      }
    }

    loadResourceCatalog();

    return () => controller.abort();
  }, [selectedCatalogVersion]);

  const selectedBundle = bundles.find(bundle => bundle.id === selectedBundleId) || bundles[0] || buildDefaultBundle();
  const selectedBundleMode = selectedBundle.mode === 'paste' ? 'paste' : 'catalog';
  const catalogBundles = useMemo(() => bundles.filter(bundle => bundle.mode !== 'paste'), [bundles]);
  const selectedBundleResources = getBundleResources(selectedBundle);
  const filteredSelectedBundleResources = selectedBundleResources.filter(resource => resource.includes(selectedQuery));
  const selectedResources = useMemo(() => [...new Set(catalogBundles.flatMap(bundle => getBundleResources(bundle)))].sort(), [catalogBundles]);
  const assigned = useMemo(() => getAssignedResources(catalogBundles), [catalogBundles]);
  const parsedPasteResourceTypes = useMemo(() => {
    return parsePastedResourceTypes(selectedBundle.pastedIncludeFilterResources);
  }, [selectedBundle.pastedIncludeFilterResources]);

  const unassignedResources = useMemo(() => {
    return getAvailableBundleResources({
      resources: allResources,
      assigned,
      query: '',
    });
  }, [assigned, allResources]);

  const availableResources = useMemo(() => {
    const selectedSet = new Set(selectedBundleResources);

    return getAvailableBundleResources({
      resources: allResources,
      assigned,
      query,
    }).filter(resource => !selectedSet.has(resource));
  }, [assigned, query, allResources, selectedBundleResources]);

  const stats = useMemo(() => {
    return getBundleStats({
      resources: allResources,
      bundles: catalogBundles,
      assigned,
    });
  }, [assigned, catalogBundles, allResources]);

  const validation = useMemo(() => {
    return validateBundles({ bundles: catalogBundles });
  }, [catalogBundles, allResources]);

  const resourceDialog = useMemo(() => {
    if (resourceDialogType === 'known') {
      return {
        title: 'Known resources',
        description: 'All resource types loaded from the current dependency catalog.',
        resources: allResources,
      };
    }

    if (resourceDialogType === 'selected') {
      return {
        title: 'Selected resources',
        description: 'Resource types currently assigned across all bundles.',
        resources: selectedResources,
      };
    }

    if (resourceDialogType === 'available') {
      return {
        title: 'Available resources',
        description: 'Resource types not assigned to any bundle.',
        resources: unassignedResources,
      };
    }

    return null;
  }, [allResources, resourceDialogType, selectedResources, unassignedResources]);

  const model = useMemo(() => {
    return buildBundleModel({
      dependencyMap: resourceCatalog.dependencyMap,
      bundles,
      stats,
      validation,
    });
  }, [bundles, stats, validation, resourceCatalog.dependencyMap]);

  const selectedGeneratedBundle = useMemo(() => {
    return model.bundles.find(bundle => bundle.name === selectedBundle.name) || model.bundles[0] || null;
  }, [model.bundles, selectedBundle.name]);

  const mainTfTemplate = useMemo(() => {
    return model.bundles
      .map(bundle => buildTfExportTemplate(bundle, tfExportMode))
      .join('\n\n');
  }, [model.bundles, tfExportMode]);

  function startAddingBundle() {
    setNewBundleName('');
    setQuery('');
    setIsAddingBundle(true);
  }

  function cancelAddingBundle() {
    setNewBundleName('');
    setIsAddingBundle(false);
  }

  function addBundle() {
    const name = sanitizeBundleName(newBundleName);

    if (!name || name === CORE_BUNDLE_NAME || bundles.some(bundle => bundle.name === name)) return;

    const bundle = buildDefaultBundle();
    bundle.name = name;

    setBundles(current => [...current, bundle]);
    setSelectedBundleId(bundle.id);
    setNewBundleName('');
    setQuery('');
    setIsAddingBundle(false);
  }

  function deleteBundle(id) {
    setBundles(current => {
      if (current.length <= 1) return current;

      const next = current.filter(bundle => bundle.id !== id);

      if (next.length > 0 && next[0].name !== CORE_BUNDLE_NAME) {
        next[0] = { ...next[0], name: CORE_BUNDLE_NAME };
      }

      setSelectedBundleId(next[0]?.id || null);
      setQuery('');
      return next;
    });
  }

  function setSelectedBundleMode(mode) {
    if (!selectedBundleId) return;

    setBundles(current => current.map(bundle => {
      return bundle.id === selectedBundleId ? { ...bundle, mode } : bundle;
    }));
  }

  function updatePastedIncludeFilters(value) {
    if (!selectedBundleId) return;

    setBundles(current => current.map(bundle => {
      return bundle.id === selectedBundleId
        ? { ...bundle, pastedIncludeFilterResources: value }
        : bundle;
    }));
  }

  function moveToBundle(resource, bundleId = selectedBundleId) {
    if (!bundleId) return;

    setBundles(current => current.map(bundle => {
      const withoutResource = getBundleResources(bundle).filter(item => item !== resource);

      if (bundle.id === bundleId) {
        return { ...bundle, selectedResources: [...withoutResource, resource].sort() };
      }

      return { ...bundle, selectedResources: withoutResource };
    }));
  }

  function removeFromBundle(resource, bundleId) {
    setBundles(current => current.map(bundle => {
      return bundle.id === bundleId
        ? { ...bundle, selectedResources: getBundleResources(bundle).filter(item => item !== resource) }
        : bundle;
    }));
  }

  function reset() {
    const defaultBundle = buildDefaultBundle();
    setBundles([defaultBundle]);
    setSelectedBundleId(defaultBundle.id);
    setNewBundleName('');
    setIsAddingBundle(false);
    setResourceDialogType(null);
    setQuery('');
  }

  function downloadWorkspace() {
    if (bundles.length === 0) return;

    downloadJsonFile({
      filename: 'exportbuilder-workspace.json',
      data: buildWorkspace({ bundles, model }),
    });
  }

  function importWorkspaceFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const workspace = parseWorkspace({
          rawText: String(reader.result || '{}'),
          knownResources: allResources,
          sanitizeBundleName,
          createId: () => crypto.randomUUID(),
        });

        setBundles(workspace.bundles.length > 0 ? workspace.bundles : [buildDefaultBundle()]);
        setSelectedBundleId(workspace.bundles[0]?.id || null);
        setNewBundleName('');
        setIsAddingBundle(false);
        setResourceDialogType(null);
        setQuery('');
      } catch {
        window.alert('Unable to read that workspace file. Make sure it is a valid Export Builder workspace JSON file.');
      }
    };

    reader.readAsText(file);
  }

  async function copyGeneratedOutput(value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1500);
    }
  }

  return <div className="gcShell">
    <header className="gcPageHeader">
      <div className="gcPageTitleRow">
        <div className="gcPageTitleGroup">
          <div className="gcPageTitleLine">
            <h1 className="gcPageTitle">CX as Code Export Builder</h1>
            <span className="gcBetaBadge">Beta</span>
          </div>
          <p className="gcPageSubtitle">A ready-to-wear starter for <code>genesyscloud_tf_export</code>.</p>
        </div>
        <div className="gcPageMeta">
          <div className="gcHeaderLinks">
            <input ref={importRef} type="file" accept="application/json,.json" onChange={importWorkspaceFile} hidden />
            <button type="button" className="gcHeaderLink" onClick={() => importRef.current?.click()}>Import</button>
            <button type="button" className="gcHeaderLink" onClick={downloadWorkspace} disabled={bundles.length === 0} title={bundles.length === 0 ? 'Create a bundle before exporting a workspace.' : 'Export workspace JSON'}>Export</button>
            <button type="button" className="gcClearButton" onClick={reset}>Reset</button>
          </div>
          <div className="gcVersionPicker">
            <span className="gcMetaLabel">Version:</span>
            <gux-dropdown ref={versionDropdownRef} value={selectedCatalogVersion}>
              <gux-listbox>
                {catalogVersionOptions.map(version => (
                  <gux-option key={version} value={version}>{getDependencyTreeVersionLabel(version)}</gux-option>
                ))}
              </gux-listbox>
            </gux-dropdown>
          </div>
        </div>
      </div>
    </header>

    <main className="gcContentArea">
      <div className="stats-grid">
        <button type="button" className="stat-card mini-stat stat-button" onClick={() => setResourceDialogType('known')}>
          <div className="mini-stat-heading"><p className="eyebrow">Known</p><strong>{stats.knownResourceCount}</strong></div>
          <span>Resource types</span>
        </button>
        <button type="button" className="stat-card mini-stat stat-button" onClick={() => setResourceDialogType('selected')}>
          <div className="mini-stat-heading"><p className="eyebrow">Selected</p><strong>{stats.selectedResourceCount}</strong></div>
          <span>Across bundles</span>
        </button>
        <button type="button" className="stat-card mini-stat stat-button" onClick={() => setResourceDialogType('available')}>
          <div className="mini-stat-heading"><p className="eyebrow">Available</p><strong>{stats.availableResourceCount}</strong></div>
          <span>Unassigned</span>
        </button>
      </div>

      <section className="gcCard bundle-nav">
        <div className="section-title">
          <div><h2>Bundles</h2><p>Select a bundle to build its export template.</p></div>
          <div className="bundle-nav-actions">
            {!isAddingBundle && <button type="button" className="gcHeaderLink" onClick={startAddingBundle}>Add bundle</button>}
          </div>
        </div>
        {isAddingBundle && <div className="field add-bundle-form">
          <label htmlFor="new-bundle-name">Add bundle</label>
          <div className="inline">
              <input id="new-bundle-name" value={newBundleName} onChange={event => setNewBundleName(event.target.value)} placeholder="letters, numbers, _, and -" />
            <button type="button" className="gcHeaderLink" onClick={addBundle}>Save</button>
            <button type="button" className="gcClearButton" onClick={cancelAddingBundle}>Cancel</button>
          </div>
        </div>}
        <div className="bundle-list">
          {bundles.map(bundle => <button type="button" key={bundle.id} className={bundle.id === selectedBundleId ? 'bundle selected' : 'bundle'} onClick={() => { setSelectedBundleId(bundle.id); setQuery(''); setSelectedQuery(''); }}>
            <span><strong>{bundle.name}</strong><small>{getBundleResources(bundle).length} selected</small></span>
            {bundles.length > 1 && (
              <button
                type="button"
                className="gcClearButton danger"
                onClick={event => { event.stopPropagation(); deleteBundle(bundle.id); }}
              >
                delete
              </button>
            )}
          </button>)}
        </div>
      </section>

    {resourceDialog && <div className="dialog-backdrop" role="presentation" onClick={() => setResourceDialogType(null)}>
        <section className="gcCard resource-dialog" role="dialog" aria-modal="true" aria-labelledby="resource-dialog-title" onClick={event => event.stopPropagation()}>
          <div className="section-title">
            <div><h2 id="resource-dialog-title">{resourceDialog.title}</h2><p>{resourceDialog.description}</p></div>
            <button type="button" className="gcClearButton" onClick={() => setResourceDialogType(null)}>Close</button>
          </div>
          <div className="chips scroll short">
            {resourceDialog.resources.map(resource => <span className="chip" key={resource}>{resource}</span>)}
          </div>
        </section>
      </div>}

      <div className="grid">
        <section className="gcCard input-panel">
          <div className="section-title">
            <div>
              <h2>{selectedBundleMode === 'catalog' ? 'Available resources' : 'include_filter_resources'}</h2>
              <p>
                {selectedBundleMode === 'catalog'
                  ? 'Add resource types to export. Dependencies are expanded automatically in the export.'
                  : <>Paste one whole resource type per line. Patterns like <code>::^Name$</code> are normalized to the bare type.</>}
              </p>
            </div>
            <gux-badge>{selectedBundleMode === 'catalog' ? availableResources.length : parsedPasteResourceTypes.length}</gux-badge>
          </div>

          <div className="input-toolbar">
            <div className="gcSegmentedControl" role="group" aria-label="Input mode">
              <button type="button" className={selectedBundleMode === 'catalog' ? 'gcSegmentedControl__option selected' : 'gcSegmentedControl__option'} aria-checked={selectedBundleMode === 'catalog'} onClick={() => setSelectedBundleMode('catalog')}>Catalog</button>
              <button type="button" className={selectedBundleMode === 'paste' ? 'gcSegmentedControl__option selected' : 'gcSegmentedControl__option'} aria-checked={selectedBundleMode === 'paste'} onClick={() => setSelectedBundleMode('paste')}>Paste</button>
            </div>
            {selectedBundleMode === 'catalog' && <div className="search">
              <input
                type="search"
                className="gcSearchInput"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="filter e.g. flow, routing, outbound"
              />
              {query && <button type="button" className="search-clear" onClick={() => setQuery('')}>clear</button>}
            </div>}
          </div>

          {selectedBundleMode === 'catalog' ? <>
          <div className="resource-list">
            {availableResources.map(resource => <div className="resource" key={resource}>
              <code>{resource}</code>
              <button type="button" className="gcHeaderLink" onClick={() => moveToBundle(resource)} title={`Add to ${selectedBundle.name}`}>add</button>
            </div>)}
            {availableResources.length === 0 && <p className="empty">No available resources match that filter.</p>}
          </div>
          </> : <>
          <textarea
            className="paste-input"
            value={selectedBundle.pastedIncludeFilterResources || ''}
            onChange={event => updatePastedIncludeFilters(event.target.value)}
            placeholder={`genesyscloud_routing_queue\ngenesyscloud_architect_schedules\ngenesyscloud_flow`}
            spellCheck={false}
          />
          {parsedPasteResourceTypes.length > 0 && <div className="paste-preview">
            <p className="eyebrow">Resource types</p>
            <div className="chips scroll short">
              {parsedPasteResourceTypes.map(resource => <span className="chip" key={resource}>{resource}</span>)}
            </div>
          </div>}
          {selectedGeneratedBundle?.firstLevelDependencies?.length > 0 && <div className="dependency-preview">
            <p className="eyebrow">First-level dependencies</p>
            <div className="chips scroll short">
              {selectedGeneratedBundle.firstLevelDependencies.map(resource => <span className="chip" key={resource}>{resource}</span>)}
            </div>
          </div>}
          </>}
        </section>

        {selectedBundleMode === 'catalog' ? <>
        <section className="gcCard selected-panel">
          <div className="section-title">
            <div><h2>{selectedBundle.name}</h2><p>Primary resource types for this bundle. First-level dependencies drive <code>replace_with_datasource</code>.</p></div>
            <gux-badge>{selectedBundleResources.length}</gux-badge>
          </div>
          <div className="search">
            <input
              type="search"
              className="gcSearchInput"
              value={selectedQuery}
              onChange={event => setSelectedQuery(event.target.value)}
              placeholder="filter selected resources"
            />
            {selectedQuery && <button type="button" className="search-clear" onClick={() => setSelectedQuery('')}>clear</button>}
          </div>
          <div className="resource-list">
            {filteredSelectedBundleResources.map(resource => <div className="resource" key={resource}>
              <code>{resource}</code>
              <div className="actions">
                <button type="button" className="gcClearButton" onClick={() => removeFromBundle(resource, selectedBundle.id)}>remove</button>
              </div>
            </div>)}
            {filteredSelectedBundleResources.length === 0 && <p className="empty">No selected resources match that filter.</p>}
          </div>
        </section>
        </> : null}

        <section className={selectedBundleMode === 'paste' ? 'gcCard output output-panel--paste' : 'gcCard output'}>
          <div className="section-title">
            <div>
              <h2>Generated export</h2>
              <p>
                {tfExportMode === TF_EXPORT_MODE_EXPORT_STATE
                  ? 'Generate a Terraform state file for existing resources — brownfield adoption and import workflows.'
                  : 'Generate HCL configuration with dependency types exported as data sources.'}
              </p>
            </div>
          </div>

          <div className="generated-file">
            <div className="generated-file-header">
              <div className="generated-file-header__start">
                <h3>main.tf</h3>
                <div className="gcSegmentedControl" role="radiogroup" aria-label="Export template mode">
                  <button
                    type="button"
                    className={tfExportMode === TF_EXPORT_MODE_EXPORT ? 'gcSegmentedControl__option selected' : 'gcSegmentedControl__option'}
                    role="radio"
                    aria-checked={tfExportMode === TF_EXPORT_MODE_EXPORT}
                    onClick={() => setTfExportMode(TF_EXPORT_MODE_EXPORT)}
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    className={tfExportMode === TF_EXPORT_MODE_EXPORT_STATE ? 'gcSegmentedControl__option selected' : 'gcSegmentedControl__option'}
                    role="radio"
                    aria-checked={tfExportMode === TF_EXPORT_MODE_EXPORT_STATE}
                    onClick={() => setTfExportMode(TF_EXPORT_MODE_EXPORT_STATE)}
                  >
                    Export state
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="gcCopyButton"
                onClick={() => copyGeneratedOutput(mainTfTemplate)}
                disabled={!mainTfTemplate}
              >
                {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
              </button>
            </div>
            <pre>{mainTfTemplate}</pre>
          </div>
        </section>
      </div>
    </main>
  </div>;
}
