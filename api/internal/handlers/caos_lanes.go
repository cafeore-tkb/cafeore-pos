package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
)

// CaOS（ドリップ管制）のドリッパーの担当者（dripper_assignees。models.DripperAssignee）。日本時間の日付ごとに、ドリッパー 1〜6 の名前と、
// 交代した時点で上級生だったか。
//
//   - PUT /api/caos/lanes/:dripper：交代（名前と上級生か。空なら担当者なし）。抽出中かどうかは見ず、待機のカードも動かさない
//   - POST /api/caos/lanes/swap：2 つのドリッパーの担当者を入れ替える
//   - POST /api/caos/lanes/seniors：今の担当者の上級生かだけを直す（画面が名簿を読み直したとき。交代ではないので記録は足さない）
//
// 画面は今日の担当者を WebSocket の配信（つないだときと、変わるたび）と、上の 2 つの応答で受け取る（読むだけの API は無い）。
// 替える（交代・入れ替え）たびに、同じトランザクションで交代の記録（dripper_assignee_changes。models.DripperAssigneeChange）を 1 つのドリッパーにつき 1 行足す。
// 記録は抽出の統計のためのもので、画面には出さず配信もしない。
//
// 替えるのは CaOS の画面からだけ（sohosai-shift の予定は画面が候補に出すだけで、サーバーは読まない）。上級生かも画面が
// sohosai-shift の名簿で判定して送り、そのまま持つ。PUT /api/caos/cups は上級生かを見ない（上級生のみのカップも、どのドリッパーにも置ける）。
//
// 変えたら今日の 6 つを {"type":"caos_lanes"} で全部の画面に配り、ほかのインスタンスへは dripper_assignees_changed で知らせる
// （注文と同じ形。受けたインスタンスは DB から読み直して配る。order_listener.go）。

const (
	// 担当者が変わったことをインスタンス同士で知らせるチャンネル。通知の中身は "<送ったインスタンスの ID>"
	dripperAssigneesChangedChannel = "dripper_assignees_changed"
	// 担当者の名前の長さ（文字）の上限
	caosMaxLaneName = 40
	// 担当者の書き込みを順番にする advisory lock
	caosLanesLock = "caos:lanes"
)

// caosDayString は日本時間の日付（YYYY-MM-DD）。担当者はこの日ごとに持つ。
func caosDayString(now time.Time) string { return now.In(jst).Format(time.DateOnly) }

// loadCaosLanes は day の 6 つの担当者と、その日の行があったかを返す。
func loadCaosLanes(db *gorm.DB, day string) (models.CaosLanes, bool, error) {
	var rows []models.DripperAssignee
	if err := db.Select("dripper", "name", "grade", "senior", "updated_at").
		Where("day = ?", day).Find(&rows).Error; err != nil {
		return models.CaosLanes{}, false, err
	}
	lanes := models.CaosLanes{Day: day, Lanes: make([]models.CaosLane, caosDrippers)}
	for i := range lanes.Lanes {
		lanes.Lanes[i] = models.CaosLane{Dripper: i + 1}
	}
	// dripper は 1〜6（表の CHECK）。名前が空なら senior も false で書いてある（PutCaosLane）
	for _, r := range rows {
		at := r.UpdatedAt
		grade := r.Grade
		lanes.Lanes[r.Dripper-1] = models.CaosLane{Dripper: r.Dripper, Name: r.Name, Grade: &grade, Senior: r.Senior, UpdatedAt: &at}
	}
	return lanes, len(rows) > 0, nil
}

// caosLanesMessage は今日の担当者の配信。今日まだ誰も替えていなければ ok = false（送らない。画面は担当者なしのまま）。
func caosLanesMessage(db *gorm.DB, now time.Time) (WSMessage, bool) {
	lanes, found, err := loadCaosLanes(db, caosDayString(now))
	if err != nil {
		log.Println("failed to load caos lanes:", err)
		return WSMessage{}, false
	}
	if !found {
		return WSMessage{}, false
	}
	return WSMessage{Type: WSMessageTypeCaosLanes, CaosLanes: &lanes}, true
}

// broadcastCaosLanes は今日の担当者を読み直して、このインスタンスの画面へだけ配る（ほかのインスタンスからの通知でも使う）。
func broadcastCaosLanes(db *gorm.DB, hub *Hub, now time.Time) {
	_ = hub.Publish(func() (WSMessage, error) {
		msg, ok := caosLanesMessage(db, now)
		if !ok {
			return WSMessage{}, errors.New("no caos lanes")
		}
		return msg, nil
	})
}

// 担当者が変わったことをほかのインスタンスへ知らせる。
func notifyCaosLanesChanged(db *gorm.DB) {
	notifyChanged(db, dripperAssigneesChangedChannel, instanceID)
}

func lockCaosLanes(tx *gorm.DB) error {
	return tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", caosLanesLock).Error
}

// saveCaosLane はドリッパーの担当者を書き、交代の記録を 1 行足す。prevName は替える前の名前（担当者なしなら空）。
func saveCaosLane(tx *gorm.DB, row models.DripperAssignee, prevName string) error {
	if err := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "day"}, {Name: "dripper"}},
		DoUpdates: clause.AssignmentColumns([]string{"name", "grade", "senior", "updated_at"}),
	}).Create(&row).Error; err != nil {
		return err
	}
	return tx.Create(&models.DripperAssigneeChange{
		ChangedAt: row.UpdatedAt, Day: row.Day, Dripper: row.Dripper,
		PrevName: prevName, Name: row.Name, Grade: row.Grade, Senior: row.Senior,
	}).Error
}

// PUT /api/caos/lanes/:dripper - 交代
func (h *CaosHandler) PutCaosLane(c *gin.Context) {
	dripper, ok := caosDripperParam(c)
	if !ok {
		return
	}
	var req models.CaosLaneUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	name := strings.TrimSpace(req.Name)
	grade := ""
	// 学年の省略は旧クライアント・自由入力を含む未確認扱い。前の人の学年を流用しない。
	if req.Grade != nil && name != "" {
		grade = strings.TrimSpace(*req.Grade)
	}
	if utf8.RuneCountInString(grade) > 20 {
		respondError(c, ruleErrorf("学年は 20 文字までです"))
		return
	}
	if utf8.RuneCountInString(name) > caosMaxLaneName {
		respondError(c, ruleErrorf("名前は %d 文字までです", caosMaxLaneName))
		return
	}
	h.writeLanes(c, func(models.CaosLanes) []models.CaosLane {
		return []models.CaosLane{{Dripper: dripper, Name: name, Grade: &grade, Senior: req.Senior && name != ""}}
	})
}

// POST /api/caos/lanes/swap - 2 つのドリッパーの担当者を入れ替える
func (h *CaosHandler) SwapCaosLanes(c *gin.Context) {
	var req models.CaosLaneSwapRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	err := errors.Join(checkCaosDripper(req.First), checkCaosDripper(req.Second))
	if err == nil && req.First == req.Second {
		err = ruleErrorf("同じドリッパーどうしは入れ替えられません")
	}
	if respondError(c, err) {
		return
	}
	h.writeLanes(c, func(cur models.CaosLanes) []models.CaosLane {
		a, b := cur.Lanes[req.First-1], cur.Lanes[req.Second-1]
		return []models.CaosLane{
			{Dripper: req.First, Name: b.Name, Grade: b.Grade, Senior: b.Senior},
			{Dripper: req.Second, Name: a.Name, Grade: a.Grade, Senior: a.Senior},
		}
	})
}

// POST /api/caos/lanes/seniors - 今の担当者の上級生かだけを直す
func (h *CaosHandler) UpdateCaosLaneSeniors(c *gin.Context) {
	var req models.CaosLaneSeniorsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var err error
	for _, l := range req.Lanes {
		err = errors.Join(err, checkCaosDripper(l.Dripper))
	}
	if respondError(c, err) {
		return
	}
	h.updateLanes(c, func(tx *gorm.DB, cur models.CaosLanes, now time.Time) (bool, error) {
		changed := false
		for _, l := range req.Lanes {
			// 名前が画面の見ていたまま（ほかの画面が替えていない）で、上級生かが違う担当者だけ書く
			lane := cur.Lanes[l.Dripper-1]
			if lane.Name == "" || lane.Name != strings.TrimSpace(l.Name) || lane.Senior == l.Senior {
				continue
			}
			if err := tx.Model(&models.DripperAssignee{}).Where("day = ? AND dripper = ?", cur.Day, l.Dripper).
				Updates(map[string]any{"senior": l.Senior, "updated_at": now}).Error; err != nil {
				return false, err
			}
			cur.Lanes[l.Dripper-1].Senior = l.Senior
			changed = true
		}
		return changed, nil
	})
}

// writeLanes は今日の担当者を change の返したとおりに替える（交代の記録もいっしょに足す）。
func (h *CaosHandler) writeLanes(c *gin.Context, change func(cur models.CaosLanes) []models.CaosLane) {
	h.updateLanes(c, func(tx *gorm.DB, cur models.CaosLanes, now time.Time) (bool, error) {
		for _, l := range change(cur) {
			grade := ""
			if l.Grade != nil {
				grade = *l.Grade
			}
			row := models.DripperAssignee{Day: cur.Day, Dripper: l.Dripper, Name: l.Name, Grade: grade, Senior: l.Senior, UpdatedAt: now}
			if err := saveCaosLane(tx, row, cur.Lanes[l.Dripper-1].Name); err != nil {
				return false, err
			}
		}
		return true, nil
	})
}

// updateLanes は今日の担当者を write で書く。読んでから書くまでを 1 つのトランザクションで行い（担当者のロックを取る）、
// 今日の 6 つを返す。write が書いたと返したときだけ配る。
func (h *CaosHandler) updateLanes(c *gin.Context, write func(tx *gorm.DB, cur models.CaosLanes, now time.Time) (bool, error)) {
	now := h.now()
	day := caosDayString(now)
	var lanes models.CaosLanes
	changed := false
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := lockCaosLanes(tx); err != nil {
			return err
		}
		cur, _, err := loadCaosLanes(tx, day)
		if err != nil {
			return err
		}
		before, err := json.Marshal(cur)
		if err != nil {
			return err
		}
		if changed, err = write(tx, cur, now); err != nil {
			return err
		}
		lanes, _, err = loadCaosLanes(tx, day)
		if err != nil || !changed {
			return err
		}
		details, err := json.Marshal(map[string]any{"before": json.RawMessage(before), "after": lanes})
		if err != nil {
			return err
		}
		kind := "lanes.change"
		switch c.Request.URL.Path {
		case "/api/caos/lanes/swap":
			kind = "lanes.swap"
		case "/api/caos/lanes/seniors":
			kind = "lanes.seniors"
		}
		return tx.Create(&models.CaosOperation{ID: uuid.New(), Kind: kind, OccurredAt: now, RecordedAt: now, ContextAt: now, Details: details}).Error
	})
	if respondError(c, err) {
		return
	}
	c.JSON(http.StatusOK, lanes)
	if changed {
		broadcastCaosLanes(h.db, h.hub, h.now())
		notifyCaosLanesChanged(h.db)
	}
}
