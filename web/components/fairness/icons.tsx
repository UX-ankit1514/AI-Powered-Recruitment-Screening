type P = { className?: string };

export const IconAlert = ({ className = "i" }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4.2M12 17h.01" />
  </svg>
);

export const IconCheck = ({ className = "i" }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
  </svg>
);

export const IconEye = ({ className = "i" }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </svg>
);
