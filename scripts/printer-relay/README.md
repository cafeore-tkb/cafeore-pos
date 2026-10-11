# Windows用プリンタ中継

Windows PCのFirefoxと中継サーバーを同じPCで動かす構成。
`POS (HTTPS) → https://127.0.0.1:18443 → http://192.168.77.2`。
中継モードはEpson SDKのePOS-Print APIを使用するため、プリンタ側で
ePOS-Printサービスと `local_printer` が利用できることが必要。
Socket.IOによるデバイス接続・状態監視は使わない。

## 初回設定（実際に使うWindows PCで実施）

1. [Node.js](https://nodejs.org/en/download) のLTS版をインストールする。
2. このフォルダをWindows PCの `C:\cafeore-printer-relay` などにコピーする。
   npm install は不要。
3. `config.example.json` を `config.json` にコピーする。
   `origin` をFirefoxで開くPOSのオリジンに変更する
   （例: `https://pos.example.com`。パス・末尾の `/` は含めない）。
   プリンタのIPが異なる場合は `printerHost` も変更する。
4. [mkcertのリリース](https://github.com/FiloSottile/mkcert/releases) から
   Windows用実行ファイルを取得し、`mkcert.exe` としてこのフォルダに置く。
5. このフォルダでPowerShellを開き、以下を実行する。

```powershell
.\mkcert.exe -install
.\mkcert.exe -cert-file localhost.pem -key-file localhost-key.pem localhost 127.0.0.1
```

証明書はこのWindows PCで作成する。別PCで作ったCAや秘密鍵をコピーしない。
mkcertのWindows対応はシステム証明書ストア。
Firefoxを再起動しても証明書エラーになる場合は、
`about:preferences#privacy` → 証明書を表示 → 認証局証明書 → インポートで、
以下のコマンドが示すフォルダ内の `rootCA.pem` を読み込み、
Webサイトの識別への信頼を選択する。`rootCA-key.pem` は共有・インポートしない。
[mkcert公式の手順・対応ストア](https://github.com/FiloSottile/mkcert#installation)

```powershell
.\mkcert.exe -CAROOT
```

## 起動とPOS設定

1. `start.cmd` をダブルクリックする。ウィンドウは開いたままにする。
2. Firefoxで `https://127.0.0.1:18443/health` を開く。
   証明書の警告なしで `Printer relay running` が表示されることを確認する。
   この画面は中継の起動確認のみで、プリンタへの接続確認はしない。
3. 中継対応のPOSをビルド・公開後、POSのURLに `?printer=relay` を付けて開く。
   既に `?` がある場合は `&printer=relay` を付ける。
   例: `https://pos.example.com/label?printer=relay`。
   設定はこのFirefoxのサイトデータに保存され、次回も中継を使用する。
4. プリンタが接続済みになったら、テスト用注文でラベルを1枚印刷し、
   文字、用紙送り、カット位置を確認する。

直接接続へ戻すには `?printer=direct` を付けてPOSを開く。
Firefoxのローカルネットワークアクセスの許可を求められた場合は、POSに許可する。
中継は `127.0.0.1` のみで待ち受けるため、他のPCからは利用できない。

## エラーの切り分け

- 起動時の Setup error: `config.json` と証明書ファイルを確認する。
- EADDRINUSE: 既に起動した中継がないか確認する。
- 403: `origin` が実際のPOSのオリジンと一致しているか確認する。
- 502: Windows PCからプリンタへ接続できない。ネットワーク、IP、
  プリンタの電源とePOS-Printサービスを確認する。
- プリンタはHTTP応答するが接続できない: `/cgi-bin/epos/service.cgi` と
  `local_printer` が有効か確認する。単に管理画面が開くだけでは不十分。
- 印刷失敗やタイムアウト時は、用紙が出たか確認してから再印刷する。

開発時の検証: `node --test server.test.mjs`。
