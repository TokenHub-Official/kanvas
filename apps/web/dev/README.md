# Visual selector scenarios

Start the regular web development server, then open `/dev/visual-selectors.html`.

This entry mounts the actual shared selectors, Agent avatar editor, tool icon editor,
and Brand Logo adapter with production theme/i18n. It is not imported by the
production application and is not a Vite build entry.

All `/api/` requests in this page are intercepted locally. It never connects to the
business database or uploads files to storage. Brand list/detail/preview responses
are simulated. Agent upload intentionally fails with HTTP 503; tool image cropping
remains local. Reloading restores the fixture. Keep this entry development-only.

Controls cover 0/1/3/12/60 assets, initial loading, list failure, corrupt image bytes,
next-page failure, unavailable options, permission changes, failed confirmation,
and an existing selection outside the first page. Use the brand integration control to exercise
real pagination, ArtifactPreview and pre-apply validation rather than only the
shared UI source contract.

Validate desktop and 560px/390px viewports. Check that preview/retry do not select,
Cancel/Escape do not apply, failed pagination preserves previous pages, and failed
confirmation preserves the selection. Uploaded files should be disposable test
images only; the file remains local to this fixture.
