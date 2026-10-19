'use client';

/** Explicit editor drafts and navigation protection (FR-ADM-11, GR-01/03/06).
 * Existing editors own their fields, validation and API calls. Nothing is stored
 * in browser storage and no write is queued or automatically replayed. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { formatNumber, numeralsFor, t } from '@platform/i18n';
import { Button, Sheet, useLocale } from '@platform/ui';
const Context = createContext(null);
const Feedback = createContext(null);

export function reviewField(
  label,
  before,
  after,
  display = (value) =>
    Array.isArray(value)
      ? value
          .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item) : ''))
          .join(', ')
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '',
) {
  return {
    label,
    before: display(before),
    after: display(after),
    beforeKey: JSON.stringify(before) ?? '',
    afterKey: JSON.stringify(after) ?? '',
  };
}

export function AdminManagementProvider({ children }) {
  const locale = useLocale();
  const [drafts, setDrafts] = useState(new Map());
  const [busy, setBusy] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [asking, setAsking] = useState(null);
  const active = useRef(false);
  const focus = useRef(null);
  const register = useCallback((id, draft) => {
    setDrafts((current) => {
      if (draft === null && !current.has(id)) return current;
      const next = new Map(current);
      if (draft === null) next.delete(id);
      else next.set(id, draft);
      return next;
    });
  }, []);
  const confirm = useCallback((review, discard = false) => {
    if (active.current) return Promise.resolve(false);
    active.current = true;
    focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise((resolve) => setAsking({ review, discard, resolve }));
  }, []);
  const finish = (answer) => {
    const pending = asking;
    setAsking(null);
    active.current = false;
    pending?.resolve(answer);
  };
  const navigate = useCallback(
    (next) => {
      if (busy) return;
      if (drafts.size === 0) {
        next();
        return;
      }
      void confirm(
        {
          title: t('manageLeaveTitle', locale),
          note: t('manageLeaveNote', locale),
          fields: [...drafts.values()].flatMap((d) => d.fields),
        },
        true,
      ).then((approved) => {
        if (!approved) return;
        for (const draft of drafts.values()) draft.reset();
        next();
      });
    },
    [busy, drafts, confirm, locale],
  );
  useEffect(() => {
    const beforeUnload = (event) => {
      if (busy || drafts.size > 0) event.preventDefault();
    };
    globalThis.addEventListener('beforeunload', beforeUnload);
    return () => globalThis.removeEventListener('beforeunload', beforeUnload);
  }, [busy, drafts]);
  const value = useMemo(
    () => ({ busy, readFailed, setReadFailed, drafts, setBusy, register, confirm, navigate }),
    [busy, readFailed, drafts, register, confirm, navigate],
  );
  return (
    <Context.Provider value={value}>
      <Feedback.Provider value={{ asking, finish, focus: () => focus.current }}>
        {children}
      </Feedback.Provider>
    </Context.Provider>
  );
}
/** Render inside the existing hospital theme so notices and portal dialogs
 * inherit the same branding as their workspace. */
export function AdminManagementFeedback() {
  const locale = useLocale();
  const management = useAdminManagement();
  const feedback = useContext(Feedback);
  if (management === null || feedback === null) return null;
  const { drafts, busy, navigate } = management;
  const { asking, finish, focus } = feedback;
  return (
    <>
      {drafts.size === 0 ? null : (
        <div className="admin-draft-notice" role="status" data-testid="management-unsaved">
          <strong>
            {t('manageUnsaved', locale)} ·{' '}
            {formatNumber(
              [...drafts.values()].reduce((n, d) => n + d.fields.length, 0),
              numeralsFor(locale),
            )}
          </strong>
          {[...drafts.values()].some((d) => d.conflict) ? (
            <p>{t('manageServerChanged', locale)}</p>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            {...(busy ? { disabled: true, disabledReason: t('manageSaving', locale) } : {})}
            onClick={() => navigate(() => undefined)}
            data-testid="management-discard"
          >
            {t('manageDiscard', locale)}
          </Button>
        </div>
      )}
      <Sheet
        console
        restoreFocusTo={focus}
        variant="modal"
        open={asking !== null}
        dismissible={false}
        title={asking?.review.title ?? t('manageReview', locale)}
        description={asking?.review.note ?? t('manageReviewNote', locale)}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <div className="admin-workspace admin-review-panel" data-testid="management-confirm">
          {asking?.review.scope === undefined ? null : (
            <p className="admin-scope">{asking.review.scope}</p>
          )}
          {asking?.review.fields?.length ? (
            <div className="admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('manageField', locale)}</th>
                    <th>{t('manageBefore', locale)}</th>
                    <th>{t('manageAfter', locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {asking.review.fields.map((f, i) => (
                    <tr key={i}>
                      <th>{f.label}</th>
                      <td>
                        {(f.beforeKey === 'true'
                          ? t('manageYes', locale)
                          : f.beforeKey === 'false'
                            ? t('manageNo', locale)
                            : f.before) || t('manageBlank', locale)}
                      </td>
                      <td>
                        {(f.afterKey === 'true'
                          ? t('manageYes', locale)
                          : f.afterKey === 'false'
                            ? t('manageNo', locale)
                            : f.after) || t('manageBlank', locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="cf-confirm-actions">
            <Button
              variant="secondary"
              onClick={() => finish(false)}
              data-testid="management-confirm-cancel"
            >
              {t('manageKeepEditing', locale)}
            </Button>
            <Button onClick={() => finish(true)} data-testid="management-confirm-save">
              {t(asking?.discard ? 'manageDiscard' : 'manageConfirm', locale)}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
export function useAdminManagement() {
  return useContext(Context);
}

/** The caller supplies explicit before/after fields and its own state reset. */
export function useManagementDraft(id, title, fields, baseRun, reset) {
  const management = useAdminManagement();
  const register = management?.register;
  const changes = fields.filter((f) => f.beforeKey !== f.afterKey);
  const [conflict, setConflict] = useState(false);
  const acknowledged = useRef(false);
  const latest = useRef({ fields, changes, reset, title });
  latest.current = { fields, changes, reset, title };
  const source = JSON.stringify(fields.map((f) => f.beforeKey));
  const edited = JSON.stringify(fields.map((f) => f.afterKey));
  const previous = useRef({ source, dirty: changes.length > 0 });
  useEffect(() => {
    if (previous.current.source !== source) {
      if (acknowledged.current || !previous.current.dirty) {
        latest.current.reset();
        setConflict(false);
      } else setConflict(true);
      acknowledged.current = false;
    }
    previous.current = { source, dirty: latest.current.changes.length > 0 };
  }, [source, edited]);
  const resetCurrent = useCallback(() => {
    latest.current.reset();
    setConflict(false);
    acknowledged.current = false;
  }, []);
  useEffect(() => {
    register?.(
      id,
      latest.current.changes.length === 0 && !conflict
        ? null
        : { title, fields: latest.current.changes, conflict, reset: resetCurrent },
    );
    return () => register?.(id, null);
  }, [register, id, title, source, edited, conflict, resetCurrent]);
  return useCallback(
    async (call, success, review) => {
      if (conflict) return false;
      const submitted = JSON.stringify(latest.current.fields.map((field) => field.afterKey));
      return await baseRun(
        async () => {
          const result = await call();
          if (result.ok && review?.fields === undefined)
            acknowledged.current =
              submitted === JSON.stringify(latest.current.fields.map((field) => field.afterKey));
          return result;
        },
        success,
        { title: latest.current.title, fields: latest.current.changes, ...review },
      );
    },
    [baseRun, conflict],
  );
}
