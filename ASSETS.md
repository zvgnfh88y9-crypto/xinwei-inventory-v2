# Static assets (canonical location)

This file documents the `public/assets/` directory convention for this project.

All local images, videos, and fonts referenced by runtime code MUST live under
`public/assets/`. Vite copies everything in `public/` verbatim into the
production bundle root, so these files survive `build` + publish.

## Layout

```
public/assets/
├── images/          # all site images (hero, logo, products, avatars, ...)
│   └── placeholder.svg
├── videos/          # local video files (optional)
└── fonts/           # self-hosted fonts (optional)
```

## Reference rule (single canonical form)

Always reference assets with a **root-absolute URL path** — leading slash, no
`public/` prefix:

```jsx
<img src="/assets/images/brand-logo.png" alt="Logo" />
```

```css
.hero { background-image: url('/assets/images/hero-banner.jpg'); }
```

## Never do

- `src="assets/images/x.png"` — relative path; breaks on nested routes and CDN sub-paths
- `src="public/assets/images/x.png"` — `public/` is not part of the served URL
- `src="../assets/x.png"` / `./assets/x.png` — same relative-path breakage
- placing images in `<project>/assets/` or `src/assets/` — not copied into `dist/`
  (unless explicitly `import`-ed, which this project convention does not use)

## Replacing an image? Rename it

Files under `public/` are served without content hashes, so CDN edges and
browsers cache them by URL. Overwriting a file with new content under the
**same name** can keep serving the stale image until caches expire.

When replacing an existing image, save it under a **new filename** (e.g.
`brand-logo-v2.png` or a short content hash suffix) and update the single
code reference. Never overwrite an existing file in place with different
content.
