#!/usr/bin/env python3
"""
ORICON NEWS エンタメ記事を取得して Markdown ファイルとして保存する。
"""

import os
import re
import sys
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request
from html.parser import HTMLParser

JST = timezone(timedelta(hours=9))
BASE_URL = "https://www.oricon.co.jp"
TARGET_URL = f"{BASE_URL}/entertainment/"
MAX_ARTICLES = 5
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


class ArticleListParser(HTMLParser):
    """エンタメ一覧ページから記事リンクとタイトルを抽出する。"""

    def __init__(self):
        super().__init__()
        self.articles = []
        self._in_link = False
        self._current = {}
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            attr_dict = dict(attrs)
            href = attr_dict.get("href", "")
            if re.match(r"^/(news|article)/\d+/?$", href):
                self._in_link = True
                self._current = {"url": BASE_URL + href, "title": ""}
                self._depth = 0

    def handle_data(self, data):
        if self._in_link:
            self._current["title"] += data.strip()

    def handle_endtag(self, tag):
        if tag == "a" and self._in_link:
            self._in_link = False
            title = self._current.get("title", "").strip()
            url = self._current.get("url", "")
            if title and url and len(self.articles) < 30:
                if not any(a["url"] == url for a in self.articles):
                    self.articles.append({"url": url, "title": title})


class ArticleBodyParser(HTMLParser):
    """個別記事ページから本文テキストを抽出する。"""

    def __init__(self):
        super().__init__()
        self.paragraphs = []
        self._in_article = False
        self._in_p = False
        self._current_text = ""
        self._skip_tags = {"script", "style", "noscript"}
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        cls = attr_dict.get("class", "")
        if tag in ("article", "div") and ("article-body" in cls or "news-article" in cls or "article__body" in cls):
            self._in_article = True
        if tag in self._skip_tags:
            self._skip_depth += 1
        if tag == "p" and self._skip_depth == 0:
            self._in_p = True
            self._current_text = ""

    def handle_data(self, data):
        if self._in_p and self._skip_depth == 0:
            self._current_text += data

    def handle_endtag(self, tag):
        if tag in self._skip_tags and self._skip_depth > 0:
            self._skip_depth -= 1
        if tag == "p" and self._in_p:
            self._in_p = False
            text = self._current_text.strip()
            if text and len(text) > 10:
                self.paragraphs.append(text)


def fetch_page(url, encoding="utf-8"):
    """URLからHTMLを取得する。"""
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=30) as resp:
        raw = resp.read()
    for enc in [encoding, "utf-8", "shift_jis", "euc-jp", "cp932"]:
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="replace")


def fetch_article_body(url):
    """個別記事のURLから本文を取得する。"""
    try:
        html = fetch_page(url)
        parser = ArticleBodyParser()
        parser.feed(html)
        if parser.paragraphs:
            return "\n\n".join(parser.paragraphs)

        # フォールバック: <p>タグから直接抽出
        paragraphs = re.findall(r"<p[^>]*>(.*?)</p>", html, re.DOTALL)
        texts = []
        for p in paragraphs:
            clean = re.sub(r"<[^>]+>", "", p).strip()
            if clean and len(clean) > 15:
                texts.append(clean)
        if texts:
            return "\n\n".join(texts[:20])
    except Exception as e:
        print(f"  Warning: Could not fetch body from {url}: {e}", file=sys.stderr)

    return "(本文の取得に失敗しました。元記事をご確認ください。)"


def sanitize_filename(title):
    """ファイル名に使えない文字を除去する。"""
    name = re.sub(r'[\\/:*?"<>|]', '', title)
    name = re.sub(r'\s+', '_', name)
    return name[:80] if name else "untitled"


def main():
    repo_root = os.environ.get("GITHUB_WORKSPACE", os.getcwd())
    now = datetime.now(JST)
    folder_name = now.strftime("%Y-%m-%d_%H%M%S")
    output_dir = os.path.join(repo_root, "articles", folder_name)

    print(f"Fetching articles from: {TARGET_URL}")
    html = fetch_page(TARGET_URL)

    parser = ArticleListParser()
    parser.feed(html)

    if not parser.articles:
        print("No articles found. Exiting.")
        sys.exit(1)

    articles = parser.articles[:MAX_ARTICLES]
    print(f"Found {len(articles)} articles to process.")

    os.makedirs(output_dir, exist_ok=True)

    for i, article in enumerate(articles, 1):
        title = article["title"]
        url = article["url"]
        print(f"\n[{i}/{len(articles)}] {title}")
        print(f"  URL: {url}")

        body = fetch_article_body(url)
        filename = f"{i:02d}_{sanitize_filename(title)}.md"
        filepath = os.path.join(output_dir, filename)

        md_content = f"""---
title: "{title.replace('"', '\\"')}"
source: "{url}"
fetched_at: "{now.strftime('%Y-%m-%d %H:%M:%S')} JST"
---

# {title}

> 出典: [{url}]({url})

---

{body}
"""
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(md_content)
        print(f"  Saved: {filepath}")

    print(f"\nDone! {len(articles)} articles saved to {output_dir}")


if __name__ == "__main__":
    main()
