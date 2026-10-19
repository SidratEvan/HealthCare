'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { localName, t } from '@platform/i18n';
import { Button, Card, useLocale } from '@platform/ui';

import { reviewField, useAdminManagement } from '@/components/AdminManagementContext';
import {
  assignmentChanges,
  sameDesk,
  reconcileAssignmentResults,
  writeAssignments,
} from '@/lib/deskAssignments';
import { loadDesks, settingsApi } from '@/lib/settings';

export function StaffDeskAssignments({ member, snapshot, offline, onChanged }) {
  const locale = useLocale();
  const management = useAdminManagement();
  const register = management?.register;
  const [desks, setDesks] = useState(null);
  const [wanted, setWanted] = useState(new Set());
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const initialized = useRef(null);
  const [needsRead, setNeedsRead] = useState(false);
  const read = useCallback(async () => {
    const result = await loadDesks();
    if (typeof result === 'string') {
      setError(t('loadFailed', locale));
      return null;
    }
    setDesks(result);
    setResults((current) => reconcileAssignmentResults(current, result));
    setNeedsRead(false);
    setError('');
    return result;
  }, [locale]);
  useEffect(() => {
    let alive = true;
    void loadDesks().then((result) => {
      if (!alive) return;
      if (typeof result === 'string') setError(t('loadFailed', locale));
      else {
        setDesks(result);
        if (initialized.current !== member.id) {
          setWanted(new Set(result.filter((d) => d.staffIds.includes(member.id)).map((d) => d.id)));
          initialized.current = member.id;
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [member.id, locale]);
  const changes = desks === null ? [] : assignmentChanges(desks, member.id, wanted);
  const before =
    desks
      ?.filter((d) => d.staffIds.includes(member.id))
      .map((d) => d.id)
      .sort() ?? [];
  const names = (ids) =>
    Array.isArray(ids) && ids.length
      ? ids
          .map((id) => desks?.find((d) => d.id === id))
          .filter((d) => d !== undefined)
          .map((d) => localName(locale, d.nameBn, d.nameEn))
          .join(', ')
      : t('manageNoDesk', locale);
  const field = reviewField(t('manageDesks', locale), before, [...wanted].sort(), names);
  const latest = useRef({ desks, field });
  latest.current = { desks, field };
  const reset = useCallback(() => {
    setWanted(
      new Set(
        latest.current.desks?.filter((d) => d.staffIds.includes(member.id)).map((d) => d.id) ?? [],
      ),
    );
  }, [member.id]);
  useEffect(() => {
    register?.(
      `staff-desks-${member.id}`,
      changes.length
        ? { title: member.fullName, fields: [latest.current.field], conflict: false, reset }
        : null,
    );
    return () => register?.(`staff-desks-${member.id}`, null);
  }, [
    register,
    member.id,
    member.fullName,
    field.beforeKey,
    field.afterKey,
    changes.length,
    reset,
  ]);
  async function save() {
    if (saving.current || offline || needsRead || desks === null || management === null) return;
    saving.current = true;
    setBusy(true);
    management.setBusy(true);
    setError('');
    try {
      const fresh = await read();
      if (fresh === null) return;
      const preserveIntent = (current) => {
        const next = new Set(
          current.filter((d) => d.staffIds.includes(member.id)).map((d) => d.id),
        );
        for (const change of changes) {
          if (wanted.has(change.before.id)) next.add(change.before.id);
          else next.delete(change.before.id);
        }
        setWanted(next);
      };
      if (
        fresh.length !== desks.length ||
        desks.some((before) => !fresh.some((current) => sameDesk(before, current)))
      ) {
        preserveIntent(fresh);
        setError(t('manageDeskChanged', locale));
        return;
      }
      if ([...wanted].some((id) => !fresh.some((d) => d.id === id))) {
        setError(t('manageDeskChanged', locale));
        return;
      }
      const approved = await management.confirm({
        title: t('manageAssignDesks', locale),
        scope: `${member.fullName} · ${localName(locale, snapshot.hospital.nameBn, snapshot.hospital.nameEn)}`,
        fields: [field],
        note: `${t('manageDeskConsequence', locale)} ${t('manageDeskWriteNote', locale)}`,
      });
      if (!approved || !navigator.onLine) return;
      const outcome = await writeAssignments(
        changes,
        (change) =>
          settingsApi.updateDesk(change.before.id, {
            staffIds: [...change.staffIds],
            expected: {
              nameBn: change.before.nameBn,
              nameEn: change.before.nameEn,
              doctorIds: [...change.before.doctorIds],
              staffIds: [...change.before.staffIds],
            },
          }),
        loadDesks,
      );
      setResults(outcome.results);
      if (outcome.desks === null) {
        setError(t('manageUncertain', locale));
        setNeedsRead(true);
      } else {
        setDesks(outcome.desks);
        preserveIntent(outcome.desks);
        if (outcome.results.some((result) => result.status !== 'completed' || !result.confirmed))
          setError(t('manageDeskWriteNote', locale));
      }
      await onChanged();
    } finally {
      saving.current = false;
      setBusy(false);
      management.setBusy(false);
    }
  }
  return (
    <Card data-testid="staff-desk-assignments">
      <h3>{t('manageAssignDesks', locale)}</h3>
      <p>{t('manageDeskConsequence', locale)}</p>
      {error ? <p role="alert">{error}</p> : null}
      {desks === null || needsRead ? (
        <Button variant="secondary" onClick={() => void read()}>
          {t('manageReconcile', locale)}
        </Button>
      ) : (
        <div className="admin-assignment-options">
          {desks.map((desk) => (
            <label key={desk.id}>
              <input
                type="checkbox"
                checked={wanted.has(desk.id)}
                disabled={busy || offline}
                onChange={(event) => {
                  const next = new Set(wanted);
                  if (event.target.checked) next.add(desk.id);
                  else next.delete(desk.id);
                  setWanted(next);
                }}
                data-testid={`staff-assignment-${desk.id}`}
              />
              {localName(locale, desk.nameBn, desk.nameEn)}
            </label>
          ))}
        </div>
      )}
      {changes.length ? (
        <div className="admin-assignment-summary">
          <p>
            {t('manageBefore', locale)}: {field.before}
          </p>
          <p>
            {t('manageAfter', locale)}: {field.after}
          </p>
          <Button
            loading={busy}
            {...(offline || busy || desks === null || needsRead
              ? {
                  disabled: true,
                  disabledReason: t(offline ? 'settingsOffline' : 'manageSaving', locale),
                }
              : {})}
            onClick={() => void save()}
            data-testid="staff-assignments-save"
          >
            {t(results.length ? 'manageSaveRemaining' : 'manageConfirm', locale)}
          </Button>
        </div>
      ) : null}
      {results.length ? (
        <div role="status" data-testid="staff-assignment-results">
          <h4>{t('manageDeskResults', locale)}</h4>
          <ul>
            {results.map((result) => (
              <li key={result.change.before.id}>
                {localName(locale, result.change.before.nameBn, result.change.before.nameEn)} —{' '}
                {t(
                  {
                    completed: 'manageCompleted',
                    rejected: 'manageRejected',
                    uncertain: 'manageUncertain',
                    pending: 'managePending',
                  }[result.status],
                  locale,
                )}
                {result.confirmed ? ` · ${t('manageConfirmed', locale)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
