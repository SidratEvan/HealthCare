/** Placeholders in the shape of the cards that will arrive. */
export function SkeletonCards({ count = 2, height = 112, testId }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" data-testid={testId}>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="rounded-md border border-line bg-surface p-4 shadow-1"
          style={{ height }}
        >
          <div className="flex items-center gap-3">
            <div className="size-12 shrink-0 rounded-pill bg-sunken motion-safe:animate-pulse" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-4 w-2/3 rounded-xs bg-sunken motion-safe:animate-pulse" />
              <div className="h-3 w-1/2 rounded-xs bg-sunken motion-safe:animate-pulse" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A plain sentence about what there is, and one way on if there is one. */
export function EmptyState({ icon, children, action, testId }) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-3 rounded-md border border-line bg-surface px-5 py-6 text-center"
    >
      {icon === undefined ? null : (
        <span className="flex size-12 items-center justify-center rounded-pill bg-brand-100 text-brand-600">
          {icon}
        </span>
      )}
      <div className="text-body-md text-ink-secondary">{children}</div>
      {action ?? null}
    </div>
  );
}

/** A request that failed, said as that, with the retry beside it. */
export function FailedState({ children, action, testId, role = 'alert' }) {
  return (
    <div
      role={role}
      data-testid={testId}
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5"
    >
      <p className="text-body-md text-ink">{children}</p>
      {action}
    </div>
  );
}

/** "No connection": stated, announced, and not mistaken for an emergency. */
export function OfflineNotice({ children, testId }) {
  return (
    <p
      role="status"
      data-testid={testId}
      className="rounded-sm border border-warn-border bg-warn-100 px-4 py-3 text-body-md text-warn-700"
    >
      {children}
    </p>
  );
}

/** A white card with the shared radius, line and shadow. */
export function Panel({ children, className = '', testId }) {
  return (
    <div
      data-testid={testId}
      className={`rounded-md border border-line bg-surface shadow-1 ${className}`}
    >
      {children}
    </div>
  );
}
