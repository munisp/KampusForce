import { useEffect, useState } from "react";
import { Award, BookOpenCheck, CheckCircle2, Clock3, Lock, Play, Settings2 } from "lucide-react";
import { EmptyState, Metric, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";
import { TrainingManager } from "./TrainingManager";

/** Operations and admins manage lessons here and can preview them; everyone else takes them. */
export function TrainingWorkspace() {
  const { user } = useWorkspace();
  const canManage = ["ops", "admin"].includes(user.role);
  const [tab, setTab] = useState<"manage" | "take">(canManage ? "manage" : "take");
  if (!canManage) return <TrainingLessons />;
  return <>
    <div className="segmented training-tabs" role="tablist" aria-label="Training">
      <button type="button" role="tab" aria-selected={tab === "manage"} className={tab === "manage" ? "active" : ""} onClick={() => setTab("manage")}><Settings2 size={15} />Manage lessons</button>
      <button type="button" role="tab" aria-selected={tab === "take"} className={tab === "take" ? "active" : ""} onClick={() => setTab("take")}><BookOpenCheck size={15} />Preview as a learner</button>
    </div>
    {tab === "manage" ? <TrainingManager /> : <TrainingLessons />}
  </>;
}

function TrainingLessons() {
  const { token } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.sales.training.useQuery({ token });
  const [selectedId, setSelectedId] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const refresh = () => { utils.sales.training.invalidate(); utils.rep.productTraining.invalidate(); };
  const start = trpc.sales.startTraining.useMutation({ onSuccess: refresh });
  const submit = trpc.sales.submitTrainingAttempt.useMutation({ onSuccess: () => { setAnswers({}); refresh(); } });
  const data = query.data;
  const stateOf = (moduleId: number) => data?.progress.find((row) => row.moduleId === moduleId)?.state || "assigned";

  // Open the first lesson the person hasn't passed, rather than always the first one.
  useEffect(() => {
    if (!data || selectedId) return;
    const next = data.modules.find((module) => module.mustPass && stateOf(module.id) !== "completed") || data.modules.find((module) => stateOf(module.id) !== "completed") || data.modules[0];
    if (next) setSelectedId(next.id);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isLoading) return <Loading label="Loading training…" />;
  if (query.error) return <ErrorState message={query.error.message} retry={query.refetch} />;
  const d = data!;
  const selected = d.modules.find((module) => module.id === selectedId) || d.modules[0];
  const progress = selected ? d.progress.find((row) => row.moduleId === selected.id) : undefined;
  const started = Boolean(progress && progress.state !== "assigned");
  const choose = (moduleId: number) => { setSelectedId(moduleId); setAnswers({}); submit.reset(); start.reset(); };
  const result = submit.data && submit.data.moduleId === selected?.id ? submit.data : null;

  return <>
    <div className="sandbox-banner"><Award size={18} /><p><strong>{d.boundary}</strong> Your score shows how well you know each lesson.</p></div>
    <div className="metrics-grid">
      <Metric label="Your progress" value={`${d.metrics.readinessPercent}%`} note={`${d.metrics.completedRequired} of ${d.metrics.requiredCount} lessons you must pass`} tone="teal" />
      <Metric label="Lessons passed" value={`${d.metrics.completed} of ${d.metrics.lessons}`} note="Saved as you go" />
      <Metric label="Average best score" value={`${d.metrics.averageBestScore}%`} note="Your best result per lesson" tone="mustard" />
      <Metric label="Time to finish all" value={`${d.metrics.minutes} min`} note={`${d.metrics.lessons} short lesson${d.metrics.lessons === 1 ? "" : "s"}`} />
    </div>
    <div className="training-grid">
      <Panel title="Your lessons" className="training-catalog">{d.modules.length ? d.modules.map((module, index) => {
        const state = stateOf(module.id);
        return <button key={module.id} aria-pressed={selected?.id === module.id} className={selected?.id === module.id ? "training-module-row selected" : "training-module-row"} onClick={() => choose(module.id)}>
          <span className="training-order">{String(index + 1).padStart(2, "0")}</span>
          <span>
            <strong>{module.title}</strong>
            <small>{module.summary}</small>
            <em><Clock3 size={12} />{module.durationMinutes} min · pass {module.passingScore}% · {module.mustPass ? "must pass" : "optional"}</em>
            {module.reasons.length > 0 && <span className="training-chips">{module.reasons.map((reason) => <span key={`${reason.kind}-${reason.id}`} className={reason.kind === "product" && reason.required ? "training-chip lock" : reason.kind === "campaign" ? "training-chip campaign" : "training-chip"}>{reason.kind === "product" ? (reason.required ? <><Lock size={10} />Unlocks {reason.name}</> : `For ${reason.name}`) : `Campaign: ${reason.name}`}</span>)}</span>}
          </span>
          <StateBadge state={state} />
        </button>;
      }) : <EmptyState title="No lessons for you yet" detail="Lessons appear here when Operations adds them for you, a product or a campaign you're in." />}</Panel>
      <div>{selected ? <Panel title={selected.title} action={<StateBadge state={progress?.state || "assigned"} />}>
        <div className="training-overview"><span>{selected.category.replaceAll("_", " ")}</span><span>{selected.durationMinutes} minutes</span><span>Pass at {selected.passingScore}%</span><span>{progress?.attempts || 0} attempt{progress?.attempts === 1 ? "" : "s"}</span></div>
        {selected.blocksSelling && progress?.state !== "completed" && <p className="training-lock-note"><Lock size={15} />Pass this lesson to sell {selected.reasons.filter((r) => r.kind === "product" && r.required).map((r) => r.name).join(", ")}.</p>}
        <p className="training-summary">{selected.summary}</p>
        <div className="training-content">{selected.content.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        {!started ? <button className="button primary" onClick={() => start.mutate({ token, moduleId: selected.id })} disabled={start.isPending}><Play size={15} />{start.isPending ? "Starting…" : "Start lesson"}</button>
          : <div className="training-progress-note"><BookOpenCheck size={18} /><span>Best score <strong>{progress!.bestScore}%</strong>{progress!.completedAt ? ` · passed ${shortDate(progress!.completedAt)}` : " · take the quiz when you're ready"}</span></div>}
        {started && <form className="training-quiz" onSubmit={(event) => { event.preventDefault(); submit.mutate({ token, moduleId: selected.id, answers: selected.quizJson.map((_, index) => answers[index] ?? -1) }); }}>
          <h3>Quiz</h3>
          {selected.quizJson.map((question, questionIndex) => <fieldset key={questionIndex}><legend>{questionIndex + 1}. {question.question}</legend>{question.options.map((option, optionIndex) => <label className="quiz-option" key={optionIndex}><input type="radio" name={`question-${selected.id}-${questionIndex}`} checked={answers[questionIndex] === optionIndex} onChange={() => setAnswers({ ...answers, [questionIndex]: optionIndex })} />{option}</label>)}</fieldset>)}
          <button className="button primary" disabled={submit.isPending || selected.quizJson.some((_, index) => answers[index] === undefined)}><CheckCircle2 size={15} />{submit.isPending ? "Checking…" : "Submit answers"}</button>
        </form>}
        {result && <div className={result.passed ? "training-result passed" : "training-result"} role="status"><strong>{result.passed ? "Lesson passed" : "Not passed yet. Read the lesson again and retry."}</strong><span>{result.score}% · {result.correct} of {result.total} correct · pass mark {result.passingScore}%</span></div>}
        {(start.error || submit.error) && <p className="form-error" role="alert">{start.error?.message || submit.error?.message}</p>}
      </Panel> : null}</div>
    </div>
    {d.attempts.length > 0 && <Panel title="Recent quizzes"><div className="attempt-grid">{d.attempts.slice(0, 8).map((attempt) => <div key={attempt.id}><span>{d.modules.find((module) => module.id === attempt.moduleId)?.title || "Lesson"}</span><strong>{attempt.score}%</strong><small>{attempt.passed ? "Passed" : "Not passed"} · {shortDate(attempt.createdAt)}</small></div>)}</div></Panel>}
  </>;
}
