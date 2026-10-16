export const catalogGridClassName =
  "grid grid-cols-[minmax(280px,1fr)_160px_100px_max-content] gap-x-5 max-[1100px]:grid-cols-[minmax(240px,1fr)_140px_max-content] max-[1100px]:gap-x-3 max-[767px]:grid-cols-[minmax(0,1fr)_auto]";
export const catalogRowLayoutClassName =
  "relative col-span-full grid grid-cols-subgrid items-center gap-y-5 px-4 py-3";
export const catalogRowClassName = `${catalogRowLayoutClassName} group transition-colors duration-150 hover:bg-mist focus-within:bg-mist motion-reduce:transition-none`;
export const catalogEntryLinkClassName =
  "after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:shadow-none focus-visible:after:outline-[3px] focus-visible:after:outline-offset-2 focus-visible:after:outline-primary focus-visible:after:shadow-[0_0_0_5px_var(--focus-halo)]";
export const catalogActionClassName =
  "relative z-10 max-[767px]:col-start-2 max-[767px]:row-start-1 max-[767px]:row-span-2";
