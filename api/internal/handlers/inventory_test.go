package handlers

import (
	"slices"
	"testing"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
)

func TestMergeResourceIDs(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()

	// どちらかが取れなかった（nil）ならすべてを見る（nil）
	if got := mergeResourceIDs(nil, []uuid.UUID{a}); got != nil {
		t.Errorf("nil before: %v", got)
	}
	if got := mergeResourceIDs([]uuid.UUID{a}, nil); got != nil {
		t.Errorf("nil after: %v", got)
	}
	// 両方とも空なら何も見ない（nil ではない空）
	if got := mergeResourceIDs([]uuid.UUID{}, []uuid.UUID{}); got == nil || len(got) != 0 {
		t.Errorf("empty: %v", got)
	}
	// 重複を除き、出てきた順に並べる
	got := mergeResourceIDs([]uuid.UUID{a, b}, []uuid.UUID{b, c, a})
	if !slices.Equal(got, []uuid.UUID{a, b, c}) {
		t.Errorf("merged: %v", got)
	}
}

func validStockResourceRequest() models.StockResourceRequest {
	return models.StockResourceRequest{Kind: models.StockResourceKindBean, Name: "ブレンド豆", Unit: "g", PerServing: 15, NotifyFrom: 100, NotifyStep: 20, Buffer: 30}
}

func TestValidateStockResource(t *testing.T) {
	ok := validStockResourceRequest()
	if err := validateStockResource(&ok); err != nil {
		t.Fatal(err)
	}
	// 通知しない設定（0）は受け付ける
	zero := validStockResourceRequest()
	zero.Kind, zero.NotifyFrom, zero.NotifyStep, zero.Buffer = models.StockResourceKindCup, 0, 0, 0
	if err := validateStockResource(&zero); err != nil {
		t.Fatal(err)
	}

	cases := map[string]func(*models.StockResourceRequest){
		"unknown kind":         func(r *models.StockResourceRequest) { r.Kind = "milk" },
		"blank name":           func(r *models.StockResourceRequest) { r.Name = "  " },
		"zero per_serving":     func(r *models.StockResourceRequest) { r.PerServing = 0 },
		"negative per_serving": func(r *models.StockResourceRequest) { r.PerServing = -1 },
		"negative notify_from": func(r *models.StockResourceRequest) { r.NotifyFrom = -1 },
		"negative notify_step": func(r *models.StockResourceRequest) { r.NotifyStep = -1 },
		"negative buffer":      func(r *models.StockResourceRequest) { r.Buffer = -1 },
	}
	for name, mutate := range cases {
		req := validStockResourceRequest()
		mutate(&req)
		if validateStockResource(&req) == nil {
			t.Errorf("%s: invalid request accepted", name)
		}
	}
}
