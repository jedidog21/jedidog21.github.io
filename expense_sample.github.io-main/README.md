# Expense Tracker docs

A self-contained documentation site for the Personal Expense Tracker sample. The content is Markdown; one `index.html` displays it.

| File | What it is |
|------|------------|
| `index.html` | The only HTML page. It loads a Markdown file and renders it in the browser. |
| `index.md` | Overview, architecture and quickstart |
| `database.md` | Schema, rules and queries |
| `api.md` | API reference |
| `frontend.md` | How the single-page frontend works |
| `about.md` | About me / resume (a template to fill in) |
| `assets/diagrams/` | The diagrams, as standalone SVG files |
| `assets/style.css`, `assets/site.js` | Styling, and the script that fetches and renders the Markdown |
| `assets/vendor/marked.min.js` | The Markdown renderer ([marked](https://github.com/markedjs/marked) 12.0.2, MIT), kept locally so the site loads nothing from other hosts |
| `.nojekyll` | Tells GitHub Pages to serve the `.md` files as they are. Without it the pages cannot load. |

Pages are addressed as `index.html?page=api`, and sections as `index.html?page=api#errors`. In the Markdown, pages link to each other as `api.md#errors`; the script rewrites those links.

To add a page, create `name.md` and add a link with `data-page="name"` to the nav in `index.html`.

## Preview locally

The site has to be served over HTTP; a browser will not let `index.html` read the Markdown files when it is opened straight from disk. Use VS Code's Live Server, or:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Publish

Push these files to a GitHub repository, then in **Settings → Pages** choose **Deploy from a branch**, the `main` branch and the `/ (root)` folder. There is no build step.
