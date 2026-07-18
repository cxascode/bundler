import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];

// For GitHub Pages project sites, assets must be rooted at /<repo-name>/.
// Override with VITE_BASE_PATH if you publish to a custom domain or different path.
const base = process.env.VITE_BASE_PATH || (repositoryName ? `/${repositoryName}/` : './');

export default defineConfig({
  plugins: [react()],
  base,
});
