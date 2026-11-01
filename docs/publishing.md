# 发布清单

目标：让别人用一条命令装上这个插件，并且你之后的升级不破坏已装的用户。

> 本机网络受限（GitHub / npm registry 都不可达），所以**发布动作要在有网的环境执行**；本仓库里的构建、打包内容检查、干净 profile 安装验证都可以先在这里跑完。

---

## 0. 已定的决定

| 决定 | 结果 |
|---|---|
| 包名 | **`dsh-token-control`**（无 scope）。2026-11-01 查 `registry.npmjs.org/dsh-token-control` 返回 404，当时空闲 |
| 仓库地址 | **`https://github.com/RitvaManner/dsh-token-control`**（已写进 `package.json` 的 `repository` / `homepage` / `bugs`） |

> 仓库名与包名已统一为 `dsh-token-control`（原仓库名 `tool` 已改名，GitHub 会自动重定向旧地址）。

> 名字是先到先得：`dsh-token-monitor`、`dsh-turn-cost`、`dsh-peak-balance`、`dsh-token-hud`、`dsh-token-pulse` 都已被占用，所以本包改名。定下名字后尽快发一个 `0.1.0` 占位，比等宣传完再发更稳。

---

## 1. `package.json` 当前状态（已改好）

```jsonc
{
  "name": "dsh-token-control",
  "version": "0.1.0",
  // "private" 已删除（保留它 npm publish 会直接拒绝）
  "description": "…",
  "license": "MIT",
  // "repository" / "homepage" / "bugs" 待你给出仓库地址后补
  "keywords": ["deepseek-harness", "dsh", "dsh-plugin", "token", "cost", "peak", "balance", "cny"],
  "engines": { "node": ">=22", "dsh": ">=0.2.0" },
  "peerDependencies": { "@deepseek-ai/schemastery": "^3.18.1" },
  "peerDependenciesMeta": { "@deepseek-ai/schemastery": { "optional": true } },
  "scripts": { "prepack": "node scripts/build-client.mjs --check && node scripts/check.mjs" }
}
```

- `dsh.engines.dsh` 是 `plugin_manager` 判定版本门槛的字段。
- `@deepseek-ai/schemastery` 是 DSH 随包，插件只做动态 import + 降级，所以声明为 optional peer（不会让 npm 去装它）。
- `prepack` 保证发出去的 `client.js` 一定与源码同步。

### 本次重命名涉及的旧值（供排查）

| 位置 | 旧 | 新 |
|---|---|---|
| 包名 / loader 行 id | `dsh-token-monitor` | `dsh-token-control` |
| Client 模块 id | `dsh-token-monitor` | `dsh-token-control` |
| 槽位条目 id | `token-monitor:readout-bar` | `token-control:readout-bar` |
| 设置页条目 id | `dsh-token-monitor` | `dsh-token-control` |
| 路由前缀 | `/api/dsh-token-monitor/v1` | `/api/dsh-token-control/v1` |
| 数据目录 | `$DSH_HOME/dsh-token-monitor/` | `$DSH_HOME/dsh-token-control/` |

已装过旧包的 profile 需要先 `remove` 旧名再装新名，否则会同时存在两行。

---

## 1b. 发布前必须改的地方（历史记录，已完成）

改名之前 `package.json` 是本地开发形态（`private: true`、无 `engines.dsh`、无 peer 声明、无 `prepack`）。这些已在本次重命名中一并改好，无需再动。

剩下的只有仓库地址三件套：

```jsonc
"repository": { "type": "git", "url": "git+https://github.com/RitvaManner/dsh-token-control.git" },
"homepage": "https://github.com/RitvaManner/dsh-token-control#readme",
"bugs": { "url": "https://github.com/RitvaManner/dsh-token-control/issues" }
```

理由（保留备查）：

- `@deepseek-ai/schemastery` 是 **DSH 随包**，插件里是动态 import，取不到会降级。声明成 optional peer，既不会让 npm 去装它，也把兼容范围说清楚。
- `prepack` 保证「发出去的 bundle 一定和源码同步」——`build-client --check` 会在 `client.js` 落后时直接失败。
- `files` 已经白名单化（`src` / `locale` / `cordis.patch.yml` / `icon.svg` / README / LICENSE），`tests`、`scripts`、`docs` 不会进包，这是好事，别把 `scripts` 加进去。

---

## 2. 发布前必须跑的检查

```sh
node scripts/build-client.mjs        # 确认 bundle 最新
node scripts/check.mjs               # 架构方向 / 协议镜像 / 乱码 / bundle 是否落后
node --test tests/                   # 47 条断言（在有子进程权限的终端跑）
npm pack --dry-run                   # 看真实打包清单，确认没有多余/缺失文件
```

`npm pack --dry-run` 里应至少看到：

```
package.json
cordis.patch.yml
icon.svg
locale/en.json
locale/zh.json
src/host/index.js
src/host/routes.js
src/host/config.js
src/host/paths.js
src/client/client.js        ← 生成物，必须存在
src/client/core.js
src/client/views/index.json
src/client/views/readout-bar.js
src/definition/**  src/consumer/**  src/provider/**
README.md  README.zh.md  LICENSE
```

---

## 3. 用 tarball 在干净 profile 里装一遍（发布前最后一道）

```sh
npm pack                             # 产出 dsh-token-control-0.1.0.tgz
dsh plugin --profile verify add ./dsh-token-control-0.1.0.tgz
dsh --profile verify --no-open
```

打开页面确认：读数带出现、设置页有「Token 监控」、余额能读（配了 `DEEPSEEK_API_KEY` 时）。

再用不带本地路径的方式验证一次（模拟真实用户）：

```sh
dsh plugin --profile verify remove dsh-token-control
npm publish --dry-run                # 先看一遍将被发布的文件与版本
```

---

## 4. 发布

```sh
npm login                            # 需要 2FA 时按提示输入一次性码
npm publish                          # 无 scope
npm publish --access public          # 有 scope 时必须显式 public
```

发布后用干净环境装一次**从 registry 拉取**的版本：

```sh
dsh plugin --profile verify add dsh-token-control
```

> 注意：`dsh plugin add <name>` 会在 profile 里跑 pnpm，装的是 registry 上的正式包；本地 `link:` 与它无关。

---

## 5. GitHub 与自动发布

### 一次性配置

1. 仓库 Secrets → Actions → New repository secret：名称 `NPM_TOKEN`，值是一个 npm **Automation**（或 Granular，需勾选该包读写）token。Automation token 会绕过 2FA 的一次性码，否则 CI 里 `npm publish` 会卡在 OTP。
2. 推仓库与标签。`.github/workflows/release.yml` 会接管发布。

> 想用更安全的 **可信发布（OIDC，仓库里不存 token）**：在 npmjs.com 的包设置里绑定这个仓库与 workflow，然后把工作流里的 `NODE_AUTH_TOKEN` 那一行删掉、保留 `permissions: id-token: write` 与 `--provenance`。两种方式二选一即可，不要同时配。

### 打一个 tag 就发布

```sh
git tag v0.1.0
git push origin v0.1.0
```

工作流做的事，任何一步失败都不会发布：

1. 校验 `tag` 与 `package.json` 的 `version` 一致（`v0.1.0` ↔ `0.1.0`）；
2. `node scripts/build-client.mjs --check` —— `client.js` 落后于 `core.js`/View 就直接失败；
3. `node scripts/check.mjs` —— 架构方向、协议镜像、乱码、bundle 同步；
4. `node --test tests/` —— 47 条断言；
5. `npm pack --dry-run` —— 把真实打包清单打进日志；
6. `npm publish --provenance --access public`。

手动验证不发布：Actions → Release → Run workflow（`dry_run` 默认 `true`），它会跑完 1–5 并执行 `npm publish --dry-run`。

### Release 正文

```sh
gh release create v0.1.0 --title "v0.1.0" --notes-file docs/release-notes-v0.1.0.md
```

（`docs/release-notes-v0.1.0.md` 已写好：功能、计费口径、已知限制、本版验证、升级说明。）

README 顶部的徽章已就位（npm 版本 / 下载量 / 许可证 / node / dsh / GitHub release）。注意两点：

- **npm 徽章在首次发布前会显示 「not found」**，发布后自动恢复，不是配置错误。
- **GitHub release 徽章在第一次创建 release 前显示 「no releases」**，同上。

### 注意

- `npm publish --provenance` 要求**公开仓库**；仓库若为私有，删掉该参数。
- 工作流不 `npm ci`（本包无运行时依赖，也没有 lockfile），因此不需要缓存配置。
- 已发布过的版本再次触发会失败（npm 不允许覆盖），改版本号后重新打 tag 即可。

---

## 6. 社区目录 / 插件市场

| 渠道 | 怎么做 |
|---|---|
| **dshmarket**（本机已装的可视化市场） | 装好市场插件后，它可以从 **npm 包名** 或 **GitHub 仓库** 安装；所以先把 npm 与 GitHub 弄好，市场侧基本零额外工作 |
| **dshbase / dsh.so 目录** | 以 GitHub 仓库为主（拿 README、topic、release）；有的清单要求 `dsh.plugin.json`。**不要凭猜写这个文件**——按站点给出的字段规范填，缺字段宁可不提交 |
| README 徽章 | 顶部已内置 shields.io 徽章；若目录站点提供自己的 badge 片段（如「实测可装」），再叠加一行即可 |

---

## 7. 升级与兼容策略（发布后真正要紧的）

- **ViewModel 只增不改**：新增字段一律可选；Client 已按「不认识就忽略」实现。破坏性变更才动 `schemaVersion` 并同步 `protocol.js` 与 `client.js` 的镜像常量（`check.mjs` 会拦住不一致）。
- **价格表**：官方调价时新增 `pricing-table-YYYY-MM.js` + 改注册处，不要把旧表改成新值（历史轮次会算错）。表版本号会显示在 ViewModel 元数据里。
- **峰谷 policy**：每年新增 `policy-YYYY.js` 并注册；未覆盖年份会标「按工作日估算」，不会假装精确。
- **版本号**：功能新增 minor，修 bug patch；`engines.dsh` 只在真的需要新 API 时提高。
- **撤回**：npm 的 unpublish 有 72 小时限制且会影响已安装用户；发错了优先 `npm deprecate dsh-token-control@0.1.0 "原因"` 再发新版本。

---

## 8. 已知需要在发布说明里写清楚的限制

1. 流式期间输出 token 是字符估算（`≈`），结算后替换为真值。
2. 余额需要 `DEEPSEEK_API_KEY`；没有就显示「未配置」，不伪造数字。
3. 插件路由只绑定回环，但注册在 DSH `/api` 连接鉴权之外（同机进程可读快照，含余额，不含 key）。
4. 读数带挂 `conversation.input.dock`；与内置 `ui-chat` 的 usage 行并存，不冲突。
5. 当前只有一个 View（ReadoutBar）；新增 View 需要 `views/<id>.js` + `index.json` 一行 + `pnpm build`。
