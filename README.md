# 域名价格查询 & 便宜域名扫描器

一个开源的域名比价工具，同时内置**百万级 `.xyz` 未注册域名扫描器**。

- 在多个注册商之间对比同一域名的首年 / 续费价格，并一键跳转到对应注册商查询
- 通过 GitHub Actions 后台 Worker + DNS-over-HTTPS 全量扫描 100 万个 6 位数字 `.xyz` 域名，结果直接托管在仓库内，前端打开即用

在线示例：<https://domain-price-checker.vercel.app>

## 功能

### 域名价格查询（首页 `/`）

输入一个名称并在多个后缀中查询：

- 展示每个后缀的注册状态（可注册 / 已注册 / 未知），用 **RDAP** 权威确认（按后缀直连 IANA 注册局端点），失败时降级到 DNS 判断
- 对**可注册**域名，对比 11 家注册商的首年价、续费价、两年合计与 WHOIS 保护费，标注最便宜的一家
- 每家注册商的「购买」链接自动携带当前域名；不支持的后缀（如国际注册商不卖 `.cn`、腾讯云暂停 `.co`）会自动隐藏对应条目
- USD / CNY 双币种显示，汇率可自定义（localStorage 记忆）

支持注册商：

| 注册商 | 备注 |
|---|---|
| Cloudflare | 不含 cn / top |
| Porkbun | 不含 cn |
| Namecheap | — |
| GoDaddy | — |
| Dynadot | — |
| Hostinger | 不含 cn |
| Spaceship | 不含 cn |
| 阿里云（万网） | 支持 cn |
| 腾讯云 | 暂停 .co |
| 西部数码 | 支持 cn |
| 新网 | 支持 cn |

价格数据维护在 [`lib/pricing.ts`](lib/pricing.ts)（公开参考价快照，仅作参考，最终以注册商结算为准）。

### 便宜域名（`/cheap`，百万 .xyz 扫描）

- **云端后台扫描**：GitHub Actions 定时（每 15 分钟）运行 [`worker/scan.mjs`](worker/scan.mjs)，把已备案域名记录为「已注册」，增量重扫时只检查未注册部分。扫描进度与结果写入 `data/`
- **前端直读**：从仓库 `data/available/*` 直接加载全部未注册域名列表，支持关键字搜索与导出 TXT，打开即用、无需自己扫描
- **本地/浏览器扫描**：也可在页面上手动对任意区间发起扫描
  - 服务端模式：每批 800 个、100 并发，服务端 DNS 预筛选 + 注册局确认
  - 浏览器直扫模式：直接调用 Cloudflare/Google 的 DoH 接口（不占服务器资源，无 60 秒限制），DNS 报 NXDOMAIN 判为可注册
  - 进度自动保存到 localStorage，可暂停后改天继续；结果可导出 TXT

当前云端进度见 `data/scan-progress.json`。

## 项目结构

```
app/
  page.tsx              # 首页：域名价格对比
  cheap/                # 便宜域名（百万 .xyz 扫描）页面
  api/check/            # RDAP+DNS 可用性检查 API
  api/scan/             # 服务端批量扫描 API
components/
  SearchForm.tsx        # 名称 + 后缀选择表单
  ResultSection.tsx     # 注册商价格对比表格与购买链接
lib/
  pricing.ts            # 注册商价格快照与结算链接模板
  tlds.ts               # 后缀列表
  rdap.ts               # RDAP 可用性检查（含 IANA 直连端点）
worker/
  scan.mjs              # GitHub Actions 后台扫描 Worker（DoH 并发扫描 + 增量 + 历史清理）
data/                   # 扫描产物（scan-progress.json + available/ 分片 txt）
```

## 开发

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # 生产构建
npm run typecheck  # TypeScript 检查
```

## 后台扫描 Worker

GitHub Actions `.github/workflows/scan.yml` 定时触发（可 `workflow_dispatch` 手动调整参数）：

| 输入 | 默认 | 说明 |
|---|---|---|
| `scan_total` | 1000000 | 扫描总量 |
| `commit_every` | 100000 | 每 N 个域名提交一次进度 |
| `scan_concurrency` | 100 | DNS 并发数 |
| `force_rescan` | 0 | 设为 1 时跳过 24 小时新鲜度检查，强制增量重扫 |

扫描原理：

1. 用 Cloudflare / Google 的 **DoH** 接口批量查询 `type=NS`，无记录（NXDOMAIN）判为可注册
2. RDAP 兜底确认，避免 DNS 误判
3. 增量模式预加载上一轮已注册索引，本轮只查询未知部分
4. 每次 commit 自动 `git reset --soft` 压缩历史，保持仓库体积恒定

## 免责声明

- 价格为公开参考价快照，可能随促销 / 汇率变动，请以各注册商结算页为准
- DNS 判定可能有个别误差，购买前请在注册商结算页再次确认
- 各注册商「购买」链接跳转到其官方查询页，用于落地该域名

## License

[MIT](LICENSE) © 2026 tanle-mtr