# 词流 WordFlow · 背单词 App

> 按《背单词App架构设计.md》实现的 **M0 MVP**。
> Cloudflare Workers 全家桶（Hono + D1 + KV + Cron）· React PWA · 共享核心算法 monorepo。

## 功能总览（M0 已实现）

| 模块 | 说明 |
|---|---|
| 🌱 艾宾浩斯调度 | 固定节点 5min→30min→12h→1d→…→30d→毕业；忘记回0级 / 模糊原地重考 / 记得升级 |
| 🧠 FSRS-lite | 双模式可切换（设置页），切换时历史进度近似迁移不丢失 |
| 📏 统一难度轴 | CEFR(60%) + 词频(25%) + 构词(15%) → difficulty∈[0,100]，懒计算写回 |
| 🎯 自适应摸底 | 服务端出题、签名会话无状态扩展；≤20 题二分收敛出词汇量+等级 |
| 📋 每日动态组单 | 新词池(水平±半档) ∪ 到期复习词，复习热身+穿插；Cron 每日预物化 |
| 🔁 权威回写 | POST /reviews 批量调度，乐观镜像被服务端结果校正 |
| ❓ 三种题型 | 看词选义 / 看义选词 / 拼写默写（共享 @app/core 本地确定性出题） |
| ⚔️ 卡牌对战 | 炉石式词灵对决：对手每回合打出一张词灵随从，答题破解——答对召唤手牌词卡出招（ATK+连击），答错被随从反击；英雄生命/法力水晶/手牌费用/词根技能，胜得积分+限定随从卡+抽卡次数 |
| 🔥 游戏化 | streak 连续打卡、经验等级、徽章（first_review/streak_3/streak_7） |
| 🔐 账号 | JWT(HS256, Web Crypto) + PBKDF2 密码哈希 |
| 📱 PWA | 可安装、离线壳缓存（vite-plugin-pwa） |

## 目录结构

```
apps/
  web/        React 19 + Vite 8 + Tailwind v4 PWA（题型组件/页面/Zustand stores）
  server/     Hono Worker（REST API + Cron 物化 + 种子脚本）
packages/
  core/       共享算法：调度器/难度轴/摸底/组单/题型工厂（web 与 server 同源）
  db/         Drizzle schema + D1 迁移 SQL
```

## 快速开始（本地）

```bash
pnpm install

# 1) 初始化本地 D1 并灌入 CET-4 百词种子
pnpm --filter @app/server db:migrate:local
pnpm --filter @app/server gen:seed        # 重新生成种子 SQL（已提交可跳过）
pnpm --filter @app/server db:seed:local

# 2) 启动后端（默认 8799 端口，避开常用 8787）
pnpm dev:server          # 需要 apps/server/.dev.vars（参考 .dev.vars.example）

# 3) 另开终端启动前端（Vite 代理 /api -> 8799）
pnpm dev:web             # http://localhost:5173
```

注册账号 → 自动进入摸底（约 2 分钟）→ 开始今日学习。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm test` | core 单元测试（94 个用例：调度/迁移/组单/题型边界/连击/词苗/抽卡/段位/对战） |
| `pnpm typecheck` | 全仓 TS 类型检查 |
| `pnpm build` | 全仓构建 |
| `pnpm --filter @app/web build` | 前端生产构建（含 SW 生成） |

### E2E 测试脚本（apps/server/scripts/）

| 脚本 | 覆盖 |
|---|---|
| `node scripts/e2e-smoke.mjs [origin]` | 注册→登录→摸底→今日队列→批动作答→streak/徽章（12 步） |
| `node scripts/e2e-review-loop.mjs [origin]` | 艾宾浩斯复习闭环：到期回归→快闪轮→级别晋升（8 步） |
| `node scripts/e2e-modes.mjs [origin]` | FSRS↔艾宾浩斯模式切换进度迁移 + 每日新词配额（12 步） |
| `node scripts/e2e-gamification.mjs [origin]` | P0 趣味化：连击纪录/词苗建卡/抽卡资格/图鉴/积分（12 步） |
| `node scripts/e2e-p1.mjs [origin]` | P1 成长感：段位结算/词书解锁门槛/词根树点亮/切词书（21 步） |
| `node scripts/e2e-battle.mjs [origin]` | 炉石式卡牌对战：词灵列表/发手牌/全对 WIN（限定卡）/每日 409/全错 LOSE（19 步） |
| `node scripts/e2e-settings.mjs [origin]` | 设置：每日新词上限修改当日立即生效（默认 10 → 5 → 30 → 10，10 步） |
| `node scripts/e2e-redo.mjs [origin]` | 重做今日单词：完成后可再次进入做题（今日已学词转复习队列，12 步） |
| `node scripts/e2e-bughunt.mjs [origin]` | 深度 Bug Hunt（本地，需 DEV_MODE）：快闪复习→毕业循环/降级恢复/词苗同日计龄/FSRS 切换/边界输入/重复词提交计数（26 步） |
| `node scripts/check-new-word-dist.mjs [origin]` | 新词首字母分布检查：连续注册 5 用户拉取今日新词，验证首字母分散（修复 a 打头扎堆） |
| `node scripts/verify-tz-fix.mjs [origin]` | 北京时区日期键验证：today.date=北京日期 + 上限 2 当天出 2 个新词（修复清晨无新词） |
| `node scripts/e2e-reset.mjs [origin]` | 一键清空记录 E2E（16 步）：重置后统计/图鉴/积分清零、词书解锁回收、今日队列重建、需重做摸底 |
| `node scripts/e2e-password-reset.mjs [origin]` | 密码重置 E2E（13 步，本地 DEV_MODE）：forgot 拿 devLink→重置→旧密码失效/新密码登录/令牌一次性/防刷/不泄露注册状态 |
| `node scripts/e2e-prod.mjs <prod-url>` | 生产冒烟：静态资产+全流程+DEV 工具已禁用（11 步） |

> 本地脚本默认走 Vite 代理 `http://localhost:5173`；生产验证需代理环境时先设
> `$env:HTTPS_PROXY / NODE_USE_ENV_PROXY=1`。

## API 一览

```
POST /api/auth/register | login     注册/登录 → JWT
GET  /api/me                        资料 + streak + 到期数 + 词苗/积分/图鉴/抽卡资格 + 段位概览
PATCH /api/me                       昵称/每日新词数/调度模式/目标词书（词书需段位解锁）；改新词上限当日立即生效（作废今日已物化计划）
POST /api/placement/start           开始摸底
POST /api/placement/answer          提交摸底作答 → 下一题或最终结果
GET  /api/today                     今日队列（未物化则现算落库）
POST /api/reviews                   批量权威回写 → 调度结果/streak/徽章/词苗/抽卡资格（含 maxCombo）
GET  /api/cards/collection          词卡图鉴 + 词力积分 + 今日抽卡资格
POST /api/cards/draw                抽词卡（重复自动转积分）
GET  /api/rank/current              段位与赛季进度（词汇量+7天正确率+活跃天数 → 青铜~词霸）
GET  /api/roots                     词根技能树（15 词根，家族词点亮状态）
GET  /api/today                    今日学习队列（?mode=redo 重做今日已学词，完成后可再次进入）
GET  /api/battle/bosses             词灵 BOSS 列表（英雄 30/35/40）+ 今日首胜状态
POST /api/battle/start              开战（无限挑战，不限次数；生成 10 题 + 随机发 5 张手牌）
POST /api/battle/answer             逐题作答（答对召唤手牌随从出招/答错被反击，服务端权威判定，自动结算）
POST /api/battle/abandon            中途退出（无限挑战，随时可重开），不结算奖励
GET  /api/wordbooks                 词书列表（含段位解锁状态 locked/minTier）
GET  /api/wordpack/:book/:version   词条包（KV 缓存 1h）
GET  /api/health                    健康检查
Cron UTC16:30                       每日计划预物化
Cron UTC00:30 每月1号                段位月度结算落库 + 历史最高刷新
```

## 趣味化玩法（P0，设计文档 §十）

| 功能 | 规则 |
|---|---|
| 🔥 连击 | 答对 +1 / 答错归零；5 连击火苗、10 连击电光、50 连击传说；当日最高连击 ≥10 → 抽卡 +1 次 |
| 🌱 词苗养成 | 树龄 = 有学习活动的累计天数；0-2 词苗 / 3-6 小树 / 7-13 大树 / 14+ 开花 |
| 🌧️ 断签救活 | 断签进入枯萎，48 小时内学满 5 词自动救活，或消耗复活卡（首次建苗赠送 1 张）；超期硬重置 |
| 🎴 词卡抽卡 | 当日累计作答 ≥15 词 → 抽 1 次（从当天学过的词里抽）；SR/SSR/UR 稀有度；重复自动转词力积分 |
| ✨ 词力积分 | 重复词卡转换所得（SR+5 / SSR+20 / UR+50），后续兑换装饰 |

## 成长感（P1，设计文档 §10.3）

| 功能 | 规则 |
|---|---|
| ⭐ 段位系统 | 评分 = 词汇量(log)45 + 近7天正确率25 + 活跃天数30 → 青铜/白银/黄金/铂金/钻石/词霸；每月 1 号结算落库，保留历史最高段位 |
| 📖 词书解锁 | wordbooks.min_tier 门槛，历史最高段位达标才可选（如 CET-6 需黄金）；切换目标词书次日生效，动态选词闭环 |
| 🌳 词根技能树 | 15 个常用词根内置（bio/geo/spect/…），学到含该词根的词即点亮节点；SVG 径向网络图零依赖，"已掌握 xx 家族 n/m 个" |
| ⚔️ 卡牌对战 | 炉石式词灵对决（词根长老/拼写魔王/词汇暴君，英雄血 30/35/40）：答题出招、连击增伤、答错被随从反击；手牌=已收集词卡随机发 5 张（费用 SR1/SSR2/UR3，ATK 随难度，词根家族 +2）；**无限挑战**——每次胜利都得词力积分，每词灵每日首胜额外得主题限定随从卡 + 抽卡次数（防刷），失败 5 词力参与奖；作答计入今日进度 |

## 部署到 Cloudflare（生产）

1. `wrangler d1 create wordflow-db`、`wrangler kv namespace create CACHE`，
   把真实 id 填入 `apps/server/wrangler.jsonc`；
2. 依次执行全部迁移（0001_init → 0010_battle_hs，幂等；0002 重新生成过，
   重跑以补充词根家族词）：
   `wrangler d1 execute wordflow-db --remote --file=../../packages/db/migrations/000X_*.sql`；
3. `wrangler secret put JWT_SECRET`；
4. `pnpm --filter @app/server deploy`（静态资产可后续接入 Workers Static Assets 或 Pages）。

> 注意：本地执行迁移须 `pnpm exec wrangler …`（wrangler 不在全局 PATH）。

## 与设计文档的偏差说明

- **framer-motion / howler.js** 未接入（M1）：动效暂用 CSS 过渡，音频待 R2 接入；
- **shadcn/ui** 暂以手写 Tailwind 组件代替（M0 保持零额外依赖）；
- **FSRS 为 lite 版**：接口与艾宾浩斯一致，M1 换完整 FSRS 内核即可，上层无感；
- 时区暂按 UTC 归组「今天」，多时区支持列入 M2。

## 已知坑

- **本地 D1 被重置/换库 → 「账号消失、同邮箱能重复注册」**：本地模拟器按 `database_id`
  存放 SQLite 文件，ID 一变（或 `.wrangler` 被清理）就是全新空库，旧账号与进度全部"消失"，
  同邮箱自然能重新注册。**排查**：登录报「账号不存在」时先看 `GET /api/health` 的
  `dbInstance`——它是数据库实例身份标记（迁移 0005 生成），变了就说明这个环境换了库。
  **恢复**：见下方「本地数据恢复」；平时注意别随手改 `wrangler.jsonc` 的 `database_id`，
  改前先备份 `.wrangler/state/v3/d1/`。
- **workers.dev 域名在国内被墙**：本地直连会 DNS 污染超时，测试走系统代理
  （Node 加 `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY`），正式使用建议绑定自定义域名；
- **每日新词上限在「次日物化」时生效**：当天已生成的计划不会因下调 limit 而缩短。

### 本地数据恢复（线上 → 本地）

```bash
# 1) 让本地库结构与线上一致（0001~0010 都执行一遍，幂等可重复）
for f in 0001_init 0002_seed_cet4 0003_add_example_columns 0004_seed_examples 0005_app_meta 0006_gamification 0007_gamification_p1 0008_seed_cet6 0009_battle 0010_battle_hs; do
  pnpm --filter @app/server exec wrangler d1 execute wordflow-db --local --file="../../packages/db/migrations/$f.sql"
done

# 2) 导出线上数据（仅数据，不含 schema）
pnpm --filter @app/server exec wrangler d1 export wordflow-db --remote --no-schema --output .probe/remote-dump.sql

# 3) 只导回用户数据表（words/wordbooks/app_meta 已由迁移种子覆盖，跳过避免主键冲突）
Get-Content .probe/remote-dump.sql | Select-String -Pattern '^INSERT INTO (users|user_word_states|review_logs|daily_stats|daily_plans|achievements)\b' | ForEach-Object Line | Set-Content .probe/remote-users.sql -Encoding utf8

# 4) 导入本地并验证
pnpm --filter @app/server exec wrangler d1 execute wordflow-db --local --file=.probe/remote-users.sql
pnpm --filter @app/server exec wrangler d1 execute wordflow-db --local --command "SELECT email,nickname,level FROM users"
```

## 后续路线（对应文档里程碑）

- **M1**：完整 FSRS 对比视图 · R2 发音音频(howler) · AI 例句(KV 缓存) · DO 排位赛 · 快闪闪电战
- **M2**：Capacitor 上架 · Cron 推送提醒 · 个性化参数拟合 · 运营后台
