# API 设计文档

## 概述

本项目 API 采用 Cloudflare Pages Functions 实现，提供单个核心接口用于订单风控分析。

## API 端点

### POST /api/analyze

执行订单风控分析，从聊天记录中提取订单信息并进行风险评估。

#### 请求

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```typescript
{
  // 必填：原始聊天记录
  chat_record: string;

  // 必填：数据源配置
  data_source: {
    // 数据源类型
    type: 'BUILTIN' | 'CSV' | 'JSON';

    // 以下字段根据 type 决定是否必填
    // type=BUILTIN 时：可选，指定场景 ID
    scenario_id?: string;

    // type=CSV 或 JSON 时：必填
    orders?: OrderLedger[];
    inventory?: InventoryRecord[];
    prices?: PriceRecord[];
  };

  // 可选：是否使用 Mock 模式（默认 false）
  mock_mode?: boolean;
}
```

**完整示例**:

```json
{
  "chat_record": "客户：A133要5000颗，最好明天发。销售：库存有，让助理建单。",
  "data_source": {
    "type": "BUILTIN",
    "scenario_id": "scenario_001"
  },
  "mock_mode": false
}
```

或使用上传的数据：

```json
{
  "chat_record": "客户：A133要5000颗，最好明天发。销售：库存有，让助理建单。",
  "data_source": {
    "type": "CSV",
    "orders": [...],
    "inventory": [...],
    "prices": [...]
  },
  "mock_mode": false
}
```

#### 响应

**成功响应 (200)**:
```typescript
{
  success: true;
  data: {
    // AI 从聊天记录提取的订单信息
    extracted: ExtractedOrder;

    // 规则引擎评估结果
    assessment: RiskAssessment;

    // 是否为 Mock 结果
    mock_mode: boolean;

    // 分析耗时（毫秒）
    duration_ms: number;
  }
}
```

**成功响应示例**:
```json
{
  "success": true,
  "data": {
    "extracted": {
      "entities": [
        {
          "part_number": "A133",
          "quantity": 5000,
          "special_requirements": [],
          "requested_delivery": "明天"
        }
      ],
      "urgency_level": "HIGH",
      "identified_missing_info": ["正式PO", "收货人联系方式"]
    },
    "assessment": {
      "overall_risk_level": "HIGH",
      "risks": [
        {
          "id": "RISK-001",
          "level": "HIGH",
          "category": "库存风险",
          "message": "现货库存不足！需求 5000 颗，当前可用仅 3000 颗",
          "suggestion": "需确认后续到货期或与客户协商分批发货",
          "owner": "采购/销售",
          "source": "RULE"
        }
      ],
      "checklist": [
        {"id": "CL-001", "text": "确认库存缺口解决方案", "status": "PENDING", "priority": "HIGH"}
      ],
      "handover_card": {
        "order_id": "PO-202405-001",
        "customer_name": "某知名终端制造厂",
        "sales_rep": "张三",
        "items": [...],
        "risk_summary": "存在 1 项高危风险",
        "action_items": ["联系采购确认到货计划"],
        "generated_at": "2024-05-20T10:30:00Z"
      }
    },
    "mock_mode": false,
    "duration_ms": 3200
  }
}
```

**错误响应 (4xx/5xx)**:
```typescript
{
  success: false;
  error: {
    // 错误代码
    code: 'INVALID_INPUT' | 'LLM_ERROR' | 'TIMEOUT' | 'INTERNAL_ERROR';

    // 错误描述
    message: string;

    // 是否已降级到 Mock 模式
    fallback_to_mock?: boolean;
  }
}
```

**错误响应示例**:

```json
{
  "success": false,
  "error": {
    "code": "TIMEOUT",
    "message": "AI 分析超时，已切换到预置结果",
    "fallback_to_mock": true
  }
}
```

## 错误代码定义

| 错误代码 | HTTP 状态码 | 说明 |
|---------|------------|------|
| `INVALID_INPUT` | 400 | 请求参数格式错误 |
| `MISSING_CHAT_RECORD` | 400 | 缺少聊天记录 |
| `MISSING_DATA_SOURCE` | 400 | 缺少数据源配置 |
| `INVALID_FILE_FORMAT` | 400 | 上传文件格式错误 |
| `LLM_ERROR` | 502 | LLM API 调用失败 |
| `TIMEOUT` | 504 | LLM API 调用超时 |
| `LLM_PARSE_ERROR` | 502 | LLM 返回结果解析失败 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

## Mock 模式

### 触发条件

以下情况会自动或手动触发 Mock 模式：

1. **手动触发**: 请求中 `mock_mode: true`
2. **自动触发**: LLM API 调用失败或超时
3. **降级触发**: LLM 返回结果无法解析

### Mock 模式行为

- 不调用真实 LLM API
- 根据输入的聊天记录，匹配最接近的预置场景
- 返回预置的抽取结果和风险评估
- 响应中标记 `mock_mode: true`

### Mock 数据场景

| 场景 ID | 场景名称 | 触发关键词 |
|---------|---------|-----------|
| `scenario_001` | 常规缺货 | 缺货、库存不足、数量不够 |
| `scenario_002` | 标签问题 | 贴标、标签、客户标签 |
| `scenario_003` | 报价过期 | 报价、价格、之前的价 |
| `scenario_004` | PO 缺失 | PO、采购单、正式订单 |

## 文件上传接口

### POST /api/upload

上传 CSV/JSON 文件并解析为结构化数据。

**Request**: `multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | 是 | CSV 或 JSON 文件 |
| data_type | string | 是 | 数据类型：orders/inventory/prices |

**Response**:
```json
{
  "success": true,
  "data": {
    "record_count": 15,
    "parsed_data": [...]
  }
}
```

## 限流设计

### 免费版限制

- 每分钟最多 10 次请求
- 每天最多 1000 次请求

### 超时设置

- LLM API 调用超时：8 秒
- 总请求超时：10 秒（CF Functions 限制）
- 前端超时提示：10 秒后显示"分析超时"

## 路由配置

```json
// _routes.json
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": []
}
```

## 调用示例

### cURL 示例

```bash
curl -X POST https://your-domain.workers.dev/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "chat_record": "客户：A133要5000颗，最好明天发。",
    "data_source": {
      "type": "BUILTIN",
      "scenario_id": "scenario_001"
    }
  }'
```

### 前端调用示例

```typescript
const response = await fetch('/api/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_record: chatInput,
    data_source: {
      type: 'BUILTIN',
      scenario_id: selectedScenario
    }
  })
});

const result = await response.json();

if (result.success) {
  setExtracted(result.data.extracted);
  setAssessment(result.data.assessment);
} else {
  if (result.error.fallback_to_mock) {
    showMessage('已切换到预置结果');
  } else {
    showError(result.error.message);
  }
}
```
