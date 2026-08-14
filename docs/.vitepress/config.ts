import { defineConfig } from 'vitepress'

// DSH Desktop docs site.
//
// English is served from the site root; Simplified Chinese is mirrored under
// /zh/. The deploy workflow (.github/workflows/docs.yml) rebuilds on push to
// master, but commits pushed by the daily sync-and-release run use
// GITHUB_TOKEN — which by design does not trigger downstream workflow runs —
// so version bumps never cause a docs rebuild. The two workflows stay fully
// isolated without any paths filtering gymnastics.
export default defineConfig({
  title: 'DSH Desktop',
  description:
    'Download-and-run desktop build of DeepSeek Harness. No Node.js, npm, or terminal required.',

  // GitHub Pages serves this as a project site under /dsh-desktop/, so all
  // asset and router URLs must be prefixed with that subpath. Without this the
  // page renders as unstyled HTML (CSS/JS 404 at the domain root).
  base: '/dsh-desktop/',

  head: [['link', { rel: 'icon', type: 'image/png', href: '/icon.png' }]],

  locales: {
    // Default locale = English (served from the site root).
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/getting-started' },
          { text: 'Releases', link: 'https://github.com/foolgry/dsh-desktop/releases' },
          { text: 'GitHub', link: 'https://github.com/foolgry/dsh-desktop' }
        ],
        sidebar: {
          '/guide/': [
            {
              text: 'Guide',
              items: [
                { text: 'Installation', link: '/guide/getting-started' },
                { text: 'Usage', link: '/guide/usage' },
                { text: 'How It Works', link: '/guide/how-it-works' }
              ]
            }
          ]
        },
        socialLinks: [
          { icon: 'github', link: 'https://github.com/foolgry/dsh-desktop' }
        ],
        footer: {
          message: 'Community (unofficial) build — not an official DeepSeek product.',
          copyright: 'MIT License'
        }
      }
    },

    // Simplified Chinese, served from /zh/.
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        nav: [
          { text: '指南', link: '/zh/guide/getting-started' },
          { text: 'Releases', link: 'https://github.com/foolgry/dsh-desktop/releases' },
          { text: 'GitHub', link: 'https://github.com/foolgry/dsh-desktop' }
        ],
        sidebar: {
          '/zh/guide/': [
            {
              text: '指南',
              items: [
                { text: '安装', link: '/zh/guide/getting-started' },
                { text: '使用', link: '/zh/guide/usage' },
                { text: '工作原理', link: '/zh/guide/how-it-works' }
              ]
            }
          ]
        },
        socialLinks: [
          { icon: 'github', link: 'https://github.com/foolgry/dsh-desktop' }
        ],
        footer: {
          message: '社区（非官方）构建，非 DeepSeek 官方产品。',
          copyright: 'MIT 协议'
        }
      }
    }
  }
})
