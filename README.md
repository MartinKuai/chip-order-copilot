# Chip Order Copilot

芯片代理商 B2B 订单交接与发货前风控 Agent

## 核心功能

- 从非结构化沟通记录中抽取订单字段（型号、数量、特殊要求）
- 基于规则引擎识别发货前风险（库存、报价、PO、地址、标签、批次）
- 生成发货前 Checklist 和销售助理交接卡片
- 支持 CSV/JSON 业务数据上传

## 技术栈

- React 18 + TypeScript
- Vite 构建
- Cloudflare Pages Functions (API 代理)
- 纯规则引擎，无需 LLM API 即可运行

## 本地开发

```bash
npm install
npm run dev
```

访问 http://localhost:5173

## 构建部署

```bash
npm run build
```

## Cloudflare Pages Functions 测试

```bash
npx wrangler pages dev dist
```

## License

MIT
