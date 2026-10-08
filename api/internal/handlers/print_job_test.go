package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"cafeore-pos/api/internal/models"
)

func ptrTo[T any](v T) *T { return &v }

// ---------------------------------------------------------------- 本物の Postgres を使うテスト（CAOS_TEST_DATABASE_URL）

func (e *caosEnv) createOrderWith(t *testing.T, body map[string]any) models.OrderResponse {
	t.Helper()
	var o models.OrderResponse
	if code := e.call(t, http.MethodPost, "/api/orders", body, &o); code != http.StatusCreated {
		t.Fatalf("注文を作れない：%d", code)
	}
	return o
}

// アイスミルクのメニューを足す
func (e *caosEnv) milkMenu(t *testing.T) uuid.UUID {
	t.Helper()
	milkType := models.ItemType{Name: "milk", DisplayName: "ミルク"}
	mustDo(t, e.db.Create(&milkType).Error)
	item := models.Item{Name: "アイスミルク", Abbr: "ミルク", ItemTypeID: milkType.ID}
	mustDo(t, e.db.Create(&item).Error)
	menu := models.Menu{Name: "アイスミルク", Abbr: "ミルク", Price: 300, Key: "milk"}
	mustDo(t, e.db.Create(&menu).Error)
	mustDo(t, e.db.Create(&models.MenuItem{MenuID: menu.ID, ItemID: item.ID, Quantity: 1}).Error)
	return menu.ID
}

func (e *caosEnv) printJobs(t *testing.T) []models.PrintJobRow {
	t.Helper()
	var rows []models.PrintJobRow
	mustDo(t, e.db.Order("id").Find(&rows).Error)
	return rows
}

func (e *caosEnv) claim(t *testing.T, printer string) (models.PrintJobClaim, int) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/print-jobs/claim", strings.NewReader(`{"printer_id":"`+printer+`"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	var got models.PrintJobClaim
	if w.Code == http.StatusOK {
		mustDo(t, json.Unmarshal(w.Body.Bytes(), &got))
	}
	return got, w.Code
}

func TestPrintQueueThroughHTTP(t *testing.T) {
	e := newCaosEnv(t)
	milk := e.milkMenu(t)

	// レジの会計（print_labels）は、注文と同じトランザクションで注文のラベルを積む。付けなければ積まない
	o1 := e.createOrderWith(t, map[string]any{"order_id": 1, "billing_amount": 800, "received": 800, "print_labels": true,
		"menu_ids": []map[string]any{{"menu_id": e.menu}, {"menu_id": milk}}})
	e.createOrder(t, 2, 1)
	jobs := e.printJobs(t)
	if len(jobs) != 1 || jobs[0].Kind != "order" || jobs[0].Source != "cashier" || jobs[0].OrderID != uuid.UUID(o1.Id) || jobs[0].OrderNo != 1 || jobs[0].Status != "queued" || jobs[0].CupID != nil {
		t.Fatalf("レジの会計で注文のラベルが 1 件積まれる：%+v", jobs)
	}

	// マスターの緊急ボタン：そのカップの緊急の印刷を積む
	var job models.PrintJob
	coffee, milkCup := o1.Cups[0], o1.Cups[1]
	if code := e.call(t, http.MethodPost, "/api/print-jobs", map[string]any{"kind": "emergency", "source": "master", "order_id": o1.Id, "cup_id": coffee.Id}, &job); code != http.StatusCreated ||
		job.Kind != models.PrintJobKindEmergency || job.Source != models.PrintJobSourceMaster || job.CupId == nil || *job.CupId != coffee.Id || job.Status != models.PrintJobStatusQueued {
		t.Fatalf("緊急の印刷を積む：%d %+v", code, job)
	}
	for name, body := range map[string]map[string]any{
		"シールの無いカップ":    {"kind": "emergency", "source": "master", "order_id": o1.Id, "cup_id": milkCup.Id},
		"ほかの注文のカップ":    {"kind": "emergency", "source": "master", "order_id": o1.Id, "cup_id": uuid.New()},
		"カップなし":        {"kind": "emergency", "source": "master", "order_id": o1.Id},
		"CaOS からは積めない": {"kind": "emergency", "source": "caos", "order_id": o1.Id, "cup_id": coffee.Id},
		"知らない種類":       {"kind": "label", "source": "master", "order_id": o1.Id},
	} {
		if code := e.call(t, http.MethodPost, "/api/print-jobs", body, nil); code != http.StatusBadRequest {
			t.Fatalf("%s は 400：%d", name, code)
		}
	}
	if code := e.call(t, http.MethodPost, "/api/print-jobs", map[string]any{"kind": "order", "source": "master", "order_id": uuid.New()}, nil); code != http.StatusNotFound {
		t.Fatalf("無い注文は 404：%d", code)
	}

	// 印刷する端末は、積んだ順に 1 件ずつ取る。取った仕事には印刷に要る注文が付く
	got, code := e.claim(t, "printer-a")
	if code != http.StatusOK || got.Job.Kind != models.PrintJobKindOrder || got.Job.Status != models.PrintJobStatusPrinting || got.Job.Attempts != 1 ||
		got.Job.PrinterId == nil || *got.Job.PrinterId != "printer-a" || got.Order.Id != o1.Id || len(got.Order.Cups) != 2 || len(got.Order.Menus) != 2 {
		t.Fatalf("1 件目は注文のラベル：%d %+v", code, got)
	}
	first := got.Job.Id
	got2, code := e.claim(t, "printer-b")
	if code != http.StatusOK || got2.Job.Kind != models.PrintJobKindEmergency || got2.Job.Id == first {
		t.Fatalf("2 件目（ほかの端末）は緊急の印刷：%d %+v", code, got2)
	}
	if _, code := e.claim(t, "printer-a"); code != http.StatusNoContent {
		t.Fatalf("待ちが無ければ 204：%d", code)
	}

	// 済みにできるのは取った端末だけ。送り直しは同じ結果
	donePath := fmt.Sprintf("/api/print-jobs/%d/done", first)
	if code := e.call(t, http.MethodPost, donePath, map[string]any{"printer_id": "printer-b"}, nil); code != http.StatusConflict {
		t.Fatalf("ほかの端末は済みにできない：%d", code)
	}
	for range 2 {
		if code := e.call(t, http.MethodPost, donePath, map[string]any{"printer_id": "printer-a"}, &job); code != http.StatusOK || job.Status != models.PrintJobStatusDone || job.FinishedAt == nil {
			t.Fatalf("済みにする（送り直しても同じ）：%d %+v", code, job)
		}
	}
	if code := e.call(t, http.MethodPost, fmt.Sprintf("/api/print-jobs/%d/failed", first), map[string]any{"printer_id": "printer-a", "error": "x"}, nil); code != http.StatusConflict {
		t.Fatalf("済みの仕事は失敗にできない：%d", code)
	}
	if code := e.call(t, http.MethodPost, fmt.Sprintf("/api/print-jobs/%d/retry", first), nil, nil); code != http.StatusConflict {
		t.Fatalf("済みの仕事はもう一度印刷できない（2 重に印刷しない）：%d", code)
	}

	// 失敗は残して画面に出し、もう一度印刷すると待ちに戻る
	failPath := fmt.Sprintf("/api/print-jobs/%d/failed", got2.Job.Id)
	if code := e.call(t, http.MethodPost, failPath, map[string]any{"printer_id": "printer-b", "error": "用紙切れ"}, &job); code != http.StatusOK || job.Status != models.PrintJobStatusFailed || job.Error == nil || *job.Error != "用紙切れ" {
		t.Fatalf("失敗にする：%d %+v", code, job)
	}
	var active []models.PrintJob
	if code := e.call(t, http.MethodGet, "/api/print-jobs", nil, &active); code != http.StatusOK || len(active) != 1 || active[0].Status != models.PrintJobStatusFailed {
		t.Fatalf("まだ終わっていない仕事に失敗が残る：%d %+v", code, active)
	}
	if code := e.call(t, http.MethodPost, fmt.Sprintf("/api/print-jobs/%d/retry", got2.Job.Id), nil, &job); code != http.StatusOK || job.Status != models.PrintJobStatusQueued || job.Error != nil || job.PrinterId != nil {
		t.Fatalf("もう一度印刷で待ちに戻る：%d %+v", code, job)
	}
	got3, code := e.claim(t, "printer-a")
	if code != http.StatusOK || got3.Job.Id != got2.Job.Id || got3.Job.Attempts != 2 {
		t.Fatalf("戻した仕事をまた取れる：%d %+v", code, got3.Job)
	}

	// 印刷中のまま止まった仕事は、1 分たつまではもう一度印刷も取り消しもできない
	retryPath := fmt.Sprintf("/api/print-jobs/%d/retry", got3.Job.Id)
	if code := e.call(t, http.MethodPost, retryPath, nil, nil); code != http.StatusConflict {
		t.Fatalf("印刷中の仕事は取り直せない：%d", code)
	}
	mustDo(t, e.db.Exec("UPDATE print_jobs SET claimed_at = now() - interval '2 minutes' WHERE id = ?", got3.Job.Id).Error)
	if code := e.call(t, http.MethodPost, fmt.Sprintf("/api/print-jobs/%d/cancel", got3.Job.Id), nil, &job); code != http.StatusOK || job.Status != models.PrintJobStatusCanceled {
		t.Fatalf("止まった仕事は取り消せる：%d %+v", code, job)
	}
	if code := e.call(t, http.MethodPost, fmt.Sprintf("/api/print-jobs/%d/done", got3.Job.Id), map[string]any{"printer_id": "printer-a"}, nil); code != http.StatusConflict {
		t.Fatalf("取り消した仕事は済みにできない：%d", code)
	}
	if code := e.call(t, http.MethodGet, "/api/print-jobs", nil, &active); code != http.StatusOK || len(active) != 0 {
		t.Fatalf("全部終わった：%d %+v", code, active)
	}
	if code := e.call(t, http.MethodPost, "/api/print-jobs/abc/retry", nil, nil); code != http.StatusBadRequest {
		t.Fatalf("ID が数でなければ 400：%d", code)
	}
	if code := e.call(t, http.MethodPost, "/api/print-jobs/999999/cancel", nil, nil); code != http.StatusNotFound {
		t.Fatalf("無い仕事は 404：%d", code)
	}
	if code := e.call(t, http.MethodPost, "/api/print-jobs/claim", map[string]any{"printer_id": " "}, nil); code != http.StatusBadRequest {
		t.Fatalf("端末の ID が空なら 400：%d", code)
	}
}

// 消えた注文・消えたカップの仕事は、取るときに失敗にして次の仕事を返す
func TestPrintQueueClaimSkipsGoneOrders(t *testing.T) {
	e := newCaosEnv(t)
	gone := e.createOrderWith(t, map[string]any{"order_id": 1, "billing_amount": 500, "received": 500, "print_labels": true, "menu_ids": []map[string]any{{"menu_id": e.menu}}})
	edited := e.createOrder(t, 2, 1)
	if code := e.call(t, http.MethodPost, "/api/print-jobs", map[string]any{"kind": "emergency", "source": "master", "order_id": edited.Id, "cup_id": edited.Cups[0].Id}, nil); code != http.StatusCreated {
		t.Fatalf("緊急の印刷を積む：%d", code)
	}
	ok := e.createOrderWith(t, map[string]any{"order_id": 3, "billing_amount": 500, "received": 500, "print_labels": true, "menu_ids": []map[string]any{{"menu_id": e.menu}}})
	e.call(t, http.MethodDelete, "/api/orders/"+gone.Id.String(), nil, nil)
	// 明細を作り直すと、カップも新しくなる
	e.call(t, http.MethodPut, "/api/orders/"+edited.Id.String(), map[string]any{"id": edited.Id, "order_id": 2, "billing_amount": 500, "received": 500, "menu_ids": []map[string]any{{"menu_id": e.menu}}}, nil)

	got, code := e.claim(t, "printer-a")
	if code != http.StatusOK || got.Order.Id != ok.Id {
		t.Fatalf("印刷できる仕事まで飛ばす：%d %+v", code, got.Job)
	}
	jobs := e.printJobs(t)
	if jobs[0].Status != "failed" || jobs[0].Error == nil || !strings.Contains(*jobs[0].Error, "注文が消された") ||
		jobs[1].Status != "failed" || jobs[1].Error == nil || !strings.Contains(*jobs[1].Error, "カップ") {
		t.Fatalf("飛ばした仕事は理由を付けて失敗にする：%+v %+v", jobs[0], jobs[1])
	}
}

// レジの会計と緊急が同時に来ても抜けず、印刷する端末が複数あっても 1 件を 1 回だけ取る
func TestPrintQueueConcurrentEnqueueAndClaim(t *testing.T) {
	e := newCaosEnv(t)
	base := e.createOrder(t, 100, 2)
	const n = 12
	var wg sync.WaitGroup
	errs := make(chan error, 2*n)
	for i := range n {
		wg.Add(2)
		go func() {
			defer wg.Done()
			if code := e.call(t, http.MethodPost, "/api/orders", map[string]any{"order_id": i + 1, "billing_amount": 500, "received": 500, "print_labels": true, "menu_ids": []map[string]any{{"menu_id": e.menu}}}, nil); code != http.StatusCreated {
				errs <- fmt.Errorf("注文 %d：%d", i+1, code)
			}
		}()
		go func() {
			defer wg.Done()
			if code := e.call(t, http.MethodPost, "/api/print-jobs", map[string]any{"kind": "emergency", "source": "master", "order_id": base.Id, "cup_id": base.Cups[i%2].Id}, nil); code != http.StatusCreated {
				errs <- fmt.Errorf("緊急 %d：%d", i, code)
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if jobs := e.printJobs(t); len(jobs) != 2*n {
		t.Fatalf("同時に積んでも抜けない：%d 件", len(jobs))
	}

	// 4 台の端末が同時に取りに来る
	var mu sync.Mutex
	claimed := map[int64]string{}
	var dup []int64
	for p := range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			printer := fmt.Sprintf("printer-%d", p)
			for {
				got, code := e.claim(t, printer)
				if code == http.StatusNoContent {
					return
				}
				if code != http.StatusOK {
					t.Errorf("取れない：%d", code)
					return
				}
				mu.Lock()
				if _, ok := claimed[got.Job.Id]; ok {
					dup = append(dup, got.Job.Id)
				}
				claimed[got.Job.Id] = printer
				mu.Unlock()
				if code := e.call(t, http.MethodPost, fmt.Sprintf("/api/print-jobs/%d/done", got.Job.Id), map[string]any{"printer_id": printer}, nil); code != http.StatusOK {
					t.Errorf("済みにできない：%d", code)
					return
				}
			}
		}()
	}
	wg.Wait()
	if len(dup) > 0 || len(claimed) != 2*n {
		t.Fatalf("1 件を 1 回だけ取る：取った %d 件、2 回取った %v", len(claimed), dup)
	}
	for _, job := range e.printJobs(t) {
		if job.Status != "done" || job.Attempts != 1 || job.PrinterID == nil || *job.PrinterID != claimed[job.ID] {
			t.Fatalf("全部 1 回で済み：%+v", job)
		}
	}
}

// 印刷キューは /api/ws/orders で配る。つないだ直後と、積んだ・取った・済みにしたとき、ほかのインスタンスから通知が来たときに届く
func TestPrintJobsAreBroadcast(t *testing.T) {
	e := newCaosEnv(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go e.orders.ListenChanges(ctx, e.dsn)

	o := e.createOrderWith(t, map[string]any{"order_id": 1, "billing_amount": 500, "received": 500, "print_labels": true, "menu_ids": []map[string]any{{"menu_id": e.menu}}})
	srv := httptest.NewServer(e.router)
	defer srv.Close()
	conn, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/ws/orders", nil)
	mustDo(t, err)
	defer func() { _ = conn.Close() }()
	if resp.Body != nil {
		_ = resp.Body.Close()
	}
	nextJobs := func() []models.PrintJob {
		t.Helper()
		mustDo(t, conn.SetReadDeadline(time.Now().Add(5*time.Second)))
		for {
			var msg WSMessage
			mustDo(t, conn.ReadJSON(&msg))
			if msg.Type == WSMessageTypePrintJobs {
				return msg.PrintJobs
			}
		}
	}
	if jobs := nextJobs(); len(jobs) != 1 || jobs[0].Status != models.PrintJobStatusQueued || jobs[0].OrderNo != 1 {
		t.Fatalf("つないだ直後に、まだ終わっていない仕事が届く：%+v", jobs)
	}
	got, _ := e.claim(t, "printer-a")
	if jobs := nextJobs(); len(jobs) != 1 || jobs[0].Status != models.PrintJobStatusPrinting {
		t.Fatalf("取ったら印刷中が届く：%+v", jobs)
	}
	e.call(t, http.MethodPost, fmt.Sprintf("/api/print-jobs/%d/done", got.Job.Id), map[string]any{"printer_id": "printer-a"}, nil)
	if jobs := nextJobs(); len(jobs) != 0 {
		t.Fatalf("済みにしたら消える：%+v", jobs)
	}

	time.Sleep(200 * time.Millisecond) // LISTEN が始まるのを待つ
	// ほかのインスタンスが積んで知らせてきたら、DB から読み直して配る（印刷する端末がどのインスタンスにつないでいても届く）
	mustDo(t, e.db.Create(&models.PrintJobRow{Kind: "emergency", Source: "master", OrderID: uuid.UUID(o.Id), OrderNo: 1, CupID: ptrTo(uuid.UUID(o.Cups[0].Id)),
		Status: "queued", CreatedAt: time.Now(), UpdatedAt: time.Now()}).Error)
	mustDo(t, e.db.Exec("SELECT pg_notify(?, ?)", printJobsChangedChannel, "another-instance").Error)
	if jobs := nextJobs(); len(jobs) != 1 || jobs[0].Kind != models.PrintJobKindEmergency {
		t.Fatalf("ほかのインスタンスで積んだ仕事が届く：%+v", jobs)
	}
}
