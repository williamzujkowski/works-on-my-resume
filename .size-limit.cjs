// Per-file JS bundle budgets enforced by CI (perf-budget workflow) and the
// `npm run size` script. Limits are the current measured size plus modest
// headroom -- bumping them is a deliberate act that should be justified in
// the commit message.
//
// We size raw shipped bytes (gzip:false, brotli:false) because the caps are
// about what we ship over the wire, not what compresses well. The `path`
// values are globs so the build's content-hashed filenames resolve at
// check time.
module.exports = [
  {
    name: 'ResumeStudio',
    path: 'dist/_astro/ResumeStudio.*.js',
    limit: '375 KB',
    gzip: false,
    brotli: false,
  },
  {
    name: 'client',
    path: 'dist/_astro/client.*.js',
    limit: '375 KB',
    gzip: false,
    brotli: false,
  },
  {
    name: 'themes',
    path: 'dist/_astro/themes.*.js',
    limit: '500 KB',
    gzip: false,
    brotli: false,
  },
];
