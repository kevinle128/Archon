# Brand foundation source

Live at https://archon.diy/brand/foundation.html. Embedded into the docs Brand page via iframe (see `packages/docs-web/src/content/docs/brand/index.md`).

Plain JSX compiled in the browser by Babel-standalone. No build step, no bundling. **To change the brand sheet, edit these files directly and refresh the page.**

| File | Owns |
| --- | --- |
| `foundation.html` | HTML shell. Loads the Fira fonts, React, and Babel from CDN, and wires up the JSX scripts. |
| `brand-app.jsx` | The brand sheet: logo, color tokens, type, shape, motion, and rules. Edit copy and section layout here. |
| `logo.jsx` | `ArchonMark` (the 7x7 pixel A and its runner pixel) and `ArchonLockup`. |
| `app.css` | Light and dark color tokens and page styles. Keep the values equal to `packages/web/src/index.css`. |
