package handlers

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm/schema"
)

// モデルの表は全部、消す表か残す表のどちらか 1 つに入っている（表を足したときに決め忘れない）
func TestDataResetTablesCoverModels(t *testing.T) {
	seen := map[string]int{}
	for _, table := range append(slices.Clone(dataResetTables), dataResetKeptTables...) {
		seen[table]++
	}
	for _, model := range models.All() {
		s, err := schema.Parse(model, &sync.Map{}, schema.NamingStrategy{})
		if err != nil {
			t.Fatal(err)
		}
		switch seen[s.Table] {
		case 0:
			t.Errorf("%s は消す表（dataResetTables）にも残す表（dataResetKeptTables）にも無い", s.Table)
		case 1:
		default:
			t.Errorf("%s が 2 回書かれている", s.Table)
		}
		delete(seen, s.Table)
	}
	for table := range seen {
		t.Errorf("%s はモデルに無い", table)
	}
}

func TestDataReset(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	api.createOrder(1, m.blendMenu, m.pairMenu)
	threshold := 3
	cup := models.StockResource{ID: uuid.New(), Kind: string(models.StockResourceKindCup), Name: "カップ", Unit: "個", PerServing: 1, NotifyFrom: 10, NotifyStep: 5, LastAlertThreshold: &threshold}
	api.create(&cup,
		&models.StockEvent{ResourceID: cup.ID, Kind: string(models.StockEventKindCount), Quantity: 50, CreatedAt: time.Now()},
		&models.DripperAssigneeChange{ChangedAt: time.Now(), Day: "2026-10-24", Dripper: 1, Name: "a"})
	api.waitBackground()
	drainBroadcasts(api)

	var status models.DataResetStatus
	api.do(http.MethodGet, "/api/admin/data-reset", nil).expect(http.StatusOK).decode(&status)
	if status.ReceptionStopped || status.Confirmation != dataResetConfirmation || len(status.UnknownTables) != 0 {
		t.Fatalf("status: %+v", status)
	}
	if rows(status.Tables, "orders") != 1 || rows(status.Tables, "order_cups") != 3 || rows(status.Tables, "stock_events") != 1 {
		t.Fatalf("tables: %+v", status.Tables)
	}

	// 同じ中身なら同じバイト列
	first := api.do(http.MethodGet, "/api/admin/data-reset/backup", nil).expect(http.StatusOK).Body
	second := api.do(http.MethodGet, "/api/admin/data-reset/backup", nil).expect(http.StatusOK).Body
	if !bytes.Equal(first, second) {
		t.Fatal("backup must be the same bytes for the same data")
	}
	var backup models.DataResetBackup
	testResponse{t: t, Body: first}.decode(&backup)
	if backup.Format != models.DataResetBackupFormatV1 || backup.Version != models.DataResetBackupVersion1 ||
		len(backup.Tables) != len(dataResetTables) || len(backup.Tables["orders"]) != 1 || len(backup.Tables["order_cups"]) != 3 {
		t.Fatalf("backup: %s", first)
	}
	if _, ok := backup.Tables["menus"]; ok {
		t.Fatal("kept tables must not be in the backup")
	}

	request := func(confirmation string, backup []byte) models.DataResetRequest {
		return models.DataResetRequest{Confirmation: confirmation, BackupSha256: sha256Hex(backup)}
	}
	api.do(http.MethodPost, "/api/admin/data-reset", request("reset", first)).expect(http.StatusBadRequest)
	api.do(http.MethodPost, "/api/admin/data-reset", models.DataResetRequest{Confirmation: dataResetConfirmation}).expect(http.StatusBadRequest)
	// 受付を止めていない
	res := api.do(http.MethodPost, "/api/admin/data-reset", request(dataResetConfirmation, first)).expect(http.StatusConflict)
	if !strings.Contains(string(res.Body), "受付を止めて") {
		t.Fatalf("body: %s", res.Body)
	}

	// 止めるとオーダーストップの記録が増えるので、前のバックアップはもう古い
	api.do(http.MethodPost, "/api/master-status", models.MasterStateUpdateRequest{Type: models.Stop}).expect(http.StatusCreated)
	res = api.do(http.MethodPost, "/api/admin/data-reset", request(dataResetConfirmation, first)).expect(http.StatusConflict)
	if !strings.Contains(string(res.Body), "ダウンロードしたあとにデータが変わりました") {
		t.Fatalf("body: %s", res.Body)
	}
	if n := api.count(&models.Order{}, "1 = 1"); n != 1 {
		t.Fatalf("refused reset must not delete anything: %d orders", n)
	}

	latest := api.do(http.MethodGet, "/api/admin/data-reset/backup", nil).expect(http.StatusOK).Body
	drainBroadcasts(api)
	var result models.DataResetResult
	api.do(http.MethodPost, "/api/admin/data-reset", request(dataResetConfirmation, latest)).expect(http.StatusOK).decode(&result)
	if rows(result.Tables, "orders") != 1 || rows(result.Tables, "master_states") != 1 || len(result.Tables) != len(dataResetTables) {
		t.Fatalf("result: %+v", result)
	}
	if msg := api.nextBroadcast(); msg.Type != WSMessageTypeDataReset {
		t.Fatalf("broadcast: %+v", msg)
	}

	api.do(http.MethodGet, "/api/admin/data-reset", nil).expect(http.StatusOK).decode(&status)
	for _, table := range status.Tables {
		if table.Rows != 0 {
			t.Errorf("%s has %d rows after reset", table.Name, table.Rows)
		}
	}
	if status.ReceptionStopped {
		t.Error("the reception history must be deleted")
	}

	// 設定は残し、在庫対象の最後に通知した段階だけ戻す
	if n := api.count(&models.Menu{}, "1 = 1"); n != 3 {
		t.Errorf("menus = %d, want 3", n)
	}
	if n := api.count(&models.Item{}, "1 = 1"); n != 3 {
		t.Errorf("items = %d, want 3", n)
	}
	var kept models.StockResource
	if err := api.db.First(&kept, "id = ?", cup.ID).Error; err != nil || kept.LastAlertThreshold != nil {
		t.Errorf("stock resource: %+v %v", kept, err)
	}

	// 連番も 1 から
	change := models.DripperAssigneeChange{ChangedAt: time.Now(), Day: "2026-10-24", Dripper: 1, Name: "b"}
	api.create(&change)
	if change.ID != 1 {
		t.Errorf("dripper_assignee_changes.id = %d, want 1", change.ID)
	}
}

// 消すか残すか決めていない表があれば、何も消さない
func TestDataResetRefusesUnknownTables(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	api.createOrder(1, m.blendMenu)
	api.do(http.MethodPost, "/api/master-status", models.MasterStateUpdateRequest{Type: models.Stop}).expect(http.StatusCreated)
	if err := api.db.Exec("CREATE TABLE new_feature (id int)").Error; err != nil {
		t.Fatal(err)
	}
	api.waitBackground()

	var status models.DataResetStatus
	api.do(http.MethodGet, "/api/admin/data-reset", nil).expect(http.StatusOK).decode(&status)
	if !slices.Equal(status.UnknownTables, []string{"new_feature"}) || !status.ReceptionStopped {
		t.Fatalf("status: %+v", status)
	}

	backup := api.do(http.MethodGet, "/api/admin/data-reset/backup", nil).expect(http.StatusOK).Body
	res := api.do(http.MethodPost, "/api/admin/data-reset", models.DataResetRequest{Confirmation: dataResetConfirmation, BackupSha256: sha256Hex(backup)}).
		expect(http.StatusConflict)
	if !strings.Contains(string(res.Body), "new_feature") {
		t.Fatalf("body: %s", res.Body)
	}
	if n := api.count(&models.Order{}, "1 = 1"); n != 1 {
		t.Fatalf("orders = %d, want 1", n)
	}
}

func TestPendingChangesDataReset(t *testing.T) {
	q := newPendingChanges()
	// 自分が送ったものは積まない
	q.add(dataResetChannel, instanceID)
	if q.take().dataReset {
		t.Fatal("own notification must be ignored")
	}
	q.add(dataResetChannel, uuid.NewString())
	if !q.take().dataReset {
		t.Fatal("data reset from another instance must be published")
	}
}

func rows(tables []models.DataResetTable, name string) int64 {
	for _, table := range tables {
		if table.Name == name {
			return table.Rows
		}
	}
	return -1
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// 積まれた配信を読み捨てる
func drainBroadcasts(api *testAPI) {
	for {
		select {
		case <-api.ws.send:
		case <-time.After(100 * time.Millisecond):
			return
		}
	}
}
