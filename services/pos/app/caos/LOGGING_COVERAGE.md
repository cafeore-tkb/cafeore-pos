# CaOSの操作ログ

保存JSONは「人間のみ」「システムのみ」「混合」を選べます。端末からは人間の操作と必要なシステムイベントを送信します。
スクロール、座標、ポインターの押下/解放、毎秒の画面状態の自動更新は収集しません。送信結果・失敗・接続状態の変化・実行時例外はシステムログです。

## 保存JSON

`GET /api/caos/logs/export`（「各種データ書き出し」の「ログを保存」）は、`exportedAt` と時系列の `entries` を返します。
`format=human`（既定）/ `system` / `mixed` で選択します。各行の `category` は human / system。各行は `time`（日本時間）、`action`（イベント名をそのまま出力（component.activated等））、`target`（注文番号・操作対象）、`event`、`details`。
カードIDや対象cupなどの識別子はdetailsに残します。過去の低水準UIイベント、人間のみの場合はシステムイベントも除外します。座標はどの形式でも除外します（監査用rawを除く）。
既存ログに注文番号がない場合、orderIdで現在の注文を引けるものは注文番号を補います。削除された注文の番号を推測して埋めません。

## 操作とイベント

| 対象 | 記録 |
|---|---|
| 注文カードのタップ | `component.activated`。component=OrderCard / control=card、注文表示番号、cardKey |
| カード上の操作 | `card.action`。注文番号、cardKey、cupIds、unitIds、dripper、status、選んだ操作 |
| 通知・コメント印 | `comment.notice.clicked` / `comment.notices.dismissed` / `comment.mark.clicked` |
| 返信 | `comment.stamp.requested`。注文ID、送信する返信内容、actionId |
| 注文番号検索 | `search.performed` / `search.submitted`。検索番号、注文ID、コメント件数 |
| 通知から検索 | `search.opened-from-comment` |
| 割当・統合・分割・移動 | `board.*.requested` / `operation.requested` |
| ドラッグ・長押し | `gesture.*`。source/targetのみ、座標なし |
| 緊急・担当者変更 | `emergency.*.requested` / `lanes.operation.requested` |
| 在庫・音・給湯・練習・再送 | 操作ハンドラーの明示的な受付イベント |
| 専用ログのないボタン・設定項目 | `component.activated` / `component.changed`。コンポーネント・表示ラベル・カード文脈 |

専用ハンドラーが操作を記録した場合、同じクリックを汎用コンポーネント操作として重ねて記録しません。
DOMのイベントはisTrusted=trueの操作だけを扱い、入力欄の内容や一文字ずつの入力は集めません。
操作受付は成功の証明ではありません。拒否された操作の試行もhumanに含みます。

## 監査用データ

サーバーの成功履歴は従来どおり業務更新と同じトランザクションでDBに残します。
コメント保存は `comment.created`、盤面・統合・割当・抽出・緊急・担当者変更は `caos_operations` と `caos_operation_cups` に保存します。
人間のみには含めず、システムのみ・混合ではoperations / cupsに含めます。元の構造が必要な場合は `GET /api/caos/logs/export?format=raw` で従来の entries / operations / cups を取得します。
`GET /api/caos/logs` は過去分を含むDBの端末イベント一覧です。既存履歴の削除や書き換えは行いません。

通信不能・ブラウザデータの削除などで、端末の操作ログが届かない場合があります。未送信ログはDBへ届いてから書き出しに含まれます。

## 保存不具合の対策

mainの#1051で、NULを含む旧ログを元のJSONごと包んで保存し、GET時に復元する実装を使用します。端末の容量不足、非表示タブの送信ロック、複数の操作タブへの対策は維持します。調査と保全の詳細は [SAVE_INCIDENT_20261018.md](./SAVE_INCIDENT_20261018.md) を参照してください。

## 容量の目安（15時間・40秒に1注文）

注文数は 15 × 3600 ÷ 40 = 1,350 件。
添付された2026-10-18 22:17の人間ログは291行・137,624バイト（整形済み、1行約473バイト）。
参考の監査JSONは、端末ログ1行約515バイト、operation約317バイト、cup履歴約822バイト（各配列をUTF-8のコンパクトJSONとして測定）。

1操作端末、通常の通信状態、1注文あたり人間イベント10〜25行と仮定すると人間のみは約7〜20MB。
システムは端末イベント20〜40行/注文に加え、サーバー業務操作3〜5回/注文、受付〜ready平均6〜10分、平均1.5杯/注文を仮定する。
窓の杯数は約14〜23杯となり、cup履歴だけで約47〜128MB。端末・operationを加え、システムのみ約60〜160MB、混合約70〜180MBが目安。

これは15時間分だけの非圧縮JSONの試算であり、現在のAPIは保存期間全体を書き出す。端末台数、繰り返し操作、通信・印刷の再試行、readyまでの滞留時間で増える。特にcup履歴は操作ごとに窓全体を保存するため、滞留すると容量が大きくなる。DBの索引・WAL・バックアップ・ブラウザの未送信領域は含まない。
