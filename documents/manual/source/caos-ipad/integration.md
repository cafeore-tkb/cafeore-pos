# 撮影した統合版の範囲

基点：`bf6c2133c89aa4e6eb672c6f9228aa1cce9c463b`。作業ブランチ：`docs/caos-ipad-manual`。

取得時点の未マージPR 26本を確認し、CaOS操作に関係する実装10本を作業ブランチへ統合しました。mainへのマージや本番デプロイは行っていません。「全PRを反映した本番版」ではありません。

## 統合した実装PR

| PR | 内容 | 撮影対象のコミット |
| --- | --- | --- |
| [#1094](https://github.com/cafeore-tkb/cafeore-pos/pull/1094) | feat(caos): 注文コメント入力と新着コメントへの導線を追加 | `774fabb478bc412f934b183e235cd3a709fe4551` |
| [#1093](https://github.com/cafeore-tkb/cafeore-pos/pull/1093) | fix(caos): 未割当の同一注文内カードを最大3列で折り返す | `60e3fb611d1fbf9113eea25a0ce836d4a96de906` |
| [#1092](https://github.com/cafeore-tkb/cafeore-pos/pull/1092) | feat(caos): ヘッダーからオーダーストップ・受付再開 | `2071aa8bc7275d96bb61daa01266e8f1821b5488` |
| [#1091](https://github.com/cafeore-tkb/cafeore-pos/pull/1091) | feat(caos): 入れ直し元のゴミ箱から対象の抽出を破棄・記録 | `9fb7d50740c92dde1e5ad6833be8290e65d2f753` |
| [#1090](https://github.com/cafeore-tkb/cafeore-pos/pull/1090) | fix(caos): 提供済みチェックの位置とサイズを既存の丸ボタンに統一 | `31b8bb47f14b07bdec86387ec59f8c39b8c22d41` |
| [#1089](https://github.com/cafeore-tkb/cafeore-pos/pull/1089) | feat(caos): 通常カップと緊急カップの混在統合を許可 | `785cc47595540a0127e90c3a0b0a384e678fe54d` |
| [#1088](https://github.com/cafeore-tkb/cafeore-pos/pull/1088) | feat(pos): 緊急カードの識別と狭幅での表示を改善 | `55fefc923bbfd06c4166dda9f2e3f0338d0fb35f` |
| [#1087](https://github.com/cafeore-tkb/cafeore-pos/pull/1087) | feat(pos): 緊急登録に理由ショートカットを追加 | `a3e8ece2f0fb8ec3bd221fe56d4628040be3f3ff` |
| [#1085](https://github.com/cafeore-tkb/cafeore-pos/pull/1085) | fix: 消えた緊急の代理印刷の頼みは 410 で断り、頼んだ端末はシールを捨てる | `6a1bdc7d72032de27dba68f81d882d2e71353e78` |
| [#1081](https://github.com/cafeore-tkb/cafeore-pos/pull/1081) | キュー画面の4列を細くし、担当者情報を担当欄に集約 | `bdee79311d41c342832fd177da350f647bb08a68` |

## 統合しなかったPR

要件だけのDraft、旧仕様と競合するDraft、CaOS操作に関係しない変更を同時実装済みとは扱っていません。

| PR | 内容 | 理由 |
| --- | --- | --- |
| [#1084](https://github.com/cafeore-tkb/cafeore-pos/pull/1084) | docs(caos): ドリップ所要時間の実績補正・個人係数の要件ドラフト | 実測平均・個人係数の要件ドラフト。予測モデルは未実装 |
| [#1080](https://github.com/cafeore-tkb/cafeore-pos/pull/1080) | feat(dashboard): 回帰分析を含むadditionalなパネル（「提供時間モデル」タブ）を追加 | 売上ダッシュボード。CaOS操作の対象外 |
| [#1079](https://github.com/cafeore-tkb/cafeore-pos/pull/1079) | spec-kit 1.2.2 を導入 | 開発手順の整備。運用画面の変更ではない |
| [#1070](https://github.com/cafeore-tkb/cafeore-pos/pull/1070) | feat(caos): 初回割り振り時刻のDB保存を分離 | 割当保存方式のDraft。今回の撮影対象と別に設計判断が必要 |
| [#1068](https://github.com/cafeore-tkb/cafeore-pos/pull/1068) | feat(pos): Enter で「ちょうど」になる間は「ちょうど」に Enter の札を出す | レジのEnter操作。CaOS操作の対象外 |
| [#1064](https://github.com/cafeore-tkb/cafeore-pos/pull/1064) | feat(api): DB の接続数の上限を DB_MAX_OPEN_CONNS で変えられるようにする | DB接続設定。撮影環境の変更には不要 |
| [#804](https://github.com/cafeore-tkb/cafeore-pos/pull/804) | feat(caos): 抽出時間の実測（杯数ごとの中央値）で予定の時刻を立てる（#803） | 過去の推定時間仕様のDraft。現在の基準時間と整合させる判断が必要 |
| [#760](https://github.com/cafeore-tkb/cafeore-pos/pull/760) | [J1] feat(pos): トップの注文データ書き出しを新バックエンドに合わせ、オーダーストップ記録も書き出せるようにする | ダウンロード機能のDraft。CaOSの操作手順の対象外 |
| [#756](https://github.com/cafeore-tkb/cafeore-pos/pull/756) | [L1] fix: API の 500 のエラーをログにも残し、Slack への送信の失敗では Webhook の URL を返さない | エラー処理のDraft。今回の操作変更とは別 |
| [#747](https://github.com/cafeore-tkb/cafeore-pos/pull/747) | chore(deps-dev): bump vitest from 3.2.4 to 4.1.11 | 依存パッケージの更新。画面の操作仕様と分けて確認する |
| [#745](https://github.com/cafeore-tkb/cafeore-pos/pull/745) | chore(deps-dev): bump postcss from 8.5.8 to 8.5.29 | 依存パッケージの更新。画面の操作仕様と分けて確認する |
| [#725](https://github.com/cafeore-tkb/cafeore-pos/pull/725) | chore(deps): bump openapi-fetch from 0.15.2 to 0.17.0 | 依存パッケージの更新。画面の操作仕様と分けて確認する |
| [#724](https://github.com/cafeore-tkb/cafeore-pos/pull/724) | Bump @radix-ui/react-switch from 1.2.6 to 1.3.7 | 依存パッケージの更新。画面の操作仕様と分けて確認する |
| [#723](https://github.com/cafeore-tkb/cafeore-pos/pull/723) | chore(deps): bump tailwind-merge from 3.5.0 to 3.7.0 | 依存パッケージの更新。画面の操作仕様と分けて確認する |
| [#722](https://github.com/cafeore-tkb/cafeore-pos/pull/722) | Bump @fontsource/zen-old-mincho from 5.2.8 to 5.3.0 | 依存パッケージの更新。画面の操作仕様と分けて確認する |
| [#705](https://github.com/cafeore-tkb/cafeore-pos/pull/705) | 呼び出し画面を PV 待機付きに作り直し、ドリッパー割当を追加 | 旧提供画面のDraft。現在のCaOSとは対象・データ構造が異なる |

## 統合時の解決と検証

- READMEの追記衝突は、元の抽出の破棄と受付停止の説明を両方残して解決しました。
- カードの見出しは、計測用の参照・属性と、折り返しの両方を保持しました。
- POSの型検査・ビルド、CaOSの79テスト、タブ制御の16テスト、Goのrace付きテスト、OpenAPI検証を実行しました。
- iPad Pro 11相当の横向きブラウザー（1194×834 CSS px、DPR 2、タッチ有効）で、実装したUIと実コンポーネントを撮影しました。実機iPadでの検証ではありません。
- 専用ローカルDBと架空の注文・人名を使用しました。実プリンターへの接続は遮断し、実機印刷は行っていません。
- 初期表示でReactのhydration警告を観測しました。クライアント描画へ復帰した後に操作・撮影しています。この資料の変更で当該警告を修正したとは扱いません。
- PDFとSVGのページ数・文字保持・画像埋め込み・段落構造を別途検査します。Illustrator実機での読み込み結果は未確認です。
