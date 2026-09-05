// Portable suites run on every host. Native Windows checks are a separate,
// required suite set on Windows, where CI and DEPLOY.cmd can execute cmd.exe.
const suites = names => names.filter(name => /^test_[^/\\]*\.mjs$/.test(name)).sort();

export function selectSuites(portableNames, windowsNames, platform) {
  const portable = suites(portableNames);
  if (platform !== 'win32') return portable;
  const windows = suites(windowsNames);
  if (!windows.includes('test_deploy_cmd.mjs'))
    throw new Error('Windows coverage is missing test/windows/test_deploy_cmd.mjs');
  return [...portable, ...windows.map(name => 'windows/' + name)];
}

// Node versions choose different default reporters. The gate reads TAP
// counters, so request TAP explicitly instead of treating unseen skips as green.
export function spawnWithTap(spawn, command, args, options) {
  return spawn(command, ['--test-reporter=tap', ...args], options);
}
