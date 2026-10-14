import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getToken, setToken, remember, onBusy } from "./lib/api.js";
import { AppCtx, Cols, TextInput, Checkbox, Btn, ErrorBox, Subheader, Toasts, Loading, useLoad, Info, prefetch, clearLoadCache } from "./components/ui.jsx";
import Sidebar from "./components/Sidebar.jsx";
import UserHeader from "./components/UserHeader.jsx";
import { BankAdmin, BankStudent } from "./tabs/Bank.jsx";
import Individual from "./tabs/Individual.jsx";
import Invest from "./tabs/Invest.jsx";
import Permissions from "./tabs/Permissions.jsx";
import Accounts from "./tabs/Accounts.jsx";
import Jobs from "./tabs/Jobs.jsx";
import Treasury from "./tabs/Treasury.jsx";
import Stats from "./tabs/Stats.jsx";
import Credit from "./tabs/Credit.jsx";
import Savings from "./tabs/Savings.jsx";
import { MartAdmin, MartUser } from "./tabs/Mart.jsx";
import Auction from "./tabs/Auction.jsx";
import Lottery from "./tabs/Lottery.jsx";
import Logs from "./tabs/Logs.jsx";
import UserStatsCredit from "./tabs/UserStatsCredit.jsx";
import Goal from "./tabs/Goal.jsx";

const APP_TITLE = "🏫학급 경제 시스템🪙";

// 탭별로 화면이 처음 불러오는 데이터 (로그인 직후 미리 불러 두면 탭을 누를 때 바로 뜸)
const TAB_LOADS = {
  "🏦 내 통장": (admin) => (admin ? [["templates_list", {}], ["accounts_list", {}]] : [["templates_list", {}], ["tx_list", { limit: 300 }]]),
  "admin::🏦 내 통장": () => [["templates_list", {}], ["accounts_list", {}]],
  "🔎 개별조회": () => [["individual_students", {}]],
  "💼 직업/월급": () => [["jobs_load", {}]],
  "🏛️ 국세청(국고)": () => [["treasury_load", {}]],
  "📊 통계청": () => [["stats_load", {}]],
  "💳 신용등급": () => [["credit_load", {}]],
  "🏦 은행(적금)": (admin) => (admin ? [["dep_req_list", {}], ["bank_load", { admin_mode: true }]] : [["bank_load", { admin_mode: false }]]),
  "admin::🏦 은행(적금)": () => [["dep_req_list", {}], ["bank_load", { admin_mode: true }]],
  "📈 투자": (admin) => [["invest_load", { admin_mode: admin }]],
  "admin::📈 투자": () => [["invest_load", { admin_mode: true }]],
  "⭐ 권한부여": () => [["perm_load", {}]],
  "👥 계정 정보": () => [["acc_load", {}]],
  "🛒마트": (admin) => [[admin ? "mart_admin_load" : "mart_user_load", {}]],
  "admin::🛒마트": () => [["mart_admin_load", {}]],
  "🏷️ 경매": (admin) => (admin ? [["auction_admin_load", { pick_round_id: "" }]] : [["auction_user_load", {}]]),
  "🍀 복권": (admin) => (admin ? [] : [["lottery_user_load", {}]]),
  "📊 통계/신용": () => [["user_stats_credit", {}]],
  "🎯 목표": () => [["goal_load", {}]],
};

export const ALL_TABS = [
  "🏦 내 통장", "🔎 개별조회", "💼 직업/월급", "🏛️ 국세청(국고)", "📊 통계청", "💳 신용등급", "🏦 은행(적금)",
  "📈 투자", "⭐ 권한부여", "👥 계정 정보", "🛒마트", "🏷️ 경매", "🍀 복권", "🧾 로그기록",
];
const STUDENT_DEFAULT = ["🏦 내 통장", "🏦 은행(적금)", "📈 투자", "🛒마트", "🏷️ 경매", "🍀 복권"];

// 기존 tab_visible() 규칙 그대로 (학생)
function tabVisibleStudent(perms, tab) {
  const has = (p) => perms.has("admin_all") || perms.has(p);
  if (STUDENT_DEFAULT.includes(tab)) return true;
  if (perms.has(`tab::${tab}`)) return true;
  if (tab === "🏛️ 국세청(국고)") return has("treasury_read") || has("treasury_write");
  if (tab === "📊 통계청") return has("stats_write");
  if (tab === "💳 신용등급") return has("credit_write");
  if (tab === "💼 직업/월급") return has("jobs_write");
  return false;
}

function buildTabs(user) {
  if (!user) return { keys: [], labels: {} };
  if (user.role === "admin") {
    const labels = {};
    ALL_TABS.forEach((t) => (labels[t] = t === "🏦 내 통장" ? "💰입금/출금" : t));
    return { keys: [...ALL_TABS], labels };
  }
  const perms = new Set(user.perms || []);
  const invOk = user.invest_enabled !== false;
  const baseKeys = ["🏦 내 통장", "🏦 은행(적금)", "📊 통계/신용"];
  const baseLabels = ["📝 통장/거래", "🏦 적금", "📊 통계/신용"];
  if (invOk) {
    baseKeys.push("📈 투자");
    baseLabels.push("📈 투자");
  }
  baseKeys.push("🎯 목표", "🛒마트", "🏷️ 경매", "🍀 복권");
  baseLabels.push("🎯 목표", "🛒마트", "🏷️ 경매", "🍀 복권");
  const extras = [];
  const addExtra = (label, key) => {
    if (baseLabels.includes(label)) return;
    if (extras.some(([, k]) => k === key)) return;
    extras.push([`⍟${label}`, key]);
  };
  const adminFeat = (t) => perms.has(`admin::${t}`);
  if (adminFeat("🏦 내 통장")) addExtra("💰입금/출금(관리자)", "admin::🏦 내 통장");
  if (adminFeat("🏦 은행(적금)")) addExtra("🏦 은행(적금)(관리자)", "admin::🏦 은행(적금)");
  if (invOk && adminFeat("📈 투자")) addExtra("📈 투자(관리자)", "admin::📈 투자");
  if (adminFeat("🛒마트")) addExtra("🛒마트(관리자)", "admin::🛒마트");
  for (const t of ALL_TABS) {
    if (t === "⭐ 권한부여" || t === "👥 계정 정보") continue;
    if (STUDENT_DEFAULT.includes(t)) continue;
    if (tabVisibleStudent(perms, t)) addExtra(t, t);
  }
  if (perms.has("tab::⭐ 권한부여")) addExtra("⭐ 권한부여", "⭐ 권한부여");
  const mi = extras.findIndex(([, k]) => k === "admin::🛒마트");
  if (mi >= 0) extras.push(extras.splice(mi, 1)[0]);
  const keys = [...baseKeys, ...extras.map(([, k]) => k)];
  const labels = {};
  baseKeys.forEach((k, i) => (labels[k] = baseLabels[i]));
  extras.forEach(([l, k]) => (labels[k] = l));
  return { keys, labels };
}

function LoginForm({ onLogin }) {
  const saved = useMemo(() => remember.read(), []);
  const [name, setName] = useState(saved.name);
  const [pin, setPin] = useState(saved.pin);
  const [rn, setRn] = useState(saved.rememberName);
  const [rp, setRp] = useState(saved.rememberPin);
  const [err, setErr] = useState("");
  const submit = async () => {
    setErr("");
    const n = name.trim();
    const p = pin.trim();
    if (!n) return setErr("이름을 입력해 주세요.");
    const r = await api("login", { name: n, pin: p });
    if (!r.ok) return setErr(r.error || "로그인 실패");
    remember.write({ name: n, pin: p, rememberName: rn, rememberPin: rp });
    onLogin(r.token, r.user.role === "admin" ? ["관리자 모드 ON", "🔓"] : ["로그인 완료!", "✅"]);
  };
  return (
    <div className="stack">
      <Cols w={[1, 1]}>
        <TextInput label="이름" value={name} onChange={setName} onEnter={submit} autoComplete="username" />
        <TextInput label="비밀번호" type="password" value={pin} onChange={setPin} onEnter={submit} autoComplete="current-password" />
      </Cols>
      <Cols w={[1, 1]}>
        <Checkbox label="아이디 기억하기" checked={rn} onChange={setRn} />
        <Checkbox label="비밀번호 기억하기" checked={rp} onChange={setRp} />
      </Cols>
      <Btn onClick={submit}>로그인</Btn>
      <ErrorBox>{err}</ErrorBox>
    </div>
  );
}

function TabContent({ tab, user }) {
  const isAdmin = user.role === "admin";
  switch (tab) {
    case "🏦 내 통장":
      return isAdmin ? <BankAdmin /> : <BankStudent />;
    case "admin::🏦 내 통장":
      return <BankAdmin />;
    case "🔎 개별조회":
      return <Individual />;
    case "💼 직업/월급":
      return <Jobs />;
    case "🏛️ 국세청(국고)":
      return <Treasury />;
    case "📊 통계청":
      return <Stats />;
    case "💳 신용등급":
      return <Credit />;
    case "🏦 은행(적금)":
      return <Savings adminMode={isAdmin} />;
    case "admin::🏦 은행(적금)":
      return <Savings adminMode />;
    case "📈 투자":
      return <Invest adminMode={isAdmin} />;
    case "admin::📈 투자":
      return <Invest adminMode />;
    case "⭐ 권한부여":
      return <Permissions />;
    case "👥 계정 정보":
      return <Accounts />;
    case "🛒마트":
      return isAdmin ? <MartAdmin /> : <MartUser />;
    case "admin::🛒마트":
      return <MartAdmin />;
    case "🏷️ 경매":
      return <Auction />;
    case "🍀 복권":
      return <Lottery />;
    case "🧾 로그기록":
      return <Logs />;
    case "📊 통계/신용":
      return <UserStatsCredit />;
    case "🎯 목표":
      return <Goal />;
    default:
      return <Info>준비 중입니다.</Info>;
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [sbOpen, setSbOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [ver, setVer] = useState(0);
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);
  const tid = useRef(0);

  useEffect(() => onBusy(setBusy), []);

  const toast = useCallback((msg, icon = "✅") => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, msg, icon }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const loadSession = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return null;
    }
    const r = await api("session");
    if (r.ok && r.user) {
      setUser(r.user);
      return r.user;
    }
    if (r.ok && !r.user) {
      setToken("");
      setUser(null);
    }
    return null;
  }, []);

  useEffect(() => {
    (async () => {
      await loadSession();
      setBooting(false);
    })();
  }, [loadSession]);

  // 권한이 바뀌면 바로 반영되도록(기존 앱처럼) 화면이 바뀔 때마다 권한 다시 확인
  const refresh = useCallback(() => {
    setVer((v) => v + 1);
    loadSession();
  }, [loadSession]);

  const tabs = useMemo(() => buildTabs(user), [user]);
  const prefetched = useRef("");
  useEffect(() => {
    if (!user) return;
    const who = `${user.role}:${user.sid || ""}`;
    if (prefetched.current === who) return;
    prefetched.current = who;
    const admin = user.role === "admin";
    const list = [];
    if (!admin) list.push(["user_header", {}]);
    for (const k of tabs.keys) list.push(...((TAB_LOADS[k] && TAB_LOADS[k](admin)) || []));
    prefetch(list);
  }, [user, tabs]);
  useEffect(() => {
    if (!user) return;
    if (!active || !tabs.keys.includes(active)) setActive(tabs.keys[0] || null);
  }, [user, tabs, active]);

  const onLogin = async (token, [msg, icon]) => {
    clearLoadCache();
    prefetched.current = "";
    setToken(token);
    setActive(null);
    await loadSession();
    toast(msg, icon);
  };

  const logout = () => {
    clearLoadCache();
    prefetched.current = "";
    setToken("");
    setUser(null);
    setActive(null);
  };

  const ctx = useMemo(() => ({ user, toast, refresh, ver }), [user, toast, refresh, ver]);

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        {busy ? <div className="top-loading" /> : null}
        <button className="sb-toggle" type="button" onClick={() => setSbOpen(true)} aria-label="사이드바 열기">
          ☰
        </button>
        <Sidebar open={sbOpen} onClose={() => setSbOpen(false)} />
        <main className="main">
          <div className="stack">
            <div className="app-title"> {APP_TITLE}</div>
            {booting ? (
              <Loading />
            ) : (
              <>
                <Subheader>{user ? `🔐 로그인(${user.name})` : "🔐 로그인"}</Subheader>
                {!user ? (
                  <LoginForm onLogin={onLogin} />
                ) : (
                  <>
                    <Btn onClick={logout}>로그아웃</Btn>
                    {user.role === "student" ? <UserHeader /> : null}
                    <div className="main-menu" role="radiogroup" aria-label="메인 메뉴">
                      {tabs.keys.map((k) => (
                        <div
                          key={k}
                          className={`mm ${k === active ? "on" : ""}`}
                          onClick={() => {
                            if (k !== active) setActive(k);
                          }}
                        >
                          <span>{tabs.labels[k] || k}</span>
                        </div>
                      ))}
                    </div>
                    <hr className="menu-hr" />
                    {active ? (
                      <div className="stack" key={active}>
                        <TabContent tab={active} user={user} />
                      </div>
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>
        </main>
        <Toasts items={toasts} />
      </div>
    </AppCtx.Provider>
  );
}

export { useLoad };
