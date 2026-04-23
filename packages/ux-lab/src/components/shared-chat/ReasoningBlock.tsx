import React, { useMemo } from 'react';
import { EvidenceCaseTrace } from '../sparta/shared';

interface EvidenceCaseData {
  verdict: string;
  grade: string;
  gates_passed: number;
  gates_total: number;
  gate_summary: string;
  gate_trace?: Array<{ gate: string; passed: boolean; detail: string; duration?: number }>;
  control_ids: string[];
  tier: string;
  drift?: { old_verdict: string; new_verdict: string; timestamp: string };
  recall_count?: number;
  recall_breakdown?: Record<string, number>;
  source_traceability?: Record<string, number>;
  description?: string;
  answer?: string;
  response_action?: 'answer' | 'deflect' | 'clarify' | string;
}

interface ReasoningBlockProps {
  data: EvidenceCaseData;
  onNavigateToControl?: (id: string) => void;
  onNavigateToSource?: (sourceId: string) => void;
}

export default function ReasoningBlock({
  data,
  onNavigateToControl,
  onNavigateToSource,
}: ReasoningBlockProps) {
  const parsedGates = useMemo(() => {
    if (Array.isArray(data.gate_trace) && data.gate_trace.length > 0) {
      return data.gate_trace.map((g) => ({
        gate: g.gate ?? g.name ?? 'Gate',
        passed: !!g.passed,
        detail: g.detail ?? '',
        duration: g.duration,
      }));
    }
    if (!data.gate_summary) return [];
    return data.gate_summary
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [statusRaw, ...nameParts] = chunk.split(':');
        const status = (statusRaw || '').trim().toUpperCase();
        const name = nameParts.join(':').trim() || 'Gate';
        return {
          gate: name,
          passed: status === 'PASS' || status === 'PASSED' || status === 'TRUE',
          detail: '',
        };
      });
  }, [data.gate_trace, data.gate_summary]);

  return (
    <EvidenceCaseTrace
      questionNode={data.description ? <span>{data.description}</span> : <span>Evidence case for {data.control_ids.join(', ') || 'the current claim'}.</span>}
      reviewStatus={data.verdict || data.grade || 'pending'}
      confidence={null}
      formalProofSuccess={undefined}
      hasFormalProof={false}
      methods={[]}
      chains={[]}
      controlIds={data.control_ids ?? []}
      glossary={[]}
      glossaryLabel="Symbol Definitions"
      reasoning={undefined}
      agentResponse={data.answer}
      responseAction={data.response_action}
      evidenceVerdict={data.verdict}
      evidenceGrade={data.grade}
      gatesPassed={data.gates_passed}
      gatesTotal={data.gates_total}
      liveGates={parsedGates}
      error={undefined}
      onNavigateToControl={(id) => onNavigateToControl?.(id)}
    />
  );
}
