# 技术设计文档

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Input Panel │  │ Data Panel  │  │    Output Panel     │  │
│  │  - Chat Input│  │ - Mock Data │  │ - Risk Dashboard    │  │
│  │  - Scenarios │  │ - CSV/JSON  │  │ - Checklist         │  │
│  │              │  │   Upload    │  │ - Handover Card     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                           │                                  │
│                    ┌──────▼──────┐                           │
│                    │ Rule Engine │  (纯前端，可独立运行)      │
│                    └──────┬──────┘                           │
│                           │                                  │
└───────────────────────────┼──────────────────────────────────┘
                            │
                   ┌────────▼────────┐
                   │ Cloudflare Pages │
                   │    Functions     │
                   │  /api/analyze    │
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐
                   │    LLM API      │
                   │  (MiMo/其他)    │
                   └─────────────────┘
```

## 技术栈选型

| 层级 | 技术 | 选型理由 |
|------|------|----------|
| **前端框架** | React 18 | 生态成熟，面试认知度高 |
| **构建工具** | Vite | 快速开发体验，HMR 即时 |
| **样式方案** | CSS Modules | 零依赖，样式隔离，符合项目定位 |
| **部署平台** | Cloudflare Pages | 免费、全球 CDN、Serverless Functions |
| **AI 服务** | LLM API | 灵活切换不同模型提供商 |

## 前端架构

### 目录结构

```
src/
├── components/           # UI 组件
│   ├── InputPanel/       # 输入面板
│   │   ├── ChatInput.tsx
│   │   ├── ScenarioSelector.tsx
│   │   └── DataSourcePanel.tsx
│   ├── OutputPanel/      # 输出面板
│   │   ├── RiskDashboard.tsx
│   │   ├── Checklist.tsx
│   │   └── HandoverCard.tsx
│   └── common/           # 通用组件
│       ├── Loading.tsx
│       ├── ErrorMessage.tsx
│       └── Toggle.tsx
├── core/                 # 核心逻辑
│   ├── ruleEngine/       # 规则引擎
│   │   ├── index.ts
│   │   ├── inventoryRules.ts
│   │   ├── priceRules.ts
│   │   ├── complianceRules.ts
│   │   └── types.ts
│   ├── parser/           # CSV/JSON 解析
│   │   ├── csvParser.ts
│   │   └── jsonParser.ts
│   └── mockData/         # 内置 Mock 数据
│       ├── scenarios.ts
│       └── builtinData.ts
├── services/             # API 服务
│   └── analyzeService.ts
├── types/                # TypeScript 类型
│   └── index.ts
├── hooks/                # 自定义 Hooks
│   └── useAnalysis.ts
├── App.tsx
└── main.tsx
```

### 核心组件设计

#### 1. InputPanel (输入面板)

```typescript
// 输入面板状态
interface InputPanelState {
  chatRecord: string;           // 当前聊天记录
  selectedScenario: string | null; // 选中的场景 ID
  dataSource: {
    type: 'BUILTIN' | 'CSV' | 'JSON';
    content: OrderLedger[] | InventoryRecord[] | PriceRecord[];
  } | null;
  isAnalyzing: boolean;         // 是否正在分析
}
```

**职责**:
- 接收用户粘贴的聊天记录
- 提供预设场景快速填充
- 管理数据源选择和文件上传
- 触发分析流程

#### 2. RiskDashboard (风险大屏)

```typescript
// 风险大屏状态
interface RiskDashboardState {
  overallLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';
  risks: RiskItem[];
  isExpanded: boolean;          // 是否展开详情
}
```

**职责**:
- 展示综合风险等级（红绿灯）
- 列出所有风险项及详情
- 支持风险项展开/收起

#### 3. RuleEngine (规则引擎)

```typescript
// 规则引擎接口
interface RuleEngine {
  evaluate(
    extracted: ExtractedOrder,
    orders: OrderLedger[],
    inventory: InventoryRecord[],
    prices: PriceRecord[]
  ): RiskAssessment;
}
```

**设计原则**:
- 纯函数，无副作用
- 每条规则独立，易于测试
- 支持规则组合和优先级
- 可脱离 LLM 独立运行

## 后端架构

### Cloudflare Pages Functions

```
functions/
└── api/
    └── analyze.ts      # 分析接口
```

### API 设计

#### POST /api/analyze

**请求体**:
```typescript
{
  chat_record: string;
  data_source: {
    type: 'BUILTIN' | 'CSV' | 'JSON';
    orders?: OrderLedger[];
    inventory?: InventoryRecord[];
    prices?: PriceRecord[];
  };
  mock_mode?: boolean;
}
```

**响应体**:
```typescript
{
  success: boolean;
  data?: {
    extracted: ExtractedOrder;
    assessment: RiskAssessment;
    mock_mode: boolean;
  };
  error?: {
    code: string;
    message: string;
    fallback_to_mock?: boolean;
  };
}
```

### LLM 调用封装

```typescript
// LLM 服务封装
interface LLMService {
  extractOrderInfo(chatRecord: string): Promise<ExtractedOrder>;
}

// 支持的 LLM 提供商
type LLMProvider = 'mimo' | 'openai' | 'anthropic' | 'mock';
```

**超时处理**:
- 设置 8 秒超时（CF Functions 限制 10 秒）
- 超时后自动降级到 Mock 模式
- 前端显示友好提示

## 规则引擎详细设计

### 规则分类

#### 1. 库存规则 (Inventory Rules)

```typescript
// 检查库存是否充足
function checkInventory Sufficiency(
  extracted: ExtractedOrder,
  inventory: InventoryRecord[]
): RiskItem | null;

// 检查批次是否可混批
function checkBatchMixing(
  extracted: ExtractedOrder,
  inventory: InventoryRecord[]
): RiskItem | null;
```

#### 2. 价格规则 (Price Rules)

```typescript
// 检查报价是否过期
function checkPriceExpiry(
  extracted: ExtractedOrder,
  prices: PriceRecord[]
): RiskItem | null;

// 检查价格是否匹配
function checkPriceMatch(
  extracted: ExtractedOrder,
  prices: PriceRecord[]
): RiskItem | null;
```

#### 3. 合规规则 (Compliance Rules)

```typescript
// 检查是否有正式 PO
function checkOfficialPO(
  extracted: ExtractedOrder,
  orders: OrderLedger[]
): RiskItem | null;

// 检查标签模板
function checkLabelTemplate(
  extracted: ExtractedOrder,
  orders: OrderLedger[]
): RiskItem | null;

// 检查收货地址
function checkDeliveryAddress(
  orders: OrderLedger[]
): RiskItem | null;
```

### 规则执行流程

```
输入数据
    │
    ▼
┌─────────────────┐
│  库存规则检查    │──→ 生成库存风险
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  价格规则检查    │──→ 生成价格风险
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  合规规则检查    │──→ 生成合规风险
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  风险等级汇总    │──→ 计算综合风险等级
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  生成 Checklist  │──→ 输出待办事项
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  生成交接卡片    │──→ 输出最终结果
└─────────────────┘
```

## 兜底策略

### 1. LLM API 失败兜底

```
LLM 调用
    │
    ├── 成功 → 使用真实抽取结果
    │
    └── 失败（超时/错误）
            │
            ▼
        前端提示："AI 抽取暂时不可用，使用预置结果"
            │
            ▼
        返回 Mock 抽取结果
            │
            ▼
        继续执行规则引擎（使用 Mock 数据）
```

### 2. 规则引擎独立运行

即使 LLM 完全不可用，规则引擎仍可基于预置数据独立给出风险分析：

```
用户输入聊天记录
    │
    ├── LLM 可用 → 抽取 + 规则引擎
    │
    └── LLM 不可用
            │
            ▼
        使用预置的"典型场景"数据
            │
            ▼
        规则引擎独立分析
            │
            ▼
        输出风险结果（标注为预置数据）
```

### 3. 数据解析失败兜底

```
用户上传 CSV/JSON
    │
    ├── 解析成功 → 使用用户数据
    │
    └── 解析失败
            │
            ▼
        提示："文件格式错误，使用内置数据"
            │
            ▼
        切换到内置 Mock 数据
```

## 性能优化

### 1. 前端优化

- 代码分割：按路由懒加载
- 虚拟列表：大数据量渲染优化
- 防抖处理：文件上传、文本输入

### 2. 后端优化

- 响应缓存：相同请求 5 分钟缓存
- 并行处理：规则检查并行执行
- 超时控制：LLM 调用 8 秒超时

## 安全设计

### 1. API Key 保护

- 环境变量存储，不暴露前端
- 通过 Cloudflare Functions 代理调用

### 2. 文件上传安全

- 限制文件大小（最大 1MB）
- 限制文件类型（.csv, .json）
- 服务端校验文件格式

### 3. 输入安全

- 聊天记录长度限制（最大 10000 字符）
- XSS 防护（React 自带）
- 内容安全检查（可选）

## 部署设计

### Cloudflare Pages 配置

```toml
# wrangler.toml
[build]
  command = "npm run build"
  directory = "dist"

[build.environment]
  NODE_VERSION = "18"
```

### 环境变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| LLM_API_KEY | LLM API 密钥 | sk-xxx |
| LLM_BASE_URL | LLM API 地址 | https://api.example.com |
| LLM_MODEL | 模型名称 | mimo-7b |

### 路由配置

```json
{
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```
