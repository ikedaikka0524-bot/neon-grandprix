# オンラインランキング（Firebase）の設定

ランキングは Firebase の「匿名認証」と「Realtime Database」を使います。`firebase-config.js` が `null` のあいだは
ランキング画面が「準備中」になり、何も送信されません（ゲームはこれまでどおり動きます）。

## 1. プロジェクトを作る
1. https://console.firebase.google.com/ →「プロジェクトを追加」→ 名前（例: `neon-grandprix`）→ 作成
   （Google アナリティクスはオフで OK）

## 2. 匿名認証を有効にする
1. 左メニュー「構築」→「Authentication」→「始める」
2. 「Sign-in method」タブ →「匿名」→ 有効にする → 保存
3. 「Settings」タブ →「承認済みドメイン」→「ドメインを追加」→ `ikedaikka0524-bot.github.io`

## 3. Realtime Database を作る
1. 「構築」→「Realtime Database」→「データベースを作成」
2. ロケーション: **シンガポール（asia-southeast1）**
3. セキュリティルール: **ロックモードで開始** → 有効にする

## 4. ルールを貼る
1. Realtime Database の「ルール」タブを開く
2. 中身をすべて消して、このリポジトリの `database.rules.json` の中身を貼り付け →「公開」
   - コースを追加したら `node tools/gen-rules.mjs` でファイルを作り直して、もう一度貼って公開

## 5. ウェブアプリを登録して設定をコピー
1. 歯車 →「プロジェクトの設定」→「全般」→ 下の「マイアプリ」→ `</>`（ウェブ）
2. アプリ名（例: `neon-gp-web`）→「アプリを登録」（Firebase Hosting は不要）
3. 表示される `firebaseConfig = { ... }` の中身を `firebase-config.js` に貼る:
   ```js
   export const FIREBASE_CONFIG = {
     apiKey: '...',
     authDomain: 'neon-grandprix.firebaseapp.com',
     databaseURL: 'https://neon-grandprix-default-rtdb.asia-southeast1.firebasedatabase.app',
     projectId: 'neon-grandprix',
     storageBucket: '...',
     messagingSenderId: '...',
     appId: '...',
   };
   ```
   **`databaseURL` が必須**です。表示に無ければ Realtime Database の画面上部の URL（`https://…firebasedatabase.app`）を入れてください。
   この値は公開されても大丈夫です（書き込みはルールで制限されています）。

## 6. デプロイ
`node tools/bump-build.mjs` → コミット → push。ホームの「ランキング」から見られます。

## ローカルで試す（エミュレーター）
Java 17 以上が必要です。
```
npx firebase-tools@13.35.1 emulators:start --only auth,database --project demo-neongp
node tools/check-lb-rules.mjs          # ルールのテスト（エミュレーターのデータは消えます）
python -m http.server 8090             # ブラウザのコンソールで localStorage['ngp.lb.emu'] = '1' → 再読み込み
```
