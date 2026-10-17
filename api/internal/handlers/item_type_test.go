package handlers

import (
	"errors"
	"testing"

	"cafeore-pos/api/internal/models"
)

func boolPtr(v bool) *bool { return &v }

func TestSetItemTypeFlags(t *testing.T) {
	type flags struct{ cup, brew, senior, iced, finish bool }
	for _, tc := range []struct {
		name                string
		current             models.ItemType
		makesCup, needsBrew *bool
		seniorOnly, iced    *bool
		finish              *bool
		want                flags
		wantErr             error
	}{
		{name: "new type defaults", want: flags{true, true, false, false, false}},
		{name: "goods", makesCup: boolPtr(false), want: flags{false, false, false, false, false}},
		{name: "milk", needsBrew: boolPtr(false), want: flags{true, false, false, false, false}},
		{name: "limited", seniorOnly: boolPtr(true), want: flags{true, true, true, false, false}},
		{name: "ice", iced: boolPtr(true), want: flags{true, true, false, true, false}},
		{name: "au lait", finish: boolPtr(true), want: flags{true, true, false, false, true}},
		{name: "brew without cup", makesCup: boolPtr(false), needsBrew: boolPtr(true), wantErr: errBrewWithoutCup},
		{name: "senior without brew", needsBrew: boolPtr(false), seniorOnly: boolPtr(true), wantErr: errSeniorWithoutBrew},
		{name: "iced without brew", needsBrew: boolPtr(false), iced: boolPtr(true), wantErr: errIcedWithoutBrew},
		{name: "iced without cup", makesCup: boolPtr(false), iced: boolPtr(true), wantErr: errIcedWithoutBrew},
		{name: "finishing without brew", needsBrew: boolPtr(false), finish: boolPtr(true), wantErr: errFinishWithoutBrew},
		{
			name:    "omitted values keep the current ones",
			current: models.ItemType{MakesCup: boolPtr(true), NeedsBrew: boolPtr(false)},
			want:    flags{true, false, false, false, false},
		},
		{
			name:    "omitted iced keeps the current value",
			current: models.ItemType{MakesCup: boolPtr(true), NeedsBrew: boolPtr(true), IcedBrew: true},
			want:    flags{true, true, false, true, false},
		},
		{
			name:    "omitted finishing keeps the current value",
			current: models.ItemType{MakesCup: boolPtr(true), NeedsBrew: boolPtr(true), NeedsFinishing: true},
			want:    flags{true, true, false, false, true},
		},
		{
			name:     "turning off the cup also turns off brew, senior, iced and finishing",
			current:  models.ItemType{MakesCup: boolPtr(true), NeedsBrew: boolPtr(true), SeniorOnly: true, IcedBrew: true, NeedsFinishing: true},
			makesCup: boolPtr(false),
			want:     flags{false, false, false, false, false},
		},
		{
			name:      "turning off brew also turns off iced and finishing",
			current:   models.ItemType{MakesCup: boolPtr(true), NeedsBrew: boolPtr(true), IcedBrew: true, NeedsFinishing: true},
			needsBrew: boolPtr(false),
			want:      flags{true, false, false, false, false},
		},
	} {
		itemType := tc.current
		err := setItemTypeFlags(&itemType, tc.makesCup, tc.needsBrew, tc.seniorOnly, tc.iced, tc.finish)
		if !errors.Is(err, tc.wantErr) {
			t.Errorf("%s: err = %v, want %v", tc.name, err, tc.wantErr)
			continue
		}
		if err != nil {
			continue
		}
		got := flags{*itemType.MakesCup, *itemType.NeedsBrew, itemType.SeniorOnly, itemType.IcedBrew, itemType.NeedsFinishing}
		if got != tc.want {
			t.Errorf("%s: got %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

func TestToItemTypeResponseFlags(t *testing.T) {
	// 読み込んでいない値（nil）は列の既定値と同じに扱う
	resp := toItemTypeResponse(&models.ItemType{Name: "hot"})
	if !resp.MakesCup || !resp.NeedsBrew || resp.SeniorOnly || resp.IcedBrew {
		t.Errorf("defaults: %+v", resp)
	}
	resp = toItemTypeResponse(&models.ItemType{Name: "ice", MakesCup: boolPtr(true), NeedsBrew: boolPtr(true), IcedBrew: true})
	if !resp.IcedBrew {
		t.Errorf("iced_brew must be returned as is: %+v", resp)
	}
	resp = toItemTypeResponse(&models.ItemType{Name: "others", MakesCup: boolPtr(false), NeedsBrew: boolPtr(true), SeniorOnly: true, IcedBrew: true, NeedsFinishing: true})
	if resp.MakesCup || resp.NeedsBrew || resp.SeniorOnly || resp.IcedBrew || resp.NeedsFinishing {
		t.Errorf("a type that makes no cup must not need brew nor be senior only nor iced nor finished at serve: %+v", resp)
	}
}
