import { ArrowDown, ArrowUp, GripVertical, Link2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CardSide,
  type MappingCard,
  type MappingTarget,
  cardGroup,
  comparisonBoard,
  excludeMappingCard,
  moveMappingCard,
  restoreMappingCard,
  settingsFromBoard,
} from "~/lib/analytics/comparisonBoard";
import type {
  ComparisonBoard,
  ComparisonSettings,
} from "~/lib/analytics/yearComparison";
import "./comparisonCardBoard.css";

type Drag = {
  card: MappingCard;
  x: number;
  y: number;
  startX: number;
  startY: number;
  pointerId: number;
  started: boolean;
};
const sameCard = (a: MappingCard | null, b: MappingCard) =>
  a?.side === b.side && a.key === b.key;
const pendingKey = (side: CardSide) =>
  side === "current" ? "pendingCurrent" : "pendingHistorical";
const excludedKey = (side: CardSide) =>
  side === "current" ? "excludedCurrent" : "excludedHistorical";
const sideName = (side: CardSide) => (side === "current" ? "今年" : "前年");

export function ComparisonCardBoard({
  settings,
  onChange,
  currentProducts,
  historicalProducts,
  disabled,
}: {
  settings: ComparisonSettings;
  onChange: (next: ComparisonSettings) => void;
  currentProducts: { key: string; name: string }[];
  historicalProducts: string[];
  disabled: boolean;
}) {
  const board = useMemo(
    () =>
      comparisonBoard(
        settings,
        currentProducts.map((p) => p.key),
        historicalProducts,
      ),
    [settings, currentProducts, historicalProducts],
  );
  const names = new Map(currentProducts.map((p) => [p.key, p.name]));
  const name = (card: MappingCard) =>
    card.side === "current" ? (names.get(card.key) ?? card.key) : card.key;
  const [selected, setSelected] = useState<MappingCard | null>(null);
  const [dragging, setDragging] = useState<Drag | null>(null);
  const [hover, setHover] = useState<MappingTarget | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dragRef = useRef<Drag | null>(null);
  const suppressClickUntil = useRef(0);
  const boardRef = useRef<HTMLFieldSetElement>(null);
  const latest = useRef({
    board,
    settings,
    onChange,
    currentProducts,
    historicalProducts,
    disabled,
  });
  latest.current = {
    board,
    settings,
    onChange,
    currentProducts,
    historicalProducts,
    disabled,
  };

  const commit = (
    next: ComparisonBoard,
    message = "対応付けを更新しました。",
  ) => {
    const state = latest.current;
    if (state.disabled || next === state.board) return;
    state.onChange(
      settingsFromBoard(
        state.settings,
        next,
        state.currentProducts,
        state.historicalProducts,
      ),
    );
    setSelected(null);
    setAnnouncement(message);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const targetAt = useCallback((x: number, y: number) => {
    const element = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-mapping-target]");
    if (!element || !boardRef.current?.contains(element)) return null;
    try {
      return JSON.parse(
        element.dataset.mappingTarget ?? "null",
      ) as MappingTarget | null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let frame = 0;
    const locate = (drag: Drag) => {
      const target = targetAt(drag.x, drag.y);
      setHover(target);
    };
    const scroll = () => {
      const drag = dragRef.current;
      if (!drag?.started) return;
      const delta =
        drag.y < 85 ? -12 : drag.y > window.innerHeight - 85 ? 12 : 0;
      if (delta) {
        window.scrollBy(0, delta);
        locate(drag);
      }
      frame = requestAnimationFrame(scroll);
    };
    const cancel = () => {
      dragRef.current = null;
      setDragging(null);
      setHover(null);
      cancelAnimationFrame(frame);
    };
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (
        !drag ||
        drag.pointerId !== event.pointerId ||
        latest.current.disabled
      )
        return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (
        !drag.started &&
        Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6
      )
        return;
      event.preventDefault();
      if (!drag.started) {
        drag.started = true;
        setSelected(null);
        frame = requestAnimationFrame(scroll);
      }
      setDragging({ ...drag });
      locate(drag);
    };
    const finish = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.started) {
        suppressClickUntil.current = performance.now() + 350;
        const target = targetAt(event.clientX, event.clientY);
        if (target && !latest.current.disabled)
          commitRef.current(
            moveMappingCard(latest.current.board, drag.card, target),
          );
      }
      cancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancel();
        setSelected(null);
        setAnnouncement("カードの移動を取り消しました。");
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      cancelAnimationFrame(frame);
      dragRef.current = null;
    };
  }, [targetAt]);
  useEffect(() => {
    if (disabled) {
      dragRef.current = null;
      setDragging(null);
      setHover(null);
      setSelected(null);
    }
  }, [disabled]);

  const begin = (event: React.PointerEvent<HTMLElement>, card: MappingCard) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      card,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      started: false,
    };
  };
  const choose = (card: MappingCard) => {
    if (disabled || performance.now() < suppressClickUntil.current) return;
    if (!selected) {
      setSelected(card);
      setAnnouncement(
        `${sideName(card.side)}の${name(card)}を選びました。相手のカード、または対応済みの行を押してください。`,
      );
    } else if (sameCard(selected, card)) setSelected(null);
    else {
      const next = moveMappingCard(board, selected, { type: "card", ...card });
      commit(next);
    }
  };
  const active = dragging?.card ?? selected;
  const targetGroup =
    hover?.type === "group"
      ? hover.id
      : hover?.type === "card"
        ? cardGroup(board, hover)?.id
        : null;
  const canDrop =
    active && hover && moveMappingCard(board, active, hover) !== board;
  const renderCard = (card: MappingCard, excluded = false) => {
    const label = `${sideName(card.side)}の${name(card)}`;
    const targeted = canDrop && hover?.type === "card" && sameCard(hover, card);
    const add = targeted && active?.side !== card.side;
    return (
      <div
        key={`${card.side}:${card.key}`}
        data-mapping-card={card.key}
        data-mapping-side={card.side}
        className={`mapping-card mapping-card--${card.side} ${excluded ? "mapping-card--excluded" : ""} ${sameCard(selected, card) ? "is-selected" : ""} ${sameCard(dragging?.card ?? null, card) ? "is-dragging" : ""} ${targeted ? "is-target" : ""}`}
      >
        {!excluded && (
          <button
            type="button"
            className="mapping-grip"
            aria-label={`${label}をドラッグ`}
            disabled={disabled}
            onPointerDown={(event) => begin(event, card)}
            onClick={() => {
              if (performance.now() >= suppressClickUntil.current) choose(card);
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="mapping-card-name"
          disabled={disabled || excluded}
          aria-label={`${label}を選ぶ`}
          aria-pressed={sameCard(selected, card)}
          data-mapping-target={
            excluded ? undefined : JSON.stringify({ type: "card", ...card })
          }
          onPointerDown={(event) => {
            if (event.pointerType === "mouse") begin(event, card);
          }}
          onClick={() => choose(card)}
        >
          {name(card)}
        </button>
        {add && (
          <span
            className="mapping-plus-preview"
            data-add-preview
            aria-hidden="true"
          >
            <Plus size={20} />
          </span>
        )}
        {excluded ? (
          <button
            type="button"
            className="mapping-card-action"
            aria-label={`${label}を戻す`}
            disabled={disabled}
            onClick={() =>
              commit(
                restoreMappingCard(board, card),
                `${label}を対応待ちに戻しました。`,
              )
            }
          >
            <ArrowUp size={17} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="mapping-card-action"
            aria-label={`${label}を対応から外す`}
            disabled={disabled}
            onClick={() =>
              commit(
                excludeMappingCard(board, card),
                `${label}を下の「比較しないカード」に移しました。`,
              )
            }
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  };
  const reorderGroup = (index: number, step: number) => {
    const groups = [...board.groups];
    const [group] = groups.splice(index, 1);
    groups.splice(index + step, 0, group);
    commit({ ...board, groups }, "対応行の順番を変更しました。");
  };
  return (
    <fieldset
      ref={boardRef}
      disabled={disabled}
      className="mapping-board"
      aria-label="商品カードの対応付け"
    >
      <legend className="sr-only">商品カードの対応付け</legend>
      <p className="mapping-instructions">
        カードを相手のカードに重ねて対応付け。同じ行へ重ねると「＋」で追加できます。カードを選んで相手を押す操作でも対応付けられます。
      </p>
      <div className="mapping-column-headings">
        <span>
          今年の商品 <small>{currentProducts.length}枚</small>
        </span>
        <span>
          前年の商品 <small>{historicalProducts.length}枚</small>
        </span>
      </div>
      <div className="mapping-groups">
        {board.groups.map((group, index) => {
          const adding =
            canDrop &&
            targetGroup === group.id &&
            active &&
            !group[active.side].includes(active.key);
          const title = group.current
            .map((key) => names.get(key) ?? key)
            .join("＋");
          return (
            <div
              key={group.id}
              data-mapping-group={group.id}
              data-mapping-target={JSON.stringify({
                type: "group",
                id: group.id,
              })}
              className={`mapping-group ${adding ? "is-target" : ""}`}
            >
              <div className="mapping-group-heading">
                <span>対応 {index + 1}</span>
                <div>
                  <button
                    type="button"
                    aria-label={`${title}の行を上へ`}
                    disabled={disabled || index === 0}
                    onClick={() => reorderGroup(index, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`${title}の行を下へ`}
                    disabled={disabled || index === board.groups.length - 1}
                    onClick={() => reorderGroup(index, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              </div>
              <div className="mapping-pair">
                {(["current", "historical"] as const).map((side) => (
                  <div
                    key={side}
                    className={`mapping-cell ${adding && active?.side === side ? "is-adding" : ""}`}
                  >
                    {group[side].map((key, itemIndex) => (
                      <div key={key}>
                        {itemIndex > 0 && (
                          <span
                            className="mapping-between-plus"
                            aria-hidden="true"
                          >
                            ＋
                          </span>
                        )}
                        {renderCard({ side, key })}
                      </div>
                    ))}
                    {adding && active?.side === side && (
                      <div
                        className="mapping-add-preview"
                        data-add-preview
                        aria-hidden="true"
                      >
                        <Plus size={20} /> 離すと追加
                      </div>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className={`mapping-link ${selected ? "can-add" : ""}`}
                  aria-label={`${title}の行に追加`}
                  disabled={disabled || !selected}
                  onClick={() => {
                    if (selected)
                      commit(
                        moveMappingCard(board, selected, {
                          type: "group",
                          id: group.id,
                        }),
                      );
                  }}
                >
                  {adding || selected ? (
                    <Plus size={16} />
                  ) : (
                    <Link2 size={16} />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <section className="mapping-pending" aria-label="対応待ちのカード">
        <h4>
          対応待ち{" "}
          <span>この中で同じ高さに並んでいても、まだ対応していません。</span>
        </h4>
        <div className="mapping-pending-columns">
          {(["current", "historical"] as const).map((side) => (
            <div
              key={side}
              data-mapping-target={JSON.stringify({ type: "pending", side })}
              data-pending-side={side}
              className={`mapping-pending-column ${canDrop && hover?.type === "pending" && hover.side === side ? "is-target" : ""}`}
            >
              <button
                type="button"
                className="mapping-unlink"
                disabled={disabled || !selected || selected.side !== side}
                onClick={() => {
                  if (selected)
                    commit(
                      moveMappingCard(board, selected, {
                        type: "pending",
                        side,
                      }),
                      "対応を解除して、対応待ちに戻しました。",
                    );
                }}
              >
                ここへ戻す・対応を解除
              </button>
              {board[pendingKey(side)].map((key) => renderCard({ side, key }))}
              {!board[pendingKey(side)].length && (
                <p className="mapping-empty">対応待ちのカードはありません</p>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="mapping-excluded" aria-label="比較しないカード">
        <h4>
          比較しないカード{" "}
          <span>↑で対応待ちに戻せます。売上の全体集計からは除きません。</span>
        </h4>
        <div className="mapping-pending-columns">
          {(["current", "historical"] as const).map((side) => (
            <div
              key={side}
              data-excluded-side={side}
              className="mapping-excluded-column"
            >
              <p className="mapping-side-label">{sideName(side)}</p>
              {board[excludedKey(side)].map((key) =>
                renderCard({ side, key }, true),
              )}
              {!board[excludedKey(side)].length && (
                <p className="mapping-empty">カードはありません</p>
              )}
            </div>
          ))}
        </div>
      </section>
      <output className="sr-only" aria-live="polite">
        {announcement}
      </output>
      {selected && !dragging && (
        <p className="mapping-selection">
          <strong>{name(selected)}</strong> を選択中。移動先を押してください。
          <button
            type="button"
            disabled={disabled}
            onClick={() => setSelected(null)}
          >
            選択を解除
          </button>
        </p>
      )}
      {dragging && (
        <div
          className={`mapping-drag-ghost mapping-card--${dragging.card.side}`}
          style={{ left: dragging.x + 14, top: dragging.y + 14 }}
          aria-hidden="true"
        >
          <GripVertical size={16} />
          {name(dragging.card)}
        </div>
      )}
    </fieldset>
  );
}
