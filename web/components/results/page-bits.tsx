import Link from "next/link";

/** Page head + one card explaining what's missing (signed in without a company, no jobs yet, ...). */
export function EmptyPage({ title, heading, body, action }: { title: string; heading: string; body: string; action?: { href: string; label: string } }) {
  return (
    <>
      <div className="phead">
        <div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="card sec" style={{ maxWidth: 640 }}>
        <h2>{heading}</h2>
        <p className="hint" style={{ marginTop: 4 }}>
          {body}
        </p>
        {action ? (
          <Link className="btn" href={action.href}>
            {action.label}
          </Link>
        ) : null}
      </div>
    </>
  );
}

export function PageSkeleton({ title, label }: { title: string; label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <div className="phead">
        <div>
          <h1 className="muted">{title}</h1>
        </div>
      </div>
      <div className="card" style={{ height: 320 }} />
    </div>
  );
}
