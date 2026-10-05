---
name: create-private-kadai
description: >
  限定公開の課題ページ（kadai）を生成するスキル。長いハッシュ付きURL、noindex、コメント非公開（TOPに表示しない）の設定で、
  知っている人だけがアクセスできる課題ページを作成する。
  「限定課題」「非公開課題」「private kadai」「課題ページ作成」「ハッシュURL」などのキーワードで使用する。
allowed-tools: Bash Read Write Edit Grep WebFetch mcp__Claude_in_Chrome__navigate mcp__Claude_in_Chrome__read_page mcp__Claude_in_Chrome__get_page_text
---

# create-private-kadai スキル

https://bbs.unikoukokun.com/kadai.html の公開課題ページをベースに、
**限定公開（知っている人だけアクセス可能）** の課題ページを生成する。

---

## 前提知識：公開版 kadai.html の構成

公開版 `kadai.html` は以下の要素で構成されている：

- **進捗トラッキング**: 「0 / N 完了」のプログレスバー＋リセット機能
- **名前入力フィールド**: 完了ボタン押下時に必須
- **課題セクション**: 番号付き（⚙️🎮🌐🛠️等のEmoji）、折りたたみ可能な詳細
- **コピペ用プロンプトブロック**: 📋ラベル付き
- **コメント/Q&Aスレッド**: 掲示板 `/q/{thread_id}` への遅延読み込み連携
- **補足・よくある質問**: 折りたたみセクション
- **画像**: `/aio/img/kadai-*.jpg` 形式の指導用画像

---

## 限定公開版の要件

### URL設計
- ファイル名: `kadai-{64文字のランダムハッシュ}.html`
- 例: `kadai-a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1.html`
- ハッシュ生成: `openssl rand -hex 32` または PowerShell `[System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)`

### SEO制御（noindex）
```html
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="googlebot" content="noindex, nofollow">
```

### コメントの非公開設定
- コメント機能自体は利用可能（参加者同士の質疑に必要）
- **TOPページ・最新コメント一覧には表示しない**
- 掲示板スレッド作成時に `unlisted` または `private` フラグを設定
- スレッドURLも推測困難なハッシュ付きにする

---

## PHASE 1 — 課題内容の定義

ユーザーに以下を確認する（AskUserQuestion を使用）：

1. **課題のタイトル**（例：「Claude Code 応用ワークショップ」）
2. **課題の数**（デフォルト: 4）
3. **各課題の内容**（タイトル、説明、プロンプトテンプレート、補足画像の有無）
4. **コメント機能**: 有効/無効
5. **公開期限**: 期限付き or 無期限

---

## PHASE 2 — HTML生成

### 2-1. ハッシュ生成

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$hash = -join ($bytes | ForEach-Object { $_.ToString("x2") })
$filename = "kadai-$hash.html"
```

### 2-2. HTMLテンプレート生成

公開版 kadai.html の構造を踏襲しつつ、以下を変更：

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- 限定公開: 検索エンジンに登録させない -->
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta name="googlebot" content="noindex, nofollow">
  <title>{課題タイトル}</title>
  <style>
    /* 公開版と同じスタイルを適用 */
    :root {
      --primary: #2563eb;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #1e293b;
      --border: #e2e8f0;
      --success: #22c55e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.8;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      text-align: center;
      padding: 2rem 0;
      border-bottom: 2px solid var(--border);
      margin-bottom: 2rem;
    }
    .header h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .private-badge {
      display: inline-block;
      background: #fef3c7;
      color: #92400e;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 0.85rem;
      font-weight: bold;
    }
    .progress-bar {
      background: var(--border);
      border-radius: 8px;
      height: 8px;
      margin: 1rem 0;
      overflow: hidden;
    }
    .progress-bar .fill {
      background: var(--success);
      height: 100%;
      width: 0%;
      transition: width 0.3s;
    }
    .progress-text { text-align: center; font-size: 0.9rem; color: #64748b; }
    .name-input {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: center;
      margin: 1rem 0;
    }
    .name-input input {
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 1rem;
    }
    .task-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .task-card h2 {
      font-size: 1.2rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .task-card .status {
      font-size: 0.85rem;
      padding: 2px 8px;
      border-radius: 4px;
      background: var(--border);
    }
    .task-card .status.done {
      background: #dcfce7;
      color: #166534;
    }
    .prompt-block {
      background: #1e293b;
      color: #e2e8f0;
      padding: 1rem;
      border-radius: 8px;
      margin: 1rem 0;
      position: relative;
      white-space: pre-wrap;
      font-family: 'Courier New', monospace;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: var(--primary);
      color: white;
      border: none;
      padding: 4px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .copy-btn:hover { opacity: 0.8; }
    details {
      margin: 0.5rem 0;
      padding: 0.5rem;
      border-left: 3px solid var(--border);
    }
    details summary {
      cursor: pointer;
      font-weight: bold;
      color: var(--primary);
    }
    .complete-btn {
      display: block;
      width: 100%;
      padding: 12px;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      margin-top: 1rem;
    }
    .complete-btn:hover { opacity: 0.9; }
    .complete-btn:disabled {
      background: #94a3b8;
      cursor: not-allowed;
    }
    .comment-section {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px dashed var(--border);
    }
    .comment-toggle {
      cursor: pointer;
      color: var(--primary);
      font-size: 0.9rem;
    }
    .comment-area {
      display: none;
      margin-top: 0.5rem;
    }
    .comment-area.open { display: block; }
    .comment-area textarea {
      width: 100%;
      min-height: 80px;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 0.9rem;
      resize: vertical;
    }
    .comment-area button {
      margin-top: 8px;
      padding: 6px 16px;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .footer {
      text-align: center;
      padding: 2rem 0;
      color: #94a3b8;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="private-badge">🔒 限定公開</span>
    <h1>{課題タイトル}</h1>
    <p>{課題の説明}</p>
    <div class="progress-bar"><div class="fill" id="progressFill"></div></div>
    <div class="progress-text" id="progressText">0 / {N} 完了</div>
    <div class="name-input">
      <label>お名前：</label>
      <input type="text" id="userName" placeholder="名前を入力">
    </div>
  </div>

  <!-- 課題セクション（動的に生成） -->
  <!-- {TASK_SECTIONS} -->

  <div class="footer">
    <p>このページは限定公開です。URLを知っている方のみアクセスできます。</p>
    <p><button onclick="resetProgress()" style="background:none;border:1px solid #94a3b8;padding:4px 12px;border-radius:4px;color:#94a3b8;cursor:pointer;">進捗をリセット</button></p>
  </div>

  <script>
    const TOTAL_TASKS = {N};
    const STORAGE_KEY = 'kadai_{hash}_progress';

    function loadProgress() {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      let completed = 0;
      for (let i = 1; i <= TOTAL_TASKS; i++) {
        if (data['task' + i]) {
          completed++;
          const btn = document.getElementById('completeBtn' + i);
          if (btn) { btn.disabled = true; btn.textContent = '✅ 完了済み'; }
          const status = document.getElementById('status' + i);
          if (status) { status.textContent = '完了'; status.classList.add('done'); }
        }
      }
      document.getElementById('progressFill').style.width = (completed / TOTAL_TASKS * 100) + '%';
      document.getElementById('progressText').textContent = completed + ' / ' + TOTAL_TASKS + ' 完了';
    }

    function completeTask(n) {
      const name = document.getElementById('userName').value.trim();
      if (!name) { alert('お名前を入力してください'); return; }
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      data['task' + n] = { name: name, completedAt: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      loadProgress();
    }

    function resetProgress() {
      if (confirm('進捗をリセットしますか？')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      }
    }

    function toggleComment(id) {
      const el = document.getElementById('comment-' + id);
      el.classList.toggle('open');
    }

    loadProgress();
  </script>
</body>
</html>
```

### 2-3. 課題セクションの動的生成

各課題ごとに以下のHTMLブロックを生成して `{TASK_SECTIONS}` に挿入：

```html
<div class="task-card" id="task{i}">
  <h2>{emoji} 課題{i}：{タイトル} <span class="status" id="status{i}">未完了</span></h2>
  <p>{説明文}</p>

  <!-- プロンプトテンプレート（ある場合） -->
  <div class="prompt-block">
    <button class="copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.textContent.replace('📋 コピー','').trim())">📋 コピー</button>
{プロンプトテキスト}
  </div>

  <!-- 補足（ある場合） -->
  <details>
    <summary>💡 補足</summary>
    <p>{補足内容}</p>
  </details>

  <!-- よくある質問（ある場合） -->
  <details>
    <summary>❓ よくある質問</summary>
    <p>{FAQ内容}</p>
  </details>

  <!-- コメント（有効な場合） -->
  <div class="comment-section">
    <span class="comment-toggle" onclick="toggleComment({i})">💬 質問・コメント（クリックで開く）</span>
    <div class="comment-area" id="comment-{i}">
      <textarea placeholder="質問や感想を入力..."></textarea>
      <button>投稿する</button>
    </div>
  </div>

  <button class="complete-btn" id="completeBtn{i}" onclick="completeTask({i})">✅ 課題{i}を完了にする</button>
</div>
```

---

## PHASE 3 — ファイル出力

### 3-1. 出力先

```
$ROOT/kadai-pages/
├── kadai-{hash}.html
└── README.md          ← 生成済みページ一覧（タイトル・URL・作成日）
```

### 3-2. README.md の更新

```markdown
# 限定公開 課題ページ一覧

| タイトル | ファイル名 | 作成日 | URL |
|---|---|---|---|
| {タイトル} | kadai-{hash}.html | {YYYY-MM-DD} | https://bbs.unikoukokun.com/kadai-{hash}.html |
```

---

## PHASE 4 — デプロイ確認

生成されたHTMLファイルをユーザーに提示し、以下を確認：

1. **ローカルプレビュー**: ブラウザで開いて表示確認
2. **デプロイ方法の案内**:
   - サーバーにアップロード（FTP/SCP/rsync等）
   - GitHub Pages等の静的ホスティング
   - ユーザーの既存のデプロイフローに従う
3. **URLの共有**: 生成されたハッシュ付きURLを対象者にのみ共有

---

## PHASE 5 — 完了レポート

| 項目 | 内容 |
|---|---|
| ファイル名 | kadai-{hash}.html |
| URL | https://bbs.unikoukokun.com/kadai-{hash}.html |
| 課題数 | {N}個 |
| noindex | ✅ 設定済み |
| コメント | {有効/無効}（TOP非表示） |
| 生成日 | {YYYY-MM-DD} |

---

## 注意事項

- ハッシュURLは推測困難だが、URLを知っていれば誰でもアクセスできる（認証は別途必要なら実装）
- `robots.txt` での追加ブロックは、URL構造を晒すリスクがあるため非推奨
- 公開版 kadai.html のスタイルやスクリプトが更新された場合、限定版も同期が必要
