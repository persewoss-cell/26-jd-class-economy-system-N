// 학생 모드: 탭 위 통장/정보 요약 (_render_user_bank_header)
import React from "react";
import { useApp, useLoad } from "./ui.jsx";

export default function UserHeader() {
  const app = useApp();
  const { data } = useLoad("user_header", {}, [app.ver]);
  const h = data && data.header;
  if (!h) return null;
  return (
    <div>
      <div className="h3">🧮 총 자산: {h.asset_total} 드림</div>
      <div className="bank-info-wrap">
        <div className="bank-info-line">💰 통장 잔액: {h.balance} 드림</div>
        <div className="bank-info-line">🏦 적금 총액: {h.savings_total} 드림</div>
        <div className="bank-info-line">🪙 투자 원금: 총 {h.inv_principal_total} 드림({h.inv_principal_text})</div>
        <div className="bank-info-line">📈 현재 평가: 총 {h.inv_eval_total} 드림({h.inv_eval_text})</div>
        <div className="bank-info-line">💼 직업: {h.role_name || "없음"}</div>
        <div className="bank-info-line">💳 신용도: {h.credit_grade}등급({h.credit_score}점)</div>
      </div>
    </div>
  );
}
