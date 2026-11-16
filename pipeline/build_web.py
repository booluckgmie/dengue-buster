"""Assemble the dashboard page.

  python -m pipeline.build_web                 -> web/index.html (links styles.css, app.js, data/bundle.js)
  python -m pipeline.build_web --inline OUT    -> single self-contained fragment (CSS + JS inlined) for embedding
"""
import sys

from .config import ROOT

WEB = ROOT / "web"
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Sora:wght@600;700&family=JetBrains+Mono&display=swap">'
D3 = '<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>'
TITLE = "<title>Dengue Buster</title>"


def main():
    body = (WEB / "body.html").read_text()
    if "--inline" in sys.argv:
        out = sys.argv[sys.argv.index("--inline") + 1]
        html = (f'{TITLE}\n<meta name="claude:viewport-fit-sides" content="cover">\n{FONTS}\n<style>\n{(WEB / "styles.css").read_text()}</style>\n'
                f'{body}\n{D3}\n<script src="data/bundle.js"></script>\n<script>\n{(WEB / "app.js").read_text()}</script>\n')
        open(out, "w").write(html)
        return
    html = (f'<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f'{TITLE}\n{FONTS}\n<link rel="stylesheet" href="styles.css">\n</head>\n<body>\n{body}\n{D3}\n<script src="data/bundle.js"></script>\n<script src="app.js"></script>\n</body>\n</html>\n')
    (WEB / "index.html").write_text(html)


if __name__ == "__main__":
    main()
