import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type {
  PersonalPlannerState,
  PlannerGoalItem,
  PlannerHorizon,
  StruggleEntry,
} from '../types/finance';

interface PlannerNotesViewProps {
  plannerState: PersonalPlannerState;
  onUpdatePlannerState: (next: PersonalPlannerState) => void;
}

const HORIZON_META: Array<{
  id: PlannerHorizon;
  label: string;
  shortLabel: string;
  prompt: string;
}> = [
  {
    id: 'yearly',
    label: 'Yearly Goals',
    shortLabel: 'Yearly',
    prompt: 'Major 12-month savings milestones (e.g., emergency buffer, ISA allowance, debt-free date)',
  },
  {
    id: 'monthly',
    label: 'Monthly Goals',
    shortLabel: 'Monthly',
    prompt: 'Category caps to hold, bills to renegotiate, and monthly savings transfer targets',
  },
  {
    id: 'weekly',
    label: 'Weekly Goals',
    shortLabel: 'Weekly',
    prompt: 'Meal prep, grocery budget switches, and weekly zero-spend day targets',
  },
  {
    id: 'daily',
    label: 'Daily Goals',
    shortLabel: 'Daily',
    prompt: 'Small daily habits that stop impulse leaks (home coffee, packed lunch, 48h cart pause)',
  },
];

export const PlannerNotesView: React.FC<PlannerNotesViewProps> = ({
  plannerState,
  onUpdatePlannerState,
}) => {
  // Commitment declaration local draft
  const [declaration, setDeclaration] = useState(plannerState.commitmentDeclaration);
  const [signedName, setSignedName] = useState(plannerState.commitmentSignedName);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Sync draft when vault is restored/reset
  useEffect(() => {
    setDeclaration(plannerState.commitmentDeclaration);
    setSignedName(plannerState.commitmentSignedName);
  }, [plannerState.commitmentDeclaration, plannerState.commitmentSignedName]);

  // Struggles log form
  const [triggerInput, setTriggerInput] = useState('');
  const [responseInput, setResponseInput] = useState('');

  // Multi-horizon planner state
  const [activeHorizon, setActiveHorizon] = useState<PlannerHorizon | 'all'>('all');
  const [newGoalHorizon, setNewGoalHorizon] = useState<PlannerHorizon>('monthly');
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalNote, setNewGoalNote] = useState('');

  const declarationDirty =
    declaration !== plannerState.commitmentDeclaration ||
    signedName !== plannerState.commitmentSignedName;

  const handleSaveDeclaration = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdatePlannerState({
      ...plannerState,
      commitmentDeclaration: declaration.trim(),
      commitmentSignedName: signedName.trim() || 'Personal Commitment',
      commitmentUpdatedAt: new Date().toISOString().slice(0, 10),
    });
    setSavedNotice('Personal commitment declaration saved locally inside your encrypted vault.');
    window.setTimeout(() => setSavedNotice(null), 4000);
  };

  const handleAddStruggle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!triggerInput.trim()) return;
    const entry: StruggleEntry = {
      id: `strug-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      trigger: triggerInput.trim(),
      responsePlan:
        responseInput.trim() || 'Pause for 24 hours and review my commitment declaration.',
    };
    onUpdatePlannerState({
      ...plannerState,
      struggles: [entry, ...plannerState.struggles],
    });
    setTriggerInput('');
    setResponseInput('');
  };

  const handleDeleteStruggle = (id: string) => {
    onUpdatePlannerState({
      ...plannerState,
      struggles: plannerState.struggles.filter((s) => s.id !== id),
    });
  };

  const handleAddGoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoalTitle.trim()) return;
    const targetHorizon: PlannerHorizon =
      activeHorizon === 'all' ? newGoalHorizon : activeHorizon;
    const item: PlannerGoalItem = {
      id: `pg-${Date.now()}`,
      horizon: targetHorizon,
      title: newGoalTitle.trim(),
      targetNote: newGoalNote.trim(),
      completed: false,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    onUpdatePlannerState({
      ...plannerState,
      plannerGoals: [item, ...plannerState.plannerGoals],
    });
    setNewGoalTitle('');
    setNewGoalNote('');
  };

  const handleToggleGoal = (id: string) => {
    onUpdatePlannerState({
      ...plannerState,
      plannerGoals: plannerState.plannerGoals.map((g) =>
        g.id === id ? { ...g, completed: !g.completed } : g
      ),
    });
  };

  const handleDeleteGoal = (id: string) => {
    onUpdatePlannerState({
      ...plannerState,
      plannerGoals: plannerState.plannerGoals.filter((g) => g.id !== id),
    });
  };

  const handleResetDailyGoals = () => {
    onUpdatePlannerState({
      ...plannerState,
      plannerGoals: plannerState.plannerGoals.map((g) =>
        g.horizon === 'daily' ? { ...g, completed: false } : g
      ),
    });
  };

  const horizonStats = useMemo(() => {
    const stats: Record<PlannerHorizon, { total: number; done: number }> = {
      yearly: { total: 0, done: 0 },
      monthly: { total: 0, done: 0 },
      weekly: { total: 0, done: 0 },
      daily: { total: 0, done: 0 },
    };
    for (const g of plannerState.plannerGoals) {
      stats[g.horizon].total += 1;
      if (g.completed) stats[g.horizon].done += 1;
    }
    return stats;
  }, [plannerState.plannerGoals]);

  const horizonsToRender =
    activeHorizon === 'all'
      ? HORIZON_META
      : HORIZON_META.filter((h) => h.id === activeHorizon);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Commitment Notes &amp; Goal Planner
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Personal commitment declaration &amp; spending struggles</span>
            <span aria-hidden="true">·</span>
            <span>Yearly, monthly, weekly, and daily action planner</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              Encrypted locally · Never sent to AI
            </span>
          </div>
        </div>
      </div>

      {savedNotice && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 flex items-center gap-2 text-xs font-medium text-teal-900 dark:text-teal-200"
        >
          <CheckCircle2 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* Section 1: Personal Commitment Declaration + Struggles Journal */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Personal Commitment Declaration */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Personal Commitment Declaration
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Your written anchor for why saving matters and what boundaries you are keeping
              </p>
            </div>
            {plannerState.commitmentUpdatedAt && (
              <span className="text-[11px] font-mono-num text-slate-400 shrink-0">
                Updated {plannerState.commitmentUpdatedAt}
              </span>
            )}
          </div>

          <form onSubmit={handleSaveDeclaration} className="space-y-3">
            <div>
              <label htmlFor="commitment-textarea" className="sr-only">
                Personal commitment declaration
              </label>
              <textarea
                id="commitment-textarea"
                rows={5}
                value={declaration}
                onChange={(e) => setDeclaration(e.target.value)}
                placeholder="Write your personal commitment to your financial future..."
                className="w-full p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 leading-relaxed placeholder:text-slate-400 resize-y"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1">
                <label
                  htmlFor="commitment-signature"
                  className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                >
                  Signed / Label
                </label>
                <input
                  id="commitment-signature"
                  type="text"
                  value={signedName}
                  onChange={(e) => setSignedName(e.target.value)}
                  placeholder="Your name or household pledge title"
                  className="w-full min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <button
                type="submit"
                disabled={!declarationDirty}
                className="sm:self-end min-h-[38px] px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Save Declaration
              </button>
            </div>
          </form>
        </section>

        {/* Struggles & Friction Journal */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Struggles &amp; Counter-Plans
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Record moments or habits that make saving hard, paired with a practical counter-step
            </p>
          </div>

          <form onSubmit={handleAddStruggle} className="space-y-2.5">
            <input
              type="text"
              value={triggerInput}
              onChange={(e) => setTriggerInput(e.target.value)}
              placeholder="Struggle or spending trigger (e.g., Friday evening takeaway fatigue)..."
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={responseInput}
                onChange={(e) => setResponseInput(e.target.value)}
                placeholder="Counter-plan (e.g., Keep quick pasta & freezer backup ready)"
                className="flex-1 min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
              <button
                type="submit"
                disabled={!triggerInput.trim()}
                className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 disabled:opacity-40 text-xs font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Log Struggle
              </button>
            </div>
          </form>

          {plannerState.struggles.length === 0 ? (
            <p className="py-4 text-xs text-slate-500 dark:text-slate-400 text-center">
              No struggles logged yet. Writing down friction points helps spot repeat patterns.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
              {plannerState.struggles.map((item) => (
                <div
                  key={item.id}
                  className="py-3 first:pt-1 last:pb-0 flex items-start justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <p className="text-xs font-medium text-slate-900 dark:text-slate-100 leading-snug">
                      {item.trigger}
                    </p>
                    <p className="text-xs text-teal-700 dark:text-teal-400 leading-snug">
                      Plan: {item.responsePlan}
                    </p>
                    <p className="text-[11px] font-mono-num text-slate-400">{item.date}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteStruggle(item.id)}
                    aria-label="Remove struggle entry"
                    className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Section 2: Multi-Horizon Goal Planner (Yearly / Monthly / Weekly / Daily) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Yearly, Monthly, Weekly &amp; Daily Goals Planner
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Break your long-term savings ambition into concrete monthly, weekly, and daily actions
            </p>
          </div>

          <div
            className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto max-w-full"
            role="group"
            aria-label="Filter planner by time horizon"
          >
            <button
              type="button"
              onClick={() => setActiveHorizon('all')}
              className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeHorizon === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              All Horizons
            </button>
            {HORIZON_META.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  setActiveHorizon(h.id);
                  setNewGoalHorizon(h.id);
                }}
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeHorizon === h.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {h.shortLabel} ({horizonStats[h.id].done}/{horizonStats[h.id].total})
              </button>
            ))}
          </div>
        </div>

        {/* Add New Planner Goal Form */}
        <form
          onSubmit={handleAddGoal}
          className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
        >
          <div className="md:col-span-2">
            <label
              htmlFor="planner-goal-horizon"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Time Horizon
            </label>
            <select
              id="planner-goal-horizon"
              value={activeHorizon === 'all' ? newGoalHorizon : activeHorizon}
              onChange={(e) => {
                const h = e.target.value as PlannerHorizon;
                setNewGoalHorizon(h);
                if (activeHorizon !== 'all') setActiveHorizon(h);
              }}
              className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-slate-100"
            >
              <option value="yearly">Yearly</option>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </select>
          </div>

          <div className="md:col-span-5">
            <label
              htmlFor="planner-goal-title"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Goal / Action Commitment
            </label>
            <input
              id="planner-goal-title"
              type="text"
              value={newGoalTitle}
              onChange={(e) => setNewGoalTitle(e.target.value)}
              placeholder="e.g., Transfer £400 to Cash ISA on payday"
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          <div className="md:col-span-3">
            <label
              htmlFor="planner-goal-note"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Target / Metric (Optional)
            </label>
            <input
              id="planner-goal-note"
              type="text"
              value={newGoalNote}
              onChange={(e) => setNewGoalNote(e.target.value)}
              placeholder="e.g., £4,800/yr total"
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={!newGoalTitle.trim()}
              className="w-full min-h-[40px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Goal
            </button>
          </div>
        </form>

        {/* Horizon Columns / List */}
        <div
          className={`grid grid-cols-1 ${
            activeHorizon === 'all' ? 'md:grid-cols-2' : ''
          } gap-6`}
        >
          {horizonsToRender.map((horizon) => {
            const items = plannerState.plannerGoals.filter(
              (g) => g.horizon === horizon.id
            );
            const doneCount = items.filter((g) => g.completed).length;
            const pct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

            return (
              <div
                key={horizon.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {horizon.label}
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {horizon.prompt}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono-num font-semibold text-teal-700 dark:text-teal-400">
                        {doneCount}/{items.length}
                      </span>
                      {horizon.id === 'daily' && doneCount > 0 && (
                        <button
                          type="button"
                          onClick={handleResetDailyGoals}
                          title="Reset daily checklist for a new day"
                          className="text-[11px] inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reset
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Horizon Progress Bar */}
                  <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-teal-600 dark:bg-teal-500 transition-[width] duration-200"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {items.length === 0 ? (
                    <p className="py-4 text-xs text-slate-400 dark:text-slate-500 text-center">
                      No {horizon.shortLabel.toLowerCase()} goals added yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {items.map((goal) => (
                        <li
                          key={goal.id}
                          className="py-2.5 first:pt-1 last:pb-0 flex items-start justify-between gap-3"
                        >
                          <button
                            type="button"
                            onClick={() => handleToggleGoal(goal.id)}
                            className="flex items-start gap-2.5 text-left min-w-0 flex-1 cursor-pointer"
                          >
                            <span
                              className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                goal.completed
                                  ? 'bg-teal-700 border-teal-700 text-white'
                                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
                              }`}
                            >
                              {goal.completed && <Check className="w-3 h-3" />}
                            </span>
                            <div className="min-w-0">
                              <p
                                className={`text-sm leading-snug ${
                                  goal.completed
                                    ? 'line-through text-slate-400 dark:text-slate-500'
                                    : 'text-slate-900 dark:text-slate-100'
                                }`}
                              >
                                {goal.title}
                              </p>
                              {goal.targetNote && (
                                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                  {goal.targetNote}
                                </p>
                              )}
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteGoal(goal.id)}
                            aria-label={`Delete ${goal.title}`}
                            className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
