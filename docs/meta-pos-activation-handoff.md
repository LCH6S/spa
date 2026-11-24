# Meta POS 激活改造接手说明

**更新时间** 2026-11-25，上海时区。

## 当前进度

| 产出或能力 | 状态与依据 |
|---|---|
| 业务需求 | BRD V0.1 保留初版详细流程，业务 BRD V0.2 保留六个场景及 AE、运营、实施、门店店员的交接。完成节点与对象关系以最新 PRD 为准。 [业务 BRD](meta-pos-device-activation-brd-business.md) |
| 产品需求 | PRD V0.1 草稿，含实施、AE、运营的三条主干路径，运营平台、Meta POS 端和 CRM 的功能、状态、异常及验收。两张客户端操作图随文档提供。 [当前 PRD](meta-pos-device-activation-prd.md) |
| 运营平台 | 独立 HTML Demo 已发布。菜单、批次和任务列表、模板下载完成线上验证。本地示例验证过时间边界、导入全失败自动取消、单条与批量作废、参数变更及错绑记录。 [在线 Demo](https://lch6s.github.io/spa/pos-device-allocation/) · [首次发布提交](https://github.com/LCH6S/spa/commit/8659561650a6301b7e521d87ecefc4a00f41e5e5) |
| Meta POS 和收钱吧终端 | 客户端路径与目标规则已写入 PRD。生产激活、实际归属返回、错绑自动解绑和结果核对，需 POS 与收钱吧终端能力方联调。 [待确认](meta-pos-device-activation-prd.md#5-依赖与待确认) |
| 通联和 CRM | 通联 USDK 读写、清除及主密钥流程待在目标机型验证。CRM 本期范围和品牌过滤口径已确定，品牌关系数据源和跨品牌错绑字段权限待评审。 [待确认](meta-pos-device-activation-prd.md#5-依赖与待确认) |

## 从哪里继续

1. **研发评审先走通一条完整路径。** 以「实施分配一台设备 → 门店在 POS 核对并激活 → 后台查结果 → 反激活后重新分配」核对任务、设备记录、目标品牌门店、收钱吧终端号之间的关系。补齐超时查原结果、错绑解除以及并发分配的生产反馈。验收使用 PRD 第 4 节。 [PRD](meta-pos-device-activation-prd.md)
2. **POS 联调分两条路径办。** 开始激活读取任务预分配参数。设置页银行卡激活读取当前设备配置。分别验证参数一致、参数不同、无参数、清除失败及主密钥回执。确认清除使用空值还是 `00`，以及旧参数失效的判定。 [正常激活](assets/meta-pos-device-activation-prd/pos-device-activation.png) · [设置页激活](assets/meta-pos-device-activation-prd/pos-settings-bank-card-activation.png)
3. **CRM 先落品牌数据范围。** 为关联品牌内的设备复用单台分配、任务和设备管理。用 A、B 两个品牌验证搜索、详情直达、操作提交和权限变化。运营平台跨品牌批量生成任务后，CRM 只按逐台任务目标品牌展示。导入批次留在运营平台。 [CRM 需求](meta-pos-device-activation-prd.md#33-crm)
4. **改交互先复现 Demo。** 从仓库根目录启动静态服务，再点对应菜单或直达路由。业务行为涉及生产能力时，用联调结果关闭 PRD 待确认项。

## Demo 源码定位

| 文件 | 职责 |
|---|---|
| [index.html](../pos-device-allocation/index.html) / [styles.css](../pos-device-allocation/styles.css) | 页面入口、菜单框架、基础样式、弹窗容器。 |
| [allocation.js](../pos-device-allocation/allocation.js) | 批次、模板读写、逐行校验、门店关联、示例数据和本地持久化。 |
| [activation.js](../pos-device-allocation/activation.js) | 逐台任务、作废、模拟激活结果、银行卡参数及变更记录。 |
| [activation-ui.js](../pos-device-allocation/activation-ui.js) | 任务列表、批量作废、详情、激活记录和银行卡参数变更弹窗。 |
| [app.js](../pos-device-allocation/app.js) | 页面路由、批次检查与结果、单台分配、POS 激活管理和反激活。 |

常用路由为 `#allocation`、`#upload`、`#check/<批次号>`、`#result/<批次号>`、`#tasks`、`#task/<任务编号>`、`#devices`、`#device/<设备ID>`。两份第三方库和许可证见 [vendor](../pos-device-allocation/vendor/)。

## 最短回归路径

- **批次。** 下载模板并用示例门店号做一份部分通过、一份全部失败的清单。查看分组预览、执行结果、自动取消及失败清单重传。用不同分钟区间验证上传时间和任务生成时间的筛选。
- **任务。** 用单台分配建立待处理任务，确认可以修改激活码和预分配银行卡参数，批次详情与任务列表使用相同作废交互。模拟错绑后核对原因里的实际收钱吧门店号。
- **设备。** 模拟正确激活，核对成功记录中的设备 ID 和收钱吧终端号，再打开设备详情。编辑银行卡配置并查看变更记录。设备反激活后核对设备退出列表、历史成功记录显示「已解绑」。

Demo 保留模拟入口便于验证交互。真实 POS 接入、CRM 品牌校验和通联能力的验收证据记录在生产联调结果中。
