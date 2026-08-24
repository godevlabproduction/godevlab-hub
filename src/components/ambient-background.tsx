// Four soft, drifting color fields behind the whole app — same device coachfio's
// hub uses to give the glass panels something to lens (frontend/hub-dark.css's
// .hub-sky). Pure CSS: fixed, blurred, z-index below everything, decorative
// only, and inert entirely under prefers-reduced-motion (see globals.css).
export function AmbientBackground() {
  return (
    <div aria-hidden className="ambient-sky">
      <span className="ambient-sky__blob ambient-sky__blob--1" />
      <span className="ambient-sky__blob ambient-sky__blob--2" />
      <span className="ambient-sky__blob ambient-sky__blob--3" />
      <span className="ambient-sky__blob ambient-sky__blob--4" />
    </div>
  );
}
