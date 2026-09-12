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
