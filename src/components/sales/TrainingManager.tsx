import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { EmptyState, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

// Operations creates lessons and decides who gets them: every rep, reps selling certain products,
// or reps in certain campaigns. A product lesson marked "must pass" locks that product until the rep passes it.

const categoryLabel: Record<string, string> = {
  conduct: "Conduct", privacy: "Privacy", sales_skills: "Sales skills", service: "Customer service", product: "Product knowledge",
};

type Question = { question: string; options: string[]; answerIndex: number };
type Draft = {
  title: string; summary: string; content: string; category: "conduct" | "privacy" | "sales_skills" | "service" | "product";
  durationMinutes: number; passingScore: number; required: boolean; forEveryone: boolean; quiz: Question[];
  products: Record<number, { selected: boolean; required: boolean }>; campaignIds: number[];
};

const emptyQuestion = (): Question => ({ question: "", options: ["", ""], answerIndex: 0 });
const emptyDraft = (): Draft => ({
  title: "", summary: "", content: "", category: "product", durationMinutes: 10, passingScore: 80, required: false, forEveryone: false,
  quiz: [emptyQuestion()], products: {}, campaignIds: [],
});

/** Mirrors the server's quiz rules so problems show before saving. */
function quizProblem(quiz: Question[]) {
  if (!quiz.length) return "Add at least one quiz question.";
  for (const [index, item] of quiz.entries()) {
    const n = index + 1;
    if (item.question.trim().length < 5) return `Question ${n} needs at least 5 characters.`;
    const options = item.options.map((option) => option.trim());
    if (options.some((option) => !option)) return `Question ${n} has an empty answer.`;
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) return `Question ${n} has the same answer twice.`;
  }
  return null;
}

export function TrainingManager() {
  const { token } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.sales.trainingAdmin.useQuery({ token });
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [notice, setNotice] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const refresh = () => { utils.sales.trainingAdmin.invalidate(); utils.sales.training.invalidate(); utils.sales.campaigns.invalidate(); };
  const done = (message: string) => { setNotice(message); setEditing(null); setDraft(emptyDraft()); refresh(); };
  const create = trpc.sales.createTrainingModule.useMutation({ onSuccess: () => done("Lesson saved. Reps it applies to can take it now.") });
  const update = trpc.sales.updateTrainingModule.useMutation({ onSuccess: () => done("Lesson updated. Reps who already passed keep their pass.") });
  const toggle = trpc.sales.setTrainingModuleActive.useMutation({ onSuccess: (r) => { setNotice(r.active ? "Lesson restored." : "Lesson archived. Reps no longer see it, and it no longer locks any product."); refresh(); } });

  const data = query.data;
  const modules = useMemo(() => (data?.modules || []).filter((module) => showArchived || module.active), [data, showArchived]);
  if (query.isLoading) return <Loading label="Loading lessons…" />;
  if (query.error) return <ErrorState message={query.error.message} retry={query.refetch} />;

  const open = (moduleId: number | "new") => {
    setNotice(""); create.reset(); update.reset();
    if (moduleId === "new") { setDraft(emptyDraft()); setEditing("new"); return; }
    const module = data!.modules.find((m) => m.id === moduleId)!;
    const products: Draft["products"] = {};
    for (const a of module.assignments) if (a.productId) products[a.productId] = { selected: true, required: a.required };
    setDraft({
      title: module.title, summary: module.summary, content: module.content, category: module.category as Draft["category"],
      durationMinutes: module.durationMinutes, passingScore: module.passingScore, required: module.required, forEveryone: module.forEveryone,
      quiz: module.quizJson.map((q) => ({ question: q.question, options: [...q.options], answerIndex: q.answerIndex })),
      products, campaignIds: module.assignments.filter((a) => a.campaignId).map((a) => a.campaignId!),
    });
    setEditing(moduleId);
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setQuestion = (index: number, patch: Partial<Question>) => set("quiz", draft.quiz.map((q, i) => i === index ? { ...q, ...patch } : q));
  const problem = quizProblem(draft.quiz);
  const pending = create.isPending || update.isPending;
  const selectedProducts = Object.entries(draft.products).filter(([, v]) => v.selected).map(([id, v]) => ({ productId: Number(id), required: v.required }));
  const nobody = !draft.forEveryone && !selectedProducts.length && !draft.campaignIds.length;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (problem) return;
    const payload = {
      token, title: draft.title, summary: draft.summary, content: draft.content, category: draft.category,
      durationMinutes: draft.durationMinutes, passingScore: draft.passingScore, required: draft.forEveryone && draft.required, forEveryone: draft.forEveryone,
      quiz: draft.quiz, products: selectedProducts, campaignIds: draft.campaignIds,
    };
    if (editing === "new") create.mutate(payload); else if (typeof editing === "number") update.mutate({ ...payload, moduleId: editing });
  };

  const editor = editing !== null && <Panel title={editing === "new" ? "New lesson" : "Edit lesson"} action={<button className="icon-button" onClick={() => setEditing(null)} aria-label="Close the editor"><X size={16} /></button>} className="training-editor">
    <form className="campaign-form" onSubmit={save}>
      <label>Title<input required minLength={3} maxLength={180} value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Selling the Kuda student account" /></label>
      <label>Summary<input required minLength={10} maxLength={400} value={draft.summary} onChange={(e) => set("summary", e.target.value)} placeholder="One line on what the rep will learn" /><small>Shown in the lesson list.</small></label>
      <label>Lesson<textarea required minLength={20} maxLength={8000} rows={8} value={draft.content} onChange={(e) => set("content", e.target.value)} placeholder="What the rep needs to know: who the product is for, what the customer must do for it to count, what never to promise." /><small>Leave a blank line between paragraphs. Never put customer details, ID numbers or passwords in a lesson.</small></label>
      <div className="form-row three">
        <label>Category<select value={draft.category} onChange={(e) => set("category", e.target.value as Draft["category"])}>{(data!.categories as readonly string[]).map((c) => <option key={c} value={c}>{categoryLabel[c] || c}</option>)}</select></label>
        <label>Minutes<input type="number" required min={1} max={240} value={draft.durationMinutes} onChange={(e) => set("durationMinutes", Number(e.target.value))} /></label>
        <label>Pass mark (%)<input type="number" required min={50} max={100} value={draft.passingScore} onChange={(e) => set("passingScore", Number(e.target.value))} /></label>
      </div>

      <fieldset className="training-audience">
        <legend>Who takes this lesson</legend>
        <div className="segmented" role="radiogroup" aria-label="Who takes this lesson">
          <button type="button" role="radio" aria-checked={!draft.forEveryone} className={!draft.forEveryone ? "active" : ""} onClick={() => set("forEveryone", false)}>Reps on the products or campaigns I tick</button>
          <button type="button" role="radio" aria-checked={draft.forEveryone} className={draft.forEveryone ? "active" : ""} onClick={() => set("forEveryone", true)}>Every rep</button>
        </div>
        <p className="panel-note">{draft.forEveryone
          ? "Every rep gets this lesson. Ticking a product can still make it a must-pass before selling that product."
          : nobody ? "Nothing is ticked yet, so no rep sees this lesson. That's fine if you'll add it to a new campaign: pick it in the campaign form."
          : "Only reps selling the ticked products, or in the ticked campaigns, get this lesson."}</p>
        {draft.forEveryone && <label className="contract-check"><input type="checkbox" checked={draft.required} onChange={(e) => set("required", e.target.checked)} />Every rep must pass it (counts towards their training progress)</label>}
        <div className="training-targets">
          <div>
            <h3>Products</h3>
            {data!.products.length ? data!.products.map((p) => {
              const row = draft.products[p.id] || { selected: false, required: true };
              return <div className="training-target" key={p.id}>
                <label className="contract-check"><input type="checkbox" checked={row.selected} onChange={(e) => set("products", { ...draft.products, [p.id]: { ...row, selected: e.target.checked } })} /><span>{p.name}<small>{p.vendorName}{p.status !== "active" ? ` · ${p.status}` : ""}</small></span></label>
                {row.selected && <label className="contract-check must-pass"><input type="checkbox" checked={row.required} onChange={(e) => set("products", { ...draft.products, [p.id]: { ...row, required: e.target.checked } })} />Must pass before selling it</label>}
              </div>;
            }) : <p className="panel-note">No products yet.</p>}
          </div>
          <div>
            <h3>Campaigns</h3>
            {data!.campaigns.length ? data!.campaigns.map((c) => <div className="training-target" key={c.id}>
              <label className="contract-check"><input type="checkbox" checked={draft.campaignIds.includes(c.id)} onChange={(e) => set("campaignIds", e.target.checked ? [...draft.campaignIds, c.id] : draft.campaignIds.filter((id) => id !== c.id))} /><span>{c.name}<small>{c.goal.replaceAll("_", " ")} · {c.state.replaceAll("_", " ")}</small></span></label>
            </div>) : <p className="panel-note">No open campaigns. You can also pick lessons when you create a campaign.</p>}
          </div>
        </div>
      </fieldset>

      <fieldset className="training-quiz-builder">
        <legend>Quiz</legend>
        <p className="panel-note">Tick the correct answer for each question. Reps never see which one is correct.</p>
        {draft.quiz.map((q, qi) => <div className="quiz-builder-question" key={qi}>
          <div className="quiz-builder-head">
            <label>Question {qi + 1}<input value={q.question} maxLength={300} onChange={(e) => setQuestion(qi, { question: e.target.value })} placeholder="e.g. When does this product pay commission?" /></label>
            {draft.quiz.length > 1 && <button type="button" className="icon-button" onClick={() => set("quiz", draft.quiz.filter((_, i) => i !== qi))} aria-label={`Remove question ${qi + 1}`}><Trash2 size={15} /></button>}
          </div>
          {q.options.map((option, oi) => <div className="quiz-builder-option" key={oi}>
            <input type="radio" name={`correct-${qi}`} checked={q.answerIndex === oi} onChange={() => setQuestion(qi, { answerIndex: oi })} aria-label={`Answer ${oi + 1} is correct`} />
            <input value={option} maxLength={200} onChange={(e) => setQuestion(qi, { options: q.options.map((o, i) => i === oi ? e.target.value : o) })} placeholder={`Answer ${oi + 1}`} aria-label={`Question ${qi + 1}, answer ${oi + 1}`} />
            {q.options.length > 2 && <button type="button" className="icon-button" onClick={() => setQuestion(qi, { options: q.options.filter((_, i) => i !== oi), answerIndex: q.answerIndex === oi ? 0 : q.answerIndex > oi ? q.answerIndex - 1 : q.answerIndex })} aria-label={`Remove answer ${oi + 1}`}><X size={14} /></button>}
          </div>)}
          {q.options.length < 6 && <button type="button" className="text-link" onClick={() => setQuestion(qi, { options: [...q.options, ""] })}><Plus size={13} />Add an answer</button>}
        </div>)}
        {draft.quiz.length < 20 && <button type="button" className="button secondary small" onClick={() => set("quiz", [...draft.quiz, emptyQuestion()])}><Plus size={14} />Add a question</button>}
      </fieldset>

      {problem && <p className="panel-note" role="status">{problem}</p>}
      {(create.error || update.error) && <p className="form-error" role="alert">{create.error?.message || update.error?.message}</p>}
      <div className="decision-actions">
        <button type="button" className="button secondary" onClick={() => setEditing(null)}>Cancel</button>
        <button className="button primary" disabled={pending || Boolean(problem)}><Check size={15} />{pending ? "Saving…" : editing === "new" ? "Save lesson" : "Save changes"}</button>
      </div>
    </form>
  </Panel>;

  return <>
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {toggle.error && <p className="form-error" role="alert">{toggle.error.message}</p>}
    {editor}
    <Panel title="Lessons" action={<div className="training-manager-actions"><label className="contract-check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label><button className="button primary small" onClick={() => open("new")}><Plus size={14} />New lesson</button></div>}>
      {modules.length ? <div className="training-admin-list">{modules.map((module) => {
        const productRows = module.assignments.filter((a) => a.productId);
        const campaignRows = module.assignments.filter((a) => a.campaignId);
        return <article key={module.id} className={module.active ? "training-admin-row" : "training-admin-row archived"}>
          <div>
            <strong>{module.title}</strong>
            <small>{categoryLabel[module.category] || module.category} · {module.durationMinutes} min · pass {module.passingScore}% · {module.quizJson.length} question{module.quizJson.length === 1 ? "" : "s"} · updated {shortDate(module.updatedAt)}</small>
            <div className="training-chips">
              {module.forEveryone && <span className="training-chip">{module.required ? "Every rep · must pass" : "Every rep"}</span>}
              {!module.forEveryone && !module.assignments.length && <span className="training-chip muted">Not given to anyone yet</span>}
              {productRows.map((a) => <span key={a.id} className={a.required ? "training-chip lock" : "training-chip"}>{a.name}{a.required ? " · must pass to sell" : ""}</span>)}
              {campaignRows.map((a) => <span key={a.id} className="training-chip campaign">Campaign: {a.name}</span>)}
              {!module.active && <span className="training-chip muted">Archived</span>}
            </div>
          </div>
          <span className="training-admin-count"><strong>{module.completions}</strong>passed</span>
          <div className="training-admin-buttons">
            <button className="button secondary small" onClick={() => open(module.id)}><Pencil size={13} />Edit</button>
            <button className="button secondary small" disabled={toggle.isPending} onClick={() => toggle.mutate({ token, moduleId: module.id, active: !module.active })}>{module.active ? <><Archive size={13} />Archive</> : <><ArchiveRestore size={13} />Restore</>}</button>
          </div>
        </article>;
      })}</div> : <EmptyState title="No lessons" detail="Create a lesson for a product or a campaign." />}
    </Panel>
  </>;
}
