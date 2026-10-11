package handlers

import "time"

// ハンドラで共通に使う、ポインタの値の比べ方。

// ptrEqual は 2 つのポインタが、どちらも nil か、指す値が同じか。
func ptrEqual[T comparable](a, b *T) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// timeEqual は 2 つの時刻が、どちらも nil か、同じ時刻か（タイムゾーンの違いは見ない）。
func timeEqual(a, b *time.Time) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && a.Equal(*b))
}

// msTime は時刻をミリ秒までに切り捨てる（nil は nil）。
// 画面の Date はミリ秒までしか持たないので、画面から送り返された時刻と比べるときに使う。
func msTime(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	v := t.Truncate(time.Millisecond)
	return &v
}
