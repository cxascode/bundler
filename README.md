# CX as Code Bundler (Beta)

**Live app:** [https://cxascode.github.io/bundler/](https://cxascode.github.io/bundler/)

Bundle pipeline exports without hand-maintaining dependency wiring.

Bundler is a small React app that produces a ready-to-wear `genesyscloud_tf_export` block for CX as Code pipelines. It seeds `include_filter_resources`, suggests `replace_with_datasource` patterns from the Genesys Cloud dependency tree, and sets the cxascode-friendly defaults (`enable_dependency_resolution`, HCL export, and related settings). You tailor the rest — named regex filters, org-specific replace patterns, and anything beyond the starter.

## Why Bundler?

Writing a correct `genesyscloud_tf_export` block by hand means juggling three things at once:

- Which resource types to **include** as export seeds
- Which related types should become **data sources** instead of managed resources
- Which provider settings the cxascode pipeline expects

Bundler handles the boilerplate so you can focus on the org-specific parts.

## Modes

### Catalog

Pick resource types from the live Genesys Cloud dependency catalog (with a bundled fallback for offline use). Bundler:

- Expands selected types into `include_filter_resources` using the dependency tree
- Derives first-level dependencies
- Suggests `replace_with_datasource` entries as `type::.*` for those dependencies
- Sets `use_legacy_architect_flow_exporter` when flows appear only as dependencies

Catalog mode also tracks which types are assigned across bundles so you do not double-assign the same resource type.

### Paste

Paste whole resource types, one per line. Bundler normalizes each line to a bare type for `include_filter_resources` and builds replace suggestions from first-level dependencies. Paste mode is for when you already know the include list and do not need the catalog picker.

## Example output

```hcl
resource "genesyscloud_tf_export" "tf_export" {
  directory                          = "./genesyscloud"
  enable_dependency_resolution       = true
  export_format                      = "hcl"
  exclude_attributes                 = []
  include_state_file                 = false
  include_filter_resources           = [
    "genesyscloud_queue",
    "genesyscloud_routing_queue"
  ]
  log_permission_errors              = true
  replace_with_datasource            = [
    "genesyscloud_division::.*",
    "genesyscloud_user::.*"
  ]
  split_files_by_resource            = false
  use_legacy_architect_flow_exporter = false
}
```

Copy the generated block from the app, drop it into your cxascode repo, and adjust from there.

## Workspace files

Export and import `bundler-workspace.json` to save bundles, switch between catalog versions, and share work with others before committing Terraform.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`).

## Build

```bash
npm run build
npm run preview
```

## Deploy with GitHub Pages

This repo includes `.github/workflows/pages.yml`.

1. Push to GitHub.
2. Go to **Settings → Pages**.
3. Set **Build and deployment → Source** to **GitHub Actions**.
4. Push to `main`, or run the workflow manually from **Actions**.

### Base path

For a project site at `https://<org>.github.io/<repo>/`, the workflow derives the Vite base path from `GITHUB_REPOSITORY`.

For a custom domain or root deployment:

```bash
VITE_BASE_PATH=/
```

## Related tools

- **Splitter** — models OrgSync split jobs (CSV excludes, multiple export templates)
- **Bundler** — models cxascode pipeline exports (TF export block only, dependency-aware include/replace)

## License

No open-source license is granted for this repository.

The source is publicly visible for reference and personal use only. Commercial redistribution, resale, and distribution of modified versions are not permitted without written permission.
