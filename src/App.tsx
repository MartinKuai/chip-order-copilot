import { useState, useCallback } from 'react';
import { InputPanel } from './components/InputPanel/InputPanel';
import { OutputPanel } from './components/OutputPanel/OutputPanel';
import { extractOrderInfo } from './lib/extractOrderInfo';
import { runRiskEngine } from './lib/riskRules';
import type { DataSource, ExtractedOrder, RiskAssessment } from './types';
import './App.css';

/**
 * 校验 API 响应是否有效
 */
function isValidAnalysisResponse(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const res = response as Record<string, unknown>;

  if (!res.success || !res.data) return false;
  const data = res.data as Record<string, unknown>;

  if (!data.extracted || !data.assessment) return false;

  const extracted = data.extracted as Record<string, unknown>;
  const assessment = data.assessment as Record<string, unknown>;

  // 检查必要字段
  if (!Array.isArray(extracted.entities)) return false;
  if (!Array.isArray(assessment.risks)) return false;
  if (!Array.isArray(assessment.checklist)) return false;
  if (!assessment.handover_card) return false;

  const handoverCard = assessment.handover_card as Record<string, unknown>;
  if (typeof handoverCard.should_ship !== 'boolean') return false;
  if (typeof handoverCard.ship_conclusion !== 'string') return false;
  if (!Array.isArray(handoverCard.missing_info)) return false;

  // 检查是否为空 SAFE Mock（无效响应）
  if (
    assessment.overall_risk_level === 'SAFE' &&
    extracted.entities.length === 0 &&
    assessment.risks.length === 0
  ) {
    const rawSummary = String(extracted.raw_summary ?? '');
    if (rawSummary.includes('Mock') || rawSummary.includes('MOCK')) {
      return false;
    }
  }

  return true;
}

function App() {
  const [extracted, setExtracted] = useState<ExtractedOrder | null>(null);
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | undefined>(undefined);

  const handleAnalyze = useCallback(async (chatRecord: string, dataSource: DataSource) => {
    setIsAnalyzing(true);
    setError(null);
    setExtracted(null);
    setAssessment(null);
    setFallbackReason(undefined);

    try {
      // 1. 首先尝试调用 API
      let apiResult = null;
      let usedFallback = false;

      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_record: chatRecord,
            data_source: dataSource,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const rawResult = await response.json();
          // 校验响应有效性
          if (isValidAnalysisResponse(rawResult)) {
            apiResult = rawResult;
          } else {
            usedFallback = true;
          }
        } else {
          usedFallback = true;
        }
      } catch {
        usedFallback = true;
      }

      // 2. 如果 API 成功且有效，使用 API 结果
      if (apiResult?.success && apiResult.data) {
        setExtracted(apiResult.data.extracted);
        setAssessment(apiResult.data.assessment);
        setFallbackReason('已通过 API 服务分析');
      } else {
        // 3. 使用本地规则引擎（兜底）
        const extractedResult = extractOrderInfo(chatRecord);
        setExtracted(extractedResult);

        const orders = dataSource.orders || [];
        const inventory = dataSource.inventory || [];
        const prices = dataSource.prices || [];

        const assessmentResult = runRiskEngine(extractedResult, orders, inventory, prices);
        setAssessment(assessmentResult);

        if (usedFallback) {
          setFallbackReason('模型/API 不可用，已使用本地规则引擎完成分析');
        }
      }
    } catch (err) {
      console.error('分析失败:', err);
      setError(err instanceof Error ? err.message : '分析过程中发生错误');
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="headerContent">
          <div className="logo">
            <span className="logoText">
              <h1 className="logoTitle">Chip Order Copilot</h1>
              <p className="logoSubtitle">芯片代理商 B2B 订单交接与发货前风控 Agent</p>
            </span>
          </div>
          <div className="headerBadge">
            <span className="badge">MVP v1.0</span>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="workspace">
          <div className="inputSection">
            <InputPanel onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} />
          </div>
          <div className="outputSection">
            <OutputPanel
              extracted={extracted}
              assessment={assessment}
              isAnalyzing={isAnalyzing}
              fallbackReason={fallbackReason}
            />
          </div>
        </div>

        {error && (
          <div className="errorBanner">
            <span className="errorText">{error}</span>
            <button className="errorClose" onClick={() => setError(null)}>x</button>
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Chip Order Copilot - 芯片代理商订单风控 AI 助手 | 规则引擎独立运行，无需 LLM API</p>
      </footer>
    </div>
  );
}

export default App;
