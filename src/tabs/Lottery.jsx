// 🍀 복권
import React, { useState } from "react";
import { api } from "../lib/api.js";
import { useApp, useLoad, Cols, H3, Caption, Btn, TextInput, Select, NumberInput, Checkbox, Info, Warning, ErrorBox, Success, DataTable, Loading, ConfirmModal, useSort, SortTh } from "../components/ui.jsx";

const ENTRY_COLS = ["참여 일시", "번호", "이름", "복권 참여 번호"];
const SUM_COLS = ["참여자수", "참여 복권수", "총 액수"];
const pad = (n, k = 2) => String(n).padStart(k, "0");

const WIN_VAL = { 등수: (w) => w.rank, 번호: (w) => w.student_no, 이름: (w) => w.student_name, "복권 참여 번호": (w) => w.numbers.map((n) => pad(n)).join(","), 당첨금: (w) => w.prize };
function WinnersTable({ winners, wset }) {
  const srt = useSort(winners, (w, c) => WIN_VAL[c](w));
  return (
    <div className="tbl-wrap">
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              {Object.keys(WIN_VAL).map((c) => (
                <SortTh key={c} label={c} s={srt} />
              ))}
            </tr>
          </thead>
          <tbody>
            {srt.sorted.map((w, i) => (
              <tr key={i}>
                <td>{w.rank}등</td>
                <td>{w.student_no}</td>
                <td>{w.student_name}</td>
                <td>
                  {w.numbers.map((n, j) => (
                    <React.Fragment key={j}>
                      {j ? ", " : ""}
                      {wset.has(n) ? <span style={{ color: "#d90429", fontWeight: 700 }}>{pad(n)}</span> : pad(n)}
                    </React.Fragment>
                  ))}
                </td>
                <td>{w.prize}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LotteryAdmin() {
  const app = useApp();
  const [pickId, setPickId] = useState("");
  const [visibleId, setVisibleId] = useState("");
  const { data, error } = useLoad("lottery_admin_load", { pick_round_id: pickId, visible_round_id: visibleId }, [app.ver, pickId, visibleId]);
  const [cfg, setCfg] = useState({ price: 20, first: 80, tax: 40, second: 20, third: 20 });
  const [joinCnt, setJoinCnt] = useState(1);
  const [joinTre, setJoinTre] = useState(true);
  const [wn, setWn] = useState([1, 2, 3, 4]);
  const [err, setErr] = useState("");
  const [drawErr, setDrawErr] = useState("");
  const [finErr, setFinErr] = useState("");
  const [askClose, setAskClose] = useState(false);
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;

  const run = async (action, args, okMsg, failMsg, setE = setErr) => {
    setE("");
    const r = await api(action, args);
    if (r.ok) {
      app.toast(typeof okMsg === "function" ? okMsg(r) : okMsg, "✅");
      app.refresh();
      return r;
    }
    setE(r.error || failMsg);
    return null;
  };

  const cur = data.current;
  const dup = new Set(wn).size !== 4;
  const finalize = async (rid, onOk) => {
    setFinErr("");
    const r = await api("lottery_finalize", { round_id: rid });
    if (r.ok) {
      onOk && onOk();
      app.toast("당첨금 지급 및 장부 반영 완료", "✅");
      app.refresh();
    } else setFinErr(r.error);
  };
  const picked = data.closed.find((r) => r.round_id === pickId);

  return (
    <>
      <H3>🛠️ 복권 설정 및 개시</H3>
      <Cols w={[1, 1, 1, 1.1, 1.1, 0.8, 0.8]} va="bottom">
        <NumberInput label="복권 가격" stepper={false} min={2} value={cfg.price} onChange={(v) => setCfg((c) => ({ ...c, price: v }))} />
        <NumberInput label="세금(%)" stepper={false} min={1} max={100} value={cfg.tax} onChange={(v) => setCfg((c) => ({ ...c, tax: v }))} />
        <NumberInput label="3등 당첨금" stepper={false} min={0} value={cfg.third} onChange={(v) => setCfg((c) => ({ ...c, third: v }))} />
        <NumberInput label="1등 백분율(%)" stepper={false} min={0} max={100} value={cfg.first} onChange={(v) => setCfg((c) => ({ ...c, first: v }))} />
        <NumberInput label="2등 백분율(%)" stepper={false} min={0} max={100} value={cfg.second} onChange={(v) => setCfg((c) => ({ ...c, second: v }))} />
        <Btn onClick={() => run("lottery_open", { ticket_price: cfg.price, tax_rate: cfg.tax, first_pct: cfg.first, second_pct: cfg.second, third_prize: cfg.third }, (r) => `복권 ${r.round_no}회 개시`, "복권 개시 실패")}>개시</Btn>
        <Btn onClick={() => setAskClose(true)}>마감</Btn>
      </Cols>
      <ConfirmModal
        open={askClose}
        title="🍀 복권 마감"
        message={data.open ? `진행 중인 ${data.open.round_no}회 복권을 마감할까요? 마감하면 더 이상 구매할 수 없어요.` : "진행 중인 복권을 마감할까요?"}
        yesText="마감"
        onYes={async () => {
          setAskClose(false);
          await run("lottery_close", {}, "복권 마감 완료", "복권 마감 실패");
        }}
        onNo={() => setAskClose(false)}
      />
      {cfg.first + cfg.second !== 100 ? <Warning>1등 + 2등 당첨 백분율의 합은 반드시 100이어야 합니다.</Warning> : null}
      <ErrorBox>{err}</ErrorBox>
      {data.open ? <Success>{`진행 중 복권: ${data.open.round_no}회 | 가격 ${data.open.ticket_price}`}</Success> : <Info>개시된 복권이 없습니다.</Info>}

      <H3>👑 관리자 복권 참여</H3>
      {data.open ? (
        <>
          <Cols w={[2, 1, 1]} va="bottom">
            <NumberInput label="복권 참여 수" min={1} value={joinCnt} onChange={setJoinCnt} />
            <Checkbox label="국고반영" checked={joinTre} onChange={setJoinTre} />
            <Btn onClick={() => run("lottery_admin_join", { count: joinCnt, apply_treasury: joinTre }, (r) => `관리자 복권 ${r.count}게임 참여 완료`, "관리자 복권 참여 실패")}>복권 참여</Btn>
          </Cols>
          {data.counts.admin_with > 0 ? <Caption>{`관리자 참여 현황 : 복권 참여수 ${pad(data.counts.admin_with)}  |  총액 ${data.counts.admin_with * data.counts.price}  |  국고반영여부 O`}</Caption> : null}
          {data.counts.admin_without > 0 ? <Caption>{`관리자 참여 현황 : 복권 참여수 ${pad(data.counts.admin_without)}  |  총액 ${data.counts.admin_without * data.counts.price}  |  국고반영여부 X`}</Caption> : null}
          <Caption>{`학생 참여 현황 : 복권 참여수 ${pad(data.counts.student)}  |  총액 ${pad(data.counts.student * data.counts.price, 3)}`}</Caption>
        </>
      ) : (
        <Info>개시된 복권이 없습니다.</Info>
      )}

      <H3>📝 복권 참여 결과</H3>
      {cur && cur.summary ? (
        <>
          <DataTable rows={cur.summary} columns={SUM_COLS} />
          <DataTable rows={cur.entries} columns={ENTRY_COLS} csvName="복권참여결과" />
        </>
      ) : (
        <Info>복권 마감 버튼을 눌러야 결과가 표시됩니다.</Info>
      )}

      {data.closed.length ? (
        <>
          <Select
            label="🔎 마감된 복권 결과 조회"
            value={picked ? `${picked.round_no}회` : "(선택없음)"}
            options={["(선택없음)", ...data.closed.map((r) => `${r.round_no}회`)]}
            onChange={(v) => {
              const r = data.closed.find((x) => `${x.round_no}회` === v);
              setPickId(r ? r.round_id : "");
            }}
          />
          {picked && data.picked ? (
            <>
              {data.picked.entries.length ? (
                <>
                  <DataTable rows={data.picked.summary} columns={SUM_COLS} />
                  <DataTable rows={data.picked.entries} columns={ENTRY_COLS} csvName="복권참여결과" />
                </>
              ) : (
                <Info>선택한 회차의 참여 결과가 없습니다.</Info>
              )}
              {data.picked.status !== "drawn" ? (
                <Warning>⚠️ 이 회차는 아직 추첨(당첨번호 제출)이 완료되지 않았습니다. 위 '복권 추첨하기'에서 진행해 주세요.</Warning>
              ) : data.picked.payout_done && data.picked.ledger_applied ? (
                <Caption>✅ 이미 당첨금 지급 및 장부 반영이 완료된 회차입니다.</Caption>
              ) : (
                <>
                  <Warning>⚠️ 이 회차는 아직 당첨금 지급/장부(국고) 반영이 완료되지 않았습니다.</Warning>
                  <Btn onClick={() => finalize(pickId)}>당첨금 지급 및 장부 반영</Btn>
                </>
              )}
            </>
          ) : null}
        </>
      ) : (
        <Info>조회 가능한 마감 복권 회차가 없습니다.</Info>
      )}

      <H3>🎰 복권 추첨하기</H3>
      <Cols w={[1, 1, 1, 1, 1.4]} va="bottom">
        {["첫 번째", "두 번째", "세 번째", "네 번째"].map((l, i) => (
          <NumberInput key={l} label={`${l} 당첨번호`} min={1} max={20} value={wn[i]} onChange={(v) => setWn((a) => a.map((x, j) => (j === i ? v : x)))} />
        ))}
        <Btn
          disabled={!!(cur && cur.payout_done)}
          onClick={async () => {
            setDrawErr("");
            if (!cur) return setDrawErr("대상 복권 회차가 없습니다.");
            if (dup) return setDrawErr("당첨번호 4개는 중복 없이 입력해 주세요.");
            const r = await api("lottery_draw", { round_id: cur.round_id, numbers: wn });
            if (r.ok) {
              setVisibleId(cur.round_id);
              app.toast("복권 추첨 완료", "✅");
              app.refresh();
            } else setDrawErr(r.error || "복권 추첨 실패");
          }}
        >
          당첨번호 제출
        </Btn>
      </Cols>
      {dup ? <Warning>당첨번호 4개는 서로 중복될 수 없습니다.</Warning> : null}
      <ErrorBox>{drawErr}</ErrorBox>

      <H3>🎉 당첨자 확인</H3>
      {cur ? (
        (() => {
          const show = visibleId === cur.round_id && cur.status === "drawn" && cur.winners;
          if (!show) return <Info>당첨 번호 제출 버튼을 눌러야 당첨 결과가 표시됩니다.</Info>;
          const wset = new Set(cur.winning_numbers);
          return (
            <>
              <Caption>{`회차 ${cur.round_no} | 당첨번호: ${cur.winning_numbers.map((n) => pad(n)).join(", ")}`}</Caption>
              {cur.winners.length ? (
                <WinnersTable winners={cur.winners} wset={wset} />
              ) : (
                <Info>당첨자가 없습니다.</Info>
              )}
              <Btn onClick={() => finalize(cur.round_id, () => setVisibleId(""))} disabled={cur.payout_done && cur.ledger_applied}>
                당첨금 지급 및 장부 반영
              </Btn>
              {cur.payout_done ? <Caption>당첨금 지급: 완료</Caption> : null}
              {cur.ledger_applied ? <Caption>장부 반영: 완료</Caption> : null}
            </>
          );
        })()
      ) : null}
      <ErrorBox>{finErr}</ErrorBox>

      <H3>📒 복권 관리 장부</H3>
      {data.ledger.length ? <DataTable rows={data.ledger} csvName="복권관리장부" /> : <Info>아직 반영된 복권 관리 장부가 없습니다.</Info>}
    </>
  );
}

function LotteryUser() {
  const app = useApp();
  const { data, error } = useLoad("lottery_user_load", {}, [app.ver]);
  const empty = () => Array.from({ length: 5 }, () => ["", "", "", ""]);
  const [games, setGames] = useState(empty);
  const [errs, setErrs] = useState([]);
  const [askBuy, setAskBuy] = useState(null);
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  const o = data.open;

  const buy = async () => {
    const valid = [];
    const e = [];
    games.forEach((g, idx) => {
      const vals = g.map((x) => String(x).trim());
      const filled = vals.filter((v) => v !== "");
      if (!filled.length) return;
      if (filled.length !== 4) return e.push(`${idx + 1}게임: 숫자 4개를 모두 입력해 주세요.`);
      const parsed = [];
      for (const v of vals) {
        if (!/^\d+$/.test(v)) return e.push(`${idx + 1}게임: 숫자만 입력해 주세요.`);
        const n = parseInt(v, 10);
        if (n < 1 || n > 20) return e.push(`${idx + 1}게임: 숫자는 1~20 사이여야 합니다.`);
        parsed.push(n);
      }
      if (new Set(parsed).size !== 4) return e.push(`${idx + 1}게임: 같은 숫자를 중복 입력할 수 없습니다.`);
      valid.push(parsed);
    });
    if (e.length) return setErrs(e);
    if (!valid.length) return setErrs(["입력된 게임이 없습니다. 최소 1게임 이상 입력해 주세요."]);
    setErrs([]);
    setAskBuy(valid);
  };
  const doBuy = async (valid) => {
    setAskBuy(null);
    const r = await api("lottery_buy", { games: valid });
    if (r.ok) {
      app.toast(`복권 ${r.count}게임 구매 완료! 통장에서 금액이 차감되었습니다.`, "✅");
      setGames(empty());
      app.refresh();
    } else setErrs([r.error || "복권 구매 실패"]);
  };

  return (
    <>
      <H3>🎟️ 복권 구매하기</H3>
      {!o ? (
        <Info>개시된 복권이 없습니다.</Info>
      ) : (
        <>
          <div className="md">{`🔔 ${o.round_no}회차 | 복권 가격 ${pad(o.ticket_price)}`}</div>
          <Caption>※ 한 줄에 1~20 숫자 4개를 중복 없이 입력하고 구매 버튼을 누르세요.</Caption>
          {games.map((g, gi) => (
            <Cols w={[0.8, 1, 1, 1, 1]} va="center" key={gi}>
              <b>{gi + 1}게임:</b>
              {g.map((v, ni) => (
                <TextInput
                  key={ni}
                  hideLabel
                  label={`${gi + 1}게임 ${ni + 1}칸`}
                  className={`lot-in-${gi}`}
                  placeholder="(숫자 입력칸)"
                  inputMode="numeric"
                  value={v}
                  onChange={(val) => setGames((gs) => gs.map((row, r) => (r === gi ? row.map((x, c) => (c === ni ? val : x)) : row)))}
                />
              ))}
            </Cols>
          ))}
          <Cols w={2}>
            <Btn onClick={() => setGames(empty())}>숫자 초기화</Btn>
            <Btn onClick={buy}>복권 구입</Btn>
          </Cols>
          {errs.map((m) => (
            <ErrorBox key={m}>{m}</ErrorBox>
          ))}
          <ConfirmModal
            open={!!askBuy}
            title="🍀 복권 구입"
            message={askBuy ? `${askBuy.length}게임을 ${askBuy.length * o.ticket_price}드림에 구입할까요?` : ""}
            onYes={() => doBuy(askBuy)}
            onNo={() => setAskBuy(null)}
          >
            {askBuy ? <div className="caption center">{askBuy.map((g, i) => `${i + 1}게임: ${g.map((n) => pad(n)).join(", ")}`).join("\n")}</div> : null}
          </ConfirmModal>
        </>
      )}
      <H3>📜 복권 구매 내역</H3>
      {!o ? <Info>개시된 복권이 없습니다.</Info> : data.history.length ? <DataTable rows={data.history} columns={["회차", "번호", "이름", "복권 참여 번호"]} csvName="복권구매내역" /> : <Info>복권 구매 내역이 없습니다.</Info>}
    </>
  );
}

export default function Lottery() {
  const app = useApp();
  return app.user && app.user.role === "admin" ? <LotteryAdmin /> : <LotteryUser />;
}
