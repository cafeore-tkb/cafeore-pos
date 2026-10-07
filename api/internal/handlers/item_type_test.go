package handlers

import (
	"errors"
	"testing"

	"cafeore-pos/api/internal/models"
)

func boolPtr(v bool) *bool { return &v }

func TestSetItemTypeFlags(t *testing.T) {
	type flags struct{ cup, brew, senior bool }
	for _, tc := range []struct {
		name                string
		current             models.ItemType
		makesCup, needsBrew *bool
		seniorOnly          *bool
		want                flags
		wantErr             error
	}{
		{name: "new type defaults", want: flags{true, true, false}},
		{name: "goods", makesCup: boolPtr(false), want: flags{false, false, false}},
		{name: "milk", needsBrew: boolPtr(false), want: flags{true, false, false}},
		{name: "limited", seniorOnly: boolPtr(true), want: flags{true, true, true}},
		{name: "brew without cup", makesCup: boolPtr(false), needsBrew: boolPtr(true), wantErr: errBrewWithoutCup},
		{name: "senior without brew", needsBrew: boolPtr(false), seniorOnly: boolPtr(true), wantErr: errSeniorWithoutBrew},
		{
			name:    "omitted values keep the current ones",
			current: models.ItemType{MakesCup: boolPtr(true), NeedsBrew: boolPtr(false)},
			want:    flags{true, false, false},
		},
		{
			name:     "turning off the cup also turns off brew and senior",
			current:  models.ItemType{MakesCup: boolPtr(true), NeedsBrew: boolPtr(true), SeniorOnly: true},
			makesCup: boolPtr(false),
			want:     flags{false, false, false},
		},
	} {
		itemType := tc.current
		err := setItemTypeFlags(&itemType, tc.makesCup, tc.needsBrew, tc.seniorOnly)
		if !errors.Is(err, tc.wantErr) {
			t.Errorf("%s: err = %v, want %v", tc.name, err, tc.wantErr)
			continue
		}
		if err != nil {
			continue
		}
		got := flags{*itemType.MakesCup, *itemType.NeedsBrew, itemType.SeniorOnly}
		if got != tc.want {
			t.Errorf("%s: got %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

func TestToItemTypeResponseFlags(t *testing.T) {
	// 読み込んでいない値（nil）は列の既定値と同じに扱う
	resp := toItemTypeResponse(&models.ItemType{Name: "hot"})
	if !resp.MakesCup || !resp.NeedsBrew || resp.SeniorOnly {
		t.Errorf("defaults: %+v", resp)
	}
	resp = toItemTypeResponse(&models.ItemType{Name: "others", MakesCup: boolPtr(false), NeedsBrew: boolPtr(true), SeniorOnly: true})
	if resp.MakesCup || resp.NeedsBrew || resp.SeniorOnly {
		t.Errorf("a type that makes no cup must not need brew nor be senior only: %+v", resp)
	}
}
