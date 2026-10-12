import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

export default defineConfig({
  site: 'https://archon.diy',
  integrations: [
    starlight({
      title: 'Archon',
      favicon: '/favicon.png',
      // The top bar is navy in both themes, so the light logo uses the top bar text color.
      logo: {
        light: './src/assets/logo-header.svg',
        dark: './src/assets/logo-dark.svg',
        alt: 'Archon',
      },
      description: 'AI workflow engine — package your coding workflows as YAML, run them anywhere.',
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&display=swap',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'llms',
            type: 'text/plain',
            href: '/llms.txt',
            title: 'LLM-optimized documentation index',
          },
        },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/coleam00/Archon' }],
      editLink: {
        baseUrl: 'https://github.com/coleam00/Archon/edit/main/packages/docs-web/',
      },
      sidebar: [
        { label: 'Marketplace', link: '/workflows/' },
        { label: 'Roadmap', link: '/roadmap/' },
        { label: 'Brand', link: '/brand/' },
        {
          label: 'The Book of Archon',
          autogenerate: { directory: 'book' },
        },
        {
          label: 'Getting Started',
          autogenerate: { directory: 'getting-started' },
        },
        {
          label: 'Guides',
          autogenerate: { directory: 'guides' },
        },
        {
          label: 'Adapters',
          autogenerate: { directory: 'adapters' },
        },
        {
          label: 'Deployment',
          autogenerate: { directory: 'deployment' },
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
        {
          label: 'Contributing',
          autogenerate: { directory: 'contributing' },
        },
      ],
      customCss: ['./src/styles/custom.css'],
      // Code blocks are dark in both themes, as in the web app. One theme, and
      // the colors come from tokens in custom.css.
      expressiveCode: {
        themes: ['github-dark-dimmed'],
        useStarlightDarkModeSwitch: false,
        useStarlightUiThemeColors: false,
        styleOverrides: {
          borderRadius: '0',
          borderColor: 'var(--archon-code-bg)',
          codeBackground: 'var(--archon-code-bg)',
          codeForeground: 'var(--archon-code-fg)',
          codeFontFamily: 'ui-monospace, Menlo, monospace',
          uiFontFamily: 'var(--__sl-font)',
          frames: {
            shadowColor: 'transparent',
            editorTabBarBackground: 'var(--archon-code-bar)',
            editorActiveTabBackground: 'var(--archon-code-bg)',
            editorActiveTabIndicatorTopColor: 'var(--archon-code-accent)',
            editorTabBarBorderBottomColor: 'var(--archon-code-line)',
            terminalTitlebarBackground: 'var(--archon-code-bar)',
            terminalTitlebarBorderBottomColor: 'var(--archon-code-line)',
            terminalTitlebarDotsForeground: 'var(--archon-code-muted)',
            terminalBackground: 'var(--archon-code-bg)',
            inlineButtonBorder: 'var(--archon-code-muted)',
            inlineButtonForeground: 'var(--archon-code-fg)',
            tooltipSuccessBackground: 'var(--archon-code-accent)',
          },
        },
      },
      plugins: [
        starlightLlmsTxt({
          description:
            'AI workflow engine -- package your coding workflows as YAML, run them anywhere.',
          details: `Archon lets you define multi-step AI coding workflows (code review, bug fixes, features) in YAML and run them from CLI, Web UI, Slack, Telegram, GitHub, or Discord. Each workflow runs in an isolated git worktree.`,

          // No exclusions - include all Starlight docs for maximum sitemap coverage
          exclude: [],

          // Topic-based subsets for selective ingestion - cover all major doc sections
          customSets: [
            {
              label: 'Quick Start',
              description: 'Essential docs to get running with Archon',
              paths: ['index', 'getting-started/**'],
            },
            {
              label: 'The Book',
              description: 'Tutorials and conceptual guides',
              paths: ['book/**'],
            },
            {
              label: 'Guides',
              description: 'How-to guides for workflows, commands, and nodes',
              paths: ['guides/**'],
            },
            {
              label: 'Adapters',
              description: 'Platform integrations (GitHub, Slack, Discord, etc.)',
              paths: ['adapters/**'],
            },
            {
              label: 'Deployment',
              description: 'Deployment guides for Docker, cloud, and local setups',
              paths: ['deployment/**'],
            },
            {
              label: 'Reference',
              description: 'CLI commands, configuration, and API reference',
              paths: ['reference/**'],
            },
            {
              label: 'Contributing',
              description: 'Contributor guides for developers',
              paths: ['contributing/**'],
            },
          ],

          // Links to non-Starlight pages in the sitemap
          optionalLinks: [
            {
              label: 'Home',
              url: 'https://archon.diy/',
              description: 'Archon homepage',
            },
            {
              label: 'Roadmap',
              url: 'https://archon.diy/roadmap/',
              description: 'Project roadmap and planned features',
            },
            {
              label: 'Workflow Marketplace',
              url: 'https://archon.diy/workflows/',
              description: 'Browse and discover community workflows',
            },
          ],

          // Control ordering - essentials first
          promote: ['index', 'getting-started/**', 'guides/authoring-workflows'],
          demote: ['contributing/**'],

          // Aggressive minification for small version
          minify: {
            note: true,
            tip: true,
            caution: false, // Keep warnings
            danger: false, // Keep critical warnings
            details: true,
            whitespace: true,
          },
        }),
      ],
    }),
  ],
});
