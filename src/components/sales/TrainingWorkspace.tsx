import { useState } from "react";
import { Award, BookOpenCheck, CheckCircle2, Clock3, Play } from "lucide-react";
import { EmptyState, Metric, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

export function TrainingWorkspace() {
  const { token } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.sales.training.useQuery({ token });
  const [selectedId, setSelectedId] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const refresh = () => utils.sales.training.invalidate();
  const start = trpc.sales.startTraining.useMutation({ onSuccess: refresh });
  const submit = trpc.sales.submitTrainingAttempt.useMutation({ onSuccess: () => { setAnswers({}); refresh(); } });
  if (query.isLoading) return <Loading label="Preparing the sales academy…" />;
  if (query.error) return <ErrorState message={query.error.message} retry={query.refetch} />;
  const data = query.data!;
  const selected = data.modules.find((module) => module.id === selectedId) || data.modules[0];
  const progress = selected ? data.progress.find((row) => row.moduleId === selected.id) : undefined;
  return <>
    <div className="sandbox-banner"><Award size={18} /><p><strong>{data.boundary}</strong> Scores assess the internal curriculum; correct answers are never exposed in the learning payload.</p></div>
    <div className="metrics-grid"><Metric label="Required readiness" value={`${data.metrics.readinessPercent}%`} note={`${data.metrics.completedRequired} of ${data.metrics.requiredCount} required modules`} tone="teal" /><Metric label="Modules completed" value={data.metrics.completed} note="Durable learning progress" /><Metric label="Average best score" value={`${data.metrics.averageBestScore}%`} note="Best result per started module" tone="mustard" /><Metric label="Curriculum" value={`${data.modules.reduce((sum, module) => sum + module.durationMinutes, 0)} min`} note="Five concise applied modules" /></div>
    <div className="training-grid">
      <Panel title="Internal sales curriculum" className="training-catalog">{data.modules.map((module) => { const item = data.progress.find((row) => row.moduleId === module.id); return <button key={module.id} className={selected?.id === module.id ? "training-module-row selected" : "training-module-row"} onClick={() => { setSelectedId(module.id); setAnswers({}); }}><span className="training-order">{String(module.sortOrder).padStart(2, "0")}</span><span><strong>{module.title}</strong><small>{module.summary}</small><em><Clock3 size={12} />{module.durationMinutes} min · pass {module.passingScore}% · {module.required ? "required" : "optional"}</em></span><StateBadge state={item?.state || "assigned"} /></button>; })}</Panel>
      <div>{selected ? <Panel title={selected.title} action={progress ? <StateBadge state={progress.state} /> : null}>
        <div className="training-overview"><span>{selected.category.replaceAll("_", " ")}</span><span>{selected.durationMinutes} minutes</span><span>Pass at {selected.passingScore}%</span><span>{progress?.attempts || 0} attempts</span></div>
        <p className="training-summary">{selected.summary}</p><p className="training-content">{selected.content}</p>
        {progress?.state === "assigned" || !progress ? <button className="button primary" onClick={() => start.mutate({ token, moduleId: selected.id })} disabled={start.isPending}><Play size={15} />Start module</button> : <div className="training-progress-note"><BookOpenCheck size={18} /><span>Best score <strong>{progress.bestScore}%</strong>{progress.completedAt ? ` · completed ${shortDate(progress.completedAt)}` : " · quiz ready when you are"}</span></div>}
        <form className="training-quiz" onSubmit={(event) => { event.preventDefault(); submit.mutate({ token, moduleId: selected.id, answers: selected.quizJson.map((_, index) => answers[index] ?? -1) }); }}><h3>Applied knowledge check</h3>{selected.quizJson.map((question, questionIndex) => <fieldset key={question.question}><legend>{questionIndex + 1}. {question.question}</legend>{question.options.map((option, optionIndex) => <label className="quiz-option" key={option}><input type="radio" name={`question-${questionIndex}`} checked={answers[questionIndex] === optionIndex} onChange={() => setAnswers({ ...answers, [questionIndex]: optionIndex })} />{option}</label>)}</fieldset>)}<button className="button primary" disabled={submit.isPending || selected.quizJson.some((_, index) => answers[index] === undefined)}><CheckCircle2 size={15} />Submit assessment</button></form>
        {submit.data && <div className={submit.data.passed ? "training-result passed" : "training-result"}><strong>{submit.data.passed ? "Module complete" : "Review and retry"}</strong><span>{submit.data.score}% · {submit.data.correct}/{submit.data.total} correct · pass mark {submit.data.passingScore}%</span></div>}
        {(start.error || submit.error) && <p className="form-error">{start.error?.message || submit.error?.message}</p>}
      </Panel> : <Panel title="Module"><EmptyState title="No training modules" detail="The internal catalog has not been initialized." /></Panel>}</div>
    </div>
    {data.attempts.length > 0 && <Panel title="Recent assessment history"><div className="attempt-grid">{data.attempts.slice(0, 8).map((attempt) => <div key={attempt.id}><span>{data.modules.find((module) => module.id === attempt.moduleId)?.title || "Module"}</span><strong>{attempt.score}%</strong><small>{attempt.passed ? "Passed" : "Retry"} · {shortDate(attempt.createdAt)}</small></div>)}</div></Panel>}
  </>;
}
