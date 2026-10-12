'use client';

import { useId, useMemo } from 'react';
import { Eye } from 'lucide-react';
import type { PersonaDto } from '@app-starter/shared';
import { Badge } from '@/components/ui/badge';

const HELP_TEXT = 'Admins can check what a colleague is allowed to see. View-as is logged.';

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ViewAsPicker({
  personas,
  value,
  onChange,
  disabled,
}: {
  personas: PersonaDto[];
  value: string | null;
  onChange: (email: string | null) => void;
  disabled?: boolean;
}) {
  const selectId = useId();

  const groups = useMemo(() => {
    const map = new Map<string, PersonaDto[]>();
    for (const persona of personas) {
      const label = persona.department ? capitalize(persona.department) : 'Other';
      const list = map.get(label) ?? [];
      list.push(persona);
      map.set(label, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });
  }, [personas]);

  const selected = value ? personas.find((p) => p.email === value) ?? null : null;
  const firstName = selected ? selected.name.split(' ')[0] : null;

  return (
    <div className="flex flex-wrap items-center gap-2" title={HELP_TEXT}>
      <label htmlFor={selectId} className="text-xs font-medium text-muted-foreground">
        Answer as
      </label>
      <select
        id={selectId}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        className="h-8 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">Myself</option>
        {groups.map(([department, members]) => (
          <optgroup key={department} label={department}>
            {members.map((persona) => (
              <option key={persona.email} value={persona.email}>
                {persona.title ? `${persona.name} — ${persona.title}` : persona.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {selected && firstName && (
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        >
          <Eye className="h-3 w-3" aria-hidden="true" />
          Viewing as {firstName}
        </Badge>
      )}
    </div>
  );
}