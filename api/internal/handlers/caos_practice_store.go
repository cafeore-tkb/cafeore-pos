package handlers

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// CaOS の練習用の盤面（実データテスト）の保存。盤面の決まりは caos パッケージ（caos.PracticeDoc。DB を使わない）にある。
// 練習 1 回分を caos_practices（models.CaosPracticeRow）の 1 行に jsonb で持つ。本番の盤面（CaosStore）とは表も配信も分けてあり、
// 本番の caos_drips・caos_lanes・caos_ops・orders には触らない。WebSocket でも配らない（練習している画面が、応答の盤面をそのまま使う）。
//
// 片付け：画面が終わったら消す（DELETE）。放置された練習は、最後に触ってから PracticeTTL を過ぎたら、
// 次に練習を始めたときに消す。練習の数は PracticeMax までにして、超えたら古いものから消す。

// PracticeTTL は、最後に触ってから練習の盤面を残しておく時間。
const PracticeTTL = 12 * time.Hour

// PracticeMax は、同時に残しておく練習の盤面の数。
const PracticeMax = 200

// errPracticeNotFound は練習の盤面が無い（消えた・片付けられた・ID が違う）。
var errPracticeNotFound = errors.New("practice not found")

// CaosPracticeStore は練習の盤面の保存。
type CaosPracticeStore struct {
	db *gorm.DB
	// 本当の時刻（片付けに使う。練習の時計ではない）
	now   func() time.Time
	newID func() string
}

// NewCaosPracticeStore は CaosPracticeStore を作る。
func NewCaosPracticeStore(db *gorm.DB) *CaosPracticeStore {
	return &CaosPracticeStore{db: db, now: time.Now, newID: uuid.NewString}
}

// Create は練習の盤面を作る。先に、放置された練習の盤面を片付ける。
func (s *CaosPracticeStore) Create(in caos.PracticeInput) (caos.PracticeState, error) {
	doc, err := caos.NewPracticeDoc(in, s.newID)
	if err != nil {
		return caos.PracticeState{}, err
	}
	if _, err := s.Cleanup(); err != nil {
		return caos.PracticeState{}, err
	}
	now := s.now()
	row := models.CaosPracticeRow{ID: uuid.New(), State: *doc, CreatedAt: now, UpdatedAt: now}
	if err := s.db.Create(&row).Error; err != nil {
		return caos.PracticeState{}, err
	}
	return doc.State(row.ID.String()), nil
}

// Cleanup は、最後に触ってから PracticeTTL を過ぎた練習の盤面と、PracticeMax を超えた古い練習の盤面を消す。消した数を返す。
func (s *CaosPracticeStore) Cleanup() (int64, error) {
	res := s.db.Where("updated_at < ?", s.now().Add(-PracticeTTL)).Delete(&models.CaosPracticeRow{})
	if res.Error != nil {
		return 0, res.Error
	}
	// 新しく 1 つ作るので、残すのは PracticeMax - 1 まで
	old := s.db.Model(&models.CaosPracticeRow{}).Select("id").Order("updated_at DESC").Offset(PracticeMax - 1)
	over := s.db.Where("id IN (?)", old).Delete(&models.CaosPracticeRow{})
	if over.Error != nil {
		return 0, over.Error
	}
	return res.RowsAffected + over.RowsAffected, nil
}

func parsePracticeID(id string) (uuid.UUID, error) {
	u, err := uuid.Parse(id)
	if err != nil {
		return uuid.Nil, errPracticeNotFound
	}
	return u, nil
}

// Get は練習の盤面を読む（時計は進めない）。
func (s *CaosPracticeStore) Get(id string) (caos.PracticeState, error) {
	u, err := parsePracticeID(id)
	if err != nil {
		return caos.PracticeState{}, err
	}
	var row models.CaosPracticeRow
	if err := s.db.First(&row, "id = ?", u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return caos.PracticeState{}, errPracticeNotFound
		}
		return caos.PracticeState{}, err
	}
	return row.State.State(id), nil
}

// update は練習の盤面を行ロックして読み、fn で変えて保存する。fn がエラーなら何も保存しない（変えかけた盤面は捨てる）。
func (s *CaosPracticeStore) update(id string, fn func(d *caos.PracticeDoc) error) (caos.PracticeState, error) {
	u, err := parsePracticeID(id)
	if err != nil {
		return caos.PracticeState{}, err
	}
	var out caos.PracticeState
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var row models.CaosPracticeRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", u).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errPracticeNotFound
			}
			return err
		}
		if err := fn(&row.State); err != nil {
			return err
		}
		row.UpdatedAt = s.now()
		if err := tx.Model(&row).Select("state", "updated_at").Updates(&row).Error; err != nil {
			return err
		}
		out = row.State.State(id)
		return nil
	})
	return out, err
}

// Advance は練習の時計を at まで進め、それまでに来た注文を盤面に入れる。
func (s *CaosPracticeStore) Advance(id string, at time.Time) (caos.PracticeState, error) {
	return s.update(id, func(d *caos.PracticeDoc) error { return d.Advance(at) })
}

// Apply は練習の時計を at まで進めてから、操作を 1 つ行う。操作の記録の ID（undo では空）と、操作のあとの盤面を返す。
func (s *CaosPracticeStore) Apply(id string, at time.Time, op caos.Op) (string, caos.PracticeState, error) {
	var opID string
	state, err := s.update(id, func(d *caos.PracticeDoc) error {
		var err error
		opID, err = d.Apply(at, op, s.newID)
		return err
	})
	return opID, state, err
}

// Delete は練習の盤面を消す（無くてもエラーにしない）。
func (s *CaosPracticeStore) Delete(id string) error {
	u, err := parsePracticeID(id)
	if err != nil {
		return nil
	}
	return s.db.Delete(&models.CaosPracticeRow{}, "id = ?", u).Error
}
