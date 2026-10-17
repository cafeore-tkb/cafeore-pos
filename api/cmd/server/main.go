// api/cmd/server/main.go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"cafeore-pos/api/internal/auth"
	"cafeore-pos/api/internal/handlers"
	"cafeore-pos/api/internal/notify"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type StatusResponse struct {
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
	Version   string    `json:"version"`
	Database  string    `json:"database"`
	// DB にあってモデルに無いもの（またはその逆）。手で DB を触った跡。空なら一致している。
	// デプロイの CI が見て、空でなければ落とす（api-build.yml）。
	SchemaDrift []string  `json:"schema_drift"`
	Build       BuildInfo `json:"build"`
}

// このサーバーがどの PR・コミットからビルドされたか。POS のトップページに出す。
//
// CI がイメージを作るときに環境変数 BUILD_PR・BUILD_COMMIT として焼き込む
// （api/Dockerfile、api-build.yml）。ローカルで動かしたときは両方とも空。
type BuildInfo struct {
	// PR の番号。プレビューはその PR、本番はマージした PR。分からなければ省く
	PR int `json:"pr,omitempty"`
	// コミットの SHA。分からなければ省く
	Commit string `json:"commit,omitempty"`
}

func buildInfoFromEnv() BuildInfo {
	pr, err := strconv.Atoi(os.Getenv("BUILD_PR"))
	if err != nil || pr <= 0 {
		pr = 0
	}
	return BuildInfo{PR: pr, Commit: os.Getenv("BUILD_COMMIT")}
}

var db *gorm.DB

// 起動時に調べたスキーマのズレ（findSchemaDrift）。
var schemaDrift = []string{}

// 起動時に読んだビルドの番号（buildInfoFromEnv）。
var build BuildInfo

func initDB() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL environment variable is not set")
	}

	var err error
	db, err = gorm.Open(
		postgres.New(postgres.Config{
			DSN:                  dsn,
			PreferSimpleProtocol: true,
		}),
		&gorm.Config{
			PrepareStmt:                              false,
			DisableForeignKeyConstraintWhenMigrating: true,
		})
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("failed to get database connection: %w", err)
	}

	// Cloud Run はリクエストが増えるとインスタンスを増やす。1インスタンスが
	// 際限なく接続を張ると、マネージド Postgres 側の上限にすぐ届く。
	sqlDB.SetMaxOpenConns(5)
	sqlDB.SetMaxIdleConns(2)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)

	// 起動時の疎通確認。タイムアウトを付けないと、DB が応答しないときに
	// listen へ進めないまま Cloud Run の起動プローブが切れるのを待つことになる。
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := sqlDB.PingContext(ctx); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// スキーマはモデルが正本。本番もプレビューもローカルも、起動時に反映する。
	if err := migrate(db); err != nil {
		return err
	}
	log.Println("Database migration completed")

	// ズレがあっても起動は止めない（注文は受けられるので）。/status に出して CI で気づく。
	drift, err := findSchemaDrift(db)
	if err != nil {
		drift = []string{fmt.Sprintf("ズレを調べられなかった: %v", err)}
	}
	for _, d := range drift {
		log.Printf("schema drift: %s", d)
	}
	schemaDrift = drift

	log.Println("Database connected successfully")
	return nil
}

// CORS で許可する origin。FRONTEND_ORIGINS にカンマ区切りで入れる。
//
// 本番は Cloudflare Workers 上の pos。プレビューはデプロイごとに
// URL が変わって列挙できないので "*" を入れている（infra の
// cloud_run_preview.tf を参照）。未設定ならローカル開発用のポートだけ許可する。
func getAllowedOrigins() []string {
	originsEnv := os.Getenv("FRONTEND_ORIGINS")

	if originsEnv == "" {
		return []string{
			"http://localhost:5173",
			"http://localhost:3000",
		}
	}

	origins := strings.Split(originsEnv, ",")
	result := make([]string, 0, len(origins))

	for _, origin := range origins {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			result = append(result, origin)
		}
	}

	return result
}

// /status・/health を登録する。API のルートは handlers.RegisterRoutes が登録する。
func registerStatusRoutes(r gin.IRouter) {
	r.GET("/status", statusHandler)
	r.GET("/health", healthHandler)
}

func statusHandler(c *gin.Context) {
	dbStatus := "connected"

	// DB接続確認
	sqlDB, err := db.DB()
	if err != nil {
		dbStatus = "disconnected"
	} else {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
		defer cancel()

		if err := sqlDB.PingContext(ctx); err != nil {
			dbStatus = "disconnected"
		}
	}

	response := StatusResponse{
		Status:      "ok",
		Timestamp:   time.Now(),
		Version:     "1.0.0",
		Database:    dbStatus,
		SchemaDrift: schemaDrift,
		Build:       build,
	}

	c.JSON(http.StatusOK, response)
}

func healthHandler(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()

	var result int

	err := db.WithContext(ctx).
		Raw("SELECT 1").
		Scan(&result).
		Error

	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "unhealthy",
			"error":  err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":   "healthy",
		"database": "connected",
		"build":    build,
	})
}

func main() {
	// 環境変数読み込み。Cloud Run では環境変数がサービス側から渡るので、
	// .env を探すのはローカル（GIN_MODE が release 以外）のときだけにする。
	if os.Getenv("GIN_MODE") != "release" {
		if err := godotenv.Load(); err != nil {
			log.Println("Warning: .env file not found")
		}
	}

	build = buildInfoFromEnv()
	log.Printf("Build: pr=%d commit=%s", build.PR, build.Commit)

	// データベース初期化
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Ginルーター
	r := gin.Default()

	// CORS設定
	r.Use(cors.New(cors.Config{
		AllowOrigins: getAllowedOrigins(),
		AllowMethods: []string{
			"GET",
			"POST",
			"PUT",
			"PATCH",
			"DELETE",
			"OPTIONS",
		},
		AllowHeaders: []string{
			"Origin",
			"Content-Type",
			"Authorization",
		},
		ExposeHeaders: []string{
			"Content-Length",
		},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	hub := handlers.NewHub()
	go hub.Run()

	// ハンドラー初期化
	// 商品の登録・変更・削除や入荷・棚卸しの通知先。SLACK_ACTIVITY_WEBHOOK_URL が無ければ
	// 在庫のアラートと同じ SLACK_WEBHOOK_URL に流す。どちらも無ければログに残すだけ。
	activityWebhook := os.Getenv("SLACK_ACTIVITY_WEBHOOK_URL")
	if activityWebhook == "" {
		activityWebhook = os.Getenv("SLACK_WEBHOOK_URL")
	}
	activity := notify.NewActivity(notify.NewSlack(activityWebhook))

	// 在庫の通知先。SLACK_WEBHOOK_URL が無ければ通知せずログに残すだけ。
	//
	// 残量確認のリマインド（POST /api/inventory/remind）を叩けるのは、
	// INVENTORY_REMIND_INVOKER の SA が audience INVENTORY_REMIND_AUDIENCE で
	// 発行した Google ID トークンを持つ相手（本番の Cloud Scheduler）か、
	// X-Cron-Secret が INVENTORY_CRON_SECRET と一致する相手（ローカル・手動実行）。
	remindAuth := handlers.RemindAuth{CronSecret: os.Getenv("INVENTORY_CRON_SECRET")}
	if invoker, audience := os.Getenv("INVENTORY_REMIND_INVOKER"), os.Getenv("INVENTORY_REMIND_AUDIENCE"); invoker != "" && audience != "" {
		remindAuth.Scheduler = auth.NewGoogleIDTokenVerifier(audience, invoker)
	}
	inventory := handlers.NewInventory(
		db,
		notify.NewSlack(os.Getenv("SLACK_WEBHOOK_URL")),
		remindAuth,
		os.Getenv("POS_BASE_URL"),
		activity,
	)
	// ほかのインスタンスでの注文・オーダーストップ・レジの状態の変更も POS の画面へ届けるため、
	// DB の通知を待ち受ける。
	// LISTEN はトランザクションプーラーでは使えないので、別の接続文字列を渡せるようにしている。
	listenDSN := os.Getenv("DATABASE_LISTEN_URL")
	if listenDSN == "" {
		listenDSN = os.Getenv("DATABASE_URL")
	}
	orderHandler := handlers.NewOrderHandler(db, hub, inventory)
	go orderHandler.ListenChanges(context.Background(), listenDSN)
	// Square Terminal 連携。SQUARE_ACCESS_TOKEN が無ければ無効
	// （/api/square/status が enabled: false を返し、レジは Square のボタンを出さない）。
	// 決済に使う端末は DB に持ち、POS の管理画面（/square-devices）でペアリングする。
	squareHandler, err := handlers.NewSquareHandler(db, orderHandler, handlers.SquareConfig{
		AccessToken:         os.Getenv("SQUARE_ACCESS_TOKEN"),
		Environment:         os.Getenv("SQUARE_ENVIRONMENT"),
		LocationID:          os.Getenv("SQUARE_LOCATION_ID"),
		WebhookSignatureKey: os.Getenv("SQUARE_WEBHOOK_SIGNATURE_KEY"),
		WebhookURL:          os.Getenv("SQUARE_WEBHOOK_URL"),
	})
	if err != nil {
		log.Fatalf("Failed to configure Square: %v", err)
	}

	// API を叩ける相手。AUTH_MODE=cloudflare-access のときは、Cloudflare Access を
	// 通ってきた（Cf-Access-Jwt-Assertion の JWT が正しい）許可リストの相手だけ。
	// 本番では POS の Worker が /api を中継し、Access がその手前でログインさせる
	// （README の「API の認証」を参照）。off のときは今までどおり誰でも叩ける。
	// cloudflare-access-report-only は確かめるが弾かず、弾くはずだったものをログに出す。
	authz, err := auth.AuthorizerFromEnv(os.Getenv)
	if err != nil {
		log.Fatalf("Failed to configure auth: %v", err)
	}
	switch {
	case authz == nil:
		log.Println("Warning: AUTH_MODE is off. Anyone who knows the URL can call the API")
	case authz.ReportOnly():
		log.Println("Warning: AUTH_MODE is report-only. Requests that would be rejected are only logged")
	}

	// /status と /health は認証しない。デプロイの CI（api-build.yml）が直接見に来るのと、
	// POS が Access のセッション切れに気づくのに使う（useOnlineStatus）。
	registerStatusRoutes(r)
	handlers.RegisterRoutes(r, authz, db, hub, inventory, orderHandler, squareHandler, activity)

	// サーバー起動
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Endpoints:")
	log.Printf("  GET  /status")
	log.Printf("  GET  /health")
	log.Printf("  GET  /api/items")
	log.Printf("  GET  /api/item-types")
	log.Printf("  GET  /api/color-settings")
	log.Printf("  GET  /api/orders")
	log.Printf("  GET  /api/orders/:id/comments")
	log.Printf("  GET  /api/ws/orders")

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("Server starting on :%s", port)

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Cloud Run はインスタンスを畳むときに SIGTERM を送る。受けずに落とすと
	// 処理中のリクエストと WebSocket がその場で切れる。
	quit := make(chan os.Signal, 1)

	signal.Notify(
		quit,
		syscall.SIGINT,
		syscall.SIGTERM,
	)

	<-quit

	log.Println("Shutting down server...")

	// Cloud Run は SIGTERM から 10 秒で止めるので、その中で Shutdown と通知の送り切りに分ける。
	// 同じ ctx を使うと、Shutdown が待ち切ったときに通知を送らずに戻ってしまう。
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	// 通知はまとめるために少し溜めてから送るので、止まる前に送り切る
	closeCtx, closeCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer closeCancel()
	activity.Close(closeCtx)

	if sqlDB, err := db.DB(); err == nil {
		if err := sqlDB.Close(); err != nil {
			log.Printf("Failed to close database: %v", err)
		}
	}

	log.Println("Server stopped")
}
