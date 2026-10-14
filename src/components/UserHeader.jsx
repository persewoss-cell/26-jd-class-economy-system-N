// 학생 모드: 탭 위 통장/정보 요약 (_render_user_bank_header)
import React from "react";
import { useApp, useLoad, Btn } from "./ui.jsx";

export default function UserHeader({ onLogout, onPin }) {
  const app = useApp();
  const { data } = useLoad("user_header", {}, [app.ver]);
  const h = data && data.header;
  if (!h) return null;
  const items = [
    ["💰", "통장 잔액", `${h.balance} 드림`, "c-mint"],
    ["🐷", "적금 총액", `${h.savings_total} 드림`, "c-pink"],
    ["🪙", "투자 원금", `${h.inv_principal_total} 드림`, "c-yellow", h.inv_principal_text],
    ["📈", "현재 평가", `${h.inv_eval_total} 드림`, "c-blue", h.inv_eval_text],
    ["💼", "직업", h.role_name || "없음", "c-lav"],
    ["💳", "신용도", `${h.credit_grade}등급 (${h.credit_score}점)`, "c-peach"],
  ];
  return (
    <div className="summary">
      <div className="sum-main">
        <div className="sum-actions">
          <Btn full={false} className="ghost" onClick={onPin}>
            🔑 비밀번호 변경
          </Btn>
          <Btn full={false} className="ghost" onClick={onLogout}>
            로그아웃
          </Btn>
        </div>
        <div className="sum-name">{app.user && app.user.name}</div>
        <div className="sum-label">🧮 총 자산</div>
        <div className="sum-value">
          {h.asset_total}
          <small> 드림</small>
        </div>
      </div>
      <div className="sum-grid">
        {items.map(([ic, label, value, c, sub]) => (
          <div className={`sum-item ${c}`} key={label}>
            <span className="sum-ic">{ic}</span>
            <div className="sum-txt">
              <div className="sum-k">{label}</div>
              <div className="sum-v">{value}</div>
              {sub ? <div className="sum-sub">{sub}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
