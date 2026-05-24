# 开发任务拆解

## 概述

本任务拆解将 MVP 开发分为 4 个 Sprint，每个 Sprint 包含具体的开发任务和交付物。

## Sprint 1: 基础设施与 UI 骨架

### 目标
搭建项目基础架构，实现高保真 UI 骨架，定义主题色彩系统。

### 任务列表

| 编号 | 任务 | 描述 | 交付物 |
|------|------|------|--------|
| S1-01 | 项目初始化 | 使用 Vite + React + TypeScript 初始化项目 | 可运行的空项目 |
| S1-02 | 目录结构 | 创建标准目录结构（components/core/services/types） | 目录骨架 |
| S1-03 | TypeScript 配置 | 配置 tsconfig.json，定义核心类型 | types/index.ts |
| S1-04 | CSS 主题系统 | 定义深色主题色彩变量和基础样式 | styles/theme.css |
| S1-05 | 布局组件 | 实现 Header、左右分栏布局 | Layout.tsx |
| S1-06 | 输入面板骨架 | 实现 InputPanel 组件骨架 | InputPanel.tsx |
| S1-07 | 输出面板骨架 | 实现 OutputPanel 组件骨架 | OutputPanel.tsx |
| S1-08 | 响应式适配 | 确保 1280px 以上屏幕正常显示 | 响应式样式 |

### 技术要点

```css
/* 主题色彩变量示例 */
:root {
  --color-bg-primary: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-text-primary: #f8fafc;
  --color-text-secondary: #94a3b8;
  --color-accent: #3b82f6;
  --color-risk-high: #ef4444;
  --color-risk-medium: #f59e0b;
  --color-risk-low: #22c55e;
}
```

### 验收标准
- [ ] 项目可正常启动和运行
- [ ] UI 布局与设计稿一致
- [ ] 深色主题视觉效果达标

---

## Sprint 2: Mock 引擎与规则校验器

### 目标
实现内置 Mock 数据、规则引擎核心逻辑、CSV/JSON 解析器。

### 任务列表

| 编号 | 任务 | 描述 | 交付物 |
|------|------|------|--------|
| S2-01 | Mock 数据设计 | 设计 3-4 套典型场景数据 | scenarios.ts |
| S2-02 | 订单台账 Mock | 实现订单台账 Mock 数据 | mockOrders.ts |
| S2-03 | 库存台账 Mock | 实现库存台账 Mock 数据 | mockInventory.ts |
| S2-04 | 报价台账 Mock | 实现报价台账 Mock 数据 | mockPrices.ts |
| S2-05 | 规则引擎核心 | 实现规则引擎主函数 | ruleEngine/index.ts |
| S2-06 | 库存规则 | 实现库存充足性、混批检查 | inventoryRules.ts |
| S2-07 | 价格规则 | 实现报价过期、价格匹配检查 | priceRules.ts |
| S2-08 | 合规规则 | 实现 PO、标签、地址检查 | complianceRules.ts |
| S2-09 | CSV 解析器 | 实现 CSV 文件解析功能 | csvParser.ts |
| S2-10 | JSON 解析器 | 实现 JSON 文件解析功能 | jsonParser.ts |
| S2-11 | 规则引擎测试 | 编写规则引擎单元测试 | *.test.ts |

### 规则引擎实现要点

```typescript
// 规则引擎主函数
export function runRiskEngine(
  extracted: ExtractedOrder,
  orders: OrderLedger[],
  inventory: InventoryRecord[],
  prices: PriceRecord[]
): RiskAssessment {
  const risks: RiskItem[] = [];

  // 并行执行所有规则检查
  const inventoryRisks = checkInventoryRules(extracted, inventory);
  const priceRisks = checkPriceRules(extracted, prices);
  const complianceRisks = checkComplianceRules(extracted, orders);

  risks.push(...inventoryRisks, ...priceRisks, ...complianceRisks);

  // 计算综合风险等级
  const overallLevel = calculateOverallLevel(risks);

  // 生成 Checklist
  const checklist = generateChecklist(risks);

  // 生成交接卡片
  const handoverCard = generateHandoverCard(extracted, orders, risks);

  return { overall_risk_level: overallLevel, risks, checklist, handover_card: handoverCard };
}
```

### 验收标准
- [ ] 3-4 套 Mock 数据可正常加载
- [ ] 规则引擎可独立运行，输出正确的风险评估
- [ ] CSV/JSON 文件可正确解析
- [ ] 单元测试覆盖率 > 80%

---

## Sprint 3: API 构建与 LLM 联调

### 目标
实现 Cloudflare Functions API，集成 LLM 服务，完成前后端联调。

### 任务列表

| 编号 | 任务 | 描述 | 交付物 |
|------|------|------|--------|
| S3-01 | CF Functions 配置 | 配置 Cloudflare Pages Functions 环境 | wrangler.toml |
| S3-02 | 分析接口实现 | 实现 POST /api/analyze 接口 | analyze.ts |
| S3-03 | LLM 服务封装 | 封装 LLM API 调用逻辑 | llmService.ts |
| S3-04 | Prompt 设计 | 设计并调优 LLM 抽取 Prompt | prompt.ts |
| S3-05 | 超时处理 | 实现 8 秒超时和降级逻辑 | timeout.ts |
| S3-06 | 错误处理 | 实现统一错误处理和响应 | errorHandler.ts |
| S3-07 | 前端 API 调用 | 实现前端调用 API 的服务层 | analyzeService.ts |
| S3-08 | Mock 模式实现 | 实现 Mock 模式逻辑 | mockService.ts |
| S3-09 | 联调测试 | 前后端联调，修复问题 | 联调报告 |

### LLM Prompt 设计

```
# Role
你是一个资深的电子元器件代理商订单风控专家和高级销售助理。
你的任务是从散乱的聊天记录中提取订单关键信息，并严格输出为结构化 JSON。

# Background
在半导体分销行业，订单常涉及型号(MPN)、批次(DateCode/Lot)、
环保包装(Tape&Reel/Tray)、客户专属标签、分批发货等复杂属性。

# Task
请阅读以下聊天记录：
<chat_record>
{{INPUT_CHAT}}
</chat_record>

# Extraction Rules
1. 提取所有涉及的型号和数量
2. 识别是否有特殊包装或标签要求
3. 识别交期紧急程度
4. 识别当前缺失的重要信息

# Output Format
严格按照以下 JSON Schema 输出：
{
  "entities": [
    {
      "part_number": "string",
      "quantity": "number",
      "special_requirements": ["string"]
    }
  ],
  "urgency_level": "NORMAL|HIGH",
  "identified_missing_info": ["string"]
}
```

### 验收标准
- [ ] /api/analyze 接口正常响应
- [ ] LLM 可正常调用并返回结构化结果
- [ ] 超时和降级逻辑正常工作
- [ ] Mock 模式可正常切换

---

## Sprint 4: 视图组装与体验抛光

### 目标
完成所有视图组件，实现完整交互流程，优化用户体验。

### 任务列表

| 编号 | 任务 | 描述 | 交付物 |
|------|------|------|--------|
| S4-01 | 场景选择器 | 实现预设场景按钮组 | ScenarioSelector.tsx |
| S4-02 | 聊天输入组件 | 完善聊天记录输入体验 | ChatInput.tsx |
| S4-03 | 数据源面板 | 实现数据源选择和文件上传 | DataSourcePanel.tsx |
| S4-04 | AI 结果展示 | 实现抽取结果展示组件 | ExtractedResult.tsx |
| S4-05 | 风险大屏 | 实现风险可视化面板 | RiskDashboard.tsx |
| S4-06 | Checklist 组件 | 实现待办事项清单 | Checklist.tsx |
| S4-07 | 交接卡片 | 实现交接卡片生成和复制 | HandoverCard.tsx |
| S4-08 | Loading 状态 | 实现加载动画和骨架屏 | Loading.tsx |
| S4-09 | 错误提示 | 实现友好的错误提示 | ErrorMessage.tsx |
| S4-10 | Mock 开关 | 实现 Mock 模式切换开关 | MockToggle.tsx |
| S4-11 | 整体联调 | 完整流程联调测试 | 功能完整 |
| S4-12 | 视觉优化 | 优化动画、过渡效果 | 视觉提升 |
| S4-13 | 文档完善 | 完善项目文档 | 文档完整 |

### 交互流程实现

```typescript
// 分析流程主函数
async function handleAnalyze() {
  setIsAnalyzing(true);

  try {
    // 1. 调用 API
    const result = await analyzeService.analyze({
      chat_record: chatInput,
      data_source: dataSource,
      mock_mode: isMockMode
    });

    // 2. 处理结果
    if (result.success) {
      setExtracted(result.data.extracted);
      setAssessment(result.data.assessment);

      // 3. 滚动到结果区域
      outputRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      // 4. 处理错误
      if (result.error.fallback_to_mock) {
        showNotification('已切换到预置结果');
      } else {
        showError(result.error.message);
      }
    }
  } catch (error) {
    showError('分析失败，请重试');
  } finally {
    setIsAnalyzing(false);
  }
}
```

### 验收标准
- [ ] 所有视图组件正常渲染
- [ ] 完整分析流程可正常执行
- [ ] 交接卡片可正常复制
- [ ] 所有错误场景有友好提示
- [ ] UI 视觉效果达标
- [ ] 所有文档完成

---

## 依赖关系

```
Sprint 1 (基础架构)
    │
    ▼
Sprint 2 (Mock + 规则引擎)
    │
    ├──→ Sprint 3 (API + LLM)
    │         │
    │         ▼
    └────→ Sprint 4 (视图组装)
```

## 里程碑

| 里程碑 | 交付物 | 完成标志 |
|--------|--------|----------|
| M1 | 可运行的 UI 骨架 | 页面可正常显示 |
| M2 | 规则引擎可独立运行 | 单元测试全部通过 |
| M3 | API 可正常调用 LLM | 联调测试通过 |
| M4 | MVP 可演示 | 所有验收标准通过 |

## 开发建议

1. **优先保证规则引擎**: 规则引擎是核心价值，应优先实现和测试
2. **Mock 模式优先**: 先确保 Mock 模式完整可用，再接入 LLM
3. **渐进式开发**: 每个 Sprint 结束都有可演示的成果
4. **测试驱动**: 核心逻辑（规则引擎）应有完整单元测试
5. **文档同步**: 每个 Sprint 结束更新相关文档
