import { useState } from 'react';
import type { ExtractedOrder, RiskAssessment } from '../../types';
import { generateHandoffCardMarkdown, generateHandoffCardText, copyToClipboard } from '../../lib/generateHandoffCard';
import styles from './OutputPanel.module.css';

interface OutputPanelProps {
  extracted: ExtractedOrder | null;
  assessment: RiskAssessment | null;
  isAnalyzing: boolean;
  fallbackReason?: string;
}

export function OutputPanel({ extracted, assessment, isAnalyzing, fallbackReason }: OutputPanelProps) {
  const [copiedText, setCopiedText] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);

  if (isAnalyzing) {
    return (
      <div className={styles.outputPanel}>
        <div className={styles.loadingState}>
          <div className={styles.loadingSpinner}></div>
          <p className={styles.loadingText}>正在进行风控分析...</p>
          <p className={styles.loadingSubtext}>抽取订单字段 &rarr; 规则校验 &rarr; 风险评估</p>
        </div>
      </div>
    );
  }

  if (!extracted || !assessment) {
    return (
      <div className={styles.outputPanel}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📊</div>
          <h3 className={styles.emptyTitle}>等待分析</h3>
          <p className={styles.emptyText}>
            请在左侧输入沟通记录，点击"执行风控分析"
          </p>
          <div className={styles.featureList}>
            <div className={styles.featureItem}>AI 智能抽取订单字段</div>
            <div className={styles.featureItem}>10+ 条风控规则校验</div>
            <div className={styles.featureItem}>自动生成交接卡片</div>
          </div>
        </div>
      </div>
    );
  }

  const handleCopy = async (format: 'text' | 'markdown') => {
    const content = format === 'text'
      ? generateHandoffCardText(assessment)
      : generateHandoffCardMarkdown(assessment);

    const success = await copyToClipboard(content);
    if (success) {
      if (format === 'text') {
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 2000);
      } else {
        setCopiedMarkdown(true);
        setTimeout(() => setCopiedMarkdown(false), 2000);
      }
    }
  };

  return (
    <div className={styles.outputPanel}>
      {/* 降级提示 */}
      {fallbackReason && (
        <div className={styles.fallbackBanner}>
          <span className={styles.fallbackIcon}>ℹ️</span>
          <span className={styles.fallbackText}>{fallbackReason}</span>
        </div>
      )}

      {/* 风险等级 */}
      <div className={`${styles.riskLevel} ${styles[assessment.overall_risk_level.toLowerCase()]}`}>
        <span className={styles.riskIcon}>
          {assessment.overall_risk_level === 'HIGH' ? '🔴' :
           assessment.overall_risk_level === 'MEDIUM' ? '🟡' :
           assessment.overall_risk_level === 'LOW' ? '🟢' : '✅'}
        </span>
        <span className={styles.riskLabel}>
          风险等级: {assessment.overall_risk_level === 'HIGH' ? '高风险' :
                     assessment.overall_risk_level === 'MEDIUM' ? '中风险' :
                     assessment.overall_risk_level === 'LOW' ? '低风险' : '安全'}
        </span>
      </div>

      {/* 订单摘要 */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>订单摘要</h3>
        <div className={styles.entityList}>
          {extracted.entities.map((entity, index) => (
            <div key={index} className={styles.entityCard}>
              <div className={styles.entityHeader}>
                <span className={styles.partNumber}>{entity.part_number}</span>
                <span className={styles.quantity}>× {entity.quantity} 颗</span>
              </div>
              {entity.special_requirements.length > 0 && (
                <div className={styles.specialReqs}>
                  {entity.special_requirements.map((req, i) => (
                    <span key={i} className={styles.reqTag}>{req}</span>
                  ))}
                </div>
              )}
              {entity.requested_delivery && (
                <div className={styles.delivery}>期望交期: {entity.requested_delivery}</div>
              )}
            </div>
          ))}
        </div>
        {extracted.identified_missing_info.length > 0 && (
          <div className={styles.missingInfo}>
            <span className={styles.missingLabel}>缺失信息:</span>
            {extracted.identified_missing_info.map((info, i) => (
              <span key={i} className={styles.missingTag}>{info}</span>
            ))}
          </div>
        )}
      </div>

      {/* 风险详情 */}
      {assessment.risks.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>风险详情</h3>
          <div className={styles.riskList}>
            {assessment.risks.map((risk) => (
              <div key={risk.id} className={`${styles.riskItem} ${styles[risk.level.toLowerCase()]}`}>
                <div className={styles.riskHeader}>
                  <span className={styles.riskLevelBadge}>
                    {risk.level === 'HIGH' ? '高' : risk.level === 'MEDIUM' ? '中' : '低'}
                  </span>
                  <span className={styles.riskCategory}>{risk.category}</span>
                  <span className={styles.riskSource}>{risk.source}</span>
                </div>
                <p className={styles.riskMessage}>{risk.message}</p>
                <p className={styles.riskSuggestion}>建议: {risk.suggestion}</p>
                <p className={styles.riskOwner}>责任人: {risk.owner}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Checklist */}
      {assessment.checklist.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>发货前 Checklist</h3>
          <div className={styles.checklist}>
            {assessment.checklist.map((item) => (
              <div key={item.id} className={`${styles.checklistItem} ${styles[item.status.toLowerCase()]}`}>
                <span className={styles.checkIcon}>
                  {item.status === 'DONE' ? '✓' : item.status === 'BLOCKED' ? '✗' : '○'}
                </span>
                <span className={styles.checkText}>{item.text}</span>
                <span className={`${styles.priorityBadge} ${styles[item.priority.toLowerCase()]}`}>
                  {item.priority}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 交接卡片 */}
      <div className={styles.section}>
        <div className={styles.handoverHeader}>
          <h3 className={styles.sectionTitle}>交接卡片</h3>
          <div className={styles.copyButtons}>
            <button
              className={`${styles.copyBtn} ${copiedText ? styles.copied : ''}`}
              onClick={() => handleCopy('text')}
            >
              {copiedText ? '已复制!' : '复制纯文本'}
            </button>
            <button
              className={`${styles.copyBtnSecondary} ${copiedMarkdown ? styles.copied : ''}`}
              onClick={() => handleCopy('markdown')}
            >
              {copiedMarkdown ? '已复制!' : '复制 Markdown'}
            </button>
          </div>
        </div>
        <pre className={styles.handoverCard}>
          {generateHandoffCardText(assessment)}
        </pre>
      </div>
    </div>
  );
}
