# CaOS iPad操作ガイドの制作資料

初めて使う人向けの、A4横・8ページのガイドです。既存の詳細マニュアルも残して更新しました。

- [全体構成と編集方針](composition.md)
- [入門ガイドのMarkdown本文](guide.md)
- [詳細マニュアル](../../master-sheet.md)
- [閲覧用PDF](../../pdf/master-sheet-ipad.pdf)
- [Illustrator向け編集データ一式](../../editable/master-sheet-editable.zip)
- [内容の点検記録](review.md)・[出力構造の検査結果](validation.json)
- [反映PRと対象外のPR](integration.md)

## 編集するとき

本文は先に`guide.md`で直します。`block`コメントとページ番号で組版先を対応させ、`sync-manuscript.cjs`でHTMLへ反映します。`layout-template.html`は配置と装飾、`manual.html`は反映後の出力です。HTMLの本文だけを直接直すと、次の同期で上書きされます。

既存の検索・音声入力・豆残量・練習などの詳しい手順は`master-sheet.md`に残しています。入門ガイドはその全量を8ページへ詰め込むものではありません。

## Illustratorで編集するとき

編集用ZIPに、8ページ分のSVGと編集上の注意を入れています。SVGでは段落ごとに1つの`text`要素を使い、折り返し行を`tspan`にまとめています。1文字ずつ別のテキスト要素に分解していません。見出しや注記も本文とは別の要素です。

本文はアウトライン化していません。Illustratorでは完全な **Noto Sans JP** フォントをインストールして開いてください。[Google Fontsの配布元](https://fonts.google.com/noto/specimen/Noto+Sans+JP)から入手できます。同梱・埋め込みのフォントは原稿に必要な499文字に絞ってあり、追加の文章に必要な字形をすべて含むものではありません。フォントのライセンスは[OFL.txt](fonts/OFL.txt)です。

SVGはブラウザーで表示・目視確認し、段落構造と画像埋め込みを検査しました。Illustrator実機での読み込みは未確認です。SVGの`text`がIllustratorでエリア内文字として扱われるか、行単位へ分かれるかまでは保証していません。PDFは埋め込みTrueTypeで文字を保持していますが、段落編集にはSVGを優先してください。`.ai`形式を装ったファイルは作っていません。

画面スクリーンショット、カード・アイコン見本の画像内の文字は画像です。それらを変更するときは撮影元・見本コンポーネントを修正して再撮影します。SVGの本文・見出し・注記は文字として編集できます。

## 画像の出典とスタイル

iPad Pro 11相当（1194×834 CSS px、DPR 2、横向き・タッチ有効）のChromiumで、専用のローカルAPIと架空の注文・人名を使いました。実機のSafari検証ではありません。緊急・破棄・受付切替などは実際のフォームや確認画面を撮影しました。撮影では送信・破棄・受付停止の確定操作を行っていません。

カード20例は`gallery.tsx`で実際の`OrderCard`を表示しています。アイコン73素材の出典は`icon-inventory.json`、掲載した使用例のサイズ・色・背景と実ボタンの撮影画像の対応は`icon-styles.json`に記録しています。同じアイコンでも場面による見た目の違いがあるため、この一覧は代表的な使用例です。一律に線幅や色を変更していません。

旧返信の「見た」「ごめん」と未使用の予備素材は通常の送信操作とは分けて説明しています。実機プリンターへの接続・印刷は行っていません。赤いプリンター表示は接続しない撮影環境の状態です。

## 再出力

Node、Playwrightまたはplaywright-core、Chromiumを用意します。`PLAYWRIGHT_MODULE`と`CHROMIUM_PATH`で利用する実体を指定できます。次のHTTPサーバーはリポジトリのルートから起動します。

```bash
python -m http.server 5211 --bind 127.0.0.1
```

別のターミナルで本文を反映し、出力します。

```bash
node documents/manual/source/caos-ipad/sync-manuscript.cjs
node documents/manual/source/caos-ipad/export-pdf.cjs
node documents/manual/source/caos-ipad/export-svg.cjs
python documents/manual/source/caos-ipad/verify-artifacts.py
```

検査用PythonにはPyMuPDFが必要です。組版の出力前に、本文をyomiyasuへ渡して点検します。原稿に新しい文字を足した場合は、完全なNoto Sans JPの可変TrueTypeを入手し、`prepare-fonts.py FONT.ttf`で静的フォントを再生成します。fontToolsが必要です。ライセンス表示も保持します。

カード・アイコンの再撮影には、POSをビルドした後に`prepare-gallery.cjs`を実行します。`/tmp/cafeore-manual-gallery`を5210番で配信し、`capture-gallery.cjs`を実行します。元のアプリ画面の再撮影は`capture-panels.cjs`です。`APP_URL`は既定で`http://localhost:5191`、専用の架空データの注文121〜138と担当者を前提とします。本番への接続用ではありません。対象のデータやUIが変わった場合は撮影手順も合わせて更新してください。

フォントの元データはGoogle Fontsの`ofl/notosansjp/NotoSansJP[wght].ttf`です。fontToolsで400/700の静的TrueTypeへ変換し、必要な文字を残しました。SIL OFL 1.1に従ってライセンスを同梱しています。
