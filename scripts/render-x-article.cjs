const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const root = path.resolve(__dirname, '..');
const input = path.join(root, 'docs', 'RATCHET_X_ARTICLE_H53.md');
const output = path.join(root, 'docs', 'RATCHET_X_ARTICLE_PASTE.html');
const title = 'RATCHET: The Solana Prediction Machine That Burns Its Own Token';

let markdown = fs.readFileSync(input, 'utf8');
markdown = markdown.replace(/^# .+\r?\n+/, '');

marked.use({
  gfm: true,
  breaks: false,
});

const body = marked.parse(markdown);
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RATCHET — formatted X Article</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #07090d; color: #e9e7df; font: 18px/1.7 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    .controls { position: sticky; top: 0; z-index: 10; padding: 18px 24px; display: flex; gap: 18px; align-items: center; justify-content: center; background: rgba(7,9,13,.96); border-bottom: 1px solid #30281b; backdrop-filter: blur(12px); }
    button { border: 1px solid #d8a63f; border-radius: 999px; padding: 12px 22px; background: #d8a63f; color: #090b0e; font: 800 14px/1 Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing: .06em; cursor: pointer; }
    .note { color: #a8a39a; font-size: 14px; line-height: 1.35; }
    .page { width: min(860px, calc(100% - 40px)); margin: 48px auto 90px; }
    .title { margin: 0 0 12px; color: #f6f2e9; font: 750 clamp(34px, 6vw, 54px)/1.08 Georgia, "Times New Roman", serif; }
    .title-note { margin-bottom: 34px; color: #817b70; font-size: 14px; }
    article { padding-top: 30px; border-top: 1px solid #332a1b; }
    article > p:first-child { margin-top: 0; color: #c8c2b7; font-size: 21px; line-height: 1.5; }
    h2 { margin: 58px 0 18px; color: #e0ad47; font: 750 31px/1.18 Georgia, "Times New Roman", serif; }
    p { margin: 0 0 22px; }
    strong { color: #fff8e8; font-weight: 800; }
    em { color: #c6bda9; }
    a { color: #70c9e9; text-decoration: underline; text-underline-offset: 3px; }
    ul, ol { margin: 6px 0 26px; padding-left: 29px; }
    li { margin: 8px 0; padding-left: 4px; }
    blockquote { margin: 28px 0; padding: 17px 20px; border-left: 3px solid #d8a63f; background: #11141a; color: #d9d4ca; }
    code { padding: 2px 5px; border-radius: 4px; background: #151820; color: #f0c86e; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    hr { margin: 48px 0; border: 0; border-top: 1px solid #332a1b; }
  </style>
</head>
<body>
  <div class="controls">
    <button id="copy">COPY FORMATTED BODY</button>
    <div class="note">Then return to X → click inside the article body → Ctrl+A → Ctrl+V.<br>The existing title stays unchanged. Do not publish until Preview looks right.</div>
  </div>
  <main class="page">
    <h1 class="title">${title}</h1>
    <div class="title-note">Title preview only — the copy button copies the formatted body below, not this title.</div>
    <article id="article">${body}</article>
  </main>
  <script>
    document.getElementById('copy').addEventListener('click', event => {
      const article = document.getElementById('article');
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(article);
      selection.removeAllRanges();
      selection.addRange(range);
      const copied = document.execCommand('copy');
      selection.removeAllRanges();
      event.currentTarget.textContent = copied ? 'FORMATTED BODY COPIED' : 'SELECT ARTICLE AND COPY';
    });
  </script>
</body>
</html>`;

fs.writeFileSync(output, html);
process.stdout.write(output + '\n');
