import { useState, type ChangeEvent, type DragEvent } from 'react';
import { builtinScenarios, getScenarioById } from '../../data/scenarios';
import type { DataSource, OrderLedger, InventoryRecord, PriceRecord } from '../../types';
import { parseBoolean } from '../../lib/utils';
import styles from './InputPanel.module.css';

interface InputPanelProps {
  onAnalyze: (chatRecord: string, dataSource: DataSource) => void;
  isAnalyzing: boolean;
}

/**
 * 从扁平数据生成结构化台账
 */
function generateLedgersFromFlatData(flatData: Record<string, unknown>[]): {
  orders: OrderLedger[];
  inventory: InventoryRecord[];
  prices: PriceRecord[];
} {
  const orders: OrderLedger[] = [];
  const inventory: InventoryRecord[] = [];
  const prices: PriceRecord[] = [];

  for (const item of flatData) {
    const partNum = String(item.product_model ?? item.model ?? item.mpn ?? item.part_num ?? '');
    const virtualCustomerId = String(item.customer_id ?? (partNum ? `UPLOAD_CUSTOMER-${partNum.toUpperCase()}` : 'UPLOAD_CUSTOMER'));

    orders.push({
      order_id: String(item.order_id ?? `UPLOAD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      customer_id: virtualCustomerId,
      customer_name: String(item.customer_name ?? '上传客户'),
      sales_rep: String(item.sales_rep ?? ''),
      has_official_po: parseBoolean(item.po_received ?? item.has_official_po ?? false),
      address_confirmed: parseBoolean(item.shipping_address_confirmed ?? item.address_confirmed ?? false),
      label_template_available: parseBoolean(item.label_template_uploaded ?? item.label_template_available ?? false),
      allow_mix_batch: parseBoolean(item.mixed_batch_allowed ?? item.allow_mix_batch ?? true),
      status: 'CONFIRMED',
    });

    inventory.push({
      part_num: partNum,
      total_avail: Number(item.available_quantity ?? item.quantity ?? item.total_avail ?? 0),
      batches: [],
      last_updated: new Date().toISOString(),
      customer_id: virtualCustomerId,
    });

    prices.push({
      part_num: partNum,
      customer_id: virtualCustomerId,
      quoted_price: Number(item.price ?? item.quoted_price ?? 0),
      currency: String(item.currency ?? 'USD'),
      quote_date: String(item.quote_date ?? new Date().toISOString()),
      valid_days: Number(item.valid_days ?? 30),
      min_qty: Number(item.min_qty ?? 1),
    });
  }

  return { orders, inventory, prices };
}

/**
 * 解析上传的文件
 */
async function parseFile(file: File): Promise<Record<string, unknown>[]> {
  const content = await file.text();

  if (file.name.endsWith('.json')) {
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [data];
  } else if (file.name.endsWith('.csv')) {
    // 简单 CSV 解析
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const headers = lines[0]!.split(',').map(h => h.trim().replace(/"/g, ''));
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        obj[h] = values[i] ?? '';
      });
      return obj;
    });
  }

  return [];
}

export function InputPanel({ onAnalyze, isAnalyzing }: InputPanelProps) {
  const [chatRecord, setChatRecord] = useState('');
  const [selectedScenario, setSelectedScenario] = useState<string | null>('scenario_001');
  const [dataSource, setDataSource] = useState<DataSource>(() => {
    const initialScenario = getScenarioById('scenario_001');
    if (initialScenario) {
      return {
        type: 'BUILTIN',
        scenario_id: 'scenario_001',
        orders: initialScenario.orders,
        inventory: initialScenario.inventory,
        prices: initialScenario.prices,
      };
    }
    return { type: 'BUILTIN', scenario_id: 'scenario_001' };
  });
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedDataInfo, setUploadedDataInfo] = useState<{
    orders: number;
    inventory: number;
    prices: number;
  } | null>(null);

  const handleScenarioSelect = (scenarioId: string) => {
    const scenario = getScenarioById(scenarioId);
    if (scenario) {
      setChatRecord(scenario.chat_record);
      setSelectedScenario(scenarioId);
      setDataSource({
        type: 'BUILTIN',
        scenario_id: scenarioId,
        orders: scenario.orders,
        inventory: scenario.inventory,
        prices: scenario.prices,
      });
      setUploadStatus(null);
      setUploadedDataInfo(null);
    }
  };

  const handleSmartUpload = async (file: File) => {
    try {
      setUploadStatus(`正在解析 ${file.name}...`);
      const flatData = await parseFile(file);

      if (flatData.length === 0) {
        setUploadStatus('文件为空或格式错误');
        return;
      }

      const ledgers = generateLedgersFromFlatData(flatData);

      setDataSource({
        type: file.name.endsWith('.json') ? 'JSON' : 'CSV',
        orders: ledgers.orders,
        inventory: ledgers.inventory,
        prices: ledgers.prices,
        flat_data: flatData,
      });

      setUploadedDataInfo({
        orders: ledgers.orders.length,
        inventory: ledgers.inventory.length,
        prices: ledgers.prices.length,
      });

      setUploadStatus(`解析成功: ${flatData.length} 条业务数据`);
    } catch (error) {
      setUploadStatus(`解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setUploadedDataInfo(null);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0]!;
      if (file.name.endsWith('.csv') || file.name.endsWith('.json')) {
        handleSmartUpload(file);
      } else {
        setUploadStatus('请上传 .csv 或 .json 文件');
      }
    }
  };

  const handleAnalyze = () => {
    if (!chatRecord.trim()) {
      alert('请输入沟通记录');
      return;
    }
    onAnalyze(chatRecord, dataSource);
  };

  return (
    <div className={styles.inputPanel}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>预设场景</h3>
        <div className={styles.scenarioGrid}>
          {builtinScenarios.map(scenario => (
            <button
              key={scenario.id}
              className={`${styles.scenarioBtn} ${selectedScenario === scenario.id ? styles.selected : ''}`}
              onClick={() => handleScenarioSelect(scenario.id)}
            >
              <span className={styles.scenarioName}>{scenario.name}</span>
              <span className={styles.scenarioDesc}>{scenario.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>沟通记录</h3>
        <textarea
          className={styles.chatInput}
          value={chatRecord}
          onChange={(e) => setChatRecord(e.target.value)}
          placeholder="请粘贴企业微信/微信聊天记录..."
          rows={8}
        />
        <div className={styles.charCount}>{chatRecord.length} 字</div>
      </div>

      <div
        className={`${styles.section} ${styles.uploadSection} ${isDragOver ? styles.dragOver : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <h3 className={styles.sectionTitle}>业务数据</h3>
        <p className={styles.uploadHint}>
          上传一份扁平 JSON/CSV，系统自动生成订单/库存/报价数据
        </p>

        <div className={styles.uploadButtons}>
          <label className={styles.uploadBtn}>
            <input
              type="file"
              accept=".csv,.json"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const file = e.target.files?.[0];
                if (file) handleSmartUpload(file);
              }}
              hidden
            />
            选择文件
          </label>
        </div>

        {uploadStatus && (
          <div className={`${styles.uploadStatus} ${uploadStatus.includes('成功') ? styles.success : styles.error}`}>
            {uploadStatus}
          </div>
        )}

        {uploadedDataInfo && (
          <div className={styles.uploadedDataInfo}>
            <span>已更新: 订单 {uploadedDataInfo.orders} 条 | 库存 {uploadedDataInfo.inventory} 条 | 报价 {uploadedDataInfo.prices} 条</span>
          </div>
        )}

        <div className={styles.dataSourceStatus}>
          <span className={styles.statusLabel}>当前数据源:</span>
          <span className={styles.statusValue}>
            {dataSource.type === 'BUILTIN' ? '内置样例数据' : `${dataSource.type} 上传数据`}
          </span>
        </div>
      </div>

      <button
        className={`${styles.analyzeBtn} ${isAnalyzing ? styles.analyzing : ''}`}
        onClick={handleAnalyze}
        disabled={isAnalyzing || !chatRecord.trim()}
      >
        {isAnalyzing ? (
          <>
            <span className={styles.spinner}></span>
            分析中...
          </>
        ) : (
          '执行风控分析'
        )}
      </button>
    </div>
  );
}
