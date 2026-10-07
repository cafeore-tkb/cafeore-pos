#!/usr/bin/env bash
# PR のプレビューが使う backend の「持ち主」の PR 番号を決めて、標準出力に出す。
#
# 別の PR の上に積んだ PR（向き先が main 以外）で、自分では backend を変えていない
# （差分に BACKEND_PATHS が無い）なら、中の backend は向き先の PR と同じコードなので、
# 自分の backend は立てずに向き先の PR の backend（pr-<番号> のリビジョンと Neon ブランチ）を使う。
# 向き先の PR もそうなら、さらに上へたどる。次のどれかで止まり、そこが持ち主になる。
#   - 向き先が main（既定ブランチ）
#   - backend を変えている
#   - 向き先のブランチを head に持つ open な PR が無い
#   - その PR に preview ラベルが無い（backend が立っていない）
# 自分で止まれば自分の番号を出す。
#
# 使い方: preview-backend-owner.sh <PR 番号>
# 環境変数: GH_TOKEN, GITHUB_REPOSITORY, DEFAULT_BRANCH（省略時 main）
# api-build.yml と pos-deploy-workers.yml が使う。判定を変えるときは README の
# 「PR のプレビューの backend」も直すこと。
set -euo pipefail

pr="$1"
default_branch="${DEFAULT_BRANCH:-main}"
owner_login="${GITHUB_REPOSITORY%%/*}"
# api-build.yml の DB_AFFECTING_PATHS と揃える
BACKEND_PATHS='^(api/|\.github/workflows/api-build\.yml$)'

# 積み方が輪になっていても止まるよう、たどるのは 10 段まで
for _ in $(seq 1 10); do
  base=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$pr" --jq '.base.ref')
  if [ "$base" = "$default_branch" ]; then
    echo "#$pr は $default_branch 向き。#$pr の backend を使う" >&2
    break
  fi

  changed=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$pr/files" --paginate \
    --jq '.[] | .filename, (.previous_filename // empty)' \
    | grep -E "$BACKEND_PATHS" || true)
  if [ -n "$changed" ]; then
    echo "#$pr は backend を変えている。#$pr の backend を使う" >&2
    break
  fi

  parent=$(gh api "repos/$GITHUB_REPOSITORY/pulls?state=open&head=$owner_login:$base" \
    --jq '.[0] | select(. != null) | [.number, ([.labels[].name] | index("preview") != null)] | @tsv')
  if [ -z "$parent" ]; then
    echo "#$pr の向き先 $base を head に持つ open な PR が無い。#$pr の backend を使う" >&2
    break
  fi
  parent_number=$(cut -f1 <<<"$parent")
  if [ "$(cut -f2 <<<"$parent")" != "true" ]; then
    echo "#$pr の向き先の #$parent_number に preview ラベルが無い。#$pr の backend を使う" >&2
    break
  fi

  echo "#$pr は #$parent_number の上に積んでいて backend を変えていない。上へたどる" >&2
  pr="$parent_number"
done

echo "$pr"
