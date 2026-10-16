// 모든 API 동작 등록
import session from "./session.js";
import bank from "./bank.js";
import individual from "./individual.js";
import invest from "./invest.js";
import permissions from "./permissions.js";
import jobs from "./jobs.js";
import treasuryStats from "./treasury_stats.js";
import savings from "./savings.js";
import mart from "./mart.js";
import auction from "./auction.js";
import lottery from "./lottery.js";
import user from "./user.js";
import reorder from "./reorder.js";
import logundo from "./logundo.js";

export const ACTIONS = {
  ...session, ...bank, ...individual, ...invest, ...permissions, ...jobs, ...treasuryStats,
  ...savings, ...mart, ...auction, ...lottery, ...user, ...reorder, ...logundo,
};
