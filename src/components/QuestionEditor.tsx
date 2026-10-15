'use client';
import { Plus } from 'lucide-react';
import { btn, input, cn } from '@/lib/design';

export interface DraftQuestion {
  id: string;
  label: string;
  helpText?: string;
  scope: 'song' | 'submission';
  required: boolean;
  maxLength: number;
}

let seq = 0;
const newId = () => `q${Date.now().toString(36)}${seq++}`;

/**
 * Question ids are PERMANENT — student answers key off them. Renaming a label
 * keeps existing answers readable; reusing an id would silently re-attach old
 * answers to a different question.
 */
export function QuestionEditor({
  questions, onChange, editing = false,
}: {
  questions: DraftQuestion[];
  onChange: (q: DraftQuestion[]) => void;
  /** True when editing a survey that may already have answers. */
  editing?: boolean;
}) {
  const perSong = questions.filter((q) => q.scope === 'song').length;

  function update(id: string, next: Partial<DraftQuestion>) {
    onChange(questions.map((q) => (q.id === id ? { ...q, ...next } : q)));
  }

  return (
    <fieldset className="pt-4 border-t border-rule">
      <legend className="text-sm font-medium mb-1">Questions for students</legend>
      {editing && (
        <p className="text-sm text-muted mb-3">
          Removing a question here hides it from new responses. Answers students
          already gave are kept and stay visible when you review them.
        </p>
      )}
      <p className="text-sm text-muted mb-3">
        Ask once per song, or once for the whole submission.
        {perSong > 0 && (
          <span className="block mt-0.5">
            {perSong} per-song question{perSong === 1 ? '' : 's'} — a student with 10 songs
            answers {perSong * 10} boxes.
          </span>
        )}
      </p>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <div key={q.id} className="border border-rule rounded-lg p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-medium text-muted pt-2.5">Question {i + 1}</span>
              <button type="button" className={btn.ghostSm}
                aria-label={`Remove question ${i + 1}`}
                onClick={() => onChange(questions.filter((x) => x.id !== q.id))}>
                Remove
              </button>
            </div>
            <div>
              <label htmlFor={`ql-${q.id}`} className="block text-sm font-medium mb-1.5">Question</label>
              <input id={`ql-${q.id}`} className={input.base} value={q.label}
                onChange={(e) => update(q.id, { label: e.target.value })}
                placeholder="Why did you pick this song?" />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={`qs-${q.id}`} className="block text-sm font-medium mb-1.5">Ask</label>
                <select id={`qs-${q.id}`} className={input.base} value={q.scope}
                  onChange={(e) => update(q.id, { scope: e.target.value as 'song' | 'submission' })}>
                  <option value="submission">Once per submission</option>
                  <option value="song">Once per song</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2.5 text-sm min-h-[44px]">
                  <input type="checkbox" className="w-4 h-4" checked={q.required}
                    onChange={(e) => update(q.id, { required: e.target.checked })} />
                  Required
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className={cn(btn.secondary, 'mt-3')}
        onClick={() => onChange([...questions, {
          id: newId(), label: '', scope: 'submission', required: true, maxLength: 500,
        }])}>
        <Plus className="w-5 h-5" aria-hidden="true" /> Add question
      </button>
    </fieldset>
  );
}
