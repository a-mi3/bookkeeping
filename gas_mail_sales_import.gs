/**
 * 産直サイトの売上速報メールを自動取込 → 「売上実績」シートに追記する Google Apps Script
 *
 * 位置づけ:
 *   出荷データ（yasai_shipping.html が管理）= 出荷した(送った)数
 *   売上実績（このスクリプトが管理）      = 実際に売れた数・金額
 *   同じ日付・店舗・野菜で突き合わせれば「送った分がどれだけ売れたか」を比較できる
 *
 * 対象スプレッドシート: yasai_shipping.html と同じ SPREADSHEET_ID
 * 使い方:
 *   1. https://script.google.com/ で新規プロジェクトを作成（スタンドアロンでOK。
 *      SPREADSHEET_ID で直接開くので紐づけは不要）
 *   2. このファイルの内容をまるごと貼り付けて保存
 *   3. 関数選択で setupTrigger を選び、一度だけ手動実行して権限を許可する
 *      → 毎日20:30頃に importDailySales が自動実行されるようになる
 *   4. 新しい送信元が増えたら SENDER_CONFIGS に追記し、その送信元専用の
 *      パーサー関数（parseXxxMail）を書き足す
 *
 * 過去分をまとめて取り込みたい場合:
 *   関数選択で backfillSeptember（またはコピーして日付を変えた関数）を選んで
 *   手動実行する。内部で日毎に importForDate を呼び、既存行があれば洗い替えるので
 *   何度実行しても重複しない。
 */

const SPREADSHEET_ID = '1fdJhfEmOB1kwOBCm3NCxQqSvN6VLvOSjzweruxqnQp0';
const RESULT_SHEET = '売上実績';
const SETTINGS_SHEET = '設定';
const RESULT_HEADER = ['日付', '店舗', '野菜', '単価', '点数', '金額', '手数料率(%)', '入金見込額', '送信元', 'メールID'];

// 送信元ごとの設定。parser は body(本文文字列) を受け取り
// { date: 'yyyy-MM-dd', items: [{store, veggie, price, qty}, ...] } を返す関数。
const SENDER_CONFIGS = [
  {
    label: 'netDoA産直',
    query: 'from:sanchoku-announcer@netdoa-nx.jp',
    parser: parseNetdoaMail,
  },
  {
    label: '加波山市場(himesan)',
    query: 'from:kabasanichiba0814@himesan.com',
    parser: parseHimesanMail,
  },
  {
    label: '道の駅しもつま(himesan)',
    query: 'from:rsshimotsuma0826@himesan.com',
    parser: parseHimesanMail,
  },
  {
    label: '道の駅グランテラス筑西(himesan)',
    query: 'from:Route-50-station0823@himesan.com',
    parser: parseGrandTerraceMail,
  },
  {
    label: 'グラントマト',
    query: 'from:sanchoku@grantomato.jp',
    parser: parseGrantomatoMail,
  },
  // 送信元が増えたらここに追記する。例:
  // { label: '別の産直サイト', query: 'from:xxx@example.jp', parser: parseXxxMail },
];

// メール本文の店舗表記 → yasai_shipping.html(設定シート)の店舗名 への読み替え表。
// 手数料率の突き合わせや表記統一のために使う。無ければ本文の表記のまま使う。
const STORE_NAME_ALIASES = {
  'フードマート下妻店': 'グラントマト下妻',
  '道の駅グランテラス筑西': 'グランテラス筑西',
};

// 道の駅しもつま（農産館・物産館）は同じ「道の駅しもつま」でも商品によって
// 加工品/生鮮の手数料率が分かれる。商品名にこれらのキーワードを含む場合は「加工品」扱いにする。
// 店舗名は yasai_shipping.html の入力画面（設定シート）の表記に合わせてある。
const SHIMOTSUMA_PROCESSED_KEYWORDS = ['塩', '唐辛子', '唐がらし', '七味', 'だし'];
const SHIMOTSUMA_RAW_STORE_NAMES = ['農産館', '物産館'];

function resolveStoreName(rawStore, veggie) {
  if (SHIMOTSUMA_RAW_STORE_NAMES.includes(rawStore)) {
    const isProcessed = SHIMOTSUMA_PROCESSED_KEYWORDS.some((k) => veggie.includes(k));
    return isProcessed ? '道の駅しもつま（加工品）' : '道の駅しもつま';
  }
  return STORE_NAME_ALIASES[rawStore] || rawStore;
}

/** 毎日20:30頃に実行するトリガーを1回だけ登録する（設定変更時も再実行すればよい） */
function setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'importDailySales')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('importDailySales')
    .timeBased()
    .everyDays(1)
    .atHour(20)
    .nearMinute(30)
    .create();
}

/** トリガーから毎日呼ばれる本体: 「本日」を対象に取り込む */
function importDailySales() {
  importForDate(new Date());
}

/**
 * 過去分をまとめて取り込みたいときに使う。
 * 例: 9月1日〜9月9日分をまとめて取り込みたい場合、スクリプトエディタで
 *     backfillRange('2026-09-01', '2026-09-09') を選んで手動実行する。
 * （関数の引数はエディタの「実行」ボタンからは渡せないので、下の
 *   backfillSeptember のように呼び出し専用の関数を用意して実行するとよい）
 */
function backfillRange(startYmd, endYmd) {
  const start = parseYmd(startYmd);
  const end = parseYmd(endYmd);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    importForDate(new Date(d));
  }
}

/** 例: 2026年9月分をまとめて取り込みたいときに実行する（日付は必要に応じて書き換える） */
function backfillSeptember() {
  backfillRange('2026-09-01', '2026-09-30');
}

/** 指定した日付を対象に、各送信元の「その日届いた最新の1通」を取り込む */
function importForDate(targetDate) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, RESULT_SHEET, RESULT_HEADER);
  // 日付列がスプレッドシート側で自動的に日付型に変換され、
  // 文字列処理(substring等)が壊れるのを防ぐためテキスト固定にする
  sheet.getRange('A:A').setNumberFormat('@');
  const feeByStore = loadFeeByStore(ss);
  const existingMessageIds = new Set(
    sheet.getDataRange().getValues().slice(1).map((r) => String(r[9]))
  );

  const tz = Session.getScriptTimeZone();
  const afterStr = Utilities.formatDate(targetDate, tz, 'yyyy/MM/dd');
  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const beforeStr = Utilities.formatDate(nextDay, tz, 'yyyy/MM/dd');
  const targetYmd = Utilities.formatDate(targetDate, tz, 'yyyy-MM-dd');

  SENDER_CONFIGS.forEach((cfg) => {
    try {
      const threads = GmailApp.search(`${cfg.query} after:${afterStr} before:${beforeStr}`);
      const messagesForDate = [];
      threads.forEach((thread) => {
        thread.getMessages().forEach((msg) => {
          if (isSameDate(msg.getDate(), targetDate)) messagesForDate.push(msg);
        });
      });
      if (!messagesForDate.length) {
        Logger.log(`[${cfg.label}] ${targetYmd} のメールなし`);
        return;
      }

      // 同じ送信元アドレスから「複数の店舗」の速報が別々のメールで同時刻に届くことがある
      // （例：道の駅しもつまは農産館・物産館が別メール）ため、1通だけに絞らず全通を解析し、
      // 本文中の店舗名（生の見出し）ごとに最新のメールを採用する
      const latestByRawStore = {};
      messagesForDate.forEach((msg) => {
        const body = msg.getPlainBody();
        const parsed = cfg.parser(body);
        if (!parsed || !parsed.items.length) return;
        const byStore = {};
        parsed.items.forEach((item) => {
          if (!byStore[item.store]) byStore[item.store] = [];
          byStore[item.store].push(item);
        });
        Object.entries(byStore).forEach(([rawStore, items]) => {
          const existing = latestByRawStore[rawStore];
          if (!existing || msg.getDate() > existing.msgDate) {
            latestByRawStore[rawStore] = { msgDate: msg.getDate(), messageId: msg.getId(), items, date: parsed.date };
          }
        });
      });

      const rawStoreNames = Object.keys(latestByRawStore);
      if (!rawStoreNames.length) {
        Logger.log(`[${cfg.label}] ${targetYmd}: 明細を抽出できませんでした`);
        return;
      }

      rawStoreNames.forEach((rawStore) => {
        const { messageId, items, date } = latestByRawStore[rawStore];
        if (existingMessageIds.has(messageId)) {
          Logger.log(`[${cfg.label}/${rawStore}] 既に取込済み: ${messageId}`);
          return;
        }

        const rows = items.map((item) => {
          const storeName = resolveStoreName(item.store, item.veggie);
          const fee = feeByStore[storeName] || 0;
          const total = item.qty * item.price;
          const income = Math.round(total * (1 - fee / 100));
          return [date, storeName, item.veggie, item.price, item.qty, total, fee, income, cfg.label, messageId];
        });

        // 同じ店舗・同じ日付の行が既にあれば削除してから最新内容で書き直す
        // （同じ日を複数回取り込んだ場合の重複防止。店舗単位で消すので、同じ送信元の
        // 別店舗（例：物産館 vs 農産館）の行を巻き込んで消してしまうことはない）
        const uniqueStoreNames = [...new Set(rows.map((r) => r[1]))];
        uniqueStoreNames.forEach((storeName) => removeExistingRows(sheet, storeName, date));

        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
        Logger.log(`[${cfg.label}/${rawStore}] ${rows.length}件取込完了 (${date})`);
      });
    } catch (e) {
      Logger.log(`[${cfg.label}] エラー: ${e}`);
    }
  });

  sortResultSheetByDateDesc(sheet);
  updateResultAggregates(ss, sheet);
  buildResultFilterSheet(ss, sheet);
  SpreadsheetApp.flush(); // 保留中の書き込みをこの実行内で確定させ、エラーが次回実行に持ち越されないようにする
}

const RESULT_FILTER_SHEET = '売上実績_絞り込み';

/**
 * 「売上実績_絞り込み」シートを作る/更新する。
 * yasai_shipping.html の「絞り込み」シート（月選択＋店舗チェックボックスでFILTER）と同じ考え方。
 * 既存の月選択・チェック状態はできるだけ引き継ぎ、新しく増えた店舗だけチェック済みで追加する。
 */
function buildResultFilterSheet(ss, resultSheet) {
  const tz = Session.getScriptTimeZone();
  const lastRow = resultSheet.getLastRow();
  const values = lastRow > 1 ? resultSheet.getRange(2, 1, lastRow - 1, resultSheet.getLastColumn()).getValues() : [];

  const allMonths = [...new Set(values.map((r) => toYmd(r[0], tz).substring(0, 7)).filter(Boolean))].sort((a, b) =>
    b.localeCompare(a)
  );
  const storeList = [...new Set(values.map((r) => r[1]).filter(Boolean))];

  let sheet = ss.getSheetByName(RESULT_FILTER_SHEET);
  const isNew = !sheet;
  if (!sheet) sheet = ss.insertSheet(RESULT_FILTER_SHEET);

  let currentYm = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const existingChecks = {};
  if (!isNew) {
    const existingB1 = sheet.getRange('B1').getValue();
    if (existingB1) currentYm = toYmd(existingB1, tz).substring(0, 7) || String(existingB1);
    const existingLastRow = sheet.getLastRow();
    if (existingLastRow >= 2) {
      sheet.getRange(2, 1, existingLastRow - 1, 4).getValues().forEach((r) => {
        if (r[2]) existingChecks[r[2]] = !!r[3];
      });
    }
  }

  const vals = [['【月選択】', currentYm, '【店舗選択】', '']];
  storeList.forEach((s) => {
    const checked = Object.prototype.hasOwnProperty.call(existingChecks, s) ? existingChecks[s] : true;
    vals.push(['', '', s, checked]);
  });
  while (vals.length < 13) vals.push(['', '', '', '']);
  vals.push(['', '', '', '']);
  const headerRow = vals.length + 1;
  vals.push(['日付', '店舗', '野菜', '単価', '点数', '金額', '手数料率(%)', '入金見込額', '送信元', 'メールID']);

  // 以前設定した入力規則(データ検証)が残っていると、新しい値を書き込む際に
  // 「規則に違反しています」エラーになることがあるため、書き込み前に必ずクリアする
  const clearRange = sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), vals.length, 200), 10);
  clearRange.clearDataValidations();

  // B1(月選択)がスプレッドシートに日付型として自動変換されるのを防ぐ
  // ※D列(チェックボックスの真偽値)まで巻き込むと壊れるため、B1だけに限定する
  sheet.getRange('B1').setNumberFormat('@');

  sheet.clearContents();
  sheet.getRange(1, 1, vals.length, 10).setValues(
    vals.map((row) => {
      const padded = row.slice();
      while (padded.length < 10) padded.push('');
      return padded;
    })
  );

  if (storeList.length) {
    const lastCheckRow = 1 + storeList.length;
    const checkboxRange = sheet.getRange(2, 4, storeList.length, 1);
    checkboxRange.setNumberFormat('General'); // 以前バグで付いたテキスト書式を解除し、真偽値として扱えるようにする
    checkboxRange.setValues(storeList.map((s) => [existingChecks.hasOwnProperty(s) ? existingChecks[s] : true]));
    checkboxRange.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    const monthList = allMonths.length ? allMonths : [currentYm];
    sheet.getRange('B1').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(monthList, true).setAllowInvalid(false).build()
    );

    const formulaRow = headerRow + 1;
    const formula =
      `=IFERROR(FILTER(${RESULT_SHEET}!A2:J,LEFT(${RESULT_SHEET}!A2:A,7)=B1,` +
      `ISNUMBER(MATCH(${RESULT_SHEET}!B2:B,FILTER(C2:C${lastCheckRow},D2:D${lastCheckRow}=TRUE),0))),"該当データなし")`;
    sheet.getRange(formulaRow, 1).setFormula(formula);
  }
}

/** 「売上実績」シートをヘッダーを除いて日付の新しい順に並べ替える */
function sortResultSheetByDateDesc(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 2) return; // ヘッダーのみ、または1行しかない場合は不要
  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort({ column: 1, ascending: false });
}

/** 「売上実績」の中身から店舗別・月次の集計シートを作り直す */
function updateResultAggregates(ss, resultSheet) {
  const tz = Session.getScriptTimeZone();
  const lastRow = resultSheet.getLastRow();
  const values = lastRow > 1 ? resultSheet.getRange(2, 1, lastRow - 1, resultSheet.getLastColumn()).getValues() : [];

  const byStore = {};
  const byMonth = {};
  values.forEach((r) => {
    const date = toYmd(r[0], tz);
    const store = r[1];
    const qty = Number(r[4]) || 0;
    const total = Number(r[5]) || 0;
    const income = Number(r[7]) || 0;
    if (!date || !store) return;

    if (!byStore[store]) byStore[store] = { count: 0, qty: 0, total: 0, income: 0 };
    byStore[store].count += 1;
    byStore[store].qty += qty;
    byStore[store].total += total;
    byStore[store].income += income;

    const ym = date.substring(0, 7);
    if (!byMonth[ym]) byMonth[ym] = { count: 0, qty: 0, total: 0, income: 0 };
    byMonth[ym].count += 1;
    byMonth[ym].qty += qty;
    byMonth[ym].total += total;
    byMonth[ym].income += income;
  });

  const storeHeader = ['店舗', '件数', '点数', '金額(税込)', '入金見込額'];
  const storeRows = Object.entries(byStore)
    .sort((a, b) => b[1].income - a[1].income)
    .map(([name, v]) => [name, v.count, v.qty, v.total, v.income]);
  writeSheetRows(getOrCreateSheet(ss, '売上実績_店舗別', storeHeader), storeHeader, storeRows);

  const monthHeader = ['年月', '件数', '点数', '金額(税込)', '入金見込額'];
  const monthRows = Object.entries(byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ym, v]) => [ym, v.count, v.qty, v.total, v.income]);
  writeSheetRows(getOrCreateSheet(ss, '売上実績_月次集計', monthHeader), monthHeader, monthRows);
}

/** シートの中身を丸ごとヘッダー+データ行で書き直す */
function writeSheetRows(sheet, header, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
}

function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* ===================== 送信元ごとのパーサー ===================== */

/**
 * netDoA産直の形式:
 *   2026年09月09日 17時45分 現在
 *   ...
 *   ピーマン/音ファーム　(単価150円)                           1点      150円
 * 店舗名は本文に出てこないため、この送信元は「さわやか直売所」固定として扱う。
 */
function parseNetdoaMail(body) {
  const dateMatch = body.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const date = dateMatch
    ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const itemPattern = /^([^\/\s]+)\/(\S+?)\s*\(単価(\d+)円\)\s+(\d+)点\s+(\d+)円\s*$/;
  const items = [];
  body.split(/\r?\n/).forEach((line) => {
    const m = line.trim().match(itemPattern);
    if (!m) return;
    items.push({
      store: 'さわやか直売所',
      veggie: m[1],
      price: parseInt(m[3], 10),
      qty: parseInt(m[4], 10),
    });
  });
  return { date, items };
}

/**
 * himesan(クラセル桜川)の形式:
 *   より　2026年09月09日　 の確定売上情報をお知らせします。
 *   加波山市場
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━
 *   商品　　　　　　　　　　　　 価格　点数　　　 金額
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━
 *   トウモロコシ                260円    6     1,560円
 *   ズッキーニ                  130円    2       260円
 *                               150円    2       300円   ← 商品名省略行は直前の商品名を引き継ぐ
 *   ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
 *   計                                  12     2,830円
 * 1通の中に複数店舗のセクションが並ぶことがある想定。
 */
function parseHimesanMail(body) {
  const dateMatch = body.match(/より\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const date = dateMatch
    ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const itemPattern = /^(.*?)\s*(\d+)円\s+(\d+)\s+([\d,]+)円$/;
  const skipKeywords = /より|様|情報をお知らせ|返信不可|お問い合わせ|株式会社|TEL|FAX|----/;

  let currentStore = null;
  let lastVeggie = null;
  const items = [];

  body.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (/^[━]+$/.test(line)) return;
    if (/^[＝]+$/.test(line)) { lastVeggie = null; return; }
    if (/商品.*価格.*点数.*金額/.test(line)) return;
    if (/^(計|合計)/.test(line)) return;

    const m = line.match(itemPattern);
    if (m) {
      if (!currentStore) return; // 店舗名が確定する前の明細行は無視
      const name = m[1].trim();
      const veggie = name || lastVeggie;
      if (!veggie) return;
      lastVeggie = veggie;
      items.push({
        store: currentStore,
        veggie,
        price: parseInt(m[2], 10),
        qty: parseInt(m[3], 10),
      });
      return;
    }

    // 数字を含まず、定型文キーワードも含まない行 → 店舗名の見出し行とみなす
    if (!/\d/.test(line) && !skipKeywords.test(line)) {
      currentStore = line;
      lastVeggie = null;
    }
  });

  return { date, items };
}

/**
 * 道の駅グランテラス筑西(himesan)の形式:
 *   ...より
 *   2026年09月06日 18時　時点の売上情報をお知らせします。
 *
 *   道の駅グランテラス筑西        ← 店舗見出し
 *   福来みかん塩                  ← 商品名
 *   　 650円                      ← 単価（1行単独）
 *   　　　2点 1,300円             ← 点数と金額（1行）
 *   福来みかん七味唐辛子
 *   　 650円
 *   　　　1点 650円
 *   計
 *   　 3点 1,950円                ← 合計行（無視）
 * 商品名・単価・点数&金額がそれぞれ別行になっている点が himesan 標準形式と異なる。
 */
function parseGrandTerraceMail(body) {
  const dateMatch = body.match(/より\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const date = dateMatch
    ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const skipKeywords = /より|様|情報をお知らせ|返信不可|お問い合わせ|株式会社|TEL|FAX|----|\(株\)|（株）/;

  let currentStore = null;
  let awaitingStore = true;
  let pendingVeggie = null;
  let pendingPrice = null;
  const items = [];

  body.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;

    if (/^計/.test(line)) {
      pendingVeggie = null;
      pendingPrice = null;
      awaitingStore = true;
      return;
    }

    const priceMatch = line.match(/^(\d+)円$/);
    if (priceMatch) {
      pendingPrice = parseInt(priceMatch[1], 10);
      return;
    }

    const qtyMatch = line.match(/^(\d+)点\s+([\d,]+)円$/);
    if (qtyMatch) {
      if (currentStore && pendingVeggie && pendingPrice != null) {
        items.push({
          store: currentStore,
          veggie: pendingVeggie,
          price: pendingPrice,
          qty: parseInt(qtyMatch[1], 10),
        });
      }
      pendingVeggie = null;
      pendingPrice = null;
      return;
    }

    if (/\d/.test(line) || skipKeywords.test(line)) return; // 無関係な行

    if (awaitingStore) {
      currentStore = line;
      awaitingStore = false;
    } else {
      pendingVeggie = line;
      pendingPrice = null;
    }
  });

  return { date, items };
}

/**
 * グラントマトの形式:
 *   フードマート下妻店よりお知らせします。
 *   尾﨑　省造様の売上情報(点検)。
 *   2026年08月03日20時現在の売上
 *
 *   なす
 *    160円
 *      1点  160円
 *   合計
 *      1点  160円
 * 店舗名が独立した見出し行ではなく「〇〇店よりお知らせします。」という文中に
 * 埋め込まれている点が他形式と異なる。1通あたり店舗は1つのみを想定。
 */
function parseGrantomatoMail(body) {
  const dateMatch = body.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const date = dateMatch
    ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const storeLineMatch = body.match(/^(.+?)より.*お知らせ/m);
  const currentStore = storeLineMatch ? storeLineMatch[1].trim() : null;

  const skipLine = /より.*お知らせ|様の売上情報|現在の売上|配信停止|株式会社|@|^\d[\d-]*\d$/;

  let pendingVeggie = null;
  let pendingPrice = null;
  const items = [];

  body.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || skipLine.test(line)) return;

    if (/^(計|合計)/.test(line)) {
      pendingVeggie = null;
      pendingPrice = null;
      return;
    }

    const priceMatch = line.match(/^(\d+)円$/);
    if (priceMatch) {
      pendingPrice = parseInt(priceMatch[1], 10);
      return;
    }

    const qtyMatch = line.match(/^(\d+)点\s+([\d,]+)円$/);
    if (qtyMatch) {
      if (currentStore && pendingVeggie && pendingPrice != null) {
        items.push({
          store: currentStore,
          veggie: pendingVeggie,
          price: pendingPrice,
          qty: parseInt(qtyMatch[1], 10),
        });
      }
      pendingVeggie = null;
      pendingPrice = null;
      return;
    }

    if (!/\d/.test(line)) {
      pendingVeggie = line;
      pendingPrice = null;
    }
  });

  return { date, items };
}

/* ===================== 共通ユーティリティ ===================== */

/** 設定シートから「店舗名 → 手数料率」の対応表を作る */
function loadFeeByStore(ss) {
  const sheet = ss.getSheetByName(SETTINGS_SHEET);
  const map = {};
  if (!sheet) return map;
  const values = sheet.getDataRange().getValues().slice(1); // ヘッダー除く
  values.forEach((r) => {
    if (r[0]) map[r[0]] = parseFloat(r[1]) || 0;
  });
  return map;
}

/**
 * 同一店舗・同一日付の既存行を削除する（再取込時の重複防止）。
 * 店舗名（解決後の店舗名）単位で消すため、同じ送信元アドレスから届く
 * 別店舗（例：物産館 vs 農産館）の行を巻き込んで消してしまうことはない。
 */
function removeExistingRows(sheet, storeName, date) {
  const tz = Session.getScriptTimeZone();
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (values[i][1] === storeName && toYmd(values[i][0], tz) === date) {
      sheet.deleteRow(i + 1);
    }
  }
}

/** セルの値が日付型でも文字列でも 'yyyy-MM-dd' 形式の文字列に揃える */
function toYmd(value, tz) {
  if (value instanceof Date) return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  return String(value || '');
}

function getOrCreateSheet(ss, name, header) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
  }
  return sheet;
}

function isSameDate(date, target) {
  return (
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
}

/* ===================== 一回限りのメンテナンス ===================== */

/**
 * シートの並び順をアプリのタブ構成（出荷側→売上側→設定）に揃え、
 * 使っていない「シート1」「出荷管理」を削除する。
 * 手動で一度だけ実行する想定（関数選択でこれを選んで実行ボタン）。
 */
function reorganizeSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  ['シート1', '出荷管理'].forEach((name) => {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      ss.deleteSheet(sheet);
      Logger.log(`削除: ${name}`);
    } else {
      Logger.log(`見つからないためスキップ（削除対象）: ${name}`);
    }
  });

  const order = [
    '出荷データ',
    '月次集計',
    '店舗別集計',
    '野菜別集計',
    '絞り込み',
    '売上実績',
    '売上実績_月次集計',
    '売上実績_店舗別',
    '売上実績_絞り込み',
    '設定',
  ];
  order.forEach((name, i) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      Logger.log(`見つからないためスキップ（並び替え対象）: ${name}`);
      return;
    }
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
  });
  Logger.log('並び替え完了');
}
