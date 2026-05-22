/**
 * Type declaration for Vite's `?raw` import suffix on CSS files.
 *
 * `import resumeCss from '../styles/resume.css?raw'` asks Vite to hand back
 * the stylesheet's source as a plain string instead of injecting it as a
 * `<style>` tag. The export pipeline uses this so the in-app `resume.css`
 * and the standalone-HTML export share one source of truth.
 */
declare module '*.css?raw' {
  const content: string;
  export default content;
}
