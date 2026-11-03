// Ad-hoc code-sign the packed .app on macOS so Apple Silicon (and Gatekeeper on
// Sonoma) accepts the bundle after electron-builder has modified it. No Apple
// Developer account needed. Skipped automatically when building on other OSes.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return;
  // Universal builds pack x64/arm64 into "*-temp" dirs first and merge them; only sign the final app.
  if (/-temp$/.test(context.appOutDir)) return;
  const appName = context.packager.appInfo.productFilename + '.app';
  const appPath = path.join(context.appOutDir, appName);
  console.log('  • ad-hoc signing', appPath);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
