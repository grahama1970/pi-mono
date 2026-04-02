import { useState, useEffect } from 'react'
import { Plus, Upload, Play, Trash2, Pencil } from 'lucide-react'
import { EMBRY, label, card } from '../../common/EmbryStyle'
import { useRegisterAction } from '../../../../hooks/useRegisterAction'

import { API, MONO } from './types'
import type { Project, EvalQuestion } from './types'
import { GateCard, thStyle, tdStyle, statusBadge, btnOutline, rerunInputStyle, filterSelect } from './shared'

export function EvaluateTab({ project }: { project: Project }) {
  const [questions, setQuestions] = useState<EvalQuestion[]>([])
  const [results, setResults] = useState<EvalQuestion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editExpected, setEditExpected] = useState('')
  const [newText, setNewText] = useState('')
  const [newExpected, setNewExpected] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importData, setImportData] = useState('')
  const [importFormat, setImportFormat] = useState<'csv' | 'jsonl'>('jsonl')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/projects/classifier-lab/eval-questions/${project.id}`)
      .then(r => r.json())
      .then(d => {
        setQuestions(d.questions || [])
        if (d.results && Array.isArray(d.results)) setResults(d.results)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [project.id])

  const [classes, setClasses] = useState<string[]>([])
  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/eval-results/${project.id}`)
      .then(r => r.json())
      .then(d => { if (d.classes) setClasses(d.classes) })
      .catch(() => {})
  }, [project.id])

  const saveQuestions = async (qs: EvalQuestion[]) => {
    setSaving(true)
    setQuestions(qs)
    await fetch(`${API}/projects/classifier-lab/eval-questions/${project.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: qs }),
    }).catch(() => {})
    setSaving(false)
  }

  const addQuestion = () => {
    if (!newText.trim() || !newExpected.trim()) return
    const q: EvalQuestion = { id: `q_${Date.now()}`, text: newText.trim(), expected: newExpected.trim() }
    saveQuestions([...questions, q])
    setNewText('')
    setNewExpected('')
  }

  const deleteQuestion = (id: string) => saveQuestions(questions.filter(q => q.id !== id))

  const saveEdit = (id: string) => {
    saveQuestions(questions.map(q => q.id === id ? { ...q, text: editText, expected: editExpected } : q))
    setEditingId(null)
  }

  const importQuestions = async () => {
    if (!importData.trim()) return
    setSaving(true)
    const resp = await fetch(`${API}/projects/classifier-lab/eval-questions/${project.id}/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: importFormat, data: importData }),
    }).then(r => r.json()).catch(() => null)
    if (resp?.ok) {
      const d = await fetch(`${API}/projects/classifier-lab/eval-questions/${project.id}`).then(r => r.json())
      setQuestions(d.questions || [])
      setImportData('')
      setShowImport(false)
    }
    setSaving(false)
  }

  const runEval = async () => {
    setRunning(true)
    const resp = await fetch(`${API}/projects/classifier-lab/eval-questions/${project.id}/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }).then(r => r.json()).catch(() => null)
    if (resp?.results) {
      setResults(resp.results)
    }
    setRunning(false)
  }

  const APP = 'classifier-lab'
  useRegisterAction('clf-eval:btn', { app: APP, action: 'CLF_EVAL_RUN', label: 'Run Evaluation', description: 'Run inference on all test questions and compare predicted vs expected classes' })
  useRegisterAction('clf-eval:import', { app: APP, action: 'CLF_EVAL_IMPORT', label: 'Import Questions', description: 'Import evaluation questions from CSV or JSONL' })
  useRegisterAction('clf-eval:new-question-text', { app: APP, action: 'CLF_EVAL_SET_QUESTION_TEXT', label: 'Set Question Text', description: 'Type a test input for the classifier', params: { text: { type: 'string' } } })
  useRegisterAction('clf-eval:expected-class', { app: APP, action: 'CLF_EVAL_SET_EXPECTED_CLASS', label: 'Set Expected Class', description: 'Set the expected classification result', params: { class: { type: 'string' } } })
  useRegisterAction('clf-eval:edit-row', { app: APP, action: 'CLF_EVAL_EDIT_QUESTION', label: 'Edit Question', description: 'Edit or delete an evaluation question' })
  useRegisterAction('clf-eval:save', { app: APP, action: 'CLF_EVAL_SAVE_EDIT', label: 'Save Edit', description: 'Save changes to evaluation question' })

  const evaluated = results && results.some(r => r.predicted !== null && r.predicted !== undefined)
  const passCount = evaluated ? results!.filter(r => r.passed).length : 0
  const failCount = evaluated ? results!.filter(r => r.passed === false).length : 0
  const totalQ = questions.length

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading test suite...</div>

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="EVAL GATE"
          passed={evaluated ? failCount === 0 : false}
          metrics={[
            { label: 'QUESTIONS', value: String(totalQ) },
            { label: 'PASSED', value: evaluated ? String(passCount) : '—', color: passCount > 0 ? EMBRY.green : EMBRY.dim },
            { label: 'FAILED', value: evaluated ? String(failCount) : '—', color: failCount > 0 ? EMBRY.red : EMBRY.dim },
          ]}
          checks={[
            { label: 'Test suite has questions', ok: totalQ > 0, detail: `${totalQ} questions` },
            { label: 'Evaluation run', ok: !!evaluated, detail: evaluated ? 'Yes' : 'Not yet' },
            { label: 'All questions passed', ok: evaluated ? failCount === 0 : false, detail: evaluated ? (failCount === 0 ? 'Yes' : `${failCount} failed`) : '—' },
          ]}
          halt={evaluated && failCount > 0 ? {
            reason: `${failCount} of ${totalQ} test questions failed. The model is not classifying correctly for these inputs.`,
            action: `Review the failed questions below. Either fix the model (retrain from Train tab) or fix the questions (edit expected class if the label was wrong).`,
          } : totalQ === 0 ? {
            reason: 'No evaluation questions defined. Cannot assess model quality without test cases.',
            action: 'Add test questions below — type examples of each class and what the model should predict. Or import a batch from CSV/JSONL.',
          } : null}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ ...label, fontSize: 11 }}>TEST SUITE — {totalQ} questions</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button data-qid="clf-eval:import" data-qs-action="CLF_EVAL_IMPORT" title="Import evaluation questions from file" onClick={() => setShowImport(!showImport)} style={{ ...btnOutline, fontSize: 9, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Upload size={10} /> IMPORT
          </button>
          <button data-qid="clf-eval:btn" data-qs-action="CLF_EVAL_RUN" title="Run inference on all test questions"
            onClick={runEval}
            disabled={running || totalQ === 0}
            style={{
              background: totalQ > 0 ? EMBRY.accent : 'transparent',
              border: `1px solid ${totalQ > 0 ? EMBRY.accent : EMBRY.border}`,
              color: totalQ > 0 ? '#000' : EMBRY.dim,
              padding: '4px 14px', borderRadius: 6, fontSize: 10, fontWeight: 900, cursor: totalQ > 0 ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <Play size={10} /> {running ? 'RUNNING...' : totalQ === 0 ? 'ADD QUESTIONS FIRST' : 'RUN EVALUATION'}
          </button>
        </div>
      </div>

      {showImport && (
        <div style={{ ...card, marginBottom: 16, padding: 16 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'center' }}>
            <div style={label}>IMPORT QUESTIONS</div>
            <select data-qid="clf-eval:import-format" data-qs-action="CLF_EVAL_SET_FORMAT" title="Select import format: JSONL or CSV" value={importFormat} onChange={e => setImportFormat(e.target.value as 'csv' | 'jsonl')} style={filterSelect}>
              <option value="jsonl">JSONL (one JSON per line)</option>
              <option value="csv">CSV (text,expected)</option>
            </select>
          </div>
          <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 8 }}>
            {importFormat === 'jsonl'
              ? 'Each line: {"text": "...", "expected": "Business"} — also accepts "class", "label", "question", "input" field names'
              : 'First row is header. Columns: text,expected'}
          </div>
          <textarea data-qid="clf-eval:import-data" data-qs-action="CLF_EVAL_SET_IMPORT_DATA" title="Paste evaluation questions data"
            value={importData}
            onChange={e => setImportData(e.target.value)}
            placeholder={importFormat === 'jsonl'
              ? '{"text": "Apple stock rises 5%", "expected": "Business"}\n{"text": "Lakers win championship", "expected": "Sports"}'
              : 'text,expected\n"Apple stock rises 5%",Business\n"Lakers win championship",Sports'}
            style={{
              width: '100%', minHeight: 120, resize: 'vertical',
              background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 4,
              color: EMBRY.white, fontFamily: MONO, fontSize: 10, lineHeight: 1.5,
              padding: 10, outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button data-qid="clf-eval:cancel" data-qs-action="CLF_EVAL_CONFIRM_IMPORT" title="Confirm and import questions" onClick={importQuestions} disabled={saving || !importData.trim()} style={{ ...btnOutline, borderColor: EMBRY.accent + '66', color: EMBRY.accent, fontSize: 9, padding: '4px 12px' }}>
              {saving ? 'IMPORTING...' : 'IMPORT'}
            </button>
            <button data-qid="clf-eval:cancel" data-qs-action="CLF_EVAL_CANCEL_IMPORT" title="Cancel import" onClick={() => setShowImport(false)} style={{ ...btnOutline, fontSize: 9, padding: '4px 12px' }}>CANCEL</button>
          </div>
        </div>
      )}

      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
              <th style={{ ...thStyle, width: 40 }}>#</th>
              <th style={thStyle}>INPUT TEXT</th>
              <th style={{ ...thStyle, width: 120 }}>EXPECTED</th>
              {evaluated && <th style={{ ...thStyle, width: 120 }}>PREDICTED</th>}
              {evaluated && <th style={{ ...thStyle, width: 60, textAlign: 'center' }}>RESULT</th>}
              <th style={{ ...thStyle, width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {questions.map((q, i) => {
              const r = results?.find(r => r.id === q.id)
              const isEditing = editingId === q.id
              return (
                <tr key={q.id} style={{ borderBottom: `1px solid ${EMBRY.border}`, background: r?.passed === false ? 'rgba(255,68,68,0.03)' : 'transparent' }}>
                  <td style={{ ...tdStyle, color: EMBRY.muted, width: 40 }}>{i + 1}</td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <input data-qid="clf-eval:edit-text" data-qs-action="CLF_EVAL_EDIT_TEXT" title="Edit question text" value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveEdit(q.id)}
                        style={{ ...rerunInputStyle, fontSize: 10, padding: '4px 8px' }} autoFocus />
                    ) : (
                      <span style={{ fontSize: 10 }}>{q.text}</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, width: 120 }}>
                    {isEditing ? (
                      classes.length > 0 ? (
                        <select data-qid="clf-eval:expected-class" data-qs-action="CLF_EVAL_SET_EXPECTED_CLASS" title="Set expected class for this question" value={editExpected} onChange={e => setEditExpected(e.target.value)} style={{ ...filterSelect, fontSize: 10 }}>
                          {classes.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <input data-qid="clf-eval:edit-expected" data-qs-action="CLF_EVAL_SET_EXPECTED_CLASS" title="Set expected class name" value={editExpected} onChange={e => setEditExpected(e.target.value)} style={{ ...rerunInputStyle, fontSize: 10, padding: '4px 8px' }} />
                      )
                    ) : (
                      <span style={{ fontSize: 10, fontFamily: MONO }}>{q.expected}</span>
                    )}
                  </td>
                  {evaluated && (
                    <td style={{ ...tdStyle, width: 120, fontFamily: MONO, fontSize: 10, color: r?.predicted ? (r.passed ? EMBRY.green : EMBRY.red) : EMBRY.muted }}>
                      {r?.predicted || '—'}
                    </td>
                  )}
                  {evaluated && (
                    <td style={{ textAlign: 'center', padding: '8px 4px' }}>
                      {r?.passed !== null && r?.passed !== undefined ? (
                        <span style={{ ...statusBadge, fontSize: 8, background: r.passed ? 'rgba(0,255,136,0.1)' : 'rgba(255,68,68,0.1)', color: r.passed ? EMBRY.green : EMBRY.red }}>
                          {r.passed ? 'PASS' : 'FAIL'}
                        </span>
                      ) : <span style={{ fontSize: 8, color: EMBRY.muted }}>—</span>}
                    </td>
                  )}
                  <td style={{ ...tdStyle, width: 60 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {isEditing ? (
                        <button data-qid="clf-eval:save" data-qs-action="CLF_EVAL_SAVE_EDIT" title="Save question edit" onClick={() => saveEdit(q.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: EMBRY.green, fontSize: 10, fontWeight: 700 }}>SAVE</button>
                      ) : (
                        <>
                          <button data-qid="clf-eval:edit-row" data-qs-action="CLF_EVAL_EDIT_QUESTION" title="Edit this question" onClick={() => { setEditingId(q.id); setEditText(q.text); setEditExpected(q.expected) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                            <Pencil size={10} color={EMBRY.dim} />
                          </button>
                          <button data-qid="clf-eval:edit-row" data-qs-action="CLF_EVAL_DELETE_QUESTION" title="Delete this question" onClick={() => deleteQuestion(q.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                            <Trash2 size={10} color={EMBRY.dim} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {questions.length === 0 && (
              <tr>
                <td colSpan={evaluated ? 6 : 4} style={{ padding: 32, textAlign: 'center', color: EMBRY.dim, fontSize: 11 }}>
                  No evaluation questions yet. Add them below or import a batch.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ ...card, padding: 12, display: 'flex', gap: 10, alignItems: 'end' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8, color: EMBRY.muted, marginBottom: 4 }}>INPUT TEXT</div>
          <input data-qid="clf-eval:new-question-text" data-qs-action="CLF_EVAL_SET_QUESTION_TEXT" title="Type a test input for the classifier"
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addQuestion()}
            placeholder="Type a test input for the classifier..."
            style={rerunInputStyle}
          />
        </div>
        <div style={{ width: 150 }}>
          <div style={{ fontSize: 8, color: EMBRY.muted, marginBottom: 4 }}>EXPECTED CLASS</div>
          {classes.length > 0 ? (
            <select data-qid="clf-eval:expected-class" data-qs-action="CLF_EVAL_SET_EXPECTED_CLASS" title="Select the expected classification" value={newExpected} onChange={e => setNewExpected(e.target.value)} style={{ ...filterSelect, width: '100%', padding: '8px 10px' }}>
              <option value="">Select...</option>
              {classes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <input data-qid="clf-eval:new-question-expected" data-qs-action="CLF_EVAL_SET_EXPECTED_CLASS" title="Type expected class name"
              value={newExpected}
              onChange={e => setNewExpected(e.target.value)}
              placeholder="Class name"
              style={rerunInputStyle}
            />
          )}
        </div>
        <button data-qid="clf-eval:btn" data-qs-action="CLF_EVAL_ADD_QUESTION" title="Add new evaluation question" onClick={addQuestion} disabled={!newText.trim() || !newExpected.trim()} style={{
          background: newText.trim() && newExpected.trim() ? EMBRY.accent : 'transparent',
          border: `1px solid ${newText.trim() && newExpected.trim() ? EMBRY.accent : EMBRY.border}`,
          color: newText.trim() && newExpected.trim() ? '#000' : EMBRY.dim,
          padding: '8px 16px', borderRadius: 6, fontSize: 10, fontWeight: 900, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
        }}>
          <Plus size={12} /> ADD
        </button>
      </div>
    </div>
  )
}
