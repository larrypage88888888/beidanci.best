# 背单词 App 技术方案与架构设计

> 版本：v0.2（方案讨论稿，未实现）
> 变更：后端确定采用 **Cloudflare Workers 全家桶**，改为**后端权威调度**；新增**艾宾浩斯曲线记忆法**（与 FSRS 并列的可切换双调度模式）。
> 目标：跨平台（手机/电脑）、按用户水平动态选词、趣味化背单词

---

## 一、需求拆解

| 产品需求 | 技术含义 |
|---|---|
| 手机 / 电脑都能用 | 一套代码跨端 → **PWA 优先**，后期可 Capacitor 打包上架 |
| 根据水平动态选词库 | 能力测评 + 统一难度轴 + 自适应推荐算法 |
| 有趣的方式背单词 | 多题型轮换 + 游戏化激励 + AI 趣味内容 |
| 有后端 | 云端权威调度与数据，账号体系从第一天就有 |
| 艾宾浩斯曲线记忆法 | 固定复习节点的调度模式（详见 §4，与 FSRS 双模式并存） |

---

## 二、总体架构：Cloudflare 单云全家桶

```
┌─ 客户端 PWA（React + TS）─ apps/web ─────────────┐
│  响应式 UI（手机竖屏 / 桌面宽屏）＋ 题型工厂 ＋ 动效   │
│  引入 @app/core（与服务端同一份调度引擎）            │
│   → 答题后本地乐观预计算下一张卡，请求异步确认        │
│  Cache Storage：词库包 + 今日队列缓存（弱网兜底）     │
└───────────────┬─────────────────────────────────┘
        HTTPS(JSON) / WebSocket
┌───────────────▼─────────────────────────────────┐
│  Cloudflare Workers（apps/server · Hono 框架）    │
│  ├─ REST API：auth / 组单 / 复习回写 / 排行榜       │
│  ├─ 调度服务：艾宾浩斯 ⇄ FSRS 权威计算              │
│  ├─ Durable Objects：PvP 对战房间、排行榜实时聚合    │
│  ├─ Cron Triggers：每日计划物化、streak 提醒推送     │
│  └─ Workers AI / 外部 LLM：谐音梗、词根故事、例句生成 │
├────────────┬──────────────┬─────────────────────┤
│ D1(SQLite)  │ KV(词库包/LLM  │ R2 对象存储(发音mp3/  │
│ 用户·状态·日志│ 结果缓存)      │ 插图) + CDN 分发      │
└────────────┴──────────────┴─────────────────────┘
```

### Cloudflare 各服务职责映射

| 能力 | 服务 | 说明 |
|---|---|---|
| API 计算 | Workers + Hono | 轻量 TS 框架，为边缘运行时而生 |
| 关系数据 | D1（Serverless SQLite） | 用户/记忆状态/复习日志，配 Drizzle ORM 做迁移 |
| 缓存/分发 | KV | 词库版本包、AI 生成结果缓存（热门词零重复生成） |
| 对象存储 | R2 | 音频、插图，零出口流量费，配 CDN |
| 强一致/长连接 | Durable Objects | WebSocket 对战房间、原子化 streak/排行榜计数 |
| 定时任务 | Cron Triggers | 每日学习计划预物化、到期提醒推送 |
| AI | Workers AI（免费额度）或外部 LLM API | 趣味内容生成 |
| 前端托管 | Workers Static Assets | 与 API 同仓库一条 `wrangler deploy` 一起发 |

### 关键架构决策

1. **后端权威调度**：所有到期计算、每日组单、难度升降级都在 Worker 完成，客户端只是展示层 + 乐观预渲染（共享同一份核心代码保证两端结果一致）。好处：算法可随时热修、多端天然同步、排位赛结果可信（防作弊）。
2. **共享核心包（monorepo）**：调度引擎、难度轴、题型工厂抽成 `@app/core`，web 与 server 都 import 它——一套算法两处复用，测试只写一份。
3. **单云部署**：计算/数据库/存储/CDN 全在一个平台，免费额度覆盖个人到中小规模产品，一条命令部署全栈。
4. **弱网策略降级为「今日缓存」**：既然以后端为准，离线不再做完整本地调度，只缓存当天已下发的队列供断网继续作答，恢复后批量回传。

### Monorepo 结构

```
/apps/web        React + Vite PWA（前端）
/apps/server     Hono Worker（API + 调度 + Cron）
/packages/core   FSRS + 艾宾浩斯 + 难度轴 + 组单算法（共享 TS）
/packages/db     Drizzle schema + 迁移（D1）
pnpm workspace；wrangler 部署
```

---

## 三、技术栈明细

### 前端
| 类别 | 选型 | 理由 |
|---|---|---|
| 框架 | React 18 + TypeScript + Vite | 生态最大、查资料容易、构建快 |
| 状态 | Zustand | 学习会话状态机够用 |
| UI | Tailwind CSS + shadcn/ui | 快速出响应式界面 |
| 动效 | framer-motion | 手势、翻卡、连击动画 |
| PWA | vite-plugin-pwa（Workbox） | 今日队列缓存、添加到主屏幕 |
| 音频 | howler.js | 单词发音播放 |

### 后端（Cloudflare 技术栈）
| 类别 | 选型 |
|---|---|
| 运行时 | Cloudflare Workers |
| 框架 | Hono（路由 / 中间件 / zod 校验） |
| ORM | Drizzle + D1（SQLite） |
| 认证 | JWT(HS256, Web Crypto) 或 D1 session 表；后续可加微信 / Apple OAuth |
| 实时 | Durable Objects（WebSocket hibernation API） |
| AI | Workers AI 起步，量大换外部 LLM API |

### 分发
- Web/PWA 直接访问；
- 上应用商店或要可靠推送时，用 **Capacitor** 打同一份代码（解决 iOS 对 Web Push 的限制）。

### 词库数据源
- [ECDICT](https://github.com/skywind3000/ECDICT)（MIT 开源英汉词典数据库）打底；
- 叠加词频表 + CEFR 等级标注 + 各考试词书映射（中考/高考/四六级/考研/雅思/托福）；
- 「归一化管道」给所有词统一打难度分（见 §4），产物为带版本静态 JSON 包 → KV/R2 下发。

---

## 四、「动态选词」+「双调度模式」核心算法设计

### 1. 统一难度轴
所有词书的单词映射到同一把尺子：
`difficulty ∈ [0,100]`，参考维度 = CEFR 等级 + 词频排名 + 词长/构词复杂度。

### 2. 水平定位（冷启动）
首次使用做约 20 题**自适应摸底测试**（服务端出题）：答对升难度、答错降难度，二分收敛，
输出预估词汇量 + 初始等级。全程 2 分钟以内，做完立刻能学。

### 3. 双调度模式（本次新增：艾宾浩斯）

两个调度器实现同一接口 `schedule(state, rating, now) → next_due / stage 变迁`，用户可在设置中切换：

**模式 A · 艾宾浩斯经典（默认，简单可解释）**

固定复习节点序列：

```
第0级 5分钟 → 第1级 30分钟 → 第2级 12小时 → 第3级 1天 → 第4级 2天
→ 第5级 4天 → 第6级 7天 → 第7级 15天 → 第8级 30天 → 毕业
```

- 作答反馈映射：**忘记 → 回到第0级重来**；**模糊 → 停留本级重考**；**记得 → 晋升下一级**
- 天然产生"碎片微会话"节奏：学一组新词 → 5 分钟后快闪一轮 → 当晚再闪 → 次日……
  （Cron 到点提醒："你的 30 个词正在等第 3 轮快闪 ⚡"）
- 规则透明可展示（"这个词已升到 7 天档！"），等级本身就是游戏化进度条

**模式 B · FSRS 智能（进阶可选）**
每词维护 `stability / difficulty / due_at`，按个人遗忘曲线自适应间隔，越用越准。

**模式关系**：默认艾宾浩斯起步（规则透明、仪式感强）；`review_logs` 积累足够数据后，
App 提示可切换智能模式，并支持对比两种模式的预测留存率。

### 4. 每日动态组单（服务端）
每天的学习队列 =
**新词池**（难度 ≈ 当前水平 ± 半档，按兴趣主题加权，控制新词数）
＋ **到期复习词**（艾宾浩斯当日到期档 ∪ FSRS due）。
连续答对自动上调难度档；频繁遗忘自动下调并加密复习。
**词库不是固定的某本书，而是围绕用户实时能力浮动的一条个人化词流。**

进阶项：全量落库的 `review_logs` 可用于回归拟合每个用户的个性化 FSRS 参数。

---

## 五、趣味化玩法设计（产品层）

### 题型轮盘（防疲劳）
听音选义 / 拼写默写 / 例句挖空 / 看图猜词 / 连线消消乐随机换皮。

### 游戏化外壳三件套
连续打卡 streak + 经验等级 + 徽章成就（低成本高留存的基础盘）。

### 特色模式
- **单词 RPG**：答对 = 出招打怪，连击放大招，把每日复习包装成一局 5 分钟战斗；
- **限时排位**：90 秒冲刺赛，好友/全网排行榜（Durable Object 实时聚合），周赛季结算；
- **养成系**：答对浇水，养一棵「词树」（Forest 机制迁移到词汇场景）；
- **快闪闪电战（艾宾浩斯专属玩法）**：利用 5 分钟 / 30 分钟微复习节点做 60 秒限时小关卡，
  把"该复习了"变成"来一把快闪"。

### AI 趣味内容（Workers AI 或外部 LLM）
一键生成谐音梗记忆 / 词根词缀故事 / 场景小剧场例句；结果按词缓存在 KV 全局复用，控制成本。

### 社交钩子
好友 PK、组队打卡、分享战绩卡片（自带传播）。

---

## 六、核心数据模型（D1）

```
words(id, text, phonetic, definitions[], audio_url, difficulty,
      cefr, frequency_rank, tags[])
wordbooks(id, name, level_tag, version)
users(id, email/nickname, level, goal_book_id, daily_new_limit,
      schedule_mode DEFAULT 'ebbinghaus', settings)

user_word_states(            -- 服务端权威，客户端乐观镜像
  user_id, word_id,
  stage INT NULL,            -- 艾宾浩斯：当前级别 0..8，毕业=9
  stability REAL NULL,       -- FSRS 模式专用
  difficulty REAL NULL,      -- FSRS 模式专用
  due_at, reps, lapses, last_review_at)

review_logs(                 -- 只追加事件日志，算法调优原料
  id, user_id, word_id, rating, latency_ms, reviewed_at)

daily_plans(user_id, date, new_word_ids[], review_word_ids[])  -- Cron 预物化
daily_stats(date, new_learned, reviewed, correct_rate, streak)
achievements(user_id, badge_key, unlocked_at)
battle_rooms(id, mode, players[], state, ended_at)   -- 若做对战
```

### 主要 API 面（Hono REST）

```
POST /api/auth/*             注册/登录/JWT 刷新
GET  /api/me                 用户水平、模式、目标词书
POST /api/placement          摸底测试出题/提交（服务端自适应选题）
GET  /api/today              取今日队列（读 daily_plans，未物化则现算）
POST /api/reviews            批量回写作答 → 返回权威调度结果
GET  /api/wordbooks          词书列表 /api/wordpack/:book/:version 词条包
WS   /ws/battle/:room        Durable Object 对战通道
```

---

## 七、里程碑规划

| 阶段 | 内容 | 预估 |
|---|---|---|
| M0 MVP | monorepo 脚手架 + wrangler 部署打通；JWT 注册登录；词库管道 v0（先做一本书）；placement 摸底；today/reviews API；前端 3 种题型闭环；**艾宾浩斯调度上线**；streak 打卡 | ~3 周 |
| M1 | FSRS 智能模式 + 双模切换；R2 发音音频；AI 例句（KV 缓存）；限时排位榜（DO）；快闪闪电战 | ~2 周 |
| M2 | Capacitor 上架 iOS/Android 商店；Cron 推送提醒；个性化参数拟合；简单运营后台 | 按需 |

M0 即含账号与云端调度（应用户要求后端从第一天参与），但仍保持最小闭环。

---

## 八、主要风险与对策

| 风险 | 对策 |
|---|---|
| **Cloudflare 在中国大陆直连不稳定**（本选型最大的运维风险） | 绑定自定义域名改善解析与线路；面向海外用户无碍；若主攻国内且要求稳定，预留切换国内云（如阿里云函数计算 FC，架构同构）的预案——core/db 已抽包，迁移面收敛在后端一层 |
| iOS Web Push 受限 | M2 用 Capacitor 原生壳拿推送权限 |
| 词库版权 | 基于 ECDICT(MIT) + 开源词频表自建，避免直接扒商业词书 |
| D1 写入配额 | 本场景写入频率低（每次作答约 1 行日志），免费额度充足；历史日志可归档至 R2 |
| AI 内容成本 | KV 按词全局缓存，热门词零重复生成 |

---

## 九、待拍板的决策点

1. **首发目标人群与词书**（考研党？四六级？少儿？）→ 决定先建哪条词库管道和美术风格。
2. **要不要 PvP 实时对战**：Durable Objects 让它在 CF 上成本可控，但复杂度仍在，MVP 可先不做。
3. **是否必须上应用商店**：不必 → 纯 PWA 最省事。
4. **默认调度模式**：我建议默认艾宾浩斯、设置里可切 FSRS；想反过来也是一句话的事。

---

## 十、趣味化增强方案（v1 定稿，2026-09 讨论）

> 用户已从 A~F 六组方向中选定 **A 即时爽感 / B 损失厌恶与习惯 / C 成长感**，
> 并逐一拍板 5 个决策（§10.1）。本节为定稿需求清单，落地顺序见 §10.8。

### 10.1 定稿决策表

| # | 决策 | 结论 |
|---|---|---|
| 1 | 断签宽恕 | **48 小时宽限救活**（复活卡或"学 5 词"） |
| 2 | 抽卡重复词 | **自动转词力积分**（可兑换限定装饰/额外抽卡） |
| 3 | 段位激励 | **段位解锁高阶 CEFR 词库**（黄金→B2、词霸→C1 等） |
| 4 | 周报分享图 | **前端 canvas 生成**（服务端零负担） |
| 5 | P0 范围 | **连击动画 + 词苗养成 + 词卡抽卡三件一起做**（共用会话结束页） |

### 10.2 P0 详细规格

**A1 连击动画**（纯前端，S）
- 连击数字放大跳动；5 连起冒火、10 连换色、50 连全屏特效（CSS 过渡，M1 换 framer-motion）。
- 音效用 WebAudio 合成（正确/错误短音），零资源依赖 R2。
- 反馈文案池随机："稳了 / 离谱 / 词霸附体"。
- 断连不扣已得 XP；连击按**会话内**计数，并记录**当日最高连击**（供周报/成就使用）。
- 规则函数入 `@app/core`（纯函数可单测）。

**B5 词苗养成**（前后端，M）
- 把 streak 可视化为 词苗→小树→大树→开花结果（0-2 天 / 3-6 / 7-13 / 14+）。
- 断签进入"枯萎"状态：**48 小时内**可用复活卡或"学 5 个词"救活；超时未救活则重置为 0 天（历史成就/树龄保留展示）。
- 全勤节点（7/30/100 天）发限定装饰，接住现有 streak_3/streak_7 徽章。
- 新表 `user_pet(user_id, stage, last_water_at, revive_deadline, tree_age_days)`。

**A2 词卡抽卡**（前后端，M）
- 每天首次学满 15 词 → 抽 1 张（从当天学过的词里抽）；当日连击≥10 额外 +1 次。
- 稀有度：SSR 20% / UR 5%（随机）；卡面 = 词 + 渐变 + 一句话词源（AI 生成，KV 缓存复用）。
- 抽到已收藏词 → 自动转词力积分；积分可兑换限定装饰/额外抽卡次数。
- 图鉴收集进度 = 已收藏词 / 词库总数。
- 新表 `user_cards(user_id, word_id, rarity, obtained_at)`、`user_points(user_id, balance)`。

### 10.3 P1 规格（成长感）

**C10 段位系统**（前后端，M）
- 段位 = 词汇量估算 + 近 7 天正确率 + 活跃天数 → 青铜/白银/黄金/铂金/钻石/词霸。
- 每月 1 号结算；保留"历史最高段位"防落差打击。
- **段位解锁更高难度 CEFR 词包**（与动态选词闭环）。
- 新表 `user_season_rank(user_id, season, tier, score)`。

**C9 词根技能树**（前后端，M）
- 种子词库提取 ~15 常用词根/词缀：学到含该词根的词 → 点亮节点，显示"已掌握 xx 家族 n/m 个"，未解锁灰显。
- 前端 SVG/CSS 网络图（零依赖）；词根表先内置示例，M1 接全量开源词根表。
- 新表 `word_roots(root, affix_type, meaning)`、`word_root_map(word_id, root)`。

### 10.4 P2 规格（习惯层）

- **C11 词力周报**：每周一 Cron 生成（新词数、复习准确率、最长连击、最强词根、周词力分=Σ 稳定度提升）；分享图前端 canvas。
- **B8 智能提醒**：Cron 按用户活跃时段推送"今日词就绪 / 复习堆积快闪"；PWA Web Push（SW 订阅 + 授权引导），iOS 待 M2 Capacitor。
- **B6 复活卡**：获取=分享/额外 5 词/节日；持有上限 3；新表 `user_inventory(user_id, item_type, count)`。
- **B7 每日低保**：连续 7 天全勤给大奖；漏签只断"全勤链"不惩罚。

### 10.5 P3 规格（内容层）

- **A3 BOSS 战**：每周 BOSS = 1 高难词 + 5 易错词，90 秒限时关卡；解锁需相关词复习到 stage≥3；击杀得专属徽章 + 双倍 XP。新表 `boss_events`、`user_boss_progress`。单人离线可玩（无需 DO）。
- **A4 AI 情绪化反馈**：作答后 ≤12 字短评，规则模板池 + AI 预生成池（按 rating×难度批量生成，KV 缓存随机取）。

### 10.6 新增数据模型汇总

```
user_pet(user_id PK, stage, last_water_at, revive_deadline, tree_age_days)
user_cards(user_id, word_id, rarity, obtained_at, PK(user_id, word_id))
user_points(user_id PK, balance)
user_season_rank(user_id, season, tier, score, PK(user_id, season))
word_roots(root PK, affix_type, meaning)
word_root_map(word_id, root, PK(word_id, root))
user_inventory(user_id, item_type, count, PK(user_id, item_type))
boss_events(week_id PK, word_ids[], started_at, ended_at)
user_boss_progress(user_id, week_id, hp, done, PK(user_id, week_id))
weekly_reports(user_id, week, json, PK(user_id, week))   -- 或按需现算
```

### 10.7 API 影响

```
POST /api/reviews  响应扩展：combo/当日最高连击、词苗状态、抽卡资格与抽卡结果（含转积分）
GET  /api/me       扩展：词苗、段位、词力积分、收藏数
POST /api/cards/draw         每日抽卡（校验资格）
GET  /api/cards/collection   图鉴
POST /api/revive             救活词苗（扣复活卡或完成学5词）
GET  /api/rank/current       段位与赛季进度
GET  /api/roots              词根树（含用户点亮状态）
GET  /api/report/weekly      周报数据
GET  /api/boss/current       本周 BOSS 关卡（P3）
Cron：+3（每日提醒 / 周一周报 / 月初段位与 BOSS 结算）
```

### 10.8 里程碑增补

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** | A1 连击动画 + B5 词苗养成（48h 救活）+ A2 词卡抽卡（含转积分）——共用"会话结束页" | ✅ 已实现（2026-09-14，迁移 0006） |
| **P1** | C10 段位（解锁高阶词库）+ C9 词根技能树（15 词根示例） | ✅ 已实现（2026-09-15，迁移 0007/0008，含 CET-6 进阶词书种子） |
| **P1.5** | ⚔️ 卡牌对战 PVE（用户新增）：词灵 BOSS 战，答题出招/连击增伤/答错反击，胜得积分+限定卡+抽卡加成；预留 PVP mode | ✅ 已实现（2026-09-15，迁移 0009，`/api/battle/*`） |
| **P2** | C11 词力周报 + B8 智能提醒 + B6 复活卡 + B7 每日低保 | 待做 |
| **P3** | A3 BOSS 战 + A4 AI 情绪化反馈 | 待做 |

> 全部可长在现有 monorepo 上：core 加纯函数规则（可单测）、server 加路由/表/Cron、web 加组件；
> AI 仅 P3 使用（Workers AI + KV 缓存控成本）；不推翻任何既有机制。
