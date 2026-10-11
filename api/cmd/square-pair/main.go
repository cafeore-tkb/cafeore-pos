// api/cmd/square-pair/main.go
//
// Square Terminal をこの POS とペアリングし、決済に使う device_id を調べる。
// 初回に 1 回だけ手で実行する。
//
//	SQUARE_ACCESS_TOKEN=... SQUARE_ENVIRONMENT=production go run ./cmd/square-pair -name "レジ1"
//
// 表示されたコードを端末のサインイン画面（「デバイスコードでサインイン」）に
// 入力すると、最後に device_id が表示される。それを SQUARE_DEVICE_ID に入れる。
//
// Square のダッシュボードで発行したコードではペアリングできない（API で
// 発行したコードが必要）。Sandbox では実機とペアリングできないので、Sandbox の
// 動作確認には Square が用意しているテスト用 device_id を使う（README を参照）。
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"

	"cafeore-pos/api/internal/square"
)

func main() {
	name := flag.String("name", "cafeore レジ", "Square の管理画面に出る端末コードの名前")
	locationID := flag.String("location", os.Getenv("SQUARE_LOCATION_ID"), "ペアリングする店舗の location_id（省略時はアカウントの既定の店舗）")
	interval := flag.Duration("interval", 5*time.Second, "ペアリング完了を確かめる間隔")
	flag.Parse()

	_ = godotenv.Load()

	token := os.Getenv("SQUARE_ACCESS_TOKEN")
	if token == "" {
		log.Fatal("SQUARE_ACCESS_TOKEN が設定されていません")
	}
	environment := os.Getenv("SQUARE_ENVIRONMENT")
	baseURL, err := square.BaseURLFor(environment)
	if err != nil {
		log.Fatal(err)
	}
	if baseURL == square.SandboxBaseURL {
		log.Println("注意: Sandbox では実機とペアリングできません。本番の端末なら SQUARE_ENVIRONMENT=production にしてください")
	}

	client := square.NewClient(baseURL, token)
	ctx := context.Background()

	code, err := client.CreateDeviceCode(ctx, uuid.NewString(), square.DeviceCode{
		Name:        *name,
		LocationID:  *locationID,
		ProductType: "TERMINAL_API",
	})
	if err != nil {
		log.Fatalf("デバイスコードを発行できませんでした: %v", err)
	}

	fmt.Printf("端末のサインイン画面でこのコードを入力してください: %s\n", code.Code)
	if code.PairBy != "" {
		fmt.Printf("有効期限: %s\n", code.PairBy)
	}

	for {
		time.Sleep(*interval)
		current, err := client.GetDeviceCode(ctx, code.ID)
		if err != nil {
			log.Printf("状態を確認できませんでした（再試行します）: %v", err)
			continue
		}
		switch current.Status {
		case "PAIRED":
			fmt.Printf("ペアリングしました。SQUARE_DEVICE_ID=%s\n", current.DeviceID)
			return
		case "EXPIRED":
			log.Fatal("コードの有効期限が切れました。もう一度実行してください")
		default:
			fmt.Printf("待っています（%s）\n", current.Status)
		}
	}
}
