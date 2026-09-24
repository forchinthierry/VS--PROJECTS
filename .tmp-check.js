const fs = require('fs');
for (const file of [
  'admin.html',
  'apply.html'
]) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  if (!scripts.length) throw new Error('No script blocks found in ' + file);
  const js = scripts[scripts.length - 1][1];
  try {
    new Function(js);
    console.log(file + ' :: script block OK');
  } catch (error) {
    console.error(file + ' :: syntax error');
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}
